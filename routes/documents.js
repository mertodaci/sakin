const express = require("express");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { ownsUnit } = require("../lib/residentUnits");

const router = express.Router();

// pdf-lib'in standart fontlari WinAnsi kodlamasini kullanir - Turkce (ğ, ı, ş,
// İ) VE Azerice'ye ozgu "ə" desteklenmez, PDF uretimi bu karakterlerde hata
// firlatir. En yakin ASCII karsiligina donusturuyoruz (yalnizca PDF ciktisinda).
function trSafe(text) {
  const map = { ğ: "g", Ğ: "G", ı: "i", İ: "I", ş: "s", Ş: "S", ç: "c", Ç: "C", ö: "o", Ö: "O", ü: "u", Ü: "U", ə: "e", Ə: "E", "₺": "TL" };
  return String(text ?? "").replace(/[ğĞışŞçÇöÖüÜİəƏ₺]/g, (m) => map[m] || m);
}

// DIKKAT: WinAnsi Kiril alfabesini HIC desteklemiyor - pdf-lib bu karakterlerde
// dogrudan hata firlatir (yeni bir font/fontkit bagimliligi eklemeden Rusca'yi
// PDF'de dogru gostermenin bir yolu yok). Bunun yerine standart bir Kiril->Latin
// harf cevirisi uygulaniyor - belge Rusca konusan biri icin hala okunabilir
// kaliyor (uluslararasi belgelerde Rusca isim/adres cevirisinde yaygin bir
// pratik), sadece Kiril harfleriyle degil.
const CYRILLIC_TO_LATIN = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "Zh", З: "Z", И: "I", Й: "Y",
  К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F",
  Х: "H", Ц: "Ts", Ч: "Ch", Ш: "Sh", Щ: "Sch", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "Yu", Я: "Ya",
};
function cyrillicToLatin(text) {
  return String(text ?? "").replace(/[Ѐ-ӿ]/g, (ch) => CYRILLIC_TO_LATIN[ch] ?? ch);
}

// PDF metnini secilen dile gore fonta guvenli hale getirir.
function pdfSafe(text, lang) {
  const s = lang === "ru" ? cyrillicToLatin(String(text ?? "")) : String(text ?? "");
  return trSafe(s);
}

const DOC_LOCALE = { tr: "tr-TR", de: "de-DE", ru: "ru-RU", az: "az-Latn-AZ" };
function fmtDateLoc(d, lang) {
  try {
    return new Date(d).toLocaleDateString(DOC_LOCALE[lang] || "tr-TR", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
  }
}
function fmtDateTr(d) { return fmtDateLoc(d, "tr"); }
function fmtTL(n) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n) + " TL";
}

// Sakin taraf PDF belgelerinde (debt-letter, receipt, borc-dokumu) kullanilan
// sabit etiketler - Kapici AI/arayuz cevirisiyle AYNI kapsam (sadece sakin
// tarafi, bkz. public/js/i18n.js basindaki not). Yonetici-ozel belgeler
// (toplu-makbuz, raporlar vb.) bu kapsamin disinda, Turkce kaliyor.
const DOC_I18N = {
  tr: {
    orgSubtitle: "Site / Apartman Yönetimi", footerAuto: "Bu belge Sakin site yönetim sistemi tarafından otomatik oluşturulmuştur.",
    createdAt: "Oluşturulma", signature: "Yönetici Adı / İmza",
    debtLetterHeading: "BORCU YOKTUR BELGESİ", site: "Site", unit: "Bağımsız Bölüm", owner: "Malik",
    debtLetterBody1: (block, no, date) => `İşbu belge ile ${block} - Daire ${no} nolu bağımsız bölümün, ${date} tarihi itibarıyla`,
    debtLetterBody2: "site yönetimine karşı herhangi bir aidat/ortak gider borcunun bulunmadığı tasdik edilir.",
    debtLetterBody3: "Bu belge banka, tapu veya resmi kurum işlemlerinde kullanılabilir.",
    receiptHeading: "ÖDEME MAKBUZU", receiptNo: "Makbuz No", date: "Tarih", payer: "Ödeyen", method: "Ödeme Yöntemi", amount: "Tutar", note: "Not",
    receiptFooter: "Bu makbuz elektronik ortamda üretilmiştir, ıslak imza gerekmez.",
    borcDokumuHeading: "BORÇ DÖKÜMÜ", remaining: "Kalan", noOpenDebt: "Açık borç kaydı bulunmamaktadır.",
    creditBalance: "Alacaklı Bakiye", totalBalance: "TOPLAM NET BAKİYE",
    borcDokumuFooter: "Bu döküm yalnızca açık borçları listeler, geçmiş ödemeler için Hesap Özeti'ne bakınız.",
  },
  de: {
    orgSubtitle: "Wohnanlagenverwaltung", footerAuto: "Dieses Dokument wurde automatisch vom Sakin-Verwaltungssystem erstellt.",
    createdAt: "Erstellt am", signature: "Name des Verwalters / Unterschrift",
    debtLetterHeading: "SCHULDENFREIHEITSBESCHEINIGUNG", site: "Anlage", unit: "Wohneinheit", owner: "Eigentümer",
    debtLetterBody1: (block, no, date) => `Hiermit wird bestätigt, dass für die Wohneinheit ${block} - Nr. ${no} zum ${date}`,
    debtLetterBody2: "keine offenen Hausgeld-/Nebenkostenschulden gegenüber der Verwaltung bestehen.",
    debtLetterBody3: "Dieses Dokument kann bei Banken, Grundbuchämtern oder Behörden verwendet werden.",
    receiptHeading: "ZAHLUNGSBELEG", receiptNo: "Belegnummer", date: "Datum", payer: "Zahler", method: "Zahlungsmethode", amount: "Betrag", note: "Anmerkung",
    receiptFooter: "Dieser Beleg wurde elektronisch erstellt und benötigt keine handschriftliche Unterschrift.",
    borcDokumuHeading: "SCHULDENÜBERSICHT", remaining: "Offen", noOpenDebt: "Es liegen keine offenen Schulden vor.",
    creditBalance: "Guthaben", totalBalance: "GESAMTSALDO",
    borcDokumuFooter: "Diese Übersicht listet nur offene Schulden auf; für den Zahlungsverlauf siehe Kontoauszug.",
  },
  ru: {
    orgSubtitle: "Upravlenie zhilym kompleksom", footerAuto: "Dokument avtomaticheski sformirovan sistemoy upravleniya Sakin.",
    createdAt: "Data formirovaniya", signature: "FIO upravlyayuschego / Podpis",
    debtLetterHeading: "SPRAVKA OB OTSUTSTVII ZADOLZHENNOSTI", site: "Ob'ekt", unit: "Kvartira", owner: "Sobstvennik",
    debtLetterBody1: (block, no, date) => `Nastoyaschim podtverzhdaetsya, chto po kvartire ${block} - No. ${no} po sostoyaniyu na ${date}`,
    debtLetterBody2: "zadolzhennost po vznosam/obschim raskhodam pered upravleniem otsutstvuet.",
    debtLetterBody3: "Dannyy dokument mozhet byt ispolzovan v banke, Rosreestre ili gosudarstvennykh organakh.",
    receiptHeading: "KVITANTSIYA OB OPLATE", receiptNo: "No. kvitantsii", date: "Data", payer: "Platelschik", method: "Sposob oplaty", amount: "Summa", note: "Primechanie",
    receiptFooter: "Kvitantsiya sformirovana v elektronnom vide, mokraya pechat ne trebuetsya.",
    borcDokumuHeading: "VYPISKA PO ZADOLZHENNOSTI", remaining: "Ostatok", noOpenDebt: "Otkrytoy zadolzhennosti net.",
    creditBalance: "Pereplata", totalBalance: "ITOGOVYY BALANS",
    borcDokumuFooter: "V vypiske ukazany tolko otkrytye dolgi; istoriyu platezhey smotrite v vypiske po schetu.",
  },
  az: {
    orgSubtitle: "Sayə İdarəetməsi", footerAuto: "Bu sənəd Sakin sayə idarəetmə sistemi tərəfindən avtomatik yaradılmışdır.",
    createdAt: "Yaradılma tarixi", signature: "İdarəçinin Adı / İmza",
    debtLetterHeading: "BORCU YOXDUR SƏNƏDİ", site: "Sayə", unit: "Mənzil", owner: "Mülkiyyətçi",
    debtLetterBody1: (block, no, date) => `Bu sənədlə ${block} - Mənzil ${no} nömrəli mənzilin ${date} tarixinə`,
    debtLetterBody2: "idarəetməyə qarşı heç bir aidat/ortaq xərc borcunun olmadığı təsdiq edilir.",
    debtLetterBody3: "Bu sənəd bank, torpaq kadastrı və ya rəsmi qurum əməliyyatlarında istifadə edilə bilər.",
    receiptHeading: "ÖDƏNİŞ QƏBZİ", receiptNo: "Qəbz No", date: "Tarix", payer: "Ödəyən", method: "Ödəniş Üsulu", amount: "Məbləğ", note: "Qeyd",
    receiptFooter: "Bu qəbz elektron mühitdə yaradılmışdır, imza tələb olunmur.",
    borcDokumuHeading: "BORC DÖKÜMÜ", remaining: "Qalıq", noOpenDebt: "Açıq borc qeydi yoxdur.",
    creditBalance: "Alacaqlı Balans", totalBalance: "ÜMUMİ XALİS BALANS",
    borcDokumuFooter: "Bu döküm yalnız açıq borcları siyahılayır, keçmiş ödənişlər üçün Hesab Xülasəsinə baxın.",
  },
};
function docLang(req) {
  const l = String(req.query.lang || "tr").toLowerCase();
  return DOC_I18N[l] ? l : "tr";
}

