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
  // ÜYELİK REST YÖNLENDİRMESİ (DDoS'a dayanıklı mimari):
  //  - Sayfa YÖNCÜ'den yayında ise (www.masaoyunlari.com.tr) üyelik uçları
  //    TARAYICIDAN DOĞRUDAN Yöncü PHP'sine gider (/api/auth.php, /api/social.php).
  //    Tarayıcı DDoS/anti-bot meydan okumasını sorunsuz geçiştirir —
  //    Render'ın sunucu-sunucu istekleri ise engelleniyor (303 HTML) ve
  //    "Üyelik sunucusundan boş cevap" hatasını üretti.
  //  - Sayfa Render/localhost/e2b'ten yayında ise (geliştirme) Render'ın
  //    kendi /api/* uçları kullanılır (yerel SQLite modu).
  // Soket katmanı (kimlik/davet) ise her iki durumda da Render'da çalışır;
  // kimlik PHP'nin imzaladığı kısa ömürlü "attest" belgesiyle taşınır.
  const TOK = 'gv-auth-token';
  let resetToken = null;

  function isYoncuPage() {
    const h = window.location.hostname;
    if (!/masaoyunlari\.com\.tr$/i.test(h)) return false;
    if (/(^|\.)onrender\.com$|\.e2b\.app$|localhost$|^127\.0\.0\.1$/.test(h)) return false;
    return true;
  }

  // REST yolu → Yöncü PHP ucu (YENİ istemci yalnızca bunları kullanır).
  const PHP_MAP = {
    '/api/auth/register': 'auth.php?action=register',
    '/api/auth/verify': 'auth.php?action=verify',
    '/api/auth/login': 'auth.php?action=login',
    '/api/auth/resend': 'auth.php?action=resend',
    '/api/auth/forgot': 'auth.php?action=forgot',
    '/api/auth/reset': 'auth.php?action=reset',
    '/api/auth/me': 'auth.php?action=me',
    '/api/auth/logout': 'auth.php?action=logout',
    '/api/auth/mail-status': 'auth.php?action=mail-status',
    '/api/auth/attest': 'auth.php?action=attest',
    '/api/friends': 'social.php?action=friends',
    '/api/friends/requests': 'social.php?action=friendRequests',
    '/api/friends/request': 'social.php?action=friendRequest',
    '/api/friends/add': 'social.php?action=friendAdd',
    '/api/friends/accept': 'social.php?action=friendAccept',
    '/api/friends/decline': 'social.php?action=friendDecline',
    '/api/friends/remove': 'social.php?action=friendRemove',
    '/api/friends/proof': 'social.php?action=friendProof'
  };

  // path (ops. ?query) → hedef URL. Yöncü sayfasında PHP'ye, diğerinde
  // Render'a giden doğru adresi üretir (profil/arama dinamik parametreli).
  function urlFor(path) {
    if (!isYoncuPage()) return BACKEND + path;
    const qi = path.indexOf('?');
    const base = qi === -1 ? path : path.slice(0, qi);
    const query = qi === -1 ? '' : path.slice(qi + 1);
    if (PHP_MAP[base]) return '/api/' + PHP_MAP[base] + (query ? '&' + query : '');
    // /api/users/search?q=... ve /api/users/:id/profile
    let m = base.match(/^\/api\/users\/(\d+)\/profile$/);
    if (m) return '/api/social.php?action=profile&id=' + m[1] + (query ? '&' + query : '');
    m = base.match(/^\/api\/users\/search$/);
    if (m) return '/api/social.php?action=search' + (query ? '&' + query : '');
    return BACKEND + path; // bilinmeyen uç: Render'a düş
  }

  function getToken() { try { return localStorage.getItem(TOK); } catch (_) { return null; } }
  function setToken(t) { try { t ? localStorage.setItem(TOK, t) : localStorage.removeItem(TOK); } catch (_) {} }

  async function api(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    const tok = getToken();
    // cPanel/FastCGI kurulumlarda Authorization başlığı PHP'ye geçmeyebilir;
    // bu yüzden aynı jetonu özel X-GV-Token başlığıyla da yollarız (yedek yol).
    if (tok) { headers.Authorization = 'Bearer ' + tok; headers['X-GV-Token'] = tok; }
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
    // isFounder: Kurucu Paneli yetkisi — sunucudan gelir (users.is_founder).
    // Bu alan taşınmazsa üst bardaki '👑 Kurucu Paneli' butonu hiç görünmez.
    s.user = { id: u.id, name: u.name, email: u.email, isFounder: u.isFounder === true,
               score: (s.user && s.user.score) || 0, level: 1 };
    try { localStorage.setItem('gv-user-name', u.name); } catch (_) {}
    ['checkAuthState', 'updateAuthState', 'updateScoreUI', 'renderFriends'].forEach(fn => {
      if (typeof window[fn] === 'function') try { window[fn](); } catch (_) {}
    });
    authHelloAll();
    refreshAttestation(); // soket kimliği için imzalı belgeyi hemen tazele
    // Çevrimiçi sayacı kimliği kişi başına sayar: giriş yapınca kayıt
    // "ziyaretçi"den "üye"ye taşınmalı, yoksa aynı kişi iki kez sayılır.
    try { window.dispatchEvent(new Event('gv:authChanged')); } catch (_) {}
  }

  function clearUser() {
    setToken(null);
    _attest = null;
    const s = st8();
    s.isGuest = true;
    s.user = { name: 'Ziyaretçi#' + Math.floor(100 + Math.random() * 900), score: 0, level: 1 };
    ['checkAuthState', 'updateAuthState', 'updateScoreUI'].forEach(fn => {
      if (typeof window[fn] === 'function') try { window[fn](); } catch (_) {}
    });
    try { window.dispatchEvent(new Event('gv:authChanged')); } catch (_) {}
  }

  // ---------- Soketlere kimlik (çevrimiçi + davet + sohbet) ----------
  // İmzalı kimlik belgesi (auth.php?action=attest): PHP tarafından
  // GV_SERVER_KEY ile imzalanır, 10 dk geçerlidir, Render'da YERİNDE
  // doğrulanır — soket katmanı, Yöncü DDoS koruması Render→PHP'yi
  // kapatsa bile kimlik doğrulamasını sürdürür.
  let _attest = null;      // { value, at }
  let _attestBusy = false;
  function attestation() {
    if (_attest && _attest.value && Date.now() - _attest.at < 8 * 60 * 1000) return _attest.value;
    return null;
  }
  async function refreshAttestation() {
    if (_attestBusy) return;
    if (!getToken()) return;
    _attestBusy = true;
    try {
      const r = await api('/api/auth/attest', null, 'GET');
      if (r.ok && r.attest) _attest = { value: r.attest, at: Date.now() };
    } catch (_) {}
    _attestBusy = false;
  }
  function authHello(sock) {
    if (!sock || !getToken()) return;
    const hello = () => {
      const att = attestation();
      sock.emit('authHello', att ? { token: getToken(), attestation: att } : { token: getToken() });
    };
    if (sock.connected) hello();
    if (!sock.__gvAuthHello) {
      sock.__gvAuthHello = true;
      sock.on('connect', hello);
    }
  }
  function authHelloAll() {
    [window.__gvRoomSocket, window.__gvLobbySocket, window.__gvChessSocket].forEach(authHello);
  }
  setInterval(() => { authHelloAll(); refreshAttestation(); }, 1500);

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
      // Giriş pop-up'ı YERİNE "E-postanı Doğrula" bilgi kutusu (kullanıcılar
      // onaysız giriş yapmaya çalışmasın).
      const addr = document.getElementById('verifyMailAddr');
      if (addr) addr.textContent = email;
      showModal('verifyMailModal');
      toast(r.message || '📧 Onay bağlantısı e-postanıza gönderildi!', r.mailSent ? 'success' : 'warning');
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
      if (r.ok && r.user) {
        applyUser(r.user);
        // Yenilemede sessiz geri yükleme yerine kısa bir karşılama — kullanıcı
        // üyeliğinin korunduğunu hemen görsün (yanıltıcı "ziyaretçi" hissi yok).
        toast('👋 Tekrar hoş geldiniz, ' + (r.user.name || 'üye') + '!', 'success', 3500);
      }
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
    // "E-postanı Doğrula" kutusundaki tekrar gönder butonu
    GV.resendVerifyMail = async function () {
      const addrEl = document.getElementById('verifyMailAddr');
      const em = (addrEl && addrEl.textContent || '').trim();
      if (!em) return toast('⚠️ E-posta adresi bulunamadı.', 'error');
      toast('📧 Mail gönderiliyor...', 'info');
      const rr = await api('/api/auth/resend', { email: em });
      toast(rr.ok ? '📧 Onay bağlantısı yeniden gönderildi. Spam klasörüne de bak!' : ('⚠️ ' + (rr.error || 'Gönderilemedi.')), rr.ok ? 'success' : 'error');
    };
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
    window.GVAuth = { token: getToken, user: () => (st8().isGuest ? null : st8().user), login: doLogin, logout: () => GV.logout(), api, authHelloAll, authHello, attestation, refreshAttestation };
    hook.done = true;
  }
  hook.done = false;
  setInterval(hook, 500);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot(), { once: true });
  else boot();
})();
