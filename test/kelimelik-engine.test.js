'use strict';
/* KELİMELİK MOTORU — sunucu kuralları.
   Sözlük, puanlama, otomatik pas, üst üste 3 pas diskalifiyesi, harf
   değişimi ve bitiş akışı burada doğrulanır. */
const assert = require('assert');
const e = require('../kelimelik-engine');

// ---- sözlük: Kelimelik kuralı (madde başı, ek almış biçim YOK) ----
assert.ok(e.sozlukBoyu() > 50000, 'sözlük yüklenmedi');
assert.strictEqual(e.sozluktekiMi('KEDİ'), true);
assert.strictEqual(e.sozluktekiMi('GELMEK'), true);
assert.strictEqual(e.sozluktekiMi('GEL'), false, 'fiil kökü geçerli olmamalı');
assert.strictEqual(e.sozluktekiMi('KEDİLER'), false, 'ek almış biçim geçerli olmamalı');
assert.strictEqual(e.sozluktekiMi('ZXQW'), false);
assert.strictEqual(e.sozluktekiMi('TÜRKİYE'), true, 'ülke adı kabul edilmeli');
assert.strictEqual(e.sozluktekiMi('PH'), false, 'element/kısaltma maddesi elenmeli');

// ---- kuruluş ----
let st = e.init({ turnLimitMs: 60000 });
assert.strictEqual(st.board.length, 15);
assert.strictEqual(st.racks[0].length, 7);
assert.strictEqual(st.racks[1].length, 7);
assert.strictEqual(st.bag.length, 100 - 14);
assert.strictEqual(st.turn, 0);

// ---- ilk hamle kuralları ----
st.racks[0] = ['K', 'E', 'D', 'İ', 'A', 'L', 'M'];
assert.strictEqual(e.play(st, 1, [{ r: 7, c: 7, harf: 'K' }]).reason, 'not_your_turn');
assert.strictEqual(e.play(st, 0, [{ r: 0, c: 0, harf: 'K' }, { r: 0, c: 1, harf: 'E' }]).reason, 'merkezden_gecmeli');
assert.strictEqual(e.play(st, 0, [{ r: 7, c: 7, harf: 'K' }]).reason, 'en_az_iki_harf');
assert.strictEqual(e.play(st, 0, [{ r: 7, c: 7, harf: 'Z' }, { r: 7, c: 8, harf: 'Z' }]).reason, 'istakanda_yok');
let red = e.play(st, 0, [{ r: 7, c: 7, harf: 'K' }, { r: 7, c: 8, harf: 'M' }]);
assert.strictEqual(red.reason, 'sozlukte_yok');
assert.deepStrictEqual(red.kelimeler, ['KM']);

// KEDİ: K1+E1+D3+İ1 = 6, merkez K² → 12
let r = e.play(st, 0, [{ r: 7, c: 7, harf: 'K' }, { r: 7, c: 8, harf: 'E' },
                       { r: 7, c: 9, harf: 'D' }, { r: 7, c: 10, harf: 'İ' }]);
assert.strictEqual(r.ok, true);
assert.strictEqual(r.puan, 12, 'merkez kelime×2 uygulanmalı');
assert.strictEqual(st.scores[0], 12);
assert.strictEqual(st.turn, 1);
assert.strictEqual(st.racks[0].length, 7, 'ıstaka yeniden dolmalı');

// ---- temas kuralı: boşlukta duran hamle reddedilir ----
st.racks[1] = ['A', 'T', 'E', 'Ş', 'L', 'İ', 'M'];
assert.strictEqual(e.play(st, 1, [{ r: 0, c: 0, harf: 'A' }, { r: 0, c: 1, harf: 'T' }]).reason, 'temas_yok');
// tek hat dışı
assert.strictEqual(e.play(st, 1, [{ r: 6, c: 7, harf: 'A' }, { r: 5, c: 8, harf: 'T' }]).reason, 'tek_hat_degil');

// ---- yan kelime denetimi: kesişen kelime de sözlükte olmalı ----
// 'AT' dikey, K'nin üstüne: A(6,7) T(5,7)? -> KEDİ'nin K'si (7,7) ile ATK olur
let st2 = e.init();
st2.board[7][7] = { harf: 'K', joker: false };
st2.board[7][8] = { harf: 'E', joker: false };
st2.board[7][9] = { harf: 'D', joker: false };
st2.board[7][10] = { harf: 'İ', joker: false };
st2.racks[0] = ['A', 'T', 'E', 'Ş', 'L', 'İ', 'M'];
st2.turn = 0;
assert.strictEqual(e.play(st2, 0, [{ r: 5, c: 7, harf: 'A' }, { r: 6, c: 7, harf: 'T' }]).reason,
  'sozlukte_yok', 'ATK yan kelimesi reddedilmeli');

// ---- joker 0 puan ----
let st3 = e.init();
st3.racks[0] = ['*', 'E', 'D', 'İ', 'A', 'L', 'M'];
let rj = e.play(st3, 0, [{ r: 7, c: 7, harf: 'K', joker: true }, { r: 7, c: 8, harf: 'E' },
                         { r: 7, c: 9, harf: 'D' }, { r: 7, c: 10, harf: 'İ' }]);
assert.strictEqual(rj.ok, true);
assert.strictEqual(rj.puan, 10, 'joker 0 puan sayılmalı (0+1+3+1)*2');

// ---- BİNGO: yedi harfin tamamı +35 ----
let st4 = e.init();
st4.racks[0] = 'ATEŞLİK'.split('');
let kel = 'ATEŞLİK';
let kon = kel.split('').map((h, i) => ({ r: 7, c: 4 + i, harf: h }));
if (e.sozluktekiMi(kel)) {
  let rb = e.play(st4, 0, kon);
  assert.strictEqual(rb.ok, true);
  assert.strictEqual(rb.bingo, true);
  assert.ok(rb.puan >= 35 + 7, 'bingo eklenmeli');
}

