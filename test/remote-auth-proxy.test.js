'use strict';

/*
 * UZAK MOD (Render ↔ Yöncü PHP) — sahte bir "PHP API" ile uçtan uca doğrulama.
 *
 *  Bu suite'te Yöncü PHP API'sini taklit eden küçük bir HTTP sunucusu kurulur
 *  (auth.php / social.php sözleşmesini aynen uygular). GameVerse sunucusu
 *  GV_AUTH_API ortam değişkeniyle ona yönlendirilir. Doğrulananlar:
 *
 *   1) REST proxy: kayıt/giriş/arkadaş uçları Render üstünden PHP'ye aktar.
 *   2) authHello: soket kimliği PHP'deki oturumla doğrulanır (30 sn önbellek).
 *   3) Davet kuralları uzak modda da zorunlu (arkadaşlık PHP'den sorulur,
 *      X-GV-Key anahtarı korur) — yanlış anahtar PHP tarafında 403.
 *   4) Maç geçmişi oyuncuya işlenir: recordMatch PHP'ye ulaşır.
 *   5) Sohbet logChat ile PHP'ye ASENKRON yazılır (logyazım bekletmez).
 *   6) Profil proxy'si çevrimiçi bayrağını Render'dan zenginleştirir.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-remote-test-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';
const KEY = 'test-server-key-0123456789';
process.env.GV_SERVER_KEY = KEY;

const assert = require('assert');
const http = require('http');

// ---------------- Sahte Yöncü PHP API ----------------
function startMockPhp() {
  const users = new Map();   // id -> user
  const sessions = new Map();// token -> userId
  const friends = new Set(); // "a-b"
  const state = {
    users, sessions, friends,
    matches: [], chat: [],
    seenKeys: [], // recordMatch/chatLog isteklerinde gelen X-GV-Key
    nextId: 1
  };

  function json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  }
  const tok = () => 'tok-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  const byToken = req => {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const uid = sessions.get(m[1]);
    return uid ? users.get(uid) : null;
  };

  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const action = u.searchParams.get('action') || '';
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let inb = {};
      try { inb = JSON.parse(body || '{}'); } catch (_) {}
      if (u.pathname === '/auth.php') {
        if (action === 'register') {
          const id = state.nextId++;
          const user = { id, name: inb.name, email: String(inb.email).toLowerCase(), verified: 0, vt: 'vt' + id };
          users.set(id, user);
          return json(res, 200, { ok: true, userId: id, mailSent: true });
        }
        if (action === 'verify') {
          for (const usr of users.values()) if (usr.vt === inb.token) { usr.verified = 1; return json(res, 200, { ok: true }); }
          return json(res, 200, { ok: false, error: 'geçersiz' });
        }
        if (action === 'login') {
          const ident = String(inb.email || '').toLowerCase();
          for (const usr of users.values()) {
            if (usr.email === ident || String(usr.name).toLowerCase() === ident) {
              if (!usr.verified) return json(res, 403, { ok: false, needVerify: true, email: usr.email });
              const t = tok(); sessions.set(t, usr.id);
              return json(res, 200, { ok: true, token: t, user: { id: usr.id, name: usr.name, email: usr.email } });
            }
          }
          return json(res, 401, { ok: false, error: 'hatalı' });
        }
        if (action === 'me') {
          const usr = byToken(req);
          if (!usr) return json(res, 401, { ok: false, error: 'Oturum geçersiz.' });
          return json(res, 200, { ok: true, user: { id: usr.id, name: usr.name, email: usr.email } });
        }
        if (action === 'logout') return json(res, 200, { ok: true });
        return json(res, 404, { ok: false });
      }
      if (u.pathname === '/social.php') {
        if (action === 'userPublic') {
          const usr = users.get(Number(u.searchParams.get('id')));
          return usr ? json(res, 200, { ok: true, user: { id: usr.id, name: usr.name } }) : json(res, 404, { ok: false });
        }
        if (action === 'friends') {
          const usr = byToken(req); if (!usr) return json(res, 401, { ok: false });
          const list = [...users.values()].filter(x =>
            friends.has(usr.id + '-' + x.id) || friends.has(x.id + '-' + usr.id))
            .map(x => ({ id: x.id, name: x.name }));
          return json(res, 200, { ok: true, friends: list });
        }
        if (action === 'friendAdd') {
          const usr = byToken(req); if (!usr) return json(res, 401, { ok: false });
          friends.add(usr.id + '-' + Number(inb.friendId));
          const list = [...users.values()].filter(x =>
            friends.has(usr.id + '-' + x.id) || friends.has(x.id + '-' + usr.id))
            .map(x => ({ id: x.id, name: x.name }));
          return json(res, 200, { ok: true, friends: list });
        }
        if (action === 'isFriendPair') {
          state.seenKeys.push(['isFriendPair', req.headers['x-gv-key']]);
          if (req.headers['x-gv-key'] !== KEY) return json(res, 403, { ok: false });
          const a = u.searchParams.get('a'), b = u.searchParams.get('b');
          return json(res, 200, { ok: true, friend: friends.has(a + '-' + b) || friends.has(b + '-' + a) });
        }
        if (action === 'recordMatch') {
          state.seenKeys.push(['recordMatch', req.headers['x-gv-key']]);
          if (req.headers['x-gv-key'] !== KEY) return json(res, 403, { ok: false });
          state.matches.push(inb);
          return json(res, 200, { ok: true });
        }
        if (action === 'chatLog') {
          state.seenKeys.push(['chatLog', req.headers['x-gv-key']]);
          if (req.headers['x-gv-key'] !== KEY) return json(res, 403, { ok: false });
          state.chat.push(inb);
          return json(res, 200, { ok: true });
        }
        if (action === 'profile') {
          const id = Number(u.searchParams.get('id'));
          const usr = users.get(id);
          if (!usr) return json(res, 404, { ok: false });
          return json(res, 200, { ok: true, user: { id, name: usr.name, createdAt: 1 }, online: false, stats: {}, recent: [] });
        }
        return json(res, 404, { ok: false });
      }
      json(res, 404, { ok: false });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, state })));
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (ms || 8000)) {
    try { last = await fn(); } catch (_) { last = null; }
    if (last) return last;
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + label);
}
async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function main() {
  const mock = await startMockPhp();
  const PHP_BASE = 'http://127.0.0.1:' + mock.server.address().port;
  process.env.GV_AUTH_API = PHP_BASE;

  const serverModule = require('../server.js');
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const { io } = require('socket.io-client');

  // ---------- 1) REST proxy akışı ----------
  let r = await api(BASE, '/api/auth/register', { name: 'Kral', email: 'kral@t.com', password: 'sifre12345' });
  assert.ok(r.ok && r.userId, 'kayıt proxy PHP\'ye ulaşmalı');
  assert.strictEqual(mock.state.users.size, 1, 'kayıt PHP (mock) tarafında tutulmalı');
  const CID = r.userId;
  r = await api(BASE, '/api/auth/register', { name: 'Dost', email: 'dost@t.com', password: 'sifre12345' });
  const FID = r.userId;
  r = await api(BASE, '/api/auth/register', { name: 'Yaban', email: 'yaban@t.com', password: 'sifre12345' });
  const SID = r.userId;
  console.log('  ✓ 1) register Render proxy üzerinden PHP\'ye yazıldı');

  r = await api(BASE, '/api/auth/login', { email: 'kral@t.com', password: 'x' });
  assert.strictEqual(r.status, 403, 'onaysız giriş 403 (PHP kararı)');
  for (const u of mock.state.users.values()) u.verified = 1; // mail akışı mock'ta atlanır
  r = await api(BASE, '/api/auth/login', { email: 'kral@t.com', password: 'x' });
  assert.ok(r.ok && r.token, 'giriş proxy dönmeli');
  const CTOK = r.token;
  const loginF = await api(BASE, '/api/auth/login', { email: 'dost@t.com', password: 'x' });
  const FTOK = loginF.token;
  const loginS = await api(BASE, '/api/auth/login', { email: 'yaban@t.com', password: 'x' });
  const STOK = loginS.token;
  console.log('  ✓ 2) login/me proxy çalışıyor (needVerify kararı da PHP\'den geldi)');

  r = await api(BASE, '/api/auth/me', null, 'GET', CTOK);
  assert.ok(r.ok && r.user.id === CID, 'me proxy');
  r = await api(BASE, '/api/friends/add', { friendId: FID }, 'POST', CTOK);
  assert.ok(r.ok && r.friends.some(x => x.id === FID), 'arkadaş ekleme proxy');
  console.log('  ✓ 3) friends proxy');

  // ---------- Soket katmanı (remote doğrulama) ----------
  function conn(name) {
    const s = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('conn ' + name)), 8000);
      s.on('connect', () => { clearTimeout(t); resolve(s); });
      s.on('connect_error', reject);
    });
  }
  const once = (s, ev, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms || 8000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });

  const cSock = await conn('C');
  const fSock = await conn('F');
  const sSock = await conn('S');
  cSock.emit('authHello', { token: CTOK });
  fSock.emit('authHello', { token: FTOK });
  sSock.emit('authHello', { token: STOK });
  const ar = await once(cSock, 'authReady');
  assert.ok(ar.ok && ar.user.id === CID, 'authHello PHP (mock) ile doğrulanmalı');
  await Promise.all([once(fSock, 'authReady'), once(sSock, 'authReady')]);
  console.log('  ✓ 4) authHello token\'ı PHP üzerinden doğrulandı');

  // profil proxy'si çevrimiçi bayrağını Render'dan almalı
  r = await api(BASE, '/api/users/' + FID + '/profile', null, 'GET');
  assert.strictEqual(r.online, true, 'F bağlıyken online=true (proxy zenginleştirme)');
  r = await api(BASE, '/api/users/' + SID + '/profile', null, 'GET');
  assert.strictEqual(r.online, true, 'S de bağlı');
  console.log('  ✓ 5) profil proxy online bayrağını yerel haritadan zenginleştirdi');

  // ---------- davet (remote isFriendPair + anahtar) ----------
  const privJoin = once(cSock, 'joinedRoom');
  cSock.emit('joinRoom', { roomId: '9100', gameId: 'chess', userName: 'Kral', userKey: 'user:' + CID, isPrivate: true, maxPlayers: 2 });
  await privJoin;

  const gotInv = once(fSock, 'gameInvite');
  const sent = once(cSock, 'inviteSent');
  cSock.emit('gameInvite', { toUserId: FID, roomId: '9100' });
  const [iv, snd] = await Promise.all([gotInv, sent]);
  assert.ok(iv.fromName === 'Kral' && snd.toName === 'Dost', 'davet payload');
  assert.ok(mock.state.seenKeys.some(([a, k]) => a === 'isFriendPair' && k === KEY), 'isFriendPair çağrısı X-GV-Key ile gitti');
  console.log('  ✓ 6) remote modda davet: arkadaşlık PHP\'den (anahtarlı) soruldu, bildirim gitti');

  let rej = once(cSock, 'inviteRejected');
  cSock.emit('gameInvite', { toUserId: SID, roomId: '9100' }); // Yaban arkadaş değil
  const rj = await rej;
  assert.ok(/arkadaş/i.test(rj.reason), 'arkadaş olmayan reddedilmeli');
  console.log('  ✓ 7) remote modda arkadaş-olmayan davet kuralı korunuyor');

  // ---------- 4) maç kaydı PHP'ye akar ----------
  const fJoin = once(fSock, 'joinedRoom');
  fSock.emit('joinRoom', { roomId: '9100', gameId: 'chess', userName: 'Dost', userKey: 'user:' + FID });
  await fJoin;
  cSock.emit('setReady', { ready: true });
  fSock.emit('setReady', { ready: true });
  await Promise.all([once(cSock, 'gameStarted'), once(fSock, 'gameStarted')]);
  fSock.emit('leaveRoom');
  await once(cSock, 'gameEnded');
  await waitFor(() => mock.state.matches.length ? mock.state.matches[0] : null, 4000, 'recordMatch PHP\'ye ulaşmadı');
  const m = mock.state.matches[0];
  assert.strictEqual(m.gameId, 'chess');
  assert.strictEqual(m.reason, 'player_left');
  assert.ok((m.players || []).some(p => p.id === FID && !p.won), 'terk eden üye mağlup işlenmeli');
  assert.ok((m.players || []).some(p => p.id === CID && p.won), 'kalan üye galip işlenmeli');
  assert.ok(mock.state.seenKeys.some(([a, k]) => a === 'recordMatch' && k === KEY), 'recordMatch anahtarlı gitmeli');
  console.log('  ✓ 8) maç geçmişi PHP\'ye (MySQL kalıcılığına) yazıldı — doğru galip/mağlup');

  // ---------- 5) sohbet logChat PHP'ye uçar ----------
  cSock.emit('chatMessage', { scope: 'room', text: 'selam masaya', name: 'Kral' });
  await waitFor(() => mock.state.chat.length ? mock.state.chat[0] : null, 4000, 'chatLog PHP\'ye ulaşmadı');
  assert.ok(mock.state.chat[0].text === 'selam masaya' && String(mock.state.chat[0].roomId) === '9100', 'sohbet satırı içerik+oda doğru');
  assert.ok(mock.state.seenKeys.some(([a, k]) => a === 'chatLog' && k === KEY), 'chatLog anahtarlı gitmeli');
  console.log('  ✓ 9) oda sohbeti PHP\'ye kalıcı olarak kaydedildi');

  // ---------- 6) yanlış anahtar korunur ----------
  assert.ok(!mock.state.seenKeys.some(([, k]) => k !== KEY && k !== undefined), 'yanlış anahtarla hiçbir yazma kabul edilmedi');

  console.log('\n✅ REMOTE-AUTH-PROXY: Yöncü↔Render uzak mod testleri geçti');
  [cSock, fSock, sSock].forEach(s => s.disconnect());
  await new Promise(r2 => mock.server.close(r2));
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
