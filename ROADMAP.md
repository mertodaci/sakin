# Sakin — Yol Haritası ve Devam Notları

Bu dosya, projeye **Claude Code üzerinden devam ederken** bağlam kaybı yaşamamak
için hazırlandı. Yeni bir Claude Code oturumu bu dosyayı okuyarak nerede
kaldığımızı, neden bu sırayı seçtiğimizi ve senin (Mert'in) hangi konuda
yardım istediğini anlayabilir.

---

## 🎯 Şu An Neredeyiz

Uygulama **çalışır durumda ve production'a yakın** — demo değil, gerçek bir
backend'i (Node.js + Express + **PostgreSQL/Prisma**, Docker Compose ile
local) olan, kayıt/onay, ödeme, muhasebe, iptal/düzenleme akışlarının
hepsi test edilmiş bir sistem. En kritik/riskli modüller (kimlik
doğrulama, aidat/ödeme/muhasebe) gerçek Prisma sorgularına taşındı; geri
kalan ~9 route dosyası hâlâ eski JSON-dizi mantığıyla ama Postgres'e
yazan/okuyan bir shim (`db.js`) üzerinden çalışıyor — detay için aşağıdaki
"PostgreSQL Geçişi" bölümüne bak.

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

## ✅ PostgreSQL Geçişi — Bu Oturumun Kapsamı TAMAMLANDI (2026-08-16)

**Plan dosyası:** `C:\Users\mert_\.claude\plans\lazy-popping-hummingbird.md`
(kapsam, şema kararları, commit sırası orada detaylı).

**Tamamlanan ve commit'lenen adımlar:**
1. ✅ Docker Compose ile local Postgres.
2. ✅ `prisma/schema.prisma` — tüm 27 koleksiyon için tablolar.
3. ✅ `prisma/seed.js` — demo veri.
4. ✅ `db.js` Postgres-backed async shim (`LEGACY_COLLECTIONS` +
   `READONLY_PASSTHROUGH`), tüm route dosyaları async/await.
5. ✅ Auth + kullanıcı yönetimi → Prisma.
6. ✅ `routes/contacts.js` → Prisma (basit CRUD).
7. ✅ `routes/finance.js` çekirdek uçları (charges/payments/transactions) →
   Prisma. `applyPayment` ve iptal akışı `prisma.$transaction` ile atomik
   (borç güncelleme + `PaymentAllocation` + `Transaction` + `Notification`
   hep birlikte yazılır/geri alınır). Para hesapları `Prisma.Decimal` ile
   (`.plus/.minus/.gte`), float yuvarlama riski yok. Idempotency artık
   `PaymentRequest` tablosunun unique kısıtıyla (`P2002` → 409) sağlanıyor.

   **Planda öngörülenin ötesinde gereken düzeltmeler** (finance.js'in
   `charges`/`payments`/`transactions`'ı Prisma'ya taşıması, bu tabloları
   hâlâ **yazan** başka legacy route'ları da zorunlu kıldı — plan bu bağı
   öngörmemişti):
   - `jobs.js` (gecikme faizi + otomatik aylık borçlandırma) tamamen
     Prisma'ya çevrildi — `data.charges`'a push ediyordu, artık
     salt-okunur passthrough'ta olduğu için sessizce veri kaybına yol
     açardı.
   - `routes/ops.js`: sayaç okuması charge oluşturma/silme Prisma'ya
     taşındı (aynı sessiz veri kaybı riski). Ayrıca `db.load()` sonrası
     eksik iki `await` bulunup düzeltildi (`GET /facilities`,
     `GET /decisions` bozuk yanıt dönüyordu — 4. adımdan kalma bug).
   - `routes/parties.js`: firma/personel ödemesinin oluşturduğu/sildiği
     `Transaction` kaydı artık doğrudan Prisma'ya yazıyor (aynı sebep).
     Ayrıca borçlanma silme ucuna `PaymentAllocation` geçmişi kontrolü
     eklendi — iptal edilmiş bir ödemenin geçmiş kaydı FK Restrict'i
     ihlal edip genel 500 hatası veriyordu, test sırasında yakalandı.
   - Borç (charge) silme uçlarına da aynı desende bir kontrol eklendi
     (`paidAmount>0` YA DA allocation geçmişi varsa engelle) — eski
     JSON-dizi döneminde bu sessizce/başıboş referans bırakarak
     "başarılı" olurdu, Postgres FK'sinin bunu genel 500'e çevirmesini
     önlemek için.
   - `routes/accounts.js`, `routes/dashboard.js`, `routes/documents.js`:
     **bilinçli olarak değiştirilmedi.** Üçü de `charges`/`payments`/
     `transactions`'ı yalnızca **okuyor** (hiç yazmıyor), bu yüzden
     `READONLY_PASSTHROUGH` üzerinden doğru çalışmaya devam ediyorlar —
     manuel testle doğrulandı. Bunları da native Prisma'ya çevirmek
     sadece kozmetik/performans kazancı sağlardı, riski karşılığı
     yoktu; ileride bir "temizlik" oturumunda ele alınabilir.
