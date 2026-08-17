/* GameVerse - self-contained realtime waiting room
 * Real players only. No bots.
 * This module does not depend on legacy renderWaitingTableUI/st.roomWaitingState.
 * It also recovers when the legacy room flow already ran before this file loaded.
 */
(function () {
  'use strict';

  const BACKEND = 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let room = null;
  let roomId = null;
  let gameId = null;
  let panel = null;
  let started = false;
  let connectedOnce = false;
  let observer = null;

  function getState() {
    try { return (typeof st !== 'undefined') ? st : null; } catch (_) { return null; }
  }

  function getActiveRoom() {
    const s = getState();
    return window.__gvActiveRoom ||
      (s && s.roomWaitingState && s.roomWaitingState.room) ||
      room || null;
  }

  function getRoomId(candidate) {
    const r = candidate || getActiveRoom();
    return String((r && r.id) || window.__gvActiveRoomId || window.currentRoomId || window.roomId || localStorage.getItem('gv-room-id') || '');
  }

  function getGameId(candidate) {
    const s = getState();
    return (candidate && (candidate.gameId || candidate.game || candidate.type)) ||
      (s && (s.curGame || s.currentGame)) || window.__gvCurrentGame || 'chess';
  }

  function getUserName() {
    const s = getState();
    const u = s && s.user;
    if (u && (u.name || u.username)) return u.name || u.username;
    try {
      const raw = localStorage.getItem('gv-user') || localStorage.getItem('user');
      if (raw) {
        const v = JSON.parse(raw);
        return v.name || v.username || 'Oyuncu';
      }
    } catch (_) {}
    return localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  function guestKey() {
    let id = localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : 'g-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-room-guest-key', id);
    }
    return 'guest:' + id;
  }

  function userKey() {
    const s = getState();
    const u = s && s.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    if (stable) return 'user:' + String(stable);
    try {
      const raw = localStorage.getItem('gv-user') || localStorage.getItem('user');
      if (raw) {
        const v = JSON.parse(raw);
        const id = v.id || v.userId || v.username || v.email;
        if (id) return 'user:' + String(id);
      }
    } catch (_) {}
    return guestKey();
  }

  function isRoomPage() {
    const s = getState();
    const hash = (location.hash || '').replace('#', '').toLowerCase();
    return !!(
      (s && s.curPage === 'room') ||
      hash === 'room' ||
      window.__gvActiveRoomId ||
      document.getElementById('pg-room')?.classList.contains('active') ||
      document.getElementById('room')?.classList.contains('active')
    );
  }

  function ensureCss() {
    if (document.getElementById('gv-standalone-waiting-css')) return;
    const style = document.createElement('style');
    style.id = 'gv-standalone-waiting-css';
    style.textContent = `
      #gvStandaloneWaiting {
        position: relative; z-index: 99999; max-width: 760px; margin: 28px auto;
        padding: 26px; border: 1px solid rgba(255,255,255,.14); border-radius: 18px;
        background: #111128; color: #e8e8ff; box-shadow: 0 20px 60px rgba(0,0,0,.45);
      }
      #gvStandaloneWaiting h2 { margin:0 0 8px; font-size:1.35rem; }
      #gvStandaloneWaiting .gv-sub { color:#b1b1d0; margin-bottom:18px; }
      #gvStandaloneWaiting .gv-seat { display:flex; align-items:center; gap:12px; padding:15px 16px; margin-top:10px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background:rgba(255,255,255,.04); }
      #gvStandaloneWaiting .gv-dot { width:12px; height:12px; border-radius:50%; background:#555; flex:none; }
      #gvStandaloneWaiting .gv-dot.on { background:#55efc4; box-shadow:0 0 10px rgba(85,239,196,.55); }
      #gvStandaloneWaiting .gv-seat-name { font-weight:700; flex:1; }
      #gvStandaloneWaiting .gv-state { color:#a7a7c7; font-size:.9rem; }
      #gvStandaloneWaiting .gv-count { margin-top:18px; font-weight:800; color:#a29bfe; }
      #gvStandaloneWaiting .gv-status { margin-top:8px; color:#c2c2d8; }
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureCss();
    panel = document.getElementById('gvStandaloneWaiting');
    if (panel) return panel;

    panel = document.createElement('section');
    panel.id = 'gvStandaloneWaiting';
    panel.setAttribute('aria-live', 'polite');

    const board = document.getElementById('boardArea');
    const page = document.getElementById('pg-room') || document.getElementById('room');
    if (board) board.prepend(panel);
    else if (page) page.prepend(panel);
    else document.body.prepend(panel);
    return panel;
  }

  function syncRoomFromGlobals() {
    const active = getActiveRoom();
    if (active && active.id) {
      room = active;
      roomId = getRoomId(active);
      gameId = getGameId(active);
    }
    return !!roomId;
  }

  function render() {
    if (!syncRoomFromGlobals()) return;
    const p = ensurePanel();
    if (!p) return;
    const players = Array.isArray(room.players) ? room.players : [];
    const max = Math.max(2, Number(room.maxPlayers || 2));
    let slots = '';
    for (let i = 0; i < max; i++) {
      const pl = players[i] || null;
      slots += `<div class="gv-seat"><span class="gv-dot ${pl ? 'on' : ''}"></span><span class="gv-seat-name">${pl ? (pl.name || pl.username || 'Oyuncu') : 'Rakip bekleniyor...'}</span><span class="gv-state">${pl ? 'Bağlandı' : 'Boş'}</span></div>`;
    }
    p.innerHTML = `<h2>♟️ ${gameId === 'chess' ? 'Satranç' : 'Oyun'} Bekleme Salonu</h2><div class="gv-sub">Rakibin bağlanmasını bekliyoruz. Bot kullanılmıyor.</div>${slots}<div class="gv-count">Oyuncular: ${players.length} / ${max}</div><div class="gv-status">${players.length >= max ? 'Rakip bulundu. Oyun hazırlanıyor…' : 'Rakip bekleniyor…'}</div>`;
    p.style.display = started ? 'none' : 'block';
  }

  function loadChess() {
    if (gameId !== 'chess' || !started) return;
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const script = document.createElement('script');
    script.src = 'js/chess-online.js?v=20260817-9';
    script.async = true;
    script.dataset.gvChessOnline = '1';
    script.onload = () => console.log('[ChessOnline] Sunucu otoriteli satranç istemcisi yüklendi.');
    script.onerror = () => console.error('[ChessOnline] chess-online.js yüklenemedi.');
    document.head.appendChild(script);
  }

  function joinServer() {
    if (!socket || !socket.connected || !roomId) return;
    socket.emit('joinRoom', {
      roomId,
      userName: getUserName(),
      userKey: userKey(),
      maxPlayers: Number((room && room.maxPlayers) || 2),
      durationMinutes: Number((room && room.durationMinutes) || 10),
      gameId
    });
  }

  function connect() {
    if (!roomId || socket) return;
    if (typeof window.io !== 'function') {
      const s = document.createElement('script');
      s.src = BACKEND + '/socket.io/socket.io.js';
      s.async = true;
      s.onload = connect;
      s.onerror = () => console.error('[RoomWaitingFix] Socket.IO client yüklenemedi.');
      document.head.appendChild(s);
      return;
    }
    socket = window.io(BACKEND, { transports:['websocket','polling'], reconnection:true, reconnectionAttempts:Infinity, reconnectionDelay:1000 });
    window.__gvStandaloneRoomSocket = socket;
    socket.on('connect', joinServer);
    socket.on('roomUpdated', updated => {
      if (!updated || String(updated.id) !== String(roomId)) return;
      room = updated;
      render();
      if (Array.isArray(updated.players) && updated.players.length >= Number(updated.maxPlayers || 2)) {
        started = true;
        render();
        window.dispatchEvent(new CustomEvent('gv:roomReady', { detail:{ roomId, gameId } }));
        loadChess();
      }
    });
    socket.on('gameStarted', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      started = true;
      render();
      window.dispatchEvent(new CustomEvent('gv:roomReady', { detail:{ roomId, gameId, playerColor:payload.playerColor } }));
      loadChess();
    });
    socket.on('disconnect', () => { if (!started) render(); });
  }

  function bootstrapFromGlobals() {
    syncRoomFromGlobals();
    if (!roomId) return;
    if (!started && isRoomPage()) {
      render();
      connect();
    }
  }

  function patchLegacy() {
    if (typeof window.startRoomWaitingProcess === 'function' && !window.__gvStandaloneWaitingPatched4) {
      const original = window.startRoomWaitingProcess;
      window.startRoomWaitingProcess = function (r) {
        room = r || room || getActiveRoom();
        roomId = getRoomId(room);
        gameId = getGameId(room);
        started = false;
        render();
        connect();
        try { return original.apply(this, arguments); } catch (_) { return null; }
      };
      window.__gvStandaloneWaitingPatched4 = true;
    }
  }

  function watch() {
    patchLegacy();
    bootstrapFromGlobals();
    if (isRoomPage() && !started) render();
  }

  function boot() {
    watch();
    [100, 300, 700, 1500, 3000].forEach(ms => setTimeout(watch, ms));
    if (!observer) {
      observer = new MutationObserver(() => { if (isRoomPage() && !started) render(); });
      observer.observe(document.body, { childList:true, subtree:true, attributes:true, attributeFilter:['class','style'] });
    }
    setInterval(watch, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
