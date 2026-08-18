// Kapici AI'nin 3. eslesme katmani icin ICERIK INDEKSI uretir: public/js/
// app.js'teki her ekranin (render fonksiyonunun) GERCEK Turkce metnini
// tarar, hangi kelimenin kac FARKLI ekranda gectigini sayar, ve her ekrana
// SADECE ona ozgu (az sayida baska ekranda da gecen) kelimeleri atar. "Ekle",
// "Sil", "Kaydet" gibi her ekranda olan kelimeler boylece otomatik elenir -
// elle bir "genel kelimeler" listesi tutmaya gerek yok, cunku sikligi zaten
// kendini ele veriyor. Ciktisi routes/helpIndex.json - help.js bunu okur.
//
// Calistirma: node scripts/build-help-index.js
// app.js her degistiginde (yeni ekran/metin eklendiginde) yeniden calistirilmali
// - otomatik tetiklenmiyor, elle calistirilan bir "derleme" adimi.
const fs = require("fs");
const path = require("path");

const APP_JS_PATH = path.join(__dirname, "../public/js/app.js");
const OUT_PATH = path.join(__dirname, "../routes/helpIndex.json");
const src = fs.readFileSync(APP_JS_PATH, "utf8");

// ---------- 1) NAV_GROUPS'u guvenli sekilde disariya cikarip degerlendir ----------
// Kaynakta sadece dizi/string literal'lerden olusan bir object literal -
// bu yuzden izole edilip eval edilmesi guvenli (disaridan hicbir kimlige
// referans vermiyor).
function extractBalanced(text, startIdx, openCh, closeCh) {
  let depth = 0;
  for (let i = startIdx; i < text.length; i++) {
    if (text[i] === openCh) depth++;
    else if (text[i] === closeCh) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  throw new Error("Balanced blok bulunamadi (" + openCh + closeCh + ") @" + startIdx);
}

const navGroupsMarker = "const NAV_GROUPS = ";
const navGroupsStart = src.indexOf(navGroupsMarker);
if (navGroupsStart === -1) throw new Error("NAV_GROUPS bulunamadi");
const navGroupsObjStart = src.indexOf("{", navGroupsStart);
const navGroupsSrc = extractBalanced(src, navGroupsObjStart, "{", "}");
// eslint-disable-next-line no-eval
const NAV_GROUPS = eval("(" + navGroupsSrc + ")");

// tabId -> { roles:Set, label }
const tabMeta = {};
function walkItems(items, role) {
  for (const [tabId, label] of items) {
    if (!tabMeta[tabId]) tabMeta[tabId] = { roles: new Set(), label };
    tabMeta[tabId].roles.add(role);
  }
}
for (const role of Object.keys(NAV_GROUPS)) {
  for (const group of NAV_GROUPS[role]) {
    if (group.items) walkItems(group.items, role);
    if (group.sections) for (const section of group.sections) walkItems(section.items, role);
  }
}

// ---------- 2) renderTab icindeki "tab === X" -> renderY eslemesini cikar ----------
const renderTabMarker = "async function renderTab(tab) {";
const renderTabStart = src.indexOf(renderTabMarker);
const renderTabBraceStart = src.indexOf("{", renderTabStart);
const renderTabBody = extractBalanced(src, renderTabBraceStart, "{", "}");

const tabToFns = {}; // tabId -> [renderFunctionName, ...] (role'e gore dallanan tab'lar icin birden fazla)
// Basit regex, "tab === X" hemen ardindan role'e gore dallanan (if/else)
// gibi ic ice kosullar OLMAYAN duz "await renderY(c)" satirlarini yakalar.
const branchRe = /tab === "([a-zA-Z0-9çğıöşüÇĞİÖŞÜ]+)"\)[\s\S]{0,20}?await (render[A-Za-z]+)\(/g;
let m;
while ((m = branchRe.exec(renderTabBody))) {
  (tabToFns[m[1]] = tabToFns[m[1]] || []).push(m[2]);
}
// Role'e gore dallanan ozel durumlar (yukaridaki basit regex'in yakalayamadigi,
// bir "if (role === ...)" katmani daha iceren tab'lar) - elle eslenir.
tabToFns.ozet = ["renderResidentOzet", "renderPersonelOzet", "renderManagerOzet"];
tabToFns.sayac = ["renderResidentSayac", "renderSayacYonetici"];

// ---------- 3) Her render fonksiyonunun GOVDESINI ve icindeki statik metni cikar ----------
// Basit ama tirnak/template-literal farkindali bir tarayici: kod icindeki
// stringler/template literal'lar ('/"/`  ve ${...} ic ice) brace derinligini
// bozmasin diye ayri modlarla takip edilir.
function findFunctionBody(name) {
  const re = new RegExp("(?:async )?function " + name + "\\(");
  const idx = src.search(re);
  if (idx === -1) return null;
  const braceStart = src.indexOf("{", src.indexOf("(", idx));
  return extractBalancedCode(src, braceStart);
}

// Kod-farkindali brace eslestirme: string/template literal icindeki
// {, }, ', " karakterlerini yok sayar; template literal icindeki ${...}
// GERCEK kod oldugu icin (ic ice olabilir) ayri bir yigin (stack) katmani
// olarak islenir.
function extractBalancedCode(text, startIdx) {
  const stack = ["code"]; // en alttaki katman: fonksiyon govdesinin kendisi
  const depths = [1]; // ilk '{' zaten sayildi
  let i = startIdx + 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    const top = stack[stack.length - 1];
    if (top === "code") {
      if (ch === "\\") { i++; continue; }
      if (ch === "'") { stack.push("squote"); continue; }
      if (ch === '"') { stack.push("dquote"); continue; }
      if (ch === "`") { stack.push("template"); continue; }
      if (ch === "/" && text[i + 1] === "/") { stack.push("linecomment"); continue; }
      if (ch === "/" && text[i + 1] === "*") { stack.push("blockcomment"); i++; continue; }
      if (ch === "{") { depths[depths.length - 1]++; continue; }
      if (ch === "}") {
        depths[depths.length - 1]--;
        if (depths[depths.length - 1] === 0) {
          if (stack.length === 1) return text.slice(startIdx, i + 1); // fonksiyon govdesi bitti
          stack.pop(); depths.pop(); // ${...} ifadesi bitti, template'e don
        }
        continue;
      }
    } else if (top === "squote") {
      if (ch === "\\") { i++; continue; }
      if (ch === "'") stack.pop();
    } else if (top === "dquote") {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') stack.pop();
    } else if (top === "template") {
      if (ch === "\\") { i++; continue; }
      if (ch === "`") { stack.pop(); continue; }
      if (ch === "$" && text[i + 1] === "{") { stack.push("code"); depths.push(1); i++; continue; }
    } else if (top === "linecomment") {
      if (ch === "\n") stack.pop();
    } else if (top === "blockcomment") {
      if (ch === "*" && text[i + 1] === "/") { stack.pop(); i++; }
    }
  }
  throw new Error("Fonksiyon govdesi kapanmadi @" + startIdx);
}

