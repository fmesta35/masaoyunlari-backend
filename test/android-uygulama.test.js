'use strict';
/* ============================================================================
 * ANDROID UYGULAMA KABUĞU (android/) — tutarlılık denetimleri
 * ============================================================================
 * Kullanıcı isteği: "farklı bir sohbetimizde belirttiğim dosyada farklı bir
 * projemiz için mobil uygulama gerçekleştirdik, oradaki kodu incele ve şimdi
 * pc'de cmd panelinde benzer şekilde masa oyunları versiyonu için Google
 * Play'e uygun koşullarda .aab dosyası üreterek başvuruda bulunalım."
 *
 * .aab'nin kendisi kullanıcının bilgisayarında (android\derle.bat) üretiliyor;
 * bu test, derlemenin ve Play incelemesinin takılacağı tutarsızlıkları ÖNCEDEN
 * yakalar:
 *
 *   1) TWA KALINTISI OLMAMALI. TakasVarmi'de TWA denendi ve Play "gerçek bir
 *      uygulama değil, tarayıcı sekmesi" diyerek REDDETTİ; bu proje native
 *      WebView olmalı (androidbrowserhelper / CustomTabs bağımlılığı yok).
 *   2) PAKET ADI üç yerde birebir aynı olmalı: build.gradle (namespace +
 *      applicationId), assetlinks.json ve Java paket yolu. Uyuşmazsa App
 *      Links doğrulanmaz ve Play yüklemeyi reddeder.
 *   3) HEDEF SDK 36 olmalı (Play 31 Ağustos 2026'dan beri zorunlu tutuyor).
 *   4) AÇILIŞ ADRESİ sitenin kendi alan adı olmalı ve manifest'teki App Link
 *      konakları onunla uyuşmalı.
 *   5) SİMGELER eksiksiz olmalı: 5 yoğunluk × (kare + yuvarlak + ön plan +
 *      tek renk) + uyarlanabilir simge XML'i + açılış görseli.
 *   6) İNTERNET izni olmalı; uygulama internetsiz çalışmıyor.
 *   7) İMZA ANAHTARI depoya GİRMEMELİ (.gitignore) — sızarsa başkası sizin
 *      adınıza güncelleme yayımlayabilir.
 *   8) versionCode / versionName bulunmalı ve sayı olmalı.
 *   9) Site tarafı kabuğu TANIYOR olmalı (js/webview.js köprüyü biliyor).
 *  10) Derleme betikleri yerinde ve ASCII olmalı (PowerShell 5.1 Türkçe
 *      karakterli betiği bozuk okuyup çalıştıramıyor).
 * ========================================================================= */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const KOK = path.join(__dirname, '..');
const AND = path.join(KOK, 'android');
const PAKET = 'tr.com.masaoyunlari.oyun';
const oku = p => fs.readFileSync(path.join(KOK, p), 'utf8');

// ---------- 0) proje duruyor mu ----------
for (const f of ['android/settings.gradle', 'android/build.gradle', 'android/gradle.properties',
                 'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml',
                 'android/app/src/main/res/layout/activity_main.xml',
                 'android/app/src/main/res/values/strings.xml',
                 'android/README.md', 'android/derle.ps1', 'android/derle.bat',
                 'android/derle-apk.bat']) {
  assert.ok(fs.existsSync(path.join(KOK, f)), 'eksik dosya: ' + f);
}
const appGradle = oku('android/app/build.gradle');
const manifest = oku('android/app/src/main/AndroidManifest.xml');
const strings = oku('android/app/src/main/res/values/strings.xml');
console.log('  ✓ 0) android projesi eksiksiz');

// ---------- 1) TWA kalıntısı yok ----------
const javaDir = path.join(AND, 'app/src/main/java', ...PAKET.split('.'));
assert.ok(fs.existsSync(javaDir), 'java paket yolu paket adıyla uyuşmalı: ' + javaDir);
const javaDosyalari = fs.readdirSync(javaDir).filter(f => f.endsWith('.java'));
assert.ok(javaDosyalari.includes('MainActivity.java'), 'MainActivity.java bulunmalı');
const mainJava = fs.readFileSync(path.join(javaDir, 'MainActivity.java'), 'utf8');

const twaIzleri = ['androidbrowserhelper', 'TrustedWebActivity', 'CustomTabs', 'LauncherActivity'];
for (const iz of twaIzleri) {
  for (const [ad, icerik] of [['app/build.gradle', appGradle], ['AndroidManifest.xml', manifest],
                              ['MainActivity.java', mainJava]]) {
    /* Yorum satırlarında "TWA denendi, reddedildi" diye GEÇMESİ serbest;
       asıl mesele KOD olarak kullanılmaması. */
    const kod = icerik.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*|<!--|#)/.test(l)).join('\n');
    assert.ok(!kod.includes(iz),
      ad + ' içinde TWA kalıntısı var: ' + iz + ' — Play TWA\'yı "tarayıcı sekmesi" diye reddediyor');
  }
}
assert.ok(/new\s+WebView|findViewById\(R\.id\.webview\)/.test(mainJava),
  'uygulama kendi WebView\'ini kullanmalı');
