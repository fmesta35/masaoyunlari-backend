'use strict';

/*
 * OKEY HAZIR MASALARI — altyapı regresyon testleri (18 masalık yapı).
 *
 *  Kullanıcı isteği: varsayılan okey lobisi
 *    (2 kişilik × 3/5/7 el) + (3 kişilik × 3/5/7 el) + (4 kişilik × 3/5/7 el),
 *    her kombinasyondan 2 masa → TOPLAM 18 masa (#301-#318).
 *  El sayısı arttıkça koltuk başına ana süre uzar: 3el=10dk, 5el=15dk, 7el=20dk.
 *
 *  Bu süit şunları kilitler:
 *   1) #301-#318 listelenir; kişi sayısı / el sayısı / süre eşleşmeleri doğrudur,
 *      masalar BOŞKEN 0/N ve 'waiting' olarak görünür, rounds alanı yayınlanır.
 *   2) 4 kişilik hazır masa (#313): 4 oyuncu koltuk alır, 5. kişi İZLEYİCİ olur.
 *   3) 4×HAZIR → oyun BAŞLAR; kişiye özel dağıtım (15+14+14+14=57, deste 48);
 *      el sayısı masanın tanımından gelir (#313 → 3 el).
 */

const assert = require('assert');
const http = require('http');

const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpRooms(url, gameId) {
  return new Promise((resolve, reject) => {
    http.get(url + '/api/rooms?gameId=' + gameId, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).rooms || []); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

function connect(url, name) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + name)), 8000);
    socket.on('connect', () => { clearTimeout(t); socket.userName = name; resolve(socket); });
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 8000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

function join(socket, roomId) {
  socket.emit('joinRoom', {
    roomId,
    gameId: 'okey',
    userName: socket.userName,
    userKey: 'test:' + socket.userName,
    maxPlayers: 4,
    durationMinutes: 10
  });
  return once(socket, 'joinedRoom');
}

// Beklenen 18 masalık düzen: [id, kişi, el, süre]
function expectedTables() {
  const DUR = { 3: 10, 5: 15, 7: 20 };
  const out = [];
  let id = 301;
  for (const players of [2, 3, 4]) {
    for (const rounds of [3, 5, 7]) {
      for (let k = 0; k < 2; k++) out.push([String(id++), players, rounds, DUR[rounds]]);
    }
  }
  return out;
}

