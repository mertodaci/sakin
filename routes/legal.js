// Yonetimcell karsilastirmasindan: "Icradaki Uyeler Listesi" ve "Icradaki
// Dosyalar Listesi" - bir dairenin/uyenin icra (yasal takip) surecinde olup
// olmadigini kaydeder. Belge sablonlari (ihtarname, genel kurul cagrisi vb.)
// routes/documents.js icinde.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

router.get("/legal-cases", requireAuth, requireRole("yonetici"), async (req, res) => {
  const cases = await prisma.legalCase.findMany({
    orderBy: { openedAt: "desc" },
    include: { unit: { select: { block: true, no: true, ownerName: true } } },
  });
  res.json(cases.map((c) => ({ ...c, unitLabel: `${c.unit.block} - Daire ${c.unit.no}`, ownerName: c.unit.ownerName, unit: undefined })));
});

router.post("/legal-cases", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { unitId, caseNumber, court, description } = req.body || {};
  if (!unitId || !caseNumber) return res.status(400).json({ error: "Daire ve dosya numarası zorunludur." });
  const legalCase = await prisma.legalCase.create({
    data: { unitId, caseNumber, court: court || "", description: description || "", createdBy: req.user.id },
  });
  res.status(201).json(legalCase);
});

router.patch("/legal-cases/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const legalCase = await prisma.legalCase.findUnique({ where: { id: req.params.id } });
  if (!legalCase) return res.status(404).json({ error: "Dosya bulunamadı." });
  const { status } = req.body || {};
  const data = {};
  if (status !== undefined) {
    data.status = status;
    data.closedAt = status === "Kapandı" ? new Date() : null;
  }
  const updated = await prisma.legalCase.update({ where: { id: legalCase.id }, data });
  res.json(updated);
});

module.exports = router;
