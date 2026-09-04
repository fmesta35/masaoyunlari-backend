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
    var availH = Math.max(240, window.innerHeight - 140);

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
    publishVars(tbl);
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
    mo = new MutationObserver(function () { fit(); });
    mo.observe(area, { childList: true, subtree: false });
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { fit(); }); ro.observe(area); }
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    // Kenar çubuğu 0.3 sn animasyonla açılıp kapanır: geçiş sonrası kesin oturtma
    // (yalnız stil yazar, DOM üretmez — ucuzdur).
    setInterval(fit, 1200);
    fit();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
