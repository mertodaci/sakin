# Sakin — Site / Apartman Yönetim Uygulaması

Bağımsız, kendi sunucunuzda çalıştırabileceğiniz bir site/apartman yönetim uygulaması.
Node.js + Express backend, **PostgreSQL veritabanı (Prisma ORM)**, JWT ile gerçek
kimlik doğrulama ve kayıt/onay akışı. Bina/apartman ölçeğinde (birkaç yüz daireye
kadar) gerçek kullanım için tasarlanmıştır.

## Hızlı Başlangıç

```bash
npm install
cp .env.example .env      # JWT_SECRET'ı ve Postgres bilgilerini kendinize göre düzenleyin
docker compose up -d      # local PostgreSQL'i ayağa kaldırır (Docker gerekir)
npx prisma migrate deploy # tabloları oluşturur
npx prisma db seed        # örnek demo veriyi yükler (isteğe bağlı, ilk kurulumda önerilir)
npm start
```

Tarayıcıda `http://localhost:3000` adresini açın.

**İlk giriş (demo yönetici hesabı):**
- E-posta: `yonetici@site.com`
- Şifre: `Degistir123!`

`npx prisma db seed` çalıştırıldıysa örnek verilerle (6 daire, birkaç sakin,
2 personel, geçmiş aidat/ödeme kayıtları) veritabanı doldurulur. Kendi binanız için
kullanmadan önce **yönetici hesabının şifresini değiştirin** ve örnek daire/sakin
kayıtlarını "Daireler" ve "Kullanıcılar" sekmelerinden silip kendi verilerinizi girin.

## Neler Gerçek, Neler Demo?

Bu bir prototip değil — kayıt, onay, oturum, borçlandırma, tahsilat, muhasebe vb.
tüm işlemler gerçek bir backend'e yazılıyor ve kalıcı. Ancak üçüncü taraf ücretli
altyapı gerektiren şu maddeler **bu sürümde aktif değil**, sadece bağlanmaya hazır
uç noktalar bırakıldı:

| Özellik | Durum | Neden |
|---|---|---|
| Online kredi kartı ile ödeme | Pasif (`POST /api/pay-online` → 501) | Bir ödeme kuruluşu (iyzico, PayTR, banka sanal POS) sözleşmesi ve API anahtarı gerekir |
| Banka hesap entegrasyonu / otomatik mutabakat | Yok | Banka API'si veya elektronik ekstre entegrasyonu gerekir |
| SMS bildirimleri | Pasif (`routes/comms.js` içindeki `sendSms()`) | Netgsm, İletimerkezi vb. bir SMS sağlayıcısı gerekir |
| E-posta bildirimleri | Yok | SMTP sunucusu / sağlayıcı bilgisi gerekir (nodemailer eklenebilir) |
| Kartlı geçiş / plaka tanıma / kamera | Yok | Fiziksel donanım gerektirir |
| Telefon santrali | Yok | Fiziksel/VoIP altyapı gerektirir |

Bu maddeler için `.env.example` ve ilgili route dosyalarında nereye ekleme
yapılacağı yorum satırlarıyla belirtildi.

## Apsiyon'dan Farkları (Gerçek Şikayetlere Dayalı Kararlar)

Şikayetvar'daki Apsiyon şikayetleri ve global rakiplerin (Buildium, TownSq) neyi
doğru yaptığı araştırılarak alınan somut ürün kararları:

| Yaygın Apsiyon şikayeti | Bu uygulamadaki çözüm |
|---|---|
| Her işlemde gizli "hizmet bedeli" kesintisi | Platform komisyonu yok (kendi sunucunuz); ileride gerçek ödeme kuruluşu eklenirse komisyon açıkça gösterilecek şekilde tasarlandı |
| Havale günlerce sisteme yansımıyor | Sistem kendi veritabanınız — banka gecikmesi yaşanmaz, kayıt anında düşer |
| Otomatik ödemede çift çekim | `POST /api/payments/pay` **idempotency key** (`requestId`) ile korunuyor — aynı istek iki kez işlenemez |
| Giriş/2FA sorunları, şifre kurtaramama | **Şifremi Unuttum** akışı: sakin talep eder → yönetici geçici şifre üretir → ilk girişte zorunlu şifre değişimi |
| "Onay bekleniyor" durumunda yönetime ulaşamama | Kullanıcılar ekranında bekleyen kayıtlar için **gün sayacı + 3+ gün gecikme rozeti** |
| Banka kredisi için "borcu yoktur" yazısı alamama | Borcu sıfır olan sakin **anında PDF belge** indirebiliyor (`/api/documents/debt-letter`) |
| Şeffaflık eksikliği / "param nereye gitti" güvensizliği | **Değiştirilemez denetim kaydı (audit log)** — her finansal/idari işlem izlenebilir, sakinler kendi dairesiyle ilgili kayıtları görebilir |
| Sürpriz ücret/bütçe artışları | **Yıllık bütçe planlama modülü** — planlanan vs gerçekleşen karşılaştırması |
| Platforma kilitlenme korkusu | Yönetici tek tıkla **tüm site verisini JSON olarak dışa aktarabilir** |

