/* ============================================================================
 * 101 OKEY — EL AÇMA PENCERESİ
 * ============================================================================
 * Açma, masa üstünde yapılamayacak kadar çok adımlı: oyuncu birden fazla per
 * kurup toplamı en az 101'e taşımak zorunda. Istakada tek tek seçmeye
 * çalışmak hem telefonda hem webde karışıyordu; bu yüzden kendi penceresi
 * var:  taşa dokun → per sepetine düşer → "Peri Bitir" → sıradakini kur →
 * "Aç". Toplam puan canlı yazıyor, yani oyuncu 101'e ulaşıp ulaşmadığını
 * GÖNDERMEDEN önce görüyor.
 *
 * OTOMATİK ALGILAMA (kullanıcı isteği): "oyuncunun tahtasında sıraladığı /
 * dizdiği perlere göre otomatik algılayan ve gruplar halinde açılmasını
 * sağlayacak 'El Açma' seçeneği olması lazım, pratik." Pencere açılır açılmaz
 * ıstakanın ÜST ve ALT rafları soldan sağa taranır; boş göz gören yerde grup
 * biter. Her grup per kuralına göre sınanır, geçerli olanlar hazır per olarak
 * gelir. Oyuncu hiçbir şeyi elle dizmek zorunda kalmaz.
 *
 * TAŞ GERİ ALMA (kullanıcı isteği): "alt-üstlerde gerekirse taş
 * değiştirebilmeli el açarken, bir sonraki turda belki kendi işlemek
 * isteyecek veya karşı rakibin okey taşını koymasını engellemek amacıyla."
 * Bu yüzden perdeki HER taşın üstünde küçük bir ✕ var: tek taş geri alınır,
 * kalan taşlar hâlâ geçerli bir per ise per bozulmaz. Böylece oyuncu bir taşı
 * bilerek elinde tutabilir.
 *
 * Buradaki puan ve doğrulama yalnız YARDIMCI. Kuralın tamamı sunucuda
 * (okey101-engine.js) sınanıyor: taş gerçekten oyuncuda mı, perler geçerli mi,
 * toplam 101'e ulaşıyor mu. Pencere yanılsa bile sunucu yanlış açılışı
 * reddeder; bu dosyadaki doğrulayıcı motorun birebir kopyasıdır ve
 * test/okey101-algilama.test.js ikisinin aynı sonucu verdiğini ölçer.
 * ========================================================================= */
