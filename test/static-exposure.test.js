'use strict';

/*
 * SUNUCU DOSYA SIZINTISI (statik servis kapsami)
 *
 *  Sunucu eskiden express.static(__dirname) ile DEPONUN TAMAMINI
 *  yayinliyordu: server.js / server-auth.js / db.js kaynak kodu,
 *  yoncu-api/*.php dosyalari ve yerel modda data/gameverse.db dahil
 *  her sey https://sunucu/<yol> adresinden indirilebiliyordu.
 *
 *  Bu test uc seyi birlikte dogrular:
 *    1) Istemcinin ihtiyaci olan dosyalar HALA servis ediliyor
 *       (index.html, js/, css/, assets/, manifest.json, sw.js),
 *    2) Sunucu ic dosyalari ARTIK disaridan alinamiyor,
 *    3) DEPO GUVENLIGI: sunucuya ozel sirlar depoya hic girmiyor.
 *
 *  (3) iki yasanmis kazadan dogdu:
 *    - Depoda "sablon" bir yoncu-api/config.php duruyordu; klasor toptan
 *      yuklendiginde sunucudaki GERCEK dosyayi ezdi ve uyelik sistemi
 *      "Veritabanina baglanilamadi" diyerek durdu.
 *    - Kok dizindeki db.php, MySQL kullanici adi ve sifresini DUZ METIN
 *      tasiyordu; depo herkese acik oldugu icin sifre disariya sizdi.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-static-'));

const assert = require('assert');
const serverModule = require('../server.js');

async function head(base, p) {
  const r = await fetch(base + p, { redirect: 'manual' });
  let body = '';
  try { body = await r.text(); } catch (_) {}
  return { status: r.status, body };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1) istemci dosyalari calisiyor ----------
  // /sw.js ve /.well-known/assetlinks.json KÖK yoldan servis edilmek ZORUNDA:
  // servis çalışanı kökten yayınlanmazsa tüm siteyi kapsayamaz, assetlinks
  // kökte olmazsa Android uygulaması alan adı sahipliğini doğrulayamaz.
  const izinli = ['/', '/index.html', '/manifest.json', '/sw.js', '/.well-known/assetlinks.json',
                  '/js/app.js', '/js/online-arena.js', '/js/webview.js', '/css/style.css',
                  '/assets/icons/icon-192.png', '/assets/icons/icon-512.png'];
  for (const p of izinli) {
    const r = await head(BASE, p);
    assert.strictEqual(r.status, 200, 'istemci dosyasi servis edilmeli: ' + p);
    assert.ok(r.body.length > 0, 'bos olmamali: ' + p);
  }
  const home = await head(BASE, '/');
  assert.ok(/<html/i.test(home.body), 'kok adres index.html dondurur');
  console.log('  ✓ 1) index.html + js/ + css/ + assets/ + manifest.json servis ediliyor');

  // ---------- 2) sunucu ic dosyalari SIZMIYOR ----------
  const yasak = [
    '/server.js', '/server-auth.js', '/db.js', '/auth-remote.js', '/mailer.js',
    '/config.js', '/package.json', '/package-lock.json',
    '/yoncu-api/config.php', '/yoncu-api/bootstrap.php', '/yoncu-api/auth.php',
    '/yoncu-api/config.ornek.php', '/okey-engine.js', '/tavla-engine.js',
    '/data/gameverse.db', '/test/admin-panel.test.js', '/README.md', '/YONCU-DEPLOY.md'
  ];
  for (const p of yasak) {
    const r = await head(BASE, p);
    assert.ok(r.status === 404 || r.status === 403,
      'sunucu dosyasi disariya kapali olmali (' + r.status + '): ' + p);
    assert.ok(!/require\(|password_hash|GV_DB_PASS|better-sqlite3/.test(r.body),
      'sunucu kaynagi govdede sizmamali: ' + p);
  }
  console.log('  ✓ 2) server.js / db.js / yoncu-api/*.php / data/*.db artık indirilemiyor');

  // ---------- 3) dizin gezinmesi (path traversal) ----------
  const kacis = ['/js/../server.js', '/css/../../etc/passwd', '/assets/..%2fserver.js'];
  for (const p of kacis) {
    const r = await head(BASE, p);
    assert.ok(r.status >= 400, 'dizin kaçışı reddedilmeli (' + r.status + '): ' + p);
  }
  console.log('  ✓ 3) js/../server.js gibi dizin kaçışları reddediliyor');

  // ---------- 4) DEPO GUVENLIGI: sirlar depoya girmesin ----------
  const kok = path.join(__dirname, '..');
  const yok = f => !fs.existsSync(path.join(kok, f));

  assert.ok(yok('yoncu-api/config.php'),
    'yoncu-api/config.php DEPODA BULUNMAMALI: sunucudaki gercek dosyayi ezer (uyelik sistemi durur)');
  assert.ok(fs.existsSync(path.join(kok, 'yoncu-api/config.ornek.php')),
    'yoncu-api/config.ornek.php sablonu bulunmali (ilk kurulum bundan kopyalanir)');
  assert.ok(yok('db.php') && yok('api.php'),
    'db.php / api.php depoda kalmamali: MySQL kullanici adi ve sifresini duz metin tasiyorlardi');

  const gitignore = fs.readFileSync(path.join(kok, '.gitignore'), 'utf8');
  assert.ok(/^yoncu-api\/config\.php$/m.test(gitignore),
    'yoncu-api/config.php .gitignore icinde olmali (yanlislikla eklenmesin)');

  // Sablonda gercek deger degil, YER TUTUCU bulunmali.
  const ornek = fs.readFileSync(path.join(kok, 'yoncu-api/config.ornek.php'), 'utf8');
  for (const alan of ['GV_DB_NAME', 'GV_DB_USER', 'GV_DB_PASS', 'GV_SERVER_KEY']) {
    const m = new RegExp("define\\('" + alan + "',\\s*'([^']*)'").exec(ornek);
    assert.ok(m, alan + ' ornek dosyada tanimli olmali');
    assert.ok(m[1].startsWith('BURAYA_'),
      alan + ' ornek dosyada GERCEK deger tasiyamaz (yer tutucu olmali): ' + m[1]);
  }

  // Sunucu, config eksik ya da doldurulmamisken NE YAPILACAGINI soylemeli.
  const boot = fs.readFileSync(path.join(kok, 'yoncu-api/bootstrap.php'), 'utf8');
  assert.ok(boot.includes('config.ornek.php'),
    'bootstrap.php config eksikken ornek dosyayi isaret etmeli');
  assert.ok(boot.includes("'BURAYA_'"),
    'bootstrap.php doldurulmamis sablon degerlerini yakalamali');
  console.log('  ✓ 4) depo güvenliği: config.php ve db.php depoda yok, şablon yer tutucularla');

  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK statik servis kapsamı: istemci dosyaları açık, sunucu dosyaları kapalı');
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
