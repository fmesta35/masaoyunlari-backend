/* GameVerse — CANLI SAYAÇLAR + GERÇEK VARLIK NABZI
 * ================================================
 * Ana sayfadaki karşılama kutusunda ve İstatistikler sayfasında görünen
 * sayılar SABİT yazılmıştı: siteye kim girerse girsin "3.421 çevrimiçi,
 * 1.205 aktif oda, 32 turnuva" görüyordu. Bu modül aynı alanları
 * sunucudaki GERÇEK durumla doldurur (/api/live-stats — herkese açık,
 * kişisel veri taşımaz).
 *
 * ÇEVRİMİÇİ SAYISI NASIL GERÇEK OLUYOR:
 * Sunucu eskiden açık SOKET sayardı; aynı kişinin 3 sekmesi 3 oyuncu gibi
 * görünürdü. Artık KİŞİ sayılıyor:
 *   - Üye girişi yapılmışsa kimlik = üye numarası (uid)
 *   - Ziyaretçide kimlik = bu tarayıcıya bir kez üretilip localStorage'da
 *     saklanan rastgele cihaz anahtarı
 * Aynı kimliğin kaç sekmesi olursa olsun sunucuda TEK kişi olur. Bu istek
 * aynı zamanda "buradayım" nabzıdır; sekme kapanınca nabız kesilir ve kişi
 * en geç 45 saniye içinde sayımdan düşer. Turnuva motoru henüz yok:
 * sunucu 0 döner, uydurma sayı yazmıyoruz.
 */
(function () {
  'use strict';
  if (window.GVLiveStats) return;

  var BACKEND = String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  var PERIYOT = 20000;      // nabız aralığı (sunucu eşiği 45 sn)
  var CIHAZ_ANAHTARI = 'gv-device-key';
  var son = null;
  var timer = null;

  // Bu tarayıcıya özel kalıcı anahtar. Kişisel veri değil: rastgele üretilir,
  // yalnız "aynı ziyaretçiyi iki kez saymamak" için kullanılır.
  function cihazAnahtari() {
    var k = null;
    try { k = localStorage.getItem(CIHAZ_ANAHTARI); } catch (_) {}
    if (!k) {
      k = 'z' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(CIHAZ_ANAHTARI, k); } catch (_) {}
    }
    return k;
  }

  // Üye girişi yapılmışsa üye numarası; yoksa null (ziyaretçi).
  function uid() {
    try {
      var u = window.st && window.st.user;
      if (u && !window.st.isGuest && Number(u.id) > 0) return Number(u.id);
    } catch (_) {}
    return null;
  }

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
    yaz('ssMembers', d.members);
    yaz('ssGuests', d.guests);
  }

  function getir() {
    // NOT: sayfa arka plandayken de nabız atarız — yoksa oyun oynayan ama
    // sekmesi arkada kalan kullanıcı "yok" sayılırdı. Tarayıcı zaten arka
    // planda zamanlayıcıyı yavaşlatır; sunucu eşiği bunu tolere eder.
    fetch(BACKEND + '/api/live-stats', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid: uid(), cihaz: cihazAnahtari() })
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) { son = d; if (!document.hidden) boya(); } })
      .catch(function () { /* sunucu uykudaysa sayılar "—" kalır */ });
  }

  // Soket varsa kimliği oradan da bildir: soket açık olduğu sürece kişi
  // "sitede" sayılır, HTTP nabzı gecikse bile sayaç doğru kalır.
  function soketeBildir(sock) {
    if (!sock || !sock.emit) return;
    try { sock.emit('gvPresence', { uid: uid(), cihaz: cihazAnahtari() }); } catch (_) {}
  }

  // Sitede birden çok soket olabilir (lobi / masa / satranç). Hangisi açıksa
  // kimliği ona da bildiririz; sunucu aynı kimliği tek kişi sayar.
  function soketleriTara() {
    [window.__gvLobbySocket, window.__gvRoomSocket, window.__gvChessSocket,
     window.socket, (window.GV && window.GV.socket)].forEach(function (s) {
      if (s && s.connected) soketeBildir(s);
    });
  }

  function basla() {
    var y = document.getElementById('gvYear');
    if (y) y.textContent = String(new Date().getFullYear());
    getir();
    soketleriTara();
    if (!timer) timer = setInterval(function () { getir(); soketleriTara(); }, PERIYOT);
    // Sekmeye dönünce anında tazele (uzun süre kapalı kalmış olabilir).
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { getir(); soketleriTara(); }
    });
    // Giriş/çıkış olunca kimlik değişir: sunucuya hemen bildir ki kişi
    // ziyaretçi kaydından üye kaydına taşınsın (çift sayım olmasın).
    window.addEventListener('gv:authChanged', function () { getir(); soketleriTara(); });
    // Sayfa değişince (İstatistikler sekmesi) son veriyi hemen bas.
    setInterval(boya, 2000);
    // Sekme kapanırken sunucuya "gidiyorum" de: sayaç anında düzelsin.
    window.addEventListener('pagehide', function () {
      try {
        var d = navigator.sendBeacon && new Blob(
          [JSON.stringify({ uid: uid(), cihaz: cihazAnahtari(), ayril: 1 })],
          { type: 'application/json' });
        if (d) navigator.sendBeacon(BACKEND + '/api/presence-bye', d);
      } catch (_) {}
    });
  }

  window.GVLiveStats = {
    refresh: getir,
    data: function () { return son; },
    cihaz: cihazAnahtari,
    bildir: soketeBildir
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', basla, { once: true });
  } else { basla(); }
})();
