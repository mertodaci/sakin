# Sakin — Yol Haritası ve Devam Notları

Bu dosya, projeye **Claude Code üzerinden devam ederken** bağlam kaybı yaşamamak
için hazırlandı. Yeni bir Claude Code oturumu bu dosyayı okuyarak nerede
kaldığımızı, neden bu sırayı seçtiğimizi ve senin (Mert'in) hangi konuda
yardım istediğini anlayabilir.

---

## 🎯 Şu An Neredeyiz

Uygulama **çalışır durumda ve production'a yakın** — demo değil, gerçek bir
backend'i (Node.js + Express + JSON dosya veritabanı) olan, kayıt/onay,
ödeme, muhasebe, iptal/düzenleme akışlarının hepsi test edilmiş bir sistem.

**Tamamlanan ana modüller:**
- Kimlik doğrulama: kayıt/onay akışı, şifremi unuttum, zorunlu şifre değişimi,
  rate limiting, hesap kilitleme, şifre politikası, oturum iptali (tokenVersion)
- Aidat/borç yönetimi: borçlandırma, kısmi tahsilat, ödeme iptali, gecikme
  faizi (otomatik), otomatik aylık borçlandırma
- Çoklu kasa/banka hesabı sistemi + hesaplar arası transfer + hesap ekstresi
- Firma & Personel cari hesap (borçlandırma, ödeme, iptal)
- Muhasebe (gelir-gider, düzenlenebilir/silinebilir hareketler, aylık grafik)
- Bütçe planlama (planlanan vs gerçekleşen)
- Duyuru, anket, site panosu, rezervasyon, arıza/talep (personele atanabilir)
- Personel, demirbaş/bakım-onarım (geçmiş kayıtlı, geri alınabilir), sayaç
  okuma & faturalama (silinebilir), kargo takibi (geri alınabilir), karar
  defteri, anahtar takibi, telefon rehberi
- Şeffaflık: değiştirilemez denetim kaydı (audit log), tüm veriyi dışa aktarma
- PDF üretimi: "borcu yoktur" belgesi, ödeme makbuzu, yazdırılabilir borç listesi
- Sol menü (accordion) navigasyon, mavi tonlu modern arayüz

**Nasıl çalıştırılır:** `README.md` içinde detaylı var — özetle `npm install`
sonra `npm start`, `http://localhost:3000`, demo giriş `yonetici@site.com` /
`Degistir123!`.

---

## 📋 Nasıl Buraya Geldik (Kısa Özet)

1. Apsiyon benzeri bir uygulama istendi → sıfırdan gerçek backend'li bir
   uygulama (Sakin) yazıldı.
2. Apsiyon'un gerçek kullanıcı şikayetleri (Şikayetvar) araştırılıp somut
   çözümler eklendi: ödeme idempotency (çift çekim koruması), şeffaflık/audit
   log, anında PDF belge üretimi, şifre kurtarma akışı.
3. Rutin ama şikayet konusu olmayan özellikler eklendi: gecikme faizi,
   otomatik borçlandırma, telefon rehberi, yazdırılabilir borç listesi.
4. Gerçek bir rakip uygulamanın (Yönetimcell) menü yapısı ekran görüntüleriyle
   incelendi, karşılaştırıldı, eksikler bulundu ve roadmap'e eklendi.
5. Sırayla: sol menü navigasyonu, çoklu kasa sistemi, Firma & Personel cari
   hesap yapıldı.
6. Kullanıcı gerçek kullanım denemesinde iki sorun buldu: arayüz "çok beyaz"
   ve tahsilat ekranında kısmi ödeme/iptal eksikti → ikisi de düzeltildi.
7. "Bunu demo olmaktan çıkar" sorusuna karşılık kapsamlı bir üretim-hazırlığı
   denetimi yapıldı → veri bütünlüğü eksikleri (iptal/silme/düzenleme
   eksiklikleri her modülde tarandı) ve güvenlik sertleştirmesi (rate limit,
   şifre politikası, hesap kilitleme, oturum iptali) tamamlandı.

---

## ✅ Tamamlanan Roadmap Maddeleri

- [x] Sol menü (accordion) navigasyonu
- [x] Çoklu kasa/banka hesabı sistemi
- [x] Firma & Personel cari hesap yönetimi
- [x] Kısmi tahsilat + ödeme iptali (aidat ve firma/personel için)
- [x] Görsel tasarım iyileştirmesi (mavi tonlu, gölgeli, daha canlı)
- [x] Veri bütünlüğü taraması: borç/sayaç faturası/muhasebe hareketi
      silme-düzenleme, kargo/demirbaş geri alma, kullanıcı pasife alma
- [x] Güvenlik sertleştirmesi: rate limiting, şifre politikası, hesap
      kilitleme, oturum iptali (tokenVersion + "tüm oturumları kapat")
- [x] Git entegrasyonu: local repo (`git init`), ilk commit, `.gitignore`
      teyidi (bkz. aşağıdaki "Git Entegrasyonu — Durum" bölümü)

## 🔄 PostgreSQL Geçişi — DEVAM EDİYOR (yarım kaldıysa buradan devam et)

**Plan dosyası:** `C:\Users\mert_\.claude\plans\lazy-popping-hummingbird.md`
(kapsam, şema kararları, commit sırası orada detaylı).

**Şu ana kadar tamamlanan ve commit'lenen adımlar:**
1. ✅ Docker Compose ile local Postgres (`docker-compose.yml`, `.env`'de
   `DATABASE_URL`) — `docker compose up -d` ile ayağa kalkıyor.
2. ✅ `prisma/schema.prisma` — tüm 27 koleksiyon için tablolar oluşturuldu
   (`npx prisma migrate dev` ile uygulandı).
3. ✅ `prisma/seed.js` — eski `buildSeed()` demo verisini birebir üretiyor
   (`npx prisma db seed`).
4. ✅ `db.js` Postgres-backed async shim'e çevrildi (`LEGACY_COLLECTIONS` +
   `READONLY_PASSTHROUGH` deseni), **tüm route dosyaları** async/await'e
   çevrildi, `middleware/asyncErrors.js` eklendi.
