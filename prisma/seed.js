// buildSeed() (eski db.js) ile ayni demo veriyi Postgres'e yazar.
// Amac: gecis sonrasi da ayni demo giris/veri deneyimi sunmak.
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

const prisma = new PrismaClient();

function uid() {
  return randomUUID();
}

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function monthsAgoPeriod(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || "yonetici@site.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "Degistir123!";
  const DUE_AMOUNT = 450;

  await prisma.$transaction(
    async (tx) => {
      // ---- Daireler ----
      const units = [
        { id: "u1", block: "A Blok", no: "4", floor: 1, ownerName: "Ayşe Kaya", ownerPhone: "0532 000 00 01", tenantName: "", tenantPhone: "", occupancy: "owner" },
        { id: "u2", block: "A Blok", no: "7", floor: 2, ownerName: "Mehmet Demir", ownerPhone: "0532 000 00 02", tenantName: "", tenantPhone: "", occupancy: "owner" },
        { id: "u3", block: "B Blok", no: "2", floor: 1, ownerName: "Fatma Şahin", ownerPhone: "0532 000 00 03", tenantName: "Elif Şahin", tenantPhone: "0532 000 00 13", occupancy: "tenant" },
        { id: "u4", block: "B Blok", no: "9", floor: 3, ownerName: "Can Yıldız", ownerPhone: "0532 000 00 04", tenantName: "", tenantPhone: "", occupancy: "owner" },
        { id: "u5", block: "C Blok", no: "1", floor: 1, ownerName: "Zeynep Arslan", ownerPhone: "0532 000 00 05", tenantName: "", tenantPhone: "", occupancy: "owner" },
        { id: "u6", block: "A Blok", no: "2", floor: 1, ownerName: "Burak Öz", ownerPhone: "0532 000 00 06", tenantName: "", tenantPhone: "", occupancy: "owner" },
      ];
      for (const u of units) await tx.unit.create({ data: u });

      // ---- Kasalar ----
      const accounts = [
        { id: "acc-banka", name: "Ana Banka Hesabı", type: "banka", bankName: "Örnek Banka", iban: "TR00 0000 0000 0000 0000 0000 00", openingBalance: 15000, createdAt: isoDaysAgo(300) },
        { id: "acc-nakit", name: "Nakit Kasa", type: "nakit", bankName: "", iban: "", openingBalance: 2000, createdAt: isoDaysAgo(300) },
        { id: "acc-pos", name: "POS / Kredi Kartı Tahsilatı", type: "pos", bankName: "", iban: "", openingBalance: 0, createdAt: isoDaysAgo(300) },
      ];
      for (const a of accounts) await tx.account.create({ data: a });
      const DEFAULT_ACCOUNT_ID = "acc-banka";

      // ---- Kullanicilar ----
      const users = [
        { id: "admin1", name: "Site Yöneticisi", email: adminEmail, phone: "0532 000 00 00", passwordHash: bcrypt.hashSync(adminPassword, 10), role: "yonetici", unitId: null, isApproved: true, createdAt: isoDaysAgo(120) },
        { id: "res1", name: "Ayşe Kaya", email: "ayse@example.com", phone: "0532 000 00 01", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u1", isApproved: true, createdAt: isoDaysAgo(90) },
        { id: "res2", name: "Mehmet Demir", email: "mehmet@example.com", phone: "0532 000 00 02", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u2", isApproved: true, createdAt: isoDaysAgo(90) },
        { id: "res3", name: "Elif Şahin", email: "elif@example.com", phone: "0532 000 00 13", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u3", isApproved: true, createdAt: isoDaysAgo(60) },
        { id: "res4", name: "Zeynep Arslan", email: "zeynep@example.com", phone: "0532 000 00 05", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u5", isApproved: true, createdAt: isoDaysAgo(40) },
        { id: "pend1", name: "Burak Öz", email: "burak@example.com", phone: "0532 000 00 06", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u6", isApproved: false, createdAt: isoDaysAgo(1) },
        { id: "per1", name: "Hasan Kapıcı", email: "hasan@site.com", phone: "0533 111 22 33", passwordHash: bcrypt.hashSync("demo1234", 10), role: "personel", unitId: null, department: "Temizlik", isApproved: true, createdAt: isoDaysAgo(200) },
        { id: "per2", name: "Osman Teknisyen", email: "osman@site.com", phone: "0533 444 55 66", passwordHash: bcrypt.hashSync("demo1234", 10), role: "personel", unitId: null, department: "Bakım-Onarım", isApproved: true, createdAt: isoDaysAgo(200) },
      ];
      for (const u of users) await tx.user.create({ data: u });

      // ---- Ayarlar (eski "meta") ----
      await tx.settings.create({
        data: {
          id: "singleton",
          buildingName: "Örnek Site",
          address: "",
          initializedAt: new Date().toISOString(),
          monthlyDueDefault: DUE_AMOUNT,
          lateFeeRate: 5,
          lateFeeGraceDays: 10,
          autoDueEnabled: true,
          autoDueDay: 1,
          autoDueAmount: DUE_AMOUNT,
          lastAutoDuePeriod: monthsAgoPeriod(0),
          defaultAccountId: DEFAULT_ACCOUNT_ID,
          ticketCategories: ["Tesisat", "Elektrik", "Asansör", "Ortak Alan", "Diğer"],
        },
      });

      // ---- Personel ----
      await tx.personnel.create({ data: { id: "per1", name: "Hasan Kapıcı", phone: "0533 111 22 33", department: "Temizlik", active: true, userId: "per1", monthlySalary: 22000 } });
      await tx.personnel.create({ data: { id: "per2", name: "Osman Teknisyen", phone: "0533 444 55 66", department: "Bakım-Onarım", active: true, userId: "per2", monthlySalary: 26000 } });

      // ---- Aidat borclari (4 donem x 6 daire) ----
      const charges = [];
      for (let i = 3; i >= 0; i--) {
        const period = monthsAgoPeriod(i);
        for (const u of units) {
          const paid = i > 0 || ["u2", "u4", "u6"].includes(u.id);
          const charge = {
            id: uid(),
            unitId: u.id,
            type: "aidat",
            period,
            amount: DUE_AMOUNT,
            dueDate: isoDaysAgo(i * 30 - 25),
            status: paid ? "paid" : "unpaid",
            paidAmount: paid ? DUE_AMOUNT : 0,
            description: `${period} ayı aidatı`,
            createdAt: isoDaysAgo(i * 30 + 5),
          };
          charges.push(charge);
          await tx.charge.create({ data: charge });
        }
      }

      // ---- Odemeler + baglantili muhasebe hareketleri ----
      const paidCharges = charges.filter((c) => c.status === "paid");
      for (const c of paidCharges) {
        const owner = users.find((u) => u.unitId === c.unitId);
        const transactionId = uid();
        const paymentId = uid();
        const date = c.dueDate;
        const receiptNo = "MK-" + Math.floor(100000 + Math.random() * 899999);

        await tx.transaction.create({
          data: { id: transactionId, type: "gelir", category: "Aidat Tahsilatı", amount: c.amount, accountId: DEFAULT_ACCOUNT_ID, date, description: c.description, createdBy: "admin1" },
        });
        await tx.payment.create({
          data: {
            id: paymentId,
            unitId: c.unitId,
            userId: owner ? owner.id : null,
            amount: c.amount,
            method: "Havale/EFT",
            accountId: DEFAULT_ACCOUNT_ID,
            date,
            note: c.description,
            receiptNo,
            transactionId,
            cancelled: false,
          },
        });
        await tx.paymentAllocation.create({ data: { id: uid(), paymentId, chargeId: c.id, amount: c.amount } });
      }

      // ---- Ek muhasebe hareketleri (temizlik/guvenlik/bakim giderleri) ----
      for (let i = 3; i >= 0; i--) {
        const period = monthsAgoPeriod(i);
        await tx.transaction.create({ data: { id: uid(), type: "gider", category: "Temizlik", amount: 2400, accountId: DEFAULT_ACCOUNT_ID, date: isoDaysAgo(i * 30 + 3), description: `${period} temizlik hizmeti`, createdBy: "admin1" } });
        await tx.transaction.create({ data: { id: uid(), type: "gider", category: "Güvenlik", amount: 5200, accountId: DEFAULT_ACCOUNT_ID, date: isoDaysAgo(i * 30 + 3), description: `${period} güvenlik personeli`, createdBy: "admin1" } });
        if (i % 2 === 0) {
          await tx.transaction.create({ data: { id: uid(), type: "gider", category: "Bakım-Onarım", amount: 850, accountId: DEFAULT_ACCOUNT_ID, date: isoDaysAgo(i * 30 + 10), description: "Genel bakım gideri", createdBy: "admin1" } });
        }
      }

      // ---- Duyurular ----
      await tx.announcement.create({ data: { id: uid(), title: "Asansör Yıllık Bakımı", body: "18 Ağustos Salı 09:00-13:00 arası A Blok asansörü bakımda olacaktır.", date: isoDaysAgo(1), authorId: "admin1", pinned: true } });
      await tx.announcement.create({ data: { id: uid(), title: "Genel Kurul Toplantısı", body: "Yıllık olağan genel kurul toplantımız 30 Ağustos Pazar 11:00'de toplantı salonunda yapılacaktır.", date: isoDaysAgo(3), authorId: "admin1", pinned: true } });
      await tx.announcement.create({ data: { id: uid(), title: "Su Deposu Temizliği Tamamlandı", body: "Periyodik su deposu temizliği ve dezenfeksiyonu yapılmıştır.", date: isoDaysAgo(20), authorId: "admin1", pinned: false } });

      // ---- Anket ----
      // Not: eski veri modelinde votedBy sadece "kim oy verdi" listesiydi, hangi
      // secenegi sectikleri ayrica tutulmuyordu (options[].votes sadece toplam
      // sayi). Ayni toplam dagilimi (4/1) koruyacak sekilde ilk 4 oyu birinci
      // secenege, son oyu ikinci secenege atfediyoruz - orijinal veri kaybini
      // en yakin sekilde yeniden ureten bir varsayim.
      const survey = await tx.survey.create({ data: { id: uid(), question: "Sitemize güvenlik kamerası sistemi eklensin mi?", active: true, createdAt: isoDaysAgo(10) } });
      const optYes = await tx.surveyOption.create({ data: { id: uid(), surveyId: survey.id, text: "Evet, eklensin", votes: 4 } });
      const optNo = await tx.surveyOption.create({ data: { id: uid(), surveyId: survey.id, text: "Hayır, gerek yok", votes: 1 } });
      for (const voterId of ["res1", "res2", "res3", "res4"]) {
        await tx.surveyVote.create({ data: { id: uid(), surveyId: survey.id, userId: voterId } });
      }
      await tx.surveyVote.create({ data: { id: uid(), surveyId: survey.id, userId: "per1" } });
      void optYes;
      void optNo;

      // ---- Ortak alanlar + rezervasyon ----
      const facilities = [
        { id: "f1", name: "Toplantı Salonu", capacity: 30, rules: "Maksimum 3 saat, hafta içi 09:00-22:00" },
        { id: "f2", name: "Spor Salonu", capacity: 10, rules: "Saatlik rezervasyon, 07:00-23:00" },
        { id: "f3", name: "Çocuk Oyun Alanı", capacity: 15, rules: "Rezervasyonsuz kullanılabilir, özel etkinlik için rezervasyon gerekir" },
        { id: "f4", name: "Yüzme Havuzu", capacity: 20, rules: "Mayıs-Eylül arası açık, 09:00-20:00" },
      ];
      for (const f of facilities) await tx.facility.create({ data: f });
      await tx.reservation.create({ data: { id: uid(), facilityId: "f1", unitId: "u3", userId: "res3", date: isoDaysAgo(-4), startTime: "18:00", endTime: "20:00", status: "Onaylandı", createdAt: isoDaysAgo(2) } });

      // ---- Ariza/Talep ----
      const ticket1 = await tx.ticket.create({
        data: { id: uid(), unitId: "u5", userId: "res4", category: "Tesisat", title: "Mutfak lavabosunda sızıntı", description: "Mutfak lavabosunun altında sürekli su sızıntısı var.", priority: "Yüksek", status: "İşlemde", assignedPersonnelId: "per2", createdAt: isoDaysAgo(1), updatedAt: isoDaysAgo(0) },
      });
      await tx.ticketComment.create({ data: { id: uid(), ticketId: ticket1.id, userId: "admin1", text: "Osman'a atandı, yarın bakılacak.", date: isoDaysAgo(0) } });
      await tx.ticket.create({ data: { id: uid(), unitId: "u1", userId: "res1", category: "Ortak Alan", title: "Bahçe aydınlatması yanmıyor", description: "Bahçe girişindeki lamba iki gündür yanmıyor.", priority: "Orta", status: "Açık", assignedPersonnelId: null, createdAt: isoDaysAgo(2), updatedAt: isoDaysAgo(2) } });

      // ---- Firma (tedarikci) + cari hesap ----
      const vendor1 = await tx.vendor.create({ data: { id: uid(), name: "ACME Asansör Servis", category: "Asansör Bakım Firması", phone: "0212 555 66 77", taxNumber: "", iban: "", notes: "", createdAt: isoDaysAgo(300) } });
      await tx.vendor.create({ data: { id: uid(), name: "Parlak Temizlik Ltd.", category: "Temizlik Firması", phone: "0212 444 33 22", taxNumber: "", iban: "", notes: "", createdAt: isoDaysAgo(300) } });
      await tx.partyCharge.create({ data: { id: uid(), partyType: "firma", partyId: vendor1.id, amount: 3500, paidAmount: 0, status: "unpaid", description: "Aylık asansör bakım sözleşme bedeli", date: isoDaysAgo(5), dueDate: isoDaysAgo(-10), createdBy: "admin1" } });

      // ---- Demirbas / bakim ----
      const equipmentSeed = [
        { id: uid(), name: "A Blok Asansör Motoru", location: "A Blok", purchaseDate: new Date("2019-03-01").toISOString(), warrantyUntil: new Date("2024-03-01").toISOString(), responsiblePersonnelId: "per2", maintenancePeriodDays: 90, lastMaintenanceDate: isoDaysAgo(60), notes: "Yıllık bakım sözleşmesi mevcut." },
        { id: uid(), name: "Hidrofor Sistemi", location: "Ortak Alan / Bodrum", purchaseDate: new Date("2021-06-15").toISOString(), warrantyUntil: new Date("2026-06-15").toISOString(), responsiblePersonnelId: "per2", maintenancePeriodDays: 180, lastMaintenanceDate: isoDaysAgo(30), notes: "" },
        { id: uid(), name: "Havuz Filtrasyon Ünitesi", location: "Havuz", purchaseDate: new Date("2022-04-10").toISOString(), warrantyUntil: new Date("2025-04-10").toISOString(), responsiblePersonnelId: "per2", maintenancePeriodDays: 30, lastMaintenanceDate: isoDaysAgo(45), notes: "Bakım süresi geçti - kontrol edilmeli." },
      ];
      for (const e of equipmentSeed) {
        await tx.equipment.create({ data: e });
        await tx.maintenanceRecord.create({ data: { id: uid(), equipmentId: e.id, date: e.lastMaintenanceDate, by: "admin1", notes: "" } });
      }

      // ---- Sayaclar ----
      await tx.meter.create({ data: { id: "m1", unitId: "u1", type: "su", serialNo: "SU-0001" } });
      await tx.meter.create({ data: { id: "m2", unitId: "u2", type: "su", serialNo: "SU-0002" } });
      await tx.meter.create({ data: { id: "m3", unitId: "u3", type: "kalorimetre", serialNo: "KL-0003" } });
      await tx.meterReading.create({ data: { id: uid(), meterId: "m1", period: monthsAgoPeriod(0), value: 12, unitCost: 45, amount: 540, date: isoDaysAgo(2), chargeId: null } });
      await tx.meterReading.create({ data: { id: uid(), meterId: "m2", period: monthsAgoPeriod(0), value: 9, unitCost: 45, amount: 405, date: isoDaysAgo(2), chargeId: null } });

      // ---- Kargo ----
      await tx.package.create({ data: { id: uid(), unitId: "u1", courier: "Aras Kargo", trackingNo: "AR123456789", receivedDate: isoDaysAgo(1), deliveredDate: null, status: "Teslim Alındı", deliveredBy: "Hasan Kapıcı" } });
      await tx.package.create({ data: { id: uid(), unitId: "u4", courier: "Yurtiçi Kargo", trackingNo: "YI987654321", receivedDate: isoDaysAgo(5), deliveredDate: isoDaysAgo(4), status: "Teslim Edildi", deliveredBy: "Hasan Kapıcı" } });

      // ---- Karar defteri ----
      await tx.decision.create({ data: { id: uid(), decisionNo: 1, date: isoDaysAgo(200), title: "2026 Yılı Aidat Tutarının Belirlenmesi", content: "Genel kurulda aylık aidatın 450 TL olarak belirlenmesine oy birliğiyle karar verilmiştir.", attendees: 22, createdBy: "admin1" } });
      await tx.decision.create({ data: { id: uid(), decisionNo: 2, date: isoDaysAgo(90), title: "Güvenlik Kamerası Yatırımı Ön Kararı", content: "Site geneline güvenlik kamerası sistemi kurulması için teklif toplanmasına karar verilmiştir.", attendees: 18, createdBy: "admin1" } });

      // ---- Anahtar takibi ----
      await tx.key.create({ data: { id: uid(), keyName: "Teras Kat Ortak Alan Anahtarı", location: "Yönetim Ofisi", status: "depoda", holderName: "", givenDate: null, returnedDate: null } });
      const key2 = await tx.key.create({ data: { id: uid(), keyName: "Hidrofor Odası Anahtarı", location: "Bodrum", status: "zimmetli", holderName: "Osman Teknisyen", givenDate: isoDaysAgo(15), returnedDate: null } });
      await tx.keyAssignment.create({ data: { id: uid(), keyId: key2.id, holderName: "Osman Teknisyen", givenDate: isoDaysAgo(15), returnedDate: null } });

      // ---- Site panosu ----
      await tx.classifieds.create({ data: { id: uid(), userId: "res2", type: "satilik", title: "Bebek Arabası Satılık", description: "Az kullanılmış, temiz. İlgilenen komşular mesaj atabilir.", date: isoDaysAgo(3), resolved: false } });
      await tx.classifieds.create({ data: { id: uid(), userId: "res1", type: "yardim", title: "Kedi Maması İhtiyacı", description: "Bu hafta kısa süreliğine şehir dışındayım, kedime bakabilecek biri var mı?", date: isoDaysAgo(1), resolved: false } });

      // ---- Bildirimler ----
      await tx.notification.create({ data: { id: uid(), userId: "res4", message: "Ağustos ayı aidat borcunuz bulunmaktadır.", read: false, date: isoDaysAgo(2), link: "#/aidat" } });
      await tx.notification.create({ data: { id: uid(), userId: "admin1", message: "Burak Öz kayıt onayı bekliyor.", read: false, date: isoDaysAgo(1), link: "#/kullanicilar" } });

      // ---- Denetim kaydi ----
      await tx.activityLog.create({ data: { id: uid(), actorId: "admin1", actorName: "Site Yöneticisi", action: "charge.generate", detail: `${monthsAgoPeriod(0)} dönemi aidat borcu tüm dairelere uygulandı (${DUE_AMOUNT}₺)`, date: isoDaysAgo(0), scopeUnitId: null } });
      await tx.activityLog.create({ data: { id: uid(), actorId: "admin1", actorName: "Site Yöneticisi", action: "decision.create", detail: "Karar No 1 kaydedildi: 2026 Yılı Aidat Tutarının Belirlenmesi", date: isoDaysAgo(200), scopeUnitId: null } });

      // ---- Butce ----
      const year = new Date().getFullYear();
      await tx.budget.create({ data: { id: uid(), year, category: "Temizlik", plannedAmount: 30000, createdBy: "admin1" } });
      await tx.budget.create({ data: { id: uid(), year, category: "Güvenlik", plannedAmount: 62000, createdBy: "admin1" } });
      await tx.budget.create({ data: { id: uid(), year, category: "Bakım-Onarım", plannedAmount: 12000, createdBy: "admin1" } });
      await tx.budget.create({ data: { id: uid(), year, category: "Asansör Bakımı", plannedAmount: 8000, createdBy: "admin1" } });

      // ---- Telefon rehberi ----
      await tx.contact.create({ data: { id: uid(), name: "Hasan Kapıcı", role: "Kapıcı", phone: "0533 111 22 33" } });
      await tx.contact.create({ data: { id: uid(), name: "ACME Asansör Servis", role: "Asansör Bakım Firması", phone: "0212 555 66 77" } });
      await tx.contact.create({ data: { id: uid(), name: "Kemal Usta", role: "Su Tesisatçısı", phone: "0555 222 33 44" } });
      await tx.contact.create({ data: { id: uid(), name: "İtfaiye", role: "Acil Durum", phone: "110" } });
    },
    { timeout: 30000 }
  );
}

main()
  .then(async () => {
    console.log("Seed tamamlandi.");
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
