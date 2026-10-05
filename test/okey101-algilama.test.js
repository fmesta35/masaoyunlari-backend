'use strict';
/* ============================================================================
 * 101 OKEY — ISTAKADAN OTOMATİK PER ALGILAMA
 * ============================================================================
 * Kullanıcı isteği: "101 okey oyununda ortaya taş açarken, oyuncunun
 * tahtasında sıraladığı / dizdiği perlere göre otomatik algılayan ve gruplar
 * halinde açılmasını sağlayacak 'El Açma' seçeneği olması lazım, pratik.
 * Alt-üstlerde gerekirse taş değiştirebilmeli el açarken, bir sonraki turda
 * belki kendi işlemek isteyecek veya karşı rakibin okey taşını koymasını
 * engellemek amacıyla."
 *
 * NE DOĞRULANIR
 *   1) Istakanın iki rafındaki, aralarında boşluk bırakılmış gruplar per
 *      olarak algılanır; geçersiz dizilimler alınmaz.
 *   2) Pencere açılır açılmaz algılama çalışır; oyuncu elle dizmek zorunda
 *      değildir ve toplam puan 101'i geçtiğinde "Aç" açılır.
 *   3) Perdeki TEK TAŞ geri alınabilir: kalan taşlar hâlâ geçerli bir per ise
 *      per bozulmaz (oyuncu o taşı elinde tutar).
 *   4) Taş çıkınca per geçersiz kalıyorsa grup tamamen bozulur ve taşlar ele
 *      döner — sunucuya geçersiz per gönderilmez.
 *   5) İstemcideki doğrulayıcı, SUNUCU MOTORUYLA aynı sonucu verir (kopyanın
 *      zamanla sapmasını bu ölçü yakalar).
 *   6) Elin tamamı perlere girerse "Aç" kapalı kalır (atacak taş şart).
 * ========================================================================= */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const KOK = path.join(__dirname, '..');
const E = require(path.join(KOK, 'okey101-engine.js'));

/* Gösterge sarı 5 → gerçek okey sarı 6 (göstergenin bir üstü). */
const OKEY = { c: 't-yellow', n: 6 };
let sayac = 0;
function T(n, c) { return { id: 'tt' + (++sayac), n, c, isFJ: false }; }
function sahteOkey() { return { id: 'tt' + (++sayac), n: 5, c: 't-joker', isFJ: true, dc: 't-yellow' }; }
function okeyTasi() { return T(6, 't-yellow'); }

function pencere() {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = new JSDOM('<!doctype html><html><body></body></html>',
    { runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true, url: 'http://localhost/' });
  dom.window.eval(fs.readFileSync(path.join(KOK, 'js', 'okey101-ac.js'), 'utf8'));
  return dom;
}

/* Rafı 15 gözlük yap: verilen gruplar aralarında BİR BOŞ GÖZ ile dizilir. */
function raf(...gruplar) {
  const r = [];
  gruplar.forEach((g, i) => {
    if (i) r.push(null);
    g.forEach(t => r.push(t));
  });
  while (r.length < 15) r.push(null);
  return r;
}

