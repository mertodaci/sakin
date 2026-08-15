const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function unitDebt(data, unitId) {
  return data.charges
    .filter((c) => c.unitId === unitId && c.status !== "paid")
    .reduce((sum, c) => sum + (c.amount - c.paidAmount), 0);
}

function scopedUnitId(req) {
  return req.user.role === "sakin" ? req.user.unitId : null;
}

/* ---------------- CHARGES (Borclandirmalar: aidat, sayac, diger) ---------------- */

router.get("/charges", requireAuth, (req, res) => {
  const data = db.load();
  let list = data.charges;
  const unitFilter = req.query.unitId || scopedUnitId(req);
  if (unitFilter) list = list.filter((c) => c.unitId === unitFilter);
  res.json(list.slice().sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate)));
});

// Aylik aidat borclandirmasini tum dairelere otomatik uygular (mukerrer donem atlanir)
router.post("/charges/generate-month", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const { period, amount, dueDate } = req.body || {};
  if (!period || !amount) return res.status(400).json({ error: "Dönem (YYYY-MM) ve tutar zorunludur." });

  let created = 0;
  data.units.forEach((u) => {
    const exists = data.charges.some((c) => c.unitId === u.id && c.type === "aidat" && c.period === period);
    if (exists) return;
    data.charges.push({
      id: db.uid(),
      unitId: u.id,
      type: "aidat",
      period,
      amount: Number(amount),
      dueDate: dueDate || new Date().toISOString(),
      status: "unpaid",
      paidAmount: 0,
      description: `${period} ayı aidatı`,
      createdAt: new Date().toISOString(),
    });
    created++;
  });
  data.meta.monthlyDueDefault = Number(amount);
  db.logActivity(data, req.user, "charge.generate", `${period} dönemi aidat borcu ${created} daireye uygulandı (${amount}₺/daire).`, null);
  db.save();
  res.status(201).json({ message: `${created} daire için ${period} dönemi aidat borcu oluşturuldu.` });
});

router.post("/charges", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const { unitId, type, period, amount, dueDate, description } = req.body || {};
  if (!unitId || !amount) return res.status(400).json({ error: "Daire ve tutar zorunludur." });
  const charge = { id: db.uid(), unitId, type: type || "diger", period: period || "", amount: Number(amount), dueDate: dueDate || new Date().toISOString(), status: "unpaid", paidAmount: 0, lateFeeAppliedPeriods: [], description: description || "", createdAt: new Date().toISOString() };
  data.charges.push(charge);
  db.logActivity(data, req.user, "charge.create", `${formatUnit(data, unitId)} için ${amount}₺ borçlandırma eklendi: ${description || "-"}`, unitId);
  db.save();
  res.status(201).json(charge);
});

// Bir borc kalemini siler - sadece hic odeme yapilmamissa (paidAmount=0). Kismen veya
// tamamen odenmis bir borcu silmek istersen once ilgili odemeyi iptal etmen gerekir,
// aksi halde odeme kaydiyla borc kaydi tutarsiz kalir.
router.delete("/charges/:id", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const charge = data.charges.find((c) => c.id === req.params.id);
  if (!charge) return res.status(404).json({ error: "Borç kaydı bulunamadı." });
  if (charge.paidAmount > 0) return res.status(400).json({ error: "Bu borca kısmen veya tamamen ödeme yapılmış, önce ilgili ödemeyi Aidat Takibi ekranından iptal edin." });
  data.charges = data.charges.filter((c) => c.id !== req.params.id);
  db.logActivity(data, req.user, "charge.delete", `${formatUnit(data, charge.unitId)} için ${charge.amount}₺ borçlandırma silindi: ${charge.description || "-"}`, charge.unitId);
  db.save();
  res.json({ message: "Borç kaydı silindi." });
});

router.patch("/charges/:id", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const charge = data.charges.find((c) => c.id === req.params.id);
  if (!charge) return res.status(404).json({ error: "Borç kaydı bulunamadı." });
  if (charge.paidAmount > 0) return res.status(400).json({ error: "Kısmen veya tamamen ödenmiş bir borcun tutarı değiştirilemez." });
  const { amount, description, dueDate } = req.body || {};
  if (amount !== undefined) charge.amount = Number(amount);
  if (description !== undefined) charge.description = description;
  if (dueDate !== undefined) charge.dueDate = dueDate;
  db.logActivity(data, req.user, "charge.update", `${formatUnit(data, charge.unitId)} için borç kaydı düzenlendi.`, charge.unitId);
  db.save();
  res.json(charge);
});

/* ---------------- PAYMENTS ---------------- */

