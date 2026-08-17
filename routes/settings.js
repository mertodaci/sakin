const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

// data.meta artik db.js icinde istegin kendi tenant baglamindaki Site
// satirindan geliyor (bkz. db.js loadMeta/save - eskiden global, TEK
// satirlik Settings singleton'iydi, siteler-arasi sizinti + baska bir
// sitenin ayarlarini sessizce ezme riski vardi).
router.get("/settings", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  res.json(data.meta);
});

router.patch("/settings", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { buildingName, lateFeeRate, lateFeeGraceDays, autoDueEnabled, autoDueDay, autoDueAmount, defaultAccountId } = req.body || {};
  if (buildingName !== undefined) data.meta.buildingName = buildingName;
  if (lateFeeRate !== undefined) data.meta.lateFeeRate = Number(lateFeeRate);
  if (lateFeeGraceDays !== undefined) data.meta.lateFeeGraceDays = Number(lateFeeGraceDays);
  if (autoDueEnabled !== undefined) data.meta.autoDueEnabled = !!autoDueEnabled;
  if (autoDueDay !== undefined) data.meta.autoDueDay = Number(autoDueDay);
  if (autoDueAmount !== undefined) data.meta.autoDueAmount = Number(autoDueAmount);
  if (defaultAccountId !== undefined) {
    // Account tenant-scope'lu bir model - extension bu sorguyu otomatik
    // req.user.siteId'ye gore filtreler, yani baska bir sitenin hesap id'si
    // verilirse null doner (siteler-arasi varsayilan hesap atamasi engellenir).
    const account = await prisma.account.findUnique({ where: { id: defaultAccountId } });
    if (!account) return res.status(400).json({ error: "Geçersiz hesap." });
    data.meta.defaultAccountId = defaultAccountId;
  }
  db.logActivity(data, req.user, "settings.update", "Site ayarları güncellendi (gecikme faizi / otomatik borçlandırma / varsayılan hesap).", null);
  await db.save(data, ["meta"]);
  res.json({ message: "Ayarlar kaydedildi.", meta: data.meta });
});

module.exports = router;
