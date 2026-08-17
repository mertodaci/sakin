// Ayni sitede birden fazla daireye sahip/erisen sakinler icin ortak yardimcilar.
// User.unitId "birincil" daire olarak kalir (JWT/kayit akislarinda hicbir
// degisiklik gerektirmez); UserUnit tablosu sadece EK daireleri tutar.

// Bir sakinin ERISEBILDIGI TUM daire id'lerini dondurur (birincil + ekler).
// user: req.user (JWT payload, .id ve .unitId alanlarina sahip) yeterlidir.
async function myUnitIds(prisma, user) {
  const extra = await prisma.userUnit.findMany({ where: { userId: user.id }, select: { unitId: true } });
  const ids = new Set(extra.map((e) => e.unitId));
  if (user.unitId) ids.add(user.unitId);
  return [...ids];
}

// Sakin rolu icin ?unitId= sorgu parametresini GUVENLI sekilde coze - eskiden
// dogrulanmadan kullanildigi icin bir sakin baskasinin unitId'sini vererek
// onun borc/odeme/vs. gecmisini gorebiliyordu (IDOR). Sonuc:
// { ok:false } -> caller 403 dondurmeli
// { ok:true, filter: undefined } -> yonetici, filtre yok (tum site)
// { ok:true, filter: "tek-id" }   -> tek bir daireye daraltilmis (yonetici serbest secim, sakin sadece kendi dairelerinden biri)
// { ok:true, filter: {in:[...]} } -> sakin icin varsayilan: TUM dairelerinin birlesik gorunumu
async function resolveUnitScope(prisma, req) {
  if (req.user.role !== "sakin") return { ok: true, filter: req.query.unitId || undefined };
  const mine = await myUnitIds(prisma, req.user);
  if (req.query.unitId) {
    if (!mine.includes(req.query.unitId)) return { ok: false };
    return { ok: true, filter: req.query.unitId };
  }
  return { ok: true, filter: { in: mine } };
}

// Bir sakin rolundeki kullanicinin, verilen unitId'ye (birincil VEYA ek
// olarak) gercekten erisip erismedigini dogrular - documents.js gibi tekil
// erisim kontrolu gereken uclarda kullanilir.
async function ownsUnit(prisma, user, unitId) {
  if (user.unitId === unitId) return true;
  const link = await prisma.userUnit.findUnique({ where: { userId_unitId: { userId: user.id, unitId } } });
  return !!link;
}

// Bir dairenin TUM sahiplerini/sakinlerini (birincil olarak bu daireyi
// gosterenler + UserUnit ile ek olarak baglananlar) dondurur - paket/otomatik
// borclandirma gibi "bu daireye bildirim gonder" senaryolarinda TEK bir
// prisma.user.findFirst({where:{unitId}}) yalnizca birincil sahibi bulurdu,
// ek daire sahiplerine bildirim hic gitmezdi.
async function findUnitResidents(prisma, unitId) {
  const [primary, extra] = await Promise.all([
    prisma.user.findMany({ where: { unitId } }),
    prisma.userUnit.findMany({ where: { unitId }, include: { user: true } }),
  ]);
  const byId = new Map(primary.map((u) => [u.id, u]));
  for (const e of extra) byId.set(e.user.id, e.user);
  return [...byId.values()];
}

module.exports = { myUnitIds, resolveUnitScope, ownsUnit, findUnitResidents };
