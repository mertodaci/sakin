const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

// Net bakiye hesabi db.js'te paylasilan tek yerde (db.netDebt) - burada,
// dashboard.js, documents.js ve comms.js hepsi ayni fonksiyonu kullanir.
const unitDebt = db.netDebt;

// User modeli BILEREK global (coklu-siteli personelin tek giris kimligi
// olmasi icin, bkz. lib/tenantScope.js) - yani prisma.user.findUnique({where:{id}})
// TEK BASINA hicbir site kontrolu yapmaz. Asagidaki /users/:id... uclarinin
// hepsi, hedef kullanicinin GERCEKTEN caginin sitesine (UserSiteAccess)
// uye oldugunu burada ELLE dogrular - aksi halde herhangi bir yonetici, id'sini
// bilerek/tahmin ederek BASKA bir sitenin kullanicisini onaylayabilir,
// pasife alabilir, sifresini sifirlayabilir hatta silebilirdi.
async function findSiteUser(userId, siteId) {
  const access = await prisma.userSiteAccess.findUnique({ where: { userId_siteId: { userId, siteId } } });
  if (!access) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

/* ---------------- UNITS (Daireler) ---------------- */

router.get("/units", requireAuth, async (req, res) => {
  const data = await db.load();
  const list = data.units.map((u) => ({ ...u, debt: unitDebt(data, u.id) }));
  res.json(list);
});

// Yonetimcell karsilastirmasi: Tahsilat Ekrani'nda ayni kisi birden fazla
// tasinmaza sahipse hepsini tek ekranda gostermek icin - malik ayri bir
// User/Malik tablosu olarak modellenmedigi icin (Unit.ownerName/ownerPhone
// serbest metin), "ayni kisi" eslestirmesi isim/telefon uzerinden yapilir.
router.get("/units/:id/related", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const unit = data.units.find((u) => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  const name = (unit.ownerName || "").trim().toLowerCase();
  const phone = (unit.ownerPhone || "").trim();
  const related = data.units.filter((u) => {
    if (u.id === unit.id) return false;
    if (name && (u.ownerName || "").trim().toLowerCase() === name) return true;
    if (phone && (u.ownerPhone || "").trim() === phone) return true;
    return false;
  });
  res.json(related.map((u) => ({ ...u, debt: unitDebt(data, u.id) })));
});

router.post("/units", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { block, no, floor, ownerName, ownerPhone, tenantName, tenantPhone, occupancy, landShare, squareMeters, feeGroup } = req.body || {};
  if (!block || !no) return res.status(400).json({ error: "Blok ve daire no zorunludur." });
  // floor semada zorunlu (Int, nullable degil) - deger verilmezse 0 varsayilir.
  const unit = { id: db.uid(), block, no, floor: floor ? Number(floor) : 0, ownerName: ownerName || "", ownerPhone: ownerPhone || "", tenantName: tenantName || "", tenantPhone: tenantPhone || "", occupancy: occupancy || "owner", landShare: landShare || null, squareMeters: squareMeters || null, feeGroup: feeGroup || null };
  data.units.push(unit);
  db.logActivity(data, req.user, "unit.create", `${block} - Daire ${no} eklendi.`, unit.id);
  await db.save(data, ["units"]);
  res.status(201).json(unit);
});

router.patch("/units/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const unit = data.units.find((u) => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  Object.assign(unit, req.body || {});
  await db.save(data, ["units"]);
  res.json(unit);
});

// Postgres'te Charge/Payment/Reservation/Ticket/Meter/Package.unitId hepsi
// onDelete:Restrict - eskiden (JSON) bu kayitlar kontrol edilmeden silme
// sessizce basariyordu, artik ilk baglı kayitta Postgres FK hatasi (500,
// anlamsiz "Sunucu hatasi" mesaji) firlatirdi. Silmeden once hepsini
// kontrol edip dostane bir Turkce hata donuyoruz.
router.delete("/units/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const inUse = data.users.some((u) => u.unitId === req.params.id);
  if (inUse) return res.status(400).json({ error: "Bu daireye bağlı kullanıcılar var, önce onları kaldırın." });

  const [chargeCount, paymentCount, reservationCount, ticketCount, meterCount, packageCount] = await Promise.all([
    prisma.charge.count({ where: { unitId: req.params.id } }),
    prisma.payment.count({ where: { unitId: req.params.id } }),
    prisma.reservation.count({ where: { unitId: req.params.id } }),
    prisma.ticket.count({ where: { unitId: req.params.id } }),
    prisma.meter.count({ where: { unitId: req.params.id } }),
    prisma.package.count({ where: { unitId: req.params.id } }),
  ]);
  if (chargeCount || paymentCount || reservationCount || ticketCount || meterCount || packageCount) {
    return res.status(400).json({ error: "Bu daireye bağlı borç/ödeme/rezervasyon/talep/sayaç/kargo kayıtları var, silinemez." });
  }

  data.units = data.units.filter((u) => u.id !== req.params.id);
  await db.save(data, ["units"]);
  res.json({ message: "Daire silindi." });
});

