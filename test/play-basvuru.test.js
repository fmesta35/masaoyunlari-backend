'use strict';
/* ============================================================================
 * GOOGLE PLAY BAŞVURU HAZIRLIĞI
 * ============================================================================
 * Kullanıcı isteği: "siteyi tamamen google play'de yayınlamak üzere
 * dosyalarını üretip başvuruda bulunalım... .aab dosyasını üretelim."
 *
 * .aab'nin kendisi PWABuilder/Bubblewrap ile dışarıda üretiliyor; bu test
 * SİTENİN tarafındaki başvuru şartlarının yerinde kalmasını güvence altına
 * alır. Play'in reddettiği klasik sebepler tek tek kontrol edilir:
 *
 *   1) GİZLİLİK POLİTİKASI — mağaza kaydında zorunlu, herkese açık bir
 *      adreste olmalı ve uygulama içinden erişilebilmeli. Üstelik DÜZ HTML
 *      olmalı: Play'in incelemecisi ve robotu JavaScript çalıştırmadan okur.
 *   2) HESAP SİLME — hesap açılabilen her uygulamada silme yolu politikada
 *      açıkça yazmak zorunda (Google "Account deletion" şartı).
 *   3) PAKET ADI — assetlinks.json'daki ad, uygulamanın paket adıyla
 *      BİREBİR aynı olmalı; yoksa TWA adres çubuğunu gizleyemez.
 *   4) SHA-256 parmak izi alanı duruyor mu (Play Console'dan doldurulacak).
 *   5) Mağaza görselleri depoda ve doğru ölçüde mi.
 *   6) Servis çalışanı uygulama kabuğunu BOZMUYOR mu (gizlilik sayfası
 *      açılınca kabuğun yerine o sayfa geçmemeli).
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');

const KOK = path.join(__dirname, '..');
const PAKET = 'tr.com.masaoyunlari.oyun';

function al(base, yol) {
  return new Promise((resolve, reject) => {
    http.get(base + yol, res => {
      let g = '';
      res.on('data', c => { g += c; });
      res.on('end', () => resolve({ status: res.statusCode, tur: res.headers['content-type'] || '', govde: g }));
    }).on('error', reject);
  });
}

/* PNG ölçüsünü başlıktan oku (harici bağımlılık istemiyoruz). */
function pngOlcu(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504E47) return null;
  return { g: buf.readUInt32BE(16), y: buf.readUInt32BE(20) };
}

