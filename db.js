// Postgres/Prisma uzerinden calisan, eski dosya-tabanli db.js ile AYNI disa
// aktarim seklini ({ load, save, uid, logActivity }) koruyan bir "shim".
//
// Amac: henuz kendi Prisma sorgularina tasinmamis route dosyalari
// (routes/ops.js, comms.js, parties.js, documents.js, settings.js,
// system.js vb.) tek satir bile degismeden calismaya devam etsin. Bu
// dosyalar hala eskisi gibi `const data = await db.load(); ...mutasyon...;
// await db.save();` deseniyle calisir - load() butun "legacy" koleksiyonlari
// Postgres'ten okuyup eski JSON sekliyle birlestirir, save() ayni koleksiyon
// setini (mevcut haliyle) tek bir transaction icinde Postgres'e geri yazar.
//
// Zaten Prisma'ya tasinmis route'lar (auth, contacts, finance...) bu
// dosyayi KULLANMAZ, dogrudan kendi Prisma sorgularini yazar. Bir
// koleksiyon tasindikca LEGACY_COLLECTIONS listesinden cikarilir ve
// load()'a salt-okunur bir "passthrough" eklenir (cunku export/dashboard
// gibi hala tasinmamis baska route'lar o veriyi okumaya devam eder).
const { randomUUID } = require("crypto");
const prisma = require("./lib/prismaClient");
const tenantContext = require("./lib/tenantContext");
const { Prisma } = prisma;

function uid() {
  return randomUUID();
}

// Prisma'nin dondurdugu Decimal/Date nesnelerini eski JSON dosyasindaki
// gibi duz sayi/ISO-string degerlere cevirir - boylece legacy route'lardaki
// `c.amount - c.paidAmount` gibi duz aritmetik/karsilastirma kodu hicbir
// degisiklik gerektirmez.
function toPlain(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value)) out[k] = toPlain(value[k]);
    return out;
  }
  return value;
}

/* =========================================================================
   LOAD: her koleksiyonu Postgres'ten okuyup eski JSON sekline donusturur
   ========================================================================= */

// DIKKAT: eskiden burasi global, TEK satirlik Settings singleton'ini
// okuyordu - coklu-kiraci donusumunden sonra bu, HER sitenin "ayarlar"
// (bina adi/adres/gecikme faizi/varsayilan hesap vb.) icin AYNI satiri
// gormesi demekti (siteler-arasi sizinti + belge/PDF'lerde yanlis site
// bilgisi). Artik cagiran istegin kendi tenant baglamindaki Site satirini
// okur - eski Settings modeli (hicbir route okumuyor/yazmiyordu) semadan
// tamamen kaldirildi (2026-08-20).
async function loadMeta() {
  const s = await prisma.site.findUniqueOrThrow({ where: { id: tenantContext.getSiteId() } });
  const plain = toPlain(s);
  const { id, name, inviteCode, active, createdAt, ticketCategories, ...meta } = plain;
  return { meta: { buildingName: name, ...meta }, ticketCategories };
}

async function loadUsers() {
  return (await prisma.user.findMany()).map(toPlain);
}

async function loadPayments() {
  const rows = await prisma.payment.findMany({ include: { allocations: true } });
  return rows.map((p) => {
    const plain = toPlain(p);
    plain.appliedTo = plain.allocations.map((a) => ({ chargeId: a.chargeId, amount: a.amount }));
    delete plain.allocations;
    return plain;
  });
}

async function loadPartyPayments() {
  const rows = await prisma.partyPayment.findMany({ include: { allocations: true } });
  return rows.map((p) => {
    const plain = toPlain(p);
    plain.appliedTo = plain.allocations.map((a) => ({ chargeId: a.partyChargeId, amount: a.amount }));
    delete plain.allocations;
    return plain;
  });
}

async function loadSurveys() {
  const rows = await prisma.survey.findMany({ include: { options: { orderBy: [{ position: "asc" }, { id: "asc" }] }, votes: true } });
  return rows.map((s) => {
    const plain = toPlain(s);
    plain.options = plain.options.map((o) => ({ text: o.text, votes: o.votes }));
    plain.votedBy = plain.votes.map((v) => v.userId);
    delete plain.votes;
    return plain;
  });
}

async function loadTickets() {
  const rows = await prisma.ticket.findMany({ include: { comments: true } });
  return rows.map((t) => {
    const plain = toPlain(t);
    plain.comments = plain.comments.map((c) => ({ id: c.id, userId: c.userId, text: c.text, date: c.date }));
    return plain;
  });
}

