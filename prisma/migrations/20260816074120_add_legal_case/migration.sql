-- CreateTable
CREATE TABLE "LegalCase" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "caseNumber" TEXT NOT NULL,
    "court" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Açık',
    "description" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "LegalCase_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "LegalCase" ADD CONSTRAINT "LegalCase_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
