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
  // PHP çağrıları 3 sn'de timeout olmalı. Hata durumunda meCache sadece
  // başarılı sonuçları 5 sn tutacak; timeout / hata durumunda hemen
  // tekrar denenir. Soğuk başlangıç senaryoları için auth.js zaten 1.5
  // sn'de authHello gönderiyor, böylece PHP cevap verir vermez cache
  // dolar.
  const t = setTimeout(() => ctrl.abort(), timeoutMs || 3000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    // FastCGI (Yöncü) Authorization'ı kırpabilir → jeton ÜÇ kanaldan gider:
    // Authorization + X-GV-Token başlıkları, ayrıca POST'ta gövde {token}
    // alanı / GET'te ?token= parametresi (PHP tarafı gv_bearer zincirinde
    // hepsini dener). Böylece üyelik doğrulaması sunucu başlık ayarlarına
    // hiç bağımlı kalmaz.
    let body = opts && opts.body ? opts.body : null;
    if (opts && opts.bearer) {
      headers.Authorization = 'Bearer ' + opts.bearer;
      headers['X-GV-Token'] = opts.bearer;
      if (body) body = { ...body, token: opts.bearer };
      else url += (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(opts.bearer);
    }
    if (opts && opts.key) headers['X-GV-Key'] = opts.key;
    const r = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
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
  'GET /api/friends/requests': '/social.php?action=friendRequests',
  'POST /api/friends/request': '/social.php?action=friendRequest',
  'POST /api/friends/add': '/social.php?action=friendRequest', // eski istemciler: istek anlamında
  'POST /api/friends/accept': '/social.php?action=friendAccept',
  'POST /api/friends/decline': '/social.php?action=friendDecline',
  'POST /api/friends/remove': '/social.php?action=friendRemove'
};

// REST proxy'si: Node uçlarını aynen tutar, içerik Yöncü'den gelir.
function installProxy(app, helpers) {
  // statik eşleşmeler
  for (const k of Object.keys(MAP)) {
    const [method, path] = k.split(' ');
    app[method.toLowerCase()](path, async (req, res) => {
      // İstemci jetonu Authorization veya (FastCGI yedeği) X-GV-Token ile gelebilir.
      const bearer = (String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i) || [])[1]
        || (req.headers['x-gv-token'] ? String(req.headers['x-gv-token']) : undefined);
      let url = REMOTE + MAP[k];
      if (k === 'GET /api/users/search' && req.query.q) url += '&q=' + encodeURIComponent(String(req.query.q));
      const r = await callJson(url, { body: method === 'POST' ? req.body : null, bearer });
      // Çevrimiçi bayraklarını zenginleştir.
      // ÖNEMLİ: PHP'nin döndürdüğü `online` alanını da koru, sadece Render
      // socket haritasıyla override ETME. Arkadaş başka bir cihazda/sunucuda
      // online ise PHP onu online işaretlemiş olabilir, ama Render soket
      // haritasında kayıtlı olmayabilir — yine de online göstermemiz
      // gerekir. Her iki kaynağı VEYA'la: phpOnline || renderOnline.
      const d = r.data;
      try {
        if (d && d.ok && helpers && helpers.isOnline) {
          const merge = (arr) => Array.isArray(arr) ? arr.map(item => {
            const phpOnline = !!item.online;
            const renderOnline = !!helpers.isOnline(item.id);
            return { ...item, online: phpOnline || renderOnline };
          }) : arr;
          if (Array.isArray(d.friends)) d.friends = merge(d.friends);
          if (Array.isArray(d.users)) d.users = merge(d.users);
          if (Array.isArray(d.incoming)) d.incoming = merge(d.incoming);
          if (Array.isArray(d.outgoing)) d.outgoing = merge(d.outgoing);
        }
      } catch (_) {}
      res.status(r.status || 502).json(d);
    });
  }
  // dinamik: profil
  app.get('/api/users/:id/profile', async (req, res) => {
    const id = Number(req.params.id);
    const r = await callJson(REMOTE + '/social.php?action=profile&id=' + encodeURIComponent(id));
    if (r.data && r.data.ok && helpers && helpers.isOnline) {
      // Profil: PHP'nin online alanı varsa onu da koru (VEYA)
      const phpOnline = !!r.data.online;
      const renderOnline = !!helpers.isOnline(id);
      r.data.online = phpOnline || renderOnline;
    }
    res.status(r.status || 502).json(r.data);
  });
  console.log('🔀 Üyelik REST uçları Yöncü PHP API\'sine proxyleniyor: ' + REMOTE);
}

// ---------------- soket yardımcıları ----------------
// authHello periyodunda her 1.5 sn'de gelen isteklerde PHP'ye tekrar
// gidilmesin diye başarılı sonuçları 60 sn cache'leriz. auth.js 1.5 sn'de
// authHello gönderiyor ama verifyToken (me) sadece cache MISS olunca PHP'ye
// gider. PHP timeout/başarısız durumda null dönerse 5 sn cooldown
// (meFailCooldown) uygularız: aynı token için 5 sn boyunca PHP'ye
// tekrar sorulmaz. Bu, PHP yavaşsa Render'ı boğmadan soğumayı bekler.
const meCache = new Map();         // token -> {u, at}
const meFailCooldown = new Map();  // token -> at (son başarısız deneme)
const ME_CACHE_TTL_MS = 60000;     // başarılı: 60 sn cache
const ME_FAIL_TTL_MS = 5000;       // başarısız: 5 sn cooldown
function me(token) {
  if (!token) return Promise.resolve(null);
  const now = Date.now();
  // Önce "fail cooldown" kontrolü: token son 5 sn'de başarısız olduysa null
  // dön ve PHP'ye gitme. Bu hem PHP'yi korur hem de gereksiz timeout'ları
  // önler (5 sn'de 20 yerine 1 istek = %95 tasarruf).
  const failAt = meFailCooldown.get(token);
  if (failAt && now - failAt < ME_FAIL_TTL_MS) return Promise.resolve(null);
  // Sonra başarılı cache.
  const c = meCache.get(token);
  if (c && c.u && now - c.at < ME_CACHE_TTL_MS) return Promise.resolve(c.u);
  // Jeton ÜÇ kanaldan gider: Authorization + X-GV-Token başlıkları (callJson
  // içinde) VE POST gövdesi. FastCGI/Yöncü başlıkları kırpsa bile gövde PHP'ye
  // her zaman ulaşır (gv_bearer'ın gövde yedeği) — üyelik doğrulaması artık
  // sunucu başlık ayarlarına bağımlı değil.
  return callJson(REMOTE + '/auth.php?action=me', { bearer: token, body: { token } }, 5000).then(r => {
    const u = r.data && r.data.ok && r.data.user ? r.data.user : null;
    if (u) {
      meCache.set(token, { u, at: Date.now() });
      meFailCooldown.delete(token); // başarılı: cooldown kaldır
    } else {
      meFailCooldown.set(token, Date.now());
    }
    if (meCache.size > 2000) meCache.delete(meCache.keys().next().value);
    if (meFailCooldown.size > 2000) meFailCooldown.delete(meFailCooldown.keys().next().value);
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
// a -> b bekleyen arkadaşlık isteği var mı? (anlık bildirim doğrulaması)
function hasRequest(a, b) {
  return callJson(REMOTE + `/social.php?action=hasRequest&a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`, { key: KEY })
    .then(r => !!(r.data && r.data.ok && r.data.has))
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

module.exports = { enabled, installProxy, me, userPublic, isFriendPair, hasRequest, recordMatch, logChat };
