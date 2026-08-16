const express = require("express");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

// pdf-lib'in standart fontlari WinAnsi kodlamasini kullanir ve bazi Turkce
// karakterleri (ğ, ı, ş, İ) desteklemez. Resmi belgede hata firlatmamak icin
// bu karakterleri en yakin ASCII karsiligina donusturuyoruz (yalnizca PDF ciktisinda).
function trSafe(text) {
  const map = { ğ: "g", Ğ: "G", ı: "i", İ: "I", ş: "s", Ş: "S", ç: "c", Ç: "C", ö: "o", Ö: "O", ü: "u", Ü: "U" };
  return String(text ?? "").replace(/[ğĞışŞçÇöÖüÜİ]/g, (m) => map[m] || m);
}

function fmtDateTr(d) {
  return new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
}
function fmtTL(n) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n) + " TL";
}

// Net bakiye hesabi db.js'te paylasilan tek yerde (db.netDebt).
const netDebt = db.netDebt;

async function buildDocument({ heading, lines, footerNote }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]); // A4
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const navy = rgb(0.078, 0.188, 0.29);
  const grey = rgb(0.43, 0.5, 0.56);

  let y = 780;
  page.drawText(trSafe("SAKIN"), { x: 50, y, size: 22, font: bold, color: navy });
  page.drawText(trSafe("Site / Apartman Yonetimi"), { x: 50, y: y - 18, size: 10, font, color: grey });
  page.drawLine({ start: { x: 50, y: y - 32 }, end: { x: 545, y: y - 32 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });

  y -= 70;
  page.drawText(trSafe(heading), { x: 50, y, size: 15, font: bold, color: navy });
  y -= 34;

  lines.forEach((line) => {
    if (line === "") { y -= 12; return; }
    page.drawText(trSafe(line), { x: 50, y, size: 11, font, color: rgb(0.06, 0.11, 0.15) });
    y -= 20;
  });

  page.drawLine({ start: { x: 50, y: 130 }, end: { x: 545, y: 130 }, thickness: 1, color: rgb(0.87, 0.9, 0.93) });
  page.drawText(trSafe(footerNote || "Bu belge Sakin site yonetim sistemi tarafindan otomatik olusturulmustur."), { x: 50, y: 110, size: 9, font, color: grey });
  page.drawText(trSafe("Olusturulma: " + fmtDateTr(new Date())), { x: 50, y: 96, size: 9, font, color: grey });

  page.drawText(trSafe("Yonetici Adi / Imza"), { x: 380, y: 180, size: 10, font, color: rgb(0.06, 0.11, 0.15) });
  page.drawLine({ start: { x: 380, y: 175 }, end: { x: 545, y: 175 }, thickness: 1, color: rgb(0.7, 0.76, 0.82) });

  return doc.save();
}

