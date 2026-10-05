'use strict';
/* ============================================================================
 * 101 OKEY MOTORU — kural doğrulaması
 * ============================================================================
 * Kullanıcının ilettiği kural metni esas alındı. Burada SOKET YOK; yalnız
 * motorun kuralları. Oyun kuralları sessizce kayarsa oyuncular fark eder ama
 * biz etmeyiz; bu yüzden her kural ayrı ayrı yazılı.
 * ========================================================================= */
const assert = require('assert');
const E = require('../okey101-engine.js');

const OKEY = { c: 't-red', n: 8 };            // gösterge 🔴7 ise okey 🔴8
let sayac = 0;
const T = (c, n, o) => Object.assign({ id: 't' + (++sayac), c, n, isFJ: false }, o || {});
const OK = () => T(OKEY.c, OKEY.n);           // gerçek okey taşı
const SAHTE = (ind) => ({ id: 't' + (++sayac), c: 't-joker', n: ind.n, dc: ind.c, isFJ: true });

// ---------- 1) PER: KÜT (aynı sayı, farklı renk) ----------
let r = E.perDogrula([T('t-red', 5), T('t-blue', 5), T('t-black', 5)], OKEY);
assert.ok(r.ok && r.tur === 'kut', 'üç farklı renkte 5 geçerli küt olmalı');
assert.strictEqual(r.puan, 15, 'küt puanı 3×5 = 15 olmalı');
r = E.perDogrula([T('t-red', 8), T('t-blue', 8), T('t-black', 8), T('t-yellow', 8)], OKEY);
assert.ok(r.ok && r.puan === 32, 'dört renkli 8 kütü 32 puan');
r = E.perDogrula([T('t-red', 5), T('t-red', 5), T('t-blue', 5)], OKEY);
assert.ok(!r.ok, 'kütte aynı renk iki kez kullanılamaz');
r = E.perDogrula([T('t-red', 5), T('t-blue', 5)], OKEY);
assert.ok(!r.ok, 'per en az 3 taş olmalı');
console.log('  ✓ 1) küt: aynı sayı/farklı renk, aynı renk tekrarı reddediliyor');

// ---------- 2) PER: SERİ (aynı renk, ardışık) ----------
r = E.perDogrula([T('t-blue', 10), T('t-blue', 11), T('t-blue', 12)], OKEY);
assert.ok(r.ok && r.tur === 'seri' && r.puan === 33, 'seri 10-11-12 = 33');
r = E.perDogrula([T('t-blue', 10), T('t-blue', 11), T('t-blue', 12), T('t-blue', 13)], OKEY);
assert.strictEqual(r.puan, 46, 'dört taşlı seri 46');
r = E.perDogrula([T('t-blue', 12), T('t-blue', 13), T('t-blue', 1)], OKEY);
assert.ok(!r.ok, '13\'ten 1\'e dönüşlü seri GEÇERSİZ olmalı');
r = E.perDogrula([T('t-blue', 3), T('t-blue', 5), T('t-blue', 7)], OKEY);
assert.ok(!r.ok, 'ardışık olmayan seri reddedilmeli');
r = E.perDogrula([T('t-blue', 4), T('t-red', 5), T('t-blue', 6)], OKEY);
assert.ok(!r.ok, 'seride renk değişemez');
console.log('  ✓ 2) seri: ardışık ve tek renk; 12-13-1 dönüşü reddediliyor');

// ---------- 3) OKEY (joker) kullanımı ----------
r = E.perDogrula([T('t-blue', 5), OK(), T('t-blue', 7)], OKEY);
assert.ok(r.ok && r.puan === 18, 'okey 6 yerine geçmeli: 5+6+7 = 18');
r = E.perDogrula([T('t-blue', 5), T('t-blue', 6), OK()], OKEY);
assert.ok(r.ok && r.puan === 18, 'okey seriyi uçtan uzatınca 5+6+7 = 18');
r = E.perDogrula([T('t-red', 9), T('t-blue', 9), OK()], OKEY);
assert.ok(r.ok && r.puan === 27, 'kütte okey eksik rengi temsil eder: 3×9 = 27');
r = E.perDogrula([T('t-blue', 5), OK(), OK()], OKEY);
assert.ok(!r.ok, 'bir perde en fazla 1 okey kullanılabilir (belirlediğimiz kural)');
/* SAHTE OKEY JOKER DEĞİLDİR: göstergenin yerine geçen normal bir taştır.
   Okeyde en sık karıştırılan nokta; motor da karıştırırsa el puanları yanlış
   hesaplanır. */
