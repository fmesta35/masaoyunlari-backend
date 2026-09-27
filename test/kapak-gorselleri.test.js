'use strict';
/* ============================================================================
 * OYUN KAPAK GÖRSELLERİ — ÖLÇÜ ve BÜTÜNLÜK
 * ============================================================================
 * Kapaklar .game-thumb içinde `background-size:cover` ile gösterilir; kutunun
 * eni 140px ile ~300px arasında, boyu sabit 120px'tir. Kapak oranı 606/354 =
 * 1.712 olduğunda `cover` en kötü durumda ortadaki %68'lik bandı bırakır —
 * tools/kapak-ortak.py'deki GUVENLI_ORAN kuralı buna dayanır. Ölçü bozulursa
 * o hesap da bozulur ve ana cisimler küçük resimde kırpılır.
 *
 * Bu test:
 *   1) index.html'deki oyun listesindeki HER oyunun kapak dosyası var mı,
 *      gerçekten JPEG mi?
 *   2) Üretim betiğimizle çizilen fotoğraf kapakları (satranç, 101 okey)
 *      tam 606x354 mü?
 *   3) Hiçbir kapak sayfayı yavaşlatacak kadar büyük değil (<= 120 KB).
 *
 * NOT: okey.jpg ve battleship.jpg eski, farklı ölçülerde kapaklardır; ölçü
 * şartı yalnız betikle üretilenlere uygulanır (yanlış kırmızıya dönmesin).
 * ========================================================================= */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const KOK = path.join(__dirname, '..');
const KAPAK_DIZIN = path.join(KOK, 'assets', 'covers');
const OLCULU = ['chess.jpg', 'okey101.jpg'];     // tools/kapak-*-fotograf.py ürünleri
const AZAMI_KB = 120;

/* JPEG boyutunu başlıktan oku (SOF0..SOF15, DNL ve yeniden başlatma
   işaretçileri hariç). Harici bağımlılık istemiyoruz. */
function jpegOlcu(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const uz = buf.readUInt16BE(i + 2);
    const sofMu = (m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
    if (sofMu) return { y: buf.readUInt16BE(i + 5), g: buf.readUInt16BE(i + 7) };
    i += 2 + uz;
  }
  return null;
}

const html = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
const kapaklar = [...html.matchAll(/cover:'(assets\/covers\/[^']+)'/g)].map(m => m[1]);
assert.ok(kapaklar.length >= 13,
  'index.html\'de oyun kapakları bulunmalı — bulunan: ' + kapaklar.length);

let sayac = 0;
for (const yol of kapaklar) {
  const tam = path.join(KOK, yol);
  assert.ok(fs.existsSync(tam), yol + ': kapak dosyası eksik');
  const buf = fs.readFileSync(tam);
  const olcu = jpegOlcu(buf);
  assert.ok(olcu, yol + ': geçerli bir JPEG değil');
  const kb = buf.length / 1024;
  assert.ok(kb <= AZAMI_KB,
    yol + ': kapak çok büyük — ' + Math.round(kb) + ' KB (üst sınır ' + AZAMI_KB + ' KB)');
  sayac++;
}
console.log('  ✓ 1) ' + sayac + ' oyunun kapağı yerinde, hepsi geçerli JPEG ve ' +
            AZAMI_KB + ' KB altında');

for (const ad of OLCULU) {
  const buf = fs.readFileSync(path.join(KAPAK_DIZIN, ad));
  const olcu = jpegOlcu(buf);
  assert.strictEqual(olcu.g + 'x' + olcu.y, '606x354',
    ad + ': betikle üretilen kapak 606x354 olmalı (güvenli bant hesabı buna dayanır) — ' +
    olcu.g + 'x' + olcu.y);
}
console.log('  ✓ 2) betikle üretilen kapaklar (' + OLCULU.join(', ') + ') tam 606x354');

/* Üretim betikleri dursun: kapak yeniden üretilebilir olmalı. */
for (const b of ['kapak-ortak.py', 'kapak-satranc-fotograf.py', 'kapak-okey101-fotograf.py']) {
  assert.ok(fs.existsSync(path.join(KOK, 'tools', b)),
    'tools/' + b + ' bulunmalı — kapaklar yeniden üretilebilir kalmalı');
}
console.log('  ✓ 3) kapak üretim betikleri yerinde');
console.log('OK kapak görselleri (' + (sayac + OLCULU.length + 3) + ' kontrol)');
