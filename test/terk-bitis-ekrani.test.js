'use strict';
/* ============================================================================
 * RAKİP MASADAN AYRILDI → KAZANDIN EKRANI + LOBİYE DÖNÜŞ
 * ============================================================================
 * Kullanıcı raporu (verbatim): "tavla oynarken karşı rakip oyundan çıktı ama
 * diğer oyuncunun ekranı böyle kaldı. Karşının oyundan çıktığına dair, oyunu
 * kazandığına dair bilgi gelmedi ve lobiye yönlendirme mesajı da gelmedi
 * 30 sn içerisinde." (ekran görüntüsünde tahta bomboş)
 *
 * Doğrulananlar (tavla ve satranç — iki kişilik tahta oyunlarının ortak yolu):
 *  1) Rakip masadan ayrılınca kalan oyuncuda BİTİŞ EKRANI açılır.
 *  2) Ekranda "kazandınız" bilgisi vardır (tahta boş kalmaz).
 *  3) Lobiye dönüş kendiliğinden tetiklenir.
 * ========================================================================= */

process.env.GV_POST_GAME_HOLD_MS = '30000';
process.env.GV_RECONNECT_GRACE_MS = '1500';  // kopan oyuncuya tanınan süre (testte kısa)

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-terk-'));

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

async function masaKur(oyun, oda, tahtaSec) {
  const A = await istemci(), B = await istemci();
  const ikisi = [A, B];
  for (const c of ikisi) {
    await bekle(() => c.win.GV && c.win.st, 25000, 'hazır');
    await bekle(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, 'oda kabuğu');
    c.win.st.curGame = oyun;
    c.win.GV.joinRoom(oda);
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    tikla(c.win, c.win.document.querySelector('#gv-real-chess-wait .gv-ready'));
  }
  for (const c of ikisi) {
    await bekle(() => c.win.document.querySelector(tahtaSec), 25000, oyun + ' tahtası');
  }
  return { A, B };
}

async function denetle(oyun, oda, tahtaSec, kopar) {
  const { A, B } = await masaKur(oyun, oda, tahtaSec);

  if (kopar) {
    // SEKMEYİ KAPATMA / bağlantı kopması: 'leaveRoom' paketi GİTMEZ.
    // Kalan oyuncuya ANINDA bilgi gitmeli (eskiden 30 sn boyunca hiçbir şey
    // gelmiyordu: tahta donuyor, oyuncu ne olduğunu anlamıyordu).
    const uyarilar = [];
    B.win.__gvRoomSocket.on('playerConnectionLost', p => uyarilar.push(p));
    A.win.__gvRoomSocket.disconnect();
    try { A.win.__gvLobbySocket && A.win.__gvLobbySocket.disconnect(); } catch (_) {}
    await bekle(() => uyarilar.length, 8000,
      oyun + ': rakibin bağlantısı kopunca kalan oyuncuya ANINDA bilgi gitmeli');
    assert.ok(Number(uyarilar[0].graceMs) > 0, 'geri sayım süresi bildirilmeli');
  } else {
    // A masadan AYRILIR (üst çubuktaki "Ayrıl" ile aynı yol).
    A.win.__gvRoomSocket.emit('leaveRoom', { roomId: oda });
  }

  // 1-2) Kalan oyuncuda bitiş ekranı ve "kazandınız" bilgisi
  const ekran = await bekle(
    () => B.win.document.querySelector('.gv-end, .chess-end-overlay, .tavla-end-overlay'),
    15000, oyun + ': rakip ayrılınca kalan oyuncuda bitiş ekranı açılmalı');
  assert.ok(/KAZAN|Kazan/.test(ekran.textContent),
    oyun + ': ekranda kazandığı yazmalı — bulunan: ' + ekran.textContent.slice(0, 120));
  // Tahta boş kalmamalı: bitiş ekranı veya tahta görünür olmalı
  assert.ok(B.win.document.querySelector('#boardArea').children.length > 0,
    oyun + ': oyun alanı boş kalmamalı');

  // 3) Lobiye dönüş tetiklenir
  await bekle(() => {
    const d = B.win.document;
    return !d.querySelector('#pg-room.active') ||
           !!d.querySelector('#pg-lobby.active') ||
           B.win.__gvActiveRoomId == null;
  }, 20000, oyun + ': kalan oyuncu lobiye yönlendirilmeli');

  console.log('  ✓ ' + oyun + (kopar ? ' (bağlantı koptu)' : ' (Ayrıl düğmesi)') +
    ': kazandın ekranı geldi ve lobiye dönüldü');
  A.dom.window.close(); B.dom.window.close();
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;
  await denetle('tavla', 'terk-tavla', '#boardArea .tavla-board');
  await denetle('chess', 'terk-satranc', '#boardArea .chess-c');
  // Asıl şikâyet: rakip sekmeyi kapattı / bağlantısı koptu.
  await denetle('tavla', 'kopuk-tavla', '#boardArea .tavla-board', true);
  server.close();
  console.log('OK rakip terki: bitiş ekranı + lobiye dönüş');
  process.exit(0);
}
main().catch(e => { console.error('❌ TERK HATASI:', e); process.exit(1); });