8. ✅ Bu ilerleme notu güncellendi, commit atıldı.

**Bilinçli olarak hâlâ legacy (shim üzerinden) kalanlar** — sonraki bir
oturuma bırakıldı, plan'ın orijinal kapsamı zaten böyleydi: `ops.js`'in
geri kalanı (rezervasyon/talep/personel/demirbaş/anahtar/kargo/karar),
`comms.js`, `directory.js`'nin daire/kullanıcı-listeleme kısmı,
`parties.js`'in vendor/partyCharge/partyPayment iş mantığı (yalnızca
yukarıdaki FK düzeltmeleri yapıldı), `settings.js`, `system.js`,
`finance.js`'teki `budgets` uçları.

**Test yöntemi:** Otomatik test suite yok (projede hiç yok) — bu oturumda
`npm start` ile gerçek sunucuya karşı çalışan bir Node script'iyle (login,
charges CRUD, kısmi/tam ödeme, ödeme iptali, idempotency, sayaç
faturası oluşturma/silme, firma ödemesi/iptali, dashboard/hesaplar/bütçe/
export uçları) uçtan uca doğrulandı, sonra test verisi temizlendi. Prisma
Studio (`npx prisma studio`, localhost:5555) ile de gözle kontrol
edilebilir.

**Nasıl devam edilir (bundan sonraki route'lar için):** Sunucuyu test
etmeden önce her zaman `docker compose ps` ile Postgres'in ayakta
olduğunu doğrula. Test için: `npm start`, admin girişi
`yonetici@site.com` / `Degistir123!` (veya `.env`'deki
`ADMIN_EMAIL`/`ADMIN_PASSWORD`). Sunucu zaten çalışıyorsa önce portu boşalt
(`Get-NetTCPConnection -LocalPort 3000` ile PID bulup `Stop-Process`) —
aksi halde `EADDRINUSE` ile eski/yanlış bir süreç isteklere cevap verebilir.
Bir koleksiyonu `LEGACY_COLLECTIONS`'tan çıkarmadan önce **o koleksiyona
yazan tüm route dosyalarını** (sadece "asıl" route'u değil) grep'le —
bu oturumda tam olarak bu bağın gözden kaçması bir dizi düzeltme
gerektirdi.

## 🔜 Bekleyen Roadmap Maddeleri (Öncelik Sırasıyla)

Bu sıralama gelişigüzel değil — her madde bir öncekinin üzerine inşa
edilecek şekilde planlandı. Sıra değiştirilebilir ama bağımlılıklara dikkat:

1. ~~**PostgreSQL'e geçiş**~~ — **kısmen tamamlandı** (bkz. yukarıdaki
   "PostgreSQL Geçişi" bölümü): en riskli/parasal modüller (auth, contacts,
   finance — charges/payments/transactions, atomik `$transaction`) gerçek
   Prisma sorgularına taşındı. Geri kalan ~9 route dosyası (ops'un geri
   kalanı, comms, directory'nin listeleme kısmı, parties'in iş mantığı,
   settings, system, budgets) hâlâ eski JSON-dizi mantığıyla ama
   Postgres'e okuyan/yazan bir shim (`db.js`) üzerinden çalışıyor —
   fonksiyonel olarak doğru ve test edildi, sadece "temiz Prisma" değil.
   Bunları da native Prisma'ya çevirmek ayrı, düşük riskli bir "temizlik"
   oturumu olarak yapılabilir, aciliyeti yok.
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
10. ~~**Excel/CSV liste dışa aktarma**~~ — **tamamlandı (2026-08-16):** Aidat
    Takibi ekranına "Excel'e Aktar (CSV)" butonu eklendi
    (`GET /api/documents/debt-list.csv`), tr-TR Excel uyumlu (noktalı virgül
    ayıraç, UTF-8 BOM). Diğer tekil listeler (örn. tüm ödemeler, tüm
    hareketler) için aynı desen kolayca tekrarlanabilir.
11. **Yardım/SSS bölümü** — uygulama içi, en düşük öncelik.
12. **Hukuki modül** — tebligat gönderme, icra takibi, genel kurul çağrısı,
    vekaletname örneği, hazirun cetveli, antetli evrak, adres etiket
    yazdırma. En özel/düşük frekanslı modül olduğu için en sona bırakıldı.

---

## 🔍 Üretim-Hazırlığı Değerlendirmesi (2026-08-16)

PostgreSQL geçişinden sonra, uygulamayı "gerçek sakinlere verilebilir mi"
sorusuyla değerlendirdim. Yönetimcell'e bu oturumda tarayıcıdan erişilemedi
(otomatik/zamanlanmış çalıştığı için) — değerlendirme README'deki mevcut
Yönetimcell karşılaştırma notlarına ve genel Türkiye apartman yönetimi UX
pratiklerine dayanıyor.

**Bu oturumda uygulanan düşük riskli/yüksek değerli düzeltmeler:**
- **Excel/CSV borç listesi export'u** (yukarıda #10) — muhasebeciyle veya
  denetçiyle paylaşmak için PDF'in yanında düz veri formatı, gerçek
  kullanımda sıkça istenen bir şey.
- **Daire listesi sıralaması düzeltildi** — Postgres'e geçişten sonra
  `ORDER BY` verilmeyen sorgular kararsız/rastgele sırada dönüyordu (her
  istekte değişebilirdi); artık her yerde (Daireler, Aidat Takibi, kayıt
  formu dropdown'u) blok/no'ya göre tutarlı sıralı. Küçük ama günlük
  kullanımda fark eden bir cila.
- **README güncellendi** — hâlâ "JSON dosya veritabanı" diyen, artık yanlış
  olan mimari açıklaması PostgreSQL/Prisma'yı yansıtacak şekilde düzeltildi.
  Yanlış dokümantasyon, gerçek bir teslim için güven kırıcıdır.

**Önceliklendirilmiş, henüz yapılmayan eksikler** (yukarıdaki "Bekleyen
Roadmap Maddeleri" listesiyle aynı, sadece üretime-hazırlık merceğinden
önceliklendirildi — küçük/orta riskli olanlar önce, mimari kararı senden
gelmesi gerekenler ayrı işaretli):
1. **Alacaklı/kredi bakiyesi** (madde 2) — bir sakin fazla ödeme yaptığında
   şu an "avans" notuyla metne gömülüyor ama ayrı bir bakiye olarak
   görünmüyor; sonraki dönem borcundan otomatik düşülmüyor. Gerçek
   kullanımda (özellikle yıl sonu/blok değişimi) sık karşılaşılan bir
   durum. Orta risklidir (para mantığına dokunuyor) — kendi başına bir
   oturumda, plan modu ile ele alınmalı.
2. **İleri tarihli borçlandırma** (madde 3) — düşük risk, `Charge.dueDate`
   zaten gelecek bir tarih olabiliyor, esas eksik gelecek tarihli
   borçların "henüz görünmesin/bildirim gitmesin" mantığı. Küçük bir
   oturumda yapılabilir.
3. **Dosya arşivi** (madde 8) — **karar senden gelmeli** (yerel disk mi S3
   mi, dosya boyutu limiti) — bu yüzden otomatik uygulanmadı.
4. **Raporlar modülü, İş Takibi, Ajanda, Gelen Mesajlar, Toplu SMS/e-posta,
   Hukuki modül** — hepsi orta/büyük kapsamlı yeni özellikler, tek
   başlarına birer oturumu hak ediyor; bu oturumda otomatik uygulanmadı.

**Bu değerlendirmede yeni bulunan, roadmap'te olmayan küçük gözlemler**
(değer/risk oranı düşük olduğu için bu oturumda uygulanmadı, ileride
değerlendirilebilir):
- Kullanıcı kayıt formunda telefon numarası formatı doğrulanmıyor (serbest
  metin) — SMS altyapısı eklendiğinde önem kazanır.
- "Bekleyen kullanıcı onayı" bildirimleri hep `admin1` id'sine gidiyor
  (birden fazla yönetici varsa diğerleri bildirim almıyor) — şu an tek
  yönetici senaryosunda sorun değil, çoklu yönetici desteklenirse (roadmap
  dışı, gelecekte istenirse) gözden geçirilmeli.

---

## 🎯 Yönetimcell Paritesi Hedefi — DEVAM EDİYOR (2026-08-16'dan itibaren)

**Mert'in net hedefi:** "Yönetimcell'in kapsadığı her şeyi, kendi
arayüzümüzle inşa edeceğiz." Bu, Bölüm 🔍'teki analiz dokümanının
(bkz. `C:\Users\mert_\.claude\projects\...\artifact` — "Sakin ×
Yönetimcell — Sektörel Analiz") uygulama fazı. Çok oturumluk bir hedef,
tek seferde bitmez — her modül test edilip commit'lenerek ilerleniyor.

**Tamamlanan:**
- ✅ UI: sidebar'a ayrı renk kimliği (koyu lacivert), içerik alanı
  genişletildi (1040px→1360px), istatistik/metin boyutları büyütüldü.
- ✅ Özet ekranındaki istatistik kutucukları tıklanabilir (ilgili
  sekmeye doğrudan geçiş) — üç rol için de.
- ✅ TC kimlik no (`User.nationalId`) + araç plaka (`Vehicle` modeli,
  plaka/marka/renk) — Kullanıcılar ekranında düzenleme modali.
- ✅ Aidat Takibi'ne borç eşiği filtresi ("500 ₺ ve fazla borcu olan"
  gibi — Yönetimcell'de 4+ ekranda tekrar eden bir kalıp).
- ✅ Hesap Özeti modali — bir dairenin borç+tahsilat hareketlerini
  kronolojik, koşan bakiyeli tek bir ekstre olarak gösterir (Daireler
  ve Aidat Takibi ekranlarından açılıyor).
- ✅ **Ajanda** (`AgendaItem` — not/faaliyet, tarihe bağlı,
  bekleyen/tamamlanan), **İş Takibi** (`InternalTask` — Devam Eden/
  Tamamlanan/Kapatılan, İşin Alanı/Türü, personele/daireye
  bağlanabilir, Talepler'den ayrı), **Gelen Mesajlar** (`Message` —
  sakin↔yönetici iki yönlü özel mesajlaşma, bildirim tetikler) —
  hepsi `routes/workspace.js`'te, rol bazlı görünürlükle
  (`NAV_GROUPS`).
- ✅ **İkamet Edenler** (`HouseholdMember` — yakınlık derecesi,
  "taşındı" işaretlenince geçmiş olarak korunur), **Arsa Payı/Aidat
  Grubu** (`Unit.landShare`/`feeGroup`), **Üye Notu** (`UserNote`,
  CRM tarzı) — Daireler ve Kullanıcılar düzenleme modallerine eklendi.
- ✅ **Hukuki modülün kalanı**: `LegalCase` modeli (icra takibi,
  `routes/legal.js`) + 7 PDF şablonu (`routes/documents.js`):
  Tebligat (Ödeme Çağrısı/İhtarname — Yönetimcell'den gerçek
  metinleriyle çıkarıldı), Genel Kurul Çağrısı, Vekaletname Örneği,
  Hazirun Cetveli, Antetli Evrak, Adres Etiketleri, Toplu Hesap Özeti.
  "Kurul & Hukuk" grubuna "İcra Takibi" ve "Belge Şablonları"
  sekmeleri eklendi.
- ✅ **Toplu SMS/e-posta arayüzü** (`POST /bulk-messages/preview`+`/send`
  — blok/borç filtresi, `<adsoyad>`/`<daire>`/`<borc>` kişiselleştirme
  parametresi; gerçek sağlayıcı olmadığı için sadece önizler ve
  konsola loglar, README'nin "demo" desenine uygun) + **Toplu Hesap
  Özeti Dökümü** (tüm dairelerin ekstresi tek PDF'te).
- ✅ **Alacaklı bakiye + serbest kategori modeli** — `Charge.type` artık
  serbest metin (eski `ChargeType` enum'u kaldırıldı, veri kaybı
  olmadan `ALTER COLUMN ... USING` ile migrate edildi); Tahsilat
  ekranına "Özel Borçlandırma" formu (`GET /charge-categories` ile
  otomatik tamamlanan kategori listesi) eklendi. Fazla ödeme artık
  `Unit.creditBalance`'a düşüyor (yeni borç otomatik tüketmiyor,
  `POST /units/:id/apply-credit` ile FIFO manuel uygulanıyor,
  `CreditApplication` tablosunda denetlenebilir). Ödeme iptalinde
  havuz-sızıntısı riskini önlemek için her `Payment` kendi
  `creditRemaining`'ini takip ediyor — iptal sadece O ödemenin henüz
  harcanmamış kısmını geri alıyor, paylaşılan havuzdaki başka
  ödemelerin kredisine dokunmuyor (code review ile bulunup düzeltilen
  gerçek veri bütünlüğü hatası). `jobs.js`'teki gecikme faizi de aynı
  krediyi bir çalışmada birden fazla borca uygulamayacak şekilde
  düzeltildi. `db.netDebt()` ortak fonksiyonu 4 tekrar eden
  hesaplamayı birleştirdi. `test-credit.js` ile regresyon testleri
  (havuz-sızıntısı senaryosu dahil) geçiyor.

**Sırada (henüz yapılmadı, bu sırayla ilerlenecek):**
1. ⏳ Muhasebe kodu eşleme (Tekdüzen Hesap Planı) + Mizan + Yevmiye/
   Kebir Defteri, banka entegrasyonu — sadece iskelet/arayüz düzeyinde
   (gerçek banka API'si/mali müşavir entegrasyonu üçüncü taraf
   sözleşmesi gerektirir, Mert'in kararı). **Buradan devam et.**
2. ⏳ Bilgi Bankası (Yönetimcell'de statik yardım/şablon linkleri
   sayfasıydı, en düşük öncelik, atlanabilir).

**Birebir kopyalanamayacaklar** (README'nin "Neler Gerçek, Neler
Demo" ayrımına eklenecek): gerçek banka entegrasyonu, gerçek SMS
gönderimi, ayrı denetçi/güvenlik-görevlisi mobil uygulamaları, sitenin
kendi halka açık web sitesi barındırması. Bunlarda veri modeli/arayüz
kurulur, üçüncü taraf bağlantısı Mert'in kararına bırakılır.

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