const ind = { c: 't-red', n: 7 };
r = E.perDogrula([T('t-red', 6), SAHTE(ind), T('t-red', 8)], OKEY);
assert.ok(r.ok && r.puan === 21, 'sahte okey 🔴7 olarak oynanır: 6+7+8 = 21');
r = E.perDogrula([T('t-blue', 2), SAHTE(ind), T('t-blue', 4)], OKEY);
assert.ok(!r.ok, 'sahte okey joker DEĞİL; 🔴7 olarak mavi seriye giremez');
console.log('  ✓ 3) okey joker, sahte okey gösterge taşı gibi davranıyor');

// ---------- 4) 5 ÇİFT ----------
const cift = (c, n) => [T(c, n), T(c, n)];
let g = [cift('t-red', 5), cift('t-blue', 8), cift('t-black', 10), cift('t-yellow', 3), cift('t-red', 12)];
assert.ok(E.ciftDogrula(g, OKEY).ok, '5 geçerli çift kabul edilmeli');
assert.ok(!E.ciftDogrula(g.slice(0, 4), OKEY).ok, '4 çift yetmez');
assert.ok(!E.ciftDogrula([[T('t-red', 5), T('t-blue', 5)]].concat(g.slice(1)), OKEY).ok,
  'çift aynı RENK ve aynı sayı olmalı');
assert.ok(E.ciftDogrula([[T('t-red', 5), OK()]].concat(g.slice(1)), OKEY).ok,
  'okey bir çifti tamamlayabilir');
assert.ok(!E.ciftDogrula([[OK(), OK()]].concat(g.slice(1)), OKEY).ok, 'iki okey bir çift olamaz');
console.log('  ✓ 4) çift açma: 5 çift, aynı renk+sayı, okey bir çifti tamamlıyor');

// ---------- 5) DAĞITIM: başlayan 22, diğerleri 21 ----------
for (const kisi of [2, 3, 4]) {
  const seats = Array.from({ length: kisi }, (_, i) => i);
  const st = E.startRound(1, seats, {}, () => 0.5, 0);
  const sayilar = seats.map(s => st.hands[s].length).sort((a, b) => a - b);
  const beklenen = seats.map(s => (s === 0 ? 22 : 21)).sort((a, b) => a - b);
  assert.deepStrictEqual(sayilar, beklenen, kisi + ' kişide dağıtım 22/21 olmalı');
  const toplam = seats.reduce((a, s) => a + st.hands[s].length, 0) + st.deck.length + 1;
  assert.strictEqual(toplam, 106, 'taşların tamamı sayılmalı (gösterge dahil)');
  assert.strictEqual(st.turn, 0, 'başlayan 22 taşlı oyuncu olmalı');
  assert.strictEqual(st.phase, 'discard', 'başlayan ÇEKMEDEN atar');
  assert.strictEqual(st.melds.length, 0, 'el başında masa boş');
  assert.strictEqual(st.opened[0], false, 'kimse açmamış olmalı');
}
console.log('  ✓ 5) dağıtım 2/3/4 kişide 22-21, 106 taş eksiksiz, başlayan atarak başlıyor');

// ---------- 6) OKEY BELİRLEME: gösterge + 1, 13 ise 1 ----------
{
  const st = E.startRound(1, [0, 1], {}, () => 0.3, 0);
  const bek = st.indicator.n >= 13 ? 1 : st.indicator.n + 1;
  assert.strictEqual(st.realOkey.n, bek, 'okey = gösterge + 1 (13 ise 1)');
  assert.strictEqual(st.realOkey.c, st.indicator.c, 'okey göstergeyle aynı renk');
  const sahteler = [].concat(...Object.values(st.hands), st.deck).filter(t => t.isFJ);
  assert.strictEqual(sahteler.length, 2, 'destede 2 sahte okey olmalı');
  sahteler.forEach(t => {
    assert.strictEqual(t.n, st.indicator.n, 'sahte okey göstergenin sayısını alır');
    assert.strictEqual(t.dc, st.indicator.c, 'sahte okey göstergenin rengini alır');
  });
}
console.log('  ✓ 6) okey = gösterge+1, sahte okeyler göstergeye bürünüyor');

