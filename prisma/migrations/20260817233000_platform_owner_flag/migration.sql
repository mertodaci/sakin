-- Platform sahibi (Mert) icin global, site-bazli olmayan bir yetki bayragi.
ALTER TABLE "User" ADD COLUMN "isPlatformOwner" BOOLEAN NOT NULL DEFAULT false;
