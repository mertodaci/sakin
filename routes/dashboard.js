const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { accountBalance } = require("./accounts");

const router = express.Router();

router.get("/dashboard", requireAuth, async (req, res) => {
  const data = await db.load();

  if (req.user.role === "sakin") {
    const unitId = req.user.unitId;
    const debt = data.charges.filter((c) => c.unitId === unitId && c.status !== "paid").reduce((s, c) => s + (c.amount - c.paidAmount), 0);
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
  const totalDebt = data.charges.filter((c) => c.status !== "paid").reduce((s, c) => s + (c.amount - c.paidAmount), 0);
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
    income,
    expense,
    openTickets,
    pendingApprovals,
    overdueEquipment,
    unreadNotifications: unread,
    unitCount: data.units.length,
    paidUnits: data.units.filter((u) => data.charges.filter((c) => c.unitId === u.id).every((c) => c.status === "paid")).length,
  });
});

module.exports = router;
