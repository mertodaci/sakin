-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "categoryId" TEXT;

-- CreateIndex
CREATE INDEX "Charge_categoryId_idx" ON "Charge"("categoryId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
