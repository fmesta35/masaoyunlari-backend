'use strict';

/*
 * OKEY İSTEMCİSİ — gerçek tarayıcı benzeri (jsdom) uçtan uca kanıt.
 *  4 gerçek pencere + 1 izleyici aynı masaya (#313, 4 kişilik hazır masa) girer:
 *   - Bekleme lobisi 4 KOLTUKLU görünür (kullanıcının istediği düzen).
 *   - 4×HAZIRIM → her pencerede masa çizilir (ekran görüntüsündeki düzen:
 *     üst/sol/sağ rakip panelleri, deste 48, GÖSTERGE, atık bölgeleri, ıstaka).
 *   - Kişiye özel dağıtım: herkes kendi 14/15 taşını görür, başkalarınınki kapalı.
 *   - DOM aksiyonları (GV._okDiscardTile / GV._okDraw) sunucuya ulaşır ve
 *     diğer pencerelerde atık bölgesi + ıstaka eşzamanlı güncellenir.
 *   - İzleyicide ıstaka boştur, aksiyon düğmeleri kapalıdır.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '1500';
process.env.GV_OKEY_ROUND_PAUSE_MS = '400';

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

// İlk dolu (sh,sl) slotunu bul
function firstTileSlot(win) {
  const ok = win.st?.boards?.okey;
  if (!ok) return null;
  for (const sh of [0, 1]) for (let sl = 0; sl < 15; sl++) if (ok.rack[sh][sl]) return { sh, sl };
  return null;
}

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;

  const clients = [];
  for (let i = 0; i < 5; i++) clients.push(await makeClient('P' + (i + 1)));
  const [A, B, C, D, S] = clients;

  // Sayfalar hazır olana kadar bekle
  for (const c of clients) {
    await waitFor(() => c.win.GV && c.win.st, 20000, c.label + ' GV/st');
    await waitFor(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 20000, c.label + ' roomfix');
  }
  console.log('  ✓ 0) 5 pencere yüklendi (4 oyuncu + 1 izleyici)');

  // Odaya gir
  for (const c of [A, B, C, D]) {
    c.win.st.curGame = 'okey';
    c.win.GV.joinRoom('313');
  }
  S.win.st.curGame = 'okey';
  S.win.GV.joinRoom('313', { spectate: true });

  // --- 1) Bekleme lobisi 4 koltuklu ---
  await waitFor(() => A.win.document.querySelectorAll('#gv-real-chess-wait .gvp').length === 4, 8000, '4 koltuk kartı');
  const seatCards = A.win.document.querySelectorAll('#gv-real-chess-wait .gvp').length;
  assert.strictEqual(seatCards, 4, 'okey bekleme lobisi 4 koltuk göstermeli');
  const statusTxt = A.win.document.querySelector('#gv-real-chess-wait .status')?.textContent || '';
  assert.ok(/\/4|dört/i.test(statusTxt), 'durum metni 4 kişilik beklemeyi anlatmalı: ' + statusTxt);
  console.log('  ✓ 1) bekleme lobisi 4 koltuklu — "' + statusTxt.trim() + '"');

  // --- 2) 4×HAZIRIM → masa her pencerede açılır ---
  for (const c of [A, B, C, D]) {
    await waitFor(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 8000, c.label + ' HAZIRIM');
    c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
  for (const c of clients) {
    await waitFor(() => c.win.document.querySelector('#boardArea .okey-table'), 20000, c.label + ' okey-table');
  }
  console.log('  ✓ 2) 4/4 HAZIRIM → okey masası 5 pencerede de çizildi (lobi kapandı)');

  // --- 3) Masa düzeni: ekran görüntüsündeki elemanlar ---
  for (const c of clients) {
    const d = c.win.document;
    assert.ok(d.querySelector('#boardArea .ok-player.top'), 'Karşı paneli');
    assert.ok(d.querySelector('#boardArea .ok-player.left'), 'Sol paneli');
    assert.ok(d.querySelector('#boardArea .ok-player.right'), 'Sağ paneli');
    assert.ok(d.querySelector('#boardArea .ok-me'), '"Sen" paneli');
    assert.ok(d.querySelector('#boardArea .ok-deck'), 'orta deste');
    assert.ok(d.querySelector('#boardArea .ok-indicator'), 'GÖSTERGE');
    assert.ok(d.querySelector('#boardArea #okFinishZone'), 'ORTAYA BİTİR bölgesi');
    assert.ok(d.querySelector('#boardArea #okThrowZone'), 'TAŞ AT bölgesi');
    assert.strictEqual(d.querySelectorAll('#boardArea .ok-disc-zone').length, 4, '4 atık bölgesi');
    assert.ok(d.querySelector('#boardArea #okTimerVal'), 'SIRA sayacı');
    assert.strictEqual(d.querySelector('#boardArea .ok-deck-cnt')?.textContent, '48', 'deste 48');
    // Rakip ıstakaları: üst blok sayısı = karşı oyuncunun taş sayısı (14/15)
    const topCount = d.querySelectorAll('#boardArea .ok-opp-rack.top .ok-opp-t').length;
    assert.ok(topCount === 14 || topCount === 15, 'karşı ıstaka kapalı blokları');
  }
  // Skor satırı "El 1/3 (4 Kişilik)" kontrolü (bir pencerede yeter)
  const scoreLineText = [...A.win.document.querySelectorAll('#boardArea .okey-table > div')]
    .map(x => x.textContent).find(t => t.includes('Kişilik')) || '';
  assert.ok(scoreLineText.includes('El 1/3 (4 Kişilik)'), 'skor satırı: ' + scoreLineText);
  // Kişiye özel dağıtım: başlayan 15, diğerleri 14; izleyici 0
  const tileCounts = [A, B, C, D].map(c => c.win.document.querySelectorAll('#boardArea .ok-tile').length);
  assert.deepStrictEqual(tileCounts.filter(n => n === 15).length, 1, 'tek başlayan (15 taş)');
  assert.deepStrictEqual(tileCounts.filter(n => n === 14).length, 3, 'diğerleri 14 taş');
  assert.strictEqual(S.win.document.querySelectorAll('#boardArea .ok-tile').length, 0, 'izleyici eli göremez');
  assert.strictEqual(S.win.document.querySelectorAll('#boardArea .ok-opp-rack.top .ok-opp-t').length > 0, true, 'izleyici kapalı ıstakaları görür');
  const specMe = S.win.document.querySelector('#boardArea .ok-me-name')?.textContent || '';
  assert.ok(specMe.includes('İzleyici'), 'izleyici paneli: ' + specMe);
  assert.ok(!S.win.document.querySelector('#boardArea .ok-actions') ||
    S.win.document.querySelector('#boardArea .ok-actions').style.display === 'none', 'izleyicide düğmeler kapalı');
  const myName = A.win.document.querySelector('#boardArea .ok-me-name')?.textContent || '';
  assert.ok(myName.startsWith('Sen'), 'Sen paneli: ' + myName);
  console.log('  ✓ 3) masa düzeni tam: Karşı/Sol/Sağ/Sen + 14-15 taş + izleyici gizliliği (dağıtım: ' + tileCounts.join(',') + ')');

  // --- 4) Başlayan (15 taşlı) pencereden atış yapılır → herkese yansır ---
  const starter = [A, B, C, D].find((c, i) => tileCounts[i] === 15);
  const others = [A, B, C, D].filter(c => c !== starter);
  const st0 = starter.win.st.boards.okey;
  assert.strictEqual(st0.myTurn, true, '15 taşlıda sıra');
  const slot = firstTileSlot(starter.win);
  const tileObj = starter.win.st.boards.okey.rack[slot.sh][slot.sl];
  starter.win.GV._okDiscardTile(slot.sh, slot.sl);
  await waitFor(() => starter.win.document.querySelectorAll('#boardArea .ok-tile').length === 14, 8000, 'atış sonrası ıstaka 14');
  // Atık herkesin ekranında görünür (atık bölgesinde numara)
  for (const c of others) {
    await waitFor(() => c.win.document.querySelector('#boardArea .ok-disc-tile .dt-num'), 8000, c.label + ' atık görünümü');
    const shown = c.win.document.querySelector('#boardArea .ok-disc-tile .dt-num').textContent;
    assert.strictEqual(shown, String(tileObj.n), 'atılan taş herkese aynı görünür');
  }
  console.log('  ✓ 4) başlayan attı → atık bölgesi tüm pencerelerde eşzamanlı (' + tileObj.n + ')');

  // --- 5) Sıradaki oyuncu desteden çeker ---
  const turnCli = await waitFor(() => {
    const w = [A, B, C, D].find(c => c.win.st?.boards?.okey?.myTurn);
    return w || null;
  }, 8000, 'sıra sahibi');
  const before = turnCli.win.document.querySelectorAll('#boardArea .ok-tile').length;
  assert.strictEqual(before, 14, 'çekmeden önce 14');
  turnCli.win.GV._okDraw();
  await waitFor(() => turnCli.win.document.querySelectorAll('#boardArea .ok-tile').length === 15, 8000, 'çekim sonrası 15');
  console.log('  ✓ 5) sıradaki oyuncu GV._okDraw() ile desteden çekti (14 → 15)');

  // --- 6) Kontrol düğmesi bilgi verir ---
  turnCli.win.GV._okCheck();
  await waitFor(() => (turnCli.win.document.getElementById('toastWrap')?.textContent || '').length > 3, 5000, 'kontrol toast');
  console.log('  ✓ 6) ✅ Kontrol bilgisi gösterildi');

  // --- 7) SIRA sayacı canlı azalıyor (sunucu turnRemainingMs tabanlı) ---
  const v1 = Number(S.win.document.querySelector('#okTimerVal')?.textContent || '0');
  await sleep(1300);
  const v2 = Number(S.win.document.querySelector('#okTimerVal')?.textContent || '0');
  assert.ok(v1 > 0 && v2 < v1, `SIRA geri sayımı canlı (${v1} → ${v2})`);
  console.log(`  ✓ 7) SIRA sayacı canlı: ${v1} → ${v2}`);

  for (const c of clients) { try { c.win.close(); } catch (_) {} }
  server.close();
  console.log('OK okey client (jsdom) regressions');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY CLIENT HATASI:', err); process.exit(1); });
