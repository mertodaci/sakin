-- Settings modeli hicbir route tarafindan okunmuyor/yazilmiyordu - coklu-
-- kiraci donusumunden beri gercek "ayarlar" kaynagi her sitenin kendi Site
-- satiri (bkz. db.js loadMeta/save). Sadece seed.js'in tarihsel bir
-- kalintisiydi (2026-08-20'de kaldirildi, bkz. ROADMAP.md).
-- DropForeignKey
ALTER TABLE "Settings" DROP CONSTRAINT "Settings_defaultAccountId_fkey";

-- DropTable
DROP TABLE "Settings";
