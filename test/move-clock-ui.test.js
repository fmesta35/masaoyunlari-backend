'use strict';

/*
 * HAMLE (SIRA) SAATİ — sırası gelen oyuncunun KENDİ kartında
 *
 *  ÖNCESİ: geri sayım tahtanın üstünde ayrı bir rozetteydi
 *  ("⏱ Hamle sırası: Siyah — 53 sn"): kimin süresi aktığını anlamak için
 *  yazıyı okumak gerekiyordu, rozet tahtayı aşağı itiyordu ve yalnız
 *  satranç ile tavlada vardı.
 *
 *  ŞİMDİ: sayaç üstteki süre şeridinde sırası gelen oyuncunun kartının
 *  İÇİNDE işler. Bu test iki oyun ailesini birlikte doğrular:
 *    A) SATRANÇ  — ana saat kartta kalır, sayaç altına eklenir
 *    B) DAMA     — ana saat YOKTUR (donmuş "10:00" gösteriliyordu);
 *                  kart artık sayacı büyük gösterir (gv-nomain)
 *  Ayrıca eski rozetlerin DOM'dan tamamen kalktığı ve sayacın gerçekten
 *  geri saydığı kontrol edilir.
 */

const fs2 = require('fs'), os = require('os'), path = require('path');
process.env.GV_DATA_DIR = fs2.mkdtempSync(path.join(os.tmpdir(), 'gv-mclock-'));
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function makeClient() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  return dom.window;
}

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 25000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('bekleme zaman aşımı: ' + what);
}

function cards(win) {
  return Array.prototype.slice.call(win.document.querySelectorAll('#topTimers .timer'));
}
function moveText(win, i) {
  const c = cards(win)[i];
  const el = c && c.querySelector('.timer-move');
  return el ? el.textContent.trim() : null;
}
function secsIn(txt) {
  const m = /(\d+)\s*sn/.exec(String(txt || ''));
  return m ? Number(m[1]) : null;
}

