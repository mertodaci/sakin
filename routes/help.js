// "Kapıcı AI" - uygulama ici kullanim yardimcisi. Kullanicilarin "nasil X
// yaparim" tarzi sorularina, ekranlar arasinda yon gosteren adim adim
// yanit veren KURAL/ANAHTAR-KELIME tabanli yerel bir SSS eslestirici -
// dis bir LLM servisine (API anahtari, maliyet, internet bagimliligi)
// ihtiyac duymadan calisir. Sorular kapali/tanimli bir kume oldugu icin
// (uygulamanin kendi ekranlari) bu, tam bir LLM'den daha guvenilir ve
// ucretsiz - her zaman GERCEK, var olan bir ekrana yonlendirir.
const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// Her girdi: hangi rol(ler) icin gecerli, esleme icin anahtar kelimeler
// (kullanicinin yazabilecegi farkli ifadeler), kisa adim-adim cevap, ve
// (varsa) "ilgili sekmeye git" butonu icin tab id'si.
const KB = [
  // ---------------- SAKIN ----------------
  {
    id: "odeme-yap",
    roles: ["sakin"],
    keywords: ["ödeme yap", "nasıl öder", "aidat öde", "kredi kartı ile öde", "borcumu öde", "ödeme nasıl"],
    answer: "**Borç ve Ödemelerim** sayfasına gidin. Üstte ödenecek tutarı görürsünüz; birden fazla daireniz varsa önce hangi daire için ödeme yapacağınızı seçin. Ardından **\"Ödeme Yap\"** butonuna basmanız yeterli.",
    tab: "aidat",
  },
  {
    id: "borc-hareketi-sakin",
    roles: ["sakin"],
    keywords: ["borç hareket", "borcumu gör", "ne kadar borcum var", "hesap özeti", "borç dökümü", "aidat borcu"],
    answer: "**Borç ve Ödemelerim** sayfasında \"Borç Kalemleri\" bölümünde tüm borçlarınızı, altında da geçmiş ödemelerinizi görebilirsiniz.",
    tab: "aidat",
  },
  {
    id: "makbuz",
    roles: ["sakin"],
    keywords: ["makbuz", "ödeme belgesi", "dekont"],
    answer: "**Borç ve Ödemelerim** sayfasındaki \"Ödeme Geçmişi\" bölümünde her ödemenin yanında **📄 Makbuz** butonu var, tıklayınca PDF olarak iner.",
    tab: "aidat",
  },
  {
    id: "borcu-yoktur",
    roles: ["sakin"],
    keywords: ["borcu yoktur belgesi", "borcu yoktur yazısı", "banka için belge"],
    answer: "Borcunuz yoksa (bakiyeniz sıfır veya alacaklıysanız) **Borç ve Ödemelerim** sayfasında **\"📄 Borcu Yoktur Belgesi\"** butonu görünür, tıklayınca anında PDF üretilir.",
    tab: "aidat",
  },
  {
    id: "talep-bildir",
    roles: ["sakin"],
    keywords: ["arıza bildir", "talep oluştur", "şikayet", "tamir iste", "yeni talep"],
    answer: "**Arıza/Talep** sayfasında **\"+ Yeni Talep\"** butonuna basıp kategori, başlık ve açıklama girerek talebinizi iletebilirsiniz. Yönetim, talebinizin durumunu güncelledikçe bildirim alırsınız.",
    tab: "talep",
  },
  {
    id: "rezervasyon-sakin",
    roles: ["sakin"],
    keywords: ["rezervasyon yap", "ortak alan ayır", "salon rezervasyon", "havuz rezervasyon"],
    answer: "**Rezervasyon** sayfasından tesis, tarih ve saat aralığı seçip \"Rezerve Et\" ile ortak alan rezervasyonu yapabilirsiniz.",
    tab: "rezervasyon",
  },
  {
    id: "sayac-sakin",
    roles: ["sakin"],
    keywords: ["sayaç okuma", "su faturam", "doğalgaz faturam", "sayaç geçmişi"],
    answer: "**Sayaçlarım** sayfasında kayıtlı sayaçlarınızı ve geçmiş okuma/fatura tutarlarını görebilirsiniz.",
    tab: "sayac",
  },
  {
    id: "kargo-sakin",
    roles: ["sakin"],
    keywords: ["kargom", "paketim geldi mi", "kargo takibi"],
    answer: "**Kargolarım** sayfasında size teslim alınan kargoları görebilirsiniz.",
    tab: "kargo",
  },
  {
    id: "coklu-daire",
    roles: ["sakin"],
    keywords: ["iki dairem var", "birden fazla dairem", "diğer dairemi gör", "daireler arası geç"],
    answer: "Aynı sitede birden fazla daireniz varsa **Borç ve Ödemelerim** sayfasının üstünde bir \"Daire\" seçici görünür: \"Tümü\" ile tüm dairelerinizin birleşik borcunu, ya da tek bir daireyi seçip sadece onu görebilirsiniz.",
    tab: "aidat",
  },

  // ---------------- YONETICI ----------------
  {
    id: "yeni-daire-ekle",
    roles: ["yonetici"],
    keywords: ["yeni daire ekle", "daire tanımla", "bağımsız bölüm ekle", "daire oluştur"],
    answer: "**Daireler** sayfasında \"Yeni Daire Ekle\" formundan blok, daire no ve diğer bilgileri girip ekleyebilirsiniz.",
    tab: "daireler",
  },
  {
    id: "odeme-girisi-yonetici",
    roles: ["yonetici"],
    keywords: ["ödeme girişi yap", "tahsilat gir", "elden ödeme al", "nakit tahsilat", "ödeme kaydet"],
    answer: "**Borç & Tahsilat** sayfasında ilgili daireyi bulup \"Ödeme Al\" ile tutar ve yöntem girerek tahsilatı kaydedebilirsiniz. Ödeme otomatik olarak en eski açık borçtan başlayarak dağıtılır.",
    tab: "tahsilat",
  },
  {
    id: "fatura-girisi",
    roles: ["yonetici"],
    keywords: ["fatura girişi", "gider girişi", "fatura ekle", "gider kaydet", "harcama gir"],
    answer: "**Muhasebe** veya **Giderler** sayfasından \"Gider\" türünde yeni bir hareket girerek kategori, tutar ve açıklama ile faturayı kaydedebilirsiniz. Firma bazlı fatura/borçlandırma için **Firma & Personel** sayfasını kullanın.",
    tab: "muhasebe",
  },
  {
    id: "borc-hareketi-yonetici",
    roles: ["yonetici"],
    keywords: ["borç hareketi gör", "borç listesi", "kimin borcu var", "açık borçlar"],
    answer: "**Borç Listesi** sayfasında tüm dairelerin açık borçlarını, **Borç & Tahsilat** sayfasında ise daire bazlı borç/ödeme hareketlerini görebilirsiniz.",
    tab: "borclistesi",
  },
  {
    id: "hesap-dokumu-yonetici",
    roles: ["yonetici"],
    keywords: ["hesap dökümü", "hesap hareketi", "ekstre al", "daire ekstresi", "hesap özeti çıkar"],
    answer: "**Daireler** sayfasında ilgili dairenin kartındaki **📄 (Hesap Özeti)** butonuyla o dairenin tüm borç/ödeme dökümünü, **📋 (Borç Dökümü)** butonuyla sadece açık borçlarını PDF olarak alabilirsiniz. Kasa/banka hesap ekstresi için **Kasalar** sayfasına bakın.",
    tab: "daireler",
  },
  {
    id: "kullanici-onayla",
    roles: ["yonetici"],
    keywords: ["yeni sakin onayla", "kayıt onayı", "üyelik onayla", "kullanıcı onayla"],
    answer: "**Kullanıcılar** sayfasında \"Onay Bekleyenler\" bölümünden yeni kayıt olan sakinleri onaylayabilir veya reddedebilirsiniz.",
    tab: "kullanicilar",
  },
  {
    id: "personel-ekle",
    roles: ["yonetici"],
    keywords: ["personel ekle", "yeni personel", "kapıcı ekle", "güvenlik ekle"],
    answer: "**Kullanıcılar** sayfasının altındaki \"Yeni Personel Ekle\" formundan doğrudan personel hesabı oluşturabilirsiniz (onay beklemez).",
    tab: "kullanicilar",
  },
  {
    id: "sakine-ikinci-daire",
    roles: ["yonetici"],
    keywords: ["sakine ikinci daire", "bir kullanıcıya başka daire", "aynı kişinin iki evi", "ek daire bağla"],
    answer: "**Kullanıcılar** sayfasında ilgili sakinin \"Düzenle\" butonuna basın, açılan pencerenin altında \"Daireleri\" bölümünden ek bir daire seçip \"Ekle\" diyebilirsiniz.",
    tab: "kullanicilar",
  },
  {
    id: "duyuru-yayinla",
    roles: ["yonetici"],
    keywords: ["duyuru yayınla", "duyuru ekle", "ilan ver"],
    answer: "**Duyurular** sayfasında \"+ Yeni Duyuru\" ile başlık ve içerik girerek anında yayınlayabilirsiniz.",
    tab: "duyuru",
  },
  {
    id: "anket-olustur",
    roles: ["yonetici"],
    keywords: ["anket oluştur", "oylama başlat", "anket aç"],
    answer: "**Anketler** sayfasında \"+ Yeni Anket\" ile soru ve seçenekleri girip anketi başlatabilirsiniz.",
    tab: "anket",
  },
  {
    id: "gecikme-faizi-ayarla",
    roles: ["yonetici"],
    keywords: ["gecikme faizi ayarla", "otomatik borçlandırma ayarla", "aylık aidat tutarı değiştir"],
    answer: "**Ayarlar** sayfasından gecikme faizi oranı/tolerans süresini ve otomatik aylık aidat borçlandırmasını (gün, tutar, açık/kapalı) düzenleyebilirsiniz.",
    tab: "ayarlar",
  },
  {
    id: "varsayilan-hesap",
    roles: ["yonetici"],
    keywords: ["varsayılan hesap", "tahsilat hangi hesaba", "kasa seç"],
    answer: "**Ayarlar** sayfasının altındaki \"Varsayılan Tahsilat Hesabı\" bölümünden, hesap seçilmeden yapılan ödemelerin hangi kasaya/banka hesabına yazılacağını belirleyebilirsiniz. Önce **Kasalar** sayfasından en az bir hesap oluşturmanız gerekir.",
    tab: "ayarlar",
  },
  {
    id: "kasa-ekle",
    roles: ["yonetici"],
    keywords: ["kasa ekle", "banka hesabı ekle", "yeni hesap oluştur"],
    answer: "**Kasalar** sayfasından yeni bir banka/nakit/pos hesabı ekleyip açılış bakiyesini girebilirsiniz.",
    tab: "kasalar",
  },
  {
    id: "yeni-site-olustur",
    roles: ["yonetici"],
    keywords: ["yeni site oluştur", "başka bir site ekle", "ikinci site", "site kur"],
    answer: "Platform sahibiyseniz **Platform Yönetimi** sayfasından \"Yeni Site Oluştur\" formuyla bir site + ilk yöneticisini tek seferde oluşturabilirsiniz. Bu menü sadece platform sahibi hesaplarda görünür.",
    tab: "platform",
  },
  {
    id: "coklu-site-erisimi",
    roles: ["yonetici"],
    keywords: ["birden fazla siteye erişim", "bölge yöneticisi yap", "başka siteye de erişsin"],
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
    // tek kelime kullanmak daha guvenilir.
    keywords: ["havuz", "klor", "otopark", "bariyer", "kamera izle", "sulama", "kaçak", "iot", "akıllı site", "aydınlatma", "jeneratör", "asansör"],
    answer: "**Akıllı Site Sistemleri** sayfasında havuz, aydınlatma, kamera, otopark bariyeri, sulama hattı, jeneratör ve asansör cihazlarınızı görüp yönetebilirsiniz. Aydınlatma/bariyer için \"Aç\"/\"Kapat\", sensörler için \"🔄 Yenile\" butonlarını kullanın.",
    tab: "akillisite",
  },

  // ---------------- GENEL (tum roller) ----------------
  {
    id: "sifre-degistir",
    roles: ["sakin", "yonetici", "personel"],
    keywords: ["şifremi değiştir", "şifremi unuttum", "şifre sıfırla"],
    answer: "Giriş yapmışsanız sağ üstteki kullanıcı menüsünden \"Şifre Değiştir\"i kullanın. Şifrenizi unuttuysanız giriş ekranındaki \"Sıfırlama talep edin\" ile yöneticinize geçici bir şifre oluşturması için talep gönderebilirsiniz.",
  },
  {
    id: "koyu-mod",
    roles: ["sakin", "yonetici", "personel"],
    keywords: ["koyu mod", "karanlık tema", "gece modu"],
    answer: "Sağ üstteki güneş/ay ikonuna tıklayarak koyu/açık mod arasında geçiş yapabilirsiniz.",
  },
  {
    id: "site-degistir",
    roles: ["sakin", "yonetici", "personel"],
    keywords: ["site değiştir", "başka siteye geç", "farklı site seç"],
    answer: "Birden fazla siteye erişiminiz varsa sağ üstteki kullanıcı menüsünde \"Site Değiştir\" seçeneği görünür.",
  },
];

