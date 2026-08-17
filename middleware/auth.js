const jwt = require("jsonwebtoken");
const db = require("../db");
const tenantContext = require("../lib/tenantContext");

const SECRET = process.env.JWT_SECRET || "dev-secret-degistirin";

// siteId zorunlu degil (preAuthToken - coklu-site secim ekrani icin - henuz
// hicbir site secilmemis token'i temsil eder, bkz. routes/auth.js login).
function sign(user, siteId) {
  return jwt.sign(
    { id: user.id, role: user.role, unitId: user.unitId || null, name: user.name, tokenVersion: user.tokenVersion || 0, siteId: siteId || null, isPlatformOwner: !!user.isPlatformOwner },
    SECRET,
    { expiresIn: "30d" }
  );
}

// mustChangePassword=true olan bir kullanici (yonetici gecici sifre
// atadiginda veya sifre sifirlama sonrasi) sifresini degistirmeden diger
// hicbir ucu kullanamaz - eskiden bu sadece arayuzde (renderForceChangePassword)
// zorlaniyordu, dogrudan API'ye istek atan biri bunu tamamen atlayabilirdi.
const ALLOWED_WHILE_MUST_CHANGE_PASSWORD = ["/api/auth/change-password", "/api/auth/me", "/api/auth/logout-all-sessions"];

// JWT dogas geregi statelesstir; "cikis yap" tek basina sunucu tarafinda token'i
// gecersiz kilamaz. tokenVersion karsilastirmasi ile gercek bir iptal mekanizmasi
// saglariz: sifre degisince veya "tum oturumlari kapat" tetiklenince kullanicinin
// tokenVersion'i artar ve eski token'lar bu kontrolden gecemez.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Oturum bulunamadı, lütfen giriş yapın." });
  try {
    const payload = jwt.verify(token, SECRET);
    const user = await db.prisma.user.findUnique({ where: { id: payload.id } });
    if (!user) return res.status(401).json({ error: "Oturum geçersiz veya süresi dolmuş." });
    if (user.isActive === false) return res.status(403).json({ error: "Hesabınız pasife alınmış." });
    if ((payload.tokenVersion || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ error: "Oturumunuz sonlandırılmış, lütfen tekrar giriş yapın." });
    }
    if (user.mustChangePassword) {
      const path = req.originalUrl.split("?")[0];
      if (!ALLOWED_WHILE_MUST_CHANGE_PASSWORD.includes(path)) {
        return res.status(403).json({ error: "Devam etmeden önce şifrenizi değiştirmeniz gerekiyor.", mustChangePassword: true });
      }
    }
    if (!payload.siteId) {
      return res.status(401).json({ error: "Site seçimi gerekiyor, lütfen tekrar giriş yapın." });
    }
    // Erisim her istekte tekrar dogrulanir - personelin erisimi kaldirilirsa
    // 30 gunluk token'i suresi dolana kadar calismaya devam etmesin diye.
    const access = await db.prisma.userSiteAccess.findUnique({
      where: { userId_siteId: { userId: payload.id, siteId: payload.siteId } },
    });
    if (!access) return res.status(403).json({ error: "Bu siteye erişiminiz kaldırılmış." });

    req.user = payload;
    // Isteğin geri kalani (route handler + icindeki TUM Prisma cagrilari,
    // db.js'in $transaction'lari dahil) bu site baglamini miras alir -
    // bkz. lib/prismaClient.js.
    tenantContext.run(payload.siteId, () => next());
  } catch {
    return res.status(401).json({ error: "Oturum geçersiz veya süresi dolmuş." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Bu işlem için yetkiniz yok." });
    }
    next();
  };
}

// Site-bazli role'den bagimsiz, global platform-sahibi yetkisi (routes/owner.js).
function requireOwner(req, res, next) {
  if (!req.user || !req.user.isPlatformOwner) {
    return res.status(403).json({ error: "Bu işlem için platform sahibi yetkisi gerekir." });
  }
  next();
}

module.exports = { sign, requireAuth, requireRole, requireOwner, SECRET };
