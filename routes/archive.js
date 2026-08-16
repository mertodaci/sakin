const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { randomUUID } = require("crypto");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

// Yonetimcell karsilastirmasi: "Dosya Arsivi" - klasor bazli genel evrak
// yukleme/saklama. Gercek dosyalar yerel diskte UUID adiyla saklanir -
// kullanicinin gonderdigi orijinal dosya adi ASLA disk yolu olarak
// kullanilmaz (path traversal riski), sadece indirirken oneri adi olarak
// gosterilir (Content-Disposition, encodeURIComponent ile guvenli sekilde).
const UPLOAD_DIR = path.join(__dirname, "..", "uploads", "archive");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, randomUUID() + path.extname(file.originalname).slice(0, 10)),
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

/* ---------------- KLASORLER ---------------- */

router.get("/archive/folders", requireAuth, requireRole("yonetici"), async (req, res) => {
  const folders = await prisma.archiveFolder.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { files: true } } } });
  res.json(folders.map((f) => ({ id: f.id, name: f.name, createdAt: f.createdAt, fileCount: f._count.files })));
});

router.post("/archive/folders", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Klasör adı zorunludur." });
  const folder = await prisma.archiveFolder.create({ data: { name: name.trim(), createdBy: req.user.id } });
  res.status(201).json(folder);
});

router.patch("/archive/folders/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { name } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Klasör adı zorunludur." });
  const folder = await prisma.archiveFolder.update({ where: { id: req.params.id }, data: { name: name.trim() } }).catch(() => null);
  if (!folder) return res.status(404).json({ error: "Klasör bulunamadı." });
  res.json(folder);
});

router.delete("/archive/folders/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const files = await prisma.archiveFile.findMany({ where: { folderId: req.params.id } });
  await prisma.archiveFolder.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  files.forEach((f) => fs.rm(path.join(UPLOAD_DIR, f.storedName), { force: true }, () => {}));
  res.json({ message: "Klasör ve içindeki dosyalar silindi." });
});

/* ---------------- DOSYALAR ---------------- */

router.get("/archive/folders/:id/files", requireAuth, requireRole("yonetici"), async (req, res) => {
  const files = await prisma.archiveFile.findMany({ where: { folderId: req.params.id }, orderBy: { uploadedAt: "desc" } });
  res.json(files);
});

router.post("/archive/folders/:id/files", requireAuth, requireRole("yonetici"), upload.single("file"), async (req, res) => {
  const folder = await prisma.archiveFolder.findUnique({ where: { id: req.params.id } });
  if (!folder) {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
    return res.status(404).json({ error: "Klasör bulunamadı." });
  }
  if (!req.file) return res.status(400).json({ error: "Dosya seçilmedi." });
  const file = await prisma.archiveFile.create({
    data: {
      folderId: folder.id,
      storedName: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype || "application/octet-stream",
      size: req.file.size,
      uploadedBy: req.user.id,
    },
  });
  res.status(201).json(file);
});

router.get("/archive/files/:id/download", requireAuth, requireRole("yonetici"), async (req, res) => {
  const file = await prisma.archiveFile.findUnique({ where: { id: req.params.id } });
  if (!file) return res.status(404).json({ error: "Dosya bulunamadı." });
  const filePath = path.join(UPLOAD_DIR, file.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Dosya diskte bulunamadı." });
  res.download(filePath, file.originalName);
});

router.delete("/archive/files/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const file = await prisma.archiveFile.findUnique({ where: { id: req.params.id } });
  if (!file) return res.status(404).json({ error: "Dosya bulunamadı." });
  await prisma.archiveFile.delete({ where: { id: req.params.id } });
  fs.rm(path.join(UPLOAD_DIR, file.storedName), { force: true }, () => {});
  res.json({ message: "Dosya silindi." });
});

module.exports = router;
