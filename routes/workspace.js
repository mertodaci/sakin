// Yonetimin ic calisma alani: Ajanda (not/faaliyet), Is Takibi (dahili
// gorevler), Gelen Mesajlar (sakin-yonetici iki yonlu). Yonetimcell
// karsilastirmasindan cikan, sakin taleplerinden (Ticket) ayri modul.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

/* ---------------- AJANDA (Notlar / Faaliyetler) ---------------- */

router.get("/agenda", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const { kind, date } = req.query;
  const where = {};
  if (kind === "not" || kind === "faaliyet") where.kind = kind;
  if (date) {
    const day = new Date(date);
    const nextDay = new Date(day.getTime() + 86400000);
    where.date = { gte: day, lt: nextDay };
  }
  const items = await prisma.agendaItem.findMany({ where, orderBy: { date: "desc" }, include: { author: { select: { name: true } } } });
  res.json(items.map((i) => ({ ...i, authorName: i.author.name, author: undefined })));
});

router.post("/agenda", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const { kind, date, text } = req.body || {};
  if (!text || (kind !== "not" && kind !== "faaliyet")) return res.status(400).json({ error: "Metin ve tür (not/faaliyet) zorunludur." });
  const item = await prisma.agendaItem.create({ data: { kind, date: date ? new Date(date) : new Date(), text, authorId: req.user.id } });
  res.status(201).json(item);
});

router.patch("/agenda/:id", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const item = await prisma.agendaItem.findUnique({ where: { id: req.params.id } });
  if (!item) return res.status(404).json({ error: "Kayıt bulunamadı." });
  const { text, done } = req.body || {};
  const data = {};
  if (text !== undefined) data.text = text;
  if (done !== undefined) data.done = !!done;
  const updated = await prisma.agendaItem.update({ where: { id: item.id }, data });
  res.json(updated);
});

router.delete("/agenda/:id", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  await prisma.agendaItem.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Kayıt silindi." });
});

/* ---------------- IS TAKIBI (Dahili Gorevler) ---------------- */

router.get("/internal-tasks", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const where = {};
  if (req.user.role === "personel") {
    const personnel = await prisma.personnel.findUnique({ where: { userId: req.user.id } });
    if (personnel) where.assignedPersonnelId = personnel.id;
  }
  const tasks = await prisma.internalTask.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { assignedPersonnel: { select: { name: true } }, unit: { select: { block: true, no: true } } },
  });
  res.json(tasks.map((t) => ({
    ...t,
    assignedName: t.assignedPersonnel?.name || null,
    unitLabel: t.unit ? `${t.unit.block} - Daire ${t.unit.no}` : null,
    assignedPersonnel: undefined,
    unit: undefined,
  })));
});

router.post("/internal-tasks", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { title, description, area, type, assignedPersonnelId, unitId, dueDate } = req.body || {};
  if (!title) return res.status(400).json({ error: "Başlık zorunludur." });
  const task = await prisma.internalTask.create({
    data: {
      title,
      description: description || "",
      area: area || "Genel",
      type: type || "Diğer",
      assignedPersonnelId: assignedPersonnelId || null,
      unitId: unitId || null,
      dueDate: dueDate ? new Date(dueDate) : null,
      createdBy: req.user.id,
    },
  });
  res.status(201).json(task);
});

router.patch("/internal-tasks/:id", requireAuth, requireRole("yonetici", "personel"), async (req, res) => {
  const task = await prisma.internalTask.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ error: "İş bulunamadı." });
  const { status, assignedPersonnelId, dueDate } = req.body || {};
  const data = { updatedAt: new Date() };
  if (status !== undefined) data.status = status;
  if (req.user.role === "yonetici") {
    if (assignedPersonnelId !== undefined) data.assignedPersonnelId = assignedPersonnelId || null;
    if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;
  }
  const updated = await prisma.internalTask.update({ where: { id: task.id }, data });
  res.json(updated);
});

/* ---------------- GELEN MESAJLAR ---------------- */

// Sakin: kendi gonderdigi + kendisine (veya genel olarak yonetime, recipientId
// null olup kendi gonderdigi) mesajlari gorur. Yonetici: tum mesaj trafigini gorur.
router.get("/messages", requireAuth, requireRole("yonetici", "sakin"), async (req, res) => {
  const where = req.user.role === "sakin" ? { senderId: req.user.id } : {};
  const messages = await prisma.message.findMany({
    where,
    orderBy: { date: "desc" },
    include: { sender: { select: { name: true, unitId: true, unit: { select: { block: true, no: true } } } } },
  });
  res.json(messages.map((m) => ({
    id: m.id,
    senderId: m.senderId,
    senderName: m.sender.name,
    senderUnitLabel: m.sender.unit ? `${m.sender.unit.block} - Daire ${m.sender.unit.no}` : null,
    recipientId: m.recipientId,
    body: m.body,
    date: m.date,
    read: m.read,
  })));
});

router.post("/messages", requireAuth, requireRole("yonetici", "sakin"), async (req, res) => {
  const { body, recipientId } = req.body || {};
  if (!body) return res.status(400).json({ error: "Mesaj metni zorunludur." });
  const finalRecipientId = req.user.role === "yonetici" ? recipientId || null : null;
  const message = await prisma.message.create({
    data: { senderId: req.user.id, recipientId: finalRecipientId, body },
  });
  if (req.user.role === "sakin") {
    await prisma.notification.create({ data: { userId: "admin1", message: `${req.user.name} size bir mesaj gönderdi.`, link: "#/mesajlar" } });
  } else if (finalRecipientId) {
    await prisma.notification.create({ data: { userId: finalRecipientId, message: "Yönetimden yeni bir mesajınız var.", link: "#/mesajlar" } });
  }
  res.status(201).json(message);
});

router.patch("/messages/:id/read", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.message.updateMany({ where: { id: req.params.id }, data: { read: true } });
  res.json({ message: "Okundu olarak işaretlendi." });
});

module.exports = router;
