'use strict';

/*
 * Tavla online uçtan uca regresyon testleri:
 *  1) Tavla lobisinde #201-#210 kalıcı masalar boşken de listelenir;
 *     satranç masaları (#101-#110) da hâlâ yerinde (birbirini bozmaz).
 *  2) Kalıcı tavla masasının süresi korunur (istemci 10 dk gönderse de 5 kalır).
 *  3) Zar atma / hamle yetkisi sunucudadır: sırası olmayan zar atamaz,
 *     yasal olmayan hamle reddedilir, yasal hamle durumu değiştirir.
 *  4) Geri alma çalışır.
 *  5) Hamle süresi (accelerated) uyarı + 'move_timeout' hükmen mağlubiyet
 *     verir ve doğru kazanana youWon gönderir.
 *  6) Kalıcı tavla masası boşalınca silinmez, beklemeye alınır.
 */

// server'dan ÖNCE: hızlandırılmış hamle süresi + deterministik zar.
process.env.GV_MOVE_WARN_MS = '1200';
process.env.GV_MOVE_FORFEIT_MS = '2500';
process.env.GV_TAVLA_FORCE_DICE = '3,1';

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

function waitFor(socket, event, pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, onEv);
      reject(new Error('timeout waiting for ' + event + ' (predicate)'));
    }, timeoutMs || 8000);
    function onEv(payload) {
      let ok = false;
      try { ok = pred(payload); } catch (_) {}
      if (ok) {
        clearTimeout(t);
        socket.off(event, onEv);
        resolve(payload);
      }
    }
    socket.on(event, onEv);
  });
}

