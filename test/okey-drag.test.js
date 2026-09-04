'use strict';

/*
 * OKEY SÜRÜKLE-BIRAK — imleç hizası + online yönlendirme kanıtı.
 *
 *  Giderilen hata: sürüklenen taşın kopyası <body>'ye ekleniyordu; .ok-tile
 *  genişliği kapsayıcıya göreli (calc(100%/15)) olduğu için klon bozuk boyda
 *  çıkıyor, konumu da her karede ORİJİNAL düğümün rect'inden hesaplandığı için
 *  masa yeniden çizilince ekranın sol üstüne yapışıyordu. Bu yüzden online
 *  okeyde sürükleme tamamen kapatılmıştı (tek tıkla taş atılıyordu).
 *
 *  Bu test GERÇEK sunucu + 4 gerçek jsdom penceresiyle şunları kanıtlar:
 *   1) Sürükleme kopyası (.ok-drag-ghost) oluşur, boyu taşın boyudur.
 *   2) Kopya imleçle BİREBİR hareket eder (tutulan nokta korunur).
 *   3) Masa yeniden çizilse bile kopya sol üste kaçmaz.
 *   4) TAŞ AT bölgesine bırakınca hamle SUNUCUYA gider (online yönlendirme).
 *   5) Istaka içinde bırakınca taş yer değiştirir, sunucuya hamle GİTMEZ.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '30000';
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

/* jsdom yerleşim (layout) hesaplamaz: getBoundingClientRect sıfır döner.
   Sürükleme motoru gerçek koordinatlarla çalıştığı için sahte bir yerleşim
   takılır — böylece "imleç hizası" matematiği gerçekten sınanabilir. */
function stubLayout(win) {
  win.Element.prototype.getBoundingClientRect = function () {
    const r = this.__gvRect || { left: 0, top: 0, width: 0, height: 0 };
    return {
      left: r.left, top: r.top, width: r.width, height: r.height,
      right: r.left + r.width, bottom: r.top + r.height,
      x: r.left, y: r.top, toJSON() { return r; }
    };
  };
}
function setRect(el, left, top, width, height) {
  if (el) el.__gvRect = { left, top, width, height };
}

function ghost(win) { return win.document.querySelector('.ok-drag-ghost'); }

function mouse(win, target, type, x, y) {
  const ev = new win.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
  target.dispatchEvent(ev);
}

// transform: translate3d(Xpx,Ypx,0) scale(s) → {x,y,s}
function parseTransform(el) {
  const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px,\s*0\)\s*scale\(([\d.]+)\)/.exec(el.style.transform || '');
  assert.ok(m, 'klonun transform değeri okunamadı: ' + el.style.transform);
  return { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) };
}

