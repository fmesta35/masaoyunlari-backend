'use strict';

/*
 * OKEY 101 MOTORU — saf kural testleri (okey-engine.js, variant='okey101').
 *  - Taş puanı = üzerindeki sayı (sahte okey göstergenin sayısını taşır → t.n)
 *  - El bitişi: 14 taşın TOPAMI hedefe (101) ulaşmalı (per/çift kuralları YOK)
 *  - Kazanan, diğer oyuncuların KALAN el puanı toplamını (gained) skora ekler
 *  - Maç bitişi (101 puana ulaşma) sunucu katmanında işlenir (bkz. okey101-online)
 *  - Standart okey varyantı ETKİLENMEMELİ
 */

const assert = require('assert');
const E = require('../okey-engine.js');

let uid = 0;
function T(n, c) { return { id: 'x' + (uid++), n, c, isFJ: false }; }

// n adet taş (1..13) üretilir; toplamı tam `total` olur (total <= 13*n kabul).
function tilesSumming(n, total) {
  const out = [];
  let left = total;
  for (let i = 0; i < n - 1; i++) {
    const v = Math.max(1, Math.min(13, left - (n - 1 - i)));
    out.push(T(v, 't-red'));
    left -= v;
  }
  out.push(T(left, 't-red'));
  return out;
}

