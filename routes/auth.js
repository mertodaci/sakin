const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const { sign, requireAuth, SECRET } = require("../middleware/auth");
const tenantContext = require("../lib/tenantContext");
const { validatePassword } = require("../lib/validation");
const { myUnitIds } = require("../lib/residentUnits");

const router = express.Router();
const prisma = db.prisma;

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 dakika

// Kaba kuvvet (brute-force) saldirilarina karsi: ayni IP'den kisa surede cok fazla
// giris/kayit/sifre-sifirlama denemesi engellenir.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Çok fazla giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin." } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Çok fazla kayıt denemesi yapıldı. Lütfen daha sonra tekrar deneyin." } });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { error: "Çok fazla talep gönderildi. Lütfen daha sonra tekrar deneyin." } });

function findByEmail(email) {
  return prisma.user.findFirst({ where: { email: { equals: email || "", mode: "insensitive" } } });
}

// Kayit icin bos/musait daire listesi (auth gerektirmez, kayit formunda kullanilir).
// Site.inviteCode ile cozulur - kod gecersizse/siteyse pasifse 404, boylece
// ikinci bir site olustugunda daireler siteler arasi sizmaz (eskiden TUM
// sitelerin TUM daireleri donuyordu, bkz. plan notu).
router.get("/units-for-signup/:inviteCode", async (req, res) => {
  const site = await prisma.site.findUnique({ where: { inviteCode: req.params.inviteCode } });
  if (!site || !site.active) return res.status(404).json({ error: "Geçersiz veya süresi dolmuş davet linki." });
  const units = await tenantContext.run(site.id, () => prisma.unit.findMany({ orderBy: [{ block: "asc" }, { no: "asc" }] }));
  res.json({ siteName: site.name, units: units.map((u) => ({ id: u.id, label: `${u.block} - Daire ${u.no}` })) });
});

router.post("/register", registerLimiter, async (req, res) => {
  const { name, email, phone, password, unitId, inviteCode } = req.body || {};

  if (!name || !email || !password || !unitId || !inviteCode) {
    return res.status(400).json({ error: "Ad, e-posta, şifre, daire seçimi ve davet linki zorunludur." });
  }
  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });
  if (await findByEmail(email)) {
    return res.status(409).json({ error: "Bu e-posta ile zaten bir hesap var." });
  }

  const site = await prisma.site.findUnique({ where: { inviteCode } });
  if (!site || !site.active) return res.status(400).json({ error: "Geçersiz veya süresi dolmuş davet linki." });

  await tenantContext.run(site.id, async () => {
    const unit = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!unit) return res.status(400).json({ error: "Geçersiz daire seçimi." });

    const user = await prisma.user.create({
      data: { name, email, phone: phone || "", passwordHash: bcrypt.hashSync(password, 10), role: "sakin", unitId, isApproved: false },
    });
    await prisma.userSiteAccess.create({ data: { userId: user.id, siteId: site.id } });

    const admins = await prisma.userSiteAccess.findMany({ where: { siteId: site.id }, include: { user: true } });
    const adminUsers = admins.map((a) => a.user).filter((u) => u.role === "yonetici");
    if (adminUsers.length) {
      await prisma.notification.createMany({
        data: adminUsers.map((a) => ({ userId: a.id, message: `${name} kayıt onayı bekliyor.`, link: "#/kullanicilar" })),
      });
    }
    res.status(201).json({ message: "Kaydınız alındı. Yönetici onayından sonra giriş yapabilirsiniz." });
  });
});

// Bir kullanicinin erisebildigi siteleri {id,name} olarak dondurur.
async function accessibleSites(userId) {
  const rows = await prisma.userSiteAccess.findMany({ where: { userId }, include: { site: true } });
  return rows.map((r) => ({ id: r.site.id, name: r.site.name }));
}

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
        // Kullanicinin erisebildigi HER sitede kayit dusulur (forgot-password'daki
        // ayni desen) - artik "tek site" varsayimi yok, kullanici birden fazla
        // siteye erisiyor olabilir.
        const userSites = await prisma.userSiteAccess.findMany({ where: { userId: user.id } });
        for (const us of userSites) {
          await tenantContext.run(us.siteId, () =>
            prisma.activityLog.create({
              data: { actorId: "sistem", actorName: "Sistem", action: "user.lockout", detail: `${user.name} hesabı ${MAX_FAILED_ATTEMPTS} hatalı denemeden sonra kilitlendi.`, scopeUnitId: user.unitId || null },
            })
          );
        }
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

  const sites = await accessibleSites(user.id);
  if (sites.length === 0) {
    return res.status(403).json({ error: "Hesabınız hiçbir siteye bağlı değil. Yönetici ile iletişime geçin." });
  }
  if (sites.length > 1) {
    // Site secilene kadar TAM token verilmez - preAuthToken sadece
    // /auth/select-site'i cagirmaya yarar (siteId=null, requireAuth'tan gecemez).
    const preAuthToken = sign(user, null);
    return res.json({ requiresSiteSelection: true, sites, preAuthToken });
  }

  const site = sites[0];
  const token = sign(user, site.id);
  const unit = user.unitId ? await tenantContext.run(site.id, () => prisma.unit.findUnique({ where: { id: user.unitId } })) : null;
  res.json({
    token,
    mustChangePassword: !!user.mustChangePassword,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, unitId: user.unitId, department: user.department || null, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null, siteId: site.id, siteName: site.name },
  });
});

