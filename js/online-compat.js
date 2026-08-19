/* GameVerse online compatibility layer */
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

  // Shared-hosting frontend; Render owns the real-time chess connection.
  // The waiting-room socket remains the only socket until gameStarted.
  load('js/room-waiting-fix.js?v=20260819b', 'data-gv-room-fix');

  window.__gvEnsureChessOnline = function () {
    if (!window.__gvChessGameStarted) return;
    if (document.querySelector('script[data-gv-chess-online]')) return;
    load('js/chess-online.js?v=20260819b', 'data-gv-chess-online');
  };

  window.GV_BACKEND_URL = BACKEND;

  const oldInitRealtime = window.GVGames && window.GVGames.initRealtime;
  if (window.GVGames && typeof oldInitRealtime === 'function') {
    window.GVGames.initRealtime = function () {
      if (this.currentGame === 'chess') {
        console.log('[OnlineCompat] Chess generic realtime devre dışı; authoritative waiting/game client kullanılıyor.');
        return;
      }
      return oldInitRealtime.apply(this, arguments);
    };
  }

  window.addEventListener('gv:roomGameStarted', function () {
    window.__gvChessGameStarted = true;
    window.__gvEnsureChessOnline();
  });
})();
