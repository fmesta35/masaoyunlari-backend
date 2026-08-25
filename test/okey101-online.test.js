'use strict';

/*
 * OKEY 101 ONLINE — sunucu yetkili uçtan uca testleri.
 *  A) Lobide okey101 hazır masaları (#331-#336) tohumlanır; klasik okey
 *     masaları (#301-#318) etkilenmez.
 *  B) 4 kişilik maç: istemciye variant='okey101' + target=101 gider;
 *     hazırlanmış 101 eli bitince skor = gained (rakiplerin kalan el
 *     puanı) ve 101 puan MAÇI BİTİRİR ('completed').
 *  C) 2 kişilik maç: düşük gained (< 101) maç DEVAM ETTİRİR (2. el),
 *     101 puana ulaşınca biter. 2. el de 101 varyantıyla kurulur.
 *  D) 101 altı el 'not_101' ile reddedilir; el devam eder.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '5000';
process.env.GV_OKEY_ROUND_PAUSE_MS = '400';

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
      res.on('end', () => { try { resolve(JSON.parse(body).rooms || []); } catch (e) { reject(e); } });
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
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 9000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

// 14 taş toplam 182 (14×13) + 1 fazlalık = 15 taşlık garantili 101 eli.
function craft101Hand(prefix) {
  const hand = [];
  for (let i = 0; i < 14; i++) hand.push({ id: (prefix || 'big') + i, n: 13, c: 't-red', isFJ: false, isOkey: false });
  const extra = { id: (prefix || 'big') + '-extra', n: 1, c: 't-black', isFJ: false, isOkey: false };
  hand.push(extra);
  return { hand, extraId: extra.id };
}

// 14 taş, toplamı tam `total` (testlerde gained'i deterministik kılar).
function knownHand(prefix, seat, total) {
  const out = [];
  let left = total;
  for (let i = 0; i < 13; i++) {
    const v = Math.max(1, Math.min(13, left - (13 - i)));
    out.push({ id: prefix + '-' + seat + '-' + i, n: v, c: 't-blue', isFJ: false, isOkey: false });
    left -= v;
  }
  out.push({ id: prefix + '-' + seat + '-13', n: left, c: 't-blue', isFJ: false, isOkey: false });
  return out;
}

function join101(socket, roomId, nPlayers) {
  socket.emit('joinRoom', {
    roomId,
    gameId: 'okey101',
    userName: socket.userName,
    userKey: 'test:' + socket.userName,
    maxPlayers: nPlayers,
    durationMinutes: 10
  });
  return once(socket, 'joinedRoom');
}

async function setup101Match(BASE, roomId, tag, nPlayers) {
  const socks = [];
  for (let i = 0; i < nPlayers; i++) socks.push(await connect(BASE, tag + '-' + i));
  const started = socks.map(s => once(s, 'gameStarted'));
  for (const s of socks) await join101(s, roomId, nPlayers);
  for (const s of socks) s.emit('setReady', { ready: true });
  const payloads = await Promise.all(started);
  const bySeat = {};
  payloads.forEach((p, i) => { bySeat[p.seat] = { socket: socks[i], state: p.gameState }; });
  return { socks, bySeat, first: payloads[0].gameState };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;

  // ============ A) Lobi: okey101 hazır masaları ============
  {
    const l101 = await httpRooms(BASE, 'okey101');
    assert.ok(l101.length >= 6, 'okey101 hazır masalar lobide (>=6)');
    assert.ok(l101.some(r => String(r.id) === '331' && r.maxPlayers === 2), '2 kişilik masa #331');
    assert.ok(l101.some(r => String(r.id) === '336' && r.maxPlayers === 4 && r.duration === 20), '4 kişilik 20 dk masa #336');
    // 101 masasında EL ROZETİ YOK (maç el sayısıyla bitmez):
    assert.ok(l101.every(r => !r.rounds), 'okey101 lobisinde "El" rozeti yok');
    const lokey = await httpRooms(BASE, 'okey');
    assert.strictEqual(lokey.length, 18, 'klasik okey 18 hazır masası etkilenmedi');
    console.log('  ✓ A) lobi: okey101 6 hazır masa (#331-#336), klasik okey 18 masa aynen');
  }

  // ============ B) 4 kişilik: variant + 101 bitiş → MAÇ biter ============
  {
    const { socks, bySeat, first } = await setup101Match(BASE, '911', 'B', 4);
    const room = rooms.get('911');
    assert.ok(room, 'oda bulunmalı');
    assert.strictEqual(first.variant, 'okey101', 'istemciye variant=okey101 gider');
    assert.strictEqual(first.target, 101, 'istemciye target=101 gider');
    assert.strictEqual(first.maxRounds, 99, 'güvenlik el limiti 99 (UI değil kural)');
    assert.strictEqual(room.okey.variant, 'okey101', 'oda varyantı okey101');

    const starterSeat = first.turn;
    const w = craft101Hand('b');
    room.okey.roundState.hands[starterSeat] = w.hand;
    const others = first.seats.filter(x => x !== starterSeat);
    let expectedGained = 0;
    others.forEach((s, i) => {
      const total = 40 + i * 10; // 40/50/60 → toplam 150
      room.okey.roundState.hands[s] = knownHand('b', s, total);
      expectedGained += total;
    });

    const re = once(bySeat[starterSeat].socket, 'okeyRoundEnded');
    const ge = once(bySeat[starterSeat].socket, 'gameEnded');
    bySeat[starterSeat].socket.emit('okeyFinish', { tileId: w.extraId });
    const reP = await re;
    assert.strictEqual(reP.gameState.finished, true, 'el bitti');
    assert.deepStrictEqual(reP.gameState.result, { winner: starterSeat, winType: '101', gained: expectedGained });
    assert.strictEqual(reP.gameState.scores[starterSeat], expectedGained, 'skor = gained (PUAN)');
    assert.strictEqual(reP.gameState.scores[others[0]] || 0, 0, 'rakip skor yazılmaz');

    const geP = await ge;
    assert.strictEqual(geP.reason, 'completed', '101 puana ulaşınca maç BİTER');
    assert.strictEqual(geP.winnerSeat, starterSeat, 'en yüksek skoru yapan kazanır');
    assert.strictEqual(geP.youWon, geP.seat === starterSeat, 'youWon kişiye özel');
    console.log('  ✓ B) 4 kişilik: variant/target + 101 bitiş (gained=' + expectedGained + ') → maç completed');
    for (const s of socks) s.disconnect();
    await sleep(300);
  }

  // ============ C) 2 kişilik: düşük gained → devam; 101 → bitiş ============
  {
    const { socks, first } = await setup101Match(BASE, '912', 'C', 2);
    const room = rooms.get('912');
    const seatA = 0, seatB = 1;

    // El 1: A bitirir ama gained 56 < 101 → maç DEVAM eder.
    room.okey.roundState.turn = seatA;
    room.okey.roundState.phase = 'discard';
    const w1 = craft101Hand('c1');
    room.okey.roundState.hands[seatA] = w1.hand;
    room.okey.roundState.hands[seatB] = knownHand('c1', seatB, 56);
    const re = once(socks[0], 'okeyRoundEnded');
    const gs2 = once(socks[0], 'gameStateUpdated');
    socks[0].emit('okeyFinish', { tileId: w1.extraId });
    const reP = await re;
    assert.deepStrictEqual(reP.gameState.result, { winner: seatA, winType: '101', gained: 56 });
    assert.strictEqual(reP.gameState.scores[seatA], 56, '56 puan < 101');

    const g2 = await gs2;
    assert.strictEqual(g2.gameState.round, 2, '101 ulaşmayan maç 2. ele DEVAM eder');
    assert.strictEqual(g2.gameState.variant, 'okey101', '2. el de 101 varyantıyla kurulur');
    assert.strictEqual(g2.gameState.scores[seatA], 56, 'skorlar ele taşınır');

    // El 2: A tekrar bitirir; gained 182 → 56+182=238 >= 101 → maç biter.
    room.okey.roundState.turn = seatA;
    room.okey.roundState.phase = 'discard';
    const w2 = craft101Hand('c2');
    room.okey.roundState.hands[seatA] = w2.hand;
    room.okey.roundState.hands[seatB] = knownHand('c2', seatB, 182);
    const ge = once(socks[0], 'gameEnded');
    socks[0].emit('okeyFinish', { tileId: w2.extraId });
    const geP = await ge;
    assert.strictEqual(geP.reason, 'completed', '101 puana ulaşınca maç biter');
    assert.strictEqual(geP.winnerSeat, seatA);
    assert.ok(geP.gameState.scores[seatA] >= 101, 'kazananın toplam skoru >= 101');
    console.log('  ✓ C) 2 kişilik: 56 puan maç bitirmez (2. el 101 varyantı) → 238 puanda biter');
    for (const s of socks) s.disconnect();
    await sleep(300);
  }

  // ============ D) not_101 reddi ============
  {
    const { socks } = await setup101Match(BASE, '913', 'D', 2);
    const room = rooms.get('913');
    const seatA = 0;
    room.okey.roundState.turn = seatA;
    room.okey.roundState.phase = 'discard';
    const low = [];
    for (let i = 0; i < 14; i++) low.push({ id: 'low' + i, n: 4, c: 't-blue', isFJ: false, isOkey: false });
    low.push({ id: 'low-x', n: 4, c: 't-blue', isFJ: false, isOkey: false });
    room.okey.roundState.hands[seatA] = low; // toplam 60 → 14 taş asla 101 yapamaz

    const rej = once(socks[0], 'okeyRejected');
    socks[0].emit('okeyFinish', { tileId: 'low-x' });
    const rejP = await rej;
    assert.strictEqual(rejP.reason, 'not_101', '101 altı el reddedilir');
    assert.strictEqual(room.okey.roundState.finished, false, 'el devam eder');
    console.log('  ✓ D) not_101 reddi (toplam 60 < 101)');
    for (const s of socks) s.disconnect();
    await sleep(300);
  }

  server.close();
  console.log('✅ OKEY101-ONLINE: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY101 ONLINE HATASI:', err); process.exit(1); });
