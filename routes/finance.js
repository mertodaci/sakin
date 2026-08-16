const express = require("express");
const { Prisma } = require("@prisma/client");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

function scopedUnitId(req) {
  return req.user.role === "sakin" ? req.user.unitId : null;
}

async function formatUnit(unitId) {
  const u = await prisma.unit.findUnique({ where: { id: unitId } });
  return u ? `${u.block} - Daire ${u.no}` : "Bir daire";
}

/* ---------------- CHARGES (Borclandirmalar: aidat, sayac, diger) ---------------- */

router.get("/charges", requireAuth, async (req, res) => {
  const unitFilter = req.query.unitId || scopedUnitId(req);
  const charges = await prisma.charge.findMany({
    where: unitFilter ? { unitId: unitFilter } : undefined,
    orderBy: { dueDate: "desc" },
  });
  res.json(charges);
});

// Aylik aidat borclandirmasini tum dairelere otomatik uygular (mukerrer donem atlanir)
router.post("/charges/generate-month", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { period, amount, dueDate } = req.body || {};
  if (!period || !amount) return res.status(400).json({ error: "Dönem (YYYY-MM) ve tutar zorunludur." });

  const units = await prisma.unit.findMany();
  const existing = await prisma.charge.findMany({ where: { type: "aidat", period }, select: { unitId: true } });
  const existingUnitIds = new Set(existing.map((c) => c.unitId));
  const toCreate = units.filter((u) => !existingUnitIds.has(u.id));
  const dueDateValue = dueDate ? new Date(dueDate) : new Date();

  await prisma.$transaction([
    prisma.charge.createMany({
      data: toCreate.map((u) => ({
        unitId: u.id,
        type: "aidat",
        period,
        amount: new Prisma.Decimal(amount),
        dueDate: dueDateValue,
        status: "unpaid",
        paidAmount: 0,
        description: `${period} ayı aidatı`,
      })),
    }),
    prisma.settings.update({ where: { id: "singleton" }, data: { monthlyDueDefault: new Prisma.Decimal(amount) } }),
    prisma.activityLog.create({
      data: { actorId: req.user.id, actorName: req.user.name, action: "charge.generate", detail: `${period} dönemi aidat borcu ${toCreate.length} daireye uygulandı (${amount}₺/daire).` },
    }),
  ]);

  res.status(201).json({ message: `${toCreate.length} daire için ${period} dönemi aidat borcu oluşturuldu.` });
});

router.post("/charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { unitId, type, period, amount, dueDate, description } = req.body || {};
  if (!unitId || !amount) return res.status(400).json({ error: "Daire ve tutar zorunludur." });
  const charge = await prisma.charge.create({
    data: {
      unitId,
      type: type || "diger",
      period: period || "",
      amount: new Prisma.Decimal(amount),
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      status: "unpaid",
      paidAmount: 0,
      lateFeeAppliedPeriods: [],
      description: description || "",
    },
  });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "charge.create", detail: `${await formatUnit(unitId)} için ${amount}₺ borçlandırma eklendi: ${description || "-"}`, scopeUnitId: unitId },
  });
  res.status(201).json(charge);
});

// Bir borc kalemini siler - sadece hic odeme yapilmamissa (paidAmount=0 VE hicbir
// PaymentAllocation'a bagli degilse - iptal edilmis kismi bir odemenin gecmis
// allocation kaydi olabilir, PaymentAllocation->Charge FK'si (onDelete: Restrict)
// bunu zaten engeller ama once dostane bir Turkce hata donduruyoruz).
router.delete("/charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const charge = await prisma.charge.findUnique({ where: { id: req.params.id } });
  if (!charge) return res.status(404).json({ error: "Borç kaydı bulunamadı." });
  const allocationCount = await prisma.paymentAllocation.count({ where: { chargeId: charge.id } });
  if (charge.paidAmount.gt(0) || allocationCount > 0) {
    return res.status(400).json({ error: "Bu borca kısmen veya tamamen ödeme yapılmış, önce ilgili ödemeyi Aidat Takibi ekranından iptal edin." });
  }
  await prisma.charge.delete({ where: { id: charge.id } });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "charge.delete", detail: `${await formatUnit(charge.unitId)} için ${charge.amount}₺ borçlandırma silindi: ${charge.description || "-"}`, scopeUnitId: charge.unitId },
  });
  res.json({ message: "Borç kaydı silindi." });
});

