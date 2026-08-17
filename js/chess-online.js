/* GameVerse - standalone authoritative online chess client */
(function () {
  'use strict';
  const BACKEND = 'https://masaoyunlari-backend.onrender.com';
  let socket = null, roomId = null, playerColor = null, gameState = null;
  let selected = null, pending = false, active = false, internalRender = false;
  let clockInt = null, rejoinInt = null;

  function toast(message, type) {
    if (window.GV && typeof window.GV.toast === 'function') {
      try { window.GV.toast(message, type || 'info'); } catch (_) {}
    }
  }
  function isChessRoom() {
    const title = document.getElementById('grTitle');
    return /satranç|chess/i.test(title ? title.textContent : '') || !!window.__gvChessOnlineRequested;
  }
  function getRoomId() {
    try {
      const state = (typeof st !== 'undefined') ? st : null;
      return window.currentRoomId || window.roomId || state?.roomWaitingState?.room?.id ||
        localStorage.getItem('gv-room-id') || new URLSearchParams(location.search).get('roomId') ||
        new URLSearchParams(location.search).get('room');
    } catch (_) { return localStorage.getItem('gv-room-id'); }
  }
  function getUser() {
    try {
      const raw = localStorage.getItem('gv-user') || localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function userName() {
    const u = getUser();
    return (u && (u.name || u.username)) || localStorage.getItem('gv-user-name') || 'Oyuncu';
  }
  function guestId() {
    let id = localStorage.getItem('gv-chess-guest-id');
    if (!id) {
      id = window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-chess-guest-id', id);
    }
    return id;
  }
  function userKey() {
    const u = getUser(), stable = u && (u.id || u.userId || u.username || u.email);
    return stable ? 'user:' + String(stable) : 'guest:' + guestId();
  }
  function colorCode() { return playerColor === 'white' ? 'w' : playerColor === 'black' ? 'b' : null; }
  function square(r, c) { return 'abcdefgh'[c] + String(8 - r); }
  function format(ms) {
    const sec = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
  function ensureSocketClient(done) {
    if (window.io) return done();
    const s = document.createElement('script');
    s.src = BACKEND + '/socket.io/socket.io.js'; s.onload = done;
    s.onerror = () => toast('🔌 Socket.IO istemcisi yüklenemedi.', 'error');
    document.head.appendChild(s);
  }
  function connect() {
    if (socket || !roomId || !isChessRoom()) return;
    ensureSocketClient(() => {
      if (socket) return;
      socket = window.io(BACKEND, { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });
      window.__gvChessSocket = socket;
      socket.on('connect', join);
      socket.on('disconnect', () => { pending = false; });
      socket.on('roomUpdated', room => {
        if (String(room.id) !== String(roomId)) return;
        const me = (room.players || []).find(p => p.id === socket.id);
        if (me) { playerColor = me.color; updateClock(); }
      });
      socket.on('gameStarted', payload => {
        if (String(payload.roomId) !== String(roomId)) return;
        active = true; playerColor = payload.playerColor || playerColor || findMyColor(payload.players);
        apply(payload.gameState); startClock();
      });
      socket.on('gameStateUpdated', payload => {
        if (String(payload.roomId) !== String(roomId)) return;
        if (payload.playerColor) playerColor = payload.playerColor;
        if (payload.gameState && Array.isArray(payload.gameState.board)) {
          active = payload.gameState.status === 'playing' || payload.gameState.status === 'finished';
          apply(payload.gameState); if (active) startClock();
        }
      });
      socket.on('chessMoveAccepted', payload => {
        if (String(payload.roomId) !== String(roomId)) return;
        pending = false; if (payload.playerColor) playerColor = payload.playerColor;
        active = true; apply(payload.gameState);
      });
      socket.on('chessMoveRejected', payload => {
        pending = false; if (payload.gameState) apply(payload.gameState);
        const msg = { not_your_turn: '⏳ Sıra rakipte.', illegal_move: '⚠️ Geçersiz satranç hamlesi.' }[payload.reason] || '⚠️ Hamle reddedildi.';
        toast(msg, 'warning');
      });
      socket.on('gameEnded', payload => { pending = false; active = true; if (payload.gameState) apply(payload.gameState); });
      socket.on('playerLeft', () => { active = false; pending = false; });
    });
  }
  function join() {
    if (!socket?.connected) return;
    roomId = getRoomId(); if (!roomId) return;
    localStorage.setItem('gv-room-id', roomId);
    socket.emit('joinRoom', { roomId, userName: userName(), userKey: userKey(), maxPlayers: 2, durationMinutes: 10, gameId: 'chess' });
  }
  function findMyColor(players) { return (players || []).find(p => p.id === socket?.id)?.color || null; }
  function apply(gs) {
    if (!gs || !Array.isArray(gs.board)) return;
    gameState = gs; selected = null; pending = false; render(); updateClock(); renderHistory();
  }
  function renderHistory() {
    const el = document.getElementById('moveHist'); if (!el || !gameState) return;
    const h = gameState.history || [];
    el.innerHTML = h.map((m, i) => `<div class="mv"><span>${Math.floor(i / 2) + 1}${m.color === 'w' ? '.' : '...'}</span><span>${m.san || ''}</span></div>`).join('');
    el.scrollTop = el.scrollHeight;
  }
  function render() {
    if (!active || !gameState || internalRender) return;
    const area = document.getElementById('boardArea'); if (!area) return;
    internalRender = true;
    const board = gameState.board, moves = gameState.legalMoves || [], my = colorCode();
    let h = '<div class="chess-wrapper"><div class="chess">';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c] || '', pc = p ? (p === p.toUpperCase() ? 'w' : 'b') : null;
      let cls = 'chess-c ' + (((r + c) % 2 === 0) ? 'l' : 'd');
      if (selected && selected[0] === r && selected[1] === c) cls += ' sel';
      const lm = gameState.history?.[gameState.history.length - 1];
      if (lm?.from === square(r,c)) cls += ' last-from'; if (lm?.to === square(r,c)) cls += ' last-to';
      if (selected) {
        const from = square(selected[0], selected[1]);
        if (moves.some(m => m.from === from && m.to === square(r,c))) cls += p ? ' valid-capture' : ' valid-move';
      }
      const sym = { K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟' }[p] || '';
      h += `<div class="${cls}" data-r="${r}" data-c="${c}" onclick="window.__gvOnlineChessClick(${r},${c})">${p ? `<span class="chess-p ${pc}">${sym}</span>` : ''}</div>`;
    }
    h += '</div>';
    if (gameState.promotionPending) h += '<div class="promo-overlay"><div class="promo-modal"><h3>♟️ Terfi</h3><div class="promo-options">' +
      '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'q\')">♛</div>' +
      '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'r\')">♜</div>' +
      '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'b\')">♝</div>' +
      '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'n\')">♞</div></div></div></div>';
    if (gameState.status === 'finished' || gameState.status === 'aborted') {
      const result = gameState.result || {}; let title = '🏁 Oyun Bitti', desc = '';
      if (result.reason === 'checkmate') { title = '♟️ ŞAH MAT!'; desc = result.winner === playerColor ? 'Kazandın!' : 'Rakip kazandı.'; }
      if (result.reason === 'stalemate') { title = '🤝 PAT!'; desc = 'Berabere.'; }
      if (result.reason === 'draw') { title = '🤝 BERABERE'; desc = 'Oyun berabere bitti.'; }
      if (result.reason === 'timeout') { title = '⏰ SÜRE BİTTİ'; desc = result.winner === playerColor ? 'Kazandın!' : 'Süren bitti.'; }
      h += `<div class="chess-end-overlay"><div class="chess-end-modal"><div class="end-icon">🏁</div><h2>${title}</h2><p>${desc}</p></div></div>`;
    }
    h += '</div>'; area.innerHTML = h; internalRender = false;
  }
  function click(r, c) {
    if (!active || !gameState || gameState.status !== 'playing' || pending) return;
    const my = colorCode(); if (!my) return toast('⏳ Oyuncu rengi bekleniyor.', 'info');
    if (gameState.turn !== my) return toast('⏳ Sıra rakipte.', 'warning');
    const piece = gameState.board[r][c] || '', pc = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null;
    if (!selected) { if (piece && pc === my) { selected = [r, c]; render(); } return; }
    if (selected[0] === r && selected[1] === c) { selected = null; render(); return; }
    if (piece && pc === my) { selected = [r,c]; render(); return; }
    const from = square(selected[0], selected[1]), to = square(r, c);
    const candidates = (gameState.legalMoves || []).filter(m => m.from === from && m.to === to);
    if (!candidates.length) return toast('⚠️ Bu hamle satranç kurallarına göre geçersiz.', 'warning');
    if (candidates.some(m => m.promotion)) { gameState.promotionPending = { from, to }; render(); return; }
    send(from, to, null);
  }
  function promote(p) {
    if (!gameState?.promotionPending) return;
    const { from, to } = gameState.promotionPending; gameState.promotionPending = null; send(from, to, p);
  }
  function send(from, to, promotion) {
    if (!socket?.connected) return toast('🔌 Sunucu bağlantısı yok.', 'error');
    pending = true; socket.emit('chessMove', { roomId, from, to, promotion });
  }
  function updateClock() {
    if (!gameState) return;
    const t1 = document.getElementById('t1'), t2 = document.getElementById('t2'), names = document.querySelectorAll('#topTimers .timer-name'), my = colorCode();
    let w = Number(gameState.whiteTimeMs || 0), b = Number(gameState.blackTimeMs || 0);
    if (gameState.status === 'playing' && gameState.serverNow) {
      const elapsed = Math.max(0, Date.now() - Number(gameState.serverNow));
      if (gameState.turn === 'w') w = Math.max(0, w - elapsed); else b = Math.max(0, b - elapsed);
    }
    if (names.length >= 2) { names[0].textContent = my === 'w' ? '♙ Beyaz (Sen)' : '♟ Siyah (Sen)'; names[1].textContent = my === 'w' ? '♟ Siyah (Rakip)' : '♙ Beyaz (Rakip)'; }
    if (t1) t1.textContent = format(my === 'w' ? w : b); if (t2) t2.textContent = format(my === 'w' ? b : w);
    document.querySelectorAll('#topTimers .timer').forEach((el, i) => { const c = i === 0 ? my : (my === 'w' ? 'b' : 'w'); el.classList.toggle('active', c === gameState.turn && gameState.status === 'playing'); });
  }
  function startClock() { if (clockInt) clearInterval(clockInt); clockInt = setInterval(updateClock, 250); updateClock(); }
  window.__gvOnlineChessClick = click; window.__gvOnlineChessPromote = promote;
  function boot() { roomId = getRoomId(); if (!roomId || !isChessRoom()) return; connect(); }
  window.addEventListener('gv:roomReady', e => { if (e.detail?.roomId) { localStorage.setItem('gv-room-id', e.detail.roomId); roomId = e.detail.roomId; window.__gvChessOnlineRequested = true; boot(); } });
  rejoinInt = setInterval(() => { if (!active) boot(); else updateClock(); }, 750);
})();
