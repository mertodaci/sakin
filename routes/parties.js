const express = require("express");
const { Prisma } = require("@prisma/client");
const db = require("../db");
const { materializeRecurringPartyCharges } = require("../jobs");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function partyDebt(data, partyType, partyId) {
  return data.partyCharges
    .filter((c) => c.partyType === partyType && c.partyId === partyId && c.status !== "paid")
    .reduce((s, c) => s + (c.amount - c.paidAmount), 0);
}

// partyType/partyId artik null olabilir ("genel gider" - belirli bir firma/
// personele bagli olmayan, sadece kategoriye baglanan borc/odeme). Bu
// durumda taraf adi yerine cagiran taraf kategori etiketini gosterir.
function partyName(data, partyType, partyId) {
  if (!partyType) return null;
  if (partyType === "firma") return data.vendors.find((v) => v.id === partyId)?.name || "-";
  return data.personnel.find((p) => p.id === partyId)?.name || "-";
}

function categoryLabel(cat) {
  if (!cat) return null;
  return `${cat.group} / ${cat.name}`;
}

function genInvoiceNo() {
  return "FT-" + Math.floor(100000 + Math.random() * 899999);
}
function genReceiptNo() {
  return "MK-" + Math.floor(100000 + Math.random() * 899999);
}

/* ---------------- GIDER KATEGORILERI (Gider Grubu / Gider) ---------------- */
// Yonetimcell'deki "Giderler (Odeme ve Borclanma)" ekraninin temeli: her
// gider bir Grup->Kalem hiyerarsisine baglanabilir, taraf (firma/personel)
// zorunlu degil - bkz. PartyCharge.categoryId.

router.get("/expense-categories", requireAuth, requireRole("yonetici"), async (req, res) => {
  const list = await db.prisma.expenseCategory.findMany({ orderBy: [{ group: "asc" }, { name: "asc" }] });
  res.json(list);
});

router.post("/expense-categories", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { group, name } = req.body || {};
  if (!group || !name) return res.status(400).json({ error: "Gider grubu ve kalem adı zorunludur." });
  const cat = await db.prisma.expenseCategory.create({ data: { group, name } });
  res.status(201).json(cat);
});

// categoryId'ye baglı PartyCharge'lar onDelete:SetNull sayesinde otomatik
// kategori referansini kaybeder (borc/fatura kaydi silinmez) - bu yuzden
// ayrica bir "kullanimda" kontrolune gerek yok.
router.delete("/expense-categories/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await db.prisma.expenseCategory.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Gider kategorisi silindi." });
});

/* ---------------- VENDORS (Firmalar) ---------------- */

router.get("/vendors", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  res.json(data.vendors.map((v) => ({ ...v, debt: partyDebt(data, "firma", v.id) })));
});

router.post("/vendors", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { name, category, contactName, phone, email, taxNumber, iban, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Firma adı zorunludur." });
  const v = { id: db.uid(), name, category: category || "", contactName: contactName || "", phone: phone || "", email: email || "", taxNumber: taxNumber || "", iban: iban || "", notes: notes || "", createdAt: new Date().toISOString() };
  data.vendors.push(v);
  db.logActivity(data, req.user, "vendor.create", `Yeni firma eklendi: ${name}`, null);
  await db.save(data);
  res.status(201).json(v);
});

