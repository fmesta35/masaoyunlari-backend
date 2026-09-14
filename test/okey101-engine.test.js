'use strict';

/*
 * OKEY 101 MOTORU — saf kural testleri (okey-engine.js, variant='okey101').
 *
 *  DÜZELTME (kullanıcının ilettiği "101 Okey Plus" referans görsellerine
 *  göre — bkz. RULES.okey101 metni ve okey-engine.js finish() gerekçesi):
 *   - Eskiden kalan 14 taşın SALT SAYISAL TOPLAMI 101'i geçtiğinde
 *     kazanılıyordu; taşların GEÇERLİ per/seri oluşturması hiç aranmıyordu.
 *     Bu artık YANLIŞ kabul edilip düzeltildi: 14 taş GERÇEKTEN geçerli
 *     perler/seriler olmalı VE toplamları >= hedef (101) olmalı.
 *   - 7 çift ile bitiş 101'de de kabul edilir (özel/bonus bitiş, puan
 *     hedefi aranmaz) — eskiden 101'de tamamen reddediliyordu.
 *   - 101'de 13→1 dönüşümlü seri (ör. 12-13-1) GEÇERSİZDİR — klasik
 *     Okey'de (variant='standard') bu dönüşüm hâlâ GEÇERLİDİR (etkilenmedi).
 *   - Gerçek okey taşını (bitiş dışında) normal bir atışla açığa çıkarmak
 *     101 puan cezası doğurur.
 */

const assert = require('assert');
const E = require('../okey-engine.js');

let uid = 0;
function T(n, c) { return { id: 'x' + (uid++), n, c, isFJ: false }; }

// n adet taş (1..13) üretilir; toplamı tam `total` olur (total <= 13*n kabul).
// NOT: bu yalnız "sayısal toplam" testleri (tilePoint/check101 birim testi)
// için kullanılır — GEÇERLİ per/seri OLUŞTURMAZ (kasıtlı, bkz. test 9).
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

// GEÇERLİ bir "küme" (aynı sayı, farklı renkler) üretir.
const ALL_COLORS = ['t-red', 't-black', 't-blue', 't-yellow'];
function group(n, size) {
  return ALL_COLORS.slice(0, size).map(c => T(n, c));
}

// GEÇERLİ bir "seri" (aynı renk, ardışık sayılar, dönüşümsüz) üretir.
function run(startN, len, color) {
  const out = [];
  for (let i = 0; i < len; i++) out.push(T(startN + i, color || 't-red'));
  return out;
}

