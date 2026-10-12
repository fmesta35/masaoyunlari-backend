'use strict';
/* Metropol PAZAR: sabit fiyat, açık artırma, süre ve tur sınırı kuralları. */
const test = require('node:test');
const assert = require('node:assert');
const E = require('../metropol-engine.js');

function oyun(seats) {
  const st = E.macBaslat({ seats: seats, rng: () => 0.5 });
  return st;
}

test('sabit fiyat: ilk alan alır, para el değiştirir, pazar kapanır', () => {
  const st = oyun([0, 1, 2]);
  st.kare[1].sahip = 0;
  assert.ok(E.pazarAc(st, 0, 1, 'sabit', 100, 1000).ok);
  assert.strictEqual(E.zarAt(st, 0).reason, 'pazar_acik');
  assert.strictEqual(E.pazarSatinAl(st, 0, 1100).reason, 'alici_degil');
  const r = E.pazarSatinAl(st, 2, 1100);
  assert.ok(r.ok);
  assert.strictEqual(st.kare[1].sahip, 2);
  assert.strictEqual(st.oyuncu[2].para, E.BASLANGIC_PARA - 100);
  assert.strictEqual(st.oyuncu[0].para, E.BASLANGIC_PARA + 100);
  assert.strictEqual(E.pazarSatinAl(st, 1, 1200).reason, 'pazar_yok');
});

test('sabit fiyat: 30 sn dolunca teklif kapanır; ipotekli ve binalı tapu satılmaz', () => {
  const st = oyun([0, 1]);
  st.kare[3].sahip = 0;
  E.pazarAc(st, 0, 3, 'sabit', 80, 2000);
  assert.strictEqual(E.pazarSureDoldu(st, 2500), null);
  assert.strictEqual(E.pazarSureDoldu(st, 32000).tur, 'sabit');
  assert.strictEqual(st.pazar, null);
  st.kare[3].ipotek = true;
  assert.strictEqual(E.pazarAc(st, 0, 3, 'sabit', 80, 0).reason, 'ipotekli');
  assert.strictEqual(E.pazarAc(st, 0, 3, 'sabit', 5, 0).ok, false);
});

test('açık artırma: sıra, asgari teklif, çekilme, satıcı kararı', () => {
  const st = oyun([0, 1, 2]);
  st.kare[3].sahip = 0;
  assert.ok(E.pazarAc(st, 0, 3, 'artirma', 0, 5000).ok);
  const pz = st.pazar;
  assert.strictEqual(pz.baslangic, E.artirmaBaslangic(60));
  assert.deepStrictEqual(pz.sira, [1, 2]);
  assert.strictEqual(E.pazarTeklif(st, 2, 100, 5100).reason, 'not_your_turn');
  assert.strictEqual(E.pazarTeklif(st, 1, 10, 5100).reason, 'teklif_dusuk');
  assert.ok(E.pazarTeklif(st, 1, 70, 5100).ok);
  assert.ok(E.pazarTeklif(st, 2, 90, 5200).ok);
  assert.ok(E.pazarCekil(st, 1, 5300).ok);
  assert.strictEqual(st.pazar.asama, 'karar');
  assert.strictEqual(E.pazarKarar(st, 1, true, 5400).reason, 'satici_degil');
  const r = E.pazarKarar(st, 0, true, 5400);
  assert.ok(r.ok && r.satildi && r.alici === 2 && r.tutar === 90);
  assert.strictEqual(st.kare[3].sahip, 2);
});

test('açık artırma: reddedince tapu yerinde kalır; kişi başı en çok 3 teklif', () => {
  const st = oyun([0, 1, 2]);
  st.kare[3].sahip = 0;
  E.pazarAc(st, 0, 3, 'artirma', 0, 0);
  let t = E.artirmaBaslangic(60), n = 0;
  const say = { 1: 0, 2: 0 };
  while (st.pazar && st.pazar.asama === 'teklif' && n++ < 20) {
    const kim = st.pazar.sira[st.pazar.idx];
    assert.ok(E.pazarTeklif(st, kim, t, 10).ok);
    say[kim]++; t += 10;
  }
  assert.deepStrictEqual(say, { 1: 3, 2: 3 }, 'herkes en çok 3 teklif verir');
  assert.strictEqual(st.pazar.asama, 'karar');
  assert.ok(E.pazarKarar(st, 0, false, 20).ok);
  assert.strictEqual(st.kare[3].sahip, 0);
  assert.strictEqual(st.pazar, null);
});

test('açık artırma: oyuncu turda en çok 3 tapuyu açık artırmaya çıkarır', () => {
  const st = oyun([0, 1]);
  [5, 6, 8, 9].forEach(k => { st.kare[k].sahip = 0; });
  [5, 6, 8].forEach(k => {
    assert.ok(E.pazarAc(st, 0, k, 'artirma', 0, 6000).ok);
    while (st.pazar) E.pazarCekil(st, st.pazar.sira[st.pazar.idx], 6000);
  });
  assert.strictEqual(E.pazarAc(st, 0, 9, 'artirma', 0, 7000).reason, 'artirma_limiti');
  assert.strictEqual(E.gorunum(st, 0, {}).artirmaKalan, 0);
});

test('açık artırma: süre dolunca sıradaki çekilir, satıcı karar vermezse reddedilir', () => {
  const st = oyun([0, 1]);
  st.kare[1].sahip = 0;
  E.pazarAc(st, 0, 1, 'artirma', 0, 0);
  assert.strictEqual(E.pazarSureDoldu(st, 31000).tur, 'teklif');
  assert.strictEqual(st.pazar, null);
  st.kare[1].sahip = 0;
  E.pazarAc(st, 0, 1, 'artirma', 0, 40000);
  E.pazarTeklif(st, 1, E.artirmaBaslangic(E.KARELER[1].p), 40100);
  assert.strictEqual(st.pazar.asama, 'karar');
  assert.strictEqual(E.pazarSureDoldu(st, 80000).tur, 'karar');
  assert.strictEqual(st.kare[1].sahip, 0);
});
