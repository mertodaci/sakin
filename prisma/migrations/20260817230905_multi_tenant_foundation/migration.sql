warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

-- DropIndex
DROP INDEX "Budget_year_category_key";

-- DropIndex
DROP INDEX "Decision_decisionNo_key";

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "HouseholdMember" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "UserNote" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "LegalCase" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "CreditApplication" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "PaymentAllocation" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseCategory" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseProject" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "RecurringPartyCharge" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "PartyCharge" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "PartyPayment" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "PartyPaymentAllocation" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Personnel" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "MaintenanceRecord" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Meter" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "MeterReading" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Key" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "KeyAssignment" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Survey" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "SurveyOption" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "SurveyVote" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Reservation" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "TicketComment" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Classifieds" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "OfficialReport" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "AgendaItem" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "InternalTask" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "ArchiveFolder" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "ArchiveFile" ADD COLUMN     "siteId" TEXT;

-- AlterTable
ALTER TABLE "KnowledgeArticle" ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "inviteCode" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "monthlyDueDefault" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lateFeeRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 10,
    "autoDueEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoDueDay" INTEGER NOT NULL DEFAULT 1,
    "autoDueAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lastAutoDuePeriod" TEXT,
    "ticketCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultAccountId" TEXT,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSiteAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSiteAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Site_inviteCode_key" ON "Site"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "UserSiteAccess_userId_siteId_key" ON "UserSiteAccess"("userId", "siteId");

-- CreateIndex
CREATE INDEX "Unit_siteId_idx" ON "Unit"("siteId");

-- CreateIndex
CREATE INDEX "HouseholdMember_siteId_idx" ON "HouseholdMember"("siteId");

-- CreateIndex
CREATE INDEX "UserNote_siteId_idx" ON "UserNote"("siteId");

-- CreateIndex
CREATE INDEX "LegalCase_siteId_idx" ON "LegalCase"("siteId");

-- CreateIndex
CREATE INDEX "Vehicle_siteId_idx" ON "Vehicle"("siteId");

-- CreateIndex
CREATE INDEX "Account_siteId_idx" ON "Account"("siteId");

-- CreateIndex
CREATE INDEX "Transfer_siteId_idx" ON "Transfer"("siteId");

-- CreateIndex
CREATE INDEX "Charge_siteId_idx" ON "Charge"("siteId");

-- CreateIndex
CREATE INDEX "Payment_siteId_idx" ON "Payment"("siteId");

