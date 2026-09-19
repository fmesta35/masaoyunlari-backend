'use strict';

/*
 * PES ET + RÖVANŞ (YENİDEN OYNA) — kullanıcı isteği (verbatim):
 *
 *  "Oyun içinde pes et butonu da olsun oyun esnasında da basabilir ayrıl
 *   butonuna basar gibi, oyun bittiğinde ( yenilgi / zafer olduktan sonra )
 *   lobiye dön butonu yanında rövanş talep et butonu da olsun. Eğer 30
 *   saniye içerisinde tıklama olmazsa otomatik lobiye yönlendirilir veya
 *   karşı rakip odadan çıktıysa diğer oyuncu da otomatik lobiye
 *   yönlendirilir. Eğer rövanş talep ederse oyunculardan biri, diğerine
 *   ekranda uyarı çıkar, kabul ederse aynı odada yeni bir ele geçebilirler.
 *   ... Bu normal 2 kişiliklerde geçerli. 3-4 kişilik oyunlarda ise
 *   oylamaya sunulur. Herkes kabul ederse ona göre aynı odada yeni el
 *   döngüsüne başlanır ( 3 el , 1el -5 el - 7 el ) oyun masa tipine bağlı."
 *
 * Bu test GERÇEK sunucu + GERÇEK soketlerle doğrular:
 *  1) PES ET: oyun sürerken pes eden oyuncu maçı kaybeder, RAKİP kazanır —
 *     ama pes eden oyuncu ODADA KALIR (ayrılmaktan farkı budur; rövanş
 *     ancak böyle mümkün olur).
 *  2) RÖVANŞ (2 kişilik): biri talep eder → diğerine teklif ulaşır →
 *     kabul edince AYNI ODADA yeni maç başlar.
 *  3) RED: reddedilirse yeni maç başlamaz, iki tarafa da bildirilir.
 *  4) OYLAMA (3+ kişilik): herkes kabul etmeden yeni el BAŞLAMAZ.
 *  5) EL SAYISI: rövanş sonrası masa tipinin el sayısı (rounds) korunur.
 *  6) RAKİP AYRILIRSA: bekleyen rövanş düşer, kalan oyuncu bilgilendirilir.
 */

process.env.GV_POST_GAME_HOLD_MS = '30000';   // rövanş penceresi açık kalsın

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-rematch-'));

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

function baglan() {
  const s = ioClient(BASE, { transports: ['websocket'], forceNew: true });
  s.__olaylar = {};
  const eski = s.on.bind(s);
  ['gameStarted', 'gameEnded', 'roomUpdated', 'rematchOffer', 'rematchDeclined',
   'rematchStarted', 'playerResigned', 'playerLeft'].forEach(ev => {
    eski(ev, p => { (s.__olaylar[ev] = s.__olaylar[ev] || []).push(p); });
  });
  return s;
}
function son(s, ev) { const a = s.__olaylar[ev]; return a && a.length ? a[a.length - 1] : null; }
function temizle(s, ev) { s.__olaylar[ev] = []; }

async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)) {
    const v = fn();
    if (v) return v;
    await sleep(60);
  }
  throw new Error('zaman aşımı: ' + ne);
}

