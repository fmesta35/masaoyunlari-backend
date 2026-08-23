// GameVerse / Masaoyunlari.com.tr - Backend URL Konfigürasyonu
// NOT: Bu sayfa Yöncü'de (www.masaoyunlari.com.tr) yayınlanıyor olsa
// bile, tüm API + socket istekleri HER ZAMAN Render backend'ine gider
// (masaoyunlari-backend.onrender.com). Aksi halde Yöncü 404 döner.
// Geliştirme için ?dev=1 veya location.hostname=localhost kullanıldığında
// yerel backend'e yönlenir.
(function () {
  var h = window.location.hostname;
  var isLocal = h === 'localhost' || h === '127.0.0.1' || /[?&]dev=1\b/.test(window.location.search);
  // Hostname override (örn. ?backend=… test için) eklenebilir; şimdilik sabit.
  window.GV_BACKEND_URL = isLocal
    ? 'http://localhost:3000'
    : 'https://masaoyunlari-backend.onrender.com';
  // Yöncü'de (www.masaoyunlari.com.tr) yayınlanırken relative URL'ler
  // ("/api/...") Yöncü'ye gider, 404 alır. fetch'i override ederek
  // "/api/..." ile başlayan relative URL'leri Render'a yönlendir.
  // Socket.IO ve XHR (socket.io client dahili) için de aynı kural geçerli.
  if (!isLocal) {
    var _fetch = window.fetch;
    window.fetch = function (url, opts) {
      if (typeof url === 'string' && url.charAt(0) === '/' && url.charAt(1) !== '/') {
        url = window.GV_BACKEND_URL + url;
      }
      return _fetch.call(this, url, opts);
    };
    // XMLHttpRequest — auth.js dahil bazı yerlerde hâlâ XHR kullanılır.
    var _xhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      if (typeof url === 'string' && url.charAt(0) === '/' && url.charAt(1) !== '/' && url.indexOf('://') === -1) {
        arguments[1] = window.GV_BACKEND_URL + url;
      }
      return _xhrOpen.apply(this, arguments);
    };
  }
})();
