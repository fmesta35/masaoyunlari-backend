/* GameVerse - gerçek oyuncu oda bekleme sistemi
 * Legacy/random bot simulation is intentionally disabled.
 */
(function () {
  'use strict';

  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  let installed = false;
  let socket = null;

  function gv() { return window.GVGames || null; }

  function isChess() {
    const s = (typeof st !== 'undefined' ? st : null);
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = String(g).toLowerCase().trim();

    if (g && g !== 'chess' && g !== 'satranc' && g !== 'satranç') return false;
    if (g === 'chess' || g === 'satranç' || g === 'satranc') return true;

    const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
    if (/satranç|satranc/i.test(title)) return true;

    return !!window.__gvChessOnlineRequested;
  }

  function ensureSocket(done) {
    if (socket && socket.connected) return done(socket);
    const g = gv();
    if (g && g.socket) {
      socket = g.socket;
      if (socket.connected) return done(socket);
      socket.once('connect', () => done(socket));
      return;
    }

    const connect = () => {
      if (!window.io) return;
      socket = window.io(BACKEND, { transports: ['websocket', 'polling'] });
      window.__gvSocket = socket;
      socket.once('connect', () => done(socket));
    };

    if (window.io) connect();
    else {
      const s = document.createElement('script');
      s.src = 'js/socket.io.min.js';
      s.onload = connect;
      s.onerror = () => console.error('[Rooms] Socket.IO client yüklenemedi.');
      document.head.appendChild(s);
    }
  }

  function renderRoom(room, sock) {
    if (!room || isChess()) return; // DO NOT TOUCH BOARD AREA FOR CHESS!
    const boardArea = document.getElementById('boardArea');
    if (!boardArea) return;

    const players = Array.isArray(room.players) ? room.players : [];
    const maxPlayers = Number(room.maxPlayers || 2);
    const seats = Array.from({ length: maxPlayers }, (_, i) => {
      const p = players[i];
      return p ? {
        occupied: true,
        name: p.name || ('Oyuncu ' + (i + 1)),
        isMe: p.id === sock.id,
        isReady: !!p.isReady
      } : { occupied: false, name: '', isMe: false, isReady: false };
    });

    if (typeof st !== 'undefined') {
      st.roomWaitingState = { room, seats, maxPlayers };
      st.roomWaitingInt = null;
    }

    const chairs = seats.map((seat, idx) => {
      const pos = typeof getChairPositionClass === 'function' ? getChairPositionClass(idx, maxPlayers) : '';
      const cls = `sim-chair ${pos}${seat.occupied ? ' occupied' : ''}${seat.isReady ? ' ready' : ''}`;
      const avatar = seat.occupied ? (seat.isMe ? '👤' : (seat.name.charAt(0) || '👤')) : '➕';
      const status = seat.occupied ? (seat.isReady ? '✅ Hazır' : '⏳ Bekliyor') : 'Boş';
      return `<div class="${cls}"><div class="sim-avatar">${avatar}</div><div class="sim-name">${seat.occupied ? seat.name : 'Sandalye ' + (idx + 1)}</div><div class="sim-status">${status}</div></div>`;
    }).join('');

    const me = players.find(p => p.id === sock.id);
    const ready = !!(me && me.isReady);

    boardArea.innerHTML = `<div class="room-waiting-overlay"><div class="waiting-card">
      <div style="display:flex;justify-space-between;align-items:center;margin-bottom:10px;">
        <h2 style="font-size:1.2em;">🎲 ${room.name || 'Oyun Masası'}</h2>
        <span style="font-size:.8em;padding:3px 10px;background:var(--card);border-radius:10px;border:1px solid var(--border);">${room.isPrivate ? '🔒 Özel Oda' : '🌐 Genel Oda'}</span>
      </div>
      <div style="color:var(--text2);font-size:.88em;">Gerçek oyuncular masaya bekleniyor... (${players.length}/${maxPlayers})</div>
      <div class="table-sim-wrap"><div class="table-sim-surface">GAMEVERSE</div>${chairs}</div>
      <div style="display:flex;gap:10px;margin-top:10px;">
        <button class="btn btn-d" style="flex:1" onclick="GV.leaveRoom()">🚪 Ayrıl</button>
        <button class="btn ${ready ? 'btn-a' : 'btn-p'}" style="flex:2;font-size:1.05em;" onclick="GV.toggleMeReady()">${ready ? '❌ HAZIR DEĞİL' : '✅ HAZIRIM'}</button>
      </div>
    </div></div>`;
  }

  function allReady(room) {
    const players = Array.isArray(room?.players) ? room.players : [];
    const max = Number(room?.maxPlayers || 2);
    return players.length === max && players.every(p => p.isReady);
  }

  function install(sock) {
    if (installed && socket === sock) return;
    installed = true;
    socket = sock;
    window.__gvSocket = sock;

    sock.on('roomUpdated', room => {
      if (isChess()) return; // DO NOT TOUCH BOARD AREA FOR CHESS!
      if (!window.__gvActiveRoomId || String(room.id) !== String(window.__gvActiveRoomId)) return;
      window.__gvActiveRoom = room;
      renderRoom(room, sock);
      if (allReady(room) && typeof startCountdownAndBeginGame === 'function') {
        if (typeof st !== 'undefined') { st.roomWaitingInt = null; st.roomWaitingState = null; }
        startCountdownAndBeginGame(room);
      }
    });

    sock.on('playerLeft', () => {
      if (isChess()) return;
      if (window.__gvActiveRoom) renderRoom(window.__gvActiveRoom, sock);
    });
  }

  function patch() {
    window.startRoomWaitingProcess = function (room) {
      if (!room || !room.id) return;
      if (typeof window.__gvStartRealRoomWaiting === 'function' && isChess()) {
        window.__gvStartRealRoomWaiting(room);
        return;
      }
      window.__gvActiveRoomId = String(room.id);
      window.__gvActiveRoom = room;
      if (typeof st !== 'undefined' && st.roomWaitingInt) {
        clearInterval(st.roomWaitingInt);
        st.roomWaitingInt = null;
      }

      ensureSocket(sock => {
        install(sock);
        renderRoom(room, sock);
        const userName = (typeof st !== 'undefined' && st.user && st.user.name) ? st.user.name : 'Oyuncu';
        sock.emit('joinRoom', {
      memberToken: (window.GVAuth && GVAuth.token ? (GVAuth.token() || undefined) : undefined),
          roomId: String(room.id),
          userName,
          maxPlayers: Number(room.maxPlayers || 2),
          gameId: (typeof st !== 'undefined' && st.curGame) || 'chess'
        });
      });
    };

    window.toggleMeReady = function () {
      if (!socket || !socket.connected) return;
      socket.emit('toggleReady');
    };

    window.checkIsAllReady = function () {
      return allReady(window.__gvActiveRoom);
    };
  }

  function boot() {
    patch();
    ensureSocket(sock => install(sock));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