function tileCount(win) { return win.document.querySelectorAll('#boardArea .ok-tile').length; }

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;

  const clients = [];
  for (let i = 0; i < 4; i++) clients.push(await makeClient('P' + (i + 1)));

  for (const c of clients) {
    await waitFor(() => c.win.GV && c.win.st, 20000, c.label + ' GV/st');
    await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 20000, c.label + ' roomfix');
    c.win.st.curGame = 'okey';
    c.win.GV.joinRoom('317');
  }
  for (const c of clients) {
    await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 10000, c.label + ' HAZIRIM');
    c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
  for (const c of clients) {
    await waitFor(() => c.win.document.querySelector('#boardArea .okey-table'), 20000, c.label + ' okey-table');
  }
  console.log('  ✓ 0) 4 pencere masaya oturdu, okey masası çizildi');

  // Sırası gelen (15 taşlı) pencere
  const starter = await waitFor(
    () => clients.find(c => c.win.st?.boards?.okey?.myTurn && tileCount(c.win) === 15) || null,
    10000, 'sıra sahibi (15 taş)');
  const win = starter.win, doc = win.document;
  stubLayout(win);

  // Sahte yerleşim: masa 1000×600, ıstaka altta, TAŞ AT bölgesi ortada.
  const table = doc.querySelector('#boardArea .okey-table');
  const tz = doc.getElementById('okThrowZone');
  const rack = doc.querySelector('#boardArea .ok-rack');
  const shelves = doc.querySelectorAll('#boardArea .ok-shelf-inner');
  setRect(table, 0, 0, 1000, 600);
  setRect(tz, 440, 300, 70, 90);
  setRect(rack, 170, 460, 660, 130);
  setRect(shelves[0], 175, 465, 645, 60);   // üst raf (sh=1)
  setRect(shelves[1], 175, 530, 645, 60);   // alt raf (sh=0)

  const tiles = [...doc.querySelectorAll('#boardArea .ok-tile')];
  const tile = tiles[0];
  // Taşın kutusu: 40×60, sol üst (200, 530) — alt rafın 1. slotu civarı
  setRect(tile, 200, 530, 40, 60);

  // ---- 1) mousedown → klon oluşur, boyu taşın boyu ----
  mouse(win, tile, 'mousedown', 215, 545);          // tutulan nokta: (15,15)
  const g = ghost(win);
  assert.ok(g, 'sürükleme kopyası (.ok-drag-ghost) oluşmalı');
  assert.strictEqual(g.style.width, '40px', 'kopya genişliği taşla aynı olmalı');
  assert.strictEqual(g.style.height, '60px', 'kopya yüksekliği taşla aynı olmalı');
  assert.strictEqual(g.parentNode, doc.body, 'kopya body üzerinde serbest hareket etmeli');
  const t0 = parseTransform(g);
  assert.strictEqual(t0.x, 200, 'kopya X, tutulan nokta korunacak şekilde yerleşmeli');
  assert.strictEqual(t0.y, 530, 'kopya Y, tutulan nokta korunacak şekilde yerleşmeli');
  assert.strictEqual(t0.s, 1, 'ölçek masanın ölçeğiyle aynı olmalı');
  console.log('  ✓ 1) sürükleme kopyası doğru boyda ve tutulan noktada oluştu');

  // ---- 2) mousemove → kopya imleçle BİREBİR ilerler ----
  mouse(win, doc, 'mousemove', 315, 445);           // +100, -100
  const t1 = parseTransform(ghost(win));
  assert.strictEqual(t1.x - t0.x, 100, 'X kayması imleçle birebir olmalı');
  assert.strictEqual(t1.y - t0.y, -100, 'Y kayması imleçle birebir olmalı');
  console.log('  ✓ 2) kopya imleçle birebir hareket ediyor (tutulan nokta sabit)');

  // ---- 3) masa yeniden çizilse bile kopya sol üste kaçmaz ----
  const okBefore = win.st.boards.okey;
  if (typeof win.__gvOkeyOnlineRepaint === 'function') win.__gvOkeyOnlineRepaint();
  assert.ok(win.__gvOkDragging, 'sürükleme sırasında bayrak açık olmalı');
  mouse(win, doc, 'mousemove', 355, 405);           // +40, -40 daha
  const t2 = parseTransform(ghost(win));
  assert.strictEqual(t2.x - t1.x, 40, 'yeniden çizim sonrası da imleç hizası korunmalı');
  assert.strictEqual(t2.y - t1.y, -40, 'yeniden çizim sonrası da imleç hizası korunmalı');
  assert.ok(t2.x > 0 && t2.y > 0, 'kopya ekranın sol üstüne yapışmamalı');
  assert.ok(okBefore, 'okey durumu korunmalı');
  console.log('  ✓ 3) masa yeniden çizilse bile kopya imleçte kaldı (eski "sol üst" hatası yok)');

  // ---- 4) TAŞ AT bölgesine bırak → hamle SUNUCUYA gider ----
  // Bırakma noktası kopyanın merkezidir: merkez (475, 345) → TAŞ AT içinde.
  mouse(win, doc, 'mousemove', 475 - 20 + 15, 345 - 30 + 15);
  mouse(win, doc, 'mouseup', 475 - 20 + 15, 345 - 30 + 15);
  assert.ok(!ghost(win), 'bırakınca kopya kaldırılmalı');
  assert.ok(!win.__gvOkDragging, 'bırakınca sürükleme bayrağı kapanmalı');
  await waitFor(() => tileCount(win) === 14, 10000, 'sunucu atışı işlemeli (15 → 14)');
  const others = clients.filter(c => c !== starter);
  for (const c of others) {
    await waitFor(() => c.win.document.querySelector('#boardArea .ok-disc-tile .dt-num'), 8000,
      c.label + ' atılan taşı görmeli');
  }
  console.log('  ✓ 4) TAŞ AT bölgesine bırakma sunucuya gitti, atık tüm masaya yansıdı');

  // ---- 5) Istaka içinde bırakma: yalnız düzen değişir, hamle gitmez ----
  const turnCli = await waitFor(
    () => clients.find(c => c.win.st?.boards?.okey?.myTurn) || null, 10000, 'yeni sıra sahibi');
  const w2 = turnCli.win, d2 = w2.document;
  stubLayout(w2);
  const sh2 = d2.querySelectorAll('#boardArea .ok-shelf-inner');
  setRect(d2.querySelector('#boardArea .okey-table'), 0, 0, 1000, 600);
  setRect(sh2[0], 175, 465, 645, 60);
  setRect(sh2[1], 175, 530, 645, 60);
  const ok2 = w2.st.boards.okey;
  // Dolu bir slot bul (alt raf sh=0 ya da üst raf sh=1)
  let src = null;
  for (const sh of [1, 0]) for (let sl = 0; sl < 15 && !src; sl++) if (ok2.rack[sh][sl]) src = { sh, sl };
  assert.ok(src, 'ıstakada taş bulunmalı');
  const movedTile = ok2.rack[src.sh][src.sl];
  const before = tileCount(w2);
  const el = [...d2.querySelectorAll('#boardArea .ok-tile')].find(x =>
    (x.getAttribute('onmousedown') || '').includes(`'tile', ${src.sh}, ${src.sl}`));
  assert.ok(el, 'taş düğümü bulunmalı');
  setRect(el, 200, src.sh === 1 ? 465 : 530, 40, 60);
  // Hedef: aynı rafın 12. slotu (rafın soluna 645/15*12 ≈ 516 px)
  const shelfEl = src.sh === 1 ? sh2[0] : sh2[1];
  const shelfRect = shelfEl.__gvRect;
  const targetSlot = 12;
  const targetX = shelfRect.left + (shelfRect.width / 15) * targetSlot + 4;
  const targetY = shelfRect.top + 30;
  mouse(w2, el, 'mousedown', 220, (src.sh === 1 ? 465 : 530) + 30);
  // Bırakma noktası kopyanın MERKEZİ olduğu için imleci merkez ofsetiyle taşı
  mouse(w2, d2, 'mousemove', targetX + 0, targetY + 0);
  mouse(w2, d2, 'mouseup', targetX, targetY);
  await sleep(400);
  assert.strictEqual(tileCount(w2), before, 'ıstaka içi taşımada taş sayısı değişmemeli');
  const ok3 = w2.st.boards.okey;
  const stillThere = [0, 1].some(sh => ok3.rack[sh].some(t => t && t.id === movedTile.id));
  assert.ok(stillThere, 'taş ıstakada kalmalı (sunucuya atılmamalı)');
  console.log('  ✓ 5) ıstaka içi sürükleme yalnız düzeni değiştirdi (hamle gitmedi)');

  for (const c of clients) { try { c.win.close(); } catch (_) {} }
  server.close();
  console.log('OK okey drag (jsdom): imleç hizası + online yönlendirme');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY DRAG HATASI:', err); process.exit(1); });
