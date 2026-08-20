'use strict';

/*
 * OKEY MOTORU — saf kural testleri (okey-engine.js).
 * Referans: sitedeki yerel okey motorunun birebir taşıması.
 *  - 106 taş, gösterge/gerçek okey, sahte okey kimliği
 *  - Dağıtım: başlayan 15 (çekmeden atar), diğerleri 14
 *  - Çekme: desteden veya bir önceki koltuğun üst atığından
 *  - Bitiş: 14 taş geçerli per / 7 çift; okey atarak bitiş ayrı tip
 *  - Deste bitimi: beraberlik
 */

const assert = require('assert');
const E = require('../okey-engine.js');

let uid = 0;
function T(n, c) { return { id: 'x' + (uid++), n, c, isFJ: false }; }
const RO = { c: 't-red', n: 5 }; // testlerde sabit gerçek okey: kırmızı 5

function main() {
  // ---------- 1) Deste kompozisyonu ----------
  const d = E.freshDeck('t');
  assert.strictEqual(d.length, 106, 'deste 106 taş');
  assert.strictEqual(d.filter(t => t.isFJ).length, 2, '2 sahte okey');
  for (const c of E.COLORS) {
    for (let n = 1; n <= 13; n++) {
      assert.strictEqual(d.filter(t => !t.isFJ && t.c === c && t.n === n).length, 2,
        `${c} ${n} ikişer adet`);
    }
  }
  console.log('  ✓ 1) deste 106 taş: 4 renk × 13 × 2 + 2 sahte okey');

  // ---------- 2) El kurulumu ----------
  const st = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2);
  assert.strictEqual(st.hands[2].length, 15, 'başlayan 15 taş');
  assert.strictEqual(st.hands[0].length, 14);
  assert.strictEqual(st.hands[1].length, 14);
  assert.strictEqual(st.hands[3].length, 14);
  assert.strictEqual(st.deck.length, 48, 'deste 48 kalır');
  assert.strictEqual(st.turn, 2, 'sıra başlayanda');
  assert.strictEqual(st.phase, 'discard', '15 taşla başlayan ÇEKMEDEN atar');
  assert.ok(!st.indicator.isFJ, 'gösterge sahte okey olamaz');
  const expectOkeyN = st.indicator.n === 13 ? 1 : st.indicator.n + 1;
  assert.deepStrictEqual(st.realOkey, { c: st.indicator.c, n: expectOkeyN },
    'gerçek okey = gösterge+1 (13→1 dönüşümlü)');
  // Sahte okeyler gösterge değerini almış olmalı
  const allTiles = [...st.deck, ...Object.values(st.hands).flat()];
  allTiles.filter(t => t.isFJ).forEach(t => {
    assert.strictEqual(t.n, st.indicator.n, 'sahte okey göstergenin sayısını alır');
    assert.strictEqual(t.dc, st.indicator.c, 'sahte okey göstergenin rengini alır (dc)');
  });
  // Gerçek okey taşları işaretli
  const okeys = allTiles.filter(t => !t.isFJ && t.c === st.realOkey.c && t.n === st.realOkey.n);
  assert.strictEqual(okeys.length, 2, '2 gerçek okey var');
  okeys.forEach(t => assert.strictEqual(t.isOkey, true, 'okey işaretli'));
  console.log('  ✓ 2) dağıtım 15/14/14/14, gösterge→okey, sahte okey kimliği, işaretler');

  // ---------- 3) Çekme/atma disiplini ----------
  const s2 = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2);
  // Sırası olmayan çekemez/ataamaz
  assert.strictEqual(E.discard(s2, 0, s2.hands[0][0].id).reason, 'not_your_turn');
  assert.strictEqual(E.drawFromDeck(s2, 0).reason, 'not_your_turn');
  // Başlayan (phase=discard) çekemez
  assert.strictEqual(E.drawFromDeck(s2, 2).reason, 'must_discard');
  // Atar → sıra 3'e geçer, phase=draw
  const thrown = s2.hands[2][0];
  const dr = E.discard(s2, 2, thrown.id);
  assert.strictEqual(dr.ok, true);
  assert.strictEqual(s2.turn, 3, 'sıra sonraki koltuğa geçer');
  assert.strictEqual(s2.phase, 'draw');
  assert.strictEqual(s2.discardPiles[2][0].id, thrown.id, 'atık kendi yığınında');
  assert.strictEqual(s2.hands[2].length, 14);
  // Atma aşamasında değilken atamaz
  assert.strictEqual(E.discard(s2, 3, s2.hands[3][0].id).reason, 'must_draw');
  // Önceki koltuğun (2) atığından çeker
  const take = E.drawFromPrev(s2, 3);
  assert.strictEqual(take.ok, true, 'soldaki atıktan çekilebilir');
  assert.strictEqual(take.drawn.id, thrown.id, 'üstteki atık gelir');
  assert.strictEqual(s2.hands[3].length, 15);
  assert.strictEqual(s2.discardPiles[2].length, 0, 'yığından düştü');
  assert.strictEqual(s2.phase, 'discard');
  // İki kez çekemez
  assert.strictEqual(E.drawFromDeck(s2, 3).reason, 'must_discard');
  // Elinde olmayan taşı atamaz
  assert.strictEqual(E.discard(s2, 3, 'yok-boyle-tas').reason, 'tile_not_found');
  // 3 atar → 0. koltuk desteden çeker
  E.discard(s2, 3, s2.hands[3][0].id);
  const before = s2.deck.length;
  const dd = E.drawFromDeck(s2, 0);
  assert.strictEqual(dd.ok, true, 'desteden çekilir');
  assert.strictEqual(s2.deck.length, before - 1);
  assert.strictEqual(s2.hands[0].length, 15);
  E.discard(s2, 0, s2.hands[0][0].id);
  assert.strictEqual(E.drawFromDeck(s2, 1).ok, true);
  console.log('  ✓ 3) tur disiplini: not_your_turn / must_draw / must_discard / önceki atık');

  // ---------- 4) Bitiş doğrulaması: per / çift / okey / geçersiz ----------
  // Geçerli 14: seri k1-2-3, seri m4-5-6, küt 7'ler (4 renk), küt 9'lar (4 renk)
  const win14 = [
    T(1, 't-red'), T(2, 't-red'), T(3, 't-red'),
    T(4, 't-blue'), T(5, 't-blue'), T(6, 't-blue'),
    T(7, 't-red'), T(7, 't-black'), T(7, 't-blue'), T(7, 't-yellow'),
    T(9, 't-red'), T(9, 't-black'), T(9, 't-blue'), T(9, 't-yellow')
  ];
  assert.strictEqual(E.checkPer(win14, RO), true, '14 taşlık geçerli per');
  assert.strictEqual(E.canFinishWith14(win14, RO), true);

  // 13→1 dönüşümlü seri: sarı 12-13-1
  const wrap14 = [
    T(12, 't-yellow'), T(13, 't-yellow'), T(1, 't-yellow'),
    T(2, 't-black'), T(3, 't-black'), T(4, 't-black'),
    T(6, 't-red'), T(6, 't-black'), T(6, 't-blue'), T(6, 't-yellow'),
    T(10, 't-red'), T(10, 't-black'), T(10, 't-blue'), T(10, 't-yellow')
  ];
  assert.strictEqual(E.checkPer(wrap14, RO), true, '12-13-1 dönüşümlü seri geçerli');

  // 13-1-2 dönüşümü + 6'lı uzun seri (3+3 dilimlenir)
  const wrap14b = [
    T(13, 't-yellow'), T(1, 't-yellow'), T(2, 't-yellow'),
    T(1, 't-black'), T(2, 't-black'), T(3, 't-black'), T(4, 't-black'), T(5, 't-black'), T(6, 't-black'),
    T(7, 't-blue'), T(8, 't-blue'), T(9, 't-blue'), T(10, 't-blue'), T(11, 't-blue')
  ];
  assert.strictEqual(E.checkPer(wrap14b, RO), true, '13-1-2 dönüşümü + 6lı seri geçerli');

  // Okey joker olarak: kırmızı 5 gerçek okey → eksik tamamlar
  const withOkey = [
    T(1, 't-red'), T(2, 't-red'), T(5, 't-red'),          // k5 = okey → k3 yerine
    T(4, 't-blue'), T(5, 't-blue'), T(6, 't-blue'),
    T(7, 't-red'), T(7, 't-black'), T(7, 't-blue'), T(7, 't-yellow'),
    T(9, 't-red'), T(9, 't-black'), T(9, 't-blue'), T(9, 't-yellow')
  ];
  assert.strictEqual(E.checkPer(withOkey, RO), true, 'okey joker gibi tamamlar');

  // Geçersiz: 7-7 çifti küt sayılmaz, dağınık el
  const bad14 = [
    T(1, 't-red'), T(4, 't-red'), T(6, 't-red'),
    T(2, 't-blue'), T(9, 't-blue'), T(11, 't-blue'),
    T(7, 't-red'), T(7, 't-black'),
    T(3, 't-black'), T(12, 't-black'),
    T(5, 't-yellow'), T(8, 't-yellow'),
    T(13, 't-yellow'), T(1, 't-black')
  ];
  assert.strictEqual(E.checkPer(bad14, RO), false, 'dağınık el per değil');
  assert.strictEqual(E.checkPairs(bad14, RO), false, 'dağınık el çift değil');

  // 7 çift
  const pairs14 = [];
  [[1, 't-red'], [2, 't-blue'], [3, 't-black'], [4, 't-yellow'],
   [6, 't-red'], [8, 't-blue'], [11, 't-black']].forEach(([n, c]) => { pairs14.push(T(n, c), T(n, c)); });
  assert.strictEqual(E.checkPairs(pairs14, RO), true, '7 çift geçerli');
  // 6 çift + 1 okey → okey 7. çifti tamamlar
  const pairsOkey = [];
  [[1, 't-red'], [2, 't-blue'], [3, 't-black'], [4, 't-yellow'],
   [6, 't-red'], [8, 't-blue']].forEach(([n, c]) => { pairsOkey.push(T(n, c), T(n, c)); });
  pairsOkey.push(T(7, 't-black'), T(5, 't-red')); // tekil siyah7 + okey
  assert.strictEqual(E.checkPairs(pairsOkey, RO), true, 'okey tekliyi çifte tamamlar');
  console.log('  ✓ 4) per/çift/okey-joker/dönüşümlü seri doğrulamaları');

  // ---------- 5) finish() akışı ----------
  const s5 = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2);
  s5.hands[2] = [...win14.map(t => ({ ...t })), T(13, 't-blue')]; // 14 geçerli + fazlalık
  const noTurn = E.finish(s5, 0, s5.hands[0][0].id);
  assert.strictEqual(noTurn.reason, 'not_your_turn');
  const f = E.finish(s5, 2, s5.hands[2][14].id);
  assert.strictEqual(f.ok, true, 'geçerli el ortaya biter');
  assert.strictEqual(f.winType, 'standard', 'normal bitiş tipi standard');
  assert.strictEqual(s5.finished, true);
  assert.deepStrictEqual(s5.result, { winner: 2, winType: 'standard' });
  assert.strictEqual(s5.hands[2].length, 14);
  // Biten ele hamle yapılamaz
  assert.strictEqual(E.discard(s5, 0, 'x').reason, 'round_over');

  // Okey atarak bitiş: fazlalık taş gerçek okey olsun
  const s6 = E.startRound(2, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2);
  const okeyTile = { ...T(s6.realOkey.n, s6.realOkey.c), isOkey: true };
  s6.hands[2] = [...win14.filter(t => !(t.n === s6.realOkey.n && t.c === s6.realOkey.c)).map(t => ({ ...t })), okeyTile];
  assert.strictEqual(s6.hands[2].length, 15);
  const f6 = E.finish(s6, 2, okeyTile.id);
  assert.strictEqual(f6.ok, true);
  assert.strictEqual(f6.winType, 'okey', 'okey atarak bitiş tipi okey');

  // Çift bitiş tipi
  const s7 = E.startRound(3, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2);
  s7.hands[2] = [...pairs14.map(t => ({ ...t })), T(12, 't-blue')];
  const f7 = E.finish(s7, 2, s7.hands[2][14].id);
  assert.strictEqual(f7.ok, true);
  assert.strictEqual(f7.winType, 'pairs', 'çifte bitiş tipi pairs');

  // Geçersiz elle bitiş reddedilir
  const s8 = E.startRound(4, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2);
  s8.hands[2] = [...bad14.map(t => ({ ...t })), T(13, 't-blue')];
  const f8 = E.finish(s8, 2, s8.hands[2][14].id);
  assert.strictEqual(f8.reason, 'not_a_win_hand', 'geçersiz el bitiremez');
  assert.strictEqual(s8.finished, false);
  console.log('  ✓ 5) finish(): standard / okey / pairs / not_a_win_hand / round_over');

  // ---------- 6) Deste bitimi: beraberlik ----------
  const s9 = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 2);
  E.discard(s9, 2, s9.hands[2][0].id); // sıra 3, phase=draw
  s9.deck = []; // deste bitti
  const dr9 = E.drawFromDeck(s9, 3);
  assert.strictEqual(dr9.ok, true);
  assert.strictEqual(dr9.deckEmpty, true, 'deste bitişi bildirilir');
  assert.strictEqual(s9.finished, true);
  assert.deepStrictEqual(s9.result, { winner: null, winType: 'draw' }, 'el berabere');
  console.log('  ✓ 6) deste bitince el berabere (draw)');

  // ---------- 7) handCanFinish (15 taşlı el) ----------
  assert.strictEqual(E.handCanFinish([...win14, T(4, 't-red')], RO), true,
    '15 taştan biri atılınca bitiyorsa true');
  assert.strictEqual(E.handCanFinish([...bad14, T(4, 't-red')], RO), false,
    'hiçbir atışla bitmiyorsa false');
  assert.strictEqual(E.handCanFinish(win14, RO), false, '14 taşla çağrılmaz (15 bekler)');
  console.log('  ✓ 7) handCanFinish 15 taşlı el taraması');

  // ---------- 8) Sıra yardımcıları ----------
  const s10 = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 0);
  assert.strictEqual(E.nextSeatOf(s10, 0), 1);
  assert.strictEqual(E.nextSeatOf(s10, 3), 0, 'son koltuktan başa döner');
  assert.strictEqual(E.prevSeatOf(s10, 0), 3, 'önceki koltuk sarılır');
  assert.strictEqual(E.prevSeatOf(s10, 1), 0);
  console.log('  ✓ 8) sıra dönüşü (next/prev) doğru');

  console.log('OK okey motoru testleri');
}

try { main(); } catch (err) { console.error('❌ OKEY MOTOR HATASI:', err); process.exit(1); }
