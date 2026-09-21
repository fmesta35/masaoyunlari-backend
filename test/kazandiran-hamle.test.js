'use strict';
/* ============================================================================
 * KAZANDIRAN HAMLE TAHTADA İŞARETLİ KALIR
 * ============================================================================
 * Kullanıcı isteği (verbatim): "oyuncuların hangi hamleyle bitirdiğini
 * görebilmeleri için... oyunu nasıl kaybedip/kazandıklarını anlasınlar."
 *
 * Doğrulananlar:
 *  1) Connect4 motoru kazandıran DÖRTLÜNÜN karelerini döndürür.
 *  2) Gomoku motoru kazandıran BEŞLİNİN karelerini döndürür.
 *  3) Sunucu bu kareleri oyun durumuyla birlikte gönderir.
 *  4) İstemci o kareleri .gv-kazandiran sınıfıyla işaretler ve maç sonu
 *     boyunca işaretli kalır.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-kzn-'));
process.env.GV_POST_GAME_HOLD_MS = '60000';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const uyu = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

// ---- 1-2) Motorlar ----
{
  const c4 = require('../connect4-engine.js');
  const st = c4.init();
  // Kırmızı alt sırada 0,1,2,3 → dörtlü; sarı araya 6. sütuna oynar
  [[0, 0], [1, 6], [0, 1], [1, 6], [0, 2], [1, 6], [0, 3]].forEach(([s, c]) => c4.play(st, s, c));
  assert.strictEqual(st.winner, 0, 'connect4: kırmızı kazanmalı');
  assert.ok(Array.isArray(st.kazananKareler) && st.kazananKareler.length === 4,
    'connect4: kazandıran 4 kare dönmeli — ' + JSON.stringify(st.kazananKareler));
  assert.deepStrictEqual(st.kazananKareler, [[5, 0], [5, 1], [5, 2], [5, 3]],
    'connect4: doğru dörtlü işaretlenmeli');
  console.log('  ✓ 1) connect4 motoru kazandıran dörtlüyü döndürüyor');

  const gm = require('../gomoku-engine.js');
  const g = gm.init();
  for (let i = 0; i < 5; i++) { gm.play(g, 0, 5, 5 + i); if (i < 4) gm.play(g, 1, 10, 5 + i); }
  assert.strictEqual(g.winner, 0, 'gomoku: siyah kazanmalı');
  assert.strictEqual((g.kazananKareler || []).length, 5, 'gomoku: kazandıran 5 kare dönmeli');
  console.log('  ✓ 2) gomoku motoru kazandıran beşliyi döndürüyor');
}

async function istemci() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  return { dom, win: dom.window };
}
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 20000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await uyu(100);
  }
  throw new Error('bekleme zaman aşımı: ' + ne);
}
const tikla = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  const A = await istemci(), B = await istemci();
  const ikisi = [A, B];
  for (const c of ikisi) {
    await bekle(() => c.win.GV && c.win.st && c.win.GVArena, 25000, 'hazır');
    await bekle(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, 'oda kabuğu');
    c.win.st.curGame = 'connect4';
    c.win.GV.joinRoom('kzn-c4');
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    tikla(c.win, c.win.document.querySelector('#gv-real-chess-wait .gv-ready'));
  }
  for (const c of ikisi) await bekle(() => c.win.document.querySelector('#boardArea .c4-board'), 25000, 'tahta');

  // Kırmızı (koltuk 0) 0,1,2,3 — sarı hep 6. sütun
  const kirmizi = ikisi.find(c => c.win.GVArena.seat() === 0);
  const sari = ikisi.find(c => c !== kirmizi);
  const oyna = (c, col) => c.win.__gvRoomSocket.emit('connect4Move', { roomId: 'kzn-c4', col: col });
  for (const [c, col] of [[kirmizi, 0], [sari, 6], [kirmizi, 1], [sari, 6],
                          [kirmizi, 2], [sari, 6], [kirmizi, 3]]) {
    oyna(c, col); await uyu(260);
  }

  // ---- 3-4) Kareler istemciye ulaştı ve işaretlendi ----
  for (const c of ikisi) {
    const isaretli = await bekle(
      () => { const l = c.win.document.querySelectorAll('#boardArea .c4-c.gv-kazandiran');
              return l.length ? l : null; }, 12000,
      'kazandıran dörtlü tahtada işaretlenmeli');
    assert.strictEqual(isaretli.length, 4, 'tam 4 kare işaretli olmalı');
  }
  console.log('  ✓ 3) kazandıran kareler sunucudan geldi');
  console.log('  ✓ 4) her iki oyuncunun tahtasında dörtlü işaretli');

  // Maç sonu paneli açıkken işaret DURUYOR olmalı
  await bekle(() => A.win.document.querySelector('.gv-bitis-panel'), 12000, 'bitiş paneli');
  assert.strictEqual(A.win.document.querySelectorAll('#boardArea .c4-c.gv-kazandiran').length, 4,
    'bitiş ekranı açıkken de dörtlü işaretli kalmalı');
  console.log('  ✓ 5) bitiş paneli açıkken işaret duruyor (tahta kapanmadığı için görünür)');

  A.dom.window.close(); B.dom.window.close();
  server.close();
  console.log('OK kazandıran hamle işareti');
  process.exit(0);
}
main().catch(e => { console.error('❌ KAZANDIRAN HAMLE HATASI:', e); process.exit(1); });
