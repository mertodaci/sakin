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
    include: { category: true },
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
  const { unitId, type, categoryId, period, amount, dueDate, description } = req.body || {};
  if (!unitId || !amount || Number(amount) <= 0) return res.status(400).json({ error: "Daire ve pozitif bir tutar zorunludur." });
  // categoryId, PartyCharge (firma/personel gideri) ile AYNI Gider Grubu/
  // Kalemi taksonomisini paylasir (orn. "Demirbas" hem bir firma
  // faturasinda hem burada, dairelere yansitilirken kullanilabilir).
  // type serbest metin olarak ana etiket olmaya devam eder - kategori
  // secilip type bos birakilirsa, kategori adi type olarak kullanilir.
  let resolvedType = type;
  if (!resolvedType && categoryId) {
    const cat = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    resolvedType = cat ? cat.name : "diger";
  }
  const charge = await prisma.charge.create({
    data: {
      unitId,
      type: resolvedType || "diger",
      categoryId: categoryId || null,
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
// chargeIds verilirse (Yonetimcell karsilastirmasi: Tahsilat Ekrani'nda
// "Secerek tahsil etmek istiyorum" checkbox'i) odeme SADECE o kayitlara
// uygulanir - saf FIFO yerine yoneticinin sectigi belirli borclar kapatilir.
// Verilmezse eski davranis (tum acik borclar, en eski once) degismeden kalir.
async function applyPayment(tx, { unitId, amount, method, userId, userName, note, accountId, chargeIds }) {
  const amt = new Prisma.Decimal(amount);
  let remaining = amt;
  const appliedTo = [];

  const openCharges = await tx.charge.findMany({
    where: chargeIds && chargeIds.length ? { unitId, id: { in: chargeIds }, status: { not: "paid" } } : { unitId, status: { not: "paid" } },
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

  // Acik borclarin tumu kapandiktan sonra kalan tutar (varsa) metne gomulmez,
  // dairenin alacakli bakiyesine (Unit.creditBalance) eklenir - yonetici daha
  // sonra "Krediyi Borca Uygula" ile bilincli olarak bir sonraki borca aktarir.
  const creditAmount = remaining.gt(0) ? remaining : new Prisma.Decimal(0);

  const payment = await tx.payment.create({
    data: {
      unitId,
      userId: userId || null,
      amount: amt,
      method: method || "Elden",
      accountId: resolvedAccountId,
      note: note || (creditAmount.gt(0) ? `${creditAmount.toString()}₺ borç kalmadığı için alacak bakiyesine eklendi` : ""),
      receiptNo,
      transactionId: transaction.id,
      creditAmount,
      creditRemaining: creditAmount,
      allocations: { create: appliedTo.map((a) => ({ chargeId: a.chargeId, amount: a.amount })) },
    },
    include: { allocations: true },
  });

  const unit = creditAmount.gt(0)
    ? await tx.unit.update({ where: { id: unitId }, data: { creditBalance: { increment: creditAmount } } })
    : await tx.unit.findUnique({ where: { id: unitId } });
  await tx.notification.create({
    data: { userId: "admin1", message: `${unit ? unit.block + " D:" + unit.no : "Bir daire"} ödeme yaptı: ${amount}₺`, read: false, link: "#/tahsilat" },
  });
  await tx.activityLog.create({
    data: { actorId: userId || "sistem", actorName: userName || "Sistem", action: "payment.create", detail: `${unit ? `${unit.block} - Daire ${unit.no}` : "Bir daire"} için ${amount}₺ ödeme kaydedildi (${payment.method}, makbuz ${payment.receiptNo})${creditAmount.gt(0) ? `, ${creditAmount}₺ alacak bakiyesine eklendi` : ""}.`, scopeUnitId: unitId },
  });

  return payment;
}

// Cift-tiklama / ag tekrarindan kaynaklanan cift odeme sikayetlerine karsi:
// istemci her odeme denemesinde benzersiz bir requestId gonderir, ayni id
// ikinci kez islenmez (idempotency key deseni - PaymentRequest tablosunda unique
// constraint, mukerrer istek Prisma P2002 hatasiyla yakalanip 409 donduruluyor).
router.post("/payments/pay", requireAuth, async (req, res) => {
  const unitId = req.user.role === "sakin" ? req.user.unitId : req.body.unitId;
  const { amount, method, requestId, accountId, chargeIds } = req.body || {};
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
      return applyPayment(tx, { unitId, amount, method, userId: req.user.id, userName: req.user.name, accountId, chargeIds });
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

      // Bu odemenin katkisindan HALA havuzda duran kismini (creditRemaining)
      // geri duser - baska bir odemenin katkisina asla dokunmaz, cunku
      // creditRemaining bu odemeye ozel, ayri izlenen bir sayidir (havuzun
      // paylasilan toplami Unit.creditBalance degil). Eger bu odemenin
      // katkisi apply-credit ile zaten baska bir borca harcanmissa
      // (creditRemaining=0), geri alinacak bir sey yoktur - o borc uzerindeki
      // etki kalir, sadece bu odemenin kendisi "iptal" olarak isaretlenir.
      let creditReversed = new Prisma.Decimal(0);
      if (payment.creditRemaining && payment.creditRemaining.gt(0)) {
        creditReversed = payment.creditRemaining;
        await tx.unit.update({ where: { id: payment.unitId }, data: { creditBalance: { decrement: creditReversed } } });
        await tx.payment.update({ where: { id: payment.id }, data: { creditRemaining: 0 } });
      }

      const unit = await tx.unit.findUnique({ where: { id: payment.unitId } });
      const creditNote = payment.creditAmount && payment.creditAmount.gt(0) && creditReversed.lt(payment.creditAmount)
        ? ` (bu ödemenin oluşturduğu ${payment.creditAmount}₺ alacağın ${payment.creditAmount.minus(creditReversed)}₺'si zaten başka bir borca uygulanmış olduğu için geri alınamadı)`
        : "";
      await tx.activityLog.create({
        data: { actorId: req.user.id, actorName: req.user.name, action: "payment.cancel", detail: `${unit ? `${unit.block} - Daire ${unit.no}` : "Bir daire"} için ${payment.amount}₺ tutarındaki ödeme (makbuz ${payment.receiptNo}) iptal edildi${creditNote}.`, scopeUnitId: payment.unitId },
      });
    });
    res.json({ message: "Ödeme iptal edildi, ilgili borç yeniden açıldı." });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.msg });
    throw e;
  }
});

