-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "accountingCode" TEXT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "accountingCode" TEXT;

-- AlterTable
ALTER TABLE "Personnel" ADD COLUMN     "accountingCode" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "accountingCode" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "accountingCode" TEXT;
