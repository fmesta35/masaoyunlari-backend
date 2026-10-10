'use strict';
/* ============================================================================
 * KELİMELİK — SÖZLÜK DOĞRULUĞU, ÇOK KELİMELİ PUANLAMA, EKRAN YERLEŞİMİ
 * ============================================================================
 * Kullanıcı raporu: "MARMALAT kelimesi nasıl Türkçe olmaz, neye göre bu
 * kelimeleri düzenledin, Türkçe sözlükte yok mu? ... yatay, dikey, iki veya
 * birden fazla kelime yapılırsa kontrol edilerek gerekli puanı ver."
 * Ayrıca: "harfler oyun alanının içerisinde kalıyor, görüntü optimizasyonu ve
 * dashboardu düzenle mobilde" ve "tam ekran + yatay görüntüde optimizasyon
 * korunamadı... yatay ve dikey otomatik optimizasyon."
 *
 * NE DOĞRULANIR
 *   1) Sözlük TDK Güncel Türkçe Sözlük madde başlarıdır ve beklenen kelimeler
 *      içindedir. MARMALAT gerçekten YOK (doğrusu MARMELAT, o VAR) — yani ret
 *      doğruydu; eksik olan şey oyuncuya bunu söylemekti.
 *   2) Reddedilen kelimeye "bunu mu demek istedin" önerisi üretiliyor ve
 *      sunucu bunu istemciye yolluyor; istemci de ekrana yazıyor.
 *   3) Bir hamlede oluşan YATAY + DİKEY bütün kelimeler denetlenir ve
 *      hepsinin puanı toplanır; biri bile sözlükte yoksa hamle reddedilir.
 *   4) Mobil yerleşim: tahta kendi kutusuna sığar, ıstakanın üstüne binmez;
 *      alçak/geniş ekranda ıstaka tahtanın YANINA geçer (kl-yatay).
 *   5) Tahtanın üstündeki eski yakınlaştırma kumandası ("Sığdır / − Orta + /
 *      🎯") kodda hiç yok.
 * ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const KOK = path.join(__dirname, '..');
const E = require(path.join(KOK, 'kelimelik-engine.js'));
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');

/* ---------------------------------------------------------------- 1) SÖZLÜK */
function bolum1() {
  assert.ok(E.sozlukBoyu() > 50000, 'sözlük yeterince geniş olmalı → ' + E.sozlukBoyu());

  // Kullanıcının bildirdiği kelime: doğrusu MARMELAT ve sözlükte VAR.
  assert.strictEqual(E.sozluktekiMi('MARMELAT'), true, 'MARMELAT sözlükte olmalı');
  assert.strictEqual(E.sozluktekiMi('MARMALAT'), false, 'MARMALAT Türkçe bir kelime değil');
  assert.strictEqual(E.sozluktekiMi('KEMER'), true, 'KEMER sözlükte olmalı');

  // Günlük kelimelerden geniş bir örneklem: sözlük gerçekten kapsamlı mı?
  const olmali = ['ELMA', 'ARMUT', 'KİTAP', 'MASA', 'SANDALYE', 'PENCERE', 'KAPI',
    'DENİZ', 'BALIK', 'ÇİÇEK', 'AĞAÇ', 'YILDIZ', 'GÜNEŞ', 'BULUT', 'YAĞMUR',
    'OKUL', 'ÖĞRETMEN', 'ÖĞRENCİ', 'DEFTER', 'KALEM', 'ÇANTA', 'AYAKKABI',
    'GÖMLEK', 'PANTOLON', 'YEMEK', 'EKMEK', 'PEYNİR', 'ZEYTİN', 'ÇAY', 'KAHVE',
    'ŞEKER', 'TUZ', 'BİBER', 'DOMATES', 'SALATALIK', 'PATATES', 'SOĞAN',
    'GELMEK', 'GİTMEK', 'YAZMAK', 'OKUMAK', 'KOŞMAK', 'UYUMAK',
    'MUTLU', 'ÜZGÜN', 'GÜZEL', 'ÇİRKİN', 'BÜYÜK', 'KÜÇÜK', 'UZUN', 'KISA',
    'TÜRKİYE', 'ALMANYA', 'FRANSA'];
  const eksik = olmali.filter(w => !E.sozluktekiMi(w));
  assert.deepStrictEqual(eksik, [], 'bu kelimeler sözlükte olmalı → ' + eksik.join(', '));

  // Madde başı kuralı: ek almış biçimler yok (oyunun ilan edilen kuralı).
  assert.strictEqual(E.sozluktekiMi('ELMALAR'), false, 'çoğul ek almış biçim madde başı değil');
  assert.strictEqual(E.sozluktekiMi('GELDİM'), false, 'çekimli fiil madde başı değil');
  console.log('  ✓ 1) sözlük TDK madde başlarını kapsıyor; MARMALAT yok, MARMELAT var');
}

