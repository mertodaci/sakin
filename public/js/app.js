/* ==========================================================
   SAKİN — Site/Apartman Yönetim Uygulaması (frontend)
   Vanilla JS, build adımı gerektirmez. Backend REST API'sini
   /api altından tüketir.
   ========================================================== */

const API_BASE = "/api";
let state = { token: localStorage.getItem("sakin_token") || null, user: null, tab: "ozet" };
let authMode = "login";

/* ---------------- API helper ---------------- */
async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  const res = await fetch(API_BASE + path, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || "Bir hata oluştu.");
  return data;
}

/* ---------------- Formatters / helpers ---------------- */
function tl(n) { return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(n || 0); }
function dt(d) { return d ? new Date(d).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" }) : "-"; }
function esc(s) { const d = document.createElement("div"); d.textContent = s ?? ""; return d.innerHTML; }
function sectionTitle(title, sub) { return `<div class="section-title"><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`; }
function ledgerRow(title, sub, right, color) {
  return `<div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${title}</div><div class="small muted">${sub}</div></div><div class="f-num" style="font-size:14px;font-weight:600;${color ? `color:${color};` : ""}">${right}</div></div>`;
}
const PILL_MAP = { "Ödendi": "green", "Borçlu": "red", "Alacaklı": "green", "Açık": "red", "Kısmi": "amber", "İşlemde": "amber", "Çözüldü": "green", "Onaylandı": "green", "depoda": "grey", "zimmetli": "amber", "Teslim Alındı": "amber", "Teslim Edildi": "green", "Güncel": "green", "Bakım Gecikti": "red", "Pasif": "grey", "Aktif": "green", "Boş": "amber" };
// Net bakiye (borc - alacakli bakiye) uc durumlu: pozitif=borclu (kirmizi),
// negatif=alacakli (yesil), sifir=odendi (yesil).
function debtStatusLabel(debt) { return debt > 0 ? "Borçlu" : debt < 0 ? "Alacaklı" : "Ödendi"; }
function debtColor(debt) { return debt > 0 ? "var(--red)" : "var(--green)"; }
// type artik serbest metin (sabit enum degil) - bilinen 4 tip icin daha
// once kullanilan Turkce etiketler korunur, baska bir kategori girilmisse
// (orn. "Idari Ceza") oldugu gibi gosterilir.
const CHARGE_TYPE_LABELS = { aidat: "Aidat", sayac: "Sayaç", gecikme_faizi: "⚠ Gecikme Faizi", diger: "Diğer" };
function chargeTypeLabel(ch) { return CHARGE_TYPE_LABELS[ch.type] || ch.type; }
function pill(status) { const cls = PILL_MAP[status] || "grey"; return `<span class="pill ${cls}"><span class="dot"></span>${esc(status)}</span>`; }
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

// Auth header gerektiren dosya indirmeleri (PDF/JSON) icin: fetch + blob + gecici indirme linki
async function downloadFile(path, fallbackName) {
  try {
    const res = await fetch(API_BASE + path, { headers: { Authorization: "Bearer " + state.token } });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "İndirme başarısız oldu."); }
    const blob = await res.blob();
    const cd = res.headers.get("Content-Disposition") || "";
    const match = cd.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (err) { toast(err.message); }
}

/* ---------------- Boot ---------------- */
window.addEventListener("DOMContentLoaded", boot);

async function boot() {
  if (state.token) {
    try {
      state.user = await api("/auth/me");
      if (state.user.mustChangePassword) renderForceChangePassword();
      else renderShell();
      return;
    } catch {
      localStorage.removeItem("sakin_token");
      state.token = null;
    }
  }
  renderLogin();
}

/* ---------------- Auth screens ---------------- */
function loginTemplate() {
  return `
  <div class="login-screen">
    <div class="login-side">
      <div>
        <div class="eyebrow">SAKİN</div>
        <h1>Sitenizin hesabı, deftere değil ekrana işlensin.</h1>
      </div>
      <div class="foot">Aidat takibi, muhasebe, duyurular, anketler, sayaç faturalama, demirbaş-bakım, kargo, karar defteri, anahtar takibi ve daha fazlası — tek panelde.</div>
    </div>
    <div class="login-main"><div class="login-form" id="authArea"></div></div>
  </div>`;
}

function renderLogin() {
  authMode = "login";
  document.getElementById("app").innerHTML = loginTemplate();
  renderAuthArea();
}

function renderAuthArea() {
  const area = document.getElementById("authArea");
  if (authMode === "login") {
    area.innerHTML = `
      <h1>Giriş yap</h1>
      <p class="sub">Hesabınızla giriş yapın.</p>
      <div id="authMsg"></div>
      <form id="loginForm">
        <div class="field"><label>E-posta</label><input type="email" name="email" required /></div>
        <div class="field"><label>Şifre</label><input type="password" name="password" required /></div>
        <button class="btn btn-primary" style="width:100%;margin-top:8px;" type="submit">Giriş yap</button>
      </form>
      <div class="auth-switch">Hesabınız yok mu? <button id="toRegister">Kayıt olun</button></div>
      <div class="auth-switch">Şifrenizi mi unuttunuz? <button id="toForgot">Sıfırlama talep edin</button></div>
      <p class="small muted" style="margin-top:14px;">Demo yönetici hesabı: yonetici@site.com / Degistir123!</p>
    `;
    document.getElementById("loginForm").addEventListener("submit", handleLogin);
    document.getElementById("toRegister").addEventListener("click", () => { authMode = "register"; renderAuthArea(); });
    document.getElementById("toForgot").addEventListener("click", () => { authMode = "forgot"; renderAuthArea(); });
  } else if (authMode === "forgot") {
    area.innerHTML = `
      <h1>Şifremi unuttum</h1>
      <p class="sub">E-posta adresinizi girin; yönetici sizin için geçici bir şifre oluşturup iletecektir.</p>
      <div id="authMsg"></div>
      <form id="forgotForm">
        <div class="field"><label>E-posta</label><input type="email" name="email" required /></div>
        <button class="btn btn-primary" style="width:100%;margin-top:8px;" type="submit">Talep Gönder</button>
      </form>
      <div class="auth-switch"><button id="toLogin2">Girişe dön</button></div>
    `;
    document.getElementById("forgotForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const msg = document.getElementById("authMsg");
      try { const r = await api("/auth/forgot-password", { method: "POST", body: { email: f.get("email") } }); msg.innerHTML = `<div class="success-box">${esc(r.message)}</div>`; }
      catch (err) { msg.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
    });
    document.getElementById("toLogin2").addEventListener("click", () => { authMode = "login"; renderAuthArea(); });
  } else {
    area.innerHTML = `<p class="sub">Yükleniyor…</p>`;
    api("/auth/units-for-signup").then((units) => {
      area.innerHTML = `
        <h1>Sakin kaydı oluştur</h1>
        <p class="sub">Kaydınız, yönetici onayından sonra aktif olur.</p>
        <div id="authMsg"></div>
        <form id="registerForm">
          <div class="field"><label>Ad Soyad</label><input name="name" required /></div>
          <div class="field"><label>E-posta</label><input type="email" name="email" required /></div>
          <div class="field"><label>Telefon</label><input name="phone" /></div>
          <div class="field"><label>Daire</label><select name="unitId" required>${units.map((u) => `<option value="${u.id}">${esc(u.label)}</option>`).join("")}</select></div>
          <div class="field"><label>Şifre</label><input type="password" name="password" required minlength="8" /><div class="small muted" style="margin-top:4px;">En az 8 karakter, en az bir harf ve bir rakam içermeli.</div></div>
          <button class="btn btn-primary" style="width:100%;margin-top:8px;" type="submit">Kayıt ol</button>
        </form>
        <div class="auth-switch">Zaten hesabınız var mı? <button id="toLogin">Giriş yapın</button></div>
      `;
      document.getElementById("registerForm").addEventListener("submit", handleRegister);
      document.getElementById("toLogin").addEventListener("click", () => { authMode = "login"; renderAuthArea(); });
    });
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = document.getElementById("authMsg");
  msg.innerHTML = "";
  try {
    const r = await api("/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password") } });
    state.token = r.token;
    localStorage.setItem("sakin_token", r.token);
    state.user = await api("/auth/me");
    state.tab = "ozet";
    if (r.mustChangePassword) renderForceChangePassword();
    else renderShell();
  } catch (err) {
    msg.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const msg = document.getElementById("authMsg");
  msg.innerHTML = "";
  try {
    const r = await api("/auth/register", { method: "POST", body: Object.fromEntries(f) });
    msg.innerHTML = `<div class="success-box">${esc(r.message)}</div>`;
    e.target.reset();
  } catch (err) {
    msg.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

function renderForceChangePassword() {
  const app = document.getElementById("app");
  app.innerHTML = `
  <div class="login-screen">
    <div class="login-side">
      <div><div class="eyebrow">SAKİN</div><h1>Önce şifrenizi güncelleyin.</h1></div>
      <div class="foot">Geçici şifreyle giriş yaptınız. Devam etmeden önce kendi belirlediğiniz bir şifreye geçmeniz gerekiyor.</div>
    </div>
    <div class="login-main">
      <div class="login-form">
        <h1>Yeni şifre belirleyin</h1>
        <p class="sub">Yöneticinizin size ilettiği geçici şifreyi ve yeni şifrenizi girin.</p>
        <div id="authMsg"></div>
        <form id="forceChangeForm">
          <div class="field"><label>Geçici Şifre</label><input type="password" name="currentPassword" required /></div>
          <div class="field"><label>Yeni Şifre</label><input type="password" name="newPassword" required minlength="8" /></div>
          <button class="btn btn-primary" style="width:100%;margin-top:8px;" type="submit">Şifreyi Güncelle ve Devam Et</button>
        </form>
      </div>
    </div>
  </div>`;
  document.getElementById("forceChangeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = document.getElementById("authMsg");
    try {
      const r = await api("/auth/change-password", { method: "POST", body: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
      if (r.token) { state.token = r.token; localStorage.setItem("sakin_token", r.token); }
      toast("Şifreniz güncellendi.");
      renderShell();
    } catch (err) { msg.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
  });
}

function logout() {
  localStorage.removeItem("sakin_token");
  state.token = null;
  state.user = null;
  state.tab = "ozet";
  expandedGroups = null;
  renderLogin();
}

/* ---------------- Icons (inline SVG, Feather-tarzı çizgi ikonlar) ---------------- */
function svgIcon(inner, extraAttrs) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extraAttrs || ""}>${inner}</svg>`;
}
const ICON = {
  bell: svgIcon('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>'),
  chevUpDown: svgIcon('<polyline points="7 15 12 20 17 15"/><polyline points="7 9 12 4 17 9"/>', 'class="chev"'),
};
const NAV_ICON = {
  ozet: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  mesajlar: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  aidat: '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
  sayac: '<path d="M4.9 19.1a9 9 0 1 1 14.2 0"/><line x1="12" y1="12" x2="15.5" y2="8.5"/><circle cx="12" cy="12" r="1"/>',
  duyuru: '<path d="M3 9v6h4l6 4V5L7 9H3z"/><path d="M17 8a4 4 0 0 1 0 8"/>',
  anket: '<line x1="6" y1="20" x2="6" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="14"/>',
  pano: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>',
  rehber: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  rezervasyon: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  talep: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.8 2.8-2-2z"/>',
  kargo: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>',
  seffaflik: '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>',
  ajanda: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="8.5 15 11 17.5 15.5 12.5"/>',
  istakibi: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/><polyline points="8.5 13 11 15.5 15.5 10"/>',
  kullanicilar: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.6"/><path d="M15 13.2a5.2 5.2 0 0 1 6.5 5"/>',
  daireler: '<rect x="4" y="2" width="16" height="20" rx="1"/><rect x="7" y="5" width="3" height="3"/><rect x="14" y="5" width="3" height="3"/><rect x="7" y="10" width="3" height="3"/><rect x="14" y="10" width="3" height="3"/><rect x="7" y="15" width="3" height="3"/><rect x="14" y="15" width="3" height="3"/>',
  tahsilat: '<rect x="2" y="6" width="20" height="14" rx="2"/><path d="M2 10h20"/><circle cx="17" cy="15" r="1" fill="currentColor" stroke="none"/>',
  muhasebe: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="8.01" y2="10"/><line x1="12" y1="10" x2="12.01" y2="10"/><line x1="16" y1="10" x2="16.01" y2="10"/><line x1="8" y1="14" x2="8.01" y2="14"/><line x1="12" y1="14" x2="12.01" y2="14"/><line x1="16" y1="14" x2="16.01" y2="14"/><line x1="8" y1="18" x2="8.01" y2="18"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  kasalar: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="4"/><line x1="12" y1="12" x2="12" y2="9.5"/><line x1="12" y1="12" x2="13.8" y2="13"/>',
  cari: '<rect x="2" y="7" width="20" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="2" y1="12" x2="22" y2="12"/>',
  butce: '<path d="M21.2 15.3A10 10 0 1 1 8.7 2.8"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  personel: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="10" r="2.5"/><path d="M8.5 17a3.5 3.5 0 0 1 7 0"/>',
  demirbas: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><line x1="12" y1="13" x2="12" y2="21"/>',
  anahtar: '<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3"/><path d="M17 6l3 3"/><path d="M14 9l2.5 2.5"/>',
  karar: '<path d="M12 6c-2-2-6-2-9-1v13c3-1 7-1 9 1 2-2 6-2 9-1V5c-3-1-7-1-9 1z"/><line x1="12" y1="6" x2="12" y2="19"/>',
  icra: '<line x1="12" y1="3" x2="12" y2="21"/><path d="M5 8l-3 5a3 3 0 0 0 6 0z"/><path d="M19 8l-3 5a3 3 0 0 0 6 0z"/><path d="M5 8h14"/><path d="M8 21h8"/>',
  belgeler: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  toplusms: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/>',
  giderler: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="13" y2="15"/>',
  borclistesi: '<path d="M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1z"/><rect x="5" y="4" width="14" height="17" rx="2"/><line x1="8" y1="11" x2="16" y2="11"/><line x1="8" y1="15" x2="16" y2="15"/>',
  tekrarlayan: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  arsiv: '<path d="M2 4h20v4H2z"/><path d="M4 8v12h16V8"/><line x1="10" y1="13" x2="14" y2="13"/>',
  ayarlar: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/>',
};
function navIcon(id) { return svgIcon(NAV_ICON[id] || NAV_ICON.ozet); }

/* ---------------- Shell ---------------- */
const NAV_GROUPS = {
  sakin: [
    { group: "Genel", items: [["ozet", "Özet"], ["mesajlar", "Gelen Mesajlar"]] },
    { group: "Hesabım", items: [["aidat", "Aidatım"], ["sayac", "Sayaçlarım"]] },
    { group: "İletişim", items: [["duyuru", "Duyurular"], ["anket", "Anketler"], ["pano", "Site Panosu"], ["rehber", "Rehber"]] },
    { group: "Hizmetler", items: [["rezervasyon", "Rezervasyon"], ["talep", "Arıza/Talep"], ["kargo", "Kargolarım"]] },
    { group: "Sistem", items: [["seffaflik", "Şeffaflık"]] },
  ],
  yonetici: [
    { group: "Genel", items: [["ozet", "Özet"], ["ajanda", "Ajanda"], ["istakibi", "İş Takibi"], ["mesajlar", "Gelen Mesajlar"]] },
    { group: "Üyeler", items: [["kullanicilar", "Kullanıcılar"], ["daireler", "Daireler"]] },
    { group: "Finans", items: [["tahsilat", "Aidat Takibi"], ["muhasebe", "Muhasebe"], ["kasalar", "Kasalar"], ["cari", "Firma & Personel"], ["giderler", "Giderler"], ["borclistesi", "Borç Listesi"], ["tekrarlayan", "İleri Tarihli / Tekrarlayan"], ["butce", "Bütçe"]] },
    { group: "İletişim", items: [["duyuru", "Duyurular"], ["anket", "Anketler"], ["pano", "Site Panosu"], ["rehber", "Rehber"], ["toplusms", "Toplu SMS/E-posta"]] },
    { group: "Operasyon", items: [["rezervasyon", "Rezervasyonlar"], ["talep", "Talepler"], ["personel", "Personel"], ["demirbas", "Demirbaş"], ["sayac", "Sayaçlar"], ["kargo", "Kargo"], ["anahtar", "Anahtarlar"]] },
    { group: "Kurul & Hukuk", items: [["karar", "Karar Defteri"], ["icra", "İcra Takibi"], ["belgeler", "Belge Şablonları"], ["arsiv", "Dosya Arşivi"]] },
    { group: "Sistem", items: [["seffaflik", "Şeffaflık"], ["ayarlar", "Ayarlar"]] },
  ],
  personel: [
    { group: "Genel", items: [["ozet", "Özet"], ["istakibi", "İş Takibi"]] },
    { group: "İş", items: [["talep", "Talepler"], ["demirbas", "Demirbaş"], ["kargo", "Kargo"]] },
    { group: "Sistem", items: [["rehber", "Rehber"]] },
  ],
};
const ROLE_LABEL = { sakin: "Sakin Paneli", yonetici: "Yönetim Paneli", personel: "Personel Paneli" };
let expandedGroups = null;

function tabLabel(tab) {
  const groups = NAV_GROUPS[state.user?.role] || [];
  for (const g of groups) {
    const found = g.items.find(([id]) => id === tab);
    if (found) return found[1];
  }
  return "";
}

function initials(name) {
  return (name || "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function renderShell() {
  const app = document.getElementById("app");
  app.innerHTML = `
   <div class="app-shell">
     <aside class="sidebar" id="sidebar">
       <div class="sidebar-brand">
         <div class="brand-mark">S</div>
         <div class="brand-word">
           <span class="f-display">Sakin</span>
           <span class="badge-role">${esc(ROLE_LABEL[state.user.role] || "")}</span>
         </div>
       </div>
       <div class="sidebar-nav-scroll"><nav id="sidebarNav"></nav></div>
       <div class="sidebar-user">
         <button class="sidebar-user-btn" id="userMenuBtn">
           <span class="sidebar-avatar">${esc(initials(state.user.name))}</span>
           <span class="sidebar-user-info">
             <div class="name">${esc(state.user.name)}</div>
             <div class="role">${esc(ROLE_LABEL[state.user.role] || "")}</div>
           </span>
           ${ICON.chevUpDown}
         </button>
       </div>
     </aside>
     <div class="main-col">
       <div class="topbar">
         <div style="display:flex;align-items:center;gap:10px;">
           <button class="hamburger" id="hamburgerBtn">☰</button>
           <span class="page-title" id="pageTitle"></span>
         </div>
         <div class="right">
           <button class="bell" id="bellBtn">${ICON.bell}<span class="dot" id="bellDot" style="display:none;"></span></button>
         </div>
       </div>
       <div class="wrap" id="content"></div>
     </div>
   </div>
   <div class="sidebar-overlay" id="sidebarOverlay"></div>
  `;
  renderSidebarNav();
  document.getElementById("bellBtn").addEventListener("click", toggleNotifPanel);
  document.getElementById("hamburgerBtn").addEventListener("click", toggleSidebar);
  document.getElementById("sidebarOverlay").addEventListener("click", toggleSidebar);
  document.getElementById("userMenuBtn").addEventListener("click", toggleUserMenu);
  refreshNotifBadge();
  renderTab(state.tab || "ozet");
}

function toggleUserMenu() {
  const existing = document.getElementById("userMenuPanel");
  if (existing) { existing.remove(); return; }
  const panel = document.createElement("div");
  panel.id = "userMenuPanel";
  panel.className = "notif-panel user-menu-panel";
  panel.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="changePwBtn" style="width:100%;margin-bottom:8px;">Şifre Değiştir</button>
    <button class="btn btn-ghost btn-sm" id="logoutAllBtn" style="width:100%;margin-bottom:8px;">Tüm Oturumları Kapat</button>
    <button class="btn btn-ghost btn-sm" id="logoutBtn" style="width:100%;">Çıkış Yap</button>
  `;
  document.querySelector(".sidebar-user").appendChild(panel);
  document.getElementById("changePwBtn").addEventListener("click", () => { panel.remove(); renderChangePasswordModal(); });
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("logoutAllBtn").addEventListener("click", async () => {
    if (!confirm("Tüm oturumlar kapatılsın mı? Diğer cihazlardaki oturumlar sonlandırılacak.")) return;
    try {
      const r = await api("/auth/logout-all-sessions", { method: "POST" });
      state.token = r.token;
      localStorage.setItem("sakin_token", r.token);
      toast("Tüm oturumlar kapatıldı.");
      panel.remove();
    } catch (err) { toast(err.message); }
  });
}

function renderChangePasswordModal() {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(12,32,50,.35);z-index:70;display:flex;align-items:center;justify-content:center;padding:20px;";
  overlay.innerHTML = `
    <div class="card pad" style="max-width:360px;width:100%;">
      <h3 class="f-display" style="margin:0 0 12px;">Şifre Değiştir</h3>
      <form id="pwModalForm">
        <div class="field"><label>Mevcut Şifre</label><input type="password" name="currentPassword" required /></div>
        <div class="field"><label>Yeni Şifre</label><input type="password" name="newPassword" required minlength="8" /><div class="small muted" style="margin-top:4px;">En az 8 karakter, en az bir harf ve bir rakam.</div></div>
        <div id="pwModalMsg"></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button type="button" class="btn btn-ghost" id="pwModalCancel" style="flex:1;">Vazgeç</button>
          <button type="submit" class="btn btn-primary" style="flex:1;">Kaydet</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#pwModalCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#pwModalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const msg = overlay.querySelector("#pwModalMsg");
    try {
      const r = await api("/auth/change-password", { method: "POST", body: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
      if (r.token) { state.token = r.token; localStorage.setItem("sakin_token", r.token); }
      toast("Şifreniz güncellendi.");
      overlay.remove();
    } catch (err) { msg.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
  });
}

async function renderUserEditModal(u) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(12,32,50,.35);z-index:70;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";
  overlay.innerHTML = `
    <div class="card pad" style="max-width:420px;width:100%;">
      <h3 class="f-display" style="margin:0 0 12px;">${esc(u.name)}</h3>
      <form id="userEditForm">
        <div class="field"><label>Ad Soyad</label><input name="name" value="${esc(u.name)}" required /></div>
        <div class="field"><label>Telefon</label><input name="phone" value="${esc(u.phone || "")}" /></div>
        <div class="field"><label>İkinci Telefon</label><input name="phone2" value="${esc(u.phone2 || "")}" /></div>
        <div class="field"><label>İkinci E-posta</label><input name="email2" type="email" value="${esc(u.email2 || "")}" /></div>
        <div class="field"><label>TC Kimlik No</label><input name="nationalId" value="${esc(u.nationalId || "")}" maxlength="11" pattern="[0-9]{11}" title="11 haneli TC kimlik numarası" /></div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button type="button" class="btn btn-ghost" id="userEditCancel" style="flex:1;">Kapat</button>
          <button type="submit" class="btn btn-primary" style="flex:1;">Kaydet</button>
        </div>
      </form>
      <div class="ledger-title" style="padding-top:18px;">Araç Plakaları</div>
      <div id="vehicleList" class="small muted">Yükleniyor…</div>
      <form id="vehicleForm" class="form-row" style="margin-top:10px;">
        <div class="field" style="flex:1 1 100px;"><label>Plaka</label><input name="plate" required /></div>
        <div class="field" style="flex:1 1 100px;"><label>Marka</label><input name="brand" /></div>
        <div class="field" style="flex:1 1 100px;"><label>Renk</label><input name="color" /></div>
        <button class="btn btn-ghost btn-sm" type="submit">Ekle</button>
      </form>
      <div class="ledger-title" style="padding-top:18px;">Notlar</div>
      <div id="noteList" class="small muted">Yükleniyor…</div>
      <form id="noteForm" class="form-row" style="margin-top:10px;">
        <div class="field" style="flex:1 1 220px;"><label>Yeni Not</label><input name="text" required placeholder="Örn. anahtarı komşuya bıraktı" /></div>
        <button class="btn btn-ghost btn-sm" type="submit">Ekle</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#userEditCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#userEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/users/" + u.id, { method: "PATCH", body: Object.fromEntries(f) });
      toast("Kullanıcı bilgileri güncellendi.");
      overlay.remove();
      renderTab("kullanicilar");
    } catch (err) { toast(err.message); }
  });

  async function loadVehicles() {
    const vehicles = await api("/users/" + u.id + "/vehicles");
    const box = overlay.querySelector("#vehicleList");
    box.innerHTML = vehicles.length
      ? vehicles.map((v) => `<div class="ledger-row" style="padding:6px 0;"><span>${esc(v.plate)}${v.brand ? " · " + esc(v.brand) : ""}${v.color ? " · " + esc(v.color) : ""}</span><button class="btn-danger" data-delveh="${v.id}">Sil</button></div>`).join("")
      : '<div class="empty-row" style="padding:4px 0;">Kayıtlı plaka yok.</div>';
    box.querySelectorAll("[data-delveh]").forEach((b) => b.addEventListener("click", async () => {
      try { await api("/vehicles/" + b.dataset.delveh, { method: "DELETE" }); loadVehicles(); } catch (err) { toast(err.message); }
    }));
  }
  loadVehicles();

  overlay.querySelector("#vehicleForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/users/" + u.id + "/vehicles", { method: "POST", body: Object.fromEntries(f) });
      e.target.reset();
      loadVehicles();
    } catch (err) { toast(err.message); }
  });

  async function loadNotes() {
    const notes = await api("/users/" + u.id + "/notes");
    const box = overlay.querySelector("#noteList");
    box.innerHTML = notes.length
      ? notes.map((n) => `<div class="ledger-row" style="padding:6px 0;flex-wrap:wrap;"><div><div style="font-size:13px;">${esc(n.text)}</div><div class="small muted">${dt(n.createdAt)}</div></div><button class="btn-danger" data-delnote="${n.id}">Sil</button></div>`).join("")
      : '<div class="empty-row" style="padding:4px 0;">Kayıtlı not yok.</div>';
    box.querySelectorAll("[data-delnote]").forEach((b) => b.addEventListener("click", async () => {
      try { await api("/notes/" + b.dataset.delnote, { method: "DELETE" }); loadNotes(); } catch (err) { toast(err.message); }
    }));
  }
  loadNotes();

  overlay.querySelector("#noteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/users/" + u.id + "/notes", { method: "POST", body: Object.fromEntries(f) });
      e.target.reset();
      loadNotes();
    } catch (err) { toast(err.message); }
  });
}

