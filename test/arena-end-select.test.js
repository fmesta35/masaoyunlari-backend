'use strict';

/*
 * ORTAK YAŞAM DÖNGÜSÜ (online-arena) — MAÇ SONU ve TAŞ SEÇİMİ
 *
 *  İki kullanıcı raporunu birlikte kilitler:
 *
 *  A) "Rakip oyundan çıktı, hamle süresi doldu ama bir şey olmuyor."
 *     Sunucuda ayrılan oyuncunun hükmen mağlubiyeti YALNIZ satranç, tavla
 *     ve okey için işleniyordu; dama/reversi/gomoku/connect4/bilardo/kart
 *     masalarında oda sessizce beklemeye dönüyordu. Kalan oyuncu donmuş
 *     bir tahtayla kalıyor, ne bildirim görüyor ne lobiye dönebiliyordu.
 *     Üstelik oda 'waiting'e düştüğü için hamle süresi denetimi de
 *     duruyordu — sayaç sıfırda takılı kalıyordu.
 *
 *  B) "Tıkladığım taşın hangi taş olduğu gözükmüyor."
 *     Oynanabilir her taşa yeşil nokta konuyor, seçilen taş belli
 *     olmuyor, gidilebilecek kareler hiç gösterilmiyordu.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function istemci() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  return dom.window;
}
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 25000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + ne);
}
function tikla(w, el) { el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); }

async function masaKur(oda) {
  const A = await istemci(), B = await istemci();
  for (const w of [A, B]) {
    await bekle(() => w.GV && w.st && w.GVArena && w.GVMsg, 25000, 'istemci hazır');
    await bekle(() => typeof w.__gvStartRealRoomWaiting === 'function', 25000, 'bekleme odası köprüsü');
    w.st.curGame = 'dama';
    w.GV.joinRoom(oda);
  }
  for (const w of [A, B]) {
    await bekle(() => w.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    w.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }
  for (const w of [A, B]) await bekle(() => w.document.querySelector('#boardArea .dama-board'), 25000, 'dama tahtası');
  return [A, B];
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  // ================= B) TAŞ SEÇİMİ =================
  {
    const [A, B] = await masaKur('sel-dama');
    const sirali = await bekle(() => [A, B].find(w => {
      const s = w.GVArena.state();
      return s && s.turn === s.playerColor;
    }) || null, 20000, 'sırası gelen pencere');
    const bekleyen = [A, B].find(w => w !== sirali);
    const doc = sirali.document;

    // 1) Oynanabilir taşlar halkalı; eski "her taşa yeşil nokta" gitti
    const oynanabilir = doc.querySelectorAll('#boardArea .dama-c.movable');
    assert.ok(oynanabilir.length > 0, 'oynanabilir taşlar işaretlenmeli');
    assert.strictEqual(doc.querySelectorAll('#boardArea .dama-c.valid').length, 0,
      'eski "valid" gösterimi kalmamalı');
    // Rakip pencerede hiçbir taş oynanabilir görünmemeli (sıra onda değil)
    assert.strictEqual(bekleyen.document.querySelectorAll('#boardArea .dama-c.movable').length, 0,
      'sırası olmayan oyuncuda taş seçilebilir görünmemeli');

    // 2) Bir taşa dokun → SEÇİLİ olsun ve hedefleri işaretlensin
    assert.strictEqual(doc.querySelectorAll('#boardArea .dama-c.sel').length, 0, 'başlangıçta seçim yok');
    const hamle = sirali.GVArena.state().legalMoves[0];
    const kare = doc.querySelector('#boardArea .dama-c[data-r="' + hamle.from[0] + '"][data-c="' + hamle.from[1] + '"]');
    tikla(sirali, kare);
    await bekle(() => doc.querySelector('#boardArea .dama-c.sel'), 5000, 'seçim vurgusu');
    const secili = doc.querySelector('#boardArea .dama-c.sel');
    assert.strictEqual(Number(secili.dataset.r), hamle.from[0], 'seçilen taş doğru karede');
    const hedefler = doc.querySelectorAll('#boardArea .dama-c.target');
    assert.ok(hedefler.length > 0, 'seçilen taşın gidebileceği kareler gösterilmeli');

    // 3) Aynı taşa tekrar dokun → seçim kalksın
    tikla(sirali, doc.querySelector('#boardArea .dama-c.sel'));
    await bekle(() => !doc.querySelector('#boardArea .dama-c.sel'), 5000, 'seçim kalkmalı');
    assert.strictEqual(doc.querySelectorAll('#boardArea .dama-c.target').length, 0,
      'seçim kalkınca hedefler de kalkmalı');

    // 4) Seç + hedefe dokun → hamle sunucuya gider
    const once = JSON.stringify(sirali.GVArena.state().board);
    tikla(sirali, doc.querySelector('#boardArea .dama-c[data-r="' + hamle.from[0] + '"][data-c="' + hamle.from[1] + '"]'));
    await bekle(() => doc.querySelector('#boardArea .dama-c.target'), 5000, 'hedefler');
    tikla(sirali, doc.querySelector('#boardArea .dama-c.target'));
    await bekle(() => JSON.stringify(sirali.GVArena.state().board) !== once, 12000, 'hamle sunucudan dönmeli');
    console.log('  ✓ 1) taş seçimi: oynanabilir halkalı, seçili vurgulu, hedefler işaretli, tıklamayla oynanıyor');

    for (const w of [A, B]) { try { w.close(); } catch (_) {} }
    await sleep(150);
  }

  // ================= A) RAKİP AYRILINCA =================
  {
    const [A, B] = await masaKur('cikis-dama');
    // A ayrılsın; B kazanmalı.
    // NOT: Ayrıl düğmesi doğrudan çıkmaz — leave-guard önce bir onay
    // penceresi açar; sunucuya leaveRoom yalnız ONAYDAN sonra gider.
    A.GV.leaveRoom();
    const onay = await bekle(() => A.document.querySelector('.gvlg-yes'), 10000, 'terk onay penceresi');
    tikla(A, onay);

    const kart = await bekle(() => B.document.querySelector('#boardArea .gv-end'), 15000,
      'kalan oyuncuda maç sonu ekranı');
    const baslik = kart.querySelector('.gv-end-title').textContent;
    const metin = kart.querySelector('.gv-end-text').textContent;
    assert.ok(/Kazand/i.test(baslik), 'kalan oyuncu KAZANDI görmeli, görülen: ' + baslik);
    assert.ok(/ayrıl/i.test(metin), 'sebep açıkça yazmalı, görülen: ' + metin);
    assert.ok(kart.classList.contains('win'), 'kazanan kutusu vurgulu olmalı');
    assert.ok(!/player_left|illegal_move|_/.test(baslik + metin),
      'kullanıcıya teknik kod gösterilmemeli: ' + baslik + ' / ' + metin);
    assert.strictEqual(B.GVArena.ended(), true, 'arena maçı bitmiş saymalı');
    console.log('  ✓ 2) rakip ayrıldı: kalan oyuncu "Kazandınız" ekranını sebebiyle birlikte görüyor');

    // Düğmeye basınca oyunun lobisine dönülür
    tikla(B, kart.querySelector('.gv-end-btn'));
    await bekle(() => B.document.querySelector('#pg-lobby.active') ||
                      B.document.querySelector('#pg-rooms.active') ||
                      !B.document.querySelector('#pg-room.active'), 8000, 'lobiye dönüş');
    assert.ok(!B.document.querySelector('#pg-room.active'), 'oyun odasından çıkılmış olmalı');
    assert.ok(!B.document.querySelector('#boardArea .gv-end'), 'sonuç ekranı kapanmalı');
    console.log('  ✓ 3) "Lobiye dön" düğmesi oyuncuyu odadan çıkarıyor');

    for (const w of [A, B]) { try { w.close(); } catch (_) {} }
    await sleep(150);
  }

  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK arena: maç sonu ekranı + taş seçimi');
  process.exit(0);
}

main().catch(e => { console.error('❌ ARENA TEST HATASI:', e); process.exit(1); });
