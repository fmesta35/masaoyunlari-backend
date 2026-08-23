'use strict';

/*
 * ÖZEL ODA + UZAK MOD SOĞUK BAŞLANGIÇ (Render ↔ Yöncü PHP) regresyon testi.
 *
 *  Sahte "PHP API" ilk 4 sn'de cevap vermez (soğuk başlangıç simülasyonu),
 *  sonra:
 *   VAKIYE A — sahte jeton:
 *     A1) jeton "bilinmeyen"ken oyuncu ŞARTLI kabul edilir (3 sn) — gerçek
 *         üye yanlış reddedilmesin;
 *     A2) PHP ayaklanıp jetonu KESİN reddedince (401) oyuncu özel masadan
 *         ALINIR (joinFailed) — sahte jetonlu üye masada kalamaz.
 *   VAKIYE B — gerçek üye:
 *     B1) soğuk başlangıçta ŞARTLI kabul edilir;
 *     B2) PHP ayaklanınca kimliği + KURUCU yetkisi otomatik aktifleşir
 *         (self-healing; sayfa yenileme gerekmez).
 *
 *  Ayrıca doğrulanmış kimlik SADECE jetondan gelir: istemcinin 'user:N'
 *  userKey'si sahte creatorId üretmez (B2'de userKey 'user:999' sahtedir,
 *  kurucu yine gerçek uid olmalı).
 */

'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-cold-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { io } = require('socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let delayMs = 4000; // PHP soğuk başlangıç simülasyonu
const users = new Map();
const sessions = new Map();
let nextId = 1;
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    const act = u.searchParams.get('action') || '';
    if (act === 'register') {
      const id = nextId++;
      users.set(id, { id, name: JSON.parse(body || '{}').name, email: JSON.parse(body || '{}').email });
      return res.end(JSON.stringify({ ok: true, userId: id, mailSent: true }));
    }
    if (act === 'login') {
      const b = JSON.parse(body || '{}');
      for (const usr of users.values()) if (usr.email === b.email) {
        const t = 'tok' + usr.id + Math.random().toString(36).slice(2);
        sessions.set(t, usr.id);
        return res.end(JSON.stringify({ ok: true, token: t, user: { id: usr.id, name: usr.name, email: usr.email } }));
      }
      return res.end(JSON.stringify({ ok: false }));
    }
    if (act === 'me') {
      setTimeout(() => {
        const m = String(req.headers['x-gv-token'] || '').trim();
        const uid = sessions.get(m);
        const usr = uid ? users.get(uid) : null;
        if (!usr) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'Oturum geçersiz.' })); }
        res.end(JSON.stringify({ ok: true, user: { id: usr.id, name: usr.name, email: usr.email } }));
      }, delayMs);
      return;
    }
    if (act === 'isFriendPair') return res.end(JSON.stringify({ ok: true, friend: true }));
    if (act === 'recordMatch' || act === 'chatLog') return res.end(JSON.stringify({ ok: true }));
    res.end(JSON.stringify({ ok: false }));
  });
});

let serverModule = null;
async function main() {
  await new Promise(r => mock.listen(0, r));
  const PHPC = 'http://127.0.0.1:' + mock.address().port;
  // auth-remote.js GV_AUTH_API'yi modül YÜKLENİRKEN okur → server.js'ten ÖNCE.
  process.env.GV_AUTH_API = PHPC;
  serverModule = require('../server.js');
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // gerçek üye kaydet (PHP'de oturum)
  let r = await fetch(PHPC + '/auth.php?action=register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Soğuk', email: 'sozuk@c.tr' }) });
  r = await r.json();
  const realId = r.userId;
  r = await fetch(PHPC + '/auth.php?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sozuk@c.tr' }) });
  const realTok = (await r.json()).token;

  // ---------- VAKIE A: sahte jeton, PHP yavaş → önce kabul, sonra KESİN atılma ----------
  const fake = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise(res => fake.on('connect', res));
  const joinedFake = fake.emit('joinRoom', { roomId: '7771', gameId: 'chess', userName: 'Sahte', userKey: 'guest:c:x', isPrivate: true, memberToken: 'fake-token-111' });
  const joinedP = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('fake joinedRoom timeout')), 12000); fake.once('joinedRoom', p => { clearTimeout(t); res(p); }); });
  await joinedP;
  console.log('  ✓ A1) PHP soğuk başlangıcı: sahte jetonlu oyuncu ŞARTLI kabul edildi (3 sn)');
  let kicked = null;
  fake.on('joinFailed', p => { kicked = p; });
  // PHP'yi "başlat" (gecikme 0) → sonraki authHello'da kesin 401 → atılma
  fake.on('connect', () => fake.emit('authHello', { token: 'fake-token-111' }));
  fake.emit('authHello', { token: 'fake-token-111' }); // bir tur daha (me() cooldown'da olabilir)
  setTimeout(() => { delayMs = 0; }, 500); // arka plan meFull 2.8 sn'de bitince PHP hazır olacak
  const waitFor = (cond, ms, label) => new Promise((res, rej) => {
    const t0 = Date.now();
    (function poll() {
      if (cond()) return res();
      if (Date.now() - t0 > ms) return rej(new Error('zaman aşımı: ' + label));
      setTimeout(poll, 200);
    })();
  });
  await waitFor(() => kicked, 20000, 'joinFailed (sahte jeton atılması)');
  assert.strictEqual(kicked.code, 'auth', 'joinFailed code=auth');
  const roomFake = serverModule.rooms.get('7771');
  const fakeStill = roomFake && roomFake.players.some(p => p.id === fake.id);
  assert.ok(!fakeStill, 'sahte jetonlu oyuncu odayı terk etti');
  console.log('  ✓ A2) PHP ayaklanınca sahte jeton KESİN reddedildi → oyuncu masadan alındı (joinFailed)');

  // ---------- VAKIE B: gerçek üye, PHP yavaş → kabul; PHP ayaklanınca kimlik aktifleşir ----------
  const real = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise(res => real.on('connect', res));
  delayMs = 4000; // tekrar soğuk
  const joinedReal = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('real joinedRoom timeout')), 12000); real.once('joinedRoom', p => { clearTimeout(t); res(p); }); });
  real.emit('joinRoom', { roomId: '7772', gameId: 'chess', userName: 'Soğuk', userKey: 'user:999', isPrivate: true, memberToken: realTok });
  await joinedReal;
  console.log('  ✓ B1) gerçek üye soğuk başlangıçta ŞARTLI kabul edildi');
  const roomReal = serverModule.rooms.get('7772');
  assert.ok(roomReal && roomReal.isPrivate, 'oda kuruldu');
  delayMs = 0; // PHP ayaklandı
  let ready = null;
  real.on('authReady', p => { if (p.ok) ready = p; });
  real.emit('authHello', { token: realTok });
  await waitFor(() => ready && Number(roomReal.creatorId) === realId, 15000, 'gerçek üye kimliği + kurucu kaydı');
  console.log('  ✓ B2) PHP ayaklanınca gerçek üyenin kimliği + KURUCU yetkisi aktifleşti (self-healing)');

  console.log('\n✅ COLD-START: soğuk başlangıçta hem sahte jeton atıldı hem gerçek üye iyileşti');
  fake.disconnect(); real.disconnect();
  serverModule.io && serverModule.io.close();
  server.close();
  mock.close();
  process.exit(0);
}
main().catch(e => { console.error('❌ HATA:', e); process.exit(1); });
