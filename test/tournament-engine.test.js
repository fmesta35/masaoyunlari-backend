'use strict';
/* =====================================================================
   TURNUVA MOTORU — tekli eleme kuralları
   ---------------------------------------------------------------------
   Kullanıcının tarifi: "Mesela 16 kişi katıldı. 2'şerli gruplar hâlinde
   8 takım oluşur. Bu 8 takım da kendi içinde tekrar eşleşir ve 4, ardından
   2, derken çeyrek final, yarı final, final ve şampiyon belirlenir."
   ===================================================================== */
const assert = require('assert');
const T = require('../tournament-engine');

function uyeler(n) {
  return Array.from({ length: n }, (_, i) => ({ uid: i + 1, name: 'Oyuncu' + (i + 1) }));
}

// ---------- 1) 16 kişi → 4 tur, 8 + 4 + 2 + 1 maç ----------
{
  const b = T.braketKur(uyeler(16), 12345);
  assert.strictEqual(b.boy, 16);
  assert.strictEqual(b.turlar.length, 4, '16 kişi 4 tur eder');
  assert.deepStrictEqual(b.turlar.map(t => t.length), [8, 4, 2, 1]);
  assert.strictEqual(T.turAdi(4, 0), '1. Tur');
  assert.strictEqual(T.turAdi(4, 1), 'Çeyrek Final');
  assert.strictEqual(T.turAdi(4, 2), 'Yarı Final');
  assert.strictEqual(T.turAdi(4, 3), 'Final');
  // Herkes tam olarak bir kez eşleşmiş olmalı
  const uidler = b.turlar[0].flatMap(m => [m.a && m.a.uid, m.b && m.b.uid]).filter(Boolean);
  assert.strictEqual(new Set(uidler).size, 16, 'her üye ilk turda tam bir kez yer almalı');
  console.log('  ✓ 1) 16 kişi → 8/4/2/1 maç ve tur adları doğru');
}

// ---------- 2) Aynı tohum aynı kurayı verir ----------
{
  const a = T.braketKur(uyeler(8), 777);
  const b = T.braketKur(uyeler(8), 777);
  const c = T.braketKur(uyeler(8), 778);
  const oku = x => x.turlar[0].map(m => [m.a && m.a.uid, m.b && m.b.uid]);
  assert.deepStrictEqual(oku(a), oku(b), 'aynı tohum aynı eşleşmeyi vermeli');
  assert.notDeepStrictEqual(oku(a), oku(c), 'farklı tohum farklı kura vermeli');
  console.log('  ✓ 2) kura tohumla yeniden üretilebiliyor');
}

// ---------- 3) Sonuçlar işlenince galip üst tura taşınır ----------
{
  const b = T.braketKur(uyeler(8), 42);
  assert.strictEqual(T.oynanacakMaclar(b).length, 4, 'ilk turda 4 maç oynanmalı');

  // 1. turu oynat: her maçta 'a' kazansın
  b.turlar[0].forEach(m => {
    const r = T.sonucIsle(b, m.id, m.a.uid);
    assert.ok(r.ok, r.error);
  });
  assert.strictEqual(T.oynanacakMaclar(b).length, 2, 'yarı finalde 2 maç olmalı');
  assert.ok(b.turlar[1].every(m => m.a && m.b), 'yarı final eşleşmeleri dolmalı');

  b.turlar[1].forEach(m => T.sonucIsle(b, m.id, m.a.uid));
  assert.strictEqual(T.oynanacakMaclar(b).length, 1, 'final tek maç');
  assert.strictEqual(T.bittiMi(b), false, 'final oynanmadan turnuva bitmez');

  const final = b.turlar[2][0];
  const r = T.sonucIsle(b, final.id, final.b.uid);
  assert.ok(r.ok);
  assert.ok(r.sampiyon, 'final bitince şampiyon belirlenmeli');
  assert.strictEqual(r.sampiyon.uid, final.b.uid);
  assert.strictEqual(T.bittiMi(b), true);
  console.log('  ✓ 3) galipler üst tura taşınıyor, final şampiyonu belirliyor');
}

// ---------- 4) İkinin kuvveti olmayan katılım: BAY ----------
{
  const b = T.braketKur(uyeler(12), 9);
  assert.strictEqual(b.boy, 16, "12 kişi 16'lık brakete oturur");
  const bay = b.turlar[0].filter(m => m.durum === 'bay');
  assert.strictEqual(bay.length, 4, '4 kişi bay geçmeli');
  bay.forEach(m => assert.ok(m.kazanan, 'bay çeken oyuncu bir üst tura geçmeli'));
  // Bay galipleri üst turda yerini almış olmalı
  const ustDolu = b.turlar[1].some(m => m.a || m.b);
  assert.ok(ustDolu, 'bay galipleri üst tura taşınmalı');
  console.log('  ✓ 4) eksik katılımda bay uygulanıyor');
}

// ---------- 5) Hatalı sonuç reddedilir ----------
{
  const b = T.braketKur(uyeler(4), 5);
  const m = b.turlar[0][0];
  assert.strictEqual(T.sonucIsle(b, 'yok', 1).ok, false, 'olmayan maç reddedilmeli');
  assert.strictEqual(T.sonucIsle(b, m.id, 9999).ok, false, 'maçta olmayan oyuncu reddedilmeli');
  assert.ok(T.sonucIsle(b, m.id, m.a.uid).ok);
  assert.strictEqual(T.sonucIsle(b, m.id, m.b.uid).ok, false, 'biten maç tekrar sonuçlanamaz');
  console.log('  ✓ 5) geçersiz sonuçlar reddediliyor');
}

// ---------- 6) Üyenin sıradaki maçı ----------
{
  const b = T.braketKur(uyeler(4), 3);
  const m = b.turlar[0][0];
  const benim = T.uyeMaci(b, m.a.uid);
  assert.strictEqual(benim.id, m.id, 'üyenin sıradaki maçı bulunmalı');
  T.sonucIsle(b, m.id, m.a.uid);
  const sonraki = T.uyeMaci(b, m.a.uid);
  assert.ok(sonraki && sonraki.id !== m.id, 'kazanan bir üst turun maçında görünmeli');
  assert.strictEqual(T.uyeMaci(b, m.b.uid), null, 'elenen oyuncunun maçı kalmamalı');
  console.log('  ✓ 6) üyenin sıradaki maçı doğru bulunuyor');
}

console.log('OK turnuva motoru');