/* ---------------- İKAMET EDENLER (Yakınlık Derecesiyle) ---------------- */
// Yonetimcell karsilastirmasindan: bir dairede malik disinda fiilen kim
// yasiyor sorusunu yakinlik derecesiyle cevaplar. isCurrent=false olanlar
// "eski sakin" gecmisi olarak korunur, silinmez.

router.get("/units/:id/household", requireAuth, requireRole("yonetici"), async (req, res) => {
  const members = await prisma.householdMember.findMany({ where: { unitId: req.params.id }, orderBy: { movedInAt: "desc" } });
  res.json(members);
});

router.post("/units/:id/household", requireAuth, requireRole("yonetici"), async (req, res) => {
  const unit = await prisma.unit.findUnique({ where: { id: req.params.id } });
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  const { name, relationship, phone } = req.body || {};
  if (!name || !relationship) return res.status(400).json({ error: "Ad ve yakınlık derecesi zorunludur." });
  const member = await prisma.householdMember.create({ data: { unitId: unit.id, name, relationship, phone: phone || "" } });
  res.status(201).json(member);
});

// "Tasindi" isaretler - kaydi silmez, isCurrent=false + movedOutAt ile gecmise tasir.
router.patch("/household/:id/move-out", requireAuth, requireRole("yonetici"), async (req, res) => {
  const updated = await prisma.householdMember.updateMany({ where: { id: req.params.id }, data: { isCurrent: false, movedOutAt: new Date() } });
  if (!updated.count) return res.status(404).json({ error: "Kayıt bulunamadı." });
  res.json({ message: "Sakin geçmişe taşındı." });
});

router.delete("/household/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.householdMember.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Kayıt silindi." });
});

// Yonetimcell karsilastirmasi: "Uyeler > Uye Listesi Secenekleri > Ikamet
// Edenler Listesi" - tum siteyi tek, aranabilir tabloda gosterir (malik/kiraci
// kendisi + guncel HouseholdMember kayitlari). Bos daireler listelenmez.
router.get("/reports/ikamet-edenler", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const members = await prisma.householdMember.findMany({ where: { isCurrent: true }, orderBy: { name: "asc" } });
  const membersByUnit = members.reduce((acc, m) => {
    (acc[m.unitId] = acc[m.unitId] || []).push(m);
    return acc;
  }, {});
  const rows = [];
  for (const u of data.units) {
    if (u.occupancy === "vacant") continue;
    const sifat = u.occupancy === "tenant" ? "Kiracı" : "Malik";
    const primaryName = u.occupancy === "tenant" ? u.tenantName : u.ownerName;
    const primaryPhone = u.occupancy === "tenant" ? u.tenantPhone : u.ownerPhone;
    if (primaryName) rows.push({ block: u.block, no: u.no, sifat, relationship: "Kendisi", name: primaryName, phone: primaryPhone || "" });
    for (const m of membersByUnit[u.id] || []) {
      rows.push({ block: u.block, no: u.no, sifat, relationship: m.relationship, name: m.name, phone: m.phone || "" });
    }
  }
  rows.sort((a, b) => a.block.localeCompare(b.block, "tr") || a.no.localeCompare(b.no, "tr", { numeric: true }));
  res.json(rows);
});

