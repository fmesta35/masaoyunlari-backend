'use strict';
/* ============================================================================
 * BİLARDO — VURUŞ KONTROLLERİ (falso / ısteka açısı) İSTEMCİ TESTİ
 * ============================================================================
 * Fizik motoru artık gerçek falso, ısteka yükseklik açısı ve defleksiyon
 * çözüyor. Bu ancak oyuncu bunları SEÇEBİLİYORSA bir anlam taşır. Test:
 *
 *  1) Masada falso (vuruş noktası), ısteka açısı ve güç denetimleri VAR.
 *  2) Falso noktası tıklanınca seçim kaydediliyor.
 *  3) Vuruş gönderildiğinde spinX / spinY / elevation SUNUCUYA gidiyor.
 *  4) Masa geometrisi SUNUCUDAN geliyor (istemci kendi sabitini uydurmuyor).
 *  5) Falsolu vuruş sunucuda çözülüp kare kare yayınlanıyor.
 * ========================================================================= */

process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');
const engine = require('../bilardo-engine');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function makeClient(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true;
      // jsdom'da canvas paketi yoktur: 2B bağlamı sahtele ki çizim çağrıları
      // sessizce yutulsun (motorun/istemcinin mantığı yine de koşar).
      const grad = { addColorStop() {} };
      const noop = () => {};
      const ctx = new Proxy({}, {
        get(_t, p) {
          if (p === 'createLinearGradient' || p === 'createRadialGradient') return () => grad;
          if (p === 'measureText') return () => ({ width: 10 });
          return noop;
        }
      });
      w.HTMLCanvasElement.prototype.getContext = function (t) { return t === '2d' ? ctx : null; };
    }
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

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;

  const A = await makeClient('A'), B = await makeClient('B');
  const both = [A, B];
  for (const c of both) {
    await waitFor(() => c.win.GV && c.win.st && c.win.GVArena, 25000, c.label + ' hazır');
    await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, c.label + ' roomfix');
    c.win.st.curGame = 'bilardo';
    c.win.GV.joinRoom('bil-spin-test');
  }
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM düğmesi');
    c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
  for (const c of both) {
    await waitFor(() => c.win.document.querySelector('#boardArea .bil-canvas'), 25000, 'bilardo masası (' + c.label + ')');
  }

  // ---- 4) masa geometrisi sunucudan ----
  const durum = A.win.GVArena.state();
  assert.ok(durum.table && durum.table.W, 'durum paketi masa geometrisini taşımalı');
  assert.strictEqual(durum.table.W, engine.constants.W, 'genişlik sunucuyla aynı olmalı');
  assert.strictEqual(durum.table.H, engine.constants.H, 'yükseklik sunucuyla aynı olmalı');
  const cv = A.win.document.querySelector('#bilOnlineCanvas');
  assert.strictEqual(Number(cv.getAttribute('width')), engine.constants.W,
    'tuval genişliği sunucu geometrisiyle aynı olmalı');
  console.log('  ✓ 4) masa geometrisi sunucudan geliyor (' + engine.constants.W + '×' + engine.constants.H + ')');

  // Sırası gelen pencere
  const mover = await waitFor(() => both.find(c => {
    const s = c.win.GVArena.state();
    return s && s.kind === 'bilardo' && s.turn === c.win.GVArena.seat();
  }) || null, 15000, 'sıra sahibi');
  const win = mover.win;

  // ---- 1) kontroller var mı? ----
  const spin = win.document.querySelector('#bilSpin');
  const elev = win.document.querySelector('#bilElev');
  const power = win.document.querySelector('#bilPower');
  assert.ok(spin, 'falso (vuruş noktası) denetimi olmalı');
  assert.ok(elev, 'ısteka yükseklik açısı denetimi olmalı');
  assert.ok(power, 'güç denetimi olmalı');
  assert.ok(!elev.disabled && !power.disabled, 'sırası gelen oyuncu için denetimler açık olmalı');
  console.log('  ✓ 1) falso, ısteka açısı ve güç denetimleri masada ve etkin');

  // ---- 2) falso noktası seçilebiliyor (sağ-üst çeyrek: sağ falso + takip) ----
  // jsdom'da getBoundingClientRect sıfır döner; widget yarıçapını
  // özniteliğinden alıp olayları ona göre üretiyoruz.
  const R = Number(spin.getAttribute('width')) / 2;
  const evt = (type, cx, cy) => new win.PointerEvent(type, { bubbles: true, clientX: cx, clientY: cy });
  spin.dispatchEvent(evt('pointerdown', R + (R - 6) * 0.6, R - (R - 6) * 0.5));
  spin.dispatchEvent(evt('pointerup', 0, 0));
  await sleep(150);

  // ---- 3) gönderilen vuruş falso ve açıyı taşıyor ----
  elev.value = '35';
  elev.dispatchEvent(new win.Event('input', { bubbles: true }));
  power.value = '60';
  power.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(150);

  let gonderilen = null;
  const sock = win.__gvRoomSocket;
  assert.ok(sock, 'oda soketi olmalı');
  const asilEmit = sock.emit.bind(sock);
  sock.emit = function (ev, payload) {
    if (ev === 'bilardoShoot') gonderilen = payload;
    return asilEmit(ev, payload);
  };
  const kareSozu = new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error('kare akışı gelmedi')), 9000);
    sock.once('bilardoShotFrames', p => { clearTimeout(t); ok(p); });
  });
  win.document.querySelector('#bilOnlineShoot')
     .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await waitFor(() => gonderilen, 6000, 'vuruş gönderimi');

  assert.ok(Number.isFinite(gonderilen.angle), 'açı gönderilmeli');
  assert.ok(gonderilen.power > 0.5 && gonderilen.power <= 1, 'güç gönderilmeli, gelen: ' + gonderilen.power);
  assert.ok(gonderilen.spinX > 0.1, 'sağ yan falso gönderilmeli, gelen spinX=' + gonderilen.spinX);
  assert.ok(gonderilen.spinY > 0.1, 'üst falso (takip) gönderilmeli, gelen spinY=' + gonderilen.spinY);
  assert.ok(Math.abs(gonderilen.elevation - 35 * Math.PI / 180) < 1e-6,
    'ısteka açısı radyan gönderilmeli, gelen: ' + gonderilen.elevation);
  console.log('  ✓ 2-3) seçilen falso ve ısteka açısı sunucuya gidiyor ' +
    `(spinX=${gonderilen.spinX.toFixed(2)}, spinY=${gonderilen.spinY.toFixed(2)}, ` +
    `açı=${Math.round(gonderilen.elevation * 180 / Math.PI)}°)`);

  // ---- 5) sunucu falsolu vuruşu çözüp yayınlıyor ----
  const kareler = await kareSozu;
  assert.ok(kareler.frames.length > 5, 'falsolu vuruş da kare kare yayınlanmalı');
  console.log('  ✓ 5) falsolu vuruş sunucuda çözüldü, ' + kareler.frames.length + ' kare yayınlandı');

  // istemcide JS hatası olmamalı
  for (const c of both) {
    const bad = c.win.__gvErrors.filter(x => /is not defined|undefined/.test(x));
    assert.strictEqual(bad.length, 0, 'istemci JS hatası → ' + bad.join(' | '));
  }

  for (const c of both) { try { c.win.close(); } catch (_) {} }
  server.close();
  console.log('OK bilardo vuruş kontrolleri: falso + ısteka açısı uçtan uca çalışıyor');
}
main().catch(e => { console.error(e); process.exit(1); });
