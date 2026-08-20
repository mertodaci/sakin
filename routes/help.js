// "Kapıcı AI" - uygulama ici kullanim yardimcisi. Kullanicilarin "nasil X
// yaparim" tarzi sorularina, ekranlar arasinda yon gosteren adim adim
// yanit veren KURAL/ANAHTAR-KELIME tabanli yerel bir SSS eslestirici -
// dis bir LLM servisine (API anahtari, maliyet, internet bagimliligi)
// ihtiyac duymadan calisir. Sorular kapali/tanimli bir kume oldugu icin
// (uygulamanin kendi ekranlari) bu, tam bir LLM'den daha guvenilir ve
// ucretsiz - her zaman GERCEK, var olan bir ekrana yonlendirir.
const express = require("express");
const prisma = require("../lib/prismaClient");
const { requireAuth, requireRole } = require("../middleware/auth");
const { myUnitIds } = require("../lib/residentUnits");

const router = express.Router();

function tl(n) {
  return `${Number(n).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}₺`;
}

// Dashboard'daki (routes/dashboard.js) ayni hesabin kucuk, dogrudan-Prisma
// bir tekrari - db.load()'un butun legacy koleksiyonlarini cekmek yerine
// (bu YENI ozellik icin gereksiz agir olurdu) sadece ihtiyaci olan iki
// sorguyu (Charge+Unit) yapar. Iki yerde ayni formul oldugu icin dashboard.js
// degisirse burasi da elle guncellenmeli.
async function unitNetDebts() {
  const [charges, units] = await Promise.all([
    prisma.charge.findMany({ where: { status: { not: "paid" } }, select: { unitId: true, amount: true, paidAmount: true } }),
    prisma.unit.findMany({ select: { id: true, creditBalance: true } }),
  ]);
  const openByUnit = new Map();
  charges.forEach((c) => openByUnit.set(c.unitId, (openByUnit.get(c.unitId) || 0) + Number(c.amount) - Number(c.paidAmount)));
  return units.map((u) => (openByUnit.get(u.id) || 0) - Number(u.creditBalance || 0));
}

// Kasa toplam bakiyesi: acilis bakiyeleri + gelir/gider hareketleri. Kasalar
// ARASI transferler toplami degistirmez (biri +tutar, digeri -ayni tutar,
// site-geneli toplamda birbirini goturur) - dashboard.js/accounts.js'in
// tek-hesap `accountBalance()`'inin aksine burada hesap bazinda ayirmaya
// gerek yok, tum hesaplari tek sorguda toplayabiliriz.
async function computeKasaTotal() {
  const [accounts, transactions] = await Promise.all([
    prisma.account.findMany({ select: { openingBalance: true } }),
    prisma.transaction.findMany({ select: { type: true, amount: true } }),
  ]);
  const opening = accounts.reduce((s, a) => s + Number(a.openingBalance), 0);
  const net = transactions.reduce((s, t) => s + (t.type === "gelir" ? Number(t.amount) : -Number(t.amount)), 0);
  return opening + net;
}

// User modeli bilerek global (coklu-siteli personelin tek giris kimligi
// olmasi icin) - UserSiteAccess uzerinden SADECE bu sitenin kullanicilarini
// sayiyoruz (bkz. ops.js/finance.js'teki ayni sinif duzeltmeler).
async function computePendingApprovals(siteId) {
  const access = await prisma.userSiteAccess.findMany({ where: { siteId }, include: { user: true } });
  return access.filter((a) => !a.user.isApproved).length;
}

// Ekran-icerik indeksi: scripts/build-help-index.js tarafindan public/js/
// app.js'teki her ekranin GERCEK metninden otomatik uretilir (bkz. o
// dosyadaki aciklama). app.js'e yeni bir ekran/metin eklendiginde elle
// yeniden calistirilmali (`node scripts/build-help-index.js`) - otomatik
// tetiklenmez. Dosya yoksa (henuz hic uretilmediyse) 3. kademe sessizce
// devre disi kalir, uygulama patlamaz.
let HELP_INDEX = {};
try { HELP_INDEX = require("./helpIndex.json"); } catch { /* henuz uretilmemis */ }