router.patch("/charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const charge = await prisma.charge.findUnique({ where: { id: req.params.id } });
  if (!charge) return res.status(404).json({ error: "Borç kaydı bulunamadı." });
  if (charge.paidAmount.gt(0)) return res.status(400).json({ error: "Kısmen veya tamamen ödenmiş bir borcun tutarı değiştirilemez." });
  const { amount, description, dueDate } = req.body || {};
  const data = {};
  if (amount !== undefined) data.amount = new Prisma.Decimal(amount);
  if (description !== undefined) data.description = description;
  if (dueDate !== undefined) data.dueDate = new Date(dueDate);
  const updated = await prisma.charge.update({ where: { id: charge.id }, data });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "charge.update", detail: `${await formatUnit(charge.unitId)} için borç kaydı düzenlendi.`, scopeUnitId: charge.unitId },
  });
  res.json(updated);
});

/* ---------------- PAYMENTS ---------------- */

function toAppliedTo(payment) {
  const { allocations, ...rest } = payment;
  return { ...rest, appliedTo: allocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount })) };
}

router.get("/payments", requireAuth, async (req, res) => {
  const unitFilter = req.query.unitId || scopedUnitId(req);
  const payments = await prisma.payment.findMany({
    where: unitFilter ? { unitId: unitFilter } : undefined,
    include: { allocations: true },
    orderBy: { date: "desc" },
  });
  res.json(payments.map(toAppliedTo));
});

// Odemeyi en eski acik borctan baslayarak dagitir (FIFO); hangi borca ne kadar
// uygulandigi (PaymentAllocation satirlari) ayrica kaydedilir - boylece odeme daha
// sonra hatasiz iptal edilebilir (kismi tahsilatlar da dahil). Borc guncelleme +
// PaymentAllocation + Transaction + Notification hep birlikte tek $transaction
// icinde yazilir - biri basarisiz olursa hicbiri kalici olmaz.
async function applyPayment(tx, { unitId, amount, method, userId, userName, note, accountId }) {
  const amt = new Prisma.Decimal(amount);
  let remaining = amt;
  const appliedTo = [];

  const openCharges = await tx.charge.findMany({
    where: { unitId, status: { not: "paid" } },
    orderBy: { dueDate: "asc" },
  });

  for (const c of openCharges) {
    if (remaining.lte(0)) break;
    const owed = c.amount.minus(c.paidAmount);
    const applied = Prisma.Decimal.min(owed, remaining);
    const newPaid = c.paidAmount.plus(applied);
    await tx.charge.update({ where: { id: c.id }, data: { paidAmount: newPaid, status: newPaid.gte(c.amount) ? "paid" : "partial" } });
    remaining = remaining.minus(applied);
    appliedTo.push({ chargeId: c.id, amount: applied });
  }

  const settings = await tx.settings.findUniqueOrThrow({ where: { id: "singleton" } });
  const resolvedAccountId = accountId || settings.defaultAccountId;
  const receiptNo = "MK-" + Math.floor(100000 + Math.random() * 899999);

  const transaction = await tx.transaction.create({
    data: { type: "gelir", category: "Aidat Tahsilatı", amount: amt, accountId: resolvedAccountId, description: `Tahsilat - ${receiptNo}`, createdBy: userId || "sistem" },
  });

  const payment = await tx.payment.create({
    data: {
      unitId,
      userId: userId || null,
      amount: amt,
      method: method || "Elden",
      accountId: resolvedAccountId,
      note: note || (remaining.gt(0) ? `${remaining.toString()}₺ borç kalmadığı için avans olarak işlendi` : ""),
      receiptNo,
      transactionId: transaction.id,
      allocations: { create: appliedTo.map((a) => ({ chargeId: a.chargeId, amount: a.amount })) },
    },
    include: { allocations: true },
  });

  const unit = await tx.unit.findUnique({ where: { id: unitId } });
  await tx.notification.create({
    data: { userId: "admin1", message: `${unit ? unit.block + " D:" + unit.no : "Bir daire"} ödeme yaptı: ${amount}₺`, read: false, link: "#/tahsilat" },
  });
  await tx.activityLog.create({
    data: { actorId: userId || "sistem", actorName: userName || "Sistem", action: "payment.create", detail: `${unit ? `${unit.block} - Daire ${unit.no}` : "Bir daire"} için ${amount}₺ ödeme kaydedildi (${payment.method}, makbuz ${payment.receiptNo}).`, scopeUnitId: unitId },
  });

  return payment;
}

