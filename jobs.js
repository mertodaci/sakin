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

  const charges = await prisma.charge.findMany({ where: { type: "aidat", status: { not: "paid" } } });
  for (const c of charges) {
    if ((c.lateFeeAppliedPeriods || []).includes(period)) continue;
    const dueTime = new Date(c.dueDate).getTime() + lateFeeGraceDays * 86400000;
    if (now <= dueTime) continue;

    const remaining = c.amount.minus(c.paidAmount);
    if (remaining.lte(0)) continue;
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

async function runMaintenanceTasks() {
  const settings = await prisma.settings.findUniqueOrThrow({ where: { id: "singleton" } });
  await applyLateFees(settings);
  await autoGenerateMonthlyDues(settings);
}

module.exports = { runMaintenanceTasks };