// Bir fonksiyon govdesinden GORUNEN (kullaniciya render edilen) metni
// cikarir. ONEMLI: bu kod tabanında Turkce metnin buyuk kismi DUZ template
// literal metni degil, ${uiT("key", "Turkce Metin")} gibi ${...} ICINDEKI
// fonksiyon cagrilarina STRING ARGUMAN olarak geciyor (i18n sistemi
// yuzunden) - bu yuzden sadece template'in duz kisimlarini degil, TUM
// string/template literal icerigini (kod icinde gecenler dahil) toplar;
// degisken adlari/operatorler gibi salt kod kisimlari atlanir. CSS
// class'lari/attribute degerleri gibi "gurultu" da bir miktar sizar ama
// belge-sikligi filtresi (bkz. asagida) bunlarin cogunu zaten eler -
// cunku ortak class adlari HER ekranda tekrarlanip elenmeye musait hale gelir.
function extractDisplayText(body) {
  let out = "";
  let stringBuf = ""; // squote/dquote icin biriktirici - kapaninca karara baglanir
  // Her "code" katmani kendi brace-derinligini tasir - bir template
  // literal'in ${...} ifadesi bittiginde (derinlik 0'a donunce) dogru
  // sekilde template moduna geri donebilmek icin (extractBalancedCode ile
  // ayni mantik, buna ek olarak string/template icerigini de topluyor).
  const stack = ["code"];
  const depths = [0];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    const top = stack[stack.length - 1];
    if (top === "code") {
      if (ch === "\\") { i++; continue; }
      if (ch === "'") { stack.push("squote"); stringBuf = ""; continue; }
      if (ch === '"') { stack.push("dquote"); stringBuf = ""; continue; }
      if (ch === "`") { stack.push("template"); continue; }
      if (ch === "/" && body[i + 1] === "/") { stack.push("linecomment"); continue; }
      if (ch === "/" && body[i + 1] === "*") { stack.push("blockcomment"); i++; continue; }
      if (ch === "{") { depths[depths.length - 1]++; continue; }
      if (ch === "}") {
        if (depths[depths.length - 1] === 0) {
          // Bu "}" template'in ${...} ifadesini kapatiyor (derinlik hic
          // artmadiysa) - template moduna geri don.
          if (stack.length > 1) { stack.pop(); depths.pop(); }
          continue;
        }
        depths[depths.length - 1]--;
        continue;
      }
    } else if (top === "squote" || top === "dquote") {
      const quoteCh = top === "squote" ? "'" : '"';
      if (ch === "\\") { i++; continue; }
      if (ch === quoteCh) {
        stack.pop();
        // Kod icindeki tirnakli string'ler ya GERCEK bir cumle/ifade
        // (bosluk iceriyor - orn. uiT("k","Yeni Talep")) ya da bir
        // element id'si/event adi/i18n anahtari/CSS class'i gibi bir
        // KIMLIK (bosluksuz, tek "kelime" - orn. "newTicketBtn", "click",
        // "talep.title"). Sadece ilkini metin sayiyoruz - digeri gurultu.
        if (/\s/.test(stringBuf)) out += " " + stringBuf + " ";
        continue;
      }
      stringBuf += ch;
    } else if (top === "template") {
      if (ch === "\\") { i++; continue; }
      if (ch === "`") { stack.pop(); continue; }
      if (ch === "$" && body[i + 1] === "{") { stack.push("code"); depths.push(0); out += " "; i++; continue; }
      out += ch;
    } else if (top === "linecomment") {
      if (ch === "\n") stack.pop();
    } else if (top === "blockcomment") {
      if (ch === "*" && body[i + 1] === "/") { stack.pop(); i++; }
    }
  }
  return out.replace(/<[^>]*>/g, " ").replace(/&[a-z]+;/g, " ");
}

