#!/usr/bin/env node
'use strict';
/* ============================================================================
 * SÜRÜM DAMGASI — index.html'deki ?v= etiketlerini içerikle eşitler
 * ============================================================================
 * NEDEN VAR: Yöncü (ve tarayıcı) JS dosyalarını agresif önbelleğe alır. Bir
 * dosyanın içeriği değişip `?v=` etiketi AYNI kalırsa, kullanıcıya ESKİ dosya
 * servis edilir ve düzeltme canlıda hiç görünmez.
 *
 * Bu gerçekten yaşandı: js/room-waiting-fix.js ile js/lobby-sync.js düzeltildi
 * ama etiketleri (20260908b / 20260820f) olduğu gibi bırakıldı. Sonuç: yeni
 * oyunların masasına girilince ekran SİYAH kalmaya devam etti — düzeltme
 * depodaydı, tarayıcıda değildi.
 *
 * ÇALIŞMASI: her betiğin içerik özeti (sha256'nın ilk 12 hanesi)
 * js-surumleri.json'da saklanır. İçerik değiştiyse etiket BUGÜNÜN tarihine
 * (gerekirse a/b/c harfiyle) yükseltilir ve index.html yeniden yazılır.
 *
 *   node tools/surum-damgasi.js           → değişenleri yükselt
 *   node tools/surum-damgasi.js --denetle → yalnız denetle (yazma), test bunu kullanır
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KOK = path.join(__dirname, '..');
const SAYFA = path.join(KOK, 'index.html');
const KAYIT = path.join(KOK, 'js-surumleri.json');
const ETIKET = /src="((?:js\/)?[A-Za-z0-9._-]+\.js)\?v=([A-Za-z0-9]+)"/g;

function ozet(dosya) {
  return crypto.createHash('sha256').update(fs.readFileSync(dosya)).digest('hex').slice(0, 12);
}
function bugun() {
  const d = new Date();
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') +
         String(d.getDate()).padStart(2, '0');
}
/* Aynı gün ikinci kez değişirse harf ilerler: 20261011a → 20261011b. */
function sonrakiEtiket(eski) {
  const gun = bugun();
  if (!eski || eski.slice(0, 8) !== gun) return gun + 'a';
  const harf = eski.slice(8) || 'a';
  const son = harf.charCodeAt(harf.length - 1);
  if (son >= 122) return gun + harf + 'a';           // 'z' sonrası
  return gun + harf.slice(0, -1) + String.fromCharCode(son + 1);
}

/* JSON.stringify'in ikinci argümanı REPLACER'dır: oraya anahtar dizisi
   vermek iç nesnelerin alanlarını ("v"/"sha") da süzüyor ve kayıt {} olarak
   yazılıyordu. Sıralamayı nesneyi yeniden kurarak yapıyoruz. */
function sirali(nesne) {
  const out = {};
  Object.keys(nesne).sort().forEach(k => { out[k] = nesne[k]; });
  return out;
}

function tara() {
  const html = fs.readFileSync(SAYFA, 'utf8');
  const kayit = fs.existsSync(KAYIT) ? JSON.parse(fs.readFileSync(KAYIT, 'utf8')) : {};
  const bulgular = [];
  let m;
  ETIKET.lastIndex = 0;
  while ((m = ETIKET.exec(html))) {
    const [tam, yol, etiket] = m;
    const tamYol = path.join(KOK, yol);
    if (!fs.existsSync(tamYol)) { bulgular.push({ yol, etiket, sorun: 'dosya_yok' }); continue; }
    const su = ozet(tamYol);
    const k = kayit[yol];
    if (!k) bulgular.push({ yol, etiket, su, sorun: 'kayit_yok', tam });
    else if (k.v !== etiket) bulgular.push({ yol, etiket, su, kayit: k, sorun: 'etiket_uyusmuyor', tam });
    else if (k.sha !== su) bulgular.push({ yol, etiket, su, kayit: k, sorun: 'icerik_degismis', tam });
  }
  return { html, kayit, bulgular };
}