router.get("/payments", requireAuth, (req, res) => {
  const data = db.load();
  let list = data.payments;
  const unitFilter = req.query.unitId || scopedUnitId(req);
  if (unitFilter) list = list.filter((p) => p.unitId === unitFilter);
  res.json(list.slice().sort((a, b) => new Date(b.date) - new Date(a.date)));
});

// Odemeyi en eski acik borctan baslayarak dagitir (FIFO); hangi borca ne kadar
// uygulandigi (appliedTo) ayrica kaydedilir - boylece odeme daha sonra hatasiz
// iptal edilebilir (kismi tahsilatlar da dahil).
function applyPayment(data, unitId, amount, method, userId, note, accountId) {
  let remaining = Number(amount);
  const appliedTo = [];
  const openCharges = data.charges
    .filter((c) => c.unitId === unitId && c.status !== "paid")
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

  for (const c of openCharges) {
    if (remaining <= 0) break;
    const owed = c.amount - c.paidAmount;
    const applied = Math.min(owed, remaining);
    c.paidAmount += applied;
    remaining -= applied;
    c.status = c.paidAmount >= c.amount ? "paid" : "partial";
    appliedTo.push({ chargeId: c.id, amount: applied });
  }

  const resolvedAccountId = accountId || data.meta.defaultAccountId;
  const transactionId = db.uid();
  const payment = {
    id: db.uid(),
    unitId,
    userId: userId || null,
    amount: Number(amount),
    method: method || "Elden",
    accountId: resolvedAccountId,
    date: new Date().toISOString(),
    note: note || (remaining > 0 ? `${remaining}₺ borç kalmadığı için avans olarak işlendi` : ""),
    receiptNo: "MK-" + Math.floor(100000 + Math.random() * 899999),
    appliedTo,
    transactionId,
    cancelled: false,
  };
  data.payments.unshift(payment);
  data.transactions.unshift({ id: transactionId, type: "gelir", category: "Aidat Tahsilatı", amount: Number(amount), accountId: resolvedAccountId, date: payment.date, description: `Tahsilat - ${payment.receiptNo}`, createdBy: userId || "sistem" });

  const unit = data.units.find((u) => u.id === unitId);
  data.notifications.push({ id: db.uid(), userId: "admin1", message: `${unit ? unit.block + " D:" + unit.no : "Bir daire"} ödeme yaptı: ${amount}₺`, read: false, date: payment.date, link: "#/tahsilat" });

  return payment;
}

// Cift-tiklama / ag tekrarindan kaynaklanan cift odeme sikayetlerine karsi:
// istemci her odeme denemesinde benzersiz bir requestId gonderir, ayni id
// ikinci kez islenmez (idempotency key deseni).
router.post("/payments/pay", requireAuth, (req, res) => {
  const data = db.load();
  const unitId = req.user.role === "sakin" ? req.user.unitId : req.body.unitId;
  const { amount, method, requestId, accountId } = req.body || {};
  if (!unitId || !amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir daire ve tutar giriniz." });

  if (requestId) {
    if (data.usedPaymentRequestIds.includes(requestId)) {
      return res.status(409).json({ error: "Bu ödeme isteği zaten işlendi (mükerrer istek engellendi)." });
    }
    data.usedPaymentRequestIds.push(requestId);
    if (data.usedPaymentRequestIds.length > 5000) data.usedPaymentRequestIds.splice(0, 1000);
  }

  const payment = applyPayment(data, unitId, amount, method, req.user.id, "", accountId);
  db.logActivity(data, req.user, "payment.create", `${formatUnit(data, unitId)} için ${amount}₺ ödeme kaydedildi (${payment.method}, makbuz ${payment.receiptNo}).`, unitId);
  db.save();
  res.status(201).json(payment);
});

function formatUnit(data, unitId) {
  const u = data.units.find((x) => x.id === unitId);
  return u ? `${u.block} - Daire ${u.no}` : "Bir daire";
}

// Bir odemeyi iptal eder: ilgili borclardaki paidAmount'lari geri duser (appliedTo
// kaydina gore, kismi tahsilatlarda dahil dogru calisir), bagli muhasebe hareketini
// siler ve odemeyi "iptal edildi" olarak isaretler (kayit izlenebilirlik icin silinmez).
router.post("/payments/:id/cancel", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const payment = data.payments.find((p) => p.id === req.params.id);
  if (!payment) return res.status(404).json({ error: "Ödeme bulunamadı." });
  if (payment.cancelled) return res.status(400).json({ error: "Bu ödeme zaten iptal edilmiş." });

  (payment.appliedTo || []).forEach(({ chargeId, amount }) => {
    const charge = data.charges.find((c) => c.id === chargeId);
    if (!charge) return;
    charge.paidAmount = Math.max(0, charge.paidAmount - amount);
    charge.status = charge.paidAmount <= 0 ? "unpaid" : charge.paidAmount >= charge.amount ? "paid" : "partial";
  });

  data.transactions = data.transactions.filter((t) => t.id !== payment.transactionId);
  payment.cancelled = true;
  payment.cancelledAt = new Date().toISOString();
  payment.cancelledBy = req.user.id;

  db.logActivity(data, req.user, "payment.cancel", `${formatUnit(data, payment.unitId)} için ${payment.amount}₺ tutarındaki ödeme (makbuz ${payment.receiptNo}) iptal edildi.`, payment.unitId);
  db.save();
  res.json({ message: "Ödeme iptal edildi, ilgili borç yeniden açıldı." });
});

