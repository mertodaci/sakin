const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

// Yonetimcell karsilastirmasi: "Muhasebe Raporlari" modulu. Canlı hesapta
// incelendiginde ortaya cikti ki bu GERCEK cift-tarafli bir muhasebe defteri
// degil - mevcut verilerimizin (Account/Unit/Vendor/Personnel/ExpenseCategory)
// uzerine, kullanicinin kendi mali musavirine referans icin atadigi serbest
// metin bir "Hesap Kodu" etiketi + bu kodlarla birlikte sunulan raporlar
// (Mizan, Tahakkuk Fisleri, Yevmiye/Kebir Defteri, Firma Mutabakat Mektubu).
// Asagidaki varsayilan kod on-ekleri (100/102/120/320/335/770) Tekduzen Hesap
// Plani grup kodlarindan esinlenmistir (Kasa/Banka/Alicilar/Saticilar/
// Personele Borclar/Genel Yonetim Giderleri) - kullanici sonradan degistirebilir.

const TYPE_TO_MODEL = { account: "account", unit: "unit", vendor: "vendor", personnel: "personnel", category: "expenseCategory" };

router.get("/accounting/codes", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const categories = await db.prisma.expenseCategory.findMany({ orderBy: [{ group: "asc" }, { name: "asc" }] });
  res.json({
    kasalar: data.accounts.map((a) => ({ id: a.id, label: a.name, code: a.accountingCode || null })),
    uyeler: data.units.map((u) => ({ id: u.id, label: `(${u.block}/${u.no}) ${u.ownerName || "-"}`, code: u.accountingCode || null })),
    firmalar: data.vendors.map((v) => ({ id: v.id, label: v.name, code: v.accountingCode || null })),
    personel: data.personnel.map((p) => ({ id: p.id, label: p.name, code: p.accountingCode || null })),
    giderler: categories.map((c) => ({ id: c.id, label: `${c.group} / ${c.name}`, code: c.accountingCode || null })),
  });
});

router.patch("/accounting/codes", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { type, id, code } = req.body || {};
  const model = TYPE_TO_MODEL[type];
  if (!model || !id) return res.status(400).json({ error: "Geçersiz tür veya kayıt." });

  // DIKKAT: eskiden account/unit/vendor/personnel legacy shim (db.load/
  // db.save) uzerinden yaziliyordu - vendor artik LEGACY_COLLECTIONS'ta
  // olmadigi icin bu save() sessizce hicbir sey yazmiyordu (firma muhasebe
  // kodu ATAMA UCU FIILEN CALISMIYORDU, kimse fark etmedi cunku hata
  // donmuyordu). Tum turler artik tek, dogrudan Prisma cagrisi.
  const updated = await prisma[model].update({ where: { id }, data: { accountingCode: code || null } }).catch(() => null);
  if (!updated) return res.status(404).json({ error: "Kayıt bulunamadı." });
  res.json({ id: updated.id, code: updated.accountingCode });
});