function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("open");
  document.getElementById("sidebarOverlay")?.classList.toggle("visible");
}

function renderSidebarNav() {
  const groups = NAV_GROUPS[state.user.role] || [];
  if (!expandedGroups) {
    const activeGroup = groups.find((g) => g.items.some(([id]) => id === state.tab));
    expandedGroups = new Set([(activeGroup || groups[0])?.group]);
  }
  const nav = document.getElementById("sidebarNav");
  nav.innerHTML = groups.map((g) => {
    const isOpen = expandedGroups.has(g.group);
    return `
      <div class="sidebar-group">
        <button class="sidebar-group-header" data-group="${esc(g.group)}">
          <span>${esc(g.group)}</span>
          <span class="chevron ${isOpen ? "open" : ""}">›</span>
        </button>
        <div class="sidebar-group-items" style="display:${isOpen ? "block" : "none"};">
          ${g.items.map(([id, label]) => `<button class="sidebar-item ${state.tab === id ? "active" : ""}" data-tab="${id}">${navIcon(id)}<span>${esc(label)}</span></button>`).join("")}
        </div>
      </div>`;
  }).join("");

  nav.querySelectorAll("[data-group]").forEach((btn) => btn.addEventListener("click", () => {
    const g = btn.dataset.group;
    if (expandedGroups.has(g)) expandedGroups.delete(g); else expandedGroups.add(g);
    renderSidebarNav();
  }));
  nav.querySelectorAll("[data-tab]").forEach((btn) => btn.addEventListener("click", () => {
    state.tab = btn.dataset.tab;
    renderSidebarNav();
    renderTab(state.tab);
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sidebarOverlay")?.classList.remove("visible");
  }));
}

async function refreshNotifBadge() {
  try {
    const list = await api("/notifications");
    const unread = list.filter((n) => !n.read).length;
    const dotEl = document.getElementById("bellDot");
    if (dotEl) dotEl.style.display = unread > 0 ? "block" : "none";
  } catch {}
}

async function toggleNotifPanel() {
  const existing = document.getElementById("notifPanel");
  if (existing) { existing.remove(); return; }
  const list = await api("/notifications");
  const panel = document.createElement("div");
  panel.id = "notifPanel";
  panel.className = "notif-panel";
  panel.innerHTML = `
    <div class="flex-between" style="margin-bottom:8px;"><strong style="font-size:14px;">Bildirimler</strong><button class="btn btn-ghost btn-sm" id="readAllBtn" style="font-size:11px;">Tümünü okundu yap</button></div>
    ${list.map((n) => `<div class="notif-item" style="${n.read ? "opacity:.55;" : ""}">${esc(n.message)}<div class="small muted">${dt(n.date)}</div></div>`).join("") || '<div class="empty-row">Bildirim yok.</div>'}
  `;
  document.querySelector(".topbar").appendChild(panel);
  document.getElementById("readAllBtn").addEventListener("click", async () => {
    await api("/notifications/read-all", { method: "POST" });
    toggleNotifPanel();
    refreshNotifBadge();
  });
}

/* ---------------- Router ---------------- */
async function renderTab(tab) {
  state.tab = tab;
  const c = document.getElementById("content");
  if (!c) return;
  const titleEl = document.getElementById("pageTitle");
  if (titleEl) titleEl.textContent = tabLabel(tab);
  c.innerHTML = '<p class="muted">Yükleniyor…</p>';
  const role = state.user.role;
  try {
    if (tab === "ozet") {
      if (role === "sakin") await renderResidentOzet(c);
      else if (role === "personel") await renderPersonelOzet(c);
      else await renderManagerOzet(c);
    } else if (tab === "aidat") await renderResidentAidat(c);
    else if (tab === "sayac") { if (role === "sakin") await renderResidentSayac(c); else await renderSayacYonetici(c); }
    else if (tab === "duyuru") await renderDuyuru(c);
    else if (tab === "anket") await renderAnket(c);
    else if (tab === "rezervasyon") await renderRezervasyon(c);
    else if (tab === "talep") await renderTalep(c);
    else if (tab === "kargo") await renderKargo(c);
    else if (tab === "pano") await renderPano(c);
    else if (tab === "kullanicilar") await renderKullanicilar(c);
    else if (tab === "daireler") await renderDaireler(c);
    else if (tab === "tahsilat") await renderTahsilat(c);
    else if (tab === "muhasebe") await renderMuhasebe(c);
    else if (tab === "kasalar") await renderKasalar(c);
    else if (tab === "cari") await renderCari(c);
    else if (tab === "giderler") await renderGiderler(c);
    else if (tab === "borclistesi") await renderBorcListesi(c);
    else if (tab === "tekrarlayan") await renderTekrarlayan(c);
    else if (tab === "personel") await renderPersonelView(c);
    else if (tab === "demirbas") await renderDemirbas(c);
    else if (tab === "karar") await renderKarar(c);
    else if (tab === "anahtar") await renderAnahtar(c);
    else if (tab === "seffaflik") await renderSeffaflik(c);
    else if (tab === "butce") await renderButce(c);
    else if (tab === "rehber") await renderRehber(c);
    else if (tab === "ayarlar") await renderAyarlar(c);
    else if (tab === "ajanda") await renderAjanda(c);
    else if (tab === "istakibi") await renderIsTakibi(c);
    else if (tab === "mesajlar") await renderMesajlar(c);
    else if (tab === "icra") await renderIcraTakibi(c);
    else if (tab === "belgeler") await renderBelgeSablonlari(c);
    else if (tab === "arsiv") await renderDosyaArsivi(c);
    else if (tab === "toplusms") await renderTopluSms(c);
    else c.innerHTML = '<p class="muted">Bulunamadı.</p>';
  } catch (err) {
    c.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
  }
}

/* ================= RESIDENT VIEWS ================= */

async function renderResidentOzet(c) {
  const [dash, announcements] = await Promise.all([api("/dashboard"), api("/announcements")]);
  c.innerHTML = `
    ${sectionTitle("Merhaba, " + state.user.name.split(" ")[0], state.user.unitLabel || "")}
    <div class="card pad mb-16 clickable" data-goto="aidat">
      <div class="flex-between">
        <div><div class="stat-label">GÜNCEL BAKİYE</div><div class="f-num stat-value" style="color:${debtColor(dash.debt)}">${tl(Math.abs(dash.debt))}</div></div>
        ${pill(debtStatusLabel(dash.debt))}
      </div>
    </div>
    <div class="grid cols-3 mb-16">
      <div class="card stat-card clickable" data-goto="talep"><div class="stat-label">AÇIK TALEP</div><div class="stat-value">${dash.openTickets}</div></div>
      <div class="card stat-card clickable" data-goto="rezervasyon"><div class="stat-label">YAKLAŞAN REZERVASYON</div><div class="stat-value">${dash.upcomingReservations}</div></div>
      <div class="card stat-card clickable" data-goto="kargo"><div class="stat-label">BEKLEYEN KARGO</div><div class="stat-value">${dash.pendingPackages}</div></div>
    </div>
    <div class="card tight">
      <div class="ledger-title">Güncel Duyurular</div>
      ${announcements.slice(0, 3).map((a) => ledgerRow(esc(a.title), dt(a.date), "")).join("") || '<div class="empty-row">Duyuru yok.</div>'}
    </div>
  `;
  c.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => goToTab(el.dataset.goto)));
}

async function renderResidentAidat(c) {
  const [charges, payments, dash] = await Promise.all([api("/charges"), api("/payments"), api("/dashboard")]);
  const debt = dash.debt;
  c.innerHTML = `
    ${sectionTitle("Aidatım", "Hesap özeti banka ekstresi mantığıyla listelenir")}
    <div class="card pad mb-16 flex-between">
      <div><div class="stat-label">${debt < 0 ? "ALACAKLI BAKİYE" : "ÖDENECEK TUTAR"}</div><div class="f-num stat-value" style="color:${debtColor(debt)}">${tl(Math.abs(debt))}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${debt <= 0 ? '<button class="btn btn-ghost" id="debtLetterBtn">📄 Borcu Yoktur Belgesi</button>' : ""}
        <button class="btn btn-primary" id="payBtn" ${debt <= 0 ? "disabled" : ""}>${debt > 0 ? "Ödeme Yap" : "Borç Yok"}</button>
      </div>
    </div>
    <div class="card tight mb-16">
      <div class="ledger-title">Borç Kalemleri</div>
      ${charges.map((ch) => ledgerRow(`${chargeTypeLabel(ch)} — ${esc(ch.description)}`, dt(ch.dueDate) + " · " + pill(ch.status === "paid" ? "Ödendi" : "Borçlu"), tl(ch.amount - ch.paidAmount), ch.status !== "paid" ? "var(--red)" : "var(--green)")).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
    <div class="card tight">
      <div class="ledger-title">Ödeme Geçmişi</div>
      ${payments.map((p) => `
        <div class="ledger-row">
          <div><div style="font-size:14px;font-weight:600;">Ödeme — ${esc(p.method)}</div><div class="small muted">${dt(p.date)} · ${p.receiptNo}</div></div>
          <div style="display:flex;align-items:center;gap:10px;"><span class="f-num" style="font-weight:600;color:var(--green);">+${tl(p.amount)}</span><button class="btn btn-ghost btn-sm" data-receipt="${p.id}">📄 Makbuz</button></div>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("payBtn")?.addEventListener("click", async (e) => {
    if (!confirm(`${tl(debt)} tutarında ödeme yapılsın mı? (Demo ortamı — gerçek kart bilgisi istenmez)`)) return;
    e.target.disabled = true; e.target.textContent = "İşleniyor…";
    // Cift tiklama / ag tekrarindan kaynaklanan cift odeme sikayetini onlemek icin
    // her deneme benzersiz bir requestId ile gonderilir (backend bunu tekrar isleme almaz).
    const requestId = crypto.randomUUID();
    try {
      await api("/payments/pay", { method: "POST", body: { amount: debt, method: "Kredi Kartı", requestId } });
      toast("Ödemeniz alındı, teşekkürler.");
      renderTab("aidat");
    } catch (err) { toast(err.message); e.target.disabled = false; e.target.textContent = "Ödeme Yap"; }
  });
  document.getElementById("debtLetterBtn")?.addEventListener("click", () => downloadFile("/documents/debt-letter", "borcu-yoktur.pdf"));
  c.querySelectorAll("[data-receipt]").forEach((b) => b.addEventListener("click", () => downloadFile("/documents/receipt/" + b.dataset.receipt, "makbuz.pdf")));
}

async function renderResidentSayac(c) {
  const [meters, readings] = await Promise.all([api("/meters"), api("/meter-readings")]);
  c.innerHTML = `
    ${sectionTitle("Sayaçlarım")}
    <div class="card tight mb-16">
      <div class="ledger-title">Kayıtlı Sayaçlarım</div>
      ${meters.map((m) => ledgerRow(m.type.toUpperCase() + " Sayacı", "Seri No: " + esc(m.serialNo || "-"), "")).join("") || '<div class="empty-row">Kayıtlı sayaç yok.</div>'}
    </div>
    <div class="card tight">
      <div class="ledger-title">Okuma / Fatura Geçmişi</div>
      ${readings.map((r) => ledgerRow(r.period + " dönemi", r.value + " birim × " + tl(r.unitCost), tl(r.amount))).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
}

/* ================= SHARED VIEWS (duyuru, anket, rezervasyon, talep, kargo, pano) ================= */

async function renderDuyuru(c) {
  const list = await api("/announcements");
  const canCreate = state.user.role === "yonetici";
  c.innerHTML = `
    <div class="flex-between">${sectionTitle("Duyurular")}${canCreate ? '<button class="btn btn-ghost btn-sm" id="newAnnBtn" style="margin-bottom:16px;">+ Yeni Duyuru</button>' : ""}</div>
    <div id="annForm"></div>
    <div class="grid">${list.map((a) => `
      <div class="card pad accent mb-16">
        <div class="flex-between"><div class="f-display" style="font-weight:700;font-size:15px;">${esc(a.title)} ${a.pinned ? "📌" : ""}</div><div class="small muted">${dt(a.date)}</div></div>
        <p style="font-size:14px;color:var(--steel);margin-top:6px;line-height:1.55;">${esc(a.body)}</p>
        ${canCreate ? `<button class="btn-danger" data-del="${a.id}">Sil</button>` : ""}
      </div>`).join("") || '<div class="empty-row">Duyuru yok.</div>'}</div>
  `;
  if (canCreate) {
    document.getElementById("newAnnBtn").addEventListener("click", () => {
      document.getElementById("annForm").innerHTML = `
        <form id="annCreateForm" class="card form-card">
          <div class="field"><label>Başlık</label><input name="title" required /></div>
          <div class="field"><label>İçerik</label><textarea name="body" rows="3" required></textarea></div>
          <label class="small"><input type="checkbox" name="pinned" /> Sabitle</label>
          <button class="btn btn-primary btn-sm" style="margin-top:10px;display:block;" type="submit">Yayınla</button>
        </form>`;
      document.getElementById("annCreateForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try { await api("/announcements", { method: "POST", body: { title: f.get("title"), body: f.get("body"), pinned: !!f.get("pinned") } }); toast("Duyuru yayınlandı."); renderTab("duyuru"); }
        catch (err) { toast(err.message); }
      });
    });
    c.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Silinsin mi?")) return; await api("/announcements/" + b.dataset.del, { method: "DELETE" }); renderTab("duyuru"); }));
  }
}

function surveyCard(s) {
  const total = s.options.reduce((a, o) => a + o.votes, 0) || 1;
  const voted = s.votedBy.includes(state.user.id);
  return `<div class="card pad mb-16">
    <div class="f-display" style="font-weight:700;font-size:15px;margin-bottom:10px;">${esc(s.question)}</div>
    ${s.options.map((o, i) => {
      const pct = Math.round((o.votes / total) * 100);
      return `<div style="margin-bottom:8px;">
        <div class="flex-between" style="font-size:14px;">
          <button ${voted ? "disabled" : ""} data-sid="${s.id}" data-vote="${i}" style="background:none;border:none;padding:0;font-weight:600;color:${voted ? "var(--ink)" : "var(--navy)"};cursor:${voted ? "default" : "pointer"};text-align:left;">${esc(o.text)}</button>
          <span class="f-num muted">${pct}% · ${o.votes} oy</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
      </div>`;
    }).join("")}
    ${voted ? '<div class="small" style="color:var(--green);font-weight:600;">Oyunuz kaydedildi</div>' : ""}
  </div>`;
}

async function renderAnket(c) {
  const list = await api("/surveys");
  const canCreate = state.user.role === "yonetici";
  c.innerHTML = `
    <div class="flex-between">${sectionTitle("Anketler")}${canCreate ? '<button class="btn btn-ghost btn-sm" id="newSurBtn" style="margin-bottom:16px;">+ Yeni Anket</button>' : ""}</div>
    <div id="surForm"></div>
    <div class="grid">${list.map(surveyCard).join("") || '<div class="empty-row">Anket yok.</div>'}</div>
  `;
  if (canCreate) {
    document.getElementById("newSurBtn").addEventListener("click", () => {
      document.getElementById("surForm").innerHTML = `
        <form id="surCreateForm" class="card form-card">
          <div class="field"><label>Soru</label><input name="question" required /></div>
          <div class="field"><label>Seçenek 1</label><input name="opt1" required /></div>
          <div class="field"><label>Seçenek 2</label><input name="opt2" required /></div>
          <div class="field"><label>Seçenek 3 (opsiyonel)</label><input name="opt3" /></div>
          <button class="btn btn-primary btn-sm" type="submit">Anketi Başlat</button>
        </form>`;
      document.getElementById("surCreateForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        const options = [f.get("opt1"), f.get("opt2"), f.get("opt3")].filter(Boolean);
        try { await api("/surveys", { method: "POST", body: { question: f.get("question"), options } }); toast("Anket oluşturuldu."); renderTab("anket"); }
        catch (err) { toast(err.message); }
      });
    });
  }
  c.querySelectorAll("[data-vote]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/surveys/${b.dataset.sid}/vote`, { method: "POST", body: { optionIndex: Number(b.dataset.vote) } }); renderTab("anket"); }
    catch (err) { toast(err.message); }
  }));
}

