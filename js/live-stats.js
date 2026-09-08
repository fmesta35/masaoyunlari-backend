/* GameVerse — CANLI SAYAÇLAR
 * =========================
 * Ana sayfadaki karşılama kutusunda ve İstatistikler sayfasında görünen
 * sayılar SABİT yazılmıştı: siteye kim girerse girsin "3.421 çevrimiçi,
 * 1.205 aktif oda, 32 turnuva" görüyordu. Bu modül aynı alanları
 * sunucudaki GERÇEK durumla doldurur (/api/live-stats — herkese açık,
 * kişisel veri taşımaz).
 *
 * Turnuva motoru henüz yok: sunucu 0 döner ve burada "—" yerine 0
 * gösterilir. Uydurma sayı yazmıyoruz.
 */
(function () {
  'use strict';
  if (window.GVLiveStats) return;

  var BACKEND = String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  var PERIYOT = 20000;
  var son = null;
  var timer = null;

  function yaz(id, deger) {
    var el = document.getElementById(id);
    if (!el) return;
    var t = (deger === null || deger === undefined) ? '—' : Number(deger).toLocaleString('tr-TR');
    if (el.textContent !== t) el.textContent = t;
  }

  function boya() {
    var d = son;
    if (!d) return;
    // Ana sayfa karşılama şeridi
    yaz('hlOnline', d.online);
    yaz('hlRooms', d.activeRooms);
    yaz('hlTourn', d.tournaments);
    // İstatistikler sayfası
    yaz('ssOnline', d.online);
    yaz('ssRooms', d.activeRooms);
    yaz('ssPlaying', d.playingRooms);
    yaz('ssTourn', d.tournaments);
  }

  function getir() {
    // Sayfa arka plandayken sunucuyu boşuna yormayalım.
    if (document.hidden) return;
    fetch(BACKEND + '/api/live-stats', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) { son = d; boya(); } })
      .catch(function () { /* sunucu uykudaysa sayılar "—" kalır */ });
  }

  function basla() {
    var y = document.getElementById('gvYear');
    if (y) y.textContent = String(new Date().getFullYear());
    getir();
    if (!timer) timer = setInterval(getir, PERIYOT);
    // Sekmeye dönünce anında tazele (uzun süre kapalı kalmış olabilir).
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) getir();
    });
    // Sayfa değişince (İstatistikler sekmesi) son veriyi hemen bas.
    setInterval(boya, 2000);
  }

  window.GVLiveStats = { refresh: getir, data: function () { return son; } };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', basla, { once: true });
  } else { basla(); }
})();
