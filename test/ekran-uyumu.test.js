'use strict';
/* ============================================================================
 * EKRAN UYUMU — simge kadrajı ve sistem çubuğu payları
 * ============================================================================
 * Kullanıcı isteği: "logosu biraz fazla zoom yapılmış gibi, zar ve tacın net
 * görünmesini sağla... mobil apk'da üst kısım aşağıya doğru kaydırılmış gibi
 * siyah boşluk çok... temanın tüm telefonlarda ekran optimizasyonu
 * sağlayacak şekilde sığdırılması."
 *
 * Bu test ekran görüntüsü karşılaştırmaz (kırılgan olur); bozulmanın GEÇTİĞİ
 * yerleri ölçer:
 *
 *  1) SİMGE KADRAJI — launcher simgeyi kendi maskesiyle (çoğu zaman DAİRE)
 *     kırpar. Konu tuvali doldurursa zarın köşeleri ve taç kesilir. Her
 *     katmanda konunun kapladığı oran ölçülüp sınırların içinde mi diye
 *     bakılıyor; ayrıca konu tuvalin KENARINA değmemeli.
 *  2) İNSET SÖZLEŞMESİ — native kabuk sistem çubuğu ölçülerini CSS
 *     değişkeni olarak yolluyor, site de onları üst barda kullanıyor.
 *     Zincirin iki ucundan biri koparsa telefonda üstte koyu bir şerit
 *     oluşur ya da içerik durum çubuğunun altında kalır. Üç parça birden
 *     denetleniyor: Java, js/webview.js bayrağı, index.html CSS'i.
 *  3) GÜVENLİK AĞI — kabuk, sayfadan onay almadan native dolguyu
 *     BIRAKMAMALI (eski site sürümü yüklenirse içerik çubuğun altında
 *     kalmasın).
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KOK = path.join(__dirname, '..');
const RES = path.join(KOK, 'android/app/src/main/res');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');

/* --- küçük PNG okuyucu: harici bağımlılık istemiyoruz --------------------
   Yalnız 8-bit RGBA PNG'leri çözer (bizim ürettiklerimiz öyle). Alfa
   kanalından konunun sınırlarını buluyoruz. */
function pngOku(yol) {
  const buf = fs.readFileSync(yol);
  assert.strictEqual(buf.readUInt32BE(0), 0x89504E47, yol + ': PNG değil');
  let p = 8, en = 0, boy = 0, derinlik = 0, tur = 0;
  const veri = [];
  while (p < buf.length) {
    const uz = buf.readUInt32BE(p);
    const ad = buf.toString('ascii', p + 4, p + 8);
    const govde = buf.slice(p + 8, p + 8 + uz);
    if (ad === 'IHDR') {
      en = govde.readUInt32BE(0); boy = govde.readUInt32BE(4);
      derinlik = govde[8]; tur = govde[9];
    } else if (ad === 'IDAT') veri.push(govde);
    else if (ad === 'IEND') break;
    p += 12 + uz;
  }
  assert.strictEqual(derinlik, 8, yol + ': 8 bit bekleniyordu');
  assert.strictEqual(tur, 6, yol + ': RGBA bekleniyordu');
  const ham = zlib.inflateSync(Buffer.concat(veri));
  const kanal = 4, satir = en * kanal;
  const px = Buffer.alloc(boy * satir);
  let o = 0;
  for (let y = 0; y < boy; y++) {
    const suzgec = ham[o++];
    const s = ham.slice(o, o + satir); o += satir;
    const h = px.slice(y * satir, (y + 1) * satir);
    const ust = y > 0 ? px.slice((y - 1) * satir, y * satir) : Buffer.alloc(satir);
    for (let i = 0; i < satir; i++) {
      const a = i >= kanal ? h[i - kanal] : 0, b = ust[i];
      const c = i >= kanal ? ust[i - kanal] : 0;
      let v = s[i];
      if (suzgec === 1) v += a;
      else if (suzgec === 2) v += b;
      else if (suzgec === 3) v += (a + b) >> 1;
      else if (suzgec === 4) {
        const t = a + b - c, da = Math.abs(t - a), db = Math.abs(t - b), dc = Math.abs(t - c);
        v += (da <= db && da <= dc) ? a : (db <= dc ? b : c);
      }
      h[i] = v & 255;
    }
  }
  return { en, boy, px };
}

