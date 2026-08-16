const express = require("express");
const { Prisma } = require("@prisma/client");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function unitLabel(data, unitId) {
  const u = data.units.find((x) => x.id === unitId);
  return u ? `${u.block} - Daire ${u.no}` : "-";
}

/* ---------------- FACILITIES & RESERVATIONS ---------------- */

router.get("/facilities", requireAuth, async (req, res) => {
  res.json((await db.load()).facilities);
});

router.get("/reservations", requireAuth, async (req, res) => {
  const data = await db.load();
  let list = data.reservations;
  if (req.user.role === "sakin") list = list.filter((r) => r.userId === req.user.id);
  const withNames = list.map((r) => ({
    ...r,
    facilityName: data.facilities.find((f) => f.id === r.facilityId)?.name || "-",
    unitLabel: unitLabel(data, r.unitId),
  }));
  res.json(withNames.sort((a, b) => new Date(a.date) - new Date(b.date)));
});

router.post("/reservations", requireAuth, async (req, res) => {
  const data = await db.load();
  const { facilityId, date, startTime, endTime } = req.body || {};
  if (!facilityId || !date || !startTime || !endTime) return res.status(400).json({ error: "Tesis, tarih ve saat aralığı zorunludur." });

  const conflict = data.reservations.some(
    (r) => r.facilityId === facilityId && r.date.slice(0, 10) === date.slice(0, 10) && r.status !== "İptal" && !(endTime <= r.startTime || startTime >= r.endTime)
  );
  if (conflict) return res.status(409).json({ error: "Bu tesis, seçtiğiniz tarih ve saatte dolu." });

  const unitId = req.user.role === "sakin" ? req.user.unitId : req.body.unitId || null;
  const r = { id: db.uid(), facilityId, unitId, userId: req.user.id, date, startTime, endTime, status: "Onaylandı", createdAt: new Date().toISOString() };
  data.reservations.push(r);
  await db.save(data);
  res.status(201).json(r);
});

router.delete("/reservations/:id", requireAuth, async (req, res) => {
  const data = await db.load();
  const r = data.reservations.find((x) => x.id === req.params.id);
  if (!r) return res.status(404).json({ error: "Rezervasyon bulunamadı." });
  if (r.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu rezervasyonu iptal etme yetkiniz yok." });
  data.reservations = data.reservations.filter((x) => x.id !== req.params.id);
  await db.save(data);
  res.json({ message: "Rezervasyon iptal edildi." });
});

/* ---------------- TICKETS (Ariza / Is Emri) ---------------- */

router.get("/ticket-categories", requireAuth, async (req, res) => res.json((await db.load()).ticketCategories));

router.get("/tickets", requireAuth, async (req, res) => {
  const data = await db.load();
  let list = data.tickets;
  if (req.user.role === "sakin") list = list.filter((t) => t.userId === req.user.id);
  if (req.user.role === "personel") list = list.filter((t) => t.assignedPersonnelId === req.user.id);
  const withNames = list.map((t) => ({
    ...t,
    unitLabel: unitLabel(data, t.unitId),
    residentName: data.users.find((u) => u.id === t.userId)?.name || "-",
    assignedName: t.assignedPersonnelId ? data.users.find((u) => u.id === t.assignedPersonnelId)?.name : null,
  }));
  res.json(withNames.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
});

router.post("/tickets", requireAuth, async (req, res) => {
  const data = await db.load();
  const { category, title, description, priority } = req.body || {};
  if (!category || !title || !description) return res.status(400).json({ error: "Kategori, başlık ve açıklama zorunludur." });
  const unitId = req.user.role === "sakin" ? req.user.unitId : req.body.unitId || null;
  const t = { id: db.uid(), unitId, userId: req.user.id, category, title, description, priority: priority || "Orta", status: "Açık", assignedPersonnelId: null, comments: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  data.tickets.unshift(t);
  data.notifications.push({ id: db.uid(), userId: "admin1", message: `Yeni talep: ${title}`, read: false, date: t.createdAt, link: "#/talepler" });
  await db.save(data);
  res.status(201).json(t);
});

router.patch("/tickets/:id", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const t = data.tickets.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Talep bulunamadı." });
  const { status, assignedPersonnelId, priority } = req.body || {};
  if (status) t.status = status;
  if (assignedPersonnelId !== undefined) t.assignedPersonnelId = assignedPersonnelId;
  if (priority) t.priority = priority;
  t.updatedAt = new Date().toISOString();
  if (status) {
    data.notifications.push({ id: db.uid(), userId: t.userId, message: `Talebiniz güncellendi: ${t.title} - ${status}`, read: false, date: t.updatedAt, link: "#/talep" });
    db.logActivity(data, req.user, "ticket.status", `Talep durumu güncellendi: ${t.title} → ${status}`, t.unitId);
  }
  await db.save(data);
  res.json(t);
});

router.post("/tickets/:id/comments", requireAuth, async (req, res) => {
  const data = await db.load();
  const t = data.tickets.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Talep bulunamadı." });
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Yorum boş olamaz." });
  t.comments.push({ id: db.uid(), userId: req.user.id, text, date: new Date().toISOString() });
  t.updatedAt = new Date().toISOString();
  await db.save(data);
  res.status(201).json(t);
});

/* ---------------- PERSONNEL ---------------- */

router.get("/personnel", requireAuth, async (req, res) => res.json((await db.load()).personnel));

router.patch("/personnel/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const p = data.personnel.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Personel bulunamadı." });
  Object.assign(p, req.body || {});
  await db.save(data);
  res.json(p);
});

