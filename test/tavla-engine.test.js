'use strict';

/*
 * Tavla motoru birim testleri — kurallar:
 *  başlangıç dizilimi, yön, kapalı kapı, vuruş, bar zorunluluğu,
 *  toplama (tam zar / büyük zar), zar-maksimizasyonu (büyük zar zorunlu),
 *  çift zar (4 hamle), geri alma, kazanma.
 */

const assert = require('assert');
const E = require('../tavla-engine');

function empty() {
  const s = E.init();
  s.points = Array(24).fill(null).map(() => ({ color: null, count: 0 }));
  s.bar = { w: 0, b: 0 };
  s.off = { w: 0, b: 0 };
  s.history = [];
  return s;
}

function put(s, i, color, count) {
  s.points[i] = { color, count };
}

function step(s, from, to) {
  const legal = E.legalSteps(s);
  const f = legal.find(x => x.from === from && x.to === to);
  assert.ok(f, `beklenen yasal hamle yok: ${from}->${to} (yasallar: ${JSON.stringify(legal)})`);
  E.applyStep(s, f);
  return f;
}

// --- 1) başlangıç dizilimi ---
{
  const s = E.init();
  const w = s.points.filter(p => p.color === 'w').reduce((n, p) => n + p.count, 0);
  const b = s.points.filter(p => p.color === 'b').reduce((n, p) => n + p.count, 0);
  assert.strictEqual(w, 15, 'beyazın 15 pulu olmalı');
  assert.strictEqual(b, 15, 'siyahın 15 pulu olmalı');
  assert.strictEqual(s.turn, 'w');
  console.log('  ✓ başlangıç dizilimi (15+15 pul, beyaz başlar)');
}

// --- 2) yön ve basit hamle ---
{
  const s = empty();
  put(s, 7, 'w', 2);
  E.roll(s, [3, 1]);
  step(s, 7, 4); // beyaz azalan indekse
  assert.strictEqual(s.points[4].count, 1);
  assert.strictEqual(s.points[4].color, 'w');
  assert.deepStrictEqual(s.movesLeft, [1]);
  step(s, 4, 3);
  assert.strictEqual(s.movesLeft.length, 0);
  console.log('  ✓ hareket yönü ve zar tüketimi');
}

// --- 3) kapalı kapı bloklar, tek taş (blot) vurulur ---
{
  const s = empty();
  put(s, 7, 'w', 1);
  put(s, 4, 'b', 2);          // kapalı kapı
  put(s, 6, 'b', 1);          // blot
  E.roll(s, [3, 1]);
  const legal = E.legalSteps(s);
  assert.ok(!legal.some(x => x.from === 7 && x.to === 4), 'kapalı kapıya gidilemez');
  assert.ok(legal.some(x => x.from === 7 && x.to === 6), 'blot vurulabilir');
  step(s, 7, 6);
  assert.strictEqual(s.bar.b, 1, 'vurulan siyah bara gitmeli');
  assert.strictEqual(s.points[6].color, 'w');
  console.log('  ✓ kapalı kapı bloklandı + vuruş bara gitti');
}

// --- 4) bar zorunluluğu ---
{
  const s = empty();
  put(s, 10, 'w', 2);
  s.bar.w = 1;
  put(s, 23, 'b', 2); // w girişi 24-1=23 kapalı
  E.roll(s, [3, 1]);
  const legal = E.legalSteps(s);
  assert.ok(legal.length > 0 && legal.every(x => x.from === 'bar'), 'bar varken yalnız bar hamlesi');
  assert.ok(!legal.some(x => x.to === 23), 'kapalı kapıya giriş yok');
  step(s, 'bar', 21); // w: 24-3=21
  assert.strictEqual(s.bar.w, 0);
  console.log('  ✓ bar önceliği ve giriş karesi kuralı');
}

// --- 5) toplama: tam zar ve büyük zar kuralı ---
{
  const s = empty();
  put(s, 4, 'w', 1);  // mesafe 5
  put(s, 1, 'w', 1);  // mesafe 2
  put(s, 0, 'w', 13); // toplama bölgesinde
  E.roll(s, [5, 2]);
  const legal = E.legalSteps(s);
  assert.ok(legal.some(x => x.from === 4 && x.to === 'off'), 'tam zar ile çıkış');
  assert.ok(legal.some(x => x.from === 1 && x.to === 'off'), '2 zarı ile çıkış');
}
{
  const s = empty();
  put(s, 4, 'w', 1);  // mesafe 5
  put(s, 0, 'w', 14);
  E.roll(s, [6, 1]);
  // Büyük zar (6) yalnızca EN GERİDEKİ puldan çıkış verir: 4 (mesafe 5 <6) üstünde
  // daha geride pul yok → izinli. 0 (mesafe 1) için 6 YASAK.
  const legal = E.legalSteps(s);
  assert.ok(legal.some(x => x.from === 4 && x.to === 'off'), 'büyük zar en gerideki puldan çıkış yapar');
  assert.ok(!legal.some(x => x.from === 0 && x.to === 'off' && x.die === 6), 'öndeki pul büyük zarla çıkamaz');
  console.log('  ✓ toplama: tam zar + büyük zar yalnız en gerideki puldan');
}