// Cift-tiklama / ag tekrarindan kaynaklanan cift odeme sikayetlerine karsi:
// istemci her odeme denemesinde benzersiz bir requestId gonderir, ayni id
// ikinci kez islenmez (idempotency key deseni - PaymentRequest tablosunda unique
// constraint, mukerrer istek Prisma P2002 hatasiyla yakalanip 409 donduruluyor).
router.post("/payments/pay", requireAuth, async (req, res) => {
  const unitId = req.user.role === "sakin" ? req.user.unitId : req.body.unitId;
  const { amount, method, requestId, accountId } = req.body || {};
  if (!unitId || !amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir daire ve tutar giriniz." });

  try {
    const payment = await prisma.$transaction(async (tx) => {
      if (requestId) {
        try {
          await tx.paymentRequest.create({ data: { id: requestId } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            throw Object.assign(new Error("DUPLICATE_REQUEST"), { isDuplicate: true });
          }
          throw e;
        }
      }
      return applyPayment(tx, { unitId, amount, method, userId: req.user.id, userName: req.user.name, accountId });
    });
    res.status(201).json(toAppliedTo(payment));
  } catch (e) {
    if (e.isDuplicate) return res.status(409).json({ error: "Bu ödeme isteği zaten işlendi (mükerrer istek engellendi)." });
    throw e;
  }
});

// Odeme altyapisina hazir ama bu surumde pasif uc (bkz README - gercek kredi karti icin
// bir odeme kurulusu / sanal POS entegrasyonu gerekir)
router.post("/pay-online", requireAuth, async (req, res) => {
  res.status(501).json({ error: "Online kredi kartı ödemesi bu sürümde aktif değil. Bir ödeme kuruluşu (iyzico, PayTR vb.) entegrasyonu gereklidir - bkz. README." });
});

// Bir odemeyi iptal eder: ilgili borclardaki paidAmount'lari geri duser (allocation
// kaydina gore, kismi tahsilatlarda dahil dogru calisir), bagli muhasebe hareketini
// siler ve odemeyi "iptal edildi" olarak isaretler (kayit izlenebilirlik icin silinmez).
router.post("/payments/:id/cancel", requireAuth, requireRole("yonetici"), async (req, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: req.params.id }, include: { allocations: true } });
      if (!payment) throw Object.assign(new Error("NOT_FOUND"), { httpStatus: 404, msg: "Ödeme bulunamadı." });
      if (payment.cancelled) throw Object.assign(new Error("ALREADY_CANCELLED"), { httpStatus: 400, msg: "Bu ödeme zaten iptal edilmiş." });

      for (const a of payment.allocations) {
        const charge = await tx.charge.findUnique({ where: { id: a.chargeId } });
        if (!charge) continue;
        const newPaid = Prisma.Decimal.max(0, charge.paidAmount.minus(a.amount));
        const status = newPaid.lte(0) ? "unpaid" : newPaid.gte(charge.amount) ? "paid" : "partial";
        await tx.charge.update({ where: { id: charge.id }, data: { paidAmount: newPaid, status } });
      }

      if (payment.transactionId) {
        await tx.transaction.delete({ where: { id: payment.transactionId } });
      }

      await tx.payment.update({
        where: { id: payment.id },
        data: { cancelled: true, cancelledAt: new Date(), cancelledBy: req.user.id, transactionId: null },
      });

      const unit = await tx.unit.findUnique({ where: { id: payment.unitId } });
      await tx.activityLog.create({
        data: { actorId: req.user.id, actorName: req.user.name, action: "payment.cancel", detail: `${unit ? `${unit.block} - Daire ${unit.no}` : "Bir daire"} için ${payment.amount}₺ tutarındaki ödeme (makbuz ${payment.receiptNo}) iptal edildi.`, scopeUnitId: payment.unitId },
      });
    });
    res.json({ message: "Ödeme iptal edildi, ilgili borç yeniden açıldı." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.msg });
    throw e;
  }
});

/* ---------------- TRANSACTIONS (Muhasebe: gelir/gider) ---------------- */

router.get("/transactions", requireAuth, requireRole("yonetici"), async (req, res) => {
  const transactions = await prisma.transaction.findMany({ orderBy: { date: "desc" } });
  res.json(transactions);
});