async function loadEquipment() {
  const rows = await prisma.equipment.findMany({ include: { maintenanceHistory: true } });
  return rows.map((e) => {
    const plain = toPlain(e);
    plain.maintenanceHistory = plain.maintenanceHistory.map((m) => ({ id: m.id, date: m.date, by: m.by, notes: m.notes }));
    return plain;
  });
}

async function loadKeys() {
  const rows = await prisma.key.findMany({ include: { history: true } });
  return rows.map((k) => {
    const plain = toPlain(k);
    plain.history = plain.history.map((h) => ({ id: h.id, holderName: h.holderName, givenDate: h.givenDate, returnedDate: h.returnedDate }));
    return plain;
  });
}

async function loadActivityLog() {
  return (await prisma.activityLog.findMany({ orderBy: { date: "desc" } })).map(toPlain);
}

async function loadUsedPaymentRequestIds() {
  return (await prisma.paymentRequest.findMany()).map((p) => p.id);
}

const simple = (model) => async () => (await prisma[model].findMany()).map(toPlain);

// Postgres'te orderBy verilmeden gelen sira kararli degildir (fiziksel satir
// sirasina bagli, UPDATE sonrasi degisebilir) - daire listesi her ekranda
// (Daireler, Aidat Takibi, dropdown'lar) blok/no'ya gore tutarli sirada
// gorunsun diye acikca sirali okunuyor.
async function loadUnits() {
  return (await prisma.unit.findMany({ orderBy: [{ block: "asc" }, { no: "asc" }] })).map(toPlain);
}

// LEGACY_COLLECTIONS: henuz kendi route'unda Prisma'ya tasinmamis her
// koleksiyon icin { load, save, order } tanimlar. `order` upsert sirasini
// belirler (parent'lar once); save() sirasinda silinmesi gereken satirlar
// TERS sirada silinir (child'lar once) - boylece FK kisitlari ihlal edilmez.
// BOS: son kalan 5 koleksiyon da (units/accounts/personnel/transfers/
// budgets - directory.js/accounts.js/accounting.js/finance.js) dogrudan
// Prisma'ya tasindi (2026-08-20). Asagida READONLY_PASSTHROUGH'a tasindilar
// - load() ile OKUNMAYA devam ediyorlar (dashboard/documents/comms/system
// export gibi hala data.xxx bekleyen legacy route'lar icin), sadece
// buradan (yazma tarafi) kaldirildilar. Dizi bilerek bos birakildi (silinmedi)
// - save()'in "touchedCollections verilmezse geriye donuk uyumluluk icin
// TUM koleksiyonlari yaz" guvenlik agi hala calisir (bos dizide no-op).
const LEGACY_COLLECTIONS = [];

