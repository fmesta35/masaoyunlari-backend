/* GameVerse - independent realtime waiting room
 * Real players only. No bots. Does not depend on the inline waiting UI.
 */
(function () {
  'use strict';

  const BACKEND = 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let room = null;
  let roomId = null;
  let gameId = 'chess';
  let panel = null;
  let started = false;
  let connectTimer = null;
  let observerTimer = null;

  function getState() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  function currentRoom() {
    const s = getState();
    return (window.__gvActiveRoom) || (s && s.roomWaitingState && s.roomWaitingState.room) || room || null;
  }

  function roomPage() {
    return document.getElementById('pg-room') || document.getElementById('room');
  }

  function roomIdOf(r) {
    return (r && r.id) || window.__gvActiveRoomId || window.currentRoomId || window.roomId || localStorage.getItem('gv-room-id') || '';
  }

  function gameIdOf(r) {
    const s = getState();
    return (r && (r.gameId || r.game || r.type)) || (s && (s.curGame || s.currentGame)) || 'chess';
  }

  function userName() {
    const s = getState();
    const u = s && s.user;
    if (u && (u.name || u.username)) return u.name || u.username;
    try {
      const raw = localStorage.getItem('gv-user') || localStorage.getItem('user');
      if (raw) {
        const v = JSON.parse(raw);
        return v.name || v.username || 'Oyuncu';
      }
    } catch (_) {}
    return localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  function userKey() {
    const s = getState();
    const u = s && s.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    if (stable) return 'user:' + stable;
    try {
      const raw = localStorage.getItem('gv-user') || localStorage.getItem('user');
      if (raw) {
        const v = JSON.parse(raw);
        const id = v.id || v.userId || v.username || v.email;
        if (id) return 'user:' + id;
      }
    } catch (_) {}
    let guest = localStorage.getItem('gv-room-guest-key');
    if (!guest) {
      guest = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'g-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-room-guest-key', guest);
    }
    return 'guest:' + guest;
  }

  function ensureCss() {
    if (document.getElementById('gvStandaloneWaitingCss')) return;
    const style = document.createElement('style');
    style.id = 'gvStandaloneWaitingCss';
    style.textContent = `
      #gvStandaloneWaiting{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(5,5,18,.96);padding:24px;color:#f1f1ff;font-family:Segoe UI,system-ui,sans-serif}
      #gvStandaloneWaiting .gv-card{width:min(720px,94vw);background:#111128;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:28px;box-shadow:0 20px 70px rgba(0,0,0,.55)}
      #gvStandaloneWaiting h2{margin:0 0 8px;font-size:28px}
      #gvStandaloneWaiting .gv-sub{color:#aaa9ca;margin-bottom:20px}
      #gvStandaloneWaiting .gv-seat{display:flex;align-items:center;gap:12px;padding:15px 16px;margin:10px 0;border-radius:14px;background:#171738;border:1px solid rgba(255,255,255,.08)}
      #gvStandaloneWaiting .gv-dot{width:12px;height:12px;border-radius:50%;background:#575777;flex:none}.gv-dot.on{background:#55efc4;box-shadow:0 0 12px rgba(85,239,196,.55)}
      #gvStandaloneWaiting .gv-name{font-weight:700;flex:1}.gv-state{color:#aaa9ca;font-size:14px}.gv-count{margin-top:18px;color:#a29bfe;font-weight:800}.gv-status{margin-top:8px;color:#c9c9e4}
    `;
    document.head.appendChild(style);
  }

  function ensurePanel() {
    ensureCss();
    panel = document.getElementById('gvStandaloneWaiting');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'gvStandaloneWaiting';
      document.body.appendChild(panel);
    }
    return panel;
  }

  function render() {
    const p = ensurePanel();
    const players = Array.isArray(room && room.players) ? room.players : [];
    const max = Number((room && room.maxPlayers) || 2);
    let seats = '';
    for (let i = 0; i < max; i++) {
      const pl = players[i];
      seats += `<div class="gv-seat"><span class="gv-dot ${pl ? 'on' : ''}"></span><span class="gv-name">${pl ? (pl.name || pl.username || 'Oyuncu') : 'Rakip bekleniyor...'}</span><span class="gv-state">${pl ? 'Bağlandı' : 'Boş'}</span></div>`;
    }
    p.innerHTML = `<div class="gv-card"><h2>♟️ ${gameId === 'chess' ? 'Satranç' : 'Oyun'} Bekleme Salonu</h2><div class="gv-sub">Rakibin bağlanmasını bekliyoruz. Bot kullanılmıyor.</div>${seats}<div class="gv-count">Oyuncular: ${players.length} / ${max}</div><div class="gv-status">${players.length >= max ? 'Rakip bulundu. Oyun başlatılıyor…' : 'Rakip bekleniyor…'}</div></div>`;
    p.style.display = 'flex';
  }

  function hide() {
    if (panel) panel.style.display = 'none';
  }

  function loadChess() {
    if (gameId !== 'chess' || document.querySelector('script[data-gv-chess-online]')) return;
    const s = document.createElement('script');
    s.src = 'js/chess-online.js?v=20260817-9';
    s.async = true;
    s.dataset.gvChessOnline = '1';
    document.head.appendChild(s);
  }

  function join() {
    if (!socket || !socket.connected || !roomId) return;
    socket.emit('joinRoom', {
      roomId,
      userName: userName(),
      userKey: userKey(),
      maxPlayers: Number((room && room.maxPlayers) || 2),
      durationMinutes: Number((room && room.durationMinutes) || 10),
      gameId
    });
  }

  function connect() {
    if (!roomId) return;
    if (socket) { if (socket.connected) join(); return; }
    if (typeof window.io !== 'function') {
      if (connectTimer) return;
      const sc = document.createElement('script');
      sc.src = BACKEND + '/socket.io/socket.io.js';
      sc.async = true;
      connectTimer = setTimeout(function(){ connectTimer=null; connect(); }, 1500);
      sc.onload = function(){ if(connectTimer){clearTimeout(connectTimer);connectTimer=null;} connect(); };
      document.head.appendChild(sc);
      return;
    }
    socket = window.io(BACKEND,{transports:['websocket','polling'],reconnection:true,reconnectionAttempts:Infinity,reconnectionDelay:500});
    window.__gvStandaloneRoomSocket = socket;
    socket.on('connect', join);
    socket.on('roomUpdated', function(updated){
      if (!updated || String(updated.id)!==String(roomId)) return;
      room = updated;
      render();
      const max = Number(updated.maxPlayers || 2);
      if (Array.isArray(updated.players) && updated.players.length >= max) {
        started = true;
        hide();
        window.dispatchEvent(new CustomEvent('gv:roomReady',{detail:{roomId:roomId,gameId:gameId}}));
        loadChess();
      }
    });
    socket.on('gameStarted', function(payload){
      if (!payload || String(payload.roomId)!==String(roomId)) return;
      started = true;
      hide();
      window.dispatchEvent(new CustomEvent('gv:roomReady',{detail:{roomId:roomId,gameId:gameId,playerColor:payload.playerColor}}));
      loadChess();
    });
    socket.on('disconnect', function(){ if(!started) render(); });
  }

  function start(r) {
    if (!r || !r.id) return false;
    room = r;
    roomId = roomIdOf(r);
    gameId = gameIdOf(r);
    started = false;
    render();
    connect();
    return true;
  }

  function hook() {
    if (!window.__gvStandalonePageHook && typeof window.page === 'function') {
      const originalPage = window.page;
      window.page = function(name){
        const result = originalPage.apply(this,arguments);
        if (name === 'room') {
          const r = window.__gvActiveRoom || currentRoom();
          if (r) setTimeout(function(){ start(r); }, 0);
        }
        return result;
      };
      window.__gvStandalonePageHook = true;
    }
    if (!window.__gvStandaloneStartHook && typeof window.startRoomWaitingProcess === 'function') {
      const originalStart = window.startRoomWaitingProcess;
      window.startRoomWaitingProcess = function(r){
        if (r) start(r);
        const result = originalStart.apply(this,arguments);
        if (r) { setTimeout(function(){ start(r); },0); setTimeout(function(){ start(r); },150); }
        return result;
      };
      window.__gvStandaloneStartHook = true;
    }
  }

  function observe() {
    const r = window.__gvActiveRoom || currentRoom();
    const s = getState();
    if (r && s && s.curPage === 'room') start(r);
  }

  function boot() {
    hook();
    observe();
    if (observerTimer) clearInterval(observerTimer);
    observerTimer = setInterval(function(){ hook(); observe(); }, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();
