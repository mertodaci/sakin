const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

/* ---------------- ANNOUNCEMENTS ---------------- */

router.get("/announcements", requireAuth, async (req, res) => {
  const data = await db.load();
  res.json(data.announcements.slice().sort((a, b) => b.pinned - a.pinned || new Date(b.date) - new Date(a.date)));
});

router.post("/announcements", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { title, body, pinned } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "Başlık ve içerik zorunludur." });
  const a = { id: db.uid(), title, body, date: new Date().toISOString(), authorId: req.user.id, pinned: !!pinned };
  data.announcements.unshift(a);
  db.logActivity(data, req.user, "announcement.create", `Duyuru yayınlandı: ${title}`, null);
  data.users.filter((u) => u.role === "sakin" && u.isApproved).forEach((u) => {
    data.notifications.push({ id: db.uid(), userId: u.id, message: `Yeni duyuru: ${title}`, read: false, date: a.date, link: "#/duyurular" });
  });
  await db.save(data);
  res.status(201).json(a);
});

router.delete("/announcements/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  data.announcements = data.announcements.filter((a) => a.id !== req.params.id);
  await db.save(data);
  res.json({ message: "Duyuru silindi." });
});

/* ---------------- SURVEYS ---------------- */

router.get("/surveys", requireAuth, async (req, res) => {
  const data = await db.load();
  res.json(data.surveys.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

router.post("/surveys", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { question, options } = req.body || {};
  const cleaned = (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (!question || cleaned.length < 2) return res.status(400).json({ error: "Soru ve en az 2 seçenek girilmelidir." });
  const s = { id: db.uid(), question, options: cleaned.map((t) => ({ text: t, votes: 0 })), active: true, votedBy: [], createdAt: new Date().toISOString() };
  data.surveys.unshift(s);
  await db.save(data);
  res.status(201).json(s);
});

router.post("/surveys/:id/vote", requireAuth, async (req, res) => {
  const data = await db.load();
  const survey = data.surveys.find((s) => s.id === req.params.id);
  if (!survey) return res.status(404).json({ error: "Anket bulunamadı." });
  if (survey.votedBy.includes(req.user.id)) return res.status(409).json({ error: "Bu ankete zaten oy verdiniz." });
  const idx = Number(req.body?.optionIndex);
  if (!survey.options[idx]) return res.status(400).json({ error: "Geçersiz seçenek." });
  survey.options[idx].votes++;
  survey.votedBy.push(req.user.id);
  await db.save(data);
  res.json(survey);
});

router.patch("/surveys/:id/close", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const survey = data.surveys.find((s) => s.id === req.params.id);
  if (!survey) return res.status(404).json({ error: "Anket bulunamadı." });
  survey.active = false;
  await db.save(data);
  res.json(survey);
});

/* ---------------- CLASSIFIEDS (Site Panosu) ---------------- */

router.get("/classifieds", requireAuth, async (req, res) => {
  const data = await db.load();
  const list = data.classifieds.map((c) => {
    const author = data.users.find((u) => u.id === c.userId);
    return { ...c, authorName: author ? author.name : "Bilinmiyor" };
  });
  res.json(list.sort((a, b) => new Date(b.date) - new Date(a.date)));
});

router.post("/classifieds", requireAuth, async (req, res) => {
  const data = await db.load();
  const { type, title, description } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: "Başlık ve açıklama zorunludur." });
  const c = { id: db.uid(), userId: req.user.id, type: type || "diger", title, description, date: new Date().toISOString(), resolved: false };
  data.classifieds.unshift(c);
  await db.save(data);
  res.status(201).json(c);
});

router.patch("/classifieds/:id/resolve", requireAuth, async (req, res) => {
  const data = await db.load();
  const c = data.classifieds.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "İlan bulunamadı." });
  if (c.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu ilanı düzenleme yetkiniz yok." });
  c.resolved = true;
  await db.save(data);
  res.json(c);
});

router.delete("/classifieds/:id", requireAuth, async (req, res) => {
  const data = await db.load();
  const c = data.classifieds.find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "İlan bulunamadı." });
  if (c.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu ilanı silme yetkiniz yok." });
  data.classifieds = data.classifieds.filter((x) => x.id !== req.params.id);
  await db.save(data);
  res.json({ message: "İlan silindi." });
});

/* ---------------- NOTIFICATIONS ---------------- */

router.get("/notifications", requireAuth, async (req, res) => {
  const data = await db.load();
  const list = data.notifications.filter((n) => n.userId === req.user.id).sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(list);
});

router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
  const data = await db.load();
  const n = data.notifications.find((x) => x.id === req.params.id && x.userId === req.user.id);
  if (!n) return res.status(404).json({ error: "Bildirim bulunamadı." });
  n.read = true;
  await db.save(data);
  res.json(n);
});

