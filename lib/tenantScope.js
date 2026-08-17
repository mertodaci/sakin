// Deny-list: bu 4 model DISINDAKI HER Prisma modeli kiracili (site-bazli)
// sayilir ve otomatik siteId filtresi alir (bkz. lib/prismaClient.js).
// Allow-list DEGIL, bilerek: allow-list "fail open" olur (yeni bir model
// eklenip buraya eklenmesi unutulursa sessizce sizdirir); deny-list
// "fail closed" olur (unutulan yeni model ilk sorguda gurultulu sekilde
// patlar - guvenli taraf, bkz. tenantContext.getSiteId()).
// Settings: henuz siteId'si YOK (Site'a devri Asama 5+'ta yapilacak, bkz.
// ROADMAP) - bu yuzden simdilik global kalmali, aksi halde her sorgu
// "bilinmeyen alan" hatasi verir.
const GLOBAL_MODELS = new Set(["Site", "UserSiteAccess", "User", "PaymentRequest", "Settings"]);

function isTenantModel(modelName) {
  return Boolean(modelName) && !GLOBAL_MODELS.has(modelName);
}

module.exports = { GLOBAL_MODELS, isTenantModel };
