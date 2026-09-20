'use strict';
/* ============================================================================
 * AMİRAL BATTI — KOMUTA KÖPRÜSÜ ARAYÜZÜ
 * ============================================================================
 * Kullanıcı isteği: oyun ekranı, ilettiği komuta köprüsü karesindeki gibi
 * olsun — üstte panoramik cam, ortada taktik ızgaralar, altta radar ve ateş
 * konsolu.
 *
 * Doğrulananlar:
 *  1) Muharebe ekranı köprü kabuğuyla çiziliyor: panoramik cam (canvas),
 *     cam üstünde kerteriz/filo bilgisi, konsolda radar ve ATEŞ düğmesi.
 *  2) Taktik ızgaralar (kendi filom + rakip suları) bozulmadı — 10x10.
 *  3) Rakip sularından bir kare seçilince hedef KİLİTLENİYOR: kare nişanlı
 *     görünüyor, konsolda koordinat yazıyor, ATEŞ düğmesi açılıyor.
 *  4) Yalnız seçmek atış GÖNDERMİYOR; atış ancak ATEŞ düğmesiyle gidiyor
 *     (dokunmatikte yanlış kareye basıp atış harcamayı önler).
 * ========================================================================= */

process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function makeClient(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  return { dom, win, label };
}
async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 20000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('bekleme zaman aşımı: ' + what);
}
// jsdom düzen hesaplamaz; yerleştirme kodu hücre ölçüsünü rect'ten okuyor.
const CELL = 34;
function sahteYerlesim(win) {
  const proto = win.Element.prototype;
  proto.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('bs-cells')) {
      return { left: 0, top: 0, width: CELL * 10, height: CELL * 10,
               right: CELL * 10, bottom: CELL * 10, x: 0, y: 0 };
    }
    if (this.classList && this.classList.contains('bs-cell')) {
      const r = Number(this.dataset.r) || 0, c = Number(this.dataset.c) || 0;
      return { left: c * CELL, top: r * CELL, width: CELL, height: CELL,
               right: (c + 1) * CELL, bottom: (r + 1) * CELL, x: c * CELL, y: r * CELL };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  };
}
const tikla = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;

  const A = await makeClient('A'), B = await makeClient('B');
  const both = [A, B];
  for (const c of both) {
    await waitFor(() => c.win.GV && c.win.st && c.win.GVArena, 25000, c.label + ' hazır');
    await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, c.label + ' roomfix');
    c.win.st.curGame = 'battleship';
    c.win.GV.joinRoom('bs-kopru-ui');
  }
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    tikla(c.win, c.win.document.querySelector('#gv-real-chess-wait .gv-ready'));
  }
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('#boardArea .bs-place'), 25000, 'yerleştirme ekranı');
    sahteYerlesim(c.win);
  }
  // Filoyu ekranın kendi düğmeleriyle diz ve onayla.
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('.bs-shuffle'), 8000, 'rastgele düğmesi');
    tikla(c.win, c.win.document.querySelector('.bs-shuffle'));
    const ready = await waitFor(
      () => { const b = c.win.document.querySelector('.bs-ready-btn'); return (b && !b.disabled) ? b : null; },
      10000, 'onay düğmesi (' + c.label + ')');
    tikla(c.win, ready);
  }
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('#boardArea .bs-battlefield'), 25000, 'muharebe ekranı');
  }

  const doc = A.win.document;

  // ---- 1) Köprü kabuğu ----
  assert.ok(doc.querySelector('.bs-bridge'), 'komuta köprüsü kabuğu olmalı');
  assert.ok(doc.querySelector('#bsSea'), 'panoramik cam (canvas) olmalı');
  const hud = doc.querySelector('.bs-view-hud');
  assert.ok(hud, 'cam üstünde kerteriz/filo bilgisi olmalı');
  assert.ok(/DÜŞMAN FİLO/.test(hud.textContent), 'filo sayacı yazmalı');
  assert.ok(doc.querySelector('#bsRadar'), 'konsolda radar olmalı');
  assert.ok(doc.querySelector('#bsFire'), 'konsolda ATEŞ düğmesi olmalı');
  console.log('  ✓ 1) köprü camı, radar ve ateş konsolu çiziliyor');

  // ---- 2) Izgaralar bozulmadı ----
  assert.strictEqual(doc.querySelectorAll('.bs-mine-grid .bs-cell').length, 100, 'kendi tahtam 10x10 olmalı');
  assert.strictEqual(doc.querySelectorAll('.bs-enemy-grid .bs-cell').length, 100, 'rakip tahtası 10x10 olmalı');
  console.log('  ✓ 2) taktik ızgaralar eskisi gibi duruyor');

  // ---- 3) Hedef seç → ATEŞ açılır ----
  const atan = (A.win.GVArena.state().turn === A.win.GVArena.seat()) ? A : B;
  const ad = atan.win.document;
  assert.ok(ad.querySelector('#bsFire').disabled, 'hedef seçilmeden ATEŞ kapalı olmalı');
  const hucre = ad.querySelector('.bs-enemy-grid .bs-cell.live');
  assert.ok(hucre, 'sırası olan oyuncuda ateşlenebilir kare olmalı');
  tikla(atan.win, hucre);
  await sleep(250);
  assert.ok(ad.querySelector('.bs-cell.aim'), 'seçilen kare nişanlı görünmeli');
  assert.ok(!ad.querySelector('#bsFire').disabled, 'hedef seçilince ATEŞ açılmalı');
  assert.ok(/^[A-J]\d+$/.test(ad.querySelector('#bsTarget').textContent.trim()),
    'konsolda hedef koordinatı yazmalı — bulunan: ' + ad.querySelector('#bsTarget').textContent);
  console.log('  ✓ 3) kare seçilince hedef kilitleniyor, ATEŞ açılıyor');

  // ---- 4) Yalnız seçmek ateş etmez ----
  const onceki = atan.win.GVArena.state().myShots.length;
  await sleep(600);
  assert.strictEqual(atan.win.GVArena.state().myShots.length, onceki,
    'yalnız seçmek atış GÖNDERMEMELİ (yanlış dokunuş koruması)');
  tikla(atan.win, ad.querySelector('#bsFire'));
  await waitFor(() => atan.win.GVArena.state().myShots.length > onceki, 9000, 'atış gitmeli');
  console.log('  ✓ 4) atış yalnız ATEŞ düğmesiyle gidiyor');

  A.dom.window.close(); B.dom.window.close();
  server.close();
  console.log('OK amiral battı komuta köprüsü');
  process.exit(0);
}
main().catch(e => { console.error('❌ KÖPRÜ HATASI:', e); process.exit(1); });
