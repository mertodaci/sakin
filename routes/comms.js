const express = require("express");
const { Prisma } = require("@prisma/client");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { loadSiteUsers } = require("../lib/siteUsers");
const { loadUnitsAndOpenCharges } = require("../lib/unitsAndCharges");

const router = express.Router();
const prisma = db.prisma;

/* ---------------- ANNOUNCEMENTS ---------------- */

router.get("/announcements", requireAuth, async (req, res) => {
  const list = await prisma.announcement.findMany({ orderBy: [{ pinned: "desc" }, { date: "desc" }] });
  res.json(list);
});

router.post("/announcements", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { title, body, pinned } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: "Başlık ve içerik zorunludur." });
  const a = await prisma.announcement.create({ data: { title, body, authorId: req.user.id, pinned: !!pinned } });
  // DIKKAT (2026-08-20'de bulunan gercek hata): eskiden prisma.user.findMany
  // ({role:"sakin"}) HICBIR SITE FILTRESI OLMADAN cagriliyordu (User bilerek
  // global bir model) - bir sitede yayinlanan duyuru, TUM PLATFORMDAKI diger
  // sitelerin sakinlerine de "Yeni duyuru: ..." bildirimi olarak dusuyordu.
  // loadSiteUsers artik SADECE bu sitenin (UserSiteAccess uzerinden) sakinlerini donuyor.
  const residents = (await loadSiteUsers(prisma, req.user.siteId)).filter((u) => u.role === "sakin" && u.isApproved);
  if (residents.length) {
    await prisma.notification.createMany({ data: residents.map((u) => ({ userId: u.id, message: `Yeni duyuru: ${title}`, link: "#/duyurular" })) });
  }
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "announcement.create", detail: `Duyuru yayınlandı: ${title}` } });
  res.status(201).json(a);
});

router.delete("/announcements/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.announcement.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Duyuru silindi." });
});

/* ---------------- SURVEYS ---------------- */

router.get("/surveys", requireAuth, async (req, res) => {
  const list = await prisma.survey.findMany({
    orderBy: { createdAt: "desc" },
    include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] }, votes: { select: { userId: true } } },
  });
  res.json(list.map((s) => ({ ...s, votedBy: s.votes.map((v) => v.userId), votes: undefined })));
});

router.post("/surveys", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { question, options } = req.body || {};
  const cleaned = (options || []).map((o) => String(o).trim()).filter(Boolean);
  if (!question || cleaned.length < 2) return res.status(400).json({ error: "Soru ve en az 2 seçenek girilmelidir." });
  // options ayri, duz .create() cagrilariyla yaziliyor - Prisma extension'lar
  // (siteId enjeksiyonu, bkz. lib/prismaClient.js) ic ice (nested) iliskisel
  // yazmalari yakalamaz.
  const s = await prisma.survey.create({ data: { question, active: true } });
  const createdOptions = [];
  for (let i = 0; i < cleaned.length; i++) {
    createdOptions.push(await prisma.surveyOption.create({ data: { surveyId: s.id, text: cleaned[i], votes: 0, position: i } }));
  }
  res.status(201).json({ ...s, options: createdOptions, votedBy: [] });
});

// Oy verme + secenegin votes sayacinin artmasi tek $transaction icinde:
// once SurveyVote.create() denenir - DB'deki @@unique([surveyId,userId])
// kisiti sayesinde ayni kullanici ikinci kez oy vermeye calisirsa Prisma
// P2002 (unique-violation) firlatir, bu da 409'a cevrilir. Bu, eski
// "votedBy dizisini oku, .includes() kontrol et, push et" desenindeki
// yaris durumunu (iki eszamanli oy birbirini silebiliyordu) tamamen kapatir.
router.post("/surveys/:id/vote", requireAuth, async (req, res) => {
  const idx = Number(req.body?.optionIndex);
  try {
    const survey = await prisma.$transaction(async (tx) => {
      const s = await tx.survey.findUnique({ where: { id: req.params.id }, include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
      if (!s) throw Object.assign(new Error("NOT_FOUND"), { httpStatus: 404, msg: "Anket bulunamadı." });
      const option = s.options[idx];
      if (!option) throw Object.assign(new Error("BAD_OPTION"), { httpStatus: 400, msg: "Geçersiz seçenek." });

      try {
        await tx.surveyVote.create({ data: { surveyId: s.id, userId: req.user.id } });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          throw Object.assign(new Error("ALREADY_VOTED"), { httpStatus: 409, msg: "Bu ankete zaten oy verdiniz." });
        }
        throw e;
      }
      await tx.surveyOption.update({ where: { id: option.id }, data: { votes: { increment: 1 } } });
      return tx.survey.findUnique({ where: { id: s.id }, include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] }, votes: { select: { userId: true } } } });
    });
    res.json({ ...survey, votedBy: survey.votes.map((v) => v.userId), votes: undefined });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.msg });
    throw e;
  }
});