function joinAs(socket, roomId, extra) {
  const payload = Object.assign({
    roomId,
    gameId: 'tavla',
    userName: socket.userName,
    userKey: socket.userKey,
    maxPlayers: 2,
    durationMinutes: 10, // kalıcı masada yok sayılmalı (masanın kendi süresi kalır)
    roomName: 'Tavla Testi'
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
  const ROOM = '205'; // 15 dk'lık (Normal) kalıcı tavla masası

  // --- 1) her iki lobide de 10'ar kalıcı masa ---
  let apiT = await httpGet(url + '/api/rooms?gameId=tavla');
  const presetT = apiT.rooms.map(r => String(r.id)).filter(id => /^20[1-9]$/.test(id) || id === '210').sort();
  assert.deepStrictEqual(presetT, ['201', '202', '203', '204', '205', '206', '207', '208', '209', '210'],
    'tavla lobisinde #201-#210 listelenmeli');
  assert.strictEqual(apiT.rooms.find(r => String(r.id) === ROOM).players, 0, 'boş masa listelenmeli');
  // Satrançtaki tip dağılımının aynısı tavlada da: 4x Hızlı(10) + 3x Normal(15) + 3x Düşünen(20)
  const distT = { 10: 0, 15: 0, 20: 0 };
  apiT.rooms.forEach(r => {
    const id = String(r.id);
    if ((/^20[1-9]$/.test(id) || id === '210')) distT[Number(r.duration)] = (distT[Number(r.duration)] || 0) + 1;
  });
  assert.deepStrictEqual(distT, { 10: 4, 15: 3, 20: 3 }, 'tavla masaları 4x10dk + 3x15dk + 3x20dk olmalı');
  assert.ok(/Hızlı/.test(apiT.rooms.find(r => String(r.id) === '201').name), 'tavla masa adı tipi yansıtmalı');

  let apiC = await httpGet(url + '/api/rooms?gameId=chess');
  const presetC = apiC.rooms.map(r => String(r.id)).filter(id => /^10[1-9]$/.test(id) || id === '110').sort();
  assert.strictEqual(presetC.length, 10, 'satranç masaları da hâlâ yerinde olmalı');
  console.log('  ✓ 1) tavla #201-#210 + satranç #101-#110 lobilerde boşken listeleniyor');

  // --- 2) masanın süresi korunur ---
  const a = await connect(io, url, 'user:ta', 'Ali');
  const b = await connect(io, url, 'user:tb', 'Ayşe');
  await joinAs(a, ROOM);
  apiT = await httpGet(url + '/api/rooms?gameId=tavla');
  assert.strictEqual(Number(apiT.rooms.find(r => String(r.id) === ROOM).duration), 15,
    'kalıcı masanın süresi korunmalı (#205 Normal 15 dk, 10 değil)');
  console.log('  ✓ 2) tavla masasının kendi süresi korunuyor');

  // --- 3) oyun başlar; zar ve hamle yetkisi sunucuda ---
  await joinAs(b, ROOM);
  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  const [startedA, startedB] = await Promise.all([once(a, 'gameStarted'), once(b, 'gameStarted')]);
  assert.strictEqual(startedA.gameState.kind, 'tavla', 'oyun türü tavla olmalı');
  assert.strictEqual(startedA.gameState.whiteTimeMs, 15 * 60 * 1000, 'ana süre masanınkinde olmalı');

  const whiteSock = startedA.playerColor === 'white' ? a : b;
  const blackSock = whiteSock === a ? b : a;

  // Sırası olmayan zar atamaz (beyaz başlar)
  const wrongRoll = once(blackSock, 'tavlaRejected', 5000);
  blackSock.emit('tavlaRoll', { roomId: ROOM });
  assert.strictEqual((await wrongRoll).reason, 'not_your_turn');

  // Beyaz zar atar -> sabit zar 3,1
  const rolled = waitFor(whiteSock, 'gameStateUpdated', p => p.gameState?.rolled === true, 5000);
  whiteSock.emit('tavlaRoll', { roomId: ROOM });
  const rolledState = (await rolled).gameState;
  assert.deepStrictEqual(rolledState.dice, [3, 1], 'zar sunucudan gelir');
  assert.deepStrictEqual(rolledState.movesLeft.slice().sort(), [1, 3]);

  // İkinci kez zar reddedilir
  const reRoll = once(whiteSock, 'tavlaRejected', 5000);
  whiteSock.emit('tavlaRoll', { roomId: ROOM });
  assert.strictEqual((await reRoll).reason, 'already_rolled');

  // Yasal olmayan hamle reddedilir (boş/rakip nokta)
  const badMove = once(whiteSock, 'tavlaRejected', 5000);
  whiteSock.emit('tavlaMove', { roomId: ROOM, from: 0, to: 1 });
  assert.strictEqual((await badMove).reason, 'illegal_move');

  // Yasal hamle durumu değiştirir (beyaz 7 -> 4, zar 3)
  const moved = waitFor(whiteSock, 'gameStateUpdated',
    p => p.gameState?.points?.[4]?.color === 'w' && p.gameState?.lastStep, 5000);
  whiteSock.emit('tavlaMove', { roomId: ROOM, from: 7, to: 4 });
  const afterMove = (await moved).gameState;
  assert.strictEqual(afterMove.points[4].count, 1);
  assert.deepStrictEqual(afterMove.movesLeft, [1], '3 zarı tüketildi, 1 kaldı');
  assert.strictEqual(afterMove.turn, 'w', 'tur bitmedi, hâlâ beyazda');

  // --- 4) geri alma ---
  const undone = waitFor(whiteSock, 'gameStateUpdated',
    p => p.gameState?.points?.[7]?.count === 3 && (p.gameState?.movesLeft || []).length === 2, 5000);
  whiteSock.emit('tavlaUndo', { roomId: ROOM });
  await undone;
  console.log('  ✓ 3-4) zar/hamle yetkisi sunucuda + geri alma çalışıyor');

  // kalan zarlarla hamle tamamlanırsa sıra siyaha geçer
  const blackTurn = waitFor(blackSock, 'gameStateUpdated', p => p.gameState?.turn === 'b', 5000);
  whiteSock.emit('tavlaMove', { roomId: ROOM, from: 7, to: 4 }); // 3
  whiteSock.emit('tavlaMove', { roomId: ROOM, from: 5, to: 4 }); // 1
  const bt = (await blackTurn).gameState;
  assert.strictEqual(bt.turn, 'b');
  assert.strictEqual(bt.rolled, false, 'yeni turda zar atanmamış olmalı');
  console.log('  ✓ 3) zarlar bitince sıra otomatik rakibe geçiyor');

  // izleyici zar atamaz
  const wSpec = await connect(io, url, 'user:spec', 'İzleyici');
  await joinAs(wSpec, ROOM, { asSpectator: true });
  const specReject = waitFor(wSpec, 'tavlaRejected', () => true, 5000).catch(() => null);
  wSpec.emit('tavlaRoll', { roomId: ROOM });
  const sr = await Promise.race([specReject, sleep(1500).then(() => null)]);
  assert.ok(sr === null || sr.reason === 'not_in_room', 'izleyici oynayamaz');
  wSpec.disconnect();

  // --- 5) hamle süresi: uyarı + hükmen mağlubiyet ---
  const c = await connect(io, url, 'user:tc', 'Can');
  const d = await connect(io, url, 'user:td', 'Derin');
  await joinAs(c, '204');
  await joinAs(d, '204');
  c.emit('setReady', { ready: true });
  d.emit('setReady', { ready: true });
  const [sc, sd] = await Promise.all([once(c, 'gameStarted'), once(d, 'gameStarted')]);
  const cWhite = sc.playerColor === 'white';

  const warn = await once(c, 'moveTimeWarning', 8000);
  assert.strictEqual(warn.color, 'white', 'ilk uyarı beyaz için (zar atılmadı)');
  const [endC, endD] = await Promise.all([once(c, 'gameEnded', 10000), once(d, 'gameEnded', 10000)]);
  assert.strictEqual(endC.reason, 'move_timeout');
  assert.strictEqual(endC.winner, 'black', 'zar atmayan beyaz hükmen kaybeder');
  assert.strictEqual(endC.youWon, !cWhite);
  assert.strictEqual(endD.youWon, cWhite);
  console.log('  ✓ 5) tavlada hamle süresi çalışıyor (uyarı + move_timeout + doğru youWon)');

  // --- 6) kalıcı masalar silinmez ---
  a.emit('leaveRoom'); b.emit('leaveRoom');
  c.emit('leaveRoom'); d.emit('leaveRoom');
  await sleep(400);
  apiT = await httpGet(url + '/api/rooms?gameId=tavla');
  const r205 = apiT.rooms.find(r => String(r.id) === '205');
  const r204 = apiT.rooms.find(r => String(r.id) === '204');
  assert.ok(r205 && r204, 'kalıcı masalar silinmemeli');
  assert.strictEqual(r204.status, 'waiting');
  assert.strictEqual(r204.players, 0);
  console.log('  ✓ 6) kalıcı tavla masaları boşalınca silinmiyor, beklemeye alınıyor');

  a.disconnect(); b.disconnect(); c.disconnect(); d.disconnect();
  await sleep(50);
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  console.log('OK tavla online regressions');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