// Her girdi: hangi rol(ler) icin gecerli, esleme icin anahtar kelimeler
// (kullanicinin yazabilecegi farkli ifadeler), kisa adim-adim cevap, ve
// (varsa) "ilgili sekmeye git" butonu icin tab id'si.
const KB = [
  // ---------------- SAKIN ----------------
  {
    id: "odeme-yap",
    roles: ["sakin"],
    keywords: ["ödeme yap", "nasıl öder", "aidat öde", "kredi kartı ile öde", "borcumu öde", "ödeme nasıl", "aidatımı nasıl yatırırım", "para yatır", "online öde", "kart ile ödeme", "aidat yatır", "borç yatır"],
    answer: "**Borç ve Ödemelerim** sayfasına gidin. Üstte ödenecek tutarı görürsünüz; birden fazla daireniz varsa önce hangi daire için ödeme yapacağınızı seçin. Ardından **\"Ödeme Yap\"** butonuna basmanız yeterli.",
    tab: "aidat",
  },
  {
    id: "borc-hareketi-sakin",
    roles: ["sakin"],
    keywords: ["borç hareket", "borcumu gör", "ne kadar borcum var", "hesap özeti", "borç dökümü", "aidat borcu", "kaç para borçluyum", "bakiyem ne kadar"],
    answer: "**Borç ve Ödemelerim** sayfasında \"Borç Kalemleri\" bölümünde tüm borçlarınızı, altında da geçmiş ödemelerinizi görebilirsiniz.",
    tab: "aidat",
  },
  {
    id: "makbuz",
    roles: ["sakin"],
    keywords: ["makbuz", "ödeme belgesi", "dekont", "fatura al", "ödeme kanıtı"],
    answer: "**Borç ve Ödemelerim** sayfasındaki \"Ödeme Geçmişi\" bölümünde her ödemenin yanında **📄 Makbuz** butonu var, tıklayınca PDF olarak iner.",
    tab: "aidat",
  },
  {
    id: "borcu-yoktur",
    roles: ["sakin"],
    keywords: ["borcu yoktur belgesi", "borcu yoktur yazısı", "banka için belge", "borcum olmadığına dair yazı"],
    answer: "Borcunuz yoksa (bakiyeniz sıfır veya alacaklıysanız) **Borç ve Ödemelerim** sayfasında **\"📄 Borcu Yoktur Belgesi\"** butonu görünür, tıklayınca anında PDF üretilir.",
    tab: "aidat",
  },
  {
    id: "talep-bildir",
    roles: ["sakin"],
    keywords: ["arıza bildir", "talep oluştur", "şikayet", "tamir iste", "yeni talep", "arıza var", "bir şey bozuldu", "usta çağır", "sorun bildir"],
    answer: "**Arıza/Talep** sayfasında **\"+ Yeni Talep\"** butonuna basıp kategori, başlık ve açıklama girerek talebinizi iletebilirsiniz. Yönetim, talebinizin durumunu güncelledikçe bildirim alırsınız.",
    tab: "talep",
  },
  {
    id: "rezervasyon-sakin",
    roles: ["sakin"],
    keywords: ["rezervasyon yap", "ortak alan ayır", "salon rezervasyon", "havuz rezervasyon", "toplantı salonu ayırt", "spor salonu ayırt"],
    answer: "**Rezervasyon** sayfasından tesis, tarih ve saat aralığı seçip \"Rezerve Et\" ile ortak alan rezervasyonu yapabilirsiniz.",
    tab: "rezervasyon",
  },
  {
    id: "sayac-sakin",
    roles: ["sakin"],
    keywords: ["sayaç okuma", "su faturam", "doğalgaz faturam", "sayaç geçmişi", "elektrik faturam", "kaç metreküp su kullandım"],
    answer: "**Sayaçlarım** sayfasında kayıtlı sayaçlarınızı ve geçmiş okuma/fatura tutarlarını görebilirsiniz.",
    tab: "sayac",
  },
  {
    id: "kargo-sakin",
    roles: ["sakin"],
    keywords: ["kargom", "paketim geldi mi", "kargo takibi", "kargom nerede", "paket teslim alındı mı"],
    answer: "**Kargolarım** sayfasında size teslim alınan kargoları görebilirsiniz.",
    tab: "kargo",
  },
  {
    id: "coklu-daire",
    roles: ["sakin"],
    keywords: ["iki dairem var", "birden fazla dairem", "diğer dairemi gör", "daireler arası geç", "başka dairemin borcu"],
    answer: "Aynı sitede birden fazla daireniz varsa **Borç ve Ödemelerim** sayfasının üstünde bir \"Daire\" seçici görünür: \"Tümü\" ile tüm dairelerinizin birleşik borcunu, ya da tek bir daireyi seçip sadece onu görebilirsiniz.",
    tab: "aidat",
  },

  // ---------------- YONETICI ----------------
  {
    id: "yeni-daire-ekle",
    roles: ["yonetici"],
    keywords: ["yeni daire ekle", "daire tanımla", "bağımsız bölüm ekle", "daire oluştur", "blok ekle", "sisteme daire kaydet"],
    answer: "**Daireler** sayfasında \"Yeni Daire Ekle\" formundan blok, daire no ve diğer bilgileri girip ekleyebilirsiniz.",
    tab: "daireler",
  },
  {
    id: "odeme-girisi-yonetici",
    roles: ["yonetici"],
    keywords: ["ödeme girişi yap", "tahsilat gir", "elden ödeme al", "nakit tahsilat", "ödeme kaydet", "sakinden para aldım", "manuel ödeme gir"],
    answer: "**Borç & Tahsilat** sayfasında ilgili daireyi bulup \"Ödeme Al\" ile tutar ve yöntem girerek tahsilatı kaydedebilirsiniz. Ödeme otomatik olarak en eski açık borçtan başlayarak dağıtılır.",
    tab: "tahsilat",
  },
  {
    id: "fatura-girisi",
    roles: ["yonetici"],
    keywords: ["fatura girişi", "gider girişi", "fatura ekle", "gider kaydet", "harcama gir", "para harcadım nereye yazarım", "fatura gir", "gider gir", "fatura nereye", "gider nereye", "harcama nereye"],
    answer: "**Muhasebe** veya **Giderler** sayfasından \"Gider\" türünde yeni bir hareket girerek kategori, tutar ve açıklama ile faturayı kaydedebilirsiniz. Firma bazlı fatura/borçlandırma için **Firma & Personel** sayfasını kullanın.",
    tab: "muhasebe",
  },
  {
    id: "borc-hareketi-yonetici",
    roles: ["yonetici"],
    keywords: ["borç hareketi gör", "borç listesi", "kimin borcu var", "açık borçlar", "hangi daireler borçlu"],
    answer: "**Borç Listesi** sayfasında tüm dairelerin açık borçlarını, **Borç & Tahsilat** sayfasında ise daire bazlı borç/ödeme hareketlerini görebilirsiniz.",
    tab: "borclistesi",
  },
  {
    id: "hesap-dokumu-yonetici",
    roles: ["yonetici"],
    keywords: ["hesap dökümü", "hesap hareketi", "ekstre al", "daire ekstresi", "hesap özeti çıkar", "dairenin geçmiş borç ödeme dökümü"],
    answer: "**Daireler** sayfasında ilgili dairenin kartındaki **📄 (Hesap Özeti)** butonuyla o dairenin tüm borç/ödeme dökümünü, **📋 (Borç Dökümü)** butonuyla sadece açık borçlarını PDF olarak alabilirsiniz. Kasa/banka hesap ekstresi için **Kasalar** sayfasına bakın.",
    tab: "daireler",
  },
  {
    id: "kullanici-onayla",
    roles: ["yonetici"],
    keywords: ["yeni sakin onayla", "kayıt onayı", "üyelik onayla", "kullanıcı onayla", "kayıt bekleyen var mı", "onay bekleyen sakinler"],
    answer: "**Kullanıcılar** sayfasında \"Onay Bekleyenler\" bölümünden yeni kayıt olan sakinleri onaylayabilir veya reddedebilirsiniz.",
    tab: "kullanicilar",
  },
  {
    id: "personel-ekle",
    roles: ["yonetici"],
    keywords: ["personel ekle", "yeni personel", "kapıcı ekle", "güvenlik ekle", "temizlikçi ekle", "personel hesabı oluştur"],
    answer: "**Kullanıcılar** sayfasının altındaki \"Yeni Personel Ekle\" formundan doğrudan personel hesabı oluşturabilirsiniz (onay beklemez).",
    tab: "kullanicilar",
  },
  {
    id: "sakine-ikinci-daire",
    roles: ["yonetici"],
    keywords: ["sakine ikinci daire", "bir kullanıcıya başka daire", "aynı kişinin iki evi", "ek daire bağla", "bir malikin birden fazla dairesi"],
    answer: "**Kullanıcılar** sayfasında ilgili sakinin \"Düzenle\" butonuna basın, açılan pencerenin altında \"Daireleri\" bölümünden ek bir daire seçip \"Ekle\" diyebilirsiniz.",
    tab: "kullanicilar",
  },
  {
    id: "duyuru-yayinla",
    roles: ["yonetici"],
    keywords: ["duyuru yayınla", "duyuru ekle", "ilan ver", "sakinlere duyuru gönder", "site geneline bildirim"],
    answer: "**Duyurular** sayfasında \"+ Yeni Duyuru\" ile başlık ve içerik girerek anında yayınlayabilirsiniz.",
    tab: "duyuru",
  },
  {
    id: "anket-olustur",
    roles: ["yonetici"],
    keywords: ["anket oluştur", "oylama başlat", "anket aç", "sakinlere oylama yaptır"],
    answer: "**Anketler** sayfasında \"+ Yeni Anket\" ile soru ve seçenekleri girip anketi başlatabilirsiniz.",
    tab: "anket",
  },
  {
    id: "gecikme-faizi-ayarla",
    roles: ["yonetici"],
    keywords: ["gecikme faizi ayarla", "otomatik borçlandırma ayarla", "aylık aidat tutarı değiştir", "aidat zammı", "gecikme cezası oranı"],
    answer: "**Ayarlar** sayfasından gecikme faizi oranı/tolerans süresini ve otomatik aylık aidat borçlandırmasını (gün, tutar, açık/kapalı) düzenleyebilirsiniz.",
    tab: "ayarlar",
  },
  {
    id: "varsayilan-hesap",
    roles: ["yonetici"],
    keywords: ["varsayılan hesap", "tahsilat hangi hesaba", "kasa seç", "ödemeler nereye düşer"],
    answer: "**Ayarlar** sayfasının altındaki \"Varsayılan Tahsilat Hesabı\" bölümünden, hesap seçilmeden yapılan ödemelerin hangi kasaya/banka hesabına yazılacağını belirleyebilirsiniz. Önce **Kasalar** sayfasından en az bir hesap oluşturmanız gerekir.",
    tab: "ayarlar",
  },
  {
    id: "kasa-ekle",
    roles: ["yonetici"],
    keywords: ["kasa ekle", "banka hesabı ekle", "yeni hesap oluştur", "nakit kasa tanımla"],
    answer: "**Kasalar** sayfasından yeni bir banka/nakit/pos hesabı ekleyip açılış bakiyesini girebilirsiniz.",
    tab: "kasalar",
  },
  {
    id: "yeni-site-olustur",
    roles: ["yonetici"],
    keywords: ["yeni site oluştur", "başka bir site ekle", "ikinci site", "site kur", "birden fazla siteyi tek hesaptan yönet"],
    answer: "Platform sahibiyseniz **Platform Yönetimi** sayfasından \"Yeni Site Oluştur\" formuyla bir site + ilk yöneticisini tek seferde oluşturabilirsiniz. Bu menü sadece platform sahibi hesaplarda görünür.",
    tab: "platform",
  },
  {
    id: "coklu-site-erisimi",
    roles: ["yonetici"],
    keywords: ["birden fazla siteye erişim", "bölge yöneticisi yap", "başka siteye de erişsin", "aynı kullanıcı iki siteyi yönetsin"],
    answer: "Platform sahibiyseniz **Platform Yönetimi** sayfasındaki \"Çoklu-Site Erişimi\" arama kutusundan kullanıcıyı bulup ek bir sitenin erişimini verebilirsiniz.",
    tab: "platform",
  },
  {
    id: "akilli-site-iot",
    roles: ["yonetici"],
    // DIKKAT: Turkce'nin eklemeli yapisi yuzunden (orn. "havuzun klor..."
    // icinde "havuz klor" alt-dize olarak GECMEZ) coklu kelimeli anahtar
    // kalipları yerine, kok kelimeyi tek basina kullanmak eklerden bagimsiz
    // eslesme sagliyor - bu KB'deki diger coklu-kelimeli girdilerde ilk
    // kelime genelde zaten ek almayan bir fiil/isim oldugu icin bu sorun
    // cikmiyor, ama "havuz", "otopark" gibi ek alma ihtimali yuksek isimlerde
    // tek kelime kullanmak daha guvenilir. (findBestMatch artik kok/on-ek
    // eslesmesi de yaptigi icin bu tedbir buyuk olcude gereksizlesti, ama
    // zarari da yok.)
    keywords: ["havuz", "klor", "otopark", "bariyer", "kamera izle", "sulama", "kaçak", "iot", "akıllı site", "aydınlatma", "jeneratör", "asansör"],
    answer: "**Akıllı Site Sistemleri** sayfasında havuz, aydınlatma, kamera, otopark bariyeri, sulama hattı, jeneratör ve asansör cihazlarınızı görüp yönetebilirsiniz. Aydınlatma/bariyer için \"Aç\"/\"Kapat\", sensörler için \"🔄 Yenile\" butonlarını kullanın.",
    tab: "akillisite",
  },

  // ---------------- GENEL (tum roller) ----------------
  {
    id: "sifre-degistir",
    roles: ["sakin", "yonetici", "personel"],
    keywords: ["şifremi değiştir", "şifremi unuttum", "şifre sıfırla", "parolamı değiştir", "giriş yapamıyorum şifre"],
    answer: "Giriş yapmışsanız sağ üstteki kullanıcı menüsünden \"Şifre Değiştir\"i kullanın. Şifrenizi unuttuysanız giriş ekranındaki \"Sıfırlama talep edin\" ile yöneticinize geçici bir şifre oluşturması için talep gönderebilirsiniz.",
  },
  {
    id: "koyu-mod",
    roles: ["sakin", "yonetici", "personel"],
    keywords: ["koyu mod", "karanlık tema", "gece modu", "ekran çok parlak", "tema değiştir"],
    answer: "Sağ üstteki güneş/ay ikonuna tıklayarak koyu/açık mod arasında geçiş yapabilirsiniz.",
  },
  {
    id: "site-degistir",
    roles: ["sakin", "yonetici", "personel"],
    keywords: ["site değiştir", "başka siteye geç", "farklı site seç", "diğer siteyi görüntüle"],
    answer: "Birden fazla siteye erişiminiz varsa sağ üstteki kullanıcı menüsünde \"Site Değiştir\" seçeneği görünür.",
  },
];

