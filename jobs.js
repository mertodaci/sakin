const { Prisma } = require("@prisma/client");
const db = require("./db");

const prisma = db.prisma;

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Gecikme faizi: son odeme tarihinin uzerinden (tolerans suresi + 1 ay) gectikce,
// her takvim ayinda BIR KEZ, kalan borcun uzerine belirlenen yuzde kadar ek
// borclandirma satiri eklenir. Ayni donem icin ikinci kez uygulanmaz (lateFeeAppliedPeriods).
async function applyLateFees(settings) {
  const { lateFeeRate, lateFeeGraceDays } = settings;
  if (!lateFeeRate || lateFeeRate.lte(0)) return 0;
  const now = Date.now();
  const period = currentPeriod();
  let applied = 0;

  const charges = await prisma.charge.findMany({ where: { type: "aidat", status: { not: "paid" } }, orderBy: { dueDate: "asc" } });

  // Dairenin uygulanmamis alacak bakiyesi bir borcu karsiliyorsa gecikme faizi
  // uygulanmaz (yonetici henuz "krediyi borca uygula" dememis olsa da, para
  // zaten sitede duruyor). Butun daireleri tek seferde onceden cekip, bu
  // calisma icinde "hala iddia edilebilir" kredi miktarini burada azaltarak
  // takip ediyoruz - aksi halde ayni kredi, o dairenin birden fazla acik
  // borcunu ayni anda "karsiliyor" sanilip hepsinde faiz atlanabilirdi.
  const unitIds = [...new Set(charges.map((c) => c.unitId))];
  const units = await prisma.unit.findMany({ where: { id: { in: unitIds } } });
  const remainingCreditByUnit = new Map(units.map((u) => [u.id, u.creditBalance]));

  for (const c of charges) {
    if ((c.lateFeeAppliedPeriods || []).includes(period)) continue;
    const dueTime = new Date(c.dueDate).getTime() + lateFeeGraceDays * 86400000;
    if (now <= dueTime) continue;

    const remaining = c.amount.minus(c.paidAmount);
    if (remaining.lte(0)) continue;

    const availableCredit = remainingCreditByUnit.get(c.unitId) || new Prisma.Decimal(0);
    if (availableCredit.gte(remaining)) {
      remainingCreditByUnit.set(c.unitId, availableCredit.minus(remaining));
      continue;
    }

    const feeAmount = remaining.times(lateFeeRate).dividedBy(100).toDecimalPlaces(2);
    if (feeAmount.lte(0)) continue;

    await prisma.charge.create({
      data: {
        unitId: c.unitId,
        type: "gecikme_faizi",
        period,
        amount: feeAmount,
        dueDate: new Date(),
        status: "unpaid",
        paidAmount: 0,
        lateFeeAppliedPeriods: [],
        description: `${c.period} dönemi gecikmiş aidat için %${lateFeeRate} gecikme faizi`,
      },
    });
    await prisma.charge.update({ where: { id: c.id }, data: { lateFeeAppliedPeriods: { push: period } } });
    applied++;
  }

  if (applied > 0) {
    await prisma.activityLog.create({ data: { actorId: "sistem", actorName: "Otomatik Sistem", action: "latefee.apply", detail: `${applied} daireye gecikme faizi uygulandı (%${lateFeeRate}).` } });
  }
  return applied;
}

// Otomatik aylik aidat borclandirma: ayarlanan gunde, o donem icin daha once
// borc olusturulmadiysa tum dairelere otomatik uygulanir.
async function autoGenerateMonthlyDues(settings) {
  const { autoDueEnabled, autoDueDay, autoDueAmount, lastAutoDuePeriod } = settings;
  if (!autoDueEnabled) return 0;
  const now = new Date();
  const period = currentPeriod();
  if (now.getDate() < autoDueDay) return 0;
  if (lastAutoDuePeriod === period) return 0;

  const units = await prisma.unit.findMany();
  const existing = await prisma.charge.findMany({ where: { type: "aidat", period }, select: { unitId: true } });
  const existingUnitIds = new Set(existing.map((c) => c.unitId));
  const toCreate = units.filter((u) => !existingUnitIds.has(u.id));

  let created = 0;
  for (const u of toCreate) {
    await prisma.charge.create({
      data: {
        unitId: u.id,
        type: "aidat",
        period,
        amount: new Prisma.Decimal(autoDueAmount),
        dueDate: new Date(),
        status: "unpaid",
        paidAmount: 0,
        lateFeeAppliedPeriods: [],
        description: `${period} ayı aidatı (otomatik borçlandırma)`,
      },
    });
    const owner = await prisma.user.findFirst({ where: { unitId: u.id } });
    if (owner) {
      await prisma.notification.create({ data: { userId: owner.id, message: `${period} ayı aidatınız (${autoDueAmount}₺) borcunuza eklendi.`, read: false, link: "#/aidat" } });
    }
    created++;
  }

  await prisma.settings.update({ where: { id: "singleton" }, data: { lastAutoDuePeriod: period } });

  if (created > 0) {
    await prisma.activityLog.create({ data: { actorId: "sistem", actorName: "Otomatik Sistem", action: "charge.autogenerate", detail: `${period} dönemi aidat borcu ${created} daireye otomatik uygulandı.` } });
  }
  return created;
}

// Tekrarlayan/ileri tarihli fatura sablonlarini (RecurringPartyCharge)
// vadesi gelince gercek bir PartyCharge'a cevirir (Yonetimcell'in "Ileri
// Tarihli Borc Listesi"nin gercek karsiligi). PartyCharge hala legacy shim
// uzerinden (db.load/db.save) yaziliyor - dogrudan prisma.partyCharge.create
// KULLANILMAZ, cunku baska bir istek ayni anda db.load() yapip daha sonra
// db.save() cagirirsa, save() o istegin eski snapshot'inda olmayan (bizim
// burada dogrudan Prisma ile eklediğimiz) satiri "artik dizide yok" sanip
// silerdi (bkz. db.js saveCollection - notIn ids -> deleteMany).
async function materializeRecurringPartyCharges() {
  const now = new Date();
  const due = await prisma.recurringPartyCharge.findMany({ where: { active: true, nextDate: { lte: now } } });
  if (due.length === 0) return 0;

  const data = await db.load();
  let created = 0;
  for (const r of due) {
    data.partyCharges.push({
      id: db.uid(),
      partyType: r.partyType,
      partyId: r.partyId,
      categoryId: r.categoryId,
      amount: r.amount.toNumber(),
      paidAmount: 0,
      status: "unpaid",
      description: r.description,
      invoiceNo: "FT-" + Math.floor(100000 + Math.random() * 899999),
      date: now.toISOString(),
      dueDate: r.nextDate.toISOString(),
      createdBy: r.createdBy,
    });
    created++;

    if (r.frequency === "once") {
      await prisma.recurringPartyCharge.update({ where: { id: r.id }, data: { active: false } });
    } else {
      const next = new Date(r.nextDate);
      if (r.frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
      else next.setMonth(next.getMonth() + 1);
      await prisma.recurringPartyCharge.update({ where: { id: r.id }, data: { nextDate: next } });
    }
  }

  db.logActivity(data, null, "recurring.materialize", `${created} tekrarlayan/ileri tarihli fatura gerçek borca çevrildi.`, null);
  await db.save(data);
  return created;
}

async function runMaintenanceTasks() {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: "singleton" } });
  await applyLateFees(settings);
  await autoGenerateMonthlyDues(settings);
  await materializeRecurringPartyCharges();
}

module.exports = { runMaintenanceTasks, materializeRecurringPartyCharges };
