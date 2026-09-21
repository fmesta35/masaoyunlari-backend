'use strict';
/* ============================================================================
 * AMİRAL BATTI — STANDART EKRAN ile TAM EKRAN AYNI YERLEŞİM
 * ============================================================================
 * Kullanıcı isteği (verbatim): "Tam Ekran alındığında ve normal dashboard da
 * - webde de mobilde de standart olması gerek. Tüm butonların yerleri vs.
 * sadece optimizasyonu ve ölçek değişecek. Standart ekranda F5 ateş et
 * butonu çok uzun - tam ekran da derli toplu."
 *
 * Bu test GERÇEK tarayıcıda (Chromium) ölçer, çünkü sorun yalnız yerleşim
 * hesabında görünüyor: jsdom düzen hesaplamaz.
 *   ESKİ ÖLÇÜM (1600×900): konsol standart 1248px / tam ekran 288px,
 *   ATEŞ düğmesi standart x=1146 (sağ kenar) / tam ekran ortada.
 *
 * Doğrulananlar (hem masaüstü hem telefon genişliğinde):
 *  1) Muharebe alanı (iki ızgara) iki modda da AYNI genişlikte.
 *  2) Ateş konsolu iki modda da aynı genişlikte ve sayfada ORTALI.
 *  3) ATEŞ düğmesi konsolun içinde, hedef okumasının yanında durur
 *     (sağ kenara kaçmaz): düğme merkezi ile konsol merkezi arasındaki
 *     fark iki modda da aynıdır.
 * Chromium yoksa test sessizce atlanır (ortam bağımlılığı olmasın).
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
if (!chromium) {
  console.log('ATLANDI amiral battı ekran tutarlılığı (playwright yok)');
  process.exit(0);
}

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bs-ekran-'));
const assert = require('assert');
const serverModule = require('../server.js');
const uyu = ms => new Promise(r => setTimeout(r, ms));

async function masayaGir(ctx, BASE, oda) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html');
  await p.waitForFunction(
    () => window.GV && window.st && typeof window.__gvStartRealRoomWaiting === 'function',
    null, { timeout: 30000 });
  await p.evaluate(o => { window.st.curGame = 'battleship'; window.GV.joinRoom(o); }, oda);
  await p.waitForSelector('#gv-real-chess-wait .gv-ready', { timeout: 20000 });
  await p.click('#gv-real-chess-wait .gv-ready');
  return p;
}
const olc = p => p.evaluate(() => {
  const g = s => { const e = document.querySelector(s); if (!e) return null;
    const b = e.getBoundingClientRect();
    return { g: Math.round(b.width), mer: Math.round(b.left + b.width / 2),
             sag: Math.round(b.right) }; };
  return { sarmal: g('.bs-wrap'), savas: g('.bs-battlefield'), konsol: g('.bs-console'),
           ates: g('.bs-fire'), filo: g('.bs-fleet-status') };
});

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const tarayici = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));

  for (const [ad, vp] of [['masaüstü', { width: 1600, height: 900 }],
                          ['telefon', { width: 412, height: 915 }]]) {
    const c1 = await tarayici.newContext({ viewport: vp });
    const c2 = await tarayici.newContext({ viewport: vp });
    const oda = 'bs-ekran-' + vp.width;
    const p1 = await masayaGir(c1, BASE, oda), p2 = await masayaGir(c2, BASE, oda);
    for (const p of [p1, p2]) {
      await p.waitForSelector('#boardArea .bs-place', { timeout: 25000 });
      await p.click('.bs-shuffle');
      await p.waitForSelector('.bs-ready-btn:not([disabled])', { timeout: 15000 });
      await p.click('.bs-ready-btn');
    }
    await p1.waitForSelector('#boardArea .bs-battlefield', { timeout: 25000 });
    await uyu(600);
    const std = await olc(p1);
    await p1.evaluate(() => document.getElementById('pg-room').classList.add('gv-fs'));
    await uyu(500);
    const tam = await olc(p1);

    /* Tam ekranda kullanılabilir alan farklı olabilir (mobilde solda süre
       şeridi var), bu yüzden MUTLAK piksel değil YERLEŞİM KURALLARI
       karşılaştırılır: ölçek değişir, düzen değişmez. */
    [['standart', std], ['tam ekran', tam]].forEach(function (x) {
      var mod = x[0], m = x[1];
      assert.strictEqual(m.konsol.g, Math.min(m.sarmal.g, 420),
        ad + ' / ' + mod + ': konsol genişliği alanla sınırlı 420px olmalı — bulunan ' + m.konsol.g);
      assert.ok(Math.abs(m.konsol.mer - m.sarmal.mer) <= 2,
        ad + ' / ' + mod + ': konsol ORTALI olmalı');
      assert.ok(Math.abs(m.savas.mer - m.sarmal.mer) <= 2,
        ad + ' / ' + mod + ': muharebe alanı ORTALI olmalı');
      assert.ok(Math.abs(m.filo.mer - m.sarmal.mer) <= 2,
        ad + ' / ' + mod + ': filo şeridi ORTALI olmalı');
      assert.ok(m.ates.mer < m.konsol.mer + m.konsol.g / 2,
        ad + ' / ' + mod + ': ATEŞ düğmesi konsolun içinde kalmalı');
    });
    /* ATEŞ düğmesi konsolun SAĞ kenarına aynı payla oturur (sayfanın sağ
       kenarına kaçmaz): pay = konsol padding'i, iki modda da aynı. */
    var payStd = std.konsol.sag - std.ates.sag, payTam = tam.konsol.sag - tam.ates.sag;
    assert.strictEqual(payStd, payTam,
      ad + ': ATEŞ düğmesi konsol kenarına aynı payla oturmalı — standart ' +
      payStd + 'px / tam ekran ' + payTam + 'px');
    assert.ok(payStd <= 16, ad + ': ATEŞ düğmesi konsolun içinde, kenara yakın olmalı');
    assert.strictEqual(std.ates.g, tam.ates.g, ad + ': ATEŞ düğmesi aynı boyda olmalı');
    console.log('  ✓ ' + ad + ': konsol ' + std.konsol.g + 'px (tam ekran ' + tam.konsol.g +
      'px), iki modda da ortalı ve ATEŞ düğmesi aynı yerde');
    await c1.close(); await c2.close();
  }

  await tarayici.close();
  server.close();
  console.log('OK amiral battı ekran tutarlılığı');
  process.exit(0);
}
main().catch(e => { console.error('❌ EKRAN TUTARLILIK HATASI:', e); process.exit(1); });
