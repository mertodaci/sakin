const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { sign, requireAuth } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 dakika

// Kaba kuvvet (brute-force) saldirilarina karsi: ayni IP'den kisa surede cok fazla
// giris/kayit/sifre-sifirlama denemesi engellenir.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Çok fazla giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin." } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Çok fazla kayıt denemesi yapıldı. Lütfen daha sonra tekrar deneyin." } });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { error: "Çok fazla talep gönderildi. Lütfen daha sonra tekrar deneyin." } });

// Sifre politikasi: en az 8 karakter, en az bir harf ve bir rakam icermeli.
function validatePassword(pw) {
  if (!pw || pw.length < 8) return "Şifre en az 8 karakter olmalıdır.";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(pw)) return "Şifre en az bir harf içermelidir.";
  if (!/[0-9]/.test(pw)) return "Şifre en az bir rakam içermelidir.";
  return null;
}

function findByEmail(email) {
  return prisma.user.findFirst({ where: { email: { equals: email || "", mode: "insensitive" } } });
}

// Kayit icin bos/musait daire listesi (auth gerektirmez, kayit formunda kullanilir)
router.get("/units-for-signup", async (req, res) => {
  const units = await prisma.unit.findMany({ orderBy: [{ block: "asc" }, { no: "asc" }] });
  res.json(units.map((u) => ({ id: u.id, label: `${u.block} - Daire ${u.no}` })));
});

router.post("/register", registerLimiter, async (req, res) => {
  const { name, email, phone, password, unitId } = req.body || {};

  if (!name || !email || !password || !unitId) {
    return res.status(400).json({ error: "Ad, e-posta, şifre ve daire seçimi zorunludur." });
  }
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  if (await findByEmail(email)) {
    return res.status(409).json({ error: "Bu e-posta ile zaten bir hesap var." });
  }
  const unit = await prisma.unit.findUnique({ where: { id: unitId } });
  if (!unit) return res.status(400).json({ error: "Geçersiz daire seçimi." });

  await prisma.user.create({
    data: { name, email, phone: phone || "", passwordHash: bcrypt.hashSync(password, 10), role: "sakin", unitId, isApproved: false },
  });

  const admins = await prisma.user.findMany({ where: { role: "yonetici" } });
  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map((a) => ({ userId: a.id, message: `${name} kayıt onayı bekliyor.`, link: "#/kullanicilar" })),
    });
  }

  res.status(201).json({ message: "Kaydınız alındı. Yönetici onayından sonra giriş yapabilirsiniz." });
});

router.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  const user = await findByEmail(email);

  if (user && user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
    return res.status(423).json({ error: `Çok fazla hatalı deneme nedeniyle hesabınız geçici olarak kilitlendi. ${minutesLeft} dakika sonra tekrar deneyin.` });
  }

  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    if (user) {
      const failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      const lockOut = failedLoginAttempts >= MAX_FAILED_ATTEMPTS;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts, lockedUntil: lockOut ? new Date(Date.now() + LOCK_DURATION_MS) : user.lockedUntil },
      });
      if (lockOut) {
        await prisma.activityLog.create({
          data: { actorId: "sistem", actorName: "Sistem", action: "user.lockout", detail: `${user.name} hesabı ${MAX_FAILED_ATTEMPTS} hatalı denemeden sonra kilitlendi.`, scopeUnitId: user.unitId || null },
        });
      }
    }
    return res.status(401).json({ error: "E-posta veya şifre hatalı." });
  }

  if (!user.isApproved) {
    return res.status(403).json({ error: "Hesabınız henüz yönetici onayı bekliyor." });
  }
  if (user.isActive === false) {
    return res.status(403).json({ error: "Hesabınız pasife alınmış. Yardım için yönetici ile iletişime geçin." });
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });

  const token = sign(user);
  const unit = user.unitId ? await prisma.unit.findUnique({ where: { id: user.unitId } }) : null;
  res.json({
    token,
    mustChangePassword: !!user.mustChangePassword,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, unitId: user.unitId, department: user.department || null, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null },
  });
});

// Sifremi unuttum: e-posta/SMS altyapisi olmadigindan, istek yoneticiye iletilir.
// Yonetici "Kullanicilar" ekranindan tek tikla gecici sifre uretip sakine iletir.
router.post("/forgot-password", forgotLimiter, async (req, res) => {
  const { email } = req.body || {};
  const user = await findByEmail(email);
  // Kullanici bulunamasa bile ayni mesaji donduruyoruz (e-posta enumerasyonunu onlemek icin)
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { resetRequestedAt: new Date() } });
    const admins = await prisma.user.findMany({ where: { role: "yonetici" } });
    if (admins.length) {
      await prisma.notification.createMany({
        data: admins.map((a) => ({ userId: a.id, message: `${user.name} şifre sıfırlama talep etti.`, link: "#/kullanicilar" })),
      });
    }
  }
  res.json({ message: "Talebiniz alındı. Yönetici sizinle iletişime geçip geçici bir şifre tanımlayacaktır." });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const unit = user.unitId ? await prisma.unit.findUnique({ where: { id: user.unitId } }) : null;
  res.json({ id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, unitId: user.unitId, department: user.department || null, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null, mustChangePassword: !!user.mustChangePassword, favoriteTabs: user.favoriteTabs || [] });
});

// Sidebar'da yildizlanan sayfalar - profil ozelinde, herhangi bir rol
// kendi favorilerini yonetebilir (yonetici yetkisi gerekmez). Frontend
// her degisiklikte guncel listenin tamamini gonderir (ekle/cikar farki
// yerine tek basit replace).
router.patch("/favorites", requireAuth, async (req, res) => {
  const { favoriteTabs } = req.body || {};
  if (!Array.isArray(favoriteTabs) || !favoriteTabs.every((t) => typeof t === "string")) {
    return res.status(400).json({ error: "favoriteTabs bir metin dizisi olmalıdır." });
  }
  const updated = await prisma.user.update({ where: { id: req.user.id }, data: { favoriteTabs } });
  res.json({ favoriteTabs: updated.favoriteTabs });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  const { currentPassword, newPassword } = req.body || {};
  if (!user || !bcrypt.compareSync(currentPassword || "", user.passwordHash)) {
    return res.status(401).json({ error: "Mevcut şifre hatalı." });
  }
  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  // Sifre degisince diger tum cihazlardaki eski oturumlar gecersiz kilinir; bu
  // cihaz icin yeni bir token uretip donduruyoruz ki kullanici disari atilmasin.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: bcrypt.hashSync(newPassword, 10), mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  const newToken = sign(updated);
  res.json({ message: "Şifreniz güncellendi.", token: newToken });
});

// "Tum oturumlari kapat": baska bir cihazda/tarayicida acik kalmis olabilecek
// oturumlari gecersiz kilar (orn. cihaz kaybolduysa). Bu cihaz icin yeni token doner.
router.post("/logout-all-sessions", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  const newToken = sign(updated);
  res.json({ message: "Tüm oturumlar kapatıldı. Bu cihazda oturumunuz devam ediyor.", token: newToken });
});

module.exports = router;
