'use strict';
/* ============================================================================
 * ÖNBELLEK SÜRÜM DAMGASI — içerik değişince ?v= de değişmeli
 * ============================================================================
 * NEDEN VAR (gerçek olay): js/room-waiting-fix.js ve js/lobby-sync.js'teki
 * "yeni oyunların masası boş açılıyor" düzeltmesi depoya girdi ama
 * index.html'deki `?v=20260908b` / `?v=20260820f` etiketleri olduğu gibi
 * bırakıldı. Yöncü ve tarayıcı ESKİ dosyayı servis etmeye devam etti;
 * düzeltme canlıda hiç görünmedi, hata "bir türlü geçmeyen hata" sanıldı.
 *
 * Bu test o tuzağı kapatır: index.html'deki her betik etiketi için dosyanın
 * içerik özeti js-surumleri.json'daki kayıtla karşılaştırılır. Bir dosyanın
 * içeriği değiştiyse `node tools/surum-damgasi.js` çalıştırılıp etiket
 * yükseltilmeden bu test GEÇMEZ.
 * ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { tara } = require('../tools/surum-damgasi.js');

const KOK = path.join(__dirname, '..');

(function () {
  try {
    // 1) Kayıt dosyası olmalı ve index.html'deki her etiketi kapsamalı.
    const kayitYolu = path.join(KOK, 'js-surumleri.json');
    assert.ok(fs.existsSync(kayitYolu), 'js-surumleri.json olmalı (node tools/surum-damgasi.js)');

    const { html, kayit, bulgular } = tara();
    const etiketSayisi = (html.match(/src="(?:js\/)?[A-Za-z0-9._-]+\.js\?v=/g) || []).length;
    assert.ok(etiketSayisi > 30, 'index.html sürümlü betik etiketleri taşımalı, bulunan: ' + etiketSayisi);
    assert.strictEqual(Object.keys(kayit).length, etiketSayisi,
      'kayıt ile etiket sayısı eşleşmeli (silinen/eklenen dosya varsa aracı çalıştırın)');

    // 2) Hiçbir dosyanın içeriği etiketinden ayrı düşmemeli.
    const kotu = bulgular.filter(b => b.sorun !== 'dosya_yok');
    assert.strictEqual(kotu.length, 0,
      'şu dosyaların içeriği değişmiş ama ?v= etiketi aynı kalmış — ' +
      '`node tools/surum-damgasi.js` çalıştırın:\n   ' +
      kotu.map(b => b.yol + ' (' + b.sorun + ', ?v=' + b.etiket + ')').join('\n   '));
    console.log('  ✓ 1) ' + etiketSayisi + ' betik etiketinin tamamı içerikle uyumlu');

    // 3) Eksik dosya olmamalı: var olmayan bir betiğe etiket verilmiş olmasın.
    const eksik = bulgular.filter(b => b.sorun === 'dosya_yok');
    assert.strictEqual(eksik.length, 0,
      'index.html var olmayan betiklere bağlanıyor: ' + eksik.map(b => b.yol).join(', '));
    console.log('  ✓ 2) index.html\'in bağladığı tüm betikler depoda var');

    /* 2b) SERVİS EDİLEBİLİRLİK: sunucu güvenlik gereği yalnız js/, css/ ve
       assets/ klasörlerini yayınlar (bkz. server.js statik yollar) + açıkça
       tanımlı birkaç kök dosya. Depoda VAR olması yetmez, tarayıcının
       indirebilmesi gerekir.
       ⚠ Bu gerçekten yaşandı: fark-sahneler.js depo KÖKÜNDEYDİ, /fark-sahneler.js
       404 dönüyordu, GVFark hiç oluşmuyor ve Fark Bulmaca "Sahne çizimleri
       yüklenemedi" hatasıyla hiç açılmıyordu. */
    const KOK_ISTISNA = ['sw.js'];
    const servisDisi = Object.keys(kayit).filter(
      y => !/^(js|css|assets)\//.test(y) && KOK_ISTISNA.indexOf(y) === -1);
    assert.strictEqual(servisDisi.length, 0,
      'bu betikler sunucudan SERVİS EDİLMİYOR (js/, css/ ya da assets/ altına taşıyın): ' +
      servisDisi.join(', '));
    console.log('  ✓ 2b) bağlanan her betik sunucunun yayınladığı bir klasörde');

    // 4) Düzeltmesi canlıya ulaşmayan dosyalar artık ESKİ etiketle olmamalı.
    //    (Bu dört dosya bire bir o olayın kurbanıydı; etiketleri geri
    //    düşerse aynı hata tekrar eder.)
    const ESKI = {
      'js/room-waiting-fix.js': '20260908b',
      'js/lobby-sync.js': '20260820f',
      'js/admin-panel.js': '20260908a',
      'js/messages.js': '20260908b'
    };
    Object.keys(ESKI).forEach(yol => {
      assert.ok(kayit[yol], yol + ' kayıtta olmalı');
      assert.notStrictEqual(kayit[yol].v, ESKI[yol],
        yol + ' hâlâ yayına ulaşmamış eski etiketi (' + ESKI[yol] + ') taşıyor');
    });
    console.log('  ✓ 3) canlıya ulaşmayan eski etiketler geri dönmemiş');

    console.log('OK sürüm damgası: içerik ile ?v= etiketleri eşleşiyor');
    process.exit(0);
  } catch (e) {
    console.error('SÜRÜM DAMGASI HATASI:', e && e.message);
    process.exit(1);
  }
})();
