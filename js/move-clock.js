/* GameVerse — HAMLE (SIRA) SAATİ: sırası gelen oyuncunun KENDİ kartında
 * ================================================================
 * ÖNCESİ: hamle geri sayımı tahtanın üstünde ayrı bir rozetteydi
 * ("⏱ Hamle sırası: Siyah — 53 sn"). Kimin süresi aktığı ancak yazıyı
 * okuyarak anlaşılıyordu, rozet tahtayı aşağı itiyordu ve yalnız satranç
 * ile tavlada vardı.
 *
 * ŞİMDİ: geri sayım, üstteki süre şeridinde SIRASI GELEN oyuncunun kendi
 * kartının içinde görünür. Kart zaten vurgulu olduğu için "kimin sırası"
 * bakışta anlaşılır; tahta hiç kımıldamaz (alan her zaman ayrılmıştır).
 *
 * Tek yerde toplanmasının sebebi: aynı davranış satranç, tavla ve ortak
 * yaşam döngüsündeki (online-arena) yedi oyunun HEPSİNDE birebir aynı
 * olsun; her istemci kendi rozetini ayrı kurallarla çizmesin.
 *
 * KULLANIM:
 *   GVMoveClock.set({
 *     activeIndex,        // 0 | 1 → kart sırası (null: kartların .active'i korunur)
 *     remainingMs,        // sunucudan gelen kalan süre
 *     limitMs,            // hamle limiti (kırmızıya dönme eşiği için)
 *     serverNow,          // paketin sunucu saati (ağ gecikmesi düzeltmesi)
 *     mainClock           // false → kartta ana saat yok, geri sayım BÜYÜK gösterilir
 *   });
 *   GVMoveClock.clear();  // oyun bitti / oda değişti
 */
(function () {
  'use strict';
  if (window.GVMoveClock) return;

  var TICK_MS = 250;
  var state = null;     // {idx, remain, limit, at, mainClock}
  var timer = null;

  function strip() { return document.getElementById('topTimers'); }
  function cards() {
    var s = strip();
    return s ? Array.prototype.slice.call(s.querySelectorAll('.timer')) : [];
  }

  /* Her kartta geri sayım satırı BİR KEZ oluşturulur ve hep DOM'da kalır:
     görünürlükle yönetildiği için sayaç gelip gitse de kart yüksekliği
     değişmez, dolayısıyla tahta yerinden oynamaz. */
  function slot(card) {
    var el = card.querySelector('.timer-move');
    if (!el) {
      el = document.createElement('div');
      el.className = 'timer-move';
      el.setAttribute('aria-live', 'off');
      card.appendChild(el);
    }
    return el;
  }

  function paint() {
    var list = cards();
    if (!list.length) return;
    var s = strip();
    if (!state) {
      list.forEach(function (c) {
        var el = slot(c);
        if (el.textContent !== '') el.textContent = '';
        c.classList.remove('gv-turn');
        el.classList.remove('danger');
      });
      if (s) s.classList.remove('gv-nomain');
      return;
    }
    if (s) s.classList.toggle('gv-nomain', state.mainClock === false);

    var remain = Math.max(0, state.remain - (Date.now() - state.at));
    var secs = Math.ceil(remain / 1000);
    var danger = remain <= Math.min(20000, (state.limit || 60000) / 2);

    list.forEach(function (c, i) {
      var el = slot(c);
      var mine = (state.idx === i);
      if (mine) {
        var txt = state.mainClock === false ? (secs + ' sn') : ('⏱ ' + secs + ' sn');
        if (el.textContent !== txt) el.textContent = txt;
        if (el.classList.contains('danger') !== danger) el.classList.toggle('danger', danger);
      } else if (el.textContent !== '') {
        el.textContent = '';
        el.classList.remove('danger');
      }
      c.classList.toggle('gv-turn', mine);
      // activeIndex verildiyse vurguyu da bu katman yönetir (satranç/tavla
      // kendi .active mantığını sürdürdüğü için orada null geçilir).
      if (state.own) c.classList.toggle('active', mine);
    });
  }

  function start() {
    if (timer) return;
    timer = setInterval(paint, TICK_MS);
  }
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  window.GVMoveClock = {
    set: function (o) {
      o = o || {};
      var remain = Number(o.remainingMs);
      if (!isFinite(remain) || remain < 0) return this.clear();
      // Paketin yolda geçirdiği süreyi düş: geri sayım sunucuyla aynı anda biter.
      var lag = o.serverNow ? Math.max(0, Date.now() - Number(o.serverNow)) : 0;
      state = {
        idx: (o.activeIndex === 0 || o.activeIndex === 1) ? o.activeIndex : -1,
        own: (o.activeIndex === 0 || o.activeIndex === 1),
        remain: Math.max(0, remain - lag),
        limit: Number(o.limitMs) || 60000,
        at: Date.now(),
        mainClock: o.mainClock !== false
      };
      // activeIndex verilmediyse kartların kendi .active sınıfını izle.
      if (state.idx < 0) {
        var list = cards();
        for (var i = 0; i < list.length; i++) {
          if (list[i].classList.contains('active')) { state.idx = i; break; }
        }
      }
      paint();
      start();
    },
    clear: function () {
      state = null;
      paint();
      stop();
    },
    /* Teşhis/test: o an gösterilen saniye ve kart sırası */
    debug: function () {
      if (!state) return null;
      return { index: state.idx, secs: Math.ceil(Math.max(0, state.remain - (Date.now() - state.at)) / 1000) };
    }
  };

  // Odadan çıkışta / oyun değişiminde sayaç kendiliğinden susar.
  window.__gvOnlineResets = window.__gvOnlineResets || [];
  window.__gvOnlineResets.push(function () { window.GVMoveClock.clear(); });
  window.addEventListener('gv:roomLeft', function () { window.GVMoveClock.clear(); });
})();
