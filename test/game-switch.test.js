'use strict';

/*
 * OYUN DEĞİŞTİRME — "eski oyun arka planda çalışmaya devam ediyor" hatası.
 *
 *  Kullanıcı raporu: Pişti masasından çıkıp Okey masasına girince başlıkta
 *  "Okey #301" yazıyor ama tahtada PİŞTİ masası çiziliyordu.
 *
 *  Sebep: kart istemcisi 500 ms'de bir #boardArea'yı koşulsuz yeniden yazan
 *  bir setInterval bırakıyordu; oda değişse de `state` temizlenmiyor, paylaşılan
 *  sokete eklenen dinleyiciler hiç kaldırılmıyordu. Aynı kalıp yedi adaptörde
 *  (kart, dama, türk daması, reversi, gomoku, connect4, bilardo) vardı.
 *
 *  Bu test GERÇEK sunucu + GERÇEK tarayıcı benzeri pencerelerle (jsdom):
 *   1) İki pencere Pişti masasına oturur, masa çizilir.
 *   2) Bir pencere odadan AYRILIR → tahta temizlenir, kart istemcisi susar.
 *   3) Aynı pencere OKEY masasına girer, 4 kişiyle oyun başlar.
 *   4) Okey masası çizilir ve BEKLEME SÜRESİ boyunca (3 sn) Pişti işaretlemesi
 *      bir daha ASLA geri gelmez.
 *   5) Bonus: eski odaya ait geç gelen bir sunucu paketi tahtayı ele geçiremez.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '30000';
process.env.GV_PISTI_TURN_MS = '30000';

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
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE;
      w.fetch = (...a) => fetch(...a);
      w.confirm = () => true;
    }
  });
  return { dom, win: dom.window, label };
}

async function waitFor(fn, timeoutMs, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('bekleme zaman aşımı: ' + what);
}

const boardHtml = w => (w.document.getElementById('boardArea') || {}).innerHTML || '';
const hasPisti = w => /card-wrap|pcard|PİŞTİ/.test(boardHtml(w));
const hasOkey = w => !!w.document.querySelector('#boardArea .okey-table');

async function joinAndReady(clients, game, roomId) {
  for (const c of clients) {
    c.win.st.curGame = game;
    c.win.GV.joinRoom(roomId);
  }
  for (const c of clients) {
    await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 12000, c.label + ' HAZIRIM (' + game + ')');
    c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
}

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;
  const srv = require('../server.js');
  // Pişti hazır masaları varsayılan olarak online değildir: aç.
  const cfg = srv.defaultPresetConfig();
  srv.applyPresetConfig({ ...cfg, pisti: { visible: true, online: true } });
  srv.seedPresetTables();

  const clients = [];
  for (let i = 0; i < 4; i++) clients.push(await makeClient('P' + (i + 1)));
  for (const c of clients) {
    await waitFor(() => c.win.GV && c.win.st, 20000, c.label + ' GV/st');
    await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 20000, c.label + ' roomfix');
    await waitFor(() => c.win.GVArena, 20000, c.label + ' arena yüklendi');
  }
  console.log('  ✓ 0) 4 pencere yüklendi, ortak yaşam döngüsü (GVArena) hazır');

  // --- 1) PİŞTİ masası: dört pencere oturur (ad hoc masa 4 koltukludur) ---
  const [A, B, C, D] = clients;
  await joinAndReady(clients, 'pisti', 'sw-pisti');
  await waitFor(() => hasPisti(A.win), 20000, 'pişti masası çizilmeli');
  assert.strictEqual(A.win.GVArena.activeId(), 'card', 'kart adaptörü tahtanın sahibi olmalı');
  console.log('  ✓ 1) Pişti masası çizildi (adaptör: ' + A.win.GVArena.activeId() + ')');

  // --- 2) Odadan ayrıl → tahta temizlenir, adaptör susar ---
  clients.forEach(c => c.win.__gvRealChessLeave());
  await waitFor(() => !hasPisti(A.win), 8000, 'ayrılınca Pişti masası kalkmalı');
  assert.strictEqual(A.win.GVArena.activeId(), null, 'ayrılınca aktif adaptör kalmamalı');
  // 1.5 sn boyunca (3 tik) geri gelmediğini doğrula — eski hata tam buradaydı.
  for (let i = 0; i < 3; i++) {
    await sleep(500);
    assert.ok(!hasPisti(A.win), 'ayrıldıktan sonra Pişti masası geri gelmemeli (tik ' + (i + 1) + ')');
  }
  console.log('  ✓ 2) odadan ayrılınca kart masası temizlendi ve geri gelmedi');

  // --- 3) Aynı pencere OKEY masasına girer (4 kişi) ---
  await joinAndReady([A, B, C, D], 'okey', 'sw-okey');
  await waitFor(() => hasOkey(A.win), 25000, 'okey masası çizilmeli');
  console.log('  ✓ 3) aynı pencere Okey masasına girdi, okey masası çizildi');

  // --- 4) 3 saniye boyunca Pişti geri gelmiyor ---
  for (let i = 0; i < 6; i++) {
    await sleep(500);
    assert.ok(hasOkey(A.win), 'okey masası ayakta kalmalı (tik ' + (i + 1) + ')');
    assert.ok(!hasPisti(A.win), 'Pişti masası okey masasının üstüne BASILMAMALI (tik ' + (i + 1) + ')');
  }
  assert.strictEqual(A.win.GVArena.activeId(), null, 'okey masasında kart adaptörü aktif olmamalı');
  console.log('  ✓ 4) 3 sn boyunca Okey masası bozulmadı, Pişti arka planda çizmedi');

  // --- 5) Eski odaya ait GEÇ gelen paket tahtayı ele geçiremez ---
  A.win.GVArena._onState({
    roomId: 'sw-pisti',
    seat: 0,
    gameState: { kind: 'pisti', status: 'playing', turn: 0, hand: [{ r: 'A', s: '♠' }], center: [], scores: [0, 0], turnRemainingMs: 9000 }
  });
  await sleep(700);
  assert.ok(hasOkey(A.win), 'geç paket sonrası okey masası hâlâ ayakta olmalı');
  assert.ok(!hasPisti(A.win), 'ESKİ odanın paketi tahtayı ele geçirmemeli');
  console.log('  ✓ 5) eski odaya ait geç gelen sunucu paketi yok sayıldı');

  for (const c of clients) { try { c.win.close(); } catch (_) {} }
  server.close();
  console.log('OK oyun değiştirme: eski masa arka planda çalışmıyor');
  process.exit(0);
}

main().catch(err => { console.error('❌ OYUN DEĞİŞTİRME HATASI:', err); process.exit(1); });