/* Alfası eşiğin üstünde olan piksellerin sınır kutusu. */
function konuKutusu(im, esik) {
  let x0 = im.en, y0 = im.boy, x1 = -1, y1 = -1;
  for (let y = 0; y < im.boy; y++) {
    for (let x = 0; x < im.en; x++) {
      if (im.px[y * im.en * 4 + x * 4 + 3] > esik) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, en: x1 - x0 + 1, boy: y1 - y0 + 1 };
}

/* Mor zemin üstüne çizilmiş katmanlarda konu = zeminden FARKLI piksel. */
function konuKutusuRenk(im, zemin, tol) {
  let x0 = im.en, y0 = im.boy, x1 = -1, y1 = -1;
  for (let y = 0; y < im.boy; y++) {
    for (let x = 0; x < im.en; x++) {
      const i = y * im.en * 4 + x * 4;
      if (im.px[i + 3] < 8) continue;                     // saydam köşe
      const d = Math.abs(im.px[i] - zemin[0]) + Math.abs(im.px[i + 1] - zemin[1])
              + Math.abs(im.px[i + 2] - zemin[2]);
      if (d > tol) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1, en: x1 - x0 + 1, boy: y1 - y0 + 1 };
}

const MOR = [108, 92, 231];

// ---------- 1) SİMGE KADRAJI ----------
/* Launcher maskesi neredeyse her zaman DAİREDİR. Ölçüt bu yüzden kare
   sınır kutusu değil, merkeze olan EN UZAK DOLU PİKSELİN YARIÇAPI: zarın
   köşeleri ve tacın ucu dairenin içinde kaldığı sürece konu istediği kadar
   büyük olabilir. Kare kutuya bakmak, köşeleri boş olan bu logoda gereksiz
   küçültme yapıyordu. */
const YARICAP = {
  ic_launcher:            { alt: 0.40, ust: 0.48 },   // tuval yarıçapı 0.5
  ic_launcher_foreground: { alt: 0.26, ust: 0.3055 }  // 108dp'de 66dp güvenli daire
};

function enUzakYaricap(im, dolu) {
  const cx = (im.en - 1) / 2, cy = (im.boy - 1) / 2;
  let enb = 0;
  for (let y = 0; y < im.boy; y++) {
    for (let x = 0; x < im.en; x++) {
      if (!dolu(im, x, y)) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (d > enb) enb = d;
    }
  }
  return enb;
}

const alfali = (im, x, y) => im.px[(y * im.en + x) * 4 + 3] > 24;
const morDegil = (im, x, y) => {
  const i = (y * im.en + x) * 4;
  if (im.px[i + 3] < 8) return false;
  return Math.abs(im.px[i] - MOR[0]) + Math.abs(im.px[i + 1] - MOR[1])
       + Math.abs(im.px[i + 2] - MOR[2]) > 90;
};

for (const yog of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  for (const ad of Object.keys(YARICAP)) {
    const yol = path.join(RES, 'mipmap-' + yog, ad + '.png');
    assert.ok(fs.existsSync(yol), 'eksik simge: ' + yog + '/' + ad);
    const im = pngOku(yol);
    const dolu = ad === 'ic_launcher_foreground' ? alfali : morDegil;
    const r = enUzakYaricap(im, dolu) / im.en;
    const s = YARICAP[ad];
    assert.ok(r <= s.ust, yog + '/' + ad + ': konu dışarı taşıyor (yarıçap ' +
      r.toFixed(3) + ' > ' + s.ust + '). Daire maskesinde zarın köşesi/taç kesilir.');
    assert.ok(r >= s.alt, yog + '/' + ad + ': konu gereğinden küçük (yarıçap ' +
      r.toFixed(3) + ' < ' + s.alt + ') — boşuna yer harcanıyor');
  }
  /* KÖŞELER SAYDAM OLMAMALI: kendi maskesini uygulamayan launcher'lar
     köşelerden koyu zemini gösterir, simge "siyah çerçeveli" görünür.
     Bir ara yuvarlatılmış maske uygulanmıştı; bu madde onu geri getirmez. */
  const kim = pngOku(path.join(RES, 'mipmap-' + yog, 'ic_launcher.png'));
  for (const [x, y] of [[0, 0], [kim.en - 1, 0], [0, kim.boy - 1], [kim.en - 1, kim.boy - 1]]) {
    assert.strictEqual(kim.px[(y * kim.en + x) * 4 + 3], 255,
      yog + '/ic_launcher: köşe saydam — zemin kenardan kenara mor olmalı');
  }
}
/* Daire çizen launcher'lar artık ic_launcher'ı (API 26+ uyarlanabilir
   sürümünü) kullanıyor: ayrı yuvarlak simge mor DAİRE + saydam köşe
   demekti, kendi tepsisini çizen launcher'da köşeler koyu kalıyordu. */
assert.ok(!/android:roundIcon/.test(oku('android/app/src/main/AndroidManifest.xml')),
  'android:roundIcon kaldırılmalı; yuvarlak simge koyu köşelere yol açıyordu');
for (const yog of ['mdpi', 'xxxhdpi']) {
  assert.ok(!fs.existsSync(path.join(RES, 'mipmap-' + yog, 'ic_launcher_round.png')),
    yog + ': ic_launcher_round.png artık üretilmemeli');
}
console.log('  ✓ 1) simge: daire maskesine tam oturuyor, köşeler mor, yuvarlak varyant yok');

// ---------- 2) İNSET SÖZLEŞMESİ: üç parça da yerinde mi ----------
const java = oku('android/app/src/main/java/tr/com/masaoyunlari/oyun/MainActivity.java');
const wv = oku('js/webview.js');
const html = oku('index.html');

for (const d of ['--gv-ust', '--gv-alt', '--gv-sol', '--gv-sag']) {
  assert.ok(java.includes("'" + d + "'"),
    'native kabuk ' + d + ' değişkenini sayfaya yollamalı');
  assert.ok(html.includes('var(' + d),
    'index.html ' + d + ' değişkenini kullanmalı (yoksa kabuk boşuna yolluyor)');
}
/* KURALLARI KABUK DA KURUYOR. Site Yöncü'de ayrı yayınlandığı için
   güncel olmayabiliyor; yalnız değişken yollamak yetmiyordu (kimse
   kullanmıyorsa bant aynen kalıyor). Kabuk kendi <style> etiketini
   ekliyor, böylece sitenin hangi sürümü yayında olursa olsun doğru
   görünüyor. */
assert.ok(/gv-inset-css/.test(java),
  'kabuk kendi <style> etiketini kurmalı (eski site sürümünde de çalışsın)');
assert.ok(/body\.gv-app \.header\{box-sizing:border-box;/.test(java),
  'kabuğun kurduğu CSS üst barı durum çubuğu kadar uzatmalı');
assert.ok(/classList\.contains\('gv-app'\)/.test(java),
  'dolgu ancak gövdede gv-app sınıfı VARKEN bırakılmalı; yoksa kurallar ' +
  'çalışmaz ve içerik durum çubuğunun altında kalır');
assert.ok(/GVWebView\.insetDestegi\s*=\s*true/.test(wv),
  'js/webview.js bayrağı korunmalı (sitenin kendi kurallarını taşıdığının işareti)');
console.log('  ✓ 2) inset sözleşmesi: kabuk CSS\'i kendi kuruyor, site de aynı değişkenleri kullanıyor');

// ---------- 3) ÜST BAR DURUM ÇUBUĞUNU KENDİSİ BOYUYOR ----------
assert.ok(/body\.gv-app\s*\{[^}]*padding-top:\s*0/.test(html),
  'uygulama kipinde gövdeye üst dolgu VERİLMEMELİ — o şerit boş/siyah kalıyordu');
assert.ok(/body\.gv-app\s+\.header\s*\{[^}]*padding-top:var\(--gv-pay-ust\)/.test(html.replace(/\s*\n\s*/g, '')),
  'üst bar kendi dolgusuyla durum çubuğunun arkasına kadar uzamalı');
assert.ok(/height:calc\(56px \+ var\(--gv-pay-ust\)\)/.test(html.replace(/\s*\n\s*/g, '')),
  'üst barın yüksekliği durum çubuğu kadar artmalı (içerik kaymasın)');
assert.ok(/padding-bottom:var\(--gv-pay-alt\)/.test(html),
  'gezinme çubuğu payı gövdenin altına verilmeli');
console.log('  ✓ 3) üst bar durum çubuğunu kendi rengiyle boyuyor, alt çubuk payı var');

// ---------- 4) GÜVENLİK AĞI ----------
assert.ok(/sayfaInsetleriUyguluyor/.test(java) && /dolguUygula/.test(java),
  'kabuk, sayfa onay vermezse native dolguyu geri koymalı');
assert.ok(/onPageStarted[\s\S]{0,400}sayfaInsetleriUyguluyor = false/.test(java),
  'yeni belge yüklenirken dolgu güvenli tarafa dönmeli (CSS değişkenleri sıfırlanır)');
console.log('  ✓ 4) güvenlik ağı: sayfa onay vermezse native dolgu geri geliyor');

// ---------- 5) DAR EKRANDA TAŞMAYI ÖNLEYEN KURALLAR ----------
assert.ok(/#welcomeHeading\{[^}]*overflow-wrap:anywhere/.test(html.replace(/\s*\n\s*/g, '')),
  'karşılama başlığı uzun kullanıcı adlarında bölünebilmeli (320px\'de kırpılıyordu)');
assert.ok(/#welcomeHeading\{font-size:clamp\(/.test(html.replace(/\s*\n\s*/g, '')),
  'karşılama başlığı ekran genişliğiyle ölçeklenmeli');
console.log('  ✓ 5) dar ekran: başlık bölünebiliyor ve ölçekleniyor');

console.log('OK ekran uyumu: simge kadrajı + sistem çubuğu payları + dar ekran');