router.post("/accounting/codes/auto-assign", requireAuth, requireRole("yonetici"), async (req, res) => {
  const categories = await prisma.expenseCategory.findMany();
  let assigned = 0;

  function nextCode(prefix, existingCodes) {
    let n = 1;
    while (existingCodes.has(`${prefix}.${String(n).padStart(2, "0")}`)) n++;
    const code = `${prefix}.${String(n).padStart(2, "0")}`;
    existingCodes.add(code);
    return code;
  }

  // DIKKAT: eskiden butun 4 koleksiyon bellekte guncellenip TEK bir
  // db.save(data, ["accounts","units","vendors","personnel"]) ile
  // yaziliyordu - vendors artik legacy shim'de olmadigi icin bu, firma
  // otomatik kod atamasinin FIILEN HICBIR SEY YAZMAMASI demekti (sessiz
  // hata). Artik her tur kendi dogrudan Prisma update()'iyle yaziyor.
  const plans = [
    { prefix: "100", model: "account" },
    { prefix: "120", model: "unit" },
    { prefix: "320", model: "vendor" },
    { prefix: "335", model: "personnel" },
  ];
  for (const plan of plans) {
    const rows = await prisma[plan.model].findMany();
    const existing = new Set(rows.filter((r) => r.accountingCode).map((r) => r.accountingCode));
    for (const r of rows) {
      if (!r.accountingCode) {
        const code = nextCode(plan.prefix, existing);
        await prisma[plan.model].update({ where: { id: r.id }, data: { accountingCode: code } });
        assigned++;
      }
    }
  }

  const existingCat = new Set(categories.filter((c) => c.accountingCode).map((c) => c.accountingCode));
  for (const cat of categories) {
    if (!cat.accountingCode) {
      const code = nextCode("770", existingCat);
      await db.prisma.expenseCategory.update({ where: { id: cat.id }, data: { accountingCode: code } });
      assigned++;
    }
  }

  res.json({ message: `${assigned} tanıma otomatik kod atandı.`, assigned });
});

// Mizan Raporu: her varlik turu (kasa/uye/firma/personel) icin Toplam Borc/
// Toplam Alacak/Borc Bakiye/Alacak Bakiye - mevcut netDebt/partyDebt/hesap
// bakiyesi hesaplarimizin ustune Hesap Kodu etiketiyle birlestirilmis hali.
router.get("/accounting/mizan", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const categories = await db.prisma.expenseCategory.findMany();
  const rows = [];

  data.accounts.forEach((a) => {
    const gelir = data.transactions.filter((t) => t.accountId === a.id && t.type === "gelir").reduce((s, t) => s + t.amount, 0);
    const gider = data.transactions.filter((t) => t.accountId === a.id && t.type === "gider").reduce((s, t) => s + t.amount, 0);
    const balance = a.openingBalance + gelir - gider;
    rows.push({ code: a.accountingCode || null, label: a.name, group: "Kasalar/Bankalar", toplamBorc: a.openingBalance + gelir, toplamAlacak: gider, borcBakiye: Math.max(0, balance), alacakBakiye: Math.max(0, -balance) });
  });

  data.units.forEach((u) => {
    const charges = data.charges.filter((c) => c.unitId === u.id);
    const toplamBorc = charges.reduce((s, c) => s + c.amount, 0);
    const toplamAlacak = data.payments.filter((p) => p.unitId === u.id && !p.cancelled).reduce((s, p) => s + p.amount, 0);
    const net = db.netDebt(data, u.id);
    rows.push({ code: u.accountingCode || null, label: `(${u.block}/${u.no}) ${u.ownerName || "-"}`, group: "Üyeler", toplamBorc, toplamAlacak, borcBakiye: Math.max(0, net), alacakBakiye: Math.max(0, -net) });
  });

  function partyRows(list, partyType, group) {
    list.forEach((entity) => {
      const charges = data.partyCharges.filter((c) => c.partyType === partyType && c.partyId === entity.id);
      const toplamBorc = charges.reduce((s, c) => s + c.amount, 0);
      const toplamAlacak = data.partyPayments.filter((p) => p.partyType === partyType && p.partyId === entity.id && !p.cancelled).reduce((s, p) => s + p.amount, 0);
      const openBalance = charges.filter((c) => c.status !== "paid").reduce((s, c) => s + (c.amount - c.paidAmount), 0);
      rows.push({ code: entity.accountingCode || null, label: entity.name, group, toplamBorc, toplamAlacak, borcBakiye: Math.max(0, openBalance), alacakBakiye: Math.max(0, -openBalance) });
    });
  }
  partyRows(data.vendors, "firma", "Firmalar");
  partyRows(data.personnel, "personel", "Personel");

  categories.forEach((cat) => {
    const charges = data.partyCharges.filter((c) => !c.partyType && c.categoryId === cat.id);
    if (!charges.length) return;
    const toplamBorc = charges.reduce((s, c) => s + c.amount, 0);
    const openBalance = charges.filter((c) => c.status !== "paid").reduce((s, c) => s + (c.amount - c.paidAmount), 0);
    rows.push({ code: cat.accountingCode || null, label: `${cat.group} / ${cat.name}`, group: "Genel Giderler", toplamBorc, toplamAlacak: toplamBorc - openBalance, borcBakiye: Math.max(0, openBalance), alacakBakiye: Math.max(0, -openBalance) });
  });

  let filtered = rows;
  if (req.query.code) filtered = filtered.filter((r) => (r.code || "").toLowerCase().includes(String(req.query.code).toLowerCase()));
  res.json(filtered);
});

