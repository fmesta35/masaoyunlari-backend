/* Masa Oyunları — Okey / 101 Okey masasını her ekrana ORANTILI oturt.
 *
 *  ESKİ YAKLAŞIM (sorunluydu): masa 1050×640 sabit tuvale kilitlenip
 *  transform: scale ile küçültülüyordu. Ama masa İÇİNDEKİ taş/raf ölçüleri de
 *  ayrıca viewport medya sorgularıyla küçülüyordu → telefonda taşlar İKİ KEZ
 *  küçülüp okunmaz hale geliyordu; ayrıca sürüklenen taşın klonu <body>'de
 *  ölçeksiz kaldığı için imleçle hizalanmıyordu.
 *
 *  YENİ YAKLAŞIM:
 *   1) Masa normalde AKIŞKANDIR (ölçek 1). Taş oranı CSS'te aspect-ratio ile
 *      korunur, yani hiçbir yerde "sabit px taş" yoktur.
 *   2) Yalnızca kullanılabilir alan mantıklı bir alt sınırın (MIN_W/MIN_H)
 *      altına düşerse — çok dar telefon, çok alçak yatay ekran — masa o alt
 *      sınır tuvaline sabitlenip transform: scale ile KÜÇÜLTÜLÜR. Bu durumda
 *      da oran birebir korunur.
 *   3) Her ölçümde iki CSS değişkeni yayınlanır:
 *        --ok-tile-w : bir ıstaka slotunun genişliği (yazı/nokta boyu buna bağlı)
 *        --ok-rack-h : ıstakanın gerçek yüksekliği (TAŞ AT / oyuncu / butonlar
 *                      bu değere göre ıstakanın ÜSTÜNE oturur → çakışma yok)
 *   4) Sürükleme motoru (index.html) etkin ölçeği rect/offsetWidth oranından
 *      okur; burada ne yapılırsa yapılsın klon masadaki taşla aynı görünür.
 */
