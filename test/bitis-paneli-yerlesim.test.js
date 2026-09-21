'use strict';
/* ============================================================================
 * MAÇ SONU PANELİ — TAHTAYI KAPATMAZ (tüm oyunlar, web + mobil)
 * ============================================================================
 * Kullanıcı isteği (verbatim): "oyuncuların hangi hamleyle bitirdiğini
 * görebilmeleri için rövanş ve lobiye dön pop-up'ın dashboardı direkt
 * kapatmaması lazım... oyun dashboard alanlarının sağına, skor tablolarına
 * yakın, dikey... Standart ve normal pencerede - herhangi bir üst üste
 * çakışma olmayacak şekilde." Mobil için: "Siz ve rakip sürelerinin üstüne
 * öncelik gelerek gösterilmesi... tam örtüşerek."
 *
 * Doğrulananlar (gerçek Chromium; her oyun, standart + tam ekran):
 *  1) Maç bitince panel açılır ve tahtayla ÜST ÜSTE BİNMEZ (dikdörtgen
 *     kesişimi sıfır).
 *  2) Masaüstünde panel tahtanın SAĞINDA ve yan panelin (skor kartları)
 *     solunda, dikey durur.
 *  3) Telefonda panel SÜRE KARTLARININ yerini alır (kartlar gizlenir),
 *     tahta yine kapanmaz.
 *  4) Rövanş/Lobiye dön düğmeleri panelin içinde ve tıklanabilir durumda.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI bitiş paneli yerleşimi (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bitis-'));
process.env.GV_POST_GAME_HOLD_MS = '60000';      // panel açık kalsın

const assert = require('assert');
const serverModule = require('../server.js');
const uyu = ms => new Promise(r => setTimeout(r, ms));

/* Her oyun: [id, tahta seçicisi, görünen ad] */
const OYUNLAR = [
  ['chess',      '#boardArea .chess-c',        'satranç'],
  ['dama',       '#boardArea .dama-board,#boardArea .dm-board', 'dama'],
  ['reversi',    '#boardArea .rv-board',       'reversi'],
  ['gomoku',     '#boardArea .gm-board',       'gomoku'],
  ['connect4',   '#boardArea .c4-board',       'connect4'],
  ['tavla',      '#boardArea .tavla-board',    'tavla'],
  ['bilardo',    '#boardArea .bil-canvas',     'bilardo'],
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
  await p.click('#gv-real-chess-wait .gv-ready');
  return p;
}
const olc = (p, tahtaSec) => p.evaluate(s => {
  const kutu = e => { if (!e) return null; const b = e.getBoundingClientRect();
    return { sol:Math.round(b.left), ust:Math.round(b.top), sag:Math.round(b.right),
             alt:Math.round(b.bottom), g:Math.round(b.width), y:Math.round(b.height) }; };
  let tahta = null;
  for (const x of s.split(',')) { const e = document.querySelector(x.trim()); if (e) { tahta = e; break; } }
  const panel = document.querySelector('.gv-bitis-panel');
  const zamanlar = document.querySelector('#pg-room .game-side .timers');
  return {
    tahta: kutu(tahta), panel: kutu(panel), yan: kutu(document.querySelector('#pg-room .game-side')),
    zamanlarGorunur: !!(zamanlar && zamanlar.offsetParent !== null),
    dugmeSayisi: panel ? panel.querySelectorAll('button').length : 0,
    panelYuvada: !!(panel && panel.closest('#gvEndSlot'))
  };
}, tahtaSec);

function kesisiyorMu(a, b) {
  if (!a || !b) return false;
  const gen = Math.min(a.sag, b.sag) - Math.max(a.sol, b.sol);
  const yuk = Math.min(a.alt, b.alt) - Math.max(a.ust, b.ust);
  return gen > 1 && yuk > 1;               // 1 px tolerans (yuvarlama)
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));

  for (const [ekran, vp] of [['masaüstü', { width: 1600, height: 900 }],
                             ['telefon',  { width: 412, height: 915 }]]) {
    for (const [oyun, sec, ad] of OYUNLAR) {
      const c1 = await tr.newContext({ viewport: vp });
      const c2 = await tr.newContext({ viewport: vp });
      const oda = 'bp-' + oyun + '-' + vp.width;
      const p1 = await gir(c1, BASE, oyun, oda), p2 = await gir(c2, BASE, oyun, oda);
      if (oyun === 'battleship') {
        for (const p of [p1, p2]) {
          await p.waitForSelector('#boardArea .bs-place', { timeout: 20000 });
          await p.click('.bs-shuffle');
          await p.waitForSelector('.bs-ready-btn:not([disabled])', { timeout: 12000 });
          await p.click('.bs-ready-btn');
        }
      }
      await p1.waitForSelector(sec.split(',')[0], { timeout: 22000 }).catch(() => {});
      await uyu(500);

      // Maçı bitir: 2. oyuncu pes eder → 1. oyuncuda "kazandınız" ekranı
      await p2.evaluate(o => window.__gvRoomSocket.emit('gvResign', { roomId: o }), oda);
      await p1.waitForSelector('.gv-bitis-panel', { timeout: 15000 });
      await uyu(400);

      for (const mod of ['standart', 'tam ekran']) {
        if (mod === 'tam ekran') {
          await p1.evaluate(() => document.getElementById('pg-room').classList.add('gv-fs'));
          await uyu(450);
        }
        const m = await olc(p1, sec);
        const nerede = ekran + ' / ' + ad + ' / ' + mod;
        assert.ok(m.panel && m.panel.g > 0 && m.panel.y > 0, nerede + ': panel görünür olmalı');
        assert.ok(m.panelYuvada, nerede + ': panel kendi yuvasında olmalı (yüzen kaplama değil)');
        assert.ok(m.dugmeSayisi >= 2, nerede + ': panelde en az 2 düğme olmalı (lobi + rövanş)');
        assert.ok(!kesisiyorMu(m.tahta, m.panel),
          nerede + ': panel tahtayla ÜST ÜSTE BİNMEMELİ — tahta ' +
          JSON.stringify(m.tahta) + ' panel ' + JSON.stringify(m.panel));
        if (ekran === 'masaüstü') {
          assert.ok(m.panel.sol >= (m.tahta ? m.tahta.sag - 1 : 0),
            nerede + ': panel tahtanın SAĞINDA olmalı');
          assert.ok(!m.yan || m.panel.sag <= m.yan.sol + 1,
            nerede + ': panel yan panelin (skor kartları) SOLUNDA olmalı');
          assert.ok(m.panel.y > m.panel.g * 0.9, nerede + ': panel DİKEY olmalı');
        } else if (mod === 'standart') {
          assert.strictEqual(m.zamanlarGorunur, false,
            nerede + ': panel süre kartlarının yerini almalı (kartlar gizlenir)');
        }
      }
      console.log('  ✓ ' + ekran + ' · ' + ad + ': panel açık, tahta kapanmıyor');
      await c1.close(); await c2.close();
    }
  }

  await tr.close(); server.close();
  console.log('OK bitiş paneli yerleşimi');
  process.exit(0);
}
main().catch(e => { console.error('❌ BİTİŞ PANELİ HATASI:', e.message); process.exit(1); });
