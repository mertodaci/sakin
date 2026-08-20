const express = require("express");
const { Prisma } = require("@prisma/client");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { myUnitIds, findUnitResidents } = require("../lib/residentUnits");

const router = express.Router();
const prisma = db.prisma;

async function unitLabel(unitId) {
  const u = await prisma.unit.findUnique({ where: { id: unitId } });
  return u ? `${u.block} - Daire ${u.no}` : "-";
}

/* ---------------- FACILITIES & RESERVATIONS ---------------- */

router.get("/facilities", requireAuth, async (req, res) => {
  res.json(await prisma.facility.findMany({ orderBy: { name: "asc" } }));
});

router.get("/reservations", requireAuth, async (req, res) => {
  const where = req.user.role === "sakin" ? { userId: req.user.id } : {};
  const list = await prisma.reservation.findMany({
    where,
    orderBy: { date: "asc" },
    include: { facility: { select: { name: true } }, unit: { select: { block: true, no: true } } },
  });
  res.json(list.map((r) => ({
    ...r,
    facilityName: r.facility?.name || "-",
    unitLabel: r.unit ? `${r.unit.block} - Daire ${r.unit.no}` : "-",
    facility: undefined,
    unit: undefined,
  })));
});

router.post("/reservations", requireAuth, async (req, res) => {
  const { facilityId, date, startTime, endTime } = req.body || {};
  let unitId = req.body.unitId;
  if (req.user.role === "sakin") {
    if (!unitId) unitId = req.user.unitId;
    const mine = await myUnitIds(prisma, req.user);
    if (!mine.includes(unitId)) return res.status(403).json({ error: "Bu daireye erişim yetkiniz yok." });
  }
  if (!facilityId || !date || !startTime || !endTime) return res.status(400).json({ error: "Tesis, tarih ve saat aralığı zorunludur." });
  if (!unitId) return res.status(400).json({ error: "Daire seçimi zorunludur." });

  const dayStart = new Date(new Date(date).toISOString().slice(0, 10) + "T00:00:00.000Z");
  const dayEnd = new Date(new Date(date).toISOString().slice(0, 10) + "T23:59:59.999Z");
  const sameDay = await prisma.reservation.findMany({ where: { facilityId, date: { gte: dayStart, lte: dayEnd }, status: { not: "İptal" } } });
  const conflict = sameDay.some((r) => !(endTime <= r.startTime || startTime >= r.endTime));
  if (conflict) return res.status(409).json({ error: "Bu tesis, seçtiğiniz tarih ve saatte dolu." });

  const r = await prisma.reservation.create({ data: { facilityId, unitId, userId: req.user.id, date: new Date(date), startTime, endTime, status: "Onaylandı" } });
  res.status(201).json(r);
});

router.delete("/reservations/:id", requireAuth, async (req, res) => {
  const r = await prisma.reservation.findUnique({ where: { id: req.params.id } });
  if (!r) return res.status(404).json({ error: "Rezervasyon bulunamadı." });
  if (r.userId !== req.user.id && req.user.role !== "yonetici") return res.status(403).json({ error: "Bu rezervasyonu iptal etme yetkiniz yok." });
  await prisma.reservation.delete({ where: { id: req.params.id } });
  res.json({ message: "Rezervasyon iptal edildi." });
});

/* ---------------- TICKETS (Ariza / Is Emri) ---------------- */

// Eskiden db.load() (27 koleksiyonun TAMAMI) ile sadece Site.ticketCategories
// alanini okumak icin cagriliyordu - bu ucun kendisi sik cagirilir (talep
// formu her acilista) oldugu icin gereksiz maliyeti buyuktu.
router.get("/ticket-categories", requireAuth, async (req, res) => {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: req.user.siteId }, select: { ticketCategories: true } });
  res.json(site.ticketCategories);
});

