'use strict';

/*
 * Regresyon testleri — hamle süresi + kalıcı hazır masalar:
 *  1) Sunucu açılışında #101-#110 hazır masalar oluşur ve BOŞKEN de
 *     listelenir ("Henüz açık masa yok" hatasının düzeltmesi:
 *     listPublicRooms boş masaları eliyordu).
 *  2) Kalıcı masanın kendi süresi korunur (istemci 10 dk gönderse bile
 *     5 dk'lık masa 5 dk kalır).
 *  3) Hamle süresi GERÇEKTEN çalışır: önce uyarı düşer, hamle gelmezse
 *     'move_timeout' ile hükmen mağlubiyet ve kişiye özel youWon gider.
 *     (Eski hata: updateClock her çağrıda moveStartedAt'i sıfırlıyordu;
 *      bu test o kodla hiç uyarı alamaz ve zaman aşımından düşerdi.)
 *  4) Hamle sayacı gerçek hamlede sıfırlanır: hamle sonrası uyarı bu kez
 *     karşı taraf için YENİDEN gelir.
 *  5) Kalıcı masa oyun bitip boşalınca SİLİNMEZ; beklemeye alınır.
 */

// ÖNEMLİ: server'dan ÖNCE ayarlanmalı (sabitler modül yüklenirken okunur).
process.env.GV_MOVE_WARN_MS = '1200';
process.env.GV_MOVE_FORFEIT_MS = '2500';

const assert = require('assert');
const http = require('http');

function loadClient() {
  try { return require('socket.io-client'); } catch (_) {}
  throw new Error('socket.io-client bulunamadı. npm install çalıştırın.');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

function connect(io, url, userKey, userName) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + userName)), 8000);
    socket.on('connect', () => {
      clearTimeout(t);
      socket.userKey = userKey;
      socket.userName = userName;
      resolve(socket);
    });
    socket.on('connect_error', err => { clearTimeout(t); reject(err); });
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + event)), timeoutMs || 6000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