(function () {
  'use strict';
  var KUTU_ID = 'ok101AcKutu';
  var durum = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function okeyMi(t, ok) { return !!(ok && t && !t.isFJ && t.c === ok.c && t.n === ok.n); }
  function renkSinifi(t) { return t.isFJ ? (t.dc || 't-red') : t.c; }
  /* Sahte okeyin GERÇEK rengi göstergenin rengidir (t.dc): taşın üstünde
     joker resmi vardır ama oyunda göstergenin yerine geçer. */
  function renkOf(t) { return (t && t.isFJ) ? t.dc : (t && t.c); }

  /* ------------------------------------------------------------ PER DOĞRULAMA
     okey101-engine.js'teki perDogrula'nın istemci kopyası. Yalnız ÖNİZLEME
     içindir (hangi grup yeşil, hangisi kırmızı); kararı sunucu verir. */
  function perDogrula(tiles, realOkey) {
    var ts = (tiles || []).filter(Boolean);
    if (ts.length < 3) return { ok: false, sebep: 'per en az 3 taş olmalı' };
    var okeyler = ts.filter(function (t) { return okeyMi(t, realOkey); });
    var dogal = ts.filter(function (t) { return !okeyMi(t, realOkey); });
    if (okeyler.length > 1) return { ok: false, sebep: 'bir perde en fazla 1 okey' };
    if (dogal.length < 2) return { ok: false, sebep: 'perde en az 2 gerçek taş olmalı' };

    // KÜT: aynı sayı, farklı renkler
    var ayniSayi = dogal.every(function (t) { return t.n === dogal[0].n; });
    if (ayniSayi && ts.length <= 4) {
      var renkler = {}, adet = 0;
      dogal.forEach(function (t) { if (!renkler[renkOf(t)]) { renkler[renkOf(t)] = 1; adet++; } });
      if (adet === dogal.length) return { ok: true, tur: 'kut', puan: dogal[0].n * ts.length };
      if (ts.length === 3 || ts.length === 4) return { ok: false, sebep: 'kütte aynı renk iki kez olamaz' };
    }

    // SERİ: aynı renk, ardışık, 13→1 dönüşü yok
    var renk = renkOf(dogal[0]);
    if (!dogal.every(function (t) { return renkOf(t) === renk; })) {
      return { ok: false, sebep: 'ne küt ne seri' };
    }
    var sayilar = dogal.map(function (t) { return t.n; }).sort(function (a, b) { return a - b; });
    for (var i = 1; i < sayilar.length; i++) {
      if (sayilar[i] === sayilar[i - 1]) return { ok: false, sebep: 'seride aynı sayı iki kez olamaz' };
    }
    var enKucuk = sayilar[0], enBuyuk = sayilar[sayilar.length - 1];
    var aralik = enBuyuk - enKucuk + 1;
    var bosluk = aralik - sayilar.length;
    if (bosluk > okeyler.length) return { ok: false, sebep: 'seride boşluk var' };
    if (aralik + (okeyler.length - bosluk) > 13) return { ok: false, sebep: 'seri 13\'ü aşamaz' };

    var puan = sayilar.reduce(function (a, b) { return a + b; }, 0);
    if (okeyler.length) {
      if (bosluk === 1) puan = (enKucuk + enBuyuk) * aralik / 2;
      else puan += (enBuyuk < 13) ? enBuyuk + 1 : enKucuk - 1;
    }
    return { ok: true, tur: 'seri', puan: puan };
  }

  /* Çift doğrulama (5 çiftle açma yolu). */
  function ciftDogrula(ts, realOkey) {
    ts = (ts || []).filter(Boolean);
    if (ts.length !== 2) return { ok: false, sebep: 'çift 2 taş olmalı' };
    var okeyler = ts.filter(function (t) { return okeyMi(t, realOkey); });
    var dogal = ts.filter(function (t) { return !okeyMi(t, realOkey); });
    if (okeyler.length > 1) return { ok: false, sebep: 'çift iki okeyden oluşamaz' };
    if (okeyler.length === 1) return { ok: true };
    if (renkOf(dogal[0]) !== renkOf(dogal[1]) || dogal[0].n !== dogal[1].n) {
      return { ok: false, sebep: 'çift aynı renk ve aynı sayı olmalı' };
    }
    return { ok: true };
  }

  /* ------------------------------------------------------- ISTAKADAN ALGILAMA
     Raf = ıstakanın bir sırası; her göz ya bir taş ya boş. Oyuncu perlerini
     aralarına boşluk bırakarak dizer — dizilim zaten niyetin kendisidir.
     Soldan sağa taranır, BOŞ GÖZ grubu bitirir; her grup per (ya da çift)
     kuralıyla sınanır. Geçerli olanlar hazır gelir, geçersizler atlanır. */
  function raflardanAlgila(raflar, realOkey, cift) {
    var bulunan = [], atlanan = [];
    (raflar || []).forEach(function (raf) {
      if (!raf) return;
      var grup = [];
      function bitir() {
        if (!grup.length) return;
        var g = grup.slice(); grup = [];
        var s = cift ? ciftDogrula(g, realOkey) : perDogrula(g, realOkey);
        if (s.ok) bulunan.push(g);
        else if (g.length >= (cift ? 2 : 3)) atlanan.push({ tas: g, sebep: s.sebep });
      }
      for (var i = 0; i < raf.length; i++) {
        var t = raf[i];
        if (t) grup.push(t); else bitir();
      }
      bitir();
    });
    return { perler: bulunan, atlanan: atlanan };
  }

  function tasHtml(t, ok, secili) {
    return '<button type="button" class="ok101a-t ' + renkSinifi(t) +
      (okeyMi(t, ok) ? ' is-okey' : '') + (secili ? ' sec' : '') +
      '" data-id="' + esc(t.id) + '"><b>' + (t.n || '') + '</b><i></i></button>';
  }
  /* Perin İÇİNDEKİ taş: üstünde tek taşlık geri alma düğmesi taşır.
     Kullanıcı isteği: bir taşı perden çıkarıp elde tutabilmek (sonraki tur
     kendi işlemek ya da rakibe okey taşı bırakmamak için). */
  function perTasHtml(t, ok, perIdx) {
    return '<span class="ok101a-pt">' + tasHtml(t, ok, false) +
      '<button type="button" class="ok101a-tx" data-act="tas-cik" data-i="' + perIdx +
      '" data-id="' + esc(t.id) + '" title="Bu taşı elde tut">✕</button></span>';
  }

  function ciz() {
    var k = document.getElementById(KUTU_ID);
    if (!k || !durum) return;
    var d = durum;
    var kalan = d.eller.filter(function (t) { return d.kullanilan.indexOf(t.id) === -1; });
    var toplam = d.perler.reduce(function (a, p) { return a + d.puanla(p); }, 0);
    var sepetPuan = d.sepet.length ? d.puanla(d.sepet) : 0;
    var yeter = d.cift ? (d.perler.length >= d.ciftAdedi) : (toplam >= d.acmaPuani);

    var h = '';
    h += '<div class="ok101a-bas">';
    h += '<b>' + (d.cift ? '👯 Çift Açma' : '🎴 El Aç') + '</b>';
    h += '<button type="button" class="ok101a-x" data-act="kapat">✕</button>';
    h += '</div>';

    h += '<div class="ok101a-kip">';
    h += '<button type="button" class="ok101a-sek' + (d.cift ? '' : ' etkin') + '" data-act="kip-per">Perle aç (en az ' + d.acmaPuani + ')</button>';
    h += '<button type="button" class="ok101a-sek' + (d.cift ? ' etkin' : '') + '" data-act="kip-cift">' + d.ciftAdedi + ' çiftle aç</button>';
    h += '</div>';

    h += '<div class="ok101a-ozet' + (yeter ? ' tamam' : '') + '">';
    h += d.cift
      ? ('Hazır çift: <b>' + d.perler.length + ' / ' + d.ciftAdedi + '</b>')
      : ('Toplam: <b>' + toplam + '</b> / ' + d.acmaPuani + (yeter ? ' ✓' : ''));
    h += '</div>';

    /* ISTAKADAN ALGILA — pencere açılırken kendiliğinden çalışır, ıstakayı
       değiştirip tekrar denemek isteyen için düğme olarak da durur. */
    h += '<div class="ok101a-algi">';
    h += '<button type="button" class="ok101a-algila" data-act="algila">🪄 Istakadan algıla</button>';
    h += '<span class="ok101a-algi-not">' + esc(d.algiNot || 'Istakanda yan yana dizdiğin gruplar per olarak alınır.') + '</span>';
    h += '</div>';

    // Kurulan perler
    h += '<div class="ok101a-perler">';
    if (!d.perler.length) {
      h += '<div class="ok101a-bos">Henüz ' + (d.cift ? 'çift' : 'per') + ' kurmadın</div>';
    }
    d.perler.forEach(function (p, i) {
      var s2 = d.cift ? ciftDogrula(p, d.realOkey) : perDogrula(p, d.realOkey);
      h += '<div class="ok101a-per' + (s2.ok ? '' : ' hatali') + '">' +
           '<span class="ok101a-per-no">' + (i + 1) + '</span>';
      p.forEach(function (t) { h += perTasHtml(t, d.realOkey, i); });
      if (!d.cift) h += '<span class="ok101a-per-p">' + d.puanla(p) + '</span>';
      if (!s2.ok) h += '<span class="ok101a-per-hata">' + esc(s2.sebep || 'geçersiz') + '</span>';
      h += '<button type="button" class="ok101a-geri" data-act="per-sil" data-i="' + i + '" title="Bu peri boz">↩</button>';
      h += '</div>';
    });
    h += '</div>';

    // Kurulmakta olan per (sepet)
    h += '<div class="ok101a-sepet' + (d.sepet.length ? ' dolu' : '') + '">';
    h += '<span class="ok101a-et">' + (d.cift ? 'ÇİFT' : 'PER') + '</span>';
    if (!d.sepet.length) h += '<span class="ok101a-ipucu">Aşağıdan taş seç</span>';
    d.sepet.forEach(function (t) { h += tasHtml(t, d.realOkey, true); });
    if (!d.cift && d.sepet.length) h += '<span class="ok101a-per-p">' + sepetPuan + '</span>';
    h += '<button type="button" class="ok101a-ok" data-act="per-bitir"' +
         (d.sepet.length < (d.cift ? 2 : 3) ? ' disabled' : '') + '>' +
         (d.cift ? 'Çifti Bitir' : 'Peri Bitir') + '</button>';
    h += '</div>';

    // Elde kalan taşlar
    h += '<div class="ok101a-el">';
    kalan.forEach(function (t) { h += tasHtml(t, d.realOkey, false); });
    h += '</div>';

    h += '<div class="ok101a-alt">';
    h += '<span class="ok101a-not' + (kalan.length ? '' : ' uyari') + '">' +
         (kalan.length
           ? ('Elinde ' + kalan.length + ' taş kalıyor — atacak taşın var. Bir taşı elde tutmak için perdeki ✕\'e dokun.')
           : 'Elinin tamamını koyamazsın: atacak en az bir taş kalmalı.') + '</span>';
    h += '<button type="button" class="ok101a-ac" data-act="gonder"' +
         ((yeter && kalan.length) ? '' : ' disabled') + '>Aç</button>';
    h += '</div>';

    k.innerHTML = h;
  }

  /* Istakadaki dizilimden perleri kur. Elle kurulmuş perler varsa onları
     EZMEZ: yalnız henüz kullanılmamış taşlardan oluşan gruplar eklenir. */
  function algila(sessiz) {
    var d = durum;
    if (!d) return;
    var sonuc = raflardanAlgila(d.raflar, d.realOkey, d.cift);
    var eklenen = 0, kullanilanTas = 0;
    sonuc.perler.forEach(function (g) {
      // Bir taşı zaten kullanılmış grubu atla (elle kurulana dokunma).
      var cakisma = g.some(function (t) { return d.kullanilan.indexOf(t.id) !== -1; });
      if (cakisma) return;
      d.perler.push(g.slice());
      g.forEach(function (t) { d.kullanilan.push(t.id); kullanilanTas++; });
      eklenen++;
    });
    if (!sessiz || eklenen) {
      d.algiNot = eklenen
        ? ('🪄 ' + eklenen + ' grup algılandı (' + kullanilanTas + ' taş). İstemediğini ↩ ile boz, tek taşı ✕ ile elde tut.')
        : (sonuc.atlanan.length
            ? 'Istakanda geçerli per bulunamadı — taşları yan yana dizip aralarına boşluk bırak, sonra yeniden dene.'
            : 'Algılanacak yeni grup yok.');
    }
    ciz();
    return eklenen;
  }

  function tiklama(e) {
    var d = durum;
    if (!d) return;
    var t = e.target.closest('[data-act], .ok101a-t');
    if (!t) return;
    var act = t.getAttribute('data-act');

    if (act === 'kapat') return kapat();
    if (act === 'kip-per' || act === 'kip-cift') {
      d.cift = (act === 'kip-cift');
      d.perler = []; d.sepet = []; d.kullanilan = [];
      d.algiNot = '';
      algila(true);                       // yeni kipte ıstakayı yeniden tara
      return ciz();
    }
    if (act === 'algila') return algila(false);
    /* TEK TAŞI PERDEN ÇIKAR: kalanlar hâlâ geçerli bir per ise per yaşar;
       değilse per tamamen bozulur ve taşları ele döner (sessiz bir şekilde
       geçersiz per bırakmak, sunucuda reddedilmeye yol açardı). */
    if (act === 'tas-cik') {
      var pi = Number(t.getAttribute('data-i'));
      var tid = t.getAttribute('data-id');
      var per = d.perler[pi];
      if (!per) return;
      var kalanPer = per.filter(function (x) { return x.id !== tid; });
      var ky = d.kullanilan.indexOf(tid);
      if (ky !== -1) d.kullanilan.splice(ky, 1);
      var gec = d.cift ? ciftDogrula(kalanPer, d.realOkey) : perDogrula(kalanPer, d.realOkey);
      if (gec.ok) {
        d.perler[pi] = kalanPer;
        d.algiNot = 'Taş elinde tutuluyor; per geçerli kaldı.';
      } else {
        d.perler.splice(pi, 1);
        kalanPer.forEach(function (x) {
          var j = d.kullanilan.indexOf(x.id);
          if (j !== -1) d.kullanilan.splice(j, 1);
        });
        d.algiNot = 'Taş çıkınca per geçersiz kaldı, grup bozuldu — taşlar elinde.';
      }
      return ciz();
    }
    if (act === 'per-bitir') {
      if (d.sepet.length < (d.cift ? 2 : 3)) return;
      d.perler.push(d.sepet.slice());
      d.sepet = [];
      return ciz();
    }
    if (act === 'per-sil') {
      var i = Number(t.getAttribute('data-i'));
      var p = d.perler.splice(i, 1)[0] || [];
      p.forEach(function (x) {
        var j = d.kullanilan.indexOf(x.id);
        if (j !== -1) d.kullanilan.splice(j, 1);
      });
      return ciz();
    }
    if (act === 'gonder') {
      var gruplar = d.perler.map(function (p) { return p.map(function (x) { return x.id; }); });
      if (!gruplar.length) return;
      d.gonder(gruplar, d.cift);
      return kapat();
    }

    // Taşa dokunma: sepete al / sepetten çıkar
    var id = t.getAttribute('data-id');
    if (!id) return;
    var sepette = d.sepet.findIndex(function (x) { return x.id === id; });
    if (sepette !== -1) {
      d.sepet.splice(sepette, 1);
      var j2 = d.kullanilan.indexOf(id);
      if (j2 !== -1) d.kullanilan.splice(j2, 1);
      return ciz();
    }
    if (d.kullanilan.indexOf(id) !== -1) return;   // kurulmuş bir perde
    var tas = d.eller.find(function (x) { return x.id === id; });
    if (!tas) return;
    d.sepet.push(tas);
    d.kullanilan.push(id);
    ciz();
  }

  function kapat() {
    durum = null;
    var ov = document.getElementById(KUTU_ID + 'Ov');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function ac(secenek) {
    kapat();
    durum = {
      eller: (secenek.eller || []).slice(),
      /* Istakanın iki rafı (üst/alt), gözleriyle birlikte: dizilim burada
         okunur. Verilmezse algılama elin tamamını tek sıra kabul eder. */
      raflar: Array.isArray(secenek.raflar) && secenek.raflar.length
        ? secenek.raflar.map(function (r) { return (r || []).slice(); })
        : [(secenek.eller || []).slice()],
      algiNot: '',
      realOkey: secenek.realOkey,
      acmaPuani: Number(secenek.acmaPuani) || 101,
      ciftAdedi: Number(secenek.ciftAdedi) || 5,
      puanla: secenek.puanla || function () { return 0; },
      gonder: secenek.gonder || function () {},
      cift: false,
      perler: [],
      sepet: [],
      kullanilan: []
    };
    var ov = document.createElement('div');
    ov.id = KUTU_ID + 'Ov';
    ov.className = 'ok101a-ov';
    var kutu = document.createElement('div');
    kutu.id = KUTU_ID;
    kutu.className = 'ok101a-kutu';
    ov.appendChild(kutu);
    ov.addEventListener('click', function (e) { if (e.target === ov) kapat(); });
    kutu.addEventListener('click', tiklama);
    document.body.appendChild(ov);
    /* Pencere açılır açılmaz ıstakadaki dizilim perlere çevrilir: kullanıcı
       isteği "otomatik algılayan ve gruplar halinde açılmasını sağlayacak". */
    algila(true);
    ciz();
  }

  window.GVOkey101Ac = {
    ac: ac, kapat: kapat,
    /* Test/teşhis: doğrulayıcı ve algılayıcı dışarıdan da ölçülebilsin
       (motorla aynı sonucu verdiği test/okey101-algilama.test.js'te sınanır). */
    perDogrula: perDogrula, ciftDogrula: ciftDogrula, algila: raflardanAlgila,
    _durum: function () { return durum; }
  };
})();