## Şikayet Değil, Rutin İhtiyaç Olan Ek Özellikler

Yukarıdakiler şikayet odaklı çözümler. Bunların yanında, hiçbir şikayette geçmese
de Türkiye'deki apartman/site yönetiminin günlük rutininde olmazsa olmaz özellikler:

- **Gecikme faizi** — Kat Mülkiyeti Kanunu gereği yaygın uygulama. Vadesi + tolerans
  süresi geçen aidatlara, ayda bir kez, ayarlanabilir oranda otomatik faiz eklenir
  (mükerrer uygulanmaz).
- **Otomatik aylık aidat borçlandırma** — Ayarlanan günde tüm dairelere otomatik
  borç oluşturulur; yöneticinin her ay elle "borçlandır" tıklaması gerekmez.
- **Telefon rehberi** — Kapıcı, asansör firması, tesisatçı gibi faydalı numaralar +
  personel + daire malik/kiracı telefonları, aranabilir tek ekranda.
- **Yazdırılabilir aidat borç listesi (PDF ve Excel/CSV)** — İlan panosuna
  asılabilecek PDF liste, ayrıca muhasebeciyle paylaşmak veya kendi tabloya
  aktarmak için Excel uyumlu CSV indirme.

Bu özellikler "Ayarlar" ve "Rehber" sekmelerinden yönetilir.

## Yönetimcell Karşılaştırması ile Eklenenler

Gerçek bir rakip uygulamanın (Yönetimcell) menü yapısı incelenerek şu yapısal
eklemeler yapıldı:

- **Sol menü (accordion) navigasyon** — üst menü yerine, tıklayarak açılıp
  kapanan gruplu sol menü.
- **Çoklu kasa/banka hesabı yönetimi** — banka, nakit, POS gibi hesaplar ayrı
  ayrı bakiye tutar; hesaplar arası transfer ve hesap ekstresi desteklenir.
  Tüm gelir/gider ve tahsilatlar artık bir hesaba bağlanır.
- **Firma & Personel cari hesap** — tedarikçilere (asansör firması, temizlik
  firması vb.) ve personele yapılan borçlandırma/ödemelerin ayrı takibi;
  ödemeler seçilen kasadan düşer ve otomatik muhasebe kaydı oluşturur.

Devam eden yol haritası: alacaklı/kredi bakiyesi desteği, ileri tarihli
borçlandırma, yapılandırılmış raporlar modülü, iç görev takibi (İş Takibi),
gelen kutusu (özel mesajlaşma), dosya arşivi, toplu SMS/e-posta arayüzü,
hukuki modül (tebligat, icra takibi, genel kurul evrakları).

**Sakin:** Özet, Aidatım (borç + ödeme), Sayaçlarım, Duyurular, Anketler,
Ortak alan rezervasyonu, Arıza/Talep, Kargolarım, Site Panosu (ilan/yardımlaşma),
Rehber, Şeffaflık.

**Yönetici:** Yukarıdakilere ek olarak — Kullanıcılar (kayıt onayı, şifre sıfırlama,
personel ekleme), Daireler (CRM), Aidat Takibi (toplu borçlandırma, tahsilat),
Muhasebe (gelir-gider, aylık grafik), Kasalar (çoklu hesap), Firma & Personel
Cari Hesap, Bütçe Planlama, Personel, Demirbaş & Bakım-Onarım, Sayaç Okuma &
Faturalama, Kargo Yönetimi, Karar Defteri, Anahtar Takibi, Ayarlar.

**Personel:** Kendisine atanan talepler, demirbaş listesi, kargo işlemleri.

## Veri Bütünlüğü ve Güvenlik Sertleştirmesi

Gerçek kullanımda "yanlış girdim, geri alayım" ihtiyacı sürekli çıkar. Bu nedenle
şu işlemlerin hepsi **iptal edilebilir veya düzenlenebilir** hale getirildi:

- Aidat tahsilatı: kısmi ödeme desteklenir, ödeme iptal edilince ilgili borç
  otomatik yeniden açılır ve kasa bakiyesi düzeltilir.
- Firma/personel ödemeleri: aynı iptal mekanizması.
- Manuel/aylık borçlandırma kayıtları: silinebilir ve düzenlenebilir (ödeme
  yapılmışsa önce ödemenin iptali gerekir — veri tutarlılığı için).
