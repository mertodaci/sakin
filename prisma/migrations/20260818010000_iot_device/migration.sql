-- Akilli Site Sistemleri (IoT) - havuz/aydinlatma/kamera/otopark/sulama/
-- jenerator/asansor gibi cihazlarin durum/olcum bilgisini tutar.
CREATE TABLE "IotDevice" (
    "siteId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "lastReadingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IotDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "IotDevice_siteId_idx" ON "IotDevice"("siteId");

ALTER TABLE "IotDevice" ADD CONSTRAINT "IotDevice_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
