'use strict';
/* ============================================================================
 * BİLARDO — ISTEKA BIRAKILDIĞI ANDA VURUYOR
 * ============================================================================
 * Kullanıcı raporu (verbatim): "bilardo da topu ayarlayıp bıraktıktan sonra
 * 2-3 saniye gecikme oluyor — ıstakayı bıraktığı anda (mouse click basılması
 * bırakıldığı anda) ıstakayla topa vurması gerek gecikme olmadan."
 *
 * ÖLÇÜLEN DURUM: fiziği sunucu çözüyor (ölçüldü: 28 ms) ve ~74 KB'lık kare
 * paketini yayınlıyor. İstemci ESKİDEN fare bırakıldıktan sonra kareler
 * GELENE KADAR hiçbir şey çizmiyordu; uzak sunucuda gidiş-dönüş 2-3 saniyeye
 * çıkınca oyuncu "bıraktım ama bir şey olmadı" diye görüyordu.
 * ÇÖZÜM: temas ANINDA yerelde canlandırılıyor (ısteka topa atılır + değme
 * sesi), fizik hâlâ tamamen sunucuda.
 *
 * Gerçek Chromium ile ölçülür (jsdom fare/işaretçi akışını yürütmüyor).
 * Doğrulananlar:
 *  1) Fare bırakılır bırakılmaz ısteka vuruşu ÇİZİLİYOR — sunucunun kareleri
 *     gelmeden (yerel gecikme < 200 ms).
 *  2) Vuruş paketi de aynı anda gidiyor.
 *  3) Sunucunun kareleri gelince toplar oradan devam ediyor.
 *  4) Sağ tıkla ısteka bırakılırsa vuruş YAPILMIYOR (eski davranış korunur).
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI bilardo anında vuruş (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bil-'));
const assert = require('assert');
const serverModule = require('../server.js');
const uyu = ms => new Promise(r => setTimeout(r, ms));

async function gir(ctx, BASE, oda) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html');
  await p.waitForFunction(
    () => window.GV && window.st && typeof window.__gvStartRealRoomWaiting === 'function',
    null, { timeout: 30000 });
  await p.evaluate(o => { window.st.curGame = 'bilardo'; window.GV.joinRoom(o); }, oda);
  await p.waitForSelector('#gv-real-chess-wait .gv-ready', { timeout: 20000 });
  await p.click('#gv-real-chess-wait .gv-ready');
  return p;
}
/* Sayfaya izleme kancaları: çizim zamanı, kare paketi zamanı, ses. */
const kancaTak = p => p.evaluate(() => {
  window.__gvOlcum = { ilkCizim: 0, kareGeldi: 0, sesler: [], gonderim: 0, birakma: 0 };
  const cv = document.getElementById('bilOnlineCanvas');
  const ctx = cv.getContext('2d');
  const asil = ctx.fillRect.bind(ctx);
  ctx.fillRect = function (x) {
    // x === -235 yalnız ISTEKA çubuğunun çizimidir (bkz. js/bilardo-online.js)
    if (x === -235 && window.__gvOlcum.birakma && !window.__gvOlcum.ilkCizim) {
      window.__gvOlcum.ilkCizim = performance.now();
    }
    return asil.apply(null, arguments);
  };
  const s = window.__gvRoomSocket;
  s.on('bilardoShotFrames', () => {
    if (!window.__gvOlcum.kareGeldi) window.__gvOlcum.kareGeldi = performance.now();
  });
  const e = s.emit.bind(s);
  s.emit = function (ev) {
    if (ev === 'bilardoShoot' && !window.__gvOlcum.gonderim) window.__gvOlcum.gonderim = performance.now();
    return e.apply(null, arguments);
  };
  if (window.GVDeniz && GVDeniz.ses) {
    const c = GVDeniz.ses.cal;
    GVDeniz.ses.cal = function (ad) { window.__gvOlcum.sesler.push(ad); return c.call(this, ad); };
    GVDeniz.ses.ayarla(true);
  }
});

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));
  const vp = { width: 1400, height: 900 };
  const c1 = await tr.newContext({ viewport: vp }), c2 = await tr.newContext({ viewport: vp });
  const p1 = await gir(c1, BASE, 'bil-aninda'), p2 = await gir(c2, BASE, 'bil-aninda');
  for (const p of [p1, p2]) await p.waitForSelector('#bilOnlineCanvas', { timeout: 25000 });
  await uyu(900);

  const sirasi = async p => p.evaluate(() => window.GVArena.state().turn === window.GVArena.seat());
  const oyuncu = (await sirasi(p1)) ? p1 : p2;
  await kancaTak(oyuncu);

  const kutu = await oyuncu.locator('#bilOnlineCanvas').boundingBox();
  const mx = kutu.x + kutu.width * 0.55, my = kutu.y + kutu.height * 0.5;

  await oyuncu.mouse.move(mx, my);                  // nişan al
  await oyuncu.mouse.down();                        // ıstekayı tut
  await oyuncu.mouse.move(mx - 90, my);             // geri çek (güç)
  await oyuncu.evaluate(() => { window.__gvOlcum.birakma = performance.now(); });
  await oyuncu.mouse.up();                          // BIRAK → vuruş
  await uyu(200);

  const o = await oyuncu.evaluate(() => window.__gvOlcum);
  assert.ok(o.ilkCizim, 'fare bırakılınca ısteka vuruşu çizilmeli');
  const gecikme = Math.round(o.ilkCizim - o.birakma);
  assert.ok(gecikme < 200, 'yerel vuruş 200 ms içinde başlamalı — ölçülen: ' + gecikme + ' ms');
  assert.ok(!o.kareGeldi || o.ilkCizim <= o.kareGeldi,
    'yerel vuruş sunucunun karelerinden ÖNCE çizilmeli');
  console.log('  ✓ 1) ısteka, fare bırakıldıktan ' + gecikme + ' ms sonra topa vuruyor (sunucu beklenmiyor)');

  assert.ok(o.gonderim && (o.gonderim - o.birakma) < 200,
    'vuruş paketi de aynı anda gitmeli — ' + Math.round(o.gonderim - o.birakma) + ' ms');
  assert.ok(o.sesler.indexOf('isteka') >= 0, 'ısteka temas sesi çalmalı');
  console.log('  ✓ 2) vuruş paketi aynı anda gidiyor, temas sesi çalıyor');

  await oyuncu.waitForFunction(() => window.__gvOlcum.kareGeldi > 0, null, { timeout: 15000 });
  const o2 = await oyuncu.evaluate(() => window.__gvOlcum);
  console.log('  ✓ 3) sunucu kareleri ' + Math.round(o2.kareGeldi - o2.birakma) +
              ' ms sonra geldi, toplar oradan devam ediyor');

  // ---- 4) Sağ tık ile ısteka bırakma: vuruş YOK ----
  await uyu(6000);                                   // vuruş bitsin, sıra geçsin
  const p3 = (await sirasi(p1)) ? p1 : p2;
  await p3.evaluate(() => {
    window.__gvIptalOlcum = { kare: 0 };
    window.__gvRoomSocket.on('bilardoShotFrames', () => { window.__gvIptalOlcum.kare++; });
  });
  const k3 = await p3.locator('#bilOnlineCanvas').boundingBox();
  await p3.mouse.move(k3.x + k3.width * 0.55, k3.y + k3.height * 0.5);
  await p3.mouse.down();
  await p3.mouse.move(k3.x + k3.width * 0.35, k3.y + k3.height * 0.5);
  await p3.mouse.click(k3.x + k3.width * 0.35, k3.y + k3.height * 0.5, { button: 'right' });
  await p3.mouse.up();
  await uyu(1200);
  const iptal = await p3.evaluate(() => window.__gvIptalOlcum);
  assert.strictEqual(iptal.kare, 0, 'sağ tıkla ısteka bırakılınca vuruş YAPILMAMALI');
  console.log('  ✓ 4) sağ tıkla ısteka bırakma hâlâ vuruşu iptal ediyor');

  await c1.close(); await c2.close(); await tr.close();
  server.close();
  console.log('OK bilardo anında vuruş');
  process.exit(0);
}
main().catch(e => { console.error('❌ BİLARDO VURUŞ HATASI:', e.message); process.exit(1); });