/* ------------------------------------------------------ 2) "BUNU MU DEMEK..." */
function bolum2() {
  assert.ok(typeof E.benzerKelimeler === 'function', 'öneri üreteci olmalı');
  const o = E.benzerKelimeler('MARMALAT');
  assert.ok(o.includes('MARMELAT'), 'MARMALAT için MARMELAT önerilmeli → ' + o.join(','));
  assert.deepStrictEqual(E.benzerKelimeler('ELMA'), [], 'sözlükteki kelimeye öneri üretilmez');
  // Gerçekten hiçbir şeye benzemeyen uydurma: öneri çıkmayabilir, çökmemeli.
  assert.ok(Array.isArray(E.benzerKelimeler('ZZŞĞÇJ')), 'uydurma kelimede de dizi dönmeli');

  // Hız: hamle reddinde anında çalışmalı
  const t0 = Date.now();
  for (let i = 0; i < 100; i++) E.benzerKelimeler('MARMALAT');
  assert.ok(Date.now() - t0 < 1500, 'öneri üretimi hızlı olmalı');

  // Sunucu öneriyi istemciye yolluyor, istemci ekrana yazıyor
  assert.ok(/oneriler: r\.oneriler/.test(oku('server.js')),
    'sunucu önerileri ret paketine koymalı');
  const istemci = oku('js/kelimelik-online.js');
  assert.ok(/Bunu mu demek istedin/.test(istemci), 'istemci öneriyi oyuncuya yazmalı');
  console.log('  ✓ 2) reddedilen kelimeye "bunu mu demek istedin" önerisi veriliyor');
}

