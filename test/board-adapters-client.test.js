'use strict';

/*
 * TAHTA ADAPTÖRLERİ (istemci) — dama, türk daması, reversi, gomoku, connect4,
 * bilardo GERÇEK tarayıcı benzeri pencerede çizilip TIKLAMAYLA oynanıyor mu?
 *
 *  Bu altı oyunun istemcileri daha önce şu hatalarla sessizce bozuktu:
 *   - `gv:roomGameStarted` dinleyicisi `e` parametresini ALMADAN `e.detail`
 *     okuyordu → ReferenceError; adaptörler bu olayla hiç açılmıyordu.
 *   - Türk daması odaya gameId:'dama' ile katılmaya çalışıyordu.
 *   - Türk damasının yüklendi bayrağı (__gvTurkDamaOnlineLoaded) köprünün
 *     aradığı adla (__gvTurkdamasiOnlineLoaded) uyuşmuyordu → her seferinde
 *     yeniden yükleniyordu.
 *   - Adaptörler paylaşılan sokete rastgele misafir anahtarıyla YENİDEN
 *     katılıyordu (bekleme odası zaten katılmışken).
 *
 *  Test: her oyunda iki gerçek pencere masaya oturur, tahta ÇİZİLİR, sırası
 *  gelen pencere DOM'dan tıklayarak hamle yapar ve hamle sunucudan İKİ
 *  pencereye de döner.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';

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

function click(win, el) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

const GAMES = [
  {
    id: 'dama', sel: '.dama-board', label: 'İngiliz Daması',
    move: function (win, root) {
      const s = win.GVArena.state();
      const m = s.legalMoves[0];
      click(win, root.querySelector('.dama-c[data-r="' + m.from[0] + '"][data-c="' + m.from[1] + '"]'));
      click(win, root.querySelector('.dama-c[data-r="' + m.to[0] + '"][data-c="' + m.to[1] + '"]'));
    }
  },
  {
    id: 'turkdamasi', sel: '.dama-board', label: 'Türk Daması',
    move: function (win, root) {
      const s = win.GVArena.state();
      const m = s.legalMoves[0];
      click(win, root.querySelector('.dama-c[data-r="' + m.from[0] + '"][data-c="' + m.from[1] + '"]'));
      click(win, root.querySelector('.dama-c[data-r="' + m.to[0] + '"][data-c="' + m.to[1] + '"]'));
    }
  },
  {
    id: 'reversi', sel: '.rv-board', label: 'Reversi',
    move: function (win, root) {
      const m = win.GVArena.state().legalMoves[0];
      click(win, root.querySelector('.rv-c[data-r="' + m.to[0] + '"][data-c="' + m.to[1] + '"]'));
    }
  },
  {
    id: 'gomoku', sel: '.gm-board', label: 'Gomoku',
    move: function (win, root) { click(win, root.querySelector('.gm-c[data-r="7"][data-c="7"]')); }
  },
  {
    id: 'connect4', sel: '.c4-board', label: 'Connect4',
    move: function (win, root) { click(win, root.querySelector('.c4-drop-btn[data-c="3"]')); }
  },
  {
    // Bilardo istemcisi yenilendi: tahta artık <canvas class="bil-canvas">,
    // vuruş düğmesi de #bilOnlineShoot. Eski seçiciler (.bil-table /
    // #bilShoot) artık hiçbir şeyi bulamıyor ve test "tahta çizilmedi"
    // diye zaman aşımına düşüyordu.
    id: 'bilardo', sel: '.bil-canvas', label: 'Bilardo',
    move: function (win, root) { click(win, root.querySelector('#bilOnlineShoot')); }
  }
];

function myTurn(win) {
  const s = win.GVArena.state();
  if (!s) return false;
  if (s.kind === 'bilardo') return s.turn === win.GVArena.seat();
  return s.turn === s.playerColor;
}

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;

  for (const g of GAMES) {
    const A = await makeClient('A'), B = await makeClient('B');
    const both = [A, B];
    for (const c of both) {
      await waitFor(() => c.win.GV && c.win.st && c.win.GVArena, 25000, c.label + ' hazır');
      await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, c.label + ' roomfix');
      c.win.st.curGame = g.id;
      c.win.GV.joinRoom('adp-' + g.id);
    }
    for (const c of both) {
      await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, g.id + ' HAZIRIM');
      c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
    }
    // 1) Tahta iki pencerede de çizilir
    for (const c of both) {
      await waitFor(() => c.win.document.querySelector('#boardArea ' + g.sel), 25000, g.id + ' tahtası (' + c.label + ')');
    }
    // 2) Adaptör yüklenirken JS hatası olmamalı ("e is not defined" regresyonu)
    for (const c of both) {
      const bad = c.win.__gvErrors.filter(x => /is not defined|undefined/.test(x));
      assert.strictEqual(bad.length, 0, g.id + ': istemci JS hatası → ' + bad.join(' | '));
    }
    // 3) Sırası gelen pencere DOM'dan tıklayarak hamle yapar
    const mover = await waitFor(() => both.find(c => myTurn(c.win)) || null, 15000, g.id + ' sıra sahibi');
    const other = both.find(c => c !== mover);
    const before = JSON.stringify(mover.win.GVArena.state().board || mover.win.GVArena.state().balls || {});
    g.move(mover.win, mover.win.document.getElementById('boardArea'));
    // 4) Hamle SUNUCUDAN her iki pencereye de döner
    await waitFor(() => JSON.stringify(mover.win.GVArena.state().board || mover.win.GVArena.state().balls || {}) !== before,
      12000, g.id + ': hamle sunucudan geri gelmeli (oynayan)');
    await waitFor(() => {
      const s = other.win.GVArena.state();
      return s && JSON.stringify(s.board || s.balls || {}) !== before;
    }, 12000, g.id + ': hamle RAKİP penceresine de yansımalı');
    console.log('  ✓ ' + g.label + ': tahta çizildi, tıklamayla hamle iki pencereye de yansıdı');
    for (const c of both) { try { c.win.close(); } catch (_) {} }
    await sleep(120);
  }

  server.close();
  console.log('OK tahta adaptörleri (jsdom): 6 oyun çiziliyor ve tıklamayla oynanıyor');
  process.exit(0);
}

main().catch(err => { console.error('❌ ADAPTÖR HATASI:', err); process.exit(1); });
