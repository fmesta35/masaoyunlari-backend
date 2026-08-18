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
    toast('🚪 Rakip oyundan ayrıldı. Lobiye yönlendiriliyorsunuz...', 'warning');
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
        if (last?.to === square(r, c)) cls += ' last-to';

        if (selected) {
          const from = square(selected[0], selected[1]);
          if (moves.some(m => m.from === from && m.to === square(r, c))) {
            cls += p ? ' valid-capture' : ' valid-move';
          }
        }

        const sym = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }[p] || '';
        const canDrag = (p && pc === mine && gameState.turn === mine);

        html += `<div class="${cls}" data-r="${r}" data-c="${c}" 
            onclick="window.__gvOnlineChessClick(${r},${c})"
            ondragover="event.preventDefault()"
            ondrop="window.__gvOnlineChessDrop(event,${r},${c})"
            ${canDrag ? `draggable="true" ondragstart="window.__gvOnlineChessDragStart(event,${r},${c})"` : ''}>
            ${p ? `<span class="chess-p ${pc}">${sym}</span>` : ''}
          </div>`;
      }
    }
    html += '</div>';

    // Promotion Modal
    if (gameState.promotionPending) {
      html += '<div class="promo-overlay"><div class="promo-modal"><h3>♟️ Piyon Terfisi</h3><p style="margin-bottom:10px;font-size:0.9em;color:#aaa;">Dönüştürmek istediğiniz taşı seçin:</p><div class="promo-options">' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'q\')">♛</div>' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'r\')">♜</div>' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'b\')">♝</div>' +
        '<div class="promo-piece" onclick="window.__gvOnlineChessPromote(\'n\')">♞</div></div></div></div>';
    }

    // Game End Overlay Modal
    if (gameState.status === 'finished' || gameState.status === 'aborted') {
      const result = gameState.result || {};
      let title = '🏁 Oyun Bitti';
      let desc = '';
      if (result.reason === 'checkmate') {
        title = '♟️ ŞAH MAT!';
        desc = result.winner === playerColor ? '🏆 Tebrikler, Kazandınız!' : '💔 Rakip kazandı.';
      } else if (result.reason === 'stalemate') {
        title = '🤝 PAT!';
        desc = 'Oyun berabere bitti.';
      } else if (result.reason === 'timeout') {
        title = '⏰ SÜRE BİTTİ';
        desc = result.winner === playerColor ? '🏆 Zaman bitti, Kazandınız!' : '💔 Süreniz doldu.';
      } else if (result.reason === 'threefold_repetition') {
        title = '🤝 ÜÇLÜ TEKRAR';
        desc = 'Oyun berabere bitti.';
      } else if (result.reason === 'insufficient_material') {
        title = '🤝 YETERSİZ MATERYAL';
        desc = 'Oyun berabere bitti.';
      } else if (result.reason === 'fifty_move') {
        title = '🤝 50 HAMLE KURALI';
        desc = 'Oyun berabere bitti.';
      } else if (result.reason === 'player_left') {
        title = '🚪 OYUNCU AYRILDI';
        desc = 'Rakip oyundan ayrıldı.';
      } else {
        title = '🤝 BERABERE';
        desc = 'Oyun berabere bitti.';
      }
      html += `<div class="chess-end-overlay"><div class="chess-end-modal"><div class="end-icon">🏁</div><h2>${title}</h2><p>${desc}</p><button class="btn btn-p" style="margin-top:15px;padding:10px 20px;cursor:pointer;" onclick="window.__gvRealChessLeave()">🚪 Odadan Ayrıl ve Lobiye Dön</button></div></div>`;
    }

    html += '</div>';
    area.innerHTML = html;
  }

  function click(r, c) {
    if (!active || !gameState || gameState.status !== 'playing' || pending) return;
    const mine = colorCode();
    if (!mine) return toast('⏳ Oyuncu rengi bekleniyor.', 'info');
    if (gameState.turn !== mine) return toast('⏳ Sıra sizde değil! Rakibin hamlesi bekleniyor.', 'warning');

    const piece = gameState.board[r][c] || '';
    const pc = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null;

    if (!selected) {
      if (piece && pc === mine) {
        selected = [r, c];
        render();
        toast(`♟️ Seçildi: ${square(r, c)}. Lütfen hedef kareye tıklayın.`, 'info');
      } else if (piece) {
        toast('⚠️ Bu taş size ait değil.', 'warning');
      }
      return;
    }

    if (selected[0] === r && selected[1] === c) {
      selected = null;
      render();
      return;
    }

    if (piece && pc === mine) {
      selected = [r, c];
      render();
      toast(`♟️ Seçildi: ${square(r, c)}. Lütfen hedef kareye tıklayın.`, 'info');
      return;
    }

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

  function dragStart(ev, r, c) {
    if (!active || !gameState || gameState.status !== 'playing' || pending) return;
    const mine = colorCode();
    if (gameState.turn !== mine) return;
    selected = [r, c];
    if (ev.dataTransfer) {
      ev.dataTransfer.setData('text/plain', JSON.stringify({ r, c }));
    }
    render();
  }

  function drop(ev, tr, tc) {
    ev.preventDefault();
    if (!selected) return;
    const from = square(selected[0], selected[1]);
    const to = square(tr, tc);
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
    socket.emit('chessMove', { roomId, from, to, promotion, userKey: userKey() });
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
      if (gameState.turn === 'w') white = Math.max(0, white - elapsed);
      else black = Math.max(0, black - elapsed);
    }

    if (names.length >= 2) {
      names[0].textContent = mine === 'w' ? '⚪ Beyaz (Siz)' : '🔴 Siyah (Siz)';
      names[1].textContent = mine === 'w' ? '🔴 Siyah (Rakip)' : '⚪ Beyaz (Rakip)';
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
  window.__gvOnlineChessDragStart = dragStart;
  window.__gvOnlineChessDrop = drop;
  window.__gvOnlineChessPromote = promote;

  function boot() {
    if (!isChessRoom()) return;
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
