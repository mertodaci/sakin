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
const PILL_MAP = { "Ödendi": "green", "Borçlu": "red", "Açık": "red", "İşlemde": "amber", "Çözüldü": "green", "Onaylandı": "green", "depoda": "grey", "zimmetli": "amber", "Teslim Alındı": "amber", "Teslim Edildi": "green", "Güncel": "green", "Bakım Gecikti": "red", "Pasif": "grey" };
function chargeTypeLabel(ch) { return ch.type === "aidat" ? "Aidat" : ch.type === "sayac" ? "Sayaç" : ch.type === "gecikme_faizi" ? "⚠ Gecikme Faizi" : "Diğer"; }
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
    { group: "Finans", items: [["tahsilat", "Aidat Takibi"], ["muhasebe", "Muhasebe"], ["kasalar", "Kasalar"], ["cari", "Firma & Personel"], ["butce", "Bütçe"]] },
    { group: "İletişim", items: [["duyuru", "Duyurular"], ["anket", "Anketler"], ["pano", "Site Panosu"], ["rehber", "Rehber"]] },
    { group: "Operasyon", items: [["rezervasyon", "Rezervasyonlar"], ["talep", "Talepler"], ["personel", "Personel"], ["demirbas", "Demirbaş"], ["sayac", "Sayaçlar"], ["kargo", "Kargo"], ["anahtar", "Anahtarlar"]] },
    { group: "Kurul & Hukuk", items: [["karar", "Karar Defteri"], ["icra", "İcra Takibi"], ["belgeler", "Belge Şablonları"]] },
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

