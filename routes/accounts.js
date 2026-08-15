const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// Bir hesabin guncel bakiyesi: acilis bakiyesi + gelirler - giderler + gelen transferler - giden transferler
function accountBalance(data, accountId) {
  const acc = data.accounts.find((a) => a.id === accountId);
  if (!acc) return 0;
  const income = data.transactions.filter((t) => t.accountId === accountId && t.type === "gelir").reduce((s, t) => s + t.amount, 0);
  const expense = data.transactions.filter((t) => t.accountId === accountId && t.type === "gider").reduce((s, t) => s + t.amount, 0);
  const transfersIn = data.transfers.filter((tr) => tr.toAccountId === accountId).reduce((s, tr) => s + tr.amount, 0);
  const transfersOut = data.transfers.filter((tr) => tr.fromAccountId === accountId).reduce((s, tr) => s + tr.amount, 0);
  return acc.openingBalance + income - expense + transfersIn - transfersOut;
}

router.get("/accounts", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const list = data.accounts.map((a) => ({ ...a, balance: accountBalance(data, a.id) }));
  res.json(list);
});

router.post("/accounts", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { name, type, bankName, iban, openingBalance } = req.body || {};
  if (!name) return res.status(400).json({ error: "Hesap adı zorunludur." });
  const acc = { id: db.uid(), name, type: type || "banka", bankName: bankName || "", iban: iban || "", openingBalance: Number(openingBalance) || 0, createdAt: new Date().toISOString() };
  data.accounts.push(acc);
  db.logActivity(data, req.user, "account.create", `Yeni kasa/hesap eklendi: ${name}`, null);
  await db.save(data);
  res.status(201).json(acc);
});

router.patch("/accounts/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const acc = data.accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: "Hesap bulunamadı." });
  const { name, type, bankName, iban } = req.body || {};
  if (name !== undefined) acc.name = name;
  if (type !== undefined) acc.type = type;
  if (bankName !== undefined) acc.bankName = bankName;
  if (iban !== undefined) acc.iban = iban;
  await db.save(data);
  res.json(acc);
});

router.delete("/accounts/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  if (data.accounts.length <= 1) return res.status(400).json({ error: "En az bir hesap bulunmalıdır." });
  const inUse = data.transactions.some((t) => t.accountId === req.params.id) || data.payments.some((p) => p.accountId === req.params.id) || data.transfers.some((tr) => tr.fromAccountId === req.params.id || tr.toAccountId === req.params.id);
  if (inUse) return res.status(400).json({ error: "Bu hesaba bağlı işlemler var, silinemez. Önce işlemleri başka bir hesaba taşıyın." });
  if (data.meta.defaultAccountId === req.params.id) return res.status(400).json({ error: "Varsayılan tahsilat hesabı silinemez. Önce Ayarlar'dan başka bir hesabı varsayılan yapın." });
  data.accounts = data.accounts.filter((a) => a.id !== req.params.id);
  await db.save(data);
  res.json({ message: "Hesap silindi." });
});

// Bir hesabin tum hareketlerini (gelir/gider/transfer) tarih sirali gosterir - "kasa ekstresi"
router.get("/accounts/:id/ledger", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const acc = data.accounts.find((a) => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: "Hesap bulunamadı." });

  const rows = [];
  data.transactions.filter((t) => t.accountId === acc.id).forEach((t) => {
    rows.push({ date: t.date, label: t.category, description: t.description, amount: t.type === "gelir" ? t.amount : -t.amount });
  });
  data.transfers.forEach((tr) => {
    if (tr.toAccountId === acc.id) rows.push({ date: tr.date, label: "Hesaba Transfer", description: `${data.accounts.find((a) => a.id === tr.fromAccountId)?.name || "-"} hesabından`, amount: tr.amount });
    if (tr.fromAccountId === acc.id) rows.push({ date: tr.date, label: "Hesaptan Transfer", description: `${data.accounts.find((a) => a.id === tr.toAccountId)?.name || "-"} hesabına`, amount: -tr.amount });
  });
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  res.json({ account: { ...acc, balance: accountBalance(data, acc.id) }, rows });
});

// Kasalar arasi para transferi (ornek: nakit tahsilati bankaya yatirma)
router.post("/accounts/transfer", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { fromAccountId, toAccountId, amount, description } = req.body || {};
  if (!fromAccountId || !toAccountId || !amount || Number(amount) <= 0) return res.status(400).json({ error: "Kaynak, hedef hesap ve tutar zorunludur." });
  if (fromAccountId === toAccountId) return res.status(400).json({ error: "Kaynak ve hedef hesap aynı olamaz." });
  if (!data.accounts.find((a) => a.id === fromAccountId) || !data.accounts.find((a) => a.id === toAccountId)) return res.status(404).json({ error: "Hesap bulunamadı." });

  const transfer = { id: db.uid(), fromAccountId, toAccountId, amount: Number(amount), date: new Date().toISOString(), description: description || "", createdBy: req.user.id };
  data.transfers.unshift(transfer);
  const fromName = data.accounts.find((a) => a.id === fromAccountId).name;
  const toName = data.accounts.find((a) => a.id === toAccountId).name;
  db.logActivity(data, req.user, "account.transfer", `${amount}₺ ${fromName} hesabından ${toName} hesabına transfer edildi.`, null);
  await db.save(data);
  res.status(201).json(transfer);
});

module.exports = { router, accountBalance };
