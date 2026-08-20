// Deny-list: bu 4 model DISINDAKI HER Prisma modeli kiracili (site-bazli)
// sayilir ve otomatik siteId filtresi alir (bkz. lib/prismaClient.js).
// Allow-list DEGIL, bilerek: allow-list "fail open" olur (yeni bir model
// eklenip buraya eklenmesi unutulursa sessizce sizdirir); deny-list
// "fail closed" olur (unutulan yeni model ilk sorguda gurultulu sekilde
// patlar - guvenli taraf, bkz. tenantContext.getSiteId()).
const GLOBAL_MODELS = new Set(["Site", "UserSiteAccess", "User", "PaymentRequest"]);

function isTenantModel(modelName) {
  return Boolean(modelName) && !GLOBAL_MODELS.has(modelName);
}

module.exports = { GLOBAL_MODELS, isTenantModel };
