-- CreateTable
CREATE TABLE "RecurringPartyCharge" (
    "id" TEXT NOT NULL,
    "partyType" "PartyType",
    "partyId" TEXT,
    "categoryId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "nextDate" TIMESTAMP(3) NOT NULL,
    "frequency" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringPartyCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringPartyCharge_active_nextDate_idx" ON "RecurringPartyCharge"("active", "nextDate");

-- AddForeignKey
ALTER TABLE "RecurringPartyCharge" ADD CONSTRAINT "RecurringPartyCharge_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