router.patch("/vendors/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const v = data.vendors.find((x) => x.id === req.params.id);
  if (!v) return res.status(404).json({ error: "Firma bulunamadı." });
  const { name, category, contactName, phone, email, taxNumber, iban, notes } = req.body || {};
  if (name !== undefined) v.name = name;
  if (category !== undefined) v.category = category;
  if (contactName !== undefined) v.contactName = contactName;
  if (phone !== undefined) v.phone = phone;
  if (email !== undefined) v.email = email;
  if (taxNumber !== undefined) v.taxNumber = taxNumber;
  if (iban !== undefined) v.iban = iban;
  if (notes !== undefined) v.notes = notes;
  await db.save(data);
  res.json(v);
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

// query: partyType, partyId, categoryId, general=1 (sadece tarafsiz "genel
// gider" kayitlari), openOnly=1 (status != paid), dueFrom/dueTo (vade
// araligi) - Borc Listesi ve Ileri Tarihli Borc Listesi ekranlarinin
// filtreleri bu tek uctan besleniyor.
router.get("/party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const categories = await db.prisma.expenseCategory.findMany();
  const catMap = new Map(categories.map((c) => [c.id, c]));
  let list = data.partyCharges;
  if (req.query.partyType) list = list.filter((c) => c.partyType === req.query.partyType);
  if (req.query.partyId) list = list.filter((c) => c.partyId === req.query.partyId);
  if (req.query.categoryId) list = list.filter((c) => c.categoryId === req.query.categoryId);
  if (req.query.general === "1") list = list.filter((c) => !c.partyType);
  if (req.query.openOnly === "1") list = list.filter((c) => c.status !== "paid");
  if (req.query.dueFrom) list = list.filter((c) => new Date(c.dueDate) >= new Date(req.query.dueFrom));
  if (req.query.dueTo) list = list.filter((c) => new Date(c.dueDate) <= new Date(req.query.dueTo));
  res.json(
    list
      .slice()
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((c) => ({ ...c, partyName: partyName(data, c.partyType, c.partyId), category: catMap.get(c.categoryId) || null }))
  );
});

