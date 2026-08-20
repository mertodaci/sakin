const { Prisma } = require("@prisma/client");
const db = require("./db");
const tenantContext = require("./lib/tenantContext");
const { findUnitResidents } = require("./lib/residentUnits");

const prisma = db.prisma;

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Gecikme faizi: son odeme tarihinin uzerinden (tolerans suresi + 1 ay) gectikce,
// her takvim ayinda BIR KEZ, kalan borcun uzerine belirlenen yuzde kadar ek
// borclandirma satiri eklenir. Ayni donem icin ikinci kez uygulanmaz (lateFeeAppliedPeriods).
// Tum okuma+kontrol+yazma islemi tek $transaction icinde - runMaintenanceTasks
// ileride eszamanli iki kez tetiklenirse (orn. sunucu yeniden baslatma 6 saatlik
// setInterval ile cakisirsa) yari-tamamlanmis bir durumda kalinmaz.
async function applyLateFees(site) {
  const { lateFeeRate, lateFeeGraceDays } = site;
  if (!lateFeeRate || lateFeeRate.lte(0)) return 0;
  const now = Date.now();
  const period = currentPeriod();

  return prisma.$transaction(async (tx) => {
    let applied = 0;
    const charges = await tx.charge.findMany({ where: { type: "aidat", status: { not: "paid" } }, orderBy: { dueDate: "asc" } });

    // Dairenin uygulanmamis alacak bakiyesi bir borcu karsiliyorsa gecikme faizi
    // uygulanmaz (yonetici henuz "krediyi borca uygula" dememis olsa da, para
    // zaten sitede duruyor). Butun daireleri tek seferde onceden cekip, bu
    // calisma icinde "hala iddia edilebilir" kredi miktarini burada azaltarak
    // takip ediyoruz - aksi halde ayni kredi, o dairenin birden fazla acik
    // borcunu ayni anda "karsiliyor" sanilip hepsinde faiz atlanabilirdi.
    const unitIds = [...new Set(charges.map((c) => c.unitId))];
    const units = await tx.unit.findMany({ where: { id: { in: unitIds } } });
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

      await tx.charge.create({
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
      await tx.charge.update({ where: { id: c.id }, data: { lateFeeAppliedPeriods: { push: period } } });
      applied++;
    }

    if (applied > 0) {
      await tx.activityLog.create({ data: { actorId: "sistem", actorName: "Otomatik Sistem", action: "latefee.apply", detail: `${applied} daireye gecikme faizi uygulandı (%${lateFeeRate}).` } });
    }
    return applied;
  }, { timeout: 30000 });
}

// Otomatik aylik aidat borclandirma: ayarlanan gunde, o donem icin daha once
// borc olusturulmadiysa tum dairelere otomatik uygulanir. lastAutoDuePeriod
// kontrolu + guncellemesi ARTIK AYNI transaction icinde - eskiden guncelleme
// dongunun sonunda ayri bir cagriyla yapiliyordu, eszamanli iki calisma ayni
// "henuz islenmedi" kontrolunden ikisi de gecebilirdi.
async function autoGenerateMonthlyDues(site) {
  const { autoDueEnabled, autoDueDay, autoDueAmount, lastAutoDuePeriod } = site;
  if (!autoDueEnabled) return 0;
  const now = new Date();
  const period = currentPeriod();
  if (now.getDate() < autoDueDay) return 0;
  if (lastAutoDuePeriod === period) return 0;

  return prisma.$transaction(async (tx) => {
    // Ayni transaction icinde tekrar kontrol et - bu fonksiyon cagrilirken
    // kullanilan `site` disaridan (runMaintenanceTasks'ta) tek seferlik
    // okunmustu, baska bir eszamanli calisma arada guncellemis olabilir.
    const fresh = await tx.site.findUniqueOrThrow({ where: { id: site.id } });
    if (fresh.lastAutoDuePeriod === period) return 0;

    const units = await tx.unit.findMany();
    const existing = await tx.charge.findMany({ where: { type: "aidat", period }, select: { unitId: true } });
    const existingUnitIds = new Set(existing.map((c) => c.unitId));
    const toCreate = units.filter((u) => !existingUnitIds.has(u.id));

    let created = 0;
    for (const u of toCreate) {
      await tx.charge.create({
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
      // findFirst({where:{unitId}}) sadece BIRINCIL sahibi bulurdu - coklu
      // daireli bir sakinin EK dairesine (UserUnit) borc eklenince hic
      // bildirim gitmezdi.
      const residents = await findUnitResidents(tx, u.id);
      for (const r of residents) {
        await tx.notification.create({ data: { userId: r.id, message: `${period} ayı aidatınız (${autoDueAmount}₺) borcunuza eklendi.`, read: false, link: "#/aidat" } });
      }
      created++;
    }

    await tx.site.update({ where: { id: site.id }, data: { lastAutoDuePeriod: period } });

    if (created > 0) {
      await tx.activityLog.create({ data: { actorId: "sistem", actorName: "Otomatik Sistem", action: "charge.autogenerate", detail: `${period} dönemi aidat borcu ${created} daireye otomatik uygulandı.` } });
    }
    return created;
  }, { timeout: 30000 });
}

// Tekrarlayan/ileri tarihli fatura sablonlarini (RecurringPartyCharge)
// vadesi gelince gercek bir PartyCharge'a cevirir (Yonetimcell'in "Ileri
// Tarihli Borc Listesi"nin gercek karsiligi). PartyCharge artik dogrudan
// Prisma'da yasiyor (parties.js gibi) - her sablon icin olusturma + sablonun
// nextDate/active guncellemesi tek $transaction icinde yapilir.
async function materializeRecurringPartyCharges() {
  const now = new Date();
  const due = await prisma.recurringPartyCharge.findMany({ where: { active: true, nextDate: { lte: now } } });
  if (due.length === 0) return 0;

  let created = 0;
  for (const r of due) {
    const isLastOccurrence = r.frequency === "once";
    let next = null;
    if (!isLastOccurrence) {
      next = new Date(r.nextDate);
      if (r.frequency === "yearly") next.setFullYear(next.getFullYear() + 1);
      else next.setMonth(next.getMonth() + 1);
    }

    const claimed = await prisma.$transaction(async (tx) => {
      // Optimistik kilit: WHERE'e eski nextDate degerini de ekleyerek
      // guncelliyoruz - baska bir process/worker (orn. PM2 cluster'da paralel
      // calisan bir baska instance) bu satiri araya girip zaten islediyse
      // nextDate artik farkli olur, updateMany 0 satir eslestirir ve bu
      // sablonu atlariz. Eskiden bu kontrol yoktu: findMany() ile once TUM
      // vadesi gelenler okunuyordu, sonra her biri ayri ayri islenirken iki
      // paralel calisma ayni sablonu ayni anda "vadesi gelmis" gorup IKI KEZ
      // gercek borca cevirebilirdi (mukerrer fatura riski).
      const result = await tx.recurringPartyCharge.updateMany({
        where: { id: r.id, active: true, nextDate: r.nextDate },
        data: isLastOccurrence ? { active: false } : { nextDate: next },
      });
      if (result.count === 0) return false;

      await tx.partyCharge.create({
        data: {
          partyType: r.partyType,
          partyId: r.partyId,
          categoryId: r.categoryId,
          amount: r.amount,
          status: "unpaid",
          description: r.description,
          invoiceNo: "FT-" + Math.floor(100000 + Math.random() * 899999),
          date: now,
          dueDate: r.nextDate,
          createdBy: r.createdBy,
        },
      });
      return true;
    });
    if (claimed) created++;
  }

  if (created > 0) {
    await prisma.activityLog.create({ data: { actorId: "sistem", actorName: "Otomatik Sistem", action: "recurring.materialize", detail: `${created} tekrarlayan/ileri tarihli fatura gerçek borca çevrildi.` } });
  }
  return created;
}

async function runMaintenanceTasksForSite(site) {
  await applyLateFees(site);
  await autoGenerateMonthlyDues(site);
  await materializeRecurringPartyCharges();
}

// Her site kendi gecikme faizi/otomatik borclandirma/tekrarlayan fatura
// ayarlarina (Site satirinin kendi lateFeeRate/autoDueEnabled/... alanlari)
// gore, kendi tenant baglaminda calisir - bir sitenin ayari baskasini etkilemez.
async function runMaintenanceTasks() {
  const sites = await prisma.site.findMany();
  for (const site of sites) {
    await tenantContext.run(site.id, () => runMaintenanceTasksForSite(site));
  }
}

module.exports = { runMaintenanceTasks, materializeRecurringPartyCharges, applyLateFees, autoGenerateMonthlyDues };
