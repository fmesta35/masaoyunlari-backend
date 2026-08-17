/* GameVerse - Realtime room waiting UI fix
 * Keeps the real-player waiting table visible after navigation/rendering.
 * No bots are created here.
 *
 * IMPORTANT: chess-online.js owns the realtime socket for chess rooms.
 * Creating a second waiting socket for chess caused the same browser/user
 * to occupy or replace a player seat and made the two chess clients drift.
 */
(function () {
  'use strict';

  let timer = null;
  let chessLoaderStarted = false;

  function getState() {
    try {
      return (typeof st !== 'undefined') ? st : null;
    } catch (_) {
      return null;
    }
  }

  function loadOnlineChess() {
    const state = getState();
    if (chessLoaderStarted || !state || state.curGame !== 'chess') return;
    if (document.querySelector('script[data-gv-chess-online]')) {
      chessLoaderStarted = true;
      return;
    }
    chessLoaderStarted = true;
    const script = document.createElement('script');
    script.src = 'js/chess-online.js?v=20260817-4';
    script.async = true;
    script.dataset.gvChessOnline = '1';
    script.onload = () => console.log('[ChessOnline] Sunucu otoriteli satranç istemcisi yüklendi.');
    script.onerror = () => console.error('[ChessOnline] chess-online.js yüklenemedi.');
    document.head.appendChild(script);
  }

  function render() {
    const state = getState();
    if (!state || !state.roomWaitingState) return false;
    if (typeof window.renderWaitingTableUI !== 'function') return false;
    const room = state.roomWaitingState.room;
    if (!room || !room.id) return false;
    try {
      window.renderWaitingTableUI();
      return true;
    } catch (e) {
      console.error('[RoomWaitingFix] renderWaitingTableUI:', e);
      return false;
    }
  }

  function startWatch() {
    if (timer) return;
    timer = setInterval(function () {
      const state = getState();
      if (!state || state.curPage !== 'room') {
        clearInterval(timer);
        timer = null;
        return;
      }
      loadOnlineChess();
      if (state.roomWaitingState) render();
    }, 400);
  }

  function install() {
    loadOnlineChess();

    if (typeof window.page === 'function' && !window.__gvRoomPagePatched) {
      const originalPage = window.page;
      window.page = function (name) {
        const result = originalPage.apply(this, arguments);
        if (name === 'room') {
          setTimeout(render, 0);
          setTimeout(render, 80);
          setTimeout(render, 250);
          setTimeout(loadOnlineChess, 0);
          startWatch();
        }
        return result;
      };
      window.__gvRoomPagePatched = true;
    }

    if (typeof window.startRoomWaitingProcess === 'function' && !window.__gvRoomStartPatched) {
      const originalStart = window.startRoomWaitingProcess;
      window.startRoomWaitingProcess = function (room) {
        const result = originalStart.apply(this, arguments);
        setTimeout(render, 0);
        setTimeout(render, 100);
        setTimeout(render, 300);
        setTimeout(loadOnlineChess, 0);
        startWatch();
        return result;
      };
      window.__gvRoomStartPatched = true;
    }

    if (getState()?.roomWaitingState) {
      setTimeout(render, 0);
      startWatch();
    }
  }

  /*
   * Do NOT open a second Socket.IO connection for chess.
   * chess-online.js is the single authoritative chess connection.
   * Other games can keep their existing room socket behavior here later.
   */
  function ensureWaitingSocket() {
    const state = getState();
    if (state?.curGame === 'chess') return;
    // Intentionally left without a socket for now. Chess is handled above.
  }

  function boot() {
    install();
    ensureWaitingSocket();
    setTimeout(install, 250);
    setTimeout(ensureWaitingSocket, 250);
    setTimeout(install, 1000);
    setTimeout(ensureWaitingSocket, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
