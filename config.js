// GameVerse / Masaoyunlari.com.tr - Backend URL Konfigürasyonu
window.GV_BACKEND_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000'
  : 'https://masaoyunlari-backend.onrender.com';