// Muhasebe Tahakkuk Fisleri: verilen tarih araliginda olusan her borc/tahsilat
// olayini (Charge/Payment/PartyCharge/PartyPayment) Fis No + Hesap Kodu +
// Aciklama + Borc/Alacak seklinde tek bir kronolojik listede birlestirir.
router.get("/accounting/fisler", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const categories = await db.prisma.expenseCategory.findMany();
  const catMap = new Map(categories.map((c) => [c.id, c]));
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to) : null;
  const inRange = (d) => (!from || new Date(d) >= from) && (!to || new Date(d) <= to);

  const unitById = new Map(data.units.map((u) => [u.id, u]));
  const vendorById = new Map(data.vendors.map((v) => [v.id, v]));
  const personnelById = new Map(data.personnel.map((p) => [p.id, p]));

  const fisler = [];
  data.charges.filter((c) => inRange(c.createdAt)).forEach((c) => {
    const unit = unitById.get(c.unitId);
    fisler.push({ date: c.createdAt, code: unit?.accountingCode || null, description: `${unit ? `(${unit.block}/${unit.no})` : "-"} ${c.type} — ${c.description || ""}`, borc: c.amount, alacak: 0 });
  });
  data.payments.filter((p) => !p.cancelled && inRange(p.date)).forEach((p) => {
    const unit = unitById.get(p.unitId);
    fisler.push({ date: p.date, code: unit?.accountingCode || null, description: `${unit ? `(${unit.block}/${unit.no})` : "-"} Tahsilat — Makbuz ${p.receiptNo}`, borc: 0, alacak: p.amount });
  });
  data.partyCharges.filter((c) => inRange(c.date)).forEach((c) => {
    let party = null, label = "Genel Gider";
    if (c.partyType === "firma") { party = vendorById.get(c.partyId); label = party?.name || "-"; }
    else if (c.partyType === "personel") { party = personnelById.get(c.partyId); label = party?.name || "-"; }
    else { const cat = catMap.get(c.categoryId); if (cat) { party = cat; label = `${cat.group} / ${cat.name}`; } }
    fisler.push({ date: c.date, code: party?.accountingCode || null, description: `${label} — Fatura ${c.invoiceNo}`, borc: c.amount, alacak: 0 });
  });
  data.partyPayments.filter((p) => !p.cancelled && inRange(p.date)).forEach((p) => {
    const party = p.partyType === "firma" ? vendorById.get(p.partyId) : p.partyType === "personel" ? personnelById.get(p.partyId) : null;
    fisler.push({ date: p.date, code: party?.accountingCode || null, description: `${party?.name || "Genel Gider"} — Makbuz ${p.receiptNo}`, borc: 0, alacak: p.amount });
  });

  fisler.sort((a, b) => new Date(a.date) - new Date(b.date));
  res.json(fisler.map((f, i) => ({ fisNo: i + 1, ...f })));
});

