'use strict';

/*
 * Regresyon testleri — dört bildirilen hata:
 *  1) Lobi 1/2 takılması  -> GET /api/rooms + roomsUpdated 2/2 ve 'playing' göstermeli
 *  2) İzleyici oyuncu oluyordu -> aynı userKey ile asSpectator koltuk ÇALMAMALI
 *  3) Terk mesajı ters -> kalan oyuncuya youWon:true gitmeli
 *  4) İzleyici hamle yapamamalı (sunucu reddeder)
 */

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
    durationMinutes: 10,
    roomName: 'Regresyon Masası'
  }, extra || {});
  const p = once(socket, 'joinedRoom');
  socket.emit('joinRoom', payload);
  return p;
}

async function main() {
  process.env.PORT = '0';
  const { start, rooms, server } = require('../server');
  const { io } = loadClient();
  await start(0);
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port;
  const ROOM = 'regression-1';

  const a = await connect(io, url, 'user:a', 'Ali');
  const b = await connect(io, url, 'user:b', 'Ayşe');

  await joinAs(a, ROOM);
  await joinAs(b, ROOM);

  // --- HATA 1: lobi 2/2 göstermeli (sahte 1/2 değil) ---
  let api = await httpGet(url + '/api/rooms?gameId=chess');
  let listed = api.rooms.find(r => r.id === ROOM);
  assert.ok(listed, 'oda listelenmeli');
  assert.strictEqual(listed.players, 2, 'lobi 2 oyuncuyu göstermeli (1/2 takılmamalı)');
  assert.strictEqual(listed.maxPlayers, 2);
  console.log('  ✓ 1) lobi 2/2 gösteriyor');

  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  await once(a, 'gameStarted');
  await once(b, 'gameStarted');

  api = await httpGet(url + '/api/rooms?gameId=chess');
  listed = api.rooms.find(r => r.id === ROOM);
  assert.strictEqual(listed.status, 'playing', 'oynanan masa "playing" olmalı (İzle butonu için)');
  console.log('  ✓ 1) oynanan masa "playing" olarak yayınlanıyor');

  // --- HATA 2: aynı userKey ile "İzle" koltuk ÇALMAMALI ---
  // Ali'nin userKey'i ile ikinci bir sekme izleyici olarak giriyor.
  const aWatch = await connect(io, url, 'user:a', 'Ali (2. sekme)');
  const joinedWatch = await joinAs(aWatch, ROOM, { asSpectator: true });
  assert.strictEqual(joinedWatch.role, 'spectator', 'aynı userKey ile İzle -> izleyici olmalı');
  assert.strictEqual(joinedWatch.isSpectator, true);
  assert.strictEqual(joinedWatch.playerColor, null, 'izleyiciye renk verilmemeli ("Siyah (Siz)" olmamalı)');

  const roomNow = rooms.get(ROOM);
  assert.strictEqual(roomNow.players.length, 2, 'koltuk sayısı değişmemeli');
  // Ali'nin koltuğu HÂLÂ ilk soketine ait olmalı (reconnect ile çalınmamalı)
  const aliSeat = roomNow.players.find(p => p.userKey === 'user:a');
  assert.ok(aliSeat, 'Ali koltuğunda kalmalı');
  assert.strictEqual(aliSeat.id, a.id, 'izleyici sekmesi Ali\'nin koltuğunu çalmamalı');
  console.log('  ✓ 2) asSpectator koltuk çalmıyor');

  // --- HATA 4: izleyici hamle yapamaz ---
  const rejected = once(aWatch, 'chessMoveRejected');
  aWatch.emit('chessMove', { roomId: ROOM, from: 'e2', to: 'e4', userKey: 'user:a' });
  const rej = await rejected;
  assert.strictEqual(rej.reason, 'not_in_room', 'izleyicinin hamlesi reddedilmeli');
  console.log('  ✓ 4) izleyici hamlesi sunucuda reddediliyor');

  // --- HATA 3: terkte KALAN oyuncu kazanır (youWon: true) ---
  const bEnded = once(b, 'gameEnded');
  const bLeft = once(b, 'playerLeft');
  a.emit('leaveRoom'); // Ali (oyuncu) "Ayrıl" diyor
  const ended = await bEnded;
  assert.strictEqual(ended.reason, 'player_left');
  assert.strictEqual(ended.youWon, true, 'KALAN oyuncu youWon:true almalı (ters mesaj olmamalı)');
  const left = await bLeft;
  assert.strictEqual(left.youWon, true, 'playerLeft de kalanı kazanan bildirmeli');
  console.log('  ✓ 3) terkte kalan oyuncuya youWon:true gidiyor');

  // Oda hemen sıfırlanmamalı; sonuç bir süre korunmalı
  const afterLeave = rooms.get(ROOM);
  assert.strictEqual(afterLeave.status, 'finished', 'oda terkten hemen sonra "finished" kalmalı');
  assert.strictEqual(afterLeave.result.reason, 'player_left');
  console.log('  ✓ 3) oda hemen sıfırlanmıyor (renk değişmiyor)');

  a.disconnect();
  b.disconnect();
  aWatch.disconnect();
  await new Promise(resolve => setTimeout(resolve, 50));
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  console.log('OK spectator + forfeit regressions');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
