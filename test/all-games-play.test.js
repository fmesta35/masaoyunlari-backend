'use strict';

/*
 * TÜM OYUN GRUPLARI — "iki gerçek oyuncu birbirine bağlanıp GERÇEKTEN oynuyor mu?"
 *
 *  Var olan testler masanın AÇILDIĞINI ve yetkisiz hamlenin reddedildiğini
 *  kanıtlıyordu. Bu test bir adım öteye gider: her oyunda sırası gelen oyuncu
 *  GEÇERLİ bir hamle yapar ve hamlenin
 *    (a) sunucuda kabul edildiği,
 *    (b) HER İKİ istemciye de yayıldığı,
 *    (c) sıranın rakibe geçtiği
 *  doğrulanır. Böylece "oyun açılıyor ama oynanmıyor" sınıfı hatalar yakalanır.
 */

const assert = require('assert');
const io = require('socket.io-client');
const srv = require('../server');
const { start, server, applyPresetConfig, seedPresetTables, defaultPresetConfig } = srv;

const sleep = ms => new Promise(r => setTimeout(r, ms));
let URL = '';
let n = 0;

function connect(name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((ok, no) => {
    s.once('connect', () => { s.uname = name; ok(s); });
    s.once('connect_error', no);
  });
}
function once(s, ev, ms = 8000) {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('zaman aşımı: ' + ev + ' (' + s.uname + ')')), ms);
    s.once(ev, x => { clearTimeout(t); ok(x); });
  });
}
async function table(gameId, seats) {
  const id = 'play-' + gameId + '-' + (++n);
  const cl = [];
  for (let i = 0; i < seats; i++) {
    const s = await connect(gameId + i);
    const j = once(s, 'joinedRoom');
    s.emit('joinRoom', {
      roomId: id, gameId, maxPlayers: seats, durationMinutes: 10, rounds: 3,
      userName: s.uname, userKey: 'test:' + s.uname + ':' + id
    });
    await j;
    cl.push(s);
  }
  const starts = cl.map(s => once(s, 'gameStarted', 12000));
  cl.forEach(s => s.emit('setReady', { ready: true }));
  const payloads = await Promise.all(starts);
  return { id, cl, payloads };
}
function close(cl) { cl.forEach(s => { try { s.disconnect(); } catch (_) {} }); }

/* Sırası gelen istemciyi bul (tahta oyunları renk, kart/okey koltuk kullanır) */
function byColor(cl, payloads) {
  const i = payloads.findIndex(p => p.gameState.turn === p.gameState.playerColor);
  assert.ok(i >= 0, 'sırası gelen oyuncu bulunamadı');
  return i;
}

const results = [];

async function boardGame(gameId, moveEvent, pickMove) {
  const { id, cl, payloads } = await table(gameId, 2);
  assert.strictEqual(payloads[0].gameState.kind, gameId, gameId + ': masa açılmalı');
  const mi = byColor(cl, payloads);
  const other = mi === 0 ? 1 : 0;
  const turnBefore = payloads[mi].gameState.turn;

  const ups = cl.map(s => once(s, 'gameStateUpdated', 8000));
  cl[mi].emit(moveEvent, Object.assign({ roomId: id }, pickMove(payloads[mi].gameState)));
  const after = await Promise.all(ups);

  assert.ok(after[0].gameState && after[1].gameState, gameId + ': her iki istemci de durum almalı');
  assert.notStrictEqual(after[mi].gameState.turn, turnBefore, gameId + ': sıra rakibe geçmeli');
  assert.strictEqual(after[0].gameState.turn, after[1].gameState.turn, gameId + ': iki istemcide sıra aynı olmalı');
  close(cl);
  await sleep(40);
  results.push(gameId);
}