async function main() {
  const serverModule = require('../server.js');
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;

  // ---------- 1) gizlilik politikası yayında ve DÜZ HTML ----------
  const gp = await al(BASE, '/gizlilik-politikasi.html');
  assert.strictEqual(gp.status, 200, 'gizlilik politikası 200 dönmeli (Play başvuru şartı)');
  assert.ok(/text\/html/.test(gp.tur), 'text/html olarak servis edilmeli — ' + gp.tur);
  /* Metin JavaScript'siz görünmeli: incelemeci robot script çalıştırmaz. */
  const govde = gp.govde;
  assert.ok(govde.length > 4000, 'politika metni gerçekten sayfada olmalı (JS ile sonradan yüklenmemeli)');
  for (const konu of ['Gizlilik Politikası', 'e-posta', 'parola', 'çerez', 'KVKK', 'GDPR']) {
    assert.ok(new RegExp(konu, 'i').test(govde), 'politikada geçmeli: ' + konu);
  }
  assert.ok(!/<script/i.test(govde), 'politika sayfası script çalıştırmamalı (robot okuyamaz)');
  console.log('  ✓ 1) gizlilik politikası yayında, düz HTML ve zorunlu başlıkları içeriyor');

  // ---------- 2) hesap silme yolu politikada yazıyor ----------
  assert.ok(/hesap\s*silme/i.test(govde),
    'Google "Account deletion" şartı: hesap silme yolu politikada AÇIKÇA yazmalı');
  assert.ok(/info@masaoyunlari\.com\.tr/.test(govde), 'silme talebi için iletişim adresi olmalı');
  assert.ok(/30\s*gün/.test(govde), 'silme talebinin ne kadar sürede karşılanacağı yazmalı');
  console.log('  ✓ 2) hesap silme talebi yolu ve süresi politikada yazıyor');

  // ---------- 3) paket adı tutarlı ----------
  const links = JSON.parse(fs.readFileSync(path.join(KOK, '.well-known', 'assetlinks.json'), 'utf8'));
  assert.strictEqual(links[0].target.package_name, PAKET,
    'assetlinks paket adı uygulamanınkiyle BİREBİR aynı olmalı');
  const rehber = fs.readFileSync(path.join(KOK, 'WEBVIEW-ANDROID.md'), 'utf8');
  assert.ok(rehber.includes(PAKET), 'rehberdeki paket adı da güncel olmalı');
  assert.ok(!/tr\.com\.masaoyunlari\.twa/.test(rehber + JSON.stringify(links)),
    'eski paket adı (…​.twa) hiçbir yerde kalmamalı — yanlış ad adres çubuğunu gizletmez');
  console.log('  ✓ 3) paket adı assetlinks ve rehberde tutarlı: ' + PAKET);

  // ---------- 4) parmak izi ----------
  /* Depodaki değer artık YER TUTUCU DEĞİL: android\derle.ps1 ile üretilen
     YÜKLEME (upload) anahtarının gerçek parmak izi. Play App Signing
     kullanıldığında Google uygulamayı KENDİ anahtarıyla yeniden imzalar;
     o yüzden Play Console'daki "uygulama imzalama" parmak izi de bu listeye
     EKLENMELİ (ikisi birden durabilir). Buradaki kontrol, listedeki her
     girdinin gerçekten SHA-256 parmak izi biçiminde olmasını şart koşar —
     yarım bırakılmış bir yer tutucu sessizce yayına çıkmasın. */
  const izler = links[0].target.sha256_cert_fingerprints;
  assert.ok(Array.isArray(izler) && izler.length >= 1 && izler.length <= 2,
    'bir ya da iki parmak izi bulunmalı (yükleme anahtarı + Play imzalama)');
  for (const iz of izler) {
    assert.ok(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(iz),
      'parmak izi 32 baytlık SHA-256 biçiminde olmalı — ' + iz);
  }
  console.log('  ✓ 4) SHA-256 parmak izi geçerli biçimde (' + izler.length + ' adet)');

  // ---------- 5) mağaza görselleri ----------
  const gorseller = [
    ['assets/icons/icon-512.png', 512, 512, 'uygulama simgesi'],
    ['assets/play/ozellik-grafigi-1024x500.png', 1024, 500, 'özellik grafiği']
  ];
  for (const [yol, g, y, ad] of gorseller) {
    const tam = path.join(KOK, yol);
    assert.ok(fs.existsSync(tam), ad + ' depoda bulunmalı: ' + yol);
    const o = pngOlcu(fs.readFileSync(tam));
    assert.ok(o, ad + ' geçerli bir PNG olmalı');
    assert.strictEqual(o.g + 'x' + o.y, g + 'x' + y, ad + ' ölçüsü — ' + o.g + 'x' + o.y);
  }
  const ekranDizin = path.join(KOK, 'assets', 'play', 'ekran');
  assert.ok(fs.existsSync(ekranDizin), 'ekran görüntüleri klasörü bulunmalı: assets/play/ekran');
  const ekranlar = fs.readdirSync(ekranDizin).filter(f => /\.png$/i.test(f));
  assert.ok(ekranlar.length >= 2, 'Play en az 2 telefon ekran görüntüsü ister — bulunan: ' + ekranlar.length);
  for (const f of ekranlar) {
    const o = pngOlcu(fs.readFileSync(path.join(ekranDizin, f)));
    assert.ok(o, f + ' geçerli PNG olmalı');
    /* Play: her kenar 320-3840 px arası, en/boy oranı 2:1'i geçmemeli. */
    const kucuk = Math.min(o.g, o.y), buyuk = Math.max(o.g, o.y);
    assert.ok(kucuk >= 320 && buyuk <= 3840, f + ' kenarları 320-3840 px arasında olmalı — ' + o.g + 'x' + o.y);
    assert.ok(buyuk / kucuk <= 2.001, f + ' en/boy oranı 2:1\'i geçmemeli — ' + o.g + 'x' + o.y);
  }
  console.log('  ✓ 5) mağaza görselleri hazır: simge, özellik grafiği ve ' + ekranlar.length + ' ekran görüntüsü');

  // ---------- 6) politika sayfası uygulama kabuğunu bozmuyor ----------
  const sw = fs.readFileSync(path.join(KOK, 'sw.js'), 'utf8');
  assert.ok(/kokMu/.test(sw) && /pathname === '\/index\.html'/.test(sw),
    'servis çalışanı KABUK olarak yalnız kök belgeyi saklamalı; yoksa gizlilik ' +
    'sayfası açılınca çevrimdışı açılışta oyunun yerine o sayfa gelir');
  const indexHtml = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
  assert.ok(/href="\/gizlilik-politikasi\.html"/.test(indexHtml),
    'gizlilik politikası bağlantısı uygulama içinden erişilebilir olmalı');
  console.log('  ✓ 6) politika bağlantısı uygulama içinde, servis çalışanı kabuğu korumalı');

  // ---------- 7) mağaza metinleri hazır ----------
  const metin = path.join(KOK, 'PLAY-MAGAZA.md');
  assert.ok(fs.existsSync(metin), 'PLAY-MAGAZA.md (başvuru metinleri) bulunmalı');
  const m = fs.readFileSync(metin, 'utf8');
  const kisa = (m.match(/<!--KISA-->([\s\S]*?)<!--\/KISA-->/) || [])[1];
  assert.ok(kisa, 'kısa açıklama <!--KISA--> bloğunda olmalı');
  const kisaUz = kisa.trim().length;
  assert.ok(kisaUz > 0 && kisaUz <= 80, 'Play kısa açıklaması en çok 80 karakter — ' + kisaUz);
  const uzun = (m.match(/<!--UZUN-->([\s\S]*?)<!--\/UZUN-->/) || [])[1];
  assert.ok(uzun, 'uzun açıklama <!--UZUN--> bloğunda olmalı');
  assert.ok(uzun.trim().length <= 4000, 'Play uzun açıklaması en çok 4000 karakter — ' + uzun.trim().length);
  const baslik = (m.match(/<!--BASLIK-->([\s\S]*?)<!--\/BASLIK-->/) || [])[1];
  assert.ok(baslik && baslik.trim().length <= 30, 'Play uygulama adı en çok 30 karakter');
  assert.ok(/masa\s*oyunlar/i.test(baslik), 'mağaza adı "Masa Oyunları" olmalı (aramada bu adla çıksın)');
  console.log('  ✓ 7) mağaza metinleri sınırlar içinde (ad ' + baslik.trim().length +
              ', kısa ' + kisaUz + ', uzun ' + uzun.trim().length + ' karakter)');

  /* ---------- 8) REKLAM BEYANI TUTARLI MI ----------
   * Kullanıcı isteği: "google reklam ve bannerları ileride ekleyeceğim".
   * Politikada ve mağaza metninde "reklam göstermiyoruz" gibi KOŞULSUZ bir
   * söz vermek, reklam eklendiği gün yanlış beyana dönüşür — Play'de bu
   * doğrudan politika ihlalidir. O yüzden cümleler TARİHE BAĞLI olmalı ve
   * reklam eklenirse ne yapılacağı yazmalı. Bu madde o dili kilitler. */
  assert.ok(/bu politikanın yayımlandığı tarihte[\s\S]{0,160}reklam/i.test(govde),
    'reklam cümlesi tarihe bağlanmalı ("bu politikanın yayımlandığı tarihte..."); ' +
    'koşulsuz "reklam göstermiyoruz" sözü reklam eklenince yanlış beyan olur');
  assert.ok(/reklamlar[\s\S]{0,40}yayına girmeden önce/i.test(govde),
    'reklam eklenirse politikanın ÖNCEDEN güncelleneceği sözü politikada olmalı');
  assert.ok(/4\.1\s*Reklam/i.test(govde),
    'politikada ayrı bir "4.1 Reklam" bölümü olmalı (sağlayıcı adı oraya yazılacak)');
  assert.ok(/sat(mıyoruz|ılmaz)/i.test(govde),
    'veri satmama sözü korunmalı — bu söz reklam eklendiğinde de geçerli kalıyor');
  assert.ok(!/reklam\s+göstermiyoruz/i.test(govde),
    'politikada koşulsuz "reklam göstermiyoruz" ifadesi bulunmamalı');
  assert.ok(!/^\s*[•\-*]\s*Reklam yok/im.test(m),
    'mağaza uzun açıklamasında koşulsuz "Reklam yok" maddesi bulunmamalı');
  assert.ok(/Veri güvenliği/i.test(m) && /Reklamlar/i.test(m),
    'PLAY-MAGAZA.md reklam eklenince güncellenecek yerleri (reklam beyanı + ' +
    'Veri güvenliği formu) listelemeli');
  console.log('  ✓ 8) reklam beyanı tarihe bağlı; ileride reklam eklenince ne yapılacağı yazılı');

  /* ---------- 9) ALT BİLGİDE POLİTİKA BAĞLANTISI İLETİŞİM SÜTUNUNDA ----------
   * Tek bağlantı için ayrı "YASAL" sütunu hem webde boş duruyordu hem de
   * telefonda alt bilgiyi uzatıyordu. Bağlantı İLETİŞİM başlığının altına
   * taşındı; Play'in "politika uygulama içinden erişilebilir olmalı" şartı
   * 6. maddede ayrıca denetleniyor, burada da sütun düzeni korunuyor. */
  assert.ok(!/<h4>\s*YASAL\s*<\/h4>/i.test(indexHtml),
    'ayrı "YASAL" sütunu kaldırıldı; bağlantı İLETİŞİM sütununda duruyor');
  const iletisimSutunu = (indexHtml.match(
    /<h4>İLETİŞİM<\/h4>[\s\S]{0,400}?<\/div>/) || [])[0] || '';
  assert.ok(/gizlilik-politikasi\.html/.test(iletisimSutunu),
    'gizlilik politikası bağlantısı İLETİŞİM sütununun içinde olmalı');
  assert.ok(/grid-template-columns:auto 1fr/.test(indexHtml),
    'telefonda alt bilgi iki sütun yan yana kalmalı (e-posta tek satıra sığsın)');
  console.log('  ✓ 9) alt bilgi: politika bağlantısı İLETİŞİM sütununda, telefonda iki sütun');

  server.close();
  console.log('OK Play başvurusu: politika, hesap silme, paket adı, görseller, metinler');
  process.exit(0);
}
main().catch(e => { console.error('❌ PLAY BAŞVURU HATASI:', e); process.exit(1); });
