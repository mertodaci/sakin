const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

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

function buildSeed() {
  const adminEmail = process.env.ADMIN_EMAIL || "yonetici@site.com";
  const adminPassword = process.env.ADMIN_PASSWORD || "Degistir123!";

  const units = [
    { id: "u1", block: "A Blok", no: "4", floor: 1, ownerName: "Ayşe Kaya", ownerPhone: "0532 000 00 01", tenantName: "", tenantPhone: "", occupancy: "owner" },
    { id: "u2", block: "A Blok", no: "7", floor: 2, ownerName: "Mehmet Demir", ownerPhone: "0532 000 00 02", tenantName: "", tenantPhone: "", occupancy: "owner" },
    { id: "u3", block: "B Blok", no: "2", floor: 1, ownerName: "Fatma Şahin", ownerPhone: "0532 000 00 03", tenantName: "Elif Şahin", tenantPhone: "0532 000 00 13", occupancy: "tenant" },
    { id: "u4", block: "B Blok", no: "9", floor: 3, ownerName: "Can Yıldız", ownerPhone: "0532 000 00 04", tenantName: "", tenantPhone: "", occupancy: "owner" },
    { id: "u5", block: "C Blok", no: "1", floor: 1, ownerName: "Zeynep Arslan", ownerPhone: "0532 000 00 05", tenantName: "", tenantPhone: "", occupancy: "owner" },
    { id: "u6", block: "A Blok", no: "2", floor: 1, ownerName: "Burak Öz", ownerPhone: "0532 000 00 06", tenantName: "", tenantPhone: "", occupancy: "owner" },
  ];

  const users = [
    {
      id: "admin1",
      name: "Site Yöneticisi",
      email: adminEmail,
      phone: "0532 000 00 00",
      passwordHash: bcrypt.hashSync(adminPassword, 10),
      role: "yonetici",
      unitId: null,
      isApproved: true,
      createdAt: isoDaysAgo(120),
    },
    { id: "res1", name: "Ayşe Kaya", email: "ayse@example.com", phone: "0532 000 00 01", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u1", isApproved: true, createdAt: isoDaysAgo(90) },
    { id: "res2", name: "Mehmet Demir", email: "mehmet@example.com", phone: "0532 000 00 02", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u2", isApproved: true, createdAt: isoDaysAgo(90) },
    { id: "res3", name: "Elif Şahin", email: "elif@example.com", phone: "0532 000 00 13", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u3", isApproved: true, createdAt: isoDaysAgo(60) },
    { id: "res4", name: "Zeynep Arslan", email: "zeynep@example.com", phone: "0532 000 00 05", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u5", isApproved: true, createdAt: isoDaysAgo(40) },
    { id: "pend1", name: "Burak Öz", email: "burak@example.com", phone: "0532 000 00 06", passwordHash: bcrypt.hashSync("demo1234", 10), role: "sakin", unitId: "u6", isApproved: false, createdAt: isoDaysAgo(1) },
    { id: "per1", name: "Hasan Kapıcı", email: "hasan@site.com", phone: "0533 111 22 33", passwordHash: bcrypt.hashSync("demo1234", 10), role: "personel", unitId: null, department: "Temizlik", isApproved: true, createdAt: isoDaysAgo(200) },
    { id: "per2", name: "Osman Teknisyen", email: "osman@site.com", phone: "0533 444 55 66", passwordHash: bcrypt.hashSync("demo1234", 10), role: "personel", unitId: null, department: "Bakım-Onarım", isApproved: true, createdAt: isoDaysAgo(200) },
  ].map((u) => ({ mustChangePassword: false, resetRequestedAt: null, isActive: true, tokenVersion: 0, failedLoginAttempts: 0, lockedUntil: null, ...u }));

  // Coklu kasa/banka hesabi yonetimi: gercek apartman yonetiminde para birden
  // fazla hesapta (banka + nakit + POS) ayri ayri takip edilir.
  const accounts = [
    { id: "acc-banka", name: "Ana Banka Hesabı", type: "banka", bankName: "Örnek Banka", iban: "TR00 0000 0000 0000 0000 0000 00", openingBalance: 15000, createdAt: isoDaysAgo(300) },
    { id: "acc-nakit", name: "Nakit Kasa", type: "nakit", bankName: "", iban: "", openingBalance: 2000, createdAt: isoDaysAgo(300) },
    { id: "acc-pos", name: "POS / Kredi Kartı Tahsilatı", type: "pos", bankName: "", iban: "", openingBalance: 0, createdAt: isoDaysAgo(300) },
  ];
  const DEFAULT_ACCOUNT_ID = "acc-banka";

  const DUE_AMOUNT = 450;
  const charges = [];
  for (let i = 3; i >= 0; i--) {
    const period = monthsAgoPeriod(i);
    units.forEach((u) => {
      const paid = i > 0 || ["u2", "u4", "u6"].includes(u.id);
      charges.push({
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
      });
    });
  }

  const payments = charges
    .filter((c) => c.status === "paid")
    .map((c) => ({
      id: uid(),
      unitId: c.unitId,
      userId: users.find((u) => u.unitId === c.unitId)?.id || null,
      amount: c.amount,
      method: "Havale/EFT",
      accountId: DEFAULT_ACCOUNT_ID,
      date: c.dueDate,
      note: c.description,
      receiptNo: "MK-" + Math.floor(100000 + Math.random() * 899999),
      appliedTo: [{ chargeId: c.id, amount: c.amount }],
      transactionId: null,
      cancelled: false,
    }));

  const transactions = [];
  payments.forEach((p) => {
    const txnId = uid();
    p.transactionId = txnId;
    transactions.push({ id: txnId, type: "gelir", category: "Aidat Tahsilatı", amount: p.amount, accountId: p.accountId, date: p.date, description: p.note, createdBy: "admin1" });
  });
  for (let i = 3; i >= 0; i--) {
    const period = monthsAgoPeriod(i);
    transactions.push({ id: uid(), type: "gider", category: "Temizlik", amount: 2400, accountId: DEFAULT_ACCOUNT_ID, date: isoDaysAgo(i * 30 + 3), description: `${period} temizlik hizmeti`, createdBy: "admin1" });
    transactions.push({ id: uid(), type: "gider", category: "Güvenlik", amount: 5200, accountId: DEFAULT_ACCOUNT_ID, date: isoDaysAgo(i * 30 + 3), description: `${period} güvenlik personeli`, createdBy: "admin1" });
    if (i % 2 === 0) {
      transactions.push({ id: uid(), type: "gider", category: "Bakım-Onarım", amount: 850, accountId: DEFAULT_ACCOUNT_ID, date: isoDaysAgo(i * 30 + 10), description: "Genel bakım gideri", createdBy: "admin1" });
    }
  }

  const announcements = [
    { id: uid(), title: "Asansör Yıllık Bakımı", body: "18 Ağustos Salı 09:00-13:00 arası A Blok asansörü bakımda olacaktır.", date: isoDaysAgo(1), authorId: "admin1", pinned: true },
    { id: uid(), title: "Genel Kurul Toplantısı", body: "Yıllık olağan genel kurul toplantımız 30 Ağustos Pazar 11:00'de toplantı salonunda yapılacaktır.", date: isoDaysAgo(3), authorId: "admin1", pinned: true },
    { id: uid(), title: "Su Deposu Temizliği Tamamlandı", body: "Periyodik su deposu temizliği ve dezenfeksiyonu yapılmıştır.", date: isoDaysAgo(20), authorId: "admin1", pinned: false },
  ];

  const surveys = [
    {
      id: uid(),
      question: "Sitemize güvenlik kamerası sistemi eklensin mi?",
      active: true,
      options: [
        { text: "Evet, eklensin", votes: 4 },
        { text: "Hayır, gerek yok", votes: 1 },
      ],
      votedBy: ["res1", "res2", "res3", "res4", "per1"],
      createdAt: isoDaysAgo(10),
    },
  ];

  const facilities = [
    { id: "f1", name: "Toplantı Salonu", capacity: 30, rules: "Maksimum 3 saat, hafta içi 09:00-22:00" },
    { id: "f2", name: "Spor Salonu", capacity: 10, rules: "Saatlik rezervasyon, 07:00-23:00" },
    { id: "f3", name: "Çocuk Oyun Alanı", capacity: 15, rules: "Rezervasyonsuz kullanılabilir, özel etkinlik için rezervasyon gerekir" },
    { id: "f4", name: "Yüzme Havuzu", capacity: 20, rules: "Mayıs-Eylül arası açık, 09:00-20:00" },
  ];

  const reservations = [
    { id: uid(), facilityId: "f1", unitId: "u3", userId: "res3", date: isoDaysAgo(-4), startTime: "18:00", endTime: "20:00", status: "Onaylandı", createdAt: isoDaysAgo(2) },
  ];

  const ticketCategories = ["Tesisat", "Elektrik", "Asansör", "Ortak Alan", "Diğer"];

  const tickets = [
    { id: uid(), unitId: "u5", userId: "res4", category: "Tesisat", title: "Mutfak lavabosunda sızıntı", description: "Mutfak lavabosunun altında sürekli su sızıntısı var.", priority: "Yüksek", status: "İşlemde", assignedPersonnelId: "per2", comments: [{ id: uid(), userId: "admin1", text: "Osman'a atandı, yarın bakılacak.", date: isoDaysAgo(0) }], createdAt: isoDaysAgo(1), updatedAt: isoDaysAgo(0) },
    { id: uid(), unitId: "u1", userId: "res1", category: "Ortak Alan", title: "Bahçe aydınlatması yanmıyor", description: "Bahçe girişindeki lamba iki gündür yanmıyor.", priority: "Orta", status: "Açık", assignedPersonnelId: null, comments: [], createdAt: isoDaysAgo(2), updatedAt: isoDaysAgo(2) },
  ];

  const personnel = [
    { id: "per1", name: "Hasan Kapıcı", phone: "0533 111 22 33", department: "Temizlik", active: true, userId: "per1", monthlySalary: 22000 },
    { id: "per2", name: "Osman Teknisyen", phone: "0533 444 55 66", department: "Bakım-Onarım", active: true, userId: "per2", monthlySalary: 26000 },
  ];

  // Firma (tedarikci) cari hesap yonetimi
  const vendors = [
    { id: uid(), name: "ACME Asansör Servis", category: "Asansör Bakım Firması", phone: "0212 555 66 77", taxNumber: "", iban: "", notes: "", createdAt: isoDaysAgo(300) },
    { id: uid(), name: "Parlak Temizlik Ltd.", category: "Temizlik Firması", phone: "0212 444 33 22", taxNumber: "", iban: "", notes: "", createdAt: isoDaysAgo(300) },
  ];

  // Firma/personele borclanma (odenmemis) ve odeme kayitlari - "cari hesap"
  const partyCharges = [
    { id: uid(), partyType: "firma", partyId: vendors[0].id, amount: 3500, paidAmount: 0, status: "unpaid", description: "Aylık asansör bakım sözleşme bedeli", date: isoDaysAgo(5), dueDate: isoDaysAgo(-10), createdBy: "admin1" },
  ];
  const partyPayments = [];

  const equipment = [
    { id: uid(), name: "A Blok Asansör Motoru", location: "A Blok", purchaseDate: "2019-03-01", warrantyUntil: "2024-03-01", responsiblePersonnelId: "per2", maintenancePeriodDays: 90, lastMaintenanceDate: isoDaysAgo(60), maintenanceHistory: [{ id: uid(), date: isoDaysAgo(60), by: "admin1", notes: "" }], notes: "Yıllık bakım sözleşmesi mevcut." },
    { id: uid(), name: "Hidrofor Sistemi", location: "Ortak Alan / Bodrum", purchaseDate: "2021-06-15", warrantyUntil: "2026-06-15", responsiblePersonnelId: "per2", maintenancePeriodDays: 180, lastMaintenanceDate: isoDaysAgo(30), maintenanceHistory: [{ id: uid(), date: isoDaysAgo(30), by: "admin1", notes: "" }], notes: "" },
    { id: uid(), name: "Havuz Filtrasyon Ünitesi", location: "Havuz", purchaseDate: "2022-04-10", warrantyUntil: "2025-04-10", responsiblePersonnelId: "per2", maintenancePeriodDays: 30, lastMaintenanceDate: isoDaysAgo(45), maintenanceHistory: [{ id: uid(), date: isoDaysAgo(45), by: "admin1", notes: "" }], notes: "Bakım süresi geçti - kontrol edilmeli." },
  ];

  const meters = [
    { id: "m1", unitId: "u1", type: "su", serialNo: "SU-0001" },
    { id: "m2", unitId: "u2", type: "su", serialNo: "SU-0002" },
    { id: "m3", unitId: "u3", type: "kalorimetre", serialNo: "KL-0003" },
  ];

  const meterReadings = [
    { id: uid(), meterId: "m1", period: monthsAgoPeriod(0), value: 12, unitCost: 45, amount: 540, date: isoDaysAgo(2) },
    { id: uid(), meterId: "m2", period: monthsAgoPeriod(0), value: 9, unitCost: 45, amount: 405, date: isoDaysAgo(2) },
  ];

  const packages = [
    { id: uid(), unitId: "u1", courier: "Aras Kargo", trackingNo: "AR123456789", receivedDate: isoDaysAgo(1), deliveredDate: null, status: "Teslim Alındı", deliveredBy: "Hasan Kapıcı" },
    { id: uid(), unitId: "u4", courier: "Yurtiçi Kargo", trackingNo: "YI987654321", receivedDate: isoDaysAgo(5), deliveredDate: isoDaysAgo(4), status: "Teslim Edildi", deliveredBy: "Hasan Kapıcı" },
  ];

  const decisions = [
    { id: uid(), decisionNo: 1, date: isoDaysAgo(200), title: "2026 Yılı Aidat Tutarının Belirlenmesi", content: "Genel kurulda aylık aidatın 450 TL olarak belirlenmesine oy birliğiyle karar verilmiştir.", attendees: 22, createdBy: "admin1" },
    { id: uid(), decisionNo: 2, date: isoDaysAgo(90), title: "Güvenlik Kamerası Yatırımı Ön Kararı", content: "Site geneline güvenlik kamerası sistemi kurulması için teklif toplanmasına karar verilmiştir.", attendees: 18, createdBy: "admin1" },
  ];

  const keys = [
    { id: uid(), keyName: "Teras Kat Ortak Alan Anahtarı", location: "Yönetim Ofisi", status: "depoda", holderName: "", givenDate: null, returnedDate: null, history: [] },
    { id: uid(), keyName: "Hidrofor Odası Anahtarı", location: "Bodrum", status: "zimmetli", holderName: "Osman Teknisyen", givenDate: isoDaysAgo(15), returnedDate: null, history: [{ id: uid(), holderName: "Osman Teknisyen", givenDate: isoDaysAgo(15), returnedDate: null }] },
  ];

  const classifieds = [
    { id: uid(), userId: "res2", type: "satilik", title: "Bebek Arabası Satılık", description: "Az kullanılmış, temiz. İlgilenen komşular mesaj atabilir.", date: isoDaysAgo(3), resolved: false },
    { id: uid(), userId: "res1", type: "yardim", title: "Kedi Maması İhtiyacı", description: "Bu hafta kısa süreliğine şehir dışındayım, kedime bakabilecek biri var mı?", date: isoDaysAgo(1), resolved: false },
  ];

  const notifications = [
    { id: uid(), userId: "res4", message: "Ağustos ayı aidat borcunuz bulunmaktadır.", read: false, date: isoDaysAgo(2), link: "#/aidat" },
    { id: uid(), userId: "admin1", message: "Burak Öz kayıt onayı bekliyor.", read: false, date: isoDaysAgo(1), link: "#/kullanicilar" },
  ];

  // Seffaflik: her onemli islem burada izlenebilir bir kayda donusur (denetim/audit log)
  const activityLog = [
    { id: uid(), actorId: "admin1", actorName: "Site Yöneticisi", action: "charge.generate", detail: `${monthsAgoPeriod(0)} dönemi aidat borcu tüm dairelere uygulandı (${DUE_AMOUNT}₺)`, date: isoDaysAgo(0), scopeUnitId: null },
    { id: uid(), actorId: "admin1", actorName: "Site Yöneticisi", action: "decision.create", detail: "Karar No 1 kaydedildi: 2026 Yılı Aidat Tutarının Belirlenmesi", date: isoDaysAgo(200), scopeUnitId: null },
  ];

  // Yillik butce planlamasi: planlanan vs gerceklesen karsilastirmasi icin
  const budgets = [
    { id: uid(), year: new Date().getFullYear(), category: "Temizlik", plannedAmount: 30000, createdBy: "admin1" },
    { id: uid(), year: new Date().getFullYear(), category: "Güvenlik", plannedAmount: 62000, createdBy: "admin1" },
    { id: uid(), year: new Date().getFullYear(), category: "Bakım-Onarım", plannedAmount: 12000, createdBy: "admin1" },
    { id: uid(), year: new Date().getFullYear(), category: "Asansör Bakımı", plannedAmount: 8000, createdBy: "admin1" },
  ];

  // Odeme istekleri icin idempotency anahtarlari (cift cekimi engellemek amaciyla)
  const usedPaymentRequestIds = [];

  // Rutin ihtiyac: faydali numaralar / telefon rehberi (kapici, teknisyen, firma vb.)
  const contacts = [
    { id: uid(), name: "Hasan Kapıcı", role: "Kapıcı", phone: "0533 111 22 33" },
    { id: uid(), name: "ACME Asansör Servis", role: "Asansör Bakım Firması", phone: "0212 555 66 77" },
    { id: uid(), name: "Kemal Usta", role: "Su Tesisatçısı", phone: "0555 222 33 44" },
    { id: uid(), name: "İtfaiye", role: "Acil Durum", phone: "110" },
  ];

  return {
    meta: {
      buildingName: "Örnek Site",
      address: "",
      initializedAt: new Date().toISOString(),
      monthlyDueDefault: DUE_AMOUNT,
      // Gecikme faizi: Kat Mulkiyeti Kanunu geregi apartman yonetimlerinde yaygin uygulama
      lateFeeRate: 5, // aylik yuzde
      lateFeeGraceDays: 10, // son odeme tarihinden sonraki tolerans suresi
      // Otomatik aylik aidat borclandirma
      autoDueEnabled: true,
      autoDueDay: 1, // her ayin kacinci gunu calisacak
      autoDueAmount: DUE_AMOUNT,
      lastAutoDuePeriod: monthsAgoPeriod(0),
      defaultAccountId: DEFAULT_ACCOUNT_ID,
    },
    units,
    users,
    charges,
    payments,
    transactions,
    announcements,
    surveys,
    facilities,
    reservations,
    ticketCategories,
    tickets,
    personnel,
    equipment,
    meters,
    meterReadings,
    packages,
    decisions,
    keys,
    classifieds,
    notifications,
    activityLog,
    budgets,
    usedPaymentRequestIds,
    contacts,
    accounts,
    transfers: [],
    vendors,
    partyCharges,
    partyPayments,
  };
}

let cache = null;

function load() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    cache = buildSeed();
    persist();
    console.log("Veritabani bulunamadi, ornek verilerle olusturuldu: " + DB_PATH);
  } else {
    cache = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
    migrate(cache);
  }
  return cache;
}

// Eski db.json dosyalarini yeni alanlarla uyumlu hale getirir (geriye donuk uyumluluk)
function migrate(data) {
  if (!data.activityLog) data.activityLog = [];
  if (!data.budgets) data.budgets = [];
  if (!data.usedPaymentRequestIds) data.usedPaymentRequestIds = [];
  if (!data.contacts) data.contacts = [];
  if (!data.transfers) data.transfers = [];
  if (!data.vendors) data.vendors = [];
  if (!data.partyCharges) data.partyCharges = [];
  if (!data.partyPayments) data.partyPayments = [];
  if (!data.accounts || data.accounts.length === 0) {
    data.accounts = [{ id: "acc-banka", name: "Ana Banka Hesabı", type: "banka", bankName: "", iban: "", openingBalance: 0, createdAt: new Date().toISOString() }];
  }
  if (data.meta.lateFeeRate === undefined) data.meta.lateFeeRate = 5;
  if (data.meta.lateFeeGraceDays === undefined) data.meta.lateFeeGraceDays = 10;
  if (data.meta.autoDueEnabled === undefined) data.meta.autoDueEnabled = false;
  if (data.meta.autoDueDay === undefined) data.meta.autoDueDay = 1;
  if (data.meta.autoDueAmount === undefined) data.meta.autoDueAmount = data.meta.monthlyDueDefault || 450;
  if (data.meta.lastAutoDuePeriod === undefined) data.meta.lastAutoDuePeriod = null;
  if (!data.meta.defaultAccountId) data.meta.defaultAccountId = data.accounts[0].id;
  (data.users || []).forEach((u) => {
    if (u.mustChangePassword === undefined) u.mustChangePassword = false;
    if (u.resetRequestedAt === undefined) u.resetRequestedAt = null;
    if (u.isActive === undefined) u.isActive = true;
    if (u.tokenVersion === undefined) u.tokenVersion = 0;
    if (u.failedLoginAttempts === undefined) u.failedLoginAttempts = 0;
    if (u.lockedUntil === undefined) u.lockedUntil = null;
  });
  (data.charges || []).forEach((c) => {
    if (c.lateFeeAppliedPeriods === undefined) c.lateFeeAppliedPeriods = [];
  });
  (data.equipment || []).forEach((e) => { if (!e.maintenanceHistory) e.maintenanceHistory = e.lastMaintenanceDate ? [{ id: uid(), date: e.lastMaintenanceDate, by: "admin1", notes: "" }] : []; });
  (data.meterReadings || []).forEach((r) => { if (r.chargeId === undefined) r.chargeId = null; });
  (data.partyPayments || []).forEach((p) => { if (p.appliedTo === undefined) p.appliedTo = []; if (p.cancelled === undefined) p.cancelled = false; });
  // Eski islemleri varsayilan hesaba ata (hesap secimi bu surumden once yoktu)
  (data.transactions || []).forEach((t) => { if (!t.accountId) t.accountId = data.meta.defaultAccountId; });
  (data.payments || []).forEach((p) => { if (!p.accountId) p.accountId = data.meta.defaultAccountId; if (p.appliedTo === undefined) p.appliedTo = []; if (p.cancelled === undefined) p.cancelled = false; });
}

function persist() {
  fs.writeFileSync(DB_PATH, JSON.stringify(cache, null, 2), "utf-8");
}

function save() {
  persist();
}

// Seffaflik icin: her onemli islemi izlenebilir sekilde kaydeder.
// scopeUnitId verilirse, sadece o daireyle iliskili sakinler bu kaydi gorebilir.
function logActivity(data, actor, action, detail, scopeUnitId = null) {
  data.activityLog.unshift({
    id: uid(),
    actorId: actor?.id || "sistem",
    actorName: actor?.name || "Sistem",
    action,
    detail,
    date: new Date().toISOString(),
    scopeUnitId,
  });
  if (data.activityLog.length > 2000) data.activityLog.length = 2000;
}

module.exports = { load, save, uid, logActivity };
