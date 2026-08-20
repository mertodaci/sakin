// Unit tenant-scope'lu bir model (extension otomatik siteId filtreler) - bu
// yuzden units okumak icin ekstra bir scoping'e gerek yok. Bu yardimci,
// db.load()'un gereksiz 27 koleksiyon cekmesinden kacinmak icin sadece
// units+acik charges'i dogrudan cekip db.netDebt (ayni charges/units
// seklini bekleyen paylasilan fonksiyon) ile kullanilabilir kucuk bir
// "data" nesnesi olusturur - birden fazla route dosyasi (directory.js,
// comms.js) paylasir. Decimal alanlar (landShare/squareMeters/
// creditBalance/amount/paidAmount) acikca Number()'a cevriliyor - aksi
// halde JSON'a Decimal degil string olarak yazilirdi.
async function loadUnitsAndOpenCharges(prisma) {
  const [units, charges] = await Promise.all([
    prisma.unit.findMany({ orderBy: [{ block: "asc" }, { no: "asc" }] }),
    prisma.charge.findMany({ where: { status: { not: "paid" } }, select: { unitId: true, amount: true, paidAmount: true } }),
  ]);
  return {
    units: units.map((u) => ({
      ...u,
      landShare: u.landShare != null ? Number(u.landShare) : null,
      squareMeters: u.squareMeters != null ? Number(u.squareMeters) : null,
      creditBalance: Number(u.creditBalance),
    })),
    charges: charges.map((c) => ({ ...c, amount: Number(c.amount), paidAmount: Number(c.paidAmount) })),
  };
}

module.exports = { loadUnitsAndOpenCharges };
