-- CreateTable
CREATE TABLE "OfficialReport" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "adminText" TEXT NOT NULL DEFAULT '',
    "resultText" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficialReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OfficialReport_type_idx" ON "OfficialReport"("type");
