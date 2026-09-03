const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { randomUUID } = require("crypto");
const { Prisma } = require("@prisma/client");
const db = require("../db");
const { materializeRecurringPartyCharges } = require("../jobs");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

// Yonetimcell karsilastirmasi: "Borc Listesi"nde her gider kaydina fatura/
// makbuz dosyasi eklenebiliyordu. archive.js ile ayni guvenlik pattern'i:
// disk dosya adi her zaman UUID, kullanicinin gonderdigi orijinal ad asla
// disk yolu olarak kullanilmaz (path traversal riski).
const ATTACHMENT_DIR = path.join(__dirname, "..", "uploads", "party-charge-attachments");
fs.mkdirSync(ATTACHMENT_DIR, { recursive: true });
const attachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ATTACHMENT_DIR),
    filename: (req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname).slice(0, 10)),
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

async function partyDebt(partyType, partyId) {
  const charges = await prisma.partyCharge.findMany({ where: { partyType, partyId, status: { not: "paid" } } });
  return charges.reduce((s, c) => s + c.amount.minus(c.paidAmount).toNumber(), 0);
}

// partyType/partyId artik null olabilir ("genel gider" - belirli bir firma/
// personele bagli olmayan, sadece kategoriye baglanan borc/odeme). Bu
// durumda taraf adi yerine cagiran taraf kategori etiketini gosterir.
async function partyName(partyType, partyId) {
  if (!partyType) return null;
  if (partyType === "firma") return (await prisma.vendor.findUnique({ where: { id: partyId } }))?.name || "-";
  return (await prisma.personnel.findUnique({ where: { id: partyId } }))?.name || "-";
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
  const list = await prisma.expenseCategory.findMany({ orderBy: [{ group: "asc" }, { name: "asc" }] });
  res.json(list);
});

router.post("/expense-categories", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { group, name } = req.body || {};
  if (!group || !name) return res.status(400).json({ error: "Gider grubu ve kalem adı zorunludur." });
  const cat = await prisma.expenseCategory.create({ data: { group, name } });
  res.status(201).json(cat);
});

// categoryId'ye baglı PartyCharge'lar onDelete:SetNull sayesinde otomatik
// kategori referansini kaybeder (borc/fatura kaydi silinmez) - bu yuzden
// ayrica bir "kullanimda" kontrolune gerek yok.
router.delete("/expense-categories/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.expenseCategory.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Gider kategorisi silindi." });
});

/* ---------------- VENDORS (Firmalar) ---------------- */

router.get("/vendors", requireAuth, requireRole("yonetici"), async (req, res) => {
  const vendors = await prisma.vendor.findMany({ orderBy: { name: "asc" } });
  const withDebt = await Promise.all(vendors.map(async (v) => ({ ...v, debt: await partyDebt("firma", v.id) })));
  res.json(withDebt);
});

router.post("/vendors", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name, category, contactName, phone, email, taxNumber, iban, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: "Firma adı zorunludur." });
  const v = await prisma.vendor.create({
    data: { name, category: category || "", contactName: contactName || "", phone: phone || "", email: email || "", taxNumber: taxNumber || "", iban: iban || "", notes: notes || "" },
  });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "vendor.create", detail: `Yeni firma eklendi: ${name}` } });
  res.status(201).json(v);
});

router.patch("/vendors/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name, category, contactName, phone, email, taxNumber, iban, notes } = req.body || {};
  const fields = {};
  if (name !== undefined) fields.name = name;
  if (category !== undefined) fields.category = category;
  if (contactName !== undefined) fields.contactName = contactName;
  if (phone !== undefined) fields.phone = phone;
  if (email !== undefined) fields.email = email;
  if (taxNumber !== undefined) fields.taxNumber = taxNumber;
  if (iban !== undefined) fields.iban = iban;
  if (notes !== undefined) fields.notes = notes;
  const v = await prisma.vendor.update({ where: { id: req.params.id }, data: fields }).catch(() => null);
  if (!v) return res.status(404).json({ error: "Firma bulunamadı." });
  res.json(v);
});

