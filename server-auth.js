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
// auth.php?action=attest çıktısı: { id, name, founder, ts, exp, sig }
// Geçerliyse { uid, name, founder }, değilse null döner. "founder" bayrağı
// PHP'nin gv_is_founder() sonucudur ve İMZAYA dahildir — bu sayede Kurucu
// Paneli uçları da (requireAdmin) PHP'ye ayrıca ulaşmadan, imzalı belgeyle
// yerinde doğrulanabilir (Yöncü DDoS koruması Render'ın sunucu-sunucu
// isteklerini engellese bile).
function verifyAttestation(att) {
  if (!att || typeof att !== 'object') return null;
  const id = Number(att.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (!windowOk(att.ts, att.exp)) return null;
  const founder = Number(att.founder) === 1 ? 1 : 0;
  const msg = id + '|' + String(att.name == null ? '' : att.name) + '|' + founder + '|' + Number(att.ts) + '|' + Number(att.exp);
  if (!sigMatches(msg, att.sig)) return null;
  return { uid: id, name: String(att.name == null ? '' : att.name), founder: founder === 1 };
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
  return db.prepare('SELECT id,name,email,verified,created_at,is_founder FROM users WHERE id = ?').get(Number(id)) || null;
}

// Kurucu (founder) kontrolü — TEK KAYNAK. İki koşuldan biri yeter:
//   1) users.is_founder = 1   (veritabanından işaretlenir)
//   2) e-posta GV_ADMIN_EMAIL ile birebir aynı
// Aynı kural PHP tarafında gv_is_founder() ile birebir uygulanır.
function isFounderUser(u) {
  if (!u) return false;
  if (Number(u.is_founder) === 1 || u.isFounder === true) return true;
  const mail = String(process.env.GV_ADMIN_EMAIL || '').trim().toLowerCase();
  if (!mail) return false;
  return String(u.email || '').toLowerCase() === mail;
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
// isFounder: Kurucu Paneli yetkisi (users.is_founder = 1 ya da GV_ADMIN_EMAIL).
// İstemci üst bardaki '👑 Kurucu Paneli' butonunu bu bayrağa göre gösterir.
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, isFounder: isFounderUser(u) }; }

// userKey ('user:7') → db id (oda kayıtlarında üye eşlemesi için)
function uidFromUserKey(userKey) {
  const m = String(userKey || '').match(/^user:(\d+)$/);
  return m ? Number(m[1]) : null;
}
function isOnline(userId) { const s = online.get(Number(userId)); return !!(s && s.size); }
// Çevrimiçi AYRIK üye sayısı (istatistik paneli için): en az bir soketi
// bağlı olan üye adedi.
function onlineCount() { let n = 0; for (const s of online.values()) if (s && s.size) n++; return n; }

// Bir ÜYENİN açık tüm soketlerine olay gönder (yaptırım bildirimi gibi
// kişiye özel anlık uyarılar için). Üye çevrimdışıysa sessizce hiçbir şey
// yapmaz — kalıcı durum zaten veritabanındadır, kullanıcı girince görür.
function emitToUser(userId, event, payload) {
  const set = online.get(Number(userId));
  if (!set || !set.size) return 0;
  let n = 0;
  set.forEach(s => { try { s.emit(event, payload); n++; } catch (_) {} });
  return n;
}