function main() {
  // ---------- 1) Sabitler + temel fonksiyonlar ----------
  assert.strictEqual(E.OKEY101_TARGET, 101, 'hedef 101');
  assert.strictEqual(E.tilePoint({ n: 13, c: 't-red', isFJ: false }), 13, 'taş puanı = sayısı');
  assert.strictEqual(E.tilePoint({ n: 5, c: 't-joker', isFJ: true }), 5, 'sahte okey göstergenin sayısını taşır');
  assert.strictEqual(E.tilePoint(null), 0, 'taş yoksa puan 0');

  const hi14 = tilesSumming(14, 182); // 14×13
  assert.ok(E.check101(hi14, 101), '182 >= 101 → geçerli (salt sayısal birim testi)');
  const lo14 = tilesSumming(14, 14);  // 14×1
  assert.ok(!E.check101(lo14, 101), '14 < 101 → geçersiz');
  assert.ok(E.check101(tilesSumming(14, 101), 101), 'tam 101 → geçerli (>=)');
  assert.ok(!E.check101(tilesSumming(14, 100), 101), '100 → geçersiz');
  assert.ok(!E.check101(tilesSumming(13, 182), 101), '13 taş asla bitirmez');
  assert.ok(!E.check101(tilesSumming(15, 182), 101), '15 taş asla bitirmez');
  assert.ok(E.check101(tilesSumming(14, 50), 45), 'özel hedef desteklenir');
  assert.ok(!E.check101(tilesSumming(14, 50), 51), 'özel hedef sınırı');
  console.log('  ✓ 1) tilePoint/check101 (salt sayısal birim testi): 14 taş + toplam >= hedef');

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

  // ---------- 3) 101 bitişi: GEÇERLİ perlerle + toplam >= 101 kabul edilir ----------
  const s3 = E.startRound(1, [0, 1, 2], { 0: 0, 1: 0, 2: 0 }, () => 0.42, 0, 'okey101');
  // 4+4+3+3 = 14 taş, dört GEÇERLİ küme (aynı sayı farklı renk): 13,12,11,10
  // → toplam = 4*13+4*12+3*11+3*10 = 52+48+33+30 = 163 >= 101.
  const win14 = [...group(13, 4), ...group(12, 4), ...group(11, 3), ...group(10, 3)];
  assert.strictEqual(win14.length, 14, 'test verisi 14 taş olmalı');
  const extra3 = T(1, 't-black'); // 15. (bitiş) taşı — win14'e dahil DEĞİL
  s3.hands[0] = win14.concat([extra3]);
  s3.hands[1] = tilesSumming(14, 60);
  s3.hands[2] = tilesSumming(14, 40);
  // Bağımsız doğrula: win14 gerçekten geçerli bir per elidir.
  assert.ok(E.checkPer(win14, s3.realOkey, true), 'referans el GERÇEKTEN geçerli perlerden oluşuyor');
  const r3 = E.finish(s3, 0, extra3.id);
  assert.strictEqual(r3.ok, true, '101 bitişi (geçerli per + toplam>=101) kabul edilir: ' + JSON.stringify(r3));
  assert.strictEqual(r3.winType, '101', 'winType=101');
  assert.strictEqual(r3.gained, 100, 'gained = 60 + 40 (rakiplerin kalan el puanı)');
  assert.strictEqual(s3.finished, true);
  assert.deepStrictEqual(s3.result, { winner: 0, winType: '101', gained: 100 }, 'result kaydı');
  assert.strictEqual(s3.scores[0], 100, 'kazananın skoru = gained (PUAN, +1 DEĞİL)');
  assert.strictEqual(s3.hands[0].length, 14, 'bitirenin elinde 14 taş kalır');
  assert.strictEqual(s3.discardPiles[0][0].id, extra3.id, '15. taş ortaya atıldı');
  console.log('  ✓ 3) 101 bitişi: GEÇERLİ perler + toplam>=101 → kabul, skor = rakiplerin kalan puanı');

  // ---------- 4) GEÇERLİ perler ama toplam < 101 → not_101 ----------
  const s4 = E.startRound(1, [0, 1, 2], { 0: 0, 1: 0, 2: 0 }, () => 0.42, 0, 'okey101');
  // 4+4+3+3=14 taş, dört GEÇERLİ küme: 1,2,3,4 → toplam = 4+8+9+12 = 33 < 101.
  const low14 = [...group(1, 4), ...group(2, 4), ...group(3, 3), ...group(4, 3)];
  assert.ok(E.checkPer(low14, s4.realOkey, true), 'düşük puanlı el de GEÇERLİ perlerden oluşuyor');
  const extra4 = T(5, 't-yellow');
  s4.hands[0] = low14.concat([extra4]);
  const r4 = E.finish(s4, 0, extra4.id);
  assert.strictEqual(r4.ok, false, 'toplam < 101 → reddedilir (perler geçerli olsa da)');
  assert.strictEqual(r4.reason, 'not_101');
  assert.ok(!s4.finished, 'reddedilen bitiş eli bitirmez');
  assert.strictEqual(s4.scores[0], 0, 'reddedilen bitiş skor yazmaz');
  console.log('  ✓ 4) GEÇERLİ perler + toplam < 101 → not_101 reddi');

  // ---------- 5) TEMEL DÜZELTME: rastgele (GEÇERSİZ) 14 taş, toplam>=101 → ARTIK REDDEDİLİR ----------
  // Kullanıcının ilettiği referans görsellere göre bitiş için GEÇERLİ
  // per/seri şarttır; salt rakamsal toplam asla tek başına yetmemeli.
  // Bu test, eski (hatalı) davranışın düzeltildiğini doğrudan kanıtlar.
  // Elle kurgulanmış 14 taş: hiçbir sayı 3+ farklı renkte tekrar etmiyor
  // (küme yok), hiçbir renkte 3+ ardışık sayı yok (seri yok), hiçbir taş
  // ikilenmiyor (çift yok) — ama toplamı tam 101.
  const s5 = E.startRound(1, [0, 1, 2], { 0: 0, 1: 0, 2: 0 }, () => 0.42, 0, 'okey101');
  const garbage14 = [
    T(13, 't-red'), T(11, 't-red'), T(9, 't-red'), T(2, 't-red'),
    T(7, 't-black'), T(5, 't-black'), T(3, 't-black'), T(2, 't-black'),
    T(13, 't-blue'), T(11, 't-blue'), T(9, 't-blue'),
    T(7, 't-yellow'), T(5, 't-yellow'), T(4, 't-yellow')
  ]; // toplam = (13+11+9+2)+(7+5+3+2)+(13+11+9)+(7+5+4) = 35+17+33+16 = 101
  assert.strictEqual(garbage14.reduce((s, t) => s + t.n, 0), 101, 'test verisinin toplamı tam 101 olmalı');
  assert.ok(!E.checkPer(garbage14, s5.realOkey, true) && !E.checkPairs(garbage14, s5.realOkey),
    'referans veri GERÇEKTEN geçersiz bir el olmalı (per de çift de değil)');
  const extra5 = T(1, 't-yellow'); // 15. (bitiş) taşı — garbage14'e dahil DEĞİL
  s5.hands[0] = garbage14.concat([extra5]);
  const r5 = E.finish(s5, 0, extra5.id);
  assert.strictEqual(r5.ok, false, 'GEÇERSİZ (per/çift olmayan) el, toplamı 101\'i geçse bile REDDEDİLMELİ');
  assert.strictEqual(r5.reason, 'not_a_win_hand', 'ret nedeni: geçerli el değil (eskiden yanlışlıkla kabul ediliyordu)');
  assert.ok(!s5.finished, 'geçersiz el asla bitirmemeli');
  console.log('  ✓ 5) DÜZELTME DOĞRULANDI: geçersiz (per/çift olmayan) el artık toplam>=101 olsa bile reddediliyor');

  // ---------- 6) 101'de 7 ÇİFT ile bitiş de kabul edilir (özel/bonus, puan şartsız) ----------
  const s6 = E.startRound(1, [0, 1, 2], { 0: 0, 1: 0, 2: 0 }, () => 0.42, 0, 'okey101');
  const pairHand = [];
  for (let n = 1; n <= 7; n++) pairHand.push(T(n, 't-red'), T(n, 't-red')); // toplam = 2*(1..7)=56 < 101
  const pairExtra = T(13, 't-blue');
  assert.ok(E.checkPairs(pairHand, s6.realOkey), 'el 7 çift (referans doğrulama)');
  s6.hands[0] = pairHand.concat([pairExtra]);
  s6.hands[1] = tilesSumming(14, 20);
  s6.hands[2] = tilesSumming(14, 30);
  const r6 = E.finish(s6, 0, pairExtra.id);
  assert.strictEqual(r6.ok, true, '101 varyantında ÇİFT bitişi artık KABUL edilir (eskiden reddediliyordu)');
  assert.strictEqual(r6.winType, 'pairs', 'winType=pairs');
  assert.strictEqual(r6.gained, 50, 'çift bitişte de kazanç = rakiplerin kalan puanı (puan hedefi aranmaz)');
  console.log('  ✓ 6) 101\'de 7 çift bitişi kabul edilir (toplamı 101\'in altında olsa bile)');

  // ---------- 7) 12-13-1 dönüşümlü seri: 101'de GEÇERSİZ, KLASİK Okey'de GEÇERLİ ----------
  // 12-13-1-2-3 (5'li dönüşümlü seri, t-red) + tek bir GEÇERLİ küme (n=7, 3 renk)
  // = 5 + ... aslında 14 taş için 5(seri)+... let's use two runs instead:
  // 12-13-1-2-3 (dönüşümlü, 5 taş) + 4-5-6-7-8 (dönüşümsüz, 5 taş) + 9-10-11 (3 taş,
  // dönüşümsüz küme yerine seri) — hepsi t-red aynı renk seriler, dönüşümlü olan TEK
  // parça: 12-13-1-2-3.
  const wrapRun = [T(12, 't-red'), T(13, 't-red'), T(1, 't-red'), T(2, 't-red'), T(3, 't-red')]; // 12-13-1-2-3
  const midRun = run(4, 5, 't-red');   // 4-5-6-7-8
  const tailRun = run(9, 4, 't-red');  // 9-10-11-12 (12 tekrar farklı taş kimliğiyle, renk aynı ama farklı seri parçası)
  const wrap14 = [...wrapRun, ...midRun, ...tailRun]; // 5+5+4 = 14 taş
  const roRef = { c: 't-blue', n: 5 }; // gerçekOkey bu taşlarla çakışmasın diye farklı renk/sayı seçildi
  // Klasik Okey (wraparound GEÇERLİ, noWrap=false / varsayılan):
  assert.ok(E.checkPer(wrap14, roRef), 'KLASİK Okey: 12-13-1 dönüşümlü seri GEÇERLİDİR (etkilenmedi)');
  // 101 Okey (wraparound GEÇERSİZ, noWrap=true):
  assert.ok(!E.checkPer(wrap14, roRef, true), '101 OKEY: 12-13-1 dönüşümlü seri GEÇERSİZDİR (düzeltildi)');
  console.log('  ✓ 7) 12-13-1 dönüşümlü seri: klasik Okey\'de geçerli, 101 Okey\'de GEÇERSİZ');

  // ---------- 8) Gerçek okeyi açık atmak 101 puan cezası doğurur ----------
  const s8p = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 0, 'okey101');
  // Elindeki taşlardan birini GERÇEK okey yap, onu atsın.
  const realOkeyTile = { id: 'ro-1', n: s8p.realOkey.n, c: s8p.realOkey.c, isFJ: false, isOkey: true };
  s8p.hands[0] = s8p.hands[0].slice(0, 14).concat([realOkeyTile]); // 15 taş (biri gerçek okey)
  const before = s8p.scores[0] || 0;
  const rp = E.discard(s8p, 0, realOkeyTile.id);
  assert.strictEqual(rp.ok, true, 'atış kabul edilir (ceza atışı ENGELLEMEZ, yalnız puan kırar)');
  assert.ok(rp.penalty, 'gerçek okeyi açık atmak bir ceza kaydı döndürmeli');
  assert.strictEqual(rp.penalty.amount, 101, 'ceza miktarı 101 puan');
  assert.strictEqual(rp.penalty.reason, 'real_okey_discarded');
  assert.strictEqual(s8p.scores[0], before - 101, 'atan oyuncunun skorundan 101 düşer');
  // Sıradan (gerçek olmayan) bir taş atmak CEZA DOĞURMAMALI:
  const s8n = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 0, 'okey101');
  const normalTile = s8n.hands[0].find(t => !E.isRealOkeyTile(t, s8n.realOkey));
  const rn = E.discard(s8n, 0, normalTile.id);
  assert.strictEqual(rn.ok, true);
  assert.strictEqual(rn.penalty, null, 'normal taş atışı ceza doğurmamalı');
  // KLASİK Okey'de bu ceza YOKTUR (yalnız 101 varyantına özgü):
  const s8std = E.startRound(1, [0, 1, 2, 3], { 0: 0, 1: 0, 2: 0, 3: 0 }, () => 0.42, 0);
  const realOkeyTileStd = { id: 'ro-2', n: s8std.realOkey.n, c: s8std.realOkey.c, isFJ: false, isOkey: true };
  s8std.hands[0] = s8std.hands[0].slice(0, 14).concat([realOkeyTileStd]);
  const rStd = E.discard(s8std, 0, realOkeyTileStd.id);
  assert.strictEqual(rStd.ok, true);
  assert.strictEqual(rStd.penalty, null, 'klasik Okey\'de gerçek okey atışı cezasızdır (etkilenmedi)');
  console.log('  ✓ 8) gerçek okeyi açık atmak 101 Okey\'de -101 puan cezası doğurur; klasik Okey etkilenmedi');

  // ---------- 9) canFinishWith14 / handCanFinish varyant farkındalığı (GEÇERLİ el şartıyla) ----------
  const winRealOkey = win14.length ? s3.realOkey : null; // s3'ten realOkey referansı (yukarıda kuruldu)
  assert.ok(E.canFinishWith14(win14, s3.realOkey, 'okey101', 101), 'geçerli per + toplam>=101 → bitirilebilir');
  assert.ok(!E.canFinishWith14(low14, s4.realOkey, 'okey101', 101), 'geçerli per ama toplam<101 → bitirilemez');
  assert.ok(!E.canFinishWith14(garbage14, s5.realOkey, 'okey101', 101),
    'GEÇERSİZ el (toplamı tam 101 olsa da) → bitirilemez (düzeltme)');
  assert.ok(E.canFinishWith14(pairHand, s6.realOkey, 'okey101', 101), '7 çift → bitirilebilir (puan şartsız)');
  assert.ok(E.handCanFinish(win14.concat([extra3]), s3.realOkey, 'okey101', 101),
    '15 taşlı elden geçerli 101 bitişi bulunabilir');
  assert.ok(!E.handCanFinish(garbage14.concat([extra5]), s5.realOkey, 'okey101', 101), 'geçersiz 15 taşlık el bitirilemez');
  // Standart yol (variant verilmezse) eski davranışını korur:
  const roX = { c: 't-red', n: 5 };
  assert.strictEqual(typeof E.canFinishWith14(pairHand, roX), 'boolean', 'standart imza değişmedi');
  assert.strictEqual(typeof E.handCanFinish(pairHand.concat([T(13, 't-blue')]), roX), 'boolean');
  console.log('  ✓ 9) canFinishWith14/handCanFinish: 101\'de artık GEÇERLİ el şartı da aranıyor');

  // ---------- 10) remainingPointsOf ----------
  const s10 = E.startRound(1, [0, 1, 2, 3], {}, () => 0.42, 0, 'okey101');
  s10.hands[0] = tilesSumming(14, 50);
  s10.hands[1] = tilesSumming(14, 60);
  s10.hands[2] = tilesSumming(14, 70);
  s10.hands[3] = tilesSumming(14, 80);
  assert.strictEqual(E.remainingPointsOf(s10, 0), 210, '0 dışındakilerin toplamı');
  assert.strictEqual(E.remainingPointsOf(s10, 3), 180, '3 dışındakilerin toplamı');
  assert.strictEqual(E.remainingPointsOf(s10, 9), 260, 'masada olmayan koltuk: herkes sayılır');
  console.log('  ✓ 10) remainingPointsOf');

  // ---------- 11) Çekme/atma disiplini varyanttan bağımsız ----------
  const s11 = E.startRound(1, [0, 1, 2, 3], {}, () => 0.42, 0, 'okey101');
  assert.strictEqual(E.drawFromDeck(s11, 1).reason, 'not_your_turn', 'sırası olmayan çekemez');
  const d11 = E.drawFromDeck(s11, 0);
  assert.strictEqual(d11.ok, false, 'başlayan (phase=discard) çekemez');
  assert.strictEqual(d11.reason, 'must_discard');
  const th = E.discard(s11, 0, s11.hands[0][0].id);
  assert.ok(th.ok, 'başlayan atar');
  assert.strictEqual(s11.turn, 1, 'sıra sonrakine');
  assert.strictEqual(s11.phase, 'draw', 'sonraki önce çeker');
  console.log('  ✓ 11) çekme/atma disiplini okey101de de geçerli');

  console.log('✅ OKEY101-ENGINE: TUM TESTLER BASARILI');
}

main();
