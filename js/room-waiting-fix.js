/* GameVerse - Realtime room waiting UI fix
 * Keeps the real-player waiting table visible after navigation/rendering.
 * No bots are created here.
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
    script.src = 'js/chess-online.js?v=20260817-2';
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }

  setTimeout(install, 250);
  setTimeout(install, 1000);
})();