router.post("/transactions", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { type, category, amount, description, date, accountId } = req.body || {};
  if (!type || !category || !amount) return res.status(400).json({ error: "Tür, kategori ve tutar zorunludur." });
  let resolvedAccountId = accountId;
  if (!resolvedAccountId) {
    const settings = await prisma.settings.findUniqueOrThrow({ where: { id: "singleton" } });
    resolvedAccountId = settings.defaultAccountId;
  }
  const t = await prisma.transaction.create({
    data: { type, category, amount: new Prisma.Decimal(amount), accountId: resolvedAccountId, date: date ? new Date(date) : new Date(), description: description || "", createdBy: req.user.id },
  });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "transaction.create", detail: `${type === "gelir" ? "Gelir" : "Gider"} kaydı: ${category} — ${amount}₺ (${description || "-"})` },
  });
  res.status(201).json(t);
});

// Yalnizca elle girilmis (bir odemeye bagli olmayan) hareketler duzenlenebilir.
// Tahsilat/firma odemesiyle olusan hareketler icin ilgili odemeyi iptal etmek gerekir -
// aksi halde odeme kaydiyla muhasebe kaydi tutarsiz kalir.
async function isLinkedToPayment(transactionId) {
  const [p, pp] = await Promise.all([
    prisma.payment.count({ where: { transactionId } }),
    prisma.partyPayment.count({ where: { transactionId } }),
  ]);
  return p > 0 || pp > 0;
}

router.patch("/transactions/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const t = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (!t) return res.status(404).json({ error: "Hareket bulunamadı." });
  if (await isLinkedToPayment(t.id)) return res.status(400).json({ error: "Bu hareket bir ödeme kaydına bağlı, doğrudan düzenlenemez. İlgili ödemeyi iptal edip yeniden oluşturun." });
  const { type, category, amount, description, date, accountId } = req.body || {};
  const data = {};
  if (type !== undefined) data.type = type;
  if (category !== undefined) data.category = category;
  if (amount !== undefined) data.amount = new Prisma.Decimal(amount);
  if (description !== undefined) data.description = description;
  if (date !== undefined) data.date = new Date(date);
  if (accountId !== undefined) data.accountId = accountId;
  const updated = await prisma.transaction.update({ where: { id: t.id }, data });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "transaction.update", detail: `Hareket düzenlendi: ${updated.category} — ${updated.amount}₺` },
  });
  res.json(updated);
});

router.delete("/transactions/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const t = await prisma.transaction.findUnique({ where: { id: req.params.id } });
  if (t && (await isLinkedToPayment(t.id))) return res.status(400).json({ error: "Bu hareket bir ödeme kaydına bağlı, doğrudan silinemez. İlgili ödemeyi iptal edin." });
  if (t) {
    await prisma.transaction.delete({ where: { id: t.id } });
    await prisma.activityLog.create({
      data: { actorId: req.user.id, actorName: req.user.name, action: "transaction.delete", detail: `Hareket silindi: ${t.category} — ${t.amount}₺ (${t.description || "-"})` },
    });
  }
  res.json({ message: "Hareket silindi." });
});

/* ---------------- BUDGET (Yillik Butce Planlama) ---------------- */
// Bu oturumun kapsami disinda: legacy db.load()/save() deseniyle kalir, ayrintili
// muhasebe hareketi (data.transactions) okumasi icin db.js'teki READONLY_PASSTHROUGH
// uzerinden hala erisilebilir.

router.get("/budgets", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const budgets = data.budgets.filter((b) => b.year === year);
  const withActuals = budgets.map((b) => {
    const actual = data.transactions.filter((t) => t.type === "gider" && t.category === b.category && new Date(t.date).getFullYear() === year).reduce((s, t) => s + t.amount, 0);
    return { ...b, actualAmount: actual };
  });
  res.json(withActuals);
});

router.post("/budgets", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { year, category, plannedAmount } = req.body || {};
  if (!category || !plannedAmount) return res.status(400).json({ error: "Kategori ve planlanan tutar zorunludur." });
  const y = Number(year) || new Date().getFullYear();
  const existing = data.budgets.find((b) => b.year === y && b.category === category);
  if (existing) {
    existing.plannedAmount = Number(plannedAmount);
  } else {
    data.budgets.push({ id: db.uid(), year: y, category, plannedAmount: Number(plannedAmount), createdBy: req.user.id });
  }
  db.logActivity(data, req.user, "budget.set", `${y} bütçesi güncellendi: ${category} — ${plannedAmount}₺ planlandı.`, null);
  await db.save(data);
  res.status(201).json({ message: "Bütçe kalemi kaydedildi." });
});

module.exports = router;
