'use strict';
/* ============================================================================
 * BİLARDO — DOKUNMATİKTE SADECE NİŞAN, WEB'DE "F" İLE NİŞAN KİLİDİ
 * ============================================================================
 * Kullanıcı raporu (verbatim):
 *  1) "Mobilde bilardo oyununda, dokunmatik ekranda ıstaka tutuluyor ama yön
 *     değiştirilmiyor, dokunmatik ekranda sadece ıstaka vuruş yönü
 *     ayarlanabilsin, çekme ve bırakma vurmayı sağlamasın. Mobilde elle oyun
 *     alanında yönünü ayarlar sonra aşağıdaki vuruş gücü, ıstaka açısı, falso
 *     yönlerini ayarlar ve vuruş yap der."
 *  2) "Webde, mouse imleciyle ıstaka yönünü ayarlarken, aşağıdaki ayarları
 *     yapmaya çalışırken yön kayıyor... F tuşuna bastığında fare imlecin en
 *     son duran hizada kilitlensin, tekrar F basarsa açılır."
 *
 * ESKİ DAVRANIŞ: tuval üzerindeki pointerdown → pointermove → pointerup
 * dizisi HER aygıtta "geriye çek ve bırak = vuruş" anlamına geliyordu.
 * Telefonda parmakla yön ayarlamaya çalışmak kaçınılmaz olarak vuruş
 * gönderiyordu; ayrıca fare tuvalin üzerinden her geçtiğinde nişan
 * değiştiği için kumandalara giderken yön kayıyordu.
 *
 * BU TEST NE DOĞRULAR (gerçek Chromium — jsdom işaretçi akışı yürütmüyor):
 *   A) Dokunmatik: parmakla sürüklemek nişanı DEĞİŞTİRİR.
 *   B) Dokunmatik: parmağı kaldırmak vuruş GÖNDERMEZ, güç de değişmez.
 *   C) Dokunmatik: vuruş yalnız "Vuruşu Yap" düğmesiyle gider.
 *   D) Fare: eski "çek ve bırak = vuruş" akışı korunuyor.
 *   E) Fare: F tuşu nişanı kilitler — imleç masada gezse bile açı sabit.
 *   F) Fare: ikinci F kilidi açar, yön yeniden değişir.
 *   G) Sohbet kutusuna "f" yazarken kilit tetiklenmez.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI bilardo nişan kontrolü (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bil-nisan-'));
const assert = require('assert');
const serverModule = require('../server.js');
const uyu = ms => new Promise(r => setTimeout(r, ms));

async function gir(ctx, BASE, oda) {
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html');
  await p.waitForFunction(
    () => window.GV && window.st && typeof window.__gvStartRealRoomWaiting === 'function',
    null, { timeout: 30000 });
  await p.evaluate(o => { window.st.curGame = 'bilardo'; window.GV.joinRoom(o); }, oda);
  await p.waitForSelector('#gv-real-chess-wait .gv-ready', { timeout: 20000 });
  for (let i = 0; i < 12; i++) {
    const oldu = await p.evaluate(() => {
      const b = document.querySelector('#gv-real-chess-wait .gv-ready');
      if (!b) return false; b.click(); return true;
    });
    if (oldu) break;
    await uyu(250);
  }
  return p;
}

/* Gönderilen vuruş paketlerini say: emit'i sarmalıyoruz. */
const kancaTak = p => p.evaluate(() => {
  window.__gvVurus = [];
  const s = window.__gvRoomSocket || window.__gvSocket || window.__gvLobbySocket;
  if (!s || !s.emit) return false;
  const asil = s.emit.bind(s);
  s.emit = function (ad) {
    if (ad === 'bilardoShoot') window.__gvVurus.push(arguments[1]);
    return asil.apply(this, arguments);
  };
  return true;
});

/* Sıra bende olan pencereyi bul (ıstaka yalnız sıradaki oyuncuda oynanır). */
async function siradakiBul(sayfalar) {
  for (const p of sayfalar) {
    const benim = await p.evaluate(() => {
      const b = document.querySelector('#bilOnlineShoot');
      return !!(b && !b.disabled);
    });
    if (benim) return p;
  }
  return null;
}

/* Nişan açısı adaptörün teşhis kancasından okunur: tahta her sunucu
   durumunda yeniden çizildiği için tuvale kanca takmak güvenilmez. */
const aci = p => p.evaluate(() => (window.__gvBilDurum || {}).aim);

