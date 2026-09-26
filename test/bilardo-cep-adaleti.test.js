'use strict';
/* ============================================================================
 * BİLARDO — BÜTÜN CEPLER AYNI ZORLUKTA
 * ============================================================================
 * Kullanıcı sorusu (verbatim): "tüm delikler aynı derecede topu sokma oranına
 * mı sahip? bazı delikler daha büyük bazılarına daha kolay giriyormuş gibi
 * geldi, hepsini test et ve buna göre düzelt."
 *
 * ÖLÇÜM YÖNTEMİ: masaya yayılmış onlarca noktadan cebin MERKEZİNE nişan alıp
 * kaç atışın girdiğine bakılır (oyuncunun gerçekte yaptığı şey budur).
 *
 * ESKİ DEĞERLERLE ÖLÇÜLEN (gerçek motor, 44 nokta):
 *     köşe cepler %4.5   —   orta cepler %57.1   → 52.6 puan fark
 * KÖK NEDEN: köşe ağzı 0.115 m ve çene yarıçapı 0.012 m ile köşegen boyunca
 * NET açıklık 0.0573 m çıkıyordu; top çapı 0.0571 m. Top ağza 0.2 mm payla
 * giriyor, pratikte hep çeneye çarpıp dönüyordu. Orta ceplerde net açıklık
 * 0.101 m (topun 1.77 katı) olduğu için onlar rahat çalışıyordu.
 * DÜZELTME: köşe ağzı 0.143 m, çene yarıçapı 0.010 m; orta ağız 0.133 m.
 *
 * Doğrulananlar:
 *  1) Dört KÖŞE cep birbirinin AYNISI (fark yok).
 *  2) İki ORTA cep birbirinin AYNISI.
 *  3) Köşe ile orta arasındaki fark küçük (≤ 10 puan).
 *  4) Her cep, makul bir mesafeden merkeze nişan alınınca topu KABUL EDİYOR.
 *  5) Köşe ağzının net açıklığı top çapından belirgin biçimde geniş.
 * ========================================================================= */

const assert = require('assert');
const e = require('../bilardo-engine.js');
const P = e.physics, C = e.constants, I = e._internals;
const R = I.R, L = P.tableLength, W = P.tableWidth, S = C.scale;

const cepler = C.pockets.map((p, i) => ({
  i, kind: p.kind, x: (p.x - C.L) / S, y: (C.B - p.y) / S, r: p.r / S
}));
assert.strictEqual(cepler.length, 6, 'masada 6 cep olmalı');

function dene(bx, by, hx, hy, hiz) {
  const st = e.init();
  st.balls.forEach(b => { if (b.id !== 'cue') b.potted = true; });   // tek top
  const cue = st.balls.find(b => b.id === 'cue');
  cue.x = bx; cue.y = by; cue.potted = false;
  cue.vx = cue.vy = cue.vz = cue.wx = cue.wy = cue.wz = 0; cue.z = 0;
  const a = Math.atan2(hy - by, hx - bx);
  cue.vx = Math.cos(a) * hiz; cue.vy = Math.sin(a) * hiz;
  const shot = { potted: [], events: [], frames: [] };
  I.simulate(st, shot);
  return shot.potted.indexOf('cue') >= 0;
}

/* Masaya yayılmış nişan noktaları (cebe en az 40 cm uzak). */
const noktalar = [];
/* Izgara ne kadar seyrek olursa ölçüm o kadar gürültülü olur; 9×5'te
   sonuç oturuyor (45 nokta, cebe 40 cm'den yakın olanlar elenir). */
for (let i = 1; i <= 9; i++) for (let j = 1; j <= 5; j++) noktalar.push([L * i / 10, W * j / 6]);

