'use strict';

/*
 * GameVerse — Üyelik & Sosyal katmanı (REST + soket)
 *
 *  Akışlar:
 *   - Kayıt: e-posta + şifre → onay linki (info@masaoyunlari.com.tr).
 *     Onaysız üye GİRİŞ YAPAMAZ. Link gelmezse "tekrar gönder".
 *   - Şifremi unuttum: e-postaya 30 dk'lık sıfırlama linki → yeni şifre DB'ye
 *     yazılır; eski oturumlar silinir, yeni şifreyle giriş açılır.
 *   - Profil: üye kartı + oyun geçmişi (matches tablosu), arkadaş ekle/çıkar.
 *   - Davet: yalnız ÖZEL MASAYI KURAN üye, arkadaşını masaya davet edebilir;
 *     alıcının bildirimi yanar (gameInvite), kabulde odaya bağlanır.
 *
 *  Güvenlik düzeyi prototip ölçeğindedir: şifreler bcrypt ile saklanır,
 *  oturumlar opaque token'dır, e-posta numaralandırması (enumeration)
 *  önlenir, istek hız sınırları uygulanır.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const mailer = require('./mailer');
const remote = require('./auth-remote');

const now = () => Date.now();
const online = new Map(); // userId -> Set<socket>

// ---------------- İmzalı belgeler (Yöncü DDoS korumasına karşı) ----------------
// Yöncü'nün DDoS/anti-bot koruması Render'ın SUNUCU-SUNUCU PHP isteklerini
// 303 + HTML ile engelliyor; tarayıcı istekleri ise sorunsuz geçiyor.
// Bu yüzden: üyelik REST'i tarayıcıdan doğrudan Yöncü PHP'sine gider, Render
// soket katmanı ise PHP'nin GV_SERVER_KEY ile İMZA'ladığı kısa ömürlü
// belgeleri (attest = kimlik, friendProof = arkadaşlık) YERİNDE doğrular.
// Render → PHP çağrısı sıcak yolda KALMAMALI (yalnızca yedek olarak).
const ATTEST_TTL_MS = 10 * 60 * 1000; // PHP ile aynı: 10 dk
const CLOCK_SKEW_MS = 30 * 1000;      // saat farkı toleransı

function hmacSha256Hex(msg, key) {
  return crypto.createHmac('sha256', String(key || '')).update(String(msg)).digest('hex');
}
function sigMatches(msg, sig) {
  const key = process.env.GV_SERVER_KEY || '';
  if (!key || !sig) return false;
  const expect = hmacSha256Hex(msg, key);
  const a = Buffer.from(expect);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function windowOk(ts, exp) {
  const t = Date.now();
  const n = Number(ts), x = Number(exp);
  if (!Number.isFinite(n) || !Number.isFinite(x)) return false;
  if (x <= t) return false;              // süresi dolmuş
  if (n > t + CLOCK_SKEW_MS) return false; // gelecekte (saat salınımı)
  if (x - n > ATTEST_TTL_MS + 60 * 1000) return false; // anormal uzun
  return true;
}
// auth.php?action=attest çıktısı: { id, name, ts, exp, sig }
// Geçerliyse uid'yi, değilse null döner.
function verifyAttestation(att) {
  if (!att || typeof att !== 'object') return null;
  const id = Number(att.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!windowOk(att.ts, att.exp)) return null;
  const msg = id + '|' + String(att.name == null ? '' : att.name) + '|' + Number(att.ts) + '|' + Number(att.exp);
  if (!sigMatches(msg, att.sig)) return null;
  return { uid: id, name: String(att.name == null ? '' : att.name) };
}
// social.php?action=friendProof çıktısı: { a, b, ts, exp, sig }
// (a,b) çifti için imza geçerliyse true.
function verifyFriendProof(proof, expectA, expectB) {
  if (!proof || typeof proof !== 'object') return false;
  const a = Number(proof.a), b = Number(proof.b);
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false;
  if (Number.isInteger(expectA) && a !== Number(expectA)) return false;
  if (Number.isInteger(expectB) && b !== Number(expectB)) return false;
  if (!windowOk(proof.ts, proof.exp)) return false;
  const msg = 'friend|' + a + '|' + b + '|' + Number(proof.ts) + '|' + Number(proof.exp);
  return sigMatches(msg, proof.sig);
}

// ---------------- yardımcılar ----------------
function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim()); }
function cleanName(v) { return String(v == null ? '' : v).replace(/[<>"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24); }

function userById(id) {
  if (!db) return null;
  return db.prepare('SELECT id,name,email,verified,created_at FROM users WHERE id = ?').get(Number(id)) || null;
}
function userByEmail(email) {
  if (!db) return null;
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase()) || null;
}
function userByToken(token) {
  if (!db || !token) return null;
  const s = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(String(token));
  return s ? userById(s.user_id) : null;
}
function authFromReq(req) {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? userByToken(m[1]) : null;
}
function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)').run(token, userId, now());
  return token;
}
function publicUser(u) { return { id: u.id, name: u.name, email: u.email }; }

// userKey ('user:7') → db id (oda kayıtlarında üye eşlemesi için)
function uidFromUserKey(userKey) {
  const m = String(userKey || '').match(/^user:(\d+)$/);
  return m ? Number(m[1]) : null;
}
function isOnline(userId) { const s = online.get(Number(userId)); return !!(s && s.size); }
// Çevrimiçi AYRIK üye sayısı (istatistik paneli için): en az bir soketi
// bağlı olan üye adedi.
function onlineCount() { let n = 0; for (const s of online.values()) if (s && s.size) n++; return n; }

// Kimlik authHello ile SONRADAN çözüldüyse (join anında üyelik backend'i
// yavaştı), soket bir odaysa oda kaydındaki üye alanlarını güncelle:
// userId'siz oturan üyenin üye yetkileri (özel masada kurucu kaydı dahil)
// sayfa yenilenmeden de aktifleşir. Yalnızca DEĞİŞEN alanda yayın yapılır.
// (Yerel + uzak modun ikisinde de çağrılır — modül seviyesinde tanımlı.)
function syncRoomIdentity(sock, rooms, emitRoom) {
  const rid = sock && sock.roomId;
  if (!rid || !sock || !sock.userId) return;
  const r = rooms.get(String(rid));
  if (!r || !Array.isArray(r.players)) return;
  const me = r.players.find(p => p.id === sock.id);
  if (!me) return;
  let changed = false;
  if (!me.userId) { me.userId = sock.userId; changed = true; }
  if (r.isPrivate && !r.creatorId) { r.creatorId = sock.userId; changed = true; }
  if (changed && emitRoom) { try { emitRoom(r); } catch (_) {} }
}

// ---------------- REST kurulumu ----------------
function installAuth(app, deps) {
  const io = deps.io;
  const rooms = deps.rooms;

  // ==== UZAK MOD: kalıcı veri Yöncü MySQL/PHP'de — Render sadece soket ====
  if (remote.enabled()) {
    // Tüm deps (emitRoom, removePlayerFromRoom dahil) uzak moda da aktarılır:
    // şartlı kabul/sonradan kimlik akışları uzak modda da yayın + masadan
    // alma yapabilmeli.
    return installRemoteMode(app, { io, rooms, emitRoom: deps.emitRoom, removePlayerFromRoom: deps.removePlayerFromRoom });
  }

  if (!db) {
    app.all('/api/auth/*', (_req, res) => res.status(503).json({ ok: false, error: 'Üyelik katmanı (veritabanı) bu sunucuda devre dışı.' }));
    console.warn('⚠️  Auth endpoints 503 (db yok).');
    // DB yoksa hiçbir üye mevcut değil → jetonlar kesin geçersizdir.
    return { isOnline: () => false, uidFromUserKey, recordMatch: () => {}, attachSocket: () => {},
      userFromReq: () => null,
      verifyToken: async () => null, verifyTokenFull: async () => ({ uid: null, status: 'invalid' }),
      verifyIdentityFull: async () => ({ uid: null, status: 'invalid' }) };
  }

  // ---- Yönetici (kurucu) hesabı: yoksa açılışta oluşturulur ----
  // Kurucu Paneli yalnız bu hesabın oturumunda açılır (e-posta eşleşmesi).
  // Varsayılan: kurucu@kurucu.com / kurucu123 — GV_ADMIN_EMAIL ile
  // değiştirilebilir. (Uzak modda aynı kurulumu PHP admin.php yapar.)
  try {
    const ADMIN_MAIL = (process.env.GV_ADMIN_EMAIL || 'kurucu@kurucu.com').toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(ADMIN_MAIL);
    if (!exists) {
      // İsim çakışma riskine karşı belirgin: üyeler "Kurucu" adıyla
      // kayıt olabilsin (bu hesap otomatik, e-posta benzersizdir).
      db.prepare('INSERT INTO users(name, email, pass_hash, verified, created_at) VALUES(?, ?, ?, 1, ?)')
        .run('\u{1F451} Kurucu', ADMIN_MAIL, bcrypt.hashSync('kurucu123', 10), now());
      console.log('👑 Yönetici hesabı oluşturuldu: ' + ADMIN_MAIL);
    }
  } catch (e) { console.warn('⚠️  Yönetici hesabı oluşturulamadı:', e.message); }

  // ---- SMTP tanı (girişsiz; şifre asla dönmez) ----
  // Mail gelmiyorsa ilk bakılacak yer: configured=false ise GV_SMTP_PASS eksik,
  // configured=true ama lastError doluysa güvenlik duvarı/yanlış porttur.
  app.get('/api/auth/mail-status', (_req, res) => {
    res.json({
      ok: true,
      configured: mailer.mailEnabled(),
      host: process.env.GV_SMTP_HOST || 'mail.masaoyunlari.com.tr',
      user: process.env.GV_SMTP_USER || 'info@masaoyunlari.com.tr',
      lastError: mailer.lastError ? mailer.lastError() : null
    });
  });

  // ---- Kayıt ----
  app.post('/api/auth/register', async (req, res) => {
    try {
      const name = cleanName(req.body && req.body.name);
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      const password = String((req.body && req.body.password) || '');
      if (name.length < 2) return res.status(400).json({ ok: false, error: 'Kullanıcı adı en az 2 karakter olmalı.' });
      if (!emailOk(email)) return res.status(400).json({ ok: false, error: 'Geçerli bir e-posta adresi girin.' });
      if (password.length < 6) return res.status(400).json({ ok: false, error: 'Şifre en az 6 karakter olmalı.' });
      const nameTaken = db.prepare('SELECT id FROM users WHERE lower(name) = lower(?)').get(name);
      if (nameTaken) return res.status(409).json({ ok: false, error: 'Bu kullanıcı adı alınmış.' });
      if (userByEmail(email)) return res.status(409).json({ ok: false, error: 'Bu e-posta ile zaten bir hesap var. Giriş yapmayı deneyin.' });
      const token = crypto.randomBytes(24).toString('hex');
      const hash = bcrypt.hashSync(password, 10);
      const info = db.prepare(
        'INSERT INTO users(name,email,pass_hash,verified,verify_token,verify_sent_at,created_at) VALUES(?,?,?,0,?,?,?)'
      ).run(name, email, hash, token, now(), now());
      const sent = await mailer.sendVerifyMail(email, name, token);
      res.json({
        ok: true,
        userId: info.lastInsertRowid,
        mailSent: !!sent,
        message: sent
          ? 'Onay bağlantısı e-postanıza gönderildi. Onaylamadan giriş yapamazsınız.'
          : 'Onay e-postası GÖNDERİLEMEDİ — "Tekrar Gönder" ile yeniden deneyin.'
      });
    } catch (e) {
      console.error('register hatası:', e);
      res.status(500).json({ ok: false, error: 'Kayıt sırasında sunucu hatası.' });
    }
  });

  // ---- Onay (POST json ve mail-dostu GET) ----
  function doVerify(token) {
    if (!token) return { ok: false, error: 'Geçersiz onay bağlantısı.' };
    const u = db.prepare('SELECT id,verified FROM users WHERE verify_token = ?').get(String(token));
    if (!u) return { ok: false, error: 'Bağlantı geçersiz veya zaten kullanılmış.' };
    db.prepare('UPDATE users SET verified = 1, verify_token = NULL WHERE id = ?').run(u.id);
    return { ok: true };
  }
  app.post('/api/auth/verify', (req, res) => res.json(doVerify(req.body && req.body.token)));
  app.get('/api/auth/verify', (req, res) => {
    const r = doVerify(req.query.token);
    const site = (process.env.GV_SITE_URL || 'https://www.masaoyunlari.com.tr').replace(/\/+$/, '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8"><title>GameVerse Üyelik Onayı</title>
      <meta http-equiv="refresh" content="5;url=${site}"></head>
      <body style="font-family:Arial;background:#0d0d22;color:#fff;display:flex;min-height:100vh;align-items:center;justify-content:center">
      <div style="background:#12122b;padding:34px;border-radius:16px;text-align:center;max-width:420px">
      <div style="font-size:2.4em">${r.ok ? '✅' : '⚠️'}</div>
      <h2>${r.ok ? 'Üyeliğiniz onaylandı!' : 'Onay yapılamadı'}</h2>
      <p style="color:#c6c9db">${r.ok ? 'Artık giriş yapabilirsiniz. 5 sn içinde siteye yönlendiriliyorsunuz...' : (r.error || '')}</p>
      <p><a style="color:#8f7bff" href="${site}">🎮 GameVerse'e git</a></p></div></body></html>`);
  });

  // ---- Giriş ----
  app.post('/api/auth/login', (req, res) => {
    try {
      const ident = String((req.body && (req.body.email || req.body.user)) || '').trim().toLowerCase();
      const password = String((req.body && req.body.password) || '');
      const u = userByEmail(ident) || db.prepare('SELECT * FROM users WHERE lower(name) = lower(?)').get(ident);
      if (!u || !bcrypt.compareSync(password, u.pass_hash)) {
        return res.status(401).json({ ok: false, error: 'E-posta/kullanıcı adı veya şifre hatalı.' });
      }
      if (!u.verified) {
        return res.status(403).json({ ok: false, needVerify: true, email: u.email, error: 'E-posta adresiniz henüz onaylanmadı. Gelen kutunuzu kontrol edin veya tekrar gönderin.' });
      }
      const token = createSession(u.id);
      res.json({ ok: true, token, user: publicUser(u) });
    } catch (e) {
      console.error('login hatası:', e);
      res.status(500).json({ ok: false, error: 'Giriş sırasında sunucu hatası.' });
    }
  });

  // ---- Onay linkini tekrar gönder ----
  app.post('/api/auth/resend', async (req, res) => {
    try {
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      const u = userByEmail(email);
      if (!u || u.verified) return res.json({ ok: true, message: 'Hesap için onay e-postası gerekirse gönderildi.' });
      if (u.verify_sent_at && now() - Number(u.verify_sent_at) < 60000) {
        return res.status(429).json({ ok: false, error: 'Az önce gönderildi; 1 dakika sonra tekrar deneyin.' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      db.prepare('UPDATE users SET verify_token = ?, verify_sent_at = ? WHERE id = ?').run(token, now(), u.id);
      const sent = await mailer.sendVerifyMail(email, u.name, token);
      res.json({ ok: true, mailSent: !!sent, message: 'Onay bağlantısı yeniden gönderildi.' });
    } catch (e) {
      console.error('resend hatası:', e);
      res.status(500).json({ ok: false, error: 'İşlem sırasında sunucu hatası.' });
    }
  });

  // ---- Şifremi unuttum ----
  app.post('/api/auth/forgot', async (req, res) => {
    try {
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      const u = userByEmail(email);
      // Hesap var mı yok mu belli etme (enumeration önlemi).
      if (u) {
        const token = crypto.randomBytes(24).toString('hex');
        db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?')
          .run(token, now() + 30 * 60 * 1000, u.id);
        await mailer.sendResetMail(email, u.name, token);
      }
      res.json({ ok: true, message: 'Bu e-posta kayıtlıysa sıfırlama bağlantısı gönderildi (30 dk geçerli).' });
    } catch (e) {
      console.error('forgot hatası:', e);
      res.status(500).json({ ok: false, error: 'İşlem sırasında sunucu hatası.' });
    }
  });

  // ---- Şifre sıfırlama ----
  app.post('/api/auth/reset', (req, res) => {
    try {
      const token = String((req.body && req.body.token) || '');
      const password = String((req.body && req.body.password) || '');
      if (password.length < 6) return res.status(400).json({ ok: false, error: 'Yeni şifre en az 6 karakter olmalı.' });
      const u = db.prepare('SELECT id,reset_expires FROM users WHERE reset_token = ?').get(token);
      if (!u || !u.reset_expires || Number(u.reset_expires) < now()) {
        return res.status(400).json({ ok: false, error: 'Sıfırlama bağlantısı geçersiz veya süresi dolmuş. Yeniden isteyin.' });
      }
      db.prepare('UPDATE users SET pass_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?')
        .run(bcrypt.hashSync(password, 10), u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id); // eski oturumlar kapatılır
      res.json({ ok: true, message: 'Şifreniz güncellendi. Yeni şifrenizle giriş yapabilirsiniz.' });
    } catch (e) {
      console.error('reset hatası:', e);
      res.status(500).json({ ok: false, error: 'İşlem sırasında sunucu hatası.' });
    }
  });

  // ---- Oturum bilgisi ----
  app.get('/api/auth/me', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Oturum geçersiz.' });
    res.json({ ok: true, user: publicUser(u) });
  });

  // ---- Çıkış (oturum anahtarını geçersiz kılar) ----
  app.post('/api/auth/logout', (req, res) => {
    const h = String(req.headers.authorization || '');
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m) db.prepare('DELETE FROM sessions WHERE token = ?').run(m[1]);
    res.json({ ok: true });
  });

  // ---- Profil + oyun geçmişi ----
  app.get('/api/users/:id/profile', (req, res) => {
    try {
      const u = userById(req.params.id);
      if (!u) return res.status(404).json({ ok: false, error: 'Oyuncu bulunamadı.' });
      const rows = db.prepare(
        'SELECT game_id, room_id, players, winner, reason, ts FROM matches WHERE players LIKE ? OR players LIKE ? ORDER BY ts DESC LIMIT 20'
      ).all(`%"id":${u.id},%`, `%"id":${u.id}}%`);
      const recent = rows.map(r => ({
        gameId: r.game_id, roomId: r.room_id, winner: r.winner, reason: r.reason, ts: r.ts,
        players: JSON.parse(r.players),
        won: (JSON.parse(r.players) || []).some(p => p.id === u.id && p.won)
      }));
      const stats = {};
      rows.forEach(r => {
        const g = stats[r.game_id] || (stats[r.game_id] = { played: 0, won: 0 });
        g.played++;
        if (recent.find(x => x.ts === r.ts && x.gameId === r.game_id && x.won)) g.won++;
      });
      res.json({
        ok: true,
        user: { id: u.id, name: u.name, createdAt: u.created_at },
        online: isOnline(u.id),
        stats, recent
      });
    } catch (e) {
      console.error('profile hatası:', e);
      res.status(500).json({ ok: false, error: 'Profil yüklenemedi.' });
    }
  });

  // ---- Arkadaşlar ----
  function friendsOf(uid) {
    const rows = db.prepare(`
      SELECT u.id, u.name, f.created_at AS since FROM friends f
      JOIN users u ON u.id = f.friend_id WHERE f.user_id = ?
      UNION
      SELECT u.id, u.name, f.created_at AS since FROM friends f
      JOIN users u ON u.id = f.user_id WHERE f.friend_id = ?
      ORDER BY name COLLATE NOCASE
    `).all(uid, uid);
    return rows.map(r => ({ id: r.id, name: r.name, since: r.since, online: isOnline(r.id) }));
  }
  app.get('/api/friends', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    res.json({ ok: true, friends: friendsOf(u.id) });
  });
  // ---- Arkadaşlık istekleri (istek → kabul/red; direkt ekleme YOK) ----
  function hasPending(a, b) { // a -> b bekleyen istek var mı?
    return !!db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ? LIMIT 1').get(a, b);
  }
  function makeFriends(a, b) {
    db.prepare('INSERT OR IGNORE INTO friends(user_id,friend_id,created_at) VALUES(?,?,?)').run(a, b, now());
    db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)').run(a, b, b, a);
  }
  function requestsOf(uid) {
    const incoming = db.prepare(`
      SELECT u.id, u.name, r.created_at AS since FROM friend_requests r
      JOIN users u ON u.id = r.from_id WHERE r.to_id = ? ORDER BY r.created_at DESC
    `).all(uid).map(r => ({ id: r.id, name: r.name, since: r.since, online: isOnline(r.id) }));
    const outgoing = db.prepare(`
      SELECT u.id, u.name, r.created_at AS since FROM friend_requests r
      JOIN users u ON u.id = r.to_id WHERE r.from_id = ? ORDER BY r.created_at DESC
    `).all(uid).map(r => ({ id: r.id, name: r.name, since: r.since, online: isOnline(r.id) }));
    return { incoming, outgoing };
  }

  app.get('/api/friends/requests', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    res.json({ ok: true, ...requestsOf(u.id) });
  });

  // İstek gönder — karşı taraftan bekleyen istek varsa otomatik KABUL olur.
  // (eski /add ucu da buraya bağlı: artık doğrudan arkadaşlık KURULMAZ)
  const requestHandler = (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    const fid = Number(req.body && req.body.friendId);
    const target = userById(fid);
    if (!target) return res.status(404).json({ ok: false, error: 'Oyuncu bulunamadı.' });
    if (fid === u.id) return res.status(400).json({ ok: false, error: 'Kendinize istek gönderemezsiniz.' });
    if (isFriendPair(u.id, fid)) return res.status(409).json({ ok: false, error: 'Zaten arkadaşsınız. ️' });
    if (hasPending(fid, u.id)) {
      makeFriends(u.id, fid);
      return res.json({ ok: true, accepted: true, toName: target.name, friends: friendsOf(u.id) });
    }
    if (hasPending(u.id, fid)) return res.status(409).json({ ok: false, error: 'İstek zaten gönderildi — yanıt bekleniyor.' });
    db.prepare('INSERT OR IGNORE INTO friend_requests(from_id,to_id,created_at) VALUES(?,?,?)').run(u.id, fid, now());
    res.json({ ok: true, requested: true, toName: target.name });
  };
  app.post('/api/friends/request', requestHandler);
  app.post('/api/friends/add', requestHandler); // geriye dönük uyumluluk (istek anlamında)

  app.post('/api/friends/accept', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    const fid = Number(req.body && req.body.friendId); // isteği GÖNDEREN kişi
    const target = userById(fid);
    if (!target) return res.status(404).json({ ok: false, error: 'Oyuncu bulunamadı.' });
    if (!hasPending(fid, u.id)) return res.status(404).json({ ok: false, error: 'Bekleyen istek bulunamadı.' });
    makeFriends(u.id, fid);
    res.json({ ok: true, accepted: true, fromName: target.name, friends: friendsOf(u.id) });
  });

  // Gelen isteği reddet VEYA kendi gönderdiğin isteği iptal et
  app.post('/api/friends/decline', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    const fid = Number(req.body && req.body.friendId);
    if (!hasPending(fid, u.id) && !hasPending(u.id, fid))
      return res.status(404).json({ ok: false, error: 'Bekleyen istek bulunamadı.' });
    db.prepare('DELETE FROM friend_requests WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)')
      .run(u.id, fid, fid, u.id);
    res.json({ ok: true });
  });
  app.post('/api/friends/remove', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    const fid = Number(req.body && req.body.friendId);
    db.prepare('DELETE FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)')
      .run(u.id, fid, fid, u.id);
    res.json({ ok: true, friends: friendsOf(u.id) });
  });

  // İki üye arkadaş mı? (tek yönlü kayıt yeterli — UNION listeleme iki yönü de görür)
  function isFriendPair(a, b) {
    return !!db.prepare(
      'SELECT 1 FROM friends WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?) LIMIT 1'
    ).get(a, b, b, a);
  }

  // ---- Üye arama (isimle arkadaş ekleme kutusu için; giriş gerekir) ----
  app.get('/api/users/search', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    const q = cleanName(req.query.q || '').toLowerCase();
    if (q.length < 2) return res.json({ ok: true, users: [] });
    const rows = db.prepare(
      'SELECT id,name FROM users WHERE verified = 1 AND lower(name) LIKE ? ORDER BY name COLLATE NOCASE LIMIT 8'
    ).all('%' + q + '%');
    res.json({ ok: true, users: rows.filter(r => r.id !== u.id).map(r => ({ id: r.id, name: r.name, online: isOnline(r.id) })) });
  });

  // ---------------- maç geçmişi kaydı ----------------
  function recordMatch({ gameId, roomId, players, winnerName, reason }) {
    if (!db || !Array.isArray(players) || !players.length) return;
    if (!players.some(p => p.id != null)) return; // tamamı misafirse kaydetme
    try {
      db.prepare('INSERT INTO matches(game_id,room_id,players,winner,reason,ts) VALUES(?,?,?,?,?,?)')
        .run(String(gameId), String(roomId), JSON.stringify(players), winnerName || null, reason || null, now());
    } catch (e) { console.warn('maç kaydı yazılamadı:', e.message); }
  }

  // ---------------- soket katmanı ----------------
  function attachSocket(socket) {
    socket.on('authHello', payload => {
      const u = userByToken(payload && payload.token);
      if (!u) return socket.emit('authReady', { ok: false, error: 'Oturum geçersiz.' });
      const identityChanged = socket.userId !== u.id;
      socket.userId = u.id;
      socket.userKey = 'user:' + u.id;
      let set = online.get(u.id);
      if (!set) { set = new Set(); online.set(u.id, set); }
      set.add(socket);
      socket.emit('authReady', { ok: true, user: publicUser(u) });
      if (identityChanged) syncRoomIdentity(socket, rooms, deps.emitRoom);
    });

    socket.on('disconnect', () => {
      if (!socket.userId) return;
      const set = online.get(socket.userId);
      if (set) { set.delete(socket); if (!set.size) online.delete(socket.userId); }
    });

    // Arkadaşlık isteği anlık bildirimleri (istemci REST'e yazdıktan SONRA ping
    // atar; burada yalnızca DOĞRULANMIŞ durum karşı tarafa iletilir. Çevrimdışı
    // kullanıcıya yok — istemci tarafı periyodik taramayla yakalar.)
    socket.on('friendRequestPing', payload => {
      const me = socket.userId ? userById(socket.userId) : null;
      if (!me) return;
      const targetId = Number(payload && payload.toUserId);
      const set = online.get(targetId);
      if (!set || !set.size) return;
      if (!hasPending(me.id, targetId)) return; // gerçekten bekleyen istek olmalı
      set.forEach(s => s.emit('friendRequest', { fromId: me.id, fromName: me.name }));
    });
    socket.on('friendAcceptPing', payload => {
      const me = socket.userId ? userById(socket.userId) : null;
      if (!me) return;
      const otherId = Number(payload && payload.toUserId);
      const set = online.get(otherId);
      if (!set || !set.size) return;
      if (!isFriendPair(me.id, otherId)) return; // kabul gerçekten oluşmuş olmalı
      set.forEach(s => s.emit('friendAccepted', { byId: me.id, byName: me.name }));
    });
    socket.on('friendDeclinePing', payload => {
      const me = socket.userId ? userById(socket.userId) : null;
      if (!me) return;
      const otherId = Number(payload && payload.toUserId);
      const set = online.get(otherId);
      if (!set || !set.size) return;
      // Ne arkadaşlık ne de herhangi bir yönde bekleyen istek kalmış olmalı
      if (isFriendPair(me.id, otherId) || hasPending(me.id, otherId) || hasPending(otherId, me.id)) return;
      set.forEach(s => s.emit('friendDeclined', {
        byId: me.id, byName: me.name,
        kind: (payload && payload.kind === 'cancelled') ? 'cancelled' : 'declined'
      }));
    });

    // Oyun daveti: yalnız ÖZEL MASANIN KURUCUSU arkadaş davet edebilir.
    socket.on('gameInvite', payload => {
      const rej = reason => socket.emit('inviteRejected', { reason });
      const me = socket.userId ? userById(socket.userId) : null;
      if (!me) return rej('Davet göndermek için üye girişi gereklidir.');
      const room = rooms.get(String((payload && payload.roomId) || ''));
      if (!room) return rej('Masa bulunamadı.');
      if (!room.isPrivate) return rej('Davet yalnızca ÖZEL masalardan gönderilebilir.');
      if (room.creatorId !== me.id) return rej('Daveti yalnızca masayı kuran oyuncu gönderebilir.');
      if (room.status !== 'waiting') return rej('Oyun başladı — yeni davet gönderilemez.');
      if ((room.players || []).length >= room.maxPlayers) return rej('Masa dolu — davet gönderilemez.');
      const target = userById(Number(payload && payload.toUserId));
      if (!target) return rej('Oyuncu bulunamadı.');
      if (target.id === me.id) return rej('Kendinizi davet edemezsiniz.');
      if ((room.players || []).some(p => Number(p.userId) === Number(target.id))) return rej('Oyuncu zaten masada.');
      if (!isFriendPair(me.id, target.id)) return rej('Yalnızca arkadaş listenizdeki oyuncuları davet edebilirsiniz.');
      if (!room.invited || typeof room.invited.set !== 'function') room.invited = new Map();
      if (room.invited.size >= 15) return rej('Bekleyen davet sınırına ulaşıldı — biri katılmadan yeni davet gönderilemez.');
      const set = online.get(target.id);
      if (!set || !set.size) return rej('Arkadaşınız şu an çevrimiçi değil.');
      // Davet = giriş hakkı; atılmışsa yeni davetle hak yeniden açılır (kickBan temizlenir).
      room.invited.set(target.id, { ts: now() });
      if (room.kickBan && typeof room.kickBan.delete === 'function') room.kickBan.delete(target.id);
      const invite = {
        inviteId: 'inv-' + now() + '-' + Math.floor(Math.random() * 1e5),
        fromId: me.id, fromName: me.name,
        roomId: String(room.id), roomName: room.name, gameId: room.gameId, ts: now()
      };
      set.forEach(s => s.emit('gameInvite', invite));
      socket.emit('inviteSent', { ok: true, toName: target.name, toUserId: target.id });
    });

    // Davet kabul/ret geri bildirimi (gönderenin ekranına düşer)
    socket.on('inviteResponse', payload => {
      const from = userById(Number(payload && payload.fromId));
      const me = socket.userId ? userById(socket.userId) : null;
      if (!from || !me) return;
      const set = online.get(from.id);
      if (!set) return;
      set.forEach(s => s.emit('inviteAnswered', {
        byId: me.id, byName: me.name,
        accepted: !!(payload && payload.accepted),
        roomId: payload && payload.roomId
      }));
    });
  }

  console.log('👤 Üyelik & sosyal katman aktif (auth + profil + arkadaş + davet).');
  return { isOnline, onlineCount, uidFromUserKey, recordMatch, attachSocket, userById,
    // Kurucu Paneli yetki kontrolü (server.js requireAdmin): istemcinin
    // oturum sahibini (e-posta dahil) döndürür.
    userFromReq: (req) => authFromReq(req),
    // Soket mesajıyla gelen üyelik jetonunu doğrular (oda kapısında anında kimlik).
    verifyToken: async (t) => { const u = t ? userByToken(String(t)) : null; return u ? Number(u.id) : null; },
    // Kararlı kimlik kontrolü: yerel DB'de oturum YOKSA sonuç kesindir
    // (status:'invalid') — 'unknown' yalnızca uzak (PHP) modda mümkündür.
    // Özel oda kilidi bu ayrımı sahte jetonu kesin reddetmek için kullanır.
    verifyTokenFull: async (t) => { const u = t ? userByToken(String(t)) : null; return u ? { uid: Number(u.id), status: 'ok' } : { uid: null, status: 'invalid' }; },
    // Birleşik kimlik: önce imzalı belge (PHP gerekmez), sonra token (yerel DB).
    verifyIdentityFull: async (cred) => {
      cred = cred || {};
      const att = verifyAttestation(cred.attestation);
      if (att) return { uid: att.uid, status: 'ok' };
      const u = cred.token ? userByToken(String(cred.token)) : null;
      return u ? { uid: Number(u.id), status: 'ok' } : { uid: null, status: 'invalid' };
    } };
}

// ================== UZAK MOD (Yöncü PHP/MySQL) ==================
// Render yalnızca: online haritası + oda kuralları + davet yönlendirmesi.
// Üyelik/profil/arkadaş/maç/sohbet kaydı PHP'de; REST uçları proxy'lenir.
function installRemoteMode(app, deps) {
  const rooms = deps.rooms;
  remote.installProxy(app, { isOnline });

  // PHP soğuk başlangıcı sırasında "BİLİNMEYEN" sonucuyla ŞARTLI kabul
  // edilen ve userId'siz oturan oyuncu için: sonraki authHello'da me()
  // boş dönerse (cooldown/timeout) bu kez KESİN cevap sorulur (meFull):
  //   - 'ok'      → kimlik + kurucu yetkisi aktifleşir (self-healing)
  //   - 'invalid' → token GEÇERSİZ: oyuncu özel masadan ALINIR
  //   - 'unknown' → PHP hâlâ ayakta değil: dokunulmaz, sonraki authHello
  //                 tekrar dener. Böylece "özel oyuna sadece doğrulanmış,
  //                 davetli üye girer" kuralı soğuk başlangıçta da korunur.
  function resolvePrivatePending(sock, token) {
    const rid = sock && sock.roomId;
    if (!rid || !token) return;
    const r = rooms.get(String(rid));
    if (!r || !r.isPrivate) return;
    const me = (r.players || []).find(p => p.id === sock.id);
    if (!me || me.userId) return; // yalnızca şartlı kabuldeki oyuncu
    remote.meFull(token).then(f => {
      if (!f || sock.roomId !== rid) return;
      const rNow = rooms.get(rid);
      if (!rNow) return;
      const meNow = (rNow.players || []).find(p => p.id === sock.id);
      if (!meNow) return;
      if (f.status === 'ok' && f.user) {
        sock.userId = Number(f.user.id);
        sock.userName = f.user.name;
        sock.userEmail = f.user.email;
        sock.userKey = 'user:' + sock.userId;
        meNow.userId = sock.userId;
        if (!rNow.creatorId) rNow.creatorId = sock.userId;
        let set = online.get(sock.userId);
        if (!set) { set = new Set(); online.set(sock.userId, set); }
        set.add(sock);
        try { sock.emit('authReady', { ok: true, user: { id: sock.userId, name: f.user.name, email: f.user.email } }); } catch (_) {}
        try { deps.emitRoom(rNow); } catch (_) {}
      } else if (f.status === 'invalid') {
        console.log('[AUTH] şartlı kabuldeki oyuncunun jetonu KESİN geçersiz — özel masadan alınıyor.');
        try { sock.leave(rid); } catch (_) {}
        sock.roomId = null;
        sock.role = null;
        if (deps.removePlayerFromRoom) {
          try { deps.removePlayerFromRoom(rNow, meNow, 'Üyelik doğrulanamadı.'); } catch (_) {}
        }
        try { sock.emit('joinFailed', { roomId: rid, code: 'auth', reason: 'Üyelik doğrulanamadı — bu özel masada kalamazsınız. Lütfen yeniden giriş yapın.' }); } catch (_) {}
      }
      // 'unknown': PHP hâlâ cevap vermiyor — oyuncu odada kalır (eski davranış).
    }).catch(_ => {});
  }

  function attachSocket(socket) {
    socket.on('authHello', payload => {
      const token = payload && payload.token;
      // 1) İmzalı kimlik belgesi (auth.php?action=attest): PHP'ye ulaşmadan,
      //    Render'da yerinde doğrulanır. Yöncü DDoS koruması Render→PHP'yi
      //    kapattığında bile kimlik doğrulaması çalışır.
      const att = verifyAttestation(payload && payload.attestation);
      if (att) {
        const identityChanged = socket.userId !== att.uid;
        socket.userId = att.uid;
        socket.userName = att.name || 'Oyuncu';
        socket.userEmail = null;
        socket.userKey = 'user:' + att.uid;
        let set = online.get(att.uid);
        if (!set) { set = new Set(); online.set(att.uid, set); }
        set.add(socket);
        socket.emit('authReady', { ok: true, user: { id: att.uid, name: att.name, email: null } });
        if (identityChanged) syncRoomIdentity(socket, rooms, deps.emitRoom);
        return;
      }
      // 2) Klasik yol: PHP me (DDoS engellemedikçe / önbellek sıcakken).
      remote.me(token).then(u => {
        if (!u) {
          socket.emit('authReady', { ok: false, error: 'Oturum geçersiz.' });
          resolvePrivatePending(socket, token);
          return;
        }
        const identityChanged = socket.userId !== Number(u.id);
        socket.userId = Number(u.id);
        socket.userName = u.name;
        socket.userEmail = u.email;
        socket.userKey = 'user:' + u.id;
        let set = online.get(socket.userId);
        if (!set) { set = new Set(); online.set(socket.userId, set); }
        set.add(socket);
        socket.emit('authReady', { ok: true, user: { id: socket.userId, name: u.name, email: u.email } });
        // PHP soğuk başlangıcı sırasında userId'siz oturan üye: kimlik
        // çözüldüğü anda oda kaydı (kurucu dahil) güncellenir.
        if (identityChanged) syncRoomIdentity(socket, rooms, deps.emitRoom);
      }).catch(() => {
        socket.emit('authReady', { ok: false, error: 'Üyelik sunucusuna ulaşılamadı.' });
        resolvePrivatePending(socket, token);
      });
    });

    socket.on('disconnect', () => {
      if (!socket.userId) return;
      const set = online.get(socket.userId);
      if (set) { set.delete(socket); if (!set.size) online.delete(socket.userId); }
    });

    // Oyun daveti: kurallar (kendi özel masası + arkadaş + çevrimiçi) burada.
    // ARKADAŞLIK KONTROLÜ: öncelik PHP'nin imzaladığı friendProof belgesine
    // (Render'da yerinde doğrulanır — DDoS Render→PHP'yi kapatsa bile çalışır).
    // Belge yoksa PHP'ye düşülür (DDoS izin veriyorsa); o da erişilemezse red.
    socket.on('gameInvite', async payload => {
      const rej = reason => socket.emit('inviteRejected', { reason });
      try {
        if (!socket.userId) return rej('Davet göndermek için üye girişi gereklidir.');
        const me = { id: socket.userId, name: socket.userName || 'Oyuncu' };
        const room = rooms.get(String((payload && payload.roomId) || ''));
        if (!room) return rej('Masa bulunamadı.');
        if (!room.isPrivate) return rej('Davet yalnızca ÖZEL masalardan gönderilebilir.');
        if (room.creatorId !== me.id) return rej('Daveti yalnızca masayı kuran oyuncu gönderebilir.');
        if (room.status !== 'waiting') return rej('Oyun başladı — yeni davet gönderilemez.');
        if ((room.players || []).length >= room.maxPlayers) return rej('Masa dolu — davet gönderilemez.');
        const targetId = Number(payload && payload.toUserId);
        if (!Number.isInteger(targetId) || targetId <= 0) return rej('Oyuncu bulunamadı.');
        if (targetId === me.id) return rej('Kendinizi davet edemezsiniz.');
        if ((room.players || []).some(p => Number(p.userId) === Number(targetId))) return rej('Oyuncu zaten masada.');
        // Hedefin çevrimiçi olması = kimliği (attest/me) doğrulanmış üyedir;
        // ayrıca arkadaşlık belgesi hedefi kimliğe bağlar.
        const set = online.get(targetId);
        if (!set || !set.size) return rej('Arkadaşınız şu an çevrimiçi değil.');
        let friendOk = verifyFriendProof(payload && payload.friendProof, me.id, targetId);
        if (!friendOk) {
          try { friendOk = await remote.isFriendPair(me.id, targetId); } catch (_) { friendOk = false; }
        }
        if (!friendOk) return rej('Yalnızca arkadaş listenizdeki oyuncuları davet edebilirsiniz.');
        if (!room.invited || typeof room.invited.set !== 'function') room.invited = new Map();
        if (room.invited.size >= 15) return rej('Bekleyen davet sınırına ulaşıldı — biri katılmadan yeni davet gönderilemez.');
        // Davet = giriş hakkı; atılmışsa yeni davetle hak yeniden açılır.
        room.invited.set(targetId, { ts: now() });
        if (room.kickBan && typeof room.kickBan.delete === 'function') room.kickBan.delete(targetId);
        const invite = {
          inviteId: 'inv-' + now() + '-' + Math.floor(Math.random() * 1e5),
          fromId: me.id, fromName: me.name,
          roomId: String(room.id), roomName: room.name, gameId: room.gameId, ts: now()
        };
        set.forEach(s => s.emit('gameInvite', invite));
        // İsim, gönderen istemcinin arkadaş listesinden gelir (görseldir).
        const toName = (payload && typeof payload.toName === 'string' && payload.toName.trim()) || 'Arkadaşınız';
        socket.emit('inviteSent', { ok: true, toName, toUserId: targetId });
      } catch (e) {
        rej('Davet gönderilemedi, sonra deneyin.');
      }
    });

    socket.on('inviteResponse', payload => {
      if (!socket.userId) return;
      const fromId = Number(payload && payload.fromId);
      const set = online.get(fromId);
      if (!set) return;
      set.forEach(s => s.emit('inviteAnswered', {
        byId: socket.userId, byName: socket.userName || 'Oyuncu',
        accepted: !!(payload && payload.accepted),
        roomId: payload && payload.roomId
      }));
    });

    // Arkadaşlık anlık bildirimleri (ping): gerçek durum DEĞİŞİKLİKLERİ
    // tarayıcı → Yöncü PHP REST'i üzerinden yapılır (istemci bunu zaten
    // yaptı); ping yalnızca "şimdi bildir" yönlendirmesidir. Kural:
    //   - PHP KESİN cevap veriyorsa (erişilebilir): cevaba uy — "yok"sa
    //     bildirim gitmez (X-GV-Key ile sorulur).
    //   - PHP erişilemiyorsa (DDoS 303/timeout): bildirim yine iletilir;
    //     alıcının listesi 8 sn'lik taramayla PHP'den kendiliğinden
    //     doğrulanır. Gönderici zaten doğrulanmış üyedir (attest/me).
    socket.on('friendRequestPing', async payload => {
      try {
        if (!socket.userId) return;
        const me = { id: socket.userId, name: socket.userName || 'Oyuncu' };
        const targetId = Number(payload && payload.toUserId);
        const set = online.get(targetId);
        if (!set || !set.size) return;
        const has = await remote.hasRequestOrNull(me.id, targetId);
        if (has === false) return; // PHP kesin dedi: bekleyen istek yok
        set.forEach(s => s.emit('friendRequest', { fromId: me.id, fromName: me.name }));
      } catch (_) {}
    });
    socket.on('friendAcceptPing', async payload => {
      try {
        if (!socket.userId) return;
        const me = { id: socket.userId, name: socket.userName || 'Oyuncu' };
        const otherId = Number(payload && payload.toUserId);
        const set = online.get(otherId);
        if (!set || !set.size) return;
        const fr = await remote.isFriendPairOrNull(me.id, otherId);
        if (fr === false) return; // PHP kesin dedi: arkadaşlık oluşmamış
        set.forEach(s => s.emit('friendAccepted', { byId: me.id, byName: me.name }));
      } catch (_) {}
    });
    socket.on('friendDeclinePing', async payload => {
      try {
        if (!socket.userId) return;
        const me = { id: socket.userId, name: socket.userName || 'Oyuncu' };
        const otherId = Number(payload && payload.toUserId);
        const set = online.get(otherId);
        if (!set || !set.size) return;
        // Üçü de "kesin bağ var"sa bildirim gitmez; erişilemezse (null) gider.
        const [fr, p1, p2] = await Promise.all([
          remote.isFriendPairOrNull(me.id, otherId),
          remote.hasRequestOrNull(me.id, otherId),
          remote.hasRequestOrNull(otherId, me.id)
        ]);
        if ((fr === true || p1 === true || p2 === true)) return;
        set.forEach(s => s.emit('friendDeclined', {
          byId: me.id, byName: me.name,
          kind: (payload && payload.kind === 'cancelled') ? 'cancelled' : 'declined'
        }));
      } catch (_) {}
    });
  }

  function recordMatch(p) {
    if (!p || !Array.isArray(p.players) || !p.players.some(x => x.id != null)) return;
    remote.recordMatch(p); // ateş-unut, Render'ı bekletme
  }
  function logChat(m) { remote.logChat(m); }

  console.log('👤 Üyelik UZAK modda: Yöncü PHP/MySQL — Render sadece soket/proxy.');
  return { isOnline, onlineCount, uidFromUserKey, recordMatch, attachSocket, logChat, userById: () => null,
    // Uzak modda jeton Yöncü PHP'de doğrulanır (3 kanallı me çağrısı).
    verifyToken: async (t) => { const u = t ? await remote.me(String(t)) : null; return (u && u.id) ? Number(u.id) : null; },
    // Kararlı sonuç: 401 → 'invalid' (kesin), timeout/ağ → 'unknown'.
    // Özel oda kilidi 'unknown'da oyuncuyu şartlı kabul eder, 'invalid'da
    // kesin reddeder — sahte jeton özel masaya giremez.
    verifyTokenFull: async (t) => {
      if (!t) return { uid: null, status: 'invalid' };
      const r = await remote.meFull(String(t));
      return { uid: r.user && r.user.id ? Number(r.user.id) : null, status: r.status };
    },
    // Birleşik kimlik: önce imzalı belge (Render'da yerinde, PHP GEREKSİZ),
    // sonra token → PHP meFull (401=kesin geçersiz, timeout=bilinmiyor).
    verifyIdentityFull: async (cred) => {
      cred = cred || {};
      const att = verifyAttestation(cred.attestation);
      if (att) return { uid: att.uid, status: 'ok' };
      if (!cred.token) return { uid: null, status: 'invalid' };
      const r = await remote.meFull(String(cred.token));
      return { uid: r.user && r.user.id ? Number(r.user.id) : null, status: r.status };
    } };
}

module.exports = { installAuth, uidFromUserKey, verifyAttestation, verifyFriendProof, hmacSha256Hex };
