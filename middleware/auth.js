const jwt = require("jsonwebtoken");
const db = require("../db");

const SECRET = process.env.JWT_SECRET || "dev-secret-degistirin";

function sign(user) {
  return jwt.sign({ id: user.id, role: user.role, unitId: user.unitId || null, name: user.name, tokenVersion: user.tokenVersion || 0 }, SECRET, { expiresIn: "30d" });
}

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
    req.user = payload;
    next();
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

module.exports = { sign, requireAuth, requireRole, SECRET };
