/* GameVerse - authoritative online room bridge
 * Keeps the existing GameVerse UI. No bots. One Socket.IO connection for the room.
 * Chess state is owned by server.js; this file only handles room presence/waiting.
 */
(function () {
  'use strict';

  const BACKEND = 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let activeRoom = null;
  let activeRoomId = null;
  let started = false;
  let patched = false;

  function state() { try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; } }

  function name() {
    const s = state();
    if (s?.user?.name) return s.user.name;
    try {
      const u = JSON.parse(localStorage.getItem('gv-user') || localStorage.getItem('user') || 'null');
      if (u?.name || u?.username) return u.name || u.username;
    } catch (_) {}
    return localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  function userKey() {
    const s = state();
    const u = s?.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    if (stable) return 'user:' + stable;
    try {
      const v = JSON.parse(localStorage.getItem('gv-user') || localStorage.getItem('user') || 'null');
      const id = v && (v.id || v.userId || v.username || v.email);
      if (id) return 'user:' + id;
    } catch (_) {}
    let id = localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = crypto?.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-room-guest-key', id);
    }
    return 'guest:' + id;
  }

  function roomFromArg(room) {
    if (room && room.id) return room;
    const s = state();
    return window.__gvActiveRoom || s?.roomWaitingState?.room || null;
  }

  function isChess(room) {
    const s = state();
    return String(room?.gameId || room?.game || s?.curGame || window.__gvCurrentGame || '').toLowerCase() === 'chess' ||
      /satranç|chess/i.test(document.getElementById('grTitle')?.textContent || '');
  }

  function ensureCss() {
    if (document.getElementById('gv-room-wait-css')) return;
    const style = document.createElement('style');
    style.id = 'gv-room-wait-css';
    style.textContent = `
      #gv-room-waiting-online{margin:18px auto;padding:18px 20px;max-width:720px;border-radius:16px;background:rgba(20,20,45,.96);border:1px solid rgba(255,255,255,.12);color:#eee;box-shadow:0 12px 40px rgba(0,0,0,.35);position:relative;z-index:1000}
      #gv-room-waiting-online h3{margin:0 0 8px;font-size:18px}
      #gv-room-waiting-online .count{font-weight:800;margin:12px 0;color:#a9a1ff}
      #gv-room-waiting-online .seat{display:flex;align-items:center;gap:10px;padding:10px 12px;margin:7px 0;border-radius:10px;background:rgba(255,255,255,.045)}
      #gv-room-waiting-online .dot{width:10px;height:10px;border-radius:50%;background:#666}.dot.on{background:#49e6ad}
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
      if (page) page.prepend(el); else document.body.prepend(el);
    }
    const players = Array.isArray(room?.players) ? room.players : [];
    const max = 2;
    el.innerHTML = '<h3>♟️ Satranç Bekleme Salonu</h3>' +
      '<div>Gerçek oyuncularla eşleşme bekleniyor. Bot kullanılmıyor.</div>' +
      players.slice(0, 2).map(p => `<div class="seat"><span class="dot on"></span><strong>${String(p.name || 'Oyuncu')}</strong><span>Bağlandı</span></div>`).join('') +
      (players.length < max ? '<div class="seat"><span class="dot"></span><span>Rakip bekleniyor...</span></div>' : '') +
      `<div class="count">Oyuncular: ${Math.min(players.length,2)} / 2</div>`;
    el.style.display = started ? 'none' : 'block';
  }

  function loadChess() {
    if (!isChess(activeRoom) || !started) return;
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const s = document.createElement('script');
    s.src = 'js/chess-online.js?v=20260817-10';
    s.async = false;
    s.dataset.gvChessOnline = '1';
    s.onload = () => {
      window.dispatchEvent(new CustomEvent('gv:roomReady', { detail: { roomId: activeRoomId, gameId:'chess' } }));
    };
    document.head.appendChild(s);
  }

  function join() {
    if (!socket?.connected || !activeRoomId) return;
    socket.emit('joinRoom', {
      roomId: activeRoomId,
      gameId: isChess(activeRoom) ? 'chess' : (activeRoom?.gameId || state()?.curGame || 'chess'),
      maxPlayers: 2,
      durationMinutes: Number(activeRoom?.durationMinutes || 10),
      userName: name(),
      userKey: userKey()
    });
  }

  function connect() {
    if (socket || !activeRoomId) return;
    const make = () => {
      if (typeof window.io !== 'function') return;
      socket = window.io(BACKEND, { transports:['websocket','polling'], reconnection:true, reconnectionAttempts:Infinity, reconnectionDelay:1000 });
      window.__gvRoomSocket = socket;
      socket.on('connect', join);
      socket.on('roomUpdated', updated => {
        if (!updated || String(updated.id) !== String(activeRoomId)) return;
        activeRoom = updated;
        renderWaiting(updated);
        if (updated.players.length >= 2) {
          started = true;
          const el = document.getElementById('gv-room-waiting-online');
          if (el) el.style.display = 'none';
          loadChess();
        }
      });
      socket.on('gameStarted', payload => {
        if (!payload || String(payload.roomId) !== String(activeRoomId)) return;
        started = true;
        const el = document.getElementById('gv-room-waiting-online');
        if (el) el.style.display = 'none';
        loadChess();
      });
      socket.on('playerLeft', () => {
        if (!started && activeRoom) renderWaiting(activeRoom);
      });
    };
    if (window.io) make();
    else {
      const s = document.createElement('script');
      s.src = BACKEND + '/socket.io/socket.io.js';
      s.onload = make;
      s.onerror = () => console.error('[RoomFix] Socket.IO yüklenemedi.');
      document.head.appendChild(s);
    }
  }

  function activate(room) {
    activeRoom = roomFromArg(room);
    if (!activeRoom?.id) return;
    activeRoomId = String(activeRoom.id);
    window.__gvActiveRoom = activeRoom;
    window.__gvActiveRoomId = activeRoomId;
    started = false;
    renderWaiting(activeRoom);
    connect();
  }

  function patchLegacy() {
    if (patched || typeof window.startRoomWaitingProcess !== 'function') return;
    const legacy = window.startRoomWaitingProcess;
    window.startRoomWaitingProcess = function (room) {
      // Do not call the old implementation: it creates simulated players.
      activate(room);
      return null;
    };
    window.__gvOriginalRoomWaitingProcess = legacy;
    patched = true;
  }

  function boot() {
    patchLegacy();
    const r = roomFromArg();
    if (r?.id) activate(r);
    setTimeout(patchLegacy, 100);
    setTimeout(patchLegacy, 500);
    setTimeout(patchLegacy, 1500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, {once:true});
  else boot();
})();
