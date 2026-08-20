require("dotenv").config();
const express = require("express");
require("./middleware/asyncErrors");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const db = require("./db");

const authRoutes = require("./routes/auth");
const directoryRoutes = require("./routes/directory");
const financeRoutes = require("./routes/finance");
const commsRoutes = require("./routes/comms");
const opsRoutes = require("./routes/ops");
const dashboardRoutes = require("./routes/dashboard");
const documentsRoutes = require("./routes/documents");
const systemRoutes = require("./routes/system");
const settingsRoutes = require("./routes/settings");
const contactsRoutes = require("./routes/contacts");
const { router: accountsRoutes } = require("./routes/accounts");
const partiesRoutes = require("./routes/parties");
const workspaceRoutes = require("./routes/workspace");
const legalRoutes = require("./routes/legal");
const archiveRoutes = require("./routes/archive");
const accountingRoutes = require("./routes/accounting");
const knowledgeRoutes = require("./routes/knowledge");
const helpRoutes = require("./routes/help");
const iotRoutes = require("./routes/iot");
const ownerRoutes = require("./routes/owner");
const { runMaintenanceTasks } = require("./jobs");

const app = express();
// contentSecurityPolicy kapali: uygulama build adimi olmadan public/js/app.js
// icinde birkac yerde inline onclick/onchange kullaniyor, CSP'nin varsayilan
// script-src'i bunlari sessizce engellerdi - CSP'yi acmak ayri, dikkatli bir
// denetim (tum inline handler'lari event-listener'a tasima) gerektirir.
// Diger helmet korumalari (X-Content-Type-Options, X-Frame-Options, HSTS vb.)
// aktif kaliyor.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors());
app.use(express.json());
// [:date[iso]] YONTEM YOL DURUM sure(ms) - basit ama yapilandirilmis istek
// logu (kim ne zaman hangi ucu ne kadar surede cagirdi) - onceden HICBIR
// istek logu yoktu, bir sey patladiginda hangi istegin sebep oldugunu
// anlamanin yolu yoktu.
app.use(morgan("[:date[iso]] :method :url :status :response-time ms - :res[content-length]b"));

// Orkestratorlerin/uptime izleyicilerinin kullanmasi icin: /api altinda
// DEGIL (rate limit'e takilmasin, auth gerektirmesin diye) ve gercek bir DB
// sorgusu calistirir - process ayakta ama Postgres'e ulasamiyorsa (orn.
// container coktu) bunu 503 ile yakalar, sadece "process yasiyor" degil
// "istekleri gercekten karsilayabilir mi" sorusuna cevap verir.
app.get("/health", async (req, res) => {
  try {
    await db.prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Health check basarisiz:`, err);
    res.status(503).json({ status: "error" });
  }
});

// Genel API rate limiti: auth uclarinin (login/register/forgot) kendi daha
// siki limitleri zaten var (routes/auth.js) - bu, geri kalan tum /api
// uclarini (daha once hic korumasi olmayan) kaba kuvvet/otomatik istek
// selinden koruyan genis bir tavan. Normal kullanimda (birden fazla acik
// sekme, dashboard'un periyodik yenilemesi) asilmayacak kadar cömert.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Çok fazla istek gönderildi. Lütfen daha sonra tekrar deneyin." },
});
app.use("/api", apiLimiter);

app.use("/api/auth", authRoutes);
app.use("/api", directoryRoutes);
app.use("/api", financeRoutes);
app.use("/api", commsRoutes);
app.use("/api", opsRoutes);
app.use("/api", dashboardRoutes);
app.use("/api", documentsRoutes);
app.use("/api", systemRoutes);
app.use("/api", settingsRoutes);
app.use("/api", contactsRoutes);
app.use("/api", accountsRoutes);
app.use("/api", partiesRoutes);
app.use("/api", workspaceRoutes);
app.use("/api", legalRoutes);
app.use("/api", archiveRoutes);
app.use("/api", accountingRoutes);
app.use("/api", knowledgeRoutes);
app.use("/api", helpRoutes);
app.use("/api", iotRoutes);
app.use("/api/owner", ownerRoutes);

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Uç bulunamadı." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -`, err);
  res.status(500).json({ error: "Sunucu hatası." });
});

const PORT = process.env.PORT || 3000;
// PM2 cluster modunda (bkz. ecosystem.config.js) her worker'a NODE_APP_INSTANCE
// ile 0'dan baslayan bir sira no atanir. Zamanlanmis bakim gorevini SADECE
// 0 numarali worker'da calistiriyoruz - aksi halde her worker kendi setInterval'ini
// bagimsiz calistirir, ayni gorev N kere tekrarlanir (gereksiz yuk + jobs.js'teki
// bazi kontrollerin tek transaction icinde olmasina ragmen N kat fazla sorgu).
// PM2 disinda (npm start / npm run dev, tek process) NODE_APP_INSTANCE tanimsizdir,
// bu da "sahibim" sayilir - boylece normal gelistirme akisi degismez.
const isSchedulerOwner = process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === "0";

app.listen(PORT, () => {
  console.log(`Sakin sunucu ${PORT} portunda çalışıyor: http://localhost:${PORT}`);
  if (!isSchedulerOwner) return;
  // Gecikme faizi ve otomatik aylik borclandirma icin: acilista bir kez, sonra
  // her 6 saatte bir kontrol edilir (gun degisiminde islemlerin gecikmeden yapilmasi icin).
  runMaintenanceTasks().catch((err) => console.error("Bakim gorevi hatasi:", err));
  setInterval(() => runMaintenanceTasks().catch((err) => console.error("Bakim gorevi hatasi:", err)), 6 * 60 * 60 * 1000);
});
