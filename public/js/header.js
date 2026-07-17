/* Shared across every page: header, API helper, device fingerprint,
   copy-protection, and the Terms & Conditions modal. Plain JS, no build step. */

/* ---------- Device fingerprint (stable per browser; powers the 2-device limit) ---------- */
function getDeviceId() {
  try {
    var id = localStorage.getItem('tt_device_id');
    if (!id) {
      id = 'dev-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('tt_device_id', id);
    }
    return id;
  } catch (e) { return 'dev-unknown'; }
}

/* ---------- Shared fetch helper (sends the device id on every request) ---------- */
async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const headers = Object.assign(
    isFormData ? {} : { 'Content-Type': 'application/json' },
    { 'x-device-id': getDeviceId() },
    options.headers || {}
  );
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
    body: options.body && !isFormData && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

async function getCurrentUser() {
  const { user } = await api('/api/auth/me');
  return user;
}

/* ---------- Display modes (shared by every outer page) ----------
   One persisted preference — 'gamify' (the sci-fi look, default) or 'minimal'
   (the original clean light styling) — applied by toggling the body classes
   the two skins are scoped under. A tiny inline snippet at the top of each
   page's <body> applies the saved mode before first paint so there's no dark
   flash; these functions handle live switching and the chooser popup. */
function ttGetDisplayMode() {
  try { return localStorage.getItem('tt_display_mode') === 'minimal' ? 'minimal' : 'gamify'; } catch (e) { return 'gamify'; }
}
function ttApplyDisplayMode(mode) {
  var minimal = mode === 'minimal';
  document.documentElement.classList.toggle('tt-minimal', minimal);
  // Outer pages scope their sci-fi skin under body.scifi; the app under
  // body.tt-scifi. Toggle whichever this page uses.
  if (document.getElementById('site-header')) document.body.classList.toggle('scifi', !minimal);
  if (document.querySelector('.app-header')) document.body.classList.toggle('tt-scifi', !minimal);
}
function ttSetDisplayMode(mode) {
  try { localStorage.setItem('tt_display_mode', mode === 'minimal' ? 'minimal' : 'gamify'); } catch (e) {}
  ttApplyDisplayMode(mode);
  ttCloseDisplayMenu();
}
function ttCloseDisplayMenu() {
  var ov = document.getElementById('tt-display-menu'); if (ov) ov.remove();
}
function ttOpenDisplayMenu() {
  ttCloseDisplayMenu();
  var dark = document.body.classList.contains('scifi') || document.body.classList.contains('tt-scifi');
  var cur = ttGetDisplayMode();
  var card = 'background:' + (dark ? '#0c1220' : '#ffffff') + ';color:' + (dark ? '#e8f1f8' : '#10151b')
    + ';border:1px solid ' + (dark ? 'rgba(255,255,255,.16)' : '#e2e6e9')
    + ';border-radius:18px;padding:22px;max-width:340px;width:calc(100vw - 40px);box-shadow:0 30px 80px rgba(0,0,0,.45)';
  var opt = 'display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:13px 14px;border-radius:12px;'
    + 'border:1px solid ' + (dark ? 'rgba(255,255,255,.12)' : '#e2e6e9') + ';background:transparent;color:inherit;'
    + 'font:inherit;font-weight:600;cursor:pointer;margin-top:10px';
  var on = 'outline:2px solid ' + (dark ? '#22d3ee' : '#0f9c8c');
  var opts = ''
    + '<button style="' + opt + (cur === 'gamify' ? ';' + on : '') + '" onclick="ttSetDisplayMode(\'gamify\')">🚀 <span>Sci-fi Gamify mode<br><small style="font-weight:500;opacity:.7">Immersive dark theme with motion</small></span></button>'
    + '<button style="' + opt + (cur === 'minimal' ? ';' + on : '') + '" onclick="ttSetDisplayMode(\'minimal\')">🔬 <span>Minimalist mode<br><small style="font-weight:500;opacity:.7">Clean, light, distraction-free</small></span></button>';
  // App-only extras (green palette + eye comfort) appear when their toggles exist.
  if (typeof window.toggleGreenTheme === 'function') {
    opts += '<button style="' + opt + '" onclick="toggleGreenTheme();ttCloseDisplayMenu()">🌿 <span>Green theme<br><small style="font-weight:500;opacity:.7">Switch the gamify palette to green</small></span></button>';
  }
  if (typeof window.toggleEyeComfort === 'function') {
    opts += '<button style="' + opt + '" onclick="toggleEyeComfort();ttCloseDisplayMenu()">👁️ <span>Eye comfort<br><small style="font-weight:500;opacity:.7">Warmer, gentler colours</small></span></button>';
  }
  var ov = document.createElement('div');
  ov.id = 'tt-display-menu';
  ov.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(2,5,10,.55);backdrop-filter:blur(4px)';
  ov.innerHTML = '<div style="' + card + '" role="dialog" aria-label="Display options">'
    + '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:1.05rem">Display options</b>'
    + '<button onclick="ttCloseDisplayMenu()" aria-label="Close" style="border:none;background:none;color:inherit;font-size:1.5rem;cursor:pointer;line-height:1">&times;</button></div>'
    + opts + '</div>';
  ov.addEventListener('click', function (e) { if (e.target === ov) ttCloseDisplayMenu(); });
  document.body.appendChild(ov);
}

