const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/settings", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  res.json(data.meta);
});

router.patch("/settings", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const { buildingName, lateFeeRate, lateFeeGraceDays, autoDueEnabled, autoDueDay, autoDueAmount } = req.body || {};
  if (buildingName !== undefined) data.meta.buildingName = buildingName;
  if (lateFeeRate !== undefined) data.meta.lateFeeRate = Number(lateFeeRate);
  if (lateFeeGraceDays !== undefined) data.meta.lateFeeGraceDays = Number(lateFeeGraceDays);
  if (autoDueEnabled !== undefined) data.meta.autoDueEnabled = !!autoDueEnabled;
  if (autoDueDay !== undefined) data.meta.autoDueDay = Number(autoDueDay);
  if (autoDueAmount !== undefined) data.meta.autoDueAmount = Number(autoDueAmount);
  db.logActivity(data, req.user, "settings.update", "Site ayarları güncellendi (gecikme faizi / otomatik borçlandırma).", null);
  db.save();
  res.json({ message: "Ayarlar kaydedildi.", meta: data.meta });
});

module.exports = router;
