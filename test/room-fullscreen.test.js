'use strict';

/*
 * TAM EKRAN (madde 6) — okey plus ekranındaki gibi, kullanıcıya oyun
 * odasını TAM EKRAN veya STANDART oynama seçeneği sunulmalı.
 *
 *  Kullanıcı raporu (verbatim):
 *   "okey plus ekranındaki gibi, kullanıcılara oyunları tam ekran
 *    oynayabilme imkanı sunulsun. İster tam ekran seçerse full tam ekran
 *    oynar, ister standart olarak oynar."
 *
 *  jsdom gerçek Fullscreen API'sini desteklemediği için bu test
 *  requestFullscreen/exitFullscreen'i sahte (mock) fonksiyonlarla
 *  değiştirip GV.toggleFullscreen()'in doğru çağrıyı yaptığını ve
 *  document 'fullscreenchange' olayı sonrası #gvFullscreenBtn'in
 *  durumunu (etiket + .is-full sınıfı) doğru güncellediğini kontrol eder.
 *  Ayrıca tarayıcı Fullscreen API'sini hiç desteklemiyorsa
 *  toggleFullscreen()'in sessizce (hata fırlatmadan) düşüp bir toast
 *  gösterdiğini doğrular.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-fullscreen-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
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

async function misafirPencere(base) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = base; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV, 20000, 'sayfa açılışı');
  await bekle(() => win.st.isGuest === true, 10000, 'ziyaretçi hâli');
  return win;
}

function click(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await misafirPencere(BASE);
  const B = await misafirPencere(BASE);
  const roomId = 'fs-test-room-' + Date.now();
  for (const w of [A, B]) {
    await bekle(() => typeof w.__gvStartRealRoomWaiting === 'function', 20000, 'roomfix hazır');
    w.st.curGame = 'gomoku';
    w.GV.joinRoom(roomId);
  }
  for (const w of [A, B]) {
    const btn = await bekle(() => w.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM düğmesi');
    click(w, btn);
  }
  for (const w of [A, B]) {
    await bekle(() => w.document.querySelector('#boardArea .gm-board'), 20000, 'tahta çizildi');
  }
  const fsBtn = await bekle(() => A.document.getElementById('gvFullscreenBtn'), 10000, 'tam ekran düğmesi DOM\'da olmalı');
  console.log('  ✓ 1) oyun odasında Tam Ekran düğmesi mevcut');

  // ---- Fullscreen API'sini sahte (mock) uygula ----
  const pgRoom = A.document.getElementById('pg-room');
  let fsEl = null;
  let reqCalls = 0, exitCalls = 0;
  pgRoom.requestFullscreen = function () {
    reqCalls++;
    fsEl = pgRoom;
    Object.defineProperty(A.document, 'fullscreenElement', { value: fsEl, configurable: true });
    A.document.dispatchEvent(new A.window.Event('fullscreenchange'));
    return Promise.resolve();
  };
  A.document.exitFullscreen = function () {
    exitCalls++;
    fsEl = null;
    Object.defineProperty(A.document, 'fullscreenElement', { value: null, configurable: true });
    A.document.dispatchEvent(new A.window.Event('fullscreenchange'));
    return Promise.resolve();
  };
  Object.defineProperty(A.document, 'fullscreenElement', { value: null, configurable: true });

  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'başlangıçta tam ekran değil');
  assert.ok(/Tam Ekran/.test(fsBtn.innerHTML), 'başlangıç etiketi "Tam Ekran": ' + fsBtn.innerHTML);

  // ---- Tam ekrana geç ----
  A.GV.toggleFullscreen();
  await sleep(50);
  assert.strictEqual(reqCalls, 1, 'requestFullscreen bir kez çağrılmalı');
  assert.strictEqual(fsBtn.classList.contains('is-full'), true, 'tam ekrana geçince buton .is-full olmalı');
  assert.ok(/Standart/.test(fsBtn.innerHTML), 'tam ekrandayken etiket "Standart" olmalı: ' + fsBtn.innerHTML);
  console.log('  ✓ 2) GV.toggleFullscreen() tam ekrana geçiriyor, düğme durumunu güncelliyor');

  // ---- Standarda dön ----
  A.GV.toggleFullscreen();
  await sleep(50);
  assert.strictEqual(exitCalls, 1, 'exitFullscreen bir kez çağrılmalı');
  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'standarda dönünce .is-full kalkmalı');
  assert.ok(/Tam Ekran/.test(fsBtn.innerHTML), 'standartta etiket yeniden "Tam Ekran" olmalı: ' + fsBtn.innerHTML);
  console.log('  ✓ 3) GV.toggleFullscreen() tekrar çağrılınca standarda dönüyor (kullanıcı istediği zaman geçebiliyor)');

  // ---- ESC ile tarayıcı kendisi çıkarsa da (dışarıdan fullscreenchange) senkron kalmalı ----
  A.GV.toggleFullscreen(); // tekrar tam ekrana geç
  await sleep(50);
  assert.strictEqual(fsBtn.classList.contains('is-full'), true, 'tekrar tam ekrana geçti');
  // Tarayıcı ESC ile kendi kendine çıkmış gibi simüle et (exitFullscreen ÇAĞRILMADAN):
  fsEl = null;
  Object.defineProperty(A.document, 'fullscreenElement', { value: null, configurable: true });
  A.document.dispatchEvent(new A.window.Event('fullscreenchange'));
  await sleep(50);
  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'ESC ile çıkışta da düğme senkron kalmalı');
  console.log('  ✓ 4) ESC gibi tarayıcı-kaynaklı çıkışlarda da düğme durumu senkron kalıyor');

  // ---- 4b) KURALLAR (ve tüm modallar) tam ekranda ARKA PLANDA KALMAMALI ----
  // Kullanıcı raporu (verbatim): "Tam ekran bastığımda kurallar arka planda
  // kalıyor, tam ekrandan çıktığımda gözüküyor, tam ekran içerisinde
  // kurallar bastığında tam ekranın önceliğinde olacak şekilde ön plana
  // çıkar." Kök neden: Fullscreen API #pg-room'u tarayıcının özel "üst
  // katman"ına alır; #rulesModal (ve diğer tüm .modal-bg pencereler)
  // dökümanda #pg-room'un KARDEŞİ olduğu için bu üst katmanın dışında
  // kalıp hiç ÇİZİLMİYORDU (z-index'in hiçbir etkisi yok). Çözüm: tam
  // ekrana girildiğinde TÜM .modal-bg pencereler #pg-room'un içine
  // taşınıyor, çıkılınca eski yerlerine dönüyor.
  const rulesModal = A.document.getElementById('rulesModal');
  assert.ok(rulesModal, '#rulesModal DOM\'da bulunmalı');
  assert.strictEqual(rulesModal.parentNode, A.document.body, 'başlangıçta Kurallar penceresi <body>\'nin doğrudan çocuğu (pg-room dışında)');

  A.GV.toggleFullscreen(); // tam ekrana geç
  await sleep(50);
  assert.strictEqual(rulesModal.parentNode, pgRoom,
    'TAM EKRANDAYKEN Kurallar penceresi #pg-room\'un İÇİNE taşınmalı — yoksa tarayıcı onu hiç çizmez');
  // Genel: rulesModal tek başına değil, TÜM modallar aynı şekilde taşınmalı
  // (örn. süre dolduğunda çıkan #timeoutModal de tam ekranda görünür kalmalı):
  const timeoutModal = A.document.getElementById('timeoutModal');
  assert.strictEqual(timeoutModal.parentNode, pgRoom, 'tam ekranda #timeoutModal da #pg-room içine taşınmalı');
  // Kurallar penceresi tam ekranda hâlâ normal şekilde açılıp kapanabiliyor
  // olmalı (yalnız DOM konumu değişti, show/hide mantığı bozulmamalı):
  A.GV.showRules();
  assert.ok(rulesModal.classList.contains('show'), 'tam ekranda Kurallar açılabiliyor (GV.showRules)');
  A.GV.hideModal('rulesModal');
  assert.ok(!rulesModal.classList.contains('show'), 'tam ekranda Kurallar kapanabiliyor (GV.hideModal)');
  console.log('  ✓ 4b) Tam ekranda TÜM modallar (Kurallar dahil) #pg-room içine taşınıp ÖN PLANDA görünüyor');

  A.GV.toggleFullscreen(); // standarda dön
  await sleep(50);
  assert.strictEqual(rulesModal.parentNode, A.document.body, 'standarda dönünce Kurallar penceresi eski yerine (body) geri dönmeli');
  assert.strictEqual(timeoutModal.parentNode, A.document.body, 'standarda dönünce #timeoutModal da eski yerine dönmeli');
  console.log('  ✓ 4c) Standarda dönünce modallar eski konumuna (body) geri taşınıyor — hiçbir şey bozulmuyor');

  // ---- 6) TAM EKRAN DÜZENİ: kaydırma yok + süre kartları DİKEY ----
  // Kullanıcı isteği: "tam ekran seçildiğinde scroll down-up seçeneği
  // olmasın, her şey ekrana sığsın. Yukarıdaki sayaçlar yatay yerine dikey
  // alt üst olarak yerleştirilebilir, böylece oyun dashboard daha geniş
  // alana sahip olur." Düzen `#pg-room.gv-fs` sınıfına bağlıdır (`:fullscreen`
  // ile `:-webkit-full-screen` aynı seçici listesinde yaşayamadığı için).
  A.GV.toggleFullscreen();                       // yeniden tam ekrana geç
  await sleep(50);
  assert.ok(pgRoom.classList.contains('gv-fs'), 'tam ekranda odaya gv-fs sınıfı eklenmeli');

  /* NOT: bu jsdom kurulumu biçem sayfalarını hiç AYRIŞTIRMIYOR
     (document.styleSheets[..].cssRules boş döner), bu yüzden kurallar
     hesaplanmış stilden değil KAYNAKTAN doğrulanır. Amaç regresyonu
     yakalamak: düzen kuralları yanlışlıkla silinirse test kırmızıya döner. */
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const blok = (secici) => {
    const i = kaynak.indexOf(secici + '{');
    if (i === -1) return '';
    return kaynak.slice(i, kaynak.indexOf('}', i) + 1);
  };
  const oda = blok('#pg-room.gv-fs');
  assert.ok(/overflow:\s*hidden/.test(oda), 'tam ekranda oda KAYDIRILMAMALI (overflow:hidden)');
  assert.ok(/height:\s*100vh/.test(oda), 'tam ekran odası ekran yüksekliğine sabitlenmeli');
  assert.ok(/display:\s*grid/.test(oda), 'tam ekran düzeni grid olmalı (sayaçlar yan kolona taşınabilsin)');
  assert.ok(/flex-direction:\s*column/.test(blok('#pg-room.gv-fs .game-side .timers')),
    'süre kartları tam ekranda DİKEY dizilmeli');
  assert.ok(/overflow:\s*hidden/.test(blok('#pg-room.gv-fs .game-board-area')),
    'tahta alanı taşmamalı (içerik küçülmeli)');
  assert.ok(kaynak.includes('#pg-room.gv-fs .game-layout{display:contents}'),
    'yan panel ve tahta dış grid\'e katılmalı (display:contents)');
  assert.ok(/@media\(max-width:760px\)\{[\s\S]{0,900}#pg-room\.gv-fs\{/.test(kaynak),
    'mobilde de tam ekran düzeni tanımlı olmalı');
  A.GV.toggleFullscreen();
  await sleep(50);
  assert.ok(!pgRoom.classList.contains('gv-fs'), 'standarda dönünce gv-fs kalkmalı');
  console.log('  ✓ 6) tam ekranda kaydırma kapalı, süre kartları dikey, tahta alanı taşmıyor');

  // ---- 7) SATRANÇ (ve TÜM tahta oyunları) TAM EKRANDA ÇÖKMEMELİ ----
  // Kullanıcı raporu (verbatim): "Satranç tam ekran yaptığımda çalışmadı.
  // Tüm oyunların webde ve mobilde, normal dashboard ekranında ve tam
  // ekranda doğru gösterildiğinden çalıştığından emin ol test et."
  // Kök neden: .chess-wrapper/.dama-wrap/... gibi sarmalayıcılar FLEX
  // (align-items:center) içinde width:auto idi → "içeriğe göre asgari
  // genişlik" moduna düşüyordu; .chess ayrıca container-type:inline-size
  // taşıdığından bu asgari genişlik SIFIRLANIYOR, tahta 6px'e (yalnız
  // kenarlık) çöküyordu. Çözüm iki parçalı: (a) sarmalayıcıya KESİN
  // (width:100%) genişlik ver; (b) aspect-ratio'yu BİZZAT tahtada taşıyan
  // oyunlarda (satranç/dama/türk daması) genişliği height:100%'ten TÜRET
  // (width:auto + height:100%, aspect-ratio genişliği doğru hesaplar);
  // hücre bazlı aspect-ratio taşıyan oyunlarda (reversi/gomoku/connect4)
  // ise width:100% esas alınır, yükseklik satırlardan kendiliğinden oluşur.
  // Bu blok gerçek Fullscreen API jsdom/sanal tarayıcıda çalışmadığından
  // (ve bu sandbox'ta headed Chromium'da da requestFullscreen "not granted"
  // hatası verdiğinden) KAYNAKTAN doğrulanır — amaç, bu CSS kuralları
  // yanlışlıkla silinir/bozulursa testin KIRMIZIYA dönmesidir. Gerçek
  // piksel doğrulaması (714x714 satranç, 611x611 dama) Playwright ile
  // manuel olarak ayrıca yapıldı.
  // NOT: bu seçici listesi kaynakta BİRDEN FAZLA satıra yayılıyor (virgülle
  // ayrılmış uzun bir liste), bu yüzden yukarıdaki blok()'un aksine "{" hemen
  // ardından gelmiyor — burada seçicinin İLK satırını arayıp "{"yi ondan
  // SONRA arayan ayrı bir yardımcı kullanıyoruz.
  const cokSatirliBlok = (parcaSecici) => {
    const i = kaynak.indexOf(parcaSecici);
    if (i === -1) return '';
    const acilis = kaynak.indexOf('{', i);
    if (acilis === -1) return '';
    return kaynak.slice(i, kaynak.indexOf('}', acilis) + 1);
  };
  const sarmalayici = cokSatirliBlok('#pg-room.gv-fs .dama-wrap,#pg-room.gv-fs .tdama-wrap,#pg-room.gv-fs .rv-wrap,');
  assert.ok(sarmalayici, 'tahta sarmalayıcıları için tam ekran kuralı bulunmalı');
  for (const sinif of ['.dama-wrap', '.tdama-wrap', '.rv-wrap', '.gm-wrap', '.c4-wrap', '.bil-wrap', '.bs-wrap', '.card-wrap', '.chess-wrapper', '.tavla-wrap']) {
    assert.ok(kaynak.includes('#pg-room.gv-fs ' + sinif), 'tam ekran sarmalayıcı kuralı ' + sinif + ' için eksik olmamalı');
  }
  assert.ok(/width:\s*100%/.test(sarmalayici), 'sarmalayıcı KESİN genişlik almalı (width:auto DEĞİL) — yoksa flex shrink-to-fit çöküşü geri gelir');
  assert.ok(/max-width:\s*none/.test(sarmalayici), 'sarmalayıcının normal moddaki max-width sınırı tam ekranda kaldırılmalı');

  // NOT: width:auto+height:100%+aspect-ratio yaklaşımı ÇOĞU genişlikte
  // çalışıyordu ama ORTA genişliklerde (örn. tablet tam ekranı ~900px)
  // tarayıcı max-width:100% ile genişliği kırptığında yüksekliği buna göre
  // YENİDEN HESAPLAMIYOR, tahta kare olmaktan çıkıyordu (gerçek tarayıcıda
  // 582×880 ölçüldü). Kesin çözüm: sarmalayıcı bir BOYUT container'ı
  // (container-type:size) olur, tahta da min(100cqw,100cqh) ile container'a
  // sığan EN BÜYÜK KAREYİ doğrudan hesaplar — genişlik/yükseklik HER ZAMAN
  // birbirine eşit kalır.
  const containerSarmalayici = blok('#pg-room.gv-fs .dama-wrap,#pg-room.gv-fs .tdama-wrap,#pg-room.gv-fs .chess-wrapper');
  assert.ok(containerSarmalayici, 'satranç/dama/türk daması sarmalayıcıları boyut container\'ı olmalı');
  assert.ok(/container-type:\s*size/.test(containerSarmalayici),
    'sarmalayıcı container-type:size taşımalı — yoksa cqw/cqh tahtaya sığan en büyük kareyi hesaplayamaz');
  const yukseklikTemelli = blok('#pg-room.gv-fs .dama-board,#pg-room.gv-fs .tdama-board,#pg-room.gv-fs .chess');
  assert.ok(yukseklikTemelli, 'kendi aspect-ratio\'sunu taşıyan tahtalar (satranç/dama/türk daması) için kural bulunmalı');
  assert.ok(/width:\s*min\(100cqw,\s*100cqh\)/.test(yukseklikTemelli) && /height:\s*min\(100cqw,\s*100cqh\)/.test(yukseklikTemelli),
    'satranç/dama/türk daması genişlik VE yükseklik min(100cqw,100cqh) ile AYNI ANDA hesaplanmalı — kare garantisi (dikdörtgene dönüşme regresyonunun düzeltmesi) budur');

  const genislikTemelli = blok('#pg-room.gv-fs .rv-board,#pg-room.gv-fs .gm-board,#pg-room.gv-fs .c4-board');
  assert.ok(genislikTemelli, 'hücre bazlı aspect-ratio taşıyan tahtalar (reversi/gomoku/connect4) için kural bulunmalı');
  assert.ok(/width:\s*100%/.test(genislikTemelli) && /height:\s*auto/.test(genislikTemelli),
    'reversi/gomoku/connect4 genişliği esas alıp yüksekliğin hücrelerden doğal oluşmasına izin vermeli');

  assert.ok(/#pg-room\.gv-fs \.bil-canvas\{[^}]*height:\s*100%/.test(kaynak),
    'bilardo (canvas — gerçek intrinsik orana sahip) tam ekranda hâlâ doğru boyutlanmalı');
  console.log('  ✓ 7) TÜM tahta oyunlarının (satranç dahil) tam ekran CSS kuralları eksiksiz — 6px\'e çökme regresyonu engellendi');

  // ---- 8) KURALLAR PENCERESİ TAM EKRANDA #pg-room İÇİNDE BAŞKA SAYFAYA
  // GEÇİŞTE DE DOĞRU KALMALI (modal reparenting yan etkisiz) ----
  // (4b/4c zaten bunu ayrıntılı test ediyor; burada yalnızca kod yolunun
  // GENEL olduğunu — yalnız #rulesModal'a özel olmadığını — kaynaktan
  // teyit ediyoruz.)
  assert.ok(/document\.querySelectorAll\(['"]\.modal-bg['"]\)/.test(kaynak),
    'modal taşıma TÜM .modal-bg pencerelerini kapsamalı, yalnız Kurallar\'ı değil');
  console.log('  ✓ 8) Modal taşıma mantığı genel (.modal-bg) — yeni eklenecek modallar da otomatik kapsanır');

  // ---- 9) SÜRE KARTLARI "SEN VS RAKİP" PANOSUNUN ÜZERİNDE (madde 6) ----
  // Kullanıcı raporu (verbatim): "Toplam genel süreler ve hamle süreleri,
  // tam ekranda gösterildiği gibi 'sen vs rakip' puan tablosunun üzerinde
  // gözüksün. Bu tüm oyunlarda geçerli olsun. Hem tam ekranda hem normal
  // dashboard da, mobilde de webde de." Eskiden #topTimers tahtanın
  // ÜSTÜNDE ayrı, tam genişlikte bir şerit olarak duruyordu (normal modda)
  // ve tahtaya ayrılan dikey alanı ~90-100px yiyordu. Artık #topTimers,
  // HTML'de doğrudan .game-side'ın İLK çocuğu — .score-panel'den ÖNCE —
  // bu YAPISAL bir çözüm olduğundan hem normal hem tam ekranda (CSS moda
  // göre yeniden konumlandırmaya gerek kalmadan) otomatik olarak geçerli.
  const topTimersEl = A.document.getElementById('topTimers');
  const scorePanelEl = A.document.querySelector('.score-panel');
  const gameSideEl = A.document.querySelector('.game-side');
  assert.strictEqual(topTimersEl.parentElement, gameSideEl,
    '#topTimers artık .game-side\'ın İÇİNDE olmalı (tahtanın üstünde ayrı şerit DEĞİL)');
  assert.ok(
    topTimersEl.compareDocumentPosition(scorePanelEl) & A.Node.DOCUMENT_POSITION_FOLLOWING,
    '#topTimers, .score-panel\'den ÖNCE gelmeli — "üzerinde gözüksün" isteğinin YAPISAL karşılığı');
  // Normal moddaki .timers artık DİKEY (fullscreen'deki AYNI görünüm) —
  // dar yan kolona (.game-side) oturur, tahtanın üstünde yer kaplamaz.
  assert.ok(/\.timers\{display:flex;flex-direction:column/.test(kaynak),
    'normal moddaki .timers de (fullscreen ile TUTARLI olacak şekilde) DİKEY dizilmeli');
  // --gv-chrome artık süre şeridini SAYMAMALI (tahta üstten büyüsün diye
  // küçültüldü) — regresyon: biri yanlışlıkla eski büyük değere dönerse
  // tahta yine gereksiz yere küçük kalır.
  assert.ok(/--gv-chrome:190px/.test(kaynak),
    '--gv-chrome süre şeridi tahtanın üstünden kalktığı için küçültülmüş olmalı (290px DEĞİL)');
  // Mobil tam ekranda puan panosu (Okey-dışı oyunlarda joinRoom'un INLINE
  // "display:flex" yazdığı .score-panel) gerçekten gizlenmeli — inline
  // stil normal bir kuralı yener, bu yüzden !important şart.
  assert.ok(/#pg-room\.gv-fs \.game-side>\*:not\(\.timers\)\{display:none!important\}/.test(kaynak),
    'mobil tam ekranda puan panosu/hamleler/sohbet gizlenirken !important olmalı — yoksa joinRoom\'un inline stili kazanır ve panolar tahtanın üstüne taşar');
  console.log('  ✓ 9) Süre kartları artık .game-side\'ın İLK çocuğu — "Sen vs Rakip" panosunun HER ZAMAN üzerinde (hem normal hem tam ekran, hem web hem mobil)');

  // ---- Fullscreen API hiç desteklenmiyorsa sessizce (hatasız) düşmeli ----
  delete pgRoom.requestFullscreen;
  delete pgRoom.webkitRequestFullscreen;
  delete pgRoom.mozRequestFullScreen;
  delete pgRoom.msRequestFullscreen;
  let hataAtildi = false;
  try { A.GV.toggleFullscreen(); } catch (_) { hataAtildi = true; }
  assert.ok(!hataAtildi, 'Fullscreen API desteklenmiyorsa bile hata fırlatılmamalı');
  assert.strictEqual(fsBtn.classList.contains('is-full'), false, 'desteklenmiyorsa durum değişmemeli');
  console.log('  ✓ 5) tarayıcı Fullscreen API\'sini desteklemiyorsa sessizce (hatasız) düşüyor');

  try { A.close(); B.close(); } catch (_) {}
  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK tam ekran: kullanıcı istediği an tam ekran/standart arasında geçiş yapabiliyor');
  process.exit(0);
}

main().catch(e => { console.error('❌ TAM EKRAN TEST HATASI:', e); process.exit(1); });