// Yonetimcell karsilastirmasi: "Gider Grubu Raporu" - secilen firma+tarih
// araligindaki PartyCharge (firma/personel fatura) tutarlarini
// ExpenseCategory bazinda gruplar.
router.get("/reports/gider-grubu", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const categories = await db.prisma.expenseCategory.findMany();
  const catById = new Map(categories.map((c) => [c.id, c]));
  const { vendorId, startDate, endDate } = req.query;
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : null;

  // Grup anahtari kategori ADINA gore (categoryId'ye gore degil) - ayni
  // grup/kalem adiyla birden fazla ExpenseCategory kaydi olsa bile
  // (tekrarlanan seed/test verisi) rapor tek satirda toplar.
  const totals = new Map(); // "group|||name" -> amount
  data.partyCharges
    .filter((c) => !vendorId || (c.partyType === "firma" && c.partyId === vendorId))
    .filter((c) => !start || new Date(c.date) >= start)
    .filter((c) => !end || new Date(c.date) <= end)
    .forEach((c) => {
      const cat = catById.get(c.categoryId);
      const key = cat ? `${cat.group}|||${cat.name}` : "Kategorisiz|||Kategorisiz";
      totals.set(key, (totals.get(key) || 0) + c.amount);
    });

  const rows = Array.from(totals.entries()).map(([key, amount]) => {
    const [group, name] = key.split("|||");
    return { group, name, amount };
  }).sort((a, b) => a.group.localeCompare(b.group, "tr") || a.name.localeCompare(b.name, "tr"));
  const total = rows.reduce((s, r) => s + r.amount, 0);
  res.json({ rows, total });
});

// Yonetimcell karsilastirmasi: "Genel Bilanco" - tek bir tarihe KADAR
// kumulatif gelir (Charge) ve gider (PartyCharge) kategori kirilimi.
router.get("/reports/genel-bilanco", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const categories = await db.prisma.expenseCategory.findMany();
  const catById = new Map(categories.map((c) => [c.id, c]));
  const asOf = req.query.asOfDate ? new Date(new Date(req.query.asOfDate).setHours(23, 59, 59, 999)) : new Date();

  function groupBy(list) {
    const totals = new Map(); // "group|||name" -> amount, ayni ad birden fazla kategori ID'sinde olsa bile tek satir
    list.filter((x) => new Date(x.date) <= asOf).forEach((x) => {
      const cat = catById.get(x.categoryId);
      const key = cat ? `${cat.group}|||${cat.name}` : "Kategorisiz|||Kategorisiz";
      totals.set(key, (totals.get(key) || 0) + x.amount);
    });
    return Array.from(totals.entries()).map(([key, amount]) => {
      const [group, name] = key.split("|||");
      return { group, name, amount };
    }).sort((a, b) => b.amount - a.amount);
  }

  const gelirler = groupBy(data.charges);
  const giderler = groupBy(data.partyCharges);
  res.json({ gelirler, giderler, totalGelir: gelirler.reduce((s, r) => s + r.amount, 0), totalGider: giderler.reduce((s, r) => s + r.amount, 0) });
});

// Yonetimcell karsilastirmasi: "Genel Durum Raporu" (ve ayni altyapiyi
// paylasan Mizan/Ozet Durum varyantlari). Belirtilen tarih araligi icin
// Gelirler(Charge kategori bazli)/Giderler,Firmalar,Personeller(PartyCharge)/
// Kasalar 5 bolumunu Devreden/Tahakkuk Eden/Tahsil-Odenen/Kalan seklinde
// hesaplar. Devreden = donem basindan ONCEKI tahakkuk - tahsilat farki;
// bu sekilde Kalan(donem sonu) = Devreden + Tahakkuk - Tahsilat formulu
// her zaman tutarli kalir (gercek muhasebe mantigi, uydurma veri degil).
function ledgerSections(items, payments, start, end, groupKeyFn) {
  const groupOf = new Map(items.map((i) => [i.id, groupKeyFn(i)]));
  const totals = new Map();
  function bump(key, field, amount) {
    if (!totals.has(key)) totals.set(key, { devreden: 0, tahakkukEden: 0, tahsilEdilen: 0 });
    totals.get(key)[field] += amount;
  }
  items.forEach((i) => {
    const key = groupKeyFn(i);
    const created = new Date(i.createdAt);
    if (created < start) bump(key, "devreden", i.amount);
    else if (created <= end) bump(key, "tahakkukEden", i.amount);
  });
  payments.forEach((p) => {
    const pdate = new Date(p.date);
    (p.appliedTo || []).forEach((alloc) => {
      const key = groupOf.get(alloc.chargeId);
      if (!key) return;
      if (pdate < start) bump(key, "devreden", -alloc.amount);
      else if (pdate <= end) bump(key, "tahsilEdilen", alloc.amount);
    });
  });
  return Array.from(totals.entries())
    .map(([label, t]) => ({ label, ...t, kalan: t.devreden + t.tahakkukEden - t.tahsilEdilen }))
    .sort((a, b) => a.label.localeCompare(b.label, "tr"));
}
function sumRows(rows, field) { return rows.reduce((s, r) => s + r[field], 0); }