console.log('  ✓ 1) TWA kullanılmıyor, kendi WebView kabuğu var');

// ---------- 2) paket adı her yerde aynı ----------
assert.ok(new RegExp("namespace\\s+'" + PAKET.replace(/\./g, '\\.') + "'").test(appGradle),
  'namespace ' + PAKET + ' olmalı');
assert.ok(new RegExp('applicationId\\s+"' + PAKET.replace(/\./g, '\\.') + '"').test(appGradle),
  'applicationId ' + PAKET + ' olmalı');
assert.ok(new RegExp('^package\\s+' + PAKET.replace(/\./g, '\\.') + ';').test(mainJava.trim()),
  'MainActivity paket bildirimi ' + PAKET + ' olmalı');
const links = JSON.parse(oku('.well-known/assetlinks.json'));
assert.strictEqual(links[0].target.package_name, PAKET,
  'assetlinks.json paket adı uygulamanınkiyle BİREBİR aynı olmalı');
const magaza = oku('PLAY-MAGAZA.md');
assert.ok(magaza.includes(PAKET), 'mağaza dosyasındaki paket adı da aynı olmalı');
console.log('  ✓ 2) paket adı gradle, java, assetlinks ve mağaza kaydında tutarlı: ' + PAKET);

// ---------- 3) hedef SDK ----------
const hedef = Number((appGradle.match(/targetSdkVersion\s+(\d+)/) || [])[1]);
const derle = Number((appGradle.match(/compileSdk\s+(\d+)/) || [])[1]);
assert.ok(hedef >= 36, 'Play 31 Ağustos 2026\'dan beri API 36 hedefini zorunlu tutuyor — bulunan: ' + hedef);
assert.ok(derle >= hedef, 'compileSdk hedeften küçük olamaz');
const minSdk = Number((appGradle.match(/minSdkVersion\s+(\d+)/) || [])[1]);
assert.ok(minSdk >= 21 && minSdk <= 26, 'minSdk makul aralıkta olmalı — bulunan: ' + minSdk);
console.log('  ✓ 3) compileSdk ' + derle + ' / targetSdk ' + hedef + ' / minSdk ' + minSdk);

// ---------- 4) açılış adresi ve App Link konakları ----------
const launch = (strings.match(/<string name="launchUrl">([^<]+)<\/string>/) || [])[1];
const host = (strings.match(/<string name="hostName">([^<]+)<\/string>/) || [])[1];
const hostAlt = (strings.match(/<string name="hostNameAlt">([^<]+)<\/string>/) || [])[1];
assert.ok(launch && /^https:\/\//.test(launch), 'açılış adresi https olmalı — ' + launch);
assert.ok(launch.includes('masaoyunlari.com.tr'), 'açılış adresi sitenin alan adı olmalı');
assert.ok(launch.includes(host), 'açılış adresi hostName ile uyuşmalı — ' + launch + ' / ' + host);
assert.ok(hostAlt && hostAlt === 'masaoyunlari.com.tr', 'www\'suz konak da tanımlı olmalı');
assert.ok(/android:host="@string\/hostName"/.test(manifest) &&
          /android:host="@string\/hostNameAlt"/.test(manifest),
  'App Link filtresi iki konağı da kapsamalı');
assert.ok(/android:autoVerify="true"/.test(manifest), 'App Links otomatik doğrulanmalı');
console.log('  ✓ 4) açılış adresi ve App Link konakları tutarlı');

// ---------- 5) simgeler ----------
const YOG = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const AD = ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground', 'ic_launcher_monochrome'];
function pngOlcu(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504E47) return null;
  return { g: buf.readUInt32BE(16), y: buf.readUInt32BE(20) };
}
let say = 0;
for (const y of YOG) {
  for (const a of AD) {
    const p = path.join(AND, 'app/src/main/res/mipmap-' + y, a + '.png');
    assert.ok(fs.existsSync(p), 'simge eksik: mipmap-' + y + '/' + a + '.png');
    const o = pngOlcu(fs.readFileSync(p));
    assert.ok(o && o.g === o.y && o.g >= 48, a + ' (' + y + ') kare ve yeterli boyutta olmalı');
    say++;
  }
}
for (const x of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  const p = path.join(AND, 'app/src/main/res/mipmap-anydpi-v26', x);
  assert.ok(fs.existsSync(p), 'uyarlanabilir simge eksik: ' + x);
  const içerik = fs.readFileSync(p, 'utf8');
  assert.ok(/<adaptive-icon/.test(içerik) && /<foreground/.test(içerik) && /<background/.test(içerik),
    x + ' geçerli bir uyarlanabilir simge olmalı');
}
assert.ok(fs.existsSync(path.join(AND, 'app/src/main/res/drawable-nodpi/splash_logo.png')),
  'açılış ekranı görseli bulunmalı');