const HIZ = 2.4;
const oranlar = cepler.map(cep => {
  let ok = 0, n = 0;
  for (const [x, y] of noktalar) {
    if (Math.hypot(x - cep.x, y - cep.y) < 0.40) continue;
    n++; if (dene(x, y, cep.x, cep.y, HIZ)) ok++;
  }
  return { cep, oran: ok / n * 100, ok, n };
});
for (const o of oranlar) {
  console.log('    cep ' + o.cep.i + ' (' + o.cep.kind + '): ' + o.ok + '/' + o.n +
              ' = %' + o.oran.toFixed(1));
}
const kose = oranlar.filter(o => o.cep.kind === 'corner').map(o => o.oran);
const orta = oranlar.filter(o => o.cep.kind === 'side').map(o => o.oran);
assert.strictEqual(kose.length, 4, '4 köşe cep olmalı');
assert.strictEqual(orta.length, 2, '2 orta cep olmalı');

// ---- 1-2) Aynı türdeki cepler birbirinin aynısı ----
assert.ok(Math.max(...kose) - Math.min(...kose) < 0.01,
  'dört köşe cep AYNI başarıyı vermeli — ' + kose.map(v => v.toFixed(1)).join(', '));
assert.ok(Math.max(...orta) - Math.min(...orta) < 0.01,
  'iki orta cep AYNI başarıyı vermeli — ' + orta.map(v => v.toFixed(1)).join(', '));
console.log('  ✓ 1) dört köşe cep birbirinin aynısı (%' + kose[0].toFixed(1) + ')');
console.log('  ✓ 2) iki orta cep birbirinin aynısı (%' + orta[0].toFixed(1) + ')');

// ---- 3) Köşe ile orta arasındaki fark küçük ----
const ort = a => a.reduce((x, y) => x + y, 0) / a.length;
const fark = Math.abs(ort(kose) - ort(orta));
assert.ok(fark <= 10,
  'köşe ve orta cepler benzer zorlukta olmalı — köşe %' + ort(kose).toFixed(1) +
  ', orta %' + ort(orta).toFixed(1) + ' (fark ' + fark.toFixed(1) + ' puan)');
console.log('  ✓ 3) köşe %' + ort(kose).toFixed(1) + ' / orta %' + ort(orta).toFixed(1) +
            ' — fark yalnız ' + fark.toFixed(1) + ' puan (eskiden 52.6)');

/* ---- 4) "Tam karşıdan" atış her cepte girer ----
   Her cebin doğal giriş doğrultusu vardır: köşede 45°'lik köşegen, orta
   cepte banda dik doğrultu. Oyuncunun "bu kesin girer" dediği atış budur;
   üç farklı mesafeden ve üç farklı güçte denenir. (Daha eğik açılardan
   çeneye çarpıp dönmek GERÇEKÇİDİR; ölçüt bu değil.) */
for (const cep of cepler) {
  const yon = cep.kind === 'corner'
    ? Math.atan2(W / 2 - cep.y, L / 2 - cep.x < 0 ? -1 : 1) * 0 +
      Math.atan2((cep.y < W / 2 ? 1 : -1), (cep.x < L / 2 ? 1 : -1))     // 45° köşegen
    : Math.atan2((cep.y < W / 2 ? 1 : -1), 0);                            // banda dik
  for (const mesafe of [0.5, 0.8, 1.1]) {
    const bx = cep.x + Math.cos(yon) * mesafe;
    const by = cep.y + Math.sin(yon) * mesafe;
    if (bx < R * 1.5 || bx > L - R * 1.5 || by < R * 1.5 || by > W - R * 1.5) continue;
    for (const hiz of [1.4, 2.4, 3.4]) {
      assert.ok(dene(bx, by, cep.x, cep.y, hiz),
        'cep ' + cep.i + ' (' + cep.kind + '): tam karşıdan ' + mesafe +
        ' m, hız ' + hiz + ' — top GİRMELİ');
    }
  }
}
console.log('  ✓ 4) altı cebin hepsi tam karşıdan gelen topu her mesafede kabul ediyor');

// ---- 5) Köşe ağzı top çapından belirgin geniş ----
const topCap = 2 * R;
const koseR = cepler.find(c => c.kind === 'corner').r;
assert.ok(koseR > topCap * 1.1,
  'köşe cebin yakalama yarıçapı top çapından geniş olmalı');
console.log('  ✓ 5) köşe yakalama yarıçapı ' + koseR.toFixed(4) + ' m, top çapı ' +
            topCap.toFixed(4) + ' m');

console.log('OK bilardo cep adaleti');
process.exit(0);