// Net bakiye hesabi db.js'te paylasilan tek yerde (db.netDebt).
const netDebt = db.netDebt;

async function buildDocument({ heading, lines, footerNote, lang }) {
  const L = DOC_I18N[lang || "tr"] || DOC_I18N.tr;
  const safe = (s) => pdfSafe(s, lang || "tr");
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);

  let y = 780;
  page.drawText(safe("SAKIN"), { x: 50, y, size: 22, font: bold, color: navy });
  page.drawText(safe(L.orgSubtitle), { x: 50, y: y - 18, size: 10, font, color: grey });
  page.drawLine({ start: { x: 50, y: y - 32 }, end: { x: 545, y: y - 32 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });

  y -= 70;
  page.drawText(safe(heading), { x: 50, y, size: 15, font: bold, color: navy });
  y -= 34;

  lines.forEach((line) => {
    if (line === "") { y -= 12; return; }
    page.drawText(safe(line), { x: 50, y, size: 11, font, color: rgb(0.06, 0.11, 0.15) });
    y -= 20;
  });

  page.drawLine({ start: { x: 50, y: 130 }, end: { x: 545, y: 130 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
  page.drawText(safe(footerNote || L.footerAuto), { x: 50, y: 110, size: 9, font, color: grey });
  page.drawText(safe(L.createdAt + ": " + fmtDateLoc(new Date(), lang)), { x: 50, y: 96, size: 9, font, color: grey });

  page.drawText(safe(L.signature), { x: 380, y: 180, size: 10, font, color: rgb(0.06, 0.11, 0.15) });
  page.drawLine({ start: { x: 380, y: 175 }, end: { x: 545, y: 175 }, thickness: 1, color: rgb(0.7, 0.76, 0.82) });

  return doc.save();
}

// Bankalarin konut kredisi vb. islemlerde talep ettigi "borcu yoktur" yazisi.
// Sikayet konusu olan gecikmeyi ortadan kaldirmak icin ANINDA olusturulur.
router.get("/documents/debt-letter", requireAuth, async (req, res) => {
  const data = await db.load();
  if (req.user.role !== "sakin") return res.status(403).json({ error: "Bu belge yalnızca sakinler için üretilir." });
  // Coklu daireli bir sakin ?unitId= ile HANGI dairesi icin belge istedigini
  // secebilir (belge dogasi geregi tek bir tasinmaz icindir, birlesik olamaz);
  // belirtmezse birincil dairesi varsayilir.
  const targetUnitId = req.query.unitId || req.user.unitId;
  if (!(await ownsUnit(db.prisma, req.user, targetUnitId))) return res.status(403).json({ error: "Bu daireye erişim yetkiniz yok." });
  const unit = data.units.find((u) => u.id === targetUnitId);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  const debt = netDebt(data, unit.id);
  if (debt > 0) {
    return res.status(409).json({ error: `Bu belge yalnızca borcu bulunmayan daireler için üretilebilir. Güncel bakiyeniz: ${fmtTL(debt)}` });
  }

  const lang = docLang(req);
  const L = DOC_I18N[lang];
  const bytes = await buildDocument({
    lang,
    heading: L.debtLetterHeading,
    lines: [
      `${L.site}: ${data.meta.buildingName}`,
      `${L.unit}: ${unit.block} - Daire ${unit.no}`,
      `${L.owner}: ${unit.ownerName || "-"}`,
      "",
      L.debtLetterBody1(unit.block, unit.no, fmtDateLoc(new Date(), lang)),
      L.debtLetterBody2,
      "",
      L.debtLetterBody3,
    ],
  });

  await db.logActivity(req.user, "document.debt-letter", `${unit.block} - Daire ${unit.no} için borcu yoktur belgesi indirildi.`, unit.id);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="borcu-yoktur-${unit.block}-${unit.no}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Bir odeme icin resmi makbuz
router.get("/documents/receipt/:paymentId", requireAuth, async (req, res) => {
  const data = await db.load();
  const payment = data.payments.find((p) => p.id === req.params.paymentId);
  if (!payment) return res.status(404).json({ error: "Ödeme kaydı bulunamadı." });
  if (req.user.role === "sakin" && !(await ownsUnit(db.prisma, req.user, payment.unitId))) return res.status(403).json({ error: "Bu makbuza erişim yetkiniz yok." });
  const unit = data.units.find((u) => u.id === payment.unitId);

  const lang = docLang(req);
  const L = DOC_I18N[lang];
  const bytes = await buildDocument({
    lang,
    heading: L.receiptHeading,
    lines: [
      `${L.receiptNo}: ${payment.receiptNo}`,
      `${L.date}: ${fmtDateLoc(payment.date, lang)}`,
      `${L.unit}: ${unit ? unit.block + " - Daire " + unit.no : "-"}`,
      `${L.payer}: ${unit ? unit.ownerName || "-" : "-"}`,
      `${L.method}: ${payment.method}`,
      "",
      `${L.amount}: ${fmtTL(payment.amount)}`,
      payment.note ? `${L.note}: ${payment.note}` : "",
    ].filter((l) => l !== undefined),
    footerNote: L.receiptFooter,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="makbuz-${payment.receiptNo}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Yonetimcell karsilastirmasi: "Toplu Tahsilat Makbuzu Dokumu" - secilen
// tarih araligindaki (opsiyonel kasa filtreli) TUM makbuzlari tek PDF'de
// arka arkaya basar (her odeme bir sayfa).
router.get("/documents/toplu-makbuz", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { startDate, endDate, accountId } = req.query;
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : null;
  const payments = data.payments
    .filter((p) => !p.cancelled)
    .filter((p) => !start || new Date(p.date) >= start)
    .filter((p) => !end || new Date(p.date) <= end)
    .filter((p) => !accountId || p.accountId === accountId)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!payments.length) return res.status(404).json({ error: "Seçilen kriterlere uyan tahsilat bulunamadı." });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);

  for (const payment of payments) {
    const unit = data.units.find((u) => u.id === payment.unitId);
    const page = doc.addPage([595, 842]);
    let y = 780;
    page.drawText(trSafe("SAKIN"), { x: 50, y, size: 22, font: bold, color: navy });
    page.drawText(trSafe("Site \ Apartman Yonetimi"), { x: 50, y: y - 18, size: 10, font, color: grey });
    page.drawLine({ start: { x: 50, y: y - 32 }, end: { x: 545, y: y - 32 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    y -= 70;
    page.drawText(trSafe("ÖDEME MAKBUZU"), { x: 50, y, size: 15, font: bold, color: navy });
    y -= 34;
    const lines = [
      `Makbuz No: ${payment.receiptNo}`,
      `Tarih: ${fmtDateTr(payment.date)}`,
      `Bağımsız Bölüm: ${unit ? unit.block + " - Daire " + unit.no : "-"}`,
      `Ödeyen: ${unit ? unit.ownerName || "-" : "-"}`,
      `Ödeme Yöntemi: ${payment.method}`,
      "",
      `Tutar: ${fmtTL(payment.amount)}`,
      payment.note ? `Not: ${payment.note}` : "",
    ].filter((l) => l !== undefined);
    lines.forEach((line) => {
      if (line === "") { y -= 12; return; }
      page.drawText(trSafe(line), { x: 50, y, size: 11, font, color: rgb(0.06, 0.11, 0.15) });
      y -= 20;
    });
    page.drawLine({ start: { x: 50, y: 130 }, end: { x: 545, y: 130 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    page.drawText(trSafe("Bu makbuz elektronik ortamda uretilmistir, islak imza gerekmez."), { x: 50, y: 110, size: 9, font, color: grey });
  }

  const bytes = await doc.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="toplu-makbuz.pdf"`);
  res.send(Buffer.from(bytes));
});

// Tek bir daire icin "Borc Dokumu" - Hesap Ozeti'nden farkli olarak SADECE
// acik (odenmemis/kismi) borclari listeler, gecmis odemeleri icermez
// (Yonetimcell karsilastirmasi: Uye Listesi'ndeki "Borc Dokumu" aksiyonu).
router.get("/documents/borc-dokumu/:unitId", requireAuth, async (req, res) => {
  const data = await db.load();
  if (req.user.role === "sakin" && !(await ownsUnit(db.prisma, req.user, req.params.unitId))) return res.status(403).json({ error: "Bu belgeye erişim yetkiniz yok." });
  const unit = data.units.find((u) => u.id === req.params.unitId);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });

  const openCharges = data.charges
    .filter((c) => c.unitId === unit.id && c.status !== "paid")
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const total = openCharges.reduce((s, c) => s + (c.amount - c.paidAmount), 0) - (unit.creditBalance || 0);

  const lang = docLang(req);
  const L = DOC_I18N[lang];
  const bytes = await buildDocument({
    lang,
    heading: L.borcDokumuHeading,
    lines: [
      `${L.unit}: ${unit.block} - Daire ${unit.no}`,
      `${L.owner}: ${unit.ownerName || "-"}`,
      "",
      ...openCharges.map((c) => `${fmtDateLoc(c.dueDate, lang)}  ${c.type}  ${c.description || ""}  —  ${L.remaining}: ${fmtTL(c.amount - c.paidAmount)}`),
      openCharges.length ? "" : L.noOpenDebt,
      unit.creditBalance > 0 ? `${L.creditBalance}: ${fmtTL(unit.creditBalance)}` : "",
      "",
      `${L.totalBalance}: ${fmtTL(total)}`,
    ].filter((l) => l !== undefined),
    footerNote: L.borcDokumuFooter,
  });

  await db.logActivity(req.user, "document.borc-dokumu", `${unit.block} - Daire ${unit.no} için borç dökümü indirildi.`, unit.id);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="borc-dokumu-${unit.block}-${unit.no}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Yonetimcell karsilastirmasi: "Toplu Üye Borç Dökümü" - secilen kriterlere
// uyan (borc durumu + esik tutar) TUM tasinmazlarin detayli borc dokumunu
// (tekli borc-dokumu ile ayni icerik) tek PDF'de arka arkaya basar.
router.get("/documents/toplu-borc-dokumu", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { durum, minBorc } = req.query;
  const threshold = Number(minBorc) || 0;
  const units = data.units
    .map((u) => ({ unit: u, debt: netDebt(data, u.id) }))
    .filter(({ debt }) => (durum === "borclu" ? debt > 0 : true))
    .filter(({ debt }) => debt >= threshold)
    .sort((a, b) => a.unit.block.localeCompare(b.unit.block, "tr") || a.unit.no.localeCompare(b.unit.no, "tr", { numeric: true }));
  if (!units.length) return res.status(404).json({ error: "Seçilen kriterlere uyan taşınmaz bulunamadı." });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);

  units.forEach(({ unit }) => {
    const openCharges = data.charges.filter((c) => c.unitId === unit.id && c.status !== "paid").sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    const total = openCharges.reduce((s, c) => s + (c.amount - c.paidAmount), 0) - (unit.creditBalance || 0);
    const page = doc.addPage([595, 842]);
    let y = 780;
    page.drawText(trSafe("SAKIN"), { x: 50, y, size: 22, font: bold, color: navy });
    page.drawText(trSafe("Site \ Apartman Yonetimi"), { x: 50, y: y - 18, size: 10, font, color: grey });
    page.drawLine({ start: { x: 50, y: y - 32 }, end: { x: 545, y: y - 32 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    y -= 70;
    page.drawText(trSafe("BORÇ DÖKÜMÜ"), { x: 50, y, size: 15, font: bold, color: navy });
    y -= 34;
    const lines = [
      `Bağımsız Bölüm: ${unit.block} - Daire ${unit.no}`,
      `Malik: ${unit.ownerName || "-"}`,
      "",
      ...openCharges.map((c) => `${fmtDateTr(c.dueDate)}  ${c.type}  ${c.description || ""}  —  Kalan: ${fmtTL(c.amount - c.paidAmount)}`),
      openCharges.length ? "" : "Açık borç kaydı bulunmamaktadır.",
      unit.creditBalance > 0 ? `Alacaklı Bakiye: ${fmtTL(unit.creditBalance)}` : "",
      "",
      `TOPLAM NET BAKİYE: ${fmtTL(total)}`,
    ].filter((l) => l !== undefined);
    lines.forEach((line) => {
      if (line === "") { y -= 12; return; }
      if (y < 80) return; // tek dairede cok fazla acik kalem varsa tasma korumasi
      page.drawText(trSafe(line), { x: 50, y, size: 11, font, color: rgb(0.06, 0.11, 0.15) });
      y -= 20;
    });
    page.drawLine({ start: { x: 50, y: 130 }, end: { x: 545, y: 130 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    page.drawText(trSafe("Bu dokum yalnizca acik borclari listeler."), { x: 50, y: 110, size: 9, font, color: grey });
  });

  const bytes = await doc.save();
  await db.logActivity(req.user, "document.toplu-borc-dokumu", `${units.length} taşınmaz için toplu borç dökümü indirildi.`, null);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="toplu-borc-dokumu.pdf"`);
  res.send(Buffer.from(bytes));
});

// Ilan panosuna asilabilecek, tum dairelerin guncel borc durumunu gosteren liste.
// Turkiye'deki apartman yonetimlerinde cok yaygin bir rutin ihtiyactir.
router.get("/documents/debt-list", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const rows = data.units
    .map((u) => ({ label: `${u.block} - Daire ${u.no}`, debt: netDebt(data, u.id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));

  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);
  const red = rgb(0.75, 0.28, 0.25);
  const green = rgb(0.12, 0.56, 0.37);

  let y = 780;
  page.drawText(trSafe("SAKIN"), { x: 50, y, size: 22, font: bold, color: navy });
  page.drawText(trSafe(data.meta.buildingName + " - Aidat Borc Listesi"), { x: 50, y: y - 18, size: 10, font, color: grey });
  page.drawLine({ start: { x: 50, y: y - 32 }, end: { x: 545, y: y - 32 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });

  y -= 60;
  page.drawText(trSafe("Bagimsiz Bolum"), { x: 50, y, size: 10, font: bold, color: grey });
  page.drawText(trSafe("Durum"), { x: 420, y, size: 10, font: bold, color: grey });
  y -= 14;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
  y -= 18;

  rows.forEach((r) => {
    if (y < 80) { y = 780; }
    page.drawText(trSafe(r.label), { x: 50, y, size: 11, font, color: rgb(0.06, 0.11, 0.15) });
    const text = r.debt > 0 ? `${r.debt.toFixed(0)} TL borclu` : r.debt < 0 ? `${Math.abs(r.debt).toFixed(0)} TL alacakli` : "Odendi";
    page.drawText(trSafe(text), { x: 420, y, size: 11, font: bold, color: r.debt > 0 ? red : green });
    y -= 20;
  });

  y -= 10;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
  page.drawText(trSafe("Olusturulma: " + fmtDateTr(new Date())), { x: 50, y: y - 16, size: 9, font, color: grey });

  const bytes = await doc.save();
  await db.logActivity(req.user, "document.debt-list", "İlan panosu için aidat borç listesi PDF'i indirildi.", null);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="aidat-borc-listesi.pdf"`);
  res.send(Buffer.from(bytes));
});

// Ayni borc listesinin CSV (Excel) hali - muhasebeciyle paylasmak veya kendi
// tabloya aktarmak icin. tr-TR Excel noktali virgul ayiraci bekler (virgul
// ondalik ayiraci oldugundan) ve BOM, Turkce karakterlerin dogru acilmasi icindir.
router.get("/documents/debt-list.csv", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const rows = data.units
    .map((u) => ({
      block: u.block,
      no: u.no,
      owner: u.ownerName || "",
      debt: netDebt(data, u.id),
    }))
    .sort((a, b) => `${a.block}${a.no}`.localeCompare(`${b.block}${b.no}`, "tr"));

  const escapeCsv = (v) => {
    const s = String(v ?? "");
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ["Blok", "Daire No", "Malik", "Borç (TL)"];
  const lines = [header.join(";"), ...rows.map((r) => [r.block, r.no, r.owner, r.debt.toFixed(2)].map(escapeCsv).join(";"))];
  const csv = "﻿" + lines.join("\r\n");

  await db.logActivity(req.user, "document.debt-list-csv", "Aidat borç listesi CSV/Excel olarak indirildi.", null);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="aidat-borc-listesi.csv"`);
  res.send(csv);
});

/* ================= HUKUKİ BELGE ŞABLONLARI ================= */
/* Yönetimcell karşılaştırmasından: gerçek metinleriyle çıkarılan iki
   kademeli tahsilat baskısı (Ödeme Çağrısı / İhtarname) ve standart
   genel kurul/vekaletname/hazirun/antetli evrak/adres etiketi şablonları. */

// Once nazik hatirlatma, sonra resmi ihtarname (7 gun sureli, icra tehditli).
router.get("/documents/tebligat/:unitId", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const unit = data.units.find((u) => u.id === req.params.unitId);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  const debt = netDebt(data, unit.id);
  const tier = req.query.tier === "ihtarname" ? "ihtarname" : "call";

  const lines = tier === "ihtarname"
    ? [
        `Sayın ${unit.ownerName || "İlgili"},`,
        "",
        `${data.meta.buildingName} Yöneticiliği'ne aşağıda dökümü mevcut borcunuz bulunmaktadır.`,
        "",
        `Bağımsız Bölüm: ${unit.block} - Daire ${unit.no}`,
        `Güncel Borç: ${fmtTL(debt)}`,
        "",
        "İşbu ihtarın tarafınıza tebliğini takip eden 7 (yedi) gün içerisinde vadesi geçmiş",
        "borcunuzu site/apartman yönetimine nakden ödemenizi, belirtilen süre içerisinde",
        "ödeme yapmamanız halinde borç bakiyesinin faiz ve ferileri ile birlikte tahsili için",
        "yasal yollara başvurulacağını, hakkınızda icra takibi başlatılabileceğini, yapılacak",
        "yasal işlemler nedeniyle oluşacak tüm masraf, yargılama gideri ve vekalet ücretinin",
        "de tarafınızdan tahsil edileceğini ihtaren bildiririz.",
      ]
    : [
        `Sayın ${unit.ownerName || "İlgili"},`,
        "",
        `${unit.block} - Daire ${unit.no} nolu bağımsız bölümünüzün güncel aidat/ortak gider`,
        `bakiyesi ${fmtTL(debt)} olarak görünmektedir.`,
        "",
        "En kısa sürede ödemenizi rica eder, herhangi bir itirazınız varsa yönetime",
        "bildirmenizi dileriz.",
      ];

  const bytes = await buildDocument({
    heading: tier === "ihtarname" ? "İHTARNAME" : "ÖDEME ÇAĞRISI",
    lines,
    footerNote: tier === "ihtarname" ? "Bu belge resmi bir hukuki uyarı niteliğindedir." : undefined,
  });

  await db.logActivity(req.user, "document.tebligat", `${unit.block} - Daire ${unit.no} için ${tier === "ihtarname" ? "ihtarname" : "ödeme çağrısı"} oluşturuldu.`, unit.id);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${tier}-${unit.block}-${unit.no}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Yonetimcell karsilastirmasi: "Tebligat Gönder" toplu hali - borcu esik
// tutarin uzerinde olan TUM tasinmazlara tek PDF'de (her biri ayri sayfa)
// ihtarname/odeme cagrisi basar.
router.get("/documents/toplu-tebligat", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const tier = req.query.tier === "ihtarname" ? "ihtarname" : "call";
  const minBorc = Number(req.query.minBorc) || 0;
  const units = data.units
    .map((u) => ({ unit: u, debt: netDebt(data, u.id) }))
    .filter(({ debt }) => debt > 0 && debt >= minBorc)
    .sort((a, b) => a.unit.block.localeCompare(b.unit.block, "tr") || a.unit.no.localeCompare(b.unit.no, "tr", { numeric: true }));
  if (!units.length) return res.status(404).json({ error: "Seçilen kriterlere uyan borçlu taşınmaz bulunamadı." });

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);

  units.forEach(({ unit, debt }) => {
    const lines = tier === "ihtarname"
      ? [
          `Sayın ${unit.ownerName || "İlgili"},`, "",
          `${data.meta.buildingName} Yöneticiliği'ne aşağıda dökümü mevcut borcunuz bulunmaktadır.`, "",
          `Bağımsız Bölüm: ${unit.block} - Daire ${unit.no}`, `Güncel Borç: ${fmtTL(debt)}`, "",
          "İşbu ihtarın tarafınıza tebliğini takip eden 7 (yedi) gün içerisinde vadesi geçmiş",
          "borcunuzu site/apartman yönetimine nakden ödemenizi, belirtilen süre içerisinde",
          "ödeme yapmamanız halinde borç bakiyesinin faiz ve ferileri ile birlikte tahsili için",
          "yasal yollara başvurulacağını, hakkınızda icra takibi başlatılabileceğini, yapılacak",
          "yasal işlemler nedeniyle oluşacak tüm masraf, yargılama gideri ve vekalet ücretinin",
          "de tarafınızdan tahsil edileceğini ihtaren bildiririz.",
        ]
      : [
          `Sayın ${unit.ownerName || "İlgili"},`, "",
          `${unit.block} - Daire ${unit.no} nolu bağımsız bölümünüzün güncel aidat/ortak gider`,
          `bakiyesi ${fmtTL(debt)} olarak görünmektedir.`, "",
          "En kısa sürede ödemenizi rica eder, herhangi bir itirazınız varsa yönetime", "bildirmenizi dileriz.",
        ];
    const page = doc.addPage([595, 842]);
    let y = 780;
    page.drawText(trSafe("SAKIN"), { x: 50, y, size: 22, font: bold, color: navy });
    page.drawText(trSafe("Site \ Apartman Yonetimi"), { x: 50, y: y - 18, size: 10, font, color: grey });
    page.drawLine({ start: { x: 50, y: y - 32 }, end: { x: 545, y: y - 32 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    y -= 70;
    page.drawText(trSafe(tier === "ihtarname" ? "İHTARNAME" : "ÖDEME ÇAĞRISI"), { x: 50, y, size: 15, font: bold, color: navy });
    y -= 34;
    lines.forEach((line) => {
      if (line === "") { y -= 12; return; }
      page.drawText(trSafe(line), { x: 50, y, size: 11, font, color: rgb(0.06, 0.11, 0.15) });
      y -= 20;
    });
  });

  const bytes = await doc.save();
  await db.logActivity(req.user, "document.toplu-tebligat", `${units.length} borçlu taşınmaza toplu ${tier === "ihtarname" ? "ihtarname" : "ödeme çağrısı"} oluşturuldu.`, null);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="toplu-${tier}.pdf"`);
  res.send(Buffer.from(bytes));
});

router.get("/documents/genel-kurul-cagrisi", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { birinciTarih, birinciSaat, ikinciTarih, ikinciSaat, adres } = req.query;
  const bytes = await buildDocument({
    heading: "GENEL KURUL ÇAĞRISI",
    lines: [
      `${data.meta.buildingName} yönetim kurulumuzun almış olduğu karar neticesinde`,
      "genel kurulumuz olağan/olağanüstü toplanacaktır.",
      "",
      `Toplantı, ${adres || data.meta.address || "…"} adresinde yapılacaktır.`,
      "",
      "Birinci toplantıda çoğunluk sağlanamadığı takdirde ikinci toplantı aşağıdaki",
      "tarih ve saatte aynı adreste yapılacaktır. İkinci toplantıda çoğunluk",
      "aranmaksızın toplantı açılarak kararlar alınacaktır.",
      "",
      `Birinci Toplantı: ${birinciTarih || "…/…/……"} Saat: ${birinciSaat || "…:…"}`,
      `İkinci Toplantı: ${ikinciTarih || "…/…/……"} Saat: ${ikinciSaat || "…:…"}`,
      "",
      "Toplantıya katılımınızı bekler, gereğini rica ederiz.",
    ],
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="genel-kurul-cagrisi.pdf"`);
  res.send(Buffer.from(bytes));
});

router.get("/documents/vekaletname", requireAuth, requireRole("yonetici"), async (req, res) => {
  const bytes = await buildDocument({
    heading: "VEKALETNAME ÖRNEĞİ",
    lines: [
      "Ben aşağıda kimlik bilgileri yazılı bağımsız bölüm maliki;",
      "",
      "Adı Soyadı: …………………………………………",
      "Bağımsız Bölüm: …………………………………………",
      "",
      "…………………………………………………… tarihinde yapılacak genel kurul toplantısında",
      "beni temsil etmek, oy kullanmak ve toplantıya ilişkin her türlü işlemi",
      "benim adıma yapmak üzere;",
      "",
      "Adı Soyadı: …………………………………………",
      "",
      "kişiyi vekil tayin ettiğimi beyan ederim.",
      "",
      "Vekalet Veren Adı / İmza: ……………………………………",
    ],
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="vekaletname-ornegi.pdf"`);
  res.send(Buffer.from(bytes));
});

router.get("/documents/antetli-evrak", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const bytes = await buildDocument({
    heading: "",
    lines: ["", "", "", "Konu: …………………………………………", "", ""],
    footerNote: data.meta.address || undefined,
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="antetli-evrak.pdf"`);
  res.send(Buffer.from(bytes));
});

// Genel kurul yoklama tutanagi: tum bagimsiz bolumlerin malik adi ve arsa
// payi ile imza icin bosluk birakilmis liste.
router.get("/documents/hazirun-cetveli", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const rows = data.units.slice().sort((a, b) => `${a.block}${a.no}`.localeCompare(`${b.block}${b.no}`, "tr"));

  const doc = await PDFDocument.create();
  let page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);

  let y = 780;
  const drawHeader = () => {
    page.drawText(trSafe("SAKIN"), { x: 50, y, size: 22, font: bold, color: navy });
    page.drawText(trSafe(data.meta.buildingName + " - Genel Kurul Hazirun (Yoklama) Cetveli"), { x: 50, y: y - 18, size: 10, font, color: grey });
    page.drawLine({ start: { x: 50, y: y - 32 }, end: { x: 545, y: y - 32 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    let hy = y - 60;
    page.drawText(trSafe("Bagimsiz Bolum"), { x: 50, y: hy, size: 10, font: bold, color: grey });
    page.drawText(trSafe("Malik"), { x: 180, y: hy, size: 10, font: bold, color: grey });
    page.drawText(trSafe("Arsa Payi"), { x: 370, y: hy, size: 10, font: bold, color: grey });
    page.drawText(trSafe("Imza"), { x: 460, y: hy, size: 10, font: bold, color: grey });
    hy -= 14;
    page.drawLine({ start: { x: 50, y: hy }, end: { x: 545, y: hy }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    return hy - 18;
  };
  y = drawHeader();

  rows.forEach((u) => {
    if (y < 80) { page = doc.addPage([595, 842]); y = 780; y = drawHeader(); }
    page.drawText(trSafe(`${u.block} - Daire ${u.no}`), { x: 50, y, size: 10, font, color: rgb(0.06, 0.11, 0.15) });
    page.drawText(trSafe(u.ownerName || "-"), { x: 180, y, size: 10, font, color: rgb(0.06, 0.11, 0.15) });
    page.drawText(trSafe(u.landShare != null ? String(u.landShare) : "-"), { x: 370, y, size: 10, font, color: rgb(0.06, 0.11, 0.15) });
    page.drawLine({ start: { x: 460, y: y - 3 }, end: { x: 545, y: y - 3 }, thickness: 0.7, color: rgb(0.7, 0.76, 0.82) });
    y -= 20;
  });

  const bytes = await doc.save();
  await db.logActivity(req.user, "document.hazirun", "Hazirun (yoklama) cetveli oluşturuldu.", null);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="hazirun-cetveli.pdf"`);
  res.send(Buffer.from(bytes));
});

// Adres etiketleri: hazir yapiskan etiket sablonu degil (kagit olcusu belirsiz),
// kesilip zarfa yapistirilabilecek tek sutunluk adres listesi.
router.get("/documents/adres-etiketleri", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const rows = data.units.slice().sort((a, b) => `${a.block}${a.no}`.localeCompare(`${b.block}${b.no}`, "tr"));

  const doc = await PDFDocument.create();
  let page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 780;

  rows.forEach((u) => {
    if (y < 90) { page = doc.addPage([595, 842]); y = 780; }
    page.drawRectangle({ x: 50, y: y - 60, width: 495, height: 55, borderColor: rgb(0.8, 0.84, 0.88), borderWidth: 0.7 });
    page.drawText(trSafe(u.ownerName || "İlgili"), { x: 62, y: y - 22, size: 12, font: bold, color: rgb(0.06, 0.11, 0.15) });
    page.drawText(trSafe(`${u.block} - Daire ${u.no}`), { x: 62, y: y - 38, size: 10, font, color: rgb(0.35, 0.4, 0.45) });
    page.drawText(trSafe(data.meta.address || ""), { x: 62, y: y - 52, size: 9, font, color: rgb(0.35, 0.4, 0.45) });
    y -= 68;
  });

  const bytes = await doc.save();
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="adres-etiketleri.pdf"`);
  res.send(Buffer.from(bytes));
});

// Toplu Hesap Ozeti Dokumu: her dairenin borc+tahsilat hareketlerini kosan
// bakiyeli ekstre olarak, hepsini tek PDF icinde art arda uretir (Yonetimcell'in
// "Toplu Hesap Ozeti Dokumu" raporunun karsiligi - bkz. Uye Raporlari).
router.get("/documents/toplu-hesap-ozeti", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const units = data.units.slice().sort((a, b) => `${a.block}${a.no}`.localeCompare(`${b.block}${b.no}`, "tr"));

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);
  const red = rgb(0.75, 0.28, 0.25);
  const green = rgb(0.12, 0.56, 0.37);

  units.forEach((unit) => {
    const entries = [];
    data.charges.filter((ch) => ch.unitId === unit.id).forEach((ch) => entries.push({ date: ch.dueDate, label: `${ch.type} - ${ch.description || ""}`, amount: ch.amount }));
    data.payments.filter((p) => p.unitId === unit.id && !p.cancelled).forEach((p) => entries.push({ date: p.date, label: `Tahsilat (${p.method}) - Makbuz ${p.receiptNo}`, amount: -p.amount }));
    entries.sort((a, b) => new Date(a.date) - new Date(b.date));
    let running = 0;
    entries.forEach((e) => { running += e.amount; e.balance = running; });

    const page = doc.addPage([595, 842]);
    let y = 780;
    page.drawText(trSafe("SAKIN"), { x: 50, y, size: 20, font: bold, color: navy });
    page.drawText(trSafe(`${unit.block} - Daire ${unit.no} — Hesap Özeti`), { x: 50, y: y - 18, size: 11, font, color: grey });
    page.drawText(trSafe(unit.ownerName || "-"), { x: 50, y: y - 32, size: 10, font, color: grey });
    page.drawLine({ start: { x: 50, y: y - 44 }, end: { x: 545, y: y - 44 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });

    y -= 70;
    page.drawText(trSafe("Tarih"), { x: 50, y, size: 9, font: bold, color: grey });
    page.drawText(trSafe("Açıklama"), { x: 130, y, size: 9, font: bold, color: grey });
    page.drawText(trSafe("Tutar"), { x: 400, y, size: 9, font: bold, color: grey });
    page.drawText(trSafe("Bakiye"), { x: 480, y, size: 9, font: bold, color: grey });
    y -= 14;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    y -= 16;

    entries.slice().reverse().forEach((e) => {
      if (y < 60) return; // tek sayfa - cok uzun ekstreler kirpilir (toplu dokum ozeti icin yeterli)
      page.drawText(trSafe(fmtDateTr(e.date)), { x: 50, y, size: 9, font, color: rgb(0.06, 0.11, 0.15) });
      page.drawText(trSafe(e.label).slice(0, 45), { x: 130, y, size: 9, font, color: rgb(0.06, 0.11, 0.15) });
      page.drawText(trSafe((e.amount > 0 ? "+" : "") + e.amount.toFixed(0)), { x: 400, y, size: 9, font, color: e.amount > 0 ? red : green });
      page.drawText(trSafe(e.balance.toFixed(0)), { x: 480, y, size: 9, font: bold, color: rgb(0.06, 0.11, 0.15) });
      y -= 15;
    });

    y = Math.max(y, 60) - 14;
    page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
    page.drawText(trSafe(`Güncel Bakiye: ${running.toFixed(0)} TL ${running > 0 ? "(Borçlu)" : "(Borcu Yok)"}`), { x: 50, y: y - 16, size: 10, font: bold, color: running > 0 ? red : green });
  });

  const bytes = await doc.save();
  await db.logActivity(req.user, "document.toplu-hesap-ozeti", `Toplu hesap özeti dökümü indirildi (${units.length} daire).`, null);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="toplu-hesap-ozeti.pdf"`);
  res.send(Buffer.from(bytes));
});

// ---------------- Muhasebe Raporlari (Yonetimcell karsilastirmasi) ----------------
// Yevmiye/Kebir Defteri + Kapanis Mizani + Firma Mutabakat Mektubu - canli
// hesapta incelenince ortaya cikti ki bunlar ayri bir cift-tarafli defter
// degil, mevcut Charge/Payment/PartyCharge/PartyPayment verisinin yil bazinda
// PDF'e dokumu. buildDocument tek sayfa cizdigi icin uzun listeler ilk N
// satirla sinirlanir (tam liste icin ekrandaki Tahakkuk Fisleri sorgulanabilir).

router.get("/documents/yevmiye-defteri", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const inYear = (d) => new Date(d).getFullYear() === year;
  const unitById = new Map(data.units.map((u) => [u.id, u]));

  const entries = [];
  data.charges.filter((c) => inYear(c.createdAt)).forEach((c) => {
    const u = unitById.get(c.unitId);
    entries.push({ date: c.createdAt, text: `${u ? u.block + "/" + u.no : "-"} ${c.type} — Borç ${fmtTL(c.amount)}` });
  });
  data.payments.filter((p) => !p.cancelled && inYear(p.date)).forEach((p) => {
    const u = unitById.get(p.unitId);
    entries.push({ date: p.date, text: `${u ? u.block + "/" + u.no : "-"} Tahsilat (${p.receiptNo}) — Alacak ${fmtTL(p.amount)}` });
  });
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));

  const bytes = await buildDocument({
    heading: `${year} YEVMİYE DEFTERİ`,
    lines: [
      `Toplam kayıt: ${entries.length}`,
      "",
      ...entries.slice(0, 38).map((e) => `${fmtDateTr(e.date)} — ${e.text}`),
      entries.length > 38 ? `… ve ${entries.length - 38} kayıt daha (tam liste için Tahakkuk Fişleri ekranı)` : "",
    ].filter((l) => l !== undefined),
    footerNote: "Bu döküm mevcut borç/tahsilat kayıtlarından otomatik oluşturulmuştur.",
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="yevmiye-defteri-${year}.pdf"`);
  res.send(Buffer.from(bytes));
});

router.get("/documents/kebir-defteri", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const inYear = (d) => new Date(d).getFullYear() === year;
  const unitById = new Map(data.units.map((u) => [u.id, u]));

  const totals = new Map();
  function add(key, borc, alacak) {
    const cur = totals.get(key) || { borc: 0, alacak: 0 };
    cur.borc += borc; cur.alacak += alacak;
    totals.set(key, cur);
  }
  data.charges.filter((c) => inYear(c.createdAt)).forEach((c) => {
    const u = unitById.get(c.unitId);
    add(u ? `${u.block}/${u.no} ${u.ownerName || "-"}` : "Bilinmeyen Daire", c.amount, 0);
  });
  data.payments.filter((p) => !p.cancelled && inYear(p.date)).forEach((p) => {
    const u = unitById.get(p.unitId);
    add(u ? `${u.block}/${u.no} ${u.ownerName || "-"}` : "Bilinmeyen Daire", 0, p.amount);
  });

  const rows = [...totals.entries()].sort((a, b) => a[0].localeCompare(b[0], "tr"));
  const bytes = await buildDocument({
    heading: `${year} KEBİR DEFTERİ (ÖZET)`,
    lines: [
      `Hesap sayısı: ${rows.length}`,
      "",
      ...rows.slice(0, 38).map(([label, t]) => `${label} — Borç: ${fmtTL(t.borc)} · Alacak: ${fmtTL(t.alacak)} · Bakiye: ${fmtTL(t.borc - t.alacak)}`),
      rows.length > 38 ? `… ve ${rows.length - 38} hesap daha` : "",
    ].filter((l) => l !== undefined),
    footerNote: "Bu döküm mevcut borç/tahsilat kayıtlarından otomatik oluşturulmuştur.",
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="kebir-defteri-${year}.pdf"`);
  res.send(Buffer.from(bytes));
});

router.get("/documents/kapanis-mizani", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const cutoff = new Date(`${year}-12-31T23:59:59`);

  const rows = data.units.map((u) => {
    const charges = data.charges.filter((c) => c.unitId === u.id && new Date(c.createdAt) <= cutoff);
    const paid = data.payments.filter((p) => p.unitId === u.id && !p.cancelled && new Date(p.date) <= cutoff).reduce((s, p) => s + p.amount, 0);
    const borc = charges.reduce((s, c) => s + c.amount, 0);
    const net = borc - paid;
    return { label: `${u.block}/${u.no} ${u.ownerName || "-"}`, net };
  }).filter((r) => Math.abs(r.net) > 0.01);

  const totalBorc = rows.reduce((s, r) => s + Math.max(0, r.net), 0);
  const totalAlacak = rows.reduce((s, r) => s + Math.max(0, -r.net), 0);
  const bytes = await buildDocument({
    heading: `${year} YIL SONU KAPANIŞ MİZANI`,
    lines: [
      `${year}-12-31 itibarıyla üye bakiyeleri`,
      "",
      ...rows.slice(0, 34).map((r) => `${r.label} — ${r.net > 0 ? "Borçlu" : "Alacaklı"}: ${fmtTL(Math.abs(r.net))}`),
      rows.length > 34 ? `… ve ${rows.length - 34} daire daha` : "",
      "",
      `TOPLAM BORÇ BAKİYESİ: ${fmtTL(totalBorc)}`,
      `TOPLAM ALACAK BAKİYESİ: ${fmtTL(totalAlacak)}`,
    ].filter((l) => l !== undefined),
    footerNote: "Bu döküm mevcut borç/tahsilat kayıtlarından otomatik oluşturulmuştur, resmi mali müşavir onayı yerine geçmez.",
  });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="kapanis-mizani-${year}.pdf"`);
  res.send(Buffer.from(bytes));
});

router.get("/documents/firma-mutabakat/:vendorId", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const vendor = data.vendors.find((v) => v.id === req.params.vendorId);
  if (!vendor) return res.status(404).json({ error: "Firma bulunamadı." });
  const charges = data.partyCharges.filter((c) => c.partyType === "firma" && c.partyId === vendor.id && c.status !== "paid");
  const balance = charges.reduce((s, c) => s + (c.amount - c.paidAmount), 0);

  const bytes = await buildDocument({
    heading: "MUTABAKAT MEKTUBU",
    lines: [
      `Sayın ${vendor.name},`,
      "",
      `${fmtDateTr(new Date())} tarihi itibarıyla kayıtlarımıza göre güncel bakiyeniz ${fmtTL(balance)} olarak görünmektedir.`,
      "Bu bakiye ile mutabık olup olmadığınızı bildirmenizi rica ederiz.",
      "",
      `${data.meta.buildingName || "Site Yönetimi"}`,
    ],
    footerNote: "Bu mektup site yönetim sistemi tarafından otomatik oluşturulmuştur.",
  });
  await db.logActivity(req.user, "document.firma-mutabakat", `${vendor.name} için mutabakat mektubu indirildi.`, null);
  // Content-Disposition header'i Turkce karakter icerince Node ERR_INVALID_CHAR
  // firlatir (raw header sadece Latin-1 kabul eder) - dosya adi ASCII'ye
  // indirgeniyor (trSafe) ve kalan gecersiz karakterler temizleniyor.
  const safeFileName = trSafe(vendor.name).replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "firma";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="mutabakat-${safeFileName}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Yonetimcell karsilastirmasi: "Bütçe Raporları" - mevcut Butce ekranindaki
// (planlanan/gerceklesen) verinin PDF ciktisi. Ekranda zaten olan tek eksik
// buydu.
router.get("/documents/butce-raporu", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const budgets = data.budgets.filter((b) => b.year === year);
  const withActuals = budgets.map((b) => {
    const actual = data.transactions.filter((t) => t.type === "gider" && t.category === b.category && new Date(t.date).getFullYear() === year).reduce((s, t) => s + t.amount, 0);
    return { ...b, actualAmount: actual };
  });
  if (!withActuals.length) return res.status(404).json({ error: `${year} yılı için kayıtlı bütçe kalemi bulunamadı.` });

  const totalPlanned = withActuals.reduce((s, b) => s + b.plannedAmount, 0);
  const totalActual = withActuals.reduce((s, b) => s + b.actualAmount, 0);
  const bytes = await buildDocument({
    heading: `${year} YILI BÜTÇE RAPORU`,
    lines: [
      `Site: ${data.meta.buildingName}`,
      "",
      ...withActuals.map((b) => `${b.category}  —  Planlanan: ${fmtTL(b.plannedAmount)}  /  Gerçekleşen: ${fmtTL(b.actualAmount)}  /  Fark: ${fmtTL(b.plannedAmount - b.actualAmount)}`),
      "",
      `TOPLAM PLANLANAN: ${fmtTL(totalPlanned)}`,
      `TOPLAM GERÇEKLEŞEN: ${fmtTL(totalActual)}`,
      `TOPLAM FARK: ${fmtTL(totalPlanned - totalActual)}`,
    ],
    footerNote: "Gerçekleşen tutarlar, kategori adı eşleşen gider hareketlerinin toplamıdır.",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="butce-raporu-${year}.pdf"`);
  res.send(Buffer.from(bytes));
});

module.exports = router;