function joinAs(socket, roomId, extra) {
  const payload = Object.assign({
    roomId,
    gameId: 'chess',
    userName: socket.userName,
    userKey: socket.userKey,
    maxPlayers: 2,
    durationMinutes: 10, // kalıcı masada bunun YOK SAYILMASI gerekir
    roomName: 'Hamle Süresi Testi'
  }, extra || {});
  const p = once(socket, 'joinedRoom');
  socket.emit('joinRoom', payload);
  return p;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const { start, server } = require('../server');
  const { io } = loadClient();
  await start(0);
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port;
  const ROOM = '105'; // 5 dk'lık kalıcı masa

  // --- 1) hazır masalar boşken de listelenir ---
  let api = await httpGet(url + '/api/rooms?gameId=chess');
  const presetIds = api.rooms
    .map(r => String(r.id))
    .filter(id => /^10[1-9]$/.test(id) || id === '110')
    .sort();
  assert.deepStrictEqual(
    presetIds,
    ['101', '102', '103', '104', '105', '106', '107', '108', '109', '110'],
    '#101-#110 kalıcı masalar listelenmeli'
  );
  const emptyRoom = api.rooms.find(r => String(r.id) === ROOM);
  assert.strictEqual(emptyRoom.players, 0, 'boş masa oyuncusuz listelenmeli (eski filtre eliyordu)');
  assert.strictEqual(emptyRoom.status, 'waiting');

  // Satranç oda tipleri (YALNIZCA satranç): 4x Hızlı (10 dk), 3x Normal (15 dk), 3x Düşünen (20 dk)
  const dist = { 10: 0, 15: 0, 20: 0 };
  api.rooms.forEach(r => {
    const id = String(r.id);
    if (/^10[1-9]$/.test(id) || id === '110') dist[Number(r.duration)] = (dist[Number(r.duration)] || 0) + 1;
  });
  assert.deepStrictEqual(dist, { 10: 4, 15: 3, 20: 3 }, 'satranç masaları 4x10dk + 3x15dk + 3x20dk olmalı');
  assert.ok(/Hızlı/.test(api.rooms.find(r => String(r.id) === '101').name), 'masa adı tipi yansıtmalı');
  assert.ok(/Düşünen/.test(api.rooms.find(r => String(r.id) === '110').name), 'masa adı tipi yansıtmalı');
  console.log('  ✓ 1) #101-#110 hazır masalar boşken de listeleniyor');
  console.log('  ✓ 1b) satranç oda tipleri: 4x Hızlı(10) + 3x Normal(15) + 3x Düşünen(20)');

  // --- 2) masanın kendi süresi korunur (istemci 10 dk gönderir) ---
  const a = await connect(io, url, 'user:a', 'Ali');
  const b = await connect(io, url, 'user:b', 'Ayşe');
  await joinAs(a, ROOM);
  api = await httpGet(url + '/api/rooms?gameId=chess');
  const joined = api.rooms.find(r => String(r.id) === ROOM);
  assert.strictEqual(Number(joined.duration), 15, 'kalıcı masanın süresi korunmalı (#105 Normal 15 dk, 10 değil)');
  console.log('  ✓ 2) masanın kendi süresi korunuyor (istemci 10 gönderse de 15 kalıyor)');

  await joinAs(b, ROOM);
  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  const [startedA, startedB] = await Promise.all([once(a, 'gameStarted'), once(b, 'gameStarted')]);

  // İstemci rozesinin ihtiyaç duyduğu hamle sayacı verileri pakette olmalı
  assert.strictEqual(startedA.gameState.moveLimitMs, 2500, 'moveLimitMs pakette olmalı');
  assert.ok(typeof startedA.gameState.moveRemainingMs === 'number', 'moveRemainingMs pakette olmalı');

  const whiteSock = startedA.playerColor === 'white' ? a : b;
  const whiteIsA = whiteSock === a;

  // --- 3) hamle yapılmazsa önce UYARI gelir (eski hatada BU ASLA GELMEZDİ) ---
  const firstWarn = await once(a, 'moveTimeWarning', 8000);
  assert.strictEqual(firstWarn.color, 'white', 'ilk uyarı hamle sırası beyazdayken beyaz için gelmeli');
  assert.ok(firstWarn.remainingMs > 0 && firstWarn.remainingMs <= 1400,
    'uyarıda makul bir kalan süre olmalı, gelen: ' + firstWarn.remainingMs);
  console.log('  ✓ 3) hamle yapılmayınca uyarı düşüyor (updateClock artık sayacı sıfırlamıyor)');

  // --- 4) gerçek hamle sayacı sıfırlar: uyarı bu kez siyah için yeniden gelir ---
  const accepted = once(whiteSock, 'chessMoveAccepted', 6000);
  whiteSock.emit('chessMove', { roomId: ROOM, from: 'e2', to: 'e4' });
  await accepted;

  const endedA = once(a, 'gameEnded', 10000);
  const endedB = once(b, 'gameEnded', 10000);
  const secondWarn = await once(a, 'moveTimeWarning', 8000);
  assert.strictEqual(secondWarn.color, 'black', 'hamleden sonra uyarı siyaha dönmeli (sayaç sıfırlandı)');
  console.log('  ✓ 4) sayaç gerçek hamlede sıfırlanıyor (ikinci uyarı karşı taraf için)');

  // --- 3 devamı) siyah da oynamazsa hükmen mağlubiyet: 'move_timeout' ---
  const [endA, endB] = await Promise.all([endedA, endedB]);
  assert.strictEqual(endA.reason, 'move_timeout', 'sebep move_timeout olmalı (terk/ana süre ile karışmamalı)');
  assert.strictEqual(endA.winner, 'white', 'hamle yapmayan siyah kaybeder, beyaz kazanır');
  assert.strictEqual(endA.youWon, whiteIsA, 'A için youWon rengine göre doğru olmalı');
  assert.strictEqual(endB.youWon, !whiteIsA, 'B için youWon rengine göre doğru olmalı');
  console.log('  ✓ 3) move_timeout + kişiye özel youWon doğru gidiyor');

  // --- 5) kalıcı masa boşalınca silinmez, beklemeye alınır ---
  a.emit('leaveRoom');
  b.emit('leaveRoom');
  await sleep(300);
  api = await httpGet(url + '/api/rooms?gameId=chess');
  const after = api.rooms.find(r => String(r.id) === ROOM);
  assert.ok(after, 'kalıcı masa boşalınca SİLİNMEMELİ');
  assert.strictEqual(after.players, 0);
  assert.strictEqual(after.status, 'waiting', 'masa beklemeye alınmalı');
  assert.strictEqual(Number(after.duration), 15, 'masanın süresi yine korunmalı');
  console.log('  ✓ 5) kalıcı masa boşalınca silinmiyor, beklemeye alınıyor');

  a.disconnect();
  b.disconnect();
  await sleep(50);
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  console.log('OK move-timer + preset tablolar regressions');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
