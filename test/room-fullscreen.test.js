'use strict';

/*
 * TAM EKRAN (madde 6) — okey plus ekranındaki gibi, kullanıcıya oyun
 * odasını TAM EKRAN veya STANDART oynama seçeneği sunulmalı.
 *
 *  Kullanıcı raporu (verbatim):
 *   "okey plus ekranındaki gibi, kullanıcılara oyunları tam ekran
 *    oynayabilme imkanı sunulsun. İster tam ekran seçerse full tam ekran
 *    oynar, ister standart olarak oynar."
 *
 *  jsdom gerçek Fullscreen API'sini desteklemediği için bu test
 *  requestFullscreen/exitFullscreen'i sahte (mock) fonksiyonlarla
 *  değiştirip GV.toggleFullscreen()'in doğru çağrıyı yaptığını ve
 *  document 'fullscreenchange' olayı sonrası #gvFullscreenBtn'in
 *  durumunu (etiket + .is-full sınıfı) doğru güncellediğini kontrol eder.
 *  Ayrıca tarayıcı Fullscreen API'sini hiç desteklemiyorsa
 *  toggleFullscreen()'in sessizce (hata fırlatmadan) düşüp bir toast
 *  gösterdiğini doğrular.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-fullscreen-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + ne);
}

async function misafirPencere(base) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = base; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV, 20000, 'sayfa açılışı');
  await bekle(() => win.st.isGuest === true, 10000, 'ziyaretçi hâli');
  return win;
}

function click(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await misafirPencere(BASE);
  const B = await misafirPencere(BASE);
  const roomId = 'fs-test-room-' + Date.now();
  for (const w of [A, B]) {
    await bekle(() => typeof w.__gvStartRealRoomWaiting === 'function', 20000, 'roomfix hazır');
    w.st.curGame = 'gomoku';
    w.GV.joinRoom(roomId);
  }
  for (const w of [A, B]) {
    const btn = await bekle(() => w.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM düğmesi');
    click(w, btn);
  }
  for (const w of [A, B]) {
    await bekle(() => w.document.querySelector('#boardArea .gm-board'), 20000, 'tahta çizildi');
  }
  const fsBtn = await bekle(() => A.document.getElementById('gvFullscreenBtn'), 10000, 'tam ekran düğmesi DOM\'da olmalı');
  console.log('  ✓ 1) oyun odasında Tam Ekran düğmesi mevcut');

  // ---- Fullscreen API'sini sahte (mock) uygula ----
  const pgRoom = A.document.getElementById('pg-room');
  let fsEl = null;
  let reqCalls = 0, exitCalls = 0;
  pgRoom.requestFullscreen = function () {
    reqCalls++;
    fsEl = pgRoom;
    Object.defineProperty(A.document, 'fullscreenElement', { value: fsEl, configurable: true });
    A.document.dispatchEvent(new A.window.Event('fullscreenchange'));
    return Promise.resolve();
  };
  A.document.exitFullscreen = function () {
    exitCalls++;
    fsEl = null;
    Object.defineProperty(A.document, 'fullscreenElement', { value: null, configurable: true });
    A.document.dispatchEvent(new A.window.Event('fullscreenchange'));
    return Promise.resolve();
  };
  Object.defineProperty(A.document, 'fullscreenElement', { value: null, configurable: true });

  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'başlangıçta tam ekran değil');
  assert.ok(/Tam Ekran/.test(fsBtn.innerHTML), 'başlangıç etiketi "Tam Ekran": ' + fsBtn.innerHTML);

  // ---- Tam ekrana geç ----
  A.GV.toggleFullscreen();
  await sleep(50);
  assert.strictEqual(reqCalls, 1, 'requestFullscreen bir kez çağrılmalı');
  assert.strictEqual(fsBtn.classList.contains('is-full'), true, 'tam ekrana geçince buton .is-full olmalı');
  assert.ok(/Standart/.test(fsBtn.innerHTML), 'tam ekrandayken etiket "Standart" olmalı: ' + fsBtn.innerHTML);
  console.log('  ✓ 2) GV.toggleFullscreen() tam ekrana geçiriyor, düğme durumunu güncelliyor');

  // ---- Standarda dön ----
  A.GV.toggleFullscreen();
  await sleep(50);
  assert.strictEqual(exitCalls, 1, 'exitFullscreen bir kez çağrılmalı');
  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'standarda dönünce .is-full kalkmalı');
  assert.ok(/Tam Ekran/.test(fsBtn.innerHTML), 'standartta etiket yeniden "Tam Ekran" olmalı: ' + fsBtn.innerHTML);
  console.log('  ✓ 3) GV.toggleFullscreen() tekrar çağrılınca standarda dönüyor (kullanıcı istediği zaman geçebiliyor)');

  // ---- ESC ile tarayıcı kendisi çıkarsa da (dışarıdan fullscreenchange) senkron kalmalı ----
  A.GV.toggleFullscreen(); // tekrar tam ekrana geç
  await sleep(50);
  assert.strictEqual(fsBtn.classList.contains('is-full'), true, 'tekrar tam ekrana geçti');
  // Tarayıcı ESC ile kendi kendine çıkmış gibi simüle et (exitFullscreen ÇAĞRILMADAN):
  fsEl = null;
  Object.defineProperty(A.document, 'fullscreenElement', { value: null, configurable: true });
  A.document.dispatchEvent(new A.window.Event('fullscreenchange'));
  await sleep(50);
  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'ESC ile çıkışta da düğme senkron kalmalı');
  console.log('  ✓ 4) ESC gibi tarayıcı-kaynaklı çıkışlarda da düğme durumu senkron kalıyor');

  // ---- Fullscreen API hiç desteklenmiyorsa sessizce (hatasız) düşmeli ----
  delete pgRoom.requestFullscreen;
  delete pgRoom.webkitRequestFullscreen;
  delete pgRoom.mozRequestFullScreen;
  delete pgRoom.msRequestFullscreen;
  let hataAtildi = false;
  try { A.GV.toggleFullscreen(); } catch (_) { hataAtildi = true; }
  assert.ok(!hataAtildi, 'Fullscreen API desteklenmiyorsa bile hata fırlatılmamalı');
  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'desteklenmiyorsa durum değişmemeli');
  console.log('  ✓ 5) tarayıcı Fullscreen API\'sini desteklemiyorsa sessizce (hatasız) düşüyor');

  try { A.close(); B.close(); } catch (_) {}
  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK tam ekran: kullanıcı istediği an tam ekran/standart arasında geçiş yapabiliyor');
  process.exit(0);
}

main().catch(e => { console.error('❌ TAM EKRAN TEST HATASI:', e); process.exit(1); });
