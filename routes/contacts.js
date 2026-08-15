const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/contacts", requireAuth, async (req, res) => res.json((await db.load()).contacts));

router.post("/contacts", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { name, role, phone } = req.body || {};
  if (!name || !phone) return res.status(400).json({ error: "Ad ve telefon zorunludur." });
  const c = { id: db.uid(), name, role: role || "", phone };
  data.contacts.push(c);
  db.logActivity(data, req.user, "contact.create", `Rehbere eklendi: ${name} (${role || "-"})`, null);
  await db.save(data);
  res.status(201).json(c);
});

router.delete("/contacts/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  data.contacts = data.contacts.filter((c) => c.id !== req.params.id);
  await db.save(data);
  res.json({ message: "Kişi silindi." });
});

module.exports = router;
