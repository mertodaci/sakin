const express = require("express");
const db = require("../db");
const { requireAuth } = require("../middleware/auth");
const { accountBalance } = require("./accounts");
const { myUnitIds } = require("../lib/residentUnits");

const router = express.Router();
const prisma = db.prisma;

// Onceki halde db.load() TUM 27 legacy/passthrough koleksiyonu (siteId
// filtresiyle bile) her /dashboard istegi geldiginde cekiyordu - bu route
// bunlardan sadece 12'sini kullaniyordu. Yuk testinde (2026-08-20) bu,
// dashboard'un uygulamadaki en yavas uc olmasina yol aciyordu (bkz. proje
// notlari). Artik SADECE ihtiyac duyulan alanlar, `select` ile hafif
// sorgularla cekiliyor (orn. equipment icin bakim gecmisi, tickets icin
// yorumlar artik cekilmiyor). Decimal alanlar (amount/openingBalance/
// creditBalance) db.js'in eskiden yaptigi gibi acikca Number()'a
// cevriliyor - Prisma.Decimal nesneleri +/- operatorleriyle guvenilir
// calismaz (string donusumu uzerinden sessizce yanlis sonuc verebilir).
async function loadDashboardData() {
  const [charges, units, partyCharges, transactions, accounts, transfers, tickets, equipment, notifications, reservations, packages] = await Promise.all([
    prisma.charge.findMany({ select: { unitId: true, status: true, amount: true, paidAmount: true } }),
    prisma.unit.findMany({ select: { id: true, creditBalance: true } }),
    prisma.partyCharge.findMany({ select: { status: true, amount: true, paidAmount: true } }),
    prisma.transaction.findMany({ select: { type: true, amount: true, accountId: true, date: true } }),
    prisma.account.findMany({ select: { id: true, openingBalance: true } }),
    prisma.transfer.findMany({ select: { fromAccountId: true, toAccountId: true, amount: true } }),
    prisma.ticket.findMany({ select: { userId: true, status: true } }),
    prisma.equipment.findMany({ select: { lastMaintenanceDate: true, maintenancePeriodDays: true } }),
    prisma.notification.findMany({ select: { userId: true, read: true } }),
    prisma.reservation.findMany({ select: { userId: true, date: true } }),
    prisma.package.findMany({ select: { unitId: true, status: true } }),
  ]);
  return {
    charges: charges.map((c) => ({ ...c, amount: Number(c.amount), paidAmount: Number(c.paidAmount) })),
    units: units.map((u) => ({ ...u, creditBalance: Number(u.creditBalance) })),
    partyCharges: partyCharges.map((c) => ({ ...c, amount: Number(c.amount), paidAmount: Number(c.paidAmount) })),
    transactions: transactions.map((t) => ({ ...t, amount: Number(t.amount) })),
    accounts: accounts.map((a) => ({ ...a, openingBalance: Number(a.openingBalance) })),
    transfers: transfers.map((tr) => ({ ...tr, amount: Number(tr.amount) })),
    tickets,
    equipment,
    notifications,
    reservations,
    packages,
  };
}

// User modeli bilerek global (coklu-siteli personelin tek giris kimligi
// olmasi icin) - UserSiteAccess uzerinden SADECE bu sitenin onay bekleyen
// kayitlarini sayiyoruz. Eskiden data.users (loadUsers) TUM PLATFORMU
// donuyordu, yani coklu-siteli bir platform sahibi icin bu sayi yanlis
// olabilirdi (routes/help.js'teki ayni sinif duzeltmeyle tutarli, bkz.
// computePendingApprovals).
async function countPendingApprovals(siteId) {
  const access = await prisma.userSiteAccess.findMany({ where: { siteId }, include: { user: true } });
  return access.filter((a) => !a.user.isApproved).length;
}

router.get("/dashboard", requireAuth, async (req, res) => {
  const data = await loadDashboardData();

  if (req.user.role === "sakin") {
    // Coklu daireli bir sakin icin (orn. ayni sitede 2 evi olan) varsayilan
    // TUM dairelerinin BIRLESIMI - ?unitId= ile TEK bir daireye daraltilabilir
    // (finance.js'teki ayni desen, IDOR'a karsi kendi dairelerinden biri mi diye dogrulanir).
    const allUnitIds = await myUnitIds(db.prisma, req.user);
    let unitIds = allUnitIds;
    if (req.query.unitId) {
      if (!allUnitIds.includes(req.query.unitId)) return res.status(403).json({ error: "Bu daireye erişim yetkiniz yok." });
      unitIds = [req.query.unitId];
    }
    const debt = unitIds.reduce((sum, id) => sum + db.netDebt(data, id), 0);
    const myTickets = data.tickets.filter((t) => t.userId === req.user.id);
    const myReservations = data.reservations.filter((r) => r.userId === req.user.id && new Date(r.date) >= new Date());
    const unread = data.notifications.filter((n) => n.userId === req.user.id && !n.read).length;
    return res.json({
      debt,
      openTickets: myTickets.filter((t) => t.status !== "Çözüldü").length,
      upcomingReservations: myReservations.length,
      unreadNotifications: unread,
      pendingPackages: data.packages.filter((p) => unitIds.includes(p.unitId) && p.status === "Teslim Alındı").length,
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
  // Yonetimcell karsilastirmasi: "Genel Kasa Durumu"nda Alacaklar (uye
  // borclari) ile yan yana bir de toplam "Borclar" karti var - sitenin
  // firma/personel/genel gidere olan acik borcu (Borc Listesi'nin
  // topladigi PartyCharge'lar).
  const totalPayables = data.partyCharges.filter((c) => c.status !== "paid").reduce((s, c) => s + (c.amount - c.paidAmount), 0);
  const income = data.transactions.filter((t) => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
  const expense = data.transactions.filter((t) => t.type === "gider").reduce((s, t) => s + t.amount, 0);
  // Dashboard mini-grafik: son 6 ay gelir/gider. Yeni bir sorgu ACMIYOR -
  // yukarida income/expense toplami icin zaten cekilmis data.transactions
  // uzerinde bellekte kirilim yapiyor (Muhasebe ekranindaki ayni desen).
  const byMonth = {};
  data.transactions.forEach((t) => {
    const d = new Date(t.date);
    const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    if (!byMonth[sortKey]) byMonth[sortKey] = { label, gelir: 0, gider: 0 };
    byMonth[sortKey][t.type] += t.amount;
  });
  const monthlyFlow = Object.keys(byMonth).sort().slice(-6).map((k) => byMonth[k]);
  // Genel kasa durumu: tum hesaplarin (banka/nakit/pos) toplam bakiyesi (acilis bakiyeleri dahil)
  const kasa = data.accounts.reduce((s, a) => s + accountBalance(data, a.id), 0);
  const openTickets = data.tickets.filter((t) => t.status !== "Çözüldü").length;
  const pendingApprovals = await countPendingApprovals(req.user.siteId);
  const overdueEquipment = data.equipment.filter((e) => e.lastMaintenanceDate && Date.now() - new Date(e.lastMaintenanceDate).getTime() > e.maintenancePeriodDays * 86400000).length;
  const unread = data.notifications.filter((n) => n.userId === req.user.id && !n.read).length;

  res.json({
    kasa,
    totalDebt,
    totalCredit,
    totalPayables,
    income,
    expense,
    monthlyFlow,
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