// 0. kademe (KB'den ONCE denenir): "toplam borç ne kadar" gibi RAKAM isteyen
// sorular icin - eskiden (bkz. ROADMAP) chatbot bu tarz sorulara sadece
// dogru ekrana yonlendiriyordu, rakam vermiyordu. compute() her cagrida
// CANLI hesaplanir (KB gibi sabit metin degil). Ayni kelime-kumesi
// eslestirici (bkz. bestKeywordMatch) KB ile paylasilir - roller/keywords
// ayni sekilde calisir, sadece answer yerine compute(req) var.
const LIVE_QUERIES = [
  {
    id: "toplam-alacak-canli",
    roles: ["yonetici", "personel"],
    // DIKKAT: bu uygulamada "alacak" SITENIN acisindandir (sakinlerin
    // siteye olan borcu = sitenin alacagi) - "toplam borc (odenecek)"
    // ise sitenin firma/personele olan borcu (bkz. public/js/app.js:1633-1634
    // "TOPLAM ALACAK" -> dash.totalDebt, "TOPLAM BORÇ (ÖDENECEK)" ->
    // dash.totalPayables). Iki ayri girdi, karistirilmasin diye cevap
    // metninde de aciklaniyor.
    keywords: ["toplam alacak", "üyelerin borcu ne kadar", "sakinlerin borcu ne kadar", "dairelerin borcu ne kadar", "ne kadar alacağımız var", "kaç alacak var"],
    compute: async () => {
      const debts = await unitNetDebts();
      const total = debts.reduce((s, d) => s + Math.max(0, d), 0);
      return { answer: `Şu an dairelerin siteye toplam açık borcu (sitenin alacağı) **${tl(total)}**.`, tab: "tahsilat" };
    },
  },
  {
    id: "toplam-odenecek-borc-canli",
    roles: ["yonetici", "personel"],
    keywords: ["toplam borcumuz", "sitenin borcu ne kadar", "firmalara borç ne kadar", "ödenecek borç ne kadar", "ne kadar borcumuz var", "kaç borcumuz var"],
    compute: async () => {
      const payables = await prisma.partyCharge.findMany({ where: { status: { not: "paid" } }, select: { amount: true, paidAmount: true } });
      const total = payables.reduce((s, c) => s + Number(c.amount) - Number(c.paidAmount), 0);
      return { answer: `Sitenin firma/personele olan toplam ödenecek borcu **${tl(total)}**.`, tab: "borclistesi" };
    },
  },
  {
    id: "kasa-bakiyesi-canli",
    roles: ["yonetici", "personel"],
    keywords: ["kasa bakiyesi", "kasada ne kadar var", "toplam kasa", "ne kadar paramız var", "banka bakiyesi ne kadar"],
    compute: async () => {
      const total = await computeKasaTotal();
      return { answer: `Tüm kasa/banka hesaplarının toplam bakiyesi **${tl(total)}**.`, tab: "kasalar" };
    },
  },
  {
    id: "acik-talep-sayisi-canli",
    roles: ["yonetici", "personel"],
    keywords: ["kaç açık talep", "açık talep sayısı", "bekleyen arıza kaç", "kaç arıza var", "kaç talep var"],
    compute: async () => {
      const count = await prisma.ticket.count({ where: { status: { not: "Çözüldü" } } });
      return { answer: `Şu an **${count}** açık talep var.`, tab: "talep" };
    },
  },
  {
    id: "onay-bekleyen-canli",
    roles: ["yonetici"],
    keywords: ["kaç onay bekleyen", "onay bekleyen kaç kişi", "bekleyen kayıt sayısı", "kaç kayıt bekliyor"],
    compute: async (req) => {
      const count = await computePendingApprovals(req.user.siteId);
      return { answer: `Onay bekleyen **${count}** kayıt var.`, tab: "kullanicilar" };
    },
  },
  {
    id: "sakin-borcu-canli",
    roles: ["sakin"],
    keywords: ["borcum ne kadar", "ne kadar borcum var", "kaç para borçluyum", "bakiyem ne kadar"],
    compute: async (req) => {
      const unitIds = await myUnitIds(prisma, req.user);
      let total = 0;
      for (const unitId of unitIds) {
        const [charges, unit] = await Promise.all([
          prisma.charge.findMany({ where: { unitId, status: { not: "paid" } }, select: { amount: true, paidAmount: true } }),
          prisma.unit.findUnique({ where: { id: unitId }, select: { creditBalance: true } }),
        ]);
        const open = charges.reduce((s, c) => s + Number(c.amount) - Number(c.paidAmount), 0);
        total += open - Number(unit?.creditBalance || 0);
      }
      if (total <= 0) return { answer: "Görünürde açık bir borcunuz yok. 🎉", tab: "aidat" };
      return { answer: `Toplam açık borcunuz **${tl(total)}**.`, tab: "aidat" };
    },
  },
];