// Yonetimcell karsilastirmasi: "Bos/Dolu Tasinmaz Listesi" - her tasinmazin
// doluluk durumu (bos/malik oturuyor/kiraci oturuyor) tek tabloda, bakiyesiyle.
router.get("/reports/bos-dolu-tasinmaz", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const rows = data.units
    .map((u) => ({
      block: u.block,
      no: u.no,
      durum: u.occupancy === "vacant" ? "Boş" : "Dolu",
      malik: u.ownerName || "",
      kiraci: u.occupancy === "tenant" ? u.tenantName || "" : "",
      debt: unitDebt(data, u.id),
    }))
    .sort((a, b) => a.block.localeCompare(b.block, "tr") || a.no.localeCompare(b.no, "tr", { numeric: true }));
  res.json(rows);
});

// Yonetimcell karsilastirmasi: "Tc Kimlik Numarasi Listesi" - hesabi olan
// (giris yapabilen) sakinlerin TC kimlik no'larini tek tabloda gosterir.
// Hesabi olmayan eski/kayitsiz sakinlerin TC no'su sistemde tutulmuyor.
router.get("/reports/tc-kimlik-listesi", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const rows = data.users
    .filter((u) => u.role === "sakin" && u.unitId)
    .map((u) => {
      const unit = data.units.find((x) => x.id === u.unitId);
      if (!unit) return null;
      return { block: unit.block, no: unit.no, durum: unit.occupancy === "tenant" ? "Kiracı" : "Malik", name: u.name, nationalId: u.nationalId || "" };
    })
    .filter(Boolean)
    .sort((a, b) => a.block.localeCompare(b.block, "tr") || a.no.localeCompare(b.no, "tr", { numeric: true }));
  res.json(rows);
});

// Yonetimcell karsilastirmasi: "Arac Plaka Listesi" - Vehicle modelinin
// (mevcut, task #6) tum siteyi kapsayan filtrelenebilir liste gorunumu.
router.get("/reports/arac-plaka-listesi", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const data = await db.load();
  const vehicles = await prisma.vehicle.findMany({ orderBy: { plate: "asc" } });
  const rows = [];
  for (const v of vehicles) {
    const u = data.users.find((x) => x.id === v.userId);
    if (!u) continue;
    const unit = u.unitId ? data.units.find((x) => x.id === u.unitId) : null;
    rows.push({ block: unit ? unit.block : "", no: unit ? unit.no : "", durum: unit && unit.occupancy === "tenant" ? "Kiracı" : "Malik", name: u.name, phone: u.phone || "", plate: v.plate, brand: v.brand || "", color: v.color || "" });
  }
  rows.sort((a, b) => a.block.localeCompare(b.block, "tr") || a.no.localeCompare(b.no, "tr", { numeric: true }));
  res.json(rows);
});

/* ---------------- USERS (Sakinler / Onay / Personel) ---------------- */

router.get("/users", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const list = data.users.map((u) => {
    const unit = u.unitId ? data.units.find((x) => x.id === u.unitId) : null;
    return { id: u.id, name: u.name, email: u.email, email2: u.email2 || null, phone: u.phone, phone2: u.phone2 || null, role: u.role, unitId: u.unitId, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null, department: u.department || null, nationalId: u.nationalId || null, isApproved: u.isApproved, isActive: u.isActive !== false, createdAt: u.createdAt, resetRequestedAt: u.resetRequestedAt || null, gender: u.gender || null, birthDate: u.birthDate || null, bloodType: u.bloodType || null, sector: u.sector || null, workplace: u.workplace || null, workAddress: u.workAddress || null, homeAddress: u.homeAddress || null };
  });
  res.json(list);
});

// Ad/telefon/TC kimlik no gibi temel profil alanlarini duzenler (Yonetimcell
// karsilastirmasindan: "Detayli Uye Listesi" alan seti).
router.patch("/users/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const { name, phone, phone2, email2, nationalId, gender, birthDate, bloodType, sector, workplace, workAddress, homeAddress } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (phone2 !== undefined) data.phone2 = phone2 || null;
  if (email2 !== undefined) data.email2 = email2 || null;
  if (nationalId !== undefined) data.nationalId = nationalId || null;
  if (gender !== undefined) data.gender = gender || null;
  if (birthDate !== undefined) data.birthDate = birthDate ? new Date(birthDate) : null;
  if (bloodType !== undefined) data.bloodType = bloodType || null;
  if (sector !== undefined) data.sector = sector || null;
  if (workplace !== undefined) data.workplace = workplace || null;
  if (workAddress !== undefined) data.workAddress = workAddress || null;
  if (homeAddress !== undefined) data.homeAddress = homeAddress || null;
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  const { passwordHash, tokenVersion, failedLoginAttempts, lockedUntil, ...safe } = updated;
  res.json(safe);
});

