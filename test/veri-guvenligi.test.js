'use strict';
/* ============================================================================
 * GOOGLE PLAY "VERİ GÜVENLİĞİ" FORMU — BEYANLARIN DAYANAĞI
 * ============================================================================
 * Kullanıcı isteği: "Uygulamanızın topladığı tüm kullanıcı verileri aktarım
 * sırasında şifreleniyor mu? - Sağlayalım. Kullanıcıların, hesaplarının ve
 * ilişkili verilerinin silinmesini talep etmek için kullanabilecekleri bir
 * bağlantı ekleyin."
 *
 * Play'de bu iki alan YALNIZCA BEYANDIR; Google doğrulamaz ama yanlış beyan
 * uygulamanın kaldırılma sebebidir. Üstelik beyan bir kez verilir, kod ise
 * değişmeye devam eder: bugün https olan bir adres yarın http yapılırsa
 * mağazadaki "Evet" sessizce yalana döner. Bu test o iki cevabı KODA
 * BAĞLAR, böylece beyan kendiliğinden doğru kalır:
 *
 *   1) AKTARIMDA ŞİFRELEME — istemcinin konuştuğu hiçbir uç nokta düz
 *      http:// olmasın (yerel geliştirme adresleri hariç), canlı oyun
 *      bağlantısı da şifreli kanaldan kurulsun.
 *   2) SİLME BAĞLANTISI — /hesap-silme.html yayında, düz HTML, üye girişi
 *      istemiyor; talebin yolu, silinen veriler ve süre sayfada yazılı.
 *   3) Bağlantı uygulama içinden de görünür (alt bilgi) ve politikadan
 *      bağlanmış; mağaza metninde de aynı adres yazılı.
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const KOK = path.join(__dirname, '..');
const SILME_ADRES = 'https://www.masaoyunlari.com.tr/hesap-silme.html';

function al(base, yol) {
  return new Promise((resolve, reject) => {
    http.get(base + yol, res => {
      let g = '';
      res.on('data', c => { g += c; });
      res.on('end', () => resolve({ status: res.statusCode, tur: res.headers['content-type'] || '', govde: g }));
    }).on('error', reject);
  });
}

/* Yerel geliştirme adresleri beyanı ilgilendirmez: kullanıcı cihazından
   çıkmazlar. Testlerdeki 127.0.0.1 ve e2b önizleme adresleri de öyle. */
function yerelMi(adres) {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(adres);
}

