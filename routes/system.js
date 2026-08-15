const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Seffaflik sayfasi: yonetici tum kayitlari, sakin sadece kendi dairesiyle
// ilgili veya kendi yaptigi islemleri gorur.
router.get("/activity-log", requireAuth, async (req, res) => {
  const data = await db.load();
  let list = data.activityLog;
  if (req.user.role !== "yonetici") {
    list = list.filter((l) => l.scopeUnitId === req.user.unitId || l.actorId === req.user.id);
  }
  res.json(list.slice(0, 300));
});

// Kilitlenme (vendor lock-in) yaratmamak icin: tum site verisi tek tikla
// JSON olarak disa aktarilabilir.
router.get("/export", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { usedPaymentRequestIds, ...exportable } = data;
  const sanitizedUsers = exportable.users.map(({ passwordHash, ...rest }) => rest);
  const payload = { ...exportable, users: sanitizedUsers, exportedAt: new Date().toISOString() };
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="sakin-veri-yedegi-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(payload, null, 2));
});

module.exports = router;