router.patch("/surveys/:id/close", requireAuth, requireRole("yonetici"), async (req, res) => {
  const s = await prisma.survey.update({ where: { id: req.params.id }, data: { active: false }, include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] }, votes: { select: { userId: true } } } }).catch(() => null);
  if (!s) return res.status(404).json({ error: "Anket bulunamadı." });
  res.json({ ...s, votedBy: s.votes.map((v) => v.userId), votes: undefined });
});

/* ---------------- CLASSIFIEDS (Site Panosu) ---------------- */

router.get("/classifieds", requireAuth, async (req, res) => {
  const list = await prisma.classifieds.findMany({ orderBy: { date: "desc" }, include: { user: { select: { name: true } } } });
  res.json(list.map((c) => ({ ...c, authorName: c.user?.name || "Bilinmiyor", user: undefined })));
});

router.post("/classifieds", requireAuth, async (req, res) => {
  const { type, title, description } = req.body || {};
  if (!title || !description) return res.status(400).json({ error: "Başlık ve açıklama zorunludur." });
  const c = await prisma.classifieds.create({ data: { userId: req.user.id, type: type || "diger", title, description, resolved: false } });
  res.status(201).json(c);
});

router.patch("/classifieds/:id/resolve", requireAuth, async (req, res) => {
  const c = await prisma.classifieds.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ error: "İlan bulunamadı." });
  if (c.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu ilanı düzenleme yetkiniz yok." });
  const updated = await prisma.classifieds.update({ where: { id: c.id }, data: { resolved: true } });
  res.json(updated);
});

router.delete("/classifieds/:id", requireAuth, async (req, res) => {
  const c = await prisma.classifieds.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ error: "İlan bulunamadı." });
  if (c.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu ilanı silme yetkiniz yok." });
  await prisma.classifieds.delete({ where: { id: c.id } });
  res.json({ message: "İlan silindi." });
});

/* ---------------- NOTIFICATIONS ---------------- */

router.get("/notifications", requireAuth, async (req, res) => {
  const list = await prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { date: "desc" } });
  res.json(list);
});

router.patch("/notifications/:id/read", requireAuth, async (req, res) => {
  const n = await prisma.notification.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: { read: true } });
  if (!n.count) return res.status(404).json({ error: "Bildirim bulunamadı." });
  res.json({ message: "Okundu olarak işaretlendi." });
});

router.post("/notifications/read-all", requireAuth, async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: req.user.id, read: false }, data: { read: true } });
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
// mode: "genel" (varsayilan) | "malik-kiraci" (Yonetimcell "Maliklere
// Kiraci Borcu Bildir" - sadece kiracili dairelerde, ALICI malik olur,
// metinde hem malik hem kiraci adi gecer - bizde ayri kisi-bazli cari
// olmadigi icin borc yine Unit'e ait toplam borc, ama hedef kitle ve
// hitap dogru sekilde kiraci varligina duyarli). units/data.load() hala
// legacy shim uzerinden okunuyor - "units" koleksiyonu Asama 5'te Prisma'ya
// tasinana kadar burasi ayni sekilde calismaya devam eder.
const MONTH_NAMES_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

