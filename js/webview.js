/* GameVerse — MOBİL UYGULAMA KATMANI (WebView / TWA / PWA)
 * =========================================================
 * Site aynı kod tabanıyla üç yerde çalışır:
 *   1) normal tarayıcı sekmesi,
 *   2) "Ana ekrana ekle" ile kurulmuş PWA,
 *   3) Google Play'e yüklenecek Android uygulaması (TWA/WebView).
 * Bu dosya 2 ve 3'te gereken farkları tek yerde toplar. Tarayıcıda
 * hiçbir şeyi değiştirmez — eklediği her davranış koşullu çalışır.
 *
 * YAPTIKLARI
 *  A) Ortam tespiti  → <body> üzerine gv-app / gv-twa / gv-webview sınıfı
 *  B) Servis çalışanı kaydı (kurulabilirlik + çevrimdışı kabuk)
 *  C) ANDROID GERİ TUŞU: uygulamayı kapatmak yerine bir önceki ekrana
 *     döner; oyun masasındayken "masadan ayrılıyorsun" onayına bağlanır
 *  D) Aşağı çekip yenileme (pull-to-refresh) kapatılır — oyun tahtasında
 *     sürükleme yaparken sayfa yenileniyordu
 *  E) Oyun sırasında ekranın sönmesi engellenir (Wake Lock)
 *  F) Kısayol/derin bağlantı: /?game=okey doğrudan o oyunun lobisini açar
 *  G) "Uygulamayı yükle" düğmesi (yalnız tarayıcıda, kurulabilir durumda)
 */