assert.ok(fs.existsSync(path.join(KOK, 'tools/android-ikonlari.py')),
  'simgeler yeniden üretilebilir kalmalı (tools/android-ikonlari.py)');
console.log('  ✓ 5) ' + say + ' simge + uyarlanabilir XML + açılış görseli yerinde');

// ---------- 6) izinler ----------
assert.ok(/android\.permission\.INTERNET/.test(manifest), 'INTERNET izni şart');
/* Gereksiz izin Play'de "neden istiyorsunuz" sorusu açar ve reddedilme
   sebebidir. Kabuk yalnız internet + ağ durumu + ekran kilidi istemeli. */
const izinler = (manifest.match(/android\.permission\.[A-Z_]+/g) || []);
const izinli = ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE',
                'android.permission.WAKE_LOCK'];
for (const i of izinler) assert.ok(izinli.includes(i), 'beklenmeyen izin: ' + i);
for (const riskli of ['CAMERA', 'ACCESS_FINE_LOCATION', 'READ_CONTACTS', 'RECORD_AUDIO',
                      'READ_EXTERNAL_STORAGE']) {
  assert.ok(!manifest.includes(riskli), 'hassas izin istenmemeli: ' + riskli);
}
console.log('  ✓ 6) yalnız gerekli izinler isteniyor (' + izinler.length + ' adet)');

// ---------- 7) imza anahtarı depoya girmiyor ----------
const gi = oku('android/.gitignore');
for (const kural of ['keystore.properties', 'keystore/', '*.keystore', '*.jks']) {
  assert.ok(gi.includes(kural), '.gitignore kuralı eksik: ' + kural);
}
assert.ok(!fs.existsSync(path.join(AND, 'keystore.properties')), 'imza parolası depoda OLMAMALI');
const keystoreVar = fs.existsSync(path.join(AND, 'keystore'));
assert.ok(!keystoreVar, 'imza anahtarı klasörü depoda OLMAMALI');
console.log('  ✓ 7) imza anahtarı ve parolası depo dışında');

// ---------- 8) sürüm numaraları ----------
const vc = Number((appGradle.match(/versionCode\s+(\d+)/) || [])[1]);
const vn = (appGradle.match(/versionName\s+"([^"]+)"/) || [])[1];
assert.ok(Number.isInteger(vc) && vc >= 1, 'versionCode tam sayı olmalı');
assert.ok(vn && /^\d+\.\d+\.\d+$/.test(vn), 'versionName x.y.z biçiminde olmalı — ' + vn);
assert.ok(/buildConfig true/.test(appGradle),
  'MainActivity BuildConfig.VERSION_NAME okuyor; AGP 8\'de bu açıkça istenmeli');
assert.ok(mainJava.includes('BuildConfig.VERSION_NAME'), 'sürüm kullanıcı ajanına eklenmeli');
console.log('  ✓ 8) versionCode ' + vc + ' / versionName ' + vn);

// ---------- 9) site kabuğu tanıyor ----------
const wv = oku('js/webview.js');
assert.ok(/window\.MasaOyunlariApp/.test(wv), 'site native köprüyü tanımalı');
assert.ok(/MasaOyunlariApp\\\//.test(wv) || /MasaOyunlariApp\//.test(wv),
  'site kullanıcı ajanındaki uygulama imzasını tanımalı');
assert.ok(/setKeepScreenOn/.test(wv) && /setKeepScreenOn/.test(mainJava),
  'ekran kilidi köprüsü iki tarafta da olmalı');
assert.ok(/addJavascriptInterface\(new WebAppBridge\(\), "MasaOyunlariApp"\)/.test(mainJava),
  'köprünün adı site tarafıyla aynı olmalı');
console.log('  ✓ 9) site ile native kabuk aynı köprüyü kullanıyor');

// ---------- 10) derleme betikleri ----------
const ps1 = oku('android/derle.ps1');
const bat = oku('android/derle.bat');
/* PowerShell 5.1 (Windows'ta varsayılan) .ps1 dosyasını BOM'suzsa
   Windows-1254 ile okur; Türkçe karakterler bozulur ve betik hata verir.
   Bu yüzden betik ASCII olmak zorunda. */
