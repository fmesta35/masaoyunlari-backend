'use strict';

/*
 * GameVerse — Yöncü PHP API adaptörü (Render tarafı)
 *
 *  GV_AUTH_API tanımlıysa üyelik/sosyal veri Yöncü MySQL'de yaşar; Render
 *  yalnızca gerçek zamanlı katmandır (soketler) ve gerektiğinde PHP'ye sorar:
 *    - authHello token doğrulaması  → auth.php?action=me   (30 sn önbellek)
 *    - davet arkadaşlık kontrolü    → social.php?action=isFriendPair (X-GV-Key)
 *    - maç / sohbet kaydı           → social.php?action=recordMatch|chatLog (X-GV-Key)
 *    - REST yedek proxy'si          → eski istemciler Render'a sorarsa PHP'ye aktarılır
 *
 *  GV_AUTH_API YOKSA bu modül devre dışıdır — sistem eskisi gibi yerel
 *  SQLite ile çalışır (geliştirme + tüm testler bu moddadır).
 */

const REMOTE = (process.env.GV_AUTH_API || '').replace(/\/+$/, '');
const KEY = process.env.GV_SERVER_KEY || '';

function enabled() { return !!REMOTE; }

async function callJson(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 8000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (opts && opts.bearer) headers.Authorization = 'Bearer ' + opts.bearer;
    if (opts && opts.key) headers['X-GV-Key'] = opts.key;
    const r = await fetch(url, {
      method: (opts && opts.body) ? 'POST' : 'GET',
      headers,
      body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal
    });
    let data = null;
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, data: data || { ok: false, error: 'Üyelik sunucusundan boş cevap.' } };
  } catch (e) {
    return { status: 0, data: { ok: false, error: 'Üyelik sunucusuna ulaşılamadı: ' + (e.name === 'AbortError' ? 'zaman aşımı' : e.message) } };
  } finally {
    clearTimeout(t);
  }
}

// ---------------- PHP eşlemesi ----------------
const MAP = {
  'POST /api/auth/register': '/auth.php?action=register',
  'POST /api/auth/verify': '/auth.php?action=verify',
  'POST /api/auth/login': '/auth.php?action=login',
  'POST /api/auth/resend': '/auth.php?action=resend',
  'POST /api/auth/forgot': '/auth.php?action=forgot',
  'POST /api/auth/reset': '/auth.php?action=reset',
  'GET /api/auth/me': '/auth.php?action=me',
  'POST /api/auth/logout': '/auth.php?action=logout',
  'GET /api/auth/mail-status': '/auth.php?action=mail-status',
  'GET /api/users/search': '/social.php?action=search',
  'GET /api/friends': '/social.php?action=friends',
  'POST /api/friends/add': '/social.php?action=friendAdd',
  'POST /api/friends/remove': '/social.php?action=friendRemove'
};

// REST proxy'si: Node uçlarını aynen tutar, içerik Yöncü'den gelir.
function installProxy(app, helpers) {
  // statik eşleşmeler
  for (const k of Object.keys(MAP)) {
    const [method, path] = k.split(' ');
    app[method.toLowerCase()](path, async (req, res) => {
      const bearer = (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1];
      let url = REMOTE + MAP[k];
      if (k === 'GET /api/users/search' && req.query.q) url += '&q=' + encodeURIComponent(String(req.query.q));
      const r = await callJson(url, { body: method === 'POST' ? req.body : null, bearer });
      // Çevrimiçi bayraklarını yerel soket haritasından zenginleştir
      const d = r.data;
      try {
        if (d && d.ok && helpers && helpers.isOnline) {
          if (Array.isArray(d.friends)) d.friends = d.friends.map(f => ({ ...f, online: helpers.isOnline(f.id) }));
          if (Array.isArray(d.users)) d.users = d.users.map(u => ({ ...u, online: helpers.isOnline(u.id) }));
        }
      } catch (_) {}
      res.status(r.status || 502).json(d);
    });
  }
  // dinamik: profil
  app.get('/api/users/:id/profile', async (req, res) => {
    const id = Number(req.params.id);
    const r = await callJson(REMOTE + '/social.php?action=profile&id=' + encodeURIComponent(id));
    if (r.data && r.data.ok && helpers && helpers.isOnline) r.data.online = helpers.isOnline(id);
    res.status(r.status || 502).json(r.data);
  });
  console.log('🔀 Üyelik REST uçları Yöncü PHP API\'sine proxyleniyor: ' + REMOTE);
}

// ---------------- soket yardımcıları ----------------
// authHello 1.5 sn'de bir tekrarlanır → PHP'yi yormamak için kısa önbellek.
const meCache = new Map(); // token -> {u, at}
function me(token) {
  if (!token) return Promise.resolve(null);
  const c = meCache.get(token);
  if (c && Date.now() - c.at < (c.u ? 30000 : 5000)) return Promise.resolve(c.u);
  return callJson(REMOTE + '/auth.php?action=me', { bearer: token }).then(r => {
    const u = r.data && r.data.ok && r.data.user ? r.data.user : null;
    meCache.set(token, { u, at: Date.now() });
    if (meCache.size > 2000) meCache.delete(meCache.keys().next().value);
    return u;
  });
}
function userPublic(id) {
  return callJson(REMOTE + '/social.php?action=userPublic&id=' + encodeURIComponent(id))
    .then(r => (r.data && r.data.ok ? r.data.user : null));
}
function isFriendPair(a, b) {
  return callJson(REMOTE + `/social.php?action=isFriendPair&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, { key: KEY })
    .then(r => !!(r.data && r.data.ok && r.data.friend))
    .catch(() => false);
}
// yazma işlemleri ateş-unut (Render'ı bekletme)
function recordMatch(p) {
  callJson(REMOTE + '/social.php?action=recordMatch', { key: KEY, body: p }).then(r => {
    if (!r.data || !r.data.ok) console.warn('maç kaydı Yöncü\'ye yazılamadı:', (r.data && r.data.error) || r.status);
  }).catch(() => {});
}
function logChat(m) {
  callJson(REMOTE + '/social.php?action=chatLog', { key: KEY, body: m }).catch(() => {});
}

module.exports = { enabled, installProxy, me, userPublic, isFriendPair, recordMatch, logChat };