async function oyunKur(gameId) {
  const A = await makeClient(), B = await makeClient();
  for (const w of [A, B]) {
    await waitFor(() => w.GV && w.st && w.GVMoveClock, 25000, 'istemci hazır');
    await waitFor(() => typeof w.__gvStartRealRoomWaiting === 'function', 25000, 'bekleme odası köprüsü');
    w.st.curGame = gameId;
    w.GV.joinRoom('mc-' + gameId);
  }
  for (const w of [A, B]) {
    await waitFor(() => w.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM düğmesi');
    w.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
  return [A, B];
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  // ================= A) SATRANÇ: ana saat + altında sayaç =================
  {
    const [A, B] = await oyunKur('chess');
    for (const w of [A, B]) await waitFor(() => w.document.querySelector('#boardArea .chess'), 25000, 'satranç tahtası');

    // 1) Eski rozet DOM'dan tamamen kalktı
    for (const w of [A, B]) {
      assert.strictEqual(w.document.getElementById('moveClockBadge'), null,
        'satranç: tahtanın üstündeki eski hamle rozeti kalkmalı');
    }

    // 2) Sayaç, sırası gelen oyuncunun KENDİ kartında
    const dolu = await waitFor(() => {
      for (const w of [A, B]) {
        const t0 = secsIn(moveText(w, 0)), t1 = secsIn(moveText(w, 1));
        if (t0 !== null || t1 !== null) return w;
      }
      return null;
    }, 20000, 'satranç: kart içi sayaç dolmalı');

    const idx = secsIn(moveText(dolu, 0)) !== null ? 0 : 1;
    const digerIdx = idx === 0 ? 1 : 0;
    assert.strictEqual(secsIn(moveText(dolu, digerIdx)), null,
      'satranç: sayaç YALNIZ sırası gelenin kartında olmalı');
    assert.ok(cards(dolu)[idx].classList.contains('active'),
      'satranç: sayacın olduğu kart vurgulu (sıra o oyuncuda) olmalı');

    // 3) Ana saat kartta DURUYOR (satrançta oyun saati var)
    const strip = dolu.document.getElementById('topTimers');
    assert.ok(!strip.classList.contains('gv-nomain'),
      'satranç: ana saat gösterilmeye devam etmeli');
    assert.ok(/\d\d:\d\d/.test(cards(dolu)[idx].querySelector('.timer-time').textContent),
      'satranç: kartın ana saati hâlâ dk:sn biçiminde');

    // 4) Sayaç GERÇEKTEN geri sayıyor
    const ilk = secsIn(moveText(dolu, idx));
    await sleep(1600);
    const son = secsIn(moveText(dolu, idx));
    assert.ok(son !== null && son < ilk, 'satranç: sayaç geri saymalı (' + ilk + ' → ' + son + ')');
    console.log('  ✓ 1) satranç: eski rozet kalktı; sayaç sırası gelenin kartında, ana saatin altında, geri sayıyor');

    for (const w of [A, B]) { try { w.close(); } catch (_) {} }
    await sleep(150);
  }

  // ============ B) DAMA: ana saat yok → sayaç kartın BÜYÜK sayısı ============
  {
    const [A, B] = await oyunKur('dama');
    for (const w of [A, B]) await waitFor(() => w.document.querySelector('#boardArea .dama-board'), 25000, 'dama tahtası');

    const sirali = await waitFor(() => [A, B].find(w => {
      const s = w.GVArena && w.GVArena.state();
      return s && typeof s.turnSeat === 'number' && s.turnSeat === w.GVArena.seat();
    }) || null, 20000, 'dama: sırası gelen pencere');
    const bekleyen = [A, B].find(w => w !== sirali);

    // 1) Sunucu artık bu oyunlarda da hamle saati alanlarını gönderiyor
    const s = sirali.GVArena.state();
    assert.ok(typeof s.turnRemainingMs === 'number' && s.turnRemainingMs > 0,
      'dama: durum paketi turnRemainingMs taşımalı');
    assert.ok(typeof s.turnLimitMs === 'number', 'dama: durum paketi turnLimitMs taşımalı');

    // 2) Sırası gelen oyuncu sayacı KENDİ kartında (0. kart = "Siz") görür
    await waitFor(() => secsIn(moveText(sirali, 0)) !== null, 15000, 'dama: sıradaki oyuncunun kartı');
    assert.strictEqual(secsIn(moveText(sirali, 1)), null, 'dama: rakip kartında sayaç olmamalı');
    assert.ok(cards(sirali)[0].classList.contains('active'), 'dama: sıradakinin kartı vurgulu');

    // 3) Bekleyen oyuncu AYNI sayacı rakip kartında (1. kart) görür
    await waitFor(() => secsIn(moveText(bekleyen, 1)) !== null, 15000, 'dama: bekleyenin rakip kartı');
    assert.strictEqual(secsIn(moveText(bekleyen, 0)), null, 'dama: bekleyenin kendi kartında sayaç olmamalı');

    // 4) Ana saati olmayan oyunda donmuş "10:00" gizlenir, sayaç büyür
    const strip = sirali.document.getElementById('topTimers');
    assert.ok(strip.classList.contains('gv-nomain'),
      'dama: ana saat olmadığı için şerit gv-nomain olmalı (donmuş 10:00 gizlenir)');

    // 5) Geri sayıyor
    const ilk = secsIn(moveText(sirali, 0));
    await sleep(1600);
    const son = secsIn(moveText(sirali, 0));
    assert.ok(son !== null && son < ilk, 'dama: sayaç geri saymalı (' + ilk + ' → ' + son + ')');
    console.log('  ✓ 2) dama: sunucu hamle saati gönderiyor; sayaç iki pencerede de DOĞRU kartta ve geri sayıyor');

    for (const w of [A, B]) { try { w.close(); } catch (_) {} }
    await sleep(150);
  }

  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK hamle saati: sırası gelen oyuncunun kendi süre kartında');
  process.exit(0);
}

main().catch(err => { console.error('❌ HAMLE SAATİ HATASI:', err); process.exit(1); });
