'use strict';
/*
 * TAM EKRANDA ODADAN AYRILMA — kullanıcı raporu (verbatim):
 *   "tam ekrandayken ayrıl dediğinde arka planda kalıyor."
 *
 * KÖK NEDEN: Fullscreen API tam ekranda YALNIZ tam ekrana alınan öğenin
 * alt ağacını çizer. Oyuncu ayrıldığında sayfa gerçekten lobiye geçer
 * (pg-lobby 'active' olur) ama tarayıcı hâlâ #pg-room'u gösterdiği için
 * oyuncu boşalmış masayı görür.
 *
 * Eski __gvTamEkrandanCik() yalnız tam ekran öğesi TAM OLARAK #pg-room ise
 * çıkıyordu; başka bir düğüm tam ekrandaysa (F11 ile belge, ya da oda
 * yeniden çizilip düğüm değiştiyse) çıkış hiç denenmiyordu. Artık çıkış
 * KOŞULSUZDUR ve ayrıca bir nöbetçi (600 ms) oda sayfası etkin değilken
 * tam ekran açık kalmışsa onu bırakır.
 *
 * Bu test jsdom'da Fullscreen API'sini taklit eder ve DÖRT yolu dener:
 *  1) oyun içindeyken "Ayrıl" → tam ekrandan çıkılmalı, lobi görünmeli
 *  2) gv:roomLeft olayı tek başına → tam ekrandan çıkılmalı
 *  3) tam ekrandaki öğe #pg-room DEĞİLSE bile çıkılmalı (asıl hata)
 *  4) nöbetçi: oda sayfası kapalıyken tam ekran açık kalırsa bırakılmalı
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-fsleave-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 20000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + ne);
}
async function pencere(base) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = base; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV && win.GVArena, 25000, 'sayfa açılışı');
  return win;
}
function tikla(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

/* Fullscreen API taklidi: hangi öğenin tam ekranda olduğunu biz söyleriz. */
function fsTakli(win) {
  const doc = win.document;
  const durum = { el: null, cikisSayisi: 0 };
  const yaz = v => Object.defineProperty(doc, 'fullscreenElement', { value: v, configurable: true });
  yaz(null);
  doc.exitFullscreen = function () {
    durum.cikisSayisi++; durum.el = null; yaz(null);
    doc.dispatchEvent(new win.Event('fullscreenchange'));
    return Promise.resolve();
  };
  durum.gir = function (el) {
    durum.el = el; yaz(el);
    doc.dispatchEvent(new win.Event('fullscreenchange'));
  };
  const oda = doc.getElementById('pg-room');
  oda.requestFullscreen = function () { durum.gir(oda); return Promise.resolve(); };
  return durum;
}

