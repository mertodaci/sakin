// Finans akislarinin (odeme, kismi tahsilat, iptal, mukerrer istek koruma,
// gecikme faizi, otomatik aylik borclandirma) gercek Postgres'e ve gercek
// HTTP uclarina karsi calisan entegrasyon testleri - bu projedeki ilk
// otomatik test suite. Once bu dosyayi calistirmadan: `npm test` -
// (pretest script'i sakin_test veritabanini olusturup migre eder).
const test = require("node:test");
const assert = require("node:assert/strict");
const { start, stop, request, seedFixture, login, db, tenantContext } = require("./helpers/testServer");
const { applyLateFees, autoGenerateMonthlyDues } = require("../jobs");

let ctx;

test.before(async () => {
  await start();
  ctx = await seedFixture();
  ctx.token = await login(ctx.adminEmail, ctx.adminPassword);
});

test.after(async () => {
  await stop();
});

async function createCharge(amount, extra = {}) {
  const res = await request("POST", "/api/charges", {
    token: ctx.token,
    body: { unitId: ctx.unit.id, type: "aidat", amount, ...extra },
  });
  assert.equal(res.status, 201, "borç oluşturma başarısız: " + JSON.stringify(res.body));
  return res.body;
}

test("tam ödeme: borcu 'paid' yapar ve makbuz döner", async () => {
  const charge = await createCharge(100, { description: "test-tam-odeme" });

  const pay = await request("POST", "/api/payments/pay", {
    token: ctx.token,
    body: { unitId: ctx.unit.id, amount: 100, method: "Elden", chargeIds: [charge.id] },
  });
  assert.equal(pay.status, 201);
  assert.ok(pay.body.receiptNo);

  const charges = await request("GET", "/api/charges", { token: ctx.token });
  const updated = charges.body.find((c) => c.id === charge.id);
  assert.equal(updated.status, "paid");
  assert.equal(Number(updated.paidAmount), 100);
});

test("kısmi ödeme: borcu 'partial' yapar, kalan borç doğru hesaplanır", async () => {
  const charge = await createCharge(200, { description: "test-kismi-odeme" });

  const pay = await request("POST", "/api/payments/pay", {
    token: ctx.token,
    body: { unitId: ctx.unit.id, amount: 80, method: "Elden", chargeIds: [charge.id] },
  });
  assert.equal(pay.status, 201);

  const charges = await request("GET", "/api/charges", { token: ctx.token });
  const updated = charges.body.find((c) => c.id === charge.id);
  assert.equal(updated.status, "partial");
  assert.equal(Number(updated.paidAmount), 80);
});

test("ödeme iptali: borcu yeniden açar, muhasebe hareketini siler", async () => {
  const charge = await createCharge(150, { description: "test-iptal" });

  const pay = await request("POST", "/api/payments/pay", {
    token: ctx.token,
    body: { unitId: ctx.unit.id, amount: 150, method: "Elden", chargeIds: [charge.id] },
  });
  assert.equal(pay.status, 201);
  const paymentId = pay.body.id;
  const transactionId = pay.body.transactionId;

  const cancel = await request("POST", `/api/payments/${paymentId}/cancel`, { token: ctx.token });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));

  const charges = await request("GET", "/api/charges", { token: ctx.token });
  const updated = charges.body.find((c) => c.id === charge.id);
  assert.equal(updated.status, "unpaid");
  assert.equal(Number(updated.paidAmount), 0);

  const txns = await request("GET", "/api/transactions", { token: ctx.token });
  assert.ok(!txns.body.some((t) => t.id === transactionId), "iptal edilen ödemenin muhasebe hareketi hâlâ duruyor");

  // Zaten iptal edilmis bir odemeyi tekrar iptal etmeye calismak 400 donmeli.
  const secondCancel = await request("POST", `/api/payments/${paymentId}/cancel`, { token: ctx.token });
  assert.equal(secondCancel.status, 400);
});

test("mükerrer istek koruması: aynı requestId iki kez gönderilirse ikincisi 409 döner ve borç sadece BİR kez kapanır", async () => {
  const charge = await createCharge(100, { description: "test-idempotency" });
  const requestId = "test-idem-" + Date.now();

  const first = await request("POST", "/api/payments/pay", {
    token: ctx.token,
    body: { unitId: ctx.unit.id, amount: 100, method: "Elden", chargeIds: [charge.id], requestId },
  });
  assert.equal(first.status, 201);

  const second = await request("POST", "/api/payments/pay", {
    token: ctx.token,
    body: { unitId: ctx.unit.id, amount: 100, method: "Elden", chargeIds: [charge.id], requestId },
  });
  assert.equal(second.status, 409);

  const payments = await request("GET", "/api/payments", { token: ctx.token });
  const matching = payments.body.filter((p) => p.receiptNo === first.body.receiptNo);
  assert.equal(matching.length, 1, "aynı requestId ile birden fazla ödeme oluşmuş");
});