// 2. kademe eslesme icin: public/js/app.js'teki NAV_GROUPS ile ayni
// ekran isimleri (bilerek kucuk bir kopya - nav degisince burasi da elle
// guncellenmeli, ama nav degisiklikleri seyrek). KB'de eslesme yoksa,
// soru bu GERCEK sayfa adlarindan biriyle ortusuyorsa en azindan dogru
// sayfaya yonlendirir - "goruntule/olustur/duzenle" gibi her eylemi KB'de
// ayri ayri tanimlamak yerine ("talepleri nerede gorurum" gibi sorular
// icin), var olan sayfa isimlerini ikinci bir sozluk gibi kullanir.
const NAV_LABELS = [
  { tab: "ozet", label: "Özet", roles: ["sakin", "yonetici", "personel"] },
  { tab: "mesajlar", label: "Gelen Mesajlar", roles: ["sakin", "yonetici"] },
  { tab: "aidat", label: "Borç ve Ödemelerim", roles: ["sakin"] },
  { tab: "sayac", label: "Sayaçlarım", roles: ["sakin"] },
  { tab: "sayac", label: "Sayaçlar", roles: ["yonetici"] },
  { tab: "duyuru", label: "Duyurular", roles: ["sakin", "yonetici"] },
  { tab: "anket", label: "Anketler", roles: ["sakin", "yonetici"] },
  { tab: "pano", label: "Site Panosu", roles: ["sakin", "yonetici"] },
  { tab: "rehber", label: "Rehber", roles: ["sakin", "yonetici", "personel"] },
  { tab: "rezervasyon", label: "Rezervasyon", roles: ["sakin"] },
  { tab: "rezervasyon", label: "Rezervasyonlar", roles: ["yonetici"] },
  { tab: "talep", label: "Arıza Talep", roles: ["sakin"] },
  { tab: "talep", label: "Talepler", roles: ["yonetici", "personel"] },
  { tab: "kargo", label: "Kargolarım", roles: ["sakin"] },
  { tab: "kargo", label: "Kargo", roles: ["yonetici", "personel"] },
  { tab: "seffaflik", label: "Şeffaflık", roles: ["sakin", "yonetici"] },
  { tab: "bilgibankasi", label: "Bilgi Bankası", roles: ["sakin", "yonetici"] },
  { tab: "ajanda", label: "Ajanda", roles: ["yonetici"] },
  { tab: "istakibi", label: "İş Takibi", roles: ["yonetici", "personel"] },
  { tab: "kullanicilar", label: "Kullanıcılar", roles: ["yonetici"] },
  { tab: "daireler", label: "Daireler", roles: ["yonetici"] },
  { tab: "ikametedenler", label: "İkamet Edenler Listesi", roles: ["yonetici"] },
  { tab: "bosdolu", label: "Boş Dolu Taşınmaz Listesi", roles: ["yonetici"] },
  { tab: "tckimlik", label: "Tc Kimlik No Listesi", roles: ["yonetici"] },
  { tab: "aracplaka", label: "Araç Plaka Listesi", roles: ["yonetici"] },
  { tab: "detayliuyelistesi", label: "Detaylı Üye Listesi", roles: ["yonetici"] },
  { tab: "tahsilat", label: "Borç Tahsilat", roles: ["yonetici"] },
  { tab: "muhasebe", label: "Muhasebe", roles: ["yonetici"] },
  { tab: "kasalar", label: "Kasalar", roles: ["yonetici"] },
  { tab: "cari", label: "Firma Personel", roles: ["yonetici"] },
  { tab: "giderler", label: "Giderler", roles: ["yonetici"] },
  { tab: "borclistesi", label: "Borç Listesi", roles: ["yonetici"] },
  { tab: "tekrarlayan", label: "İleri Tarihli Tekrarlayan", roles: ["yonetici"] },
  { tab: "muhasebekod", label: "Muhasebe Kodları", roles: ["yonetici"] },
  { tab: "isletmeprojesi", label: "İşletme Projesi", roles: ["yonetici"] },
  { tab: "butce", label: "Bütçe", roles: ["yonetici"] },
  { tab: "toplusms", label: "Toplu Sms E-posta", roles: ["yonetici"] },
  { tab: "personel", label: "Personel", roles: ["yonetici"] },
  { tab: "demirbas", label: "Demirbaş", roles: ["yonetici", "personel"] },
  { tab: "anahtar", label: "Anahtarlar", roles: ["yonetici"] },
  { tab: "akillisite", label: "Akıllı Site Sistemleri", roles: ["yonetici"] },
  { tab: "karar", label: "Karar Defteri", roles: ["yonetici"] },
  { tab: "icra", label: "İcra Takibi", roles: ["yonetici"] },
  { tab: "belgeler", label: "Belge Şablonları", roles: ["yonetici"] },
  { tab: "arsiv", label: "Dosya Arşivi", roles: ["yonetici"] },
  { tab: "ayarlar", label: "Ayarlar", roles: ["yonetici"] },
  { tab: "geneldurum", label: "Genel Durum Raporu", roles: ["yonetici"] },
  { tab: "mizan", label: "Mizan Raporu", roles: ["yonetici"] },
  { tab: "fisler", label: "Tahakkuk Fişleri", roles: ["yonetici"] },
  { tab: "denetimraporu", label: "Denetim Kurulu Raporu", roles: ["yonetici"] },
  { tab: "faaliyetraporu", label: "Yönetim Faaliyet Raporu", roles: ["yonetici"] },
  { tab: "platform", label: "Platform Yönetimi", roles: ["yonetici"] },
];