router.get("/tickets", requireAuth, async (req, res) => {
  const where = {};
  if (req.user.role === "sakin") where.userId = req.user.id;
  if (req.user.role === "personel") where.assignedPersonnelId = req.user.id;
  const list = await prisma.ticket.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { unit: { select: { block: true, no: true } }, user: { select: { name: true } }, assignedPersonnel: { select: { name: true } }, comments: { orderBy: { date: "asc" } } },
  });
  res.json(list.map((t) => ({
    ...t,
    unitLabel: t.unit ? `${t.unit.block} - Daire ${t.unit.no}` : "-",
    residentName: t.user?.name || "-",
    assignedName: t.assignedPersonnel?.name || null,
    unit: undefined,
    user: undefined,
    assignedPersonnel: undefined,
  })));
});

router.post("/tickets", requireAuth, async (req, res) => {
  const { category, title, description, priority } = req.body || {};
  let unitId = req.body.unitId;
  if (req.user.role === "sakin") {
    if (!unitId) unitId = req.user.unitId;
    const mine = await myUnitIds(prisma, req.user);
    if (!mine.includes(unitId)) return res.status(403).json({ error: "Bu daireye erişim yetkiniz yok." });
  }
  if (!category || !title || !description) return res.status(400).json({ error: "Kategori, başlık ve açıklama zorunludur." });
  if (!unitId) return res.status(400).json({ error: "Daire seçimi zorunludur." });
  const t = await prisma.ticket.create({
    data: { unitId, userId: req.user.id, category, title, description, priority: priority || "Orta", status: "Açık", assignedPersonnelId: null },
  });
  // DIKKAT: User global bir model (coklu-site personel icin) - prisma.user.findMany({where:{role:"yonetici"}})
  // TUM platformdaki yoneticileri dondurur, bu SITEYE ozel degil. UserSiteAccess
  // uzerinden SADECE bu sitenin yoneticilerini buluyoruz.
  const siteAccess = await prisma.userSiteAccess.findMany({ where: { siteId: req.user.siteId }, include: { user: true } });
  const admins = siteAccess.map((a) => a.user).filter((u) => u.role === "yonetici");
  if (admins.length) {
    await prisma.notification.createMany({ data: admins.map((a) => ({ userId: a.id, message: `Yeni talep: ${title}`, link: "#/talepler" })) });
  }
  res.status(201).json(t);
});

router.patch("/tickets/:id", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: "Talep bulunamadı." });
  const { status, assignedPersonnelId, priority } = req.body || {};
  const fields = { updatedAt: new Date() };
  if (status) fields.status = status;
  if (assignedPersonnelId !== undefined) fields.assignedPersonnelId = assignedPersonnelId || null;
  if (priority) fields.priority = priority;
  const updated = await prisma.ticket.update({ where: { id: t.id }, data: fields });
  if (status) {
    await prisma.notification.create({ data: { userId: t.userId, message: `Talebiniz güncellendi: ${t.title} - ${status}`, link: "#/talep" } });
    await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "ticket.status", detail: `Talep durumu güncellendi: ${t.title} → ${status}`, scopeUnitId: t.unitId } });
  }
  res.json(updated);
});

router.post("/tickets/:id/comments", requireAuth, async (req, res) => {
  const t = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: "Talep bulunamadı." });
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Yorum boş olamaz." });
  await prisma.ticketComment.create({ data: { ticketId: t.id, userId: req.user.id, text } });
  const updated = await prisma.ticket.update({ where: { id: t.id }, data: { updatedAt: new Date() }, include: { comments: true } });
  res.status(201).json(updated);
});

/* ---------------- PERSONNEL ---------------- */

router.get("/personnel", requireAuth, async (req, res) => res.json(await prisma.personnel.findMany({ orderBy: { name: "asc" } })));

router.patch("/personnel/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name, phone, department, active, monthlySalary } = req.body || {};
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (phone !== undefined) fields.phone = phone;
  if (department !== undefined) fields.department = department;
  if (active !== undefined) fields.active = !!active;
  if (monthlySalary !== undefined) fields.monthlySalary = monthlySalary === null || monthlySalary === "" ? null : new Prisma.Decimal(monthlySalary);
  const p = await prisma.personnel.update({ where: { id: req.params.id }, data: fields }).catch(() => null);
  if (!p) return res.status(404).json({ error: "Personel bulunamadı." });
  res.json(p);
});

/* ---------------- EQUIPMENT (Demirbas / Bakim-Onarim) ---------------- */