- Sayaç faturaları: yanlış girilen okuma, bağlı borcuyla birlikte silinebilir.
- Muhasebe hareketleri: düzenlenebilir (ödemeye bağlı olmayanlar).
- Kargo ve demirbaş bakım kayıtları: geri alınabilir.
- Kullanıcılar: kalıcı silme yerine **pasife alma** seçeneği — geçmiş kayıtlar
  korunur, sadece giriş engellenir.

**Güvenlik:**
- Giriş/kayıt/şifre sıfırlama uçlarında rate limiting (kaba kuvvet koruması)
- Şifre politikası: en az 8 karakter, harf ve rakam zorunlu
- 5 hatalı girişten sonra hesap 15 dakika kilitlenir
- Oturum iptali (`tokenVersion`): şifre değişince veya kullanıcı pasife alınınca
  diğer cihazlardaki eski oturumlar otomatik geçersiz olur; kullanıcı istediği
  zaman "Tüm Oturumları Kapat" ile bunu manuel tetikleyebilir (sağ üstteki
  kullanıcı menüsünden)

**PostgreSQL geçişi:** Veritabanı katmanı JSON dosyasından PostgreSQL/Prisma'ya
taşındı. En riskli/parasal modüller (kimlik doğrulama, kişi rehberi, aidat/ödeme/
muhasebe — ödeme ve iptal akışı `prisma.$transaction` ile atomik) gerçek Prisma
sorgularına geçirildi ve test edildi. Geri kalan modüller (rezervasyon, arıza/
talep, duyuru/anket, kargo, demirbaş, anahtar, firma/personel cari hesabının iş
mantığı, ayarlar) hâlâ Postgres'e okuyan/yazan bir uyumluluk katmanı (`db.js`
içindeki shim) üzerinden çalışıyor — fonksiyonel olarak doğru, sadece henüz
"native" Prisma sorgusu değil. Detay ve devam planı için `ROADMAP.md`'ye bakın.

## Mimarî

```
server.js          → Express giriş noktası, statik dosyalar + /api
db.js               → Postgres/Prisma uzerinden calisan, henuz native Prisma'ya
                      tasinmamis route'lar icin eski JSON-sekilli okuma/yazma shim'i
prisma/schema.prisma → veritabani semasi (tum tablolar)
middleware/auth.js  → JWT doğrulama + rol bazlı yetkilendirme
routes/
  auth.js           → kayıt, giriş, oturum (native Prisma)
  directory.js      → daireler, kullanıcılar, personel hesabı oluşturma (kullanıcı mutasyonları native Prisma)
  finance.js        → borçlandırma (aidat/sayaç/diğer), ödeme, muhasebe hareketleri (native Prisma, atomik $transaction)
  contacts.js       → telefon rehberi (native Prisma)
  comms.js          → duyuru, anket, site panosu, bildirimler
  ops.js            → rezervasyon, arıza/talep, personel, demirbaş, sayaç, kargo, karar defteri, anahtar
  dashboard.js      → özet istatistikler
public/             → saf HTML/CSS/JS arayüz (derleme adımı gerekmez)
```

## Kendi Sunucunuzda Yayına Alma

- Basit bir VPS (örn. 1-2 GB RAM yeterli) üzerinde `pm2` ile çalıştırabilirsiniz:
  `npm i -g pm2 && pm2 start server.js --name sakin`
- PostgreSQL'i de aynı sunucuda Docker Compose ile (`docker compose up -d`) veya
  yönetilen bir veritabanı servisinde (RDS, Supabase, Neon vb.) çalıştırabilirsiniz.
- HTTPS için önüne Nginx/Caddy reverse proxy koymanız önerilir.
- Veritabanını düzenli yedekleyin: `pg_dump` ile, veya "Ayarlar" ekranındaki
  tüm veriyi JSON dışa aktarma özelliğiyle ek bir kopya alın.
- `.env` dosyasındaki `JWT_SECRET`'ı mutlaka uzun ve rastgele bir değerle değiştirin.

## Bilinen Sınırlar

- Aynı anda çok sayıda binayı yöneten büyük ölçekli bir yönetim şirketi için bu
  sürüm tek-bina varsayımıyla yazıldı (çoklu bina desteği eklenebilir).
- E-posta doğrulama yoktur; kayıt olan kullanıcıyı yönetici manuel onaylar.
- Bazı route dosyaları henüz native Prisma'ya taşınmadı (bkz. yukarıdaki
  "PostgreSQL geçişi" notu) — fonksiyonel olarak doğru çalışıyor, ileride
  temizlenebilir bir teknik borç.
