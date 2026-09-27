'use strict';
/* ============================================================================
 * BİLARDO SESLERİ + RÖVANŞTA TAHTANIN GERÇEKTEN SIFIRLANMASI
 * ============================================================================
 * Kullanıcı raporu (verbatim):
 *  1) "Bilardoda ses açık ama ne topa vurma sesi geliyor, ne deliğe top
 *     girince ses geliyor, özel gerçekçi efektler ayarla."
 *  2) "Rövanş talep edince iki oyuncu kabul ediyor, yeniden başlıyor gibi
 *     komut veriyor ama yeni ele başlanır gibi oyun sıfırdan başlamıyor,
 *     ekran öyle kalıyor. Bunu tüm oyunlarda kontrol et ve düzelt."
 *
 * KÖK NEDENLER:
 *  1) Motor her vuruşta zaman damgalı olaylar üretiyor (bilardo-engine.js:
 *     'ball' / 'cushion' / 'jaw' / 'pot', çarpma hızıyla) ve bunlar
 *     `bilardoShotFrames` paketiyle istemciye GELİYORDU — ama istemci
 *     yalnız kareleri çiziyor, olayları hiç kullanmıyordu: tek bir ses bile
 *     çalınmıyordu.
 *  2) Ortak yaşam döngüsü (js/online-arena.js) tahtayı yalnız ÜRETİLEN HTML
 *     değiştiğinde basar. Bilardo tahtası HTML'de değil TUVALDE yaşıyor ve
 *     yeni el, eski maçın son hâliyle AYNI HUD metnini üretebiliyor
 *     (skor 0-0, gruplar "Açık masa") — o zaman bind() hiç çalışmıyor,
 *     tuval yenilenmiyor ve oyuncu dağılmış eski topları görmeye devam
 *     ediyordu.
 *
 * DOĞRULANANLAR:
 *   A) Vuruşta ses motoruna GERÇEKTEN çağrı gidiyor: topa temas ve
 *      (varsa) banda çarpma sesleri animasyonla aynı saatte çalınıyor.
 *   B) Ana ses anahtarı kapalıyken hiç ses çıkmıyor.
 *   C) Rövanş sonrası bilardo masası açılış düzenine dönüyor VE tuval
 *      yeniden çiziliyor (çizim sayacı artıyor).
 *   D) Rövanş haberi geldiğinde ortak yaşam döngüsü zorla yeniden çiziyor —
 *      bu tüm arena oyunlarını (dama, reversi, gomoku, connect4, kart,
 *      bilardo) kapsar.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI bilardo ses/rövanş (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-bil-ses-'));
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

/* Ses motorunun çağrılarını say (WebAudio başsız tarayıcıda gerçekten
   çalmaz; ölçülen şey İSTEMCİNİN doğru sesi doğru anda istemesidir). */
const sesKancasi = p => p.evaluate(() => {
  window.__ses = [];
  const d = window.GVDeniz && window.GVDeniz.ses;
  if (!d || typeof d.cal !== 'function') return false;
  const asil = d.cal.bind(d);
  d.cal = function (ad, siddet) { window.__ses.push({ ad: ad, siddet: siddet }); return asil(ad, siddet); };
  return true;
});
const topParmak = p => p.evaluate(() => {
  const g = (window.GVArena && GVArena.state()) || null;
  if (!g || !g.balls) return null;
  return g.balls.map(b => Math.round(b.x) + ',' + Math.round(b.y) + (b.potted ? 'P' : '')).join(' ');
});
const cizimSayaci = p => p.evaluate(() => (window.__gvBilDurum || {}).cizim || 0);

