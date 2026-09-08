'use strict';

/*
 * TAVLA — GERÇEK ARAYÜZDEN EL OYNAMA (kullanıcı raporu: "tavlada ele
 * başlanamıyor, hata veriyor")
 *
 *  Mevcut test/tavla-online.test.js yalnızca SOKET katmanını sınıyordu:
 *  zar/hamle paketleri doğruydu ama tarayıcıdaki düğme ve tıklamaların
 *  bu paketlere gerçekten dönüşüp dönüşmediği hiç denenmemişti. Online
 *  tavla, index.html'in yerleşik çizicisini (dTavla) kullanıp GV._tv*
 *  fonksiyonlarını çevrimiçi sürümleriyle DEĞİŞTİREREK çalışır; bu
 *  değiştirme bozulursa tahta çizilir ama hiçbir tıklama işlemez.
 *
 *  Bu test iki gerçek pencerede masaya oturur, ZAR ATAR ve DOM üzerinden
 *  bir pul oynar; hamlenin sunucudan iki pencereye de döndüğünü doğrular.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_TAVLA_FORCE_DICE = '3,1';     // deterministik zar

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function istemci() {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  win.__gvErrors = [];
  win.addEventListener('error', e => win.__gvErrors.push(String(e.message || e)));
  return win;
}
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 25000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + ne);
}
const tavla = w => (w.st && w.st.boards && w.st.boards.tavla) || null;

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;

  const A = await istemci(), B = await istemci();
  for (const w of [A, B]) {
    await bekle(() => w.GV && w.st && typeof w.__gvStartRealRoomWaiting === 'function', 25000, 'istemci hazır');
    w.st.curGame = 'tavla';
    w.GV.joinRoom('ui-tavla');
  }
  for (const w of [A, B]) {
    await bekle(() => w.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    w.document.querySelector('#gv-real-chess-wait .gv-ready').click();
  }

  // 1) Tahta iki pencerede de çizilir
  for (const w of [A, B]) await bekle(() => w.document.querySelector('#boardArea .tavla-wrap'), 25000, 'tavla tahtası');
  for (const w of [A, B]) {
    const kotu = w.__gvErrors.filter(x => /is not defined|undefined is not|not a function/.test(x));
    assert.strictEqual(kotu.length, 0, 'istemci JS hatası: ' + kotu.join(' | '));
  }
  console.log('  ✓ 1) online tavla masası iki pencerede de çizildi (JS hatası yok)');

  // 2) Online istemci yerleşik GV._tv* fonksiyonlarını devralmış olmalı;
  //    aksi halde tıklamalar yerel (offline) tahtayı oynatır, sunucuya
  //    hiçbir şey gitmez — "ele başlanamıyor" bunun belirtisidir.
  for (const w of [A, B]) {
    assert.strictEqual(typeof w.GV._tvRoll, 'function', 'zar fonksiyonu bulunmalı');
    assert.strictEqual(typeof w.GV._tvClick, 'function', 'tıklama fonksiyonu bulunmalı');
  }

  // 3) ZAR: sırası gelen pencere atar
  await bekle(() => tavla(A) && tavla(B), 15000, 'durum aynası');
  for (const w of [A, B]) { try { w.GV._tvRoll(); } catch (_) {} }
  // SIRASI GELEN pencere: iki pencere de zarı görür, ama yalnız birinin
  // sırasıdır. (Teşhis kancası tavla-online.js'te tanımlıdır.)
  const atan = await bekle(() => [A, B].find(w => {
    const s = tavla(w);
    const d = w.__gvTavlaDebug && w.__gvTavlaDebug();
    return s && s.diceRolled && (s.availableMoves || []).length > 0 && d && d.mine === d.turn;
  }) || null, 20000, 'zar atılmalı ve sıra sahibi belirlenmeli');
  const diger = [A, B].find(w => w !== atan);
  const s0 = tavla(atan);
  assert.ok(Number(s0.dice[0]) > 0 && Number(s0.dice[1]) > 0,
    'sunucunun attığı zar istemciye yansımalı, görülen: ' + JSON.stringify(s0.dice));
  await bekle(() => { const s = tavla(diger); return s && s.diceRolled; }, 15000, 'zar rakip pencerede de görünmeli');
  console.log('  ✓ 2) "Zar At" sunucuya gidiyor, zar iki pencerede de görünüyor');

  // 4) HAMLE: DOM'daki gibi seç + hedefe tıkla
  const renk = s0.turn;
  const oncekiKareler = JSON.stringify(s0.points);
  let oynandi = false;
  for (let i = 0; i < 24 && !oynandi; i++) {
    const s = tavla(atan);
    const p = s.points[i];
    if (!p || p.color !== renk || !p.count) continue;
    atan.GV._tvClick(i);                       // seç
    await sleep(120);
    const sec = tavla(atan);
    const hedefler = (sec.validTargets || []);
    if (sec.selected !== i || !hedefler.length) { atan.GV._tvClick(i); await sleep(80); continue; }
    atan.GV._tvClick(hedefler[0]);             // oyna
    oynandi = true;
  }
  assert.ok(oynandi, 'oynanabilir bir pul bulunup seçilebilmeli (seçim ve hedefler çalışmalı)');

  await bekle(() => JSON.stringify(tavla(atan).points) !== oncekiKareler, 12000,
    'hamle SUNUCUDAN oynayan pencereye dönmeli');
  await bekle(() => JSON.stringify(tavla(diger).points) !== oncekiKareler, 12000,
    'hamle RAKİP pencereye de yansımalı');
  console.log('  ✓ 3) pul seçilip oynanıyor; hamle sunucudan iki pencereye de dönüyor');

  // 5) SESSİZ AĞ: aynı odaya defalarca katılma hatası geri gelmesin.
  //    Ölçüm: eskiden ~20 joinRoom/sn gidiyor, masa saniyede onlarca kez
  //    yeniden çiziliyor ve zar bildirimi üst üste yığılıyordu.
  for (const w of [A, B]) {
    w.__join = 0;
    const sk = w.__gvRoomSocket;
    if (sk) { const oe = sk.emit.bind(sk); sk.emit = function (ev) { if (ev === 'joinRoom') w.__join++; return oe.apply(null, arguments); }; }
  }
  await sleep(3000);
  for (const w of [A, B]) {
    assert.ok(w.__join <= 1, '3 sn içinde en fazla 1 joinRoom gitmeli, giden: ' + w.__join);
  }
  console.log('  ✓ 4) masa sürekli yeniden katılmıyor (3 sn içinde en fazla 1 joinRoom)');

  for (const w of [A, B]) { try { w.close(); } catch (_) {} }
  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK tavla arayüzü: zar atma ve pul oynama uçtan uca çalışıyor');
  process.exit(0);
}

main().catch(e => { console.error('❌ TAVLA UI HATASI:', e); process.exit(1); });