async function computeGenelDurum(start, end) {
  const data = await db.load();
  const categories = await db.prisma.expenseCategory.findMany();
  const catById = new Map(categories.map((c) => [c.id, c]));
  const TYPE_LABEL = { aidat: "Aidat", sayac: "Sayaç", gecikme_faizi: "Gecikme Faizi", diger: "Diğer" };
  const catLabel = (categoryId) => { const c = catById.get(categoryId); return c ? `${c.group} / ${c.name}` : null; };

  const vendorById = new Map(data.vendors.map((v) => [v.id, v]));
  const personnelById = new Map(data.personnel.map((p) => [p.id, p]));

  const gelirler = ledgerSections(data.charges, data.payments.filter((p) => !p.cancelled), start, end, (c) => catLabel(c.categoryId) || TYPE_LABEL[c.type] || c.type);
  const genelGiderler = data.partyCharges.filter((c) => !c.partyType);
  const firmaGiderleri = data.partyCharges.filter((c) => c.partyType === "firma");
  const personelGiderleri = data.partyCharges.filter((c) => c.partyType === "personel");
  const partyPayments = data.partyPayments.filter((p) => !p.cancelled);
  const giderler = ledgerSections(genelGiderler, partyPayments, start, end, (c) => catLabel(c.categoryId) || "Kategorisiz");
  const firmalar = ledgerSections(firmaGiderleri, partyPayments, start, end, (c) => vendorById.get(c.partyId)?.name || "Bilinmeyen Firma");
  const personeller = ledgerSections(personelGiderleri, partyPayments, start, end, (c) => personnelById.get(c.partyId)?.name || "Bilinmeyen Personel");

  const kasalar = data.accounts.map((acc) => {
    const before = (field) => data.transactions.filter((t) => t.accountId === acc.id && t.type === field && new Date(t.date) < start).reduce((s, t) => s + t.amount, 0);
    const within = (field) => data.transactions.filter((t) => t.accountId === acc.id && t.type === field && new Date(t.date) >= start && new Date(t.date) <= end).reduce((s, t) => s + t.amount, 0);
    const transfersBefore = data.transfers.filter((tr) => new Date(tr.date) < start);
    const transferIn = transfersBefore.filter((tr) => tr.toAccountId === acc.id).reduce((s, tr) => s + tr.amount, 0);
    const transferOut = transfersBefore.filter((tr) => tr.fromAccountId === acc.id).reduce((s, tr) => s + tr.amount, 0);
    const devir = acc.openingBalance + before("gelir") - before("gider") + transferIn - transferOut;
    const giren = within("gelir");
    const cikan = within("gider");
    return { label: acc.name, devir, giren, cikan, kalan: devir + giren - cikan };
  });

  return {
    gelirler: { rows: gelirler, toplam: { devreden: sumRows(gelirler, "devreden"), tahakkukEden: sumRows(gelirler, "tahakkukEden"), tahsilEdilen: sumRows(gelirler, "tahsilEdilen"), kalan: sumRows(gelirler, "kalan") } },
    giderler: { rows: giderler, toplam: { devreden: sumRows(giderler, "devreden"), tahakkukEden: sumRows(giderler, "tahakkukEden"), tahsilEdilen: sumRows(giderler, "tahsilEdilen"), kalan: sumRows(giderler, "kalan") } },
    firmalar: { rows: firmalar, toplam: { devreden: sumRows(firmalar, "devreden"), tahakkukEden: sumRows(firmalar, "tahakkukEden"), tahsilEdilen: sumRows(firmalar, "tahsilEdilen"), kalan: sumRows(firmalar, "kalan") } },
    personeller: { rows: personeller, toplam: { devreden: sumRows(personeller, "devreden"), tahakkukEden: sumRows(personeller, "tahakkukEden"), tahsilEdilen: sumRows(personeller, "tahsilEdilen"), kalan: sumRows(personeller, "kalan") } },
    kasalar: { rows: kasalar, toplam: { devir: sumRows(kasalar, "devir"), giren: sumRows(kasalar, "giren"), cikan: sumRows(kasalar, "cikan"), kalan: sumRows(kasalar, "kalan") } },
  };
}