// Firmaya bagli hem borc (partyCharges) hem odeme (partyPayments) kaydi
// kontrol edilir - odeme, hicbir zaman acik borc birakmadan (orn. tek
// faturalik "genel gider" odemesi) tek basina var olabilir, sadece
// borclara bakmak yetim odeme kaydi birakirdi.
router.delete("/vendors/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const [chargeCount, paymentCount] = await Promise.all([
    prisma.partyCharge.count({ where: { partyType: "firma", partyId: req.params.id } }),
    prisma.partyPayment.count({ where: { partyType: "firma", partyId: req.params.id } }),
  ]);
  if (chargeCount > 0 || paymentCount > 0) return res.status(400).json({ error: "Bu firmaya bağlı cari hesap kayıtları var, silinemez." });
  await prisma.vendor.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Firma silindi." });
});

/* ---------------- PARTY CHARGES (Firma/Personel Borclanma) ---------------- */

// query: partyType, partyId, categoryId, general=1 (sadece tarafsiz "genel
// gider" kayitlari), openOnly=1 (status != paid), dueFrom/dueTo (vade
// araligi) - Borc Listesi ve Ileri Tarihli Borc Listesi ekranlarinin
// filtreleri bu tek uctan besleniyor.
router.get("/party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const where = {};
  if (req.query.partyType) where.partyType = req.query.partyType;
  if (req.query.partyId) where.partyId = req.query.partyId;
  if (req.query.categoryId) where.categoryId = req.query.categoryId;
  if (req.query.general === "1") where.partyType = null;
  if (req.query.openOnly === "1") where.status = { not: "paid" };
  if (req.query.dueFrom || req.query.dueTo) {
    where.dueDate = {};
    if (req.query.dueFrom) where.dueDate.gte = new Date(req.query.dueFrom);
    if (req.query.dueTo) where.dueDate.lte = new Date(req.query.dueTo);
  }
  const [list, categories] = await Promise.all([
    prisma.partyCharge.findMany({ where, orderBy: { date: "desc" } }),
    prisma.expenseCategory.findMany(),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const withNames = await Promise.all(
    list.map(async (c) => ({ ...c, partyName: await partyName(c.partyType, c.partyId), category: catMap.get(c.categoryId) || null }))
  );
  res.json(withNames);
});

router.post("/party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { partyType, partyId, categoryId, amount, description, dueDate } = req.body || {};
  if ((!partyType || !partyId) && !categoryId) return res.status(400).json({ error: "En az bir taraf (firma/personel) veya bir gider kategorisi seçilmelidir." });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir tutar girilmelidir." });
  const charge = await prisma.partyCharge.create({
    data: {
      partyType: partyType || null,
      partyId: partyType ? partyId : null,
      categoryId: categoryId || null,
      amount: new Prisma.Decimal(amount),
      status: "unpaid",
      description: description || "",
      invoiceNo: genInvoiceNo(),
      // dueDate tarih-only girilebilir (ör. HTML <input type="date"> "2026-09-01")
      // - Prisma DateTime tam ISO-8601 bekler, bu yuzden once gercek Date'e cevrilir.
      dueDate: dueDate ? new Date(dueDate) : new Date(),
      createdBy: req.user.id,
    },
  });
  const label = partyType ? await partyName(partyType, partyId) : categoryLabel(await prisma.expenseCategory.findUnique({ where: { id: categoryId } }));
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "party.charge", detail: `${label} için ${amount}₺ borçlandırma kaydedildi (fatura ${charge.invoiceNo}): ${description || "-"}` },
  });
  res.status(201).json(charge);
});

router.post("/party-charges/:id/attachment", requireAuth, requireRole("yonetici"), attachmentUpload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Dosya zorunludur." });
  const charge = await prisma.partyCharge.findUnique({ where: { id: req.params.id } });
  if (!charge) { fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: "Borç kaydı bulunamadı." }); }
  // Eski dosya varsa diskten temizle (ayni kayda yeni dosya yuklenirse birikmesin).
  if (charge.attachmentStoredName) fs.unlink(path.join(ATTACHMENT_DIR, charge.attachmentStoredName), () => {});
  const updated = await prisma.partyCharge.update({
    where: { id: charge.id },
    data: { attachmentStoredName: req.file.filename, attachmentOriginalName: req.file.originalname },
  });
  res.json({ attachmentStoredName: updated.attachmentStoredName, attachmentOriginalName: updated.attachmentOriginalName });
});