// Salt-okunur passthrough: bir koleksiyon kendi route'unda Prisma'ya
// tasindiktan sonra buraya eklenir - artik burada YAZILMAZ (kendi route'u
// yazar), ama hala eski data.xxx seklini bekleyen baska legacy route'lar
// (orn. dashboard.js, system.js /export) icin load()'da sunulmaya devam eder.
const READONLY_PASSTHROUGH = [
  // units/accounts/personnel/transfers/budgets: yazma taraflari (directory.js,
  // accounts.js, accounting.js, finance.js) artik dogrudan Prisma kullaniyor
  // (2026-08-20). Burada hala data.units/data.accounts/vb. okuyan cok sayida
  // rapor/legacy route (accounting.js'nin mizan/fisler/kod-atama-goruntuleme
  // uclari, comms.js, dashboard.js, directory.js'nin GET uclari, documents.js,
  // finance.js'nin budget/report uclari, system.js /export) icin salt-okunur
  // olarak sunuluyor.
  { name: "units", load: loadUnits },
  { name: "accounts", load: simple("account") },
  { name: "personnel", load: simple("personnel") },
  { name: "transfers", load: simple("transfer") },
  { name: "budgets", load: simple("budget") },
  // users: routes/auth.js ve routes/directory.js'nin kullanici mutasyonu
  // yapan uclari artik dogrudan Prisma kullaniyor (bkz. db.prisma.user).
  // Burada sadece hala data.users okuyan diger legacy route'lar (dashboard,
  // comms, ops, jobs, system/export) icin salt-okunur olarak sunuluyor.
  { name: "users", load: loadUsers },
  // contacts: routes/contacts.js artik dogrudan Prisma kullaniyor. Burada
  // sadece system.js'nin /export ucu icin salt-okunur olarak sunuluyor.
  { name: "contacts", load: simple("contact") },
  // charges/payments/transactions: routes/finance.js'in cekirdek uclari artik
  // dogrudan Prisma kullaniyor. Burada hala data.charges/data.payments/
  // data.transactions okuyan legacy route'lar (directory.js unitDebt,
  // finance.js /budgets, system.js /export) icin salt-okunur olarak
  // sunuluyor. YAZMA icin kullanilmamali - jobs.js, ops.js, parties.js
  // gibi yazma yapan legacy route'lar dogrudan Prisma cagrisina cevrildi.
  { name: "charges", load: simple("charge") },
  { name: "payments", load: loadPayments },
  { name: "transactions", load: simple("transaction") },
  // vendors/partyCharges/partyPayments: routes/parties.js ve jobs.js'in
  // materializeRecurringPartyCharges'i artik dogrudan Prisma kullaniyor.
  // Burada hala data.vendors/data.partyCharges/data.partyPayments okuyan
  // rapor uclari (finance.js, accounting.js, documents.js, dashboard.js)
  // icin salt-okunur olarak sunuluyor.
  { name: "vendors", load: simple("vendor") },
  { name: "partyCharges", load: simple("partyCharge") },
  { name: "partyPayments", load: loadPartyPayments },
  // facilities/equipment/meters/meterReadings/reservations/tickets/packages/
  // decisions/keys: routes/ops.js artik dogrudan Prisma kullaniyor. Burada
  // hala data.xxx okuyan dashboard.js ve system.js /export icin salt-okunur
  // olarak sunuluyor - export'un TUM koleksiyonlari icermesi gerektigi icin
  // (bkz. system.js: `const {usedPaymentRequestIds, ...exportable} = data`)
  // bu koleksiyonlar load()'dan tamamen kaldirilamaz, sadece yazma tarafi
  // (LEGACY_COLLECTIONS) kapatilir.
  { name: "facilities", load: simple("facility") },
  { name: "equipment", load: loadEquipment },
  { name: "meters", load: simple("meter") },
  { name: "meterReadings", load: simple("meterReading") },
  { name: "reservations", load: simple("reservation") },
  { name: "tickets", load: loadTickets },
  { name: "packages", load: simple("package") },
  { name: "decisions", load: simple("decision") },
  { name: "keys", load: loadKeys },
  // announcements/surveys/classifieds/notifications: routes/comms.js artik
  // dogrudan Prisma kullaniyor. Burada dashboard.js (notifications) ve
  // system.js /export icin salt-okunur olarak sunuluyor.
  { name: "announcements", load: simple("announcement") },
  { name: "surveys", load: loadSurveys },
  { name: "classifieds", load: simple("classifieds") },
  { name: "notifications", load: simple("notification") },
  // activityLog: logActivity() artik dogrudan prisma.activityLog.create()
  // ile yazar (asagida) - eskiden HER db.save() cagrisi (touchedCollections
  // ne olursa olsun) butun activityLog gecmisini satir satir yeniden
  // upsert ediyordu, bu da yillar icinde buyuyen tabloyu her mutasyonda
  // (ozellikle documents.js'teki 10 PDF/CSV indirme ucunda) O(N) maliyetli
  // yapiyordu - 10 bin kullanicida en buyuk performans riski buydu. Burada
  // sadece system.js /activity-log ve /export gibi hala data.activityLog
  // okuyan legacy route'lar icin salt-okunur olarak sunuluyor.
  { name: "activityLog", load: loadActivityLog },
];

async function load() {
  const { meta, ticketCategories } = await loadMeta();
  const entries = await Promise.all(LEGACY_COLLECTIONS.map((c) => c.load()));
  const readonlyEntries = await Promise.all(READONLY_PASSTHROUGH.map((c) => c.load()));

  const data = { meta, ticketCategories, usedPaymentRequestIds: await loadUsedPaymentRequestIds() };
  LEGACY_COLLECTIONS.forEach((c, i) => (data[c.name] = entries[i]));
  READONLY_PASSTHROUGH.forEach((c, i) => (data[c.name] = readonlyEntries[i]));
  return data;
}

/* =========================================================================
   SAVE: mevcut in-memory `data` objesini Postgres'e geri yazar (upsert +
   dizide artik olmayan kayitlari silme). Her save() cagrisi TUM legacy
   koleksiyonlari yeniden esitler - eski db.js'in her save()'de butun
   dosyayi yeniden yazmasiyla ayni yaklasim, sadece tek dosya yerine
   tek bir Postgres transaction'i icinde tablo tablo yapilir.
   ========================================================================= */

