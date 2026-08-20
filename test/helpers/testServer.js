// Test suite'in bootstrap yardimcisi: AYRI bir Postgres veritabanina
// (sakin_test) karsi gercek Express app'i gecici bir portta ayaga kaldirir,
// gercek HTTP istekleriyle (fetch) test etmeyi saglar - bu projede daha
// once elle (curl/tarayici ile) yapilan dogrulamanin otomatiklestirilmis
// hali. Mock YOK: gercek Prisma sorgulari, gercek $transaction'lar, gercek
// JWT auth akisi.
//
// ONEMLI SIRALAMA: DATABASE_URL, server.js/db.js require edilmeden ONCE
// sakin_test'e cevrilmeli - PrismaClient, olusturuldugu anda process.env'i
// okur. server.js kendi ici dotenv.config() cagrisi zaten process.env'de
// olan bir degeri EZMEZ (dotenv varsayilan davranisi), o yuzden bu sira
// yeterli.
require("dotenv").config();
process.env.DATABASE_URL = `postgresql://${process.env.POSTGRES_USER}:${process.env.POSTGRES_PASSWORD}@localhost:${process.env.POSTGRES_PORT || 5432}/sakin_test?schema=public&connection_limit=5&pool_timeout=20`;

const bcrypt = require("bcryptjs");
const app = require("../../server");
const db = require("../../db");
const tenantContext = require("../../lib/tenantContext");

let server;
let baseUrl;

// Test DB'yi her suite basinda temiz bir sayfaya sifirlar - onceki bir
// calismadan kalan veri yuzunden testlerin birbirini etkilemesini onler.
async function truncateAll() {
  const tables = await db.prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations'`;
  if (tables.length === 0) return;
  const names = tables.map((t) => `"${t.tablename}"`).join(", ");
  await db.prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

async function start() {
  await truncateAll();
  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stop() {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.prisma.$disconnect();
}

async function request(method, path, { token, body } = {}) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

// Finans akislarini test etmeye yetecek minimal bir kurulum: 1 site, 1
// yonetici, 1 daire, 1 banka hesabi. prisma/seed.js'teki demo veriden
// kasitli olarak cok daha kucuk - testler kendi ihtiyaclari olan
// charge/payment satirlarini kendileri olusturur.
async function seedFixture() {
  const site = await db.prisma.site.create({
    data: {
      name: "Test Sitesi",
      address: "",
      monthlyDueDefault: 450,
      lateFeeRate: 5,
      lateFeeGraceDays: 10,
      autoDueEnabled: false,
      autoDueDay: 1,
      autoDueAmount: 450,
      defaultAccountId: "test-acc-banka",
      ticketCategories: [],
    },
  });

  return tenantContext.run(site.id, async () => {
    const unit = await db.prisma.unit.create({
      data: { id: "test-u1", block: "A", no: "1", floor: 1, ownerName: "Test Malik", ownerPhone: "", tenantName: "", tenantPhone: "", occupancy: "owner" },
    });
    await db.prisma.account.create({
      data: { id: "test-acc-banka", name: "Test Banka", type: "banka", bankName: "", iban: "", openingBalance: 0 },
    });
    const adminEmail = "test-admin@example.com";
    const adminPassword = "TestAdmin123!";
    const admin = await db.prisma.user.create({
      data: { id: "test-admin", name: "Test Yönetici", email: adminEmail, phone: "", passwordHash: bcrypt.hashSync(adminPassword, 10), role: "yonetici", unitId: null, isApproved: true },
    });
    await db.prisma.userSiteAccess.create({ data: { userId: admin.id, siteId: site.id } });
    return { site, unit, adminEmail, adminPassword };
  });
}

async function login(email, password) {
  const res = await request("POST", "/api/auth/login", { body: { email, password } });
  if (res.status !== 200 || !res.body || !res.body.token) {
    throw new Error("Test login basarisiz: " + JSON.stringify(res.body));
  }
  return res.body.token;
}

module.exports = { start, stop, request, seedFixture, login, truncateAll, db, tenantContext };
