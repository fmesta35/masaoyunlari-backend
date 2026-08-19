/* GameVerse - lobi senkronu
 * Masa listesi sunucudan yayınlanır; dolu / oynanan masalar izlenebilir.
 */
(function () {
  'use strict';
  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let currentGame = null;
  let lastRooms = {};
  let hooked = false;

  function toast(msg, type) {
    if (window.GV && typeof window.GV.toast === 'function') {
      try { window.GV.toast(msg, type || 'info'); return; } catch (_) {}
    }
    console.log('[Lobby]', msg);
  }

  function gameFromDom() {
    const name = (document.getElementById('lobbyName')?.textContent || '').toLowerCase();
    const map = {
      satranç: 'chess', satranc: 'chess', chess: 'chess',
      tavla: 'tavla', okey: 'okey', '101 okey': 'okey101',
      pişti: 'pisti', pisti: 'pisti', batak: 'batak',
      'ingiliz daması': 'dama', dama: 'dama',
      'türk daması': 'turkdamasi', reversi: 'reversi',
      gomoku: 'gomoku', connect4: 'connect4', bilardo: 'bilardo'
    };
    return map[name] || currentGame || 'chess';
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>'"]/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
  }

  function paint(gameId, rooms, opts) {
    const list = document.getElementById('roomList');
    if (!list) return;
    const rows = Array.isArray(rooms) ? rooms : [];
    lastRooms[gameId] = rows;

    if (!rows.length) {
      const loading = opts && opts.loading;
      list.innerHTML = `<div class="room" style="justify-content:center;padding:28px 18px;text-align:center;color:var(--text2);">
        ${loading
          ? '⏳ Masalar yükleniyor...'
          : 'Henüz açık masa yok. <b>Masa Oluştur</b> veya <b>Hızlı Eşleş</b> ile ilk masayı sen aç.'}
      </div>`;
      return;
    }

    list.innerHTML = rows.map(r => {
      const maxP = Number(r.maxPlayers || 2);
      const currentP = Number(r.players || 0);
      const playing = r.status === 'playing' || r.status === 'finished';
      const full = currentP >= maxP;
      const specs = Number(r.spectatorCount || 0);
      const statusLabel = playing ? '▶ Oynanıyor' : (full ? 'Dolu' : 'Bekliyor');
      const statusColor = playing ? 'var(--accent)' : (full ? 'var(--warning)' : 'var(--success)');
      const action = playing || full
        ? `<button class="btn btn-sm btn-o" onclick="GV.joinRoom('${esc(r.id)}',{spectate:true})">👁️ İzle</button>`
        : `<button class="btn btn-sm ${r.isPrivate ? 'btn-a' : 'btn-p'}" onclick="GV.joinRoom('${esc(r.id)}')">${r.isPrivate ? '🔒 Katıl' : 'Katıl'}</button>`;
      const names = Array.isArray(r.playerList) && r.playerList.length
        ? r.playerList.map(p => esc(p.name || 'Oyuncu')).join(' · ')
        : '';
      return `<div class="room" style="display:flex;justify-content:space-between;align-items:center;padding:12px 18px;margin-bottom:8px;background:var(--card);border-radius:10px;border:1px solid var(--border);flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="color:var(--accent);font-weight:bold;">#${esc(r.id)}</span>
          <span class="room-name">${r.isPrivate ? '🔒' : '🌐'} ${esc(r.name || ('Masa #' + r.id))}</span>
          <span style="font-size:0.8em;color:var(--text2);">(${maxP} Kişilik)</span>
          ${names ? `<span style="font-size:0.78em;color:var(--text3);">${names}</span>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span style="font-size:0.78em;font-weight:700;color:${statusColor};">${statusLabel}</span>
          <span style="font-size:0.9em;font-weight:700;color:${full ? 'var(--danger)' : 'var(--success)'};">👥 ${currentP}/${maxP}</span>
          ${specs ? `<span style="font-size:0.78em;color:var(--text3);">👁️ ${specs}</span>` : ''}
          ${action}
        </div>
      </div>`;
    }).join('');
  }

  function attach(sock) {
    if (!sock || sock.__gvLobbySync) return;
    sock.__gvLobbySync = true;
    sock.on('roomsUpdated', payload => {
      if (!payload) return;
      const gid = payload.gameId || currentGame;
      if (gid) paint(gid, payload.rooms || []);
    });
    sock.on('connect', () => {
      if (currentGame) sock.emit('subscribeLobby', { gameId: currentGame });
    });
  }

  function getSocket(done) {
    const existing = window.__gvRoomSocket || window.__gvLobbySocket || window.__gvChessSocket;
    if (existing) {
      socket = existing;
      window.__gvLobbySocket = existing;
      attach(socket);
      if (socket.connected) return done(socket);
      socket.once('connect', () => done(socket));
      return;
    }
    if (!window.io) {
      const sources = ['js/socket.io.min.js', 'socket.io.min.js', 'https://cdn.socket.io/4.7.5/socket.io.min.js'];
      (function tryNext(i) {
        if (i >= sources.length) return console.error('[Lobby] Socket.IO yüklenemedi');
        const s = document.createElement('script');
        s.src = sources[i];
        s.onload = () => getSocket(done);
        s.onerror = () => tryNext(i + 1);
        document.head.appendChild(s);
      })(0);
      return;
    }
    socket = window.io(BACKEND, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800
    });
    window.__gvLobbySocket = socket;
    attach(socket);
    if (socket.connected) done(socket);
    else socket.once('connect', () => done(socket));
  }

  function subscribe(gameId) {
    if (!gameId) return;
    currentGame = gameId;
    window.__gvLobbyGameId = gameId;
    paint(gameId, lastRooms[gameId] || [], { loading: !lastRooms[gameId] });
    getSocket(sock => {
      sock.emit('subscribeLobby', { gameId });
    });
  }

  function hook() {
    if (!window.GV || hooked) return;
    const GV = window.GV;
    hooked = true;

    if (typeof GV.genRooms === 'function' && !GV.genRooms.__gvLobbyPatch) {
      const orig = GV.genRooms;
      GV.genRooms = function (gid) {
        const gameId = gid || currentGame || gameFromDom();
        currentGame = gameId;
        subscribe(gameId);
      };
      GV.genRooms.__gvLobbyPatch = true;
      GV.genRooms.__gvOriginal = orig;
    }

    if (typeof GV.openLobby === 'function' && !GV.openLobby.__gvLobbyPatch) {
      const origOpen = GV.openLobby;
      GV.openLobby = function (gid) {
        if (gid) currentGame = gid;
        const ret = origOpen.apply(this, arguments);
        subscribe(gid || currentGame || gameFromDom());
        return ret;
      };
      GV.openLobby.__gvLobbyPatch = true;
    }

    if (typeof GV.joinRoom === 'function' && !GV.joinRoom.__gvSpecPatch) {
      const origJoin = GV.joinRoom;
      GV.joinRoom = function (rid, opts) {
        window.__gvJoinAsSpectator = !!(opts && (opts.spectate || opts.asSpectator));
        return origJoin.call(this, rid);
      };
      GV.joinRoom.__gvSpecPatch = true;
    }

    if (typeof GV.quickMatch === 'function' && !GV.quickMatch.__gvLobbyPatch) {
      const origQm = GV.quickMatch;
      GV.quickMatch = function () {
        const gid = currentGame || gameFromDom() || 'chess';
        const waiting = (lastRooms[gid] || []).find(r =>
          r.status === 'waiting' && Number(r.players) < Number(r.maxPlayers || 2));
        if (waiting) {
          toast('⚡ Açık masa bulundu, bağlanılıyor...', 'success');
          window.__gvJoinAsSpectator = false;
          return GV.joinRoom(String(waiting.id));
        }
        toast('⚡ Yeni masa açılıyor, rakip bekleniyor...', 'info');
        window.__gvJoinAsSpectator = false;
        const rid = String(1000 + Math.floor(Math.random() * 9000));
        return GV.joinRoom(rid);
      };
      GV.quickMatch.__gvLobbyPatch = true;
      GV.quickMatch.__gvOriginal = origQm;
    }
  }

  function boot() {
    hook();
    const lobby = document.getElementById('pg-lobby');
    if (lobby && lobby.classList.contains('active')) {
      subscribe(gameFromDom());
    }
  }

  setInterval(hook, 400);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