function renderShell() {
  const app = document.getElementById("app");
  app.innerHTML = `
   <div class="app-shell">
     <aside class="sidebar" id="sidebar">
       <div class="sidebar-brand">
         <span class="f-display" style="font-weight:700;font-size:17px;color:var(--navy);">SAKİN</span>
         <span class="badge-role">${esc(ROLE_LABEL[state.user.role] || "")}</span>
       </div>
       <nav id="sidebarNav"></nav>
     </aside>
     <div class="main-col">
       <div class="topbar">
         <button class="hamburger" id="hamburgerBtn">☰</button>
         <div style="flex:1;"></div>
         <div class="right">
           <button class="bell" id="bellBtn">&#128276;<span class="dot" id="bellDot" style="display:none;"></span></button>
           <button class="ghost-dark" id="userMenuBtn">${esc(state.user.name)} ▾</button>
           <button class="ghost-dark" id="logoutBtn">Çıkış</button>
         </div>
       </div>
       <div class="wrap" id="content"></div>
     </div>
   </div>
   <div class="sidebar-overlay" id="sidebarOverlay"></div>
  `;
  renderSidebarNav();
  document.getElementById("logoutBtn").addEventListener("click", logout);
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
  panel.className = "notif-panel";
  panel.style.right = "16px";
  panel.innerHTML = `
    <button class="btn btn-ghost btn-sm" id="changePwBtn" style="width:100%;margin-bottom:8px;">Şifre Değiştir</button>
    <button class="btn btn-ghost btn-sm" id="logoutAllBtn" style="width:100%;">Tüm Oturumları Kapat</button>
    <p class="small muted" style="margin-top:8px;margin-bottom:0;">Başka bir cihazda açık kalmış olabilecek oturumları kapatır.</p>
  `;
  document.querySelector(".topbar").appendChild(panel);
  document.getElementById("changePwBtn").addEventListener("click", () => { panel.remove(); renderChangePasswordModal(); });
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
          ${g.items.map(([id, label]) => `<button class="sidebar-item ${state.tab === id ? "active" : ""}" data-tab="${id}">${esc(label)}</button>`).join("")}
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
        <div><div class="stat-label">GÜNCEL BAKİYE</div><div class="f-num stat-value" style="color:${dash.debt > 0 ? "var(--red)" : "var(--green)"}">${tl(dash.debt)}</div></div>
        ${pill(dash.debt > 0 ? "Borçlu" : "Ödendi")}
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
  const [charges, payments] = await Promise.all([api("/charges"), api("/payments")]);
  const debt = charges.filter((x) => x.status !== "paid").reduce((s, x) => s + (x.amount - x.paidAmount), 0);
  c.innerHTML = `
    ${sectionTitle("Aidatım", "Hesap özeti banka ekstresi mantığıyla listelenir")}
    <div class="card pad mb-16 flex-between">
      <div><div class="stat-label">ÖDENECEK TUTAR</div><div class="f-num stat-value" style="color:${debt > 0 ? "var(--red)" : "var(--green)"}">${tl(debt)}</div></div>
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

  const [charges, payments] = await Promise.all([api("/charges?unitId=" + unit.id), api("/payments?unitId=" + unit.id)]);
  const entries = [];
  charges.forEach((ch) => entries.push({ date: ch.dueDate, label: `${chargeTypeLabel(ch)} — ${ch.description || ""}`, amount: Number(ch.amount) }));
  payments.filter((p) => !p.cancelled).forEach((p) => entries.push({ date: p.date, label: `Tahsilat (${p.method}) — Makbuz ${p.receiptNo}`, amount: -Number(p.amount) }));
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  entries.forEach((e) => { running += e.amount; e.balance = running; });

  const body = overlay.querySelector("#hesapOzetiBody");
  if (!entries.length) { body.innerHTML = '<div class="empty-row">Hareket kaydı yok.</div>'; return; }
  body.innerHTML = `
    <div class="scroll-x">
      <table class="simple">
        <thead><tr><th>Tarih</th><th>Açıklama</th><th style="text-align:right;">Tutar</th><th style="text-align:right;">Bakiye</th></tr></thead>
        <tbody>${entries.slice().reverse().map((e) => `
          <tr>
            <td>${dt(e.date)}</td>
            <td>${esc(e.label)}</td>
            <td class="f-num" style="text-align:right;color:${e.amount > 0 ? "var(--red)" : "var(--green)"};">${e.amount > 0 ? "+" : ""}${tl(e.amount)}</td>
            <td class="f-num" style="text-align:right;font-weight:600;">${tl(e.balance)}</td>
          </tr>`).join("")}</tbody>
      </table>
    </div>
    <div class="small muted" style="margin-top:12px;">Güncel bakiye: <b style="color:${running > 0 ? "var(--red)" : "var(--green)"};">${tl(running)}</b>${running > 0 ? " (borçlu)" : " (borcu yok)"}</div>
  `;
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
        <div class="field"><label>Aidat Grubu</label><input name="feeGroup" placeholder="Örn. 2+1, Villa…" /></div>
        <button class="btn btn-primary" type="submit">Ekle</button>
      </form>
    </div>
    <div class="card tight">
      ${list.map((u) => `
        <div class="ledger-row"><div><div style="font-size:14px;font-weight:600;">${esc(u.block)} - Daire ${esc(u.no)}</div><div class="small muted">${esc(u.ownerName || "-")}${u.tenantName ? " (Kiracı: " + esc(u.tenantName) + ")" : ""}${u.feeGroup ? " · " + esc(u.feeGroup) : ""}${u.landShare ? " · Arsa Payı: " + esc(String(u.landShare)) : ""}</div></div>
        <div style="display:flex;align-items:center;gap:10px;"><div class="f-num" style="color:${u.debt > 0 ? "var(--red)" : "var(--green)"};font-weight:600;">${tl(u.debt)}</div><button class="btn btn-ghost btn-sm" data-ozet="${u.id}" title="Hesap Özeti">📄</button><button class="btn btn-ghost btn-sm" data-editunit="${u.id}">Düzenle</button></div></div>`).join("") || '<div class="empty-row">Kayıt yok.</div>'}
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
        <div class="field" style="flex:1 1 140px;"><label>Aidat Grubu</label><input name="feeGroup" value="${esc(u.feeGroup || "")}" /></div>
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
  const [units, accounts, payments] = await Promise.all([api("/units"), api("/accounts"), api("/payments")]);
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

  // Yönetimcell karşılaştırmasından: borç eşiği filtresi (birçok ekranda
  // tekrar eden bir kalıp - "1.000 ₺ ve daha fazla borcu olan" gibi).
  function renderUnitsListBox() {
    const threshold = Number(document.getElementById("debtFilter").value || 0);
    const filtered = threshold <= 0 ? units : threshold === 1 ? units.filter((u) => u.debt > 0) : units.filter((u) => u.debt >= threshold);
    const box = document.getElementById("unitsListBox");
    box.innerHTML = filtered.map((u) => `
        <div class="ledger-row" style="flex-wrap:wrap;">
          <div><div style="font-size:14px;font-weight:600;">${esc(u.block)} - Daire ${esc(u.no)}</div><div class="small muted">${esc(u.ownerName || "-")}</div></div>
          <div style="display:flex;align-items:center;gap:10px;"><span class="f-num" style="font-weight:600;color:${u.debt > 0 ? "var(--red)" : "var(--green)"};">${tl(u.debt)}</span>${pill(u.debt > 0 ? "Borçlu" : "Ödendi")}<button class="btn btn-ghost btn-sm" data-ozet="${u.id}" title="Hesap Özeti">📄</button>${u.debt > 0 ? `<button class="btn btn-ghost btn-sm" data-collect="${u.id}">Tahsil Et</button>` : ""}</div>
          <div style="width:100%;" id="collect-form-${u.id}"></div>
        </div>`).join("") || '<div class="empty-row">Bu filtreye uyan daire yok.</div>';
    box.querySelectorAll("[data-ozet]").forEach((b) => b.addEventListener("click", () => {
      const u = units.find((x) => x.id === b.dataset.ozet);
      if (u) renderHesapOzetiModal(u);
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
  const [vendors, personnel, charges, accounts] = await Promise.all([api("/vendors"), api("/personnel"), api("/party-charges"), api("/accounts")]);
  const personnelDebt = (id) => charges.filter((ch) => ch.partyType === "personel" && ch.partyId === id && ch.status !== "paid").reduce((s, ch) => s + (ch.amount - ch.paidAmount), 0);

  function partyCard(name, sub, debt, partyType, partyId) {
    return `
      <div class="card pad mb-16">
        <div class="flex-between">
          <div><div style="font-weight:700;">${esc(name)}</div><div class="small muted">${esc(sub)}</div></div>
          <div class="f-num" style="font-weight:600;color:${debt > 0 ? "var(--red)" : "var(--green)"};">${tl(debt)}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;">
          <button class="btn btn-ghost btn-sm" data-charge="${partyType}|${partyId}">+ Borçlandır</button>
          ${debt > 0 ? `<button class="btn btn-ghost btn-sm" data-pay="${partyType}|${partyId}|${debt}">Öde</button>` : ""}
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
        <div class="field"><label>Telefon</label><input name="phone" /></div>
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
  c.querySelectorAll("[data-tebligat]").forEach((b) => b.addEventListener("click", () => {
    downloadFile(`/documents/tebligat/${b.dataset.tebligat}?tier=${b.dataset.tier}`, `${b.dataset.tier}.pdf`);
  }));
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