async function syncChildren(tx, child, parentId, items) {
  await tx[child.model].deleteMany({ where: { [child.parentField]: parentId } });
  for (const item of items || []) {
    const createData = child.mapCreate ? child.mapCreate(item, parentId) : { ...item, [child.parentField]: parentId };
    delete createData.id;
    await tx[child.model].create({ data: createData });
  }
}

async function saveCollection(tx, def, rows) {
  const ids = rows.map((r) => r.id);
  for (const row of rows) {
    const fields = { ...row };
    const childDefs = def.children || [];
    childDefs.forEach((c) => delete fields[c.field]);
    await tx[def.model].upsert({ where: { id: row.id }, create: fields, update: fields });
    for (const child of childDefs) {
      await syncChildren(tx, child, row.id, row[child.field]);
    }
  }
  await tx[def.model].deleteMany({ where: { id: { notIn: ids } } });
}

const LEGACY_COLLECTION_NAMES = LEGACY_COLLECTIONS.map((c) => c.name);

// touchedCollections: cagiran route'un GERCEKTEN mutasyona ugrattigi
// koleksiyon adlarinin listesi. save() SADECE bunlari Postgres'e yeniden
// yazar - eskiden butun 20+ legacy koleksiyon her save()'de yeniden
// yazilirdi, bu da alakasiz eszamanli isteklerin birbirinin verisini sessizce
// silmesine/geri almasina yol aciyordu (bkz. ROADMAP.md "Iş Akışı Bütünlüğü").
// touchedCollections verilmezse (eski cagri tarzi) geriye donuk uyumluluk icin
// TUM koleksiyonlar yazilir - ama tum call site'lar bu fonksiyonun yaninda
// guncellendigi icin bu sadece bir guvenlik agi, kullanilmamasi beklenir.
async function save(data, touchedCollections) {
  const names = touchedCollections === undefined ? LEGACY_COLLECTION_NAMES : touchedCollections;
  const defs = LEGACY_COLLECTIONS.filter((c) => names.includes(c.name));

  await prisma.$transaction(
    async (tx) => {
      if (names.includes("meta")) {
        const { buildingName, ...rest } = data.meta;
        await tx.site.update({
          where: { id: tenantContext.getSiteId() },
          data: { ...rest, name: buildingName, ticketCategories: data.ticketCategories },
        });
      }

      for (const def of defs) {
        await saveCollection(tx, def, data[def.name]);
      }

      if (names.includes("usedPaymentRequestIds")) {
        const currentRequestIds = data.usedPaymentRequestIds || [];
        const existing = await tx.paymentRequest.findMany({ select: { id: true } });
        const existingIds = existing.map((r) => r.id);
        const toAdd = currentRequestIds.filter((id) => !existingIds.includes(id));
        for (const id of toAdd) await tx.paymentRequest.create({ data: { id } });
        const toRemove = existingIds.filter((id) => !currentRequestIds.includes(id));
        if (toRemove.length) await tx.paymentRequest.deleteMany({ where: { id: { in: toRemove } } });
      }
    },
    { timeout: 30000 }
  );
}

// Net bakiye: acik borclarin toplami - dairenin alacakli bakiyesi (Unit.
// creditBalance). Pozitifse borclu, negatifse alacakli. `data` load()'un
// dondurdugu sekil (data.charges + data.units) - hala legacy shim uzerinden
// okuyan tum route'lar (directory, dashboard, documents, comms) bunu
// paylasir, boylece netleme kurali tek yerde degisir.
function netDebt(data, unitId) {
  const openSum = data.charges
    .filter((c) => c.unitId === unitId && c.status !== "paid")
    .reduce((sum, c) => sum + (c.amount - c.paidAmount), 0);
  const unit = data.units.find((u) => u.id === unitId);
  return openSum - (unit?.creditBalance || 0);
}

// Dogrudan Postgres'e yazar (tek satirlik create) - eskiden data.activityLog
// dizisine mutasyon yapip gercek yazmayi save()'e birakiyordu, bu da save()'in
// HER cagrisinda butun activityLog gecmisini yeniden upsert etmesine yol
// aciyordu (bkz. LEGACY_COLLECTIONS yorumu). Artik Prisma'ya tasinmis
// route'larla (auth.js, finance.js vb.) ayni desen: tek satir, tek create.
async function logActivity(actor, action, detail, scopeUnitId = null) {
  await prisma.activityLog.create({
    data: {
      actorId: actor?.id || "sistem",
      actorName: actor?.name || "Sistem",
      action,
      detail,
      scopeUnitId,
    },
  });
}

module.exports = { load, loadMeta, save, uid, logActivity, netDebt, prisma };
