// GameVerse / Masaoyunlari.com.tr - Backend URL Konfigürasyonu
// Paylaşımlı hosting (Yöncü) üzerinden açıldığında Render backend'ine bağlanır;
// localhost, Render veya başka bir ortamda doğrudan aynı origin kullanılır
// (server.js hem statik dosyaları hem Socket.IO'yu aynı porttan sunar).
(function () {
  var h = window.location.hostname;
  var servedByBackend = h === 'localhost' || h === '127.0.0.1' ||
    /\.onrender\.com$/.test(h) || /\.e2b\.app$/.test(h);
  window.GV_BACKEND_URL = servedByBackend
    ? window.location.origin
    : 'https://masaoyunlari-backend.onrender.com';
})();
