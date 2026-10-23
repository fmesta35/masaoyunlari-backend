'use strict';
/* PASSAPAROLA SORU HAVUZU — kullanıcı isteği: "en az 500/1000 farklı
   yarışma için sorular, zorluk seviyeleri karışık olsun". */
const assert = require('assert');
const E = require('../passaparola-engine.js');
const h = E.havuzYukle();
const toplam = E.havuzBoyutu();
assert.ok(toplam >= 1000, 'havuzda en az 1000 soru olmalı: ' + toplam);
const ust = c => ({ i: 'İ', ı: 'I' }[c] || c.toLocaleUpperCase('tr-TR'));
E.HARFLER.forEach(L => {
  const l = h[L] || [];
  assert.ok(l.length >= 30, L + ' harfinde en az 30 soru olmalı: ' + l.length);
  const z = new Set(l.map(q => Number(q.zorluk || 2)));
  assert.ok(z.has(1) && z.has(2) && z.has(3), L + ' harfinde üç zorluk seviyesi de olmalı');
  l.forEach(q => {
    assert.strictEqual(ust(q.answer[0]), L, `"${q.answer}" cevabı ${L} ile başlamalı`);
    assert.ok(q.question.length > 10, 'soru metni olmalı: ' + q.answer);
    assert.ok(E.cevapDogruMu(q.answer, q.answer, q.alternatives), 'cevap kendisiyle eşleşmeli: ' + q.answer);
  });
});
console.log('  ✓ 1) havuz: ' + toplam + ' soru, her harfte ≥30 soru ve 3 zorluk seviyesi');
const goruldu = new Set();
for (let i = 0; i < 1000; i++) {
  const st = E.macBaslat({ seats: [0, 1], sureSn: 60 });
  assert.strictEqual(Object.keys(st.sorular).length, 27, 'her yarışmada 27 harf');
  goruldu.add(E.HARFLER.map(L => st.sorular[L].answer).join('|'));
}
assert.ok(goruldu.size >= 990, '1000 maçta neredeyse hepsi farklı yarışma olmalı: ' + goruldu.size);
const st1 = E.macBaslat({ seats: [0, 1], setId: 1, sureSn: 60 });
assert.strictEqual(st1.setAdi, 'Standart Klasik Set', 'setId verilince sabit set korunmalı');
console.log('  ✓ 2) 1000 maçta ' + goruldu.size + ' farklı yarışma; sabit setler hâlâ seçilebiliyor');
console.log('OK passaparola soru havuzu');