/* ---------------- EQUIPMENT (Demirbas / Bakim-Onarim) ---------------- */

router.get("/equipment", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const now = Date.now();
  const list = data.equipment.map((e) => {
    const due = e.lastMaintenanceDate ? new Date(e.lastMaintenanceDate).getTime() + e.maintenancePeriodDays * 86400000 : null;
    return { ...e, responsibleName: data.users.find((u) => u.id === e.responsiblePersonnelId)?.name || "-", maintenanceOverdue: due ? due < now : false };
  });
  res.json(list);
});

router.post("/equipment", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { name, location, purchaseDate, warrantyUntil, responsiblePersonnelId, maintenancePeriodDays, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Demirbaş adı zorunludur." });
  const e = { id: db.uid(), name, location: location || "", purchaseDate: purchaseDate || "", warrantyUntil: warrantyUntil || "", responsiblePersonnelId: responsiblePersonnelId || null, maintenancePeriodDays: Number(maintenancePeriodDays) || 90, lastMaintenanceDate: new Date().toISOString(), maintenanceHistory: [], notes: notes || "" };
  data.equipment.push(e);
  await db.save(data);
  res.status(201).json(e);
});

router.delete("/equipment/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  data.equipment = data.equipment.filter((e) => e.id !== req.params.id);
  await db.save(data);
  res.json({ message: "Demirbaş kaydı silindi." });
});

router.patch("/equipment/:id/maintained", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const e = data.equipment.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: "Demirbaş bulunamadı." });
  if (!e.maintenanceHistory) e.maintenanceHistory = [];
  const now = new Date().toISOString();
  e.maintenanceHistory.push({ id: db.uid(), date: now, by: req.user.id, notes: req.body?.notes || "" });
  e.lastMaintenanceDate = now;
  if (req.body?.notes) e.notes = req.body.notes;
  await db.save(data);
  res.json(e);
});

// Yanlislikla "bakim yapildi" isaretlenmisse son bakim kaydini geri alir
router.post("/equipment/:id/undo-maintained", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const e = data.equipment.find((x) => x.id === req.params.id);
  if (!e) return res.status(404).json({ error: "Demirbaş bulunamadı." });
  if (!e.maintenanceHistory || e.maintenanceHistory.length === 0) return res.status(400).json({ error: "Geri alınacak bir bakım kaydı yok." });
  e.maintenanceHistory.pop();
  const last = e.maintenanceHistory[e.maintenanceHistory.length - 1];
  e.lastMaintenanceDate = last ? last.date : null;
  await db.save(data);
  res.json(e);
});

