// Tek seferlik demo-veri betigi: coklu-site ve coklu-daire (UserUnit)
// ozelliklerini test edebilmek icin gercekci test kullanicilari olusturur.
// Idempotent'tir - ikinci kez calistirmak hata vermez, eksik parcalari
// tamamlar. Kullanim: node scripts/seed-multisite-demo.js
const bcrypt = require("bcryptjs");
const prisma = require("../lib/prismaClient");
const tenantContext = require("../lib/tenantContext");

const SITE1_ADMIN_EMAIL = "yonetici@site.com";
const SITE2_NAME = "Palmiye Rezidans";
const SITE2_ADMIN_NAME = "Site Yöneticisi 2";
const SITE2_ADMIN_EMAIL = "yonetici2@site.com";
const SITE2_ADMIN_PASSWORD = "Site2Demo123!";

async function main() {
  // 1) Mevcut yoneticiyi platform sahibi yap - "Platform Yonetimi" menusunu
  // ve /owner/* uclarini test edebilsin (schema.prisma: User.isPlatformOwner).
  const owner = await prisma.user.update({
    where: { email: SITE1_ADMIN_EMAIL },
    data: { isPlatformOwner: true },
  });
  console.log(`isPlatformOwner=true: ${owner.email}`);

  // 2) Ikinci bir site + kendi yoneticisini olustur (routes/owner.js POST
  // /sites ile birebir ayni mantik) - yoksa.
  let site2 = await prisma.site.findFirst({ where: { name: SITE2_NAME } });
  let site2Admin = await prisma.user.findFirst({ where: { email: { equals: SITE2_ADMIN_EMAIL, mode: "insensitive" } } });
  if (!site2) {
    site2 = await prisma.site.create({ data: { name: SITE2_NAME, address: "Palmiye Mah. Yalı Cad. No:12, Antalya" } });
    console.log(`Yeni site olusturuldu: ${site2.name} (${site2.id})`);
  }
  if (!site2Admin) {
    site2Admin = await tenantContext.run(site2.id, () =>
      prisma.user.create({
        data: {
          name: SITE2_ADMIN_NAME,
          email: SITE2_ADMIN_EMAIL,
          phone: "0533 222 33 44",
          passwordHash: bcrypt.hashSync(SITE2_ADMIN_PASSWORD, 10),
          role: "yonetici",
          isApproved: true,
          mustChangePassword: false,
        },
      })
    );
    console.log(`Site2 admini olusturuldu: ${site2Admin.email} / ${SITE2_ADMIN_PASSWORD}`);
  }
  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: site2Admin.id, siteId: site2.id } },
    create: { userId: site2Admin.id, siteId: site2.id },
    update: {},
  });

  // Ikinci sitenin bos gorunmemesi icin birkac daire ekle (yoksa).
  const site2Units = await tenantContext.run(site2.id, () => prisma.unit.findMany());
  if (site2Units.length === 0) {
    await tenantContext.run(site2.id, () =>
      prisma.unit.create({ data: { block: "1. Blok", no: "1", floor: 1, ownerName: "Deniz Aydın", ownerPhone: "0532 555 11 22", tenantName: "", tenantPhone: "", occupancy: "owner" } })
    );
    await tenantContext.run(site2.id, () =>
      prisma.unit.create({ data: { block: "1. Blok", no: "2", floor: 1, ownerName: "Emre Kara", ownerPhone: "0532 555 33 44", tenantName: "", tenantPhone: "", occupancy: "owner" } })
    );
    console.log("Site2 icin 2 ornek daire eklendi.");
  }

  // 3) Mevcut yoneticiye (site1) IKINCI sitenin de erisimini ver - ayni
  // giris bilgisiyle "Site Degistir" akisini test edebilsin.
  await prisma.userSiteAccess.upsert({
    where: { userId_siteId: { userId: owner.id, siteId: site2.id } },
    create: { userId: owner.id, siteId: site2.id },
    update: {},
  });
  console.log(`${owner.email} artik "${site2.name}" sitesine de erisebiliyor (coklu-site giris testi icin).`);

  // 4) Coklu-daire testi: mevcut sakin Ayse Kaya'ya (res1, birincil dairesi
  // A Blok - Daire 4) AYNI sitede ikinci bir daire daha ver (UserUnit).
  // User modelinde siteId alani yok (kasitli - coklu-site personelin tek
  // kimligi olabilmesi icin) - siteId'yi UserSiteAccess uzerinden buluyoruz.
  const resident = await prisma.user.findFirst({ where: { email: "ayse@example.com" } });
  if (!resident) {
    console.log("ayse@example.com bulunamadi, coklu-daire adimi atlaniyor.");
  } else {
    const residentAccess = await prisma.userSiteAccess.findFirst({ where: { userId: resident.id } });
    const residentSiteId = residentAccess.siteId;
    const already = await tenantContext.run(residentSiteId, () => prisma.userUnit.findMany({ where: { userId: resident.id } }));
    if (already.length === 0) {
      const extraUnit = await tenantContext.run(residentSiteId, () =>
        prisma.unit.create({ data: { block: "D Blok", no: "3", floor: 2, ownerName: "Ayşe Kaya", ownerPhone: "0532 000 00 01", tenantName: "", tenantPhone: "", occupancy: "owner" } })
      );
      await tenantContext.run(residentSiteId, () => prisma.userUnit.create({ data: { userId: resident.id, unitId: extraUnit.id } }));
      console.log("ayse@example.com'a ikinci daire eklendi: D Blok - Daire 3 (çoklu-daire testi için).");
    } else {
      console.log("ayse@example.com zaten ek daireye sahip, atlaniyor.");
    }
  }

  // 5) Site2'ye gercek bir kasa + odenmis aidat borcu ekle (Charge+Payment+
  // Transaction+PaymentAllocation, prisma/seed.js ile ayni desen) - aksi
  // halde Muhasebe'de "toplam gelir 0" gorunuyor (hicbir borc/tahsilat yok,
  // sadece bos daireler) ve daire listesindeki "Ödendi" rozeti "borc yok"
  // ile "gercekten odendi"yi ayirt etmiyor - kafa karistiriyor.
  const site2Account = await tenantContext.run(site2.id, async () => {
    const existing = await prisma.account.findFirst({ where: { name: "Ana Banka Hesabı" } });
    if (existing) return existing;
    const acc = await prisma.account.create({
      data: { name: "Ana Banka Hesabı", type: "banka", bankName: "Örnek Banka", iban: "TR00 0000 0000 0000 0000 0000 00", openingBalance: 5000 },
    });
    console.log("Site2 icin banka hesabi olusturuldu.");
    return acc;
  });
  if (!site2.defaultAccountId) {
    await prisma.site.update({ where: { id: site2.id }, data: { defaultAccountId: site2Account.id } });
  }

  const site2Units2 = await tenantContext.run(site2.id, () => prisma.unit.findMany({ orderBy: { no: "asc" } }));
  const existingCharges = await tenantContext.run(site2.id, () => prisma.charge.findMany());
  if (existingCharges.length === 0) {
    const period = new Date().toISOString().slice(0, 7);
    const dueAmount = 450;
    for (const unit of site2Units2) {
      await tenantContext.run(site2.id, async () => {
        const charge = await prisma.charge.create({
          data: { unitId: unit.id, type: "aidat", period, amount: dueAmount, dueDate: new Date(), status: "paid", paidAmount: dueAmount, description: `${period} ayı aidatı` },
        });
        const transaction = await prisma.transaction.create({
          data: { type: "gelir", category: "Aidat Tahsilatı", amount: dueAmount, accountId: site2Account.id, date: new Date(), description: charge.description, createdBy: site2Admin.id },
        });
        const payment = await prisma.payment.create({
          data: { unitId: unit.id, amount: dueAmount, method: "Havale/EFT", accountId: site2Account.id, date: new Date(), note: charge.description, receiptNo: "MK-" + Math.floor(100000 + Math.random() * 899999), transactionId: transaction.id, cancelled: false },
        });
        await prisma.paymentAllocation.create({ data: { paymentId: payment.id, chargeId: charge.id, amount: dueAmount } });
      });
    }
    console.log(`Site2'nin ${site2Units2.length} dairesine ${period} donemi icin odenmis aidat (${dueAmount}₺) eklendi - Muhasebe'de gercek gelir gorunecek.`);
  }

  console.log("\nTest kullanicilari:");
  console.log(`  Coklu-site yonetici : ${SITE1_ADMIN_EMAIL} / Degistir123! (Platform Yonetimi + Site Degistir ile 2 siteyi de gorur)`);
  console.log(`  2. site yoneticisi  : ${SITE2_ADMIN_EMAIL} / ${SITE2_ADMIN_PASSWORD} (sadece "${SITE2_NAME}")`);
  console.log(`  Coklu-daire sakini  : ayse@example.com / demo1234 (A Blok-4 + D Blok-3, "Borç ve Ödemelerim" ekraninda ikisi birlikte)`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