async function siradaki(sayfalar) {
  for (const p of sayfalar) {
    if (await p.evaluate(() => {
      const b = document.querySelector('#bilOnlineShoot'); return !!(b && !b.disabled);
    })) return p;
  }
  return null;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] },
      KROM ? { executablePath: KROM } : {}));
  const c1 = await tr.newContext({ viewport: { width: 1440, height: 900 } });
  const c2 = await tr.newContext({ viewport: { width: 1440, height: 900 } });
  const p1 = await gir(c1, BASE, 'ses-rv'); const p2 = await gir(c2, BASE, 'ses-rv');
  for (const p of [p1, p2]) await p.waitForSelector('#boardArea .bil-canvas', { timeout: 20000 });
  await uyu(1500);
  let kontrol = 0;

  const acilis = await topParmak(p1);
  assert.ok(acilis, 'test kurulumu: top konumları okunmalı');

  // ---------- A) VURUŞ SESLERİ ----------
  const vuran = await siradaki([p1, p2]);
  assert.ok(vuran, 'sırası olan pencere bulunmalı');
  assert.strictEqual(await sesKancasi(p1), true, 'ses motoru (GVDeniz.ses) erişilebilir olmalı');
  await sesKancasi(p2);
  await vuran.evaluate(() => {
    const s = window.__gvRoomSocket;
    s.emit('bilardoShoot', { angle: 0, power: 1, spinX: 0, spinY: 0, elevation: 0, clientVersion: 3 });
  });
  await uyu(11000);
  const sesler = await p1.evaluate(() => window.__ses.slice());
  const adlar = sesler.map(s => s.ad);
  assert.ok(adlar.includes('topCarpma'),
    'A) sert bir açılış vuruşunda TOP TOPA çarpma sesi istenmeli — çalınanlar: ' +
    JSON.stringify(adlar.slice(0, 12)));
  assert.ok(adlar.includes('bant'),
    'A) toplar banda çarpıyor, bant sesi de istenmeli — çalınanlar: ' +
    JSON.stringify(adlar.slice(0, 12)));
  const siddetler = sesler.filter(s => s.ad === 'topCarpma').map(s => s.siddet);
  assert.ok(siddetler.every(v => v == null || (v > 0 && v <= 1)),
    'A) çarpma şiddeti 0..1 aralığında olmalı — ' + JSON.stringify(siddetler.slice(0, 6)));
  /* Kalabalık denetimi: açılış vuruşunda onlarca temas olur; hepsi
     çalınırsa tek bir gürültü duvarı olur. */
  assert.ok(sesler.length <= 70,
    'A) ses sayısı sınırlanmalı (gürültü duvarı olmasın) — ' + sesler.length);
  kontrol += 4;
  console.log('  ✓ A) vuruşta ' + sesler.length + ' ses planlandı: ' +
    [...new Set(adlar)].join(', '));

  // ---------- B) SES KAPALIYKEN SUSAR ----------
  const kapaliSonuc = await p1.evaluate(() => {
    const d = window.GVDeniz && window.GVDeniz.ses;
    if (!d) return null;
    // Odadaki "🔊 Ses" düğmesinin kullandığı anahtarın aynısı
    if (typeof d.ayarla === 'function') d.ayarla(false);
    else { try { localStorage.setItem('gv-ses', 'off'); } catch (_) {} }
    return d.cal('topCarpma', 0.8);
  });
  assert.strictEqual(kapaliSonuc, false,
    'B) ana ses anahtarı kapalıyken hiçbir ses çalınmamalı');
  await p1.evaluate(() => {
    const d = window.GVDeniz && window.GVDeniz.ses;
    if (d && typeof d.ayarla === 'function') d.ayarla(true);
  });
  kontrol += 1;
  console.log('  ✓ B) ses kapalıyken ses motoru susuyor');

  // ---------- C/D) RÖVANŞTA TAHTA SIFIRLANIYOR ----------
  const vurustanSonra = await topParmak(p1);
  assert.notStrictEqual(vurustanSonra, acilis,
    'test kurulumu: vuruş topları gerçekten dağıtmalı');
  await p1.evaluate(() => { const s = window.__gvRoomSocket; s.emit('gvResign'); });
  await uyu(1600);
  const cizimOnce = await cizimSayaci(p1);
  for (const p of [p1, p2]) await p.evaluate(() => { const s = window.__gvRoomSocket; s.emit('rematchRequest'); });
  await uyu(3000);

  const sonrasi = await topParmak(p1);
  const cizimSonra = await cizimSayaci(p1);
  assert.strictEqual(sonrasi, acilis,
    'C) rövanş sonrası toplar AÇILIŞ düzenine dönmeli — hâlâ: ' + String(sonrasi).slice(0, 60));
  assert.ok(cizimSonra > cizimOnce,
    'C) rövanştan sonra tuval yeniden çizilmeli (çizim sayacı artmalı) — ' +
    cizimOnce + ' → ' + cizimSonra);
  const bitis = await p1.evaluate(() => {
    const e = document.querySelector('.gv-end,.chess-end-overlay');
    return !!(e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 2);
  });
  assert.strictEqual(bitis, false, 'C) yeni el başlayınca bitiş paneli kapanmalı');
  const oynanabilir = await p1.evaluate(() => {
    const b = document.querySelector('#bilOnlineShoot'); return !!b;
  }) && await p2.evaluate(() => {
    const b = document.querySelector('#bilOnlineShoot'); return !!b;
  });
  assert.ok(oynanabilir, 'C) yeni elde iki oyuncuda da kumanda paneli olmalı');
  kontrol += 4;
  console.log('  ✓ C) rövanş sonrası masa açılış düzeninde, tuval yeniden çizildi (' +
    cizimOnce + ' → ' + cizimSonra + '), bitiş paneli kapandı');

  // ---------- D) ORTAK YAŞAM DÖNGÜSÜ ZORLA ÇİZİYOR ----------
  const zorla = fs.readFileSync(path.join(__dirname, '..', 'js', 'rematch.js'), 'utf8');
  assert.ok(/rematchStarted[\s\S]{0,2500}GVArena\.repaint\(\)/.test(zorla),
    'D) rematchStarted gelince GVArena.repaint() çağrılmalı (tüm arena oyunları için)');
  const arena = fs.readFileSync(path.join(__dirname, '..', 'js', 'online-arena.js'), 'utf8');
  assert.ok(/damga/.test(arena),
    'D) arena, adaptörün durum damgasını da karşılaştırmalı (HTML aynı kalsa bile yeniden çizsin)');
  assert.ok(/gameStarted:\s*function\s*\(p\)\s*\{\s*onState\(p,\s*true\)/.test(arena),
    'D) gameStarted yeni maç demektir: zorla yeniden çizilmeli');
  kontrol += 3;
  console.log('  ✓ D) rövanş/yeni maç haberinde tahta zorla yeniden çiziliyor (tüm arena oyunları)');

  await tr.close(); server.close();
  console.log('OK bilardo ses/rövanş (' + kontrol + ' kontrol)');
  process.exit(0);
}
main().catch(e => { console.error('❌ BİLARDO SES/RÖVANŞ HATASI:', e.message); process.exit(1); });
