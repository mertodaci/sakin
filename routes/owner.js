// Platform sahibinin (Mert) site-asiri (cross-site) yonetim uclari:
// yeni site + ilk yoneticisini tek seferde olusturma, tum sitelerin listesi,
// site-asiri toplu ozet. requireOwner ile korunur - site-bazli role'den
// (yonetici/sakin/personel) tamamen ayri, global bir yetki.
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const tenantContext = require("../lib/tenantContext");
const { requireAuth, requireOwner } = require("../middleware/auth");
const { validatePassword } = require("../lib/validation");

const router = express.Router();
const prisma = db.prisma;

router.use(requireAuth, requireOwner);

// Extension'a "unscoped mode" kacis kapisi eklemek yerine: her site kendi
// tenant baglaminda AYRI AYRI sorgulanir, sonuclar burada JS'te toplanir.
// 50 site icin maliyetsiz, hicbir asamada ham/unscoped bir Prisma sorgusu yok.
async function runAcrossAllSites(fn) {
  const sites = await prisma.site.findMany({ orderBy: { createdAt: "asc" } });
  const results = [];
  for (const site of sites) {
    results.push(await tenantContext.run(site.id, () => fn(site)));
  }
  return results;
}

router.get("/sites", async (req, res) => {
  const sites = await prisma.site.findMany({ orderBy: { createdAt: "asc" } });
  res.json(
    sites.map((s) => ({ id: s.id, name: s.name, address: s.address, active: s.active, inviteCode: s.inviteCode, createdAt: s.createdAt }))
  );
});

// Yeni bir site + ilk yoneticisini TEK seferde olusturur - aksi halde yeni
// sitenin hicbir kullanicisi olmadigindan kimse davet linki dagitamaz/kayit
// onaylayamaz (bootstrap sorunu).
router.post("/sites", async (req, res) => {
  const { siteName, address, adminName, adminEmail, tempPassword } = req.body || {};
  if (!siteName || !adminName || !adminEmail || !tempPassword) {
    return res.status(400).json({ error: "Site adı, yönetici adı, yönetici e-postası ve geçici şifre zorunludur." });
  }
  const pwError = validatePassword(tempPassword);
  if (pwError) return res.status(400).json({ error: pwError });

  const existing = await prisma.user.findFirst({ where: { email: { equals: adminEmail, mode: "insensitive" } } });
  if (existing) return res.status(409).json({ error: "Bu e-posta ile zaten bir hesap var." });

  const site = await prisma.site.create({ data: { name: siteName, address: address || "" } });
  const admin = await tenantContext.run(site.id, async () => {
    const user = await prisma.user.create({
      data: {
        name: adminName,
        email: adminEmail,
        phone: "",
        passwordHash: bcrypt.hashSync(tempPassword, 10),
        role: "yonetici",
        isApproved: true,
        mustChangePassword: true,
      },
    });
    await prisma.userSiteAccess.create({ data: { userId: user.id, siteId: site.id } });
    return user;
  });

  res.status(201).json({
    site: { id: site.id, name: site.name, inviteCode: site.inviteCode },
    admin: { id: admin.id, name: admin.name, email: admin.email },
  });
});

router.patch("/sites/:id", async (req, res) => {
  const { active } = req.body || {};
  if (typeof active !== "boolean") return res.status(400).json({ error: "active alanı zorunludur." });
  const site = await prisma.site.update({ where: { id: req.params.id }, data: { active } }).catch(() => null);
  if (!site) return res.status(404).json({ error: "Site bulunamadı." });
  res.json({ id: site.id, name: site.name, active: site.active });
});

// Platformdaki TUM kullanicilari (hangi sitelere eristikleriyle birlikte)
// listeler - coklu-site erisimi verirken kullaniciyi bulmak icin.
router.get("/users", async (req, res) => {
  const [users, access] = await Promise.all([
    prisma.user.findMany({ orderBy: { name: "asc" } }),
    prisma.userSiteAccess.findMany({ include: { site: true } }),
  ]);
  const accessByUser = new Map();
  for (const a of access) {
    if (!accessByUser.has(a.userId)) accessByUser.set(a.userId, []);
    accessByUser.get(a.userId).push({ id: a.site.id, name: a.site.name });
  }
  res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, sites: accessByUser.get(u.id) || [] })));
});

// Mevcut bir kullaniciya (orn. birden fazla siteden sorumlu bir bolge
// yoneticisine) BASKA bir sitenin erisimini verir - kayit akisi/site
// bootstrap'i sadece kullanicinin ILK sitesini olusturuyor, coklu-site
// personeli icin bu ek erisimin ELLE verilmesi gerekiyor.
router.post("/users/:userId/site-access", async (req, res) => {
  const { siteId } = req.body || {};
  if (!siteId) return res.status(400).json({ error: "siteId zorunludur." });
  const [user, site] = await Promise.all([
    prisma.user.findUnique({ where: { id: req.params.userId } }),
    prisma.site.findUnique({ where: { id: siteId } }),
  ]);
  if (!user || !site) return res.status(404).json({ error: "Kullanıcı veya site bulunamadı." });
  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: user.id, siteId } },
    create: { userId: user.id, siteId },
    update: {},
  });
  res.status(201).json({ message: `${user.name} artık ${site.name} sitesine de erişebiliyor.` });
});

router.delete("/users/:userId/site-access/:siteId", async (req, res) => {
  await prisma.userSiteAccess.deleteMany({ where: { userId: req.params.userId, siteId: req.params.siteId } });
  res.json({ message: "Site erişimi kaldırıldı." });
});

// Site-asiri toplu ozet: daire/kullanici sayisi ve acik talep sayisi, her
// site icin kendi tenant baglaminda hesaplanip liste olarak dondurulur.
router.get("/overview", async (req, res) => {
  const overview = await runAcrossAllSites(async (site) => {
    // DIKKAT: User, GLOBAL_MODELS deny-list'inde (coklu-site personelin tek
    // giris kimligi olabilmesi icin) - yani prisma.user.count() extension
    // tarafindan siteId'ye gore otomatik filtrelenmez, her zaman TUM
    // kullanicilari sayar. Site-bazli kullanici sayisi icin bunun yerine
    // UserSiteAccess uzerinden, siteId'yi ELLE filtreleyerek sayilir.
    const [unitCount, userCount, openTickets] = await Promise.all([
      prisma.unit.count(),
      prisma.userSiteAccess.count({ where: { siteId: site.id } }),
      prisma.ticket.count({ where: { status: { not: "Çözüldü" } } }),
    ]);
    return { siteId: site.id, siteName: site.name, active: site.active, unitCount, userCount, openTickets };
  });
  res.json(overview);
});

module.exports = router;