async function renderRezervasyon(c) {
  const [reservations, facilities] = await Promise.all([api("/reservations"), api("/facilities")]);
  const canManage = state.user.role === "yonetici";
  c.innerHTML = `
    ${sectionTitle("Ortak Alan Rezervasyonu")}
    ${!canManage ? `
    <form id="resForm" class="card form-card form-row">
      <div class="field"><label>Tesis</label><select name="facilityId">${facilities.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select></div>
      <div class="field"><label>Tarih</label><input type="date" name="date" required /></div>
      <div class="field"><label>Başlangıç</label><input type="time" name="startTime" value="18:00" required /></div>
      <div class="field"><label>Bitiş</label><input type="time" name="endTime" value="19:00" required /></div>
      <button class="btn btn-primary" type="submit">Rezerve Et</button>
    </form>` : ""}
    <div class="card tight">
      <div class="ledger-title">${canManage ? "Tüm Rezervasyonlar" : "Rezervasyonlarım"}</div>
      ${reservations.map((r) => `
        <div class="ledger-row">
          <div><div style="font-size:14px;font-weight:600;">${esc(r.facilityName)}</div><div class="small muted">${dt(r.date)} · ${r.startTime}-${r.endTime}${canManage ? " · " + esc(r.unitLabel) : ""}</div></div>
          <div style="display:flex;align-items:center;gap:10px;">${pill(r.status)}<button class="btn-danger" data-cancel="${r.id}">İptal</button></div>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("resForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/reservations", { method: "POST", body: Object.fromEntries(f) }); toast("Rezervasyon oluşturuldu."); renderTab("rezervasyon"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("İptal edilsin mi?")) return; try { await api("/reservations/" + b.dataset.cancel, { method: "DELETE" }); renderTab("rezervasyon"); } catch (err) { toast(err.message); } }));
}