async function main() {
  await start(0);
  URL = 'http://127.0.0.1:' + server.address().port;
  const cfg = defaultPresetConfig();
  applyPresetConfig({ ...cfg, pisti: { visible: true, online: true }, batak: { visible: true, online: true } });
  seedPresetTables();

  // --- 1) SATRANÇ ---
  {
    const { id, cl, payloads } = await table('chess', 2);
    const wi = payloads.findIndex(p => p.playerColor === 'white');
    assert.ok(wi >= 0, 'satranç: beyaz koltuk');
    const ups = cl.map(s => once(s, 'gameStateUpdated', 8000));
    cl[wi].emit('chessMove', { roomId: id, from: 'e2', to: 'e4' });
    const after = await Promise.all(ups);
    assert.ok(after[0].gameState.fen.includes(' b '), 'satranç: sıra siyaha geçmeli');
    assert.strictEqual(after[0].gameState.fen, after[1].gameState.fen, 'satranç: iki istemcide aynı konum');
    close(cl); await sleep(40);
    results.push('chess');
    console.log('  ✓ satranç: e2-e4 iki pencerede de işlendi');
  }

  // --- 2) İNGİLİZ DAMASI / TÜRK DAMASI ---
  for (const g of ['dama', 'turkdamasi']) {
    await boardGame(g, 'damaMove', gs => {
      const m = gs.legalMoves[0];
      assert.ok(m, g + ': yasal hamle listesi dolu olmalı');
      return { from: m.from, to: m.to };
    });
    console.log('  ✓ ' + g + ': yasal hamle oynandı, sıra rakibe geçti');
  }

  // --- 3) REVERSİ ---
  await boardGame('reversi', 'reversiMove', gs => {
    const m = gs.legalMoves[0];
    assert.ok(m, 'reversi: yasal hamle olmalı');
    return { r: m.to[0], c: m.to[1] };
  });
  console.log('  ✓ reversi: yasal hamle oynandı, sıra rakibe geçti');

  // --- 4) GOMOKU ---
  await boardGame('gomoku', 'gomokuMove', () => ({ r: 7, c: 7 }));
  console.log('  ✓ gomoku: taş kondu, sıra rakibe geçti');

  // --- 5) CONNECT4 ---
  await boardGame('connect4', 'connect4Move', () => ({ col: 3 }));
  console.log('  ✓ connect4: pul atıldı, sıra rakibe geçti');

  // --- 6) BİLARDO (vuruş sonrası simülasyon durumu her iki istemciye gider) ---
  {
    const { id, cl, payloads } = await table('bilardo', 2);
    const mi = payloads.findIndex(p => p.gameState.turn === p.seat);   // bilardoda sıra KOLTUK numarasıdır
    assert.ok(mi >= 0, 'bilardo: sırası gelen koltuk');
    const ups = cl.map(s => once(s, 'gameStateUpdated', 10000));
    cl[mi].emit('bilardoShoot', { roomId: id, angle: 0.15, power: 7 });
    const after = await Promise.all(ups);
    assert.ok(after[0].gameState.shots >= 1, 'bilardo: vuruş sayacı artmalı');
    assert.strictEqual(after[0].gameState.shots, after[1].gameState.shots, 'bilardo: iki istemcide aynı');
    close(cl); await sleep(40);
    results.push('bilardo');
    console.log('  ✓ bilardo: vuruş yapıldı, sonuç iki pencereye yayıldı');
  }

  // --- 7) PİŞTİ (kart) ---
  {
    const { id, cl, payloads } = await table('pisti', 2);
    assert.strictEqual(payloads[0].gameState.kind, 'pisti');
    const mi = payloads.findIndex(p => p.gameState.turn === p.seat);
    assert.ok(mi >= 0, 'pişti: sırası gelen koltuk');
    const handBefore = payloads[mi].gameState.hand.length;
    const ups = cl.map(s => once(s, 'gameStateUpdated', 8000));
    cl[mi].emit('pistiPlay', { roomId: id, index: 0 });
    const after = await Promise.all(ups);
    assert.strictEqual(after[mi].gameState.hand.length, handBefore - 1, 'pişti: kart elden çıkmalı');
    assert.strictEqual(after[0].gameState.turn, after[1].gameState.turn, 'pişti: sıra iki istemcide aynı');
    close(cl); await sleep(40);
    results.push('pisti');
    console.log('  ✓ pişti: kart oynandı, orta ve sıra iki pencerede güncellendi');
  }

  // --- 8) BATAK (4 kişi, ihale) ---
  {
    const { id, cl, payloads } = await table('batak', 4);
    assert.strictEqual(payloads[0].gameState.phase, 'bid', 'batak: ihale aşaması');
    const mi = payloads.findIndex(p => p.gameState.turn === p.seat);
    assert.ok(mi >= 0, 'batak: ihale sırası');
    const ups = cl.map(s => once(s, 'gameStateUpdated', 8000));
    cl[mi].emit('batakBid', { roomId: id, value: 5 });
    const after = await Promise.all(ups);
    const seatOfMi = payloads[mi].seat;
    after.forEach((a, i) => assert.strictEqual(a.gameState.bids[seatOfMi], 5,
      'batak: ihale tüm masaya yansımalı (istemci ' + i + ')'));
    close(cl); await sleep(40);
    results.push('batak');
    console.log('  ✓ batak: ihale verildi, 4 pencerede de göründü');
  }

  // --- 9) OKEY + 101 OKEY (4 kişi, çek + at) ---
  for (const g of ['okey', 'okey101']) {
    const { id, cl, payloads } = await table(g, 4);
    const mi = payloads.findIndex(p => p.gameState.turn === p.seat);
    assert.ok(mi >= 0, g + ': başlayan koltuk');
    const before = payloads[mi].gameState.myHand.length;
    assert.strictEqual(before, 15, g + ': başlayan 15 taşla açar');
    const tile = payloads[mi].gameState.myHand[0];
    const ups = cl.map(s => once(s, 'gameStateUpdated', 8000));
    cl[mi].emit('okeyDiscard', { roomId: id, tileId: tile.id });
    const after = await Promise.all(ups);
    assert.strictEqual(after[mi].gameState.myHand.length, 14, g + ': atıştan sonra 14 taş');
    const seatOfMi = payloads[mi].seat;
    after.forEach((a, i) => assert.strictEqual((a.gameState.discardPiles[seatOfMi] || []).length, 1,
      g + ': atılan taş tüm masada görünmeli (istemci ' + i + ')'));
    assert.notStrictEqual(after[0].gameState.turn, seatOfMi, g + ': sıra sonraki oyuncuya geçmeli');
    close(cl); await sleep(40);
    results.push(g);
    console.log('  ✓ ' + g + ': taş atıldı, 4 pencerede de görüldü ve sıra ilerledi');
  }

  server.close();
  console.log('OK tüm oyun grupları online oynanıyor: ' + results.join(', ') + ' (' + results.length + ' oyun)');
  process.exit(0);
}

main().catch(e => { console.error('❌ OYUN GRUBU HATASI:', e); try { server.close(); } catch (_) {} process.exit(1); });
