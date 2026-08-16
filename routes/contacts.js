const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

router.get("/contacts", requireAuth, async (req, res) => res.json(await prisma.contact.findMany()));

router.post("/contacts", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name, role, phone } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: "Ad ve telefon zorunludur." });
  const c = await prisma.contact.create({ data: { name, role: role || "", phone } });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "contact.create", detail: `Rehbere eklendi: ${name} (${role || "-"})` },
  });
  res.status(201).json(c);
});

router.delete("/contacts/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.contact.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Kişi silindi." });
});

module.exports = router;
