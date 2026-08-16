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
- ✅ **Sidebar/menü görsel yeniden tasarımı** (Mert'in "arayüz amatör,
  yeni nesil albenisi yok" geri bildirimine karşılık) — sidebar artık
  düz lacivert degrade yerine koyu "slate" zemin + indigo/mor vurgu
  rengiyle (`--accent`/`--accent-2`, `#6366F1`→`#8B5CF6`) çağdaş bir
  SaaS ürün kimliğinde; markanın yanına gradyanlı monogram
  (`brand-mark`) eklendi. Her nav öğesine, role göre 6-28 arası,
  elle çizilmiş satır-ikon (inline SVG, `NAV_ICON` haritası, dış
  bağımlılık yok) eklendi — önceden sadece düz metin listesiydi.
  Kullanıcı adı/çıkış artık üstte metin buton değil, sidebar altında
  baş harfli avatarlı bir "kullanıcı kartı" (Yönetimcell ve benzeri
  modern panellerdeki yerleşime daha yakın); açılır menüsü (şifre
  değiştir/tüm oturumları kapat/çıkış) kartın üstünde beliriyor.
  Topbar sadeleşti: sağda sadece bildirim zili, solda o an açık
  sekmenin başlığı (`tabLabel()`). Genel kart/istatistik kutucuklarına
  hafif radial-glow + büyütülmüş köşe yarıçapı (14px→16px) eklendi.
  Üç rolde de (sakin/yönetici/personel) tüm nav öğelerinin ikonu
  eksiksiz render ediliyor, tarayıcıda DOM/console üzerinden
  doğrulandı (ekran görüntüsü bu oturumda mevcut değildi - headless
  önizleme). **Bu, "amatör görünüm" şikayetine ilk ciddi yanıt; genel
  içerik alanı (formlar/tablolar) hâlâ önceki tasarımda - istenirse
  bir sonraki adım olarak ele alınabilir.**
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

- ✅ **Giderler (Ödeme) modülü — gider kategorisi + genel gider** (Mert'in
  canlı Yönetimcell hesabında "Giderler (Ödeme)" menüsünü tek tek
  gezip her alt sayfanın GERÇEK işlevini (sadece menü adını değil)
  çıkarmamız üzerine): yeni `ExpenseCategory` modeli (Gider Grubu →
  Gider kalemi hiyerarşisi, Yönetimcell'deki "Bahçe Bakım Hizmetleri →
  Ağaç Kesim ve Budama Gideri" gibi taksonomiyle aynı fikir).
  `PartyCharge`/`PartyPayment`'ın `partyType`/`partyId` alanları artık
  nullable — belirli bir firma/personele bağlı olmadan, sadece bir
  gider kategorisine bağlı "genel gider" borçlandırması mümkün (yeni
  "Giderler" sekmesi). Her borçlandırmaya `invoiceNo` (Fatura No), her
  ödemeye `receiptNo` (Makbuz No) otomatik üretiliyor
  (Yönetimcell'deki fatura/makbuz numarası alanlarının karşılığı).
  `POST /party-payments/pay` artık ya taraf bazlı FIFO (firma/personel,
  değişmedi) ya da `chargeId` ile tek bir kaydı hedefleyen ödeme kabul
  ediyor (genel giderler Yönetimcell'de de toplu değil fatura fatura
  ödeniyor). Vendor'a `contactName`/`email` eklendi. Yeni **Borç
  Listesi** sekmesi: firma+personel+genel gider ayrımı yapmadan TÜM
  açık borçları taraf türü/vade aralığı filtreleriyle tek tabloda
  gösteriyor (`GET /party-charges?openOnly=1&...`). Kategori silme
  `onDelete: SetNull` ile güvenli (bağlı borç kaydı asla silinmez,
  sadece kategori referansını kaybeder). `test-giderler.js` ile
  regresyon testleri geçiyor. **Bilinçli sadeleştirme**: Yönetimcell'in
  fatura oluştururken "Ödendi" kutucuğuyla anında ödenmiş işaretleme
  kısayolu şimdilik yok — önce borçlandır, sonra ayrı adımda öde
  (uygulamanın genelindeki tutarlı desen).

- ✅ **Tekrarlayan/İleri tarihli fatura sistemi** — Yönetimcell'in "İleri
  Tarihli Borç Listesi"si meğer sadece vadesi ileri olan borçların
  listesi değil, asıl periyodik/zamanlanmış fatura şablonu sistemiymiş
  (canlı hesapta inceleyince ortaya çıktı). Yeni `RecurringPartyCharge`
  modeli: taraf (firma/personel) VEYA kategoriye bağlı bir şablon
  (tutar, açıklama, ilk vade, sıklık: Tek Seferlik/Aylık/Yıllık)
  tanımlanır; `jobs.js`'teki `materializeRecurringPartyCharges()`
  vadesi gelen şablonları gerçek `PartyCharge`'a çevirir (tek seferlik
  şablon ateşleyince pasifleşir, aylık/yıllık bir sonraki vadeye
  atlar) — mevcut `runMaintenanceTasks()` döngüsüne eklendi (6 saatte
  bir otomatik + yönetici "Şimdi Çalıştır" ile anında tetikleyebiliyor,
  aidat tarafındaki `charges/generate-month` ile aynı manuel-tetikleyici
  deseni). **Önemli tasarım kararı**: bu materialize fonksiyonu
  `PartyCharge`'ı doğrudan `prisma.partyCharge.create()` ile DEĞİL,
  `db.load()`/`db.save()` legacy-shim döngüsü üzerinden yazıyor —
  çünkü `PartyCharge` hâlâ shim'in tam-senkron `save()`'ine bağlı
  (`saveCollection`, snapshot'ta olmayan id'leri `deleteMany` ile
  siliyor); arka plandaki job doğrudan Prisma ile satır eklerse, o
  sırada başka bir isteğin (routes/parties.js) eski bir `data`
  snapshot'ıyla çağıracağı `db.save()` bu yeni satırı sessizce silerdi.
  Yeni "İleri Tarihli / Tekrarlayan" sekmesi eklendi. `test-recurring.js`
  ile tam yaşam döngüsü (materialize, tek-seferlik pasifleşme, aylık
  vade ilerletme, henüz-vadesi-gelmeyeni-atlamak, tekrar-çalıştırma
  idempotent'liği, aktif/pasif, silme) test edildi, geçiyor.

- ✅ **Firma/Personel "Hesap Hareketleri"** — Hesap Özeti pattern'i
  (`renderHesapOzetiModal`) firma/personel'e genişletildi:
  `renderPartyHesapHareketleriModal` koşan bakiyeli, Fatura No/Makbuz
  No dahil kronolojik ekstre gösteriyor; "Firma & Personel" ekranındaki
  her kartta "📄 Hesap Hareketleri" butonundan açılıyor.

- ✅ **Kalan tüm Yönetimcell menülerini yeniden denetle** — Mert'in
  talebi üzerine ("Bunu tamamladıktan sonra diğer menüler/sayfalar için
  de tekrar kontrolü yap ve emin ol eksik bir şey kalmasın"), canlı
  hesapta Üyeler, Kasalar, Raporlar, Borçlandır, Hukuki menülerinin
  HER alt sayfasına tek tek girildi (Tanımlar bu hesabın yetkisi
  dışındaydı — DOM'da boş `<ul>`, "Borçlandır → İleri Tarihli
  Borçlandırma" da "Bu işlem için yetkiniz yok" verdi, incelenemedi).
  **Hukuki menüsü baştan sona zaten önceki fazda kapsanmıştı, yeni
  eksik çıkmadı.** Bulunan yeni eksikler aşağıdaki "Sırada" listesine
  eklendi.

- ✅ **Charge'ı ExpenseCategory'ye bağlama** (Mert'in düzeltmesi: "biz hep
  aidat üzerinden gittik ama demirbaş giderleri gibi borçlandırmalar da
  yapılıyor dairelere") — bir önceki fazda `ExpenseCategory`'yi sadece
  `PartyCharge`'a (firma/personel gideri) bağlamıştım, dairelere kesilen
  `Charge`'a hiç bağlamamıştım. `Charge.categoryId` eklendi — AYNI Gider
  Grubu/Kalemi taksonomisini `PartyCharge` ile paylaşıyor (örn. "Demirbaş"
  kategorisi hem bir firma faturasında hem bir daireye yansıtılan
  borçlandırmada kullanılabiliyor). Tahsilat'taki "Özel Borçlandırma"
  formuna kategori seçimi eklendi (`type` serbest metin alanı geriye
  dönük uyumluluk için kalıyor, kategori seçilip type boş bırakılırsa
  kategori adından türetiliyor). Hesap Özeti modaline bunun doğrudan
  meyvesi olan **kategori kırılımı** eklendi: üstte Aidat/Demirbaş/...
  gibi her kategori için ayrı kalan-bakiye çipi (Yönetimcell'deki
  Aidat/Yakıt/Demirbaş/Ek Gider sütunlarının karşılığı).
  `test-charge-category.js` ile regresyon testleri geçiyor.

- ✅ **Dosya Arşivi** — Raporlar altında bulunmuştu, klasör bazlı genel
  evrak/dosya yükleme-saklama sistemi (Personel Evrakları, Maaş
  Bordroları, SGK Ödemeleri, Üye Evrakları gibi). Yeni `ArchiveFolder`/
  `ArchiveFile` modelleri; gerçek dosyalar yerel diskte `uploads/archive/`
  altında **UUID adıyla** saklanıyor (kullanıcının gönderdiği orijinal
  dosya adı asla disk yolu olarak kullanılmıyor — path traversal riskini
  önlemek için — sadece indirirken öneri adı olarak gösteriliyor,
  `res.download()`). `multer` eklendi (disk storage, 25MB dosya boyutu
  sınırı). `uploads/` `.gitignore`'a eklendi. Yeni "Dosya Arşivi"
  sekmesi ("Kurul & Hukuk" grubunda) — klasör listesi → tıklayınca
  dosya listesi + yükle/indir/sil. Tüm uçlar sadece yönetici rolüne
  açık. `test-archive.js` ile klasör/dosya CRUD + path-traversal
  güvenlik testi (tarayıcının kendisi de dosya adındaki yol kısmını
  temizliyor, ek bir güvenlik katmanı) geçiyor.

- ✅ **Borç Dökümü** ekranı — Üye Listesi'ndeki 3 satır-aksiyonundan biri
  (Hesap Özeti/Borç Dökümü/Tahsilat Ekranı — Mert'in bu oturumun en
  başındaki asıl şikayeti). "Hesap Özeti"nden farklı: sadece AÇIK
  borçları (geçmiş ödemeler olmadan) tek tabloda gösterir, yanında
  doğrudan **Tahsil Et** / **Sms Gönder** / **Yazdır (PDF)** butonları
  var. `renderBorcDokumuModal` — Daireler ve Aidat Takibi'ndeki her
  daire satırına yeni "📋" butonuyla açılıyor. Backend: `GET
  /documents/borc-dokumu/:unitId` (tek dairenin açık borç PDF'i,
  `buildDocument` helper'ı ile) + `POST /units/:id/borc-sms` (tekil,
  kişiselleştirilmiş borç durumu SMS'i — toplu SMS'teki `sendSms` stub
  mekanizmasıyla aynı). `test-borc-dokumu.js` ile regresyon testleri
  geçiyor. (Hesap Özeti'ndeki satır bazlı makbuz PDF'i ve tüm ekstreyi
  PDF indirme kısmı bu adıma dahil edilmedi, küçük bir sonraki adım
  olarak kalabilir.)

- ✅ **Tahsilat Ekranı zenginleştirme** — aynı kişi (isim/telefon
  eşleşmesiyle — ayrı bir Malik tablosu olmadığı için Unit.ownerName/
  ownerPhone üzerinden, `GET /units/:id/related`) birden fazla
  taşınmaza sahipse Borç Dökümü modalinde hepsinin açık borçları TEK
  ekranda, satır bazlı checkbox'larla listeleniyor; "Seçilenleri Tahsil
  Et" seçili kalemleri (birden fazla daireye yayılsa bile, her daire
  için ayrı bir Payment/makbuz oluşturularak) kapatıyor.
  `POST /payments/pay` artık opsiyonel `chargeIds` kabul ediyor — FIFO
  yerine SADECE belirtilen kayıtlara uygulanıyor (`PartyCharge`'daki
  `chargeId` tekil-hedef tasarımının genellenmiş hali).
  **Yol boyunca bulunup düzeltilen 2 gerçek hata**: (1) `POST /units`
  `floor` alanı verilmediğinde `null` gönderiyordu ama şemada zorunlu
  (`Int`) — 500 hatası veriyordu, artık 0 varsayılıyor. (2) Borç
  Dökümü modalinde "Seçilenlerin toplamı" her zaman ₺0 gösteriyordu
  çünkü `selectedTotal()` DOM'a henüz eklenmemiş checkbox'ları
  sorguluyordu (template string DOM'a yazılmadan önce hesaplanıyordu)
  — artık ilk değer doğrudan hesaplanan `totalOpen`'dan geliyor.
  `test-multiunit.js` ile regresyon testleri (malik eşleştirme,
  izole çoklu-daire ödemesi, yanlış-pozitif eşleşme olmaması dahil)
  geçiyor.

- ✅ **Boş taşınmaz (vacant unit) durumu** — `Occupancy` enum'una
  `vacant` eklendi (Yönetimcell'in "Boş/Dolu Taşınmaz Listesi"
  raporunun karşılığı). Fark edilen ayrıntı: `occupancy` alanı daha
  önce hiçbir formda gösterilmiyordu (sadece oluşturma sırasında
  sessizce "owner" varsayılıyordu) — "Yeni Daire Ekle" ve "Daire
  Düzenle" formlarına "İkamet Durumu" seçimi (Malik Oturuyor/Kiracı
  Oturuyor/Boş) eklendi, Daireler listesinde boş dairelere "Boş"
  rozeti gösteriliyor. `test-vacant.js` ile regresyon testi geçiyor.

- ✅ **Unit.squareMeters (m²) + kullanıcıda ikinci telefon/e-posta** —
  "Detaylı Üye Listesi" rapor oluşturucusunda görülen alanlar:
  `Unit.squareMeters` (arsa payının yanında ayrı bir metrekare alanı,
  "Yeni Daire Ekle"/"Daire Düzenle" formlarına ve Daireler listesine
  eklendi) + `User.phone2`/`email2` (Kullanıcı Düzenle modaline
  "İkinci Telefon"/"İkinci E-posta" eklendi — `email2` login için
  kullanılan `email` gibi unique değil, sadece bilgi amaçlı ikincil
  iletişim alanı). `test-sqm-contact.js` ile regresyon testleri
  (oluşturma, güncelleme, temizleme) geçiyor.

- ✅ **Dashboard/Kasalar'a Borçlar Toplamı kartı** — Yönetimcell'in
  genel kasa özetinde Alacaklar (üye borçları) ile yan yana bir toplam
  "Borçlar" (firma/personel/genel gidere olan açık borç) kartı vardı,
  bizde sadece tahsilat tarafı gösteriliyordu. `GET /dashboard` artık
  `totalPayables` döndürüyor (`data.partyCharges`'ın açık kayıtları
  toplamı — Borç Listesi'nin topladığı veriyle aynı kaynak). Genel
  Özet'e "TOPLAM BORÇ (ÖDENECEK)" kartı, Kasalar'a ise "TOPLAM KASA
  BAKİYESİ"nin yanına "ALACAKLAR (ÜYE BORÇLARI)"/"BORÇLAR (ÖDENECEK)"
  kartları eklendi (Yönetimcell'in Genel Kasa Durumu'ndaki üç-kart
  düzenine daha yakın). **Bilinçli sadeleştirme**: Ana Para/Gecikme
  kırılımı bu adıma dahil edilmedi (gecikme faizi zaten ayrı bir
  `Charge.type` olarak var, istenirse ayrıca hesaplanabilir).
  `test-payables-card.js` ile regresyon testi geçiyor.

- ✅ **Muhasebe kodu + Mizan + Tahakkuk Fişleri + Yevmiye/Kebir/Mutabakat**
  — Mert'in talebi üzerine ("yönetimcell de nasılsa ikisini de öyle
  yapalım") canlı hesapta "Muhasebe Raporları" menüsünün 5 alt sayfası
  tek tek incelendi. Ortaya çıkan gerçek: bu GERÇEK çift-taraflı bir
  muhasebe defteri değil — mevcut verilerimizin (Account/Unit/Vendor/
  Personnel/ExpenseCategory) üzerine kullanıcının kendi mali müşavirine
  referans için atadığı serbest metin bir **Hesap Kodu** etiketi + bu
  kodlarla birleştirilmiş raporlar.
  - `accountingCode String?` eklendi: Account, Unit, Vendor, Personnel,
    ExpenseCategory. Yeni **Muhasebe Kodları** ekranı (`GET/PATCH
    /accounting/codes`) + "Kodu Olmayanlara Otomatik Kod Oluştur"
    (`POST /accounting/codes/auto-assign` — Tekdüzen Hesap Planı grup
    kodlarından esinlenen varsayılan ön-ekler: 100=Kasa, 120=Alıcılar/
    Üyeler, 320=Satıcılar/Firmalar, 335=Personele Borçlar, 770=Genel
    Yönetim Giderleri — kullanıcı sonradan değiştirebilir).
  - Yeni **Mizan Raporu** ekranı (`GET /accounting/mizan`) — her varlık
    türü için Toplam Borç/Toplam Alacak/Borç Bakiye/Alacak Bakiye
    kırılımı, kod filtresiyle.
  - Yeni **Muhasebe Tahakkuk Fişleri** ekranı (`GET /accounting/fisler`)
    — tarih aralığında oluşan her borç/tahsilat olayını (Charge/Payment/
    PartyCharge/PartyPayment) Fiş No + Hesap Kodu + Açıklama + Borç/
    Alacak şeklinde kronolojik listeler.
  - Yevmiye Defteri / Kebir Defteri / Kapanış Mizanı — yıl bazlı PDF
    dökümü (`buildDocument` helper'ı ile, mevcut belge şablonu
    desenine uygun).
  - Firma Mutabakat Mektubu — "Firma & Personel" ekranındaki her firma
    kartına "✉️ Mutabakat" butonu, güncel bakiyeyi içeren PDF üretir.
  - `test-accounting.js` ile regresyon testleri (kod atama/otomatik
    kod/mizan/fişler/4 PDF export) geçiyor.
  - **Bilinçli sadeleştirme**: banka entegrasyonu ve gerçek mali
    müşavir/e-defter API bağlantısı hâlâ üçüncü taraf sözleşmesi
    gerektiriyor (README'nin "Neler Gerçek, Neler Demo" ayrımı) —
    burada üretilen PDF'ler kullanıcının kendi mali müşavirine
    iletmesi için, resmi e-defter beyanı yerine geçmez.
- ✅ **Bilgi Bankası** — Mert'in talebi üzerine ("ikisini de öyle
  yapalım") canlı hesapta Hukuki menüsü altında incelendi (daha önce
  "düşük öncelik, atlanabilir" not edilmişti ama açıkça istenince ele
  alındı). Kategorize edilmiş (Bilgi Bankası/Örnek Yazışmalar/
  Yönetmelikler), aranabilir bir yardım makaleleri kütüphanesi.
  **Önemli not**: Yönetimcell'deki içerik onların kendi telifli
  editoryal metinleriydi — o metinler kopyalanmadı, sadece MEKANİZMA
  (kategori+arama+CRUD) aynı şekilde kuruldu. Yeni `KnowledgeArticle`
  modeli; `routes/knowledge.js` (okuma tüm rollere açık, yazma sadece
  yönetici); yeni "Bilgi Bankası" sekmesi hem yönetici (Kurul & Hukuk
  grubu, tam CRUD) hem sakin (Sistem grubu, salt okunur) tarafında.
  5 özgün örnek makale (kendi ifadelerimizle, Kat Mülkiyeti Kanunu
  temel konuları) seed edildi — yönetici bunları düzenleyip
  genişletebilir. `test-knowledge.js` ile regresyon testleri geçiyor.
  **Yol boyunca bulunan gerçek hata**: `firma-mutabakat` PDF ucu,
  firma adı Türkçe karakter içerdiğinde (`Content-Disposition`
  header'ı sadece Latin-1 kabul ettiği için) `ERR_INVALID_CHAR` ile
  500 veriyordu — dosya adı `trSafe()` ile ASCII'ye indirgenip
  düzeltildi.
- ✅ **Rol-bazlı tam denetim** — Mert'in talebi üzerine ("bir site
  yöneticisi olarak ve bir de apartman sakini gözüyle uygulamayı
  incele") her üç rolün (yönetici/sakin/personel) TÜM sekmeleri
  otomatik olarak tek tek gezildi, konsol/ağ hataları kontrol edildi.
  **Bulunan tek gerçek hata**: `renderRehber`, `units` API çağrısını
  koşula göre (sadece yönetici/personel için) diziye ekleyip sabit
  pozisyonla destructure ediyordu — sakin rolünde dizi kısa kaldığı
  için `personnel` değişkeni aslında `units`'in sonucunu alıyor,
  gerçek personel verisi `undefined` kalıp sayfayı çökertiyordu
  ("Cannot read properties of undefined"). Koşulsuz sabit pozisyonla
  (`canSeeUnits` yoksa `Promise.resolve([])`) düzeltildi. Düzeltme
  sonrası üç rolün de her sekmesi hatasız doğrulandı.

- ✅ **Tam site denetimi (2. tur) + "Üye Listesi Seçenekleri" 4 rapor
  sayfası** — Mert'in ısrarlı talebi üzerine ("isim olarak gördüğün
  ve bakmadığın her şeye bak") canlı hesaptaki ~50 sayfanın TAMAMI
  (Raporlar'ın tüm alt dalları + Üyeler/Giderler/Kasalar/Hukuki'nin
  her leaf sayfası) gerçekten açılıp içeriği (sütun/filtre/örnek veri)
  incelendi — sadece menü isimlerini toplamak değil. Bulgular
  `yonetimcell-full-audit.md`'de. Bu turun ilk somut çıktısı olarak
  "Üyeler > Üye Listesi Seçenekleri" altındaki 4 filtrelenebilir liste
  sayfası eklendi:
  - **İkamet Edenler Listesi**: `GET /reports/ikamet-edenler` — her
    taşınmazın malik/kiracısı + güncel `HouseholdMember` kayıtları tek
    tabloda (Blok/No/Sıfatı/Yakınlığı/Ad Soyad/Telefon).
  - **Boş/Dolu Taşınmaz Listesi**: `GET /reports/bos-dolu-tasinmaz` —
    mevcut `occupancy` alanından üretilen doluluk+bakiye tablosu.
  - **Tc Kimlik Numarası Listesi**: `GET /reports/tc-kimlik-listesi`
    — hesabı olan (giriş yapabilen) sakinlerin `nationalId`'si;
    hesapsız eski/kayıtsız sakinlerin TC no'su sistemde tutulmadığı
    için kapsam dışı (not olarak sayfada belirtildi).
  - **Araç Plaka Listesi**: `GET /reports/arac-plaka-listesi` —
    `Vehicle` modeli zaten kişi başına çoklu kayıt destekliyordu
    (task #6), sadece site-geneli liste görünümü eksikti.
  - Dördü de aynı basit paternİ paylaşıyor: arama kutusu (client-side
    filtre) + tablo + tarayıcı "Yazdır" butonu (`window.print()`) —
    her biri için ayrı PDF endpoint'i açmak bu ölçekte gereksiz
    karmaşıklık olurdu. `test-uye-listeleri.js` ile 4 uç + rol
    kısıtlaması (sakin erişemez) doğrulandı, tarayıcıda görsel olarak
    da kontrol edildi.
  - **Tur 2'de bulunan diğer gerçek eksikler** (henüz uygulanmadı,
    sırada): Genel Durum Raporu ve türevleri (Mizan/Özet Durum/Denetim
    Kurulu/Yönetim Faaliyet Raporu), Taşınmaz Raporları'nın 3 pivotu
    (birim×ay, ay×kategori, birim×kategori) + kişi bazlı ikizleri,
    Tahsilat/Detaylı Gider Raporu (birleşik hareket logu), Günlük/Aylık
    Özet Bilanço, Gider Grubu Raporu, Genel Bilanço, İşletme Defteri,
    Dönemsel Gelir-Gider Tablosu, Toplu Tahsilat Makbuzu/Üye Borç
    Dökümü, toplu Tebligat, İşletme Projesi (m²/arsa payı/eşit
    paylaşıma göre bütçelenmiş toplu borçlandırma — en büyük efor
    kalemi), Detaylı Üye Listesi (esnek sütun seçici + cinsiyet/doğum
    tarihi/kan grubu/sektör/iş yeri/ev adresi gibi yeni alanlar), toplu
    SMS/e-posta hazır-şablon varyantları, Bütçe Raporları PDF export,
    ve üç küçük model kontrolü (Personnel'de kurul rolleri, gider
    kaydına dosya eki, kasalar arası Virman — bu sonuncusu meğer zaten
    "Kasalar" ekranındaki "⇄ Hesaplar Arası Transfer" ile karşılanıyormuş,
    ayrıca iş çıkmadı).

- ✅ **Toplu Tahsilat Makbuzu Dökümü** — `GET /documents/toplu-makbuz`
  (yalnızca yönetici): tarih aralığı + opsiyonel kasa filtresiyle
  seçilen dönemdeki tüm ödeme makbuzlarını TEK PDF'de arka arkaya
  basar (her makbuz bir sayfa, mevcut tekli makbuz şablonuyla aynı
  görünüm). Kasalar ekranına "🖨️ Toplu Tahsilat Makbuzu" butonu +
  inline tarih/kasa formu eklendi.
  **Yol boyunca bulunan gerçek hata**: `trSafe()` (PDF'te Türkçe
  karakterleri WinAnsi'ye indirgeyen helper) ₺ işaretini
  tanımıyordu — bir ödeme notu ₺ sembolü içerdiğinde `pdf-lib`
  "WinAnsi cannot encode ₺" hatasıyla 500 veriyordu. `trSafe`'e ₺→"TL"
  eşlemesi eklendi; bu, dosyadaki TÜM PDF uçlarını (tekli makbuz dahil)
  aynı riskten koruyor. `test-toplu-makbuz.js` ile doğrulandı.

- ✅ **Ortak rapor görsel bileşeni** (`report-filter-bar` + `table.report`
  CSS sınıfları, `style.css`) — Mert'in ekran tasarımı geri bildirimi
  üzerine (Yönetimcell'in koyu başlıklı, filtre/tablo hiyerarşisi net
  tablolarıyla karşılaştırma), tüm YENİ rapor sayfaları bundan sonra bu
  bileşenle inşa ediliyor. Mevcut eski ekranlar (basit `table.simple`)
  şimdilik dokunulmadı — backlog bittikten sonra tek seferde tüm
  uygulamaya (ve menü yapısına) uygulanacak.

- ✅ **Günlük Bilanço + Aylık Özet Bilanço** — `GET
  /reports/gunluk-bilanco` (kasa+gün → Devir/Tahsilat/Ödeme/Kalan) ve
  `GET /reports/aylik-ozet-bilanco` (yıl+ay → ayın her günü için
  Giren/Çıkan/Kalan + Toplam satırı), yeni rapor CSS'iyle, Finans
  grubuna eklendi. Mevcut `data.transactions` (her Payment/PartyPayment
  otomatik bir Transaction'a bağlı) üzerinden hesaplanıyor.
  **Yol boyunca bulunan gerçek hata**: Aylık Özet Bilanço'da günlük
  tarih `Date.toISOString().slice(0,10)` ile üretiliyordu — bu UTC'ye
  çevirir, sunucu saat dilimi UTC'nin ilerisinde (TR +3) olduğu için
  her gün bir gün ERKEN gösteriliyordu (1 Ağustos yerine 31 Temmuz).
  Elle `yıl-ay-gün` formatlamaya çevrilip düzeltildi.
  `test-bilanco.js` ile doğrulandı.

**Düşük öncelik / muhtemelen gereksiz** (menü denetiminde görüldü ama
düşük değerli): "Üyelere Toplu Sms Gönder" altındaki hazır şablonlar
("Maliklere Kiracı Borcunu Bildir" — malik/kiracı ilişkisine duyarlı
hedefli SMS — hariç, bu gerçek bir eksik), "Site Sakini Şifrelerini
Gönder" (bizim self-servis kayıt/onay modelimizle uyuşmuyor, admin'in
şifre atayıp SMS'le göndermesi bizim akışımızda yok).

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