const STOP_WORDS = new Set([
  "ile", "için", "gibi", "olan", "olarak", "daha", "kadar", "hala", "hâlâ", "yeni", "genel",
  "tarih", "tarihi", "tutar", "tutarı", "durum", "durumu", "adet", "toplam", "seçim", "işlem", "kayıt", "sayfa",
  "bilgi", "seçiniz", "girin", "yazın", "açıklama", "not", "detay", "liste", "listesi",
  "başarılı", "başarıyla", "hata", "oluştu", "lütfen", "zorunlu", "geçerli", "değil",
  "merhaba", "selam", "selamlar", "günler",
]);

const tokenize = (text) =>
  (text.toLocaleLowerCase("tr").match(/[a-zçğıöşü]{4,}/g) || []).filter((w) => !STOP_WORDS.has(w));

const perTabWords = {}; // tabId -> Set(word)
const fnCache = {};
for (const [tabId, fnNames] of Object.entries(tabToFns)) {
  const words = new Set();
  for (const fnName of fnNames) {
    if (!fnCache[fnName]) {
      const body = findFunctionBody(fnName);
      fnCache[fnName] = body ? tokenize(extractDisplayText(body)) : [];
    }
    for (const w of fnCache[fnName]) words.add(w);
  }
  perTabWords[tabId] = words;
}

// ---------- 4) Belge-sikligi (kac FARKLI tab'ta gecen kelime) hesapla ----------
const docFreq = {};
for (const words of Object.values(perTabWords)) {
  for (const w of words) docFreq[w] = (docFreq[w] || 0) + 1;
}
const totalTabs = Object.keys(perTabWords).length;
const MAX_DOC_FREQ = 5; // bu sayidan fazla ekranda gecen kelime "genel" sayilir, elenir
const MAX_TERMS_PER_TAB = 20;

const index = {};
for (const [tabId, words] of Object.entries(perTabWords)) {
  const meta = tabMeta[tabId];
  if (!meta) continue; // NAV_GROUPS'ta olmayan (orn. eski/kullanilmayan) bir tab
  const distinctive = [...words]
    .filter((w) => docFreq[w] <= MAX_DOC_FREQ)
    .sort((a, b) => docFreq[a] - docFreq[b])
    .slice(0, MAX_TERMS_PER_TAB);
  index[tabId] = { label: meta.label, roles: [...meta.roles], terms: distinctive };
}

fs.writeFileSync(OUT_PATH, JSON.stringify(index, null, 2), "utf8");
console.log(`${Object.keys(index).length} ekran indekslendi (toplam ${totalTabs} taranan), -> ${path.relative(process.cwd(), OUT_PATH)}`);
