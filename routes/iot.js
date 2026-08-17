// Akilli Site Sistemleri (IoT) - havuz klor sensoru, aydinlatma, kamera,
// otopark bariyeri, sulama hatti kacak tespiti, jenerator, asansor.
//
// DIKKAT: su an HENUZ gercek bir cihaz/sensor entegrasyonu yok - simulateReading()
// her "Yenile" istegi geldiginde plausibl (gercekci araliktaki) rastgele bir
// olcum uretir, gercek donanima baglanmaz. Amac: yonetimin gorecegi gelecekteki
// ekranin/etkilesim modelinin (aç/kapa, canli okuma, kacak konumu) simdiden
// kurulmasi - ileride gercek bir sensor/webhook baglanacaksa sadece bu
// fonksiyonun cagrildigi yere gercek veri yazilmasi yeterli, sema/route
// yapisi degismeden kalir.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
const prisma = db.prisma;

const ACTIONABLE_TYPES = new Set(["aydinlatma", "otopark_bariyer"]);

function initialData(type) {
  if (type === "aydinlatma") return { acik: true };
  if (type === "otopark_bariyer") return { acik: false };
  return simulateReading(type, {});
}

// Gercekci araliklarda rastgele bir "okuma" uretir - tip basina farkli bir
// olcum/durum seti. Aydinlatma/bariyer burada YOK cunku onlar sadece elle
// (action) degisir, kendiliginden "okunmaz".
function simulateReading(type, prev) {
  switch (type) {
    case "havuz": {
      const klor = +(0.3 + Math.random() * 3.2).toFixed(2);
      const ph = +(6.8 + Math.random() * 1.6).toFixed(1);
      const sicaklik = +(21 + Math.random() * 9).toFixed(1);
      const klorOk = klor >= 0.5 && klor <= 3.0;
      const phOk = ph >= 7.2 && ph <= 7.8;
      return { klor, ph, sicaklik, durum: klorOk && phOk ? "ideal" : "dikkat" };
    }
    case "kamera": {
      const cevrimici = Math.random() > 0.06;
      return { cevrimici, sonHareket: cevrimici ? new Date(Date.now() - Math.random() * 3 * 3600000).toISOString() : (prev && prev.sonHareket) || null };
    }
    case "sulama": {
      const kacakVar = Math.random() < 0.12;
      const debi = +(6 + Math.random() * 6).toFixed(1);
      const hatlar = ["A", "B", "C"];
      const vana1 = Math.floor(Math.random() * 5) + 1;
      return {
        durum: kacakVar ? "kacak_supheli" : "normal",
        debi,
        tahminiKonum: kacakVar ? `${hatlar[Math.floor(Math.random() * hatlar.length)]} Hattı, ${vana1}. ve ${vana1 + 1}. vana arası` : null,
      };
    }
    case "jenerator": {
      const calisiyor = Math.random() < 0.12;
      return { durum: calisiyor ? "calisiyor" : "bekleme", yakit: Math.floor(35 + Math.random() * 65) };
    }
    case "asansor": {
      const arizali = Math.random() < 0.05;
      return { durum: arizali ? "arizali" : "normal" };
    }
    default:
      return prev || {};
  }
}

const DEFAULT_DEVICES = [
  { type: "havuz", name: "Ana Havuz", location: "Sosyal Tesis" },
  { type: "aydinlatma", name: "Bahçe Aydınlatması", location: "Genel Alan" },
  { type: "aydinlatma", name: "Otopark Aydınlatması", location: "Kapalı Otopark" },
  { type: "kamera", name: "Ana Giriş Kamerası", location: "A Blok Girişi" },
  { type: "kamera", name: "Otopark Kamerası", location: "Kapalı Otopark" },
  { type: "otopark_bariyer", name: "Otopark Bariyeri", location: "Ana Giriş" },
  { type: "sulama", name: "Bahçe Sulama Hattı A", location: "Ön Bahçe" },
  { type: "sulama", name: "Bahçe Sulama Hattı B", location: "Arka Bahçe" },
  { type: "jenerator", name: "Yedek Jeneratör", location: "Teknik Oda" },
  { type: "asansor", name: "A Blok Asansörü", location: "A Blok" },
];

// Bu site icin hic cihaz yoksa (ilk acilis), makul bir baslangic seti otomatik
// olusturulur - her yeni site kendi tenant baglaminda kendi cihazlarini alir.
router.get("/iot/devices", requireAuth, requireRole("yonetici"), async (req, res) => {
  let devices = await prisma.iotDevice.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  if (devices.length === 0) {
    await prisma.iotDevice.createMany({
      data: DEFAULT_DEVICES.map((d) => ({ ...d, data: initialData(d.type), lastReadingAt: new Date() })),
    });
    devices = await prisma.iotDevice.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] });
  }
  res.json(devices);
});

router.post("/iot/devices", requireAuth, requireRole("yonetici"), async (req, res) => {
  const { type, name, location } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: "Cihaz tipi ve adı zorunludur." });
  const device = await prisma.iotDevice.create({
    data: { type, name, location: location || null, data: initialData(type), lastReadingAt: new Date() },
  });
  res.status(201).json(device);
});

router.delete("/iot/devices/:id", requireAuth, requireRole("yonetici"), async (req, res) => {
  await prisma.iotDevice.deleteMany({ where: { id: req.params.id } });
  res.json({ message: "Cihaz kaldırıldı." });
});

// "Yenile" - yeni bir simule okuma uretir (aydinlatma/bariyer haric, onlar
// icin anlamsiz - sadece action ile degisirler).
router.post("/iot/devices/:id/simulate", requireAuth, requireRole("yonetici"), async (req, res) => {
  const device = await prisma.iotDevice.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: "Cihaz bulunamadı." });
  if (ACTIONABLE_TYPES.has(device.type)) return res.status(400).json({ error: "Bu cihaz için okuma yenileme desteklenmiyor." });
  const data = simulateReading(device.type, device.data);
  const updated = await prisma.iotDevice.update({ where: { id: device.id }, data: { data, lastReadingAt: new Date() } });
  res.json(updated);
});

// Aydinlatma ac/kapa, otopark bariyeri ac/kapa - gercek bir eyleme benzer
// sekilde denetim kaydina (activityLog) da islenir.
router.post("/iot/devices/:id/action", requireAuth, requireRole("yonetici"), async (req, res) => {
  const device = await prisma.iotDevice.findUnique({ where: { id: req.params.id } });
  if (!device) return res.status(404).json({ error: "Cihaz bulunamadı." });
  if (!ACTIONABLE_TYPES.has(device.type)) return res.status(400).json({ error: "Bu cihaz için eylem desteklenmiyor." });
  const acik = !device.data.acik;
  const updated = await prisma.iotDevice.update({ where: { id: device.id }, data: { data: { ...device.data, acik }, lastReadingAt: new Date() } });
  await prisma.activityLog.create({
    data: { actorId: req.user.id, actorName: req.user.name, action: "iot.action", detail: `${device.name} ${acik ? "açıldı" : "kapatıldı"}.` },
  });
  res.json(updated);
});

module.exports = router;
