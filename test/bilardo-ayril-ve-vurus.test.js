'use strict';
/* ============================================================================
 * BİLARDO — TAM EKRANDA "AYRIL" ve MOBİLDE "VURUŞU YAP"
 * ============================================================================
 * Kullanıcı raporu (verbatim):
 *  1) "Bilardo webde ve mobilde Odadan ayrıl dedikten sonra (tam ekranda)
 *     bekleme yapıyor, direkt lobiye yönlendirmiyor."
 *  2) "Bilardo Mobilde vuruş gücü yatay skala değeri tam sıfır değerine
 *     çektiğimizde ibre de sıfırda gözüksün 100'e çekince 100'de gözüksün
 *     hafif kayma var. Ek olarak Vuruş yap dediğimde hiçbir işlem yapmıyor
 *     mobilde, çalışmıyor."
 *
 * ÖLÇÜLEN KÖK NEDENLER (gerçek Chromium):
 *  1) Gezinme aslında ÇALIŞIYORDU: oyuncu ayrılınca pg-lobby 'active'
 *     oluyor. Ama Fullscreen API tam ekranda YALNIZ #pg-room'un alt ağacını
 *     çizer; kimse tam ekrandan çıkmadığı için oyuncu boşalmış masayı
 *     görmeye devam ediyordu.
 *  2) 915x412 yatayda "Vuruşu Yap" düğmesinin çizim kutusu y 388..422
 *     görünüyordu ama şeridin (.bil-controls, overflow-y:auto) kırpma sınırı
 *     402'de bitiyordu: düğmenin MERKEZİNDE
 *     document.elementFromPoint "game-layout" döndürüyordu, yani parmak
 *     düğmeye hiç değmiyordu. Şerit içeriği (≈170 px) ayrılan 147 px'e
 *     sığmıyordu.
 *  3) Kaydırıcıda tarayıcının kendi çizimi kullanılıyordu; ibrenin merkezi
 *     uçlarda ibre yarıçapı kadar içeride kalıyor ve dolgu ibreyle
 *     hizalanmıyordu.
 *
 * BU TEST NE DOĞRULAR:
 *   A) Yatay telefonda "Vuruşu Yap" düğmesinin merkezi GERÇEKTEN düğmeye ait
 *      (kırpılmıyor) ve parmakla dokunmak vuruş paketi gönderiyor.
 *   B) Portre telefonda da aynısı çalışıyor.
 *   C) Güç kaydırıcısı 0–100 aralığında ve uç değerlerde hizalama oranı
 *      (--gv-oran) tam 0 ve tam 1 — yani ibre rayın uçlarına oturuyor.
 *   D) Tam ekrandayken odadan ayrılınca tam ekrandan ÇIKILIYOR, gv-fs sınıfı
 *      kalkıyor ve lobi sayfası açılıyor.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI bilardo ayrıl/vuruş (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bil-ayril-'));
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

const kancaTak = p => p.evaluate(() => {
  window.__gvVurus = 0;
  const s = window.__gvRoomSocket;
  if (!s || !s.emit) return false;
  const asil = s.emit.bind(s);
  s.emit = function (ad) { if (ad === 'bilardoShoot') window.__gvVurus++; return asil.apply(this, arguments); };
  return true;
});

async function siradakiBul(sayfalar) {
  for (const p of sayfalar) {
    if (await p.evaluate(() => {
      const b = document.querySelector('#bilOnlineShoot');
      return !!(b && !b.disabled);
    })) return p;
  }
  return null;
}

const dugmeBilgisi = p => p.evaluate(() => {
  const b = document.getElementById('bilOnlineShoot');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const ust = document.elementFromPoint(cx, cy);
  return {
    kutu: { x: Math.round(r.left), y: Math.round(r.top), g: Math.round(r.width), h: Math.round(r.height) },
    merkez: [Math.round(cx), Math.round(cy)],
    ustEleman: ust ? (ust.id || ust.className || ust.tagName) : null,
    dugmeMi: ust === b || (!!ust && b.contains(ust)),
    ekran: [innerWidth, innerHeight]
  };
});

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));
  let kontrol = 0;

  // ---------- A / B / C : MOBİLDE VURUŞ + KAYDIRICI ----------
  for (const [ad, vp] of [['yatay 915×412', { width: 915, height: 412 }],
                          ['portre 390×844', { width: 390, height: 844 }]]) {
    const c1 = await tr.newContext({ viewport: vp, hasTouch: true, isMobile: true });
    const c2 = await tr.newContext({ viewport: vp, hasTouch: true, isMobile: true });
    const oda = 'bil-vur-' + vp.width;
    const p1 = await gir(c1, BASE, oda); const p2 = await gir(c2, BASE, oda);
    for (const q of [p1, p2]) await q.waitForSelector('#bilOnlineCanvas', { timeout: 22000 });
    await uyu(1700);
    const p = await siradakiBul([p1, p2]);
    assert.ok(p, ad + ': sırası olan pencere bulunmalı');
    await kancaTak(p);

    const d = await dugmeBilgisi(p);
    assert.ok(d, ad + ': "Vuruşu Yap" düğmesi bulunmalı');
    assert.ok(d.merkez[1] > 0 && d.merkez[1] < vp.height,
      ad + ': düğme merkezi ekranın içinde olmalı — y ' + d.merkez[1] + ' / ' + vp.height);
    assert.ok(d.dugmeMi,
      ad + ': düğmenin MERKEZİNE dokunan parmak düğmeye değmeli (kırpılmamalı) — ' +
      'o noktada bulunan: ' + d.ustEleman);
    kontrol += 2;

    await p.touchscreen.tap(d.merkez[0], d.merkez[1]);
    await uyu(400);
    const gitti = await p.evaluate(() => window.__gvVurus);
    assert.strictEqual(gitti, 1,
      ad + ': parmakla "Vuruşu Yap"a dokunmak vuruş göndermeli — ' + gitti + ' paket');
    kontrol += 1;

    // ---- kaydırıcı uçları ----
    const uclar = await p.evaluate(async () => {
      const el = document.getElementById('bilPower');
      const oku = () => ({
        deger: Number(el.value),
        oran: Number(getComputedStyle(el).getPropertyValue('--gv-oran'))
      });
      const ayarla = v => new Promise(r => {
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => r(oku()), 60);
      });
      return {
        min: Number(el.min), max: Number(el.max),
        sifir: await ayarla(0), orta: await ayarla(50), yuz: await ayarla(100)
      };
    });
    assert.strictEqual(uclar.min, 0, ad + ': güç kaydırıcısı 0\'dan başlamalı');
    assert.strictEqual(uclar.max, 100, ad + ': güç kaydırıcısı 100\'de bitmeli');
    assert.strictEqual(uclar.sifir.oran, 0,
      ad + ': 0\'a çekilince hizalama oranı tam 0 olmalı (ibre rayın başında) — ' +
      uclar.sifir.oran);
    assert.strictEqual(uclar.yuz.oran, 1,
      ad + ': 100\'e çekilince hizalama oranı tam 1 olmalı (ibre rayın sonunda) — ' +
      uclar.yuz.oran);
    assert.strictEqual(uclar.orta.oran, 0.5, ad + ': ortada oran 0.5 olmalı');
    kontrol += 5;
    console.log('  ✓ ' + ad + ': düğme merkezi gerçekten düğme (' + d.kutu.g + '×' + d.kutu.h +
                '), dokunuş vuruş gönderiyor; kaydırıcı 0→0.0, 50→0.5, 100→1.0');
    await c1.close(); await c2.close();
  }

  // ---------- D : TAM EKRANDA AYRILMA ----------
  {
    const vp = { width: 1280, height: 800 };
    const c1 = await tr.newContext({ viewport: vp });
    const c2 = await tr.newContext({ viewport: vp });
    const p1 = await gir(c1, BASE, 'bil-ayril'); const p2 = await gir(c2, BASE, 'bil-ayril');
    for (const q of [p1, p2]) await q.waitForSelector('#bilOnlineCanvas', { timeout: 22000 });
    await uyu(1500);

    /* Gerçek Fullscreen API bu ortamda izin verilmiyor ("not granted"),
       bu yüzden tam ekran DURUMU taklit ediliyor: document.fullscreenElement
       #pg-room'u gösteriyor ve exitFullscreen çağrısı sayılıyor. Test edilen
       şey zaten bizim kodumuzun bu durumda ÇIKIŞ çağırıp çağırmadığı. */
    await p1.evaluate(() => {
      const oda = document.getElementById('pg-room');
      oda.classList.add('gv-fs');
      window.__cikisSayisi = 0;
      Object.defineProperty(document, 'fullscreenElement',
        { configurable: true, get: () => (window.__cikisSayisi ? null : oda) });
      document.exitFullscreen = function () { window.__cikisSayisi++; return Promise.resolve(); };
    });
    await uyu(200);

    await p1.evaluate(() => {
      window.confirm = () => true;               // onay penceresini geç
      if (typeof window.__gvRealChessLeave === 'function') window.__gvRealChessLeave();
    });
    await uyu(900);

    const sonuc = await p1.evaluate(() => ({
      cikis: window.__cikisSayisi,
      fsSinifi: document.getElementById('pg-room').classList.contains('gv-fs'),
      lobiAktif: !!document.querySelector('#pg-lobby.active'),
      odaAktif: !!document.querySelector('#pg-room.active'),
      sayfa: window.st && window.st.curPage
    }));
    assert.ok(sonuc.cikis >= 1,
      'D) odadan ayrılınca tam ekrandan ÇIKILMALI — exitFullscreen çağrısı: ' + sonuc.cikis);
    assert.strictEqual(sonuc.fsSinifi, false,
      'D) gv-fs sınıfı kaldırılmalı (oda boş bir tam ekran olarak kalmasın)');
    assert.ok(sonuc.lobiAktif && !sonuc.odaAktif,
      'D) lobi sayfası açılmalı — curPage: ' + sonuc.sayfa);
    kontrol += 3;
    console.log('  ✓ D) tam ekranda ayrılınca tam ekrandan çıkılıyor ve lobi açılıyor (curPage: ' +
                sonuc.sayfa + ')');
    await c1.close(); await c2.close();
  }

  await tr.close(); server.close();
  console.log('OK bilardo ayrıl/vuruş (' + kontrol + ' kontrol)');
  process.exit(0);
}
main().catch(e => { console.error('❌ BİLARDO AYRIL/VURUŞ HATASI:', e.message); process.exit(1); });