// preAuthToken (siteId=null) ile cagrilir - requireAuth'u KULLANMAZ, cunku
// requireAuth zaten dolu bir siteId sartiyor (bkz. middleware/auth.js).
// Kendi hafif dogrulamasini yapar: token gecerli mi + secilen site icin
// gercekten UserSiteAccess var mi.
async function resolveSiteSelection(req, res) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Oturum bulunamadı, lütfen giriş yapın." });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: "Oturum geçersiz veya süresi dolmuş." });
  }
  const { siteId } = req.body || {};
  if (!siteId) return res.status(400).json({ error: "Site seçimi zorunludur." });

  const [user, access] = await Promise.all([
    prisma.user.findUnique({ where: { id: payload.id } }),
    prisma.userSiteAccess.findUnique({ where: { userId_siteId: { userId: payload.id, siteId } } }),
  ]);
  if (!user) return res.status(401).json({ error: "Oturum geçersiz veya süresi dolmuş." });
  if (!access) return res.status(403).json({ error: "Bu siteye erişiminiz yok." });

  const site = await prisma.site.findUnique({ where: { id: siteId } });
  const newToken = sign(user, site.id);
  const unit = user.unitId ? await tenantContext.run(site.id, () => prisma.unit.findUnique({ where: { id: user.unitId } })) : null;
  res.json({
    token: newToken,
    mustChangePassword: !!user.mustChangePassword,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, unitId: user.unitId, department: user.department || null, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null, siteId: site.id, siteName: site.name },
  });
}

// Ilk girişte (preAuthToken ile) site seçimi
router.post("/select-site", resolveSiteSelection);
// Oturum ortasında site değiştirme (tam token ile) - ayni mantik, tek fark
// cagiran tarafin zaten tam yetkili bir token'a sahip olmasi.
router.post("/switch-site", resolveSiteSelection);

// Sifremi unuttum: e-posta/SMS altyapisi olmadigindan, istek yoneticiye iletilir.
// Yonetici "Kullanicilar" ekranindan tek tikla gecici sifre uretip sakine iletir.
router.post("/forgot-password", forgotLimiter, async (req, res) => {
  const { email } = req.body || {};
  const user = await findByEmail(email);
  // Kullanici bulunamasa bile ayni mesaji donduruyoruz (e-posta enumerasyonunu onlemek icin)
  if (user) {
    await prisma.user.update({ where: { id: user.id }, data: { resetRequestedAt: new Date() } });
    const sites = await prisma.userSiteAccess.findMany({ where: { userId: user.id } });
    for (const s of sites) {
      const admins = await prisma.userSiteAccess.findMany({ where: { siteId: s.siteId }, include: { user: true } });
      const adminUsers = admins.map((a) => a.user).filter((u) => u.role === "yonetici");
      if (adminUsers.length) {
        await prisma.notification.createMany({
          data: adminUsers.map((a) => ({ userId: a.id, message: `${user.name} şifre sıfırlama talep etti.`, link: "#/kullanicilar" })),
        });
      }
    }
  }
  res.json({ message: "Talebiniz alındı. Yönetici sizinle iletişime geçip geçici bir şifre tanımlayacaktır." });
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const unit = user.unitId ? await prisma.unit.findUnique({ where: { id: user.unitId } }) : null;
  const sites = await accessibleSites(user.id);
  const currentSite = sites.find((s) => s.id === req.user.siteId) || null;
  // Coklu daireli sakinler icin (orn. ayni sitede 2 evi olan) frontend'in
  // daire secici/birlestirici gosterebilmesi icin TUM daireleri.
  let units = [];
  if (user.role === "sakin") {
    const ids = await myUnitIds(prisma, req.user);
    const unitRows = await prisma.unit.findMany({ where: { id: { in: ids } }, orderBy: [{ block: "asc" }, { no: "asc" }] });
    units = unitRows.map((u) => ({ id: u.id, label: `${u.block} - Daire ${u.no}` }));
  }
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    unitId: user.unitId,
    department: user.department || null,
    unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null,
    units,
    isPlatformOwner: !!user.isPlatformOwner,
    mustChangePassword: !!user.mustChangePassword,
    favoriteTabs: user.favoriteTabs || [],
    siteId: req.user.siteId,
    siteName: currentSite ? currentSite.name : null,
    sites,
  });
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
  const newToken = sign(updated, req.user.siteId);
  res.json({ message: "Şifreniz güncellendi.", token: newToken });
});

// "Tum oturumlari kapat": baska bir cihazda/tarayicida acik kalmis olabilecek
// oturumlari gecersiz kilar (orn. cihaz kaybolduysa). Bu cihaz icin yeni token doner.
router.post("/logout-all-sessions", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const updated = await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
  const newToken = sign(updated, req.user.siteId);
  res.json({ message: "Tüm oturumlar kapatıldı. Bu cihazda oturumunuz devam ediyor.", token: newToken });
});

module.exports = router;