function main() {
  const dom = pencere();
  const win = dom.window;
  const A = win.GVOkey101Ac;
  assert.ok(A && A.algila && A.perDogrula, 'açma penceresi algılayıcıyı dışa vermeli');

  // ---------- 1) DİZİLİMDEN ALGILAMA ----------
  {
    const seri = [T(10, 't-red'), T(11, 't-red'), T(12, 't-red')];          // 33
    const kut = [T(12, 't-yellow'), T(12, 't-red'), T(12, 't-blue')];       // 36
    const bozuk = [T(3, 't-red'), T(8, 't-blue'), T(11, 't-black')];        // ne küt ne seri
    const ust = raf(seri, kut);
    const alt = raf(bozuk, [T(1, 't-blue'), T(2, 't-blue')]);               // 2 taş: per değil
    const s = A.algila([ust, alt], OKEY, false);
    assert.strictEqual(s.perler.length, 2, 'iki geçerli grup algılanmalı');
    const idler = s.perler.map(p => p.map(t => t.id).join(','));
    assert.ok(idler.includes(seri.map(t => t.id).join(',')), 'seri algılanmalı');
    assert.ok(idler.includes(kut.map(t => t.id).join(',')), 'küt algılanmalı');
    assert.strictEqual(s.atlanan.length, 1, 'geçersiz grup atlananlara yazılmalı');
    console.log('  ✓ 1) ıstakadaki dizilimden perler algılanıyor, geçersizler alınmıyor');
  }

  // ---------- 2) PENCERE AÇILIR AÇILMAZ ALGILIYOR ----------
  {
    const seri = [T(10, 't-red'), T(11, 't-red'), T(12, 't-red')];          // 33
    const kut = [T(12, 't-yellow'), T(12, 't-red'), T(12, 't-blue')];       // 36
    const kut2 = [T(13, 't-red'), T(13, 't-blue'), T(13, 't-black')];       // 39
    const artan = [T(1, 't-black'), T(4, 't-blue')];                        // elde kalsın
    const eller = [].concat(seri, kut, kut2, artan);
    A.ac({
      eller: eller,
      raflar: [raf(seri, kut), raf(kut2, artan)],
      realOkey: OKEY,
      acmaPuani: 101, ciftAdedi: 5,
      puanla: p => (A.perDogrula(p, OKEY).puan || 0),
      gonder: () => {}
    });
    const kutu = win.document.getElementById('ok101AcKutu');
    assert.ok(kutu, 'pencere açılmalı');
    const d = A._durum();
    assert.strictEqual(d.perler.length, 3, 'üç grup kendiliğinden kurulmalı');
    assert.ok(/3 grup algılandı/.test(kutu.textContent), 'kullanıcıya kaç grup bulunduğu yazılmalı');
    assert.ok(/108/.test(kutu.textContent), 'toplam puan (33+36+39=108) gösterilmeli');
    const acDgm = kutu.querySelector('.ok101a-ac');
    assert.ok(acDgm && !acDgm.disabled, '101 aşıldığı için Aç açık olmalı');
    console.log('  ✓ 2) pencere açılınca gruplar hazır geliyor, 108 puanla Aç açılıyor');

    A.kapat();
  }

  // ---------- 3-4) TEK TAŞ GERİ ALMA ----------
  {
    /* 4 taşlı küt: bir taş çıkınca 3 taş kalır ve per GEÇERLİ kalmalı.
       Bir taş daha çıkınca 2 kalır ve per bozulmalı. */
    const kut4 = [T(9, 't-red'), T(9, 't-blue'), T(9, 't-black'), T(9, 't-yellow')];
    const artan = [T(1, 't-black'), T(4, 't-blue')];
    const win4 = pencere().window;
    const B = win4.GVOkey101Ac;
    B.ac({
      eller: [].concat(kut4, artan),
      raflar: [raf(kut4), raf(artan)],
      realOkey: OKEY, acmaPuani: 101, ciftAdedi: 5,
      puanla: p => (B.perDogrula(p, OKEY).puan || 0),
      gonder: () => {}
    });
    const d = B._durum();
    assert.strictEqual(d.perler.length, 1, '4 taşlı küt tek grup olarak algılanmalı');
    assert.strictEqual(d.perler[0].length, 4, 'dört taşın hepsi perde olmalı');

    function xDgm(id) {
      return Array.from(win4.document.getElementById('ok101AcKutu')
        .querySelectorAll('.ok101a-tx')).find(b => b.getAttribute('data-id') === id);
    }
    function tikla(el) { el.dispatchEvent(new win4.MouseEvent('click', { bubbles: true })); }

    // 3) bir taş çıkar → per yaşar
    const cikan = d.perler[0][3];
    const x1 = xDgm(cikan.id);
    assert.ok(x1, 'perdeki her taşın geri alma düğmesi olmalı');
    tikla(x1);
    assert.strictEqual(d.perler.length, 1, 'kalan 3 taş geçerli küt: per yaşamalı');
    assert.strictEqual(d.perler[0].length, 3, 'perden tek taş çıkmalı');
    assert.strictEqual(d.kullanilan.indexOf(cikan.id), -1, 'çıkan taş ele dönmeli');
    const kutuMetin = win4.document.getElementById('ok101AcKutu').textContent;
    assert.ok(/elinde tutuluyor/i.test(kutuMetin), 'taşın elde kaldığı bildirilmeli');
    /* Çıkan taş "elde kalanlar" şeridinde görünmeli: oyuncu onu sonraki tur
       kendi işleyebilsin ya da atmasın diye elinde tutuyor. */
    const el = win4.document.querySelector('#ok101AcKutu .ok101a-el');
    assert.ok(el.querySelector('[data-id="' + cikan.id + '"]'), 'çıkan taş elde görünmeli');
    console.log('  ✓ 3) perden tek taş geri alınabiliyor, kalan per geçerliyse bozulmuyor');

    // 4) bir taş daha çıkar → per bozulur
    const ikinci = d.perler[0][2];
    tikla(xDgm(ikinci.id));
    assert.strictEqual(d.perler.length, 0, '2 taş kalınca per bozulmalı');
    assert.strictEqual(d.kullanilan.length, 0, 'bozulan perin taşları ele dönmeli');
    assert.ok(/geçersiz kaldı/i.test(win4.document.getElementById('ok101AcKutu').textContent),
      'grubun neden bozulduğu yazılmalı');
    console.log('  ✓ 4) geçersiz kalan grup bozuluyor, taşlar ele dönüyor');
    B.kapat();
  }

  // ---------- 5) İSTEMCİ DOĞRULAYICISI MOTORLA AYNI ----------
  {
    const ornekler = [
      [T(5, 't-red'), T(6, 't-red'), T(7, 't-red')],                 // seri
      [T(5, 't-red'), T(5, 't-blue'), T(5, 't-black')],              // küt
      [T(5, 't-red'), T(5, 't-blue'), T(5, 't-blue')],               // kütte aynı renk
      [T(5, 't-red'), T(7, 't-red'), T(8, 't-red')],                 // boşluklu seri
      [T(12, 't-red'), T(13, 't-red'), T(1, 't-red')],               // 13→1 dönüşü
      [T(5, 't-red'), T(6, 't-red'), okeyTasi()],                    // okeyli seri
      [T(5, 't-red'), T(7, 't-red'), okeyTasi()],                    // okey boşluğu doldurur
      [okeyTasi(), okeyTasi(), T(5, 't-red')],                       // iki okey
      [sahteOkey(), T(6, 't-yellow'), T(7, 't-yellow')],             // sahte okey seriye girer
      [T(9, 't-red'), T(9, 't-blue'), T(9, 't-black'), T(9, 't-yellow')]
    ];
    const win2 = pencere().window;
    ornekler.forEach((g, i) => {
      const a = win2.GVOkey101Ac.perDogrula(g, OKEY);
      const b = E.perDogrula(g, OKEY);
      assert.strictEqual(!!a.ok, !!b.ok,
        'örnek ' + (i + 1) + ': istemci ve motor aynı kararı vermeli (istemci=' +
        a.ok + ' motor=' + b.ok + ')');
      if (b.ok) assert.strictEqual(a.puan, b.puan, 'örnek ' + (i + 1) + ': puan da aynı olmalı');
    });
    console.log('  ✓ 5) istemci doğrulayıcısı motorla birebir aynı sonucu veriyor');
  }

  // ---------- 6) ATACAK TAŞ KALMAZSA AÇ KAPALI ----------
  {
    const win3 = pencere().window;
    const seri = [T(10, 't-red'), T(11, 't-red'), T(12, 't-red')];
    const kut = [T(12, 't-yellow'), T(12, 't-red'), T(12, 't-blue')];
    const kut2 = [T(13, 't-red'), T(13, 't-blue'), T(13, 't-black')];
    const eller = [].concat(seri, kut, kut2);        // artan taş YOK
    win3.GVOkey101Ac.ac({
      eller: eller, raflar: [raf(seri, kut), raf(kut2)], realOkey: OKEY,
      acmaPuani: 101, ciftAdedi: 5,
      puanla: p => (win3.GVOkey101Ac.perDogrula(p, OKEY).puan || 0),
      gonder: () => {}
    });
    const kutu = win3.document.getElementById('ok101AcKutu');
    const ac = kutu.querySelector('.ok101a-ac');
    assert.ok(ac.disabled, 'elin tamamı perlere girdiyse Aç kapalı olmalı');
    assert.ok(/atacak en az bir taş/i.test(kutu.textContent), 'sebep yazılmalı');
    console.log('  ✓ 6) atacak taş kalmıyorsa Aç kapalı ve sebebi yazıyor');
  }

  // ---------- 7) OYUN İSTEMCİSİ RAFLARI GÖNDERİYOR ----------
  {
    const kod = fs.readFileSync(path.join(KOK, 'js', 'okey-online.js'), 'utf8');
    assert.ok(/raflar: ok101Raflar\(\)/.test(kod), 'açma penceresine ıstaka dizilimi verilmeli');
    assert.ok(/function ok101Raflar\(\)/.test(kod), 'raf okuyucu tanımlı olmalı');
    const sayfa = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
    assert.ok(/\.ok101a-algila\{/.test(sayfa), 'algılama düğmesinin stili olmalı');
    assert.ok(/\.ok101a-tx\{/.test(sayfa), 'tek taş geri alma düğmesinin stili olmalı');
    console.log('  ✓ 7) oyun istemcisi dizilimi gönderiyor, stiller yerinde');
  }

  console.log('OK 101 okey: ıstakadan otomatik per algılama ve taş geri alma');
}

try { main(); }
catch (e) { console.error('101 ALGILAMA HATASI:', e); process.exit(1); }