// Sorunun kendi anlami olmayan (soru kalibi kuran) kelimelerini eler - aksi
// halde "nerede", "nasıl" gibi kelimeler etiket eslesmesini gurultuye bogar.
const STOPWORDS = new Set(
  ["nerede", "nasıl", "ne", "kadar", "için", "ile", "ve", "bir", "bu", "şu", "acaba", "lütfen",
   "mi", "mı", "mu", "mü", "gibi", "çok", "var", "yok", "olur", "istiyorum", "istiyorsunuz",
   "yapıyorum", "yaparım", "görürüm", "görebilirim", "alırım", "bulurum", "bulabilirim", "edebilirim",
   "yapabilirim", "görmek", "bulmak", "yapmak",
   // sohbet/selamlasma kaliplari - herhangi bir ekranin metnine (orn.
   // "Merhaba, {isim}" karsilama yazisi) yanlislikla eslesmesin diye.
   "merhaba", "selam", "selamlar", "günaydın", "iyi", "günler", "akşamlar", "nasılsın",
   "nasılsınız", "teşekkürler", "teşekkür", "sağol", "hoşça", "kal"].map(normalize)
);

function findNavLabelMatch(question, role) {
  const qWords = normalize(question).split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (!qWords.length) return null;
  let best = null;
  let bestScore = 0;
  for (const entry of NAV_LABELS) {
    if (!entry.roles.includes(role)) continue;
    const labelWords = normalize(entry.label).split(" ").filter((w) => w.length >= 3 && !STOPWORDS.has(w));
    const matchedCount = labelWords.filter((lw) => qWords.some((qw) => wordsMatch(qw, lw))).length;
    if (matchedCount === 0) continue;
    if (matchedCount > bestScore) { bestScore = matchedCount; best = entry; }
  }
  return best;
}