/* ---------------- METERS (Sayac Okuma & Faturalama) ---------------- */

router.get("/meters", requireAuth, async (req, res) => {
  const data = await db.load();
  let list = data.meters;
  if (req.user.role === "sakin") list = list.filter((m) => m.unitId === req.user.unitId);
  res.json(list.map((m) => ({ ...m, unitLabel: unitLabel(data, m.unitId) })));
});

router.post("/meters", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { unitId, type, serialNo } = req.body || {};
  if (!unitId || !type) return res.status(400).json({ error: "Daire ve sayaç tipi zorunludur." });
  const m = { id: db.uid(), unitId, type, serialNo: serialNo || "" };
  data.meters.push(m);
  await db.save(data);
  res.status(201).json(m);
});

router.get("/meter-readings", requireAuth, async (req, res) => {
  const data = await db.load();
  let list = data.meterReadings;
  if (req.user.role === "sakin") {
    const myMeterIds = data.meters.filter((m) => m.unitId === req.user.unitId).map((m) => m.id);
    list = list.filter((r) => myMeterIds.includes(r.meterId));
  }
  res.json(list.slice().sort((a, b) => new Date(b.date) - new Date(a.date)));
});

// Sayac okuma girisi otomatik olarak borclandirma (charge) olusturur. Charge artik
// finance.js gibi dogrudan Prisma'da yasiyor (LEGACY_COLLECTIONS'ta degil) - once
// gercek satiri olusturup id'sini aliyoruz, meterReading'e (hala legacy) o id'yi
// referans olarak yaziyoruz ki db.save() sirasinda FK saglansin.
router.post("/meter-readings", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { meterId, period, value, unitCost } = req.body || {};
  const meter = data.meters.find((m) => m.id === meterId);
  if (!meter) return res.status(404).json({ error: "Sayaç bulunamadı." });
  const amount = Number(value) * Number(unitCost);
  const charge = await db.prisma.charge.create({
    data: {
      unitId: meter.unitId,
      type: "sayac",
      period,
      amount: new Prisma.Decimal(amount),
      dueDate: new Date(),
      status: "unpaid",
      paidAmount: 0,
      lateFeeAppliedPeriods: [],
      description: `${period} ${meter.type} tüketimi (${value} birim x ${unitCost}₺)`,
    },
  });
  const reading = { id: db.uid(), meterId, period, value: Number(value), unitCost: Number(unitCost), amount, date: new Date().toISOString(), chargeId: charge.id };
  data.meterReadings.unshift(reading);
  await db.save(data);
  res.status(201).json(reading);
});

// Yanlis girilen bir sayac okumasini/faturasini siler - bagli borca hic odeme
// yapilmamissa hem okumayi hem olusturdugu borcu birlikte kaldirir.
router.delete("/meter-readings/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const reading = data.meterReadings.find((r) => r.id === req.params.id);
  if (!reading) return res.status(404).json({ error: "Okuma kaydı bulunamadı." });
  const charge = reading.chargeId ? await db.prisma.charge.findUnique({ where: { id: reading.chargeId } }) : null;
  if (charge && charge.paidAmount.gt(0)) return res.status(400).json({ error: "Bu faturaya ait borca ödeme yapılmış, önce ilgili ödemeyi iptal edin." });
  data.meterReadings = data.meterReadings.filter((r) => r.id !== req.params.id);
  db.logActivity(data, req.user, "meter.delete", `Sayaç okuması silindi: ${reading.period} - ${reading.amount}₺`, meter_unit(data, reading.meterId));
  await db.save(data);
  if (charge) await db.prisma.charge.delete({ where: { id: charge.id } });
  res.json({ message: "Sayaç okuması ve bağlı borç silindi." });
});
function meter_unit(data, meterId) {
  return data.meters.find((m) => m.id === meterId)?.unitId || null;
}

/* ---------------- PACKAGES (Kargo Takibi) ---------------- */