function yukselt() {
  let { html, kayit, bulgular } = tara();
  if (!bulgular.length) { console.log('✓ Tüm ?v= etiketleri içerikle uyumlu.'); return 0; }
  bulgular.forEach(b => {
    if (b.sorun === 'dosya_yok') { console.log('⚠ dosya yok: ' + b.yol); return; }
    let yeni = b.etiket;
    /* İçerik değiştiyse etiket YÜKSELİR. Kayıt yoksa ya da etiket zaten
       elle değiştirilmişse mevcut etiket korunur, yalnız kayıt tazelenir. */
    if (b.sorun === 'icerik_degismis') yeni = sonrakiEtiket(b.etiket);
    if (yeni !== b.etiket) {
      html = html.replace(b.tam, 'src="' + b.yol + '?v=' + yeni + '"');
      console.log('↑ ' + b.yol + ': ' + b.etiket + ' → ' + yeni);
    } else {
      console.log('· ' + b.yol + ': kayıt tazelendi (' + yeni + ')');
    }
    kayit[b.yol] = { v: yeni, sha: b.su };
  });
  /* index.html'de olmayan kayıtları at (dosya silinmiş olabilir). */
  const yollar = new Set();
  ETIKET.lastIndex = 0; let m;
  while ((m = ETIKET.exec(html))) yollar.add(m[1]);
  Object.keys(kayit).forEach(k => { if (!yollar.has(k)) delete kayit[k]; });

  fs.writeFileSync(SAYFA, html);
  fs.writeFileSync(KAYIT, JSON.stringify(sirali(kayit), null, 2) + '\n');
  return 0;
}

function denetle() {
  const { bulgular } = tara();
  const kotu = bulgular.filter(b => b.sorun !== 'dosya_yok');
  if (!kotu.length) { console.log('✓ Tüm ?v= etiketleri içerikle uyumlu.'); return 0; }
  console.error('✗ ' + kotu.length + ' dosyanın ?v= etiketi içerikle uyuşmuyor:');
  kotu.forEach(b => console.error('   ' + b.yol + '  (' + b.sorun + ', etiket=' + b.etiket + ')'));
  console.error('\n  Düzeltmek için: node tools/surum-damgasi.js');
  return 1;
}

/* --zorla <yol...> : içeriği değişmemiş görünse bile etiketi yükseltir.
   Canlıdaki dosyanın depodakinden farklı olduğu bilindiğinde (örn. bir
   düzeltme etiket yükseltilmeden yayına alındığında) gerekir. */
function zorla(yollar) {
  let html = fs.readFileSync(SAYFA, 'utf8');
  const kayit = fs.existsSync(KAYIT) ? JSON.parse(fs.readFileSync(KAYIT, 'utf8')) : {};
  let n = 0;
  yollar.forEach(yol => {
    const re = new RegExp('src="' + yol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\?v=([A-Za-z0-9]+)"');
    const m = html.match(re);
    if (!m) { console.log('⚠ etiket bulunamadı: ' + yol); return; }
    const yeni = sonrakiEtiket(m[1]);
    html = html.replace(re, 'src="' + yol + '?v=' + yeni + '"');
    kayit[yol] = { v: yeni, sha: ozet(path.join(KOK, yol)) };
    console.log('↑ ' + yol + ': ' + m[1] + ' → ' + yeni);
    n++;
  });
  fs.writeFileSync(SAYFA, html);
  fs.writeFileSync(KAYIT, JSON.stringify(sirali(kayit), null, 2) + '\n');
  console.log(n + ' etiket yükseltildi.');
  return 0;
}

if (require.main === module) {
  const arg = process.argv.slice(2);
  if (arg.includes('--denetle')) process.exit(denetle());
  else if (arg[0] === '--zorla') process.exit(zorla(arg.slice(1)));
  else process.exit(yukselt());
}
module.exports = { tara, denetle, ozet, zorla };
