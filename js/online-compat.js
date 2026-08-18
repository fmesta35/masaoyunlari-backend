/* GameVerse online compatibility layer
 * Loaded by app.js so the static frontend does not need a large index.html edit.
 * It never replaces the main game UI.
 */
(function () {
  'use strict';
  const BACKEND = 'https://masaoyunlari-backend.onrender.com';

  function load(src, key) {
    if (document.querySelector('script[' + key + ']')) return;
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.setAttribute(key, '1');
    s.onload = () => console.log('[OnlineCompat] yüklendi:', src);
    s.onerror = () => console.error('[OnlineCompat] yüklenemedi:', src);
    (document.head || document.documentElement).appendChild(s);
  }

  load('js/room-waiting-fix.js?v=20260818-1', 'data-gv-room-fix');

  window.__gvEnsureChessOnline = function () {
    if (document.querySelector('script[data-gv-chess-online]')) return;
    load('js/chess-online.js?v=20260818-1', 'data-gv-chess-online');
  };

  window.GV_BACKEND_URL = BACKEND;

  const oldInitRealtime = window.GVGames && window.GVGames.initRealtime;
  if (window.GVGames && typeof oldInitRealtime === 'function') {
    window.GVGames.initRealtime = function () {
      if (this.currentGame === 'chess') {
        console.log('[OnlineCompat] Chess generic realtime devre dışı; authoritative client kullanılıyor.');
        return;
      }
      return oldInitRealtime.apply(this, arguments);
    };
  }

  window.addEventListener('gv:roomReady', function (event) {
    if (event.detail && event.detail.gameId === 'chess' && typeof window.__gvEnsureChessOnline === 'function') {
      window.__gvEnsureChessOnline();
    }
  });
})();