router.get("/equipment", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const now = Date.now();
  const list = await prisma.equipment.findMany({ include: { responsiblePersonnel: { select: { name: true } }, maintenanceHistory: true } });
  res.json(list.map((e) => {
    const due = e.lastMaintenanceDate ? new Date(e.lastMaintenanceDate).getTime() + e.maintenancePeriodDays * 86400000 : null;
    return { ...e, responsibleName: e.responsiblePersonnel?.name || "-", maintenanceOverdue: due ? due < now : false, responsiblePersonnel: undefined };
  }));
});

router.post("/equipment", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name, location, purchaseDate, warrantyUntil, responsiblePersonnelId, maintenancePeriodDays, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Demirbaş adı zorunludur." });
  const e = await prisma.equipment.create({
    data: {
      name,
      location: location || "",
      purchaseDate: purchaseDate ? new Date(purchaseDate) : new Date(),
      warrantyUntil: warrantyUntil ? new Date(warrantyUntil) : null,
      responsiblePersonnelId: responsiblePersonnelId || null,
      maintenancePeriodDays: Number(maintenancePeriodDays) || 90,
      lastMaintenanceDate: new Date(),
      notes: notes || "",
    },
  });
  res.status(201).json(e);
});

router.delete("/equipment/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.equipment.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Demirbaş kaydı silindi." });
});

router.patch("/equipment/:id/maintained", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const e = await prisma.equipment.findUnique({ where: { id: req.params.id } });
  if (!e) return res.status(404).json({ error: "Demirbaş bulunamadı." });
  const now = new Date();
  await prisma.maintenanceRecord.create({ data: { equipmentId: e.id, date: now, by: req.user.id, notes: req.body?.notes || "" } });
  const updated = await prisma.equipment.update({
    where: { id: e.id },
    data: { lastMaintenanceDate: now, ...(req.body?.notes ? { notes: req.body.notes } : {}) },
    include: { maintenanceHistory: true },
  });
  res.json(updated);
});

// Yanlislikla "bakim yapildi" isaretlenmisse son bakim kaydini geri alir
router.post("/equipment/:id/undo-maintained", requireAuth, requireRole("yonetici"), async (req, res) => {
  const e = await prisma.equipment.findUnique({ where: { id: req.params.id }, include: { maintenanceHistory: true } });
  if (!e) return res.status(404).json({ error: "Demirbaş bulunamadı." });
  if (!e.maintenanceHistory.length) return res.status(400).json({ error: "Geri alınacak bir bakım kaydı yok." });
  const sorted = e.maintenanceHistory.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const last = sorted[0];
  const newLast = sorted[1] || null;
  await prisma.maintenanceRecord.delete({ where: { id: last.id } });
  const updated = await prisma.equipment.update({
    where: { id: e.id },
    data: { lastMaintenanceDate: newLast ? newLast.date : null },
    include: { maintenanceHistory: true },
  });
  res.json(updated);
});

/* ---------------- METERS (Sayac Okuma & Faturalama) ---------------- */

router.get("/meters", requireAuth, async (req, res) => {
  const where = req.user.role === "sakin" ? { unitId: { in: await myUnitIds(prisma, req.user) } } : {};
  const list = await prisma.meter.findMany({ where, include: { unit: { select: { block: true, no: true } } } });
  res.json(list.map((m) => ({ ...m, unitLabel: m.unit ? `${m.unit.block} - Daire ${m.unit.no}` : "-", unit: undefined })));
});

router.post("/meters", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { unitId, type, serialNo } = req.body || {};
  if (!unitId || !type) return res.status(400).json({ error: "Daire ve sayaç tipi zorunludur." });
  const m = await prisma.meter.create({ data: { unitId, type, serialNo: serialNo || "" } });
  res.status(201).json(m);
});

router.get("/meter-readings", requireAuth, async (req, res) => {
  const where = {};
  if (req.user.role === "sakin") {
    const myMeters = await prisma.meter.findMany({ where: { unitId: { in: await myUnitIds(prisma, req.user) } }, select: { id: true } });
    where.meterId = { in: myMeters.map((m) => m.id) };
  }
  const list = await prisma.meterReading.findMany({ where, orderBy: { date: "desc" } });
  res.json(list);
});