/* ---------- 7) EL AÇMA: 101 altı reddedilir, 101 ve üstü kabul ---------- */
function elKur(eldekiler, opts) {
  const st = E.startRound(1, [0, 1], {}, () => 0.5, 0);
  st.hands[0] = eldekiler.slice();
  st.hands[1] = [T('t-black', 1), T('t-black', 2)];
  st.phase = (opts && opts.phase) || 'discard';
  st.turn = 0;
  st.realOkey = OKEY;
  return st;
}
{
  // 33 + 24 = 57 → yetmez
  const a = [T('t-red', 10), T('t-red', 11), T('t-red', 12),
             T('t-blue', 7), T('t-blue', 8), T('t-blue', 9), T('t-black', 13)];
  const st = elKur(a);
  const grup = [[a[0].id, a[1].id, a[2].id], [a[3].id, a[4].id, a[5].id]];
  const sonuc = E.openMelds(st, 0, grup);
  assert.ok(!sonuc.ok && sonuc.reason === 'below_101', '57 puanla açılamaz');
  assert.strictEqual(sonuc.puan, 57, 'hesaplanan puan 57 olmalı');
  assert.strictEqual(st.hands[0].length, 7, 'reddedilen açılışta taşlar ELE GERİ dönmeli');
  assert.strictEqual(st.melds.length, 0, 'reddedilen açılış masaya hiçbir şey koymamalı');
  assert.strictEqual(st.opened[0], false, 'reddedilen açılışta oyuncu açılmış sayılmaz');
}
{
  // 33 + 24 + 36 + 15 = 108 → kullanıcının kural metnindeki örnek
  const a = [T('t-red', 10), T('t-red', 11), T('t-red', 12),
             T('t-blue', 7), T('t-blue', 8), T('t-blue', 9),
             T('t-yellow', 12), T('t-red', 12), T('t-blue', 12),
             T('t-black', 4), T('t-black', 5), T('t-black', 6),
             T('t-black', 13)];
  const st = elKur(a);
  const grup = [[a[0].id, a[1].id, a[2].id], [a[3].id, a[4].id, a[5].id],
                [a[6].id, a[7].id, a[8].id], [a[9].id, a[10].id, a[11].id]];
  const s = E.openMelds(st, 0, grup);
  assert.ok(s.ok, 'kural metnindeki 108 puanlık örnek açılabilmeli: ' + JSON.stringify(s));
  assert.strictEqual(s.puan, 108, 'toplam 108 hesaplanmalı');
  assert.strictEqual(st.melds.length, 4, 'dört per masaya konmalı');
  assert.strictEqual(st.opened[0], true, 'oyuncu açılmış işaretlenmeli');
  assert.strictEqual(st.hands[0].length, 1, 'elde atılacak taş kalmalı');
}
console.log('  ✓ 7) el açma: 101 altı reddediliyor, 108 puanlık örnek açılıyor');

// ---------- 8) AÇILIŞ SIRASI VE TEKRAR AÇMA ----------
{
  const a = [T('t-red', 10), T('t-red', 11), T('t-red', 12), T('t-black', 1)];
  const st = elKur(a, { phase: 'draw' });
  const s = E.openMelds(st, 0, [[a[0].id, a[1].id, a[2].id]]);
  assert.strictEqual(s.reason, 'draw_first', 'taş çekmeden açılamaz');
}
{
  const a = [T('t-red', 10), T('t-red', 11), T('t-red', 12), T('t-black', 1)];
  const st = elKur(a);
  st.turn = 1;
  assert.strictEqual(E.openMelds(st, 0, [[a[0].id]]).reason, 'not_your_turn', 'sıra sende değilken açılamaz');
}
console.log('  ✓ 8) sıra ve çekme şartı açılışta da geçerli');

