// Coklu-kiracili (multi-tenant) donusum: bir HTTP istegi boyunca "hangi
// site'a bakiyoruz" bilgisini, o istegin icindeki her fonksiyon cagrisina
// (middleware -> route handler -> icindeki Prisma cagrilarina, $transaction
// callback'leri dahil) elle parametre olarak tasimadan ulastirmak icin
// Node'un yerlesik AsyncLocalStorage'i kullanilir. middleware/auth.js'teki
// requireAuth, her istegin basinda run(siteId, ...) ile bu baglami acar;
// lib/prismaClient.js'teki extension her Prisma sorgusunda getSiteId() ile
// bu baglami okur.
const { AsyncLocalStorage } = require("async_hooks");

const storage = new AsyncLocalStorage();

// ONEMLI: fn'i her zaman kendi ICINDE await eden bir async sarmalayici
// uzerinden cagiriyoruz - `fn` async olmayan, dogrudan bir Prisma cagrisi
// dondururken (orn. `() => prisma.unit.findMany()`) VE cagiran taraf
// run()'un DONUS DEGERINI DISARIDAN await ederse, AsyncLocalStorage baglami
// Prisma'nin "tembel" (lazy) promise'i gercekten calismaya basladiginda
// (run()'un senkron penceresi kapandiktan SONRA) kaybolabiliyor - bizzat
// test edilip dogrulandi. `fn`'i burada await etmek, `fn` ister async ister
// duz bir Prisma cagrisi dondursun, baglamin dogru yayilmasini garantiler.
function run(siteId, fn) {
  return storage.run({ siteId }, async () => {
    return await fn();
  });
}

// Aktif baglam yoksa (orn. requireAuth disinda, yanlislikla veya bilinmeyen
// bir yerden cagrilan bir kiracili-model sorgusu) ACIKCA hata firlatir -
// sessizce "site filtresi yok" durumuna dusup veri sizdirmak yerine.
function getSiteId() {
  const store = storage.getStore();
  if (!store || !store.siteId) {
    throw new Error(
      "Tenant baglami (siteId) ayarlanmamis - bu kod requireAuth/tenantContext.run() disinda mi calisiyor?"
    );
  }
  return store.siteId;
}

module.exports = { run, getSiteId };
