-- AlterTable
ALTER TABLE "User" ADD COLUMN     "favoriteTabs" TEXT[] DEFAULT ARRAY[]::TEXT[];
