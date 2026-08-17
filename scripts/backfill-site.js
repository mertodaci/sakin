// Tek seferlik script (Coklu-kiracili donusum, Asama 2): mevcut TEK Settings
// satirindan bir Site olusturur, tum kiracili tablolardaki NULL siteId'leri
// bu Site'in id'sine yazar, her User icin bir UserSiteAccess satiri acar.
// Sonra siteId sutunlari NOT NULL yapilabilir (bkz. bu script'in cagirdigi
// dogrulama ciktisi: hepsi 0 olmali).
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

// Prisma client property adlari (camelCase) - schema.prisma'daki 48 kiracili
// modelin tam listesi (User/Site/UserSiteAccess/PaymentRequest disinda hepsi).
const TENANT_MODELS = [
  "unit", "householdMember", "userNote", "legalCase", "vehicle", "account", "transfer", "charge", "payment",
  "creditApplication", "paymentAllocation", "transaction", "budget", "vendor", "expenseCategory", "expenseProject",
  "recurringPartyCharge", "partyCharge", "partyPayment", "partyPaymentAllocation", "personnel", "equipment",
  "maintenanceRecord", "meter", "meterReading", "package", "decision", "key", "keyAssignment", "announcement",
  "survey", "surveyOption", "surveyVote", "facility", "reservation", "ticket", "ticketComment", "classifieds",
  "notification", "activityLog", "contact", "officialReport", "agendaItem", "internalTask", "message",
  "archiveFolder", "archiveFile", "knowledgeArticle",
];

async function main() {
  let site = await prisma.site.findFirst();
  if (!site) {
    const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
    if (!settings) throw new Error("Settings singleton bulunamadi - once seed calistirilmali.");
    site = await prisma.site.create({
      data: {
        name: settings.buildingName,
        address: settings.address,
        monthlyDueDefault: settings.monthlyDueDefault,
        lateFeeRate: settings.lateFeeRate,
        lateFeeGraceDays: settings.lateFeeGraceDays,
        autoDueEnabled: settings.autoDueEnabled,
        autoDueDay: settings.autoDueDay,
        autoDueAmount: settings.autoDueAmount,
        lastAutoDuePeriod: settings.lastAutoDuePeriod,
        ticketCategories: settings.ticketCategories,
        defaultAccountId: settings.defaultAccountId,
      },
    });
    console.log(`Site olusturuldu: ${site.id} (${site.name})`);
  } else {
    console.log(`Mevcut Site kullaniliyor: ${site.id} (${site.name})`);
  }

  for (const model of TENANT_MODELS) {
    const result = await prisma[model].updateMany({ where: { siteId: null }, data: { siteId: site.id } });
    if (result.count > 0) console.log(`  ${model}: ${result.count} satir guncellendi`);
  }

  const users = await prisma.user.findMany({ select: { id: true } });
  let accessCreated = 0;
  for (const u of users) {
    const existing = await prisma.userSiteAccess.findUnique({ where: { userId_siteId: { userId: u.id, siteId: site.id } } });
    if (!existing) {
      await prisma.userSiteAccess.create({ data: { userId: u.id, siteId: site.id } });
      accessCreated++;
    }
  }
  console.log(`UserSiteAccess: ${accessCreated} yeni satir olusturuldu (${users.length} kullanicidan).`);

  console.log("\n=== Dogrulama: her tabloda siteId IS NULL sayisi (hepsi 0 olmali) ===");
  for (const model of TENANT_MODELS) {
    const nullCount = await prisma[model].count({ where: { siteId: null } });
    if (nullCount > 0) console.log(`  ⚠️  ${model}: ${nullCount} satir hala NULL!`);
  }
  console.log("Bitti.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