router.get("/party-charges/:id/attachment", requireAuth, requireRole("yonetici"), async (req, res) => {
  const charge = await prisma.partyCharge.findUnique({ where: { id: req.params.id } });
  if (!charge || !charge.attachmentStoredName) return res.status(404).json({ error: "Ek dosya bulunamadı." });
  res.download(path.join(ATTACHMENT_DIR, charge.attachmentStoredName), charge.attachmentOriginalName || "ek-dosya");
});

router.delete("/party-charges/:id/attachment", requireAuth, requireRole("yonetici"), async (req, res) => {
  const charge = await prisma.partyCharge.findUnique({ where: { id: req.params.id } });
  if (!charge) return res.status(404).json({ error: "Borç kaydı bulunamadı." });
  if (charge.attachmentStoredName) fs.unlink(path.join(ATTACHMENT_DIR, charge.attachmentStoredName), () => {});
  await prisma.partyCharge.update({ where: { id: charge.id }, data: { attachmentStoredName: null, attachmentOriginalName: null } });
  res.json({ message: "Ek dosya kaldırıldı." });
});

/* ---------------- PARTY PAYMENTS (Firma/Personele Odeme) ---------------- */

router.get("/party-payments", requireAuth, requireRole("yonetici"), async (req, res) => {
  const where = {};
  if (req.query.partyType) where.partyType = req.query.partyType;
  if (req.query.partyId) where.partyId = req.query.partyId;
  const list = await prisma.partyPayment.findMany({ where, orderBy: { date: "desc" }, include: { allocations: true } });
  res.json(list.map((p) => ({ ...p, appliedTo: p.allocations.map((a) => ({ chargeId: a.partyChargeId, amount: a.amount })), allocations: undefined })));
});