// Odeme altyapisina hazir ama bu surumde pasif uc (bkz README - gercek kredi karti icin
// bir odeme kurulusu / sanal POS entegrasyonu gerekir)
router.post("/pay-online", requireAuth, (req, res) => {
  res.status(501).json({ error: "Online kredi kartı ödemesi bu sürümde aktif değil. Bir ödeme kuruluşu (iyzico, PayTR vb.) entegrasyonu gereklidir - bkz. README." });
});

/* ---------------- TRANSACTIONS (Muhasebe: gelir/gider) ---------------- */

router.get("/transactions", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  res.json(data.transactions.slice().sort((a, b) => new Date(b.date) - new Date(a.date)));
});

router.post("/transactions", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const { type, category, amount, description, date, accountId } = req.body || {};
  if (!type || !category || !amount) return res.status(400).json({ error: "Tür, kategori ve tutar zorunludur." });
  const t = { id: db.uid(), type, category, amount: Number(amount), accountId: accountId || data.meta.defaultAccountId, date: date || new Date().toISOString(), description: description || "", createdBy: req.user.id };
  data.transactions.unshift(t);
  db.logActivity(data, req.user, "transaction.create", `${type === "gelir" ? "Gelir" : "Gider"} kaydı: ${category} — ${amount}₺ (${description || "-"})`, null);
  db.save();
  res.status(201).json(t);
});

// Yalnizca elle girilmis (bir odemeye bagli olmayan) hareketler duzenlenebilir.
// Tahsilat/firma odemesiyle olusan hareketler icin ilgili odemeyi iptal etmek gerekir -
// aksi halde odeme kaydiyla muhasebe kaydi tutarsiz kalir.
function isLinkedToPayment(data, transactionId) {
  return data.payments.some((p) => p.transactionId === transactionId) || data.partyPayments.some((p) => p.transactionId === transactionId);
}

router.patch("/transactions/:id", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const t = data.transactions.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: "Hareket bulunamadı." });
  if (isLinkedToPayment(data, t.id)) return res.status(400).json({ error: "Bu hareket bir ödeme kaydına bağlı, doğrudan düzenlenemez. İlgili ödemeyi iptal edip yeniden oluşturun." });
  const { type, category, amount, description, date, accountId } = req.body || {};
  if (type !== undefined) t.type = type;
  if (category !== undefined) t.category = category;
  if (amount !== undefined) t.amount = Number(amount);
  if (description !== undefined) t.description = description;
  if (date !== undefined) t.date = date;
  if (accountId !== undefined) t.accountId = accountId;
  db.logActivity(data, req.user, "transaction.update", `Hareket düzenlendi: ${t.category} — ${t.amount}₺`, null);
  db.save();
  res.json(t);
});

router.delete("/transactions/:id", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const t = data.transactions.find((x) => x.id === req.params.id);
  if (t && isLinkedToPayment(data, t.id)) return res.status(400).json({ error: "Bu hareket bir ödeme kaydına bağlı, doğrudan silinemez. İlgili ödemeyi iptal edin." });
  data.transactions = data.transactions.filter((x) => x.id !== req.params.id);
  if (t) db.logActivity(data, req.user, "transaction.delete", `Hareket silindi: ${t.category} — ${t.amount}₺ (${t.description || "-"})`, null);
  db.save();
  res.json({ message: "Hareket silindi." });
});

/* ---------------- BUDGET (Yillik Butce Planlama) ---------------- */

router.get("/budgets", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const budgets = data.budgets.filter((b) => b.year === year);
  const withActuals = budgets.map((b) => {
    const actual = data.transactions.filter((t) => t.type === "gider" && t.category === b.category && new Date(t.date).getFullYear() === year).reduce((s, t) => s + t.amount, 0);
    return { ...b, actualAmount: actual };
  });
  res.json(withActuals);
});

router.post("/budgets", requireAuth, requireRole("yonetici"), (req, res) => {
  const data = db.load();
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
  db.save();
  res.status(201).json({ message: "Bütçe kalemi kaydedildi." });
});

module.exports = router;
