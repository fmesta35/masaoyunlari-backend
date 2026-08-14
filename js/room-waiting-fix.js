/* GameVerse - Realtime room waiting UI fix
 * Ensures the waiting table remains visible after page('room') and game renderers run.
 * No bots are created here; only st.roomWaitingState / Socket.IO room state is displayed.
 */
(function () {
  'use strict';

  let timer = null;
  let lastRoomId = null;

  function getState() {
    return (typeof window.st !== 'undefined' && window.st) || null;
  }

  function render() {
    const state = getState();
    if (!state || !state.roomWaitingState) return false;
    if (typeof window.renderWaitingTableUI !== 'function') return false;

    const room = state.roomWaitingState.room;
    if (!room || !room.id) return false;

    try {
      window.renderWaitingTableUI();
      lastRoomId = String(room.id);
      return true;
    } catch (e) {
      console.error('[RoomWaitingFix] renderWaitingTableUI:', e);
      return false;
    }
  }

  function startWatch() {
    if (timer) return;
    let attempts = 0;
    timer = setInterval(function () {
      const state = getState();
      if (!state || !state.roomWaitingState || state.curPage !== 'room') {
        clearInterval(timer);
        timer = null;
        lastRoomId = null;
        return;
      }

      const room = state.roomWaitingState.room;
      if (!room || !room.id) return;

      render();
      attempts++;
      // Once the room is stable, keep a light periodic refresh so a game renderer
      // cannot accidentally replace the waiting UI. This stops immediately when
      // roomWaitingState is cleared by the real game start/leave flow.
      if (attempts > 10 && state.roomWaitingState == null) {
        clearInterval(timer);
        timer = null;
      }
    }, 400);
  }

  function install() {
    // Patch page() so the waiting UI is restored immediately after navigation.
    if (typeof window.page === 'function' && !window.__gvRoomPagePatched) {
      const originalPage = window.page;
      window.page = function (name) {
        const result = originalPage.apply(this, arguments);
        if (name === 'room') {
          setTimeout(render, 0);
          setTimeout(render, 80);
          setTimeout(render, 250);
          startWatch();
        }
        return result;
      };
      window.__gvRoomPagePatched = true;
    }

    // Patch the room starter after games.js/no-bots.js have installed theirs.
    if (typeof window.startRoomWaitingProcess === 'function' && !window.__gvRoomStartPatched) {
      const originalStart = window.startRoomWaitingProcess;
      window.startRoomWaitingProcess = function (room) {
        const result = originalStart.apply(this, arguments);
        setTimeout(render, 0);
        setTimeout(render, 100);
        setTimeout(render, 300);
        startWatch();
        return result;
      };
      window.__gvRoomStartPatched = true;
    }

    startWatch();
  }

  // Run after all inline GameVerse functions and injected scripts are available.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }

  // A second pass catches scripts loaded with defer/dynamically.
  setTimeout(install, 250);
  setTimeout(install, 1000);
})();
