'use strict';
/* ============================================================================
 * 101 OKEY — KULLANICI RAPORU (20.10.2026) DÜZELTMELERİ
 * ============================================================================
 *  1) Masadan (atık/deste) taş çekerken sürüklenen kopya BÜYÜMEMELİ: yalnız
 *     taşın kendisi kopyalanır, ıstaka taşının yazı boyu ona uygulanmaz.
 *  2) Sahte okey OKEYİN yerine geçer → gösterge mavi 13 iken oyunda yalnız
 *     1 tane daha mavi 13 olur (eskiden 3 görünüyordu).
 *  3) "El Aç" ıstakadaki gerçek dizilimi okur: kullanıcının ekran
 *     görüntüsündeki raf (azalan seriler, kütler, aralarda boşluk) perlere
 *     ayrılır ve 101'i geçer.
 *  4) Atık bölgeleri masanın ortasından (açılan perlerin üstünden) çekildi.
 *  5) Çift kipi: çiftler yan yana dizilmemiş olsa da bulunur; perlerle 101'e
 *     ulaşılamıyorsa pencere kendiliğinden çift kipine geçer.
 *  6) Puanlama motor testinde (okey101-motor.test.js) ölçülüyor.
 * ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const KOK = path.join(__dirname, '..');
const E = require(path.join(KOK, 'okey101-engine.js'));

let n0 = 0;
const T = (n, c) => ({ id: 'u' + (++n0), n, c, isFJ: false });
const R = 't-red', K = 't-black', B = 't-blue', Y = 't-yellow';

function pencere() {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, url: 'http://localhost/' });
  dom.window.eval(fs.readFileSync(path.join(KOK, 'js', 'okey101-ac.js'), 'utf8'));
  return dom;
}

// ---- 2) deste dağılımı ----
for (let i = 0; i < 40; i++) {
  const st = E.startRound(1, [0, 1, 2, 3], {}, Math.random, 0);
  const hepsi = [].concat(...Object.values(st.hands), st.deck);
  const gibi = (c, n) => hepsi.filter(t => (t.isFJ ? t.dc : t.c) === c && t.n === n).length;
  assert.strictEqual(gibi(st.indicator.c, st.indicator.n), 1, 'gösterge taşının oyunda yalnız 1 eşi olmalı');
  assert.strictEqual(hepsi.filter(t => !t.isFJ && t.c === st.realOkey.c && t.n === st.realOkey.n).length, 2, '2 gerçek okey');
  assert.strictEqual(hepsi.filter(t => t.isFJ && t.dc === st.realOkey.c && t.n === st.realOkey.n).length, 2, '2 sahte okey okeyin değerinde');
}
console.log('  ✓ 2) sahte okey okeyin yerine geçiyor; göstergenin yalnız 1 eşi var');

// ---- 3) kullanıcının ıstakası ----
{
  const dom = pencere();
  const A = dom.window.GVOkey101Ac;
  const okey = { c: B, n: 1 };   // gösterge mavi 13 → okey mavi 1
  const ust = [T(7, Y), T(7, K), null, T(6, B), T(9, Y), null, T(10, B), T(9, B), T(8, B), null, T(8, K), null, T(11, B), T(11, K), T(11, Y)];
  const alt = [T(10, R), T(11, R), T(12, R), T(13, R), null, T(5, K), T(4, K), T(3, K), T(2, K), null, T(3, Y), T(2, Y), T(1, Y), null, null];
  const sonuc = A.algila([ust, alt], okey, false);
  const puan = sonuc.perler.reduce((a, p) => a + A.perDogrula(p, okey).puan, 0);
  assert.strictEqual(sonuc.perler.length, 5, '5 per algılanmalı: ' + sonuc.perler.map(p => p.map(t => t.n).join('-')).join(' | '));
  assert.ok(puan >= 101, 'toplam 101\'i geçmeli: ' + puan);
  // Pencere üzerinden: açılınca hazır gelmeli
  A.ac({ eller: ust.concat(alt).filter(Boolean), raflar: [ust, alt], realOkey: okey, acmaPuani: 101, ciftAdedi: 5,
         puanla: p => (A.perDogrula(p, okey).puan || 0), gonder: () => {} });
  assert.strictEqual(A._durum().perler.length, 5, 'pencere açılır açılmaz 5 per hazır');
  assert.ok(!dom.window.document.querySelector('.ok101a-ac').disabled, '"Aç" açık olmalı');
  A.kapat();
  // İstemci rafı gerçekten gönderiyor mu (eski Array.isArray hatası)
  const js = fs.readFileSync(path.join(KOK, 'js', 'okey-online.js'), 'utf8');
  assert.ok(!/Array\.isArray\(ok\.rack\)/.test(js), 'raf nesnesini dizi sanan eski sınama kalmamalı');
  assert.ok(/function ok101Raflar[\s\S]{0,900}rackIds/.test(js), 'raflar ekrandaki yerleşimden (rackIds) okunmalı');
  console.log('  ✓ 3) kullanıcının ıstakası 5 pere ayrıldı (' + puan + ' puan), pencere hazır açıldı');
}

// ---- 5) çift kipi ----
{
  const dom = pencere();
  const A = dom.window.GVOkey101Ac;
  const okey = { c: R, n: 9 };
  const el = [T(2, R), T(5, B), T(2, R), T(9, K), T(5, B), T(11, Y), T(9, K), T(13, B), T(11, Y), T(13, B), T(4, K), T(7, Y)];
  const ust = el.slice(0, 12).concat([null, null, null]);   // çiftler yan yana DEĞİL, boşluksuz
  A.ac({ eller: el, raflar: [ust, new Array(15).fill(null)], realOkey: okey, acmaPuani: 101, ciftAdedi: 5,
         puanla: p => (A.perDogrula(p, okey).puan || 0), gonder: () => {} });
  const d = A._durum();
  assert.strictEqual(d.cift, true, 'perle 101 yoksa pencere çift kipine geçmeli');
  assert.strictEqual(d.perler.length, 5, '5 çift bulunmalı');
  assert.ok(d.perler.every(p => p.length === 2 && p[0].n === p[1].n && p[0].c === p[1].c), 'çiftler doğru eşlenmeli');
  assert.ok(!dom.window.document.querySelector('.ok101a-ac').disabled, '"Aç" açık olmalı (2 taş elde)');
  A.kapat();
  // Sunucu motoru da bu çiftleri kabul etmeli
  const st = E.startRound(1, [0, 1], {}, () => 0.5, 0);
  st.realOkey = okey; st.turn = 0; st.phase = 'discard'; st.hands[0] = el.slice();
  const r = E.openMelds(st, 0, d.perler.map(p => p.map(t => t.id)), true);
  assert.ok(r.ok, 'motor 5 çifti kabul etmeli: ' + JSON.stringify(r));
  assert.strictEqual(st.acilisTuru[0], 'cift');
  console.log('  ✓ 5) çiftler dağınık dizilse de algılandı, çift kipine kendiliğinden geçildi, motor kabul etti');
}

// ---- 1) ve 4) arayüz kaynak denetimi ----
{
  const sayfa = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
  assert.ok(/const kaynak = \(type === 'left'\)/.test(sayfa), 'atıktan sürüklemede yalnız taş kopyalanmalı');
  assert.ok(/kaynak === target && type === 'tile'/.test(sayfa), 'ıstaka yazı boyu yalnız ıstaka taşına verilmeli');
  assert.ok(/\.okey-table \.ok-disc-zone\[data-pos="0"\]\{top:auto;left:auto;bottom:calc\(var\(--ok-rack-h\)/.test(sayfa),
    'kendi atığım ıstakanın sağına (ortadan uzağa) alınmalı');
  console.log('  ✓ 1/4) sürükleme kopyası yalnız taş; atık bölgeleri ortadan kenara alındı');
}
console.log('OK 101 okey kullanıcı raporu düzeltmeleri');
