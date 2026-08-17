// Sifre politikasi: en az 8 karakter, en az bir harf ve bir rakam icermeli.
// routes/auth.js (kayit/sifre degisimi) ve routes/owner.js (site yoneticisi
// gecici sifresi) tarafindan paylasilir.
function validatePassword(pw) {
  if (!pw || pw.length < 8) return "Şifre en az 8 karakter olmalıdır.";
  if (!/[A-Za-zÇĞİÖŞÜçğıöşü]/.test(pw)) return "Şifre en az bir harf içermelidir.";
  if (!/[0-9]/.test(pw)) return "Şifre en az bir rakam içermelidir.";
  return null;
}

module.exports = { validatePassword };