function ticketCard(t, role, personnel) {
  const canManage = role === "yonetici" || role === "personel";
  return `<div class="card pad mb-16">
    <div class="flex-between">
      <div><div style="font-size:14px;font-weight:700;">${esc(t.category)} — ${esc(t.title)}</div><div class="small muted">${role !== "sakin" ? esc(t.residentName) + " · " + esc(t.unitLabel) + " · " : ""}${dt(t.createdAt)}</div></div>
      ${pill(t.status)}
    </div>
    <p style="font-size:14px;color:var(--steel);margin-top:8px;">${esc(t.description)}</p>
    ${t.assignedName ? `<div class="small muted">Atanan: ${esc(t.assignedName)}</div>` : ""}
    ${t.comments.length ? `<div class="small muted" style="margin-top:6px;">${t.comments.map((cm) => `💬 ${esc(cm.text)}`).join("<br/>")}</div>` : ""}
    ${role === "yonetici" ? `<div class="field" style="margin-top:8px;max-width:220px;"><label class="small">Ata</label><select data-assign="${t.id}"><option value="">Atanmadı</option>${personnel.map((p) => `<option value="${p.id}" ${t.assignedPersonnelId === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></div>` : ""}
    ${canManage ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">${["Açık", "İşlemde", "Çözüldü"].map((s) => `<button class="btn btn-ghost btn-sm" data-status="${t.id}|${s}" style="${t.status === s ? "background:var(--ice);" : ""}">${s}</button>`).join("")}</div>` : ""}
  </div>`;
}

async function renderTalep(c) {
  const role = state.user.role;
  const promises = [api("/tickets"), api("/ticket-categories")];
  if (role === "yonetici") promises.push(api("/personnel"));
  const [tickets, categories, personnel = []] = await Promise.all(promises);
  c.innerHTML = `
    <div class="flex-between">${sectionTitle(role === "sakin" ? "Arıza / Talep" : "Talepler")}${role === "sakin" ? '<button class="btn btn-ghost btn-sm" id="newTicketBtn" style="margin-bottom:16px;">+ Yeni Talep</button>' : ""}</div>
    <div id="ticketForm"></div>
    <div class="grid">${tickets.map((t) => ticketCard(t, role, personnel)).join("") || '<div class="empty-row">Kayıt yok.</div>'}</div>
  `;
  if (role === "sakin") {
    document.getElementById("newTicketBtn").addEventListener("click", () => {
      document.getElementById("ticketForm").innerHTML = `
        <form id="ticketCreateForm" class="card form-card">
          <div class="field"><label>Kategori</label><select name="category">${categories.map((cat) => `<option>${esc(cat)}</option>`).join("")}</select></div>
          <div class="field"><label>Başlık</label><input name="title" required /></div>
          <div class="field"><label>Açıklama</label><textarea name="description" rows="3" required></textarea></div>
          <button class="btn btn-primary btn-sm" type="submit">Gönder</button>
        </form>`;
      document.getElementById("ticketCreateForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try { await api("/tickets", { method: "POST", body: Object.fromEntries(f) }); toast("Talebiniz iletildi."); renderTab("talep"); }
        catch (err) { toast(err.message); }
      });
    });
  }
  if (role === "yonetici" || role === "personel") {
    c.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", async () => {
      const [id, status] = b.dataset.status.split("|");
      try { await api("/tickets/" + id, { method: "PATCH", body: { status } }); renderTab("talep"); }
      catch (err) { toast(err.message); }
    }));
  }
  c.querySelectorAll("[data-assign]").forEach((sel) => sel.addEventListener("change", async () => {
    try { await api("/tickets/" + sel.dataset.assign, { method: "PATCH", body: { assignedPersonnelId: sel.value || null } }); toast("Atama güncellendi."); }
    catch (err) { toast(err.message); }
  }));
}

async function renderKargo(c) {
  const role = state.user.role;
  const list = await api("/packages");
  const canManage = role === "yonetici" || role === "personel";
  let units = [];
  if (canManage) units = await api("/units");
  c.innerHTML = `
    <div class="flex-between">${sectionTitle(role === "sakin" ? "Kargolarım" : "Kargo Takibi")}${canManage ? '<button class="btn btn-ghost btn-sm" id="newPkgBtn" style="margin-bottom:16px;">+ Kargo Kaydı</button>' : ""}</div>
    <div id="pkgForm"></div>
    <div class="card tight">
      ${list.map((p) => `
        <div class="ledger-row">
          <div><div style="font-size:14px;font-weight:600;">${esc(p.courier)}${p.trackingNo ? " · " + esc(p.trackingNo) : ""}</div><div class="small muted">${canManage ? esc(p.unitLabel) + " · " : ""}${dt(p.receivedDate)}</div></div>
          <div style="display:flex;align-items:center;gap:10px;">${pill(p.status)}${canManage && p.status !== "Teslim Edildi" ? `<button class="btn btn-ghost btn-sm" data-deliver="${p.id}">Teslim Et</button>` : ""}</div>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  if (canManage) {
    document.getElementById("newPkgBtn").addEventListener("click", () => {
      document.getElementById("pkgForm").innerHTML = `
        <form id="pkgCreateForm" class="card form-card form-row">
          <div class="field"><label>Daire</label><select name="unitId">${units.map((u) => `<option value="${u.id}">${esc(u.block)} - Daire ${esc(u.no)}</option>`).join("")}</select></div>
          <div class="field"><label>Kargo Firması</label><input name="courier" required /></div>
          <div class="field"><label>Takip No</label><input name="trackingNo" /></div>
          <button class="btn btn-primary" type="submit">Kaydet</button>
        </form>`;
      document.getElementById("pkgCreateForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try { await api("/packages", { method: "POST", body: Object.fromEntries(f) }); toast("Kargo kaydedildi."); renderTab("kargo"); }
        catch (err) { toast(err.message); }
      });
    });
    c.querySelectorAll("[data-deliver]").forEach((b) => b.addEventListener("click", async () => { try { await api("/packages/" + b.dataset.deliver + "/deliver", { method: "PATCH" }); renderTab("kargo"); } catch (err) { toast(err.message); } }));
  }
}

function adType(t) { return { yardim: "Yardım", satilik: "Satılık", kayip: "Kayıp", diger: "Diğer" }[t] || t; }

async function renderPano(c) {
  const list = await api("/classifieds");
  c.innerHTML = `
    <div class="flex-between">${sectionTitle("Site Panosu", "Yardımlaşma ve ilan alanı")}<button class="btn btn-ghost btn-sm" id="newAdBtn" style="margin-bottom:16px;">+ İlan Ver</button></div>
    <div id="adForm"></div>
    <div class="grid">${list.map((a) => `
      <div class="card pad mb-16">
        <div class="flex-between"><span class="pill grey">${esc(adType(a.type))}</span><div class="small muted">${dt(a.date)} · ${esc(a.authorName)}</div></div>
        <div style="font-weight:700;margin-top:8px;">${esc(a.title)}</div>
        <p style="font-size:14px;color:var(--steel);margin-top:4px;">${esc(a.description)}</p>
        ${a.resolved ? '<span class="pill green">Tamamlandı</span>' : `<button class="btn btn-ghost btn-sm" data-resolve="${a.id}">Tamamlandı işaretle</button>`}
      </div>`).join("") || '<div class="empty-row">İlan yok.</div>'}</div>
  `;
  document.getElementById("newAdBtn").addEventListener("click", () => {
    document.getElementById("adForm").innerHTML = `
      <form id="adCreateForm" class="card form-card">
        <div class="field"><label>Tür</label><select name="type"><option value="yardim">Yardım Talebi</option><option value="satilik">Satılık Ürün</option><option value="kayip">Kayıp Eşya/Hayvan</option><option value="diger">Diğer</option></select></div>
        <div class="field"><label>Başlık</label><input name="title" required /></div>
        <div class="field"><label>Açıklama</label><textarea name="description" rows="3" required></textarea></div>
        <button class="btn btn-primary btn-sm" type="submit">Yayınla</button>
      </form>`;
    document.getElementById("adCreateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api("/classifieds", { method: "POST", body: Object.fromEntries(f) }); toast("İlan yayınlandı."); renderTab("pano"); }
      catch (err) { toast(err.message); }
    });
  });
  c.querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", async () => { try { await api("/classifieds/" + b.dataset.resolve + "/resolve", { method: "PATCH" }); renderTab("pano"); } catch (err) { toast(err.message); } }));
}

/* ================= MANAGER-ONLY VIEWS ================= */

async function renderManagerOzet(c) {
  const [dash, units] = await Promise.all([api("/dashboard"), api("/units")]);
  c.innerHTML = `
    ${sectionTitle("Genel Özet", "Sitenin genel mali ve operasyonel durumu")}
    <div class="grid cols-3 mb-16">
      <div class="card stat-card clickable" data-goto="kasalar"><div class="stat-label">KASA BAKİYESİ</div><div class="f-num stat-value" style="color:${dash.kasa >= 0 ? "var(--green)" : "var(--red)"};">${tl(dash.kasa)}</div></div>
      <div class="card stat-card clickable" data-goto="tahsilat"><div class="stat-label">TOPLAM ALACAK</div><div class="f-num stat-value" style="color:var(--red);">${tl(dash.totalDebt)}</div></div>
      <div class="card stat-card clickable" data-goto="tahsilat"><div class="stat-label">AİDATI ÖDENEN</div><div class="stat-value">${dash.paidUnits}/${dash.unitCount}</div></div>
    </div>
    <div class="grid cols-3 mb-16">
      <div class="card stat-card clickable" data-goto="talep"><div class="stat-label">AÇIK TALEP</div><div class="stat-value">${dash.openTickets}</div></div>
      <div class="card stat-card clickable" data-goto="kullanicilar"><div class="stat-label">ONAY BEKLEYEN</div><div class="stat-value">${dash.pendingApprovals}</div></div>
      <div class="card stat-card clickable" data-goto="demirbas"><div class="stat-label">BAKIMI GECİKEN</div><div class="stat-value">${dash.overdueEquipment}</div></div>
    </div>
    <div class="card tight">
      <div class="ledger-title">Borcu Bulunan Daireler</div>
      ${units.filter((u) => u.debt > 0).map((u) => ledgerRow(esc(u.block) + " - Daire " + esc(u.no), esc(u.ownerName || ""), tl(u.debt), "var(--red)")).join("") || '<div class="empty-row">Borçlu daire yok.</div>'}
    </div>
  `;
  c.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => goToTab(el.dataset.goto)));
}

// Ozet ekranindaki istatistik kutucuklarindan ilgili sekmeye dogrudan gecis.
function goToTab(tabId) {
  const groups = NAV_GROUPS[state.user.role] || [];
  const owner = groups.find((g) => g.items.some(([id]) => id === tabId));
  if (owner) { if (!expandedGroups) expandedGroups = new Set(); expandedGroups.add(owner.group); }
  state.tab = tabId;
  renderSidebarNav();
  renderTab(tabId);
}

// Yonetimcell karsilastirmasindan: bir dairenin borc+tahsilat hareketlerini
// kronolojik, bakiye takip eden tek bir ekstre olarak gosteren modal
// (Yonetimcell'in uye detayindaki "Hesap Ozeti" tablosunun karsiligi).
async function renderHesapOzetiModal(unit) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(12,32,50,.35);z-index:70;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";
  overlay.innerHTML = `
    <div class="card pad" style="max-width:680px;width:100%;max-height:85vh;overflow-y:auto;">
      <div class="flex-between" style="margin-bottom:2px;">
        <h3 class="f-display" style="margin:0;">${esc(unit.block)} - Daire ${esc(unit.no)}</h3>
        <button class="btn btn-ghost btn-sm" id="hesapOzetiClose">Kapat</button>
      </div>
      <div class="small muted" style="margin-bottom:14px;">Hesap Özeti — kronolojik borç/tahsilat dökümü</div>
      <div id="hesapOzetiBody"><div class="empty-row">Yükleniyor…</div></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#hesapOzetiClose").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  const [charges, payments, creditApps] = await Promise.all([api("/charges?unitId=" + unit.id), api("/payments?unitId=" + unit.id), api("/credit-applications?unitId=" + unit.id)]);
  const entries = [];
  charges.forEach((ch) => entries.push({ date: ch.dueDate, label: `${chargeTypeLabel(ch)} — ${ch.description || ""}`, amount: Number(ch.amount) }));
  payments.filter((p) => !p.cancelled).forEach((p) => entries.push({ date: p.date, label: `Tahsilat (${p.method}) — Makbuz ${p.receiptNo}`, amount: -Number(p.amount) }));
  // Not: alacak uygulamasi (CreditApplication) kosan bakiyeye AYRICA etki
  // etmez - o tutar zaten fazla odemenin yapildigi anda (Payment satirinda)
  // bakiyeyi dusurmustu. Burada sadece "hangi borc ne zaman krediyle
  // kapatildi" seffafligi icin sifir-etkili bilgi satiri olarak gosterilir.
  creditApps.forEach((ca) => entries.push({ date: ca.date, label: "Alacak Bakiyesi Uygulandı (bilgi amaçlı, bakiyeyi değiştirmez)", amount: 0, info: true }));
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  entries.forEach((e) => { if (!e.info) running += e.amount; e.balance = running; });

  // Yonetimcell karsilastirmasi: ust kisimda gider kategorisine gore (Aidat/
  // Demirbas/Su Kullanim Bedeli...) ayri ayri kalan bakiye kirilimi. charge.
  // paidAmount zaten o kaleme yapilan tum tahsis toplamini yansittigi icin
  // (amount - paidAmount) direkt o kategorinin kalan borcunu verir.
  const categoryTotals = new Map();
  charges.forEach((ch) => {
    const label = ch.category ? `${ch.category.group} / ${ch.category.name}` : chargeTypeLabel(ch);
    const remaining = Number(ch.amount) - Number(ch.paidAmount);
    categoryTotals.set(label, (categoryTotals.get(label) || 0) + remaining);
  });

  const body = overlay.querySelector("#hesapOzetiBody");
  if (!entries.length) { body.innerHTML = '<div class="empty-row">Hareket kaydı yok.</div>'; return; }
  const categoryChips = [...categoryTotals.entries()].map(([label, total]) => `
    <div style="flex:0 0 auto;padding:8px 14px;border-right:1px solid var(--line);">
      <div class="small muted" style="white-space:nowrap;">${esc(label)}</div>
      <div class="f-num" style="font-weight:600;color:${total > 0 ? "var(--red)" : total < 0 ? "var(--green)" : "var(--mist)"};">${tl(total)}</div>
    </div>`).join("");
  body.innerHTML = `
    <div class="scroll-x" style="display:flex;border:1px solid var(--line);border-radius:8px;margin-bottom:14px;">${categoryChips}</div>
    <div class="scroll-x">
      <table class="simple">
        <thead><tr><th>Tarih</th><th>Açıklama</th><th style="text-align:right;">Tutar</th><th style="text-align:right;">Bakiye</th></tr></thead>
        <tbody>${entries.slice().reverse().map((e) => `
          <tr style="${e.info ? "opacity:.6;" : ""}">
            <td>${dt(e.date)}</td>
            <td>${esc(e.label)}</td>
            <td class="f-num" style="text-align:right;color:${e.info ? "var(--mist)" : e.amount > 0 ? "var(--red)" : "var(--green)"};">${e.info ? "—" : (e.amount > 0 ? "+" : "") + tl(e.amount)}</td>
            <td class="f-num" style="text-align:right;font-weight:600;">${tl(e.balance)}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="small muted" style="margin-top:12px;">Güncel bakiye: <b style="color:${running > 0 ? "var(--red)" : "var(--green)"};">${tl(running)}</b>${running > 0 ? " (borçlu)" : running < 0 ? " (alacaklı)" : " (borcu yok)"}</div>
  `;
}

// Yonetimcell karsilastirmasi: Firma/Personel detay sayfasindaki "Hesap
// Hareketleri" - unit'lerin Hesap Özeti'yle ayni kosan-bakiyeli desen,
// PartyCharge/PartyPayment'a uygulanmis hali (Fatura No/Makbuz No dahil).
async function renderPartyHesapHareketleriModal(partyType, partyId, label) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(12,32,50,.35);z-index:70;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";
  overlay.innerHTML = `
    <div class="card pad" style="max-width:680px;width:100%;max-height:85vh;overflow-y:auto;">
      <div class="flex-between" style="margin-bottom:2px;">
        <h3 class="f-display" style="margin:0;">${esc(label)}</h3>
        <button class="btn btn-ghost btn-sm" id="partyHesapClose">Kapat</button>
      </div>
      <div class="small muted" style="margin-bottom:14px;">Hesap Hareketleri — kronolojik borç/ödeme dökümü</div>
      <div id="partyHesapBody"><div class="empty-row">Yükleniyor…</div></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#partyHesapClose").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  const qs = `partyType=${partyType}&partyId=${partyId}`;
  const [charges, payments] = await Promise.all([api("/party-charges?" + qs), api("/party-payments?" + qs)]);
  const entries = [];
  charges.forEach((ch) => entries.push({ date: ch.dueDate, label: `${esc(ch.description || "Borçlandırma")} — Fatura ${esc(ch.invoiceNo)}`, amount: Number(ch.amount) }));
  payments.filter((p) => !p.cancelled).forEach((p) => entries.push({ date: p.date, label: `Ödeme (${esc(p.method)}) — Makbuz ${esc(p.receiptNo)}`, amount: -Number(p.amount) }));
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  entries.forEach((e) => { running += e.amount; e.balance = running; });

  const body = overlay.querySelector("#partyHesapBody");
  if (!entries.length) { body.innerHTML = '<div class="empty-row">Hareket kaydı yok.</div>'; return; }
  body.innerHTML = `
    <div class="scroll-x">
      <table class="simple">
        <thead><tr><th>Tarih</th><th>Açıklama</th><th style="text-align:right;">Tutar</th><th style="text-align:right;">Bakiye</th></tr></thead>
        <tbody>${entries.slice().reverse().map((e) => `
          <tr>
            <td>${dt(e.date)}</td>
            <td>${e.label}</td>
            <td class="f-num" style="text-align:right;color:${e.amount > 0 ? "var(--red)" : "var(--green)"};">${(e.amount > 0 ? "+" : "") + tl(e.amount)}</td>
            <td class="f-num" style="text-align:right;font-weight:600;">${tl(e.balance)}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="small muted" style="margin-top:12px;">Güncel bakiye: <b style="color:${running > 0 ? "var(--red)" : "var(--green)"};">${tl(running)}</b>${running > 0 ? " (borçlu)" : running < 0 ? " (fazla ödenmiş)" : " (borcu yok)"}</div>
  `;
}

// Yonetimcell karsilastirmasi: Uye Listesi'ndeki 3 satir-aksiyonundan biri
// olan "Borc Dokumu" - Hesap Ozeti'nden (tarihce+acik borc birlikte) farkli
// olarak SADECE acik borclari gosterir, yaninda dogrudan Tahsil Et/Sms
// Gonder/Yazdir butonlariyla. Mert'in bu oturumun basindaki asil sikayetiydi.
async function renderBorcDokumuModal(unit) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(12,32,50,.35);z-index:70;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";
  overlay.innerHTML = `
    <div class="card pad" style="max-width:680px;width:100%;max-height:85vh;overflow-y:auto;">
      <div class="flex-between" style="margin-bottom:2px;">
        <h3 class="f-display" style="margin:0;">${esc(unit.block)} - Daire ${esc(unit.no)}</h3>
        <button class="btn btn-ghost btn-sm" id="borcDokumuClose">Kapat</button>
      </div>
      <div class="small muted" style="margin-bottom:14px;">Borç Dökümü — sadece açık borçlar</div>
      <div id="borcDokumuBody"><div class="empty-row">Yükleniyor…</div></div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#borcDokumuClose").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });

  // Yonetimcell karsilastirmasi: ayni malikin (isim/telefon eslesmesiyle,
  // ayri bir Malik tablosu olmadigi icin) birden fazla tasinmazi varsa
  // hepsinin acik borclarini TEK ekranda gosterip secerek (checkbox) tahsil
  // edebilme. "unitsById" secili checkbox'lari daireye gore gruplamak icin.
  const [charges, accounts, related] = await Promise.all([api("/charges?unitId=" + unit.id), api("/accounts"), api(`/units/${unit.id}/related`).catch(() => [])]);
  const unitsById = new Map([[unit.id, unit], ...related.map((u) => [u.id, u])]);
  const relatedCharges = await Promise.all(related.map((u) => api("/charges?unitId=" + u.id)));
  const rows = [
    ...charges.map((c) => ({ ...c, unitId: unit.id })),
    ...relatedCharges.flatMap((list, i) => list.map((c) => ({ ...c, unitId: related[i].id }))),
  ].filter((c) => c.status !== "paid").sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  const isMultiProperty = related.length > 0;

  function selectedTotal() {
    const checked = [...overlay.querySelectorAll('[data-charge-check]:checked')].map((cb) => cb.dataset.chargeCheck);
    return rows.filter((c) => checked.includes(c.id)).reduce((s, c) => s + (Number(c.amount) - Number(c.paidAmount)), 0);
  }
  function updateSelectedTotalUI() {
    const el = overlay.querySelector("#bdSelectedTotal");
    if (el) el.textContent = tl(selectedTotal());
    const btn = overlay.querySelector("#bdCollectBtn");
    if (btn) btn.disabled = selectedTotal() <= 0;
  }

  const totalOpen = rows.reduce((s, c) => s + (Number(c.amount) - Number(c.paidAmount)), 0);
  const totalCredit = [...unitsById.values()].reduce((s, u) => s + (u.creditBalance || 0), 0);
  const netTotal = totalOpen - totalCredit;

  const body = overlay.querySelector("#borcDokumuBody");
  body.innerHTML = `
    ${isMultiProperty ? `<div class="small muted" style="margin-bottom:10px;">Bu malikin ${unitsById.size} taşınmazı bulundu, hepsinin açık borçları aşağıda birlikte listeleniyor.</div>` : ""}
    <div class="scroll-x">
      <table class="simple">
        <thead><tr><th></th>${isMultiProperty ? "<th>Daire</th>" : ""}<th>Vade</th><th>Açıklama</th><th style="text-align:right;">Kalan</th></tr></thead>
        <tbody>${rows.map((c) => {
          const u = unitsById.get(c.unitId);
          return `
          <tr>
            <td><input type="checkbox" data-charge-check="${c.id}" checked /></td>
            ${isMultiProperty ? `<td>${esc(u.block)} - ${esc(u.no)}</td>` : ""}
            <td>${dt(c.dueDate)}</td>
            <td>${esc(chargeTypeLabel(c))}${c.description ? " — " + esc(c.description) : ""}</td>
            <td class="f-num" style="text-align:right;font-weight:600;">${tl(Number(c.amount) - Number(c.paidAmount))}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="${isMultiProperty ? 5 : 4}" class="empty-row">Açık borç kaydı yok.</td></tr>`}</tbody>
      </table>
    </div>
    ${totalCredit > 0 ? `<div class="small" style="margin-top:8px;color:var(--green);">Toplam alacaklı bakiye: ${tl(totalCredit)}</div>` : ""}
    <div class="small muted" style="margin-top:8px;">Toplam net bakiye: <b style="color:${netTotal > 0 ? "var(--red)" : "var(--green)"};">${tl(netTotal)}</b> · Seçilenlerin toplamı: <b id="bdSelectedTotal">${tl(totalOpen)}</b></div>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
      <button class="btn btn-primary btn-sm" id="bdCollectBtn" ${totalOpen <= 0 ? "disabled" : ""}>Seçilenleri Tahsil Et</button>
      <button class="btn btn-ghost btn-sm" id="bdSmsBtn">Sms Gönder</button>
      <button class="btn btn-ghost btn-sm" id="bdPrintBtn">Yazdır (PDF)</button>
    </div>
    <div id="bdCollectForm"></div>
  `;
  // Checkbox'lar hepsi varsayilan "checked" ile geldigi icin ilk deger yukarida
  // totalOpen'dan yazildi (selectedTotal() render aninda DOM'da henuz olusmamis
  // checkbox'lari sorgulardi, hep 0 donerdi) - simdi DOM olustu, dogrulama icin senkronize et.
  updateSelectedTotalUI();

  body.querySelectorAll("[data-charge-check]").forEach((cb) => cb.addEventListener("change", updateSelectedTotalUI));

  body.querySelector("#bdCollectBtn").addEventListener("click", () => {
    const box = body.querySelector("#bdCollectForm");
    box.innerHTML = `
      <form class="form-row" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">
        <div class="field"><label>Ödenecek Toplam (₺)</label><input value="${selectedTotal()}" disabled /></div>
        <div class="field"><label>Hesap</label><select name="accountId">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        <button class="btn btn-primary btn-sm" type="submit">Kaydet</button>
        ${isMultiProperty ? '<span class="small muted">Birden fazla daireden seçim yaptıysanız, her daire için ayrı bir tahsilat kaydı (ayrı makbuz) oluşturulur.</span>' : ""}
      </form>`;
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const accountId = new FormData(e.target).get("accountId");
      const checked = [...overlay.querySelectorAll('[data-charge-check]:checked')].map((cb) => cb.dataset.chargeCheck);
      const selectedRows = rows.filter((c) => checked.includes(c.id));
      const byUnit = new Map();
      selectedRows.forEach((c) => {
        if (!byUnit.has(c.unitId)) byUnit.set(c.unitId, []);
        byUnit.get(c.unitId).push(c);
      });
      try {
        for (const [uId, list] of byUnit) {
          const amount = list.reduce((s, c) => s + (Number(c.amount) - Number(c.paidAmount)), 0);
          if (amount <= 0) continue;
          await api("/payments/pay", { method: "POST", body: { unitId: uId, amount, method: "Elden", accountId, requestId: crypto.randomUUID(), chargeIds: list.map((c) => c.id) } });
        }
        toast("Tahsilat kaydedildi.");
        overlay.remove();
        renderTab(state.tab);
      } catch (err) { toast(err.message); }
    });
  });
  body.querySelector("#bdSmsBtn").addEventListener("click", async () => {
    try { const r = await api(`/units/${unit.id}/borc-sms`, { method: "POST" }); toast(r.message); }
    catch (err) { toast(err.message); }
  });
  body.querySelector("#bdPrintBtn").addEventListener("click", () => downloadFile(`/documents/borc-dokumu/${unit.id}`, `borc-dokumu-${unit.block}-${unit.no}.pdf`));
}

function daysSince(d) { return Math.floor((Date.now() - new Date(d).getTime()) / 86400000); }

async function renderKullanicilar(c) {
  const list = await api("/users");
  const pending = list.filter((u) => !u.isApproved);
  const approved = list.filter((u) => u.isApproved);
  const resetRequests = approved.filter((u) => u.resetRequestedAt);
  c.innerHTML = `
    ${sectionTitle("Kullanıcılar")}
    ${pending.length ? `<div class="card tight mb-16"><div class="ledger-title">Onay Bekleyenler</div>${pending.map((u) => {
      const days = daysSince(u.createdAt);
      return `<div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(u.name)} ${days >= 3 ? '<span class="pill red"><span class="dot"></span>Gecikti</span>' : ""}</div><div class="small muted">${esc(u.email)} · ${esc(u.unitLabel || "-")} · ${days === 0 ? "bugün" : days + " gündür bekliyor"}</div></div>
      <div style="display:flex;gap:8px;"><button class="btn btn-primary btn-sm" data-approve="${u.id}">Onayla</button><button class="btn-danger" data-deluser="${u.id}">Reddet</button></div></div>`;
    }).join("")}</div>` : ""}
    ${resetRequests.length ? `<div class="card tight mb-16"><div class="ledger-title">Şifre Sıfırlama Talepleri</div>${resetRequests.map((u) => `
      <div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(u.name)}</div><div class="small muted">${esc(u.email)} · Talep: ${dt(u.resetRequestedAt)}</div></div>
      <button class="btn btn-primary btn-sm" data-reset="${u.id}">Geçici Şifre Oluştur</button></div>`).join("")}</div>` : ""}
    <div class="card tight mb-16"><div class="ledger-title">Sakinler &amp; Personel</div>${approved.map((u) => `
      <div class="ledger-row" style="${u.isActive === false ? "opacity:.55;" : ""}"><div><div style="font-size:14px;font-weight:600;">${esc(u.name)} ${u.role === "yonetici" ? "👑" : ""} ${u.isActive === false ? pill("Pasif") : ""}</div><div class="small muted">${esc(u.email)} · ${u.role === "sakin" ? esc(u.unitLabel || "-") : u.role === "personel" ? esc(u.department || "Personel") : "Yönetici"}</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn btn-ghost btn-sm" data-edit="${u.id}">Düzenle</button>${u.role !== "yonetici" ? `<button class="btn btn-ghost btn-sm" data-reset="${u.id}">Şifre Sıfırla</button>` : ""}${u.role !== "yonetici" && u.id !== state.user.id ? (u.isActive === false ? `<button class="btn btn-ghost btn-sm" data-reactivate="${u.id}">Aktif Et</button>` : `<button class="btn btn-ghost btn-sm" data-deactivate="${u.id}">Pasife Al</button>`) : ""}${u.id !== state.user.id ? `<button class="btn-danger" data-deluser="${u.id}">Kalıcı Sil</button>` : ""}</div></div>`).join("")}</div>
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Personel Ekle</div>
      <form id="perForm" class="form-row">
        <div class="field"><label>Ad Soyad</label><input name="name" required /></div>
        <div class="field"><label>E-posta</label><input type="email" name="email" required /></div>
        <div class="field"><label>Telefon</label><input name="phone" /></div>
        <div class="field"><label>Departman</label><input name="department" placeholder="Temizlik, Güvenlik, Bakım…" /></div>
        <div class="field"><label>Şifre</label><input type="password" name="password" required minlength="8" /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
  `;
  c.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", async () => { try { await api("/users/" + b.dataset.approve + "/approve", { method: "PATCH" }); toast("Kullanıcı onaylandı."); renderTab("kullanicilar"); } catch (err) { toast(err.message); } }));
  c.querySelectorAll("[data-deluser]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Kalıcı olarak silinsin mi? Bu işlem geri alınamaz, geçmiş kayıtlar için 'Pasife Al' seçeneğini kullanmanız önerilir.")) return; try { await api("/users/" + b.dataset.deluser, { method: "DELETE" }); renderTab("kullanicilar"); } catch (err) { toast(err.message); } }));
  c.querySelectorAll("[data-deactivate]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Kullanıcı pasife alınsın mı? Geçmiş kayıtları korunur, sadece giriş yapamaz hale gelir.")) return; try { await api("/users/" + b.dataset.deactivate + "/deactivate", { method: "PATCH" }); toast("Kullanıcı pasife alındı."); renderTab("kullanicilar"); } catch (err) { toast(err.message); } }));
  c.querySelectorAll("[data-reactivate]").forEach((b) => b.addEventListener("click", async () => { try { await api("/users/" + b.dataset.reactivate + "/reactivate", { method: "PATCH" }); toast("Kullanıcı aktif edildi."); renderTab("kullanicilar"); } catch (err) { toast(err.message); } }));
  c.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => {
    const u = list.find((x) => x.id === b.dataset.edit);
    if (u) renderUserEditModal(u);
  }));
  c.querySelectorAll("[data-reset]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Bu kullanıcı için geçici bir şifre oluşturulsun mu?")) return;
    try {
      const r = await api("/users/" + b.dataset.reset + "/reset-password", { method: "POST" });
      alert(`Geçici şifre: ${r.tempPassword}\n\nBu şifreyi güvenli bir kanaldan (telefon, elden) kullanıcıya iletin. İlk girişte kendi şifresini belirlemesi istenecektir.`);
      renderTab("kullanicilar");
    } catch (err) { toast(err.message); }
  }));
  document.getElementById("perForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/users/personnel", { method: "POST", body: Object.fromEntries(f) }); toast("Personel eklendi."); renderTab("kullanicilar"); }
    catch (err) { toast(err.message); }
  });
}

async function renderDaireler(c) {
  const list = await api("/units");
  c.innerHTML = `
    ${sectionTitle("Daireler")}
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Daire Ekle</div>
      <form id="unitForm" class="form-row">
        <div class="field"><label>Blok</label><input name="block" required /></div>
        <div class="field"><label>Daire No</label><input name="no" required /></div>
        <div class="field"><label>Kat</label><input name="floor" type="number" /></div>
        <div class="field"><label>Malik Adı</label><input name="ownerName" /></div>
        <div class="field"><label>Malik Telefon</label><input name="ownerPhone" /></div>
        <div class="field"><label>Arsa Payı</label><input name="landShare" type="number" step="0.0001" placeholder="Örn. 0.0125" /></div>
        <div class="field"><label>Metrekare (m²)</label><input name="squareMeters" type="number" step="0.01" /></div>
        <div class="field"><label>Aidat Grubu</label><input name="feeGroup" placeholder="Örn. 2+1, Villa…" /></div>
        <div class="field"><label>İkamet Durumu</label><select name="occupancy"><option value="owner">Malik Oturuyor</option><option value="tenant">Kiracı Oturuyor</option><option value="vacant">Boş</option></select></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
    <div class="card tight">
      ${list.map((u) => `
        <div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(u.block)} - Daire ${esc(u.no)} ${u.occupancy === "vacant" ? pill("Boş") : ""}</div><div class="small muted">${esc(u.ownerName || "-")}${u.tenantName ? " (Kiracı: " + esc(u.tenantName) + ")" : ""}${u.feeGroup ? " · " + esc(u.feeGroup) : ""}${u.landShare ? " · Arsa Payı: " + esc(String(u.landShare)) : ""}${u.squareMeters ? " · " + esc(String(u.squareMeters)) + " m²" : ""}</div></div>
        <div style="display:flex;align-items:center;gap:10px;"><div class="f-num" style="color:${debtColor(u.debt)};font-weight:600;">${tl(Math.abs(u.debt))}</div>${pill(debtStatusLabel(u.debt))}<button class="btn btn-ghost btn-sm" data-ozet="${u.id}" title="Hesap Özeti">📄</button><button class="btn btn-ghost btn-sm" data-borcdokumu="${u.id}" title="Borç Dökümü">📋</button><button class="btn btn-ghost btn-sm" data-editunit="${u.id}">Düzenle</button></div></div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("unitForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/units", { method: "POST", body: Object.fromEntries(f) }); toast("Daire eklendi."); renderTab("daireler"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-ozet]").forEach((b) => b.addEventListener("click", () => {
    const u = list.find((x) => x.id === b.dataset.ozet);
    if (u) renderHesapOzetiModal(u);
  }));
  c.querySelectorAll("[data-borcdokumu]").forEach((b) => b.addEventListener("click", () => {
    const u = list.find((x) => x.id === b.dataset.borcdokumu);
    if (u) renderBorcDokumuModal(u);
  }));
  c.querySelectorAll("[data-editunit]").forEach((b) => b.addEventListener("click", () => {
    const u = list.find((x) => x.id === b.dataset.editunit);
    if (u) renderUnitEditModal(u);
  }));
}

const HOUSEHOLD_RELATIONSHIPS = ["Kendisi", "Eş", "Çocuk", "Anne", "Baba", "Kardeş", "Kiracı", "Ev Arkadaşı", "Misafir", "Diğer"];

async function renderUnitEditModal(u) {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(12,32,50,.35);z-index:70;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;";
  overlay.innerHTML = `
    <div class="card pad" style="max-width:460px;width:100%;">
      <h3 class="f-display" style="margin:0 0 12px;">${esc(u.block)} - Daire ${esc(u.no)}</h3>
      <form id="unitEditForm" class="form-row">
        <div class="field" style="flex:1 1 140px;"><label>Malik Adı</label><input name="ownerName" value="${esc(u.ownerName || "")}" /></div>
        <div class="field" style="flex:1 1 140px;"><label>Malik Telefon</label><input name="ownerPhone" value="${esc(u.ownerPhone || "")}" /></div>
        <div class="field" style="flex:1 1 140px;"><label>Kiracı Adı</label><input name="tenantName" value="${esc(u.tenantName || "")}" /></div>
        <div class="field" style="flex:1 1 140px;"><label>Kiracı Telefon</label><input name="tenantPhone" value="${esc(u.tenantPhone || "")}" /></div>
        <div class="field" style="flex:1 1 140px;"><label>Arsa Payı</label><input name="landShare" type="number" step="0.0001" value="${u.landShare != null ? esc(String(u.landShare)) : ""}" /></div>
        <div class="field" style="flex:1 1 140px;"><label>Metrekare (m²)</label><input name="squareMeters" type="number" step="0.01" value="${u.squareMeters != null ? esc(String(u.squareMeters)) : ""}" /></div>
        <div class="field" style="flex:1 1 140px;"><label>Aidat Grubu</label><input name="feeGroup" value="${esc(u.feeGroup || "")}" /></div>
        <div class="field" style="flex:1 1 140px;"><label>İkamet Durumu</label><select name="occupancy"><option value="owner" ${u.occupancy === "owner" ? "selected" : ""}>Malik Oturuyor</option><option value="tenant" ${u.occupancy === "tenant" ? "selected" : ""}>Kiracı Oturuyor</option><option value="vacant" ${u.occupancy === "vacant" ? "selected" : ""}>Boş</option></select></div>
        <div style="display:flex;gap:8px;margin-top:4px;width:100%;">
          <button type="button" class="btn btn-ghost" id="unitEditCancel" style="flex:1;">Kapat</button>
          <button type="submit" class="btn btn-primary" style="flex:1;">Kaydet</button>
        </div>
      </form>
      <div class="ledger-title" style="padding-top:18px;">İkamet Edenler</div>
      <div id="householdList" class="small muted">Yükleniyor…</div>
      <form id="householdForm" class="form-row" style="margin-top:10px;">
        <div class="field" style="flex:1 1 120px;"><label>Ad Soyad</label><input name="name" required /></div>
        <div class="field" style="flex:1 1 100px;"><label>Yakınlık</label><select name="relationship">${HOUSEHOLD_RELATIONSHIPS.map((r) => `<option value="${r}">${r}</option>`).join("")}</select></div>
        <div class="field" style="flex:1 1 100px;"><label>Telefon</label><input name="phone" /></div>
        <button class="btn btn-ghost btn-sm" type="submit">Ekle</button>
      </form>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#unitEditCancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#unitEditForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/units/" + u.id, { method: "PATCH", body: Object.fromEntries(f) });
      toast("Daire bilgileri güncellendi.");
      overlay.remove();
      renderTab("daireler");
    } catch (err) { toast(err.message); }
  });

  async function loadHousehold() {
    const members = await api("/units/" + u.id + "/household");
    const box = overlay.querySelector("#householdList");
    box.innerHTML = members.length
      ? members.map((m) => `<div class="ledger-row" style="padding:6px 0;${m.isCurrent ? "" : "opacity:.5;"}"><div><div style="font-size:13px;font-weight:600;">${esc(m.name)} ${m.isCurrent ? "" : "(Eski Sakin)"}</div><div class="small muted">${esc(m.relationship)}${m.phone ? " · " + esc(m.phone) : ""}</div></div><div style="display:flex;gap:6px;">${m.isCurrent ? `<button class="btn btn-ghost btn-sm" data-moveout="${m.id}">Taşındı</button>` : ""}<button class="btn-danger" data-delhousehold="${m.id}">Sil</button></div></div>`).join("")
      : '<div class="empty-row" style="padding:4px 0;">Kayıtlı ikamet eden yok.</div>';
    box.querySelectorAll("[data-moveout]").forEach((b) => b.addEventListener("click", async () => {
      try { await api("/household/" + b.dataset.moveout + "/move-out", { method: "PATCH" }); loadHousehold(); } catch (err) { toast(err.message); }
    }));
    box.querySelectorAll("[data-delhousehold]").forEach((b) => b.addEventListener("click", async () => {
      try { await api("/household/" + b.dataset.delhousehold, { method: "DELETE" }); loadHousehold(); } catch (err) { toast(err.message); }
    }));
  }
  loadHousehold();

  overlay.querySelector("#householdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api("/units/" + u.id + "/household", { method: "POST", body: Object.fromEntries(f) });
      e.target.reset();
      loadHousehold();
    } catch (err) { toast(err.message); }
  });
}

