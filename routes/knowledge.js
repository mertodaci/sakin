const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

// Yonetimcell karsilastirmasi: Hukuki menusu altindaki "Bilgi Bankasi" -
// kategorize edilmis (Bilgi Bankasi/Ornek Yazismalar/Yonetmelikler),
// aranabilir bir yardim makaleleri kutuphanesi. Okuma tum roller icin acik
// (sakin de faydalanir), yazma sadece yonetici.

router.get("/knowledge-articles", requireAuth, async (req, res) => {
  const { category, search } = req.query;
  const where = {};
  if (category) where.category = category;
  if (search) where.OR = [{ title: { contains: search, mode: "insensitive" } }, { content: { contains: search, mode: "insensitive" } }];
  const articles = await prisma.knowledgeArticle.findMany({ where, orderBy: [{ category: "asc" }, { title: "asc" }] });
  res.json(articles);
});

router.post("/knowledge-articles", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { category, title, content } = req.body || {};
  if (!category || !title || !content) return res.status(400).json({ error: "Kategori, başlık ve içerik zorunludur." });
  const article = await prisma.knowledgeArticle.create({ data: { category, title, content, createdBy: req.user.id } });
  res.status(201).json(article);
});

router.patch("/knowledge-articles/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { category, title, content } = req.body || {};
  const data = { updatedAt: new Date() };
  if (category !== undefined) data.category = category;
  if (title !== undefined) data.title = title;
  if (content !== undefined) data.content = content;
  const article = await prisma.knowledgeArticle.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!article) return res.status(404).json({ error: "Makale bulunamadı." });
  res.json(article);
});

router.delete("/knowledge-articles/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.knowledgeArticle.delete({ where: { id: req.params.id } }).catch((e) => {
    if (e.code !== "P2025") throw e;
  });
  res.json({ message: "Makale silindi." });
});

module.exports = router;
