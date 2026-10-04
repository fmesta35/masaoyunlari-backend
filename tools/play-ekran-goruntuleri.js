'use strict';
/*
 * GOOGLE PLAY EKRAN GÖRÜNTÜLERİ — assets/play/ekran/*.png
 *
 * NEDEN BU YOLLA?
 * Play, ekran görüntülerinin uygulamanın GERÇEK hâlini göstermesini şart
 * koşar; elde çizilmiş sahte ekranlar reddedilme sebebidir. Bu betik
 * sunucuyu yerelde çalıştırır, Chromium'u telefon ölçüsünde (1080x1920)
 * açar ve GERÇEK oyunu oynatıp kareyi alır:
 *   • okey masası   → 4 gerçek istemci masaya oturur ve maç başlar
 *   • kelimelik     → 2 gerçek istemci oturur, ıstaka ve tahta çizilir
 * Böylece mağazadaki görüntü ile kullanıcının gördüğü ekran birebir aynı.
 *
 * Kullanım:  node tools/play-ekran-goruntuleri.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const KOK = path.join(__dirname, '..');
const HEDEF = path.join(KOK, 'assets', 'play', 'ekran');
/* TELEFON GÖRÜNÜMÜ — CSS genişliği GERÇEKTEN telefon olmalı.
   İlk denemede 1080x1920 piksel doğrudan görünüm ölçüsü olarak verilmişti;
   site 1080 CSS px'i MASAÜSTÜ sayıp yan paneli tahtanın yanına koydu ve
   ekranın alt yarısı boş kaldı. Doğrusu: telefon CSS ölçüsü (432x768) +
   piksel yoğunluğu 2.5 → çıktı yine 1080x1920 ama düzen mobil. */
const CSS_EN = 432, CSS_BOY = 768, YOGUNLUK = 2.5;   // → 1080 x 1920 PNG

const uyu = ms => new Promise(r => setTimeout(r, ms));

async function sayfa(ctx, BASE, ad) {
  const p = await ctx.newPage();
  p.on('pageerror', () => {});
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.GV && window.st, null, { timeout: 30000 });
  if (ad) await p.evaluate(n => { try { localStorage.setItem('gv-user-name', n); } catch (_) {} }, ad);
  return p;
}

async function cek(p, dosya) {
  fs.mkdirSync(HEDEF, { recursive: true });
  const yol = path.join(HEDEF, dosya);
  await p.screenshot({ path: yol, fullPage: false });
  const kb = Math.round(fs.statSync(yol).size / 1024);
  console.log('  ✓ ' + dosya + ' (' + kb + ' KB)');
}

/* Masaya oturt: oyun seç → odaya gir → HAZIRIM. Gerçek akışın aynısı. */
async function masayaOtur(p, oyun, odaId) {
  await p.evaluate(({ oyun, odaId }) => {
    window.st.curGame = oyun;
    window.GV.joinRoom(odaId);
  }, { oyun, odaId });
  await p.waitForSelector('#gv-real-chess-wait .gv-ready', { timeout: 30000 });
  await p.click('#gv-real-chess-wait .gv-ready');
}

async function main() {
  process.env.GV_POST_GAME_HOLD_MS = '600000';
  const serverModule = require('../server.js');
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  console.log('sunucu: ' + BASE);

  const tarayici = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await tarayici.newContext({
    viewport: { width: CSS_EN, height: CSS_BOY },
    deviceScaleFactor: YOGUNLUK,
    isMobile: true,
    hasTouch: true,
    locale: 'tr-TR'
  });

  /* ---------- 1) ana sayfa ---------- */
  const ana = await sayfa(ctx, BASE, 'Oyuncu');
  await uyu(2500);
  await cek(ana, '01-ana-sayfa.png');

  /* ---------- 2) tüm oyunlar ---------- */
  await ana.evaluate(() => window.GV.page('games'));
  await uyu(1800);
  await cek(ana, '02-tum-oyunlar.png');

  /* ---------- 3) okey lobisi (hazır masalar) ---------- */
  await ana.evaluate(() => window.GV.openLobby('okey'));
  await uyu(2200);
  await cek(ana, '03-okey-lobisi.png');

  /* ---------- 4) GERÇEK okey masası (4 oyuncu) ---------- */
  const okeycu = [ana];
  for (let i = 1; i < 4; i++) okeycu.push(await sayfa(ctx, BASE, 'Oyuncu' + (i + 1)));
  for (const p of okeycu) await masayaOtur(p, 'okey', 'play-okey');
  await okeycu[0].waitForSelector('#boardArea .ok-rack .ok-tile', { timeout: 40000 });
  await uyu(2500);
  await cek(okeycu[0], '04-okey-masasi.png');
  for (let i = 1; i < okeycu.length; i++) await okeycu[i].close();

  /* ---------- 5) GERÇEK kelimelik masası (2 oyuncu) ---------- */
  const k1 = await sayfa(ctx, BASE, 'Oyuncu');
  const k2 = await sayfa(ctx, BASE, 'Rakip');
  for (const p of [k1, k2]) await masayaOtur(p, 'kelimelik', 'play-kelimelik');
  await k1.waitForSelector('#boardArea .kl-tahta .kl-hc', { timeout: 40000 });
  await uyu(2500);
  await cek(k1, '05-kelimelik.png');
  await k2.close();

  /* ---------- 6) sıralama ---------- */
  await k1.evaluate(() => window.GV.page('lb'));
  await uyu(1800);
  await cek(k1, '06-siralama.png');

  await tarayici.close();
  server.close();
  console.log('bitti → ' + HEDEF);
  process.exit(0);
}
main().catch(e => { console.error('EKRAN GÖRÜNTÜSÜ HATASI:', e); process.exit(1); });