// ---------- 9) İŞLEME (açılmış pere taş ekleme) ----------
{
  const a = [T('t-red', 10), T('t-red', 11), T('t-red', 12),
             T('t-blue', 7), T('t-blue', 8), T('t-blue', 9),
             T('t-yellow', 12), T('t-red', 12), T('t-blue', 12),
             T('t-black', 4), T('t-black', 5), T('t-black', 6),
             T('t-red', 13), T('t-black', 1)];
  const st = elKur(a);
  E.openMelds(st, 0, [[a[0].id, a[1].id, a[2].id], [a[3].id, a[4].id, a[5].id],
                      [a[6].id, a[7].id, a[8].id], [a[9].id, a[10].id, a[11].id]]);
  const kirmiziSeri = st.melds.find(m => m.tiles.some(t => t.id === a[0].id));
  const s = E.addToMeld(st, 0, kirmiziSeri.id, a[12].id);   // 🔴13 → 10-11-12'ye
  assert.ok(s.ok, '🔴13, 🔴10-11-12 serisine işlenebilmeli: ' + JSON.stringify(s));
  assert.strictEqual(kirmiziSeri.tiles.length, 4, 'per dört taşa çıkmalı');
  const kotu = E.addToMeld(st, 0, kirmiziSeri.id, a[13].id); // ⚫1 uymaz
  assert.ok(!kotu.ok, 'uymayan taş işlenememeli');
  assert.strictEqual(kirmiziSeri.tiles.length, 4, 'reddedilen işleme peri bozmamalı');
  assert.ok(st.hands[0].some(t => t.id === a[13].id), 'reddedilen taş ELE geri dönmeli');
}
{
  // Açmamış oyuncu işleyemez
  const a = [T('t-red', 13), T('t-black', 1)];
  const st = elKur(a);
  st.melds.push({ id: 'm1', seat: 1, tur: 'seri',
                  tiles: [T('t-red', 10), T('t-red', 11), T('t-red', 12)] });
  assert.strictEqual(E.addToMeld(st, 0, 'm1', a[0].id).reason, 'not_opened',
    'açmadan işleme yapılamaz');
}
console.log('  ✓ 9) işleme: uyan taş ekleniyor, uymayan reddediliyor, açmayan işleyemiyor');

// ---------- 10) BİTİŞ VE CEZA PUANI ----------
{
  const a = [T('t-red', 10), T('t-red', 11), T('t-red', 12),
             T('t-blue', 7), T('t-blue', 8), T('t-blue', 9),
             T('t-yellow', 12), T('t-red', 12), T('t-blue', 12),
             T('t-black', 4), T('t-black', 5), T('t-black', 6),
             T('t-black', 1)];
  const st = elKur(a);
  st.hands[1] = [T('t-red', 9), T('t-blue', 4), OK()];     // 9 + 4 + okey(50) = 63
  st.opened[1] = true;                                      // açmış: katlanmaz
  E.openMelds(st, 0, [[a[0].id, a[1].id, a[2].id], [a[3].id, a[4].id, a[5].id],
                      [a[6].id, a[7].id, a[8].id], [a[9].id, a[10].id, a[11].id]]);
  const s = E.discard(st, 0, a[12].id);
  assert.ok(s.ok && s.finished, 'son taş atılınca el bitmeli');
  assert.strictEqual(st.result.winner, 0, 'bitiren 0. koltuk olmalı');
  assert.strictEqual(st.result.cezalar[0], 0, 'bitirene ceza yazılmaz');
  assert.strictEqual(st.result.cezalar[1], 63, 'kalan taşlar ceza: 9+4+okey(50) = 63');
  assert.strictEqual(st.scores[1], 63, 'ceza toplam puana eklenmeli');
}
{
  // AÇMAMIŞ oyuncunun cezası ikiye katlanır
  const st = E.startRound(1, [0, 1], {}, () => 0.5, 0);
  st.realOkey = OKEY;
  st.hands[1] = [T('t-red', 9), T('t-blue', 4)];            // 13
  st.opened[1] = false;
  assert.strictEqual(E.elCezasi(st, 1), 26, 'açmayanın cezası ikiye katlanmalı (13 → 26)');
  st.opened[1] = true;
  assert.strictEqual(E.elCezasi(st, 1), 13, 'açmışın cezası katlanmaz');
}
console.log('  ✓ 10) bitiş ve ceza: okey 50, açmayana ×2, bitirene 0');