async function fareIle(p, x, y) {
  const kutu = await p.evaluate(() => {
    const b = document.getElementById('bilOnlineCanvas').getBoundingClientRect();
    return { x: b.left, y: b.top, g: b.width, y2: b.height };
  });
  await p.mouse.move(kutu.x + x * kutu.g, kutu.y + y * kutu.y2);
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));
  let kontrol = 0;

  // ================= A/B/C) DOKUNMATİK =================
  {
    const vp = { width: 390, height: 844 };
    const c1 = await tr.newContext({ viewport: vp, hasTouch: true, isMobile: true });
    const c2 = await tr.newContext({ viewport: vp, hasTouch: true, isMobile: true });
    const p1 = await gir(c1, BASE, 'bil-dokun');
    const p2 = await gir(c2, BASE, 'bil-dokun');
    for (const p of [p1, p2]) await p.waitForSelector('#bilOnlineCanvas', { timeout: 22000 });
    await uyu(1400);
    const p = await siradakiBul([p1, p2]);
    assert.ok(p, 'dokunmatik: sırası olan pencere bulunmalı');
    await kancaTak(p);

    const kutu = await p.evaluate(() => {
      const b = document.getElementById('bilOnlineCanvas').getBoundingClientRect();
      return { x: b.left, y: b.top, g: b.width, h: b.height };
    });
    // Parmakla masanın SAĞ ÜST köşesine doğru sürükle
    await p.touchscreen.tap(kutu.x + kutu.g * 0.30, kutu.y + kutu.h * 0.50);
    await uyu(120);
    const aci1 = await aci(p);

    /* Playwright'ın touchscreen'i tek tap gönderir; sürüklemeyi gerçek
       pointer olaylarıyla yapıyoruz (pointerType: 'touch'). */
    await p.evaluate(k => {
      const cv = document.getElementById('bilOnlineCanvas');
      const b = cv.getBoundingClientRect();
      const olay = (tur, fx, fy) => cv.dispatchEvent(new PointerEvent(tur, {
        pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true,
        clientX: b.left + b.width * fx, clientY: b.top + b.height * fy
      }));
      olay('pointerdown', 0.30, 0.50);
      olay('pointermove', 0.75, 0.12);
      olay('pointerup', 0.75, 0.12);
    });
    await uyu(150);
    const aci2 = await aci(p);
    assert.ok(aci2 !== null && aci1 !== null, 'dokunmatik: nişan açısı okunabilmeli');
    assert.notStrictEqual(Number(aci2).toFixed(4), Number(aci1).toFixed(4),
      'A) dokunmatik: parmakla sürüklemek nişan açısını değiştirmeli — ' +
      aci1 + ' → ' + aci2);
    kontrol += 1;

    const gonderim = await p.evaluate(() => window.__gvVurus.length);
    assert.strictEqual(gonderim, 0,
      'B) dokunmatik: parmağı kaldırmak vuruş GÖNDERMEMELİ — ' + gonderim + ' paket gitti');
    const guc = await p.evaluate(() => Number(document.getElementById('bilPower').value));
    assert.strictEqual(guc, 55,
      'B) dokunmatik: çekme hareketi vuruş gücünü değiştirmemeli — güç ' + guc);
    kontrol += 2;

    await p.evaluate(() => document.getElementById('bilOnlineShoot').click());
    await uyu(250);
    const gonderim2 = await p.evaluate(() => window.__gvVurus.length);
    assert.strictEqual(gonderim2, 1,
      'C) dokunmatik: vuruş yalnız "Vuruşu Yap" ile gitmeli — ' + gonderim2);
    const paket = await p.evaluate(() => window.__gvVurus[0]);
    assert.ok(Math.abs(Number(paket.angle) - Number(aci2)) < 0.02,
      'C) gönderilen açı parmakla ayarlanan açı olmalı — paket ' + paket.angle + ', ekran ' + aci2);
    kontrol += 2;
    console.log('  ✓ A/B/C) dokunmatik: parmak yalnız nişan alıyor (' +
                Number(aci1).toFixed(3) + ' → ' + Number(aci2).toFixed(3) +
                ' rad), bırakınca vuruş gitmiyor, vuruş düğmeyle ve aynı açıyla gidiyor');
    await c1.close(); await c2.close();
  }

  // ================= D/E/F/G) FARE + "F" KİLİDİ =================
  {
    const vp = { width: 1440, height: 900 };
    const c1 = await tr.newContext({ viewport: vp });
    const c2 = await tr.newContext({ viewport: vp });
    const p1 = await gir(c1, BASE, 'bil-fare');
    const p2 = await gir(c2, BASE, 'bil-fare');
    for (const p of [p1, p2]) await p.waitForSelector('#bilOnlineCanvas', { timeout: 22000 });
    await uyu(1400);
    const p = await siradakiBul([p1, p2]);
    assert.ok(p, 'fare: sırası olan pencere bulunmalı');
    await kancaTak(p);

    // ---- E) F ile kilit ----
    await fareIle(p, 0.30, 0.50);
    await uyu(120);
    const serbest1 = await aci(p);
    await fareIle(p, 0.75, 0.15);
    await uyu(120);
    const serbest2 = await aci(p);
    assert.notStrictEqual(Number(serbest2).toFixed(4), Number(serbest1).toFixed(4),
      'fare: kilit yokken imleç hareketi nişanı değiştirmeli');
    kontrol += 1;

    await p.keyboard.press('f');
    await uyu(180);
    const kilitliMi = await p.evaluate(() => {
      const b = document.getElementById('bilAimLock');
      return b ? b.getAttribute('aria-pressed') : null;
    });
    assert.strictEqual(kilitliMi, 'true', 'E) F tuşu nişan kilidini açmalı (gösterge)');
    const kilitliAci = await aci(p);
    await fareIle(p, 0.20, 0.85);
    await uyu(150);
    await fareIle(p, 0.60, 0.20);
    await uyu(150);
    const kilitliAci2 = await aci(p);
    assert.strictEqual(Number(kilitliAci2).toFixed(4), Number(kilitliAci).toFixed(4),
      'E) kilitliyken imleç masada gezse bile nişan açısı SABİT kalmalı — ' +
      kilitliAci + ' → ' + kilitliAci2);
    kontrol += 2;

    // ---- F) ikinci F serbest bırakır ----
    await p.keyboard.press('f');
    await uyu(180);
    const acikMi = await p.evaluate(() => {
      const b = document.getElementById('bilAimLock');
      return b ? b.getAttribute('aria-pressed') : null;
    });
    assert.strictEqual(acikMi, 'false', 'F) ikinci F kilidi açmalı');
    await fareIle(p, 0.85, 0.80);
    await uyu(150);
    const yeniAci = await aci(p);
    assert.notStrictEqual(Number(yeniAci).toFixed(4), Number(kilitliAci).toFixed(4),
      'F) kilit açılınca nişan yeniden değişebilmeli');
    kontrol += 2;

    // ---- G) sohbete "f" yazmak kilidi tetiklememeli ----
    const oncekiDurum = await p.evaluate(() =>
      document.getElementById('bilAimLock').getAttribute('aria-pressed'));
    await p.evaluate(() => {
      const i = document.querySelector('.chat-input input, .chat-input textarea');
      if (i) i.focus();
    });
    await p.keyboard.press('f');
    await uyu(180);
    const sonraDurum = await p.evaluate(() =>
      document.getElementById('bilAimLock').getAttribute('aria-pressed'));
    assert.strictEqual(sonraDurum, oncekiDurum,
      'G) sohbet kutusuna yazarken F nişan kilidini tetiklememeli');
    kontrol += 1;
    await p.evaluate(() => document.activeElement && document.activeElement.blur());

    // ---- D) fare ile çek-bırak hâlâ vuruyor ----
    const kutu = await p.evaluate(() => {
      const b = document.getElementById('bilOnlineCanvas').getBoundingClientRect();
      return { x: b.left, y: b.top, g: b.width, h: b.height };
    });
    await p.mouse.move(kutu.x + kutu.g * 0.28, kutu.y + kutu.h * 0.5);
    await p.mouse.down();
    await p.mouse.move(kutu.x + kutu.g * 0.10, kutu.y + kutu.h * 0.5, { steps: 6 });
    await p.mouse.up();
    await uyu(300);
    const gonderim = await p.evaluate(() => window.__gvVurus.length);
    assert.strictEqual(gonderim, 1,
      'D) fare ile çekip bırakmak vuruşu göndermeli (eski davranış korunmalı) — ' + gonderim);
    kontrol += 1;
    console.log('  ✓ D/E/F/G) fare: çek-bırak hâlâ vuruyor; F kilidi nişanı sabitliyor, ' +
                'ikinci F açıyor, sohbete yazarken tetiklenmiyor');
    await c1.close(); await c2.close();
  }

  await tr.close(); server.close();
  console.log('OK bilardo nişan kontrolü (' + kontrol + ' kontrol)');
  process.exit(0);
}
main().catch(e => { console.error('❌ BİLARDO NİŞAN HATASI:', e.message); process.exit(1); });