5. ✅ Auth + kullanıcı yönetimi (`middleware/auth.js`, `routes/auth.js`,
   `routes/directory.js`'nin 6 kullanıcı-mutasyon ucu) gerçek Prisma
   sorgularına taşındı. `users` artık `LEGACY_COLLECTIONS`'ta değil,
   salt-okunur passthrough'ta.

**Sırada (henüz yapılmadı):**
6. ⏳ `routes/contacts.js` → Prisma (basit CRUD, düşük risk).
7. ⏳ `routes/finance.js` çekirdek uçları (charges/payments/transactions) →
   Prisma, `applyPayment`/iptal akışı `prisma.$transaction` ile atomik
   yapılacak. Eşlik eden küçük değişiklikler: `jobs.js`,
   `routes/accounts.js`'teki `accountBalance()` (muhtemelen değişiklik
   gerekmeyebilir, READONLY_PASSTHROUGH ile `data.transactions` zaten doğru
   geliyor — kontrol et), `routes/dashboard.js`, `routes/documents.js`.
8. ⏳ Bu ilerleme notunu güncelle, son commit'i at.

**Nasıl devam edilir:** Sunucuyu test etmeden önce her zaman `docker compose
ps` ile Postgres'in ayakta olduğunu doğrula. Test için: `npm start`, admin
girişi `yonetici@site.com` / `Degistir123!` (veya `.env`'deki
`ADMIN_EMAIL`/`ADMIN_PASSWORD`). Sunucu zaten çalışıyorsa önce portu boşalt
(`Get-NetTCPConnection -LocalPort 3000` ile PID bulup `Stop-Process`) —
aksi halde `EADDRINUSE` ile eski/yanlış bir süreç isteklere cevap verebilir
(bu oturumda tam olarak bu yüzünden kaynaklanan bir hataya düşüldü).

## 🔜 Bekleyen Roadmap Maddeleri (Öncelik Sırasıyla)

Bu sıralama gelişigüzel değil — her madde bir öncekinin üzerine inşa
edilecek şekilde planlandı. Sıra değiştirilebilir ama bağımlılıklara dikkat:

1. **PostgreSQL'e geçiş** — bilerek en başa/ayrı tutuldu çünkü:
   - Şu an JSON dosya tabanlı veritabanı (`db.js`) var; küçük/orta ölçek
     (tek bina) için yeterli ama eşzamanlı yazmada veri kaybı riski taşıyor.
   - Her route dosyası (`routes/*.js`) doğrudan `data.xxx` dizilerini
     manipüle ediyor — bu, gerçek bir DB'ye geçerken **hepsinin** yeniden
     yazılması demek. Büyük, riskli, dikkatli test gerektiren bir iş.
   - Önerim: Bu geçişi ayrı, odaklı bir oturumda yapmak — önce şema
     tasarımı (Prisma/Drizzle ORM önerilir), sonra route route migrate
     edip her birini test ederek ilerlemek.
2. **Alacaklı/kredi bakiyesi desteği** — bir dairenin fazla ödeme yapıp
   "alacaklı" duruma geçebilmesi (şu an sadece borç/ödendi var, negatif
   bakiye/kredi kavramı yok).
