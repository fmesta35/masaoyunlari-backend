/* GameVerse - self-contained realtime waiting room
 * Real players only. No bots. This file intentionally does not depend on
 * renderWaitingTableUI() or st.roomWaitingState for the visible UI.
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
  let booted = false;
  let connectTimer = null;

  function state() {
    try { return (typeof st !== 'undefined') ? st : null; } catch (_) { return null; }
  }

  function currentRoom() {
    const s = state();
    return (s && s.roomWaitingState && s.roomWaitingState.room) || room || null;
  }

  function roomElement() {
    return document.getElementById('pg-room') || document.getElementById('room');
  }

  function getRoomId(candidate) {
    const r = candidate || currentRoom();
    return (r && r.id) || window.currentRoomId || window.roomId || localStorage.getItem('gv-room-id') || '';
  }

  function getGameId(candidate) {
    const s = state();
    return (candidate && candidate.gameId) || (rGame(candidate)) ||
      (s && (s.curGame || s.currentGame)) || window.__gvCurrentGame || 'chess';
  }

  function rGame(r) { return r && (r.gameId || r.game || r.type); }

  function getUserName() {
    const s = state();
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
      id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'g-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-room-guest-key', id);
    }
    return 'guest:' + id;
  }

  function stableUserKey() {
    const s = state();
    const u = s && s.user;
    if (u) {
      const id = u.id || u.userId || u.username || u.email;
      if (id) return 'user:' + id;
    }
    try {
      const raw = localStorage.getItem('gv-user') || localStorage.getItem('user');
      if (raw) {
        const v = JSON.parse(raw);
        const id = v.id || v.userId || v.username || v.email;
        if (id) return 'user:' + id;
      }
    } catch (_) {}
    return guestKey();
  }

  function ensureCss() {
    if (document.getElementById('gv-standalone-waiting-css')) return;
    const style = document.createElement('style');
    style.id = 'gv-standalone-waiting-css';
    style.textContent = `
      #gvStandaloneWaiting { max-width: 760px; margin: 24px auto; padding: 24px; border:1px solid rgba(255,255,255,.12); border-radius:18px; background:rgba(255,255,255,.04); color:inherit; box-shadow:0 12px 40px rgba(0,0,0,.25); }
      #gvStandaloneWaiting h2 { margin:0 0 8px; font-size:1.35rem; }
      #gvStandaloneWaiting .gv-sub { color:#a8a8c8; margin-bottom:18px; }
      #gvStandaloneWaiting .gv-seat { display:flex; align-items:center; gap:12px; padding:14px 16px; margin-top:10px; border:1px solid rgba(255,255,255,.10); border-radius:14px; background:rgba(255,255,255,.03); }
      #gvStandaloneWaiting .gv-dot { width:12px; height:12px; border-radius:50%; background:#555; flex:none; }
      #gvStandaloneWaiting .gv-dot.on { background:#55efc4; box-shadow:0 0 10px rgba(85,239,196,.5); }
      #gvStandaloneWaiting .gv-seat-name { font-weight:700; flex:1; }
      #gvStandaloneWaiting .gv-state { color:#9b9bbb; font-size:.9rem; }
      #gvStandaloneWaiting .gv-count { margin-top:18px; font-weight:700; color:#a29bfe; }
      #gvStandaloneWaiting .gv-status { margin-top:8px; color:#b8b8d0; }
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    const page = roomElement();
    if (!page) return null;
    page.classList.add('active');
    page.style.display = 'block';
    page.style.visibility = 'visible';
    page.style.opacity = '1';
    ensureCss();

    panel = document.getElementById('gvStandaloneWaiting');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'gvStandaloneWaiting';
      page.appendChild(panel);
    }
    return panel;
  }

  function renderWaiting() {
    const p = ensurePanel();
    if (!p) return;
    const players = Array.isArray(room && room.players) ? room.players : [];
    const max = Number((room && room.maxPlayers) || 2);
    const names = [];
    for (let i = 0; i < max; i++) names.push(players[i] || null);

    p.innerHTML = `
      <h2>♟️ ${gameId === 'chess' ? 'Satranç' : 'Oyun'} Bekleme Salonu</h2>
      <div class="gv-sub">Rakibin bağlanmasını bekliyoruz. Bot kullanılmıyor.</div>
      ${names.map((pl, i) => `
        <div class="gv-seat">
          <span class="gv-dot ${pl ? 'on' : ''}"></span>
          <span class="gv-seat-name">${pl ? (pl.name || pl.username || 'Oyuncu') : 'Rakip bekleniyor...'}</span>
          <span class="gv-state">${pl ? 'Bağlandı' : 'Boş'}</span>
        </div>
      `).join('')}
      <div class="gv-count">Oyuncular: ${players.length} / ${max}</div>
      <div class="gv-status">${players.length >= max ? 'Rakip bulundu. Oyun hazırlanıyor…' : 'Rakip bekleniyor…'}</div>
    `;
  }

  function loadChess() {
    if (gameId !== 'chess' || started) return;
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const script = document.createElement('script');
    script.src = 'js/chess-online.js?v=20260817-8';
    script.async = true;
    script.dataset.gvChessOnline = '1';
    document.head.appendChild(script);
  }

  function hideWaiting() {
    if (panel) panel.style.display = 'none';
  }

  function joinServer() {
    if (!socket || !socket.connected || !roomId) return;
    socket.emit('joinRoom', {
      roomId,
      userName: getUserName(),
      userKey: stableUserKey(),
      maxPlayers: Number((room && room.maxPlayers) || 2),
      durationMinutes: Number((room && room.durationMinutes) || 10),
      gameId
    });
  }

  function connect() {
    if (!roomId) return;
    if (socket) {
      if (socket.connected) joinServer();
      return;
    }
    if (typeof window.io !== 'function') {
      if (connectTimer) return;
      const s = document.createElement('script');
      s.src = BACKEND + '/socket.io/socket.io.js';
      s.async = true;
      connectTimer = setTimeout(function(){ connectTimer = null; connect(); }, 1500);
      s.onload = function(){ if (connectTimer) { clearTimeout(connectTimer); connectTimer=null; } connect(); };
      s.onerror = function(){ if (connectTimer) { clearTimeout(connectTimer); connectTimer=null; } };
      document.head.appendChild(s);
      return;
    }

    socket = window.io(BACKEND, { transports:['websocket','polling'], reconnection:true, reconnectionAttempts:Infinity, reconnectionDelay:1000 });
    window.__gvStandaloneRoomSocket = socket;
    socket.on('connect', joinServer);
    socket.on('roomUpdated', function(updated){
      if (!updated || String(updated.id) !== String(roomId)) return;
      room = updated;
      renderWaiting();
      if (Array.isArray(updated.players) && updated.players.length >= Number(updated.maxPlayers || 2)) {
        started = true;
        hideWaiting();
        if (state()) state().roomWaitingState = { room: updated };
        window.dispatchEvent(new CustomEvent('gv:roomReady', { detail:{ roomId:roomId, gameId:gameId } }));
        loadChess();
      }
    });
    socket.on('gameStarted', function(payload){
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      started = true;
      hideWaiting();
      window.dispatchEvent(new CustomEvent('gv:roomReady', { detail:{ roomId:roomId, gameId:gameId, playerColor:payload.playerColor } }));
      loadChess();
    });
    socket.on('disconnect', function(){
      if (!started) renderWaiting();
    });
  }

  function start(roomArg) {
    room = roomArg || currentRoom() || {};
    roomId = getRoomId(room);
    gameId = getGameId(room);
    if (!roomId) return;
    booted = true;
    started = false;
    renderWaiting();
    connect();
  }

  function patch() {
    if (!window.__gvStandaloneWaitingPatched && typeof window.startRoomWaitingProcess === 'function') {
      const original = window.startRoomWaitingProcess;
      window.startRoomWaitingProcess = function (r) {
        start(r);
        try { return original.apply(this, arguments); } catch (_) { return null; }
      };
      window.__gvStandaloneWaitingPatched = true;
    }
  }

  function boot() {
    patch();
    const r = currentRoom();
    if (r && !booted) start(r);
    setTimeout(patch, 100);
    setTimeout(patch, 500);
    setTimeout(patch, 1200);
    setTimeout(patch, 2500);
  }

  window.addEventListener('gv:roomReady', function(e){
    if (e.detail && e.detail.roomId) {
      roomId = e.detail.roomId;
      gameId = e.detail.gameId || gameId || 'chess';
      loadChess();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();