(function () {
  'use strict';
  if (window.__gvWebViewLoaded) return;
  window.__gvWebViewLoaded = true;

  // ---------------------------------------------------- A) ortam tespiti
  var nav = navigator || {};
  var ua = String(nav.userAgent || '');
  function medya(q) { try { return window.matchMedia && window.matchMedia(q).matches; } catch (_) { return false; } }

  var standalone = medya('(display-mode: standalone)') || medya('(display-mode: fullscreen)') ||
                   nav.standalone === true;
  // TWA (Play Store paketi) sayfayı android-app:// yönlendiricisiyle açar.
  var twa = String(document.referrer || '').indexOf('android-app://') === 0;
  // Saf WebView: Android UA'sında "; wv" işareti bulunur.
  var webview = /\bwv\b/.test(ua) || /Version\/[\d.]+ Chrome\//.test(ua) === false && /Android/.test(ua) && !/Chrome\//.test(ua);
  var uygulama = standalone || twa || webview;

  var API = window.GVApp = {
    standalone: standalone, twa: twa, webview: webview, isApp: uygulama,
    platform: /Android/i.test(ua) ? 'android' : /iPhone|iPad|iPod/i.test(ua) ? 'ios' : 'web'
  };

  function sinifla() {
    var b = document.body;
    if (!b) return;
    b.classList.toggle('gv-app', uygulama);
    b.classList.toggle('gv-twa', twa);
    b.classList.toggle('gv-webview', webview);
    b.classList.add('gv-' + API.platform);
  }
  if (document.body) sinifla(); else document.addEventListener('DOMContentLoaded', sinifla);

  // ------------------------------------------- B) servis çalışanı kaydı
  // Kurulabilirliğin (ve Play Store TWA kalite kontrolünün) ön koşulu.
  if ('serviceWorker' in nav && location.protocol === 'https:' ||
      ('serviceWorker' in nav && /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    window.addEventListener('load', function () {
      nav.serviceWorker.register('/sw.js').then(function (reg) {
        // Yeni sürüm indiğinde beklemeden devralsın: kullanıcı eski
        // istemciyle sunucuya bağlanıp uyumsuzluk yaşamasın.
        if (reg.waiting) reg.waiting.postMessage('gv-skip-waiting');
        reg.addEventListener('updatefound', function () {
          var yeni = reg.installing;
          if (!yeni) return;
          yeni.addEventListener('statechange', function () {
            if (yeni.state === 'installed' && nav.serviceWorker.controller) {
              yeni.postMessage('gv-skip-waiting');
            }
          });
        });
      }).catch(function () { /* kayıt başarısızsa site normal çalışır */ });
    });
  }

  // ------------------------------------------------ C) Android geri tuşu
  // Uygulamada geri tuşu varsayılan olarak UYGULAMAYI KAPATIR. Kullanıcı
  // oyun masasındayken bunu yapması kötü; önce ekranlar arasında geri
  // gitmeli, ana ekranda ise çıkmadan önce onay istemeli.
  var geriHazir = false;
  function geriKur() {
    if (geriHazir || !uygulama) return;
    geriHazir = true;
    try { history.pushState({ gv: 'kok' }, ''); } catch (_) {}

    window.addEventListener('popstate', function () {
      // 1) Açık pencere/çekmece varsa önce onu kapat
      var kapandi = false;
      var modal = document.querySelector('.modal-overlay.active, .modal-bg.active, .modal.active');
      if (modal && window.GV && typeof GV.hideModal === 'function') {
        try { GV.hideModal(modal.id); kapandi = true; } catch (_) {}
      }
      if (!kapandi) {
        var sb = document.querySelector('.sidebar.open');
        if (sb) { sb.classList.remove('open'); kapandi = true; }
      }
      // 2) Oyun odasındaysa masadan ayrılmayı sor (leave-guard devrede)
      if (!kapandi) {
        var oda = document.getElementById('pg-room');
        if (oda && oda.classList.contains('active') && window.GV && typeof GV.leaveRoom === 'function') {
          try { GV.leaveRoom(); kapandi = true; } catch (_) {}
        }
      }
      // 3) Lobide/alt sayfadaysa ana sayfaya dön
      if (!kapandi) {
        var anaSayfada = !!document.querySelector('#pg-home.active');
        if (!anaSayfada && window.GV && typeof GV.page === 'function') {
          try { GV.page('home'); kapandi = true; } catch (_) {}
        }
      }
      // Her durumda kök durumu geri koy: bir sonraki geri tuşu da bize gelsin.
      try { history.pushState({ gv: 'kok' }, ''); } catch (_) {}
      // 4) Ana sayfadayken hiçbir şey kapatmadıysak: çıkışa izin ver
      if (!kapandi) {
        if (window.__gvCikisOnay && Date.now() - window.__gvCikisOnay < 2500) {
          try { history.go(-2); } catch (_) {}
          return;
        }
        window.__gvCikisOnay = Date.now();
        if (window.GV && GV.toast) GV.toast('Çıkmak için geri tuşuna tekrar basın.', 'info', 2200);
      }
    });
  }
  if (document.body) geriKur(); else document.addEventListener('DOMContentLoaded', geriKur);

  // ------------------------------- D) aşağı çekip yenilemeyi kapat (app)
  // Tahtada taş sürüklerken sayfa yenileniyordu. CSS overscroll-behavior
  // desteklemeyen eski WebView'ler için dokunma yedeği de var.
  if (uygulama) {
    try {
      document.documentElement.style.overscrollBehaviorY = 'contain';
      document.body && (document.body.style.overscrollBehaviorY = 'contain');
    } catch (_) {}
  }

  // ------------------------------------------- E) oyun sırasında ekran açık
  var kilit = null;
  function kilitAl() {
    if (!uygulama || kilit || !nav.wakeLock || !nav.wakeLock.request) return;
    nav.wakeLock.request('screen').then(function (k) {
      kilit = k;
      k.addEventListener('release', function () { kilit = null; });
    }).catch(function () { kilit = null; });
  }
  function kilitBirak() { if (kilit) { try { kilit.release(); } catch (_) {} kilit = null; } }
  function odadaMi() {
    var oda = document.getElementById('pg-room');
    return !!(oda && oda.classList.contains('active'));
  }
  setInterval(function () { if (odadaMi()) kilitAl(); else kilitBirak(); }, 4000);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && odadaMi()) kilitAl();
  });

  // --------------------------------- F) kısayol / derin bağlantı: ?game=
  // manifest.json'daki uygulama kısayolları (Okey, Tavla, Satranç, Bilardo)
  // buraya düşer. Eskiden bu parametre hiçbir yerde OKUNMUYORDU: kısayollar
  // uygulamayı açıyor ama oyuna götürmüyordu.
  function kisayol() {
    var g;
    try { g = new URLSearchParams(location.search).get('game'); } catch (_) { return; }
    if (!g) return;
    var esle = { billiards: 'bilardo', pool: 'bilardo', backgammon: 'tavla', chess: 'chess', okey101: 'okey101' };
    g = esle[g] || g;
    var t0 = Date.now();
    var bekle = setInterval(function () {
      if (Date.now() - t0 > 15000) return clearInterval(bekle);
      if (!(window.GV && typeof GV.openLobby === 'function' && window.GAMES && GAMES[g])) return;
      clearInterval(bekle);
      try { GV.openLobby(g); } catch (_) {}
    }, 250);
  }
  window.addEventListener('load', kisayol);

  // ---------------------------------------- G) "Uygulamayı yükle" düğmesi
  // Yalnız tarayıcıda ve tarayıcı kurulabilir dediğinde görünür.
  var kurulumOlayi = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    kurulumOlayi = e;
    API.canInstall = true;
    var d = document.getElementById('gvInstallBtn');
    if (d) d.hidden = false;
  });
  API.install = function () {
    if (!kurulumOlayi) return Promise.resolve(false);
    kurulumOlayi.prompt();
    return kurulumOlayi.userChoice.then(function (r) {
      kurulumOlayi = null;
      var d = document.getElementById('gvInstallBtn');
      if (d) d.hidden = true;
      return r && r.outcome === 'accepted';
    });
  };
  window.addEventListener('appinstalled', function () {
    API.canInstall = false;
    var d = document.getElementById('gvInstallBtn');
    if (d) d.hidden = true;
  });
})();