// ---- İKİ TARAF DA ÜST ÜSTE PAS: maç biter (Kelimelik'in kendi kuralı) ----
let st5a = e.init();
e.pas(st5a, 0, false); e.pas(st5a, 1, false);
e.pas(st5a, 0, false);
assert.strictEqual(st5a.status, 'playing');
let dort = e.pas(st5a, 1, false);
assert.strictEqual(dort.bitti, true, 'dört üst üste pas maçı bitirmeli');
assert.strictEqual(st5a.result.reason, 'all_passed');

// ---- PAS: üst üste 3 pas → diskalifiye, puan silinir, rakip kazanır ----
// (rakip arada hamle yaptığı için toplam sayaç sıfırlanır; diskalifiye
//  yalnız AYNI oyuncunun üst üste pasından doğar)
let st5 = e.init();
st5.scores = [40, 10];
assert.strictEqual(e.pas(st5, 0, false).ok, true);
assert.strictEqual(st5.passStreak[0], 1);
assert.strictEqual(st5.turn, 1);
st5.turn = 0; st5.totalPasses = 0;        // rakip hamle yaptı
e.pas(st5, 0, false);
assert.strictEqual(st5.passStreak[0], 2);
st5.turn = 0; st5.totalPasses = 0;        // rakip yine hamle yaptı
let dq = e.pas(st5, 0, false);
assert.strictEqual(dq.diskalifiye, true, '3. pasta diskalifiye olmalı');
assert.strictEqual(st5.status, 'finished');
assert.strictEqual(st5.winner, 1, 'rakip hükmen kazanmalı');
assert.strictEqual(st5.scores[0], 0, 'diskalifiye olanın puanı silinmeli');

// ---- HARF DEĞİŞTİR: pas sayacını sıfırlar, torbadan taş alır ----
let st6 = e.init();
st6.passStreak[0] = 2;
const torbaOnce = st6.bag.length;
let t = e.takas(st6, 0, [0, 1, 2]);
assert.strictEqual(t.ok, true);
assert.strictEqual(st6.racks[0].length, 7);
assert.strictEqual(st6.bag.length, torbaOnce, 'torbadaki toplam taş korunmalı');
assert.strictEqual(st6.passStreak[0], 0, 'değişim üst üste pas sayacını sıfırlamalı');
assert.strictEqual(st6.turn, 1);
let st7 = e.init(); st7.bag = [];
assert.strictEqual(e.takas(st7, 0, [0]).reason, 'torba_bos');

// ---- OTOMATİK PAS: yalnız torba boşken ve gerçekten hamle yoksa ----
let st8 = e.init();
assert.strictEqual(e.otomatikPasGerekli(st8), false, 'torba doluyken otomatik pas olmamalı');
st8.bag = [];
st8.racks[0] = ['Ğ', 'Ğ'];
assert.strictEqual(e.hamleVarMi(st8, 0), false, 'boş tahtada ĞĞ ile hamle yok');
assert.strictEqual(e.otomatikPasGerekli(st8), true);
st8.racks[0] = ['K', 'E', 'D', 'İ'];
assert.strictEqual(e.hamleVarMi(st8, 0), true);

// ---- BİTİŞ: torba boş + el bitti → kalan taş puanı aktarılır ----
let st9 = e.init();
st9.bag = [];
st9.board[7][7] = { harf: 'K', joker: false };
st9.board[7][8] = { harf: 'E', joker: false };
st9.board[7][9] = { harf: 'D', joker: false };
st9.board[7][10] = { harf: 'İ', joker: false };
st9.racks[0] = ['A', 'L'];                  // 'AL' oynayıp eli bitirecek
st9.racks[1] = ['J', 'Z'];                  // 10 + 4 = 14 puan ceza
st9.scores = [20, 30];
st9.turn = 0;
let son = e.play(st9, 0, [{ r: 8, c: 7, harf: 'A' }, { r: 9, c: 7, harf: 'L' }]);
assert.strictEqual(son.ok, true);
assert.strictEqual(st9.status, 'finished');
assert.strictEqual(st9.scores[1], 30 - 14, 'rakibin elindeki taş puanı düşülmeli');
assert.ok(st9.scores[0] >= 20 + 14, 'bitirene eklenmeli');

// ---- PES ET: puan silinir, rakip kazanır ----
let st10 = e.init(); st10.scores = [50, 10];
assert.strictEqual(e.pesEt(st10, 0).ok, true);
assert.strictEqual(st10.status, 'finished');
assert.strictEqual(st10.winner, 1);
assert.strictEqual(st10.scores[0], 0);

// ---- bitmiş maçta hamle kabul edilmez ----
assert.strictEqual(e.play(st10, 1, [{ r: 7, c: 7, harf: 'A' }]).reason, 'finished');
assert.strictEqual(e.pas(st10, 1, false).reason, 'finished');
assert.strictEqual(e.takas(st10, 1, [0]).reason, 'finished');

// ---- aynı kareye iki taş / tahtadaki kareye taş ----
let st11 = e.init();
st11.racks[0] = ['A', 'T', 'E', 'Ş', 'L', 'İ', 'M'];
assert.strictEqual(e.play(st11, 0, [{ r: 7, c: 7, harf: 'A' }, { r: 7, c: 7, harf: 'T' }]).reason, 'ayni_kare');
st11.board[7][7] = { harf: 'K', joker: false };
assert.strictEqual(e.play(st11, 0, [{ r: 7, c: 7, harf: 'A' }, { r: 7, c: 8, harf: 'T' }]).reason, 'kare_dolu');

console.log('OK kelimelik-engine');
