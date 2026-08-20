// Test suite'ten once (npm test'in pretest'i) calisir: sakin_test
// veritabaninin var oldugundan ve tum migration'larin uygulandigindan emin
// olur. Idempotent'tir - veritabani zaten varsa/migre edilmisse zararsizca
// tekrar calisir. Kullanim: node scripts/setup-test-db.js
require("dotenv").config();
const { execSync } = require("child_process");

const { POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_PORT } = process.env;
const TEST_DB = "sakin_test";
const TEST_DATABASE_URL = `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:${POSTGRES_PORT || 5432}/${TEST_DB}?schema=public&connection_limit=5&pool_timeout=20`;

function run(cmd, opts = {}) {
  return execSync(cmd, { stdio: "pipe", ...opts }).toString();
}

try {
  run(`docker exec sakin-postgres createdb -U ${POSTGRES_USER} ${TEST_DB}`);
  console.log(`[setup-test-db] "${TEST_DB}" veritabanı oluşturuldu.`);
} catch (e) {
  // createdb, veritabani zaten varsa hata koduyla cikar - bu beklenen/zararsiz durum.
  if (!/already exists/i.test(e.stdout?.toString() || e.message)) {
    console.error("[setup-test-db] Test veritabanı oluşturulamadı:", e.stdout?.toString() || e.message);
    process.exit(1);
  }
}

try {
  run("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } });
  console.log("[setup-test-db] Migration'lar uygulandı.");
} catch (e) {
  console.error("[setup-test-db] Migration hatası:", e.stdout?.toString() || e.message);
  process.exit(1);
}
