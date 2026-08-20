const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { myUnitIds } = require("../lib/residentUnits");
const { loadSiteUsers } = require("../lib/siteUsers");

const router = express.Router();

// Seffaflik sayfasi: yonetici tum kayitlari, sakin sadece kendi daire(leri)yle
// ilgili veya kendi yaptigi islemleri gorur. Eskiden db.load() (27
// koleksiyonun TAMAMI) ile sadece data.activityLog okumak icin cagriliyordu.
router.get("/activity-log", requireAuth, async (req, res) => {
  let list = await db.prisma.activityLog.findMany({ orderBy: { date: "desc" } });
  if (req.user.role !== "yonetici") {
    const unitIds = req.user.role === "sakin" ? await myUnitIds(db.prisma, req.user) : [req.user.unitId];
    list = list.filter((l) => unitIds.includes(l.scopeUnitId) || l.actorId === req.user.id);
  }
  res.json(list.slice(0, 300));
});

// Kilitlenme (vendor lock-in) yaratmamak icin: tum site verisi tek tikla
// JSON olarak disa aktarilabilir.
router.get("/export", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { usedPaymentRequestIds, ...exportable } = data;
  // DIKKAT (2026-08-20'de bulunan gercek hata - ayni sinif diger
  // duzeltmelerle tutarli): data.users (db.js'in loadUsers()'i) User
  // bilerek global oldugu icin site filtresi UYGULAMAZ - "site yedegi"
  // export'u eskiden TUM PLATFORMDAKI diger sitelerin kullanicilarini da
  // (sifre hash'i haric, ama isim/e-posta/telefon/TC kimlik no dahil)
  // iceriyordu. loadSiteUsers artik SADECE bu sitenin kullanicilarini donuyor.
  const siteUsers = await loadSiteUsers(db.prisma, req.user.siteId);
  const sanitizedUsers = siteUsers.map(({ passwordHash, ...rest }) => rest);
  const payload = { ...exportable, users: sanitizedUsers, exportedAt: new Date().toISOString() };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="sakin-veri-yedegi-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

module.exports = router;
