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

  // DOM'a YALNIZCA değişiklik varsa yaz: her 250 ms'de aynı metni tekrar
  // basmak (textContent ataması aynı olsa bile düğümü siler-yeniler) bazı
  // tarayıcılarda sayacı "yanıp sönüyormuş" gibi gösteriyordu.
  function setText(el, txt) {
    if (el && el.textContent !== txt) el.textContent = txt;
  }

  // Online oyun saatleri DEVRALINDI: index.html'deki yerel (bot/gösterim)
  // zamanlayıcısının #t1/#t2'ye yazması bu işaretle kesin olarak mühürlenir.
  // (Eski hata: yerel sayaç açık kalırsa iki yazıcı çakışır → ekran
  // "sıfırlanıyormuş" gibi titrer, süre bitince kullanıcı lobiye atılırdı.)
  function claimClockOwnership() {
    const s = getState();
    if (s) s.onlineClock = true;
  }
  function releaseClockOwnership() {
    const s = getState();
    if (s) s.onlineClock = false;
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
      .tavla-move-badge { display: block; width: max-content; max-width: 100%; min-height: 32px; margin: 0 auto 8px; padding: 6px 14px; border-radius: 999px; background: rgba(46,213,115,.14); border: 1px solid rgba(46,213,115,.45); color: #7bed9f; font-weight: 700; font-size: .92rem; text-align: center; font-variant-numeric: tabular-nums; box-sizing: border-box; }
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

  // ---------- Görünüm: sunucu durumu -> tahta ----------
  function rerender() {
    if (!gameState) return;
    const s = getState();
    injectStyle();
    const area = document.getElementById('boardArea');

    if (s && area && typeof window.dTavla === 'function') {
      // ANA YOL: index.html'deki yerleşik çizici (tam tema uyumu).
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
      window.dTavla(area);
      postRender(area);
    } else if (area) {
      // YEDEK YOL: barındırmadaki index.html eski nesilse window.st/dTavla
      // hiç tanımlı olmayabilir; o durumda bile tahta BOŞ KALMASIN diye
      // bu modül tahtayı tamamen kendisi çizer (kendi tıklama katmanıyla).
      drawSelfBoard(area);
      renderEndOverlay(area);
    }
    updateClock();
  }

  // ---------- Kendi kendine yeten tahta çizici (st/dTavla YOKSA) ----------
  // index.html'in .tavla-* sınıflarını kullanır (eski nesil sayfada bile bu
  // CSS bulunur); bulunamazsa da minik bir iç stil enjekte edilir.
  function selfPt(i) {
    const p = gameState.points[i] || { color: null, count: 0 };
    const l = i % 2 === 0;
    let c = 'tavla-point ' + (l ? 'light' : 'dark');
    if (sel === i) c += ' selected';
    if (selTargets().includes(i)) c += ' can-move';
    let h = `<div class="${c}" onclick="window.__gvTavlaSelfClick(${i})">`;
    if (p.count > 0) {
      const mv = Math.min(p.count, 5);
      for (let j = 0; j < mv; j++) {
        if (j === 4 && p.count > 5) h += `<div class="tavla-checker ${p.color} count">${p.count}</div>`;
        else h += `<div class="tavla-checker ${p.color}"></div>`;
      }
    }
    return h + '</div>';
  }

  function selfDie(v, used) {
    let inner = '';
    if (v > 0) {
      let dots = '';
      for (let d = 0; d < v; d++) dots += '<div class="dot"></div>';
      inner = `<div class="tavla-die-face f${v}">${dots}</div>`;
    } else {
      inner = '<div class="tavla-die-empty">🎲</div>';
    }
    return `<div class="tavla-die${used ? ' used' : ''}">${inner}</div>`;
  }

  function drawSelfBoard(area) {
    const gs = gameState;
    if (!gs || !Array.isArray(gs.points)) return;
    const lock = !myTurn() || !active || gs.status !== 'playing';
    const movesLeft = gs.movesLeft || [];

    let h = '<div class="tavla-wrap">';
    h += '<div id="tvMoveBadge" class="tavla-move-badge" style="visibility:hidden"></div>';

    // Zar / aksiyon şeridi
    h += '<div class="tavla-dice-area">';
    h += `<div class="tavla-info">${gs.turn === 'w' ? '⚪ BEYAZ' : '⚫ SİYAH'} sırası${myTurn() ? ' — SİZDE' : ''}</div>`;
    h += '<div class="tavla-dice">';
    [0, 1].forEach(i => {
      const v = gs.rolled ? (gs.dice[i] || 0) : 0;
      h += selfDie(v, v > 0 && !movesLeft.includes(v));
    });
    h += '</div>';
    if (!gs.rolled && gs.status === 'playing') {
      const disabled = lock ? ' disabled style="opacity:.45;cursor:not-allowed"' : '';
      h += `<button class="tavla-btn" onclick="window.__gvTavlaSelfRoll()"${disabled}>🎲 Zar At</button>`;
    } else if (gs.rolled && gs.status === 'playing') {
      if ((gs.turnMoves || 0) > 0 && movesLeft.length > 0) {
        const disabled = lock ? ' disabled style="opacity:.45;cursor:not-allowed"' : '';
        h += `<button class="tavla-btn undo" onclick="window.__gvTavlaSelfUndo()"${disabled}>↩️ Geri Al</button>`;
      }
      if (!movesLeft.length) {
        const disabled = lock ? ' disabled style="opacity:.45;cursor:not-allowed"' : '';
        h += `<button class="tavla-btn end" onclick="window.__gvTavlaSelfEndTurn()"${disabled}>✅ Bitir</button>`;
      }
    }
    h += `<div class="tavla-info">📦 ⚪${gs.off?.w || 0}/⚫${gs.off?.b || 0}</div>`;
    h += '</div>';

    // Tahta
    h += '<div class="tavla-board">';
    h += '<div class="tavla-num-row">';
    for (let i = 13; i <= 18; i++) h += `<div class="tavla-num-cell">${i}</div>`;
    h += '<div style="width:42px;flex-shrink:0"></div>';
    for (let i = 19; i <= 24; i++) h += `<div class="tavla-num-cell">${i}</div>`;
    h += '<div style="width:60px;flex-shrink:0"></div></div>';
    h += '<div class="tavla-row"><div class="tavla-half">';
    for (let i = 12; i <= 17; i++) h += selfPt(i);
    h += `</div><div class="tavla-bar">BAR<div class="tavla-bar-count">⚫${gs.bar?.b || 0}</div></div><div class="tavla-half">`;
    for (let i = 18; i <= 23; i++) h += selfPt(i);
    h += `</div><div class="tavla-off" onclick="window.__gvTavlaSelfBear('w')"><div>⚪</div><div class="tavla-off-count">${gs.off?.w || 0}</div><div>OFF</div></div></div>`;
    h += '<div class="tavla-row"><div class="tavla-half">';
    for (let i = 11; i >= 6; i--) h += selfPt(i);
    h += `</div><div class="tavla-bar">BAR<div class="tavla-bar-count">⚪${gs.bar?.w || 0}</div></div><div class="tavla-half">`;
    for (let i = 5; i >= 0; i--) h += selfPt(i);
    h += `</div><div class="tavla-off" style="background:linear-gradient(135deg,#333,#000)" onclick="window.__gvTavlaSelfBear('b')"><div>⚫</div><div class="tavla-off-count">${gs.off?.b || 0}</div><div>OFF</div></div></div>`;
    h += '<div class="tavla-num-row">';
    for (let i = 12; i >= 7; i--) h += `<div class="tavla-num-cell">${i}</div>`;
    h += '<div style="width:42px;flex-shrink:0"></div>';
    for (let i = 6; i >= 1; i--) h += `<div class="tavla-num-cell">${i}</div>`;
    h += '<div style="width:60px;flex-shrink:0"></div></div>';
    h += '</div></div>';

    area.innerHTML = h;
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
    claimClockOwnership();

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
        setText(names[0], '⚪ Beyaz');
        setText(names[1], '⚫ Siyah');
      } else {
        setText(names[0], m === 'w' ? '⚪ Beyaz (Siz)' : '⚫ Siyah (Siz)');
        setText(names[1], m === 'w' ? '⚫ Siyah (Rakip)' : '⚪ Beyaz (Rakip)');
      }
    }
    if (isSpectator || !m) {
      setText(t1, format(white));
      setText(t2, format(black));
    } else {
      setText(t1, format(m === 'w' ? white : black));
      setText(t2, format(m === 'w' ? black : white));
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
        setText(badge, `⏱ Hamle sırası: ${who} — ${secs} sn`);
        const danger = remain <= Math.min(20000, limit / 2);
        if (badge.classList.contains('danger') !== danger) badge.classList.toggle('danger', danger);
        if (badge.style.visibility !== 'visible') badge.style.visibility = 'visible';
      } else {
        if (badge.style.visibility !== 'hidden') badge.style.visibility = 'hidden';
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

  // Kendi çizici katmanının (st/dTavla'sız yedek yol) kullandığı global kancalar.
  window.__gvTavlaSelfClick = function (i) { onlineClick(i); };
  window.__gvTavlaSelfRoll = function () { onlineRoll(); };
  window.__gvTavlaSelfUndo = function () { onlineUndo(); };
  window.__gvTavlaSelfEndTurn = function () { onlineEndTurn(); };
  window.__gvTavlaSelfBear = function (c) { onlineBearOff(c); };

  // Odadan ayrılırken room-waiting-fix.js tarafından çağrılır.
  window.__gvTavlaOnlineReset = function () {
    active = false;
    releaseClockOwnership();
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
      const area = document.getElementById('boardArea');
      if (!area) return;
      injectStyle();
      if (s) {
        // Yerel (çevrimdışı) tahta: oyuncu en azından dizilimi görür.
        s.boards = s.boards || {};
        if (!s.boards.tavla && typeof window.rTavla === 'function') {
          window.rTavla(area);
        } else if (s.boards.tavla && typeof window.dTavla === 'function') {
          window.dTavla(area);
        }
        toast('⚠️ Sunucu senkronu kurulamadı — tavla şu an ÇEVRİMDIŞI (yerel) görünümde. Online senkron için sayfayı yenileyin.', 'warning');
      } else {
        // index.html eski nesil ve sunucudan da durum gelmedi: ekran bomboş
        // kalmasın, açıklayıcı bir kart göster.
        area.innerHTML = '<div style="max-width:420px;margin:40px auto;padding:28px;text-align:center;' +
          'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:16px;color:#fff">' +
          '<div style="font-size:2.4em">🎲</div><h3 style="margin:10px 0 8px">Tavla masası açılamadı</h3>' +
          '<p style="color:#aaa;font-size:.92em;margin-bottom:14px">Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin (Ctrl+F5) ve tekrar katılın.</p>' +
          '<button onclick="window.location.reload()" style="padding:10px 18px;border-radius:10px;border:0;background:#6c5ce7;color:#fff;font-weight:700;cursor:pointer">🔄 Sayfayı Yenile</button></div>';
      }
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
