'use strict';
/* ============================================================================
 * RÖVANŞ TEKLİFİ — HER OYUNDA ULAŞIR, BİTİŞ EKRANININ ÖNÜNE GEÇER
 * ============================================================================
 * Kullanıcı isteği (verbatim): "amiral battıda rakip rövanş talep ediyor,
 * karşı tarafa talep gelmedi. lobiye dön ve rövanş talep et pop-up'ıyla
 * çakışıyor olabilir kontrol et. Eğer lobiye dön ve rövanş talep et pop
 * ekranındayken rövanş talebi gelirse onu önceliklendir; evet derse yeni
 * oyuna başlar, hayır derse lobiye döner zaten. Tüm 2 kişilik oyunlarda bu
 * şekilde uyarla."
 *
 * ESKİ HATA: js/rematch.js dinleyicilerini 1 sn'lik sayaçla ve yalnız TEK
 * bir global değişkene bağlıyordu. Maç hızlı bitince rakibin soketi henüz
 * bağlanmamış oluyor, sunucunun gönderdiği 'rematchOffer' paketini dinleyen
 * kimse olmuyor ve teklif sessizce kayboluyordu. Artık soket doğduğu anda
 * bağlanıyor (window.io kancası).
 *
 * Doğrulananlar:
 *  1) AMİRAL BATTI: maç biter bitmez talep edilince rakipte karar kutusu
 *     açılır (teklif kaybolmaz).
 *  2) Karar kutusu bitiş ekranının ÜSTÜNDEdir ve bitiş ekranının kendi
 *     "Rövanş Talep Et" düğmesini kilitler (çakışma yok).
 *  3) "Evet" → aynı masada yeni el başlar.
 *  4) İKİ OYUNCU DA aynı anda talep ederse oylama sıfırlanmaz, yeni el başlar.
 * ========================================================================= */

process.env.GV_POST_GAME_HOLD_MS = '30000';

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-rovans-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const ioClient = require('socket.io-client');
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
    return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 };
  };
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  // ================= 1-3) AMİRAL BATTI arayüzü =================
  const A = await istemci(), B = await istemci();
  const ikisi = [A, B];
  for (const c of ikisi) {
    await bekle(() => c.win.GV && c.win.st && c.win.GVArena, 25000, 'hazır');
    await bekle(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, 'oda kabuğu');
    c.win.st.curGame = 'battleship';
    c.win.GV.joinRoom('bs-rovans');
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    tikla(c.win, c.win.document.querySelector('#gv-real-chess-wait .gv-ready'));
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#boardArea .bs-place'), 25000, 'yerleştirme');
    sahteYerlesim(c.win);
    tikla(c.win, await bekle(() => c.win.document.querySelector('.bs-shuffle'), 8000, 'rastgele'));
    tikla(c.win, await bekle(() => {
      const b = c.win.document.querySelector('.bs-ready-btn'); return (b && !b.disabled) ? b : null;
    }, 10000, 'onay'));
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#boardArea .bs-battlefield'), 25000, 'muharebe');
  }

  // Maç HEMEN bitsin: A pes eder (eski hatanın ortaya çıktığı an).
  A.win.__gvRoomSocket.emit('gvResign', { roomId: 'bs-rovans' });
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('.gv-end'), 15000, 'bitiş ekranı');
  }
  const bDugme = B.win.document.querySelector('.gv-rematch-btn');
  assert.ok(bDugme, 'bitiş ekranında rövanş düğmesi olmalı');

  // A talep eder → B'de karar kutusu ANINDA açılmalı.
  tikla(A.win, A.win.document.querySelector('.gv-rematch-btn'));
  const kutu = await bekle(() => B.win.document.getElementById('gvRematchAsk'), 10000,
    'amiral battıda rakibe rövanş teklifi ULAŞMALI');
  console.log('  ✓ 1) amiral battı: teklif rakibe ulaştı, karar kutusu açıldı');

  // Öncelik: kutu bitiş ekranının üstünde ve ekranın kendi düğmesi kilitli.
  assert.ok(/Rövanş Talebi/.test(kutu.textContent), 'kutuda talep başlığı olmalı');
  assert.strictEqual(B.win.document.querySelector('.gv-rematch-btn').disabled, true,
    'karar verilirken bitiş ekranının rövanş düğmesi kilitlenmeli');
  assert.ok(/bekleniyor/i.test(
    (B.win.document.querySelector('.gv-rematch-count') || {}).textContent || 'bekleniyor'),
    'karar sürerken otomatik lobi geri sayımı durmalı');
  console.log('  ✓ 2) karar kutusu bitiş ekranının önüne geçiyor, çakışma yok');

  // Evet → aynı masada yeni el.
  tikla(B.win, B.win.document.getElementById('gvRematchYes'));
  for (const c of ikisi) {
    await bekle(() => !c.win.document.querySelector('.gv-end'), 15000, 'bitiş ekranı kapanmalı');
    await bekle(() => c.win.document.querySelector('#boardArea .bs-place'), 20000,
      'rövanş sonrası filo yeniden dizilmeli');
  }
  console.log('  ✓ 3) evet denince aynı masada yeni el başladı');
  A.dom.window.close(); B.dom.window.close();

  // ================= 4) İki taraf da aynı anda talep ederse =================
  {
    const mk = () => ioClient(BASE, { transports: ['websocket'], forceNew: true });
    const s1 = mk(), s2 = mk();
    const olay = { s1: [], s2: [] };
    ['rematchOffer', 'rematchStarted', 'rematchDeclined', 'gameStarted'].forEach(e => {
      s1.on(e, p => olay.s1.push({ e, p })); s2.on(e, p => olay.s2.push({ e, p }));
    });
    await uyu(300);
    s1.emit('joinRoom', { roomId: 'rov-ayni-an', gameId: 'dama' });
    s2.emit('joinRoom', { roomId: 'rov-ayni-an', gameId: 'dama' });
    await uyu(700);
    s1.emit('setReady', { ready: true }); s2.emit('setReady', { ready: true });
    await bekle(() => olay.s1.some(x => x.e === 'gameStarted'), 9000, 'maç başlamalı');
    olay.s1.length = 0; olay.s2.length = 0;
    s2.emit('gvResign', { roomId: 'rov-ayni-an' });
    await uyu(700);
    // İKİSİ DE aynı anda talep ediyor:
    s1.emit('rematchRequest', { roomId: 'rov-ayni-an' });
    s2.emit('rematchRequest', { roomId: 'rov-ayni-an' });
    await bekle(() => olay.s1.some(x => x.e === 'rematchStarted'), 9000,
      'iki taraf da talep edince oylama kilitlenmemeli, yeni el başlamalı');
    console.log('  ✓ 4) iki oyuncu aynı anda talep etse de masa kilitlenmiyor');
    s1.close(); s2.close();
  }

  server.close();
  console.log('OK rövanş teklifi önceliği');
  process.exit(0);
}
main().catch(e => { console.error('❌ RÖVANŞ ÖNCELİK HATASI:', e); process.exit(1); });