test("gecikme faizi: vadesi geçmiş borca bir kez uygulanır, aynı dönemde tekrar uygulanmaz", async () => {
  // Once kasitli olarak vadesi COK gecmis (grace period'un da otesinde) bir borc
  // olusturuyoruz - normal POST /api/charges dueDate'i "simdi" atadigi icin
  // dogrudan Prisma ile eski bir dueDate yaziyoruz.
  const overdue = await tenantContext.run(ctx.site.id, () =>
    db.prisma.charge.create({
      data: {
        unitId: ctx.unit.id,
        type: "aidat",
        period: "2020-01",
        amount: 100,
        dueDate: new Date("2020-01-01"),
        status: "unpaid",
        paidAmount: 0,
        lateFeeAppliedPeriods: [],
        description: "test-gecikme-faizi",
      },
    })
  );

  const site = await db.prisma.site.findUniqueOrThrow({ where: { id: ctx.site.id } });
  const appliedFirst = await tenantContext.run(ctx.site.id, () => applyLateFees(site));
  assert.ok(appliedFirst >= 1, "en az bir gecikme faizi uygulanmalıydı");

  const feeCharges = await tenantContext.run(ctx.site.id, () =>
    db.prisma.charge.findMany({ where: { unitId: ctx.unit.id, type: "gecikme_faizi" } })
  );
  assert.equal(feeCharges.length, 1, "tam olarak bir gecikme faizi kalemi oluşmalıydı");
  assert.equal(Number(feeCharges[0].amount), 5); // %5 * 100

  // Ayni ay icinde tekrar cagrilirsa (orn. sunucu yeniden baslarsa) YENIDEN
  // UYGULANMAMALI - jobs.js'teki lateFeeAppliedPeriods kontrolu.
  const appliedSecond = await tenantContext.run(ctx.site.id, () => applyLateFees(site));
  assert.equal(appliedSecond, 0, "aynı dönem için gecikme faizi ikinci kez uygulandı");

  const feeChargesAfter = await tenantContext.run(ctx.site.id, () =>
    db.prisma.charge.findMany({ where: { unitId: ctx.unit.id, type: "gecikme_faizi" } })
  );
  assert.equal(feeChargesAfter.length, 1, "gecikme faizi mükerrer oluşmuş");
});

test("otomatik aylık borçlandırma: her daireye bir kez uygulanır, aynı dönem için tekrar uygulanmaz", async () => {
  // Ikinci bir daire ekleyelim ki "tum dairelere" davranisi da gorunsun.
  const unit2 = await tenantContext.run(ctx.site.id, () =>
    db.prisma.unit.create({ data: { id: "test-u2", block: "A", no: "2", floor: 1, ownerName: "Test Malik 2", ownerPhone: "", tenantName: "", tenantPhone: "", occupancy: "owner" } })
  );

  const siteBefore = await db.prisma.site.findUniqueOrThrow({ where: { id: ctx.site.id } });
  // autoDueEnabled fixture'da false - bu testte acikca true yapip deneyelim.
  await db.prisma.site.update({ where: { id: ctx.site.id }, data: { autoDueEnabled: true, autoDueDay: 1, lastAutoDuePeriod: null } });
  const site = await db.prisma.site.findUniqueOrThrow({ where: { id: ctx.site.id } });

  const created = await tenantContext.run(ctx.site.id, () => autoGenerateMonthlyDues(site));
  assert.ok(created >= 2, "en az iki daireye (test-u1 + test-u2) aidat borcu oluşmalıydı");

  const period = new Date().toISOString().slice(0, 7);
  const duesForUnit2 = await tenantContext.run(ctx.site.id, () =>
    db.prisma.charge.findMany({ where: { unitId: unit2.id, type: "aidat", period } })
  );
  assert.equal(duesForUnit2.length, 1);

  // Ayni donem icin tekrar cagrilirsa (lastAutoDuePeriod kontrolu) YENIDEN
  // OLUSTURULMAMALI.
  const siteAfter = await db.prisma.site.findUniqueOrThrow({ where: { id: ctx.site.id } });
  const createdSecond = await tenantContext.run(ctx.site.id, () => autoGenerateMonthlyDues(siteAfter));
  assert.equal(createdSecond, 0, "aynı dönem için aidat borcu ikinci kez oluşturuldu");

  await db.prisma.site.update({ where: { id: ctx.site.id }, data: { autoDueEnabled: siteBefore.autoDueEnabled, lastAutoDuePeriod: siteBefore.lastAutoDuePeriod } });
});