/* ---------------- ARAÇ PLAKALARI ---------------- */

router.get("/users/:id/vehicles", requireAuth, requireRole("yonetici"), async (req, res) => {
  const vehicles = await prisma.vehicle.findMany({ where: { userId: req.params.id } });
  res.json(vehicles);
});

router.post("/users/:id/vehicles", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const { plate, brand, color } = req.body || {};
  if (!plate) return res.status(400).json({ error: "Plaka zorunludur." });
  const vehicle = await prisma.vehicle.create({ data: { userId: user.id, plate, brand: brand || "", color: color || "" } });
  res.status(201).json(vehicle);
});

router.delete("/vehicles/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.vehicle.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Plaka kaydı silindi." });
});

/* ---------------- ÜYE NOTLARI (CRM Tarzı Serbest Not) ---------------- */

router.get("/users/:id/notes", requireAuth, requireRole("yonetici"), async (req, res) => {
  const notes = await prisma.userNote.findMany({ where: { userId: req.params.id }, orderBy: { createdAt: "desc" } });
  res.json(notes);
});

router.post("/users/:id/notes", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Not metni zorunludur." });
  const note = await prisma.userNote.create({ data: { userId: user.id, authorId: req.user.id, text } });
  res.status(201).json(note);
});

router.delete("/notes/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.userNote.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Not silindi." });
});

router.patch("/users/:id/approve", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  await prisma.user.update({ where: { id: user.id }, data: { isApproved: true } });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.approve", detail: `${user.name} kaydı onaylandı.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Kullanıcı onaylandı." });
});

// Sakini/personeli KALICI OLARAK SILMEDEN pasife alir - gecmis odeme/talep kayitlari
// korunur, ancak giris yapamaz hale gelir. Tasinan sakinler icin dogru yontem budur.
router.patch("/users/:id/deactivate", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Kendi hesabınızı pasife alamazsınız." });
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false, tokenVersion: { increment: 1 } } });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.deactivate", detail: `${user.name} pasife alındı.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Kullanıcı pasife alındı." });
});

router.patch("/users/:id/reactivate", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.reactivate", detail: `${user.name} yeniden aktif edildi.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Kullanıcı yeniden aktif edildi." });
});

// Gecici sifre uretir (sifremi unuttum akisinin yonetici tarafi). Sifre sadece bu
// yanitta bir kere gorunur - yonetici bunu kullaniciya sozlu/mesaj yoluyla iletir.
// Sifre politikasina uygun (harf+rakam+8 karakter) bir gecici sifre uretilir.
router.post("/users/:id/reset-password", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const tempPassword = Math.random().toString(36).slice(-5) + Math.floor(10 + Math.random() * 89) + "A";
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: bcrypt.hashSync(tempPassword, 10), mustChangePassword: true, resetRequestedAt: null, tokenVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null },
  });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.reset-password", detail: `${user.name} için geçici şifre oluşturuldu.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Geçici şifre oluşturuldu. Bu şifreyi güvenli bir şekilde kullanıcıya iletin.", tempPassword });
});

