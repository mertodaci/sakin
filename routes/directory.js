const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

function unitDebt(data, unitId) {
  return data.charges
    .filter((c) => c.unitId === unitId && c.status !== "paid")
    .reduce((sum, c) => sum + (c.amount - c.paidAmount), 0);
}

/* ---------------- UNITS (Daireler) ---------------- */

router.get("/units", requireAuth, async (req, res) => {
  const data = await db.load();
  const list = data.units.map((u) => ({ ...u, debt: unitDebt(data, u.id) }));
  res.json(list);
});

router.post("/units", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const { block, no, floor, ownerName, ownerPhone, tenantName, tenantPhone, occupancy, landShare, feeGroup } = req.body || {};
  if (!block || !no) return res.status(400).json({ error: "Blok ve daire no zorunludur." });
  const unit = { id: db.uid(), block, no, floor: floor || null, ownerName: ownerName || "", ownerPhone: ownerPhone || "", tenantName: tenantName || "", tenantPhone: tenantPhone || "", occupancy: occupancy || "owner", landShare: landShare || null, feeGroup: feeGroup || null };
  data.units.push(unit);
  db.logActivity(data, req.user, "unit.create", `${block} - Daire ${no} eklendi.`, unit.id);
  await db.save(data);
  res.status(201).json(unit);
});

router.patch("/units/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const unit = data.units.find((u) => u.id === req.params.id);
  if (!unit) return res.status(404).json({ error: "Daire bulunamadı." });
  Object.assign(unit, req.body || {});
  await db.save(data);
  res.json(unit);
});

router.delete("/units/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const inUse = data.users.some((u) => u.unitId === req.params.id);
  if (inUse) return res.status(400).json({ error: "Bu daireye bağlı kullanıcılar var, önce onları kaldırın." });
  data.units = data.units.filter((u) => u.id !== req.params.id);
  await db.save(data);
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

/* ---------------- USERS (Sakinler / Onay / Personel) ---------------- */

router.get("/users", requireAuth, requireRole("yonetici"), async (req, res) => {
  const data = await db.load();
  const list = data.users.map((u) => {
    const unit = u.unitId ? data.units.find((x) => x.id === u.unitId) : null;
    return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, unitId: u.unitId, unitLabel: unit ? `${unit.block} - Daire ${unit.no}` : null, department: u.department || null, nationalId: u.nationalId || null, isApproved: u.isApproved, isActive: u.isActive !== false, createdAt: u.createdAt, resetRequestedAt: u.resetRequestedAt || null };
  });
  res.json(list);
});

// Ad/telefon/TC kimlik no gibi temel profil alanlarini duzenler (Yonetimcell
// karsilastirmasindan: "Detayli Uye Listesi" alan seti - bu oturumda sadece
// TC kimlik no eklendi, digerleri sonraki bir oturuma birakildi).
router.patch("/users/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const { name, phone, nationalId } = req.body || {};
  const data = {};
  if (name !== undefined) data.name = name;
  if (phone !== undefined) data.phone = phone;
  if (nationalId !== undefined) data.nationalId = nationalId || null;
  const updated = await prisma.user.update({ where: { id: user.id }, data });
  res.json({ id: updated.id, name: updated.name, phone: updated.phone, nationalId: updated.nationalId });
});

/* ---------------- ARAÇ PLAKALARI ---------------- */

router.get("/users/:id/vehicles", requireAuth, requireRole("yonetici"), async (req, res) => {
  const vehicles = await prisma.vehicle.findMany({ where: { userId: req.params.id } });
  res.json(vehicles);
});

router.post("/users/:id/vehicles", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
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
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
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
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  await prisma.user.update({ where: { id: user.id }, data: { isApproved: true } });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.approve", detail: `${user.name} kaydı onaylandı.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Kullanıcı onaylandı." });
});

// Sakini/personeli KALICI OLARAK SILMEDEN pasife alir - gecmis odeme/talep kayitlari
// korunur, ancak giris yapamaz hale gelir. Tasinan sakinler icin dogru yontem budur.
router.patch("/users/:id/deactivate", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Kendi hesabınızı pasife alamazsınız." });
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false, tokenVersion: { increment: 1 } } });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.deactivate", detail: `${user.name} pasife alındı.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Kullanıcı pasife alındı." });
});

router.patch("/users/:id/reactivate", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  await prisma.user.update({ where: { id: user.id }, data: { isActive: true } });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.reactivate", detail: `${user.name} yeniden aktif edildi.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Kullanıcı yeniden aktif edildi." });
});

// Gecici sifre uretir (sifremi unuttum akisinin yonetici tarafi). Sifre sadece bu
// yanitta bir kere gorunur - yonetici bunu kullaniciya sozlu/mesaj yoluyla iletir.
// Sifre politikasina uygun (harf+rakam+8 karakter) bir gecici sifre uretilir.
router.post("/users/:id/reset-password", requireAuth, requireRole("yonetici"), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  const tempPassword = Math.random().toString(36).slice(-5) + Math.floor(10 + Math.random() * 89) + "A";
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: bcrypt.hashSync(tempPassword, 10), mustChangePassword: true, resetRequestedAt: null, tokenVersion: { increment: 1 }, failedLoginAttempts: 0, lockedUntil: null },
  });
  await prisma.activityLog.create({ data: { actorId: req.user.id, actorName: req.user.name, action: "user.reset-password", detail: `${user.name} için geçici şifre oluşturuldu.`, scopeUnitId: user.unitId || null } });
  res.json({ message: "Geçici şifre oluşturuldu. Bu şifreyi güvenli bir şekilde kullanıcıya iletin.", tempPassword });
});

router.delete("/users/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Kendi hesabınızı silemezsiniz." });
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
  await prisma.user.delete({ where: { id: req.params.id } });
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
  await prisma.personnel.create({ data: { id: user.id, name, phone: phone || "", department: department || "Genel", active: true, userId: user.id } });
  res.status(201).json({ message: "Personel hesabı oluşturuldu." });
});

module.exports = router;