// Bankalarin konut kredisi vb. islemlerde talep ettigi "borcu yoktur" yazisi.
// Sikayet konusu olan gecikmeyi ortadan kaldirmak icin ANINDA olusturulur.
router.get("/documents/debt-letter", requireAuth, async (req, res) => {
  const data = await db.load();
  if (req.user.role !== "sakin") return res.status(403).json({ error: "Bu belge yalnızca sakinler için üretilir." });
  const unit = data.units.find((u) => u.id === req.user.unitId);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  const debt = netDebt(data, unit.id);
  if (debt > 0) {
    return res.status(409).json({ error: `Bu belge yalnızca borcu bulunmayan daireler için üretilebilir. Güncel bakiyeniz: ${fmtTL(debt)}` });
  }

  const bytes = await buildDocument({
    heading: "BORCU YOKTUR BELGESİ",
    lines: [
      `Site: ${data.meta.buildingName}`,
      `Bağımsız Bölüm: ${unit.block} - Daire ${unit.no}`,
      `Malik: ${unit.ownerName || "-"}`,
      "",
      `İşbu belge ile ${unit.block} - Daire ${unit.no} nolu bağımsız bölümün, ${fmtDateTr(new Date())} tarihi itibarıyla`,
      "site yönetimine karşı herhangi bir aidat/ortak gider borcunun bulunmadığı tasdik edilir.",
      "",
      "Bu belge banka, tapu veya resmi kurum işlemlerinde kullanılabilir.",
    ],
  });

  db.logActivity(data, req.user, "document.debt-letter", `${unit.block} - Daire ${unit.no} için borcu yoktur belgesi indirildi.`, unit.id);
  await db.save(data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="borcu-yoktur-${unit.block}-${unit.no}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Bir odeme icin resmi makbuz
router.get("/documents/receipt/:paymentId", requireAuth, async (req, res) => {
  const data = await db.load();
  const payment = data.payments.find((p) => p.id === req.params.paymentId);
  if (!payment) return res.status(404).json({ error: "Ödeme kaydı bulunamadı." });
  if (req.user.role === "sakin" && payment.unitId !== req.user.unitId) return res.status(403).json({ error: "Bu makbuza erişim yetkiniz yok." });
  const unit = data.units.find((u) => u.id === payment.unitId);

  const bytes = await buildDocument({
    heading: "ÖDEME MAKBUZU",
    lines: [
      `Makbuz No: ${payment.receiptNo}`,
      `Tarih: ${fmtDateTr(payment.date)}`,
      `Bağımsız Bölüm: ${unit ? unit.block + " - Daire " + unit.no : "-"}`,
      `Ödeyen: ${unit ? unit.ownerName || "-" : "-"}`,
      `Ödeme Yöntemi: ${payment.method}`,
      "",
      `Tutar: ${fmtTL(payment.amount)}`,
      payment.note ? `Not: ${payment.note}` : "",
    ].filter((l) => l !== undefined),
    footerNote: "Bu makbuz elektronik ortamda üretilmiştir, ıslak imza gerekmez.",
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="makbuz-${payment.receiptNo}.pdf"`);
  res.send(Buffer.from(bytes));
});

// Tek bir daire icin "Borc Dokumu" - Hesap Ozeti'nden farkli olarak SADECE
// acik (odenmemis/kismi) borclari listeler, gecmis odemeleri icermez
// (Yonetimcell karsilastirmasi: Uye Listesi'ndeki "Borc Dokumu" aksiyonu).
router.get("/documents/borc-dokumu/:unitId", requireAuth, async (req, res) => {
  const data = await db.load();
  if (req.user.role === "sakin" && req.user.unitId !== req.params.unitId) return res.status(403).json({ error: "Bu belgeye erişim yetkiniz yok." });
  const unit = data.units.find((u) => u.id === req.params.unitId);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });

  const openCharges = data.charges
    .filter((c) => c.unitId === unit.id && c.status !== "paid")
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const total = openCharges.reduce((s, c) => s + (c.amount - c.paidAmount), 0) - (unit.creditBalance || 0);

  const bytes = await buildDocument({
    heading: "BORÇ DÖKÜMÜ",
    lines: [
      `Bağımsız Bölüm: ${unit.block} - Daire ${unit.no}`,
      `Malik: ${unit.ownerName || "-"}`,
      "",
      ...openCharges.map((c) => `${fmtDateTr(c.dueDate)}  ${c.type}  ${c.description || ""}  —  Kalan: ${fmtTL(c.amount - c.paidAmount)}`),
      openCharges.length ? "" : "Açık borç kaydı bulunmamaktadır.",
      unit.creditBalance > 0 ? `Alacaklı Bakiye: ${fmtTL(unit.creditBalance)}` : "",
      "",
      `TOPLAM NET BAKİYE: ${fmtTL(total)}`,
    ].filter((l) => l !== undefined),
    footerNote: "Bu döküm yalnızca açık borçları listeler, geçmiş ödemeler için Hesap Özeti'ne bakınız.",
  });

  db.logActivity(data, req.user, "document.borc-dokumu", `${unit.block} - Daire ${unit.no} için borç dökümü indirildi.`, unit.id);
  await db.save(data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="borc-dokumu-${unit.block}-${unit.no}.pdf"`);
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
  db.logActivity(data, req.user, "document.debt-list", "İlan panosu için aidat borç listesi PDF'i indirildi.", null);
  await db.save(data);

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

  db.logActivity(data, req.user, "document.debt-list-csv", "Aidat borç listesi CSV/Excel olarak indirildi.", null);
  await db.save(data);

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

  db.logActivity(data, req.user, "document.tebligat", `${unit.block} - Daire ${unit.no} için ${tier === "ihtarname" ? "ihtarname" : "ödeme çağrısı"} oluşturuldu.`, unit.id);
  await db.save(data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${tier}-${unit.block}-${unit.no}.pdf"`);
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
  db.logActivity(data, req.user, "document.hazirun", "Hazirun (yoklama) cetveli oluşturuldu.", null);
  await db.save(data);

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
  db.logActivity(data, req.user, "document.toplu-hesap-ozeti", `Toplu hesap özeti dökümü indirildi (${units.length} daire).`, null);
  await db.save(data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="toplu-hesap-ozeti.pdf"`);
  res.send(Buffer.from(bytes));
});

module.exports = router;
