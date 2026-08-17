// Coklu-kiracili (multi-tenant) donusumun kalbi: kiracili (site-bazli) her
// modele HER Prisma sorgusunda otomatik siteId filtresi/degeri ekleyen bir
// Prisma Client Extension. Tek bir yerde (burada) devreye alindigi icin
// db.js'in generic prisma[modelName].findMany()/upsert() gibi dinamik
// cagrilari (legacy shim) dahil UYGULAMADAKI HER Prisma cagrisi otomatik
// kapsanir - route dosyalarinin where'lerine tek tek siteId eklemeye
// gerek YOK.
//
// ONEMLI SINIRLAMA: extension'lar Prisma'nin ic ice (nested) iliskisel
// yazmalarini (orn. `prisma.payment.create({data:{...,allocations:
// {create:[...]}}})`) YAKALAMAZ - sadece en dista cagrilan operasyonu
// gorur. Bu yuzden boyle bir yazim asla kullanilmamali; her satir kendi
// duz (ayri) .create() cagrisiyla yazilmali (bkz. db.js'in kendi
// syncChildren'inin zaten yaptigi desen). Bu kurala uyulmazsa, ya
// siteId eksik oldugu icin DB hatasi (NOT NULL ihlali - guvenli, gurultulu)
// ya da (daha kotusu, eger siteId nullable birakilsaydi) sessiz bir
// kiracilar-arasi veri sizintisi olurdu.
const { PrismaClient, Prisma } = require("@prisma/client");
const { isTenantModel } = require("./tenantScope");

const WHERE_FILTER_OPS = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "deleteMany",
]);
// findUnique/update/delete: Prisma'nin "genisletilmis unique where" ozelligi
// sayesinde, tekil alanla (id) BIRLIKTE ekstra (unique olmayan) filtre
// eklenebilir - baska bir site'a ait id verilirse null/P2025 doner, asla
// yanlis site'in verisi sizmaz.
const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete"]);

// getSiteId: () => string - baglami nereden okuyacagini disaridan alir.
// Uygulama icin tenantContext.getSiteId (AsyncLocalStorage), tek-seferlik
// scriptler (prisma/seed.js) icin sabit bir deger dondurebilir.
function withTenantScope(rawClient, getSiteId) {
  return rawClient.$extends({
    name: "tenantScope",
    query: {
      $allOperations({ model, operation, args, query }) {
        if (!isTenantModel(model)) return query(args);
        const siteId = getSiteId();

        if (WHERE_FILTER_OPS.has(operation)) {
          args.where = { ...(args.where || {}), siteId };
        } else if (UNIQUE_WHERE_OPS.has(operation)) {
          args.where = { ...(args.where || {}), siteId };
        } else if (operation === "create") {
          args.data = { ...(args.data || {}), siteId };
        } else if (operation === "createMany") {
          if (Array.isArray(args.data)) args.data = args.data.map((d) => ({ ...d, siteId }));
        } else if (operation === "upsert") {
          args.where = { ...(args.where || {}), siteId };
          args.create = { ...(args.create || {}), siteId };
        }
        return query(args);
      },
    },
  });
}

const { getSiteId } = require("./tenantContext");
const rawClient = new PrismaClient();
const scopedClient = withTenantScope(rawClient, getSiteId);

module.exports = scopedClient;
module.exports.raw = rawClient;
module.exports.withTenantScope = withTenantScope;
module.exports.Prisma = Prisma;
