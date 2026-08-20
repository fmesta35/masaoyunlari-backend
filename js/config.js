// GameVerse / Masaoyunlari.com.tr - Backend URL Konfigürasyonu
// Paylaşımlı hosting (Yöncü) üzerinden açıldığında:
//   - gerçek zamanlı (oyun/sohbet/davet) socketleri   → Render backend
//   - üyelik / profil / arkadaş / maç / sohbet KAYDI  → Yöncü PHP API (MySQL)
// localhost, Render veya başka bir ortamda ise iki iş de aynı origin'de
// kalır (server.js hem statik dosyaları hem üyelik API'sini aynı porttan sunar).
(function () {
  var h = window.location.hostname;
  var servedByBackend = h === 'localhost' || h === '127.0.0.1' ||
    /\.onrender\.com$/.test(h) || /\.e2b\.app$/.test(h);
  window.GV_BACKEND_URL = servedByBackend
    ? window.location.origin
    : 'https://masaoyunlari-backend.onrender.com';
  // Üyelik/sosyal veritabanının adresi: site kendi PHP API'sini çağırır.
  // (Yöncü'ye yüklenen yoncu-api/ dosyaları site kökündeki /api/ altında durur.)
  window.GV_PHP_API = servedByBackend
    ? ''
    : (window.GV_PHP_API_OVERRIDE || (window.location.origin + '/api'));
})();