/* ---------------- ALACAKLI BAKİYE (Kredi) ---------------- */
// Yonetimcell karsilastirmasindan: fazla odeme otomatik olarak Unit.creditBalance'a
// eklenir (applyPayment icinde) ama hicbir borca OTOMATIK uygulanmaz - burada
// yonetici bilincli, tek tikla, ayni FIFO mantigiyla (en eski acik borctan
// baslayarak) krediyi borca aktarir. Her aktarim CreditApplication olarak
// izlenebilir sekilde kaydedilir.
// Havuzdan bir tutar "harcanirken" (borca uygulanirken), o tutarin hangi
// odeme(ler)in katkisindan geldigini de FIFO (en eski katki once) olarak
// isaretler - Payment.creditRemaining'i dusurur. Boylece bir odeme daha
// sonra iptal edildiginde SADECE kendi hala harcanmamis katkisi geri
// alinabilir, baska bir odemenin katkisina dokunulmaz.
async function consumeCreditFromPayments(tx, unitId, amount) {
  let toConsume = amount;
  const contributingPayments = await tx.payment.findMany({
    where: { unitId, cancelled: false, creditRemaining: { gt: 0 } },
    orderBy: { date: "asc" },
  });
  for (const p of contributingPayments) {
    if (toConsume.lte(0)) break;
    const take = Prisma.Decimal.min(p.creditRemaining, toConsume);
    await tx.payment.update({ where: { id: p.id }, data: { creditRemaining: p.creditRemaining.minus(take) } });
    toConsume = toConsume.minus(take);
  }
}

