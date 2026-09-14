'use strict';
const assert = require('assert');
const bs = require('../battleship-engine');

function validFleetPlacements() {
  // Sınır içi, çakışmasız, klasik 5 gemi — yatay dizilmiş, farklı satırlarda.
  return [
    { shipId: 'carrier', r: 0, c: 0, dir: 'h' },     // (0,0..4)
    { shipId: 'battleship', r: 1, c: 0, dir: 'h' },  // (1,0..3)
    { shipId: 'cruiser', r: 2, c: 0, dir: 'h' },     // (2,0..2)
    { shipId: 'submarine', r: 3, c: 0, dir: 'h' },   // (3,0..2)
    { shipId: 'destroyer', r: 4, c: 0, dir: 'h' }    // (4,0..1)
  ];
}

// 1) init() başlangıç durumu doğru.
{
  const s = bs.init();
  assert.strictEqual(s.phase, 'placing');
  assert.strictEqual(s.ready[0], false);
  assert.strictEqual(s.ready[1], false);
  assert.strictEqual(s.turn, null);
}

// 2) Geçerli yerleştirme kabul edilir; her iki koltuk yerleştirince faz 'battle'a geçer.
{
  const s = bs.init();
  let r = bs.place(s, 0, validFleetPlacements());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.ready[0], true);
  assert.strictEqual(s.phase, 'placing'); // rakip henüz yerleştirmedi
  r = bs.place(s, 1, validFleetPlacements());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.phase, 'battle');
  assert.ok(s.turn === 0 || s.turn === 1);
}

// 3) Aynı koltuk ikinci kez yerleştiremez.
{
  const s = bs.init();
  bs.place(s, 0, validFleetPlacements());
  const r = bs.place(s, 0, validFleetPlacements());
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'already_ready');
}

// 4) Sınır dışı yerleştirme reddedilir.
{
  const s = bs.init();
  const bad = validFleetPlacements();
  bad[0] = { shipId: 'carrier', r: 0, c: 7, dir: 'h' }; // 5 hücre, 7..11 -> sınır dışı
  const r = bs.place(s, 0, bad);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'out_of_bounds');
}

// 5) Çakışan gemiler reddedilir.
{
  const s = bs.init();
  const bad = validFleetPlacements();
  bad[1] = { shipId: 'battleship', r: 0, c: 1, dir: 'h' }; // carrier (0,0..4) ile çakışır
  const r = bs.place(s, 0, bad);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'overlap');
}

// 6) Eksik/yanlış filo (5 gemiden az/çok, ya da tekrarlanan gemi) reddedilir.
{
  const s = bs.init();
  const incomplete = validFleetPlacements().slice(0, 4);
  assert.strictEqual(bs.place(s, 0, incomplete).ok, false);

  const s2 = bs.init();
  const dup = validFleetPlacements();
  dup[4] = { shipId: 'carrier', r: 5, c: 0, dir: 'h' }; // 'carrier' iki kez, 'destroyer' hiç yok
  const r2 = bs.place(s2, 0, dup);
  // Motor tanımlara (SHIPS) göre arar: 'destroyer' için hiç eşleşme
  // bulunamaz, bu yüzden asıl eksik gemi burada raporlanır (dolaylı
  // olarak tekrar da reddedilmiş olur — 5 alan doluyken bir gemi hâlâ eksik).
  assert.strictEqual(r2.ok, false);
  assert.strictEqual(r2.reason, 'missing_ship');
  assert.strictEqual(r2.shipId, 'destroyer');
}

// 7) 'placing' fazında ateş edilemez; sıra dışı ateş reddedilir.
{
  const s = bs.init();
  bs.place(s, 0, validFleetPlacements());
  assert.strictEqual(bs.fire(s, 0, 0, 0).reason, 'wrong_phase');
  bs.place(s, 1, validFleetPlacements());
  const notTurn = s.turn === 0 ? 1 : 0;
  const r = bs.fire(s, notTurn, 5, 5);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'not_your_turn');
}

