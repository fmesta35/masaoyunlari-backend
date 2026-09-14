'use strict';
const assert = require('assert');
const io = require('socket.io-client');
const srv = require('../server');

function conn(url, name) {
  const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((ok, no) => { s.once('connect', () => { s.name = name; ok(s); }); s.once('connect_error', no); });
}
const once = (s, e) => new Promise((ok, no) => {
  const t = setTimeout(() => no(Error('timeout ' + e)), 6000);
  s.once(e, x => { clearTimeout(t); ok(x); });
});
// Bazı olaylar (ör. gameStateUpdated) BİRDEN FAZLA ara adımda ardı ardına
// gelir (yerleştirme/atış sonrası hem "eski" bildirim hem "asıl" sonuç aynı
// pencerede sıraya girebilir — iki bağımsız soket arasında ağ gecikmesi
// garantisi yoktur). Basit .once() bu yüzden YANLIŞ (erken/eski) paketi
// yakalayabilir. Bunun yerine istenen koşulu sağlayan paket gelene kadar
// dinlemeye devam eden bir yardımcı kullanılır.
function waitFor(s, event, pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off(event, h); reject(new Error('timeout waiting for ' + event)); }, timeoutMs || 6000);
    function h(p) { if (!pred || pred(p)) { clearTimeout(t); s.off(event, h); resolve(p); } }
    s.on(event, h);
  });
}

// Sınır içi, çakışmasız, klasik 5 gemi — yatay dizilmiş, farklı satırlarda.
function fleetPlacements() {
  return [
    { shipId: 'carrier', r: 0, c: 0, dir: 'h' },
    { shipId: 'battleship', r: 1, c: 0, dir: 'h' },
    { shipId: 'cruiser', r: 2, c: 0, dir: 'h' },
    { shipId: 'submarine', r: 3, c: 0, dir: 'h' },
    { shipId: 'destroyer', r: 4, c: 0, dir: 'h' }
  ];
}

