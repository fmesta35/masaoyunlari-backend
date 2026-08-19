'use strict';

/*
 * Regresyon — SAYAÇ SAHİPLİĞİ (tayin edici UI hatası):
 *
 *  Kullanıcı raporu: "Tavla sayacı sıfırlar gibi yanıp sönüyor, belirli bir
 *  süre sonra oyundan otomatik atıyor."
 *
 *  Kök nedenler ve bu testin kilitleri:
 *  1) index.html'in YEREL zamanlayıcısı (#t1/#t2'ye yazan st.timerInterval)
 *     herhangi bir yoldan açık kalırsa online satranç/tavla odasına sızıyor;
 *     iki yazıcı çakışıyor (titreme) ve yerel süre bitince openLobby()
 *     kullanıcıyı lobiye atıyordu (otomatik atılma).
 *     → joinRoom() artık stopTimer() + st.timers=null yapar, startTimer() ve
 *       tick/_updateTimerDisplay st.onlineClock ile mühürlenir.
 *  2) Online modüller (chess-online/tavla-online) ilk sunucu paketinde
 *     st.onlineClock=true işaretler; reset/leave akışı geri alır.
 *
 *  Bu test gerçek index.html'i jsdom'da açar ve GERÇEK joinRoom/startTimer/
 *  _updateTimerDisplay kodunu koşturur.
 */

const assert = require('assert');

async function main() {
  const { JSDOM, VirtualConsole } = require('jsdom');
  const { start } = require('../server.js');

  const server = await start(0); // start() dinleme başlayınca çözülür
  const port = server.address().port;
  const BASE = `http://localhost:${port}`;

  const vc = new VirtualConsole(); // css parse uyarılarını yut
  vc.on('jsdomError', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.GV_BACKEND_URL = BASE;
      window.fetch = (...a) => fetch(...a); // node fetch'ini sayfaya ver
      window.confirm = () => true;
    }
  });
  const win = dom.window;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // Site boot
  let booted = false;
  for (let i = 0; i < 250; i++) {
    if (win.GV && win.st && typeof win.GV.joinRoom === 'function') { booted = true; break; }
    await sleep(100);
  }
  assert.ok(booted, 'site açılamadı (GV/st yok)');
  assert.strictEqual(win.st.onlineClock, false, 'başlangıçta onlineClock=false olmalı');
  console.log('✓ site boot, onlineClock=false');

  // --- 1) Yerel sayaç KALINTISI online tavla odasına sızamaz ---
  // Açık kalmış bir yerel sayacı birebir taklit et (site kodunun ürettiği şekil):
  win.st.timers = { t1: 500, t2: 600, player: 1, unlimited: false, paused: false };
  win.st.timerInterval = setInterval(() => { win.st.timers.t1--; }, 1000);
  win.st.curGame = 'tavla';
  win.GV.joinRoom('201');
  assert.strictEqual(win.st.timers, null, 'joinRoom yerel sayaç durumunu sıfırlamalı');
  assert.strictEqual(win.st.timerInterval, null, 'joinRoom yerel sayaç intervalını durdurmalı');
  console.log('✓ joinRoom(online tavla): yerel sayaç durduruldu + sıfırlandı');

  // --- 2) OnlineClock üstlenilmişken yerel startTimer İNKÂR edilir ---
  win.st.onlineClock = true;
  // startTimer global değil; GV IIFE'si içinde. Sayfa içinde değerlendir:
  const started = (() => { try { win.startTimer(); } catch (e) { return 'throw:' + e.message; } return !!win.st.timerInterval; })();
  assert.strictEqual(started, false, 'onlineClock=true iken startTimer interval kurmamalı');
  // Yerel gösterim de yazamaz:
  win.st.timers = { t1: 123, t2: 456, player: 1, unlimited: false, paused: false };
  win.document.getElementById('t1').textContent = '10:00'; // online modülün yazdığı değer
  win._updateTimerDisplay();
  assert.strictEqual(win.document.getElementById('t1').textContent, '10:00',
    '_updateTimerDisplay onlineClock=true iken panele dokunmamalı');
  console.log('✓ onlineClock=true: yerel startTimer/_updateTimerDisplay kilitli');

  // --- 3) Yerel oyunda (onlineClock yok) startTimer normal çalışır ---
  win.st.onlineClock = false;
  win.startTimer();
  assert.ok(win.st.timerInterval, 'yerel oyunda startTimer çalışmalı');
  const t1Start = win.st.timers.t1;
  await sleep(1200);
  assert.ok(win.st.timers.t1 < t1Start, 'yerel sayaç azalmalı');
  win.stopTimer();
  console.log('✓ onlineClock=false: yerel sayaç normal işler (bozulma yok)');

  // --- 4) Yerel oyun odasına giriş onlineClock kalıntısını temizler ---
  win.st.onlineClock = true; // önceki oturumdan kalmış gibi
  win.st.curGame = 'dama';
  win.st.timerInterval = null;
  win.GV.joinRoom('7788');
  assert.strictEqual(win.st.onlineClock, false, 'yerel oyuna girişte onlineClock sıfırlanmalı');
  console.log('✓ joinRoom(yerel dama): onlineClock kalıntısı temizlendi');

  // --- 5) Online modüller sayfa domurunda hazır ve kanca fonksiyonları tanımlı ---
  for (let i = 0; i < 150 && !win.__gvTavlaOnlineLoaded; i++) await sleep(100);
  assert.ok(win.__gvTavlaOnlineLoaded, 'tavla-online yüklenmeli');
  assert.ok(win.__gvChessOnlineLoaded, 'chess-online yüklenmeli');
  assert.strictEqual(typeof win.__gvTavlaSelfClick, 'function', 'tavla self-click kancası');
  assert.strictEqual(typeof win.__gvTavlaSelfRoll, 'function', 'tavla self-roll kancası');
  assert.strictEqual(typeof win.__gvTavlaSelfBear, 'function', 'tavla self-bear kancası');
  console.log('✓ online istemciler yüklü, self-çizici kancaları tanımlı');

  dom.window.close();
  server.close();
  console.log('\nCLOCK-OWNERSHIP TESTLERİ: TÜMÜ GEÇTİ ✔');
  process.exit(0);
}

main().catch(err => { console.error('❌ CLOCK-OWNERSHIP HATASI:', err); process.exit(1); });
