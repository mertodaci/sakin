const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function partyDebt(data, partyType, partyId) {
  return data.partyCharges
    .filter((c) => c.partyType === partyType && c.partyId === partyId && c.status !== "paid")
    .reduce((s, c) => s + (c.amount - c.paidAmount), 0);
}

function partyName(data, partyType, partyId) {
  if (partyType === "firma") return data.vendors.find((v) => v.id === partyId)?.name || "-";
  return data.personnel.find((p) => p.id === partyId)?.name || "-";
}

/* ---------------- VENDORS (Firmalar) ---------------- */

router.get("/vendors", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  res.json(data.vendors.map((v) => ({ ...v, debt: partyDebt(data, "firma", v.id) })));
});

router.post("/vendors", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { name, category, phone, taxNumber, iban, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Firma adı zorunludur." });
  const v = { id: db.uid(), name, category: category || "", phone: phone || "", taxNumber: taxNumber || "", iban: iban || "", notes: notes || "", createdAt: new Date().toISOString() };
  data.vendors.push(v);
  db.logActivity(data, req.user, "vendor.create", `Yeni firma eklendi: ${name}`, null);
  await db.save(data);
  res.status(201).json(v);
});

router.delete("/vendors/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const inUse = data.partyCharges.some((c) => c.partyType === "firma" && c.partyId === req.params.id);
  if (inUse) return res.status(400).json({ error: "Bu firmaya bağlı cari hesap kayıtları var, silinemez." });
  data.vendors = data.vendors.filter((v) => v.id !== req.params.id);
  await db.save(data);
  res.json({ message: "Firma silindi." });
});

/* ---------------- PARTY CHARGES (Firma/Personel Borclanma) ---------------- */

router.get("/party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  let list = data.partyCharges;
  if (req.query.partyType) list = list.filter((c) => c.partyType === req.query.partyType);
  if (req.query.partyId) list = list.filter((c) => c.partyId === req.query.partyId);
  res.json(list.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).map((c) => ({ ...c, partyName: partyName(data, c.partyType, c.partyId) })));
});

router.post("/party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { partyType, partyId, amount, description, dueDate } = req.body || {};
  if (!partyType || !partyId || !amount) return res.status(400).json({ error: "Taraf ve tutar zorunludur." });
  const charge = { id: db.uid(), partyType, partyId, amount: Number(amount), paidAmount: 0, status: "unpaid", description: description || "", date: new Date().toISOString(), dueDate: dueDate || new Date().toISOString(), createdBy: req.user.id };
  data.partyCharges.push(charge);
  db.logActivity(data, req.user, "party.charge", `${partyName(data, partyType, partyId)} için ${amount}₺ borçlandırma kaydedildi: ${description || "-"}`, null);
  await db.save(data);
  res.status(201).json(charge);
});

/* ---------------- PARTY PAYMENTS (Firma/Personele Odeme) ---------------- */

router.get("/party-payments", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  let list = data.partyPayments;
  if (req.query.partyType) list = list.filter((p) => p.partyType === req.query.partyType);
  if (req.query.partyId) list = list.filter((p) => p.partyId === req.query.partyId);
  res.json(list.slice().sort((a, b) => new Date(b.date) - new Date(a.date)));
});

// Odemeyi en eski acik borctan baslayarak dagitir (FIFO) - tahsilat mantigiyla ayni,
// ama para bu sefer bizden cikiyor (gider) ve secilen kasadan dusuluyor. Hangi borca
// ne kadar uygulandigi (appliedTo) kaydedilir - boylece iptal edilebilir.
router.post("/party-payments/pay", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { partyType, partyId, amount, accountId, method, description } = req.body || {};
  if (!partyType || !partyId || !amount || Number(amount) <= 0) return res.status(400).json({ error: "Taraf ve tutar zorunludur." });
  const resolvedAccountId = accountId || data.meta.defaultAccountId;
  if (!data.accounts.find((a) => a.id === resolvedAccountId)) return res.status(404).json({ error: "Hesap bulunamadı." });

  let remaining = Number(amount);
  const appliedTo = [];
  const openCharges = data.partyCharges
    .filter((c) => c.partyType === partyType && c.partyId === partyId && c.status !== "paid")
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

  const transactionId = db.uid();
  const payment = { id: db.uid(), partyType, partyId, amount: Number(amount), accountId: resolvedAccountId, method: method || "Havale/EFT", description: description || "", date: new Date().toISOString(), createdBy: req.user.id, appliedTo, transactionId, cancelled: false };
  data.partyPayments.unshift(payment);

  const categoryLabel = partyType === "firma" ? "Firma Ödemesi" : "Personel Ödemesi";
  data.transactions.unshift({ id: transactionId, type: "gider", category: categoryLabel, amount: Number(amount), accountId: resolvedAccountId, date: payment.date, description: `${partyName(data, partyType, partyId)} - ${description || categoryLabel}`, createdBy: req.user.id });

  db.logActivity(data, req.user, "party.payment", `${partyName(data, partyType, partyId)} tarafına ${amount}₺ ödeme yapıldı.`, null);
  await db.save(data);
  res.status(201).json(payment);
});

// Firma/personele yapilan bir odemeyi iptal eder: ilgili borclarin paidAmount'unu
// geri duser ve bagli muhasebe hareketini siler (aidat iptaliyle ayni desen).
router.post("/party-payments/:id/cancel", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const payment = data.partyPayments.find((p) => p.id === req.params.id);
  if (!payment) return res.status(404).json({ error: "Ödeme bulunamadı." });
  if (payment.cancelled) return res.status(400).json({ error: "Bu ödeme zaten iptal edilmiş." });

  (payment.appliedTo || []).forEach(({ chargeId, amount }) => {
    const charge = data.partyCharges.find((c) => c.id === chargeId);
    if (!charge) return;
    charge.paidAmount = Math.max(0, charge.paidAmount - amount);
    charge.status = charge.paidAmount <= 0 ? "unpaid" : charge.paidAmount >= charge.amount ? "paid" : "partial";
  });
  data.transactions = data.transactions.filter((t) => t.id !== payment.transactionId);
  payment.cancelled = true;
  payment.cancelledAt = new Date().toISOString();
  payment.cancelledBy = req.user.id;

  db.logActivity(data, req.user, "party.payment.cancel", `${partyName(data, payment.partyType, payment.partyId)} tarafına yapılan ${payment.amount}₺ ödeme iptal edildi.`, null);
  await db.save(data);
  res.json({ message: "Ödeme iptal edildi, ilgili borç yeniden açıldı." });
});

// Firma/personele borclanma kaydini siler - sadece hic odeme yapilmamissa (paidAmount=0)
router.delete("/party-charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const charge = data.partyCharges.find((c) => c.id === req.params.id);
  if (!charge) return res.status(404).json({ error: "Kayıt bulunamadı." });
  if (charge.paidAmount > 0) return res.status(400).json({ error: "Bu borca kısmen veya tamamen ödeme yapılmış, önce ilgili ödemeyi iptal edin." });
  data.partyCharges = data.partyCharges.filter((c) => c.id !== req.params.id);
  db.logActivity(data, req.user, "party.charge.delete", `${partyName(data, charge.partyType, charge.partyId)} için borçlandırma silindi: ${charge.description}`, null);
  await db.save(data);
  res.json({ message: "Borçlandırma kaydı silindi." });
});

module.exports = router;
