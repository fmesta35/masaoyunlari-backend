'use strict';

/*
 * MOBİL UYGULAMA (PWA / Android TWA) HAZIRLIĞI
 *
 *  Site, Google Play'e yüklenecek Android uygulamasının (Trusted Web
 *  Activity) içinden de çalışacak. Bu testin koruduğu şeyler, biri
 *  eksik olduğunda uygulamanın SESSİZCE bozulduğu noktalardır:
 *
 *   1) manifest.json: PNG 192 + 512 ikon ve maskable sürümleri ŞART
 *      (eskiden yalnız bir SVG data-URI vardı → Bubblewrap/Play paketi
 *      üretilemiyordu), display=standalone, start_url kapsam içinde.
 *   2) /sw.js kökten servis edilmeli ve Service-Worker-Allowed: /
 *      başlığını taşımalı; yoksa servis çalışanı tüm siteyi kapsayamaz.
 *   3) Servis çalışanı /api ve /socket.io trafiğine ASLA karışmamalı —
 *      canlı oyun paketleri önbellekten servis edilirse oyun kilitlenir.
 *   4) /.well-known/assetlinks.json kökten servis edilmeli; yoksa
 *      uygulama adres çubuğunu gizleyemez (TWA yerine tarayıcı görünümü).
 *   5) index.html uygulama katmanını (js/webview.js) yüklemeli ve
 *      tarayıcıda window.GVApp'ı kurmalı.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-pwa-'));

const assert = require('assert');
const serverModule = require('../server.js');

async function al(base, p) {
  const r = await fetch(base + p);
  const govde = await r.text();
  return { status: r.status, tur: r.headers.get('content-type') || '', swAllowed: r.headers.get('service-worker-allowed'), govde };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1) manifest ----------
  const m = await al(BASE, '/manifest.json');
  assert.strictEqual(m.status, 200, 'manifest.json servis edilmeli');
  assert.ok(/manifest\+json|application\/json/.test(m.tur), 'manifest içerik türü JSON olmalı: ' + m.tur);
  const man = JSON.parse(m.govde);
  assert.strictEqual(man.display, 'standalone', 'display=standalone (uygulama görünümü)');
  assert.ok(man.start_url && man.start_url.startsWith('/'), 'start_url site kökünde olmalı');
  assert.ok(man.scope === '/' , 'scope kök olmalı (tüm site uygulama içinde açılsın)');
  assert.ok(man.name && man.short_name, 'ad ve kısa ad zorunlu');
  assert.ok(/^#[0-9a-f]{6}$/i.test(man.theme_color) && /^#[0-9a-f]{6}$/i.test(man.background_color),
    'tema ve arka plan rengi altılı HEX olmalı');

  const png = man.icons.filter(i => i.type === 'image/png');
  const boy = n => png.some(i => i.sizes === n + 'x' + n);
  assert.ok(boy(192), 'PNG 192x192 ikon şart (Play paketi bunu ister)');
  assert.ok(boy(512), 'PNG 512x512 ikon şart (mağaza simgesi)');
  assert.ok(png.some(i => String(i.purpose || '').includes('maskable')),
    'maskable ikon şart (Android ikonu daire/squircle kırpar)');
  for (const i of png) {
    const r = await al(BASE, i.src);
    assert.strictEqual(r.status, 200, 'ikon dosyası yayında olmalı: ' + i.src);
  }
  console.log('  ✓ 1) manifest: standalone + PNG 192/512 + maskable ikonlar yayında');

  // ---------- 2) servis çalışanı ----------
  const sw = await al(BASE, '/sw.js');
  assert.strictEqual(sw.status, 200, '/sw.js kökten servis edilmeli');
  assert.ok(/javascript/.test(sw.tur), 'sw.js JavaScript olarak servis edilmeli');
  assert.strictEqual(sw.swAllowed, '/', 'Service-Worker-Allowed: / başlığı olmalı');
  console.log('  ✓ 2) /sw.js kökten ve doğru başlıklarla servis ediliyor');

  // ---------- 3) canlı oyun trafiğine karışmama ----------
  assert.ok(/\/api\//.test(sw.govde) && /socket\.io/.test(sw.govde),
    'servis çalışanı /api ve /socket.io yollarını açıkça dışlamalı');
  const swKod = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.ok(swKod.includes("p.startsWith('/api/')"), 'sw: /api/ dışlanmalı');
  assert.ok(swKod.includes("p.startsWith('/socket.io/')"), 'sw: /socket.io/ dışlanmalı');
  assert.ok(swKod.includes("req.method !== 'GET'"), 'sw: GET olmayan istekler dışlanmalı');
  console.log('  ✓ 3) servis çalışanı /api, /socket.io ve GET olmayan isteklere karışmıyor');

  // ---------- 4) assetlinks ----------
  const al2 = await al(BASE, '/.well-known/assetlinks.json');
  assert.strictEqual(al2.status, 200, 'assetlinks.json kökten servis edilmeli');
  assert.ok(/json/.test(al2.tur), 'assetlinks JSON olarak servis edilmeli');
  const links = JSON.parse(al2.govde);
  assert.ok(Array.isArray(links) && links.length, 'assetlinks bir dizi olmalı');
  assert.strictEqual(links[0].target.namespace, 'android_app', 'hedef android_app olmalı');
  assert.ok(Array.isArray(links[0].target.sha256_cert_fingerprints), 'parmak izi alanı bulunmalı');
  console.log('  ✓ 4) /.well-known/assetlinks.json yayında ve doğru biçimde');

  // ---------- 5) istemci katmanı ----------
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(html.includes('js/webview.js'), 'index.html uygulama katmanını yüklemeli');
  assert.ok(/rel="manifest"/.test(html), 'index.html manifest bağlantısı taşımalı');
  assert.ok(/apple-mobile-web-app-capable/.test(html), 'iOS tam ekran meta etiketi olmalı');

  const { JSDOM, VirtualConsole } = require('jsdom');
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); }
  });
  const win = dom.window;
  const t0 = Date.now();
  while (!win.GVApp && Date.now() - t0 < 20000) await new Promise(r => setTimeout(r, 120));
  assert.ok(win.GVApp, 'window.GVApp kurulmalı (uygulama katmanı yüklendi)');
  assert.strictEqual(typeof win.GVApp.install, 'function', 'GVApp.install() kurulum çağrısı olmalı');
  assert.strictEqual(win.GVApp.isApp, false, 'normal tarayıcıda uygulama kipi KAPALI olmalı');
  assert.ok(!win.document.body.classList.contains('gv-app'), 'tarayıcıda gv-app sınıfı eklenmemeli');
  // Düğme artık üst barda gizli durmuyor; alt menüde (footer) üç durumu
  // da açıkça anlatıyor: mağaza adresi varsa Google Play'e götürür,
  // tarayıcı kurulabilir diyorsa kurulumu başlatır, ikisi de yoksa
  // "Yakında Google Play'de" der ve tıklanmaz.
  // Düğmenin durumunu js/webview.js sayfa 'load' olayında yazar; jsdom'da
  // bu, GVApp kurulduktan birkaç yüz ms sonra olabilir.
  // KARARSIZ TEST DÜZELTMESİ: düğme HTML'de zaten görünür durumda
  // duruyor, bu yüzden "hidden değilse çık" koşulu webview.js daha
  // etiketleri yazmadan sağlanıyordu ve test rastgele düşüyordu.
  // Artık düğmenin GERÇEKTEN işlenmiş olmasını bekliyoruz: etiket üç
  // bilinen metinden biri olana kadar.
  // Etiketin İLK HÂLİ de "Yakında Google Play'de" olduğu için metne
  // bakarak beklemek yetmiyordu. Kesin ölçüt: GVApp kurulana kadar bekle,
  // sonra durumu yazan fonksiyonu AÇIKÇA çağır — böylece 'load' olayının
  // jsdom'da ne zaman düştüğüne bağlı kararsızlık tamamen kalkar.
  const t1 = Date.now();
  while (Date.now() - t1 < 8000) {
    if (win.GVApp && typeof win.GVApp.refreshInstallUI === 'function') break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(win.GVApp && typeof win.GVApp.refreshInstallUI === 'function',
    'js/webview.js yüklenip GVApp kurulmalı');
  win.GVApp.refreshInstallUI();
  const kur = win.document.getElementById('gvInstallBtn');
  assert.ok(kur, 'mobil uygulama düğmesi DOM\'da bulunmalı');
  assert.ok(kur.closest('.gv-footer'), 'düğme alt menüde (footer) durmalı');
  assert.ok(!kur.hidden, 'tarayıcıda düğme görünür olmalı');
  assert.ok(kur.classList.contains('soon'), 'mağaza adresi yokken "yakında" durumunda olmalı');
  assert.ok(/Yakında|Google Play/i.test(win.document.getElementById('gvInstallLabel').textContent),
    'etiket ne yapılacağını söylemeli, görülen: ' + win.document.getElementById('gvInstallLabel').textContent);
  try { win.close(); } catch (_) {}
  console.log('  ✓ 5) index.html uygulama katmanını yüklüyor; tarayıcıda davranış değişmiyor');

  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK mobil uygulama (PWA / Android TWA) hazırlığı');
  process.exit(0);
}

main().catch(e => { console.error('❌ PWA TEST HATASI:', e); process.exit(1); });