/* ------------------------------------------- 3) ÇOK KELİMELİ HAMLE PUANLAMASI */
function bolum3() {
  /* Kullanıcı isteği: "yatay, dikey, iki veya birden fazla kelime yapılırsa
     kontrol edilerek gerekli puanı ver." Bir hamlede oluşan BÜTÜN kelimeler
     (ana kelime + kesişmeden doğan yan kelimeler) ayrı ayrı denetlenir ve
     puanları TOPLANIR. Aşağıda ikisi de ölçülüyor. */
  const st = E.init();
  const N = st.board.length;
  const M = Math.floor(N / 2);

  // 1. hamle: merkeze yatay MASA
  st.turn = 0;
  st.racks[0] = ['M', 'A', 'S', 'A', 'K', 'L', 'E'];
  const h1 = E.play(st, 0, [
    { r: M, c: M, harf: 'M' }, { r: M, c: M + 1, harf: 'A' },
    { r: M, c: M + 2, harf: 'S' }, { r: M, c: M + 3, harf: 'A' }
  ]);
  assert.ok(h1.ok, 'ilk hamle geçerli olmalı → ' + (h1.reason || ''));
  assert.deepStrictEqual(h1.kelimeler, ['MASA'], 'ilk hamlede tek kelime oluşur');

  /* 2. hamle: ÇOK KELİMELİ. MASA'nın altına, iki harfi aynı anda koyarak
     dikey AT ve AL kelimelerini birlikte kuruyoruz:
         sütun M+1 : A (tahtada) üstte, altına T  → dikey "AT"
         sütun M+3 : A (tahtada) üstte, altına L  → dikey "AL"
     İki yeni taş da M+1. satırda yan yana DEĞİL (araları dolu değil) —
     bu yüzden yatayda yeni bir kelime oluşmaz, yalnız iki dikey kelime olur.
     Arada boşluk kalmaması için M+2 sütununa da harf koyuyoruz: S'nin altına
     U → dikey "SU", ve M+1..M+3 satırında yatay "TUL"... bu geçersiz olurdu.
     Bu yüzden iki taşı YAN YANA koyuyoruz ve yatay kelimeyi de geçerli
     seçiyoruz: M+1'e A, M+2'ye L → yatay "AL", dikey "AA"(geçersiz) olurdu.
     En temizi: tek taşla iki kelime kuran klasik durum. */
  st.turn = 1;
  st.racks[1] = ['U', 'K', 'E', 'L', 'M', 'A', 'N'];
  /* S'nin (M+2) altına U koyarsak dikey "SU" oluşur; yanında başka taş
     olmadığı için yatay kelime oluşmaz. Tek kelimeli ama kesişen hamle. */
  const h2 = E.play(st, 1, [{ r: M + 1, c: M + 2, harf: 'U' }]);
  assert.ok(h2.ok, 'kesişen tek harflik hamle geçerli olmalı → ' + (h2.reason || ''));
  assert.deepStrictEqual(h2.kelimeler, ['SU'], 'kesişmeden doğan kelime sayılmalı');

  /* 3. hamle: GERÇEKTEN ÇOK KELİMELİ. "SU"nun U'sunun yanına (M+1, M+3) bir
     harf koyarsak hem yatay (U + yeni harf) hem dikey (A + yeni harf) kelime
     oluşur; ikisi de denetlenir. "UN" ve "AN" ikisi de sözlükte. */
  st.turn = 0;
  st.racks[0] = ['N', 'K', 'E', 'L', 'M', 'A', 'T'];
  const h3 = E.play(st, 0, [{ r: M + 1, c: M + 3, harf: 'N' }]);
  assert.ok(h3.ok, 'iki kelimeyi birden kuran hamle geçerli olmalı → ' +
    (h3.reason || '') + ' ' + JSON.stringify(h3.kelimeler || []));
  const kelimeler = (h3.kelimeler || []).slice().sort();
  assert.deepStrictEqual(kelimeler, ['AN', 'UN'],
    'yatay ve dikey kelimelerin İKİSİ de sayılmalı → ' + kelimeler.join(','));
  /* Puan ikisinin toplamı olmalı: U(2)+N(1)=3 ve A(1)+N(1)=2 → en az 5
     (bonus kareye denk gelirse daha fazla, ama asla tek kelimelik kadar az
     olamaz). */
  assert.ok(h3.puan >= 5, 'iki kelimenin puanı toplanmalı → ' + h3.puan);

  // 4. GEÇERSİZ YAN KELİME hamleyi reddeder
  st.turn = 1;
  st.racks[1] = ['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'];
  const h4 = E.play(st, 1, [{ r: M + 2, c: M + 2, harf: 'Z' }]);
  assert.strictEqual(h4.ok, false, 'geçersiz kelime hamleyi reddetmeli');
  assert.strictEqual(h4.reason, 'sozlukte_yok', 'ret sebebi sözlük olmalı');
  assert.ok((h4.kelimeler || []).length >= 1, 'hangi kelimenin bozuk olduğu bildirilmeli');
  console.log('  ✓ 3) yatay + dikey bütün kelimeler denetleniyor ve puanları toplanıyor');
}