async function main() {
  const server = await serverModule.start(0);
  const port = server.address().port;
  const BASE = `http://localhost:${port}`;

  // --- 1) 18 hazır masa: sayım, kişi/el/süre eşleşmesi, boşken listeleme ---
  const listed = await httpRooms(BASE, 'okey');
  const byId = Object.fromEntries(listed.map(r => [String(r.id), r]));
  const exp = expectedTables();
  assert.strictEqual(exp.length, 18, 'beklenen düzen 18 masa');
  const presetIds = exp.map(e => e[0]);
  assert.deepStrictEqual(presetIds[0], '301');
  assert.deepStrictEqual(presetIds[17], '318');
  for (const [id, players, rounds, dur] of exp) {
    const r = byId[id];
    assert.ok(r, `#${id} listelenmeli`);
    assert.strictEqual(r.maxPlayers, players, `#${id} ${players} kişilik olmalı`);
    assert.strictEqual(r.rounds, rounds, `#${id} ${rounds} elli olmalı (lobi rozeti)`);
    const d = r.durationMinutes || r.duration;
    assert.strictEqual(d, dur, `#${id} süre ${dur} dk (${rounds} el ölçeği)`);
    assert.strictEqual(r.players, 0, `#${id} boşken 0/${players} listelenmeli`);
    assert.strictEqual(r.status, 'waiting', `#${id} waiting`);
    assert.ok(new RegExp(`${players} Kişilik`).test(r.name) && new RegExp(`${rounds} El`).test(r.name),
      `#${id} adı kişi/el bilgisini taşımalı: ${r.name}`);
  }
  assert.strictEqual(Object.keys(byId).filter(id => {
    const n = Number(id); return n >= 301 && n <= 318;
  }).length, 18, 'aralıkta TAM 18 hazır masa');
  console.log('  ✓ 1) 18 hazır masa: 2/3/4 kişilik × 3/5/7 el × 2 — süre/el/ad doğru, boşken 0/N');

  // --- 2) 4 kişilik hazır masa (#313): 4 oyuncu, 5. kişi izleyici ---
  const s1 = await connect(BASE, 'Okey-A');
  const s2 = await connect(BASE, 'Okey-B');
  const s3 = await connect(BASE, 'Okey-C');
  const s4 = await connect(BASE, 'Okey-D');
  const s5 = await connect(BASE, 'Okey-Izleyici');

  const j1 = await join(s1, '313');
  assert.strictEqual(j1.role, 'player');
  await join(s2, '313');
  await join(s3, '313');
  const j4 = await join(s4, '313');
  assert.strictEqual(j4.role, 'player', '4. oyuncu da koltuk almalı');
  const j5 = await join(s5, '313');
  assert.strictEqual(j5.role, 'spectator', '5. kişi izleyici olmalı (4/4 dolu masa)');

  const roomNow = await httpRooms(BASE, 'okey').then(rs => rs.find(r => String(r.id) === '313'));
  assert.strictEqual(roomNow.players, 4, 'lobi 4/4 göstermeli');
  assert.strictEqual(roomNow.spectatorCount, 1, 'lobi 1 izleyici göstermeli');
  console.log('  ✓ 2) #313: 4 gerçek oyuncu koltuk aldı, 5. kişi izleyicide (lobi 4/4 + 1👁️)');

  // --- 3) 4×HAZIR → oyun başlar; el sayısı masa tanımından (3 el) ---
  const started = [s1, s2, s3, s4].map(s => once(s, 'gameStarted'));
  const specStarted = once(s5, 'gameStarted');
  s1.emit('setReady', { ready: true });
  s2.emit('setReady', { ready: true });
  s3.emit('setReady', { ready: true });
  s4.emit('setReady', { ready: true });
  const payloads = await Promise.all(started);
  const specPayload = await specStarted;

  const afterReady = await httpRooms(BASE, 'okey').then(rs => rs.find(r => String(r.id) === '313'));
  assert.strictEqual(afterReady.status, 'playing', '4/4 hazır olunca okey başlamalı (playing)');

  let starterSeen = 0;
  for (const p of payloads) {
    const gs = p.gameState;
    assert.strictEqual(gs.kind, 'okey');
    assert.strictEqual(gs.status, 'playing');
    assert.strictEqual(typeof gs.mySeat, 'number');
    assert.ok(Array.isArray(gs.myHand));
    assert.ok(gs.myHand.length === 14 || gs.myHand.length === 15);
    if (gs.myHand.length === 15) starterSeen++;
    if (gs.mySeat === gs.turn) assert.strictEqual(gs.myHand.length, 15, 'başlayan 15 taş alır');
    assert.deepStrictEqual(Object.keys(gs.handCounts).sort(), ['0', '1', '2', '3'],
      'dört koltuğun taş sayısı görünmeli');
    const total = Object.values(gs.handCounts).reduce((a, b) => a + b, 0);
    assert.strictEqual(total, 57, 'toplam 57 taş (15+14+14+14)');
    assert.strictEqual(gs.deckCount, 48, 'deste 48 (106-1 gösterge-57)');
    assert.ok(gs.indicator && gs.realOkey);
    assert.strictEqual(gs.phase, 'discard');
    assert.strictEqual(gs.round, 1);
    assert.strictEqual(gs.maxRounds, 3, '#313 hazır masası 3 elli (masa tanımından)');
  }
  assert.strictEqual(starterSeen, 1, 'tek başlayan (15 taşlı)');

  assert.strictEqual(specPayload.isSpectator, true);
  assert.strictEqual(specPayload.gameState.mySeat, null);
  assert.strictEqual(specPayload.gameState.myHand, null);
  assert.strictEqual(specPayload.gameState.deckCount, 48);
  console.log('  ✓ 3) 4/4 HAZIR → başladı; kişiye özel dağıtım + 3 el (masa tanımından) + gizli eller');

  for (const s of [s1, s2, s3, s4, s5]) s.disconnect();
  await sleep(400);
  server.close();
  console.log('OK okey hazır masaları regressions (18 masa)');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY PRESET HATASI:', err); process.exit(1); });
