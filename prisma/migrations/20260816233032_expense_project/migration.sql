-- CreateTable
CREATE TABLE "ExpenseProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startPeriod" TEXT NOT NULL,
    "endPeriod" TEXT NOT NULL,
    "categoryId" TEXT,
    "shareMethod" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(12,2) NOT NULL,
    "blockFilter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseProject_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ExpenseProject" ADD CONSTRAINT "ExpenseProject_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
