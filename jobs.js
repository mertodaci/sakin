const db = require("./db");

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Gecikme faizi: son odeme tarihinin uzerinden (tolerans suresi + 1 ay) gectikce,
// her takvim ayinda BIR KEZ, kalan borcun uzerine belirlenen yuzde kadar ek
// borclandirma satiri eklenir. Ayni donem icin ikinci kez uygulanmaz (lateFeeAppliedPeriods).
function applyLateFees(data) {
  const { lateFeeRate, lateFeeGraceDays } = data.meta;
  if (!lateFeeRate || lateFeeRate <= 0) return 0;
  const now = Date.now();
  const period = currentPeriod();
  let applied = 0;

  data.charges.filter((c) => c.type === "aidat" && c.status !== "paid").forEach((c) => {
    if (!c.lateFeeAppliedPeriods) c.lateFeeAppliedPeriods = [];
    if (c.lateFeeAppliedPeriods.includes(period)) return;
    const dueTime = new Date(c.dueDate).getTime() + lateFeeGraceDays * 86400000;
    if (now <= dueTime) return;

    const remaining = c.amount - c.paidAmount;
    if (remaining <= 0) return;
    const feeAmount = Math.round(remaining * (lateFeeRate / 100) * 100) / 100;
    if (feeAmount <= 0) return;

    data.charges.push({
      id: db.uid(),
      unitId: c.unitId,
      type: "gecikme_faizi",
      period,
      amount: feeAmount,
      dueDate: new Date().toISOString(),
      status: "unpaid",
      paidAmount: 0,
      lateFeeAppliedPeriods: [],
      description: `${c.period} dönemi gecikmiş aidat için %${lateFeeRate} gecikme faizi`,
      createdAt: new Date().toISOString(),
    });
    c.lateFeeAppliedPeriods.push(period);
    applied++;
  });

  if (applied > 0) {
    db.logActivity(data, { id: "sistem", name: "Otomatik Sistem" }, "latefee.apply", `${applied} daireye gecikme faizi uygulandı (%${lateFeeRate}).`, null);
  }
  return applied;
}

// Otomatik aylik aidat borclandirma: ayarlanan gunde, o donem icin daha once
// borc olusturulmadiysa tum dairelere otomatik uygulanir.
function autoGenerateMonthlyDues(data) {
  const { autoDueEnabled, autoDueDay, autoDueAmount, lastAutoDuePeriod } = data.meta;
  if (!autoDueEnabled) return 0;
  const now = new Date();
  const period = currentPeriod();
  if (now.getDate() < autoDueDay) return 0;
  if (lastAutoDuePeriod === period) return 0;

  let created = 0;
  data.units.forEach((u) => {
    const exists = data.charges.some((c) => c.unitId === u.id && c.type === "aidat" && c.period === period);
    if (exists) return;
    data.charges.push({
      id: db.uid(),
      unitId: u.id,
      type: "aidat",
      period,
      amount: Number(autoDueAmount),
      dueDate: new Date().toISOString(),
      status: "unpaid",
      paidAmount: 0,
      lateFeeAppliedPeriods: [],
      description: `${period} ayı aidatı (otomatik borçlandırma)`,
      createdAt: new Date().toISOString(),
    });
    const owner = data.users.find((x) => x.unitId === u.id);
    if (owner) data.notifications.push({ id: db.uid(), userId: owner.id, message: `${period} ayı aidatınız (${autoDueAmount}₺) borcunuza eklendi.`, read: false, date: new Date().toISOString(), link: "#/aidat" });
    created++;
  });
  data.meta.lastAutoDuePeriod = period;

  if (created > 0) {
    db.logActivity(data, { id: "sistem", name: "Otomatik Sistem" }, "charge.autogenerate", `${period} dönemi aidat borcu ${created} daireye otomatik uygulandı.`, null);
  }
  return created;
}

function runMaintenanceTasks() {
  const data = db.load();
  const feesApplied = applyLateFees(data);
  const duesCreated = autoGenerateMonthlyDues(data);
  if (feesApplied > 0 || duesCreated > 0) db.save();
}

module.exports = { runMaintenanceTasks, applyLateFees, autoGenerateMonthlyDues };