async function renderTahsilat(c) {
  const [units, accounts, payments, categories, expenseCategories] = await Promise.all([api("/units"), api("/accounts"), api("/payments"), api("/charge-categories"), api("/expense-categories")]);
  const expenseCategoryOptions = `<option value="">Yok (sadece serbest metin)</option>` + expenseCategories.map((cat) => `<option value="${cat.id}">${esc(cat.group)} / ${esc(cat.name)}</option>`).join("");
  c.innerHTML = `
    <div class="flex-between">${sectionTitle("Aidat Takibi")}<div style="display:flex;gap:8px;margin-bottom:16px;"><button class="btn btn-ghost btn-sm" id="printListBtn">🖨️ Borç Listesi Yazdır (PDF)</button><button class="btn btn-ghost btn-sm" id="csvListBtn">📊 Excel'e Aktar (CSV)</button></div></div>
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Aylık Aidat Borçlandır</div>
      <form id="genForm" class="form-row">
        <div class="field"><label>Dönem (YYYY-AA)</label><input name="period" placeholder="2026-09" required /></div>
        <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" required /></div>
        <button class="btn btn-primary" type="submit">Tüm Dairelere Uygula</button>
      </form>
    </div>
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Özel Borçlandırma (tek daire, serbest kategori)</div>
      <div class="small muted" style="margin-top:-4px;margin-bottom:10px;">Demirbaş, su kullanım bedeli gibi kalemler için "Gider Kategorisi"ni seçin — Giderler ekranındaki firma/personel faturalarıyla aynı kategori listesini paylaşır, raporlarda birlikte kırılım alabilirsiniz. Kategori seçmeden de serbest metinle borçlandırabilirsiniz.</div>
      <form id="manualChargeForm" class="form-row">
        <div class="field" style="flex:1 1 200px;"><label>Daire</label><select name="unitId">${units.map((u) => `<option value="${u.id}">${esc(u.block)} - Daire ${esc(u.no)}</option>`).join("")}</select></div>
        <div class="field" style="flex:1 1 200px;"><label>Gider Kategorisi</label><select name="categoryId">${expenseCategoryOptions}</select></div>
        <div class="field" style="flex:1 1 160px;"><label>Kategori (serbest metin)</label><input name="type" list="chargeCategoryList" placeholder="Kategori seçtiyseniz boş bırakabilirsiniz" /><datalist id="chargeCategoryList">${categories.map((cat) => `<option value="${esc(cat)}"></option>`).join("")}</datalist></div>
        <div class="field" style="flex:0 0 140px;"><label>Tutar (₺)</label><input name="amount" type="number" min="0.01" step="0.01" required /></div>
        <div class="field" style="flex:1 1 220px;"><label>Açıklama</label><input name="description" /></div>
        <button class="btn btn-ghost btn-sm" type="submit">Borçlandır</button>
      </form>
    </div>
    <div class="card pad mb-16" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field" style="margin-bottom:0;flex:1 1 220px;"><label>Tahsilatın işleneceği hesap</label><select id="collectAccount">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
      <div class="field" style="margin-bottom:0;flex:1 1 220px;"><label>Borç durumu</label>
        <select id="debtFilter">
          <option value="0">Tümü</option>
          <option value="1">Borcu olan</option>
          <option value="500">500 ₺ ve daha fazla borcu olan</option>
          <option value="1000">1.000 ₺ ve daha fazla borcu olan</option>
          <option value="2000">2.000 ₺ ve daha fazla borcu olan</option>
          <option value="5000">5.000 ₺ ve daha fazla borcu olan</option>
        </select>
      </div>
    </div>
    <div class="card tight mb-16" id="unitsListBox"></div>
    <div class="card tight">
      <div class="ledger-title">Son Tahsilatlar</div>
      ${payments.slice(0, 15).map((p) => {
        const u = units.find((x) => x.id === p.unitId);
        const label = u ? `${u.block} - Daire ${u.no}` : "-";
        return `<div class="ledger-row" style="${p.cancelled ? "opacity:.5;" : ""}">
          <div><div style="font-size:14px;font-weight:600;">${esc(label)} ${p.cancelled ? "(İptal edildi)" : ""}</div><div class="small muted">${p.method} · ${p.receiptNo} · ${dt(p.date)}</div></div>
          <div style="display:flex;align-items:center;gap:10px;"><span class="f-num" style="font-weight:600;${p.cancelled ? "text-decoration:line-through;" : "color:var(--green);"}">+${tl(p.amount)}</span>${!p.cancelled ? `<button class="btn-danger" data-cancel-payment="${p.id}">İptal Et</button>` : ""}</div>
        </div>`;
      }).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("printListBtn").addEventListener("click", () => downloadFile("/documents/debt-list", "aidat-borc-listesi.pdf"));
  document.getElementById("csvListBtn").addEventListener("click", () => downloadFile("/documents/debt-list.csv", "aidat-borc-listesi.csv"));
  document.getElementById("genForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { const r = await api("/charges/generate-month", { method: "POST", body: Object.fromEntries(f) }); toast(r.message); renderTab("tahsilat"); }
    catch (err) { toast(err.message); }
  });
  document.getElementById("manualChargeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/charges", { method: "POST", body: Object.fromEntries(f) }); toast("Borçlandırma eklendi."); renderTab("tahsilat"); }
    catch (err) { toast(err.message); }
  });

  // Yönetimcell karşılaştırmasından: borç eşiği filtresi (birçok ekranda
  // tekrar eden bir kalıp - "1.000 ₺ ve daha fazla borcu olan" gibi).
  function renderUnitsListBox() {
    const threshold = Number(document.getElementById("debtFilter").value || 0);
    const filtered = threshold <= 0 ? units : threshold === 1 ? units.filter((u) => u.debt > 0) : units.filter((u) => u.debt >= threshold);
    const box = document.getElementById("unitsListBox");
    box.innerHTML = filtered.map((u) => `
        <div class="ledger-row" style="flex-wrap:wrap;">
          <div><div style="font-size:14px;font-weight:600;">${esc(u.block)} - Daire ${esc(u.no)}</div><div class="small muted">${esc(u.ownerName || "-")}</div></div>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span class="f-num" style="font-weight:600;color:${debtColor(u.debt)};">${tl(Math.abs(u.debt))}</span>${pill(debtStatusLabel(u.debt))}<button class="btn btn-ghost btn-sm" data-ozet="${u.id}" title="Hesap Özeti">📄</button><button class="btn btn-ghost btn-sm" data-borcdokumu="${u.id}" title="Borç Dökümü">📋</button>${u.creditBalance > 0 ? `<button class="btn btn-ghost btn-sm" data-applycredit="${u.id}" title="Alacaklı bakiyeyi (${tl(u.creditBalance)}) açık borca uygula">💳 Krediyi Uygula</button>` : ""}${u.debt > 0 ? `<button class="btn btn-ghost btn-sm" data-collect="${u.id}">Tahsil Et</button>` : ""}</div>
          <div style="width:100%;" id="collect-form-${u.id}"></div>
        </div>`).join("") || '<div class="empty-row">Bu filtreye uyan daire yok.</div>';
    box.querySelectorAll("[data-ozet]").forEach((b) => b.addEventListener("click", () => {
      const u = units.find((x) => x.id === b.dataset.ozet);
      if (u) renderHesapOzetiModal(u);
    }));
    box.querySelectorAll("[data-borcdokumu]").forEach((b) => b.addEventListener("click", () => {
      const u = units.find((x) => x.id === b.dataset.borcdokumu);
      if (u) renderBorcDokumuModal(u);
    }));
    box.querySelectorAll("[data-applycredit]").forEach((b) => b.addEventListener("click", async () => {
      try { const r = await api("/units/" + b.dataset.applycredit + "/apply-credit", { method: "POST" }); toast(r.message); renderTab("tahsilat"); }
      catch (err) { toast(err.message); }
    }));
    box.querySelectorAll("[data-collect]").forEach((b) => b.addEventListener("click", () => {
      const unitId = b.dataset.collect;
      const unit = units.find((u) => u.id === unitId);
      const formBox = document.getElementById("collect-form-" + unitId);
      formBox.innerHTML = `
        <form class="form-row" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;width:100%;">
          <div class="field"><label>Tahsil Edilecek Tutar (₺)</label><input name="amount" type="number" value="${unit.debt}" max="${unit.debt}" min="0.01" step="0.01" required /></div>
          <button class="btn btn-primary btn-sm" type="submit">Tahsilatı Kaydet</button>
          <span class="small muted">Borcun tamamından azını girerek kısmi tahsilat yapabilirsiniz.</span>
        </form>`;
      formBox.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const amount = Number(new FormData(e.target).get("amount"));
        const accountId = document.getElementById("collectAccount").value;
        try { await api("/payments/pay", { method: "POST", body: { unitId, amount, method: "Elden", accountId, requestId: crypto.randomUUID() } }); toast("Tahsilat kaydedildi."); renderTab("tahsilat"); }
        catch (err) { toast(err.message); }
      });
    }));
  }
  renderUnitsListBox();
  document.getElementById("debtFilter").addEventListener("change", renderUnitsListBox);

  c.querySelectorAll("[data-cancel-payment]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Bu ödeme iptal edilsin mi? İlgili borç yeniden açılacaktır.")) return;
    try { await api("/payments/" + b.dataset.cancelPayment + "/cancel", { method: "POST" }); toast("Ödeme iptal edildi."); renderTab("tahsilat"); }
    catch (err) { toast(err.message); }
  }));
}

async function renderMuhasebe(c) {
  const [transactions, accounts] = await Promise.all([api("/transactions"), api("/accounts")]);
  const accName = (id) => accounts.find((a) => a.id === id)?.name || "-";
  const income = transactions.filter((t) => t.type === "gelir").reduce((s, t) => s + t.amount, 0);
  const expense = transactions.filter((t) => t.type === "gider").reduce((s, t) => s + t.amount, 0);
  // Ay etiketiyle birlikte gercek siralama anahtari (yyyy-mm) da tutulur; boylece
  // grafik islem ekleme sirasina degil, takvim sirasina (eskiden yeniye) gore cizilir.
  const byMonth = {};
  transactions.forEach((t) => {
    const d = new Date(t.date);
    const sortKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("tr-TR", { month: "short", year: "2-digit" });
    if (!byMonth[sortKey]) byMonth[sortKey] = { label, gelir: 0, gider: 0 };
    byMonth[sortKey][t.type] += t.amount;
  });
  const months = Object.keys(byMonth).sort().slice(-6);
  const maxVal = Math.max(1, ...months.flatMap((m) => [byMonth[m].gelir, byMonth[m].gider]));
  c.innerHTML = `
    ${sectionTitle("Muhasebe")}
    <div class="flex-between mb-16"><div></div><button class="btn btn-ghost btn-sm" id="newTxnBtn">+ Hareket Ekle</button></div>
    <div id="txnForm"></div>
    <div class="grid cols-2 mb-16">
      <div class="card stat-card"><div class="stat-label">TOPLAM GELİR</div><div class="f-num stat-value" style="color:var(--green);">${tl(income)}</div></div>
      <div class="card stat-card"><div class="stat-label">TOPLAM GİDER</div><div class="f-num stat-value" style="color:var(--red);">${tl(expense)}</div></div>
    </div>
    <div class="card pad mb-16">
      <div class="ledger-title" style="padding:0 0 10px;">Aylık Gelir / Gider</div>
      <div style="display:flex;align-items:flex-end;gap:14px;height:160px;overflow-x:auto;">
        ${months.map((m) => `
          <div style="flex:0 0 auto;text-align:center;min-width:44px;">
            <div style="display:flex;align-items:flex-end;gap:3px;height:130px;justify-content:center;">
              <div title="Gelir ${tl(byMonth[m].gelir)}" style="width:14px;background:var(--green);height:${(byMonth[m].gelir / maxVal) * 130}px;border-radius:3px 3px 0 0;"></div>
              <div title="Gider ${tl(byMonth[m].gider)}" style="width:14px;background:var(--red);height:${(byMonth[m].gider / maxVal) * 130}px;border-radius:3px 3px 0 0;"></div>
            </div>
            <div class="small muted" style="margin-top:4px;">${byMonth[m].label}</div>
          </div>`).join("")}
      </div>
    </div>
    <div class="card tight">
      <div class="ledger-title">Hareket Dökümü</div>
      ${transactions.slice(0, 25).map((t) => `
        <div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(t.category)}</div><div class="small muted">${esc(t.description)} · ${accName(t.accountId)} · ${dt(t.date)}</div></div>
        <div style="display:flex;align-items:center;gap:8px;"><span class="f-num" style="font-weight:600;color:${t.type === "gelir" ? "var(--green)" : "var(--red)"};">${t.type === "gelir" ? "+" : "-"}${tl(t.amount)}</span><button class="btn-danger" data-deltxn="${t.id}">Sil</button></div></div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("newTxnBtn").addEventListener("click", () => {
    document.getElementById("txnForm").innerHTML = `
      <form id="txnCreateForm" class="card form-card form-row">
        <div class="field"><label>Tür</label><select name="type"><option value="gider">Gider</option><option value="gelir">Gelir</option></select></div>
        <div class="field"><label>Kategori</label><input name="category" required placeholder="Temizlik, Güvenlik…" /></div>
        <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" required /></div>
        <div class="field"><label>Hesap</label><select name="accountId">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        <div class="field" style="flex:2 1 200px;"><label>Açıklama</label><input name="description" required /></div>
        <button class="btn btn-primary" type="submit">Kaydet</button>
      </form>`;
    document.getElementById("txnCreateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api("/transactions", { method: "POST", body: Object.fromEntries(f) }); toast("Hareket kaydedildi."); renderTab("muhasebe"); }
      catch (err) { toast(err.message); }
    });
  });
  c.querySelectorAll("[data-deltxn]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("Silinsin mi?")) return; try { await api("/transactions/" + b.dataset.deltxn, { method: "DELETE" }); renderTab("muhasebe"); } catch (err) { toast(err.message); } }));
}

async function renderKasalar(c) {
  const accounts = await api("/accounts");
  const totalBalance = accounts.reduce((s, a) => s + a.balance, 0);
  const typeLabel = { banka: "Banka", nakit: "Nakit", pos: "POS/Kredi Kartı", diger: "Diğer" };
  c.innerHTML = `
    <div class="flex-between">${sectionTitle("Kasalar", "Banka, nakit ve POS hesaplarının ayrı ayrı takibi")}<button class="btn btn-ghost btn-sm" id="transferBtn" style="margin-bottom:16px;">⇄ Hesaplar Arası Transfer</button></div>
    <div id="transferForm"></div>
    <div class="card pad mb-16">
      <div class="stat-label">TOPLAM KASA BAKİYESİ</div>
      <div class="f-num stat-value" style="color:${totalBalance >= 0 ? "var(--green)" : "var(--red)"};font-size:28px;">${tl(totalBalance)}</div>
    </div>
    <div class="grid" id="accountsGrid">
      ${accounts.map((a) => `
        <div class="card pad mb-16">
          <div class="flex-between">
            <div>
              <div style="font-weight:700;">${esc(a.name)}</div>
              <div class="small muted">${typeLabel[a.type] || a.type}${a.bankName ? " · " + esc(a.bankName) : ""}${a.iban ? " · " + esc(a.iban) : ""}</div>
            </div>
            <div class="f-num" style="font-weight:600;font-size:17px;color:${a.balance >= 0 ? "var(--green)" : "var(--red)"};">${tl(a.balance)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" style="margin-top:10px;" data-ledger="${a.id}">Hesap Ekstresi</button>
          <div id="ledger-${a.id}" style="margin-top:10px;"></div>
        </div>`).join("")}
    </div>
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Kasa/Hesap Ekle</div>
      <form id="accForm" class="form-row">
        <div class="field"><label>Ad</label><input name="name" required placeholder="Garanti BBVA Hesabı…" /></div>
        <div class="field"><label>Tür</label><select name="type"><option value="banka">Banka</option><option value="nakit">Nakit</option><option value="pos">POS/Kredi Kartı</option><option value="diger">Diğer</option></select></div>
        <div class="field"><label>Banka Adı</label><input name="bankName" /></div>
        <div class="field"><label>IBAN</label><input name="iban" /></div>
        <div class="field"><label>Açılış Bakiyesi (₺)</label><input name="openingBalance" type="number" value="0" /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
  `;
  document.getElementById("accForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/accounts", { method: "POST", body: Object.fromEntries(f) }); toast("Hesap eklendi."); renderTab("kasalar"); }
    catch (err) { toast(err.message); }
  });
  document.getElementById("transferBtn").addEventListener("click", () => {
    document.getElementById("transferForm").innerHTML = `
      <form id="transferCreateForm" class="card form-card form-row">
        <div class="field"><label>Kaynak Hesap</label><select name="fromAccountId">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Hedef Hesap</label><select name="toAccountId">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" required /></div>
        <div class="field" style="flex:2 1 200px;"><label>Açıklama</label><input name="description" placeholder="Nakit tahsilatın bankaya yatırılması…" /></div>
        <button class="btn btn-primary" type="submit">Transfer Et</button>
      </form>`;
    document.getElementById("transferCreateForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api("/accounts/transfer", { method: "POST", body: Object.fromEntries(f) }); toast("Transfer tamamlandı."); renderTab("kasalar"); }
      catch (err) { toast(err.message); }
    });
  });
  c.querySelectorAll("[data-ledger]").forEach((b) => b.addEventListener("click", async () => {
    const box = document.getElementById("ledger-" + b.dataset.ledger);
    if (box.dataset.open === "1") { box.innerHTML = ""; box.dataset.open = "0"; return; }
    try {
      const { rows } = await api("/accounts/" + b.dataset.ledger + "/ledger");
      box.dataset.open = "1";
      box.innerHTML = `<div class="card tight" style="margin-top:6px;">${rows.slice(0, 20).map((r) => ledgerRow(esc(r.label), esc(r.description || "") + " · " + dt(r.date), (r.amount >= 0 ? "+" : "") + tl(r.amount), r.amount >= 0 ? "var(--green)" : "var(--red)")).join("") || '<div class="empty-row">Hareket yok.</div>'}</div>`;
    } catch (err) { toast(err.message); }
  }));
}

async function renderCari(c) {
  const [vendors, personnel, charges, accounts, categories] = await Promise.all([api("/vendors"), api("/personnel"), api("/party-charges"), api("/accounts"), api("/expense-categories")]);
  const personnelDebt = (id) => charges.filter((ch) => ch.partyType === "personel" && ch.partyId === id && ch.status !== "paid").reduce((s, ch) => s + (ch.amount - ch.paidAmount), 0);
  const categoryOptions = `<option value="">Kategori seçin (opsiyonel)</option>` + categories.map((cat) => `<option value="${cat.id}">${esc(cat.group)} / ${esc(cat.name)}</option>`).join("");

  const partyNameMap = new Map();
  function partyCard(name, sub, debt, partyType, partyId) {
    partyNameMap.set(`${partyType}|${partyId}`, name);
    return `
      <div class="card pad mb-16">
        <div class="flex-between">
          <div><div style="font-weight:700;">${esc(name)}</div><div class="small muted">${esc(sub)}</div></div>
          <div class="f-num" style="font-weight:600;color:${debt > 0 ? "var(--red)" : "var(--green)"};">${tl(debt)}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-charge="${partyType}|${partyId}">+ Borçlandır</button>
          ${debt > 0 ? `<button class="btn btn-ghost btn-sm" data-pay="${partyType}|${partyId}|${debt}">Öde</button>` : ""}
          <button class="btn btn-ghost btn-sm" data-hesap="${partyType}|${partyId}" title="Hesap Hareketleri">📄 Hesap Hareketleri</button>
        </div>
        <div id="cari-action-${partyType}-${partyId}"></div>
      </div>`;
  }

  c.innerHTML = `
    ${sectionTitle("Firma & Personel Cari Hesap", "Tedarikçi ve personel borç/ödeme takibi")}
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Firma Ekle</div>
      <form id="vendorForm" class="form-row">
        <div class="field"><label>Firma Adı</label><input name="name" required /></div>
        <div class="field"><label>Kategori</label><input name="category" placeholder="Asansör, Temizlik, Güvenlik…" /></div>
        <div class="field"><label>Yetkili</label><input name="contactName" placeholder="İletişim kişisi" /></div>
        <div class="field"><label>Telefon</label><input name="phone" /></div>
        <div class="field"><label>E-posta</label><input name="email" type="email" /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
    <h3 class="f-display" style="font-size:15px;margin:18px 0 10px;">Firmalar</h3>
    <div class="grid">${vendors.map((v) => partyCard(v.name, v.category || "Firma", v.debt, "firma", v.id)).join("") || '<div class="empty-row">Kayıtlı firma yok.</div>'}</div>
    <h3 class="f-display" style="font-size:15px;margin:18px 0 10px;">Personel</h3>
    <div class="grid">${personnel.map((p) => partyCard(p.name, p.department || "Personel", personnelDebt(p.id), "personel", p.id)).join("") || '<div class="empty-row">Kayıtlı personel yok.</div>'}</div>
  `;

  document.getElementById("vendorForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/vendors", { method: "POST", body: Object.fromEntries(f) }); toast("Firma eklendi."); renderTab("cari"); }
    catch (err) { toast(err.message); }
  });

  c.querySelectorAll("[data-charge]").forEach((b) => b.addEventListener("click", () => {
    const [partyType, partyId] = b.dataset.charge.split("|");
    const box = document.getElementById(`cari-action-${partyType}-${partyId}`);
    box.innerHTML = `
      <form class="form-row" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;" data-charge-form="${partyType}|${partyId}">
        <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" required /></div>
        <div class="field" style="flex:2 1 200px;"><label>Açıklama</label><input name="description" placeholder="Aylık bakım bedeli, maaş…" required /></div>
        <div class="field" style="flex:2 1 200px;"><label>Gider Kategorisi</label><select name="categoryId">${categoryOptions}</select></div>
        <button class="btn btn-primary btn-sm" type="submit">Kaydet</button>
      </form>`;
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api("/party-charges", { method: "POST", body: { partyType, partyId, ...f } }); toast("Borçlandırma kaydedildi."); renderTab("cari"); }
      catch (err) { toast(err.message); }
    });
  }));

  c.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => {
    const [partyType, partyId, debt] = b.dataset.pay.split("|");
    const box = document.getElementById(`cari-action-${partyType}-${partyId}`);
    box.innerHTML = `
      <form class="form-row" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;">
        <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" value="${debt}" required /></div>
        <div class="field"><label>Hesap</label><select name="accountId">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        <button class="btn btn-primary btn-sm" type="submit">Öde</button>
      </form>`;
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api("/party-payments/pay", { method: "POST", body: { partyType, partyId, ...f } }); toast("Ödeme kaydedildi."); renderTab("cari"); }
      catch (err) { toast(err.message); }
    });
  }));

  c.querySelectorAll("[data-hesap]").forEach((b) => b.addEventListener("click", () => {
    const [partyType, partyId] = b.dataset.hesap.split("|");
    renderPartyHesapHareketleriModal(partyType, partyId, partyNameMap.get(`${partyType}|${partyId}`) || "Hesap Hareketleri");
  }));
}

// Yonetimcell karsilastirmasi: "Giderler (Odeme ve Borclanma)" ekrani.
// Belirli bir firma/personele bagli olmayan, sadece bir Gider Grubu/Kalemi
// kategorisine baglanan borc/fatura girisi + bu kategori taksonomisinin
// yonetimi (bkz. task: PartyCharge.categoryId, partyType null olabilir).
async function renderGiderler(c) {
  const [categories, generalCharges, accounts] = await Promise.all([api("/expense-categories"), api("/party-charges?general=1"), api("/accounts")]);
  const categoryOptions = categories.map((cat) => `<option value="${cat.id}">${esc(cat.group)} / ${esc(cat.name)}</option>`).join("");

  function chargeRow(ch) {
    const kalan = ch.amount - ch.paidAmount;
    return `
      <div class="ledger-row">
        <div>
          <div style="font-weight:600;">${esc(ch.category ? `${ch.category.group} / ${ch.category.name}` : "Kategorisiz")}</div>
          <div class="small muted">${esc(ch.description)} · Fatura ${esc(ch.invoiceNo)} · Vade ${dt(ch.dueDate)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${pill(ch.status === "paid" ? "Ödendi" : ch.status === "partial" ? "Kısmi" : "Açık")}
          <div class="f-num" style="font-weight:600;">${tl(kalan)}</div>
          ${kalan > 0 ? `<button class="btn btn-ghost btn-sm" data-pay-charge="${ch.id}|${kalan}">Öde</button>` : ""}
        </div>
        <div id="gider-pay-${ch.id}" style="flex-basis:100%;"></div>
      </div>`;
  }

  c.innerHTML = `
    ${sectionTitle("Giderler", "Firma/personele bağlı olmayan genel gider borçlandırması + gider kategorisi yönetimi")}
    <div class="grid cols-2">
      <div class="card form-card">
        <div class="ledger-title" style="padding:0 0 10px;">Yeni Gider Kategorisi</div>
        <form id="categoryForm" class="form-row">
          <div class="field"><label>Gider Grubu</label><input name="group" placeholder="Bahçe Bakım Hizmetleri" required /></div>
          <div class="field"><label>Gider Kalemi</label><input name="name" placeholder="Ağaç Kesim ve Budama Gideri" required /></div>
          <button class="btn btn-primary btn-sm" type="submit">Ekle</button>
        </form>
        <div class="ledger-title" style="padding-top:14px;">Kayıtlı Kategoriler</div>
        <div id="categoryList" style="max-height:220px;overflow-y:auto;">
          ${categories.map((cat) => `<div class="ledger-row" style="padding:6px 0;"><span class="small">${esc(cat.group)} / ${esc(cat.name)}</span><button class="btn-danger" data-delcat="${cat.id}">Sil</button></div>`).join("") || '<div class="empty-row">Kategori yok.</div>'}
        </div>
      </div>
      <div class="card form-card">
        <div class="ledger-title" style="padding:0 0 10px;">Genel Gider Borçlandır</div>
        <form id="generalChargeForm">
          <div class="field"><label>Gider Kategorisi</label><select name="categoryId" required>${categoryOptions || '<option value="">Önce bir kategori ekleyin</option>'}</select></div>
          <div class="field"><label>Açıklama</label><input name="description" required /></div>
          <div class="form-row">
            <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" min="0.01" step="0.01" required /></div>
            <div class="field"><label>Vade Tarihi</label><input name="dueDate" type="date" /></div>
          </div>
          <button class="btn btn-primary btn-sm" type="submit">Kaydet</button>
        </form>
      </div>
    </div>
    <div class="card tight" style="margin-top:16px;">
      <div class="ledger-title">Genel Giderler</div>
      ${generalCharges.map(chargeRow).join("") || '<div class="empty-row">Kayıtlı genel gider yok.</div>'}
    </div>
  `;

  document.getElementById("categoryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api("/expense-categories", { method: "POST", body: f }); toast("Kategori eklendi."); renderTab("giderler"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-delcat]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Bu kategoriyi silmek istediğinize emin misiniz?")) return;
    try { await api("/expense-categories/" + b.dataset.delcat, { method: "DELETE" }); toast("Kategori silindi."); renderTab("giderler"); }
    catch (err) { toast(err.message); }
  }));
  document.getElementById("generalChargeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api("/party-charges", { method: "POST", body: f }); toast("Gider borçlandırması kaydedildi."); renderTab("giderler"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-pay-charge]").forEach((b) => b.addEventListener("click", () => {
    const [chargeId, kalan] = b.dataset.payCharge.split("|");
    const box = document.getElementById(`gider-pay-${chargeId}`);
    box.innerHTML = `
      <form class="form-row" style="margin-top:10px;border-top:1px solid var(--line);padding-top:10px;width:100%;">
        <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" value="${kalan}" required /></div>
        <div class="field"><label>Hesap</label><select name="accountId">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
        <button class="btn btn-primary btn-sm" type="submit">Öde</button>
      </form>`;
    box.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api("/party-payments/pay", { method: "POST", body: { chargeId, ...f } }); toast("Ödeme kaydedildi."); renderTab("giderler"); }
      catch (err) { toast(err.message); }
    });
  }));
}

// Yonetimcell karsilastirmasi: "Borc Listesi" ekrani. Firma/personel/genel
// gider ayrimi yapmadan TUM acik PartyCharge kayitlarini tek, filtrelenebilir
// bir tabloda gosterir (Firma&Personel ekranindaki kart-bazli gorunumun
// aksine).
async function renderBorcListesi(c) {
  async function load(filters) {
    const qs = new URLSearchParams({ openOnly: "1", ...filters }).toString();
    return api("/party-charges?" + qs);
  }
  const accounts = await api("/accounts");
  let charges = await load({});

  function partyLabel(ch) {
    if (ch.partyName) return `${ch.partyName} (${ch.partyType === "firma" ? "Firma" : "Personel"})`;
    if (ch.category) return `${ch.category.group} / ${ch.category.name} (Genel Gider)`;
    return "Genel Gider";
  }

  function row(ch) {
    const kalan = ch.amount - ch.paidAmount;
    return `
      <tr>
        <td>${dt(ch.dueDate)}</td>
        <td>${esc(ch.invoiceNo)}</td>
        <td>${esc(partyLabel(ch))}</td>
        <td>${esc(ch.description)}</td>
        <td class="f-num">${tl(ch.amount)}</td>
        <td class="f-num">${tl(ch.paidAmount)}</td>
        <td class="f-num" style="font-weight:600;">${tl(kalan)}</td>
        <td><button class="btn btn-ghost btn-sm" data-pay-charge="${ch.id}|${kalan}">Öde</button></td>
      </tr>
      <tr id="bl-pay-${ch.id}" style="display:none;"><td colspan="8"></td></tr>`;
  }

  function renderTable() {
    return `
      <div class="scroll-x">
        <table class="simple">
          <thead><tr><th>Vade</th><th>Fatura No</th><th>Taraf / Kategori</th><th>Açıklama</th><th>Borç</th><th>Ödenen</th><th>Kalan</th><th></th></tr></thead>
          <tbody>${charges.map(row).join("") || '<tr><td colspan="8" class="empty-row">Açık borç yok.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function bindRowActions() {
    c.querySelectorAll("[data-pay-charge]").forEach((b) => b.addEventListener("click", () => {
      const [chargeId, kalan] = b.dataset.payCharge.split("|");
      const holder = document.getElementById(`bl-pay-${chargeId}`);
      holder.style.display = "table-row";
      holder.querySelector("td").innerHTML = `
        <form class="form-row" style="padding:8px 0;">
          <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" value="${kalan}" required /></div>
          <div class="field"><label>Hesap</label><select name="accountId">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join("")}</select></div>
          <button class="btn btn-primary btn-sm" type="submit">Öde</button>
        </form>`;
      holder.querySelector("form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = Object.fromEntries(new FormData(e.target));
        try { await api("/party-payments/pay", { method: "POST", body: { chargeId, ...f } }); toast("Ödeme kaydedildi."); renderTab("borclistesi"); }
        catch (err) { toast(err.message); }
      });
    }));
  }

  c.innerHTML = `
    ${sectionTitle("Borç Listesi", "Firma, personel ve genel giderlerin tamamındaki açık borçlar")}
    <div class="card tight" style="margin-bottom:16px;">
      <form id="blFilterForm" class="form-row" style="padding:14px;">
        <div class="field"><label>Taraf Türü</label><select name="partyType"><option value="">Tümü</option><option value="firma">Firma</option><option value="personel">Personel</option></select></div>
        <div class="field"><label>Vade Başlangıç</label><input name="dueFrom" type="date" /></div>
        <div class="field"><label>Vade Bitiş</label><input name="dueTo" type="date" /></div>
        <button class="btn btn-ghost btn-sm" type="submit">Filtrele</button>
      </form>
    </div>
    <div id="blTable">${renderTable()}</div>
  `;
  bindRowActions();

  document.getElementById("blFilterForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const filters = {};
    if (f.partyType) filters.partyType = f.partyType;
    if (f.dueFrom) filters.dueFrom = f.dueFrom;
    if (f.dueTo) filters.dueTo = f.dueTo;
    charges = await load(filters);
    document.getElementById("blTable").innerHTML = renderTable();
    bindRowActions();
  });
}

const RECURRING_FREQ_LABEL = { once: "Tek Seferlik", monthly: "Aylık", yearly: "Yıllık" };

// Yonetimcell karsilastirmasi: "Ileri Tarihli Borc Listesi" - aslinda
// periyodik/zamanlanmis fatura sablonu sistemi (bkz. jobs.js
// materializeRecurringPartyCharges). Sablon burada tanimlanir, vadesi
// gelince arka planda otomatik gercek borca cevrilir (ya da "Şimdi
// Çalıştır" ile hemen).
async function renderTekrarlayan(c) {
  const [list, vendors, personnel, categories] = await Promise.all([
    api("/recurring-party-charges"),
    api("/vendors"),
    api("/personnel"),
    api("/expense-categories"),
  ]);

  const partyOptions =
    `<option value="">Yok (sadece kategoriye bağlı genel gider)</option>` +
    `<optgroup label="Firmalar">${vendors.map((v) => `<option value="firma|${v.id}">${esc(v.name)}</option>`).join("")}</optgroup>` +
    `<optgroup label="Personel">${personnel.map((p) => `<option value="personel|${p.id}">${esc(p.name)}</option>`).join("")}</optgroup>`;
  const categoryOptions = `<option value="">Kategori seçin (opsiyonel)</option>` + categories.map((cat) => `<option value="${cat.id}">${esc(cat.group)} / ${esc(cat.name)}</option>`).join("");

  function row(r) {
    const label = r.partyName ? `${r.partyName} (${r.partyType === "firma" ? "Firma" : "Personel"})` : r.category ? `${r.category.group} / ${r.category.name} (Genel Gider)` : "Genel Gider";
    return `
      <div class="ledger-row">
        <div>
          <div style="font-weight:600;">${esc(label)}</div>
          <div class="small muted">${esc(r.description)} · Sonraki vade: ${dt(r.nextDate)} · ${RECURRING_FREQ_LABEL[r.frequency] || r.frequency}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          ${pill(r.active ? "Aktif" : "Pasif")}
          <div class="f-num" style="font-weight:600;">${tl(r.amount)}</div>
          <button class="btn btn-ghost btn-sm" data-toggle="${r.id}|${!r.active}">${r.active ? "Duraklat" : "Etkinleştir"}</button>
          <button class="btn-danger" data-delrec="${r.id}">Sil</button>
        </div>
      </div>`;
  }

  c.innerHTML = `
    ${sectionTitle("İleri Tarihli / Tekrarlayan Faturalar", "Firma, personel veya genel gider için zamanlanmış fatura şablonları - vadesi gelince otomatik borca dönüşür")}
    <div class="card form-card">
      <div class="flex-between" style="margin-bottom:10px;">
        <div class="ledger-title" style="padding:0;">Yeni Şablon</div>
        <button class="btn btn-ghost btn-sm" id="runNowBtn">Vadesi Gelenleri Şimdi Çalıştır</button>
      </div>
      <form id="recurringForm">
        <div class="form-row">
          <div class="field" style="flex:2 1 220px;"><label>Taraf</label><select name="party">${partyOptions}</select></div>
          <div class="field" style="flex:2 1 220px;"><label>Gider Kategorisi</label><select name="categoryId">${categoryOptions}</select></div>
        </div>
        <div class="field"><label>Açıklama</label><input name="description" required /></div>
        <div class="form-row">
          <div class="field"><label>Tutar (₺)</label><input name="amount" type="number" min="0.01" step="0.01" required /></div>
          <div class="field"><label>İlk Vade Tarihi</label><input name="nextDate" type="date" required /></div>
          <div class="field"><label>Sıklık</label><select name="frequency"><option value="once">Tek Seferlik</option><option value="monthly">Aylık</option><option value="yearly">Yıllık</option></select></div>
        </div>
        <button class="btn btn-primary btn-sm" type="submit">Kaydet</button>
      </form>
    </div>
    <div class="card tight" style="margin-top:16px;">
      <div class="ledger-title">Kayıtlı Şablonlar</div>
      ${list.map(row).join("") || '<div class="empty-row">Kayıtlı şablon yok.</div>'}
    </div>
  `;

  document.getElementById("runNowBtn").addEventListener("click", async () => {
    try { const r = await api("/recurring-party-charges/run-now", { method: "POST" }); toast(r.message); renderTab("tekrarlayan"); }
    catch (err) { toast(err.message); }
  });

  document.getElementById("recurringForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const body = { description: f.description, amount: f.amount, nextDate: f.nextDate, frequency: f.frequency, categoryId: f.categoryId || undefined };
    if (f.party) { const [partyType, partyId] = f.party.split("|"); body.partyType = partyType; body.partyId = partyId; }
    try { await api("/recurring-party-charges", { method: "POST", body }); toast("Şablon kaydedildi."); renderTab("tekrarlayan"); }
    catch (err) { toast(err.message); }
  });

  c.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
    const [id, active] = b.dataset.toggle.split("|");
    try { await api("/recurring-party-charges/" + id, { method: "PATCH", body: { active: active === "true" } }); renderTab("tekrarlayan"); }
    catch (err) { toast(err.message); }
  }));
  c.querySelectorAll("[data-delrec]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Bu şablonu silmek istediğinize emin misiniz?")) return;
    try { await api("/recurring-party-charges/" + b.dataset.delrec, { method: "DELETE" }); toast("Şablon silindi."); renderTab("tekrarlayan"); }
    catch (err) { toast(err.message); }
  }));
}