// Odemeyi dagitir: partyType+partyId verilmisse en eski acik borctan baslayarak
// FIFO dagitir (tahsilat mantigiyla ayni - firma/personele coklu acik fatura
// olabilir, tek odeme hepsine sirayla uygulanir). chargeId verilmisse (genel
// gider - taraf yok, tek fatura) SADECE o tek kaydi hedefler - Yonetimcell'de
// de genel giderler toplu degil, fatura fatura odenir.
//
// finance.js'deki /payments/pay ile ayni desen: FIFO dagitim + borc guncelleme +
// Transaction + PartyPayment/allocations hep birlikte tek $transaction icinde
// yazilir; requestId verilirse PaymentRequest tablosuna eklenir, ayni id
// ikinci kez gelirse unique-violation (P2002) yakalanip 409 donulur (cift
// tiklama/ag tekrarindan kaynaklanan mukerrer odeme koruması). id, finance.js'le
// ayni sebeple `${siteId}:${requestId}` olarak namespace'lenir - PaymentRequest
// GLOBAL_MODELS'te (siteId kolonu yok), namespace olmadan iki farkli sitenin
// ayni requestId'yi uretmesi digerinin odemesini yanlislikla reddedebilirdi.
router.post("/party-payments/pay", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { partyType, partyId, chargeId, amount, accountId, method, description, requestId } = req.body || {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir tutar girilmelidir." });
  if ((!partyType || !partyId) && !chargeId) return res.status(400).json({ error: "Taraf veya tek bir borç kaydı belirtilmelidir." });

  try {
    const payment = await prisma.$transaction(async (tx) => {
      if (requestId) {
        try {
          await tx.paymentRequest.create({ data: { id: `${req.user.siteId}:${requestId}` } });
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            throw Object.assign(new Error("DUPLICATE_REQUEST"), { isDuplicate: true });
          }
          throw e;
        }
      }

      const site = await tx.site.findUniqueOrThrow({ where: { id: req.user.siteId } });
      const resolvedAccountId = accountId || site.defaultAccountId;
      if (!(await tx.account.findUnique({ where: { id: resolvedAccountId } }))) {
        throw Object.assign(new Error("ACCOUNT_NOT_FOUND"), { httpStatus: 404, msg: "Hesap bulunamadı." });
      }

      const openCharges = chargeId
        ? await tx.partyCharge.findMany({ where: { id: chargeId, status: { not: "paid" } } })
        : await tx.partyCharge.findMany({ where: { partyType, partyId, status: { not: "paid" } }, orderBy: { dueDate: "asc" } });
      if (chargeId && openCharges.length === 0) {
        throw Object.assign(new Error("CHARGE_NOT_FOUND"), { httpStatus: 404, msg: "Borç kaydı bulunamadı veya zaten ödenmiş." });
      }

      let remaining = new Prisma.Decimal(amount);
      const appliedTo = [];
      for (const c of openCharges) {
        if (remaining.lte(0)) break;
        const owed = c.amount.minus(c.paidAmount);
        const applied = Prisma.Decimal.min(owed, remaining);
        const newPaid = c.paidAmount.plus(applied);
        await tx.partyCharge.update({ where: { id: c.id }, data: { paidAmount: newPaid, status: newPaid.gte(c.amount) ? "paid" : "partial" } });
        remaining = remaining.minus(applied);
        appliedTo.push({ chargeId: c.id, amount: applied });
      }

      // Tek-fatura odemesinde taraf bilgisi hedef borctan cikarilir (istekte
      // gonderilmemis olabilir) - odeme kaydinin kendi partyType/partyId'si
      // dogru kalsin diye (raporlama/filtreleme icin).
      const resolvedPartyType = chargeId ? openCharges[0].partyType : partyType || null;
      const resolvedPartyId = chargeId ? openCharges[0].partyId : partyType ? partyId : null;
      const label = resolvedPartyType
        ? await partyName(resolvedPartyType, resolvedPartyId)
        : categoryLabel(await tx.expenseCategory.findUnique({ where: { id: openCharges[0]?.categoryId || "" } }).catch(() => null)) || "Genel Gider";

      const txCategoryLabel = resolvedPartyType === "firma" ? "Firma Ödemesi" : resolvedPartyType === "personel" ? "Personel Ödemesi" : "Genel Gider Ödemesi";
      const transaction = await tx.transaction.create({
        data: { type: "gider", category: txCategoryLabel, amount: new Prisma.Decimal(amount), accountId: resolvedAccountId, description: `${label} - ${description || txCategoryLabel}`, createdBy: req.user.id },
      });

      const receiptNo = genReceiptNo();
      // allocations ayri, duz .create() cagrilariyla yaziliyor - Prisma
      // extension'lar (siteId enjeksiyonu, bkz. lib/prismaClient.js) ic ice
      // (nested) iliskisel yazmalari yakalamaz.
      const created = await tx.partyPayment.create({
        data: {
          partyType: resolvedPartyType,
          partyId: resolvedPartyId,
          amount: new Prisma.Decimal(amount),
          accountId: resolvedAccountId,
          method: method || "Havale/EFT",
          description: description || "",
          receiptNo,
          createdBy: req.user.id,
          transactionId: transaction.id,
        },
      });
      for (const a of appliedTo) {
        await tx.partyPaymentAllocation.create({ data: { partyPaymentId: created.id, partyChargeId: a.chargeId, amount: a.amount } });
      }
      created.allocations = appliedTo.map((a) => ({ partyChargeId: a.chargeId, amount: a.amount }));

      await tx.activityLog.create({
        data: { actorId: req.user.id, actorName: req.user.name, action: "party.payment", detail: `${label} tarafına ${amount}₺ ödeme yapıldı (makbuz ${receiptNo}).` },
      });

      return created;
    });
    res.status(201).json({ ...payment, appliedTo: payment.allocations.map((a) => ({ chargeId: a.partyChargeId, amount: a.amount })), allocations: undefined });
  } catch (e) {
    if (e.isDuplicate) return res.status(409).json({ error: "Bu ödeme isteği zaten işlendi (mükerrer istek engellendi)." });
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.msg });
    throw e;
  }
});

