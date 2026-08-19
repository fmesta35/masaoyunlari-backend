/* GameVerse - Authoritative Online Tavla Client
 * Backend SUNUCUDA yetkilidir (zar, hamle, vuruş, toplama, süreler).
 * Tahta çizimi index.html'deki dTavla() yeniden kullanılır; bu modül yalnızca
 * sunucu durumunu st.boards.tavla'ya yansıtır ve GV._tv* tıklamalarını
 * (online odadayken) sunucuya yönlendirir. Satranç istemcisinden BAĞIMSIZDIR.
 */
(function () {
  'use strict';
  if (window.__gvTavlaOnlineLoaded) return;
  window.__gvTavlaOnlineLoaded = true;

  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let roomId = null;
  let playerColor = null;   // 'white' | 'black'
  let gameState = null;     // sunucudan gelen yetkili durum
  let active = false;
  let clockInt = null;
  let isSpectator = !!window.__gvIsSpectator;

  // Seçim tamamen istemciye ait görsel durumdur (yetki sunucuda).
  let sel = null;
  let lastNoticeId = null;
  let lastRollKey = null;
  let fallbackTimer = null;

  // Bitiş kararları: sunucunun kişiye özel youWon bilgisi (renk karşılaştırması
  // "ters mesaj" hatasına yol açabildiği için tek doğru kaynak budur).
  let endYouWon = null;
  let forfeitYouWon = null;

  function getState() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  function isTavlaRoom() {
    const s = getState();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = String(g).toLowerCase().trim();
    if (g === 'tavla') return true;
    if (g) return false;
    const title = document.getElementById('grTitle')?.textContent || '';
    return /tavla/i.test(title);
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
    // room-waiting-fix.js / chess-online.js ile AYNI anahtar ailesi kullanılır.
    let id = localStorage.getItem('gv-chess-guest-id') || localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    localStorage.setItem('gv-chess-guest-id', id);
    return 'guest:' + id;
  }

  function clearDuplicateToasts() {
    const wrap = document.getElementById('toastWrap');
    if (wrap) wrap.innerHTML = '';
  }

  function toast(message, type) {
    clearDuplicateToasts();
    if (window.GV && typeof window.GV.toast === 'function') {
      try { window.GV.toast(message, type || 'info'); return; } catch (_) {}
    }
    console.log(`[Tavla] (${type}): ${message}`);
  }

  function mine() { // 'w' | 'b' | null
    return playerColor === 'white' ? 'w' : playerColor === 'black' ? 'b' : null;
  }

  function myTurn() {
    return !isSpectator && mine() && gameState && gameState.turn === mine();
  }

  function mySteps() {
    return (gameState && Array.isArray(gameState.legalMoves)) ? gameState.legalMoves : [];
  }

  function selTargets() {
    if (sel === null || sel === undefined) return [];
    return mySteps().filter(x => x.from === sel && typeof x.to === 'number').map(x => x.to);
  }

  function injectStyle() {
    if (document.getElementById('gv-tavla-online-style')) return;
    const style = document.createElement('style');
    style.id = 'gv-tavla-online-style';
    style.textContent = `
      .tavla-move-badge { display: block; width: max-content; max-width: 100%; margin: 0 auto 8px; padding: 6px 14px; border-radius: 999px; background: rgba(46,213,115,.14); border: 1px solid rgba(46,213,115,.45); color: #7bed9f; font-weight: 700; font-size: .92rem; text-align: center; font-variant-numeric: tabular-nums; }
      .tavla-move-badge.danger { background: rgba(255,71,87,.18); border-color: rgba(255,71,87,.55); color: #ff6b81; animation: gvTavlaDanger 1s ease-in-out infinite; }
      @keyframes gvTavlaDanger { 0%, 100% { box-shadow: 0 0 0 rgba(255,71,87,0); } 50% { box-shadow: 0 0 14px rgba(255,71,87,.55); } }
      .chess-end-overlay { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: center; justify-content: center; background: rgba(6,7,20,0.88); backdrop-filter: blur(12px); }
      .chess-end-modal { background: #111128; border: 1px solid rgba(255,255,255,0.15); padding: 28px; border-radius: 18px; text-align: center; color: #fff; box-shadow: 0 20px 60px rgba(0,0,0,0.7); max-width: 420px; width: 90%; }
      .chess-end-modal h2 { margin: 12px 0 8px; font-size: 1.5rem; color: #f9ca24; }
      .chess-end-modal p { color: #aaa; margin-bottom: 20px; font-size: 1rem; }
      .end-icon { font-size: 3rem; }
    `;
    document.head.appendChild(style);
  }

  // ---------- Görünüm: sunucu durumu -> st.boards.tavla + dTavla ----------
  function rerender() {
    if (!gameState) return;
    const s = getState();
    if (!s) return;
    injectStyle();
    s.boards = s.boards || {};
    s.boards.tavla = {
      points: gameState.points,
      bar: gameState.bar,
      off: gameState.off,
      dice: gameState.rolled ? gameState.dice : [0, 0],
      availableMoves: (gameState.movesLeft || []).slice(),
      turn: gameState.turn,
      diceRolled: !!gameState.rolled,
      gameEnded: gameState.status === 'finished',
      selected: sel,
      validTargets: selTargets(),
      moveHistory: new Array(gameState.turnMoves || 0).fill(0)
    };
    const area = document.getElementById('boardArea');
    if (area && typeof window.dTavla === 'function') {
      window.dTavla(area);
      postRender(area);
    }
    updateClock();
  }

  function postRender(area) {
    // Sıram değilse / izleyiciysem butonlar pasif görünsün.
    const lock = !myTurn() || !active || gameState.status !== 'playing';
    const rollBtn = area.querySelector('.tavla-btn[onclick*="_tvRoll"]');
    if (rollBtn && (lock || gameState.rolled)) {
      rollBtn.disabled = true;
      rollBtn.style.opacity = '0.45';
      rollBtn.style.cursor = 'not-allowed';
    }
    if (lock) {
      area.querySelectorAll('.tavla-btn.undo, .tavla-btn.end').forEach(b => {
        b.disabled = true;
        b.style.opacity = '0.45';
        b.style.cursor = 'not-allowed';
      });
    }
    renderEndOverlay(area);
  }

  function winnerName(color) {
    return color === 'white' ? 'Beyaz' : color === 'black' ? 'Siyah' : 'Bir oyuncu';
  }

  function renderEndOverlay(area) {
    if (!gameState || gameState.status !== 'finished') return;
    if (area.querySelector('.chess-end-overlay')) return;
    const result = gameState.result || {};
    const winner = result.winner;
    let title = '🏁 Oyun Bitti';
    let desc = '';
    const iWon = forfeitYouWon !== null ? forfeitYouWon : (endYouWon !== null ? endYouWon : (winner && winner === playerColor));
    if (result.reason === 'win' || result.reason === 'mars') {
      title = result.reason === 'mars' ? '🔥 MARS!' : '🎲 OYUN BİTTİ';
      desc = isSpectator
        ? (winnerName(winner) + (result.reason === 'mars' ? ' MARS ile kazandı!' : ' kazandı.'))
        : (iWon
          ? (result.reason === 'mars' ? '🏆 Rakibe hiç pul çıkarttırmadınız — MARS ile KAZANDINIZ!' : '🏆 Tüm pullarınızı önce topladınız — KAZANDINIZ!')
          : (result.reason === 'mars' ? '💔 Hiç pul çıkaramadınız — MARS ile kaybettiniz.' : '💔 Rakip tüm pullarını önce topladı.'));
    } else if (result.reason === 'move_timeout') {
      title = '⏱ HAMLE SÜRESİ DOLDU';
      desc = isSpectator
        ? (winnerName(winner) + ' kazandı. Hamle süresi doldu.')
        : (iWon ? '🏆 Rakibiniz hamle süresini doldurdu — KAZANDINIZ!' : '💔 Hamle süreniz doldu — HÜKMEN KAYBETTİNİZ.');
    } else if (result.reason === 'timeout') {
      title = '⏰ SÜRE BİTTİ';
      desc = isSpectator
        ? (winnerName(winner) + ' kazandı (ana süre doldu).')
        : (iWon ? '🏆 Rakibin ana süresi doldu, KAZANDINIZ!' : '💔 Ana süreniz doldu.');
    } else if (result.reason === 'player_left' || result.reason === 'abandon') {
      title = '🚪 OYUN TERK EDİLDİ';
      desc = isSpectator
        ? (winnerName(winner) + ' kazandı. Oyun terk edildi.')
        : (iWon ? '🏆 Oyunu KAZANDINIZ! Rakibiniz oyunu terk etti.' : '💔 Oyunu terk ettiğiniz için KAYBETTİNİZ.');
    }
    area.insertAdjacentHTML('beforeend',
      `<div class="chess-end-overlay"><div class="chess-end-modal"><div class="end-icon">🎲</div><h2>${title}</h2><p>${desc}</p><button class="btn btn-p" style="margin-top:15px;padding:10px 20px;cursor:pointer;" onclick="window.__gvRealChessLeave()">🚪 Odadan Ayrıl ve Lobiye Dön</button></div></div>`);
  }

  // ---------- Durum uygulama ----------
  function apply(gs) {
    if (!gs || gs.kind !== 'tavla') return;
    // Yetkili sunucu durumu ulaştı: yerel yedek planı iptal.
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    gameState = gs;

    if (!active) active = true;

    // Zar duyurusu (tur başına bir kez)
    if (gs.rolled) {
      const key = gs.turn + ':' + gs.dice.join(',') + ':' + (gs.movesLeft || []).join(',');
      if (key !== lastRollKey && gs.turnMoves === 0) {
        lastRollKey = key;
        toast(`🎲 Zar: ${gs.dice[0]}-${gs.dice[1]} (${gs.turn === 'w' ? 'BEYAZ' : 'SİYAH'})`, 'info');
      }
    }

    // Sunucu duyurusu (hamle yok -> otomatik pas)
    if (gs.notice && gs.notice.id && gs.notice.id !== lastNoticeId) {
      lastNoticeId = gs.notice.id;
      toast('🔁 ' + gs.notice.text, 'warning');
    }

    // Seçim artık geçersizse temizle
    if (sel !== null && !mySteps().some(x => x.from === sel)) sel = null;

    rerender();
  }

  // ---------- Saat / rozet ----------
  function format(ms) {
    const sec = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  function updateClock() {
    if (!gameState) return;
    const t1 = document.getElementById('t1');
    const t2 = document.getElementById('t2');
    const names = document.querySelectorAll('#topTimers .timer-name');
    const m = mine();

    let white = Number(gameState.whiteTimeMs || 0);
    let black = Number(gameState.blackTimeMs || 0);
    if (gameState.status === 'playing' && gameState.serverNow) {
      const elapsed = Math.max(0, Date.now() - Number(gameState.serverNow));
      if (gameState.turn === 'w') white = Math.max(0, white - elapsed);
      else black = Math.max(0, black - elapsed);
    }

    if (names.length >= 2) {
      if (isSpectator || !m) {
        names[0].textContent = '⚪ Beyaz';
        names[1].textContent = '⚫ Siyah';
      } else {
        names[0].textContent = m === 'w' ? '⚪ Beyaz (Siz)' : '⚫ Siyah (Siz)';
        names[1].textContent = m === 'w' ? '⚫ Siyah (Rakip)' : '⚪ Beyaz (Rakip)';
      }
    }
    if (isSpectator || !m) {
      if (t1) t1.textContent = format(white);
      if (t2) t2.textContent = format(black);
    } else {
      if (t1) t1.textContent = format(m === 'w' ? white : black);
      if (t2) t2.textContent = format(m === 'w' ? black : white);
    }

    document.querySelectorAll('#topTimers .timer').forEach((el, i) => {
      const color = (isSpectator || !m) ? (i === 0 ? 'w' : 'b') : (i === 0 ? m : (m === 'w' ? 'b' : 'w'));
      el.classList.toggle('active', color === gameState.turn && gameState.status === 'playing');
    });

    // Hamle süresi rozeti (son ~20 sn kırmızı) — satrançtakiyle aynı kural.
    const badge = document.getElementById('tvMoveBadge');
    if (badge) {
      const limit = Number(gameState.moveLimitMs) || 60000;
      if (gameState.status === 'playing' && typeof gameState.moveRemainingMs === 'number') {
        const sincePack = gameState.serverNow ? Math.max(0, Date.now() - Number(gameState.serverNow)) : 0;
        const remain = Math.max(0, Number(gameState.moveRemainingMs) - sincePack);
        const secs = Math.ceil(remain / 1000);
        const who = gameState.turn === 'w' ? 'Beyaz' : 'Siyah';
        badge.textContent = `⏱ Hamle sırası: ${who} — ${secs} sn`;
        badge.classList.toggle('danger', remain <= Math.min(20000, limit / 2));
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function startClock() {
    if (clockInt) clearInterval(clockInt);
    clockInt = setInterval(updateClock, 250);
    updateClock();
  }

  // ---------- Online eylemler ----------
  function onlineActive() {
    return !!(active && gameState && isTavlaRoom());
  }

  function onlineRoll() {
    if (!onlineActive()) return;
    if (isSpectator) return toast('👁️ İzleyicisiniz — zar atamazsınız.', 'info');
    if (!myTurn()) return toast('⏳ Sıra sizde değil! Rakibin zar atması bekleniyor.', 'warning');
    if (gameState.rolled) return;
    socket?.emit('tavlaRoll', { roomId });
  }

  function sendMove(from, to) {
    socket?.emit('tavlaMove', { roomId, from, to });
  }

  function onlineClick(i) {
    if (!onlineActive()) return;
    if (gameState.status !== 'playing') return;
    if (isSpectator) return;
    const m = mine();
    if (gameState.turn !== m) return toast('⏳ Sıra sizde değil! Rakibin hamlesi bekleniyor.', 'warning');
    if (!gameState.rolled) return toast('🎲 Önce zar atmalısınız!', 'warning');

    // Kırık pul önce bar'dan girmek ZORUNDA
    if ((gameState.bar?.[m] || 0) > 0) {
      const targets = mySteps().filter(x => x.from === 'bar').map(x => x.to);
      if (targets.includes(i)) { sendMove('bar', i); return; }
      return toast("🚧 Kırık pulunuz var — önce bar'dan yerleştirmelisiniz!", 'warning');
    }

    if (sel === null || sel === undefined) {
      if (mySteps().some(x => x.from === i)) { sel = i; rerender(); }
      else {
        const p = gameState.points[i];
        if (p && p.color === m && p.count > 0) toast('❌ Bu pul bu zarla oynatılamaz.', 'warning');
      }
      return;
    }
    if (i === sel) { sel = null; rerender(); return; }

    const step = mySteps().find(x => x.from === sel && x.to === i);
    if (step) {
      const f = sel;
      sel = null;
      sendMove(f, i);
      return;
    }
    // Başka bir kendi puluna tıklandıysa seçimi değiştir
    if (mySteps().some(x => x.from === i)) { sel = i; rerender(); return; }
    toast('❌ Geçersiz hedef.', 'warning');
  }

  function onlineBearOff(c) {
    if (!onlineActive()) return;
    if (gameState.status !== 'playing') return;
    if (isSpectator) return;
    if (c !== gameState.turn) return toast('⏳ Sıra sizde değil!', 'warning');
    if (!myTurn()) return toast('⏳ Sıra sizde değil!', 'warning');
    if (!gameState.rolled) return toast('🎲 Önce zar atmalısınız!', 'warning');
    const step = mySteps().find(x => x.to === 'off');
    if (!step) return toast('📦 Şu an pul toplayamazsınız. (Tüm pullar evde olmalı)', 'warning');
    sel = null;
    sendMove(step.from, 'off');
  }

  function onlineUndo() {
    if (!onlineActive()) return;
    if (!myTurn()) return toast('⏳ Sıra sizde değil!', 'warning');
    socket?.emit('tavlaUndo', { roomId });
  }

  function onlineEndTurn() {
    if (!onlineActive()) return;
    if (!myTurn()) return;
    socket?.emit('tavlaPass', { roomId });
  }

  // ---------- Yerel (botlu) tavla ile köprü: online odadayken GV._tv* sarmalanır ----------
  function wrapLocalHandlers() {
    if (window.__gvTavlaHandlersWrapped) return;
    if (!window.GV || typeof window.GV._tvClick !== 'function') return;
    window.__gvTavlaHandlersWrapped = true;
    const orig = {
      roll: window.GV._tvRoll,
      click: window.GV._tvClick,
      bear: window.GV._tvBearOff,
      end: window.GV._tvEndTurn,
      undo: window.GV._tvUndoMove
    };
    window.__gvTavlaLocalHandlers = orig;
    window.GV._tvRoll = function () { if (onlineActive()) return onlineRoll(); return orig.roll && orig.roll(); };
    window.GV._tvClick = function (i) { if (onlineActive()) return onlineClick(i); return orig.click && orig.click(i); };
    window.GV._tvBearOff = function (c) { if (onlineActive()) return onlineBearOff(c); return orig.bear && orig.bear(c); };
    window.GV._tvEndTurn = function () { if (onlineActive()) return onlineEndTurn(); return orig.end && orig.end(); };
    window.GV._tvUndoMove = function () { if (onlineActive()) return onlineUndo(); return orig.undo && orig.undo(); };
  }

  // ---------- Otomatik dönüş ----------
  let autoReturnTimer = null;
  function autoReturnToLobby() {
    if (autoReturnTimer) return;
    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      if (typeof window.__gvRealChessLeave === 'function') window.__gvRealChessLeave();
      else if (typeof window.leaveRoom === 'function') window.leaveRoom();
    }, 5000);
  }

  function handlePlayerLeft(payload) {
    if (isSpectator) {
      toast('🚪 Bir oyuncu ayrıldı. İzleme sona eriyor...', 'info');
    } else {
      if (payload && typeof payload.youWon === 'boolean') forfeitYouWon = payload.youWon;
      else if (forfeitYouWon === null) forfeitYouWon = true;
      toast('🏆 Rakip oyundan ayrıldı — KAZANDINIZ! Lobiye yönlendiriliyorsunuz...', 'success');
      rerender();
    }
    autoReturnToLobby();
  }

  // ---------- Soket ----------
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
      durationMinutes: 10, // kalıcı masalarda sunucu bunu YOK SAYAR (masanın süresi korunur)
      gameId: 'tavla',
      asSpectator: !!window.__gvJoinAsSpectator || !!window.__gvIsSpectator
    });
  }

  function attach() {
    if (!socket || socket.__gvTavlaBound) return;
    socket.__gvTavlaBound = true;

    socket.on('gameStarted', payload => {
      if (!payload || String(payload.roomId) !== String(roomId) || !isTavlaRoom()) return;
      if (!payload.gameState || payload.gameState.kind !== 'tavla') return;
      active = true;
      forfeitYouWon = null;
      endYouWon = null;
      lastNoticeId = null;
      lastRollKey = null;
      sel = null;
      if (payload.isSpectator) {
        isSpectator = true;
        window.__gvIsSpectator = true;
        playerColor = null;
      } else {
        playerColor = payload.playerColor || playerColor;
      }
      apply(payload.gameState);
      startClock();
    });

    socket.on('gameStateUpdated', payload => {
      if (!payload || String(payload.roomId) !== String(roomId) || !isTavlaRoom()) return;
      if (!payload.gameState || payload.gameState.kind !== 'tavla') return;
      if (payload.isSpectator) { isSpectator = true; window.__gvIsSpectator = true; }
      if (payload.playerColor) playerColor = payload.playerColor;
      apply(payload.gameState);
      startClock();
    });

    socket.on('tavlaRejected', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      const messages = {
        not_your_turn: '⏳ Sıra sizde değil! Rakibin hamlesi bekleniyor.',
        illegal_move: '❌ Bu hamle geçersiz (zar / kural ihlali).',
        roll_first: '🎲 Önce zar atmalısınız!',
        already_rolled: '🎲 Zar zaten atıldı.',
        has_legal_move: '⚠️ Yasal hamleniz varken pas geçemezsiniz.',
        nothing_to_undo: '⚠️ Geri alınacak hamle yok.',
        not_in_room: '⚠️ Oyuncu koltuğu bulunamadı.',
        bad_target: '⚠️ Geçersiz hedef.',
        time_expired: '⏰ Süreniz doldu.'
      };
      toast(messages[payload.reason] || '⚠️ Hamle reddedildi.', 'warning');
    });

    socket.on('gameEnded', payload => {
      if (!payload || !payload.gameState || payload.gameState.kind !== 'tavla') return;
      apply(payload.gameState);
      if (payload && typeof payload.youWon === 'boolean' && !isSpectator && !payload.isSpectator) {
        endYouWon = payload.youWon;
      }
      if (payload.reason === 'player_left' || payload.reason === 'abandon' || payload.reason === 'move_timeout') {
        const winner = payload.winner || payload.gameState?.result?.winner;
        const iWon = typeof payload.youWon === 'boolean' ? payload.youWon : (winner && winner === playerColor);
        forfeitYouWon = (isSpectator || payload.isSpectator) ? null : !!iWon;
        const isMoveTimeout = payload.reason === 'move_timeout';
        rerender();
        if (isSpectator || payload.isSpectator) {
          toast((isMoveTimeout ? '⏱ Hamle süresi doldu. ' : '🚪 Oyun terk edildi. ') + winnerName(winner) + ' kazandı. Lobiye yönlendiriliyorsunuz...', 'info');
        } else if (iWon) {
          toast(isMoveTimeout
            ? '🏆 Rakibiniz hamle süresini doldurdu — OYUNU KAZANDINIZ! Lobiye yönlendiriliyorsunuz...'
            : '🏆 Oyunu KAZANDINIZ! Rakibiniz oyunu terk etti. Lobiye yönlendiriliyorsunuz...', 'success');
        } else {
          toast(isMoveTimeout
            ? '⏱ Hamle süreniz doldu — HÜKMEN KAYBETTİNİZ. Lobiye yönlendiriliyorsunuz...'
            : '💔 Oyunu terk ettiğiniz için KAYBETTİNİZ. Lobiye yönlendiriliyorsunuz...', 'error');
        }
        autoReturnToLobby();
      } else {
        rerender(); // win/mars/timeout overlay
      }
    });

    socket.on('moveTimeWarning', payload => {
      if (!payload || String(payload.roomId) !== String(roomId) || !isTavlaRoom()) return;
      const secs = Math.ceil(Math.max(0, Number(payload.remainingMs) || 0) / 1000) || 20;
      if (payload.color === playerColor) {
        toast(`⏰ Hamle yapmakta gecikiyorsunuz! ${secs} saniye içinde oynamazsanız HÜKMEN MAĞLUP sayılacaksınız!`, 'error');
      } else {
        toast(`⏳ Rakibiniz hamle yapmıyor. ${secs} saniye içinde oynamazsa hükmen mağlup sayılacak.`, 'warning');
      }
    });

    socket.on('playerLeft', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      handlePlayerLeft(payload);
    });
  }

  function connect() {
    roomId = getRoomId();
    if (!roomId || !isTavlaRoom()) return;
    loadSocketClient(() => {
      // Bekleme odası (room-waiting-fix) soketini devral.
      if (socket && window.__gvRoomSocket && socket !== window.__gvRoomSocket) {
        try { socket.off && socket.off(); } catch (_) {}
        socket = null;
      }
      if (socket) {
        attach();
        if (socket.connected) join(); else socket.once('connect', join);
        return;
      }
      socket = window.__gvRoomSocket || window.__gvChessSocket || window.io(BACKEND, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 700
      });
      window.__gvRoomSocket = socket;
      attach();
      if (socket.connected) join(); else socket.once('connect', join);
    });
  }

  // Odadan ayrılırken room-waiting-fix.js tarafından çağrılır.
  window.__gvTavlaOnlineReset = function () {
    active = false;
    gameState = null;
    sel = null;
    playerColor = null;
    isSpectator = false;
    forfeitYouWon = null;
    endYouWon = null;
    lastNoticeId = null;
    lastRollKey = null;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    roomId = null;
    if (clockInt) { clearInterval(clockInt); clockInt = null; }
    socket = null;
  };

  // ---------- "Oyun açılmıyor" koruması ----------
  // Odaya girildi ama birkaç saniye içinde sunucudan tavla durumu gelmediyse
  // (eski backend, eksik dosya dağıtımı, bağlantı hatası) ekran BOŞ KALMASIN:
  // yerel tahta açılır ve kullanıcı açıkça bilgilendirilir. Sunucu durumu
  // sonradan ulaşırsa apply() bu görünümün üzerine geçer (kesintisiz).
  function scheduleLocalFallback() {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (gameState || !isTavlaRoom()) return; // sunucu durumu zaten gelmiş
      const s = getState();
      if (!s) return;
      const area = document.getElementById('boardArea');
      if (!area) return;
      s.boards = s.boards || {};
      injectStyle();
      if (!s.boards.tavla && typeof window.rTavla === 'function') {
        window.rTavla(area); // gönderilen yerel motorla aynı başlangıç dizilimi
      } else if (s.boards.tavla && typeof window.dTavla === 'function') {
        window.dTavla(area);
      }
      toast('⚠️ Sunucu senkronu kurulamadı — tavla şu an ÇEVRİMDIŞI (yerel) görünümde. Online senkron için sayfayı yenileyin.', 'warning');
    }, 4000);
  }

  function boot() {
    wrapLocalHandlers();
    if (!isTavlaRoom()) return;
    roomId = getRoomId();
    if (roomId) connect();
    scheduleLocalFallback();
  }

  window.addEventListener('gv:roomGameStarted', boot);
  window.addEventListener('gv:roomReady', event => {
    if (event.detail?.gameId === 'tavla' || event.detail?.roomId) {
      window.__gvTavlaOnlineRequested = true;
      if (event.detail?.roomId) roomId = String(event.detail.roomId);
      boot();
    }
  });
  window.addEventListener('DOMContentLoaded', wrapLocalHandlers, { once: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
