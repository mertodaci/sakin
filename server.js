require("dotenv").config();
const express = require("express");
require("./middleware/asyncErrors");
const cors = require("cors");
const path = require("path");

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
const { runMaintenanceTasks } = require("./jobs");

const app = express();
app.use(cors());
app.use(express.json());

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

app.use(express.static(path.join(__dirname, "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return res.status(404).json({ error: "Uç bulunamadı." });
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Sunucu hatası." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sakin sunucu ${PORT} portunda çalışıyor: http://localhost:${PORT}`);
  // Gecikme faizi ve otomatik aylik borclandirma icin: acilista bir kez, sonra
  // her 6 saatte bir kontrol edilir (gun degisiminde islemlerin gecikmeden yapilmasi icin).
  runMaintenanceTasks().catch((err) => console.error("Bakim gorevi hatasi:", err));
  setInterval(() => runMaintenanceTasks().catch((err) => console.error("Bakim gorevi hatasi:", err)), 6 * 60 * 60 * 1000);
});
