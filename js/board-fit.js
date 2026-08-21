/* GameVerse - tüm masa görünümlerini oranı bozmadan kullanılabilir alana sığdırır. */
(function () {
  'use strict';
  var DESIGN_W = 1050;
  var DESIGN_H = 640;
  var raf = 0;

  function fitOkey() {
    var area = document.getElementById('boardArea');
    if (!area) return;
    var table = area.querySelector('.okey-table');
    if (!table) return;

    var wrap = document.getElementById('gvBoardFit');
    if (!wrap || !wrap.contains(table)) {
      wrap = document.createElement('div');
      wrap.id = 'gvBoardFit';
      wrap.style.cssText = 'position:relative;margin:0 auto;overflow:hidden;max-width:100%';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }

    /* boardArea'ın clientWidth'i sidebar animasyonunun ilk karesinde eski
       kalabilir. Birkaç piksel güvenlik payı, yatay kaydırma oluşmasını önler. */
    var width = Math.max(1, area.clientWidth || area.getBoundingClientRect().width || window.innerWidth);
    /* wrapper yüksekliği ölçeklenmiş yüksekliğe eşit olduğu için onu tekrar
       ölçmek her çağrıda küçülme üretir; dikey kapasiteyi viewporttan al. */
    var height = Math.max(320, window.innerHeight - 150);
    var availableW = Math.max(240, width - 2);
    var availableH = Math.max(280, height - 2);
    var scale = Math.min(availableW / DESIGN_W, availableH / DESIGN_H, 1.35);

    table.style.width = DESIGN_W + 'px';
    table.style.height = DESIGN_H + 'px';
    table.style.maxWidth = 'none';
    table.style.maxHeight = 'none';
    table.style.minHeight = '0';
    table.style.transformOrigin = 'top left';
    table.style.transform = 'scale(' + scale + ')';
    wrap.style.width = (DESIGN_W * scale) + 'px';
    wrap.style.height = (DESIGN_H * scale) + 'px';
  }

  function fitOtherBoards() {
    /* Satranç, tavla ve diğer oyunlar zaten max-width/aspect-ratio ile
       akışkandır. Bu sınıf, boardArea flex çocuğunun dar ekranda taşmasını
       garanti altına alır; hiçbir oyun motorunun koordinatını değiştirmez. */
    var area = document.getElementById('boardArea');
    if (!area) return;
    area.style.minWidth = '0';
    area.style.maxWidth = '100%';
    Array.prototype.forEach.call(area.children, function (child) {
      if (!child.id || child.id !== 'gvBoardFit') {
        child.style.maxWidth = '100%';
        child.style.boxSizing = 'border-box';
      }
    });
  }

  function fit() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(function () { raf = 0; fitOkey(); fitOtherBoards(); });
  }

  function boot() {
    var area = document.getElementById('boardArea');
    if (!area) { setTimeout(boot, 300); return; }
    new MutationObserver(fit).observe(area, { childList: true, subtree: true });
    if (window.ResizeObserver) new ResizeObserver(fit).observe(area);
    /* Sidebar display:none değişimi boardArea boyunu her tarayıcıda Resize
       Observer ile bildirmeyebilir. Body class'ını da izleyip geçiş sonrası
       yeniden ölçüyoruz. */
    new MutationObserver(fit).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', fit, { passive: true });
    window.addEventListener('orientationchange', fit, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', fit, { passive: true });
    setTimeout(fit, 0);
    setTimeout(fit, 350);
    setTimeout(fit, 700);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