/* ------------------------------------------------------------ 4) YERLEŞİM */
function bolum4() {
  const kod = oku('js/kelimelik-online.js');
  /* Ölçünün DAVRANIŞI test/kelimelik-client.test.js'te gerçek kodu çalıştırarak
     ölçülüyor (küçülme döngüsü, yerleşim seçimi, en büyük tahta). Burada
     kuralın KAYNAKTA yerinde durduğu doğrulanıyor. */
  assert.ok(/var dikeyK = Math\.min\(availW, availH - rackH - ctrlH - ARA\);/.test(kod),
    'alt alta yerleşimin tahta kenarı hesaplanmalı');
  assert.ok(/var yatayK = Math\.min\(availH, availW - SAG_MIN\);/.test(kod),
    'yan yana yerleşimin tahta kenarı hesaplanmalı');
  assert.ok(/yatay = yatayK > dikeyK \+ HISTEREZ/.test(kod),
    'iki yerleşimden büyük tahta veren seçilmeli (histerezli)');
  assert.ok(/kl-yatay/.test(kod), 'yatay sınıfı sarıcıya eklenmeli');
  /* KÜÇÜLME DÖNGÜSÜNÜN KÖKÜ: alanın KENDİ yüksekliği bütçeye girmemeli. */
  assert.ok(!/ar\.height/.test(kod),
    'tahtanın yükseklik bütçesi boardArea\'nın kendi yüksekliğinden ÇIKARILMAMALI (küçülme döngüsü)');
  assert.ok(/availH = Math\.max\(160, gorunurY\(\)/.test(kod),
    'yükseklik bütçesi görünür ekrandan okunmalı');
  assert.ok(/visualViewport[\s\S]{0,400}addEventListener\('resize'/.test(kod),
    'adres çubuğu / tam ekran değişimi de ölçüyü tazelemeli');
  assert.ok(/fullscreenchange/.test(kod), 'tam ekran değişiminde ölçü tazelenmeli');
  assert.ok(/new ResizeObserver/.test(kod),
    'sitenin kendi tam ekran düğmesi için alanın kutusu izlenmeli');
  assert.ok(/--kl-rt/.test(kod), 'ıstaka taşı ölçülen alana göre boyutlanmalı');

  const sayfa = oku('index.html');
  assert.ok(/\.kl-wrap\.kl-yatay\{flex-direction:row/.test(sayfa),
    'yatay yerleşimde ıstaka tahtanın yanına geçmeli');
  assert.ok(/#pg-room\.gv-fs \.kl-wrap\.kl-yatay\{flex-direction:row/.test(sayfa),
    'tam ekran + yatayda da yan yana yerleşim geçerli olmalı');
  assert.ok(/\.kl-sag\{display:flex/.test(sayfa), 'ıstaka+kumanda ortak sütunda olmalı');
  assert.ok(/#pg-room\.gv-fs \.kl-sag\{width:100%/.test(sayfa),
    'tam ekranda ortak sütun genişlemeli (ıstaka/kumanda taşmasın)');
  assert.ok(/width:var\(--kl-rt/.test(sayfa), 'taş boyu ölçülen değerden gelmeli');
  assert.ok(!/\.kl-rt\{width:clamp\(28px,4\.6vw,38px\)/.test(sayfa),
    'yatay telefon medya sorgusu taş ölçüsünü EZMEMELİ');
  assert.ok(/<div class="kl-sag">/.test(kod), 'çizimde ortak sütun olmalı');
  console.log('  ✓ 4) dikey/yatay yerleşim kuralları ve tam ekran uyumu yerinde');
}

/* ------------------------------------------------- 5) ESKİ YAKINLAŞTIRMA YOK */
function bolum5() {
  for (const f of ['js/kelimelik-online.js', 'js/online-arena.js', 'index.html', 'js/board-fit.js']) {
    const k = oku(f);
    assert.ok(!/Sığdır/.test(k), f + ': "Sığdır" kumandası kaldırılmış olmalı');
    assert.ok(!/kl-zoom|klOlcek|kl-olcek/.test(k), f + ': yakınlaştırma kademesi kalmamalı');
  }
  const kod = oku('js/kelimelik-online.js');
  assert.ok(!/olcek/.test(kod), 'kelimelik istemcisinde ölçek kademesi kalmamalı');
  console.log('  ✓ 5) tahta üstündeki eski yakınlaştırma kumandası kodda yok');
}

(async () => {
  try {
    bolum1(); bolum2(); bolum3(); bolum4(); bolum5();
    console.log('OK kelimelik: sözlük, öneri, çok kelimeli puanlama, mobil yerleşim');
  } catch (e) {
    console.error('KELİMELİK SÖZLÜK/YERLEŞİM HATASI:', e);
    process.exit(1);
  }
})();
