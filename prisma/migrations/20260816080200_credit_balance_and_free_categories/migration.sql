/*
  Warnings:

  - Changed the type of `type` on the `Charge` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
-- Enum -> text donusumu: mevcut veriyi korumak icin DROP+ADD yerine
-- dogrudan ALTER COLUMN ... USING type::text kullanildi (Prisma'nin
-- otomatik uretimi veriyi silecekti, elle duzeltildi).
ALTER TABLE "Charge" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "creditAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- DropEnum
DROP TYPE "ChargeType";

-- CreateTable
CREATE TABLE "CreditApplication" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "chargeId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
