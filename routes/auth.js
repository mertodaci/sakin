const express = require("express");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { sign, requireAuth } = require("../middleware/auth");

const router = express.Router();

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

// Kayit icin bos/musait daire listesi (auth gerektirmez, kayit formunda kullanilir)
router.get("/units-for-signup", (req, res) => {
  const data = db.load();
  res.json(
    data.units.map((u) => ({ id: u.id, label: `${u.block} - Daire ${u.no}` }))
  );
});

router.post("/register", registerLimiter, (req, res) => {
  const data = db.load();
  const { name, email, phone, password, unitId } = req.body || {};

  if (!name || !email || !password || !unitId) {
    return res.status(400).json({ error: "Ad, e-posta, şifre ve daire seçimi zorunludur." });
  }
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  if (data.users.some((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "Bu e-posta ile zaten bir hesap var." });
  }
  if (!data.units.some((u) => u.id === unitId)) {
    return res.status(400).json({ error: "Geçersiz daire seçimi." });
  }

  const user = {
    id: db.uid(),
    name,
    email,
    phone: phone || "",
    passwordHash: bcrypt.hashSync(password, 10),
    role: "sakin",
    unitId,
    isApproved: false,
    isActive: true,
    tokenVersion: 0,
    failedLoginAttempts: 0,
    lockedUntil: null,
    mustChangePassword: false,
    resetRequestedAt: null,
    createdAt: new Date().toISOString(),
  };
  data.users.push(user);

  const admins = data.users.filter((u) => u.role === "yonetici");
  admins.forEach((a) => {
    data.notifications.push({
      id: db.uid(),
      userId: a.id,
      message: `${name} kayıt onayı bekliyor.`,
      read: false,
      date: new Date().toISOString(),
      link: "#/kullanicilar",
    });
  });

  db.save();
  res.status(201).json({ message: "Kaydınız alındı. Yönetici onayından sonra giriş yapabilirsiniz." });
});

router.post("/login", loginLimiter, (req, res) => {
  const data = db.load();
  const { email, password } = req.body || {};
  const user = data.users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());

  if (user && user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.lockedUntil) - new Date()) / 60000);
    return res.status(423).json({ error: `Çok fazla hatalı deneme nedeniyle hesabınız geçici olarak kilitlendi. ${minutesLeft} dakika sonra tekrar deneyin.` });
  }

  if (!user || !bcrypt.compareSync(password || "", user.passwordHash)) {
    if (user) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
        db.logActivity(data, null, "user.lockout", `${user.name} hesabı ${MAX_FAILED_ATTEMPTS} hatalı denemeden sonra kilitlendi.`, user.unitId || null);
      }
      db.save();
    }
    return res.status(401).json({ error: "E-posta veya şifre hatalı." });
  }

  if (!user.isApproved) {
    return res.status(403).json({ error: "Hesabınız henüz yönetici onayı bekliyor." });
  }
  if (user.isActive === false) {
    return res.status(403).json({ error: "Hesabınız pasife alınmış. Yardım için yönetici ile iletişime geçin." });
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  db.save();

  const token = sign(user);
  const unit = user.unitId ? data.units.find((u) => u.id === user.unitId) : null;
  res.json({
    token,
    mustChangePassword: !!user.mustChangePassword,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, unitId: user.unitId, department: user.department || null, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null },
  });
});

// Sifremi unuttum: e-posta/SMS altyapisi olmadigindan, istek yoneticiye iletilir.
// Yonetici "Kullanicilar" ekranindan tek tikla gecici sifre uretip sakine iletir.
router.post("/forgot-password", forgotLimiter, (req, res) => {
  const data = db.load();
  const { email } = req.body || {};
  const user = data.users.find((u) => u.email.toLowerCase() === String(email || "").toLowerCase());
  // Kullanici bulunamasa bile ayni mesaji donduruyoruz (e-posta enumerasyonunu onlemek icin)
  if (user) {
    user.resetRequestedAt = new Date().toISOString();
    data.users.filter((u) => u.role === "yonetici").forEach((a) => {
      data.notifications.push({ id: db.uid(), userId: a.id, message: `${user.name} şifre sıfırlama talep etti.`, read: false, date: new Date().toISOString(), link: "#/kullanicilar" });
    });
    db.save();
  }
  res.json({ message: "Talebiniz alındı. Yönetici sizinle iletişime geçip geçici bir şifre tanımlayacaktır." });
});

router.get("/me", requireAuth, (req, res) => {
  const data = db.load();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const unit = user.unitId ? data.units.find((u) => u.id === user.unitId) : null;
  res.json({ id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, unitId: user.unitId, department: user.department || null, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null, mustChangePassword: !!user.mustChangePassword });
});

router.post("/change-password", requireAuth, (req, res) => {
  const data = db.load();
  const user = data.users.find((u) => u.id === req.user.id);
  const { currentPassword, newPassword } = req.body || {};
  if (!user || !bcrypt.compareSync(currentPassword || "", user.passwordHash)) {
    return res.status(401).json({ error: "Mevcut şifre hatalı." });
  }
  const pwError = validatePassword(newPassword);
  if (pwError) return res.status(400).json({ error: pwError });
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.mustChangePassword = false;
  // Sifre degisince diger tum cihazlardaki eski oturumlar gecersiz kilinir; bu
  // cihaz icin yeni bir token uretip donduruyoruz ki kullanici disari atilmasin.
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  db.save();
  const newToken = sign(user);
  res.json({ message: "Şifreniz güncellendi.", token: newToken });
});

// "Tum oturumlari kapat": baska bir cihazda/tarayicida acik kalmis olabilecek
// oturumlari gecersiz kilar (orn. cihaz kaybolduysa). Bu cihaz icin yeni token doner.
router.post("/logout-all-sessions", requireAuth, (req, res) => {
  const data = db.load();
  const user = data.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  db.save();
  const newToken = sign(user);
  res.json({ message: "Tüm oturumlar kapatıldı. Bu cihazda oturumunuz devam ediyor.", token: newToken });
});

module.exports = router;