// Reservation/Ticket/TicketComment/Classifieds.userId hepsi onDelete:Restrict
// - bagli kayit varsa once dostane hata donuyoruz (aksi halde Postgres FK
// hatasi 500 olarak cikardi). "personel" rolundeki bir kullanici siliniyorsa,
// bagli Personnel kaydi da (Ticket.assignedPersonnelId/Equipment.
// responsiblePersonnelId uzerinden hala atanmis is yoksa) birlikte silinir -
// aksi halde Personnel.userId SetNull olur ama kayit yetim kalir, atamalar
// "hayalet" bir personele bagli gibi gorunmeye devam eder.
router.delete("/users/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Kendi hesabınızı silemezsiniz." });
  const user = await findSiteUser(req.params.id, req.user.siteId);
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });

  const [reservationCount, ticketCount, commentCount, classifiedCount] = await Promise.all([
    prisma.reservation.count({ where: { userId: req.params.id } }),
    prisma.ticket.count({ where: { userId: req.params.id } }),
    prisma.ticketComment.count({ where: { userId: req.params.id } }),
    prisma.classifieds.count({ where: { userId: req.params.id } }),
  ]);
  if (reservationCount || ticketCount || commentCount || classifiedCount) {
    return res.status(400).json({ error: "Bu kullanıcıya bağlı rezervasyon/talep/yorum/ilan kayıtları var, silinemez. Bunun yerine \"Pasife Al\" kullanın." });
  }

  const personnel = await prisma.personnel.findUnique({ where: { userId: req.params.id } });
  if (personnel) {
    const [assignedTickets, assignedEquipment] = await Promise.all([
      prisma.ticket.count({ where: { assignedPersonnelId: personnel.id } }),
      prisma.equipment.count({ where: { responsiblePersonnelId: personnel.id } }),
    ]);
    if (assignedTickets || assignedEquipment) {
      return res.status(400).json({ error: "Bu personele atanmış talep/demirbaş kayıtları var, önce başka bir personele aktarın." });
    }
  }

  await prisma.$transaction(async (tx) => {
    if (personnel) await tx.personnel.delete({ where: { id: personnel.id } });
    await tx.user.delete({ where: { id: req.params.id } });
  });
  res.json({ message: "Kullanıcı silindi." });
});

// Yonetici tarafindan dogrudan personel hesabi olusturma
router.post("/users/personnel", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name, email, phone, password, department } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Ad, e-posta ve şifre zorunludur." });
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (existing) {
    return res.status(409).json({ error: "Bu e-posta ile zaten bir hesap var." });
  }
  const user = await prisma.user.create({
    data: { name, email, phone: phone || "", passwordHash: bcrypt.hashSync(password, 10), role: "personel", department: department || "Genel", isApproved: true },
  });
  // User global (siteId'siz) oldugu icin UserSiteAccess satiri ELLE eklenmezse
  // bu personel hicbir siteye erisemez, giris yapamaz (login'in accessibleSites'i
  // 0 doner) - digger kullanici olusturma yollarinda (register, owner.js) zaten
  // yapilan bu adim burada eksikti.
  await prisma.userSiteAccess.create({ data: { userId: user.id, siteId: req.user.siteId } });
  await prisma.personnel.create({ data: { id: user.id, name, phone: phone || "", department: department || "Genel", active: true, userId: user.id } });
  res.status(201).json({ message: "Personel hesabı oluşturuldu." });
});

// Yonetimcell karsilastirmasi: "Detaylı Üye Listesi Dökümü" - taşınmaz +
// üye bilgilerini tek genis satirda birlestirir, hangi sutunlarin
// gosterilecegine frontend'te checkbox'larla karar verilir (esnek dokum).
router.get("/reports/detayli-uye-listesi", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const meters = await prisma.meter.findMany();
  const metersByUnit = meters.reduce((acc, m) => { (acc[m.unitId] = acc[m.unitId] || []).push(m); return acc; }, {});

  const rows = data.users
    .filter((u) => u.role === "sakin" && u.unitId)
    .map((u) => {
      const unit = data.units.find((x) => x.id === u.unitId);
      if (!unit) return null;
      const unitMeters = metersByUnit[unit.id] || [];
      const meterOf = (type) => unitMeters.find((m) => m.type === type)?.serialNo || "";
      return {
        block: unit.block, no: unit.no, feeGroup: unit.feeGroup || "", floor: unit.floor,
        squareMeters: unit.squareMeters || null, landShare: unit.landShare || null,
        yakitSayacNo: meterOf("yakit") || meterOf("dogalgaz"), sicakSuSayacNo: meterOf("sicak_su"), sogukSuSayacNo: meterOf("soguk_su") || meterOf("su"), elektrikSayacNo: meterOf("elektrik"),
        gender: u.gender || "", name: u.name, birthDate: u.birthDate || null, bloodType: u.bloodType || "",
        nationalId: u.nationalId || "", phone: u.phone || "", phone2: u.phone2 || "", email: u.email || "", email2: u.email2 || "",
        sector: u.sector || "", workplace: u.workplace || "", workAddress: u.workAddress || "", homeAddress: u.homeAddress || "",
        durum: unit.occupancy === "tenant" ? "Kiracı" : "Malik",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.block.localeCompare(b.block, "tr") || a.no.localeCompare(b.no, "tr", { numeric: true }));
  res.json(rows);
});

module.exports = router;