// 3. kademe: NAV_LABELS'ta (elle tutulan, sadece sayfa ADI) da eslesme
// yoksa, HELP_INDEX'teki (otomatik uretilen, her ekranin KENDINE OZGU is
// kelime dagarcigi - orn. "Giderler" ekraninin dagarcigina "fatura" da
// giriyor, cunku o ekranda gecen ama baska ekranlarda az gecen bir kelime)
// icerige gore eslestirme dener. Boylece "faturaları nereye giricem" gibi
// sayfa adinda GECMEYEN ama o sayfanin ICERIGINDE gecen bir kavramla
// sorulan sorular da dogru ekrana yonlenir.
function findContentMatch(question, role) {
  const qWords = normalize(question).split(" ").filter((w) => w.length >= 4 && !STOPWORDS.has(w));
  if (!qWords.length) return null;
  let best = null;
  let bestScore = 0;
  for (const [tab, entry] of Object.entries(HELP_INDEX)) {
    if (!entry.roles.includes(role)) continue;
    const matchedCount = entry.terms.filter((term) => qWords.some((qw) => wordsMatch(qw, normalize(term)))).length;
    if (matchedCount === 0) continue;
    if (matchedCount > bestScore) { bestScore = matchedCount; best = { tab, label: entry.label }; }
  }
  return best;
}

