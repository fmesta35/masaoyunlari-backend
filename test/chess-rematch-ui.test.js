'use strict';
/* ============================================================================
 * SATRANÇ — RÖVANŞ ARAYÜZÜ (gerçek tarayıcı akışı)
 * ============================================================================
 * Kullanıcının şikâyeti: "satrançta rövanş talep ettim — karşısı kabul etti mi
 * etmedi mi belirli değil, böyle takılı kaldı." (ekran görüntüsünde tahta bomboş)
 *
 * Doğrulananlar:
 *  1) Maç bitince satranç bitiş ekranı ve "Rövanş Talep Et" düğmesi çıkar.
 *  2) Talep edilince TALEP EDENDE bekleme yazısı görünür (karşı taraf
 *     bekleniyor — "belirsiz" kalmaz).
 *  3) RAKİPTE kabul/ret kutusu açılır.
 *  4) Kabul edilince İKİ TARAFTA da yeni tahta çizilir (64 kare) ve bitiş
 *     ekranı kapanır — ekran boş kalmaz.
 * ========================================================================= */

process.env.GV_POST_GAME_HOLD_MS = '30000';   // rövanş penceresi açık kalsın

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-chess-rovans-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const uyu = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function istemci(etiket) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  return { dom, win: dom.window, etiket };
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
const tahtaKare = c => c.win.document.querySelectorAll('#boardArea .chess-c').length;

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  const A = await istemci('A'), B = await istemci('B');
  const ikisi = [A, B];
  for (const c of ikisi) {
    await bekle(() => c.win.GV && c.win.st, 25000, c.etiket + ' hazır');
    await bekle(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, c.etiket + ' oda kabuğu');
    c.win.st.curGame = 'chess';
    c.win.GV.joinRoom('satranc-rovans-ui');
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    tikla(c.win, c.win.document.querySelector('#gv-real-chess-wait .gv-ready'));
  }
  for (const c of ikisi) await bekle(() => tahtaKare(c) === 64, 25000, c.etiket + ' tahta çizilmeli');
  console.log('  ✓ 0) maç başladı, iki tarafta da 64 kare çizildi');

  // ---- 1) Biri pes eder → iki tarafta da bitiş ekranı + rövanş düğmesi ----
  A.win.__gvRoomSocket ? null : null;
  const sokA = A.win.__gvRoomSocket || A.win.__gvChessSocket;
  assert.ok(sokA, 'A soketi bulunmalı');
  sokA.emit('gvResign', { roomId: 'satranc-rovans-ui' });

  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('.chess-end-overlay'), 15000, c.etiket + ' bitiş ekranı');
    assert.ok(c.win.document.querySelector('.gv-rematch-btn'),
      c.etiket + ': bitiş ekranında "Rövanş Talep Et" düğmesi olmalı');
  }
  console.log('  ✓ 1) maç bitti, iki tarafta da bitiş ekranı ve rövanş düğmesi var');

  // ---- 2) A rövanş ister → A'da "bekleniyor", B'de kabul kutusu ----
  tikla(A.win, A.win.document.querySelector('.gv-rematch-btn'));
  await bekle(() => {
    const s = A.win.document.querySelector('.gv-rematch-count');
    return s && /bekleniyor/i.test(s.textContent);
  }, 10000, 'talep edende "rakip bekleniyor" yazmalı');
  console.log('  ✓ 2) talep edende durum belirsiz kalmıyor (rakip bekleniyor)');

  const kutu = await bekle(() => B.win.document.getElementById('gvRematchAsk'), 10000,
    'rakipte kabul/ret kutusu açılmalı');
  assert.ok(/Rövanş Talebi/.test(kutu.textContent), 'kutuda talep başlığı olmalı');
  console.log('  ✓ 3) rakipte kabul/ret kutusu açıldı');

  // ---- 4) B kabul eder → iki tarafta da YENİ tahta ----
  tikla(B.win, B.win.document.getElementById('gvRematchYes'));

  for (const c of ikisi) {
    await bekle(() => !c.win.document.querySelector('.chess-end-overlay'), 15000,
      c.etiket + ': bitiş ekranı kapanmalı');
    await bekle(() => tahtaKare(c) === 64, 15000,
      c.etiket + ': rövanş sonrası YENİ tahta çizilmeli (ekran boş kalmamalı)');
    assert.strictEqual(c.win.document.querySelectorAll('#boardArea .chess-p').length, 32,
      c.etiket + ': yeni elde 32 taş dizilmeli');
  }
  console.log('  ✓ 4) rövanş kabul edilince iki tarafta da yeni tahta çizildi');

  A.dom.window.close(); B.dom.window.close();
  server.close();
  console.log('OK satranç rövanş arayüzü');
  process.exit(0);
}
main().catch(e => { console.error('❌ SATRANÇ RÖVANŞ HATASI:', e); process.exit(1); });
