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
  const debt = data.charges.filter((c) => c.unitId === unit.id && c.status !== "paid").reduce((s, c) => s + (c.amount - c.paidAmount), 0);
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

// Ilan panosuna asilabilecek, tum dairelerin guncel borc durumunu gosteren liste.
// Turkiye'deki apartman yonetimlerinde cok yaygin bir rutin ihtiyactir.
router.get("/documents/debt-list", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const rows = data.units
    .map((u) => ({ label: `${u.block} - Daire ${u.no}`, debt: data.charges.filter((c) => c.unitId === u.id && c.status !== "paid").reduce((s, c) => s + (c.amount - c.paidAmount), 0) }))
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
    const text = r.debt > 0 ? `${r.debt.toFixed(0)} TL borclu` : "Odendi";
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

module.exports = router;
