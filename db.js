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
const { PrismaClient, Prisma } = require("@prisma/client");
const { randomUUID } = require("crypto");

const prisma = new PrismaClient();

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

async function loadMeta() {
  const s = await prisma.settings.findUniqueOrThrow({ where: { id: "singleton" } });
  const plain = toPlain(s);
  const { id, ticketCategories, ...meta } = plain;
  return { meta, ticketCategories };
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
  const rows = await prisma.survey.findMany({ include: { options: true, votes: true } });
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

// LEGACY_COLLECTIONS: henuz kendi route'unda Prisma'ya tasinmamis her
// koleksiyon icin { load, save, order } tanimlar. `order` upsert sirasini
// belirler (parent'lar once); save() sirasinda silinmesi gereken satirlar
// TERS sirada silinir (child'lar once) - boylece FK kisitlari ihlal edilmez.
const LEGACY_COLLECTIONS = [
  { name: "units", model: "unit", load: simple("unit") },
  { name: "accounts", model: "account", load: simple("account") },
  { name: "facilities", model: "facility", load: simple("facility") },
  { name: "vendors", model: "vendor", load: simple("vendor") },
  { name: "personnel", model: "personnel", load: simple("personnel") },
  { name: "equipment", model: "equipment", load: loadEquipment, children: [{ field: "maintenanceHistory", model: "maintenanceRecord", parentField: "equipmentId" }] },
  { name: "meters", model: "meter", load: simple("meter") },
  { name: "charges", model: "charge", load: simple("charge") },
  { name: "meterReadings", model: "meterReading", load: simple("meterReading") },
  { name: "transactions", model: "transaction", load: simple("transaction") },
  { name: "payments", model: "payment", load: loadPayments, children: [{ field: "appliedTo", model: "paymentAllocation", parentField: "paymentId", mapCreate: (a, parentId) => ({ paymentId: parentId, chargeId: a.chargeId, amount: a.amount }) }] },
  { name: "partyCharges", model: "partyCharge", load: simple("partyCharge") },
  { name: "partyPayments", model: "partyPayment", load: loadPartyPayments, children: [{ field: "appliedTo", model: "partyPaymentAllocation", parentField: "partyPaymentId", mapCreate: (a, parentId) => ({ partyPaymentId: parentId, partyChargeId: a.chargeId, amount: a.amount }) }] },
  { name: "transfers", model: "transfer", load: simple("transfer") },
  { name: "reservations", model: "reservation", load: simple("reservation") },
  { name: "tickets", model: "ticket", load: loadTickets, children: [{ field: "comments", model: "ticketComment", parentField: "ticketId" }] },
  { name: "announcements", model: "announcement", load: simple("announcement") },
  { name: "surveys", model: "survey", load: loadSurveys, children: [
    { field: "options", model: "surveyOption", parentField: "surveyId", mapCreate: (o, parentId) => ({ surveyId: parentId, text: o.text, votes: o.votes }) },
    { field: "votedBy", model: "surveyVote", parentField: "surveyId", mapCreate: (userId, parentId) => ({ surveyId: parentId, userId }) },
  ] },
  { name: "packages", model: "package", load: simple("package") },
  { name: "decisions", model: "decision", load: simple("decision") },
  { name: "keys", model: "key", load: loadKeys, children: [{ field: "history", model: "keyAssignment", parentField: "keyId" }] },
  { name: "classifieds", model: "classifieds", load: simple("classifieds") },
  { name: "notifications", model: "notification", load: simple("notification") },
  { name: "activityLog", model: "activityLog", load: loadActivityLog },
  { name: "budgets", model: "budget", load: simple("budget") },
  { name: "contacts", model: "contact", load: simple("contact") },
];

// Salt-okunur passthrough: bir koleksiyon kendi route'unda Prisma'ya
// tasindiktan sonra buraya eklenir - artik burada YAZILMAZ (kendi route'u
// yazar), ama hala eski data.xxx seklini bekleyen baska legacy route'lar
// (orn. dashboard.js, system.js /export) icin load()'da sunulmaya devam eder.
const READONLY_PASSTHROUGH = [
  // users: routes/auth.js ve routes/directory.js'nin kullanici mutasyonu
  // yapan uclari artik dogrudan Prisma kullaniyor (bkz. db.prisma.user).
  // Burada sadece hala data.users okuyan diger legacy route'lar (dashboard,
  // comms, ops, jobs, system/export) icin salt-okunur olarak sunuluyor.
  { name: "users", load: loadUsers },
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

async function save(data) {
  await prisma.$transaction(
    async (tx) => {
      await tx.settings.update({
        where: { id: "singleton" },
        data: { ...data.meta, ticketCategories: data.ticketCategories },
      });

      for (const def of LEGACY_COLLECTIONS) {
        await saveCollection(tx, def, data[def.name]);
      }

      const currentRequestIds = data.usedPaymentRequestIds || [];
      const existing = await tx.paymentRequest.findMany({ select: { id: true } });
      const existingIds = existing.map((r) => r.id);
      const toAdd = currentRequestIds.filter((id) => !existingIds.includes(id));
      for (const id of toAdd) await tx.paymentRequest.create({ data: { id } });
      const toRemove = existingIds.filter((id) => !currentRequestIds.includes(id));
      if (toRemove.length) await tx.paymentRequest.deleteMany({ where: { id: { in: toRemove } } });
    },
    { timeout: 30000 }
  );
}

// Legacy route'larda kullanilan senkron desen: data.activityLog dizisine
// mutasyon yapar, gercek yazma save() cagrisinda gerceklesir. Prisma'ya
// tasinmis route'lar bunun yerine dogrudan prisma.activityLog.create(...)
// kullanir (bkz. routes/auth.js, routes/contacts.js, routes/finance.js).
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
}

module.exports = { load, save, uid, logActivity, prisma };
