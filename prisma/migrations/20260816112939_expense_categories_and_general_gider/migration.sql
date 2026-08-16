-- AlterTable
ALTER TABLE "PartyCharge" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "invoiceNo" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "partyType" DROP NOT NULL,
ALTER COLUMN "partyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "PartyPayment" ADD COLUMN     "receiptNo" TEXT NOT NULL DEFAULT '',
ALTER COLUMN "partyType" DROP NOT NULL,
ALTER COLUMN "partyId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "contactName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "email" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseCategory_group_idx" ON "ExpenseCategory"("group");

-- CreateIndex
CREATE INDEX "PartyCharge_categoryId_idx" ON "PartyCharge"("categoryId");

-- AddForeignKey
ALTER TABLE "PartyCharge" ADD CONSTRAINT "PartyCharge_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