router.post("/units/:id/apply-credit", requireAuth, requireRole("yonetici"), async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const unit = await tx.unit.findUnique({ where: { id: req.params.id } });
      if (!unit) throw Object.assign(new Error("NOT_FOUND"), { httpStatus: 404, msg: "Daire bulunamadı." });
      if (unit.creditBalance.lte(0)) throw Object.assign(new Error("NO_CREDIT"), { httpStatus: 400, msg: "Bu dairenin uygulanabilir bir alacak bakiyesi yok." });

      let remaining = unit.creditBalance;
      const openCharges = await tx.charge.findMany({ where: { unitId: unit.id, status: { not: "paid" } }, orderBy: { dueDate: "asc" } });

      let totalApplied = new Prisma.Decimal(0);
      for (const c of openCharges) {
        if (remaining.lte(0)) break;
        const owed = c.amount.minus(c.paidAmount);
        const applied = Prisma.Decimal.min(owed, remaining);
        if (applied.lte(0)) continue;
        const newPaid = c.paidAmount.plus(applied);
        await tx.charge.update({ where: { id: c.id }, data: { paidAmount: newPaid, status: newPaid.gte(c.amount) ? "paid" : "partial" } });
        await tx.creditApplication.create({ data: { unitId: unit.id, chargeId: c.id, amount: applied, createdBy: req.user.id } });
        remaining = remaining.minus(applied);
        totalApplied = totalApplied.plus(applied);
      }

      if (totalApplied.lte(0)) throw Object.assign(new Error("NO_OPEN_CHARGE"), { httpStatus: 400, msg: "Bu dairenin krediyi uygulayabileceğiniz açık bir borcu yok." });

      await tx.unit.update({ where: { id: unit.id }, data: { creditBalance: { decrement: totalApplied } } });
      await consumeCreditFromPayments(tx, unit.id, totalApplied);
      await tx.activityLog.create({
        data: { actorId: req.user.id, actorName: req.user.name, action: "credit.apply", detail: `${unit.block} - Daire ${unit.no} için ${totalApplied}₺ alacak bakiyesi açık borca uygulandı.`, scopeUnitId: unit.id },
      });
      return totalApplied;
    });
    res.json({ message: `${result}₺ alacak bakiyesi borca uygulandı.` });
  } catch (e) {
    if (e.httpStatus) return res.status(e.httpStatus).json({ error: e.msg });
    throw e;
  }
});

// Hesap Ozeti ekstresinde odemelerle birlikte gosterebilmek icin.
router.get("/credit-applications", requireAuth, async (req, res) => {
  const unitFilter = req.query.unitId || scopedUnitId(req);
  const apps = await prisma.creditApplication.findMany({ where: unitFilter ? { unitId: unitFilter } : undefined, orderBy: { date: "desc" } });
  res.json(apps);
});