// Sayac okuma girisi otomatik olarak borclandirma (charge) olusturur - okuma +
// bagli borc olusturma tek $transaction icinde (biri basarisiz olursa hicbiri kalici olmaz).
router.post("/meter-readings", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { meterId, period, value, unitCost } = req.body || {};
  const meter = await prisma.meter.findUnique({ where: { id: meterId } });
  if (!meter) return res.status(404).json({ error: "Sayaç bulunamadı." });
  const amount = new Prisma.Decimal(Number(value) * Number(unitCost));
  const reading = await prisma.$transaction(async (tx) => {
    const charge = await tx.charge.create({
      data: {
        unitId: meter.unitId,
        type: "sayac",
        period,
        amount,
        dueDate: new Date(),
        status: "unpaid",
        paidAmount: 0,
        lateFeeAppliedPeriods: [],
        description: `${period} ${meter.type} tüketimi (${value} birim x ${unitCost}₺)`,
      },
    });
    return tx.meterReading.create({ data: { meterId, period, value: Number(value), unitCost: Number(unitCost), amount, chargeId: charge.id } });
  });
  res.status(201).json(reading);
});

// Yanlis girilen bir sayac okumasini/faturasini siler - bagli borca hic odeme
// yapilmamissa hem okumayi hem olusturdugu borcu birlikte kaldirir (tek $transaction).
router.delete("/meter-readings/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      const reading = await tx.meterReading.findUnique({ where: { id: req.params.id } });
      if (!reading) throw Object.assign(new Error("NOT_FOUND"), { httpStatus: 404, msg: "Okuma kaydı bulunamadı." });
      const charge = reading.chargeId ? await tx.charge.findUnique({ where: { id: reading.chargeId } }) : null;
      if (charge && charge.paidAmount.gt(0)) throw Object.assign(new Error("HAS_PAYMENT"), { httpStatus: 400, msg: "Bu faturaya ait borca ödeme yapılmış, önce ilgili ödemeyi iptal edin." });
      const meter = await tx.meter.findUnique({ where: { id: reading.meterId } });
      await tx.meterReading.delete({ where: { id: reading.id } });
      if (charge) await tx.charge.delete({ where: { id: charge.id } });
      await tx.activityLog.create({
        data: { actorId: req.user.id, actorName: req.user.name, action: "meter.delete", detail: `Sayaç okuması silindi: ${reading.period} - ${reading.amount}₺`, scopeUnitId: meter?.unitId || null },
      });
    });
    res.json({ message: "Sayaç okuması ve bağlı borç silindi." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.msg });
    throw e;
  }
});

/* ---------------- PACKAGES (Kargo Takibi) ---------------- */

router.get("/packages", requireAuth, async (req, res) => {
  const where = req.user.role === "sakin" ? { unitId: { in: await myUnitIds(prisma, req.user) } } : {};
  const list = await prisma.package.findMany({ where, orderBy: { receivedDate: "desc" }, include: { unit: { select: { block: true, no: true } } } });
  res.json(list.map((p) => ({ ...p, unitLabel: p.unit ? `${p.unit.block} - Daire ${p.unit.no}` : "-", unit: undefined })));
});

router.post("/packages", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const { unitId, courier, trackingNo, deliveredBy } = req.body || {};
  if (!unitId || !courier) return res.status(400).json({ error: "Daire ve kargo firması zorunludur." });
  const p = await prisma.package.create({ data: { unitId, courier, trackingNo: trackingNo || "", status: "Teslim Alındı", deliveredBy: deliveredBy || req.user.name } });
  // findFirst({where:{unitId}}) sadece BIRINCIL sahibi bulurdu - coklu daireli
  // bir sakinin EK dairesine (UserUnit) kargo gelirse hic bildirim gitmezdi.
  const residents = await findUnitResidents(prisma, unitId);
  if (residents.length) {
    await prisma.notification.createMany({ data: residents.map((r) => ({ userId: r.id, message: `${courier} kargonuz yönetim ofisine teslim alındı.`, link: "#/kargo" })) });
  }
  res.status(201).json(p);
});

