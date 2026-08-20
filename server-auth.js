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

const now = () => Date.now();
const online = new Map(); // userId -> Set<socket>

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

// ---------------- REST kurulumu ----------------
function installAuth(app, deps) {
  const io = deps.io;
  const rooms = deps.rooms;

  if (!db) {
    app.all('/api/auth/*', (_req, res) => res.status(503).json({ ok: false, error: 'Üyelik katmanı (veritabanı) bu sunucuda devre dışı.' }));
    console.warn('⚠️  Auth endpoints 503 (db yok).');
    return { isOnline: () => false, uidFromUserKey, recordMatch: () => {}, attachSocket: () => {} };
  }

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
  app.post('/api/friends/add', (req, res) => {
    const u = authFromReq(req);
    if (!u) return res.status(401).json({ ok: false, error: 'Giriş gerekli.' });
    const fid = Number(req.body && req.body.friendId);
    if (!userById(fid)) return res.status(404).json({ ok: false, error: 'Oyuncu bulunamadı.' });
    if (fid === u.id) return res.status(400).json({ ok: false, error: 'Kendinizi ekleyemezsiniz.' });
    db.prepare('INSERT OR IGNORE INTO friends(user_id,friend_id,created_at) VALUES(?,?,?)').run(u.id, fid, now());
    res.json({ ok: true, friends: friendsOf(u.id) });
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
      socket.userId = u.id;
      socket.userKey = 'user:' + u.id;
      let set = online.get(u.id);
      if (!set) { set = new Set(); online.set(u.id, set); }
      set.add(socket);
      socket.emit('authReady', { ok: true, user: publicUser(u) });
    });

    socket.on('disconnect', () => {
      if (!socket.userId) return;
      const set = online.get(socket.userId);
      if (set) { set.delete(socket); if (!set.size) online.delete(socket.userId); }
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
      const target = userById(Number(payload && payload.toUserId));
      if (!target) return rej('Oyuncu bulunamadı.');
      if (target.id === me.id) return rej('Kendinizi davet edemezsiniz.');
      if (!isFriendPair(me.id, target.id)) return rej('Yalnızca arkadaş listenizdeki oyuncuları davet edebilirsiniz.');
      const set = online.get(target.id);
      if (!set || !set.size) return rej('Arkadaşınız şu an çevrimiçi değil.');
      const invite = {
        inviteId: 'inv-' + now() + '-' + Math.floor(Math.random() * 1e5),
        fromId: me.id, fromName: me.name,
        roomId: String(room.id), roomName: room.name, gameId: room.gameId, ts: now()
      };
      set.forEach(s => s.emit('gameInvite', invite));
      socket.emit('inviteSent', { ok: true, toName: target.name });
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
  return { isOnline, uidFromUserKey, recordMatch, attachSocket, userById };
}

module.exports = { installAuth, uidFromUserKey };
