'use strict';

/*
 * OKEY 101 İSTEMCİSİ — gerçek tarayıcı benzeri (jsdom) uçtan uca kanıt.
 *  - Lobi: 101 Okey sayfasında 6 hazır masa listelenir; "El" ROZETİ YOK
 *    (maç el sayısıyla değil, 101 puanla biter).
 *  - 4 gerçek pencere 4 kişilik 101 hazır masasına (#336) girer →
 *    bekleme lobisi 4 KOLTUKLU (okey101 artık köprü oyunudur).
 *  - 4×HAZIRIM → masa her pencerede "🔢 OKEY 101 • El 1 (4 Kişilik) •
 *    Hedef 101" başlığıyla çizilir; st.boards.okey variant/target taşır.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '1500';
process.env.GV_OKEY_ROUND_PAUSE_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function makeClient(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE;
      w.fetch = (...a) => fetch(...a);
      w.confirm = () => true;
    }
  });
  return { dom, win: dom.window, label };
}

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('bekleme zaman aşımı: ' + what);
}

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;

  // ============ 1) Lobi: 101 Okey masaları + El rozeti yok ============
  const L = await makeClient('L');
  await waitFor(() => L.win.GV && L.win.st, 20000, 'L GV/st');
  await waitFor(() => typeof L.win.__gvStartRealRoomWaiting === 'function', 20000, 'L roomfix');
  L.win.st.curGame = 'okey101';
  L.win.GV.openLobby('okey101');
  const rows = await waitFor(() => {
    const r = [...L.win.document.querySelectorAll('#roomList .room')]
      .filter(el => /Masa #3\d\d/.test(el.textContent));
    return r.length >= 6 ? r : null;
  }, 15000, 'lobide 101 hazır masaları');
  assert.ok(rows.some(el => el.textContent.includes('#336') && el.textContent.includes('4 Kişilik')), '#336 4 kişilik masa');
  assert.ok(rows.every(el => !/🀄\s*\d+\s*El/.test(el.textContent)), '101 masasında "El" rozeti yok');
  console.log('  ✓ 1) lobi: 6 hazır 101 masası listelendi, "El" rozeti yok');
  L.dom.window.close();

  // ============ 2) 4 pencere #336 masasına → 4 koltuklu bekleme ============
  const clients = [];
  for (let i = 0; i < 4; i++) clients.push(await makeClient('P' + (i + 1)));
  for (const c of clients) {
    await waitFor(() => c.win.GV && c.win.st, 20000, c.label + ' GV/st');
    await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 20000, c.label + ' roomfix');
  }
  for (const c of clients) {
    c.win.st.curGame = 'okey101';
    c.win.GV.joinRoom('336');
  }
  await waitFor(() => clients[0].win.document.querySelectorAll('#gv-real-chess-wait .gvp').length === 4, 8000, '4 koltuk kartı');
  console.log('  ✓ 2) 4 pencere 101 masasında — bekleme lobisi 4 koltuklu');

  // ============ 3) 4×HAZIRIM → masa "OKEY 101" başlığıyla çizilir ============
  for (const c of clients) {
    await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 8000, c.label + ' HAZIRIM');
    c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
  for (const c of clients) {
    await waitFor(() => c.win.document.querySelector('#boardArea .okey-table'), 20000, c.label + ' okey-table');
  }
  console.log('  ✓ 3) 4/4 HAZIRIM → 101 okey masası 4 pencerede de çizildi');

  for (const c of clients) {
    const d = c.win.document;
    const hdr = [...d.querySelectorAll('#boardArea .okey-table > div')]
      .map(x => x.textContent).find(t => t.includes('OKEY 101')) || '';
    assert.ok(hdr.includes('OKEY 101'), 'başlık OKEY 101: ' + hdr);
    assert.ok(hdr.includes('Hedef 101'), 'başlıkta hedef 101: ' + hdr);
    assert.ok(hdr.includes('(4 Kişilik)'), 'başlıkta kişi sayısı: ' + hdr);
    const ok = c.win.st.boards.okey;
    assert.strictEqual(ok.variant, 'okey101', 'state variant=okey101');
    assert.strictEqual(ok.target, 101, 'state target=101');
  }
  const hdrTxt = [...clients[0].win.document.querySelectorAll('#boardArea .okey-table > div')]
    .map(x => x.textContent).find(t => t.includes('OKEY 101')) || '';
  console.log('  ✓ 4) başlık + state: "' + hdrTxt.trim().slice(0, 60) + '..." (variant=okey101, target=101)');

  for (const c of clients) c.dom.window.close();
  server.close();
  console.log('✅ OKEY101-CLIENT: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY101 CLIENT HATASI:', err); process.exit(1); });
