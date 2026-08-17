/* GameVerse waiting room fix - real players only, no bots */
(function () {
  'use strict';

  let timer = null;
  let patched = false;

  function getState() {
    try { return (typeof st !== 'undefined') ? st : null; }
    catch (_) { return null; }
  }

  function roomPage() {
    return document.getElementById('pg-room') || document.getElementById('room');
  }

  function ensureWaitingState(room) {
    const state = getState();
    if (!state || !room) return;

    state.curPage = 'room';
    state.roomWaitingState = state.roomWaitingState || {};
    state.roomWaitingState.room = room;
    state.roomWaitingState.maxPlayers = Number(room.maxPlayers || 2);
    state.roomWaitingState.seats = Array.from({ length: state.roomWaitingState.maxPlayers }, function (_, i) {
      const p = Array.isArray(room.players) ? room.players[i] : null;
      return {
        occupied: !!p,
        name: p ? (p.name || p.username || 'Oyuncu') : '',
        isMe: !!p && !!state.user && p.name === state.user.name,
        isReady: !!p && !!p.isReady
      };
    });
  }

  function show(room) {
    const state = getState();
    const page = roomPage();
    if (!state || !page) return false;

    page.classList.add('active');
    page.style.display = 'block';
    page.style.visibility = 'visible';
    page.style.opacity = '1';

    if (room) ensureWaitingState(room);

    if (state.roomWaitingState && typeof window.renderWaitingTableUI === 'function') {
      try { window.renderWaitingTableUI(); }
      catch (e) { console.error('[RoomWaitingFix] renderWaitingTableUI:', e); }
    }

    loadChess();
    return true;
  }

  function loadChess() {
    const state = getState();
    if (!state || state.curGame !== 'chess') return;
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const script = document.createElement('script');
    script.src = 'js/chess-online.js?v=20260817-7';
    script.async = true;
    script.dataset.gvChessOnline = '1';
    script.onload = function () {
      console.log('[ChessOnline] Sunucu otoriteli satranç istemcisi yüklendi.');
    };
    script.onerror = function () {
      console.error('[ChessOnline] chess-online.js yüklenemedi.');
    };
    document.head.appendChild(script);
  }

  function watch() {
    if (timer) return;
    timer = setInterval(function () {
      const state = getState();
      if (!state || state.curPage !== 'room') {
        clearInterval(timer);
        timer = null;
        return;
      }
      show();
    }, 300);
  }

  function patch() {
    if (!patched && typeof window.page === 'function') {
      const originalPage = window.page;
      window.page = function (name) {
        const result = originalPage.apply(this, arguments);
        if (name === 'room') {
          setTimeout(function () { show(); }, 0);
          setTimeout(function () { show(); }, 100);
          setTimeout(function () { show(); }, 300);
          watch();
        }
        return result;
      };
      patched = true;
      window.__gvRoomPagePatched3 = true;
    }

    if (typeof window.startRoomWaitingProcess === 'function' && !window.__gvRoomStartPatched3) {
      const originalStart = window.startRoomWaitingProcess;
      window.startRoomWaitingProcess = function (room) {
        const state = getState();
        if (state) state.curPage = 'room';
        ensureWaitingState(room);

        const result = originalStart.apply(this, arguments);

        ensureWaitingState(room);
        setTimeout(function () { show(room); }, 0);
        setTimeout(function () { show(room); }, 100);
        setTimeout(function () { show(room); }, 300);
        watch();
        return result;
      };
      window.__gvRoomStartPatched3 = true;
    }
  }

  function boot() {
    patch();
    show();
    setTimeout(patch, 100);
    setTimeout(patch, 500);
    setTimeout(patch, 1200);
    setTimeout(patch, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