async function renderPersonelView(c) {
  const list = await api("/personnel");
  c.innerHTML = `
    ${sectionTitle("Personel")}
    <div class="card tight">
      ${list.map((p) => `<div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(p.name)}</div><div class="small muted">${esc(p.department)} · ${esc(p.phone || "-")}</div></div>${pill(p.active ? "Ödendi" : "Açık")}</div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
    <p class="small muted" style="margin-top:12px;">Yeni personel eklemek için "Kullanıcılar" sekmesini kullanın.</p>
  `;
}

async function renderDemirbas(c) {
  const role = state.user.role;
  const list = await api("/equipment");
  c.innerHTML = `
    ${sectionTitle("Demirbaş &amp; Bakım-Onarım")}
    ${role === "yonetici" ? `
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Demirbaş</div>
      <form id="eqForm" class="form-row">
        <div class="field"><label>Ad</label><input name="name" required /></div>
        <div class="field"><label>Konum</label><input name="location" /></div>
        <div class="field"><label>Bakım Periyodu (gün)</label><input name="maintenancePeriodDays" type="number" value="90" /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>` : ""}
    <div class="grid">
      ${list.map((e) => `
        <div class="card pad mb-16">
          <div class="flex-between"><div style="font-weight:700;">${esc(e.name)}</div>${e.maintenanceOverdue ? pill("Bakım Gecikti") : pill("Güncel")}</div>
          <div class="small muted" style="margin-top:4px;">${esc(e.location || "-")} · Sorumlu: ${esc(e.responsibleName || "-")}</div>
          <div class="small muted">Son bakım: ${dt(e.lastMaintenanceDate)} · Periyot: ${e.maintenancePeriodDays} gün</div>
          ${e.notes ? `<p class="small" style="margin-top:6px;">${esc(e.notes)}</p>` : ""}
          <button class="btn btn-ghost btn-sm" style="margin-top:8px;" data-maintained="${e.id}">Bakım Yapıldı İşaretle</button>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("eqForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/equipment", { method: "POST", body: Object.fromEntries(f) }); toast("Demirbaş eklendi."); renderTab("demirbas"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-maintained]").forEach((b) => b.addEventListener("click", async () => { try { await api("/equipment/" + b.dataset.maintained + "/maintained", { method: "PATCH" }); toast("Bakım kaydedildi."); renderTab("demirbas"); } catch (err) { toast(err.message); } }));
}

async function renderSayacYonetici(c) {
  const [meters, readings, units] = await Promise.all([api("/meters"), api("/meter-readings"), api("/units")]);
  c.innerHTML = `
    ${sectionTitle("Sayaç Okuma &amp; Faturalama")}
    <div class="grid cols-2">
      <div class="card form-card">
        <div class="ledger-title" style="padding:0 0 10px;">Yeni Sayaç Tanımla</div>
        <form id="meterForm">
          <div class="field"><label>Daire</label><select name="unitId">${units.map((u) => `<option value="${u.id}">${esc(u.block)} - Daire ${esc(u.no)}</option>`).join("")}</select></div>
          <div class="field"><label>Tip</label><select name="type"><option value="su">Su</option><option value="elektrik">Elektrik</option><option value="dogalgaz">Doğalgaz</option><option value="kalorimetre">Kalorimetre</option></select></div>
          <div class="field"><label>Seri No</label><input name="serialNo" /></div>
          <button class="btn btn-primary btn-sm" type="submit">Ekle</button>
        </form>
      </div>
      <div class="card form-card">
        <div class="ledger-title" style="padding:0 0 10px;">Okuma Gir &amp; Faturala</div>
        <form id="readingForm">
          <div class="field"><label>Sayaç</label><select name="meterId">${meters.map((m) => `<option value="${m.id}">${esc(m.unitLabel)} - ${esc(m.type)}</option>`).join("")}</select></div>
          <div class="field"><label>Dönem</label><input name="period" placeholder="2026-09" required /></div>
          <div class="field"><label>Tüketim (birim)</label><input name="value" type="number" step="0.01" required /></div>
          <div class="field"><label>Birim Fiyat (₺)</label><input name="unitCost" type="number" step="0.01" required /></div>
          <button class="btn btn-primary btn-sm" type="submit">Faturala</button>
        </form>
      </div>
    </div>
    <div class="card tight" style="margin-top:16px;">
      <div class="ledger-title">Okuma Geçmişi</div>
      ${readings.map((r) => ledgerRow(r.period, r.value + " birim × " + tl(r.unitCost), tl(r.amount))).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("meterForm").addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("/meters", { method: "POST", body: Object.fromEntries(f) }); toast("Sayaç eklendi."); renderTab("sayac"); } catch (err) { toast(err.message); } });
  document.getElementById("readingForm").addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("/meter-readings", { method: "POST", body: Object.fromEntries(f) }); toast("Fatura oluşturuldu."); renderTab("sayac"); } catch (err) { toast(err.message); } });
}