async function main() {
  await srv.start(0);
  const url = 'http://127.0.0.1:' + srv.server.address().port;
  const id = 'online-battleship';
  const a = await conn(url, 'A'), b = await conn(url, 'B');

  const ja = once(a, 'joinedRoom'), jb = once(b, 'joinedRoom');
  a.emit('joinRoom', { roomId: id, gameId: 'battleship', maxPlayers: 2, userName: a.name, userKey: 'test:' + a.name, durationMinutes: 10 });
  b.emit('joinRoom', { roomId: id, gameId: 'battleship', maxPlayers: 2, userName: b.name, userKey: 'test:' + b.name, durationMinutes: 10 });
  await Promise.all([ja, jb]);

  const ga = once(a, 'gameStarted'), gb = once(b, 'gameStarted');
  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  const [pa, pb] = await Promise.all([ga, gb]);
  assert.strictEqual(pa.gameState.kind, 'battleship');
  assert.strictEqual(pa.gameState.phase, 'placing');
  assert.strictEqual(pb.gameState.phase, 'placing');
  const seatA = pa.seat, seatB = pb.seat;
  assert.ok((seatA === 0 && seatB === 1) || (seatA === 1 && seatB === 0));

  // 1) Sınır dışı/çakışan yerleştirme reddedilir.
  {
    const rejA = once(a, 'battleshipRejected');
    const bad = fleetPlacements(); bad[1] = { shipId: 'battleship', r: 0, c: 1, dir: 'h' }; // carrier ile çakışır
    a.emit('battleshipPlace', { roomId: id, placements: bad });
    const rej = await rejA;
    assert.strictEqual(rej.reason, 'overlap');
  }

  // 2) Geçerli yerleştirme kabul edilir; faz her iki yerleştirme bitmeden 'placing' kalır.
  const readyMineA = waitFor(a, 'gameStateUpdated', p => p.gameState.ready && p.gameState.ready.mine === true);
  a.emit('battleshipPlace', { roomId: id, placements: fleetPlacements() });
  const afterA = await readyMineA;
  assert.strictEqual(afterA.gameState.phase, 'placing');
  assert.strictEqual(afterA.gameState.ready.opponent, false);
  // Kendi filom tam görünür durumda.
  assert.strictEqual(Array.isArray(afterA.gameState.myShips), true);
  assert.strictEqual(afterA.gameState.myShips.length, 5);

  const battleA = waitFor(a, 'gameStateUpdated', p => p.gameState.phase === 'battle');
  const battleB = waitFor(b, 'gameStateUpdated', p => p.gameState.phase === 'battle');
  b.emit('battleshipPlace', { roomId: id, placements: fleetPlacements() });
  const [finA, finB] = await Promise.all([battleA, battleB]);
  assert.strictEqual(finA.gameState.phase, 'battle');
  assert.strictEqual(finB.gameState.phase, 'battle');
  const turnSeat = finA.gameState.turn;
  assert.ok(turnSeat === 0 || turnSeat === 1);

  // 3) GİZLİ BİLGİ: hiçbir tarafın gameState'inde rakibin filo hücreleri YOK.
  //    (myShips yalnız KENDİ filosunu — hücreleriyle — taşır; enemyFleet
  //    yalnız tür+battı-mı bilgisini taşır, konum asla gönderilmez.)
  assert.strictEqual(JSON.stringify(finA.gameState.myShips).includes('"cells"'), true);
  assert.strictEqual(JSON.stringify(finA.gameState.enemyFleet).includes('cells'), false);
  const enemyFleetKeys = Object.keys((finA.gameState.enemyFleet || [])[0] || {});
  assert.deepStrictEqual(enemyFleetKeys.sort(), ['id', 'name', 'size', 'sunk'].sort());

  const movers = { 0: a, 1: b }, others = { 0: b, 1: a };
  const moverSeat = turnSeat, otherSeat = turnSeat === 0 ? 1 : 0;
  const mover = movers[moverSeat], other = others[moverSeat];

  // 4) Sırası olmayan taraf ateş edemez.
  {
    const rej = once(other, 'battleshipRejected');
    other.emit('battleshipFire', { roomId: id, r: 5, c: 5 });
    assert.strictEqual((await rej).reason, 'not_your_turn');
  }

  // 5) Sırası gelen taraf (0,0)'a ateş eder -> rakibin carrier'ı orada, isabet olmalı.
  {
    const shot = waitFor(a, 'battleshipShotResult', p => p.r === 0 && p.c === 0);
    const turned = waitFor(a, 'gameStateUpdated', p => p.gameState.turn === otherSeat);
    mover.emit('battleshipFire', { roomId: id, r: 0, c: 0 });
    const shotA = await shot;
    assert.strictEqual(shotA.result, 'hit');
    assert.strictEqual(shotA.shipId, 'carrier');
    assert.strictEqual(shotA.seat, moverSeat);
    await turned; // el her zaman değişir (isabet olsa da)
  }

  // 6) Aynı hücreye tekrar ateş edilemez (sıra tekrar mover'a dönünce dener).
  {
    const backToMover = waitFor(a, 'gameStateUpdated', p => p.gameState.turn === moverSeat);
    other.emit('battleshipFire', { roomId: id, r: 9, c: 9 }); // ıska, sıra mover'a döner
    await backToMover;
    const rej = once(mover, 'battleshipRejected');
    mover.emit('battleshipFire', { roomId: id, r: 0, c: 0 });
    assert.strictEqual((await rej).reason, 'already_fired');
  }

  // 7) destroyer'ı (4,0) ve (4,1)'den batırıp 'sunk' + Türkçe gemi adı doğrulanır.
  {
    const hit1 = waitFor(a, 'battleshipShotResult', p => p.r === 4 && p.c === 0);
    const backToMover2 = waitFor(a, 'gameStateUpdated', p => p.gameState.turn === moverSeat);
    mover.emit('battleshipFire', { roomId: id, r: 4, c: 0 });
    await hit1;
    other.emit('battleshipFire', { roomId: id, r: 8, c: 8 }); // ıska, sırayı geri getir
    await backToMover2;
    const sunk = waitFor(a, 'battleshipShotResult', p => p.r === 4 && p.c === 1);
    mover.emit('battleshipFire', { roomId: id, r: 4, c: 1 });
    const s2 = await sunk;
    assert.strictEqual(s2.result, 'sunk');
    assert.strictEqual(s2.shipId, 'destroyer');
    assert.strictEqual(s2.sunkShip.name, 'Muhrip');
  }

  a.disconnect(); b.disconnect();
  srv.server.close();
  console.log('OK battleship online: yerleştirme + gizli bilgi + sıra kontrolü + isabet/batırma');
}
main().catch(e => { console.error(e); try { srv.server.close(); } catch (_) {} process.exit(1); });