router.get("/reports/genel-durum", requireAuth, requireRole("yonetici"), async (req, res) => {
  const start = req.query.startDate ? new Date(req.query.startDate) : new Date(0);
  const end = req.query.endDate ? new Date(new Date(req.query.endDate).setHours(23, 59, 59, 999)) : new Date();
  res.json(await computeGenelDurum(start, end));
});

// Yonetimcell karsilastirmasi: "Denetim Kurulu Raporu" + "Yonetim Faaliyet
// Raporu" - resmi sablon: mali veri Genel Durum Raporu ile AYNI hesaplamadan
// CANLI uretilir (saklanmaz), sadece idari inceleme + sonuc serbest metinleri
// ve baslik/donem OfficialReport'ta saklanir. type: "denetim" | "faaliyet".
router.get("/reports/official", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { type } = req.query;
  if (!["denetim", "faaliyet"].includes(type)) return res.status(400).json({ error: "Geçersiz rapor türü." });
  const list = await db.prisma.officialReport.findMany({ where: { type }, orderBy: { createdAt: "desc" } });
  res.json(list);
});

router.post("/reports/official", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { type, title, startDate, endDate } = req.body || {};
  if (!["denetim", "faaliyet"].includes(type)) return res.status(400).json({ error: "Geçersiz rapor türü." });
  if (!title || !startDate || !endDate) return res.status(400).json({ error: "Başlık, başlangıç ve bitiş tarihi zorunludur." });
  const report = await db.prisma.officialReport.create({ data: { type, title, startDate: new Date(startDate), endDate: new Date(endDate), createdBy: req.user.id } });
  res.status(201).json(report);
});

router.get("/reports/official/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const report = await db.prisma.officialReport.findUnique({ where: { id: req.params.id } });
  if (!report) return res.status(404).json({ error: "Rapor bulunamadı." });
  const financials = await computeGenelDurum(report.startDate, new Date(new Date(report.endDate).setHours(23, 59, 59, 999)));
  let faaliyetler = null;
  if (report.type === "faaliyet") {
    faaliyetler = await db.prisma.agendaItem.findMany({ where: { kind: "faaliyet", date: { gte: report.startDate, lte: report.endDate } }, orderBy: { date: "asc" } });
  }
  res.json({ ...report, financials, faaliyetler });
});

router.patch("/reports/official/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { adminText, resultText, title } = req.body || {};
  const data = {};
  if (adminText !== undefined) data.adminText = adminText;
  if (resultText !== undefined) data.resultText = resultText;
  if (title !== undefined) data.title = title;
  const report = await db.prisma.officialReport.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!report) return res.status(404).json({ error: "Rapor bulunamadı." });
  res.json(report);
});

router.delete("/reports/official/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await db.prisma.officialReport.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Rapor silindi." });
});

module.exports = router;
