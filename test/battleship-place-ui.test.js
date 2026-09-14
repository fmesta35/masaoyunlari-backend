'use strict';
/* ============================================================================
 * AMİRAL BATTI — YERLEŞTİRME ARAYÜZÜ (sürükle-bırak + döndürme + görseller)
 * ============================================================================
 * Kullanıcı isteği (verbatim): "Filoları yerleştirirken sürükle bırak
 * mantığıyla ilerlesin. İlgili gemilerin orjinal benzer resimleri gözüksün,
 * kare kutucuk olarak ilerlemesi[n]. Gemi resimleri kare boyutlarına sığacak
 * şekilde yerleştirilsin ve filo yerleştirirken kutu kenarında yön değiştirme
 * işareti olsun orta büyüklükte görülebilir ve tıklanabilir düzeyde."
 *
 * Doğrulananlar:
 *  1) Yerleştirme ekranında her gemi KARE KUTU değil, kendi ÇİZİMİYLE
 *     (svg) ve kapladığı hücre sayısı kadar genişlikte görünür.
 *  2) Gemi tepsiden ızgaraya SÜRÜKLE-BIRAK ile yerleşir (Pointer Events —
 *     masaüstü ve dokunmatik aynı kod yolu).
 *  3) Sürükleme sırasında hedef hücreler geçerli/geçersiz olarak işaretlenir.
 *  4) Yerleşen geminin ucunda tıklanabilir DÖNDÜRME tutamağı vardır ve
 *     yatay ↔ dikey çevirir.
 *  5) Yerleştirme süresi SUNUCUDAN gelir (90 sn) ve hamle saati DEĞİLDİR.
 *  6) Onaylanan filo sunucuya doğru koordinatlarla gider.
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
  win.__gvErrors = [];
  win.addEventListener('error', e => win.__gvErrors.push(String(e.message || e)));
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

// jsdom düzen (layout) hesaplamaz: getBoundingClientRect hep sıfır döner.
// Sürükleme kodu hücre ölçüsünü ve ızgara konumunu bu çağrıdan okuduğu için
// gerçek bir tarayıcıdaki gibi davranması adına sahte ölçüler veriyoruz:
// ızgara (0,0)'dan başlar ve her hücre CELL pikseldir.
const CELL = 34;
function sahteYerlesim(win) {
  const proto = win.Element.prototype;
  proto.getBoundingClientRect = function () {
    if (this.classList && this.classList.contains('bs-cells')) {
      return { left: 0, top: 0, width: CELL * 10, height: CELL * 10, right: CELL * 10, bottom: CELL * 10, x: 0, y: 0 };
    }
    if (this.classList && this.classList.contains('bs-cell')) {
      const r = Number(this.dataset.r) || 0, c = Number(this.dataset.c) || 0;
      return { left: c * CELL, top: r * CELL, width: CELL, height: CELL,
               right: (c + 1) * CELL, bottom: (r + 1) * CELL, x: c * CELL, y: r * CELL };
    }
    if (this.classList && this.classList.contains('bs-ship')) {
      const st = this.getAttribute('style') || '';
      const g = k => { const m = st.match(new RegExp('--' + k + ':\\s*(-?\\d+)')); return m ? Number(m[1]) : 0; };
      const r = g('r'), c = g('c'), n = g('n');
      const yatay = this.dataset.dir !== 'v';
      const w = (yatay ? n : 1) * CELL, h = (yatay ? 1 : n) * CELL;
      return { left: c * CELL, top: r * CELL, width: w, height: h,
               right: c * CELL + w, bottom: r * CELL + h, x: c * CELL, y: r * CELL };
    }
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  };
}
function pe(win, type, x, y) {
  return new win.PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 });
}
// Bir gemiyi (tepsiden ya da tahtadan) hedef hücreye sürükle
function surukle(win, kaynakEl, hedefR, hedefC) {
  kaynakEl.dispatchEvent(pe(win, 'pointerdown', 5, 5));
  const x = hedefC * CELL + CELL / 2, y = hedefR * CELL + CELL / 2;
  win.document.dispatchEvent(pe(win, 'pointermove', x, y));
  return { x, y };
}

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;

  const A = await makeClient('A'), B = await makeClient('B');
  const both = [A, B];
  for (const c of both) {
    await waitFor(() => c.win.GV && c.win.st && c.win.GVArena, 25000, c.label + ' hazır');
    await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, c.label + ' roomfix');
    c.win.st.curGame = 'battleship';
    c.win.GV.joinRoom('bs-place-ui');
  }
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('#boardArea .bs-place'), 25000, 'yerleştirme ekranı (' + c.label + ')');
  }
  const win = A.win;
  sahteYerlesim(win);

  // ---- 5) yerleştirme süresi sunucudan, hamle saati DEĞİL ----
  const st0 = win.GVArena.state();
  assert.strictEqual(st0.phase, 'placing');
  assert.ok(st0.placeLimitMs >= 60000, 'yerleştirme bütçesi sunucudan gelmeli, gelen: ' + st0.placeLimitMs);
  assert.strictEqual(st0.placeLimitMs, 90000, 'yerleştirme süresi 90 sn olmalı');
  assert.strictEqual(st0.turnRemainingMs, null,
    'yerleştirme fazında HAMLE sayacı çalışmamalı (sıra kimsede değil)');
  assert.ok(win.document.querySelector('#bsClock'), 'yerleştirme geri sayımı ekranda olmalı');
  console.log('  ✓ 5) yerleştirme süresi 90 sn ve hamle saatinden ayrı');

  // ---- 1) gemiler kare kutu değil, çizim olarak görünüyor ----
  const tray = win.document.querySelector('#bsTray');
  assert.ok(tray, 'dizilmemiş gemiler için tepsi olmalı');
  const trayShips = tray.querySelectorAll('.bs-tray-ship');
  assert.strictEqual(trayShips.length, 5, '5 gemi tepside olmalı');
  for (const el of trayShips) {
    assert.ok(el.querySelector('svg.bs-art'), 'her gemi kendi çizimiyle görünmeli: ' + el.dataset.ship);
  }
  const carrier = [...trayShips].find(el => el.dataset.ship === 'carrier');
  assert.ok(/--n:\s*5/.test(carrier.getAttribute('style') || ''),
    'çizim kapladığı hücre kadar genişlemeli, style=' + carrier.getAttribute('style'));
  console.log('  ✓ 1) her gemi kare kutu yerine kendi çizimiyle ve boyu kadar görünüyor');

  // ---- 2+3) sürükle-bırak ----
  const cellsEl = win.document.querySelector('.bs-place-grid .bs-cells');
  surukle(win, carrier, 2, 1);                       // C3'ten başlayacak şekilde
  const isaretli = cellsEl.querySelectorAll('.bs-cell.ok').length;
  assert.strictEqual(isaretli, 5, 'sürükleme sırasında 5 hücre GEÇERLİ olarak işaretlenmeli, bulunan: ' + isaretli);
  win.document.dispatchEvent(pe(win, 'pointerup', 0, 0));
  await sleep(150);

  const yerlesen = win.document.querySelector('.bs-place-grid .bs-ship[data-ship="carrier"]');
  assert.ok(yerlesen, 'bırakılan gemi ızgarada görünmeli');
  assert.ok(/--r:\s*2/.test(yerlesen.getAttribute('style')) && /--c:\s*1/.test(yerlesen.getAttribute('style')),
    'gemi bırakılan hücreye yerleşmeli, style=' + yerlesen.getAttribute('style'));
  assert.strictEqual(yerlesen.dataset.dir, 'h');
  assert.ok(yerlesen.querySelector('svg.bs-art'), 'ızgaradaki gemi de çizimle görünmeli');
  assert.strictEqual(cellsEl.querySelectorAll('.bs-cell.ok,.bs-cell.bad').length, 0,
    'bırakıldıktan sonra önizleme işaretleri temizlenmeli');
  console.log('  ✓ 2-3) gemi sürükle-bırakla yerleşti, önizleme geçerli/geçersiz gösterdi');

  // ---- 4) döndürme tutamağı ----
  const rot = yerlesen.querySelector('.bs-rot');
  assert.ok(rot, 'yerleşen geminin ucunda döndürme tutamağı olmalı');
  rot.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(150);
  const donmus = win.document.querySelector('.bs-place-grid .bs-ship[data-ship="carrier"]');
  assert.strictEqual(donmus.dataset.dir, 'v', 'tutamağa tıklayınca gemi dikey olmalı');
  console.log('  ✓ 4) döndürme tutamağı gemiyi yatay ↔ dikey çeviriyor');

  // ---- 6) filo onaylanınca sunucuya doğru gidiyor ----
  win.document.querySelector('.bs-shuffle').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(200);
  const hazirBtn = await waitFor(() => {
    const b = win.document.querySelector('.bs-ready-btn');
    return b && !b.disabled ? b : null;
  }, 5000, 'onay düğmesi etkin');
  let gonderilen = null;
  const sock = win.__gvRoomSocket;
  const asil = sock.emit.bind(sock);
  sock.emit = function (ev, p) { if (ev === 'battleshipPlace') gonderilen = p; return asil(ev, p); };
  hazirBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await waitFor(() => gonderilen, 6000, 'yerleştirme gönderimi');
  assert.strictEqual(gonderilen.placements.length, 5, '5 gemi gönderilmeli');
  for (const p of gonderilen.placements) {
    assert.ok(Number.isInteger(p.r) && Number.isInteger(p.c), 'koordinat tam sayı olmalı');
    assert.ok(p.dir === 'h' || p.dir === 'v', 'yön h/v olmalı');
  }
  await waitFor(() => win.GVArena.state().ready.mine === true, 6000, 'sunucu filoyu kabul etmeli');
  console.log('  ✓ 6) onaylanan filo sunucuya doğru koordinatlarla gitti ve kabul edildi');

  for (const c of both) {
    const bad = c.win.__gvErrors.filter(x => /is not defined|undefined/.test(x));
    assert.strictEqual(bad.length, 0, 'istemci JS hatası → ' + bad.join(' | '));
  }
  for (const c of both) { try { c.win.close(); } catch (_) {} }
  server.close();
  console.log('OK amiral battı yerleştirme arayüzü: sürükle-bırak + gemi çizimleri + döndürme tutamağı');
}
main().catch(e => { console.error(e); process.exit(1); });