router.post("/party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { partyType, partyId, categoryId, amount, description, dueDate } = req.body || {};
  if ((!partyType || !partyId) && !categoryId) return res.status(400).json({ error: "En az bir taraf (firma/personel) veya bir gider kategorisi seçilmelidir." });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir tutar girilmelidir." });
  const charge = {
    id: db.uid(),
    partyType: partyType || null,
    partyId: partyType ? partyId : null,
    categoryId: categoryId || null,
    amount: Number(amount),
    paidAmount: 0,
    status: "unpaid",
    description: description || "",
    invoiceNo: genInvoiceNo(),
    date: new Date().toISOString(),
    // dueDate tarih-only girilebilir (ör. HTML <input type="date"> "2026-09-01")
    // - Prisma DateTime tam ISO-8601 bekler, bu yuzden once gercek Date'e cevrilir
    // (new Date(...).toISOString() saat bilgisini otomatik tamamlar).
    dueDate: dueDate ? new Date(dueDate).toISOString() : new Date().toISOString(),
    createdBy: req.user.id,
  };
  data.partyCharges.push(charge);
  const label = partyType ? partyName(data, partyType, partyId) : categoryLabel(await db.prisma.expenseCategory.findUnique({ where: { id: categoryId } }));
  db.logActivity(data, req.user, "party.charge", `${label} için ${amount}₺ borçlandırma kaydedildi (fatura ${charge.invoiceNo}): ${description || "-"}`, null);
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

// Odemeyi dagitir: partyType+partyId verilmisse en eski acik borctan baslayarak
// FIFO dagitir (tahsilat mantigiyla ayni - firma/personele coklu acik fatura
// olabilir, tek odeme hepsine sirayla uygulanir). chargeId verilmisse (genel
// gider - taraf yok, tek fatura) SADECE o tek kaydi hedefler - Yonetimcell'de
// de genel giderler toplu degil, fatura fatura odenir.
router.post("/party-payments/pay", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { partyType, partyId, chargeId, amount, accountId, method, description } = req.body || {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir tutar girilmelidir." });
  if ((!partyType || !partyId) && !chargeId) return res.status(400).json({ error: "Taraf veya tek bir borç kaydı belirtilmelidir." });
  const resolvedAccountId = accountId || data.meta.defaultAccountId;
  if (!data.accounts.find((a) => a.id === resolvedAccountId)) return res.status(404).json({ error: "Hesap bulunamadı." });

  let remaining = Number(amount);
  const appliedTo = [];
  const openCharges = chargeId
    ? data.partyCharges.filter((c) => c.id === chargeId && c.status !== "paid")
    : data.partyCharges
        .filter((c) => c.partyType === partyType && c.partyId === partyId && c.status !== "paid")
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  if (chargeId && openCharges.length === 0) return res.status(404).json({ error: "Borç kaydı bulunamadı veya zaten ödenmiş." });
  for (const c of openCharges) {
    if (remaining <= 0) break;
    const owed = c.amount - c.paidAmount;
    const applied = Math.min(owed, remaining);
    c.paidAmount += applied;
    remaining -= applied;
    c.status = c.paidAmount >= c.amount ? "paid" : "partial";
    appliedTo.push({ chargeId: c.id, amount: applied });
  }

  // Tek-fatura odemesinde taraf bilgisi hedef borctan cikarilir (istekte
  // gonderilmemis olabilir) - odeme kaydinin kendi partyType/partyId'si
  // dogru kalsin diye (raporlama/filtreleme icin).
  const resolvedPartyType = chargeId ? openCharges[0].partyType : partyType || null;
  const resolvedPartyId = chargeId ? openCharges[0].partyId : partyType ? partyId : null;
  const label = resolvedPartyType
    ? partyName(data, resolvedPartyType, resolvedPartyId)
    : categoryLabel((await db.prisma.expenseCategory.findUnique({ where: { id: openCharges[0]?.categoryId || "" } }).catch(() => null))) || "Genel Gider";

  // transactions artik finance.js gibi dogrudan Prisma'da yasiyor (LEGACY_COLLECTIONS'ta
  // degil) - once gercek satiri olusturup id'sini aliyoruz, partyPayment'e (hala legacy)
  // o id'yi referans olarak yaziyoruz ki db.save() sirasinda FK saglansin.
  const txCategoryLabel = resolvedPartyType === "firma" ? "Firma Ödemesi" : resolvedPartyType === "personel" ? "Personel Ödemesi" : "Genel Gider Ödemesi";
  const transaction = await db.prisma.transaction.create({
    data: { type: "gider", category: txCategoryLabel, amount: new Prisma.Decimal(amount), accountId: resolvedAccountId, description: `${label} - ${description || txCategoryLabel}`, createdBy: req.user.id },
  });

  const receiptNo = genReceiptNo();
  const payment = { id: db.uid(), partyType: resolvedPartyType, partyId: resolvedPartyId, amount: Number(amount), accountId: resolvedAccountId, method: method || "Havale/EFT", description: description || "", receiptNo, date: new Date().toISOString(), createdBy: req.user.id, appliedTo, transactionId: transaction.id, cancelled: false };
  data.partyPayments.unshift(payment);

  db.logActivity(data, req.user, "party.payment", `${label} tarafına ${amount}₺ ödeme yapıldı (makbuz ${receiptNo}).`, null);
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
  if (payment.transactionId) {
    await db.prisma.transaction.delete({ where: { id: payment.transactionId } }).catch((e) => {
      if (e.code !== "P2025") throw e;
    });
  }
  payment.transactionId = null;
  payment.cancelled = true;
  payment.cancelledAt = new Date().toISOString();
  payment.cancelledBy = req.user.id;

  db.logActivity(data, req.user, "party.payment.cancel", `${partyName(data, payment.partyType, payment.partyId) || "Genel gider"} için yapılan ${payment.amount}₺ ödeme iptal edildi.`, null);
  await db.save(data);
  res.json({ message: "Ödeme iptal edildi, ilgili borç yeniden açıldı." });
});

// Firma/personele borclanma kaydini siler - sadece hic odeme yapilmamissa (paidAmount=0
// VE hicbir PartyPaymentAllocation'a bagli degilse - iptal edilmis kismi bir odemenin
// gecmis allocation kaydi olabilir, bu PartyPaymentAllocation->PartyCharge FK'sini
// (onDelete: Restrict) ihlal edip genel bir 500 hatasina yol acardi; once dostane bir
// Turkce hata donduruyoruz).
router.delete("/party-charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const charge = data.partyCharges.find((c) => c.id === req.params.id);
  if (!charge) return res.status(404).json({ error: "Kayıt bulunamadı." });
  const allocationCount = await db.prisma.partyPaymentAllocation.count({ where: { partyChargeId: charge.id } });
  if (charge.paidAmount > 0 || allocationCount > 0) return res.status(400).json({ error: "Bu borca kısmen veya tamamen ödeme yapılmış, önce ilgili ödemeyi iptal edin." });
  data.partyCharges = data.partyCharges.filter((c) => c.id !== req.params.id);
  db.logActivity(data, req.user, "party.charge.delete", `${partyName(data, charge.partyType, charge.partyId) || "Genel gider"} için borçlandırma silindi: ${charge.description}`, null);
  await db.save(data);
  res.json({ message: "Borçlandırma kaydı silindi." });
});

