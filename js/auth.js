/* GameVerse — Gerçek Üyelik (şifre + e-posta onayı + sıfırlama)
 *
 *  Backend: server-auth.js (Render) — SQLite + bcrypt + nodemailer.
 *  Bu modül:
 *   - login/register/forgot/reset/logout submit handler'larını GERÇEK API'ye bağlar
 *   - ?verify= / ?reset= link akışlarını işler (mailden gelen onay linkleri)
 *   - gv-auth-token ile otomatik oturum açar (/api/auth/me)
 *   - her soket bağlandığında sunucuya authHello(token) gönderir (çevrimiçi
 *     durum + davet + sohbet üyeliği için kimlik)
 */
(function () {
  'use strict';

  const BACKEND = (window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  // Kalıcı veri (üyelik/profil/arkadaş/maç) Yöncü PHP API'de tutulur —
  // GV_PHP_API tanımlıysa REST çağrıları PHP'ye gider (config.js ayarlar).
  const PHP = (window.GV_PHP_API || '').replace(/\/+$/, '');
  const TOK = 'gv-auth-token';
  let resetToken = null;

  function urlFor(path) {
    if (!PHP) return BACKEND + path;
    let m = path.match(/^\/api\/users\/(\d+)\/profile$/);
    if (m) return PHP + '/social.php?action=profile&id=' + m[1];
    m = path.match(/^\/api\/users\/search\?q=(.*)$/);
    if (m) return PHP + '/social.php?action=search&q=' + m[1];
    m = path.match(/^\/api\/auth\/(\w+)$/);
    if (m) return PHP + '/auth.php?action=' + m[1];
    if (path === '/api/friends') return PHP + '/social.php?action=friends';
    m = path.match(/^\/api\/friends\/(\w+)$/);
    if (m) return PHP + '/social.php?action=' + ({ add: 'friendAdd', remove: 'friendRemove' }[m[1]] || m[1]);
    return BACKEND + path;
  }

  function getToken() { try { return localStorage.getItem(TOK); } catch (_) { return null; } }
  function setToken(t) { try { t ? localStorage.setItem(TOK, t) : localStorage.removeItem(TOK); } catch (_) {} }

  async function api(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = getToken();
    if (tok) headers.Authorization = 'Bearer ' + tok;
    const r = await fetch(urlFor(path), {
      method: method || (body ? 'POST' : 'GET'),
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch (_) {}
    if (!data) {
      // oPanel gibi paneller hata gövdelerini (JSON'ı) kendi hata sayfasıyla
      // değiştirebiliyor — duruma göre okunabilir Türkçe mesaj üretelim.
      const m = {
        401: 'Kullanıcı adı/e-posta veya şifre hatalı.',
        403: 'E-posta adresiniz onay bekliyor olabilir — gelen kutusunu ve spam klasörünü kontrol edin.',
        404: 'Sunucudaki uygulama eski sürümde görünüyor.',
        409: 'Bu kullanıcı adı veya e-posta zaten kayıtlı.',
        500: 'Sunucu hatası (500).',
        503: 'Sunucu geçici olarak hizmet veremiyor (bakım veya veritabanı).'
      };
      data = { ok: false, error: m[r.status] || 'Sunucuya ulaşılamadı.' };
    }
    return { status: r.status, ...data };
  }

  function st8() { return window.st || {}; }
  function toast(msg, type, ms) { if (window.GV && GV.toast) GV.toast(msg, type || 'info', ms || 5000); }
  function showModal(id) { if (window.GV && GV.showModal) GV.showModal(id); }
  function hideModal(id) { if (window.GV && GV.hideModal) GV.hideModal(id); }

  function applyUser(u, tok) {
    if (tok) setToken(tok);
    const s = st8();
    s.isGuest = false;
    s.user = { id: u.id, name: u.name, email: u.email, score: (s.user && s.user.score) || 0, level: 1 };
    try { localStorage.setItem('gv-user-name', u.name); } catch (_) {}
    ['checkAuthState', 'updateAuthState', 'updateScoreUI', 'renderFriends'].forEach(fn => {
      if (typeof window[fn] === 'function') try { window[fn](); } catch (_) {}
    });
    authHelloAll();
  }

  function clearUser() {
    setToken(null);
    const s = st8();
    s.isGuest = true;
    s.user = { name: 'Ziyaretçi#' + Math.floor(100 + Math.random() * 900), score: 0, level: 1 };
    ['checkAuthState', 'updateAuthState', 'updateScoreUI'].forEach(fn => {
      if (typeof window[fn] === 'function') try { window[fn](); } catch (_) {}
    });
  }

  // ---------- Soketlere kimlik (çevrimiçi + davet + sohbet) ----------
  function authHello(sock) {
    if (!sock || !getToken()) return;
    const hello = () => sock.emit('authHello', { token: getToken() });
    if (sock.connected) hello();
    if (!sock.__gvAuthHello) {
      sock.__gvAuthHello = true;
      sock.on('connect', hello);
    }
  }
  function authHelloAll() {
    [window.__gvRoomSocket, window.__gvLobbySocket, window.__gvChessSocket].forEach(authHello);
  }
  setInterval(authHelloAll, 1500);

  // ---------- Modal akışları ----------
  async function doLogin() {
    const idEl = document.getElementById('loginUser');
    const pwEl = document.getElementById('loginPass');
    const ident = (idEl && idEl.value || '').trim();
    const password = (pwEl && pwEl.value) || '';
    if (!ident || !password) return toast('E-posta/kullanıcı adı ve şifre girin.', 'warning');
    toast('🔑 Giriş yapılıyor...', 'info');
    const r = await api('/api/auth/login', { email: ident, password });
    if (r.ok && r.token) {
      applyUser(r.user, r.token);
      hideModal('loginModal');
      toast(`🎉 Hoş geldiniz, ${r.user.name}!`, 'success');
      return;
    }
    if (r.needVerify) {
      toast('⚠️ ' + (r.error || 'E-postanız onaylanmadı.'), 'error');
      if (confirm('E-postanız henüz onaylanmadı.\n\nOnay bağlantısını TEKRAR GÖNDERMEK ister misiniz?')) {
        const rr = await api('/api/auth/resend', { email: r.email || ident });
        toast(rr.ok ? '📧 Onay bağlantısı yeniden gönderildi.' : ('⚠️ ' + (rr.error || 'Gönderilemedi')), rr.ok ? 'success' : 'error');
      }
      return;
    }
    toast('⚠️ ' + (r.error || 'Giriş başarısız.'), 'error');
  }

  async function doRegister() {
    const nameEl = document.getElementById('regUser');
    const emEl = document.getElementById('regEmail');
    const pwEl = document.getElementById('regPass');
    const name = (nameEl && nameEl.value || '').trim();
    const email = (emEl && emEl.value || '').trim();
    const password = (pwEl && pwEl.value) || '';
    toast('📝 Kayıt oluşturuluyor...', 'info');
    const r = await api('/api/auth/register', { name, email, password });
    if (r.ok) {
      hideModal('registerModal');
      toast(r.message || '📧 Onay bağlantısı e-postanıza gönderildi!', r.mailSent ? 'success' : 'warning');
      showModal('loginModal');
      return;
    }
    toast('⚠️ ' + (r.error || 'Kayıt başarısız.'), 'error');
  }

  async function doForgot() {
    const emEl = document.getElementById('forgotEmail');
    const email = (emEl && emEl.value || '').trim();
    if (!email) return toast('E-posta adresi girin!', 'warning');
    const r = await api('/api/auth/forgot', { email });
    hideModal('forgotPasswordModal');
    toast(r.message || '📧 Bağlantı gönderildiyse e-postanızda görünür.', 'success');
  }

  // ---------- Şifre sıfırlama (maildeki linkten gelen ?reset= akışı) ----------
  function openResetModal() {
    let ov = document.getElementById('gvResetModal');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'gvResetModal';
      ov.style.cssText = 'position:fixed;inset:0;z-index:2147482500;background:rgba(6,7,20,.85);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)';
      ov.innerHTML =
        '<div style="background:#12122b;border:1px solid rgba(255,255,255,.15);border-radius:16px;max-width:380px;width:92%;padding:24px;color:#fff">' +
        '<h2 style="margin-top:0">🔒 Yeni Şifre Belirle</h2>' +
        '<p style="color:#9aa0b4;font-size:.85em">Sıfırlama bağlantınız doğrulandı. Yeni şifrenizi girin:</p>' +
        '<input id="gvResetPass1" type="password" placeholder="Yeni şifre (en az 6 karakter)" style="width:100%;margin-bottom:10px;padding:11px;border-radius:9px;border:1px solid rgba(255,255,255,.15);background:#0d0d22;color:#fff">' +
        '<input id="gvResetPass2" type="password" placeholder="Yeni şifre (tekrar)" style="width:100%;margin-bottom:14px;padding:11px;border-radius:9px;border:1px solid rgba(255,255,255,.15);background:#0d0d22;color:#fff">' +
        '<button id="gvResetSubmit" style="width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#00b894,#00a381);color:#fff;font-weight:800;cursor:pointer">Şifremi Güncelle</button>' +
        '</div>';
      document.body.appendChild(ov);
      ov.querySelector('#gvResetSubmit').addEventListener('click', async () => {
        const p1 = ov.querySelector('#gvResetPass1').value;
        const p2 = ov.querySelector('#gvResetPass2').value;
        if (p1.length < 6) return toast('Şifre en az 6 karakter olmalı.', 'warning');
        if (p1 !== p2) return toast('Şifreler uyuşmuyor.', 'warning');
        const r = await api('/api/auth/reset', { token: resetToken, password: p1 });
        if (r.ok) {
          ov.remove();
          toast('✅ Şifreniz güncellendi! Yeni şifrenizle giriş yapabilirsiniz.', 'success');
          showModal('loginModal');
        } else {
          toast('⚠️ ' + (r.error || 'Sıfırlama başarısız.'), 'error');
        }
      });
    }
  }

  // ---------- Oturum açma / query akışları ----------
  async function boot() {
    // Mail linki: ?verify=TOKEN / ?reset=TOKEN
    const q = new URLSearchParams(location.search);
    const vt = q.get('verify');
    const rt = q.get('reset');
    if (vt || rt) {
      history.replaceState({}, '', location.pathname);
      if (vt) {
        const r = await api('/api/auth/verify', { token: vt });
        toast(r.ok ? '✅ Üyeliğiniz onaylandı! Giriş yapabilirsiniz.' : ('⚠️ ' + (r.error || 'Onay yapılamadı')), r.ok ? 'success' : 'error');
        if (r.ok) showModal('loginModal');
      } else {
        resetToken = rt;
        openResetModal();
      }
    }
    // Otomatik oturum
    if (getToken()) {
      const r = await api('/api/auth/me', null, 'GET');
      if (r.ok && r.user) applyUser(r.user);
      else setToken(null);
    }
  }

  // ---------- Gerçek API'lere bağlan (var olan modal handler'ları override) ----------
  function hook() {
    if (!window.GV || hook.done) return;
    const GV = window.GV;
    GV.submitLogin = doLogin;
    GV.submitRegister = doRegister;
    GV.submitForgotPassword = doForgot;
    // Çıkış: token'ı da temizle
    const origLogout = GV.logout;
    GV.logout = function () {
      const tok = getToken();
      if (tok) api('/api/auth/logout', {}).catch(() => {});
      clearUser();
      if (typeof origLogout === 'function') {
        try { origLogout.apply(this, arguments); } catch (_) {}
      }
    };
    window.GVAuth = { token: getToken, user: () => (st8().isGuest ? null : st8().user), login: doLogin, logout: () => GV.logout(), api, authHelloAll };
    hook.done = true;
  }
  hook.done = false;
  setInterval(hook, 500);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
})();