const FALLBACK_SUGGESTIONS = {
  sakin: ["Nasıl ödeme yaparım?", "Nasıl talep oluştururum?", "Nasıl makbuz alırım?"],
  yonetici: ["Nasıl yeni daire eklerim?", "Nasıl ödeme girişi yaparım?", "Nasıl hesap dökümü alırım?"],
  personel: ["Nasıl talep oluştururum?", "Şifremi nasıl değiştiririm?"],
};

function normalize(text) {
  return String(text || "").toLocaleLowerCase("tr").replace(/[.,!?;:]/g, " ").replace(/\s+/g, " ").trim();
}

// Basit anahtar-kelime orten skorlama: entry.keywords'ten kacinin soruda
// (alt-dize olarak) gectigini sayar. Tam bir NLP degil ama kapali/tanimli
// bir soru kumesi (uygulamanin kendi ekranlari) icin yeterince guvenilir -
// ve her zaman GERCEK var olan bir ekrana yonlendirir, halusinasyon riski yok.
function findBestMatch(question, role) {
  const q = normalize(question);
  let best = null;
  let bestScore = 0;
  for (const entry of KB) {
    if (!entry.roles.includes(role)) continue;
    let score = 0;
    for (const kw of entry.keywords) {
      if (q.includes(normalize(kw))) score += normalize(kw).split(" ").length; // uzun/spesifik eslesmeler daha agir basar
    }
    if (score > bestScore) { bestScore = score; best = entry; }
  }
  return bestScore > 0 ? best : null;
}

router.get("/help/suggestions", requireAuth, (req, res) => {
  res.json({ suggestions: FALLBACK_SUGGESTIONS[req.user.role] || FALLBACK_SUGGESTIONS.sakin });
});

router.post("/help/ask", requireAuth, (req, res) => {
  const { question } = req.body || {};
  if (!question || !question.trim()) return res.status(400).json({ error: "Bir soru yazmalısınız." });
  const match = findBestMatch(question, req.user.role);
  if (!match) {
    return res.json({
      answer: "Bu konuda tam olarak size yardımcı olamadım. Aşağıdaki örnek sorulardan birini deneyebilir ya da yönetiminizle iletişime geçebilirsiniz.",
      tab: null,
      suggestions: FALLBACK_SUGGESTIONS[req.user.role] || FALLBACK_SUGGESTIONS.sakin,
    });
  }
  res.json({ answer: match.answer, tab: match.tab || null, suggestions: [] });
});

module.exports = router;
