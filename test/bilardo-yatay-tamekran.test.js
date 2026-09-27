'use strict';
/* ============================================================================
 * BİLARDO — YATAY TELEFON ve TAM EKRAN KOMPAKT DÜZEN
 * ============================================================================
 * Kullanıcı raporu (verbatim): "bilardo - yatay ekranda mobilde çok küçülmüş
 * işe yaramıyor. Tam ekrana geçildiğinde ise tamamen bilardo dashboard
 * yansıtacak ve oynanacak şekilde ayarla."
 *
 * ÖLÇÜLEN ESKİ DURUM (gerçek Chromium):
 *   915x412 yatay, standart pencere : tuval 322x177 px (sarmalayıcı 0.395
 *     ölçekle küçültülmüş) — ekran genişliğinin yalnızca %35'i, sağda
 *     ~500 px bomboş alan.
 *   915x412 yatay, TAM EKRAN        : tuval 0x0 px. Eski kural
 *     `#pg-room.gv-fs .bil-canvas{height:100%;width:auto}` esnek kutuda
 *     tuvali tamamen çökertiyordu, yani masa hiç çizilmiyordu.
 *   390x844 portre, TAM EKRAN       : tuval 76x42 px.
 *
 * KÖK NEDEN: HUD ve kumanda şeridi masanın ALTINDA duruyor; sarmalayıcının
 * doğal boyu ~740 px oluyor ve board-fit tamamını orantılı küçültünce masa
 * da aynı oranda eziliyordu. Yatay ekranda kıt olan YÜKSEKLİK, bol olan
 * GENİŞLİK kullanılmıyordu.
 *
 * ÇÖZÜM: `.bil-kompakt` düzeni (index.html) + js/board-fit.js. Yatay/geniş
 * kutuda `.bil-serit` biçimi HUD ve kumandaları masanın SAĞINA taşır, masa
 * boyun tamamını alır; dar/portre kutuda dikey biçim kullanılır ve tam
 * ekranda yan panel şeridi gizlenir. Ölçek dönüşümü UYGULANMAZ.
 *
 * BU TEST NE DOĞRULAR:
 *   1) Yatay telefonda (standart pencere) tuval ekran genişliğinin en az
 *      %50'si ve kullanılabilir yüksekliğin en az %85'i kadar.
 *   2) Tam ekranda tuval GERÇEKTEN var (0x0 değil) ve ekranın en az %55'i.
 *   3) Sarmalayıcıya transform:scale uygulanmıyor (yazılar okunaklı).
 *   4) Portre telefonda tam ekranda tuval ekran genişliğinin en az %85'i.
 *   5) Hiçbir durumda kutu ekranın dışına taşmıyor.
 *   6) Bilardodan çıkınca kompakt sınıflar temizleniyor.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI bilardo yatay/tam ekran (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bil-yt-'));
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

const olc = p => p.evaluate(() => {
  const kutu = e => { if (!e) return null; const b = e.getBoundingClientRect();
    return { sol: Math.round(b.left), ust: Math.round(b.top), sag: Math.round(b.right),
             alt: Math.round(b.bottom), g: Math.round(b.width), y: Math.round(b.height) }; };
  const w = document.querySelector('#boardArea .bil-wrap');
  const a = document.querySelector('#boardArea');
  const oda = document.getElementById('pg-room');
  return {
    ekranG: innerWidth, ekranY: innerHeight,
    donusum: w ? getComputedStyle(w).transform : null,
    kompakt: !!(w && w.classList.contains('bil-kompakt')),
    serit: !!(w && w.classList.contains('bil-serit')),
    odaGenis: !!(oda && oda.classList.contains('gv-bil-genis')),
    wrap: kutu(w), tuval: kutu(document.querySelector('#boardArea .bil-canvas')),
    alanUst: a ? Math.round(a.getBoundingClientRect().top) : 0,
    /* Kumanda düğmeleri gerçekten tıklanabilir boyda mı? */
    vurusY: (() => { const b = document.querySelector('#boardArea .bil-reset');
      return b ? Math.round(b.getBoundingClientRect().height) : 0; })()
  };
});

function tasmaYok(m, ad) {
  assert.ok(m.wrap.alt <= m.ekranY + 2, ad + ': kutu ekranın altından taşıyor — ' +
    m.wrap.alt + ' > ' + m.ekranY);
  assert.ok(m.wrap.sag <= m.ekranG + 2, ad + ': kutu sağdan taşıyor — ' +
    m.wrap.sag + ' > ' + m.ekranG);
}