-- CreateIndex
CREATE INDEX "CreditApplication_siteId_idx" ON "CreditApplication"("siteId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_siteId_idx" ON "PaymentAllocation"("siteId");

-- CreateIndex
CREATE INDEX "Transaction_siteId_idx" ON "Transaction"("siteId");

-- CreateIndex
CREATE INDEX "Budget_siteId_idx" ON "Budget"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_siteId_year_category_key" ON "Budget"("siteId", "year", "category");

-- CreateIndex
CREATE INDEX "Vendor_siteId_idx" ON "Vendor"("siteId");

-- CreateIndex
CREATE INDEX "ExpenseCategory_siteId_idx" ON "ExpenseCategory"("siteId");

-- CreateIndex
CREATE INDEX "ExpenseProject_siteId_idx" ON "ExpenseProject"("siteId");

-- CreateIndex
CREATE INDEX "RecurringPartyCharge_siteId_idx" ON "RecurringPartyCharge"("siteId");

-- CreateIndex
CREATE INDEX "PartyCharge_siteId_idx" ON "PartyCharge"("siteId");

-- CreateIndex
CREATE INDEX "PartyPayment_siteId_idx" ON "PartyPayment"("siteId");

-- CreateIndex
CREATE INDEX "PartyPaymentAllocation_siteId_idx" ON "PartyPaymentAllocation"("siteId");

-- CreateIndex
CREATE INDEX "Personnel_siteId_idx" ON "Personnel"("siteId");

-- CreateIndex
CREATE INDEX "Equipment_siteId_idx" ON "Equipment"("siteId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_siteId_idx" ON "MaintenanceRecord"("siteId");

-- CreateIndex
CREATE INDEX "Meter_siteId_idx" ON "Meter"("siteId");

-- CreateIndex
CREATE INDEX "MeterReading_siteId_idx" ON "MeterReading"("siteId");

-- CreateIndex
CREATE INDEX "Package_siteId_idx" ON "Package"("siteId");

-- CreateIndex
CREATE INDEX "Decision_siteId_idx" ON "Decision"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "Decision_siteId_decisionNo_key" ON "Decision"("siteId", "decisionNo");

-- CreateIndex
CREATE INDEX "Key_siteId_idx" ON "Key"("siteId");

-- CreateIndex
CREATE INDEX "KeyAssignment_siteId_idx" ON "KeyAssignment"("siteId");

-- CreateIndex
CREATE INDEX "Announcement_siteId_idx" ON "Announcement"("siteId");

-- CreateIndex
CREATE INDEX "Survey_siteId_idx" ON "Survey"("siteId");

-- CreateIndex
CREATE INDEX "SurveyOption_siteId_idx" ON "SurveyOption"("siteId");

-- CreateIndex
CREATE INDEX "SurveyVote_siteId_idx" ON "SurveyVote"("siteId");

-- CreateIndex
CREATE INDEX "Facility_siteId_idx" ON "Facility"("siteId");

-- CreateIndex
CREATE INDEX "Reservation_siteId_idx" ON "Reservation"("siteId");

-- CreateIndex
CREATE INDEX "Ticket_siteId_idx" ON "Ticket"("siteId");

-- CreateIndex
CREATE INDEX "TicketComment_siteId_idx" ON "TicketComment"("siteId");

-- CreateIndex
CREATE INDEX "Classifieds_siteId_idx" ON "Classifieds"("siteId");

-- CreateIndex
CREATE INDEX "Notification_siteId_idx" ON "Notification"("siteId");

-- CreateIndex
CREATE INDEX "ActivityLog_siteId_idx" ON "ActivityLog"("siteId");

-- CreateIndex
CREATE INDEX "Contact_siteId_idx" ON "Contact"("siteId");

-- CreateIndex
CREATE INDEX "OfficialReport_siteId_idx" ON "OfficialReport"("siteId");

-- CreateIndex
CREATE INDEX "AgendaItem_siteId_idx" ON "AgendaItem"("siteId");

-- CreateIndex
CREATE INDEX "InternalTask_siteId_idx" ON "InternalTask"("siteId");

-- CreateIndex
CREATE INDEX "Message_siteId_idx" ON "Message"("siteId");

-- CreateIndex
CREATE INDEX "ArchiveFolder_siteId_idx" ON "ArchiveFolder"("siteId");

-- CreateIndex
CREATE INDEX "ArchiveFile_siteId_idx" ON "ArchiveFile"("siteId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_siteId_idx" ON "KnowledgeArticle"("siteId");

-- AddForeignKey
ALTER TABLE "UserSiteAccess" ADD CONSTRAINT "UserSiteAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteAccess" ADD CONSTRAINT "UserSiteAccess_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNote" ADD CONSTRAINT "UserNote_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseProject" ADD CONSTRAINT "ExpenseProject_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringPartyCharge" ADD CONSTRAINT "RecurringPartyCharge_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyCharge" ADD CONSTRAINT "PartyCharge_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyPayment" ADD CONSTRAINT "PartyPayment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyPaymentAllocation" ADD CONSTRAINT "PartyPaymentAllocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Personnel" ADD CONSTRAINT "Personnel_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Equipment" ADD CONSTRAINT "Equipment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Key" ADD CONSTRAINT "Key_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeyAssignment" ADD CONSTRAINT "KeyAssignment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Announcement" ADD CONSTRAINT "Announcement_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Survey" ADD CONSTRAINT "Survey_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyOption" ADD CONSTRAINT "SurveyOption_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurveyVote" ADD CONSTRAINT "SurveyVote_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketComment" ADD CONSTRAINT "TicketComment_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classifieds" ADD CONSTRAINT "Classifieds_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficialReport" ADD CONSTRAINT "OfficialReport_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalTask" ADD CONSTRAINT "InternalTask_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveFolder" ADD CONSTRAINT "ArchiveFolder_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveFile" ADD CONSTRAINT "ArchiveFile_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

