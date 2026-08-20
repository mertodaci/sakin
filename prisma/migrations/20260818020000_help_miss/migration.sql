-- Yardim (Kapici AI) 3. kademe eslesmezse soruyu sessizce loglar - yonetici
-- Sistem > Yardim Sorulari ekranindan bakip KB'ye yeni kelime ekleyebilir.
-- NOT: bu tablo dev veritabaninda `prisma db push` ile olusturulmustu, bu
-- migration dosyasi geriye donuk olarak sadece migration gecmisini gercek
-- durumla eslestirmek icin eklendi (2026-08-20, Settings modeli kaldirma
-- calismasi sirasinda migration drift'i olarak fark edildi).
CREATE TABLE "HelpMiss" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HelpMiss_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HelpMiss_siteId_idx" ON "HelpMiss"("siteId");

ALTER TABLE "HelpMiss" ADD CONSTRAINT "HelpMiss_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;