// 8) İsabet/ıska doğru hesaplanır; aynı hücreye iki kez ateş edilemez; el her zaman değişir.
{
  const s = bs.init();
  bs.place(s, 0, validFleetPlacements());
  bs.place(s, 1, validFleetPlacements()); // her iki koltukta da aynı dizilim
  const mover = s.turn;
  const other = mover === 0 ? 1 : 0;

  // Rakibin (0,0) hücresi 'carrier' — isabet olmalı.
  let r = bs.fire(s, mover, 0, 0);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.result, 'hit');
  assert.strictEqual(r.shipId, 'carrier');
  assert.strictEqual(s.turn, other); // el değişti (isabet olsa da)

  // Aynı hücreye ikinci kez ateş edilemez (sıra yeniden mover'a gelince).
  bs.fire(s, other, 9, 9); // ıska, sıra tekrar mover'a döner
  const dup = bs.fire(s, mover, 0, 0);
  assert.strictEqual(dup.ok, false);
  assert.strictEqual(dup.reason, 'already_fired');

  // Boş bir hücreye (ör. 8,8) ateş -> ıska.
  const miss = bs.fire(s, mover, 8, 8);
  assert.strictEqual(miss.ok, true);
  assert.strictEqual(miss.result, 'miss');
  assert.strictEqual(miss.shipId, null);
}

// 9) Bir gemi tüm hücrelerinden vurulunca batar; tüm filo batınca oyun biter.
{
  const s = bs.init();
  // destroyer (boy 2) sadece (4,0) ve (4,1)'de — kolay batırmak için.
  bs.place(s, 0, validFleetPlacements());
  bs.place(s, 1, validFleetPlacements());
  const mover = s.turn, other = mover === 0 ? 1 : 0;

  let r = bs.fire(s, mover, 4, 0);
  assert.strictEqual(r.result, 'hit');
  bs.fire(s, other, 9, 8); // ıska, sırayı mover'a geri getir
  r = bs.fire(s, mover, 4, 1);
  assert.strictEqual(r.result, 'sunk');
  assert.strictEqual(r.sunkShip.id, 'destroyer');
  assert.strictEqual(r.finished, false); // filonun geri kalanı hâlâ ayakta
}

// 10) Tüm filoyu batırınca kazanan doğru ilan edilir ve faz 'finished' olur.
{
  const s = bs.init();
  bs.place(s, 0, validFleetPlacements());
  bs.place(s, 1, validFleetPlacements());
  const mover = s.turn, other = mover === 0 ? 1 : 0;
  // Rakibin (koltuk `other`) TÜM gemi hücrelerini sırayla vur; aradaki
  // el geçişlerinde `other` da (isabet/ıska önemsiz) mover'ın tahtasında
  // henüz ateş edilmemiş bir hücreye vurarak sırayı geri getirir.
  const targetShips = s.ships[other];
  const allCells = [];
  targetShips.forEach(sh => sh.cells.forEach(([r, c]) => allCells.push([r, c])));
  let finished = false, winner = null;
  let fillIdx = 0;
  for (const [r, c] of allCells) {
    const res = bs.fire(s, mover, r, c);
    assert.strictEqual(res.ok, true);
    assert.notStrictEqual(res.result, 'miss');
    if (res.finished) { finished = true; winner = mover; break; }
    // `other`ın kendi turu: mover'ın tahtasında henüz denenmemiş bir hücre.
    let fr, fc;
    do { fr = Math.floor(fillIdx / bs.SIZE); fc = fillIdx % bs.SIZE; fillIdx++; }
    while (s.shots[other].some(sh => sh.r === fr && sh.c === fc));
    const fillRes = bs.fire(s, other, fr, fc);
    assert.strictEqual(fillRes.ok, true);
  }
  assert.strictEqual(finished, true);
  assert.strictEqual(winner, mover);
  assert.strictEqual(s.phase, 'finished');
  assert.strictEqual(s.winner, mover);
  assert.strictEqual(s.result.reason, 'fleet_sunk');
}

console.log('OK battleship-engine');