// --- 6) zar-maksimizasyonu kuralları ---
{
  // 6a) İki zar da her sırada kullanılabiliyorsa iki ilk adım da yasal
  const s = empty();
  put(s, 7, 'w', 1);
  s.off.w = 14;
  E.roll(s, [3, 2]);
  // 3: 7→4 (sonra 2: 4→2) ✓ ; 2: 7→5 (sonra 3: 5→2) ✓ — ikisi de 2 zar kullanır.
  const legal = E.legalSteps(s);
  assert.ok(legal.some(x => x.from === 7 && x.to === 4 && x.die === 3), '3 ile başlama yasal');
  assert.ok(legal.some(x => x.from === 7 && x.to === 5 && x.die === 2), '2 ile başlama yasal');
  console.log('  ✓ mümkünse iki zar da kullanılmak zorunda (iki ilk adım da açık)');
}
{
  // 6b) Yalnızca bir zar oynanabiliyorsa o zar zorunlu (diğer kapı kapalı)
  const s = empty();
  put(s, 10, 'w', 1);
  put(s, 8, 'b', 2); // 10-2 kapalı
  put(s, 2, 'b', 2); // 6 ile 10→4 sonrası 4→2 kapalı kalsın
  E.roll(s, [6, 2]);
  const legal = E.legalSteps(s);
  assert.ok(legal.length === 1 && legal[0].die === 6 && legal[0].to === 4,
    'yalnız 6 oynanabiliyorsa 6 zorunlu (2 kapalı)');
  console.log('  ✓ tek zar oynanabiliyorsa o zorunlu; ikisi de kapalıysa pas');
}
{
  // 6c) İki zar TEKER TEKER oynanabilir ama BİRLİKTE değil → büyük zar zorunlu
  const s = empty();
  put(s, 10, 'w', 1);
  put(s, 2, 'b', 2); // her iki zincirin ikinci adım inişi (8→2 / 4→2) kapalı
  E.roll(s, [2, 6]);
  // Zincir A: 2 ile 10→8 açık, sonra 6 ile 8→2 kapalı → 1 zar, toplam 2
  // Zincir B: 6 ile 10→4 açık, sonra 2 ile 4→2 kapalı → 1 zar, toplam 6  → BÜYÜK zorunlu
  const legal = E.legalSteps(s);
  assert.ok(legal.length === 1 && legal[0].die === 6 && legal[0].to === 4,
    'birlikte kullanılamıyorsa BÜYÜK zar zorunlu');
  console.log('  ✓ iki zar birlikte kullanılamıyorsa büyük zar zorunlu');
}

// --- 7) çift zar: 4 hamle ---
{
  const s = empty();
  put(s, 7, 'w', 4);
  E.roll(s, [5, 5]);
  assert.deepStrictEqual(s.movesLeft, [5, 5, 5, 5]);
  step(s, 7, 2);
  assert.strictEqual(s.movesLeft.length, 3);
  console.log('  ✓ çift zar 4 hamle verir');
}

// --- 8) geri alma ---
{
  const s = empty();
  put(s, 7, 'w', 2);
  E.roll(s, [3, 1]);
  step(s, 7, 4);
  assert.ok(E.undo(s), 'geri alma mümkün');
  assert.strictEqual(s.points[7].count, 2);
  assert.deepStrictEqual(s.movesLeft.sort(), [1, 3]);
  console.log('  ✓ geri alma durumu eksiksiz döndürüyor');
}

// --- 9) kazanma tespiti ---
{
  const s = empty();
  put(s, 0, 'w', 1);
  s.off.w = 14;
  E.roll(s, [1, 1]);
  step(s, 0, 'off');
  assert.strictEqual(s.winner, 'w', '15. pul çıkınca kazanan belli olur');
  console.log('  ✓ kazanma tespiti (15/15)');
}

console.log('OK tavla engine unit tests');
process.exit(0);