router.get("/packages", requireAuth, async (req, res) => {
  const data = await db.load();
  let list = data.packages;
  if (req.user.role === "sakin") list = list.filter((p) => p.unitId === req.user.unitId);
  res.json(list.map((p) => ({ ...p, unitLabel: unitLabel(data, p.unitId) })).sort((a, b) => new Date(b.receivedDate) - new Date(a.receivedDate)));
});

router.post("/packages", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const { unitId, courier, trackingNo, deliveredBy } = req.body || {};
  if (!unitId || !courier) return res.status(400).json({ error: "Daire ve kargo firması zorunludur." });
  const p = { id: db.uid(), unitId, courier, trackingNo: trackingNo || "", receivedDate: new Date().toISOString(), deliveredDate: null, status: "Teslim Alındı", deliveredBy: deliveredBy || req.user.name };
  data.packages.unshift(p);
  data.notifications.push({ id: db.uid(), userId: data.users.find((u) => u.unitId === unitId)?.id, message: `${courier} kargonuz yönetim ofisine teslim alındı.`, read: false, date: p.receivedDate, link: "#/kargo" });
  await db.save(data);
  res.status(201).json(p);
});

router.patch("/packages/:id/deliver", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const p = data.packages.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Kargo kaydı bulunamadı." });
  p.status = "Teslim Edildi";
  p.deliveredDate = new Date().toISOString();
  await db.save(data);
  res.json(p);
});

// Yanlislikla "teslim edildi" isaretlenmisse geri alir
router.patch("/packages/:id/undo-deliver", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const p = data.packages.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: "Kargo kaydı bulunamadı." });
  p.status = "Teslim Alındı";
  p.deliveredDate = null;
  await db.save(data);
  res.json(p);
});

router.delete("/packages/:id", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  data.packages = data.packages.filter((p) => p.id !== req.params.id);
  await db.save(data);
  res.json({ message: "Kargo kaydı silindi." });
});

/* ---------------- DECISIONS (Karar Defteri) ---------------- */

router.get("/decisions", requireAuth, async (req, res) => {
  res.json((await db.load()).decisions.slice().sort((a, b) => b.decisionNo - a.decisionNo));
});

router.post("/decisions", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { title, content, attendees, date } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: "Başlık ve karar metni zorunludur." });
  const nextNo = (Math.max(0, ...data.decisions.map((d) => d.decisionNo)) || 0) + 1;
  const d = { id: db.uid(), decisionNo: nextNo, date: date || new Date().toISOString(), title, content, attendees: Number(attendees) || 0, createdBy: req.user.id };
  data.decisions.unshift(d);
  await db.save(data);
  res.status(201).json(d);
});

/* ---------------- KEYS (Anahtar Takibi) ---------------- */

router.get("/keys", requireAuth, requireRole("yonetici", "personel"), async (req, res) => res.json((await db.load()).keys));

router.post("/keys", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { keyName, location } = req.body || {};
  if (!keyName) return res.status(400).json({ error: "Anahtar adı zorunludur." });
  const k = { id: db.uid(), keyName, location: location || "", status: "depoda", holderName: "", givenDate: null, returnedDate: null, history: [] };
  data.keys.push(k);
  await db.save(data);
  res.status(201).json(k);
});

router.patch("/keys/:id/checkout", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const k = data.keys.find((x) => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: "Anahtar bulunamadı." });
  const { holderName } = req.body || {};
  if (!holderName) return res.status(400).json({ error: "Zimmetlenecek kişi adı zorunludur." });
  k.status = "zimmetli";
  k.holderName = holderName;
  k.givenDate = new Date().toISOString();
  k.returnedDate = null;
  k.history.push({ id: db.uid(), holderName, givenDate: k.givenDate, returnedDate: null });
  await db.save(data);
  res.json(k);
});

router.patch("/keys/:id/checkin", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const k = data.keys.find((x) => x.id === req.params.id);
  if (!k) return res.status(404).json({ error: "Anahtar bulunamadı." });
  k.status = "depoda";
  const last = k.history[k.history.length - 1];
  if (last) last.returnedDate = new Date().toISOString();
  k.returnedDate = new Date().toISOString();
  await db.save(data);
  res.json(k);
});

module.exports = router;