router.post("/notifications/read-all", requireAuth, async (req, res) => {
  const data = await db.load();
  data.notifications.filter((n) => n.userId === req.user.id).forEach((n) => (n.read = true));
  await db.save(data);
  res.json({ message: "Tüm bildirimler okundu olarak işaretlendi." });
});

// Gercek SMS/e-posta gondermek isterseniz burayi kendi API bilgilerinizle doldurun.
function sendSms(phone, message) {
  // TODO: Netgsm / Iletimerkezi vb. saglayici API cagrisi buraya eklenmelidir.
  console.log(`[SMS - GONDERILMEDI, entegrasyon eksik] -> ${phone}: ${message}`);
}
function sendEmail(email, message) {
  // TODO: SMTP / SendGrid vb. saglayici entegrasyonu buraya eklenmelidir.
  console.log(`[E-POSTA - GONDERILMEDI, entegrasyon eksik] -> ${email}: ${message}`);
}

/* ---------------- TOPLU SMS/E-POSTA (Yonetimcell karsilastirmasindan) ---------------- */
// Gercek bir SMS/e-posta saglayicisi baglanana kadar (bkz. README "Neler
// Gercek, Neler Demo") bu uc GONDERMEZ - sadece kime, ne metniyle
// gonderilecegini kisisellestirip onizler ve konsola loglar (sendSms/
// sendEmail stub'lari uzerinden). Boylece arayuz+filtre+sablon mekanizmasi
// gercek saglayici baglanir baglanmaz kullanima hazir.
router.post("/bulk-messages/preview", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { channel, template, block, minDebt } = req.body || {};
  if (!template) return res.status(400).json({ error: "Mesaj şablonu zorunludur." });

  let units = data.units.map((u) => ({ ...u, debt: db.netDebt(data, u.id) }));
  if (block) units = units.filter((u) => u.block === block);
  if (minDebt) units = units.filter((u) => u.debt >= Number(minDebt));

  const recipients = units.map((u) => {
    const resident = data.users.find((usr) => usr.unitId === u.id && usr.role === "sakin");
    const text = template
      .split("<adsoyad>").join(u.ownerName || resident?.name || "-")
      .split("<borc>").join(String(u.debt))
      .split("<daire>").join(`${u.block} - Daire ${u.no}`);
    const contact = channel === "eposta" ? resident?.email || "" : resident?.phone || u.ownerPhone || "";
    return { unitLabel: `${u.block} - Daire ${u.no}`, name: u.ownerName || resident?.name || "-", contact, text };
  }).filter((r) => r.contact);

  res.json({ count: recipients.length, recipients });
});

router.post("/bulk-messages/send", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { channel, recipients } = req.body || {};
  if (!Array.isArray(recipients) || !recipients.length) return res.status(400).json({ error: "Alıcı listesi boş." });
  recipients.forEach((r) => (channel === "eposta" ? sendEmail(r.contact, r.text) : sendSms(r.contact, r.text)));
  const data = await db.load();
  db.logActivity(data, req.user, "bulk-message.send", `${recipients.length} kişiye toplu ${channel === "eposta" ? "e-posta" : "SMS"} gönderim denemesi yapıldı (sağlayıcı entegrasyonu eksik, bkz. sunucu logu).`, null);
  await db.save(data);
  res.status(202).json({ message: `${recipients.length} alıcı için gönderim denendi. Gerçek sağlayıcı bağlanmadığı için mesajlar konsola loglandı, fiilen iletilmedi (bkz. README "Neler Gerçek, Neler Demo").` });
});

// Yonetimcell karsilastirmasi: Uye Listesi/Borc Dokumu ekranindaki "Sms
// Gonder" tekil aksiyonu - toplu SMS akisiyla ayni stub mekanizmasini
// (sendSms) kullanir, sadece TEK bir daireye, otomatik olusturulan borc
// metniyle.
router.post("/units/:id/borc-sms", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const unit = data.units.find((u) => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  const resident = data.users.find((u) => u.unitId === unit.id && u.role === "sakin");
  const contact = resident?.phone || unit.ownerPhone || "";
  if (!contact) return res.status(400).json({ error: "Bu daire için kayıtlı telefon numarası yok." });
  const debt = db.netDebt(data, unit.id);
  const text = `Sayın ${unit.ownerName || resident?.name || "-"}, ${unit.block} - Daire ${unit.no} güncel borcunuz ${debt}₺'dir. Bilgilerinize sunulur.`;
  sendSms(contact, text);
  db.logActivity(data, req.user, "unit.borc-sms", `${unit.block} - Daire ${unit.no} sakinine borç durumu SMS'i gönderim denemesi yapıldı.`, unit.id);
  await db.save(data);
  res.status(202).json({ message: `${contact} numarasına gönderim denendi. Gerçek sağlayıcı bağlanmadığı için mesaj konsola loglandı, fiilen iletilmedi.` });
});

module.exports = router;
