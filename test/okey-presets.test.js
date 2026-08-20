'use strict';

/*
 * OKEY HAZIR MASALARI — altyapı regresyon testleri.
 *
 *  Kullanıcı isteği: "Tavla'da olduğu gibi Okey için 10 masa aç:
 *  4× ⚡ Hızlı (10 dk), 3× ♟️ Normal (15 dk), 3× 🧠 Düşünen (20 dk)."
 *  Model: SADECE 4 GERÇEK OYUNCU (bot yok) — masa 4 koltukludur.
 *
 *  Bu süit şunları kilitler:
 *   1) #301-#310 masaları doğru süre tipleriyle ve BOŞKEN listelenir (0/4).
 *   2) Masalar maxPlayers=4'tür; 4 oyuncu koltuk alır, 5. kişi İZLEYİCİ olur.
 *   3) Motor (okey-engine.js) daha entegre edilmediği için 4 oyuncu da HAZIR
 *      bassa bile oda beklemeyi terk ETMEZ (takılı/yanlış başlamaz).
 *
 *  NOT: Preset tohumu GV_OKEY_PRESETS=1 ile zorlanır (motor dosyası eklenince
 *  bu bayrağa gerek kalmaz, otomatik açılır).
 */

process.env.GV_OKEY_PRESETS = '1';

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

async function main() {
  const server = await serverModule.start(0);
  const port = server.address().port;
  const BASE = `http://localhost:${port}`;

  // --- 1) 10 hazır masanın listelenmesi + süre tipleri ---
  const listed = await httpRooms(BASE, 'okey');
  const ids = listed.map(r => String(r.id));
  const expected = ['301', '302', '303', '304', '305', '306', '307', '308', '309', '310'];
  assert.deepStrictEqual(ids.filter(id => expected.includes(id)).sort(), expected.sort().slice(),
    '#301-#310 okey masaları listelenmeli');
  assert.strictEqual(listed.filter(r => r.maxPlayers === 4).length >= 10, true, 'okey masaları 4 kişilik');
  const byId = Object.fromEntries(listed.map(r => [String(r.id), r]));
  const dur = id => byId[id].durationMinutes || byId[id].duration;
  for (const id of ['301', '302', '303', '304']) assert.strictEqual(dur(id), 10, id + ' = 10 dk (⚡ Hızlı)');
  for (const id of ['305', '306', '307']) assert.strictEqual(dur(id), 15, id + ' = 15 dk (♟️ Normal)');
  for (const id of ['308', '309', '310']) assert.strictEqual(dur(id), 20, id + ' = 20 dk (🧠 Düşünen)');
  assert.ok(/Hızlı/.test(byId['301'].name) && /Normal/.test(byId['305'].name) && /Düşünen/.test(byId['308'].name),
    'masa adları tip etiketi taşımalı');
  assert.strictEqual(byId['301'].players, 0, 'masa boşken 0/4 listelenmeli');
  assert.strictEqual(byId['301'].status, 'waiting');
  console.log('  ✓ 1) #301-#310 masalar boşken 0/4 ve doğru süre tipleriyle listeleniyor');

  // --- 2) 4 oyuncu koltuk alır, 5. kişi izleyici olur ---
  const s1 = await connect(BASE, 'Okey-A');
  const s2 = await connect(BASE, 'Okey-B');
  const s3 = await connect(BASE, 'Okey-C');
  const s4 = await connect(BASE, 'Okey-D');
  const s5 = await connect(BASE, 'Okey-Izleyici');

  const j1 = await join(s1, '301');
  assert.strictEqual(j1.role, 'player');
  const j2 = await join(s2, '301');
  const j3 = await join(s3, '301');
  const j4 = await join(s4, '301');
  assert.strictEqual(j4.role, 'player', '4. oyuncu da koltuk almalı');
  const j5 = await join(s5, '301');
  assert.strictEqual(j5.role, 'spectator', '5. kişi izleyici olmalı (4/4 dolu masa)');

  const roomNow = await httpRooms(BASE, 'okey').then(rs => rs.find(r => String(r.id) === '301'));
  assert.strictEqual(roomNow.players, 4, 'lobi 4/4 göstermeli');
  assert.strictEqual(roomNow.spectatorCount, 1, 'lobi 1 izleyici göstermeli');
  console.log('  ✓ 2) 4 gerçek oyuncu koltuk aldı, 5. kişi izleyicide (lobi 4/4 + 1👁️)');

  // --- 3) Motor henüz yok: 4 HAZIR bile olsa oda beklemeyi terk etmez ---
  s1.emit('setReady', { ready: true });
  s2.emit('setReady', { ready: true });
  s3.emit('setReady', { ready: true });
  s4.emit('setReady', { ready: true });
  await sleep(600);
  const afterReady = await httpRooms(BASE, 'okey').then(rs => rs.find(r => String(r.id) === '301'));
  assert.strictEqual(afterReady.status, 'waiting',
    'motor yokken oda takılı/yanlış başlamamalı — beklemeli');
  const readyN = (afterReady.playerList || []).filter(p => p.isReady).length;
  assert.strictEqual(readyN, 4, 'hazır sayısı 4 görünmeli');
  console.log('  ✓ 3) 4/4 HAZIR — motor yokken oda güvenle bekliyor (takılma yok)');

  // Temizlik
  for (const s of [s1, s2, s3, s4, s5]) s.disconnect();
  await sleep(400);
  server.close();
  console.log('OK okey hazır masaları regressions');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY PRESET HATASI:', err); process.exit(1); });