router.patch("/packages/:id/deliver", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const p = await prisma.package.update({ where: { id: req.params.id }, data: { status: "Teslim Edildi", deliveredDate: new Date() } }).catch(() => null);
  if (!p) return res.status(404).json({ error: "Kargo kaydı bulunamadı." });
  res.json(p);
});

// Yanlislikla "teslim edildi" isaretlenmisse geri alir
router.patch("/packages/:id/undo-deliver", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const p = await prisma.package.update({ where: { id: req.params.id }, data: { status: "Teslim Alındı", deliveredDate: null } }).catch(() => null);
  if (!p) return res.status(404).json({ error: "Kargo kaydı bulunamadı." });
  res.json(p);
});

router.delete("/packages/:id", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  await prisma.package.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Kargo kaydı silindi." });
});

/* ---------------- DECISIONS (Karar Defteri) ---------------- */

router.get("/decisions", requireAuth, async (req, res) => {
  res.json(await prisma.decision.findMany({ orderBy: { decisionNo: "desc" } }));
});

// decisionNo'nun DB'de @unique olmasi sayesinde (bkz. schema.prisma) eszamanli
// iki olusturma denemesi ayni numarayi almaya calisirsa biri P2002 ile
// carpisir - bu durumda bir kez "en buyuk numara + 1"i yeniden hesaplayip
// tekrar dener (cok dusuk ihtimalli bir yaris durumu, sonsuz donguye
// girmemesi icin sadece 1 kez).
router.post("/decisions", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { title, content, attendees, date } = req.body || {};
  if (!title || !content) return res.status(400).json({ error: "Başlık ve karar metni zorunludur." });

  async function tryCreate() {
    const max = await prisma.decision.aggregate({ _max: { decisionNo: true } });
    const nextNo = (max._max.decisionNo || 0) + 1;
    return prisma.decision.create({
      data: { decisionNo: nextNo, date: date ? new Date(date) : new Date(), title, content, attendees: Number(attendees) || 0, createdBy: req.user.id },
    });
  }

  let d;
  try {
    d = await tryCreate();
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      d = await tryCreate();
    } else {
      throw e;
    }
  }
  res.status(201).json(d);
});

/* ---------------- KEYS (Anahtar Takibi) ---------------- */

router.get("/keys", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  res.json(await prisma.key.findMany({ include: { history: true }, orderBy: { keyName: "asc" } }));
});

router.post("/keys", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { keyName, location } = req.body || {};
  if (!keyName) return res.status(400).json({ error: "Anahtar adı zorunludur." });
  const k = await prisma.key.create({ data: { keyName, location: location || "", status: "depoda", holderName: "" } });
  res.status(201).json(k);
});

router.patch("/keys/:id/checkout", requireAuth, requireRole("yonetici"), async (req, res) => {
  const k = await prisma.key.findUnique({ where: { id: req.params.id } });
  if (!k) return res.status(404).json({ error: "Anahtar bulunamadı." });
  const { holderName } = req.body || {};
  if (!holderName) return res.status(400).json({ error: "Zimmetlenecek kişi adı zorunludur." });
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.keyAssignment.create({ data: { keyId: k.id, holderName, givenDate: now, returnedDate: null } });
    return tx.key.update({ where: { id: k.id }, data: { status: "zimmetli", holderName, givenDate: now, returnedDate: null }, include: { history: true } });
  });
  res.json(updated);
});

router.patch("/keys/:id/checkin", requireAuth, requireRole("yonetici"), async (req, res) => {
  const k = await prisma.key.findUnique({ where: { id: req.params.id }, include: { history: true } });
  if (!k) return res.status(404).json({ error: "Anahtar bulunamadı." });
  const now = new Date();
  const openAssignment = k.history.filter((h) => !h.returnedDate).sort((a, b) => new Date(b.givenDate) - new Date(a.givenDate))[0];
  const updated = await prisma.$transaction(async (tx) => {
    if (openAssignment) await tx.keyAssignment.update({ where: { id: openAssignment.id }, data: { returnedDate: now } });
    return tx.key.update({ where: { id: k.id }, data: { status: "depoda", returnedDate: now }, include: { history: true } });
  });
  res.json(updated);
});

module.exports = router;