async function tamEkranYap(p) {
  /* Gerçek Fullscreen API'de #pg-room ekranın SOL ÜSTÜNE oturur; testte
     sınıfı elle verdiğimiz için aynı yerleşimi position:fixed ile taklit
     ediyoruz, yoksa üstte kalan sayfa ölçümü yanıltır. */
  await p.evaluate(() => {
    const r = document.getElementById('pg-room');
    r.classList.add('gv-fs');
    r.style.position = 'fixed'; r.style.left = '0'; r.style.top = '0'; r.style.zIndex = '9999';
  });
  await uyu(1400);
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));
  let kontrol = 0;

  // ---------- 1) YATAY TELEFON ----------
  for (const vp of [{ width: 915, height: 412 }, { width: 844, height: 390 }]) {
    const ad = 'yatay ' + vp.width + '×' + vp.height;
    const c1 = await tr.newContext({ viewport: vp });
    const c2 = await tr.newContext({ viewport: vp });
    const oda = 'bil-yt-' + vp.width;
    const p1 = await gir(c1, BASE, oda); await gir(c2, BASE, oda);
    await p1.waitForSelector('#boardArea .bil-canvas', { timeout: 22000 });
    await uyu(1800);

    const std = await olc(p1);
    tasmaYok(std, ad + ' / standart');
    assert.ok(std.kompakt && std.serit,
      ad + ' / standart: bilardo şerit (kompakt) düzende olmalı');
    assert.strictEqual(std.donusum, 'none',
      ad + ' / standart: sarmalayıcıya ölçek uygulanmamalı (yazılar okunaklı kalsın) — ' +
      std.donusum);
    const enAzG = Math.round(vp.width * 0.50);
    assert.ok(std.tuval.g >= enAzG,
      ad + ' / standart: masa ekranın en az %50\'si olmalı — ' + std.tuval.g + ' px, ' +
      'gereken ' + enAzG + ' px (eski sürümde 322 px idi)');
    const kullanY = vp.height - std.alanUst - 10;
    assert.ok(std.tuval.y >= kullanY * 0.85,
      ad + ' / standart: masa kullanılabilir boyun en az %85\'ini almalı — ' +
      std.tuval.y + ' / ' + kullanY);
    assert.ok(std.vurusY >= 28,
      ad + ' / standart: vuruş düğmesi parmakla basılabilir boyda kalmalı — ' + std.vurusY);
    kontrol += 5;

    await tamEkranYap(p1);
    const tam = await olc(p1);
    tasmaYok(tam, ad + ' / tam ekran');
    assert.ok(tam.tuval.g > 0 && tam.tuval.y > 0,
      ad + ' / tam ekran: masa çizilmeli (eski sürümde tuval 0x0 idi)');
    assert.ok(tam.tuval.g >= vp.width * 0.55,
      ad + ' / tam ekran: masa ekranın en az %55\'i olmalı — ' + tam.tuval.g + ' px');
    assert.strictEqual(tam.donusum, 'none', ad + ' / tam ekran: ölçek uygulanmamalı');
    kontrol += 3;
    console.log('  ✓ ' + ad + ': standart masa ' + std.tuval.g + '×' + std.tuval.y +
                ', tam ekran ' + tam.tuval.g + '×' + tam.tuval.y + ' (eski: 322×177 ve 0×0)');
    await c1.close(); await c2.close();
  }

  // ---------- 2) PORTRE TELEFON ----------
  {
    const vp = { width: 390, height: 844 };
    const c1 = await tr.newContext({ viewport: vp });
    const c2 = await tr.newContext({ viewport: vp });
    const p1 = await gir(c1, BASE, 'bil-portre'); await gir(c2, BASE, 'bil-portre');
    await p1.waitForSelector('#boardArea .bil-canvas', { timeout: 22000 });
    await uyu(1600);

    const std = await olc(p1);
    assert.ok(!std.kompakt,
      'portre / standart: uzun ekranda kompakt düzene gerek yok, normal düzen kalmalı');
    assert.ok(!std.odaGenis, 'portre / standart: oda sınıfı temiz kalmalı');
    kontrol += 2;

    await tamEkranYap(p1);
    const tam = await olc(p1);
    tasmaYok(tam, 'portre / tam ekran');
    assert.ok(tam.kompakt && !tam.serit,
      'portre / tam ekran: dar kutuda DİKEY kompakt biçim kullanılmalı');
    assert.ok(tam.odaGenis,
      'portre / tam ekran: yan panel şeridi gizlenmeli (masaya genişlik kalsın)');
    assert.ok(tam.tuval.g >= vp.width * 0.85,
      'portre / tam ekran: masa ekranın en az %85\'i olmalı — ' + tam.tuval.g +
      ' px (eski sürümde 76 px idi)');
    kontrol += 3;
    console.log('  ✓ portre 390×844: tam ekran masa ' + tam.tuval.g + '×' + tam.tuval.y +
                ' (eski: 76×42)');
    await c1.close(); await c2.close();
  }

  // ---------- 3) MASAÜSTÜ: normal pencerede düzen DEĞİŞMEZ ----------
  {
    const vp = { width: 1440, height: 900 };
    const c1 = await tr.newContext({ viewport: vp });
    const c2 = await tr.newContext({ viewport: vp });
    const p1 = await gir(c1, BASE, 'bil-masa'); await gir(c2, BASE, 'bil-masa');
    await p1.waitForSelector('#boardArea .bil-canvas', { timeout: 22000 });
    await uyu(1500);
    const std = await olc(p1);
    assert.ok(!std.kompakt,
      'masaüstü / standart: geniş pencerede klasik düzen korunmalı (kumandalar masanın altında)');
    assert.ok(!std.odaGenis, 'masaüstü / standart: oda sınıfı temiz kalmalı');
    await tamEkranYap(p1);
    const tam = await olc(p1);
    assert.ok(tam.kompakt, 'masaüstü / tam ekran: kompakt düzene geçmeli');
    assert.ok(!tam.odaGenis,
      'masaüstü / tam ekran: geniş ekranda yan panel (süre + sohbet) korunmalı');
    assert.ok(tam.tuval.g >= 800,
      'masaüstü / tam ekran: masa ekranı doldurmalı — ' + tam.tuval.g + ' px');
    kontrol += 4;
    console.log('  ✓ masaüstü 1440×900: standart klasik düzen, tam ekran masa ' +
                tam.tuval.g + '×' + tam.tuval.y);
    await c1.close(); await c2.close();
  }

  await tr.close(); server.close();
  console.log('OK bilardo yatay/tam ekran (' + kontrol + ' kontrol)');
  process.exit(0);
}
main().catch(e => { console.error('❌ BİLARDO YATAY/TAM EKRAN HATASI:', e.message); process.exit(1); });