async function main() {
  const serverModule = require('../server.js');
  const server = serverModule.server || serverModule;
  await new Promise(r => server.listen(0, r));
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1) AKTARIMDA ŞİFRELEME ----------
  const istemciDosyalari = [];
  for (const dizin of ['js', 'css']) {
    const tam = path.join(KOK, dizin);
    if (!fs.existsSync(tam)) continue;
    for (const f of fs.readdirSync(tam)) {
      if (/\.(js|css)$/i.test(f)) istemciDosyalari.push(path.join(tam, f));
    }
  }
  istemciDosyalari.push(path.join(KOK, 'index.html'));
  istemciDosyalari.push(path.join(KOK, 'sw.js'));
  istemciDosyalari.push(path.join(KOK, 'manifest.json'));

  const duzBaglantilar = [];
  for (const dosya of istemciDosyalari) {
    const icerik = fs.readFileSync(dosya, 'utf8');
    for (const m of icerik.match(/http:\/\/[^\s'"`)<>]+/g) || []) {
      // XML ad alanları ve şema adresleri gerçek bir bağlantı değildir.
      if (/w3\.org|schema\.org|purl\.org|xmlns/i.test(m)) continue;
      if (yerelMi(m)) continue;
      duzBaglantilar.push(path.relative(KOK, dosya) + ' → ' + m);
    }
    for (const m of icerik.match(/ws:\/\/[^\s'"`)<>]+/g) || []) {
      if (yerelMi(m.replace(/^ws/, 'http'))) continue;
      duzBaglantilar.push(path.relative(KOK, dosya) + ' → ' + m);
    }
  }
  assert.deepStrictEqual(duzBaglantilar, [],
    'Play "aktarımda şifreleme: Evet" beyanı var; istemcide şifrelenmemiş ' +
    'uç nokta bulunamaz:\n  ' + duzBaglantilar.join('\n  '));

  const config = fs.readFileSync(path.join(KOK, 'js', 'config.js'), 'utf8');
  assert.ok(/https:\/\/masaoyunlari-backend\.onrender\.com/.test(config),
    'sunucu adresi https olmalı (socket.io bağlantısı buradan wss kurar)');
  console.log('  ✓ 1) aktarımda şifreleme: istemcide düz http/ws uç nokta yok, sunucu adresi https');

  // ---------- 2) SİLME SAYFASI YAYINDA ----------
  const politikaMetni = fs.readFileSync(path.join(KOK, 'gizlilik-politikasi.html'), 'utf8');
  const sayfa = await al(BASE, '/hesap-silme.html');
  assert.strictEqual(sayfa.status, 200, '/hesap-silme.html 200 dönmeli (Play forma bu adresi alıyor)');
  assert.ok(/text\/html/.test(sayfa.tur), 'text/html servis edilmeli — ' + sayfa.tur);
  const sv = sayfa.govde;
  assert.ok(!/<script/i.test(sv),
    'silme sayfası JavaScript çalıştırmamalı: Play incelemecisi ve robotu düz HTML okur');
  assert.ok(!/giriş yap|oturum aç|parolanız/i.test(sv),
    'silme sayfası üye girişi istememeli; incelemeci hesapsız açabilmeli');
  assert.ok(/hesap silme/i.test(sv), 'sayfa hesap silmeyi açıkça anlatmalı');
  assert.ok(/info@masaoyunlari\.com\.tr/.test(sv), 'talep için iletişim adresi olmalı');
  assert.ok(/30\s*gün/.test(sv), 'talebin karşılanma süresi yazmalı');
  assert.ok(/12\s*ay/.test(sv),
    'saklanan kayıtların (log) süresi de yazmalı — Play "silinen" ve "saklanan" ayrımını ister');
  assert.ok(/12\s*ay/.test(politikaMetni),
    'silme sayfasındaki saklama süresi politikadaki süreyle AYNI olmalı; iki ' +
    'belge çelişirse hangisi doğru belli olmaz');
  for (const konu of ['kullanıcı adı', 'e-posta', 'arkadaş', 'maç']) {
    assert.ok(new RegExp(konu, 'i').test(sv), 'silinen veriler arasında sayılmalı: ' + konu);
  }
  console.log('  ✓ 2) /hesap-silme.html yayında, düz HTML, girişsiz; silinen ve saklanan veriler yazılı');

  // ---------- 3) BAĞLANTI HER YERDE AYNI ----------
  const indexHtml = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
  assert.ok(/href="\/hesap-silme\.html"/.test(indexHtml),
    'silme bağlantısı uygulama içinden (alt bilgi) erişilebilir olmalı');
  const politika = (await al(BASE, '/gizlilik-politikasi.html')).govde;
  assert.ok(/href="\/hesap-silme\.html"/.test(politika),
    'gizlilik politikası silme sayfasına bağlanmalı');
  assert.ok(/aktarımda şifreleme/i.test(politika) && /TLS/.test(politika),
    'politika aktarımda şifrelemeyi açıkça yazmalı (Play cevabının dayanağı)');
  const magaza = fs.readFileSync(path.join(KOK, 'PLAY-MAGAZA.md'), 'utf8');
  assert.ok(magaza.includes(SILME_ADRES),
    'PLAY-MAGAZA.md forma girilecek silme adresini içermeli: ' + SILME_ADRES);
  const sw = fs.readFileSync(path.join(KOK, 'sw.js'), 'utf8');
  assert.ok(/kokMu/.test(sw),
    'servis çalışanı yalnız kök belgeyi kabuk olarak saklamalı; yoksa silme ' +
    'sayfası açılınca çevrimdışı açılışta oyunun yerine o sayfa gelir');
  console.log('  ✓ 3) bağlantı alt bilgide, politikada ve mağaza metninde tutarlı');

  server.close();
  console.log('OK veri güvenliği: aktarımda şifreleme + hesap silme bağlantısı');
  process.exit(0);
}
main().catch(e => { console.error('❌ VERİ GÜVENLİĞİ HATASI:', e); process.exit(1); });
