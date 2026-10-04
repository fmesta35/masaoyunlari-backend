'use strict';
/* ============================================================================
 * LİNK PAYLAŞIM KAPAĞI (og:image) — WhatsApp / Instagram / X / Facebook
 * ============================================================================
 * Kullanıcı isteği: "masaoyunlari.com.tr linkini paylaştığımda WhatsApp'ta,
 * Instagram'da veya diğer sosyal medya platformlarında güzel bir kapak
 * fotoğrafı oyunlarımızı yansıtsın, linkle beraber o görsel gözüksün."
 *
 * ÖLÇÜLEN ESKİ DURUM: index.html `og:image` olarak
 * "assets/images/og-image.jpg" gösteriyordu ama O DOSYA YOKTU (assets/images
 * klasörü bile yoktu) ve yol GÖRECELİYDİ — önizleme robotları mutlak URL
 * ister. `og:url` de eski bir alan adını (gameverse.com) işaret ediyordu.
 * Sonuç: paylaşımlarda hiçbir görsel çıkmıyordu.
 *
 * BU TEST NE DOĞRULAR:
 *   1) og:image / twitter:image dosyası GERÇEKTEN var ve 1200x630.
 *   2) Dosya önizleme robotlarını zorlamayacak kadar küçük (<= 300 KB).
 *      (WhatsApp ~300 KB üstü görselleri sık sık atlar.)
 *   3) Bütün paylaşım adresleri MUTLAK ve https.
 *   4) Zorunlu etiketler eksiksiz: type, title, description, image,
 *      image:width/height, url, twitter:card=summary_large_image.
 *   5) Hiçbir yerde eski alan adı (gameverse.com) kalmamış.
 *   6) Üretim betiği duruyor (kapak yeniden üretilebilir).
 * ========================================================================= */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const KOK = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');