assert.ok(!/[^\x00-\x7F]/.test(ps1), 'derle.ps1 ASCII olmalı (PowerShell 5.1 kısıtlaması)');
assert.ok(!/[^\x00-\x7F]/.test(bat), 'derle.bat ASCII olmalı');
assert.ok(/bundleRelease/.test(ps1), 'betik .aab üretmeli (bundleRelease)');
assert.ok(/keytool/.test(ps1), 'betik imza anahtarını üretebilmeli');
assert.ok(/Read-Host/.test(ps1) && /AsSecureString/.test(ps1),
  'parola kullanıcıdan gizli şekilde alınmalı (betiğe gömülmemeli)');
assert.ok(!/storePassword=[A-Za-z0-9]/.test(ps1), 'betikte gömülü parola olmamalı');
assert.ok(/android-sdk/.test(ps1), 'betik kurulu SDK\'yı aramalı (gereksiz GB indirmesin)');
/* TELEFONDA DENEME: Play Console .aab ister ama .aab bir cihaza KURULAMAZ
   (indirilebilir bir paket değil, mağazanın cihaza göre APK üretmesi için
   kaynak). Uygulamayı kendi telefonunda denemek isteyen için -Apk anahtarı
   ve derle-apk.bat var; ikisi de AYNI imza yapılandırmasını kullanır, yani
   denenen uygulama mağazaya gidenle aynı davranır. */
const batApk = oku('android/derle-apk.bat');
assert.ok(!/[^\x00-\x7F]/.test(batApk), 'derle-apk.bat ASCII olmalı');
assert.ok(/\$Apk/.test(ps1) && /assembleRelease/.test(ps1),
  'betik -Apk anahtarıyla telefona kurulabilen APK de üretmeli');
assert.ok(/-Apk/.test(batApk), 'derle-apk.bat betiği -Apk anahtarıyla çağırmalı');
assert.ok(/signingConfig signingConfigs\.release/.test(appGradle),
  'release yapısı imzalı olmalı; yoksa assembleRelease imzasız APK üretir ve kurulmaz');
console.log('  ✓ 10) derleme betikleri ASCII, parolayı sormuyor-gömmüyor, kurulu SDK\'yı arıyor; APK seçeneği var');

// ---------- 11) kaynak atıfları çözülüyor mu ----------
/* Java'daki R.id.x / R.string.y ve XML'deki @drawable/z gibi atıfların
   hepsi GERÇEKTEN var mı? Tek harflik bir yazım hatası derlemeyi kırar ve
   bunu ancak kullanıcının bilgisayarında, dakikalar sonra görürüz. */
function dosyaBirlestir(desen) {
  const dizin = path.join(AND, 'app/src/main/res', desen);
  if (!fs.existsSync(dizin)) return '';
  return fs.readdirSync(dizin).filter(f => f.endsWith('.xml'))
    .map(f => fs.readFileSync(path.join(dizin, f), 'utf8')).join('\n');
}
function varMiKaynak(tur, ad) {
  const res = path.join(AND, 'app/src/main/res');
  if (tur === 'id') return dosyaBirlestir('layout').includes('android:id="@+id/' + ad + '"');
  if (tur === 'string' || tur === 'color' || tur === 'style') {
    return dosyaBirlestir('values').includes('name="' + ad + '"');
  }
  if (tur === 'layout') return fs.existsSync(path.join(res, 'layout', ad + '.xml'));
  // drawable / mipmap: hangi yoğunlukta olursa olsun bir dosya bulunmalı
  return fs.readdirSync(res)
    .filter(d => d.startsWith(tur))
    .some(d => fs.readdirSync(path.join(res, d)).some(f => f.replace(/\.[^.]+$/, '') === ad));
}
const eksikler = [];
let m;
const reJava = /R\.(id|string|color|style|layout|drawable|mipmap)\.(\w+)/g;
while ((m = reJava.exec(mainJava))) {
  if (!varMiKaynak(m[1], m[2])) eksikler.push('MainActivity.java → R.' + m[1] + '.' + m[2]);
}
const reXml = /@(string|color|drawable|mipmap|style)\/(\w+)/g;
for (const [ad, icerik] of [['layout', dosyaBirlestir('layout')], ['AndroidManifest.xml', manifest]]) {
  reXml.lastIndex = 0;
  while ((m = reXml.exec(icerik))) {
    if (!varMiKaynak(m[1], m[2])) eksikler.push(ad + ' → @' + m[1] + '/' + m[2]);
  }
}
assert.deepStrictEqual(eksikler, [], 'çözülemeyen kaynak atıfları (derleme kırılır): ' + eksikler.join(', '));
console.log('  ✓ 11) Java ve XML\'deki bütün kaynak atıfları çözülüyor');

console.log('OK android uygulaması: native WebView, tutarlı paket adı, simgeler, izinler, derleme betiği');