const FALLBACK_SUGGESTIONS = {
  sakin: ["Nasıl ödeme yaparım?", "Nasıl talep oluştururum?", "Nasıl makbuz alırım?"],
  yonetici: ["Nasıl yeni daire eklerim?", "Nasıl ödeme girişi yaparım?", "Nasıl hesap dökümü alırım?"],
  personel: ["Nasıl talep oluştururum?", "Şifremi nasıl değiştiririm?"],
};

// Turkce'ye ozgu harfleri ASCII karsiliklarina katlar - klavye/otomatik
// duzeltme yuzunden cok yaygin olan "borç"/"borc", "değiştir"/"degistir"
// gibi yazim farklarini, KB anahtar kelimeleri AYNEN korunurken (sadece
// eslesme icin) tek bir noktada cozer.
function fold(text) {
  return text.replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u");
}

function normalize(text) {
  return fold(String(text || "").toLocaleLowerCase("tr")).replace(/[.,!?;:]/g, " ").replace(/\s+/g, " ").trim();
}

// Sinirlandirilmis Levenshtein (duzenleme) mesafesi - kisa kelimeler
// (site sozlugu kucuk) uzerinde calistigi icin performans sorunu yok.
// Yazim hatalarina (orn. "odeme" -> "ödeme" harf kaymasi degil ama "ödmee"
// gibi harf sirasi hatalari) tolerans saglar.
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[n];
}

// Iki kelimenin "ayni koken"den geldigini kabul eder - Turkce'nin eklemeli
// yapisi yuzunden (orn. "ödemeyi", "ödemesini", "ödeyeceğim" hepsi "öde"
// kokunden) tam bir stemmer yazmak yerine, pratik iki kisayol kullanilir:
// biri digerinin onekiyse (ortak kok >=4 harf), ya da kisa bir duzenleme
// mesafesindeyse (yazim hatasi). Bu, gercek bir NLP degil ama LLM'siz,
// kapali bir soru kumesi icin yeterince guvenilir.
// Bu kelimeler ("kaç", "çok" gibi) çok sık kullanılan, KISA ve kapalı-sinif
// kelimeler - 3 harfli onek kuralina birebir izin verilirse "kaç" ~ "kaçak"
// (su kacagi) gibi YANLIS pozitif eslesmelere yol acar. Bunlar sadece
// BIREBIR ayniysa eslesir, onek/duzenleme-mesafesi kurallari calismaz.
const EXACT_ONLY_WORDS = new Set(["kac", "cok", "kim", "var", "yok", "bir", "iki", "uc", "tum", "hic", "her", "biri"]);