function main() {
  // ---------- 1) Sabitler + temel fonksiyonlar ----------
  assert.strictEqual(E.OKEY101_TARGET, 101, 'hedef 101');
  assert.strictEqual(E.tilePoint({ n: 13, c: 't-red', isFJ: false }), 13, 'taş puanı = sayısı');
  assert.strictEqual(E.tilePoint({ n: 5, c: 't-joker', isFJ: true }), 5, 'sahte okey göstergenin sayısını taşır');
  assert.strictEqual(E.tilePoint(null), 0, 'taş yoksa puan 0');

  const hi14 = tilesSumming(14, 182); // 14×13
  assert.ok(E.check101(hi14, 101), '182 >= 101 → geçerli');
  const lo14 = tilesSumming(14, 14);  // 14×1
  assert.ok(!E.check101(lo14, 101), '14 < 101 → geçersiz');
  assert.ok(E.check101(tilesSumming(14, 101), 101), 'tam 101 → geçerli (>=)');
  assert.ok(!E.check101(tilesSumming(14, 100), 101), '100 → geçersiz');
  assert.ok(!E.check101(tilesSumming(13, 182), 101), '13 taş asla bitirmez');
  assert.ok(!E.check101(tilesSumming(15, 182), 101), '15 taş asla bitirmez');
  assert.ok(E.check101(tilesSumming(14, 50), 45), 'özel hedef desteklenir');
  assert.ok(!E.check101(tilesSumming(14, 50), 51), 'özel hedef sınırı');
  console.log('  ✓ 1) tilePoint/check101: 14 taş + toplam >= hedef');

  // ---------- 2) startRound varyant kurulumu ----------
  const st = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2, 'okey101');
  assert.strictEqual(st.variant, 'okey101', 'varyant saklanır');
  assert.strictEqual(st.target, 101, 'hedef 101');
  assert.strictEqual(st.hands[2].length, 15, 'başlayan 15 taş');
  assert.strictEqual(st.hands[0].length, 14);
  assert.strictEqual(st.hands[1].length, 14);
  assert.strictEqual(st.hands[3].length, 14);
  assert.strictEqual(st.turn, 2, 'sıra başlayanda');
  assert.strictEqual(st.phase, 'discard', 'başlayan çekmeden atar');

  const stStd = E.startRound(1, [0, 1, 2, 3], {}, () => 0.42, 2);
  assert.strictEqual(stStd.variant, 'standard', 'varsayılan varyant standard');
  assert.strictEqual(stStd.target, null, 'standartta hedef yok');

  const stBad = E.startRound(1, [0, 1, 2, 3], {}, () => 0.42, 0, 'garbage');
  assert.strictEqual(stBad.variant, 'standard', 'geçersiz varyant standarda düşer');
  console.log('  ✓ 2) startRound: okey101 → variant+target; standard etkilenmedi');

  // ---------- 3) 101 bitişi: kabul + gained = rakiplerin kalan toplamı ----------
  const s3 = E.startRound(1, [0, 1, 2], { 0: 0, 1: 0, 2: 0 }, () => 0.42, 0, 'okey101');
  const win15 = tilesSumming(14, 182).concat([T(1, 't-black')]);
  const extraId = win15[14].id;
  s3.hands[0] = win15;
  s3.hands[1] = tilesSumming(14, 60);
  s3.hands[2] = tilesSumming(14, 40);
  const r3 = E.finish(s3, 0, extraId);
  assert.strictEqual(r3.ok, true, '101 bitişi kabul edilir');
  assert.strictEqual(r3.winType, '101', 'winType=101');
  assert.strictEqual(r3.gained, 100, 'gained = 60 + 40 (rakiplerin kalan el puanı)');
  assert.strictEqual(s3.finished, true);
  assert.deepStrictEqual(s3.result, { winner: 0, winType: '101', gained: 100 }, 'result kaydı');
  assert.strictEqual(s3.scores[0], 100, 'kazananın skoru = gained (PUAN, +1 DEĞİL)');
  assert.strictEqual(s3.hands[0].length, 14, 'bitirenin elinde 14 taş kalır');
  assert.strictEqual(s3.discardPiles[0][0].id, extraId, '15. taş ortaya atıldı');
  console.log('  ✓ 3) 101 bitişi: skor = rakiplerin kalan puan toplamı (gained)');

  // ---------- 4) 101 altı el reddedilir (not_101) ----------
  const s4 = E.startRound(1, [0, 1, 2], { 0: 0, 1: 0, 2: 0 }, () => 0.42, 0, 'okey101');
  s4.hands[0] = tilesSumming(15, 80); // 15 taş toplam 80 → 14 taş hiçbir zaman >= 101
  const r4 = E.finish(s4, 0, s4.hands[0][0].id);
  assert.strictEqual(r4.ok, false, '101 altı bitiş reddedilir');
  assert.strictEqual(r4.reason, 'not_101');
  assert.ok(!s4.finished, 'reddedilen bitiş eli bitirmez');
  assert.strictEqual(s4.scores[0], 0, 'reddedilen bitiş skor yazmaz');
  console.log('  ✓ 4) not_101 reddi (toplam < 101)');

  // ---------- 5) 101 varyantı STANDART kuralı (çift/per) kullanmaz ----------
  const s5 = E.startRound(1, [0, 1, 2], { 0: 0, 1: 0, 2: 0 }, () => 0.42, 0, 'okey101');
  // Geçerli bir STANDART 7 çift el: 1..7 numaraların AYNI renk 2'şer adedi
  // (çift = aynı taşın 2 adedi) + 1 fazlalık: toplam 2×(1+..+7)=56 < 101.
  const pairHand = [];
  for (let n = 1; n <= 7; n++) pairHand.push(T(n, 't-red'), T(n, 't-red'));
  const pairExtra = T(13, 't-blue');
  s5.hands[0] = pairHand.concat([pairExtra]);
  // Çift elin standartta geçerli olduğunu bağımsız doğrula:
  assert.ok(E.checkPairs(pairHand, s5.realOkey), 'el standartta 7 çift (referans)');
  const r5 = E.finish(s5, 0, pairExtra.id);
  assert.strictEqual(r5.ok, false, '101 varyantında çift el YETMEZ');
  assert.strictEqual(r5.reason, 'not_101');
  console.log('  ✓ 5) 101 varyantı per/çift kurallarını uygulamaz (yalnız toplam sayılır)');

  // ---------- 6) canFinishWith14 / handCanFinish varyant farkındalığı ----------
  assert.ok(E.canFinishWith14(tilesSumming(14, 101), null, 'okey101', 101), '14 taş 101 → bitirilebilir');
  assert.ok(!E.canFinishWith14(tilesSumming(14, 99), null, 'okey101', 101), '14 taş 99 → bitirilemez');
  assert.ok(E.handCanFinish(tilesSumming(14, 101).concat([T(13, 't-blue')]), null, 'okey101', 101),
    '15 taşlı elden 101 bitirilebilir');
  assert.ok(!E.handCanFinish(tilesSumming(15, 90), null, 'okey101', 101), 'düşük toplam el bitirilemez');
  // Standart yol (variant verilmezse) eski davranışını korur:
  const roX = { c: 't-red', n: 5 };
  assert.strictEqual(typeof E.canFinishWith14(pairHand, roX), 'boolean', 'standart imza değişmedi');
  assert.strictEqual(typeof E.handCanFinish(pairHand.concat([T(13, 't-blue')]), roX), 'boolean');
  console.log('  ✓ 6) canFinishWith14/handCanFinish varyant farkındalığı');

  // ---------- 7) remainingPointsOf ----------
  const s7 = E.startRound(1, [0, 1, 2, 3], {}, () => 0.42, 0, 'okey101');
  s7.hands[0] = tilesSumming(14, 50);
  s7.hands[1] = tilesSumming(14, 60);
  s7.hands[2] = tilesSumming(14, 70);
  s7.hands[3] = tilesSumming(14, 80);
  assert.strictEqual(E.remainingPointsOf(s7, 0), 210, '0 dışındakilerin toplamı');
  assert.strictEqual(E.remainingPointsOf(s7, 3), 180, '3 dışındakilerin toplamı');
  assert.strictEqual(E.remainingPointsOf(s7, 9), 260, 'masada olmayan koltuk: herkes sayılır');
  console.log('  ✓ 7) remainingPointsOf');

  // ---------- 8) Çekme/atma disiplini varyanttan bağımsız ----------
  const s8 = E.startRound(1, [0, 1, 2, 3], {}, () => 0.42, 0, 'okey101');
  assert.strictEqual(E.drawFromDeck(s8, 1).reason, 'not_your_turn', 'sırası olmayan çekemez');
  const d8 = E.drawFromDeck(s8, 0);
  assert.strictEqual(d8.ok, false, 'başlayan (phase=discard) çekemez');
  assert.strictEqual(d8.reason, 'must_discard');
  const th = E.discard(s8, 0, s8.hands[0][0].id);
  assert.ok(th.ok, 'başlayan atar');
  assert.strictEqual(s8.turn, 1, 'sıra sonrakine');
  assert.strictEqual(s8.phase, 'draw', 'sonraki önce çeker');
  console.log('  ✓ 8) çekme/atma disiplini okey101de de geçerli');

  console.log('✅ OKEY101-ENGINE: TUM TESTLER BASARILI');
}

main();