async function odayaGir(win, oyun, odaId) {
  await bekle(() => typeof win.__gvStartRealRoomWaiting === 'function', 25000, 'oda köprüsü');
  win.st.curGame = oyun;
  win.GV.joinRoom(odaId);
  const b = await bekle(() => win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
  b.click();
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  let gecti = 0;

  for (const oyun of ['gomoku', 'kelimelik']) {
    const tahtaSec = oyun === 'gomoku' ? '.gm-board' : '.kl-tahta';
    const oda = 'fsay-' + oyun + '-' + Date.now();

    // --- 1) oyun içindeyken "Ayrıl" ---
    {
      const A = await pencere(BASE), B = await pencere(BASE);
      await odayaGir(A, oyun, oda); await odayaGir(B, oyun, oda);
      for (const w of [A, B]) await bekle(() => w.document.querySelector('#boardArea ' + tahtaSec), 25000, oyun + ' tahtası');
      const fsA = fsTakli(A);
      A.GV.toggleFullscreen();
      await bekle(() => A.document.getElementById('pg-room').classList.contains('gv-fs'), 5000, 'tam ekran açıldı');
      assert.strictEqual(fsA.el, A.document.getElementById('pg-room'));

      A.GV.leaveRoom();
      /* Oyun sürerken ayrılma js/leave-guard.js'in onay penceresinden geçer.
         O kaplama TAM EKRANDA #pg-room'un içine eklenmeli (aksi halde
         tarayıcı onu çizmez ve oyuncu masadan ayrılamaz) — burada hem
         varlığı hem de doğru ebeveyni denetlenir. */
      const onay = await bekle(() => A.document.querySelector('.gvlg-overlay'), 6000,
        oyun + ': terk onayı penceresi açılmalı');
      assert.strictEqual(onay.parentNode, A.document.getElementById('pg-room'),
        'tam ekranda onay penceresi #pg-room içine eklenmeli, yoksa çizilmez');
      tikla(A, onay.querySelector('.gvlg-yes'));
      await bekle(() => fsA.cikisSayisi > 0, 8000, oyun + ': Ayrıl tam ekrandan çıkarmalı');
      await bekle(() => !A.document.getElementById('pg-room').classList.contains('gv-fs'), 5000, 'gv-fs sınıfı kalkmalı');
      await bekle(() => A.document.getElementById('pg-lobby').classList.contains('active'), 8000, 'lobi görünmeli');
      assert.strictEqual(A.document.getElementById('pg-room').classList.contains('active'), false,
        'oda sayfası arka planda ETKİN kalmamalı');
      console.log('  ✓ ' + oyun + ' 1) tam ekranda Ayrıl → tam ekran bırakıldı, lobi açıldı');
      gecti++;
      try { A.close(); } catch (_) {}
      try { B.close(); } catch (_) {}
      await sleep(150);
    }
  }

  // --- 2/3/4) tek pencerede olay, yabancı öğe ve nöbetçi ---
  {
    const W = await pencere(BASE);
    const fsW = fsTakli(W);
    const odaEl = W.document.getElementById('pg-room');

    // 2) gv:roomLeft olayı tek başına tam ekranı bırakmalı
    fsW.gir(odaEl);
    odaEl.classList.add('gv-fs');
    W.dispatchEvent(new W.CustomEvent('gv:roomLeft', { detail: { roomId: 'x' } }));
    await bekle(() => fsW.cikisSayisi >= 1, 5000, 'gv:roomLeft tam ekrandan çıkarmalı');
    assert.strictEqual(odaEl.classList.contains('gv-fs'), false);
    console.log('  ✓ 2) gv:roomLeft olayı tam ekranı bırakıyor');
    gecti++;

    // 3) ASIL HATA: tam ekrandaki öğe #pg-room DEĞİLSE de çıkılmalı
    const yabanci = W.document.body;
    fsW.gir(yabanci);
    const once = fsW.cikisSayisi;
    W.__gvTamEkrandanCik();
    assert.ok(fsW.cikisSayisi > once,
      'tam ekrandaki öğe #pg-room olmasa da çıkış denenmeli (kullanıcı raporundaki hata)');
    console.log('  ✓ 3) tam ekrandaki öğe oda değilken bile çıkış yapılıyor');
    gecti++;

    // 4) NÖBETÇİ: oda sayfası etkin değilken tam ekran açık kalırsa bırakılır
    W.document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    W.document.getElementById('pg-lobby').classList.add('active');
    fsW.gir(odaEl);
    const once2 = fsW.cikisSayisi;
    await bekle(() => fsW.cikisSayisi > once2, 4000, 'nöbetçi tam ekranı bırakmalı');
    console.log('  ✓ 4) nöbetçi: oda kapalıyken açık kalan tam ekran bırakılıyor');
    gecti++;

    // 5) nöbetçi ters yönde: tam ekran yokken gv-fs sınıfı kalmamalı
    odaEl.classList.add('gv-fs');
    await bekle(() => !odaEl.classList.contains('gv-fs'), 4000, 'artık tam ekran yok, sınıf temizlenmeli');
    console.log('  ✓ 5) tam ekran kapalıyken gv-fs düzen sınıfı temizleniyor');
    gecti++;
    try { W.close(); } catch (_) {}
  }

  server.close();
  console.log('OK tam ekranda ayrılma (' + gecti + ' kontrol)');
  process.exit(0);
}
main().catch(e => { console.error('❌ TAM EKRAN AYRILMA HATASI:', e); process.exit(1); });
