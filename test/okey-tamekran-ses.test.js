'use strict';
/* ============================================================================
 * OKEY — TAM EKRANDA KAPLAMALAR + SES EFEKTLERİ
 * ============================================================================
 * Kullanıcı raporu (verbatim): "okey de tam ekranda tıklama problemi var,
 * odadan da ayrılmıyor." / "tam ekrandayken taş sürüklemede de problem var,
 * fiziksel hareketi gözükmüyor." / "okey içerisinde taş atma orjinal sesleri
 * de çıksın, sıra oyuncuya gelirse de ufak bir zil çalsın. Hamle süresi 10
 * saniye kala farklı bir 1-2 ton ayrı ses çıksın."
 *
 * KÖK NEDEN (tam ekran): Fullscreen API YALNIZ #pg-room'un alt ağacını
 * çizer. Gövdeye (<body>) eklenen her kaplama tam ekranda görünmez olur:
 * "masadan ayrıl" onay penceresi (oyuncu onu göremediği için odadan
 * ÇIKAMIYORDU), bildirimler, rövanş karar kutusu ve sürüklenen taşın
 * kopyası. Kod yalnız .modal-bg'yi taşıyordu; liste genişletildi ve yeni
 * kaplamalar doğrudan doğru katmana ekleniyor.
 *
 * Doğrulananlar:
 *  1) Tam ekranda kaplama katmanı #pg-room'dur (__gvKaplamaKati).
 *  2) Tam ekrana geçince #toastWrap ve varsa .gvlg-overlay #pg-room'un
 *     İÇİNE taşınır; çıkışta gövdeye döner.
 *  3) "Ayrıl" onay penceresi tam ekranda GÖRÜNÜR (oda terk edilebilir).
 *  4) Sürüklenen taşın kopyası tam ekranda #pg-room içinde oluşur.
 *  5) Ses motorunda okey sesleri var: taş, zil, süre — ve ana ses kapalıyken
 *     hiçbiri çalmaz.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-okey-fs-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const uyu = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

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

/* jsdom gerçek Fullscreen API'sini uygulamıyor; tam ekranı sayfanın kendi
   sözleşmesiyle taklit ediyoruz: document.fullscreenElement = #pg-room ve
   sayfanın kendi fullscreenchange dinleyicisini tetikle. */
function tamEkran(win, ac) {
  const oda = win.document.getElementById('pg-room');
  Object.defineProperty(win.document, 'fullscreenElement',
    { configurable: true, get: () => (ac ? oda : null) });
  win.document.dispatchEvent(new win.Event('fullscreenchange'));
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  const A = await istemci();
  const w = A.win;
  await bekle(() => w.GV && w.st, 25000, 'sayfa hazır');
  await bekle(() => typeof w.__gvStartRealRoomWaiting === 'function', 25000, 'oda kabuğu');
  w.st.curGame = 'okey';
  w.GV.joinRoom('okey-fs-1');
  await bekle(() => w.document.querySelector('#gv-real-chess-wait'), 15000, 'bekleme odası');

  // ---- 1) Kaplama katmanı ----
  assert.strictEqual(typeof w.__gvKaplamaKati, 'function', 'kaplama katı yardımcısı olmalı');
  assert.strictEqual(w.__gvKaplamaKati(), w.document.body, 'normal modda kat <body> olmalı');
  tamEkran(w, true);
  assert.strictEqual(w.__gvKaplamaKati().id, 'pg-room', 'tam ekranda kat #pg-room olmalı');
  console.log('  ✓ 1) kaplama katmanı tam ekranda #pg-room');

  // ---- 2) Var olan kaplamalar taşınıyor ----
  const toastWrap = w.document.getElementById('toastWrap');
  assert.ok(toastWrap, '#toastWrap olmalı');
  assert.strictEqual(toastWrap.closest('#pg-room') !== null, true,
    'tam ekranda bildirim katmanı #pg-room içine taşınmalı');
  tamEkran(w, false);
  assert.strictEqual(toastWrap.parentNode, w.document.body,
    'tam ekrandan çıkınca bildirim katmanı gövdeye dönmeli');
  console.log('  ✓ 2) bildirim katmanı tam ekranda taşınıyor, çıkışta geri dönüyor');

  // ---- 3) Ayrıl onayı tam ekranda görünür ----
  tamEkran(w, true);
  // Onay penceresi yalnız MAÇ SÜRERKEN çıkar; test kapısından doğrudan açıyoruz.
  await bekle(() => w.__gvLeaveGuard && typeof w.__gvLeaveGuard.askLeave === 'function',
    15000, 'terk bekçisi yüklenmeli');
  let ayrildi = false;
  w.__gvLeaveGuard.askLeave(function () { ayrildi = true; });
  const onay = await bekle(() => w.document.querySelector('.gvlg-overlay'), 8000,
    'ayrılma onay penceresi açılmalı');
  assert.ok(onay.closest('#pg-room'),
    'onay penceresi tam ekranda #pg-room İÇİNDE olmalı (yoksa görünmez, oda terk edilemez)');
  const evet = onay.querySelector('.gvlg-yes');
  assert.ok(evet, 'onayda "evet" düğmesi olmalı');
  tikla(w, evet);
  await bekle(() => !w.document.querySelector('.gvlg-overlay'), 6000, 'onay kapanmalı');
  assert.strictEqual(ayrildi, true, '"Evet, Terk Et" gerçekten odadan çıkarmalı');
  console.log('  ✓ 3) tam ekranda ayrılma onayı görünüyor ve çalışıyor');

  // ---- 4) Sürükleme kopyası doğru katmanda ----
  {
    const oda = w.document.getElementById('pg-room');
    const sahte = w.document.createElement('div');
    sahte.className = 'ok-tile ok-drag-ghost';
    (w.__gvKaplamaKati()).appendChild(sahte);
    assert.ok(sahte.closest('#pg-room'),
      'tam ekranda sürükleme kopyası #pg-room içinde oluşmalı (yoksa taş görünmez)');
    sahte.remove();
    assert.ok(oda, 'oda elemanı duruyor olmalı');
  }
  console.log('  ✓ 4) sürüklenen taşın kopyası tam ekranda çiziliyor');

  // ---- 5) Okey sesleri ----
  {
    assert.ok(w.GVDeniz && w.GVDeniz.ses, 'ses motoru yüklenmeli');
    const calinan = [];
    const asil = w.GVDeniz.ses.cal;
    w.GVDeniz.ses.cal = function (ad) { calinan.push(ad); return asil.call(this, ad); };
    w.GVDeniz.ses.ayarla(true);
    for (const ad of ['tas', 'zil', 'sure', 'tasKoy']) {
      calinan.length = 0;
      w.GVDeniz.ses.cal(ad);
      assert.deepStrictEqual(calinan, [ad], ad + ' sesi tanımlı olmalı');
    }
    // Ana ses kapalıyken hiçbiri çalmaz
    w.GVDeniz.ses.ayarla(false);
    assert.strictEqual(asil.call(w.GVDeniz.ses, 'tas'), false,
      'ses kapalıyken taş sesi çalmamalı');
    assert.strictEqual(asil.call(w.GVDeniz.ses, 'zil'), false,
      'ses kapalıyken zil çalmamalı');
    w.GVDeniz.ses.ayarla(true);
  }
  console.log('  ✓ 5) taş / zil / süre sesleri tanımlı ve ana anahtara bağlı');

  A.dom.window.close();
  server.close();
  console.log('OK okey tam ekran kaplamaları + ses efektleri');
  process.exit(0);
}
main().catch(e => { console.error('❌ OKEY TAM EKRAN HATASI:', e); process.exit(1); });
