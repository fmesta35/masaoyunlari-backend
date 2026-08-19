/* GameVerse - Authoritative Online Chess Client
 * Frontend on Yöncü Shared Hosting; Socket.IO backend on Render.com.
 */
(function () {
  'use strict';
  // Bu dosya hem index.html'den statik olarak hem de room-waiting-fix.js
  // tarafından dinamik olarak yüklenebilir; iki kez çalışmasını engelle.
  if (window.__gvChessOnlineLoaded) return;
  window.__gvChessOnlineLoaded = true;

  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let roomId = null;
  let playerColor = null;
  let gameState = null;
  let selected = null;
  let pending = false;
  let active = false;
  let clockInt = null;

  // Çift tetiklenmeye karşı tıklama kilidi
  let lastExecTime = 0;
  let lastClickCell = -1;

  // Score tracking per session (Starts 0 - 0)
  let myMatchScore = 0;
  let oppMatchScore = 0;

  // Şah uyarısının aynı pozisyon için tekrar tekrar gösterilmemesi için
  let lastCheckFen = null;

  // Terfi seçimi ARTIK gameState üzerinde değil ayrı değişkende tutulur:
  // sunucudan gelen her durum paketi gameState nesnesini yenilediği için
  // pencere kendiliğinden kapanıyordu. Pozisyon değişmedikçe korunur.
  let promotionPending = null;

  function clearDuplicateToasts() {
    const wrap = document.getElementById('toastWrap');
    if (wrap) wrap.innerHTML = '';
  }

  function toast(message, type) {
    clearDuplicateToasts();
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
    // room-waiting-fix.js ile AYNI anahtar kullanılmalı; aksi halde sunucu
    // yeniden bağlanan oyuncuyu koltuğuyla eşleştiremez.
    let id = localStorage.getItem('gv-chess-guest-id') || localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    localStorage.setItem('gv-chess-guest-id', id);
    return 'guest:' + id;
  }

  function loadSocketClient(done) {
    if (window.io) return done();
    const sources = ['js/socket.io.min.js', 'socket.io.min.js', 'https://cdn.socket.io/4.7.5/socket.io.min.js'];
    (function tryNext(i) {
      if (i >= sources.length) return toast('🔌 Socket.IO istemcisi yüklenemedi.', 'error');
      const s = document.createElement('script');
      s.src = sources[i];
      s.onload = done;
      s.onerror = () => tryNext(i + 1);
      document.head.appendChild(s);
    })(0);
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

  let autoReturnTimer = null;
  function autoReturnToLobby() {
    if (autoReturnTimer) return; // bir kez planla
    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      if (typeof window.__gvRealChessLeave === 'function') {
        window.__gvRealChessLeave();
      } else if (typeof window.leaveRoom === 'function') {
        window.leaveRoom();
      }
    }, 5000);
  }

  function handlePlayerLeft() {
    active = false;
    pending = false;
    toast('🚪 Rakip oyundan ayrıldı. Lobiye yönlendiriliyorsunuz...', 'warning');
    autoReturnToLobby();
  }

  function connect() {
    roomId = getRoomId();
    if (!roomId || !isChessRoom()) return;
    loadSocketClient(() => {
      // Bekleme odası (room-waiting-fix) yeni bir soket oluşturduysa eski
      // soketi bırak ve güncel olanı devral.
      if (socket && window.__gvRoomSocket && socket !== window.__gvRoomSocket) {
        try { socket.off && socket.off(); } catch (_) {}
        socket = null;
      }
      if (socket) {
        if (socket.connected) join();
        return;
      }
      socket = window.__gvRoomSocket || window.__gvChessSocket || window.io(BACKEND, {
        transports: ['polling', 'websocket'],
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
        const inCheck = !!(payload?.gameState?.check);
        const messages = {
          not_your_turn: '⏳ Sıra sizde değil! Rakibin hamlesi bekleniyor.',
          illegal_move: inCheck
            ? '⛔ ŞAH tehdidi altındasınız! Sadece Şah\'ınızı kurtaran hamleler oynanabilir.'
            : '⚠️ Satranç kurallarına göre geçersiz hamle.',
          not_in_room: '⚠️ Oyuncu koltuğu bulunamadı.',
          time_expired: '⏰ Süreniz doldu.'
        };
        toast(messages[payload?.reason] || '⚠️ Hamle reddedildi.', 'warning');
      });

      socket.on('gameEnded', payload => {
        pending = false;
        active = true;
        if (payload?.gameState) apply(payload.gameState);

        // Terk / hükmen mağlubiyet: her iki oyuncu da 5 sn sonra lobiye döner,
        // masa yeni oyuncular için sıfırlanır.
        if (payload?.reason === 'player_left' || payload?.reason === 'abandon') {
          const winner = payload.winner || payload.gameState?.result?.winner;
          if (winner === playerColor) {
            toast('🏆 Oyunu KAZANDINIZ! Rakibiniz oyunu terk etti. Lobiye yönlendiriliyorsunuz...', 'success');
          } else {
            toast('💔 Oyunu terk ettiğiniz için KAYBETTİNİZ. Lobiye yönlendiriliyorsunuz...', 'error');
          }
          autoReturnToLobby();
        }
      });

      // Hamle süresi uyarısı: 1 dakikadır hamle yapılmadı, 1 dakika daha
      // beklenirse hükmen mağlubiyet.
      socket.on('moveTimeWarning', payload => {
        if (!payload || String(payload.roomId) !== String(roomId) || !isChessRoom()) return;
        const secs = Math.ceil(Math.max(0, Number(payload.remainingMs) || 60000) / 1000);
        if (payload.color === playerColor) {
          toast(`⏰ 1 dakikadır hamle yapmadınız! ${secs} saniye içinde oynamazsanız HÜKMEN MAĞLUP sayılacaksınız!`, 'error');
        } else {
          toast(`⏳ Rakibiniz hamle yapmıyor. ${secs} saniye içinde oynamazsa hükmen mağlup sayılacak.`, 'warning');
        }
      });

      socket.on('playerLeft', () => {
        handlePlayerLeft();
      });

      // KRİTİK: Bu script çoğu zaman oyun başladıktan SONRA, bekleme odasının
      // zaten bağlanmış olan soketini devralarak çalışır. Soket bağlı olduğu
      // için 'connect' olayı bir daha tetiklenmez ve 'gameStarted' çoktan
      // kaçırılmıştır. Hemen joinRoom göndererek sunucudan güncel oyun
      // durumunu (gameStarted + gameState) yeniden isteriz.
      if (socket.connected) join();
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
    // Tahta pozisyonu DEĞİŞMEDİYSE (aynı fen) oyuncunun taş seçimini KORU.
    // Aksi halde sunucudan gelen her durum yayını (reconnect, rakibin join'i
    // vb.) seçimi siler ve oyuncu hedef kareye tıklayamadan seçim kaybolur.
    const sameBoard = gameState && gameState.fen && gs.fen &&
      gameState.fen === gs.fen && gameState.status === gs.status;
    gameState = gs;
    if (!sameBoard) {
      selected = null;
      promotionPending = null; // pozisyon değişti; bekleyen terfi geçersiz
    }
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
    notifyCheck();
  }

  // ŞAH bildirimi: şah çekildiğinde her iki tarafa uygun uyarıyı gösterir.
  function notifyCheck() {
    if (!gameState || gameState.status !== 'playing' || !gameState.check) return;
    if (gameState.fen && gameState.fen === lastCheckFen) return; // aynı pozisyon için tekrarlama
    lastCheckFen = gameState.fen || null;
    const mine = colorCode();
    if (gameState.turn === mine) {
      toast('⚠️ ŞAH! Şahınız tehdit altında — Şah\'ınızı korumalısınız!', 'error');
    } else {
      toast('♚ ŞAH çektiniz! Rakip şahını korumak zorunda.', 'success');
    }
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
      .chess-c { cursor: pointer !important; touch-action: manipulation; transition: all 0.15s ease; position: relative; }
      .chess-c.sel { outline: 4px solid #f1c40f !important; outline-offset: -4px; background: rgba(241, 196, 15, 0.45) !important; box-shadow: inset 0 0 15px rgba(241, 196, 15, 0.7) !important; z-index: 5 !important; }
      /* Oynanabilir TÜM hamleler sarı işaretle gösterilir:
         boş kare -> dolu sarı nokta, rakip taşı -> sarı halka */
      .chess-c.valid-move::after { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 30%; height: 30%; background: #f1c40f !important; box-shadow: 0 0 10px rgba(241, 196, 15, 0.9); border-radius: 50%; pointer-events: none; z-index: 6; animation: gvDotPulse 1.2s ease-in-out infinite; }
      .chess-c.valid-capture { outline: none !important; }
      .chess-c.valid-capture::after { content: ''; position: absolute; inset: 5%; border: 4px solid #f1c40f; border-radius: 50%; box-shadow: 0 0 10px rgba(241, 196, 15, 0.8), inset 0 0 8px rgba(241, 196, 15, 0.5); background: rgba(241, 196, 15, 0.12); pointer-events: none; z-index: 6; }
      @keyframes gvDotPulse { 0%, 100% { opacity: .85; } 50% { opacity: .5; } }
      .chess-c.in-check { background: radial-gradient(circle, rgba(255,107,107,.75), rgba(255,107,107,.35)) !important; animation: gvCheckPulse 1s infinite; }
      @keyframes gvCheckPulse { 0%, 100% { box-shadow: inset 0 0 12px rgba(255,0,0,.8); } 50% { box-shadow: inset 0 0 25px rgba(255,0,0,.5); } }
      .chess-end-overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; background: rgba(6,7,20,0.88); backdrop-filter: blur(12px); }
      .chess-end-modal { background: #111128; border: 1px solid rgba(255,255,255,0.15); padding: 28px; border-radius: 18px; text-align: center; color: #fff; box-shadow: 0 20px 60px rgba(0,0,0,0.7); max-width: 420px; width: 90%; }
      .chess-end-modal h2 { margin: 12px 0 8px; font-size: 1.5rem; color: #6c5ce7; }
      .chess-end-modal p { color: #aaa; margin-bottom: 20px; font-size: 1rem; }
      .end-icon { font-size: 3rem; }
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

    // Şah tehdidi altındaki şahın karesi (kırmızı vurgulanır)
    let checkedKing = null;
    if (gameState.check && gameState.status === 'playing') {
      const kingChar = gameState.turn === 'w' ? 'K' : 'k';
      for (let kr = 0; kr < 8 && !checkedKing; kr++) {
        for (let kc = 0; kc < 8; kc++) {
          if (board[kr][kc] === kingChar) { checkedKing = [kr, kc]; break; }
        }
      }
    }

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
        if (checkedKing && checkedKing[0] === r && checkedKing[1] === c) cls += ' in-check';

        if (selected) {
          const from = square(selected[0], selected[1]);
          if (moves.some(m => m.from === from && m.to === square(r, c))) {
            cls += p ? ' valid-capture' : ' valid-move';
          }
        }

        const sym = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }[p] || '';
        const canDrag = (p && pc === mine && gameState.turn === mine);

        html += `<div class="${cls}" data-r="${r}" data-c="${c}" 
            ondragover="event.preventDefault()"
            ondrop="window.__gvOnlineChessDrop(event,${r},${c})"
            ${canDrag ? `draggable="true" ondragstart="window.__gvOnlineChessDragStart(event,${r},${c})"` : ''}>
            ${p ? `<span class="chess-p ${pc}">${sym}</span>` : ''}
          </div>`;
      }
    }
    html += '</div>';

    // Promotion Modal
    if (promotionPending) {
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
      } else if (result.reason === 'player_left' || result.reason === 'abandon') {
        title = '🚪 OYUN TERK EDİLDİ';
        desc = result.winner === playerColor
          ? '🏆 Oyunu KAZANDINIZ! Rakibiniz oyunu terk etti. Birazdan lobiye yönlendirileceksiniz...'
          : '💔 Oyunu terk ettiğiniz için KAYBETTİNİZ. Birazdan lobiye yönlendirileceksiniz...';
      } else {
        title = '🤝 BERABERE';
        desc = 'Oyun berabere bitti.';
      }
      html += `<div class="chess-end-overlay"><div class="chess-end-modal"><div class="end-icon">🏁</div><h2>${title}</h2><p>${desc}</p><button class="btn btn-p" style="margin-top:15px;padding:10px 20px;cursor:pointer;" onclick="window.__gvRealChessLeave()">🚪 Odadan Ayrıl ve Lobiye Dön</button></div></div>`;
    }

    html += '</div>';
    area.innerHTML = html;
    attachBoardDelegation(area);
  }

  // Tıklamalar tek bir delege dinleyiciyle yakalanır (inline onclick yok).
  // Farede 'pointerdown' (basıldığı an) kullanılır: draggable kareler ufak fare
  // kaymasında click olayını yutabildiği için "birkaç kez tıklayınca çalışıyor"
  // hissi oluşuyordu. pointerdown İLK dokunuşta anında tepki verir.
  let delegationAttached = false;
  let swallowNextClick = false;
  function attachBoardDelegation(area) {
    if (delegationAttached || !area) return;
    delegationAttached = true;

    const handleBoardEvent = function (ev) {
      if (!active || !gameState) return; // sadece online satranç aktifken
      if (promotionPending) return; // terfi seçimi açıkken tahta kilitli
      const cell = ev.target.closest('.chess-c');
      if (!cell || !area.contains(cell) || cell.dataset.r === undefined) return;
      const r = parseInt(cell.dataset.r, 10);
      const c = parseInt(cell.dataset.c, 10);
      if (!isNaN(r) && !isNaN(c)) click(r, c);
    };

    if (window.PointerEvent) {
      area.addEventListener('pointerdown', function (ev) {
        if (ev.pointerType !== 'mouse' || ev.button !== 0) return;
        // Yalnızca tahta karelerinde işle; terfi penceresi vb. öğelerde
        // click olayına karışma.
                if (!ev.target.closest('.chess-c')) return;
        // Bu basışın üreteceği click olayını (ne kadar geç gelirse gelsin)
        // yut; yoksa yavaş tıklamada seçim anında geri alınıyor.
        swallowNextClick = true;
        handleBoardEvent(ev);
      });
    }
    // Dokunmatik ekran / kalem / eski tarayıcılar için click yedeği
    area.addEventListener('click', function (ev) {
      if (swallowNextClick) { swallowNextClick = false; return; } // fare: pointerdown'da işlendi
      handleBoardEvent(ev);
    });
    }
    // Dokunmatik ekran / kalem / eski tarayıcılar için click yedeği
    area.addEventListener('click', function (ev) {
      if (Date.now() < suppressClickUntil) return; // fare: pointerdown'da işlendi
      handleBoardEvent(ev);
    });
  }

  function click(r, c) {
    if (!active || !gameState || gameState.status !== 'playing' || pending) return;
    if (promotionPending) return; // terfi seçimi tamamlanmadan tahta kilitli

    // Çift tetiklenme kilidi: yalnızca AYNI kareye 100ms içinde gelen mükerrer
    // tıklamayı yok say (farklı kareye hızlı tıklama meşrudur, yenmemeli).
    const now = Date.now();
    const cellIdx = r * 8 + c;
    if (now - lastExecTime < 100 && lastClickCell === cellIdx) {
      return;
    }
    lastExecTime = now;
    lastClickCell = cellIdx;

    const mine = colorCode();
    if (!mine) return toast('⏳ Oyuncu rengi bekleniyor.', 'info');
    if (gameState.turn !== mine) return toast('⏳ Sıra sizde değil! Rakibin hamlesi bekleniyor.', 'warning');

    const piece = gameState.board[r][c] || '';
    const pc = piece ? (piece === piece.toUpperCase() ? 'w' : 'b') : null;

    // 1. No piece selected yet
    if (!selected) {
      if (piece && pc === mine) {
        selected = [r, c];
        render();
        const fromSq = square(r, c);
        const pieceMoves = (gameState.legalMoves || []).filter(m => m.from === fromSq);
        if (!pieceMoves.length) {
          toast(gameState.check
            ? '⛔ Bu taşla Şah\'ınızı koruyamazsınız! Başka bir taş deneyin.'
            : '⚠️ Bu taşın oynanabilir hamlesi yok. Başka bir taş seçin.', 'warning');
        } else {
          toast(`♟️ Seçildi: ${fromSq}. Lütfen hedef kareye tıklayın.`, 'info');
        }
      } else if (piece) {
        toast('⚠️ Bu taş size ait değil.', 'warning');
      }
      return;
    }

    // 2. Re-clicking the SAME selected piece -> DESELECT!
    if (selected[0] === r && selected[1] === c) {
      selected = null;
      render();
      toast('↩️ Seçim iptal edildi.', 'info');
      return;
    }

    // 3. Clicking another piece of OWN color -> SWITCH SELECTION!
    if (piece && pc === mine) {
      selected = [r, c];
      render();
      const fromSq = square(r, c);
      const pieceMoves = (gameState.legalMoves || []).filter(m => m.from === fromSq);
      if (!pieceMoves.length) {
        toast(gameState.check
          ? '⛔ Bu taşla Şah\'ınızı koruyamazsınız! Başka bir taş deneyin.'
          : '⚠️ Bu taşın oynanabilir hamlesi yok. Başka bir taş seçin.', 'warning');
      } else {
        toast(`♟️ Seçildi: ${fromSq}. Lütfen hedef kareye tıklayın.`, 'info');
      }
      return;
    }

    // 4. Attempting move to destination square (r, c)
    const from = square(selected[0], selected[1]);
    const to = square(r, c);
    const candidates = (gameState.legalMoves || []).filter(m => m.from === from && m.to === to);

    if (!candidates.length) {
      // Invalid destination clicked -> DESELECT piece
      selected = null;
      render();
      toast(gameState.check
        ? '⛔ ŞAH tehdidi altındasınız! Bu hamle Şah\'ınızı kurtarmıyor — sadece Şah\'ı koruyan hamleler oynanabilir.'
        : '⚠️ Geçersiz kare. Seçim iptal edildi.', gameState.check ? 'error' : 'warning');
      return;
    }

    if (candidates.some(m => m.promotion)) {
      promotionPending = { from, to };
      render();
      return;
    }

    send(from, to, null);
  }

  function dragStart(ev, r, c) {
    if (!active || !gameState || gameState.status !== 'playing' || pending) return;
    if (promotionPending) return;
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
    if (promotionPending) return;
    if (!selected) return;
    const from = square(selected[0], selected[1]);
    const to = square(tr, tc);
    const candidates = (gameState.legalMoves || []).filter(m => m.from === from && m.to === to);

    if (!candidates.length) {
      selected = null;
      render();
      toast(gameState.check
        ? '⛔ ŞAH tehdidi altındasınız! Bu hamle Şah\'ınızı kurtarmıyor — sadece Şah\'ı koruyan hamleler oynanabilir.'
        : '⚠️ Geçersiz kare. Seçim iptal edildi.', gameState.check ? 'error' : 'warning');
      return;
    }

    if (candidates.some(m => m.promotion)) {
      promotionPending = { from, to };
      render();
      return;
    }

    send(from, to, null);
  }

  function promote(piece) {
    if (!promotionPending) return;
    const pendingMove = promotionPending;
    promotionPending = null;
    render();
    send(pendingMove.from, pendingMove.to, piece);
  }

    let pendingTimer = null;
  function send(from, to, promotion) {
    if (!socket?.connected) return toast('🔌 Sunucu bağlantısı yok. Bağlantı kurulunca tekrar deneyin.', 'error');
    pending = true;
    // Güvenlik: 8 sn içinde sunucudan yanıt gelmezse kilidi kaldır
    // (bağlantı sorununda tahta sonsuza dek kilitli kalmasın).
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pending = false; }, 8000);
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

  if (!window.GV) window.GV = {};
  window.GV._cc = click;
  window._cc = click;
  window.__gvOnlineChessClick = click;
  window.__gvOnlineChessDragStart = dragStart;
  window.__gvOnlineChessDrop = drop;
  window.__gvOnlineChessPromote = promote;

  // Odadan ayrılırken room-waiting-fix.js tarafından çağrılır;
  // oyun durumunu tamamen sıfırlar ki eski tahta/tıklamalar takılı kalmasın.
  window.__gvChessOnlineReset = function () {
    active = false;
    pending = false;
    gameState = null;
    selected = null;
    playerColor = null;
    roomId = null;
    if (clockInt) { clearInterval(clockInt); clockInt = null; }
    socket = null; // room-waiting-fix yeni oyun için yeni soket oluşturur
    myMatchScore = 0;
    oppMatchScore = 0;
  };

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
