/* GameVerse - gerçek oyuncu oda bekleme köprüsü
 * Public rooms must wait for real Socket.IO players; never simulate bots.
 */
(function () {
  'use strict';

  function getGV() { return window.GVGames || null; }

  function renderRealRoom() {
    const gv = getGV();
    if (!gv || !gv.roomId) return;
    const state = window.__gvRealRoomState;
    if (!state || !state.room) return;

    const boardArea = document.getElementById('boardArea');
    if (!boardArea) return;

    const room = state.room;
    const players = room.players || [];
    const maxPlayers = Number(room.maxPlayers || state.maxPlayers || 2);
    const meId = state.socketId;

    const seats = [];
    for (let i = 0; i < maxPlayers; i++) {
      const p = players[i];
      seats.push(p ? {
        occupied: true,
        name: p.name || ('Oyuncu ' + (i + 1)),
        isMe: p.id === meId,
        isReady: !!p.isReady,
        id: p.id,
        color: p.color
      } : { occupied: false, name: '', isMe: false, isReady: false });
    }

    // Keep the local waiting state compatible with the existing UI.
    if (typeof st !== 'undefined') {
      st.roomWaitingState = { room, seats, maxPlayers };
      room.players = players.length;
    }

    const currentCount = players.length;
    const myPlayer = players.find(p => p.id === meId) || players.find(p => p.name === (typeof st !== 'undefined' ? st.user.name + ' (Sen)' : ''));
    const isMeReady = !!(myPlayer && myPlayer.isReady);

    let chairsHtml = '';
    seats.forEach((seat, idx) => {
      const posClass = typeof getChairPositionClass === 'function' ? getChairPositionClass(idx, maxPlayers) : '';
      let chairClass = `sim-chair ${posClass}`;
      if (seat.occupied) chairClass += ' occupied';
      if (seat.isReady) chairClass += ' ready';
      const avatar = seat.occupied ? (seat.isMe ? '👤' : (seat.name.charAt(0) || '👤')) : '➕';
      const status = seat.occupied ? (seat.isReady ? '✅ Hazır' : '⏳ Bekliyor') : 'Boş';
      chairsHtml += `<div class="${chairClass}"><div class="sim-avatar">${avatar}</div><div class="sim-name">${seat.occupied ? seat.name : 'Sandalye ' + (idx + 1)}</div><div class="sim-status">${status}</div></div>`;
    });

    boardArea.innerHTML = `
      <div class="room-waiting-overlay">
        <div class="waiting-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <h2 style="font-size:1.2em;">🎲 ${room.name || 'Oyun Masası'}</h2>
            <span style="font-size:0.8em;padding:3px 10px;background:var(--card);border-radius:10px;border:1px solid var(--border);">${room.isPrivate ? '🔒 Özel Oda' : '🌐 Genel Oda'}</span>
          </div>
          <div style="color:var(--text2);font-size:0.88em;">Gerçek oyuncular masaya bekleniyor... (${currentCount}/${maxPlayers})</div>
          <div class="table-sim-wrap"><div class="table-sim-surface">GAMEVERSE</div>${chairsHtml}</div>
          <div style="display:flex;gap:10px;margin-top:10px;">
            <button class="btn btn-d" style="flex:1" onclick="GV.leaveRoom()">🚪 Ayrıl</button>
            <button class="btn ${isMeReady ? 'btn-a' : 'btn-p'}" style="flex:2;font-size:1.05em;" onclick="GV.toggleMeReady()">${isMeReady ? '❌ HAZIR DEĞİL' : '✅ HAZIRIM'}</button>
          </div>
        </div>
      </div>`;
  }

  function patch() {
    if (typeof window.startRoomWaitingProcess !== 'function') return false;

    // Replace the old local random-bot simulator with a server-authoritative room wait.
    window.startRoomWaitingProcess = function (room) {
      const gv = getGV();
      const socket = window.__gvSocket || (gv && gv.socket);
      if (!socket) {
        console.warn('[Rooms] Socket.IO bağlantısı hazır değil; gerçek oyuncu bekleniyor.');
        return;
      }

      if (typeof st !== 'undefined' && st.roomWaitingInt) {
        clearInterval(st.roomWaitingInt);
        st.roomWaitingInt = null;
      }

      window.__gvRealRoomState = {
        room: room,
        maxPlayers: room.maxPlayers || 2,
        socketId: socket.id
      };

      if (typeof st !== 'undefined') {
        st.roomWaitingState = { room, seats: [], maxPlayers: room.maxPlayers || 2 };
      }

      renderRealRoom();

      // Ask the server to place this browser in the room. The server's roomUpdated
      // event is the only source used to add/remove other players.
      socket.emit('joinRoom', {
        roomId: room.id,
        userName: (typeof st !== 'undefined' && st.user ? st.user.name : 'Oyuncu'),
        maxPlayers: room.maxPlayers || 2,
        gameId: (typeof st !== 'undefined' ? st.curGame : null) || 'chess'
      });
    };

    window.toggleMeReady = function () {
      const gv = getGV();
      const socket = window.__gvSocket || (gv && gv.socket);
      if (!socket || !socket.connected) return;
      socket.emit('toggleReady');
    };

    window.checkIsAllReady = function () {
      const state = window.__gvRealRoomState;
      if (!state || !state.room) return false;
      const players = state.room.players || [];
      return players.length === Number(state.room.maxPlayers || 2) && players.every(p => p.isReady);
    };

    return true;
  }

  function attachSocketHandlers() {
    const gv = getGV();
    const socket = window.__gvSocket || (gv && gv.socket);
    if (!socket || socket.__noBotHandlersAttached) return !!socket;
    socket.__noBotHandlersAttached = true;
    window.__gvSocket = socket;

    socket.on('connect', () => {
      window.__gvRealRoomState && (window.__gvRealRoomState.socketId = socket.id);
    });

    socket.on('roomUpdated', room => {
      const state = window.__gvRealRoomState;
      if (!state || !room || String(room.id) !== String(state.room.id)) return;
      state.room = room;
      state.socketId = socket.id;
      renderRealRoom();

      const players = room.players || [];
      if (players.length === Number(room.maxPlayers || 2) && players.every(p => p.isReady)) {
        if (typeof st !== 'undefined' && st.roomWaitingInt) {
          clearInterval(st.roomWaitingInt);
          st.roomWaitingInt = null;
        }
        if (typeof st !== 'undefined' && st.roomWaitingState) {
          st.roomWaitingState = null;
        }
        if (typeof startCountdownAndBeginGame === 'function') startCountdownAndBeginGame(room);
      }
    });

    socket.on('playerLeft', data => {
      const state = window.__gvRealRoomState;
      if (!state) return;
      renderRealRoom();
    });
  }

  function boot() {
    patch();
    attachSocketHandlers();
    setTimeout(() => { patch(); attachSocketHandlers(); }, 250);
    setTimeout(() => { patch(); attachSocketHandlers(); }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