router.post("/bulk-messages/preview", requireAuth, requireRole("yonetici"), async (req, res) => {
  const [data, siteUsers] = await Promise.all([loadUnitsAndOpenCharges(prisma), loadSiteUsers(prisma, req.user.siteId)]);
  const { channel, template, block, minDebt, mode } = req.body || {};
  if (!template) return res.status(400).json({ error: "Mesaj şablonu zorunludur." });

  let units = data.units.map((u) => ({ ...u, debt: db.netDebt(data, u.id) }));
  if (mode === "malik-kiraci") units = units.filter((u) => u.occupancy === "tenant" && u.tenantName);
  if (block) units = units.filter((u) => u.block === block);
  if (minDebt) units = units.filter((u) => u.debt >= Number(minDebt));

  const donem = MONTH_NAMES_LONG[new Date().getMonth()] + " " + new Date().getFullYear();
  const recipients = units.map((u) => {
    const resident = siteUsers.find((usr) => usr.unitId === u.id && usr.role === "sakin");
    let text = template
      .split("<adsoyad>").join(u.ownerName || resident?.name || "-")
      .split("<borc>").join(String(u.debt))
      .split("<daire>").join(`${u.block} - Daire ${u.no}`)
      .split("<blok>").join(u.block)
      .split("<kapino>").join(u.no)
      .split("<donem>").join(donem);
    let contact, name;
    if (mode === "malik-kiraci") {
      text = text.split("<malsahibi>").join(u.ownerName || "-").split("<kiraci>").join(u.tenantName || "-");
      contact = channel === "eposta" ? "" : u.ownerPhone || "";
      name = u.ownerName || "-";
    } else {
      contact = channel === "eposta" ? resident?.email || "" : resident?.phone || u.ownerPhone || "";
      name = u.ownerName || resident?.name || "-";
    }
    return { unitLabel: `${u.block} - Daire ${u.no}`, name, contact, text };
  }).filter((r) => r.contact);

  res.json({ count: recipients.length, recipients });
});

router.post("/bulk-messages/send", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { channel, recipients } = req.body || {};
  if (!Array.isArray(recipients) || !recipients.length) return res.status(400).json({ error: "Alıcı listesi boş." });
  recipients.forEach((r) => (channel === "eposta" ? sendEmail(r.contact, r.text) : sendSms(r.contact, r.text)));
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "bulk-message.send", detail: `${recipients.length} kişiye toplu ${channel === "eposta" ? "e-posta" : "SMS"} gönderim denemesi yapıldı (sağlayıcı entegrasyonu eksik, bkz. sunucu logu).` },
  });
  res.status(202).json({ message: `${recipients.length} alıcı için gönderim denendi. Gerçek sağlayıcı bağlanmadığı için mesajlar konsola loglandı, fiilen iletilmedi (bkz. README "Neler Gerçek, Neler Demo").` });
});

// Yonetimcell karsilastirmasi: Uye Listesi/Borc Dokumu ekranindaki "Sms
// Gonder" tekil aksiyonu - toplu SMS akisiyla ayni stub mekanizmasini
// (sendSms) kullanir, sadece TEK bir daireye, otomatik olusturulan borc
// metniyle.
router.post("/units/:id/borc-sms", requireAuth, requireRole("yonetici"), async (req, res) => {
  const [data, siteUsers] = await Promise.all([loadUnitsAndOpenCharges(prisma), loadSiteUsers(prisma, req.user.siteId)]);
  const unit = data.units.find((u) => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  const resident = siteUsers.find((u) => u.unitId === unit.id && u.role === "sakin");
  const contact = resident?.phone || unit.ownerPhone || "";
  if (!contact) return res.status(400).json({ error: "Bu daire için kayıtlı telefon numarası yok." });
  const debt = db.netDebt(data, unit.id);
  const text = `Sayın ${unit.ownerName || resident?.name || "-"}, ${unit.block} - Daire ${unit.no} güncel borcunuz ${debt}₺'dir. Bilgilerinize sunulur.`;
  sendSms(contact, text);
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "unit.borc-sms", detail: `${unit.block} - Daire ${unit.no} sakinine borç durumu SMS'i gönderim denemesi yapıldı.`, scopeUnitId: unit.id },
  });
  res.status(202).json({ message: `${contact} numarasına gönderim denendi. Gerçek sağlayıcı bağlanmadığı için mesaj konsola loglandı, fiilen iletilmedi.` });
});

module.exports = router;
