'use strict';
/*
 * GOOGLE PLAY TABLET EKRAN GÖRÜNTÜLERİ
 *   assets/play/tablet7/*.png   → 1600x900  (7 inç; kenarlar 320–3840 arası)
 *   assets/play/tablet10/*.png  → 1920x1080 (10 inç; kenarlar 1080–7680 arası)
 *
 * Play mağaza girişinde telefon ekranlarının YANI SIRA 7 ve 10 inç tablet
 * ekranları da zorunlu alan. Telefon görüntüsünü büyütüp göndermek
 * reddedilme sebebi: tablette düzen gerçekten farklı (yan panel tahtanın
 * yanında, daha geniş liste). Bu yüzden görüntü yine GERÇEK oyundan,
 * tablet genişliğinde alınır — kardeş betik play-ekran-goruntuleri.js ile
 * aynı akış, yalnız görünüm ölçüsü değişir.
 *
 * Kullanım:  node tools/play-tablet-goruntuleri.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const KOK = path.join(__dirname, '..');
const OLCULER = [
  { ad: 'tablet7',  en: 1600, boy: 900  },
  { ad: 'tablet10', en: 1920, boy: 1080 }
];

const uyu = ms => new Promise(r => setTimeout(r, ms));

async function sayfa(ctx, BASE, ad) {
  const p = await ctx.newPage();
  p.on('pageerror', () => {});
  await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.GV && window.st, null, { timeout: 30000 });
  if (ad) await p.evaluate(n => { try { localStorage.setItem('gv-user-name', n); } catch (_) {} }, ad);
  return p;
}

async function masayaOtur(p, oyun, odaId) {
  await p.evaluate(({ oyun, odaId }) => {
    window.st.curGame = oyun;
    window.GV.joinRoom(odaId);
  }, { oyun, odaId });
  await p.waitForSelector('#gv-real-chess-wait .gv-ready', { timeout: 30000 });
  await p.click('#gv-real-chess-wait .gv-ready');
}

async function olcuIcin(tarayici, BASE, olcu, sira) {
  const HEDEF = path.join(KOK, 'assets', 'play', olcu.ad);
  fs.mkdirSync(HEDEF, { recursive: true });
  const cek = async (p, dosya) => {
    const yol = path.join(HEDEF, dosya);
    await p.screenshot({ path: yol, fullPage: false });
    console.log('  ✓ ' + olcu.ad + '/' + dosya +
                ' (' + Math.round(fs.statSync(yol).size / 1024) + ' KB)');
  };

  const ctx = await tarayici.newContext({
    viewport: { width: olcu.en, height: olcu.boy },
    deviceScaleFactor: 1,
    locale: 'tr-TR'
  });

  const ana = await sayfa(ctx, BASE, 'Oyuncu');
  await uyu(2500);
  await cek(ana, '01-ana-sayfa.png');

  await ana.evaluate(() => window.GV.page('games'));
  await uyu(1800);
  await cek(ana, '02-tum-oyunlar.png');

  await ana.evaluate(() => window.GV.openLobby('okey'));
  await uyu(2200);
  await cek(ana, '03-okey-lobisi.png');

  /* GERÇEK okey masası — her ölçü için ayrı oda kimliği; aynı oda tekrar
     kullanılırsa ilk turun oyuncuları hâlâ oturuyor olur ve masa dolu gelir. */
  const okeycu = [ana];
  for (let i = 1; i < 4; i++) okeycu.push(await sayfa(ctx, BASE, 'Oyuncu' + (i + 1)));
  for (const p of okeycu) await masayaOtur(p, 'okey', 'tab-okey-' + sira);
  await okeycu[0].waitForSelector('#boardArea .ok-rack .ok-tile', { timeout: 40000 });
  /* "Okey başladı" bildirimi sağ üstteki düğmelerin üzerine biniyor;
     mağaza görüntüsünde üst üste binmiş iki kutu kötü duruyor. Bildirim
     kendiliğinden sönene kadar bekle. */
  await uyu(7000);
  await cek(okeycu[0], '04-okey-masasi.png');
  for (let i = 1; i < okeycu.length; i++) await okeycu[i].close();

  const k1 = await sayfa(ctx, BASE, 'Oyuncu');
  const k2 = await sayfa(ctx, BASE, 'Rakip');
  for (const p of [k1, k2]) await masayaOtur(p, 'kelimelik', 'tab-kelimelik-' + sira);
  await k1.waitForSelector('#boardArea .kl-tahta .kl-hc', { timeout: 40000 });
  await uyu(7000);
  await cek(k1, '05-kelimelik.png');
  await k2.close();

  await k1.evaluate(() => window.GV.page('lb'));
  await uyu(1800);
  await cek(k1, '06-siralama.png');

  await ctx.close();
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
  let sira = 0;
  for (const olcu of OLCULER) { sira++; await olcuIcin(tarayici, BASE, olcu, sira); }
  await tarayici.close();
  server.close();
  console.log('bitti');
  process.exit(0);
}
main().catch(e => { console.error('TABLET EKRAN GÖRÜNTÜSÜ HATASI:', e); process.exit(1); });