// ---------- 11) AÇMADAN BİTİLEMEZ / ATACAK TAŞ KALMALI ----------
{
  const a = [T('t-red', 10), T('t-red', 11), T('t-red', 12),
             T('t-blue', 7), T('t-blue', 8), T('t-blue', 9),
             T('t-yellow', 12), T('t-red', 12), T('t-blue', 12),
             T('t-black', 4), T('t-black', 5), T('t-black', 6)];
  const st = elKur(a);
  const grup = [[a[0].id, a[1].id, a[2].id], [a[3].id, a[4].id, a[5].id],
                [a[6].id, a[7].id, a[8].id], [a[9].id, a[10].id, a[11].id]];
  const s = E.openMelds(st, 0, grup);
  assert.strictEqual(s.reason, 'need_discard_tile',
    'elin tamamını açıp atacak taş bırakmamak yasak olmalı');
  assert.strictEqual(st.hands[0].length, 12, 'reddedilen açılışta el eksiksiz dönmeli');
}
console.log('  ✓ 11) atacak taş bırakmadan açılamıyor');

// ---------- 12) ÇEKME: deste ve önceki oyuncunun atığı ----------
{
  const st = E.startRound(1, [0, 1, 2], {}, () => 0.5, 0);
  E.discard(st, 0, st.hands[0][0].id);
  assert.strictEqual(st.turn, 1, 'sıra sonraki koltuğa geçmeli');
  assert.strictEqual(st.phase, 'draw', 'yeni oyuncu önce çeker');
  const once = st.hands[1].length;
  /* 101 KURALI (kullanıcı raporu): açmadan yerden taş alınmaz. Önce
     reddedildiğini, sonra açmış oyuncuda çalıştığını ölçüyoruz. */
  const red = E.drawFromPrev(st, 1);
  assert.strictEqual(red.ok, false, 'açmamış oyuncu yerden taş alamamalı');
  assert.strictEqual(red.reason, 'acmadan_yerden_alinmaz', 'ret sebebi açık olmalı');
  assert.strictEqual(st.hands[1].length, once, 'reddedilen almada el değişmemeli');
  st.opened[1] = true;                       // bu oyuncu daha önce açmış say
  const d = E.drawFromPrev(st, 1);
  assert.ok(d.ok && d.from === 0, 'açmış oyuncu 0. koltuğun attığını alabilmeli');
  assert.strictEqual(st.hands[1].length, once + 1, 'taş ele eklenmeli');
  assert.strictEqual(E.drawFromDeck(st, 1).reason, 'must_discard', 'iki kez çekilemez');
  assert.strictEqual(E.drawFromPrev(st, 2).reason, 'not_your_turn', 'sırası olmayan çekemez');
}
{
  // Deste bitince el berabere
  const st = E.startRound(1, [0, 1], {}, () => 0.5, 0);
  st.deck = [];
  E.discard(st, 0, st.hands[0][0].id);
  const d = E.drawFromDeck(st, 1);
  assert.ok(d.deckEmpty && st.finished, 'deste bitince el kapanmalı');
  assert.strictEqual(st.result.winType, 'draw', 'beraberlik olmalı');
  assert.strictEqual(st.result.cezalar[0], 0, 'beraberlikte ceza yazılmaz');
}
console.log('  ✓ 12) çekme kaynakları, çift çekme engeli, deste bitince beraberlik');

// ---------- 13) MAÇ SONU: en DÜŞÜK ceza kazanır ----------
assert.strictEqual(E.macBittiMi({ 0: 40, 1: 90 }, [0, 1], 101), null, 'sınıra ulaşan yoksa maç sürer');
{
  const m = E.macBittiMi({ 0: 103, 1: 55, 2: 70 }, [0, 1, 2], 101);
  assert.ok(m, 'sınıra ulaşan varsa maç bitmeli');
  assert.strictEqual(m.winner, 1, 'EN DÜŞÜK ceza kazanmalı');
  assert.strictEqual(m.score, 55);
}
console.log('  ✓ 13) maç ceza sınırında bitiyor, en düşük toplam kazanıyor');

console.log('OK 101 okey motoru: per, açma, işleme, bitiş, ceza, maç sonu');