/* ================= AJANDA / İŞ TAKİBİ / GELEN MESAJLAR ================= */
/* Yönetimcell karşılaştırmasından: yönetimin kendi iç çalışma alanı. */

async function renderAjanda(c) {
  const today = new Date().toISOString().slice(0, 10);
  const list = await api("/agenda");
  c.innerHTML = `
    ${sectionTitle("Ajanda", "Notlar ve sitede gerçekleşen faaliyetler")}
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Kayıt Ekle</div>
      <form id="agendaForm" class="form-row">
        <div class="field" style="flex:0 0 140px;"><label>Tür</label><select name="kind"><option value="not">Not</option><option value="faaliyet">Faaliyet</option></select></div>
        <div class="field" style="flex:0 0 170px;"><label>Tarih</label><input type="date" name="date" value="${today}" required /></div>
        <div class="field" style="flex:1 1 260px;"><label>Metin</label><input name="text" required /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
    <div class="card tight">
      ${list.map((i) => `
        <div class="ledger-row" style="${i.done ? "opacity:.55;" : ""}">
          <div><div style="font-size:14px;font-weight:600;">${i.kind === "faaliyet" ? "📌 Faaliyet" : "📝 Not"} — ${esc(i.text)}${i.done ? " (Tamamlandı)" : ""}</div><div class="small muted">${dt(i.date)} · ${esc(i.authorName)}</div></div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" data-toggle="${i.id}" data-done="${i.done}">${i.done ? "Bekleyene Al" : "Tamamlandı"}</button>
            <button class="btn-danger" data-delagenda="${i.id}">Sil</button>
          </div>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("agendaForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/agenda", { method: "POST", body: Object.fromEntries(f) }); toast("Kayıt eklendi."); renderTab("ajanda"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/agenda/" + b.dataset.toggle, { method: "PATCH", body: { done: b.dataset.done !== "true" } }); renderTab("ajanda"); }
    catch (err) { toast(err.message); }
  }));
  c.querySelectorAll("[data-delagenda]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Bu kayıt silinsin mi?")) return;
    try { await api("/agenda/" + b.dataset.delagenda, { method: "DELETE" }); renderTab("ajanda"); }
    catch (err) { toast(err.message); }
  }));
}

async function renderIsTakibi(c) {
  const canCreate = state.user.role === "yonetici";
  const [tasks, personnel, units] = await Promise.all([
    api("/internal-tasks"),
    canCreate ? api("/personnel") : Promise.resolve([]),
    canCreate ? api("/units") : Promise.resolve([]),
  ]);
  const STATUSES = ["Devam Eden", "Tamamlanan", "Kapatılan"];
  c.innerHTML = `
    ${sectionTitle("İş Takibi", "Yönetimin kendi iç görev/to-do listesi")}
    ${canCreate ? `
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni İş Oluştur</div>
      <form id="taskForm" class="form-row">
        <div class="field" style="flex:1 1 220px;"><label>Başlık</label><input name="title" required /></div>
        <div class="field" style="flex:1 1 160px;"><label>İşin Alanı</label><input name="area" placeholder="Genel, Temizlik, Bahçe…" /></div>
        <div class="field" style="flex:1 1 160px;"><label>İşin Türü</label><input name="type" placeholder="Arıza, Öneri…" /></div>
        <div class="field" style="flex:1 1 200px;"><label>Atanan Personel</label><select name="assignedPersonnelId"><option value="">—</option>${personnel.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
        <div class="field" style="flex:1 1 200px;"><label>İlgili Daire</label><select name="unitId"><option value="">—</option>${units.map((u) => `<option value="${u.id}">${esc(u.block)} - Daire ${esc(u.no)}</option>`).join("")}</select></div>
        <div class="field" style="flex:1 1 160px;"><label>Teslim Tarihi</label><input type="date" name="dueDate" /></div>
        <div class="field" style="flex:1 1 260px;"><label>Açıklama</label><input name="description" /></div>
        <button class="btn btn-primary" type="submit">Oluştur</button>
      </form>
    </div>` : ""}
    <div class="card tight">
      ${tasks.map((t) => `
        <div class="ledger-row" style="flex-wrap:wrap;">
          <div><div style="font-size:14px;font-weight:600;">${esc(t.title)}</div><div class="small muted">${esc(t.area)} · ${esc(t.type)}${t.assignedName ? " · " + esc(t.assignedName) : ""}${t.unitLabel ? " · " + esc(t.unitLabel) : ""}${t.dueDate ? " · Teslim: " + dt(t.dueDate) : ""}</div>${t.description ? `<div class="small muted" style="margin-top:2px;">${esc(t.description)}</div>` : ""}</div>
          <div style="display:flex;align-items:center;gap:8px;">
            ${pill(t.status)}
            <select data-status="${t.id}">${STATUSES.map((s) => `<option value="${s}" ${s === t.status ? "selected" : ""}>${s}</option>`).join("")}</select>
          </div>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  if (canCreate) {
    document.getElementById("taskForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api("/internal-tasks", { method: "POST", body: Object.fromEntries(f) }); toast("İş oluşturuldu."); renderTab("istakibi"); }
      catch (err) { toast(err.message); }
    });
  }
  c.querySelectorAll("[data-status]").forEach((sel) => sel.addEventListener("change", async () => {
    try { await api("/internal-tasks/" + sel.dataset.status, { method: "PATCH", body: { status: sel.value } }); toast("Durum güncellendi."); renderTab("istakibi"); }
    catch (err) { toast(err.message); }
  }));
}

async function renderMesajlar(c) {
  const isYonetici = state.user.role === "yonetici";
  const [list, residents] = await Promise.all([api("/messages"), isYonetici ? api("/users") : Promise.resolve([])]);
  const sakinler = residents.filter((u) => u.role === "sakin" && u.isApproved);
  c.innerHTML = `
    ${sectionTitle("Gelen Mesajlar", isYonetici ? "Sakinlerden gelen özel mesajlar" : "Yönetime özel mesaj gönderin")}
    <div class="card form-card">
      <form id="msgForm" class="form-row">
        ${isYonetici ? `<div class="field" style="flex:1 1 220px;"><label>Kime (boş = genel not)</label><select name="recipientId"><option value="">—</option>${sakinler.map((u) => `<option value="${u.id}">${esc(u.name)}${u.unitLabel ? " · " + esc(u.unitLabel) : ""}</option>`).join("")}</select></div>` : ""}
        <div class="field" style="flex:1 1 320px;"><label>${isYonetici ? "Mesaj" : "Yönetime Mesajınız"}</label><input name="body" required placeholder="Mesajınızı yazın…" /></div>
        <button class="btn btn-primary" type="submit">Gönder</button>
      </form>
    </div>
    <div class="card tight">
      ${list.map((m) => `
        <div class="ledger-row" style="${m.read || m.senderId === state.user.id ? "" : "background:var(--azure-light);"}">
          <div><div style="font-size:14px;font-weight:600;">${esc(m.senderName)}${m.senderUnitLabel ? " · " + esc(m.senderUnitLabel) : ""}</div><div class="small muted" style="margin-top:2px;">${esc(m.body)}</div><div class="small muted">${dt(m.date)}</div></div>
          ${isYonetici && !m.read && m.senderId !== state.user.id ? `<button class="btn btn-ghost btn-sm" data-readmsg="${m.id}">Okundu İşaretle</button>` : ""}
        </div>`).join("") || '<div class="empty-row">Gelen mesaj yok.</div>'}
    </div>
  `;
  document.getElementById("msgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/messages", { method: "POST", body: Object.fromEntries(f) }); toast("Mesaj gönderildi."); renderTab("mesajlar"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-readmsg]").forEach((b) => b.addEventListener("click", async () => {
    try { await api("/messages/" + b.dataset.readmsg + "/read", { method: "PATCH" }); renderTab("mesajlar"); }
    catch (err) { toast(err.message); }
  }));
}

/* ================= TOPLU SMS/E-POSTA ================= */
/* Yönetimcell karşılaştırmasından: şablon + <adsoyad>/<borc>/<daire> gibi
   kişiselleştirme parametresi + blok/borç filtresi. Gerçek sağlayıcı
   bağlanana kadar sadece önizleme üretir, konsola loglar (bkz. README). */

async function renderTopluSms(c) {
  const units = await api("/units");
  const blocks = [...new Set(units.map((u) => u.block))].sort();
  c.innerHTML = `
    ${sectionTitle("Toplu SMS/E-posta", "Gerçek gönderim için sağlayıcı entegrasyonu gerekir — bu ekran şablon + alıcı listesini önizler")}
    <div class="card form-card">
      <form id="bulkForm" class="form-row">
        <div class="field" style="flex:0 0 140px;"><label>Kanal</label><select name="channel"><option value="sms">SMS</option><option value="eposta">E-posta</option></select></div>
        <div class="field" style="flex:0 0 140px;"><label>Blok</label><select name="block"><option value="">Tüm Bloklar</option>${blocks.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select></div>
        <div class="field" style="flex:0 0 200px;"><label>Borç Eşiği</label>
          <select name="minDebt">
            <option value="">Tümü</option>
            <option value="1">Borcu olanlar</option>
            <option value="500">500 ₺ ve fazla borcu olanlar</option>
            <option value="1000">1.000 ₺ ve fazla borcu olanlar</option>
          </select>
        </div>
        <div class="field" style="flex:1 1 320px;"><label>Mesaj Şablonu</label><input name="template" required placeholder="Sayın <adsoyad>, <daire> için güncel borcunuz <borc> ₺'dir." /></div>
        <button class="btn btn-primary" type="submit">Alıcıları Önizle</button>
      </form>
      <div class="small muted" style="margin-top:8px;">Kullanılabilecek parametreler: <code>&lt;adsoyad&gt;</code> <code>&lt;daire&gt;</code> <code>&lt;borc&gt;</code></div>
    </div>
    <div id="bulkPreview"></div>
  `;
  document.getElementById("bulkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api("/bulk-messages/preview", { method: "POST", body: f });
      const box = document.getElementById("bulkPreview");
      box.innerHTML = `
        <div class="card tight mb-16">
          <div class="flex-between"><div class="ledger-title">Önizleme — ${r.count} alıcı</div>${r.count ? `<button class="btn btn-primary btn-sm" id="bulkSendBtn" style="margin:8px 0;">Gönder (taslak modu)</button>` : ""}</div>
          ${r.recipients.map((rec) => `<div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(rec.name)} — ${esc(rec.unitLabel)}</div><div class="small muted">${esc(rec.contact)}</div><div class="small muted" style="margin-top:2px;">${esc(rec.text)}</div></div></div>`).join("") || '<div class="empty-row">Bu filtreye uyan, iletişim bilgisi kayıtlı alıcı yok.</div>'}
        </div>`;
      const sendBtn = document.getElementById("bulkSendBtn");
      sendBtn && sendBtn.addEventListener("click", async () => {
        try {
          const sr = await api("/bulk-messages/send", { method: "POST", body: { channel: f.channel, recipients: r.recipients } });
          toast(sr.message);
        } catch (err) { toast(err.message); }
      });
    } catch (err) { toast(err.message); }
  });
}

/* ================= HUKUKİ: İCRA TAKİBİ / BELGE ŞABLONLARI ================= */