(function () {
  'use strict';

  var MIN_W = 560;   // bu genişliğin altında tuval sabitlenip küçültülür
  var MIN_H = 430;   // bu yüksekliğin altında tuval sabitlenip küçültülür

  function areaEl() { return document.getElementById('boardArea'); }

  /* GERÇEKTEN GÖRÜNEN YÜKSEKLİK.
     Telefon tarayıcılarında window.innerHeight, adres çubuğunun ARKASINDA
     kalan alanı da sayar: yatay çevrildiğinde 412 px "var" görünür ama
     gerçekte 330 px görünür. Tahtayı innerHeight'a göre sığdırınca alt
     kısmı adres çubuğunun altında kalıyor ve oyuncu "oyun alanı gelmedi"
     diyor (kullanıcı raporu). visualViewport, tarayıcı çubukları çıkarılmış
     GERÇEK görünür alanı verir; desteklenmeyen tarayıcıda innerHeight'a
     düşeriz. */
  function gorunurYukseklik() {
    var vv = window.visualViewport;
    var h = (vv && vv.height) ? vv.height : (window.innerHeight || 600);
    return Math.max(160, Math.round(h));
  }
  function gorunurGenislik() {
    var vv = window.visualViewport;
    var w = (vv && vv.width) ? vv.width : (window.innerWidth || 800);
    return Math.max(200, Math.round(w));
  }

  function unwrap(tbl) {
    // Eski sürümün bıraktığı sarıcıyı temizle (akışkan modda gerekmez).
    var wrap = document.getElementById('gvBoardFit');
    if (wrap && wrap.parentNode && wrap.contains(tbl)) {
      wrap.parentNode.insertBefore(tbl, wrap);
      wrap.parentNode.removeChild(wrap);
    }
  }

  function ensureWrap(tbl) {
    var wrap = document.getElementById('gvBoardFit');
    if (!wrap || !wrap.contains(tbl)) {
      wrap = document.createElement('div');
      wrap.id = 'gvBoardFit';
      wrap.style.cssText = 'position:relative;margin:0 auto;overflow:hidden';
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    }
    return wrap;
  }

  function publishVars(tbl) {
    // Slot genişliği: raf iç genişliği / 15 (çizimdeki slot adımıyla aynı).
    var shelf = tbl.querySelector('.ok-shelf-inner');
    if (shelf) {
      var w = shelf.offsetWidth || 0;
      if (w > 0) tbl.style.setProperty('--ok-tile-w', (w / 15).toFixed(2) + 'px');
    }
    var rack = tbl.querySelector('.ok-rack-wrap');
    if (rack) {
      var h = rack.offsetHeight || 0;
      if (h > 0) tbl.style.setProperty('--ok-rack-h', Math.round(h) + 'px');
    }
  }

  function fit() {
    var area = areaEl();
    if (!area) return;
    var tbl = area.querySelector('.okey-table');
    if (!tbl) { unwrapOrphan(); return; }

    var availW = Math.max(240, area.clientWidth || window.innerWidth);
    /* Kullanılabilir YÜKSEKLİK ölçülerek bulunur: sabit "innerHeight - 140"
       varsayımı, masanın sayfada nerede başladığını bilmiyordu. Yatay
       telefonda (412 px) ve tam ekranda masa alanı 170 px aşağıdan
       başlıyor; 140'lık sabit pay yüzünden okey masası ekranın altından
       ~32 px taşıyordu (ölçüldü). */
    var ust = 0;
    try { ust = Math.max(0, area.getBoundingClientRect().top); } catch (_) { ust = 140; }
    var availH = Math.max(200, gorunurYukseklik() - ust - 10);

    if (availW >= MIN_W && availH >= MIN_H) {
      // AKIŞKAN mod: CSS kendi işini yapar, hiçbir dönüşüm uygulanmaz.
      unwrap(tbl);
      if (tbl.style.transform) {
        tbl.style.transform = '';
        tbl.style.width = '';
        tbl.style.height = '';
        tbl.style.maxWidth = '';
        tbl.style.maxHeight = '';
        tbl.style.minHeight = '';
        tbl.style.transformOrigin = '';
      }
      publishVars(tbl);
      return;
    }

    // KÜÇÜLTME modu: alt sınır tuvaline sabitle, orantılı ölçekle.
    var DW = Math.max(MIN_W, availW);
    var DH = Math.max(MIN_H, availH);
    var s = Math.min(availW / DW, availH / DH, 1);
    var wrap = ensureWrap(tbl);
    tbl.style.width = DW + 'px';
    tbl.style.height = DH + 'px';
    tbl.style.maxWidth = 'none';
    tbl.style.maxHeight = 'none';
    tbl.style.minHeight = '0';
    tbl.style.transformOrigin = 'top left';
    tbl.style.transform = 'scale(' + s + ')';
    wrap.style.width = (DW * s) + 'px';
    wrap.style.height = (DH * s) + 'px';
    /* DÜZELTME TURU: ölçek uygulandıktan sonra düzen oturunca masanın
       başladığı nokta değişebiliyor (üstteki şeritler yeniden akıyor);
       gerçek kutuyu ölçüp gerekirse biraz daha küçültüyoruz. */
    for (var tur = 0; tur < 3; tur++) {
      var kutu = wrap.getBoundingClientRect();
      var sinir = gorunurYukseklik() - 8;
      if (kutu.bottom <= sinir + 1) break;
      var oran = Math.max(0.5, (sinir - kutu.top) / Math.max(1, kutu.height));
      s = Math.max(0.2, s * oran);
      tbl.style.transform = 'scale(' + s + ')';
      wrap.style.width = (DW * s) + 'px';
      wrap.style.height = (DH * s) + 'px';
    }
    publishVars(tbl);
  }

  /* ==========================================================================
     TÜM OYUNLAR: TAHTAYI GÖRÜNEN ALANA SIĞDIR (özellikle YATAY TELEFON)
     --------------------------------------------------------------------------
     Kullanıcı raporu: "Bilardo oyununda mobilde, ekranı yatay yatırdığımda
     veya tam ekran moduna geçtiğimde görüntüde kaymalar ve ekrana sığmama
     var. Tüm oyunlar için bu hatayı düzelt."
     ÖLÇÜLEN DURUM (gerçek Chromium, 915×412 ve 740×360 yatay):
       satranç alt taşması 76 px, dama 178, reversi 142, connect4 99,
       tavla 251, bilardo 499, amiral battı 567; TAM EKRANDA hepsi ~61 px.
     KÖK NEDEN: mobil kurallar yalnız GENİŞLİĞE bakıyordu (max-width:760px).
     Yatay çevrilince genişlik 740-915 px oluyor, masaüstü düzeni uygulanıyor
     ama YÜKSEKLİK 360-412 px'e düşüyor; hiçbir kural tahtayı yüksekliğe göre
     sınırlamıyordu.
     ÇÖZÜM: tahta doğal boyunda kalır; görünen alana sığmıyorsa ORANTILI
     küçültülür (transform: scale). Oran bozulmaz, düzen değişmez, yalnız
     ölçek küçülür. Dokunma/tıklama koordinatları getBoundingClientRect ile
     okunduğu için ölçek hesaba kendiliğinden katılır. Okey masası kendi
     mekanizmasıyla oturtulduğu için burada ATLANIR. */
  var OYUN_SARMAL = '.chess-wrapper,.dama-wrap,.tdama-wrap,.rv-wrap,.gm-wrap,' +
                    '.c4-wrap,.bil-wrap,.card-wrap,.bs-wrap,.tavla-wrap';
  var sigdirmaKilit = false;
  function sigdir() {
    var area = areaEl();
    if (!area) return;
    if (area.querySelector('.okey-table')) return;        // okey kendi yolunu kullanır
    var el = area.querySelector(OYUN_SARMAL);
    if (!el) { if (area.style.minHeight) area.style.minHeight = ''; return; }
    /* YALNIZ GEREKTİĞİNDE: alçak ekran (yatay telefon) ya da tam ekran.
       Normal masaüstü penceresinde sayfa zaten kaydırılabiliyor; orada
       tahtayı küçültmek düzeni gereksiz yere değiştirirdi. */
    var oda = document.getElementById('pg-room');
    var tamEkran = !!(oda && oda.classList.contains('gv-fs'));
    var kisaEkran = gorunurYukseklik() < 560;
    if (!tamEkran && !kisaEkran) {
      if (el.style.transform) { el.style.transform = ''; el.style.transformOrigin = ''; }
      if (area.style.minHeight) area.style.minHeight = '';
      return;
    }
    sigdirmaKilit = true;
    try {
      // Ölçüm doğal boyutta yapılır: önce varsa ölçek kaldırılır.
      if (el.style.transform) { el.style.transform = ''; el.style.transformOrigin = ''; }
      area.style.minHeight = '';
      var r = area.getBoundingClientRect();
      var altPay = 10;
      var kullanY = Math.max(140, gorunurYukseklik() - r.top - altPay);
      var kullanG = Math.max(200, Math.min(area.clientWidth || r.width, gorunurGenislik()));
      var dogalY = Math.max(1, el.scrollHeight || el.offsetHeight);
      var dogalG = Math.max(1, el.scrollWidth || el.offsetWidth);
      var s = Math.min(kullanY / dogalY, kullanG / dogalG, 1);
      /* Oran "sığıyor" dese bile GERÇEK kutuyu doğrulayacağız: bazı oyunlarda
         (bilardo, amiral battı) sarmalayıcının dışına taşan kumanda/günlük
         şeritleri var ve scrollHeight gerçeği tam yansıtmıyor. */
      var gercekTasma = el.getBoundingClientRect().bottom >
                        ((window.innerHeight || 600) - altPay) + 1;
      if (s >= 0.995 && !gercekTasma) return;              // zaten sığıyor
      /* Alt sınır ekrana göre: yatay telefonda (yükseklik < 500 px) bilardo
         ve amiral battı gibi uzun masalar 0.35'e sıkışıp yine taşıyordu;
         alçak ekranlarda daha fazla küçülmeye izin veriyoruz. */
      /* Alt sınır görünür alana göre kademeli: adres çubuğu açık yatay
         telefonda (görünen ~320 px) bilardo/amiral battı gibi uzun masalar
         0.24'e sıkışıp yine taşıyordu. Çok dar alanda daha fazla
         küçülmeye izin veriyoruz — küçük ama TAM görünür bir masa,
         yarısı ekran dışında kalan bir masadan iyidir. */
      var gy = gorunurYukseklik();
      var altSinir = gy < 380 ? 0.16 : (gy < 500 ? 0.24 : 0.45);
      s = Math.max(altSinir, Math.min(1, s));
      el.style.transformOrigin = 'top center';
      el.style.transform = 'scale(' + s.toFixed(4) + ')';
      // Ölçekli kutu kadar yer ayır (altta boşluk/kayma olmasın).
      area.style.minHeight = Math.ceil(dogalY * s) + 'px';
      /* DÜZELTME TURU: bazı oyunlarda (bilardo, amiral battı) sarmalayıcının
         altında kumanda/günlük şeridi var; ölçek uygulandıktan sonra düzen
         oturunca birkaç piksel taşma kalabiliyordu. Gerçek kutuyu yeniden
         ölçüp gerekirse biraz daha küçültüyoruz — ölçüm, tahmin değil. */
      for (var tur = 0; tur < 4; tur++) {
        var kutu = el.getBoundingClientRect();
        var sinir = gorunurYukseklik() - altPay;
        if (kutu.bottom <= sinir + 1) break;
        var oran = Math.max(0.5, (sinir - kutu.top) / Math.max(1, kutu.height));
        s = Math.max(altSinir, s * oran);
        el.style.transform = 'scale(' + s.toFixed(4) + ')';
        area.style.minHeight = Math.ceil(dogalY * s) + 'px';
      }
    } finally {
      // Kendi yazdığımız stiller gözlemciyi tetiklemesin.
      setTimeout(function () { sigdirmaKilit = false; }, 0);
    }
  }

  function unwrapOrphan() {
    var wrap = document.getElementById('gvBoardFit');
    if (wrap && !wrap.querySelector('.okey-table') && wrap.parentNode) {
      wrap.parentNode.removeChild(wrap);
    }
  }

  var mo = null, ro = null;
  function boot() {
    var area = areaEl();
    if (!area) { setTimeout(boot, 400); return; }
    /* Tek geçiş bazen erken kalıyor: tahta çizildikten sonra yazı tipleri,
       tuval ve şeritler oturunca yükseklik değişebiliyor. Her tetikten
       sonra kısa bir gecikmeyle İKİNCİ bir ölçüm yapıyoruz (borçlanma
       yok: ikinci geçiş yalnız gerekiyorsa stil yazar). */
    var ikinci = null;
    var hepsi = function () {
      if (sigdirmaKilit) return;
      fit(); sigdir();
      if (ikinci) clearTimeout(ikinci);
      ikinci = setTimeout(function () { ikinci = null; fit(); sigdir(); }, 320);
    };
    mo = new MutationObserver(hepsi);
    mo.observe(area, { childList: true, subtree: false });
    if (window.ResizeObserver) { ro = new ResizeObserver(hepsi); ro.observe(area); }
    window.addEventListener('resize', hepsi);
    window.addEventListener('orientationchange', function () {
      // Döndürme sonrası düzen birkaç kare sonra oturuyor: iki kez ölç.
      setTimeout(hepsi, 120); setTimeout(hepsi, 450); setTimeout(hepsi, 900);
    });
    /* Adres çubuğu kayarken görünür alan değişir — o da yeniden ölçülmeli. */
    if (window.visualViewport) {
      try {
        window.visualViewport.addEventListener('resize', hepsi);
        window.visualViewport.addEventListener('scroll', hepsi);
      } catch (_) {}
    }
    // Tam ekrana girip çıkmak da kullanılabilir yüksekliği değiştirir.
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (ev) {
      try { document.addEventListener(ev, function () { setTimeout(hepsi, 120); }); } catch (_) {}
    });
    // Kenar çubuğu 0.3 sn animasyonla açılıp kapanır: geçiş sonrası kesin oturtma
    // (yalnız stil yazar, DOM üretmez — ucuzdur).
    setInterval(hepsi, 700);
    hepsi();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