3. **İleri tarihli borçlandırma** — gelecek bir tarih için önceden borç
   tanımlama (Yönetimcell karşılaştırmasından çıktı).
4. **İş Takibi** — yöneticinin kendi iç görev/to-do listesi (sakin
   taleplerinden farklı — "asansör firmasını ara" gibi dahili işler).
5. **Ajanda (Notlar/Faaliyetler)** — dashboard'da güne özel not/hatırlatma
   takvimi.
6. **Raporlar modülü** — kategorize edilmiş, muhtemelen PDF/Excel
   çıktı alınabilen yapılandırılmış raporlar (tahsilat, gelir-gider, üye,
   muhasebe raporları vb.). Kasa/cari hesap sistemleri zaten var, bu
   modül onların üzerine rapor katmanı ekleyecek — bu yüzden madde 1-3'ten
   sonraya alındı.
7. **Gelen Mesajlar** — sakin-yönetici arası özel (iki yönlü) mesajlaşma;
   şu anki duyuru/pano tek yönlü.
8. **Dosya Arşivi** — genel kurul tutanağı, sözleşme taraması gibi serbest
   dosya yükleme/saklama. Şu an hiç dosya upload özelliği yok, bu da
   backend'e `multer` gibi bir upload katmanı ve depolama stratejisi
   (yerel disk mi, S3 mi) gerektirecek — karar senden gelmeli.
9. **Toplu SMS/e-posta arayüzü** — gerçek gönderim için SMS/e-posta
   gateway aboneliği gerekiyor (bkz. README "Neler Gerçek, Neler Demo"),
   ama arayüz/seçim mekanizması şimdiden kurulabilir.
10. **Excel/CSV liste dışa aktarma** — şu an sadece tüm veriyi JSON olarak
    dışa aktarma var; tekil liste (örn. sadece borçlu üyeler) için
    Excel/CSV export.
11. **Yardım/SSS bölümü** — uygulama içi, en düşük öncelik.
12. **Hukuki modül** — tebligat gönderme, icra takibi, genel kurul çağrısı,
    vekaletname örneği, hazirun cetveli, antetli evrak, adres etiket
    yazdırma. En özel/düşük frekanslı modül olduğu için en sona bırakıldı.

---

## 🔧 Git Entegrasyonu — Durum

**2026-08-16 itibarıyla tamamlandı.** Mert'in git deneyimi yoktu, adım adım
anlatılarak kuruldu. Alınan kararlar:

- `git init` yapıldı, ilk commit atıldı (27 dosya).
- Kullanıcı bilgisi **local** (repo'ya özel, `--global` değil) olarak
  kişisel mail ile ayarlandı — çünkü global git config'te şirket maili
  kayıtlıydı ve bu proje şirketle ilgisiz. Global ayar değiştirilmedi,
  sadece bu repo içinde override edildi.
- `.gitignore` teyit edildi: `node_modules/`, `data/db.json`, `.env`,
  `server.log` zaten doğru hariç tutuluyordu. Ek olarak
  `.claude/settings.local.json` eklendi (Claude Code'un makineye özel
  izin ayarları — gizli bilgi içermiyor ama kişiye/makineye özel olduğu
  için repo'ya girmemeli).
- **Uzak depo (GitHub) şimdilik bağlanmadı** — Mert isteyince ayrı bir
  oturumda hesap oluşturma/bağlama adımları anlatılacak.
- **İş akışı kararı:** Bundan sonraki roadmap maddeleri (PostgreSQL geçişi
  dahil) branch açılmadan **doğrudan `master` üzerine commit** edilecek.
  Basitlik tercih edildi çünkü tek kullanıcı var ve henüz kimseyle
  paylaşılmıyor. İleride bu karar değişebilir (örn. büyük/riskli işler
  için branch'e geçilebilir).

---

## 📁 Proje Yapısı (Hızlı Referans)

```
server.js          → Express giriş noktası
db.js               → veri modeli + seed + migrate (JSON dosya tabanlı)
jobs.js             → gecikme faizi + otomatik borçlandırma (zamanlayıcı)
middleware/auth.js  → JWT doğrulama, rol kontrolü, oturum iptali
routes/             → auth, directory, finance, comms, ops, dashboard,
                      documents, system, settings, contacts, accounts, parties
public/             → saf HTML/CSS/JS arayüz (derleme adımı yok)
README.md           → kurulum + mimari + Apsiyon/Yönetimcell karşılaştırma notları
ROADMAP.md          → bu dosya
```

Herhangi bir özelliğin "neden böyle tasarlandığı" sorusu için önce
`README.md`'deki ilgili bölümlere bakılmalı — çoğu karar orada gerekçesiyle
yazılı.