/* ---------- Header with pinned My Account ---------- */
function renderHeader(activePage) {
  const el = document.getElementById('site-header');
  if (!el) return;
  el.innerHTML = `
    <img class="logo-mark" src="/img/logo.png" alt="Tabib Talk logo">
    <div class="brand-text"><strong>Tabib Talk</strong><span>Egyptian Medical Arabic</span></div>
    <nav>
      <a href="/index.html" data-key="home">Land up page</a>
      <a href="/plans.html" data-key="plans" data-plans-link>Plans</a>
      <a href="/app.html" class="cta" data-key="app" onclick="return openAppGuard(event)">Open the Website</a>
      <a href="/account.html" class="account-pin" data-key="account">My Account</a>
      <button type="button" onclick="ttOpenDisplayMenu()" aria-label="Display options" title="Display options — Gamify / Minimalist"
        style="width:36px;height:36px;border-radius:10px;border:1px solid rgba(128,128,128,.35);background:transparent;color:inherit;cursor:pointer;font-size:1rem;flex:none">🎨</button>
    </nav>`;
  el.querySelectorAll('nav a').forEach(a => { if (a.dataset.key === activePage) a.classList.add('active'); });
  ttApplyDisplayMode(ttGetDisplayMode());
  // Kill-switch: hide every Plans link when the admin has disabled the
  // commercial surface.
  fetch('/api/site-config', { credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (cfg && cfg.plansEnabled === false) {
        document.querySelectorAll('[data-plans-link]').forEach(function (a) { a.style.display = 'none'; });
      }
    })
    .catch(function () {});
}

/* NOTE: useBackButton() used to swap the top-right "Home" link for a "← Back"
   button on the Plans page. That link is now "Land up page" and must stay
   intact and functional on every page, including Plans — so the helper and its
   only call site (plans.html) were removed rather than left as a trap. */

/* ---------- Copy protection (deterrent; not unbreakable, by nature of the web) ---------- */
function enableCopyProtection() {
  document.body.classList.add('noselect');
  ['copy', 'cut', 'contextmenu', 'dragstart'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var t = e.target;
      // still allow interacting with form fields
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
    });
  });
  // block common devtools/copy shortcuts as a mild deterrent
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toLowerCase();
    if ((e.ctrlKey || e.metaKey) && ['c', 'x', 'u', 's'].indexOf(k) >= 0) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      e.preventDefault();
    }
  });
}

/* Blur-on-blur: mild deterrent that blurs the page while the tab/window
   isn't focused. Doesn't block screenshots or recording — nothing can —
   but adds a small speed bump. Applied site-wide alongside copy protection. */
function enableBlurOnBlur() {
  function setBlurred(on) { document.body.classList.toggle('tt-blurred', on); }
  document.addEventListener('visibilitychange', function () { setBlurred(document.hidden); });
  window.addEventListener('blur', function () { setBlurred(true); });
  window.addEventListener('focus', function () { setBlurred(false); });
}


/* ---------- Terms & Conditions modal (shared markup, injected on demand) ---------- */
function ensureTermsModal() {
  if (document.getElementById('terms-modal')) return;
  var ov = document.createElement('div');
  ov.className = 'modal-overlay'; ov.id = 'terms-modal';
  ov.innerHTML = `
    <div class="modal">
      <button class="modal-x" onclick="closeTerms()" aria-label="Close">&times;</button>
      <h2>Terms &amp; Conditions</h2>
      <p style="color:var(--muted);margin-top:0">Please read these before subscribing.</p>
      <div class="terms-body">
        <p><strong class="t-sub">1. No refund policy.</strong> All payments are final. Because access is granted manually after we confirm your payment, we do not offer refunds once a subscription has been activated. Please choose your plan carefully before paying.</p>
        <p><strong class="t-sub">2. No auto-payment, no forced commitment.</strong> We never store your card or set up automatic recurring charges. Nothing renews on its own and nothing is deducted without you choosing to pay again. We would rather earn your return through the quality of what we build than bind you to a subscription you didn't actively choose. When a plan's duration ends, access simply pauses until you decide to subscribe again.</p>
        <p><strong class="t-sub">3. One account, one person, up to two devices.</strong> Your account is for your personal use only. Sharing your login with others, or using it across more than two devices, is not permitted. Doing so may lead to your subscription being suspended or your account being banned, without refund.</p>
        <p><strong class="t-sub">4. Content is protected.</strong> The lessons, phrases, question banks and other materials are for your own study. Copying, redistributing, or reselling the content is not allowed.</p>
        <p><strong class="t-sub">5. Fair use.</strong> We may suspend or ban accounts that abuse the service, attempt to bypass access controls, or violate these terms.</p>
        <p style="color:var(--muted)">By subscribing, you agree to these terms.</p>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', function (e) { if (e.target === ov) closeTerms(); });
}
function openTerms() { ensureTermsModal(); document.getElementById('terms-modal').classList.add('open'); }
function closeTerms() { var m = document.getElementById('terms-modal'); if (m) m.classList.remove('open'); }
window.openTerms = openTerms; window.closeTerms = closeTerms;

/* Open App requires an account (items 10 & 11): logged-in users open the app,
   everyone else is sent to sign up first. */
async function openAppGuard(ev) {
  if (ev) ev.preventDefault();
  try {
    var user = await getCurrentUser();
    if (user) { window.location.href = '/app.html'; }
    else { window.location.href = '/login.html?next=/app.html'; }
  } catch (e) {
    window.location.href = '/login.html?next=/app.html';
  }
  return false;
}
window.openAppGuard = openAppGuard;
