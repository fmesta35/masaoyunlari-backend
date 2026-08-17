/* GameVerse - authoritative online room bridge
 * Keeps the existing GameVerse UI. No bots. One Socket.IO connection for the room.
 * IMPORTANT: the legacy join flow may pass a room NUMBER/string, not an object.
 */
(function () {
  'use strict';

  const BACKEND = 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let activeRoom = null;
  let activeRoomId = null;
  let started = false;
  let hooked = false;

  function state() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  function playerName() {
    const s = state();
    if (s?.user?.name) return s.user.name;
    try {
      const u = JSON.parse(localStorage.getItem('gv-user') || localStorage.getItem('user') || 'null');
      if (u?.name || u?.username) return u.name || u.username;
    } catch (_) {}
    return localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  function playerKey() {
    const s = state(), u = s?.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    if (stable) return 'user:' + stable;
    try {
      const v = JSON.parse(localStorage.getItem('gv-user') || localStorage.getItem('user') || 'null');
      const id = v && (v.id || v.userId || v.username || v.email);
      if (id) return 'user:' + id;
    } catch (_) {}
    let id = localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = (window.crypto && typeof window.crypto.randomUUID === 'function')
        ? window.crypto.randomUUID()
        : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-room-guest-key', id);
    }
    return 'guest:' + id;
  }

  function normalizeRoom(r) {
    if (r && typeof r === 'object') {
      const id = r.id ?? r.roomId ?? r.room_id ?? r.code;
      if (id !== undefined && id !== null && String(id) !== '') return { ...r, id: String(id) };
    }
    if (r !== undefined && r !== null && String(r) !== '') {
      return { id: String(r), gameId: 'chess', players: [] };
    }
    const s = state();
    const candidates = [
      window.__gvActiveRoom,
      s?.roomWaitingState?.room,
      s?.roomWaitingState?.roomId,
      window.__gvActiveRoomId,
      window.currentRoomId,
      window.roomId,
      localStorage.getItem('gv-room-id')
    ];
    for (const x of candidates) {
      const n = normalizeRoom(x);
      if (n) return n;
    }
    return null;
  }

  function isChess(r) {
    const s = state();
    const g = r?.gameId || r?.game || r?.gameType || s?.curGame || window.__gvCurrentGame || '';
    return String(g).toLowerCase() === 'chess' || /satranç|satranc/i.test(String(g)) ||
      /satranç|chess/i.test(document.getElementById('grTitle')?.textContent || '');
  }

  function ensureCss() {
    if (document.getElementById('gv-room-wait-css')) return;
    const style = document.createElement('style');
    style.id = 'gv-room-wait-css';
    style.textContent = `
      #gv-room-waiting-online{display:block!important;position:relative;z-index:99999;margin:18px auto;padding:22px;max-width:720px;border-radius:16px;background:#14142d;color:#eee;border:1px solid rgba(255,255,255,.14);box-shadow:0 15px 50px rgba(0,0,0,.45);font-family:system-ui,sans-serif}
      #gv-room-waiting-online h3{margin:0 0 8px;font-size:20px}
      #gv-room-waiting-online .sub{opacity:.75;margin-bottom:14px}
      #gv-room-waiting-online .count{font-weight:800;margin-top:14px;color:#a9a1ff}
      #gv-room-waiting-online .seat{display:flex;align-items:center;gap:10px;padding:11px 13px;margin:7px 0;border-radius:10px;background:rgba(255,255,255,.06)}
      #gv-room-waiting-online .dot{width:10px;height:10px;border-radius:50%;background:#666;flex:0 0 10px}
      #gv-room-waiting-online .dot.on{background:#49e6ad;box-shadow:0 0 10px #49e6ad}
    `;
    document.head.appendChild(style);
  }

  function renderWaiting(room) {
    if (started) return;
    ensureCss();
    let el = document.getElementById('gv-room-waiting-online');
    const page = document.getElementById('pg-room') || document.getElementById('room');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gv-room-waiting-online';
      (page || document.body).prepend(el);
    }
    const players = Array.isArray(room?.players) ? room.players : [];
    el.innerHTML = '<h3>♟️ Satranç Bekleme Salonu</h3>' +
      '<div class="sub">Gerçek oyuncularla eşleşme bekleniyor. Bot kullanılmıyor.</div>' +
      players.slice(0, 2).map(p =>
        '<div class="seat"><span class="dot on"></span><strong>' +
        String(p.name || p.username || 'Oyuncu') +
        '</strong><span>Bağlandı</span></div>'
      ).join('') +
      (players.length < 2 ? '<div class="seat"><span class="dot"></span><span>Rakip bekleniyor...</span></div>' : '') +
      '<div class="count">Oyuncular: ' + Math.min(players.length, 2) + ' / 2</div>';
    el.style.display = 'block';
  }

  function hideWaiting() {
    const el = document.getElementById('gv-room-waiting-online');
    if (el) el.remove();
  }

  function loadChess() {
    if (!isChess(activeRoom) || !started) return;
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const s = document.createElement('script');
    s.src = 'js/chess-online.js?v=20260817-12';
    s.async = false;
    s.dataset.gvChessOnline = '1';
    s.onload = () => window.dispatchEvent(new CustomEvent('gv:roomReady', { detail: { roomId: activeRoomId, gameId: 'chess' } }));
    document.head.appendChild(s);
  }

  function joinRoom() {
    if (!socket?.connected || !activeRoomId) return;
    socket.emit('joinRoom', {
      roomId: activeRoomId,
      gameId: 'chess',
      maxPlayers: 2,
      durationMinutes: Number(activeRoom?.durationMinutes || 10),
      userName: playerName(),
      userKey: playerKey()
    });
  }

  function connect() {
    if (socket || !activeRoomId) return;
    const make = () => {
      if (typeof window.io !== 'function') {
        console.error('[RoomFix] Socket.IO client bulunamadı.');
        return;
      }
      socket = window.io(BACKEND, { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1000 });
      window.__gvRoomSocket = socket;
      socket.on('connect', joinRoom);
      socket.on('roomUpdated', updated => {
        if (!updated || String(updated.id) !== String(activeRoomId)) return;
        activeRoom = updated;
        window.__gvActiveRoom = updated;
        if (Array.isArray(updated.players) && updated.players.length >= 2) {
          started = true;
          hideWaiting();
          loadChess();
        } else {
          started = false;
          renderWaiting(updated);
        }
      });
      socket.on('gameStarted', payload => {
        if (!payload || String(payload.roomId) !== String(activeRoomId)) return;
        started = true;
        hideWaiting();
        loadChess();
      });
      socket.on('playerLeft', () => {
        if (activeRoom && !started) renderWaiting(activeRoom);
      });
    };
    if (window.io) make();
    else {
      const s = document.createElement('script');
      s.src = BACKEND + '/socket.io/socket.io.js';
      s.onload = make;
      s.onerror = () => console.error('[RoomFix] Socket.IO client yüklenemedi.');
      document.head.appendChild(s);
    }
  }

  function activate(roomArg) {
    const room = normalizeRoom(roomArg);
    if (!room?.id) return;
    activeRoom = room;
    activeRoomId = String(room.id);
    started = false;
    window.__gvActiveRoom = room;
    window.__gvActiveRoomId = activeRoomId;
    renderWaiting(room);
    connect();
  }

  function hookLegacy() {
    if (hooked || typeof window.startRoomWaitingProcess !== 'function') return;
    const legacy = window.startRoomWaitingProcess;
    window.startRoomWaitingProcess = function (roomArg) {
      activate(roomArg);
      return null;
    };
    window.__gvOriginalRoomWaitingProcess = legacy;
    hooked = true;
  }

  function observeRoomState() {
    hookLegacy();
    const s = state();
    const candidate = window.__gvActiveRoom || s?.roomWaitingState?.room || s?.roomWaitingState?.roomId || window.currentRoomId || window.roomId;
    if (candidate && !activeRoomId) activate(candidate);
  }

  function boot() {
    hookLegacy();
    observeRoomState();
    setTimeout(observeRoomState, 50);
    setTimeout(observeRoomState, 200);
    setTimeout(observeRoomState, 500);
    setTimeout(observeRoomState, 1000);
    setTimeout(observeRoomState, 2000);
    setInterval(observeRoomState, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
