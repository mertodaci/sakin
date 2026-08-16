const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { accountBalance } = require("./accounts");

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  const data = await db.load();

  if (req.user.role === "sakin") {
    const unitId = req.user.unitId;
    const debt = db.netDebt(data, unitId);
    const myTickets = data.tickets.filter((t) => t.userId === req.user.id);
    const myReservations = data.reservations.filter((r) => r.userId === req.user.id && new Date(r.date) >= new Date());
    const unread = data.notifications.filter((n) => n.userId === req.user.id && !n.read).length;
    return res.json({
      debt,
      openTickets: myTickets.filter((t) => t.status !== "Çözüldü").length,
      upcomingReservations: myReservations.length,
      unreadNotifications: unread,
      pendingPackages: data.packages.filter((p) => p.unitId === unitId && p.status === "Teslim Alındı").length,
    });
  }

  // yonetici / personel
  // Alacak toplami: her dairenin net bakiyesi (acik borc - alacakli bakiye)
  // ayri hesaplanip sadece pozitif (gercekten borclu) olanlar toplanir - bir
  // dairenin alacakli bakiyesi baska bir dairenin borcunu "kapatmaz". Tek
  // gecisli (O(units+charges)) hesaplaniyor - her daire icin ayri ayri tum
  // charges dizisini taramak yerine.
  const openSumByUnit = new Map();
  data.charges.forEach((c) => {
    if (c.status === "paid") return;
    openSumByUnit.set(c.unitId, (openSumByUnit.get(c.unitId) || 0) + (c.amount - c.paidAmount));
  });
  const unitNetDebts = data.units.map((u) => (openSumByUnit.get(u.id) || 0) - (u.creditBalance || 0));
  const totalDebt = unitNetDebts.reduce((s, d) => s + Math.max(0, d), 0);
  const totalCredit = unitNetDebts.reduce((s, d) => s + Math.max(0, -d), 0);
  const income = data.transactions.filter((t) => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
  const expense = data.transactions.filter((t) => t.type === "gider").reduce((s, t) => s + t.amount, 0);
  // Genel kasa durumu: tum hesaplarin (banka/nakit/pos) toplam bakiyesi (acilis bakiyeleri dahil)
  const kasa = data.accounts.reduce((s, a) => s + accountBalance(data, a.id), 0);
  const openTickets = data.tickets.filter((t) => t.status !== "Çözüldü").length;
  const pendingApprovals = data.users.filter((u) => !u.isApproved).length;
  const overdueEquipment = data.equipment.filter((e) => e.lastMaintenanceDate && Date.now() - new Date(e.lastMaintenanceDate).getTime() > e.maintenancePeriodDays * 86400000).length;
  const unread = data.notifications.filter((n) => n.userId === req.user.id && !n.read).length;

  res.json({
    kasa,
    totalDebt,
    totalCredit,
    income,
    expense,
    openTickets,
    pendingApprovals,
    overdueEquipment,
    unreadNotifications: unread,
    unitCount: data.units.length,
    // "Odendi" sayisi artik net bakiyeye gore (acik borc, varsa alacakli
    // bakiyeyle karsilanmis olabilir) - tek tek her Charge satirinin
    // status'una degil, boylece bu sayi totalDebt/totalCredit ile tutarli.
    paidUnits: unitNetDebts.filter((d) => d <= 0).length,
  });
});

module.exports = router;
