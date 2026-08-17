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

  // The waiting-room module owns the chess connection. Loading it from here
  // guarantees it is available even when the 200 KB index has stale script tags.
  load('js/room-waiting-fix.js?v=20260817-5', 'data-gv-room-fix');

  // Keep the authoritative chess client available before a room is opened.
  window.__gvEnsureChessOnline = function () {
    if (document.querySelector('script[data-gv-chess-online]')) return;
    load('js/chess-online.js?v=20260817-5', 'data-gv-chess-online');
  };

  // Make the backend URL available to any compatible frontend module.
  window.GV_BACKEND_URL = BACKEND;

  // If the old generic GVGames realtime module is present, do not let it open
  // a second socket for chess. The authoritative chess client handles it.
  const oldInitRealtime = window.GVGames && window.GVGames.initRealtime;
  if (window.GVGames && typeof oldInitRealtime === 'function') {
    window.GVGames.initRealtime = function () {
      if (this.currentGame === 'chess') {
        console.log('[OnlineCompat] Chess generic realtime devre dışı; authoritative client kullanılıyor.');
        if (typeof window.__gvEnsureChessOnline === 'function') window.__gvEnsureChessOnline();
        return;
      }
      return oldInitRealtime.apply(this, arguments);
    };
  }

  window.addEventListener('gv:roomReady', function (event) {
    if (event.detail && event.detail.gameId === 'chess') window.__gvEnsureChessOnline();
  });
})();