/* ---------------- TEKRARLAYAN / ILERI TARIHLI FATURALAR ---------------- */
// Yonetimcell'deki "Ileri Tarihli Borc Listesi" ekraninin gercek karsiligi -
// meger sadece vadesi ileri olan borclar degil, periyodik/zamanlanmis fatura
// sablonu sistemiymis (bkz. jobs.js materializeRecurringPartyCharges).

router.get("/recurring-party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const [list, categories] = await Promise.all([
    db.prisma.recurringPartyCharge.findMany({ orderBy: { nextDate: "asc" } }),
    db.prisma.expenseCategory.findMany(),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  res.json(
    list.map((r) => ({
      ...r,
      amount: r.amount.toNumber(),
      partyName: partyName(data, r.partyType, r.partyId),
      category: catMap.get(r.categoryId) || null,
    }))
  );
});

router.post("/recurring-party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { partyType, partyId, categoryId, description, amount, nextDate, frequency } = req.body || {};
  if ((!partyType || !partyId) && !categoryId) return res.status(400).json({ error: "En az bir taraf (firma/personel) veya bir gider kategorisi seçilmelidir." });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir tutar girilmelidir." });
  if (!nextDate) return res.status(400).json({ error: "İlk vade tarihi zorunludur." });
  if (!["once", "monthly", "yearly"].includes(frequency)) return res.status(400).json({ error: "Geçersiz sıklık." });
  const r = await db.prisma.recurringPartyCharge.create({
    data: {
      partyType: partyType || null,
      partyId: partyType ? partyId : null,
      categoryId: categoryId || null,
      description: description || "",
      amount: new Prisma.Decimal(amount),
      nextDate: new Date(nextDate),
      frequency,
      createdBy: req.user.id,
    },
  });
  res.status(201).json(r);
});

router.patch("/recurring-party-charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { active } = req.body || {};
  const r = await db.prisma.recurringPartyCharge.update({ where: { id: req.params.id }, data: { active: !!active } }).catch(() => null);
  if (!r) return res.status(404).json({ error: "Kayıt bulunamadı." });
  res.json(r);
});

router.delete("/recurring-party-charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await db.prisma.recurringPartyCharge.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Tekrarlayan fatura şablonu silindi." });
});

// Normalde runMaintenanceTasks 6 saatte bir otomatik calisir - yonetici
// vadesi gelmis sablonlari beklemeden hemen borca cevirmek isteyebilir
// (charges/generate-month'un aidat tarafindaki manuel tetikleyicisiyle ayni desen).
router.post("/recurring-party-charges/run-now", requireAuth, requireRole("yonetici"), async (req, res) => {
  const created = await materializeRecurringPartyCharges();
  res.json({ message: `${created} fatura gerçek borca çevrildi.`, created });
});

module.exports = router;