// Firma/personele yapilan bir odemeyi iptal eder: ilgili borclarin paidAmount'unu
// geri duser ve bagli muhasebe hareketini siler (aidat iptaliyle ayni desen).
router.post("/party-payments/:id/cancel", requireAuth, requireRole("yonetici"), async (req, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      const payment = await tx.partyPayment.findUnique({ where: { id: req.params.id }, include: { allocations: true } });
      if (!payment) throw Object.assign(new Error("NOT_FOUND"), { httpStatus: 404, msg: "Ödeme bulunamadı." });
      if (payment.cancelled) throw Object.assign(new Error("ALREADY_CANCELLED"), { httpStatus: 400, msg: "Bu ödeme zaten iptal edilmiş." });

      for (const a of payment.allocations) {
        const charge = await tx.partyCharge.findUnique({ where: { id: a.partyChargeId } });
        if (!charge) continue;
        const newPaid = Prisma.Decimal.max(0, charge.paidAmount.minus(a.amount));
        const status = newPaid.lte(0) ? "unpaid" : newPaid.gte(charge.amount) ? "paid" : "partial";
        await tx.partyCharge.update({ where: { id: charge.id }, data: { paidAmount: newPaid, status } });
      }

      if (payment.transactionId) {
        await tx.transaction.delete({ where: { id: payment.transactionId } });
      }

      await tx.partyPayment.update({
        where: { id: payment.id },
        data: { cancelled: true, cancelledAt: new Date(), cancelledBy: req.user.id, transactionId: null },
      });

      const label = (await partyName(payment.partyType, payment.partyId)) || "Genel gider";
      await tx.activityLog.create({
        data: { actorId: req.user.id, actorName: req.user.name, action: "party.payment.cancel", detail: `${label} için yapılan ${payment.amount}₺ ödeme iptal edildi.` },
      });
    });
    res.json({ message: "Ödeme iptal edildi, ilgili borç yeniden açıldı." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.msg });
    throw e;
  }
});

// Firma/personele borclanma kaydini siler - sadece hic odeme yapilmamissa (paidAmount=0
// VE hicbir PartyPaymentAllocation'a bagli degilse - iptal edilmis kismi bir odemenin
// gecmis allocation kaydi olabilir, bu PartyPaymentAllocation->PartyCharge FK'sini
// (onDelete: Restrict) ihlal edip genel bir 500 hatasina yol acardi; once dostane bir
// Turkce hata donduruyoruz).
router.delete("/party-charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const charge = await prisma.partyCharge.findUnique({ where: { id: req.params.id } });
  if (!charge) return res.status(404).json({ error: "Kayıt bulunamadı." });
  const allocationCount = await prisma.partyPaymentAllocation.count({ where: { partyChargeId: charge.id } });
  if (charge.paidAmount.gt(0) || allocationCount > 0) return res.status(400).json({ error: "Bu borca kısmen veya tamamen ödeme yapılmış, önce ilgili ödemeyi iptal edin." });
  const label = (await partyName(charge.partyType, charge.partyId)) || "Genel gider";
  if (charge.attachmentStoredName) fs.unlink(path.join(ATTACHMENT_DIR, charge.attachmentStoredName), () => {});
  await prisma.partyCharge.delete({ where: { id: req.params.id } });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "party.charge.delete", detail: `${label} için borçlandırma silindi: ${charge.description}` },
  });
  res.json({ message: "Borçlandırma kaydı silindi." });
});

/* ---------------- TEKRARLAYAN / ILERI TARIHLI FATURALAR ---------------- */
// Yonetimcell'deki "Ileri Tarihli Borc Listesi" ekraninin gercek karsiligi -
// meger sadece vadesi ileri olan borclar degil, periyodik/zamanlanmis fatura
// sablonu sistemiymis (bkz. jobs.js materializeRecurringPartyCharges).

router.get("/recurring-party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const [list, categories] = await Promise.all([
    prisma.recurringPartyCharge.findMany({ orderBy: { nextDate: "asc" } }),
    prisma.expenseCategory.findMany(),
  ]);
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const withNames = await Promise.all(
    list.map(async (r) => ({ ...r, amount: r.amount.toNumber(), partyName: await partyName(r.partyType, r.partyId), category: catMap.get(r.categoryId) || null }))
  );
  res.json(withNames);
});

router.post("/recurring-party-charges", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { partyType, partyId, categoryId, description, amount, nextDate, frequency } = req.body || {};
  if ((!partyType || !partyId) && !categoryId) return res.status(400).json({ error: "En az bir taraf (firma/personel) veya bir gider kategorisi seçilmelidir." });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: "Geçerli bir tutar girilmelidir." });
  if (!nextDate) return res.status(400).json({ error: "İlk vade tarihi zorunludur." });
  if (!["once", "monthly", "yearly"].includes(frequency)) return res.status(400).json({ error: "Geçersiz sıklık." });
  const r = await prisma.recurringPartyCharge.create({
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
  const r = await prisma.recurringPartyCharge.update({ where: { id: req.params.id }, data: { active: !!active } }).catch(() => null);
  if (!r) return res.status(404).json({ error: "Kayıt bulunamadı." });
  res.json(r);
});

router.delete("/recurring-party-charges/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.recurringPartyCharge.delete({ where: { id: req.params.id } }).catch((e) => {
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