function wordsMatch(a, b) {
  if (a === b) return true;
  if (EXACT_ONLY_WORDS.has(a) || EXACT_ONLY_WORDS.has(b)) return false;
  if (a.length >= 3 && b.length >= 3) {
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (longer.startsWith(shorter)) return true;
  }
  if (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1) return true;
  return false;
}

// Eslesme skorlamasi: alt-dize arama yerine kelime-kumesi ortusmesi - soru
// icindeki kelimeler farkli sirada olsa, ek almis olsa ya da kucuk bir yazim
// hatasi icerse bile eslesir. Bir anahtar-kelime ifadesinin TUM kelimeleri
// (fuzzy olarak) soruda gecmeli - aksi halde "ekle" gibi tek kelimeler cok
// fazla girdiyle zayifca eslesip yanlis yonlendirir. KB ve LIVE_QUERIES
// ayni {roles, keywords} seklini paylastigi icin tek bir fonksiyon ikisine
// de hizmet eder.
function bestKeywordMatch(entries, question, role) {
  const qWords = normalize(question).split(" ").filter(Boolean);
  let best = null;
  let bestScore = 0;
  for (const entry of entries) {
    if (!entry.roles.includes(role)) continue;
    let score = 0;
    for (const kw of entry.keywords) {
      const kwWords = normalize(kw).split(" ").filter(Boolean);
      const allMatched = kwWords.every((kwWord) => qWords.some((qWord) => wordsMatch(qWord, kwWord)));
      if (allMatched) score += kwWords.length; // uzun/spesifik eslesmeler daha agir basar
    }
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return bestScore > 0 ? best : null;
}

function findBestMatch(question, role) {
  return bestKeywordMatch(KB, question, role);
}

function findLiveQueryMatch(question, role) {
  return bestKeywordMatch(LIVE_QUERIES, question, role);
}

router.get("/help/suggestions", requireAuth, (req, res) => {
  res.json({ suggestions: FALLBACK_SUGGESTIONS[req.user.role] || FALLBACK_SUGGESTIONS.sakin });
});

router.post("/help/ask", requireAuth, async (req, res) => {
  const { question } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: "Bir soru yazmalısınız." });

  // 0. kademe: "toplam alacak ne kadar" gibi rakam isteyen sorular - KB'den
  // ONCE denenir, cunku KB'deki bazi genel-kapsamli girdiler ("borç hareketi
  // gör" gibi) bunlarla kelime ortusebilir ama tier 0 daha spesifik/dogru.
  const liveMatch = findLiveQueryMatch(question, req.user.role);
  if (liveMatch) {
    const result = await liveMatch.compute(req);
    return res.json({ answer: result.answer, tab: result.tab || null, suggestions: [] });
  }

  const match = findBestMatch(question, req.user.role);
  if (match) return res.json({ answer: match.answer, tab: match.tab || null, suggestions: [] });

  // KB'de detayli bir cevap yok ama soru bir sayfa adiyla ortusuyor olabilir
  // ("talepleri nerede görürüm" gibi - KB sadece "nasıl talep açarım"ı
  // biliyor). Boyle durumda adim adim degil ama en azindan DOGRU sayfaya
  // yonlendiren genel bir cevap ver - bos donmekten iyi.
  const navMatch = findNavLabelMatch(question, req.user.role) || findContentMatch(question, req.user.role);
  if (navMatch) {
    return res.json({
      answer: `Bunun için **${navMatch.label}** sayfasına bakabilirsiniz.`,
      tab: navMatch.tab,
      suggestions: [],
    });
  }

  // Hicbiri eslesmedi - sessizce logla. LLM baglamadan KB'yi zamanla
  // genisletmenin tek yolu: yonetici periyodik olarak GET /help/misses'e
  // bakip gercekten sorulan ama eslesmeyen sorulari gorup KB'ye yeni
  // anahtar kelime ekleyebilir. Hata olursa (DB gecici erisilemez vb.)
  // kullaniciyi asla bekletmez/engellemez - fire-and-forget.
  prisma.helpMiss
    .create({ data: { role: req.user.role, question: question.trim().slice(0, 500) } })
    .catch(() => {});
  res.json({
    answer: "Bu konuda tam olarak size yardımcı olamadım. Aşağıdaki örnek sorulardan birini deneyebilir ya da yönetiminizle iletişime geçebilirsiniz.",
    tab: null,
    suggestions: FALLBACK_SUGGESTIONS[req.user.role] || FALLBACK_SUGGESTIONS.sakin,
  });
});

// Yonetici, cevapsiz kalan sorulari inceleyip KB'yi elle genisletebilsin
// diye (bkz. yukaridaki create cagrisi).
router.get("/help/misses", requireAuth, requireRole("yonetici"), async (req, res) => {
  const misses = await prisma.helpMiss.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  res.json(misses);
});

router.delete("/help/misses/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.helpMiss.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Kayıt silindi." });
});

router.delete("/help/misses", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.helpMiss.deleteMany({});
  res.json({ message: "Tüm kayıtlar silindi." });
});

module.exports = router;
