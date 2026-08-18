/* GameVerse - Authoritative Online Chess Client
 * Frontend on Yöncü Shared Hosting; Socket.IO backend on Render.com.
 */
(function () {
  'use strict';
  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let roomId = null;
  let playerColor = null;
  let gameState = null;
  let selected = null;
  let pending = false;
  let active = false;
  let clockInt = null;

  // Score tracking per session (Starts 0 - 0)
  let myMatchScore = 0;
  let oppMatchScore = 0;

  function toast(message, type) {
    if (window.GV && typeof window.GV.toast === 'function') {
      try { window.GV.toast(message, type || 'info'); return; } catch (_) {}
    }
    if (window.GVApp && typeof window.GVApp.showToast === 'function') {
      try { window.GVApp.showToast(message, type || 'info'); } catch (_) {}
    }
    console.log(`[Toast] (${type}): ${message}`);
  }

  function getState() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  function isChessRoom() {
    const s = getState();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = String(g).toLowerCase().trim();

    if (g && g !== 'chess' && g !== 'satranc' && g !== 'satranç') return false;
    if (g === 'chess' || g === 'satranç' || g === 'satranc') return true;

    const title = document.getElementById('grTitle')?.textContent || '';
    if (/chess|satranç|satranc/i.test(title)) return true;

    return !!window.__gvChessOnlineRequested;
  }

  function getRoomId() {
    const s = getState();
    const values = [roomId, window.__gvActiveRoomId, window.__gvActiveRoom?.id, window.currentRoomId, window.roomId, s?.roomWaitingState?.room?.id, localStorage.getItem('gv-room-id'), new URLSearchParams(location.search).get('roomId'), new URLSearchParams(location.search).get('room')];
    return values.find(v => v !== undefined && v !== null && String(v) !== '')?.toString() || null;
  }

  function getUserName() {
    const s = getState();
    return s?.user?.name || s?.user?.username || localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  function userKey() {
    const s = getState();
    const u = s?.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    if (stable) return 'user:' + String(stable);
    let id = localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-room-guest-key', id);
    }
    return 'guest:' + id;
  }

  function loadSocketClient(done) {
    if (window.io) return done();
    const s = document.createElement('script');
    s.src = 'js/socket.io.min.js';
    s.onload = done;
    s.onerror = () => toast('🔌 Socket.IO istemcisi yüklenemedi.', 'error');
    document.head.appendChild(s);
  }

  function join() {
    if (!socket?.connected) return;
    roomId = getRoomId();
    if (!roomId) return;
    localStorage.setItem('gv-room-id', roomId);
    socket.emit('joinRoom', {
      roomId,
      userName: getUserName(),
      userKey: userKey(),
      maxPlayers: 2,
      durationMinutes: 10,
      gameId: 'chess'
    });
  }

  function updateScorePanelUI() {
    const myVal = document.getElementById('myScoreVal');
    const oppVal = document.getElementById('oppScoreVal');
    if (myVal) myVal.textContent = myMatchScore;
    if (oppVal) oppVal.textContent = oppMatchScore;
  }

  function handlePlayerLeft() {
    active = false;
    pending = false;
    toast('🚪 Rakip oyundan ayrıldı. 2 saniye içinde lobiye yönlendiriliyorsunuz...', 'warning');
    setTimeout(() => {
      if (typeof window.__gvRealChessLeave === 'function') {
        window.__gvRealChessLeave();
      } else if (typeof window.leaveRoom === 'function') {
        window.leaveRoom();
      }
    }, 2000);
  }

  function connect() {
    roomId = getRoomId();
    if (!roomId || !isChessRoom()) return;
    loadSocketClient(() => {
      if (socket) {
        if (socket.connected) join();
        return;
      }
      socket = window.__gvRoomSocket || window.__gvChessSocket || window.io(BACKEND, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 800
      });
      window.__gvRoomSocket = socket;
      window.__gvChessSocket = socket;

      socket.on('connect', join);
      socket.on('disconnect', () => { pending = false; });
      socket.on('roomUpdated', room => {
        if (!room || String(room.id) !== String(roomId) || !isChessRoom()) return;
        const me = (room.players || []).find(p => p.id === socket.id || (p.userKey && p.userKey === userKey()));
        if (me) playerColor = me.color;
        
        if (active && room.players.length < 2) {
          handlePlayerLeft();
        }
      });

      socket.on('gameStarted', payload => {
        if (!payload || String(payload.roomId) !== String(roomId) || !isChessRoom()) return;
        active = true;
        playerColor = payload.playerColor || playerColor || findMyColor(payload.players);
        apply(payload.gameState);
        startClock();
      });

      socket.on('gameStateUpdated', payload => {
        if (!payload || String(payload.roomId) !== String(roomId) || !isChessRoom()) return;
        if (payload.playerColor) playerColor = payload.playerColor;
        if (payload.gameState) {
          active = payload.gameState.status === 'playing' || payload.gameState.status === 'finished';
          apply(payload.gameState);
          if (active) startClock();
        }
      });

      socket.on('chessMoveAccepted', payload => {
        if (!payload || String(payload.roomId) !== String(roomId) || !isChessRoom()) return;
        if (payload.playerColor) playerColor = payload.playerColor;
        pending = false;
        active = true;
        apply(payload.gameState);
      });

      socket.on('chessMoveRejected', payload => {
        pending = false;
        if (payload?.gameState) apply(payload.gameState);
        const messages = {
          not_your_turn: '⏳ Sıra sizde değil! Rakibin hamlesi bekleniyor.',
          illegal_move: '⚠️ Satranç kurallarına göre geçersiz hamle.',
          not_in_room: '⚠️ Oyuncu koltuğu bulunamadı.',
          time_expired: '⏰ Süreniz doldu.'
        };
        toast(messages[payload?.reason] || '⚠️ Hamle reddedildi.', 'warning');
      });

      socket.on('gameEnded', payload => {
        pending = false;
        active = true;
        if (payload?.gameState) apply(payload.gameState);

        if (payload?.reason === 'player_left') {
          handlePlayerLeft();
        }
      });

      socket.on('playerLeft', () => {
        handlePlayerLeft();
      });
    });
  }

  function findMyColor(players) {
    return (players || []).find(p => p.id === socket?.id || (p.userKey && p.userKey === userKey()))?.color || null;
  }

  function colorCode() {
    return playerColor === 'white' ? 'w' : playerColor === 'black' ? 'b' : null;
  }

  function square(r, c) {
    return 'abcdefgh'[c] + String(8 - r);
  }

  function format(ms) {
    const sec = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  function apply(gs) {
    if (!gs || !Array.isArray(gs.board)) return;
    gameState = gs;
    selected = null;
    pending = false;
    
    if (gameState.status === 'finished' && gameState.result) {
      if (gameState.result.winner === playerColor && !gameState._scoreCounted) {
        gameState._scoreCounted = true;
        myMatchScore++;
      } else if (gameState.result.winner && gameState.result.winner !== playerColor && gameState.result.winner !== 'draw' && !gameState._scoreCounted) {
        gameState._scoreCounted = true;
        oppMatchScore++;
      }
    }

    render();
    updateClock();
    renderHistory();
    updateScorePanelUI();
  }

  function renderHistory() {
    const el = document.getElementById('moveHist');
    if (!el || !gameState) return;
    const h = gameState.history || [];
    el.innerHTML = h.map((m, i) => `<div class="mv"><span>${Math.floor(i / 2) + 1}${m.color === 'w' ? '.' : '...'}</span><span>${escapeHtml(m.san || '')}</span></div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function injectPieceStyle() {
    if (document.getElementById('gv-chess-piece-style')) return;
    const style = document.createElement('style');
    style.id = 'gv-chess-piece-style';
    style.textContent = `
      .chess-p { pointer-events: none !important; user-select: none !important; -webkit-user-select: none !important; }
      .chess-c { cursor: pointer !important; touch-action: manipulation; }
      .chess-c.sel { background: rgba(108, 92, 231, 0.65) !important; box-shadow: inset 0 0 10px #6c5ce7; }
      .chess-c.valid-move::after { content: ''; position: absolute; width: 28%; height: 28%; background: rgba(0, 184, 148, 0.85); border-radius: 50%; pointer-events: none; }
      .chess-c.valid-capture { outline: 3px solid #ff7675 inset !important; }
    `;
    document.head.appendChild(style);
  }

  function render() {
    if (!active || !gameState) return;
    const area = document.getElementById('boardArea');
    if (!area) return;

    injectPieceStyle();
    updateScorePanelUI();

    const board = gameState.board;
    const moves = gameState.legalMoves || [];
    const mine = colorCode();
    const isFlipped = (mine === 'b');

    let html = '<div class="chess-wrapper"><div class="chess">';

    const rowRange = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const colRange = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

    for (const r of rowRange) {
      for (const c of colRange) {
        const p = board[r][c] || '';
        const pc = p ? (p === p.toUpperCase() ? 'w' : 'b') : null;
        let cls = 'chess-c ' + (((r + c) % 2 === 0) ? 'l' : 'd');
        if (selected && selected[0] === r && selected[1] === c) cls += ' sel';

        const last = gameState.history?.[gameState.history.length - 1];
        if (last?.from === square(r, c)) cls += ' last-from';
        if (last?.to === square(r, c)) 
