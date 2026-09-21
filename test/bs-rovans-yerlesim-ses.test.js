'use strict';
/* ============================================================================
 * AMİRAL BATTI — RÖVANŞTA FİLO BAŞTAN DİZİLİR + SES ANA ANAHTARI
 * ============================================================================
 * Kullanıcı raporu (verbatim): "Amiral battı - oyun içerisinde sesleri
 * kapatmamıza rağmen hala ses çıkıyor. rövanş talepleri kabul edildi ancak
 * filoyu yerleştirme komutları vs. gelmediği için oyuna başlanamıyor."
 *
 * KÖK NEDEN (yerleşim): istemcideki yerleşim durumu YALNIZ oda kimliğine
 * bağlıydı. Rövanşta oda aynı kaldığı için eski durum (gemiler dizili +
 * "onayladım") duruyor, ekran "Filon hazır — rakibi bekliyorsun" diye
 * kilitleniyor ve yeni filo sunucuya hiç gönderilmiyordu.
 * KÖK NEDEN (ses): üstteki "🔇 Ses" düğmesi yalnız WebAudio efektlerini
 * kapatıyordu; sesli anlatım (konuşma) kendi anahtarıyla konuşmaya devam
 * ediyordu. Oyuncu için ikisi de "oyun sesi".
 *
 * Doğrulananlar:
 *  1) Rövanş kabul edilince yerleştirme ekranı SIFIRDAN gelir: gemi tepsisi
 *     dolu, tahtada yerleşmiş gemi yok, "Filoyu Onayla" kilitli.
 *  2) Yeni filo dizilip onaylanınca muharebe gerçekten başlar.
 *  3) Ana ses anahtarı kapalıyken sesli anlatım da susar; açıkken konuşur.
 * ========================================================================= */

process.env.GV_POST_GAME_HOLD_MS = '30000';

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bs-rovans-'));

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
const CELL = 34;
function sahteYerlesim(win) {
  win.Element.prototype.getBoundingClientRect = function () {
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
async function filoDiz(c) {
  await bekle(() => c.win.document.querySelector('#boardArea .bs-place'), 25000, 'yerleştirme ekranı');
  sahteYerlesim(c.win);
  tikla(c.win, await bekle(() => c.win.document.querySelector('.bs-shuffle'), 8000, 'rastgele'));
  tikla(c.win, await bekle(() => {
    const b = c.win.document.querySelector('.bs-ready-btn'); return (b && !b.disabled) ? b : null;
  }, 10000, 'onay düğmesi'));
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  const A = await istemci(), B = await istemci();
  const ikisi = [A, B];
  for (const c of ikisi) {
    await bekle(() => c.win.GV && c.win.st && c.win.GVArena, 25000, 'hazır');
    await bekle(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, 'oda kabuğu');
    c.win.st.curGame = 'battleship';
    c.win.GV.joinRoom('bs-rovans-filo');
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    tikla(c.win, c.win.document.querySelector('#gv-real-chess-wait .gv-ready'));
  }
  for (const c of ikisi) await filoDiz(c);
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#boardArea .bs-battlefield'), 25000, 'muharebe');
  }

  // ---- 3) SES: ana anahtar sesli anlatımı da kapatır ----
  {
    const w = A.win;
    assert.ok(w.GVDeniz && w.GVDeniz.ses, 'ses motoru yüklenmeli');
    const konusulan = [];
    w.speechSynthesis = { cancel() {}, speak(u) { konusulan.push(String(u && u.text || '')); } };
    w.SpeechSynthesisUtterance = function (t) { this.text = t; };
    w.GVDeniz.ses.ayarla(false);                       // üstteki "🔇 Ses"
    assert.strictEqual(w.GVDeniz.ses.acik(), false, 'ses kapanmalı');
    assert.strictEqual(w.GVDeniz.ses.cal('ates'), false, 'ses kapalıyken efekt çalmamalı');
    // Sunucudan gelen atış paketini istemcinin KENDİ dinleyicisine veriyoruz
    // (GVArena olayları sokete bağlar; dışarıdan olay üretmenin yolu budur).
    (w.__gvRoomSocket.listeners('battleshipShotResult') || []).forEach(function (fn) {
      fn({ roomId: 'bs-rovans-filo', seat: 1, r: 0, c: 0, result: 'miss' });
    });
    await uyu(400);
    assert.strictEqual(konusulan.length, 0,
      'ana ses kapalıyken sesli anlatım da SUSMALI — konuşulan: ' + JSON.stringify(konusulan));
    w.GVDeniz.ses.ayarla(true);
    console.log('  ✓ 3) ana ses anahtarı kapalıyken sesli anlatım da susuyor');
  }

  // ---- 1-2) Rövanş: filo BAŞTAN dizilir ----
  A.win.__gvRoomSocket.emit('gvResign', { roomId: 'bs-rovans-filo' });
  for (const c of ikisi) await bekle(() => c.win.document.querySelector('.gv-end'), 15000, 'bitiş ekranı');
  tikla(A.win, A.win.document.querySelector('.gv-rematch-btn'));
  tikla(B.win, await bekle(() => B.win.document.getElementById('gvRematchYes'), 10000, 'karar kutusu'));

  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#boardArea .bs-place'), 20000, 'yeni yerleştirme ekranı');
    const d = c.win.document;
    assert.ok(!/Filon hazır/.test(d.querySelector('.bs-place-head').textContent),
      'rövanşta "Filon hazır — rakibi bekliyorsun" ekranında KİLİTLİ kalmamalı');
    assert.strictEqual(d.querySelectorAll('.bs-place-grid .bs-ship').length, 0,
      'yeni elde tahtada yerleşmiş gemi kalmamalı');
    assert.strictEqual(d.querySelectorAll('#bsTray .bs-tray-ship').length, 5,
      'gemi tepsisi 5 gemiyle yeniden dolmalı');
    assert.ok(d.querySelector('.bs-ready-btn') && d.querySelector('.bs-ready-btn').disabled,
      'hiçbir gemi dizilmeden onay düğmesi kilitli olmalı');
    assert.ok(d.querySelector('.bs-shuffle'), 'yerleştirme komutları (rastgele/yön/temizle) gelmeli');
  }
  console.log('  ✓ 1) rövanşta yerleştirme ekranı sıfırdan geliyor, komutlar yerinde');

  for (const c of ikisi) await filoDiz(c);
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#boardArea .bs-battlefield'), 25000,
      'yeni filo onaylanınca muharebe başlamalı');
  }
  console.log('  ✓ 2) yeni filo onaylanınca muharebe başladı');

  A.dom.window.close(); B.dom.window.close();
  server.close();
  console.log('OK amiral battı rövanş yerleşimi + ses anahtarı');
  process.exit(0);
}
main().catch(e => { console.error('❌ RÖVANŞ YERLEŞİM HATASI:', e); process.exit(1); });
