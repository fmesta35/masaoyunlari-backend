/* GameVerse - Authoritative Chess Waiting Room Bridge
 * Frontend is on Yöncü Shared Hosting; Socket.IO backend is on Render.com.
 */
(function () {
  'use strict';
  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  let socket = null, roomId = null, room = null, started = false;

  function state() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  function isChess() {
    const s = state();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = String(g).toLowerCase().trim();

    // If curGame is explicitly another game (Pişti, Tavla, Okey etc.), it is NOT chess!
    if (g && g !== 'chess' && g !== 'satranc' && g !== 'satranç') {
      return false;
    }

    if (g === 'chess' || g === 'satranç' || g === 'satranc') return true;

    const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
    if (/satranç|satranc/i.test(title)) return true;

    return !!window.__gvChessOnlineRequested;
  }

  function isRoomPage() {
    const s = state();
    return !!(document.getElementById('pg-room')?.classList.contains('active') || String(s?.curPage || '').toLowerCase() === 'room');
  }

  function userName() {
    const s = state();
    return s?.user?.name || s?.user?.username || localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  function userKey() {
    const s = state();
    const u = s?.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    if (stable) return 'user:' + String(stable);
    let id = localStorage.getItem('gv-chess-guest-id');
    if (!id) {
      id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-chess-guest-id', id);
    }
    return 'guest:' + id;
  }

  function roomIdNow() {
    const s = state();
    const a = [window.__gvActiveRoomId, window.__gvActiveRoom?.id, s?.roomWaitingState?.room?.id, s?.roomWaitingState?.roomId, localStorage.getItem('gv-room-id')];
    for (const x of a) {
      if (x !== undefined && x !== null && String(x) !== '') return String(x);
    }
    return null;
  }

  function css() {
    if (document.getElementById('gv-real-wait-css')) return;
    const stl = document.createElement('style');
    stl.id = 'gv-real-wait-css';
    stl.textContent = `
#gv-real-chess-wait{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(6,7,20,.88);backdrop-filter:blur(12px)}
#gv-real-chess-wait .card{width:min(92vw,620px);background:var(--bg2,#111128);color:var(--text,#fff);border:1px solid var(--border2,rgba(255,255,255,.15));border-radius:18px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.65)}
#gv-real-chess-wait h2{margin:0 0 7px;font-size:1.35rem;color:var(--primary,#6c5ce7);text-align:center}
#gv-real-chess-wait .sub{color:var(--text2,#aaa);font-size:.9rem;margin-bottom:18px;text-align:center}
#gv-real-chess-wait .players{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:15px 0}
.gvp{padding:18px 10px;text-align:center;background:var(--card,#1a1a3e);border:2px solid var(--border,rgba(255,255,255,.08));border-radius:14px;transition:all .3s ease}
.gvp.ready{border-color:var(--success,#00b894);box-shadow:0 0 18px rgba(0,184,148,.2);background:rgba(0,184,148,.08)}
.gvp .av{font-size:2.2rem;margin-bottom:7px}
.gvp .nm{font-weight:700;min-height:22px;font-size:1rem}
.gvp .st{font-size:.85rem;color:var(--text2,#aaa);margin-top:6px;font-weight:bold}
.gvp.ready .st{color:#00b894}
#gv-real-chess-wait .status{text-align:center;color:var(--text2,#aaa);margin:14px 0;font-size:.95rem;min-height:22px;font-weight:600}
.gv-ready{width:100%;padding:14px;border:0;border-radius:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#000;font-weight:800;cursor:pointer;font-size:1.1rem;transition:all .2s ease;box-shadow:0 4px 15px rgba(245,158,11,.3)}
.gv-ready:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(245,158,11,.4)}
.gv-ready.ready{background:linear-gradient(135deg,#10b981,#059669);color:#fff;box-shadow:0 4px 15px rgba(16,185,129,.3)}
.gv-leave{width:100%;margin-top:10px;padding:11px;border:1px solid var(--border2,rgba(255,255,255,.15));border-radius:12px;background:transparent;color:var(--text2,#aaa);cursor:pointer;font-weight:600}
.gv-leave:hover{background:rgba(255,255,255,.05);color:#fff}
.spin{width:28px;height:28px;margin:15px auto;border:3px solid var(--border2,rgba(255,255,255,.15));border-top-color:var(--primary,#6c5ce7);border-radius:50%;animation:gv-spin .8s linear infinite}
@keyframes gv-spin{to{transform:rotate(360deg)}}
@media(max-width:650px){#gv-real-chess-wait .players{grid-template-columns:1fr}}
`;
    document.head.appendChild(stl);
  }

  function overlay() {
    css();
    let e = document.getElementById('gv-real-chess-wait');
    if (!e) {
      e = document.createElement('div');
      e.id = 'gv-real-chess-wait';
      document.body.appendChild(e);
    }
    return e;
  }

  function hide() {
    document.getElementById('gv-real-chess-wait')?.remove();
  }

  function render() {
    if (!isChess() || !room || started) {
      hide();
      return;
    }
    const e = overlay();
    const ps = Array.isArray(room.players) ? room.players : [];
    const me = ps.find(p => p.id === socket?.id);
    const ready = !!me?.isReady;
    const full = ps.length === 2;
    const allReady = full && ps.every(p => p.isReady);

    const player = (i) => {
      const p = ps[i];
      if (!p) {
        return `<div class="gvp"><div class="av">➕</div><div class="nm">Rakip bekleniyor...</div><div class="st">Boş Sandalye</div></div>`;
      }
      return `<div class="gvp ${p.isReady ? 'ready' : ''}">
        <div class="av">${p.color === 'white' ? '⚪' : '🔴'}</div>
        <div class="nm">${esc(p.name || 'Oyuncu')}${p.id === socket?.id ? ' <b>(Siz)</b>' : ''}</div>
        <div class="st">${p.isReady ? '✅ HAZIR' : '⏳ BEKLİYOR'}</div>
      </div>`;
    };

    const status = allReady ? '🚀 Oyun başlatılıyor...' : full
      ? (ready ? '⏳ Rakibin de "HAZIRIM" butonuna basması bekleniyor...' : '👉 Oyuna başlamak için "HAZIRIM" butonuna basınız.')
      : '⌛ İkinci oyuncu masaya bekleniyor...';

    e.innerHTML = `<div class="card">
      <h2>♟️ Satranç Masa #${roomId} — Bekleme Odası</h2>
      <div class="sub">Oyun, her iki oyuncu da <b>HAZIRIM</b> butonuna bastığında başlayacaktır.</div>
      ${ps.length < 2 ? '<div class="spin"></div>' : ''}
      <div class="players">${player(0)}${player(1)}</div>
      <div class="status">${status}</div>
      <button class="gv-ready ${ready ? 'ready' : ''}" type="button">
        ${ready ? '✓ HAZIRSINIZ (İPTAL ETMEK İÇİN TIKLAYIN)' : '▶ OYUNA HAZIRIM!'}
      </button>
      <button class="gv-leave" type="button">🚪 Odadan Ayrıl</button>
    </div>`;

    e.querySelector('.gv-ready')?.addEventListener('click', () => {
      if (socket && socket.connected) {
        socket.emit('setReady', { ready: !ready });
      }
    });

    e.querySelector('.gv-leave')?.addEventListener('click', leave);
  }

  function esc(v) {
    return String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function loadChess() {
    if (!isChess()) return;
    window.__gvChessGameStarted = true;
    window.__gvChessOnlineRequested = true;
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const s = document.createElement('script');
    s.src = 'js/chess-online.js?v=' + Date.now();
    s.dataset.gvChessOnline = '1';
    s.async = false;
    document.head.appendChild(s);
  }

  function connect() {
    if (!roomId || !isChess()) return;
    if (!window.io) {
      const s = document.createElement('script');
      s.src = 'js/socket.io.min.js';
      s.onload = connect;
      s.onerror = () => console.error('[RoomFix] Socket.IO yüklenemedi');
      document.head.appendChild(s);
      return;
    }

    if (!socket) {
      socket = window.io(BACKEND, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 700
      });
      window.__gvRoomSocket = socket;
      window.__gvChessSocket = socket;

      socket.on('connect', join);
      socket.on('roomUpdated', r => {
        if (!r || String(r.id) !== roomId || !isChess()) return;
        room = r;
        window.__gvActiveRoom = r;
        if (r.status === 'playing' || r.status === 'finished') {
          started = true;
          hide();
          loadChess();
        } else {
          render();
        }
      });

      socket.on('gameStarted', p => {
        if (!p || String(p.roomId) !== roomId || !isChess()) return;
        started = true;
        hide();
        window.dispatchEvent(new CustomEvent('gv:roomGameStarted', { detail: p }));
        loadChess();
      });

      socket.on('disconnect', () => {
        if (!started && isChess()) render();
      });

      socket.on('roomFull', p => {
        if (!isChess()) return;
        room = Object.assign({}, room, { players: [] });
        const e = overlay();
        e.innerHTML = `<div class="card"><h2>♟️ Satranç</h2><div class="sub">${esc(p?.message || 'Bu oda dolu.')}</div></div>`;
      });
    }
    join();
  }

  function join() {
    if (!socket?.connected || !roomId || !isChess()) return;
    localStorage.setItem('gv-room-id', roomId);
    socket.emit('joinRoom', {
      roomId,
      userName: userName(),
      userKey: userKey(),
      maxPlayers: 2,
      durationMinutes: Number(room?.duration || 10),
      gameId: 'chess'
    });
  }

  function leave() {
    window.__gvChessOnlineRequested = false;
    try {
      if (socket && socket.connected) {
        socket.emit('leaveRoom');
        socket.disconnect();
      }
    } catch (_) {}
    socket = null;
    window.__gvRoomSocket = null;
    window.__gvChessSocket = null;
    window.__gvActiveRoom = null;
    window.__gvActiveRoomId = null;
    window.__gvChessGameStarted = false;
    hide();

    // Reset clocks on UI to 10:00
    const t1 = document.getElementById('t1');
    const t2 = document.getElementById('t2');
    if (t1) t1.textContent = '10:00';
    if (t2) t2.textContent = '10:00';

    const s = state();
    if (s) {
      s.roomWaitingState = null;
      s.roomWaitingInt = null;
    }
    if (s && typeof page === 'function') page('lobby');
  }

  function startRealRoomWaiting(r) {
    if (!isChess()) return;
    roomId = String(r?.id || roomIdNow() || '');
    room = r || { id: roomId, name: 'Satranç Masası #' + roomId, maxPlayers: 2, duration: 10, players: [], status: 'waiting' };
    started = false;
    window.__gvActiveRoomId = roomId;
    window.__gvActiveRoom = room;
    window.__gvChessOnlineRequested = true;
    localStorage.setItem('gv-room-id', roomId);
    if (state()) state().curPage = 'room';
    connect();
    render();
  }

  // Explicitly export for index.html function startRoomWaitingProcess
  window.__gvStartRealRoomWaiting = startRealRoomWaiting;
  window.__gvRealChessLeave = leave;

  function patch() {
    if (typeof window.startRoomWaitingProcess !== 'function' || window.startRoomWaitingProcess.__gvChessPatch) return;
    const original = window.startRoomWaitingProcess;
    function patched(r) {
      if (!isChess()) return original.apply(this, arguments);
      startRealRoomWaiting(r);
    }
    patched.__gvChessPatch = true;
    patched.__gvOriginal = original;
    window.startRoomWaitingProcess = patched;
  }

  function patchLeaveRoom() {
    if (typeof window.leaveRoom === 'function' && !window.leaveRoom.__gvChessLeavePatch) {
      const originalLeave = window.leaveRoom;
      window.leaveRoom = function() {
        if (isChess()) {
          leave();
        }
        return originalLeave.apply(this, arguments);
      };
      window.leaveRoom.__gvChessLeavePatch = true;
    }
  }

  function scan() {
    patch();
    patchLeaveRoom();
    if (!isChess()) {
      window.__gvChessOnlineRequested = false;
      hide(); // Ensure chess overlay is completely hidden on non-chess games like Pişti, Tavla, Okey!
      return;
    }
    if (!isRoomPage()) return;
    const id = roomIdNow();
    if (id && id !== roomId) {
      roomId = id;
      started = false;
      connect();
    }
    if (room && !started) render();
  }

  setInterval(scan, 300);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan, { once: true });
  else scan();
})();
