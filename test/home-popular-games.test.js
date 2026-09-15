'use strict';

/*
 * ANA SAYFA "POPÜLER OYUNLAR" + SOL OYUNLAR MENÜSÜ KALDIRMA (madde 3'ün
 * bir kısmı — sıralama/rozet/görsel ve menü kısmı; bilardo motoru ve
 * kapak resimleri kullanıcının kabul ettiği ayrı iş kalemleridir).
 *
 *  Kullanıcı raporu (verbatim, ilgili kısımlar):
 *   "soldaki oyunlar menüsü webde ve mobilde kaldırılsın, zaten üst
 *    menüde oyunlar var, oraya arama motoru eklensin. Ana sayfadaki
 *    popüler oyunlar türleri, en çok oynanan oyun sıralamasına göre
 *    sıralansın ve gösterilsin. Oyun kapak fotoğraflarında oynanan oyun
 *    sayısı gösterilsin (oyun isminin altında teorik olarak gösterilen
 *    oyuncu sayıları yerine) Popüler oyunların altındaki oyun
 *    resimlerinin üst köşelerindeki 'hot' 'popüler' 'yeni'
 *    sınıflandırmalarını kaldır."
 *
 *  Bu test:
 *   1) sol "Oyunlar" menüsü (arama kutusu + oyun listesi, eskiden
 *      #sbGames) DOM'dan tamamen kalktı — hem masaüstü hem mobil düzen
 *      için (mobil hamburger çekmecesi yalnız SİTE gezinmesi içeriyor,
 *      oyun listesi yok);
 *   2) "Tüm Oyunlar" (üst menü → 🎮 Oyunlar) sayfasında arama kutusu var
 *      ve GERÇEKTEN filtreliyor;
 *   3) ana sayfadaki oyun kartlarında HOT/YENİ/POPÜLER rozeti YOK;
 *   4) ana sayfa "Popüler Oyunlar" GERÇEK sunucu sayaçlarına (bkz.
 *      play-counts.js + /api/game-play-counts) göre çoktan aza sıralı;
 *   5) her kartın altyazısı artık gerçek "N kez oynandı" yazısı DEĞİL —
 *      kullanıcının SONRAKİ isteği üzerine bunun yerine gerçek bir "⚡
 *      Hızlı Eşleş" düğmesi var (oynanma sayısı kart üzerinde `title`
 *      ipucu olarak kalıyor, sıralamada kullanılmaya devam ediyor).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-popgames-'));
process.env.GV_DATA_DIR = dataDir;

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

// server.js'ten ÖNCE gerçek sayaçları sahte (ama gerçek okunan) verilerle
// dolduruyoruz — aynı süreç içinde aynı modül önbelleğini paylaşacaklar.
const playCounts = require('../play-counts');
playCounts.bump('okey'); playCounts.bump('okey'); playCounts.bump('okey'); playCounts.bump('okey'); playCounts.bump('okey'); // 5
playCounts.bump('chess'); playCounts.bump('chess'); playCounts.bump('chess'); // 3
playCounts.bump('tavla'); // 1
// diğer tüm oyunlar 0 kalır (hiç bump çağrılmadı)

const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + ne);
}

async function pencere(base) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = base;
      // Node'un çıplak (global) fetch'i, tarayıcının aksine göreli URL'leri
      // belge konumuna göre ÇÖZEMEZ ("/api/..." → hata). Diğer testlerdeki
      // gibi window.fetch'i Node fetch'ine bağlıyoruz ama göreli yolu önce
      // sunucu adresine tamamlıyoruz — yalnızca bu test dosyasına özgü bir
      // test-altyapısı düzeltmesi, üretim kodunda göreli fetch tarayıcıda
      // zaten doğru çalışır.
      w.fetch = (url, opts) => fetch(typeof url === 'string' && url.charAt(0) === '/' ? base + url : url, opts);
    }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV, 20000, 'sayfa açılışı');
  return win;
}

async function main() {
  // Sayaçların gerçekten /api/game-play-counts'a yansıdığını da
  // doğrudan doğrula (istemciden bağımsız, sunucu tarafı doğruluğu).
  const preCheckServer = await serverModule.start(0);
  const preBase = 'http://127.0.0.1:' + preCheckServer.address().port;
  const apiRes = await (await fetch(preBase + '/api/game-play-counts')).json();
  assert.ok(apiRes.ok, 'API yanıt vermeli');
  assert.strictEqual(apiRes.counts.okey, 5, 'okey 5 kez oynanmış görünmeli');
  assert.strictEqual(apiRes.counts.chess, 3, 'chess 3 kez oynanmış görünmeli');
  assert.strictEqual(apiRes.counts.tavla, 1, 'tavla 1 kez oynanmış görünmeli');
  console.log('  ✓ 0) /api/game-play-counts gerçek sayaçları doğru döndürüyor');

  const BASE = preBase;
  const w = await pencere(BASE);
  await bekle(() => {
    const cards = w.document.querySelectorAll('#homeGames .game-card');
    return cards.length >= 12 ? cards : null;
  }, 10000, 'ana sayfa oyun kartları çizilsin');
  // İlk çizim (init) sunucu sayaçları gelmeden önce (hepsi 0 varsayımıyla)
  // olabilir; loadPlayCounts() fetch'i bitip renderHome()'u TEKRAR
  // çağırana kadar bekle — asıl sıralama testi budur.
  await bekle(() => {
    const ids = [...w.document.querySelectorAll('#homeGames .game-card')].map(e => e.dataset.g);
    return ids[0] === 'okey' ? ids : null;
  }, 10000, 'gerçek sayaçlarla yeniden sıralanmalı (okey ilk sırada)');

  // ---------- 1) sol "Oyunlar" menüsü tamamen kalktı ----------
  assert.strictEqual(w.document.getElementById('sbGames'), null, '#sbGames artık DOM\'da olmamalı');
  assert.strictEqual(w.document.querySelector('.sidebar .sb-title'), null, 'sol menüde "Oyunlar" başlığı kalmamalı');
  assert.strictEqual(w.document.querySelectorAll('.sidebar .sb-item').length, 0, 'sol menüde oyun listesi öğesi kalmamalı');
  // Mobil çekmece hâlâ site gezinmesini (Ana Sayfa/Oyunlar/İstatistikler...) içermeli:
  assert.ok(w.document.querySelector('.sidebar .sb-nav-item[data-p="stats"]'), 'mobil çekmecede site gezinmesi hâlâ olmalı');
  console.log('  ✓ 1) sol "Oyunlar" menüsü (arama+liste) kalktı; mobil site gezinme çekmecesi duruyor');

  // ---------- 2) "Tüm Oyunlar" sayfasında arama, gerçekten filtreliyor ----------
  w.GV.page('games');
  const searchInput = await bekle(() => w.document.querySelector('#pg-games .sb-search input'), 5000, 'Oyunlar sayfasında arama kutusu olmalı');
  assert.ok(searchInput, 'arama kutusu #pg-games içinde olmalı');
  searchInput.value = 'okey';
  searchInput.dispatchEvent(new w.window.Event('input', { bubbles: true }));
  await sleep(50);
  const gorunenler = [...w.document.querySelectorAll('#allGames .game-card')].filter(e => e.style.display !== 'none').map(e => e.dataset.g);
  assert.ok(gorunenler.includes('okey') && gorunenler.includes('okey101'), '"okey" araması Okey + 101 Okey\'i göstermeli: ' + gorunenler);
  assert.ok(!gorunenler.includes('tavla'), '"okey" araması Tavla\'yı GİZLEMELİ: ' + gorunenler);
  console.log('  ✓ 2) "Tüm Oyunlar" sayfasındaki arama kutusu gerçekten filtreliyor');

  // ---------- 3) HOT/YENİ/POPÜLER rozeti yok ----------
  assert.strictEqual(w.document.querySelectorAll('.game-tag').length, 0, 'hiçbir kartta hot/yeni/popüler rozeti kalmamalı');
  console.log('  ✓ 3) HOT/YENİ/POPÜLER rozetleri tüm kartlardan kaldırıldı');

  // ---------- 4) ana sayfa sıralaması gerçek sayaca göre ----------
  const homeIds = [...w.document.querySelectorAll('#homeGames .game-card')].map(e => e.dataset.g);
  assert.strictEqual(homeIds[0], 'okey', 'en çok oynanan (5) ilk sırada olmalı: ' + homeIds.join(','));
  assert.strictEqual(homeIds[1], 'chess', 'ikinci en çok oynanan (3) ikinci sırada olmalı: ' + homeIds.join(','));
  assert.strictEqual(homeIds[2], 'tavla', 'üçüncü en çok oynanan (1) üçüncü sırada olmalı: ' + homeIds.join(','));
  console.log('  ✓ 4) Popüler Oyunlar GERÇEK oynanma sayısına göre çoktan aza sıralı (okey>chess>tavla>...)');

  // ---------- 5) "N kez oynandı" altyazısının yerini GERÇEK Hızlı Eşleş
  //              düğmesi aldı (oynanma sayısı title ipucunda kalıyor) ----------
  const okeyCard = w.document.querySelector('#homeGames .game-card[data-g="okey"]');
  const chessCard = w.document.querySelector('#homeGames .game-card[data-g="chess"]');
  const damaCard = w.document.querySelector('#homeGames .game-card[data-g="dama"]');
  assert.ok(!/kez oynandı/.test(okeyCard.textContent), 'kart METNİNDE artık "N kez oynandı" yazmamalı (düğmeye taşındı): ' + okeyCard.textContent);
  assert.ok(!/👥/.test(okeyCard.textContent), 'eski uydurma "👥 oyuncu sayısı" göstergesi kalmamalı');
  const qmBtn = okeyCard.querySelector('.gv-qm-btn');
  assert.ok(qmBtn, 'her kartta bir "⚡ Hızlı Eşleş" düğmesi olmalı');
  assert.ok(/Hızlı Eşleş/.test(qmBtn.textContent), 'düğme metni "Hızlı Eşleş" olmalı: ' + qmBtn.textContent);
  assert.ok(/quickMatchFor\(.okey./.test(qmBtn.getAttribute('onclick') || ''), 'okey kartının düğmesi quickMatchFor(\'okey\',...) çağırmalı');
  assert.strictEqual(okeyCard.getAttribute('title'), '5 kez oynandı', 'gerçek oynanma sayısı artık title ipucunda kalmalı: ' + okeyCard.getAttribute('title'));
  assert.strictEqual(chessCard.getAttribute('title'), '3 kez oynandı', 'chess kartının title ipucu doğru olmalı');
  assert.strictEqual(damaCard.getAttribute('title'), '0 kez oynandı', 'hiç oynanmamış oyunun title ipucu "0 kez oynandı" olmalı');
  console.log('  ✓ 5) kart altyazısı artık gerçek "⚡ Hızlı Eşleş" düğmesi; oynanma sayısı title ipucunda korunuyor');

  try { w.close(); } catch (_) {}
  serverModule.io.close();
  await new Promise(r => preCheckServer.close(r));
  console.log('OK popüler oyunlar: gerçek sayaç + rozetsiz kart + taşınmış arama + kaldırılmış sol menü');
  process.exit(0);
}

main().catch(e => { console.error('❌ POPÜLER OYUNLAR TEST HATASI:', e); process.exit(1); });
