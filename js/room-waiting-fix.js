/* GameVerse - gerçek oyuncu bekleme odası + Hazırım senkronizasyonu */
(function () {
  'use strict';
  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  let socket = null;
  let roomId = null;
  let room = null;
  let started = false;
  let patchTimer = null;

  function state() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  function currentRoomId() {
    const s = state();
    const values = [
      window.__gvActiveRoomId,
      window.__gvActiveRoom?.id,
      window.currentRoomId,
      window.roomId,
      s?.roomWaitingState?.room?.id,
      s?.roomWaitingState?.roomId,
      localStorage.getItem('gv-room-id'),
      new URLSearchParams(location.search).get('roomId'),
      new URLSearchParams(location.search).get('room')
    ];
    return values.find(v => v !== undefined && v !== null && String(v) !== '')?.toString() || null;
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
    let id = localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-room-guest-key', id);
    }
    return 'guest:' + id;
  }

  function isChessRoom() {
    const s = state();
    const g = s?.curGame || window.__gvCurrentGame || window.__gvActiveRoom?.gameId || '';
    const title = document.getElementById('grTitle')?.textContent || '';
    return /chess|satranç|satranc/i.test(String(g)) || /chess|satranç|satranc/i.test(title) || !!window.__gvChessOnlineRequested;
  }

  function isRoomPage() {
    const s = state();
    return !!(
      document.getElementById('pg-room')?.classList.contains('active') ||
      document.getElementById('room')?.classList.contains('active') ||
      String(s?.curPage || '').toLowerCase() === 'room'
    );
  }

  function ensureSocketClient(done) {
    if (window.io) return done();
    const script = document.createElement('script');
    script.src = BACKEND + '/socket.io/socket.io.js';
    script.onload = done;
    script.onerror = () => renderError('Socket.IO istemcisi yüklenemedi.');
    document.head.appendChild(script);
  }

  function css() {
    if (document.getElementById('gv-wait-room-css')) return;
    const style = document.createElement('style');
    style.id = 'gv-wait-room-css';
    style.textContent = `
      #gv-chess-wait{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(6,7,20,.84);backdrop-filter:blur(12px)}
      #gv-chess-wait .gw-card{width:min(92vw,560px);background:var(--bg2,#111128);color:var(--text,#fff);border:1px solid var(--border2,rgba(255,255,255,.15));border-radius:18px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.6)}
      #gv-chess-wait h2{margin:0 0 5px;font-size:1.35rem}#gv-chess-wait .sub{color:var(--text2,#aaa);font-size:.9rem;margin-bottom:18px}
      #gv-chess-wait .players{display:grid;gap:8px;margin:15px 0}.gw-player{display:flex;align-items:center;gap:10px;padding:11px 12px;background:var(--card,#1a1a3e);border:1px solid var(--border,rgba(255,255,255,.08));border-radius:12px}.gw-dot{width:10px;height:10px;border-radius:50%;background:#666}.gw-dot.on{background:#55efc4;box-shadow:0 0 10px rgba(85,239,196,.7)}.gw-name{flex:1}.gw-state{font-size:.78rem;color:var(--text2,#aaa)}
      #gv-chess-wait .status{text-align:center;margin:10px 0 14px;color:var(--text2,#aaa);min-height:20px}#gv-chess-wait .actions{display:flex;gap:8px;justify-content:center}.gw-ready{min-width:170px}.gw-ready.ready{background:var(--success2,#00b894)!important;color:#fff}
      #gv-chess-wait .note{text-align:center;font-size:.76rem;color:var(--text3,#777);margin-top:12px}
      #gv-chess-wait .err{color:#ff7675;text-align:center}
    `;
    document.head.appendChild(style);
  }

  function openOverlay() {
    css();
    let el = document.getElementById('gv-chess-wait');
    if (!el) { el = document.createElement('div'); el.id = 'gv-chess-wait'; document.body.appendChild(el); }
    el.style.display = 'flex';
    return el;
  }

  function hideOverlay() {
    const el = document.getElementById('gv-chess-wait');
    if (el) el.remove();
  }

  function renderError(text) {
    const el = openOverlay();
    el.innerHTML = `<div class="gw-card"><h2>♟ Satranç</h2><div class="err">${text}</div></div>`;
  }

  function toggleReady(ready) {
    if (!socket?.connected) return;
    socket.emit('setReady', { ready: !!ready });
  }

  function render() {
    if (!room || started) return;
    const el = openOverlay();
    const players = Array.isArray(room.players) ? room.players : [];
    const me = players.find(p => p.id === socket?.id);
    const ready = !!me?.isReady;
    const full = players.length >= Number(room.maxPlayers || 2);
    const allReady = full && players.length === 2 && players.every(p => p.isReady);
    const playerHtml = [0, 1].map(index => {
      const p = players[index];
      if (!p) return `<div class="gw-player"><span class="gw-dot"></span><div class="gw-name">Rakip bekleniyor...</div><div class="gw-state">Boş</div></div>`;
      return `<div class="gw-player"><span class="gw-dot ${p.isReady ? 'on' : ''}"></span><div class="gw-name">${escapeHtml(p.name || 'Oyuncu')} ${p.id === socket?.id ? '<strong>(Sen)</strong>' : ''}</div><div class="gw-state">${p.isReady ? 'Hazır' : 'Hazır değil'}</div></div>`;
    }).join('');
    const status = allReady ? 'Oyun başlatılıyor...' : full ? (ready ? 'Rakibin de hazır olması bekleniyor.' : 'İkiniz de Hazırım dediğinde oyun başlayacak.') : 'Rakip oyuncu bekleniyor...';
    el.innerHTML = `<div class="gw-card"><h2>♟ Satranç — Bekleme Odası</h2><div class="sub">Oyun, iki gerçek oyuncu da <b>Hazırım</b> dediğinde başlar.</div><div class="players">${playerHtml}</div><div class="status">${status}</div><div class="actions"><button class="btn btn-a gw-ready ${ready ? 'ready' : ''}" type="button">${ready ? 'Hazırım ✓' : 'Hazırım'}</button></div><div class="note">Oyuncular: ${players.length} / 2</div></div>`;
    const button = el.querySelector('.gw-ready');
    if (button) button.addEventListener('click', () => toggleReady(!ready));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function loadChess() {
    window.__gvChessOnlineRequested = true;
    if (typeof window.__gvEnsureChessOnline === 'function') return window.__gvEnsureChessOnline();
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const s = document.createElement('script');
    s.src = 'js/chess-online.js?v=20260818-1';
    s.dataset.gvChessOnline = '1';
    s.async = false;
    document.head.appendChild(s);
  }

  function connect() {
    if (!roomId) return;
    ensureSocketClient(() => {
      if (socket) {
        join();
        return;
      }
      socket = window.__gvRoomSocket || window.io(BACKEND, { transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 800 });
      window.__gvRoomSocket = socket;
      socket.on('connect', join);
      socket.on('roomUpdated', updated => {
        if (!updated || String(updated.id) !== String(roomId)) return;
        room = updated;
        window.__gvActiveRoom = updated;
        if (updated.status === 'playing' || updated.status === 'finished') {
          started = true;
          hideOverlay();
          loadChess();
          return;
        }
        render();
      });
      socket.on('gameStarted', payload => {
        if (!payload || String(payload.roomId) !== String(roomId)) return;
        started = true;
        hideOverlay();
        window.__gvActiveRoom = room || null;
        window.dispatchEvent(new CustomEvent('gv:roomGameStarted', { detail: payload }));
        loadChess();
      });
      socket.on('roomFull', payload => renderError(payload?.message || 'Bu oda dolu.'));
      socket.on('disconnect', () => { if (!started) renderError('Sunucu bağlantısı kesildi. Yeniden bağlanılıyor...'); });
      join();
    });
  }

  function join() {
    if (!socket?.connected || !roomId) return;
    localStorage.setItem('gv-room-id', roomId);
    socket.emit('joinRoom', {
      roomId,
      userName: userName(),
      userKey: userKey(),
      maxPlayers: 2,
      durationMinutes: 10,
      gameId: 'chess'
    });
  }

  function installWaitingPatch() {
    if (typeof window.startRoomWaitingProcess !== 'function' || window.startRoomWaitingProcess.__gvPatched) return;
    const patched = function (roomArg) {
      roomId = String(roomArg?.id || currentRoomId() || '');
      if (!roomId) return;
      started = false;
      window.__gvActiveRoomId = roomId;
      localStorage.setItem('gv-room-id', roomId);
      window.dispatchEvent(new CustomEvent('gv:roomReady', { detail: { roomId, gameId: 'chess' } }));
      if (socket) join(); else connect();
      render();
    };
    patched.__gvPatched = true;
    patched.__gvOriginal = window.startRoomWaitingProcess;
    window.startRoomWaitingProcess = patched;
  }

  function scan() {
    installWaitingPatch();
    if (!isRoomPage() || !isChessRoom()) return;
    const id = currentRoomId();
    if (id && id !== roomId) {
      roomId = id;
      window.__gvActiveRoomId = id;
      localStorage.setItem('gv-room-id', id);
      connect();
    }
    if (roomId && !started && !socket) connect();
    if (!started && room) render();
  }

  function boot() {
    scan();
    if (patchTimer) clearInterval(patchTimer);
    patchTimer = setInterval(scan, 400);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