// Serbest kategori alani icin tutarlilik yardimcisi: mevcut kategorileri
// oneri listesi olarak dondurur (yeni kategori yazmak da serbest).
router.get("/charge-categories", requireAuth, requireRole("yonetici"), async (req, res) => {
  const rows = await prisma.charge.findMany({ distinct: ["type"], select: { type: true }, orderBy: { type: "asc" } });
  const defaults = ["aidat", "sayac", "diger", "gecikme_faizi"];
  const categories = [...new Set([...defaults, ...rows.map((r) => r.type)])];
  res.json(categories);
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

/* ---------------- TASINMAZ RAPORLARI (3 pivot: birim x ay, ay x kategori, birim x kategori) ---------------- */
// Yonetimcell karsilastirmasi: "Taşınmaz/Dönem Raporu", "Dönem/Detay Raporu",
// "Taşınmaz/Detay Raporu" - ayni Charge/Payment verisinin uc farkli pivotu.
// metric: "tahakkuk" (o donemde borclandirilan) | "tahsil" (o donemde tahsil
// edilen) | "net" (tahakkuk - tahsil, donem ici net hareket). Devreden sutunu
// secilen yildan ONCEKI tum hareketleri toplar.

const MONTH_NAMES = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const CHARGE_TYPE_LABEL = { aidat: "Aidat", sayac: "Sayaç", gecikme_faizi: "Gecikme Faizi", diger: "Diğer" };

async function loadTasinmazPivotContext(req) {
  const data = await db.load();
  const categories = await prisma.expenseCategory.findMany();
  const catById = new Map(categories.map((c) => [c.id, c]));
  const year = Number(req.query.year) || new Date().getFullYear();
  const block = req.query.block;
  const metric = ["tahakkuk", "tahsil", "net"].includes(req.query.metric) ? req.query.metric : "tahakkuk";

  let units = data.units;
  if (block) units = units.filter((u) => u.block === block);
  // "Uye" (kisi) bazli raporlar icin: Malikler/Kiraciler durum filtresi.
  // Yonetimcell'de eski malik/kiraci de cari olarak ayri tutuluyor - bizde
  // borc Unit'e bagli oldugundan (kisiye degil) o ayrimi yapamiyoruz, bu
  // yuzden sadece GUNCEL Malik/Kiraci filtrelenebiliyor (dogru olan budur,
  // uydurma bir "eski sakin borcu" verisi eklemiyoruz).
  if (req.query.durum === "malik") units = units.filter((u) => u.occupancy !== "tenant");
  else if (req.query.durum === "kiraci") units = units.filter((u) => u.occupancy === "tenant");
  const unitIds = new Set(units.map((u) => u.id));
  const charges = data.charges.filter((c) => unitIds.has(c.unitId));
  const chargeById = new Map(charges.map((c) => [c.id, c]));
  const payments = data.payments.filter((p) => !p.cancelled && unitIds.has(p.unitId));

  const catLabel = (c) => { const cat = catById.get(c.categoryId); return cat ? `${cat.group} / ${cat.name}` : (CHARGE_TYPE_LABEL[c.type] || c.type); };
  // -1 = donemden once (Devreden), 0-11 = ay, null = yil disinda (yok sayilir)
  const monthOf = (date) => { const d = new Date(date); if (d.getFullYear() < year) return -1; if (d.getFullYear() > year) return null; return d.getMonth(); };
  const unitById = new Map(units.map((u) => [u.id, u]));

  return { units, unitById, charges, chargeById, payments, year, block, metric, catLabel, monthOf };
}

// Genel amacli pivot olusturucu: rowKeyFn(charge)+colKeyFn(charge veya null=ay)
// ikilisine gore tahakkuk/tahsil toplar, secilen metrige gore tek deger dondurur.
function buildMatrix(ctx, rowKeyFn, colKeys, colOfFn) {
  const rows = new Map(); // rowKey -> { [colKey]: { tahakkuk, tahsil } }
  function cell(rowKey, colKey) {
    if (!rows.has(rowKey)) rows.set(rowKey, {});
    const row = rows.get(rowKey);
    if (!row[colKey]) row[colKey] = { tahakkuk: 0, tahsil: 0 };
    return row[colKey];
  }
  ctx.charges.forEach((c) => {
    const colKey = colOfFn(c);
    if (colKey === null || colKey === undefined) return;
    cell(rowKeyFn(c), colKey).tahakkuk += c.amount;
  });
  ctx.payments.forEach((p) => {
    (p.appliedTo || []).forEach((alloc) => {
      const c = ctx.chargeById.get(alloc.chargeId);
      if (!c) return;
      const pMonth = ctx.monthOf(p.date);
      // Tahsilat, odemenin kendi tarihine gore donem/aya yazilir (tahakkukun ayina degil).
      const colKey = colOfFn(c, pMonth);
      if (colKey === null || colKey === undefined) return;
      cell(rowKeyFn(c), colKey).tahsil += alloc.amount;
    });
  });
  const value = (v) => (ctx.metric === "tahakkuk" ? v.tahakkuk : ctx.metric === "tahsil" ? v.tahsil : v.tahakkuk - v.tahsil);
  return Array.from(rows.entries()).map(([rowKey, row]) => {
    const values = {};
    let total = 0;
    colKeys.forEach((k) => { const v = row[k] || { tahakkuk: 0, tahsil: 0 }; values[k] = value(v); total += values[k]; });
    return { row: rowKey, values, total };
  });
}

// 1) Taşınmaz/Dönem: satir=birim, sutun=Devreden+12 ay
router.get("/reports/tasinmaz-donem", requireAuth, requireRole("yonetici"), async (req, res) => {
  const ctx = await loadTasinmazPivotContext(req);
  const colKeys = ["devreden", ...MONTH_NAMES];
  const colOf = (charge, paymentMonth) => {
    const m = paymentMonth !== undefined ? paymentMonth : ctx.monthOf(charge.createdAt);
    if (m === null) return null;
    return m === -1 ? "devreden" : MONTH_NAMES[m];
  };
  const rows = buildMatrix(ctx, (c) => c.unitId, colKeys, colOf);
  const out = rows.map((r) => { const u = ctx.unitById.get(r.row); return { block: u?.block || "-", no: u?.no || "-", ...r.values, total: r.total }; })
    .sort((a, b) => a.block.localeCompare(b.block, "tr") || a.no.localeCompare(b.no, "tr", { numeric: true }));
  res.json({ columns: colKeys, rows: out });
});

// 2) Dönem/Detay: satir=Devreden+12 ay, sutun=gider kategorisi
router.get("/reports/donem-detay", requireAuth, requireRole("yonetici"), async (req, res) => {
  const ctx = await loadTasinmazPivotContext(req);
  const colKeys = Array.from(new Set(ctx.charges.map((c) => ctx.catLabel(c)))).sort((a, b) => a.localeCompare(b, "tr"));
  const rowOf = (charge, paymentMonth) => {
    const m = paymentMonth !== undefined ? paymentMonth : ctx.monthOf(charge.createdAt);
    if (m === null) return null;
    return m === -1 ? "devreden" : MONTH_NAMES[m];
  };
  // buildMatrix rowKeyFn tek parametre alir (charge) - burada donem bilgisini
  // colOfFn'e degil rowKeyFn'e tasimak icin ayri bir dongu yaziyoruz.
  const rowLabels = ["devreden", ...MONTH_NAMES];
  const rows = new Map();
  function cell(rowKey, colKey) { if (!rows.has(rowKey)) rows.set(rowKey, {}); const row = rows.get(rowKey); if (!row[colKey]) row[colKey] = { tahakkuk: 0, tahsil: 0 }; return row[colKey]; }
  ctx.charges.forEach((c) => { const rk = rowOf(c); if (rk === null) return; cell(rk, ctx.catLabel(c)).tahakkuk += c.amount; });
  ctx.payments.forEach((p) => (p.appliedTo || []).forEach((alloc) => {
    const c = ctx.chargeById.get(alloc.chargeId); if (!c) return;
    const rk = rowOf(c, ctx.monthOf(p.date)); if (rk === null) return;
    cell(rk, ctx.catLabel(c)).tahsil += alloc.amount;
  }));
  const value = (v) => (ctx.metric === "tahakkuk" ? v.tahakkuk : ctx.metric === "tahsil" ? v.tahsil : v.tahakkuk - v.tahsil);
  const out = rowLabels.map((rk) => {
    const row = rows.get(rk) || {};
    const values = {}; let total = 0;
    colKeys.forEach((k) => { const v = row[k] || { tahakkuk: 0, tahsil: 0 }; values[k] = value(v); total += values[k]; });
    return { period: rk === "devreden" ? "Devreden" : `${ctx.year} ${rk}`, ...values, total };
  });
  res.json({ columns: colKeys, rows: out });
});

// 3) Taşınmaz/Detay: tek bir ay+yil icin satir=birim, sutun=gider kategorisi
router.get("/reports/tasinmaz-detay", requireAuth, requireRole("yonetici"), async (req, res) => {
  const ctx = await loadTasinmazPivotContext(req);
  const month = req.query.month !== undefined && req.query.month !== "" ? Number(req.query.month) : null; // 0-11, bos ise TUM yil
  const colKeys = Array.from(new Set(ctx.charges.map((c) => ctx.catLabel(c)))).sort((a, b) => a.localeCompare(b, "tr"));
  const colOf = (charge, paymentMonth) => {
    const m = paymentMonth !== undefined ? paymentMonth : ctx.monthOf(charge.createdAt);
    if (m === null || m === -1) return null; // devreden bu raporda gosterilmiyor
    if (month !== null && m !== month) return null;
    return ctx.catLabel(charge);
  };
  const rows = buildMatrix(ctx, (c) => c.unitId, colKeys, colOf);
  const out = rows.map((r) => { const u = ctx.unitById.get(r.row); return { block: u?.block || "-", no: u?.no || "-", ...r.values, total: r.total }; })
    .sort((a, b) => a.block.localeCompare(b.block, "tr") || a.no.localeCompare(b.no, "tr", { numeric: true }));
  res.json({ columns: colKeys, rows: out });
});

// Kisi (uye/cari) adini dondurur - Unit'in guncel sorumlusu (malik oturuyorsa
// malik, kiraci oturuyorsa kiraci). Ayni kisi birden fazla tasinmaza sahipse
// (isim eslesmesiyle) satirlar burada birlesir - "kisi bazli" ile "taşınmaz
// bazli" raporlar arasindaki gercek fark budur.
function personOf(unit) {
  if (!unit) return null;
  const name = unit.occupancy === "tenant" ? unit.tenantName : unit.ownerName;
  return (name || "").trim() || null;
}

// 4) Üye/Dönem: satir=kisi (malik/kiraci), sutun=Devreden+12 ay
router.get("/reports/uye-donem", requireAuth, requireRole("yonetici"), async (req, res) => {
  const ctx = await loadTasinmazPivotContext(req);
  const colKeys = ["devreden", ...MONTH_NAMES];
  const colOf = (charge, paymentMonth) => {
    const m = paymentMonth !== undefined ? paymentMonth : ctx.monthOf(charge.createdAt);
    if (m === null) return null;
    return m === -1 ? "devreden" : MONTH_NAMES[m];
  };
  const rowKeyFn = (c) => personOf(ctx.unitById.get(c.unitId)) || "Bilinmeyen";
  const rows = buildMatrix(ctx, rowKeyFn, colKeys, colOf);
  const out = rows.filter((r) => r.row !== "Bilinmeyen" || r.total !== 0).map((r) => ({ name: r.row, ...r.values, total: r.total })).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  res.json({ columns: colKeys, rows: out });
});

// 5) Üye/Detay: tek bir ay+yil icin satir=kisi, sutun=gider kategorisi
router.get("/reports/uye-detay", requireAuth, requireRole("yonetici"), async (req, res) => {
  const ctx = await loadTasinmazPivotContext(req);
  const month = req.query.month !== undefined && req.query.month !== "" ? Number(req.query.month) : null;
  const colKeys = Array.from(new Set(ctx.charges.map((c) => ctx.catLabel(c)))).sort((a, b) => a.localeCompare(b, "tr"));
  const colOf = (charge, paymentMonth) => {
    const m = paymentMonth !== undefined ? paymentMonth : ctx.monthOf(charge.createdAt);
    if (m === null || m === -1) return null;
    if (month !== null && m !== month) return null;
    return ctx.catLabel(charge);
  };
  const rowKeyFn = (c) => personOf(ctx.unitById.get(c.unitId)) || "Bilinmeyen";
  const rows = buildMatrix(ctx, rowKeyFn, colKeys, colOf);
  const out = rows.filter((r) => r.row !== "Bilinmeyen" || r.total !== 0).map((r) => ({ name: r.row, ...r.values, total: r.total })).sort((a, b) => a.name.localeCompare(b.name, "tr"));
  res.json({ columns: colKeys, rows: out });
});

module.exports = router;
