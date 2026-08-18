/* GameVerse - sunucu otoriteli çevrim içi satranç istemcisi */
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

  function toast(message, type) {
    if (window.GV && typeof window.GV.toast === 'function') {
      try { window.GV.toast(message, type || 'info'); return; } catch (_) {}
    }
    if (window.GVApp && typeof window.GVApp.showToast === 'function') {
      try { window.GVApp.showToast(message, type || 'info'); } catch (_) {}
    }
  }

  function getState() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  function isChessRoom() {
    const s = getState();
    const title = document.getElementById('grTitle')?.textContent || '';
    return !!window.__gvChessOnlineRequested || /chess|satranç|satranc/i.test(String(s?.curGame || '')) || /chess|satranç|satranc/i.test(title);
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
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2); localStorage.setItem('gv-room-guest-key', id); }
    return 'guest:' + id;
  }

  function loadSocketClient(done) {
    if (window.io) return done();
    const s = document.createElement('script');
    s.src = BACKEND + '/socket.io/socket.io.js';
    s.onload = done;
    s.onerror = () => toast('🔌 Socket.IO istemcisi yüklenemedi.', 'error');
    document.head.appendChild(s);
  }

  function join() {
    if (!socket?.connected) return;
    roomId = getRoomId();
    if (!roomId) return;
    localStorage.setItem('gv-room-id', roomId);
    socket.emit('joinRoom', { roomId, userName: getUserName(), userKey: userKey(), maxPlayers: 2, durationMinutes: 10, gameId: 'chess' });
  }

  function connect() {
    roomId = getRoomId();
    if (!roomId || !isChessRoom()) return;
    loadSocketClient(() => {
      if (socket) { if (socket.connected) join(); return; }
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
        if (!room || String(room.id) !== String(roomId)) return;
        const me = (room.players || []).find(p => p.id === socket.id);
        if (me) playerColor = me.color;
      });
      socket.on('gameStarted', payload => {
        if (!payload || String(payload.roomId) !== String(roomId)) return;
        active = true;
        playerColor = payload.playerColor || playerColor || findMyColor(payload.players);
        apply(payload.gameState);
        startClock();
      });
      socket.on('gameStateUpdated', payload => {
        if (!payload || String(payload.roomId) !== String(roomId)) return;
        if (payload.playerColor) playerColor = payload.playerColor;
        if (payload.gameState) {
          active = payload.gameState.status === 'playing' || payload.gameState.status === 'finished';
          apply(payload.gameState);
          if (active) startClock();
        }
      });
      socket.on('chessMoveAccepted', payload => {
        if (!payload || String(payload.roomId) !== String(roomId)) return;
        if (payload.playerColor) playerColor = payload.playerColor;
        pending = false;
        active = true;
        apply(payload.gameState);
      });
      socket.on('chessMoveRejected', payload => {
        pending = false;
        if (payload?.gameState) apply(payload.gameState);
        const messages = {
          not_your_turn: '⏳ Sıra rakipte.',
          illegal_move: '⚠️ Satranç kurallarına göre geçersiz hamle.',
          not_in_room: '⚠️ Oyuncu koltuğu bulunamadı.',
          time_expired: '⏰ Süren doldu.'
        };
        toast(messages[payload?.reason] || '⚠️ Hamle reddedildi.', 'warning');
      });
      socket.on('gameEnded', payload => {
        pending = false;
        active = true;
        if (payload?.gameState) apply(payload.gameState);
      });
      socket.on('playerLeft', () => { pending = false; active = false; });
    });
  }

  function findMyColor(players) { return (players || []).find(p => p.id === socket?.id)?.color || null; }
  function colorCode() { return playerColor === 'white' ? 'w' : playerColor === 'black' ? 'b' : null; }
  function square(r, c) { return 'abcdefgh'[c] + String(8 - r); }
  function format(ms) { const sec = Math.ceil(Math.max(0, Number(ms) || 0) / 1000); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }

  function apply(gs) {
    if (!gs || !Array.isArray(gs.board)) return;
    gameState = gs;
    selected = null;
    pending = false;
    render();
    updateClock();
    renderHistory();
  }

  function renderHistory() {
    const el = document.getElementById('moveHist');
    if (!el || !gameState) return;
    const h = gameState.history || [];
    el.innerHTML = h.map((m, i) => `<div class="mv"><span>${Math.floor(i / 2) + 1}${m.color === 'w' ? '.' : '...'}</span><span>${escapeHtml(m.san || '')}</span></div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch])); }

  function render() {
    if (!active || !gameState) return;
    const area = document.getElementById('boardArea');
    if (!area) return;
    const board = gameState.board;
    const moves = gameState.legalMoves || [];
    const mine = colorCode();
    let html = '<div class="chess-wrapper"><div class="chess">';

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c] || '';
        const pc = p ? (p === p.toUpperCase() ? 'w' : 'b') : null;
        let cls = 'chess-c ' + (((r + c) % 2 === 0) ? 'l' : 'd');
        if (selected && selected[0] === r && selected[1] === c) cls += ' sel';
        const last = gameState.history?.[gameState.history.length - 1];
        if (last?.from === square(r, c)) cls += ' last-from';
        if (last?.to === square(r, c)) cls += ' last-to';
        if (selected) {
          const from = square(selected[0], selected[1]);
          if (moves.some(m => m.from === from && m.to === square(r, c))) cls += p ? ' valid-capture' : ' valid-move';
        }
        const sym = { K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙', k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟' }[p] || '';
        html += `<div class="${cls}" data-r="${r}" data-c="${c}" onclick="window.__gvOnlineChessClick(${r},${c})">${p ? `<span class="chess-p ${pc}">${sym}</span>` : ''}</div>`;
      }
    }
    html += '</div>';

    if (gameState.promotionPending) {
      html += '<div class="promo-overlay"><div class="promo-modal"><h3>♟️ Terfi</h3><div class="promo-options">' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'q\')">♛</div>' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'r\')">♜</div>' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'b\')">♝</div>' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'n\')">♞</div></div></div></div>';
    }

    if (gameState.status === 'finished' || gameState.status === 'aborted') {
      const result = gameState.result || {};
      let title = '🏁 Oyun Bitti';
      let desc = '';
      if (result.reason === 'checkmate') { title = '♟️ ŞAH MAT!'; desc = result.winner === playerColor ? 'Kazandın!' : 'Rakip kazandı.'; }
      else if (result.reason === 'stalemate') { title = '🤝 PAT!'; desc = 'Berabere.'; }
      else if (result.reason === 'timeout') { title = '⏰ SÜRE BİTTİ'; desc = result.winner === playerColor ? 'Kazandın!' : 'Süren bitti.'; }
      else if (result.reason === 'threefold_repetition') { title = '🤝 ÜÇLÜ TEKRAR'; desc = 'Oyun berabere bitti.'; }
      else if (result.reason === 'insufficient_material') { title = '🤝 YETERSİZ MATERYAL'; desc = 'Oyun berabere bitti.'; }
      else if (result.reason === 'fifty_move') { title = '🤝 50 HAMLE KURALI'; desc = 'Oyun berabere bitti.'; }
      else if (result.reason === 'player_left') { title = '🚪 OYUNCU AYRILDI'; desc = 'Oyun sonlandırıldı.'; }
      else { title = '🤝 BERABERE'; desc = 'Oyun berabere bitti.'; }
      html += `<div class="chess-end-overlay"><div class="chess-end-modal"><div class="end-icon">🏁</div><h2>${title}</h2><p>${desc}</p></div></div>`;
    }

    html += '</div>';
    area.innerHTML = html;
  }

  function click(r, c) {
    if (!active || !gameState || gameState.status !== 'playing' || pending) return;
    const mine = colorCode();
    if (!mine) return toast('⏳ Oyuncu rengi bekleniyor.', 'info');
    if (gameState.turn !== mine) return toast('⏳ Sıra rakipte.', 'warning');

    const piece = gameState.board[r][c] || '';
    const pc = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null;
    if (!selected) {
      if (piece && pc === mine) { selected = [r, c]; render(); }
      return;
    }
    if (selected[0] === r && selected[1] === c) { selected = null; render(); return; }
    if (piece && pc === mine) { selected = [r, c]; render(); return; }

    const from = square(selected[0], selected[1]);
    const to = square(r, c);
    const candidates = (gameState.legalMoves || []).filter(m => m.from === from && m.to === to);
    if (!candidates.length) return toast('⚠️ Bu hamle satranç kurallarına göre geçersiz.', 'warning');

    if (candidates.some(m => m.promotion)) {
      gameState.promotionPending = { from, to };
      render();
      return;
    }
    send(from, to, null);
  }

  function promote(piece) {
    if (!gameState?.promotionPending) return;
    const pendingMove = gameState.promotionPending;
    gameState.promotionPending = null;
    render();
    send(pendingMove.from, pendingMove.to, piece);
  }

  function send(from, to, promotion) {
    if (!socket?.connected) return toast('🔌 Sunucu bağlantısı yok.', 'error');
    pending = true;
    socket.emit('chessMove', { roomId, from, to, promotion });
  }

  function updateClock() {
    if (!gameState) return;
    const t1 = document.getElementById('t1');
    const t2 = document.getElementById('t2');
    const names = document.querySelectorAll('#topTimers .timer-name');
    const mine = colorCode();
    let white = Number(gameState.whiteTimeMs || 0);
    let black = Number(gameState.blackTimeMs || 0);
    if (gameState.status === 'playing' && gameState.serverNow) {
      const elapsed = Math.max(0, Date.now() - Number(gameState.serverNow));
      if (gameState.turn === 'w') white = Math.max(0, white - elapsed); else black = Math.max(0, black - elapsed);
    }
    if (names.length >= 2) {
      names[0].textContent = mine === 'w' ? '♙ Beyaz (Sen)' : '♟ Siyah (Sen)';
      names[1].textContent = mine === 'w' ? '♟ Siyah (Rakip)' : '♙ Beyaz (Rakip)';
    }
    if (t1) t1.textContent = format(mine === 'w' ? white : black);
    if (t2) t2.textContent = format(mine === 'w' ? black : white);
    document.querySelectorAll('#topTimers .timer').forEach((el, i) => {
      const color = i === 0 ? mine : (mine === 'w' ? 'b' : 'w');
      el.classList.toggle('active', color === gameState.turn && gameState.status === 'playing');
    });
  }

  function startClock() {
    if (clockInt) clearInterval(clockInt);
    clockInt = setInterval(updateClock, 250);
    updateClock();
  }

  window.__gvOnlineChessClick = click;
  window.__gvOnlineChessPromote = promote;

  function boot() {
    if (!window.__gvChessOnlineRequested && !isChessRoom()) return;
    roomId = getRoomId();
    if (roomId) connect();
  }

  window.addEventListener('gv:roomGameStarted', boot);
  window.addEventListener('gv:roomReady', event => {
    if (event.detail?.gameId === 'chess' || event.detail?.roomId) {
      window.__gvChessOnlineRequested = true;
      if (event.detail?.roomId) roomId = String(event.detail.roomId);
      boot();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
