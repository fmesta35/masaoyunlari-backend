/* GameVerse — Kurucu Paneli (yönetici)
 *
 *  Yalnız KURUCU hesabının (veritabanında is_founder = 1) oturumunda üst bara
 *  "👑 Kurucu Paneli" butonu gelir. Panelde iki sekme:
 *
 *  1) 👥 KULLANICI & ROLLER — üye listesi (isim, e-posta, katılım tarihi, rol)
 *  2) 🎮 OYUNLAR — tüm oyunlar liste halinde:
 *       - sitede GÖRÜNÜR / GİZLİ anahtarı,
 *       - hazır masa SAYISI artır/azalt (standart 10 masalı oyunlar),
 *       - masa ADLARI ve TİPLERİ düzenlenebilir,
 *       - "Kaydet ve Uygula" → kalıcı veriye (Yöncü MySQL) yazılır VE
 *         Render anında uygular (lobi/menu canlı güncellenir).
 *
 *  Veri yolu (DDoS'a dayanıklı mimariyle uyumlu):
 *   - Yöncü sayfasında: tarayıcı → Yöncü PHP /api/admin.php (kalıcı kayıt)
 *   - Her ortamda:      tarayıcı → Render /api/admin/tables-apply (canlı uygulama)
 */
(function () {
  'use strict';

  const BACKEND = (window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  // Kurucu e-postası artık ZORUNLU DEĞİL: yetki öncelikle sunucunun
  // döndürdüğü user.isFounder bayrağından gelir (veritabanındaki
  // is_founder sütunu). Bu değişken yalnız ek/yedek eşleşme içindir.
  const ADMIN_EMAIL = String(window.__gvAdminEmail || '').toLowerCase();

  // Standart hazır-masa (10 masa) açan oyunlar; okey sabit 18 masa;
  // diğerleri (kart oyunları vb.) yalnız görünürlük yönetilir.
  const STANDARD = ['chess', 'tavla', 'okey', 'okey101', 'pisti', 'batak', 'dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo', 'battleship'];
  const FIXED = [];
  const TYPE_DEFS = [
    { type: 'fast', label: '⚡ Hızlı (10 dk)', duration: 10 },
    { type: 'normal', label: '♟️ Normal (15 dk)', duration: 15 },
    { type: 'thinker', label: '🧠 Düşünen (20 dk)', duration: 20 }
  ];
  const TYPE_LABEL = { fast: '⚡ Hızlı', normal: '♟️ Normal', thinker: '🧠 Düşünen' };

  let settingsCache = null;   // panelin düzenlediği yapılandırma
  let panelTab = 'users';
  let usersLoaded = false;

  // ---------------- yardımcılar ----------------
  function st8() { return window.st || {}; }
  function toast(m, t, ms) { if (window.GV && GV.toast) GV.toast(m, t || 'info', ms || 4500); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function trDate(ts) {
    const d = new Date(Number(ts || 0));
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function isYoncuPage() {
    const h = window.location.hostname;
    if (!/masaoyunlari\.com\.tr$/i.test(h)) return false;
    if (/(^|\.)onrender\.com$|\.e2b\.app$|localhost$|^127\.0\.0\.1$/.test(h)) return false;
    return true;
  }
  function isAdmin() {
    const s = st8();
    if (!s.user) return false;
    if (s.user.isFounder === true || Number(s.user.is_founder) === 1) return true;
    return !!(ADMIN_EMAIL && s.user.email && String(s.user.email).toLowerCase() === ADMIN_EMAIL);
  }

  async function api(path, body, method) {
    const headers = { 'Content-Type': 'application/json' };
    let tok = null;
    try { tok = localStorage.getItem('gv-auth-token'); } catch (_) {}
    if (tok) { headers.Authorization = 'Bearer ' + tok; headers['X-GV-Token'] = tok; }
    // Render'a (BACKEND) giden Kurucu Paneli çağrılarına İMZALI kimlik
    // belgesini de ekle: Yöncü'nün DDoS koruması Render'ın PHP'ye
    // sunucu-sunucu ulaşmasını (auth.php?action=me) engelleyebiliyor —
    // requireAdmin() bu belgeyle (founder bayrağı imzalı) PHP'ye hiç
    // ulaşmadan yetkiyi doğrular. js/auth.js belgeyi 1.5 sn'de bir tazeler.
    if (path.indexOf(BACKEND) === 0 && window.GVAuth && typeof GVAuth.attestation === 'function') {
      try {
        const att = GVAuth.attestation();
        // encodeURIComponent: HTTP başlık değerleri yalnız Latin-1 kabul
        // eder — kullanıcı adı Türkçe karakter (ı,ş,ç...) içerebilir.
        if (att) headers['X-GV-Attest'] = encodeURIComponent(JSON.stringify(att));
      } catch (_) {}
    }
    const r = await fetch(path, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, ...(data || { ok: false, error: 'Boş cevap.' }) };
  }

  // Üye listesi — Yöncü sayfasında PHP'ye (kalıcı kayıt), diğerinde Render:
  async function fetchUsers() {
    if (isYoncuPage()) return api('/api/admin.php?action=users', null, 'GET');
    return api(BACKEND + '/api/admin/users', null, 'GET');
  }
  // Masa ayarları oku — Yöncü'de PHP'den (yoksa varsayılan), diğerinde Render:
  async function fetchSettings() {
    if (isYoncuPage()) {
      const r = await api('/api/admin.php?action=gamesGet', null, 'GET');
      if (r.ok) return (r.settings && typeof r.settings === 'object') ? r.settings : null;
      return null; // PHP'de kayıt yoksa sunucudaki varsayılanlar geçerli
    }
    const r = await api(BACKEND + '/api/admin/tables', null, 'GET');
    return (r.ok && r.games) ? r.games : null;
  }
  // Kaydet: 1) kalıcı veri (Yöncü PHP — yalnız Yöncü sayfasında) 2) Render CANLI:
  async function saveSettings(cfg) {
    if (isYoncuPage()) {
      const php = await api('/api/admin.php?action=gamesSave', { games: cfg }, 'POST');
      if (!php.ok) return { ok: false, error: php.error || 'Kayıt yapılamadı.' };
    }
    const apply = await api(BACKEND + '/api/admin/tables-apply', { games: cfg }, 'POST');
    if (!apply.ok) return { ok: false, error: apply.error || 'Uygulanamadı.' };
    // Görünürlüğü anında menüye yansıt:
    try {
      const m = {};
      (apply.games || []).forEach(g => { m[g.id] = g.visible; });
      window.__gvGameVisibility = m;
      // Tüm siteye yansıt: menü + ana sayfa + tüm oyunlar + sıralama/turnuva
      // sekmeleri + oyun skoru ızgarası (gizlenen oyunun tüm buton/görseli kalksın).
      ['renderSB', 'renderHome', 'renderAll', 'renderLBTabs', 'renderTournTabs', 'updateScoreUI']
        .forEach(fn => { if (typeof window[fn] === 'function') window[fn](); });
    } catch (_) {}
    return { ok: true };
  }

  // Varsayılan ayarlar (sunucudakiyle aynı kalıp):
  const BASE = { chess: 101, tavla: 201, dama: 401, turkdamasi: 501, reversi: 601, gomoku: 701, connect4: 801, bilardo: 921, okey: 301, okey101: 331, pisti: 341, batak: 361, battleship: 1001 };
  function defaultTables(gid) {
    const out = [];
    for (const t of TYPE_DEFS) {
      const n = (t.type === 'fast' ? 4 : t.type === 'normal' ? 3 : 3);
      for (let k = 0; k < n; k++) out.push({ name: `${t.label} Masa #${BASE[gid] + out.length}`, type: t.type, durationMinutes: t.duration });
    }
    return out;
  }
  function defaultSettings() {
    const cfg = {};
    const games = (window.GAMES && Object.keys(window.GAMES)) || STANDARD;
    for (const g of games) {
      if (STANDARD.includes(g)) cfg[g] = { visible: true, tables: defaultTables(g) };
      else cfg[g] = { visible: true };
    }
    return cfg;
  }

  // Yöncü'de kayıtlı ayar bloğu, YENİ eklenen bir oyunu (örn. battleship)
  // henüz İÇERMEYEBİLİR — eski kayıt üstüne yazılmadan önce kaydedilmişti.
  // Sunucu (server.js normPresetConfig) bu durumda o oyun için varsayılanı
  // kullanır; panel de AYNI mantığı uygulamazsa eksik oyun "0 masa" ile
  // görünür (kullanıcının bildirdiği hata). Bu yüzden alan-alan BİRLEŞTİR:
  // yalnız gerçekten kayıtlı olan visible/tables değerleri varsayılanın
  // üstüne yazılır, eksik oyun/alan varsayılanda kalır.
  function mergeIntoDefault(fetched) {
    const def = defaultSettings();
    if (!fetched || typeof fetched !== 'object') return def;
    const out = {};
    for (const gid of Object.keys(def)) {
      const base = def[gid];
      const src = fetched[gid];
      if (!src || typeof src !== 'object') { out[gid] = base; continue; }
      const merged = Object.assign({}, base);
      if (typeof src.visible === 'boolean') merged.visible = src.visible;
      if (STANDARD.includes(gid) && Array.isArray(src.tables) && src.tables.length) merged.tables = src.tables;
      out[gid] = merged;
    }
    // Kayıtlı ama artık listede olmayan bir oyun varsa (kaldırılmış oyun)
    // yine de kaybolmasın:
    for (const gid of Object.keys(fetched)) {
      if (!out[gid] && fetched[gid] && typeof fetched[gid] === 'object') out[gid] = fetched[gid];
    }
    return out;
  }

  // ---------------- panel gövdesi ----------------
  function panelModal() {
    let m = document.getElementById('adminPanelModal');
    if (m) return m;
    m = document.createElement('div');
    m.className = 'modal-bg';
    m.id = 'adminPanelModal';
    m.innerHTML = `
      <div class="modal" style="max-width:780px;width:96%;max-height:88vh;display:flex;flex-direction:column;padding:0;overflow:hidden">
        <div style="background:linear-gradient(135deg,#6c5ce7,#8f7bff);padding:16px 20px;display:flex;justify-content:space-between;align-items:center;flex:none">
          <h2 style="margin:0;font-size:1.25em;color:#fff">👑 Kurucu Paneli</h2>
          <button type="button" style="background:rgba(255,255,255,.25);border:none;color:#fff;width:30px;height:30px;border-radius:50%;font-size:1em;cursor:pointer" onclick="GV.hideModal('adminPanelModal')">✕</button>
        </div>
        <div style="display:flex;gap:6px;padding:10px 16px 0;flex:none;border-bottom:1px solid var(--border)">
          <button type="button" class="admin-tab" data-tab="users" style="padding:9px 14px;border:none;border-radius:9px 9px 0 0;font-weight:700;cursor:pointer;background:var(--bg3);color:var(--text)">👥 Kullanıcı &amp; Roller</button>
          <button type="button" class="admin-tab" data-tab="games" style="padding:9px 14px;border:none;border-radius:9px 9px 0 0;font-weight:700;cursor:pointer;background:var(--bg3);color:var(--text)">🎮 Oyunlar</button>
        </div>
        <div id="adminPanelBody" style="flex:1;overflow-y:auto;padding:16px"></div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) GV.hideModal('adminPanelModal'); });
    m.querySelectorAll('.admin-tab').forEach(b => b.addEventListener('click', () => {
      panelTab = b.getAttribute('data-tab');
      renderPanel();
    }));
    return m;
  }

  function renderPanel() {
    const body = document.getElementById('adminPanelBody');
    if (!body) return;
    // Sekme görünümleri:
    panelModal().querySelectorAll('.admin-tab').forEach(b => {
      const on = b.getAttribute('data-tab') === panelTab;
      b.style.background = on ? 'var(--primary)' : 'var(--bg3)';
      b.style.color = on ? '#fff' : 'var(--text)';
    });
    if (panelTab === 'users') renderUsersTab(body);
    else renderGamesTab(body);
  }

  // ---------- SEKME 1: Kullanıcı & Roller ----------
  /* ÜYE YAPTIRIMLARI (kullanıcı isteği):
       "üyelere yaptırım uyarlama özelliği gelsin ... tüm sohbetler
        kapatılsın kullanıcının (oyun içi ve genel sohbet) 1 gün, 1 hafta,
        1 ay, 1 yıl, sınırsız, belirli süreli girilen süre de sessizlik.
        Kısıtlama getirildiğinde ilgili kullanıcıya bildirim gider ...
        şimdilik sadece mesaj ve sohbet kısıtlaması yaptırımı uygulansın"

     Veri yolu: yaptırım uçları HER ORTAMDA Render'dadır (oyun sunucusu
     kısıtlamayı anında uygulayan taraf odur). Render kalıcı kaydı üyelik
     katmanına yazar — yerelde SQLite, üretimde Yöncü MySQL. Kurucu
     doğrulaması sunucuda (requireAdmin); buradaki arayüz yalnız görünüm. */
  let sanctionMap = {};        // userId -> aktif yaptırım
  let sanctionOpts = null;     // sunucudan gelen süre/tür seçenekleri
  let sanctionUser = null;     // penceresi açık olan üye

  async function fetchSanctions() {
    const r = await api(BACKEND + '/api/admin/sanctions', null, 'GET');
    const m = {};
    if (r && r.ok) (r.liste || []).forEach(y => { m[Number(y.userId)] = y; });
    return m;
  }
  async function fetchSanctionOpts() {
    if (sanctionOpts) return sanctionOpts;
    const r = await api(BACKEND + '/api/admin/sanctions/options', null, 'GET');
    // Sunucuya ulaşılamazsa panel yine de çalışsın (aynı kimlikler).
    sanctionOpts = (r && r.ok) ? r : {
      sureler: [{ id: '1g', etiket: '1 Gün' }, { id: '1h', etiket: '1 Hafta' },
                { id: '1a', etiket: '1 Ay' }, { id: '1y', etiket: '1 Yıl' },
                { id: 'sinirsiz', etiket: 'Sınırsız' }, { id: 'ozel', etiket: 'Belirli süre (dakika)' }],
      turler: [{ id: 'chat', etiket: 'Sohbet ve mesaj kısıtlaması',
                 aciklama: 'Oyun içi (masa) ve genel sohbete mesaj gönderemez.' }],
      ozelMaxDakika: 525600
    };
    return sanctionOpts;
  }

  // "2 gün 3 saat" gibi kalan süre metni (sunucudaki sureMetni ile aynı dil).
  function kalanSure(bitis) {
    if (bitis == null) return 'süresiz';
    const ms = Number(bitis) - Date.now();
    if (ms <= 0) return 'doldu';
    const dk = Math.floor(ms / 60000);
    const gun = Math.floor(dk / 1440), saat = Math.floor((dk % 1440) / 60);
    if (gun >= 365) return Math.floor(gun / 365) + ' yıl';
    if (gun > 0) return gun + ' gün' + (saat ? ' ' + saat + ' saat' : '');
    if (saat > 0) return saat + ' saat';
    return Math.max(1, dk) + ' dakika';
  }

  function renderUsersTab(body) {
    body.innerHTML = '<div style="text-align:center;padding:26px;color:var(--text2)">⏳ Üyeler yükleniyor...</div>';
    Promise.all([fetchUsers(), fetchSanctions()]).then(([r, sm]) => {
      if (!r.ok) { body.innerHTML = `<div style="text-align:center;padding:26px;color:#ff7675">⚠️ ${esc(r.error || 'Yüklenemedi')}</div>`; return; }
      usersLoaded = true;
      sanctionMap = sm || {};
      const users = r.users || [];
      const kisitli = Object.keys(sanctionMap).length;
      body.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
          <div style="font-weight:800;font-size:.95em">TÜM KULLANICILAR (${users.length})</div>
          ${kisitli ? `<span style="background:rgba(255,118,117,.15);color:#ff7675;font-weight:800;font-size:.75em;padding:4px 9px;border-radius:8px">🔇 ${kisitli} kısıtlı üye</span>` : ''}
        </div>
        <div style="font-size:.76em;color:var(--text3);margin-bottom:10px">Yaptırım uygulanan üyeye <b>anında bildirim</b> gider; oyun içi ve genel sohbete mesaj gönderemez.</div>
        <div style="border:1px solid var(--border);border-radius:12px;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;font-size:.88em;min-width:520px">
            <thead><tr style="background:var(--bg3);text-align:left">
              <th style="padding:10px 14px">KULLANICI</th>
              <th style="padding:10px 14px">KATILIM</th>
              <th style="padding:10px 14px">DURUM</th>
              <th style="padding:10px 14px;text-align:right">ROL / İŞLEM</th>
            </tr></thead>
            <tbody>
              ${users.map(u => userRow(u)).join('')}
            </tbody>
          </table>
        </div>`;
      /* ⚠ ÇAKIŞMA NOTU: bu düğmelerde eskiden `data-uid` vardı. js/social.js
         sayfanın TAMAMINDA `[data-uid]` taşıyan her öğeye tıklanınca profil
         penceresini açan tek bir dinleyici kuruyor — bu yüzden "Yaptırım"a
         basınca yaptırım penceresiyle BİRLİKTE üye profili de açılıyordu.
         Düğmeler artık `data-sanc-uid` kullanır; `data-uid` yalnız üye
         ADINDA durur, böylece "isme tıkla → bilgileri gör" çalışır. */
      body.querySelectorAll('[data-sanc]').forEach(b => b.addEventListener('click', e => {
        e.stopPropagation();
        const uid = Number(b.getAttribute('data-sanc-uid'));
        const user = users.find(x => Number(x.id) === uid);
        if (!user) return;
        if (b.getAttribute('data-sanc') === 'lift') liftSanction(user, body);
        else openSanctionModal(user, body);
      }));
    }).catch(e => {
      body.innerHTML = `<div style="text-align:center;padding:26px;color:#ff7675">⚠️ ${esc(e.message || 'Bağlantı hatası')}</div>`;
    });
  }

  function userRow(u) {
    const y = sanctionMap[Number(u.id)];
    const kurucu = u.role === 'kurucu';
    return `
      <tr style="border-top:1px solid var(--border)">
        <td style="padding:11px 14px">
          <div ${kurucu ? '' : `data-uid="${u.id}"`} style="font-weight:700;color:var(--accent)${kurucu ? '' : ';cursor:pointer'}"
               ${kurucu ? '' : 'title="Üye bilgilerini aç"'}>${esc(u.name)}</div>
          <div style="font-size:.82em;color:var(--text3)">${esc(u.email)}</div>
        </td>
        <td style="padding:11px 14px;color:var(--text2)">${trDate(u.createdAt)}</td>
        <td style="padding:11px 14px">
          ${y
            ? `<span title="${esc(y.sebep || 'Gerekçe belirtilmedi')}" style="background:rgba(255,118,117,.15);color:#ff7675;font-weight:800;font-size:.76em;padding:4px 9px;border-radius:8px;white-space:nowrap">🔇 Sohbet kısıtlı · ${esc(kalanSure(y.bitis))}</span>`
            : '<span style="color:#00b894;font-weight:700;font-size:.78em">✓ Kısıtlama yok</span>'}
        </td>
        <td style="padding:11px 14px;text-align:right;white-space:nowrap">
          ${kurucu
            ? '<span style="background:rgba(253,203,110,.18);color:#fdcb6e;font-weight:800;font-size:.8em;padding:4px 10px;border-radius:8px">KURUCU (SİZ)</span>'
            : `<span style="background:var(--bg3);color:var(--text2);font-weight:700;font-size:.8em;padding:4px 10px;border-radius:8px">Üye</span>
               <button type="button" data-sanc="open" data-sanc-uid="${u.id}" style="margin-left:6px;border:1px solid var(--border);background:var(--bg3);color:var(--text);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:.8em">⚖️ Yaptırım</button>
               ${y ? `<button type="button" data-sanc="lift" data-sanc-uid="${u.id}" style="margin-left:4px;border:none;background:rgba(0,184,148,.15);color:#00b894;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:.8em;font-weight:700">✓ Kaldır</button>` : ''}`}
        </td>
      </tr>`;
  }

  // ---- Yaptırım penceresi ----
  function sanctionModal() {
    let m = document.getElementById('adminSanctionModal');
    if (m) return m;
    m = document.createElement('div');
    m.className = 'modal-bg';
    m.id = 'adminSanctionModal';
    m.innerHTML = `
      <div class="modal" style="max-width:480px;width:94%;padding:0;overflow:hidden">
        <div style="background:linear-gradient(135deg,#d63031,#ff7675);padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0;font-size:1.05em;color:#fff">⚖️ Üyeye Yaptırım Uygula</h3>
          <button type="button" style="background:rgba(255,255,255,.25);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer" onclick="GV.hideModal('adminSanctionModal')">✕</button>
        </div>
        <div id="adminSanctionBody" style="padding:16px"></div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) GV.hideModal('adminSanctionModal'); });
    return m;
  }

  async function openSanctionModal(user, listBody) {
    sanctionUser = user;
    const opts = await fetchSanctionOpts();
    const m = sanctionModal();
    const b = m.querySelector('#adminSanctionBody');
    const y = sanctionMap[Number(user.id)];
    b.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--bg3);display:flex;align-items:center;justify-content:center;font-weight:800">${esc(String(user.name || '?').slice(0, 2).toUpperCase())}</div>
        <div><div style="font-weight:800">${esc(user.name)}</div><div style="font-size:.78em;color:var(--text3)">${esc(user.email)}</div></div>
      </div>
      ${y ? `<div style="background:rgba(255,118,117,.1);border:1px solid rgba(255,118,117,.3);border-radius:10px;padding:9px 12px;font-size:.8em;color:#ff7675;margin-bottom:12px">
               🔇 Bu üye hâlihazırda kısıtlı — kalan süre: <b>${esc(kalanSure(y.bitis))}</b>${y.sebep ? ' · Gerekçe: ' + esc(y.sebep) : ''}.
               <div style="color:var(--text3);margin-top:3px">Yeni yaptırım uygularsanız mevcut kısıtlamanın yerine geçer.</div>
             </div>` : ''}
      <div style="font-weight:800;font-size:.82em;margin-bottom:6px">YAPTIRIM TÜRÜ</div>
      <!-- Şu an TEK tür var (sohbet/mesaj kısıtlaması). Tek seçenekli bir
           radyo düğmesi hem seçim yapılacakmış izlenimi veriyor hem de
           kafa karıştırıyordu; bu yüzden tür SABİT bir bilgi kartı olarak
           gösterilir. İkinci tür eklendiğinde liste yeniden seçilebilir
           hale gelir (aşağıdaki turId bunun için sunucudan okunur). -->
      <div id="sancTurKart" data-tur="${esc(((opts.turler || [])[0] || {}).id || 'chat')}"
           style="display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:10px;padding:11px 13px;margin-bottom:14px;background:var(--bg2)">
        <span style="font-size:1.15em;line-height:1.2">🔇</span>
        <span style="flex:1;min-width:0">
          <b style="font-size:.9em">${esc(((opts.turler || [])[0] || {}).etiket || 'Sohbet ve mesaj kısıtlaması')}</b>
          <div style="font-size:.76em;color:var(--text3);margin-top:2px">${esc(((opts.turler || [])[0] || {}).aciklama || '')}</div>
        </span>
      </div>
      <div style="font-weight:800;font-size:.82em;margin-bottom:6px">SÜRE</div>
      <select id="sancSure" style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:.88em">
        ${(opts.sureler || []).map(o => `<option value="${esc(o.id)}">${esc(o.etiket)}</option>`).join('')}
      </select>
      <div id="sancOzelWrap" style="display:none;margin-top:8px">
        <input id="sancDakika" type="number" min="1" max="${Number(opts.ozelMaxDakika) || 525600}" placeholder="Süre (dakika)"
          style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:.88em">
        <div style="font-size:.72em;color:var(--text3);margin-top:4px">Örnek: 90 → 1 saat 30 dakika sessizlik.</div>
      </div>
      <div style="font-weight:800;font-size:.82em;margin:14px 0 6px">GEREKÇE <span style="font-weight:400;color:var(--text3)">(kullanıcıya bildirimde gösterilir)</span></div>
      <textarea id="sancSebep" rows="2" maxlength="240" placeholder="Örn: Sohbette küfür ve hakaret"
        style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:.86em;resize:vertical"></textarea>
      <div id="sancErr" style="color:#ff7675;font-size:.8em;margin-top:8px;display:none"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button type="button" class="btn btn-sm" onclick="GV.hideModal('adminSanctionModal')">Vazgeç</button>
        <button type="button" id="sancApply" style="background:linear-gradient(135deg,#d63031,#ff7675);color:#fff;border:none;padding:10px 18px;border-radius:9px;font-weight:800;cursor:pointer">⚖️ Yaptırımı Uygula</button>
      </div>`;
    const sel = b.querySelector('#sancSure');
    const ozel = b.querySelector('#sancOzelWrap');
    sel.addEventListener('change', () => { ozel.style.display = sel.value === 'ozel' ? 'block' : 'none'; });
    b.querySelector('#sancApply').addEventListener('click', () => applySanction(listBody));
    if (window.GV && GV.showModal) GV.showModal('adminSanctionModal');
    else m.classList.add('show');
  }

  async function applySanction(listBody) {
    const m = document.getElementById('adminSanctionModal');
    if (!m || !sanctionUser) return;
    const err = m.querySelector('#sancErr');
    const btn = m.querySelector('#sancApply');
    const kart = m.querySelector('#sancTurKart');
    const tur = (kart && kart.getAttribute('data-tur')) || 'chat';
    const sure = m.querySelector('#sancSure').value;
    const dakika = Number(m.querySelector('#sancDakika') ? m.querySelector('#sancDakika').value : 0);
    const sebep = String(m.querySelector('#sancSebep').value || '').trim();
    const goster = msg => { err.textContent = '⚠️ ' + msg; err.style.display = 'block'; };
    err.style.display = 'none';
    if (sure === 'ozel' && !(dakika > 0)) return goster('Süreyi dakika olarak girin.');
    btn.disabled = true; btn.textContent = '⏳ Uygulanıyor...';
    const r = await api(BACKEND + '/api/admin/sanctions',
      { userId: sanctionUser.id, tur, sure, dakika, sebep }, 'POST');
    btn.disabled = false; btn.textContent = '⚖️ Yaptırımı Uygula';
    if (!r.ok) return goster(r.error || 'Yaptırım uygulanamadı.');
    toast('🔇 ' + sanctionUser.name + ' için sohbet kısıtlaması uygulandı — kullanıcıya bildirim gönderildi.', 'success');
    if (window.GV && GV.hideModal) GV.hideModal('adminSanctionModal');
    if (listBody) renderUsersTab(listBody);
  }

  async function liftSanction(user, listBody) {
    if (!window.confirm(user.name + ' üyesinin sohbet kısıtlaması kaldırılsın mı?')) return;
    const r = await api(BACKEND + '/api/admin/sanctions/lift', { userId: user.id, tur: 'chat' }, 'POST');
    if (!r.ok) { toast('⚠️ ' + (r.error || 'Kaldırılamadı.'), 'error'); return; }
    toast('✅ ' + user.name + ' üyesinin sohbet kısıtlaması kaldırıldı.', 'success');
    if (listBody) renderUsersTab(listBody);
  }

  // ---------- SEKME 2: Oyunlar ----------
  function renderGamesTab(body) {
    if (!settingsCache) {
      body.innerHTML = '<div style="text-align:center;padding:26px;color:var(--text2)">⏳ Oyun ayarları yükleniyor...</div>';
      fetchSettings().then(s => {
        settingsCache = mergeIntoDefault(s);
        renderGamesTab(body);
      }).catch(() => {
        settingsCache = defaultSettings();
        renderGamesTab(body);
      });
      return;
    }
    const games = (window.GAMES && Object.keys(window.GAMES)) || STANDARD;
    body.innerHTML = `
      <div style="font-weight:800;font-size:.95em;margin-bottom:4px">OYUNLAR (${games.length})</div>
      <div style="font-size:.78em;color:var(--text3);margin-bottom:12px">Görünürlük, masa sayısı ve masa adları/tipleri buradan yönetilir. Değişiklikler <b>Kaydet ve Uygula</b> ile kalıcı olur ve siteye anında yansır.</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        ${games.map(gid => gameRow(gid)).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button type="button" id="adminSaveBtn" style="background:linear-gradient(135deg,#6c5ce7,#8f7bff);color:#fff;border:none;padding:11px 22px;border-radius:10px;font-weight:800;cursor:pointer">💾 Kaydet ve Uygula</button>
      </div>`;
    body.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', () => onGameAction(btn.getAttribute('data-act'), btn.getAttribute('data-gid'), btn.getAttribute('data-i'), btn)));
    const saveBtn = document.getElementById('adminSaveBtn');
    if (saveBtn) saveBtn.addEventListener('click', onSave);
  }

  function gameRow(gid) {
    const g = (window.GAMES && window.GAMES[gid]) || { name: gid, icon: '🎮' };
    const cfg = settingsCache[gid] || { visible: true };
    const isStd = STANDARD.includes(gid);
    const isFixed = FIXED.includes(gid);
    const vis = cfg.visible !== false;
    const rows = isStd ? (cfg.tables || []) : [];
    return `
      <div style="border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--bg2)">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:1.4em">${g.icon}</span>
          <b style="font-size:1em;flex:1;min-width:120px">${esc(g.name)}${isFixed ? ' <span style="font-size:.7em;color:var(--text3)">(18 hazır masa — yapı sabit)</span>' : (isStd ? '' : ' <span style="font-size:.7em;color:var(--text3)">(hazır masa yok)</span>')}</b>
          <span style="font-size:.78em;color:var(--text3)">${isStd ? rows.length + ' masa' : ''}</span>
          ${isStd ? `
          <button type="button" data-act="addTable" data-gid="${gid}" style="border:1px solid var(--border);background:var(--bg3);color:var(--text);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:.8em" title="Masa ekle">➕ Masa</button>
          <button type="button" data-act="delTable" data-gid="${gid}" style="border:1px solid var(--border);background:var(--bg3);color:var(--text2);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:.8em" title="Son masayı kaldır">➖ Masa</button>` : ''}
          <button type="button" data-act="toggleVis" data-gid="${gid}"
            style="border:none;border-radius:8px;padding:6px 12px;cursor:pointer;font-weight:800;font-size:.8em;${vis ? 'background:rgba(0,184,148,.15);color:#00b894' : 'background:rgba(255,118,117,.15);color:#ff7675'}">
            ${vis ? '👁 Görünür' : '🚫 Gizli'}
          </button>
          ${isStd ? `<button type="button" data-act="editTables" data-gid="${gid}" style="border:1px solid var(--border);background:var(--bg3);color:var(--text);border-radius:8px;padding:5px 10px;cursor:pointer;font-size:.8em">✏️ Düzenle</button>` : ''}
        </div>
        ${isStd ? `<div data-tbl="${gid}" style="display:none;margin-top:10px;flex-direction:column;gap:6px"></div>` : ''}
      </div>`;
  }

  function paintTableRows(gid) {
    const wrap = document.querySelector(`[data-tbl="${gid}"]`);
    if (!wrap) return;
    const cfg = settingsCache[gid] || { tables: [] };
    wrap.innerHTML = (cfg.tables || []).map((t, i) => `
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
        <input data-edit="name" data-gid="${gid}" data-i="${i}" value="${esc(t.name)}" style="flex:2;min-width:150px;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:.85em">
        <select data-edit="type" data-gid="${gid}" data-i="${i}" style="padding:7px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:.82em">
          ${TYPE_DEFS.map(td => `<option value="${td.type}" ${t.type === td.type ? 'selected' : ''}>${td.label}</option>`).join('')}
        </select>
        <input data-edit="dur" data-gid="${gid}" data-i="${i}" type="number" min="1" max="240" value="${Number(t.durationMinutes) || 15}" style="width:64px;padding:7px 8px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:.82em" title="Süre (dk)">
        <button type="button" data-act="delRow" data-gid="${gid}" data-i="${i}" style="border:none;background:rgba(255,118,117,.12);color:#ff7675;border-radius:8px;padding:7px 10px;cursor:pointer" title="Bu masayı sil">🗑</button>
      </div>`).join('');
    wrap.querySelectorAll('[data-edit]').forEach(inp => {
      inp.addEventListener('change', () => {
        const g = inp.getAttribute('data-gid');
        const i = Number(inp.getAttribute('data-i'));
        const t = (settingsCache[g] || {}).tables && (settingsCache[g].tables[i]);
        if (!t) return;
        if (inp.getAttribute('data-edit') === 'name') t.name = inp.value.slice(0, 60);
        if (inp.getAttribute('data-edit') === 'dur') t.durationMinutes = Math.min(240, Math.max(1, Math.floor(Number(inp.value) || 15)));
        if (inp.getAttribute('data-edit') === 'type') {
          t.type = inp.value;
          const td = TYPE_DEFS.find(x => x.type === inp.value);
          if (td) t.durationMinutes = td.duration;
        }
      });
    });
  }

  function onGameAction(act, gid, iAttr, target) {
    const i = iAttr === null || iAttr === undefined ? -1 : Number(iAttr);
    const cfg = settingsCache[gid];
    if (!cfg) return;
    if (act === 'toggleVis') {
      cfg.visible = cfg.visible === false;
      renderPanel();
      return;
    }
    if (act === 'addTable') {
      cfg.tables = cfg.tables || [];
      const n = cfg.tables.length;
      const d = defaultTables(gid)[n] || { name: `Masa #${BASE[gid] + n}`, type: 'normal', durationMinutes: 15 };
      cfg.tables.push({ name: d.name, type: d.type, durationMinutes: d.duration });
      paintTableRows(gid);
      return;
    }
    if (act === 'online') { cfg.online = !!target?.checked; return; }
      if (act === 'delTable') {
      if (Array.isArray(cfg.tables) && cfg.tables.length) cfg.tables.pop();
      paintTableRows(gid);
      return;
    }
    if (act === 'delRow') {
      if (Array.isArray(cfg.tables)) cfg.tables.splice(i, 1);
      paintTableRows(gid);
      return;
    }
    if (act === 'editTables') {
      const wrap = document.querySelector(`[data-tbl="${gid}"]`);
      if (!wrap) return;
      const open = wrap.style.display === 'flex';
      document.querySelectorAll('[data-tbl]').forEach(w => { w.style.display = 'none'; });
      wrap.style.display = open ? 'none' : 'flex';
      if (!open) paintTableRows(gid);
      return;
    }
  }

  async function onSave() {
    if (!settingsCache) return;
    const btn = document.getElementById('adminSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Kaydediliyor...'; }
    const r = await saveSettings(settingsCache);
    if (btn) { btn.disabled = false; btn.textContent = '💾 Kaydet ve Uygula'; }
    if (r.ok) toast('✅ Değişiklikler kaydedildi ve siteye uygulandı.', 'success');
    else toast('⚠️ ' + (r.error || 'Kaydedilemedi.'), 'error');
  }

  // ---------------- Ana sayfa istatistik paneli (yalnız kurucu) ----------------
  // Welcome kutusunun hemen altına canlı istatistik kartları. Üye/maç
  // sayıları üretimde Yöncü MySQL'den (PHP), online/aktif oyun/devam eden
  // maç Render'ın canlı durumundan; ikisi istemcide birleştirilir.
  let statsSection = null;
  function statsTarget() {
    return isAdmin() && document.getElementById('pg-home');
  }
  function ensureStatsSection() {
    if (!statsTarget()) { removeStatsSection(); return null; }
    if (statsSection && statsSection.isConnected) return statsSection;
    statsSection = document.createElement('div');
    statsSection.id = 'adminStatsSection';
    const home = document.getElementById('pg-home');
    const welcome = home.querySelector('#welcomeHeading');
    const anchor = welcome ? welcome.closest('div') : home.firstChild;
    statsSection.innerHTML =
      '<div class="card mb" style="padding:14px">' +
        '<h4 style="margin-bottom:10px;font-size:.9em">📊 Yönetici İstatistikleri ' +
        '<span style="font-size:.7em;color:var(--text3);font-weight:400">(canlı, 30 sn&#39;de bir yenilenir)</span></h4>' +
        '<div class="stats" id="adminStatsGrid" style="margin-bottom:0"><div style="color:var(--text3);font-size:.85em">⏳ Yükleniyor...</div></div>' +
        // PUAN SIFIRLAMA — kullanıcının isteği: "İstatistikler başlığı
        // altında olsun." İki seçenek: (1) elle, (2) seçilen periyotta
        // otomatik. Sıfırlama veriyi SİLMEZ; yalnız yeni bir sayım
        // noktası koyar, geçmiş kayıt korunur.
        '<div id="adminScoreReset" style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">' +
          '<h4 style="margin-bottom:8px;font-size:.88em">🏆 Puan Tablosu Sıfırlama</h4>' +
          '<p style="color:var(--text3);font-size:.76em;margin-bottom:10px">' +
            'Sıfırlama kayıtları silmez: yeni bir sayım dönemi başlatır, ' +
            'eski veriler veritabanında korunur.</p>' +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">' +
            '<label style="font-size:.8em;color:var(--text2)">Otomatik dönem:</label>' +
            '<select id="adminScorePeriod" style="padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:var(--bg3);color:var(--text);font-size:.82em"></select>' +
            '<button type="button" id="adminScorePeriodSave" class="btn btn-sm">💾 Dönemi Kaydet</button>' +
            '<button type="button" id="adminScoreResetNow" class="btn btn-sm btn-d">🧹 Şimdi Sıfırla</button>' +
          '</div>' +
          '<div id="adminScoreResetInfo" style="font-size:.75em;color:var(--text3);margin-top:8px"></div>' +
        '</div>' +
      '</div>';
    if (anchor && anchor.parentNode === home) home.insertBefore(statsSection, anchor.nextSibling);
    else home.insertBefore(statsSection, home.firstChild);
    return statsSection;
  }
  function removeStatsSection() {
    if (statsSection && statsSection.isConnected) statsSection.remove();
    statsSection = null;
  }
  // ---- Puan sıfırlama denetimleri (İstatistikler başlığı altında) ----
  let scoreUISetup = false;
  async function refreshScoreReset() {
    const sel = document.getElementById('adminScorePeriod');
    const info = document.getElementById('adminScoreResetInfo');
    if (!sel) return;
    let r = null;
    try { r = await api(BACKEND + '/api/admin/scores/settings', null, 'GET'); } catch (_) {}
    if (!r || !r.ok) { if (info) info.textContent = '⚠️ Puan ayarları okunamadı.'; return; }
    const sec = r.secenekler || {};
    sel.innerHTML = Object.keys(sec).map(k =>
      '<option value="' + k + '"' + (k === r.periyot ? ' selected' : '') + '>' + sec[k] + '</option>').join('');
    if (info) {
      info.textContent = r.sonSifirlama
        ? 'Son sıfırlama: ' + new Date(Number(r.sonSifirlama)).toLocaleString('tr-TR')
        : 'Henüz hiç sıfırlanmadı — tüm puanlar ilk günden beri sayılıyor.';
    }
    if (scoreUISetup) return;
    scoreUISetup = true;
    const kaydet = document.getElementById('adminScorePeriodSave');
    const simdi = document.getElementById('adminScoreResetNow');
    if (kaydet) kaydet.addEventListener('click', async () => {
      const r2 = await api(BACKEND + '/api/admin/scores/settings', { periyot: sel.value }, 'POST');
      if (r2 && r2.ok) { toast('✅ Otomatik sıfırlama dönemi kaydedildi.', 'success'); refreshScoreReset(); }
      else toast('⚠️ ' + ((r2 && r2.error) || 'Kaydedilemedi.'), 'error');
    });
    if (simdi) simdi.addEventListener('click', async () => {
      // Geri alınamaz görünen bir işlem: tek tıkla olmasın.
      if (!window.confirm('Tüm oyuncuların puanları sıfırlanacak ve yeni bir dönem başlayacak.\n\nEski kayıtlar silinmez, yalnız sayım bu andan itibaren yapılır.\n\nOnaylıyor musunuz?')) return;
      const r2 = await api(BACKEND + '/api/admin/scores/reset', {}, 'POST');
      if (r2 && r2.ok) {
        toast('✅ Puanlar sıfırlandı; yeni dönem başladı.', 'success');
        refreshScoreReset();
        if (window.GVScores && GVScores.refresh) GVScores.refresh();
      } else toast('⚠️ ' + ((r2 && r2.error) || 'Sıfırlanamadı.'), 'error');
    });
  }

  async function refreshHeroStats() {
    if (!ensureStatsSection()) return;
    const grid = document.getElementById('adminStatsGrid');
    if (!grid) return;
    try {
      // Üye/maç: üretimde PHP'den, diğerinde Render'ın kendi DB'sinden.
      const userStatsP = isYoncuPage()
        ? api('/api/admin.php?action=stats', null, 'GET')
        : api(BACKEND + '/api/admin/stats', null, 'GET');
      // Canlı durum: her zaman Render'dan (online haritası + odalar).
      const liveP = api(BACKEND + '/api/admin/stats', null, 'GET');
      const [us, live] = await Promise.all([userStatsP, liveP]);
      const a = (us && us.ok && us.stats) ? us.stats : {};
      const b = (live && live.ok && live.stats) ? live.stats : {};
      const s = Object.assign({}, a, b); // canlı durum öncelikli (b)
      const fmt = n => (Number(n) || 0).toLocaleString('tr-TR');
      const cards = [
        ['🟢', fmt(s.onlineUsers), 'Online Kullanıcı'],
        ['👤', fmt(s.activeUsers), 'Aktif Kullanıcı (7 gün)'],
        ['🆕', fmt(s.newUsersToday), 'Bugün Yeni Üye'],
        ['📅', fmt(s.newUsersWeek), 'Haftalık Yeni Üye'],
        ['🗓️', fmt(s.newUsersMonth), 'Aylık Yeni Üye'],
        ['👥', fmt(s.totalUsers), 'Toplam Üye'],
        ['🎮', fmt(s.totalGames), 'Toplam Oyun'],
        ['⚡', fmt(s.activeGames), 'Aktif Oyun'],
        ['🕹️', fmt(s.gamesToday), 'Günlük Oyun'],
        ['🏟️', fmt(s.totalMatches), 'Toplam Maç'],
        ['🔄', fmt(s.ongoingMatches), 'Devam Eden Maç'],
        ['✅', fmt(s.completedMatches), 'Tamamlanan Maç']
      ];
      grid.innerHTML = cards.map(c =>
        '<div class="stat"><div class="stat-icon">' + c[0] + '</div>' +
        '<div class="stat-val">' + c[1] + '</div>' +
        '<div class="stat-label">' + c[2] + '</div></div>').join('');
    } catch (e) {
      grid.innerHTML = '<div style="color:#ff7675;font-size:.85em">⚠️ İstatistik alınamadı</div>';
    }
    refreshScoreReset();
  }

  // ---------------- üst bar butonu + giriş ----------------
  function ensurePanelButton() {
    if (!isAdmin()) return;
    if (document.getElementById('adminPanelBtn')) return;
    const container = document.getElementById('headerAuthContainer');
    if (!container) return;
    const b = document.createElement('button');
    b.id = 'adminPanelBtn';
    b.className = 'btn btn-sm';
    b.style.cssText = 'background:linear-gradient(135deg,#6c5ce7,#8f7bff);color:#fff;font-weight:800';
    b.textContent = '👑 Kurucu Paneli';
    b.addEventListener('click', () => {
      panelModal();
      window.GV && GV.showModal('adminPanelModal');
      renderPanel();
    });
    container.appendChild(b);
  }
  function dropPanelButton() {
    const b = document.getElementById('adminPanelBtn');
    if (b) b.remove();
  }

  // Üst bar, giriş/çıkışta yeniden yazıldığı için buton periyodik
  // kontrolle idare edilir (diğer modüllerle aynı desen): kurucu
  // oturumundayken buton var, değilse temizlenir.
  function tick() {
    if (!window.GV) return;
    if (isAdmin()) { ensurePanelButton(); ensureStatsSection(); }
    else { dropPanelButton(); removeStatsSection(); }
    if (!window.GV.openAdminPanel) {
      window.GV.openAdminPanel = function () {
        panelModal();
        window.GV.showModal('adminPanelModal');
        renderPanel();
      };
    }
  }
  setInterval(tick, 600);
  // İstatistik verisi 30 sn'de bir tazelenir (yalnız kurucu oturumunda):
  setInterval(() => { if (statsTarget()) refreshHeroStats(); }, 30000);
  function boot() { tick(); if (statsTarget()) refreshHeroStats(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();

  // Yalnız testler için: Yöncü'de kayıtlı ayar bloğunun YENİ bir oyunu
  // (örn. battleship) içermediği durumu (kurucu panelinde "0 masa" hatası)
  // gerçek bir sayfa/hostname açmadan doğrulayabilmek için (bkz.
  // test/admin-panel-games-merge.test.js). Üretimde etkisi yoktur.
  window.__adminPanelTest = { mergeIntoDefault, defaultSettings };
})();
