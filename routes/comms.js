const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ---------------- ANNOUNCEMENTS ---------------- */

router.get("/announcements", requireAuth, (req, res) => {
  const data = db.load();
  res.json(data.announcements.slice().sort((a, b) => b.pinned - a.pinned || new Date(b.date) - new Date(a.date)));
});

router.post("/announcements", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const { title, body, pinned } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "Başlık ve içerik zorunludur." });
  const a = { id: db.uid(), title, body, date: new Date().toISOString(), authorId: req.user.id, pinned: !!pinned };
  data.announcements.unshift(a);
  db.logActivity(data, req.user, "announcement.create", `Duyuru yayınlandı: ${title}`, null);
  data.users.filter((u) => u.role === "sakin" && u.isApproved).forEach((u) => {
    data.notifications.push({ id: db.uid(), userId: u.id, message: `Yeni duyuru: ${title}`, read: false, date: a.date, link: "#/duyurular" });
  });
  db.save();
  res.status(201).json(a);
});

router.delete("/announcements/:id", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  data.announcements = data.announcements.filter((a) => a.id !== req.params.id);
  db.save();
  res.json({ message: "Duyuru silindi." });
});

/* ---------------- SURVEYS ---------------- */

router.get("/surveys", requireAuth, (req, res) => {
  const data = db.load();
  res.json(data.surveys.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

router.post("/surveys", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const { question, options } = req.body || {};
  const cleaned = (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (!question || cleaned.length < 2) return res.status(400).json({ error: "Soru ve en az 2 seçenek girilmelidir." });
  const s = { id: db.uid(), question, options: cleaned.map((t) => ({ text: t, votes: 0 })), active: true, votedBy: [], createdAt: new Date().toISOString() };
  data.surveys.unshift(s);
  db.save();
  res.status(201).json(s);
});

router.post("/surveys/:id/vote", requireAuth, (req, res) => {
  const data = db.load();
  const survey = data.surveys.find((s) => s.id === req.params.id);
  if (!survey) return res.status(404).json({ error: "Anket bulunamadı." });
  if (survey.votedBy.includes(req.user.id)) return res.status(409).json({ error: "Bu ankete zaten oy verdiniz." });
  const idx = Number(req.body?.optionIndex);
  if (!survey.options[idx]) return res.status(400).json({ error: "Geçersiz seçenek." });
  survey.options[idx].votes++;
  survey.votedBy.push(req.user.id);
  db.save();
  res.json(survey);
});

router.patch("/surveys/:id/close", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const survey = data.surveys.find((s) => s.id === req.params.id);
  if (!survey) return res.status(404).json({ error: "Anket bulunamadı." });
  survey.active = false;
  db.save();
  res.json(survey);
});

/* ---------------- CLASSIFIEDS (Site Panosu) ---------------- */

router.get("/classifieds", requireAuth, (req, res) => {
  const data = db.load();
  const list = data.classifieds.map((c) => {
    const author = data.users.find((u) => u.id === c.userId);
    return { ...c, authorName: author ? author.name : "Bilinmiyor" };
  });
  res.json(list.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

router.post("/classifieds", requireAuth, (req, res) => {
  const data = db.load();
  const { type, title, description } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: "Başlık ve açıklama zorunludur." });
  const c = { id: db.uid(), userId: req.user.id, type: type || "diger", title, description, date: new Date().toISOString(), resolved: false };
  data.classifieds.unshift(c);
  db.save();
  res.status(201).json(c);
});

router.patch("/classifieds/:id/resolve", requireAuth, (req, res) => {
  const data = db.load();
  const c = data.classifieds.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "İlan bulunamadı." });
  if (c.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu ilanı düzenleme yetkiniz yok." });
  c.resolved = true;
  db.save();
  res.json(c);
});

router.delete("/classifieds/:id", requireAuth, (req, res) => {
  const data = db.load();
  const c = data.classifieds.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "İlan bulunamadı." });
  if (c.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu ilanı silme yetkiniz yok." });
  data.classifieds = data.classifieds.filter((x) => x.id !== req.params.id);
  db.save();
  res.json({ message: "İlan silindi." });
});

/* ---------------- NOTIFICATIONS ---------------- */

router.get("/notifications", requireAuth, (req, res) => {
  const data = db.load();
  const list = data.notifications.filter((n) => n.userId === req.user.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(list);
});

router.patch("/notifications/:id/read", requireAuth, (req, res) => {
  const data = db.load();
  const n = data.notifications.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!n) return res.status(404).json({ error: "Bildirim bulunamadı." });
  n.read = true;
  db.save();
  res.json(n);
});

router.post("/notifications/read-all", requireAuth, (req, res) => {
  const data = db.load();
  data.notifications.filter((n) => n.userId === req.user.id).forEach((n) => (n.read = true));
  db.save();
  res.json({ message: "Tüm bildirimler okundu olarak işaretlendi." });
});

// Gercek SMS/e-posta gondermek isterseniz burayi kendi API bilgilerinizle doldurun.
function sendSms(phone, message) {
  // TODO: Netgsm / Iletimerkezi vb. saglayici API cagrisi buraya eklenmelidir.
  console.log(`[SMS - GONDERILMEDI, entegrasyon eksik] -> ${phone}: ${message}`);
}

module.exports = router;
