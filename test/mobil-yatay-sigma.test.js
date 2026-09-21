'use strict';
/* ============================================================================
 * MOBİL YATAY / TAM EKRAN — TAHTA EKRANA SIĞIYOR (tüm oyunlar)
 * ============================================================================
 * Kullanıcı raporu (verbatim): "Bilardo oyununda mobilde, ekranı yatay
 * yatırdığımda veya tam ekran moduna geçtiğimde görüntüde kaymalar ve ekrana
 * sığmama optimizasyonu var. Tüm oyunlar için bu hatayı düzelt tüm mobillerde
 * uyumlu olacak şekilde."
 *
 * ÖLÇÜLEN ESKİ DURUM (gerçek Chromium, 915×412 yatay, standart pencere):
 *   satranç 76 px, dama 178, reversi 142, connect4 99, tavla 251,
 *   bilardo 499, amiral battı 567 px ALT TAŞMA; tam ekranda hepsi ~61 px.
 * KÖK NEDEN: mobil kurallar yalnız GENİŞLİĞE bakıyordu (max-width:760px).
 * Yatayda genişlik 740-915 px olunca masaüstü düzeni uygulanıyor ama
 * yükseklik 360-412 px'e düşüyor; tahtayı yüksekliğe göre sınırlayan kural
 * yoktu. ÇÖZÜM: js/board-fit.js tahtayı görünen alana ORANTILI sığdırıyor.
 *
 * Doğrulanan: iki yatay telefon ölçüsünde, 7 oyunda, standart ve tam ekranda
 * tahta ekranın dışına taşmıyor.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI mobil yatay sığma (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-yatay-'));
const assert = require('assert');
const serverModule = require('../server.js');
const uyu = ms => new Promise(r => setTimeout(r, ms));

const OYUNLAR = [
  ['chess', '#boardArea .chess-c', 'satranç'],
  ['dama', '#boardArea .dama-board,#boardArea .dm-board', 'dama'],
  ['reversi', '#boardArea .rv-board', 'reversi'],
  ['connect4', '#boardArea .c4-board', 'connect4'],
  ['tavla', '#boardArea .tavla-board', 'tavla'],
  ['bilardo', '#boardArea .bil-canvas', 'bilardo'],
  ['battleship', '#boardArea .bs-battlefield', 'amiral battı'],
];

async function gir(ctx, BASE, oyun, oda) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html');
  await p.waitForFunction(
    () => window.GV && window.st && typeof window.__gvStartRealRoomWaiting === 'function',
    null, { timeout: 30000 });
  await p.evaluate(a => { window.st.curGame = a[0]; window.GV.joinRoom(a[1]); }, [oyun, oda]);
  await p.waitForSelector('#gv-real-chess-wait .gv-ready', { timeout: 20000 });
  // Alçak ekranda düğme görünür alanın dışında kalabiliyor: JS ile tıkla.
  await p.evaluate(() => document.querySelector('#gv-real-chess-wait .gv-ready').click());
  return p;
}
const olc = (p, sec) => p.evaluate(s => {
  let t = null;
  for (const x of s.split(',')) { const e = document.querySelector(x.trim()); if (e) { t = e; break; } }
  const kok = t ? (t.closest('#boardArea>*') || t) : null;
  const b = kok ? kok.getBoundingClientRect() : null;
  return {
    ekranG: innerWidth, ekranY: innerHeight,
    tahta: b ? { sol: Math.round(b.left), ust: Math.round(b.top),
                 sag: Math.round(b.right), alt: Math.round(b.bottom),
                 g: Math.round(b.width), y: Math.round(b.height) } : null,
    yatayTasma: Math.max(0, document.documentElement.scrollWidth - innerWidth)
  };
}, sec);

function tasmalar(m) {
  const t = [];
  if (!m.tahta) return ['tahta bulunamadı'];
  if (m.tahta.sol < -2) t.push('sol ' + (-m.tahta.sol) + ' px');
  if (m.tahta.sag > m.ekranG + 2) t.push('sağ ' + (m.tahta.sag - m.ekranG) + ' px');
  if (m.tahta.alt > m.ekranY + 2) t.push('alt ' + (m.tahta.alt - m.ekranY) + ' px');
  if (m.yatayTasma > 2) t.push('sayfa yatay ' + m.yatayTasma + ' px');
  return t;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));

  for (const [ad, vp] of [['yatay telefon 915×412', { width: 915, height: 412 }],
                          ['yatay küçük 740×360', { width: 740, height: 360 }]]) {
    for (const [oyun, sec, tad] of OYUNLAR) {
      const c1 = await tr.newContext({ viewport: vp });
      const c2 = await tr.newContext({ viewport: vp });
      const oda = 'yat-' + oyun + '-' + vp.width;
      const p1 = await gir(c1, BASE, oyun, oda), p2 = await gir(c2, BASE, oyun, oda);
      if (oyun === 'battleship') {
        for (const p of [p1, p2]) {
          await p.waitForSelector('#boardArea .bs-place', { timeout: 20000 });
          await p.evaluate(() => document.querySelector('.bs-shuffle').click());
          await p.waitForSelector('.bs-ready-btn:not([disabled])', { timeout: 12000 });
          await p.evaluate(() => document.querySelector('.bs-ready-btn').click());
        }
      }
      await p1.waitForSelector(sec.split(',')[0], { timeout: 22000 }).catch(() => {});
      await uyu(800);

      const std = await olc(p1, sec);
      assert.deepStrictEqual(tasmalar(std), [],
        ad + ' / ' + tad + ' / standart: tahta ekrana sığmalı — ' + JSON.stringify(std.tahta));

      await p1.evaluate(() => document.getElementById('pg-room').classList.add('gv-fs'));
      await uyu(700);
      const tam = await olc(p1, sec);
      assert.deepStrictEqual(tasmalar(tam), [],
        ad + ' / ' + tad + ' / tam ekran: tahta ekrana sığmalı — ' + JSON.stringify(tam.tahta));

      console.log('  ✓ ' + ad + ' · ' + tad + ': standart ' + std.tahta.g + '×' + std.tahta.y +
                  ', tam ekran ' + tam.tahta.g + '×' + tam.tahta.y + ' — ikisi de sığıyor');
      await c1.close(); await c2.close();
    }
  }

  await tr.close(); server.close();
  console.log('OK mobil yatay sığma');
  process.exit(0);
}
main().catch(e => { console.error('❌ YATAY SIĞMA HATASI:', e.message); process.exit(1); });