function meta(ad) {
  const re = new RegExp('<meta\\s+(?:property|name)="' + ad.replace(/[:]/g, '[:]') +
                        '"\\s+content="([^"]*)"', 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

// ---- 4) zorunlu etiketler
const zorunlu = ['og:type', 'og:title', 'og:description', 'og:image',
                 'og:image:width', 'og:image:height', 'og:url',
                 'twitter:card', 'twitter:image'];
for (const ad of zorunlu) {
  const v = meta(ad);
  assert.ok(v && v.trim(), ad + ': etiket eksik ya da boş');
}
assert.strictEqual(meta('twitter:card'), 'summary_large_image',
  'twitter:card büyük görselli kart olmalı (küçük kartta kapak minik çıkar)');
assert.strictEqual(meta('og:image:width'), '1200', 'og:image:width 1200 olmalı');
assert.strictEqual(meta('og:image:height'), '630', 'og:image:height 630 olmalı');
console.log('  ✓ 1) zorunlu paylaşım etiketlerinin hepsi yerinde');

// ---- 3) mutlak https adresler
for (const ad of ['og:image', 'twitter:image', 'og:url']) {
  const v = meta(ad);
  assert.ok(/^https:\/\//.test(v),
    ad + ' MUTLAK https adresi olmalı (önizleme robotları göreceli yolu çözemez) — ' + v);
  assert.ok(/masaoyunlari\.com\.tr/.test(v), ad + ' sitenin kendi alan adını göstermeli — ' + v);
}
console.log('  ✓ 2) og:image, twitter:image ve og:url mutlak https adresleri');

// ---- 5) eski alan adı kalmamış
/* Yorum satırlarında geçmiş anlatılırken adı geçebilir; ETİKET ve
   yapısal veri değerlerinde geçmemeli. */
const kodSatirlari = html.split('\n').filter(l => !/^\s*(\*|<!--|\s{5})/.test(l));
assert.ok(!/gameverse\.com/i.test(kodSatirlari.join('\n').replace(/<!--[\s\S]*?-->/g, '')),
  'eski alan adı (gameverse.com) hâlâ index.html içinde — paylaşımlar yanlış adrese gider');
console.log('  ✓ 3) eski alan adı temizlenmiş');

// ---- 1/2) görsel gerçekten var, doğru ölçüde ve makul boyutta
const gorselYol = meta('og:image').replace(/^https:\/\/[^/]+\//, '');
const tam = path.join(KOK, gorselYol);
assert.ok(fs.existsSync(tam),
  'og:image dosyası depoda YOK: ' + gorselYol + ' (eski sürümdeki hata tam olarak buydu)');
const buf = fs.readFileSync(tam);

/* JPEG ölçüsünü başlıktan oku — harici bağımlılık istemiyoruz. */
function jpegOlcu(b) {
  if (b.length < 4 || b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
    const uz = b.readUInt16BE(i + 2);
    const sof = (m >= 0xC0 && m <= 0xCF) && m !== 0xC4 && m !== 0xC8 && m !== 0xCC;
    if (sof) return { y: b.readUInt16BE(i + 5), g: b.readUInt16BE(i + 7) };
    i += 2 + uz;
  }
  return null;
}
const olcu = jpegOlcu(buf);
assert.ok(olcu, 'og görseli geçerli bir JPEG değil');
assert.strictEqual(olcu.g + 'x' + olcu.y, '1200x630',
  'paylaşım kapağı 1200x630 (1.91:1) olmalı — ' + olcu.g + 'x' + olcu.y);
const kb = Math.round(buf.length / 1024);
assert.ok(kb <= 300, 'paylaşım kapağı 300 KB altında olmalı (WhatsApp büyük görselleri atlar) — ' + kb + ' KB');
console.log('  ✓ 4) kapak dosyası var: ' + gorselYol + ' — ' + olcu.g + 'x' + olcu.y + ', ' + kb + ' KB');

// ---- 6) üretim betiği
assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-paylasim.py')),
  'tools/kapak-paylasim.py bulunmalı — kapak yeniden üretilebilir kalmalı');
console.log('  ✓ 5) üretim betiği (tools/kapak-paylasim.py) yerinde');


/* ---- 7) ETİKETLER ROBOTUN OKUYACAĞI İLK BAYTLARDA MI?
 * Kullanıcı raporu: "www.masaoyunlari.com.tr linkini paylaştığımda WhatsApp'ta,
 * Instagram'da link paylaşımı web site görseli gelmiyor." Etiketlerin hepsi
 * doğruydu — ama <head>'in SONUNDAYDI: önlerinde ~1570 satırlık gömülü CSS
 * vardı ve og:image dosyanın ~85 KB içinde başlıyordu. WhatsApp/Facebook
 * robotları sayfanın tamamını indirmez; ilk birkaç on KB'yi okuyup bırakır.
 * Bu yüzden etiketler GÖRÜLMÜYORDU. Düzeltme etiketleri <title>'ın hemen
 * altına taşıdı. Bu kontrol, ileride biri <head>'in başına yeniden büyük
 * bir <style> koyarsa hatanın SESSİZCE geri gelmesini engeller. */
const ROBOT_BUTCESI = 20 * 1024;      // güvenli sınır; gerçek robotlar daha fazlasını okur
for (const ad of ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:image']) {
  const re = new RegExp('<meta\\s+(?:property|name)="' + ad.replace(/[:]/g, '[:]') + '"');
  const yer = Buffer.byteLength(html.slice(0, html.search(re)), 'utf8');
  assert.ok(yer >= 0 && yer < ROBOT_BUTCESI,
    ad + ' sayfanın ' + Math.round(yer / 1024) + '. KB\'sinde — önizleme robotları buraya kadar ' +
    'okumaz. Etiketler <head>\'in EN BAŞINDA, büyük <style> bloklarından ÖNCE durmalı.');
}
/* Taşıma sırasında eski blok silinmeli: iki og:image varsa robot hangisini
   okuyacağını bilmez ve eski/yanlış kapak çıkabilir. */
for (const ad of ['og:image', 'og:url', 'og:title', 'twitter:card']) {
  const say = (html.match(new RegExp('<meta\\s+(?:property|name)="' + ad.replace(/[:]/g, '[:]') + '"', 'g')) || []).length;
  assert.strictEqual(say, 1, ad + ' etiketi ' + say + ' kez geçiyor — tam olarak 1 kez olmalı');
}
console.log('  ✓ 6) etiketler ilk 20 KB içinde ve tekrarsız (robot bütçesi)');

console.log('OK paylaşım kapağı (' + (zorunlu.length + 19) + ' kontrol)');