async function odayaGir(sockets, roomId, gameId, opts) {
  for (const s of sockets) {
    s.emit('joinRoom', Object.assign({ roomId, gameId }, opts || {}));
    await sleep(120);
  }
  for (const s of sockets) s.emit('setReady', { roomId, ready: true });
  for (const s of sockets) await bekle(() => son(s, 'gameStarted'), 12000, 'oyun başlasın');
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://127.0.0.1:' + server.address().port;

  // ============ 1) PES ET: kaybeder ama ODADA KALIR ============
  {
    const A = baglan(), B = baglan();
    await sleep(250);
    await odayaGir([A, B], 'pes-1', 'dama');

    A.emit('gvResign', { roomId: 'pes-1' });

    const aBitis = await bekle(() => son(A, 'gameEnded'), 8000, 'pes eden bitiş ekranı');
    const bBitis = await bekle(() => son(B, 'gameEnded'), 8000, 'rakip bitiş ekranı');
    assert.strictEqual(aBitis.reason, 'resign', 'bitiş sebebi "resign" olmalı');
    assert.strictEqual(aBitis.youWon, false, 'pes eden KAYBETMİŞ sayılmalı');
    assert.strictEqual(bBitis.youWon, true, 'rakip KAZANMIŞ sayılmalı');
    await bekle(() => son(B, 'playerResigned'), 4000, 'rakibe "pes etti" bildirimi');

    // ASIL FARK: pes eden oyuncu masadan ÇIKMAZ (ayrılmak çıkarırdı).
    const oda = await bekle(() => son(B, 'roomUpdated'), 6000, 'oda güncellemesi');
    assert.strictEqual((oda.players || []).length, 2,
      'pes eden oyuncu MASADA KALMALI (rövanş ancak böyle mümkün) — bulunan: ' + (oda.players || []).length);
    console.log('  ✓ 1) pes et: maç kaybedildi, rakip kazandı, pes eden masada kaldı');

    // ============ 2) RÖVANŞ: talep → kabul → aynı odada yeni maç ============
    temizle(A, 'gameStarted'); temizle(B, 'gameStarted');
    A.emit('rematchRequest', { roomId: 'pes-1' });

    const teklif = await bekle(() => son(B, 'rematchOffer'), 6000, 'rakibe rövanş teklifi ulaşmalı');
    assert.strictEqual(teklif.youRequested, false, 'teklifi açan B değil');
    assert.strictEqual(teklif.need, 2, '2 kişilik masada 2 kabul gerekir');
    const kendi = await bekle(() => son(A, 'rematchOffer'), 4000, 'talep edene kendi durumu');
    assert.strictEqual(kendi.youRequested, true, 'talebi açan A olmalı');
    assert.strictEqual(kendi.youAccepted, true, 'talebi açan otomatik kabul sayılır');

    B.emit('rematchVote', { roomId: 'pes-1', accept: true });
    await bekle(() => son(A, 'rematchStarted'), 8000, 'rövanş başlamalı (A)');
    await bekle(() => son(B, 'rematchStarted'), 8000, 'rövanş başlamalı (B)');
    const yeniA = await bekle(() => son(A, 'gameStarted'), 8000, 'AYNI odada yeni maç (A)');
    const yeniB = await bekle(() => son(B, 'gameStarted'), 8000, 'AYNI odada yeni maç (B)');
    assert.strictEqual(String(yeniA.roomId), 'pes-1', 'yeni maç AYNI odada olmalı');
    assert.strictEqual(String(yeniB.roomId), 'pes-1', 'yeni maç AYNI odada olmalı');
    console.log('  ✓ 2) rövanş: talep → karşı tarafa uyarı → kabul → aynı odada yeni maç');

    A.close(); B.close();
    await sleep(300);
  }

  // ============ 3) RED: yeni maç BAŞLAMAZ ============
  {
    const A = baglan(), B = baglan();
    await sleep(250);
    await odayaGir([A, B], 'pes-2', 'dama');
    A.emit('gvResign', { roomId: 'pes-2' });
    await bekle(() => son(B, 'gameEnded'), 8000, 'maç bitsin');

    temizle(A, 'gameStarted'); temizle(B, 'gameStarted');
    B.emit('rematchRequest', { roomId: 'pes-2' });
    await bekle(() => son(A, 'rematchOffer'), 6000, 'teklif ulaşsın');
    A.emit('rematchVote', { roomId: 'pes-2', accept: false });

    const red = await bekle(() => son(B, 'rematchDeclined'), 6000, 'red bildirimi');
    assert.strictEqual(red.reason, 'declined', 'red sebebi bildirilmeli');
    await sleep(800);
    assert.ok(!son(A, 'gameStarted') && !son(B, 'gameStarted'),
      'REDDEDİLİNCE yeni maç BAŞLAMAMALI');
    console.log('  ✓ 3) rövanş reddedilince yeni maç başlamıyor, iki tarafa da bildiriliyor');
    A.close(); B.close();
    await sleep(300);
  }

  // ============ 4+5) 3 KİŞİLİK OYLAMA + EL SAYISI KORUNUMU ============
  {
    const A = baglan(), B = baglan(), C = baglan();
    await sleep(250);
    // 3 kişilik okey masası, 5 EL — rövanş sonrası el sayısı korunmalı.
    await odayaGir([A, B, C], 'pes-3', 'okey', { maxPlayers: 3, rounds: 5 });
    const ilkDurum = son(A, 'gameStarted');
    const ilkEl = (ilkDurum.gameState && ilkDurum.gameState.maxRounds) || null;
    assert.strictEqual(ilkEl, 5, 'masa tipi 5 el olmalı (bulunan: ' + ilkEl + ')');

    A.emit('gvResign', { roomId: 'pes-3' });
    await bekle(() => son(B, 'gameEnded'), 10000, 'okey maçı bitsin');

    temizle(A, 'gameStarted'); temizle(B, 'gameStarted'); temizle(C, 'gameStarted');
    A.emit('rematchRequest', { roomId: 'pes-3' });
    const t3 = await bekle(() => son(B, 'rematchOffer'), 6000, '3 kişilik teklif');
    assert.strictEqual(t3.need, 3, '3 kişilik masada 3 kabul gerekir (oylama)');

    // Yalnız BİR kişi kabul ederse yeni el BAŞLAMAMALI (oylama kuralı).
    B.emit('rematchVote', { roomId: 'pes-3', accept: true });
    await sleep(900);
    assert.ok(!son(A, 'rematchStarted'),
      'HERKES kabul etmeden yeni el başlamamalı (3-4 kişilik oylama kuralı)');
    const ara = await bekle(() => {
      const o = son(C, 'rematchOffer');
      return (o && (o.acceptedSeats || []).length === 2) ? o : null;
    }, 5000, 'ara oylama durumu');
    assert.strictEqual(ara.acceptedSeats.length, 2, 'iki kabul görünmeli');

    // Üçüncü kişi de kabul edince yeni el başlar.
    C.emit('rematchVote', { roomId: 'pes-3', accept: true });
    await bekle(() => son(A, 'rematchStarted'), 8000, 'herkes kabul edince rövanş başlar');
    const yeni = await bekle(() => son(A, 'gameStarted'), 10000, 'yeni okey eli');
    assert.strictEqual(String(yeni.roomId), 'pes-3', 'yeni el AYNI odada');
    const yeniEl = (yeni.gameState && yeni.gameState.maxRounds) || null;
    assert.strictEqual(yeniEl, 5,
      'rövanş sonrası masa tipinin EL SAYISI korunmalı (beklenen 5, bulunan ' + yeniEl + ')');
    console.log('  ✓ 4) 3 kişilik masa: herkes kabul etmeden yeni el başlamıyor (oylama)');
    console.log('  ✓ 5) rövanş sonrası masa tipinin el sayısı (5 el) korunuyor');
    A.close(); B.close(); C.close();
    await sleep(300);
  }

  // ============ 6) RAKİP AYRILIRSA rövanş düşer ============
  {
    const A = baglan(), B = baglan();
    await sleep(250);
    await odayaGir([A, B], 'pes-4', 'dama');
    A.emit('gvResign', { roomId: 'pes-4' });
    await bekle(() => son(B, 'gameEnded'), 8000, 'maç bitsin');

    A.emit('rematchRequest', { roomId: 'pes-4' });
    await bekle(() => son(B, 'rematchOffer'), 6000, 'teklif ulaşsın');

    B.emit('leaveRoom');                       // rakip masadan çıkar
    const dus = await bekle(() => son(A, 'rematchDeclined'), 6000,
      'rakip ayrılınca bekleyen rövanş DÜŞMELİ');
    assert.strictEqual(dus.reason, 'player_left', 'sebep "rakip ayrıldı" olmalı');
    console.log('  ✓ 6) rakip odadan çıkınca bekleyen rövanş düşüyor ve bildiriliyor');
    A.close(); B.close();
    await sleep(300);
  }

  // ============ 7) ARAYÜZ: bitiş ekranında iki düğme + 30 sn geri sayım ==
  // Gerçek tarayıcı sayfasını (jsdom) açar, gerçek bir maçı PES ET ile
  // bitirir ve bitiş ekranında "Lobiye Dön" YANINDA "Rövanş Talep Et"
  // düğmesinin çıktığını, geri sayımın 30 sn olduğunu doğrular.
  {
    const { JSDOM, VirtualConsole } = require('jsdom');
    const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
    const dom = await JSDOM.fromURL(BASE + '/index.html', {
      resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
    });
    const win = dom.window;
    await bekle(() => win.st && win.GV && win.GVRematch, 20000, 'sayfa açılışı');

    // Pencere odaya otursun, ikinci oyuncu soketten katılsın.
    const B = baglan();
    await sleep(250);
    win.st.curGame = 'dama';
    win.GV.joinRoom('ui-son');
    await bekle(() => win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM düğmesi');
    B.emit('joinRoom', { roomId: 'ui-son', gameId: 'dama' });
    await sleep(400);
    win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
    B.emit('setReady', { roomId: 'ui-son', ready: true });
    await bekle(() => son(B, 'gameStarted'), 15000, 'maç başlasın');

    // Pencere oyun sürerken "Pes Et" düğmesini GÖRMELİ.
    const pesBtn = await bekle(() => {
      const b = win.document.getElementById('gvResignBtn');
      return (b && b.style.display !== 'none') ? b : null;
    }, 20000, 'oyun sürerken "Pes Et" düğmesi görünmeli (oda durumu: ' + win.__gvRoomStatus + ')');
    assert.ok(/Pes Et/.test(pesBtn.textContent), 'düğme metni "Pes Et" olmalı');

    // Rakip pes etsin → pencerede bitiş ekranı açılsın.
    B.emit('gvResign', { roomId: 'ui-son' });
    const kart = await bekle(() => win.document.querySelector('.gv-end, .chess-end-overlay'), 12000,
      'bitiş ekranı açılmalı');
    const rovans = kart.querySelector('.gv-rematch-btn');
    assert.ok(rovans, 'bitiş ekranında "Rövanş Talep Et" düğmesi OLMALI');
    assert.ok(/Rövanş/.test(rovans.textContent), 'düğme metni "Rövanş Talep Et" olmalı');
    assert.ok(kart.querySelector('.gv-end-btn') || /Lobiye/i.test(kart.textContent),
      '"Lobiye Dön" düğmesi de kalmalı (rövanş onun YANINA eklendi)');
    assert.ok(/30/.test(kart.textContent),
      'otomatik lobiye dönüş 30 sn olmalı (kullanıcı isteği) — bulunan: ' + kart.textContent.slice(0, 120));

    // Maç bitince "Pes Et" düğmesi gizlenmeli.
    await bekle(() => {
      const b = win.document.getElementById('gvResignBtn');
      return b && b.style.display === 'none';
    }, 8000, 'maç bitince "Pes Et" düğmesi gizlenmeli');

    console.log('  ✓ 7) bitiş ekranı: "Lobiye Dön" + "Rövanş Talep Et" yan yana, 30 sn geri sayım');
    B.close(); win.close();
    await sleep(300);
  }

  server.close();
  console.log('OK pes et + rövanş: teslim, talep/kabul/red, 3 kişilik oylama, el sayısı korunumu, arayüz');
  process.exit(0);
}

main().catch(err => { console.error('❌ PES ET / RÖVANŞ HATASI:', err); process.exit(1); });
