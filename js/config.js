// GameVerse / Masaoyunlari.com.tr - Backend URL Konfigürasyonu
//
//  Yöncü (paylaşımlı hosting) kökünden yayınlanan sayfa, TÜM backend
//  trafiğini Render'a yönlendirir. Yöncü'de PHP dosyaları olsa bile
//  doğrudan erişmek yerine Render'a gitmek tercih edilir çünkü:
//    1) Render'da installRemoteMode zaten Yöncü PHP'sine proxy atar
//    2) Tek domain (Render) üzerinden CORS / cookie / socket karmaşıklığı önlenir
//    3) Yöncü'de PHP yoksa bile Render üzerinden 503/redirect olarak anlamlı hata döner
//
//  Geliştirme için ?dev=1 veya location.hostname=localhost kullanıldığında
//  yerel backend'e yönlenir (server.js tek process'te hem statik dosyaları
//  hem üyelik API'sini aynı porttan sunar).
(function () {
  var h = window.location.hostname;
  var isLocal = h === 'localhost' || h === '127.0.0.1' || /[?&]dev=1\b/.test(window.location.search);
  var RENDER = 'https://masaoyunlari-backend.onrender.com';

  if (isLocal) {
    window.GV_BACKEND_URL = window.location.origin;
    window.GV_PHP_API = ''; // aynı origin → /api/... doğrudan server.js'e gider
    return;
  }
  if (/\.onrender\.com$/.test(h) || /\.e2b\.app$/.test(h)) {
    // Sayfa zaten Render / e2b'de host ediliyor; aynı origin yeterli.
    window.GV_BACKEND_URL = window.location.origin;
    window.GV_PHP_API = ''; // aynı origin
    return;
  }
  // Yöncü (www.masaoyunlari.com.tr) veya başka paylaşımlı hosting:
  // TÜM API + socket trafiği Render'a yönlendirilir.
  window.GV_BACKEND_URL = RENDER;
  // social.js urlFor(): PHP boş değilse oraya gider. PHP'yi Render'a
  // ayarlamak yerine BOŞ bırakıyoruz → urlFor() otomatik olarak
  // BACKEND + path (yani Render + /api/...) döndürür. Render'da
  // installProxy zaten /api/* isteklerini Yöncü PHP'sine proxy eder.
  if (!window.GV_PHP_API || /masaoyunlari\.com\.tr/.test(String(window.GV_PHP_API))) {
    // Yöncü'ye bakan bir değer varsa veya boşsa, Render'a yönlendir.
    // Boş bırakmak yeterli; ama açıkça Render'ı göstermek teşhis için faydalı.
    try { window.GV_PHP_API = ''; } catch (_) {}
  }
})();
