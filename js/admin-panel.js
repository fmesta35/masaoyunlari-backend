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
  const STANDARD = ['chess', 'tavla', 'okey', 'okey101', 'pisti', 'batak', 'dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo'];
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
  const BASE = { chess: 101, tavla: 201, dama: 401, turkdamasi: 501, reversi: 601, gomoku: 701, connect4: 801, bilardo: 921, okey: 301, okey101: 331, pisti: 341, batak: 361 };
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
  function renderUsersTab(body) {
    body.innerHTML = '<div style="text-align:center;padding:26px;color:var(--text2)">⏳ Üyeler yükleniyor...</div>';
    fetchUsers().then(r => {
      if (!r.ok) { body.innerHTML = `<div style="text-align:center;padding:26px;color:#ff7675">⚠️ ${esc(r.error || 'Yüklenemedi')}</div>`; return; }
      usersLoaded = true;
      const users = r.users || [];
      body.innerHTML = `
        <div style="font-weight:800;font-size:.95em;margin-bottom:10px">TÜM KULLANICILAR (${users.length})</div>
        <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse;font-size:.88em">
            <thead><tr style="background:var(--bg3);text-align:left">
              <th style="padding:10px 14px">KULLANICI</th>
              <th style="padding:10px 14px">KATILIM</th>
              <th style="padding:10px 14px;text-align:right">ROL</th>
            </tr></thead>
            <tbody>
              ${users.map(u => `
              <tr style="border-top:1px solid var(--border)">
                <td style="padding:11px 14px">
                  <div style="font-weight:700;color:var(--accent)">${esc(u.name)}</div>
                  <div style="font-size:.82em;color:var(--text3)">${esc(u.email)}</div>
                </td>
                <td style="padding:11px 14px;color:var(--text2)">${trDate(u.createdAt)}</td>
                <td style="padding:11px 14px;text-align:right">
                  ${u.role === 'kurucu'
                    ? '<span style="background:rgba(253,203,110,.18);color:#fdcb6e;font-weight:800;font-size:.8em;padding:4px 10px;border-radius:8px">KURUCU (SİZ)</span>'
                    : '<span style="background:var(--bg3);color:var(--text2);font-weight:700;font-size:.8em;padding:4px 10px;border-radius:8px">Üye</span>'}
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`;
    }).catch(e => {
      body.innerHTML = `<div style="text-align:center;padding:26px;color:#ff7675">⚠️ ${esc(e.message || 'Bağlantı hatası')}</div>`;
    });
  }

  // ---------- SEKME 2: Oyunlar ----------
  function renderGamesTab(body) {
    if (!settingsCache) {
      body.innerHTML = '<div style="text-align:center;padding:26px;color:var(--text2)">⏳ Oyun ayarları yükleniyor...</div>';
      fetchSettings().then(s => {
        settingsCache = s || defaultSettings();
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
      '</div>';
    if (anchor && anchor.parentNode === home) home.insertBefore(statsSection, anchor.nextSibling);
    else home.insertBefore(statsSection, home.firstChild);
    return statsSection;
  }
  function removeStatsSection() {
    if (statsSection && statsSection.isConnected) statsSection.remove();
    statsSection = null;
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
})();
