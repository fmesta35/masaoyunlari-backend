/* Masa Oyunları — Masa görünümünü her ekrana ORANTILI sığdır (okey + 101).
 *
 *  Sorun: .okey-table genişliği kabına göre akışkandı ama iç parçalar (ıstaka,
 *  atık bölgeleri, deste) sabit px değerler taşıdığı için kenar çubuğu aç/kapa
 *  ya da pencere boyutu değişince görünüm "kayabiliyordu".
 *
 *  Çözüm: masa 1050×640 tasarım tuvaline sabitlenir ve kullanılabilir alana
 *  transform: scale ile ölçeklenir. Böylece:
 *   - İç geometri ve oranlar HER ZAMAN birebir korunur (kayma/bozulma yok).
 *   - Yazılar/vektörler net kalır (görüntü kalitesi düşmez).
 *   - PC / tablet / telefon, kenar çubuğu açık-kapalı: hepsine otomatik sığar.
 *
 *  Sürükle-bırak mekanikleri getBoundingClientRect kullandığı için ölçekli
 *  görünümle uyumludur (rect'ler ölçek sonrası koordinatları döndürür).
 *
 *  Yalnızca .okey-table hedeflenir; satranç/tavla tahtaları kendi akışkan
 *  oranlarıyla çalışmaya devam eder (çalışan sistemlere dokunulmaz).
 */
(function () {
  'use strict';

  var DESIGN_W = 1050;   // .okey-table max-width ile uyumlu tasarım genişliği
  var DESIGN_H = 640;    // masa yüksekliği (560-720 bandının güvenli ortası)

  function areaEl() { return document.getElementById('boardArea'); }

  function fit() {
    var area = areaEl();
    if (!area) return;
    var tbl = area.querySelector('.okey-table');
    if (!tbl) return;

    // Masa sabit-boyut sarıcıya alınır (sayfa yerleşiminin alanı budur).
    var wrap = document.getElementById('gvBoardFit');
    if (!wrap || !wrap.contains(tbl)) {
      wrap = document.createElement('div');
      wrap.id = 'gvBoardFit';
      wrap.style.cssText = 'position:relative;margin:0 auto;overflow:hidden';
      tbl.parentNode.insertBefore(wrap, tbl);
      wrap.appendChild(tbl);
    }

    var availW = Math.max(300, area.clientWidth || window.innerWidth);
    var availH = Math.max(340, window.innerHeight - 150); // üst bar + oda başlığı payı
    var s = Math.min(availW / DESIGN_W, availH / DESIGN_H, 1.15); // hafif büyütmeye izin

    tbl.style.width = DESIGN_W + 'px';
    tbl.style.height = DESIGN_H + 'px';
    tbl.style.maxWidth = 'none';
    tbl.style.maxHeight = 'none';
    tbl.style.minHeight = '0';
    tbl.style.transformOrigin = 'top left';
    tbl.style.transform = 'scale(' + s + ')';
    wrap.style.width = (DESIGN_W * s) + 'px';
    wrap.style.height = (DESIGN_H * s) + 'px';
  }

  var mo = null, ro = null;
  function boot() {
    var area = areaEl();
    if (!area) { setTimeout(boot, 400); return; }
    // Render'lar innerHTML'ı tepeden değiştirir: yeni masayı yakala + sığdır.
    mo = new MutationObserver(function () { fit(); });
    mo.observe(area, { childList: true, subtree: false });
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { fit(); }); ro.observe(area); }
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    // Kenar çubuğu 0.3 sn animasyonla kapanır/açılır: geçiş sonrası kesin oturtma
    // + seyrek güvenlik taraması (ucuzdur; hiçbir DOM değişikliği üretmez, yalnız stil).
    setInterval(fit, 1200);
    fit();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
