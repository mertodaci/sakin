// User modeli bilerek global (coklu-siteli personelin tek giris kimligi
// olmasi icin, bkz. lib/tenantScope.js) - yani prisma.user.findMany() TEK
// BASINA hicbir site filtresi UYGULAMAZ. UserSiteAccess uzerinden SADECE
// bu sitenin kullanicilarini doner - 2026-08-20'de bulunan gercek bir
// siteler-arasi veri sizintisinin (GET /users TUM platformu donuyordu,
// bkz. routes/directory.js) duzeltilmesiyle ortaya cikan, birden fazla
// route dosyasinin paylastigi ortak yardimci.
async function loadSiteUsers(prisma, siteId) {
  const access = await prisma.userSiteAccess.findMany({ where: { siteId }, include: { user: true } });
  return access.map((a) => a.user);
}

module.exports = { loadSiteUsers };