// Kimlik authHello ile SONRADAN çözüldüyse (join anında üyelik backend'i
// yavaştı VEYA oyuncu MASADAYKEN misafirden üyeye geçtiyse — oyun esnasında
// giriş yaptı), soket bir odaysa oda kaydındaki üye alanlarını güncelle:
// userId'siz oturan üyenin üye yetkileri (özel masada kurucu kaydı dahil)
// sayfa yenilenmeden de aktifleşir. GÖRÜNEN AD da (me.name) burada
// güncellenir — eskiden yalnız userId yazılıyordu, ad hep "Ziyaretçi#..."
// olarak kalıyordu (koltuk etiketi VE sohbet ismi bu alandan okunur).
// İzleyici kaydı da aynı şekilde senkronlanır. Yalnızca DEĞİŞEN alanda
// yayın yapılır. (Yerel + uzak modun ikisinde de çağrılır — modül
// seviyesinde tanımlı.)
function syncRoomIdentity(sock, rooms, emitRoom, name) {
  const rid = sock && sock.roomId;
  if (!rid || !sock || !sock.userId) return;
  const r = rooms.get(String(rid));
  if (!r) return;
  let changed = false;
  const uygula = rec => {
    if (!rec) return;
    if (!rec.userId) { rec.userId = sock.userId; changed = true; }
    if (name && rec.name !== name) { rec.name = name; changed = true; }
  };
  if (Array.isArray(r.players)) uygula(r.players.find(p => p.id === sock.id));
  if (Array.isArray(r.spectators)) uygula(r.spectators.find(s => s.id === sock.id));
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
      // Puan sistemi: veritabanı yoksa sessizce devre dışı (uydurma veri yok).
      puanYaz: () => {}, puanOzet: () => ({ toplam: 0, oyunlar: [], genel: {} }),
      puanSiralama: () => [], puanSira: () => null, puanSifirla: () => ({ ok: false, error: 'Veritabanı yok.' }),
      puanAyarOku: () => ({ periyot: 'kapali', sonSifirlama: 0 }), puanAyarYaz: () => ({ ok: false }),
      // Yaptırım sistemi: veritabanı yoksa kimse kısıtlı değildir.
      emitToUser,
      yaptirimUygula: () => ({ ok: false, error: 'Veritabanı yok.' }),
      yaptirimKaldir: () => ({ ok: false, error: 'Veritabanı yok.' }),
      yaptirimAktif: () => null,
      yaptirimListe: () => [],
      yaptirimGecmis: () => [],
      raporEkle: () => ({ ok: false, error: 'Veritabanı yok.' }),
      raporListe: () => [],
      // Turnuva: veritabanı yoksa liste boştur, kayıt yapılamaz.
      turnuvaListe: () => [],
      turnuvaKaydet: () => ({ ok: false, error: 'Veritabanı yok.' }),
      turnuvaSil: () => ({ ok: false, error: 'Veritabanı yok.' }),
      userFromReq: () => null,
      userFromReqAsync: async () => null,
      verifyToken: async () => null, verifyTokenFull: async () => ({ uid: null, status: 'invalid' }),
      verifyIdentityFull: async () => ({ uid: null, status: 'invalid' }) };
  }

  // ---- Yönetici (kurucu) hesabı ----
  // Kurucu Paneli'ni açan hesap: users.is_founder = 1 OLAN hesap ya da
  // e-postası GV_ADMIN_EMAIL'e eşit olan hesap (bkz. isFounderUser).
  //
  // ⚠ GÜVENLİK: Burada eskiden kurucu@kurucu.com hesabı SABİT "kurucu123"
  // şifresiyle otomatik açılıyordu; şifre depoda açıkça yazdığı için siteye
  // dışarıdan kurucu olarak girilebiliyordu. Otomatik açma KALDIRILDI.
  // Yerel/geliştirme ortamında bir kurucu hesabı gerekiyorsa GV_ADMIN_EMAIL
  // ve GV_ADMIN_PASS birlikte verilir; yalnız o zaman oluşturulur.
  try {
    const ADMIN_MAIL = String(process.env.GV_ADMIN_EMAIL || '').trim().toLowerCase();
    const ADMIN_PASS = String(process.env.GV_ADMIN_PASS || '');
    if (ADMIN_MAIL) {
      const exists = db.prepare('SELECT id, is_founder FROM users WHERE lower(email) = ?').get(ADMIN_MAIL);
      if (exists) {
        // Var olan hesabı kurucu olarak işaretle (bayrak tek doğruluk kaynağı).
        if (Number(exists.is_founder) !== 1) {
          db.prepare('UPDATE users SET is_founder = 1 WHERE id = ?').run(exists.id);
        }
      } else if (ADMIN_PASS) {
        db.prepare('INSERT INTO users(name, email, pass_hash, verified, created_at, is_founder) VALUES(?, ?, ?, 1, ?, 1)')
          .run('\u{1F451} Kurucu', ADMIN_MAIL, bcrypt.hashSync(ADMIN_PASS, 10), now());
        console.log('👑 Yönetici hesabı oluşturuldu: ' + ADMIN_MAIL);
      } else {
        console.warn('ℹ️  GV_ADMIN_EMAIL tanımlı ama o e-postayla hesap yok; GV_ADMIN_PASS verilmediği için hesap OLUŞTURULMADI.');
      }
    }
  } catch (e) { console.warn('⚠️  Yönetici hesabı hazırlanamadı:', e.message); }

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

  // ---------------- PUAN SİSTEMİ (yerel mod) ----------------
  // Kurallar scoring.js'te; burada YALNIZ kalıcılık var. Puanlar toplam
  // olarak değil OLAY olarak yazılır (score_events): oyun türüne göre ayrı
  // istatistik ve "sıfırla" işlemi bu sayede veri silmeden yapılabiliyor.

  // En son sıfırlama anı: bundan ÖNCEKİ olaylar toplamlara girmez.
  function puanSifirNoktasi() {
    if (!db) return 0;
    try {
      const r = db.prepare('SELECT ts FROM score_resets ORDER BY ts DESC LIMIT 1').get();
      return r ? Number(r.ts) : 0;
    } catch (_) { return 0; }
  }

  // Olay listesini yazar. Tek işlemde (transaction) yazılır ki maç bitişinde
  // yarım kalmış puan tablosu oluşmasın.
  function puanYaz(olaylar) {
    if (!db || !Array.isArray(olaylar) || !olaylar.length) return;
    try {
      const ins = db.prepare('INSERT INTO score_events(user_id,game_id,kind,points,room_id,ts) VALUES(?,?,?,?,?,?)');
      const t = now();
      db.transaction(list => {
        for (const o of list) {
          if (!o || !(Number(o.uid) > 0)) continue;
          ins.run(Number(o.uid), String(o.gameId || ''), String(o.tur || ''),
                  Math.round(Number(o.puan) || 0), String(o.roomId || ''), t);
        }
      })(olaylar);
    } catch (e) { console.warn('puan yazılamadı:', e.message); }
  }

  // Bir üyenin puan özeti — OYUN TÜRÜNE GÖRE AYRI (kullanıcının isteği).
  function puanOzet(uid) {
    const bos = { toplam: 0, oyunlar: [], genel: { mac: 0, galibiyet: 0, beraberlik: 0,
                  maglubiyet: 0, terk: 0 }, sira: null };
    if (!db || !(Number(uid) > 0)) return bos;
    try {
      const t0 = puanSifirNoktasi();
      const rows = db.prepare(
        `SELECT game_id, kind, COUNT(*) adet, SUM(points) puan
           FROM score_events WHERE user_id = ? AND ts >= ?
          GROUP BY game_id, kind`
      ).all(Number(uid), t0);
      const harita = new Map();
      for (const r of rows) {
        let g = harita.get(r.game_id);
        if (!g) {
          g = { gameId: r.game_id, puan: 0, mac: 0, galibiyet: 0, beraberlik: 0,
                maglubiyet: 0, terk: 0, donus: 0 };
          harita.set(r.game_id, g);
        }
        const adet = Number(r.adet) || 0;
        g.puan += Number(r.puan) || 0;
        if (r.kind === 'win' || r.kind === 'win_left') { g.galibiyet += adet; g.mac += adet; }
        else if (r.kind === 'draw') { g.beraberlik += adet; g.mac += adet; }
        else if (r.kind === 'loss' || r.kind === 'timeout') { g.maglubiyet += adet; g.mac += adet; }
        else if (r.kind === 'leave') g.terk += adet;
        else if (r.kind === 'rejoin') g.donus += adet;
      }
      const oyunlar = [...harita.values()].sort((a, b) => b.puan - a.puan);
      const genel = { mac: 0, galibiyet: 0, beraberlik: 0, maglubiyet: 0, terk: 0 };
      let toplam = 0;
      oyunlar.forEach(g => {
        toplam += g.puan;
        genel.mac += g.mac; genel.galibiyet += g.galibiyet;
        genel.beraberlik += g.beraberlik; genel.maglubiyet += g.maglubiyet;
        genel.terk += g.terk;
      });
      // TABAN: toplam puan eksiye düşmez (tek tek olaylar eksi kalabilir).
      const toplamNet = Math.max(0, toplam);
      return { toplam: toplamNet, oyunlar, genel, sifirlandi: t0, sira: puanSira(uid, t0, toplamNet) };
    } catch (e) { console.warn('puan özeti okunamadı:', e.message); return bos; }
  }

  // Sıralama tablosu (ilk N üye). Oyun türü verilirse o oyuna göre.
  function puanSiralama(limit, gameId) {
    if (!db) return [];
    try {
      const t0 = puanSifirNoktasi();
      const n = Math.min(100, Math.max(1, Number(limit) || 20));
      const kosul = gameId ? ' AND e.game_id = ?' : '';
      const args = gameId ? [t0, String(gameId), n] : [t0, n];
      const rows = db.prepare(
        `SELECT u.id, u.name, SUM(e.points) puan
           FROM score_events e JOIN users u ON u.id = e.user_id
          WHERE e.ts >= ?${kosul}
          GROUP BY u.id, u.name ORDER BY puan DESC LIMIT ?`
      ).all(...args);
      return rows.map(r => ({ id: r.id, name: r.name, puan: Math.max(0, Number(r.puan) || 0) }));
    } catch (e) { console.warn('sıralama okunamadı:', e.message); return []; }
  }

  // Bir üyenin GERÇEK küresel sırası (kullanıcının isteği: "puan veri
  // istatistikleri gerçeği yansıtsın, rastgele değerler olmasın" — önceden
  // profildeki sıra numarası puan aralığına göre UYDURULMUŞ bir tabloydan
  // geliyordu). Kendisinden daha yüksek puanlı kaç üye varsa, sıra ondan
  // bir fazlasıdır (1 = birinci). t0/toplam verilirse (puanOzet zaten
  // hesapladıysa) tekrar sorgulanmaz — aksi halde kendisi hesaplar.
  function puanSira(uid, t0, toplam) {
    if (!db || !(Number(uid) > 0)) return null;
    try {
      if (t0 == null) t0 = puanSifirNoktasi();
      if (toplam == null) {
        const r = db.prepare('SELECT SUM(points) puan FROM score_events WHERE user_id = ? AND ts >= ?').get(Number(uid), t0);
        toplam = Math.max(0, Number(r && r.puan) || 0);
      }
      const row = db.prepare(
        `SELECT COUNT(*) + 1 AS pos FROM (
           SELECT user_id, SUM(points) puan FROM score_events
            WHERE ts >= ? GROUP BY user_id HAVING SUM(points) > ?
         )`
      ).get(t0, Number(toplam) || 0);
      return row ? Number(row.pos) || 1 : 1;
    } catch (e) { console.warn('sıra okunamadı:', e.message); return null; }
  }

  // Kurucu: puanları sıfırla. Veri SİLİNMEZ — yeni bir sıfırlama noktası
  // işaretlenir, toplamlar o andan itibaren sayılır (geri alınabilir).
  function puanSifirla(byUserId, mode) {
    if (!db) return { ok: false, error: 'Veritabanı yok.' };
    try {
      const t = now();
      db.prepare('INSERT INTO score_resets(ts,by_user,mode) VALUES(?,?,?)')
        .run(t, Number(byUserId) || null, String(mode || 'manuel'));
      return { ok: true, ts: t };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // Kurucu ayarı: otomatik sıfırlama periyodu (settings tablosunda).
  function puanAyarOku() {
    if (!db) return { periyot: 'kapali', sonSifirlama: 0 };
    try {
      const r = db.prepare('SELECT value FROM settings WHERE skey = ?').get('score_reset_period');
      return { periyot: r ? String(r.value) : 'kapali', sonSifirlama: puanSifirNoktasi() };
    } catch (_) { return { periyot: 'kapali', sonSifirlama: 0 }; }
  }
  function puanAyarYaz(periyot) {
    if (!db) return { ok: false };
    try {
      db.prepare('INSERT INTO settings(skey,value,updated_at) VALUES(?,?,?) ' +
                 'ON CONFLICT(skey) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
        .run('score_reset_period', String(periyot || 'kapali'), now());
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // ======================= ÜYE YAPTIRIMLARI =======================
  // Kurucunun bir üyeye uyguladığı kısıtlama. ŞİMDİLİK TEK TÜR: 'chat' —
  // kullanıcının HEM oyun içi (masa) HEM genel sohbeti kapatılır.
  //
  // Tasarım kararları:
  //  * expires_at NULL → SÜRESİZ. Süre girilirse bitiş anı MUTLAK zaman
  //    olarak saklanır (sunucu yeniden başlasa da yaptırım aynen sürer).
  //  * Kayıt SİLİNMEZ; kaldırma lifted_at ile işaretlenir (denetim izi).
  //  * Aynı üyeye yeni yaptırım gelirse öncekiler kaldırılmış sayılır —
  //    her zaman TEK aktif kayıt olur, "hangisi geçerli" belirsizliği yok.
  function yaptirimSatirTemiz(r) {
    if (!r) return null;
    return {
      id: Number(r.id), userId: Number(r.user_id), tur: String(r.kind || 'chat'),
      sebep: r.reason ? String(r.reason) : '',
      byUid: r.by_user != null ? Number(r.by_user) : null,
      baslangic: Number(r.created_at) || 0,
      bitis: r.expires_at != null ? Number(r.expires_at) : null,   // null = süresiz
      kaldirildi: r.lifted_at != null ? Number(r.lifted_at) : null
    };
  }

  // Bir üyenin YÜRÜRLÜKTEKİ yaptırımı (yoksa null). Süresi dolmuş kayıt
  // otomatik olarak geçersizdir — ayrı bir temizleyici işe gerek yok.
  function yaptirimAktif(uid, tur) {
    if (!db || !(Number(uid) > 0)) return null;
    try {
      const r = db.prepare(
        `SELECT * FROM sanctions
          WHERE user_id = ? AND kind = ? AND lifted_at IS NULL
            AND (expires_at IS NULL OR expires_at > ?)
          ORDER BY id DESC LIMIT 1`
      ).get(Number(uid), String(tur || 'chat'), now());
      return yaptirimSatirTemiz(r);
    } catch (e) { console.warn('yaptırım okunamadı:', e.message); return null; }
  }

  // Kurucu: yaptırım uygula. sureMs null/0 → SÜRESİZ.
  function yaptirimUygula(p) {
    if (!db) return { ok: false, error: 'Veritabanı yok.' };
    const uid = Number(p && p.uid);
    if (!(uid > 0)) return { ok: false, error: 'Kullanıcı bulunamadı.' };
    const tur = String((p && p.tur) || 'chat');
    const t = now();
    const sureMs = Number(p && p.sureMs);
    const bitis = (Number.isFinite(sureMs) && sureMs > 0) ? t + Math.round(sureMs) : null;
    try {
      // Önceki aktif kayıtları kapat (tek aktif yaptırım kuralı).
      db.prepare('UPDATE sanctions SET lifted_at = ?, lifted_by = ? WHERE user_id = ? AND kind = ? AND lifted_at IS NULL')
        .run(t, Number(p && p.byUid) || null, uid, tur);
      db.prepare('INSERT INTO sanctions(user_id,kind,reason,by_user,created_at,expires_at) VALUES(?,?,?,?,?,?)')
        .run(uid, tur, String((p && p.sebep) || '').slice(0, 240), Number(p && p.byUid) || null, t, bitis);
      return { ok: true, yaptirim: yaptirimAktif(uid, tur) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // Kurucu: yaptırımı kaldır (kayıt silinmez, kaldırıldı işaretlenir).
  function yaptirimKaldir(uid, byUid, tur) {
    if (!db) return { ok: false, error: 'Veritabanı yok.' };
    try {
      const r = db.prepare('UPDATE sanctions SET lifted_at = ?, lifted_by = ? WHERE user_id = ? AND kind = ? AND lifted_at IS NULL')
        .run(now(), Number(byUid) || null, Number(uid), String(tur || 'chat'));
      return { ok: true, kaldirilan: r.changes || 0 };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  // Kurucu paneli listesi: YÜRÜRLÜKTEKİ tüm yaptırımlar (üye adıyla).
  function yaptirimListe() {
    if (!db) return [];
    try {
      const rows = db.prepare(
        `SELECT s.*, u.name AS uname, u.email AS uemail
           FROM sanctions s LEFT JOIN users u ON u.id = s.user_id
          WHERE s.lifted_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > ?)
          ORDER BY s.created_at DESC LIMIT 500`
      ).all(now());
      return rows.map(r => Object.assign(yaptirimSatirTemiz(r), { ad: r.uname || '', eposta: r.uemail || '' }));
    } catch (e) { console.warn('yaptırım listesi okunamadı:', e.message); return []; }
  }

  /* Kurucu paneli "Uyarılar" sütunu (kullanıcı isteği): bir üyenin
     GEÇMİŞTEKİ TÜM yaptırımları — kaldırılmış ve süresi dolmuş olanlar
     DAHİL. Böylece panelde "kaçıncı uyarı" ve "ne kadar süreyle" görülüp
     KATLAMALI ceza verilebilir.
     Not: tablo zaten hiçbir kaydı silmiyordu; eksik olan tek şey, aktif
     olmayanları da döndüren bu okuma yoluydu. uid verilmezse tüm üyelerin
     geçmişi döner (panel tek çağrıda hem sayıları hem ayrıntıyı kurar). */
  function yaptirimGecmis(uid, limit) {
    if (!db) return [];
    const lim = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
    try {
      const tek = Number(uid) > 0;
      const sql =
        `SELECT s.*, u.name AS uname, u.email AS uemail
           FROM sanctions s LEFT JOIN users u ON u.id = s.user_id
          ${tek ? 'WHERE s.user_id = ?' : ''}
          ORDER BY s.user_id ASC, s.created_at ASC
          LIMIT ${lim}`;
      const rows = tek ? db.prepare(sql).all(Number(uid)) : db.prepare(sql).all();
      return rows.map(r => Object.assign(yaptirimSatirTemiz(r), {
        ad: r.uname || '', eposta: r.uemail || ''
      }));
    } catch (e) { console.warn('yaptırım geçmişi okunamadı:', e.message); return []; }
  }

  /* ---------------- ŞİKAYETLER (kullanıcı bildirimleri) ----------------
     Sohbet dökümü şikayet ANINDA dondurulur: oda sohbeti oda kapanınca,
     genel sohbet 60 sn sonra sunucudan silindiği için sonradan
     toplanamaz. */
  function raporEkle(p) {
    if (!db) return { ok: false, error: 'Veritabanı yok.' };
    const scope = (p && p.scope === 'global') ? 'global' : 'room';
    const reason = String((p && p.reason) || '').slice(0, 40);
    if (!reason) return { ok: false, error: 'Gerekçe gerekli.' };
    try {
      const r = db.prepare(
        `INSERT INTO reports(scope,reporter_uid,reporter_name,reported_uid,reported_name,
                             reason,note,room_id,game_id,transcript,created_at,status)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,'open')`
      ).run(
        scope,
        Number(p.reporterUid) || null, String(p.reporterName || '').slice(0, 60),
        Number(p.reportedUid) || null, String(p.reportedName || '').slice(0, 60),
        reason, String(p.note || '').slice(0, 500),
        p.roomId != null ? String(p.roomId).slice(0, 40) : null,
        p.gameId != null ? String(p.gameId).slice(0, 30) : null,
        JSON.stringify(Array.isArray(p.transcript) ? p.transcript.slice(-200) : []),
        now()
      );
      return { ok: true, id: Number(r.lastInsertRowid) };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  function raporListe(p) {
    if (!db) return [];
    const scope = (p && (p.scope === 'global' || p.scope === 'room')) ? p.scope : null;
    const lim = Math.min(Math.max(Number(p && p.limit) || 200, 1), 500);
    try {
      const rows = scope
        ? db.prepare(`SELECT * FROM reports WHERE scope = ? ORDER BY created_at DESC LIMIT ${lim}`).all(scope)
        : db.prepare(`SELECT * FROM reports ORDER BY created_at DESC LIMIT ${lim}`).all();
      return rows.map(raporSatirTemiz);
    } catch (e) { console.warn('şikayet listesi okunamadı:', e.message); return []; }
  }

  /* ==================================================================
     TURNUVALAR (yerel / SQLite)
     Braket ve katılımcı listesi tek bir JSON alanında tutulur; sunucu
     turnuvayı bir bütün olarak okur, değiştirir ve geri yazar. Böylece
     tournament-engine.js'in ürettiği yapı olduğu gibi saklanır.
     ================================================================== */
  function turnuvaSatirTemiz(r) {
    if (!r) return null;
    let d = {};
    try { d = JSON.parse(r.data || '{}'); } catch (_) { d = {}; }
    return {
      id: String(r.id),
      gameId: String(r.game_id || ''),
      ad: String(r.name || ''),
      durum: String(r.status || 'taslak'),
      kayitAcilis: r.register_open_at != null ? Number(r.register_open_at) : null,
      kayitKapanis: r.register_close_at != null ? Number(r.register_close_at) : null,
      baslangic: r.start_at != null ? Number(r.start_at) : null,
      bitis: r.end_at != null ? Number(r.end_at) : null,
      kapasite: Number(r.capacity) || 0,
      not: String(r.note || ''),
      olusturanUid: r.created_by != null ? Number(r.created_by) : null,
      olusturma: Number(r.created_at) || 0,
      guncelleme: Number(r.updated_at) || 0,
      katilimcilar: Array.isArray(d.katilimcilar) ? d.katilimcilar : [],
      braket: d.braket || null,
      duyurular: Array.isArray(d.duyurular) ? d.duyurular : []
    };
  }

  function turnuvaListe() {
    if (!db) return [];
    try {
      return db.prepare('SELECT * FROM tournaments ORDER BY start_at DESC, created_at DESC LIMIT 200')
               .all().map(turnuvaSatirTemiz);
    } catch (e) { console.warn('turnuva listesi okunamadı:', e.message); return []; }
  }

  function turnuvaKaydet(t) {
    if (!db) return { ok: false, error: 'Veritabanı yok.' };
    if (!t || !t.id) return { ok: false, error: 'Turnuva kimliği yok.' };
    const simdi = Date.now();
    const veri = JSON.stringify({
      katilimcilar: t.katilimcilar || [],
      braket: t.braket || null,
      duyurular: t.duyurular || []
    });
    try {
      db.prepare(`INSERT INTO tournaments
          (id,game_id,name,status,register_open_at,register_close_at,start_at,end_at,
           capacity,note,created_by,created_at,updated_at,data)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          game_id=excluded.game_id, name=excluded.name, status=excluded.status,
          register_open_at=excluded.register_open_at, register_close_at=excluded.register_close_at,
          start_at=excluded.start_at, end_at=excluded.end_at, capacity=excluded.capacity,
          note=excluded.note, updated_at=excluded.updated_at, data=excluded.data`)
        .run(String(t.id), String(t.gameId || ''), String(t.ad || ''), String(t.durum || 'taslak'),
             t.kayitAcilis || null, t.kayitKapanis || null, t.baslangic || null, t.bitis || null,
             Number(t.kapasite) || 0, String(t.not || ''),
             t.olusturanUid != null ? Number(t.olusturanUid) : null,
             Number(t.olusturma) || simdi, simdi, veri);
      return { ok: true };
    } catch (e) { console.warn('turnuva kaydedilemedi:', e.message); return { ok: false, error: e.message }; }
  }

  function turnuvaSil(id) {
    if (!db) return { ok: false, error: 'Veritabanı yok.' };
    try { db.prepare('DELETE FROM tournaments WHERE id = ?').run(String(id)); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }

  function raporSatirTemiz(r) {
    if (!r) return null;
    let dokum = [];
    try { dokum = JSON.parse(r.transcript || '[]'); } catch (_) { dokum = []; }
    return {
      id: Number(r.id),
      scope: String(r.scope || 'room'),
      sikayetEdenUid: r.reporter_uid != null ? Number(r.reporter_uid) : null,
      sikayetEden: String(r.reporter_name || ''),
      sikayetEdilenUid: r.reported_uid != null ? Number(r.reported_uid) : null,
      sikayetEdilen: String(r.reported_name || ''),
      gerekce: String(r.reason || ''),
      not: String(r.note || ''),
      odaId: r.room_id != null ? String(r.room_id) : null,
      oyunId: r.game_id != null ? String(r.game_id) : null,
      dokum: Array.isArray(dokum) ? dokum : [],
      tarih: Number(r.created_at) || 0,
      durum: String(r.status || 'open')
    };
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
      if (identityChanged) syncRoomIdentity(socket, rooms, deps.emitRoom, u.name);
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
    // Puan sistemi (scoring.js kuralları + score_events kalıcılığı)
    puanYaz, puanOzet, puanSiralama, puanSira, puanSifirla, puanAyarOku, puanAyarYaz,
    // Yaptırım sistemi (sohbet kısıtlaması) — kalıcılık SQLite'ta.
    emitToUser, yaptirimUygula, yaptirimKaldir, yaptirimAktif, yaptirimListe,
    // Uyarı geçmişi (panelde "Notlar") + şikayet kayıtları.
    yaptirimGecmis, raporEkle, raporListe,
    turnuvaListe, turnuvaKaydet, turnuvaSil,
    // Kurucu Paneli yetki kontrolü (server.js requireAdmin): istemcinin
    // oturum sahibini (e-posta dahil) döndürür.
    userFromReq: (req) => authFromReq(req),
    // Kurucu Paneli yetkisi (server.js requireAdmin) — yerel modda senkron
    // sorgu yeter; imza uzak modla AYNI olsun diye Promise döner.
    userFromReqAsync: async (req) => {
      const u = authFromReq(req);
      return u ? { id: u.id, name: u.name, email: u.email, isFounder: isFounderUser(u) } : null;
    },
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
        if (f.user.name) meNow.name = f.user.name;
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
        if (identityChanged) syncRoomIdentity(socket, rooms, deps.emitRoom, att.name || 'Oyuncu');
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
        if (identityChanged) syncRoomIdentity(socket, rooms, deps.emitRoom, u.name);
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
    // Puan sistemi — UZAK MOD: kurallar Render'da, kalıcılık Yöncü MySQL'de.
    puanYaz: (o) => remote.puanYaz(o),
    puanOzet: (uid) => remote.puanOzet(uid),
    puanSiralama: (n, g) => remote.puanSiralama(n, g),
    // NOT: "sira" (küresel sıra) ayrı bir çağrı gerektirmez — PHP'nin
    // scoreSummary yanıtı zaten hesaplayıp puanOzet() içinde döndürür.
    puanSifirla: (by, mode) => remote.puanSifirla(by, mode),
    puanAyarOku: () => remote.puanAyarOku(),
    puanAyarYaz: (p) => remote.puanAyarYaz(p),
    // Yaptırım sistemi — UZAK MOD: kurallar/anlık uygulama Render'da,
    // kalıcılık Yöncü MySQL'de (puan sistemiyle birebir aynı kalıp).
    emitToUser,
    yaptirimUygula: (p) => remote.yaptirimUygula(p),
    yaptirimKaldir: (uid, by, tur) => remote.yaptirimKaldir(uid, by, tur),
    yaptirimAktif: (uid, tur) => remote.yaptirimAktif(uid, tur),
    yaptirimListe: () => remote.yaptirimListe(),
    // Uyarı geçmişi + şikayetler — UZAK MOD: kalıcılık Yöncü MySQL'de.
    yaptirimGecmis: (uid, limit) => remote.yaptirimGecmis(uid, limit),
    raporEkle: (p) => remote.raporEkle(p),
    raporListe: (p) => remote.raporListe(p),
    // Turnuvalar — UZAK MOD: kalıcılık Yöncü MySQL'de, mantık Render'da.
    turnuvaListe: () => remote.turnuvaListe(),
    turnuvaKaydet: (t) => remote.turnuvaKaydet(t),
    turnuvaSil: (id) => remote.turnuvaSil(id),
    // Kurucu Paneli yetkisi — UZAK MOD. Eskiden bu API userFromReq'i HİÇ
    // döndürmüyordu; server.js'teki requireAdmin bu yüzden üretimde kurucuya
    // bile 403 veriyordu (/api/admin/stats hiç çalışmadı). Kimlik artık
    // Yöncü PHP'sinden (auth.php?action=me) çözülür; 'isFounder' alanı
    // gv_is_founder() ile birebir aynı kuralı taşır.
    userFromReqAsync: async (req) => {
      const h = String((req && req.headers && req.headers.authorization) || '');
      const m = h.match(/^Bearer\s+(.+)$/i);
      const tok = (m && m[1]) ? String(m[1]).trim()
        : (req && req.headers && req.headers['x-gv-token'] ? String(req.headers['x-gv-token']).trim() : '');
      if (!tok) return null;
      let u = null;
      try { u = await remote.me(tok); } catch (_) { u = null; }
      if (!u || !u.id) return null;
      return { id: Number(u.id), name: u.name, email: u.email, isFounder: u.isFounder === true };
    },
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

module.exports = { installAuth, uidFromUserKey, verifyAttestation, verifyFriendProof, hmacSha256Hex, isFounderUser };