async function renderIcraTakibi(c) {
  const [cases, units] = await Promise.all([api("/legal-cases"), api("/units")]);
  const STATUSES = ["Açık", "Kapandı"];
  c.innerHTML = `
    ${sectionTitle("İcra Takibi", "Yasal takip sürecindeki daireler/dosyalar")}
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Dosya Ekle</div>
      <form id="legalForm" class="form-row">
        <div class="field" style="flex:1 1 200px;"><label>Daire</label><select name="unitId">${units.map((u) => `<option value="${u.id}">${esc(u.block)} - Daire ${esc(u.no)}</option>`).join("")}</select></div>
        <div class="field" style="flex:1 1 160px;"><label>Dosya No</label><input name="caseNumber" required /></div>
        <div class="field" style="flex:1 1 200px;"><label>İcra Dairesi/Mahkeme</label><input name="court" /></div>
        <div class="field" style="flex:1 1 260px;"><label>Açıklama</label><input name="description" /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
    <div class="card tight">
      ${cases.map((lc) => `
        <div class="ledger-row" style="flex-wrap:wrap;">
          <div><div style="font-size:14px;font-weight:600;">${esc(lc.unitLabel)} — Dosya No: ${esc(lc.caseNumber)}</div><div class="small muted">${esc(lc.court || "-")}${lc.ownerName ? " · " + esc(lc.ownerName) : ""} · Açılış: ${dt(lc.openedAt)}</div>${lc.description ? `<div class="small muted">${esc(lc.description)}</div>` : ""}</div>
          <select data-legalstatus="${lc.id}">${STATUSES.map((s) => `<option value="${s}" ${s === lc.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        </div>`).join("") || '<div class="empty-row">Kayıtlı dosya yok.</div>'}
    </div>
  `;
  document.getElementById("legalForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/legal-cases", { method: "POST", body: Object.fromEntries(f) }); toast("Dosya eklendi."); renderTab("icra"); }
    catch (err) { toast(err.message); }
  });
  c.querySelectorAll("[data-legalstatus]").forEach((sel) => sel.addEventListener("change", async () => {
    try { await api("/legal-cases/" + sel.dataset.legalstatus, { method: "PATCH", body: { status: sel.value } }); toast("Durum güncellendi."); renderTab("icra"); }
    catch (err) { toast(err.message); }
  }));
}

async function renderBelgeSablonlari(c) {
  const units = await api("/units");
  const debtors = units.filter((u) => u.debt > 0).sort((a, b) => b.debt - a.debt);
  c.innerHTML = `
    ${sectionTitle("Belge Şablonları", "Genel kurul, tebligat ve resmi evrak şablonları")}
    <div class="card pad mb-16">
      <div class="ledger-title" style="padding:0 0 10px;">Genel Kurul Çağrısı</div>
      <form id="gkForm" class="form-row">
        <div class="field" style="flex:1 1 180px;"><label>Birinci Toplantı Tarih</label><input type="date" name="birinciTarih" /></div>
        <div class="field" style="flex:0 0 110px;"><label>Saat</label><input type="time" name="birinciSaat" /></div>
        <div class="field" style="flex:1 1 180px;"><label>İkinci Toplantı Tarih</label><input type="date" name="ikinciTarih" /></div>
        <div class="field" style="flex:0 0 110px;"><label>Saat</label><input type="time" name="ikinciSaat" /></div>
        <div class="field" style="flex:1 1 260px;"><label>Toplantı Adresi</label><input name="adres" placeholder="Boş bırakılırsa site adresi kullanılır" /></div>
        <button class="btn btn-primary btn-sm" type="submit">PDF Oluştur</button>
      </form>
    </div>
    <div class="grid cols-3 mb-16">
      <button class="card pad clickable" id="btnVekalet" style="text-align:left;border:none;"><div style="font-weight:700;">📄 Vekaletname Örneği</div><div class="small muted">Genel kurul için hazır şablon</div></button>
      <button class="card pad clickable" id="btnHazirun" style="text-align:left;border:none;"><div style="font-weight:700;">📋 Hazirun Cetveli</div><div class="small muted">Tüm daireler, arsa payı, imza alanı</div></button>
      <button class="card pad clickable" id="btnAntetli" style="text-align:left;border:none;"><div style="font-weight:700;">📃 Antetli Evrak</div><div class="small muted">Boş, markalı resmi yazı kağıdı</div></button>
      <button class="card pad clickable" id="btnEtiket" style="text-align:left;border:none;"><div style="font-weight:700;">🏷️ Adres Etiketleri</div><div class="small muted">Tüm daireler için zarf etiketi listesi</div></button>
      <button class="card pad clickable" id="btnTopluOzet" style="text-align:left;border:none;"><div style="font-weight:700;">📚 Toplu Hesap Özeti</div><div class="small muted">Tüm dairelerin ekstresi tek PDF'te</div></button>
    </div>
    <div class="card tight">
      <div class="ledger-title">Borçlu Dairelere Tebligat (Ödeme Çağrısı / İhtarname)</div>
      ${debtors.map((u) => `
        <div class="ledger-row">
          <div><div style="font-size:14px;font-weight:600;">${esc(u.block)} - Daire ${esc(u.no)}</div><div class="small muted">${esc(u.ownerName || "-")} · ${tl(u.debt)}</div></div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-ghost btn-sm" data-tebligat="${u.id}" data-tier="call">Ödeme Çağrısı</button>
            <button class="btn-danger" data-tebligat="${u.id}" data-tier="ihtarname">İhtarname</button>
          </div>
        </div>`).join("") || '<div class="empty-row">Borçlu daire yok.</div>'}
    </div>
  `;
  document.getElementById("gkForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const params = new URLSearchParams(Object.fromEntries(new FormData(e.target)));
    downloadFile("/documents/genel-kurul-cagrisi?" + params.toString(), "genel-kurul-cagrisi.pdf");
  });
  document.getElementById("btnVekalet").addEventListener("click", () => downloadFile("/documents/vekaletname", "vekaletname-ornegi.pdf"));
  document.getElementById("btnHazirun").addEventListener("click", () => downloadFile("/documents/hazirun-cetveli", "hazirun-cetveli.pdf"));
  document.getElementById("btnAntetli").addEventListener("click", () => downloadFile("/documents/antetli-evrak", "antetli-evrak.pdf"));
  document.getElementById("btnEtiket").addEventListener("click", () => downloadFile("/documents/adres-etiketleri", "adres-etiketleri.pdf"));
  document.getElementById("btnTopluOzet").addEventListener("click", () => downloadFile("/documents/toplu-hesap-ozeti", "toplu-hesap-ozeti.pdf"));
  c.querySelectorAll("[data-tebligat]").forEach((b) => b.addEventListener("click", () => {
    downloadFile(`/documents/tebligat/${b.dataset.tebligat}?tier=${b.dataset.tier}`, `${b.dataset.tier}.pdf`);
  }));
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// Yonetimcell karsilastirmasi: "Dosya Arsivi" - klasor bazli genel evrak
// yukleme/saklama (Personel Evraklari, Maas Bordrolari, SGK Odemeleri,
// Uye Evraklari gibi). Bizde daha once hic yoktu - her sey ya veritabani
// kaydi ya da anlik uretilen PDF'ti; bu gercek dosya yuklemeyi destekler.
async function renderDosyaArsivi(c) {
  let openFolder = null;

  async function renderFolderList() {
    const folders = await api("/archive/folders");
    c.innerHTML = `
      ${sectionTitle("Dosya Arşivi", "Klasör bazlı genel evrak/dosya saklama")}
      <div class="card form-card">
        <form id="newFolderForm" class="form-row">
          <div class="field" style="flex:1 1 240px;"><label>Yeni Klasör Adı</label><input name="name" required placeholder="Personel Evrakları, Üye Evrakları…" /></div>
          <button class="btn btn-primary btn-sm" type="submit">+ Klasör Ekle</button>
        </form>
      </div>
      <div class="grid cols-3">
        ${folders.map((f) => `
          <div class="card pad clickable" data-openfolder="${f.id}" style="cursor:pointer;">
            <div class="flex-between">
              <div style="font-weight:700;">📁 ${esc(f.name)}</div>
              <button class="btn-danger" data-delfolder="${f.id}" title="Klasörü sil">Sil</button>
            </div>
            <div class="small muted" style="margin-top:6px;">${f.fileCount} dosya</div>
          </div>`).join("") || '<div class="empty-row">Henüz klasör yok.</div>'}
      </div>
    `;
    document.getElementById("newFolderForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try { await api("/archive/folders", { method: "POST", body: f }); toast("Klasör eklendi."); renderFolderList(); }
      catch (err) { toast(err.message); }
    });
    c.querySelectorAll("[data-delfolder]").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Bu klasör ve içindeki tüm dosyalar silinecek. Emin misiniz?")) return;
      try { await api("/archive/folders/" + b.dataset.delfolder, { method: "DELETE" }); toast("Klasör silindi."); renderFolderList(); }
      catch (err) { toast(err.message); }
    }));
    c.querySelectorAll("[data-openfolder]").forEach((card) => card.addEventListener("click", () => {
      openFolder = folders.find((f) => f.id === card.dataset.openfolder);
      renderFolderDetail();
    }));
  }

  async function renderFolderDetail() {
    const files = await api(`/archive/folders/${openFolder.id}/files`);
    c.innerHTML = `
      <div class="flex-between">${sectionTitle("📁 " + openFolder.name, "Dosya Arşivi")}<button class="btn btn-ghost btn-sm" id="backToFolders" style="margin-bottom:16px;">← Klasörlere Dön</button></div>
      <div class="card form-card">
        <div class="ledger-title" style="padding:0 0 10px;">Yeni Dosya Ekle</div>
        <form id="uploadForm" class="form-row">
          <div class="field" style="flex:1 1 260px;"><label>Dosya</label><input type="file" name="file" required /></div>
          <button class="btn btn-primary btn-sm" type="submit">Yükle</button>
        </form>
      </div>
      <div class="card tight">
        ${files.map((f) => `
          <div class="ledger-row">
            <div><div style="font-size:14px;font-weight:600;">📄 ${esc(f.originalName)}</div><div class="small muted">${formatFileSize(f.size)} · ${dt(f.uploadedAt)}</div></div>
            <div style="display:flex;gap:8px;"><button class="btn btn-ghost btn-sm" data-dlfile="${f.id}" data-fname="${esc(f.originalName)}">İndir</button><button class="btn-danger" data-delfile="${f.id}">Sil</button></div>
          </div>`).join("") || '<div class="empty-row">Bu klasörde dosya yok.</div>'}
      </div>
    `;
    document.getElementById("backToFolders").addEventListener("click", () => { openFolder = null; renderFolderList(); });
    document.getElementById("uploadForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fileInput = e.target.querySelector('input[name="file"]');
      if (!fileInput.files.length) return;
      const fd = new FormData();
      fd.append("file", fileInput.files[0]);
      try {
        const res = await fetch(API_BASE + `/archive/folders/${openFolder.id}/files`, {
          method: "POST",
          headers: { Authorization: "Bearer " + state.token },
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Yükleme başarısız oldu.");
        toast("Dosya yüklendi.");
        renderFolderDetail();
      } catch (err) { toast(err.message); }
    });
    c.querySelectorAll("[data-dlfile]").forEach((b) => b.addEventListener("click", () => downloadFile("/archive/files/" + b.dataset.dlfile + "/download", b.dataset.fname)));
    c.querySelectorAll("[data-delfile]").forEach((b) => b.addEventListener("click", async () => {
      if (!confirm("Bu dosyayı silmek istediğinize emin misiniz?")) return;
      try { await api("/archive/files/" + b.dataset.delfile, { method: "DELETE" }); toast("Dosya silindi."); renderFolderDetail(); }
      catch (err) { toast(err.message); }
    }));
  }

  renderFolderList();
}

async function renderKarar(c) {
  const list = await api("/decisions");
  const canCreate = state.user.role === "yonetici";
  c.innerHTML = `
    <div class="flex-between">${sectionTitle("Karar Defteri", "Kat Mülkiyeti Kanunu gereği tutulan resmi karar kaydı")}${canCreate ? '<button class="btn btn-ghost btn-sm" id="newDecBtn" style="margin-bottom:16px;">+ Yeni Karar</button>' : ""}</div>
    <div id="decForm"></div>
    <div class="grid">
      ${list.map((d) => `
        <div class="card pad mb-16">
          <div class="flex-between"><div style="font-weight:700;">Karar No: ${d.decisionNo} — ${esc(d.title)}</div><div class="small muted">${dt(d.date)}</div></div>
          <p style="font-size:14px;color:var(--steel);margin-top:6px;">${esc(d.content)}</p>
          <div class="small muted">Katılımcı sayısı: ${d.attendees}</div>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  if (canCreate) {
    document.getElementById("newDecBtn").addEventListener("click", () => {
      document.getElementById("decForm").innerHTML = `
        <form id="decCreateForm" class="card form-card">
          <div class="field"><label>Başlık</label><input name="title" required /></div>
          <div class="field"><label>Karar Metni</label><textarea name="content" rows="3" required></textarea></div>
          <div class="field"><label>Katılımcı Sayısı</label><input name="attendees" type="number" /></div>
          <button class="btn btn-primary btn-sm" type="submit">Kaydet</button>
        </form>`;
      document.getElementById("decCreateForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const f = new FormData(e.target);
        try { await api("/decisions", { method: "POST", body: Object.fromEntries(f) }); toast("Karar kaydedildi."); renderTab("karar"); }
        catch (err) { toast(err.message); }
      });
    });
  }
}

async function renderAnahtar(c) {
  const list = await api("/keys");
  c.innerHTML = `
    ${sectionTitle("Anahtar Takibi")}
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Yeni Anahtar</div>
      <form id="keyForm" class="form-row">
        <div class="field"><label>Anahtar Adı</label><input name="keyName" required /></div>
        <div class="field"><label>Konum</label><input name="location" /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
    <div class="card tight">
      ${list.map((k) => `
        <div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(k.keyName)}</div><div class="small muted">${esc(k.location || "-")}${k.status === "zimmetli" ? " · Zimmetli: " + esc(k.holderName) : ""}</div></div>
        <div style="display:flex;align-items:center;gap:8px;">${pill(k.status)}
        ${k.status === "depoda" ? `<button class="btn btn-ghost btn-sm" data-checkout="${k.id}">Zimmetle</button>` : `<button class="btn btn-ghost btn-sm" data-checkin="${k.id}">Teslim Al</button>`}
        </div></div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("keyForm").addEventListener("submit", async (e) => { e.preventDefault(); const f = new FormData(e.target); try { await api("/keys", { method: "POST", body: Object.fromEntries(f) }); toast("Anahtar eklendi."); renderTab("anahtar"); } catch (err) { toast(err.message); } });
  c.querySelectorAll("[data-checkout]").forEach((b) => b.addEventListener("click", async () => {
    const holderName = prompt("Kime zimmetleniyor?");
    if (!holderName) return;
    try { await api("/keys/" + b.dataset.checkout + "/checkout", { method: "PATCH", body: { holderName } }); renderTab("anahtar"); }
    catch (err) { toast(err.message); }
  }));
  c.querySelectorAll("[data-checkin]").forEach((b) => b.addEventListener("click", async () => { try { await api("/keys/" + b.dataset.checkin + "/checkin", { method: "PATCH" }); renderTab("anahtar"); } catch (err) { toast(err.message); } }));
}

/* ================= PERSONEL VIEW ================= */

/* ================= ŞEFFAFLIK (Audit Log) & BÜTÇE ================= */

const ACTION_LABEL = {
  "payment.create": "💰 Ödeme",
  "charge.generate": "🧾 Borçlandırma",
  "transaction.create": "📒 Muhasebe Kaydı",
  "transaction.delete": "🗑️ Muhasebe Silme",
  "user.approve": "✅ Kullanıcı Onayı",
  "user.reset-password": "🔑 Şifre Sıfırlama",
  "unit.create": "🏠 Daire Eklendi",
  "announcement.create": "📢 Duyuru",
  "ticket.status": "🛠️ Talep Durumu",
  "decision.create": "📜 Karar Defteri",
  "budget.set": "📊 Bütçe Güncelleme",
  "document.debt-letter": "📄 Belge İndirme",
  "document.debt-list": "🖨️ Borç Listesi Yazdırma",
  "document.debt-list-csv": "📊 Borç Listesi Excel İndirme",
  "latefee.apply": "⚠ Gecikme Faizi",
  "charge.autogenerate": "🔁 Otomatik Borçlandırma",
  "settings.update": "⚙️ Ayar Değişikliği",
  "contact.create": "📇 Rehber Kaydı",
};

async function renderSeffaflik(c) {
  const list = await api("/activity-log");
  const isManager = state.user.role === "yonetici";
  c.innerHTML = `
    <div class="flex-between">${sectionTitle("Şeffaflık", isManager ? "Sistemdeki tüm önemli işlemlerin değiştirilemez kaydı" : "Sizinle ilgili işlemlerin kaydı")}${isManager ? '<button class="btn btn-ghost btn-sm" id="exportBtn" style="margin-bottom:16px;">⬇ Tüm Veriyi Dışa Aktar</button>' : ""}</div>
    <div class="card tight">
      ${list.map((l) => `
        <div class="ledger-row">
          <div><div style="font-size:14px;font-weight:600;">${ACTION_LABEL[l.action] || l.action}</div><div class="small muted">${esc(l.detail)}</div></div>
          <div style="text-align:right;"><div class="small muted">${esc(l.actorName)}</div><div class="small muted">${dt(l.date)}</div></div>
        </div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
    ${isManager ? '<p class="small muted" style="margin-top:10px;">Bu kayıtlar sonradan değiştirilemez veya silinemez — sitenizin mali/idari işlemlerinde tam şeffaflık sağlar.</p>' : ""}
  `;
  document.getElementById("exportBtn")?.addEventListener("click", () => downloadFile("/export", "sakin-veri-yedegi.json"));
}

async function renderButce(c) {
  const year = new Date().getFullYear();
  const budgets = await api(`/budgets?year=${year}`);
  c.innerHTML = `
    ${sectionTitle(year + " Yılı Bütçe Planlaması", "Planlanan gider ile gerçekleşen gideri karşılaştırın")}
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Bütçe Kalemi Ekle / Güncelle</div>
      <form id="budgetForm" class="form-row">
        <div class="field"><label>Kategori</label><input name="category" required placeholder="Temizlik, Güvenlik…" /></div>
        <div class="field"><label>Planlanan Tutar (₺/yıl)</label><input name="plannedAmount" type="number" required /></div>
        <input type="hidden" name="year" value="${year}" />
        <button class="btn btn-primary" type="submit">Kaydet</button>
      </form>
    </div>
    <div class="grid">
      ${budgets.map((b) => {
        const pct = Math.min(100, Math.round((b.actualAmount / b.plannedAmount) * 100));
        const over = b.actualAmount > b.plannedAmount;
        return `<div class="card pad mb-16">
          <div class="flex-between"><div style="font-weight:700;">${esc(b.category)}</div><div class="small muted">${tl(b.actualAmount)} / ${tl(b.plannedAmount)}</div></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${over ? "var(--red)" : "var(--navy)"};"></div></div>
          <div class="small muted" style="margin-top:6px;">${over ? "⚠ Bütçe aşıldı" : pct + "% kullanıldı"}</div>
        </div>`;
      }).join("") || '<div class="empty-row">Henüz bütçe kalemi yok.</div>'}
    </div>
  `;
  document.getElementById("budgetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/budgets", { method: "POST", body: Object.fromEntries(f) }); toast("Bütçe kaydedildi."); renderTab("butce"); }
    catch (err) { toast(err.message); }
  });
}

async function renderRehber(c) {
  const promises = [api("/contacts")];
  const canSeeUnits = state.user.role === "yonetici" || state.user.role === "personel";
  if (canSeeUnits) promises.push(api("/units"));
  promises.push(api("/personnel"));
  const [contacts, units = [], personnel] = await Promise.all(promises);

  const rows = [
    ...contacts.map((x) => ({ name: x.name, role: x.role || "Faydalı Numara", phone: x.phone })),
    ...personnel.map((x) => ({ name: x.name, role: x.department || "Personel", phone: x.phone })),
    ...units.filter((u) => u.ownerPhone).map((u) => ({ name: u.ownerName || "-", role: `${u.block} - Daire ${u.no} (Malik)`, phone: u.ownerPhone })),
    ...units.filter((u) => u.tenantPhone).map((u) => ({ name: u.tenantName || "-", role: `${u.block} - Daire ${u.no} (Kiracı)`, phone: u.tenantPhone })),
  ];

  c.innerHTML = `
    ${sectionTitle("Rehber", "Faydalı numaralar, personel ve site sakinleri")}
    <div class="field mb-16"><input id="rehberSearch" placeholder="İsim, telefon veya rol ara…" /></div>
    ${state.user.role === "yonetici" ? `
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Faydalı Numara Ekle</div>
      <form id="contactForm" class="form-row">
        <div class="field"><label>Ad</label><input name="name" required /></div>
        <div class="field"><label>Rol / Firma</label><input name="role" placeholder="Hidrofor Teknisyeni…" /></div>
        <div class="field"><label>Telefon</label><input name="phone" required /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>` : ""}
    <div class="card tight" id="rehberList">
      ${rows.map((r) => ledgerRow(esc(r.name), esc(r.role), `<a href="tel:${esc(r.phone)}" style="color:var(--navy);text-decoration:none;">${esc(r.phone)}</a>`)).join("") || '<div class="empty-row">Kayıt yok.</div>'}
    </div>
  `;
  document.getElementById("rehberSearch").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    const filtered = rows.filter((r) => (r.name + r.role + r.phone).toLowerCase().includes(q));
    document.getElementById("rehberList").innerHTML = filtered.map((r) => ledgerRow(esc(r.name), esc(r.role), `<a href="tel:${esc(r.phone)}" style="color:var(--navy);text-decoration:none;">${esc(r.phone)}</a>`)).join("") || '<div class="empty-row">Sonuç yok.</div>';
  });
  document.getElementById("contactForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await api("/contacts", { method: "POST", body: Object.fromEntries(f) }); toast("Rehbere eklendi."); renderTab("rehber"); }
    catch (err) { toast(err.message); }
  });
}

async function renderAyarlar(c) {
  const settings = await api("/settings");
  c.innerHTML = `
    ${sectionTitle("Ayarlar")}
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Gecikme Faizi</div>
      <p class="small muted" style="margin-top:-6px;margin-bottom:10px;">Son ödeme tarihinden belirlenen gün sonra hâlâ ödenmemiş aidatlara, her ay bir kez, kalan tutar üzerinden otomatik faiz eklenir.</p>
      <form id="lateFeeForm" class="form-row">
        <div class="field"><label>Aylık Faiz Oranı (%)</label><input name="lateFeeRate" type="number" step="0.1" value="${settings.lateFeeRate}" /></div>
        <div class="field"><label>Tolerans Süresi (gün)</label><input name="lateFeeGraceDays" type="number" value="${settings.lateFeeGraceDays}" /></div>
        <button class="btn btn-primary" type="submit">Kaydet</button>
      </form>
    </div>
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Otomatik Aylık Aidat Borçlandırma</div>
      <p class="small muted" style="margin-top:-6px;margin-bottom:10px;">Etkinleştirilirse, her ay belirlenen günde tüm dairelere otomatik olarak aidat borcu eklenir — elle "borçlandır" tıklamanız gerekmez.</p>
      <form id="autoDueForm" class="form-row">
        <div class="field"><label><input type="checkbox" name="autoDueEnabled" ${settings.autoDueEnabled ? "checked" : ""} /> Etkin</label></div>
        <div class="field"><label>Ayın Kaçıncı Günü</label><input name="autoDueDay" type="number" min="1" max="28" value="${settings.autoDueDay}" /></div>
        <div class="field"><label>Aylık Tutar (₺)</label><input name="autoDueAmount" type="number" value="${settings.autoDueAmount}" /></div>
        <button class="btn btn-primary" type="submit">Kaydet</button>
      </form>
    </div>
    <div class="card form-card">
      <div class="ledger-title" style="padding:0 0 10px;">Site Bilgisi</div>
      <form id="buildingForm" class="form-row">
        <div class="field" style="flex:1 1 100%;"><label>Site Adı</label><input name="buildingName" value="${esc(settings.buildingName)}" /></div>
        <button class="btn btn-primary" type="submit">Kaydet</button>
      </form>
    </div>
  `;
  document.getElementById("lateFeeForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api("/settings", { method: "PATCH", body: f }); toast("Gecikme faizi ayarları kaydedildi."); }
    catch (err) { toast(err.message); }
  });
  document.getElementById("autoDueForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = { autoDueEnabled: fd.get("autoDueEnabled") === "on", autoDueDay: fd.get("autoDueDay"), autoDueAmount: fd.get("autoDueAmount") };
    try { await api("/settings", { method: "PATCH", body }); toast("Otomatik borçlandırma ayarları kaydedildi."); }
    catch (err) { toast(err.message); }
  });
  document.getElementById("buildingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await api("/settings", { method: "PATCH", body: f }); toast("Site bilgisi kaydedildi."); }
    catch (err) { toast(err.message); }
  });
}

async function renderPersonelOzet(c) {
  const dash = await api("/dashboard");
  c.innerHTML = `
    ${sectionTitle("Merhaba, " + state.user.name.split(" ")[0], state.user.department || "")}
    <div class="grid cols-2">
      <div class="card stat-card clickable" data-goto="talep"><div class="stat-label">SİZE ATANAN AÇIK TALEP</div><div class="stat-value">${dash.openTickets}</div></div>
      <div class="card stat-card clickable" data-goto="demirbas"><div class="stat-label">BAKIMI GECİKEN DEMİRBAŞ</div><div class="stat-value">${dash.overdueEquipment}</div></div>
    </div>
  `;
  c.querySelectorAll("[data-goto]").forEach((el) => el.addEventListener("click", () => goToTab(el.dataset.goto)));
}
