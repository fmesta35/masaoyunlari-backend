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

    // If curGame is explicitly another game (Pişti, Okey etc.), it is NOT chess/tavla!
    if (g && g !== 'chess' && g !== 'satranc' && g !== 'satranç' && g !== 'tavla') {
      return false;
    }

    if (g === 'chess' || g === 'satranç' || g === 'satranc' || g === 'tavla') return true;

    const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
    if (/satranç|satranc|tavla/i.test(title)) return true;

    return !!window.__gvChessOnlineRequested || !!window.__gvTavlaOnlineRequested;
  }

  // Bu köprü satranç ve tavla odalarını yönetir; aktif oyunu döndürür.
  function activeGame() {
    const s = state();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = String(g).toLowerCase().trim();
    if (g === 'tavla') return 'tavla';
    if (!g) {
      const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
      if (/tavla/i.test(title)) return 'tavla';
    }
    return 'chess';
  }

  function gameLabel() { return activeGame() === 'tavla' ? '🎲 Tavla' : '♟️ Satranç'; }

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

  function isMe(p) {
    if (!p) return false;
    if (socket?.id && p.id === socket.id) return true;
    // İzleyici modunda userKey ile eşleştirme YAPILMAZ: aynı tarayıcının
    // 2. sekmesi "İzle" dediğinde kendini oyuncu koltuğunda sanıyordu.
    if (window.__gvIsSpectator || window.__gvJoinAsSpectator) return false;
    return !!(p.userKey && p.userKey === userKey());
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
#gv-real-chess-wait .spec-banner{margin:0 0 12px;padding:8px 12px;border-radius:10px;background:rgba(108,92,231,.15);border:1px solid rgba(108,92,231,.35);color:var(--primary2,#a29bfe);text-align:center;font-weight:700;font-size:.9rem}
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
    const specs = Array.isArray(room.spectators) ? room.spectators : [];
    const me = ps.find(isMe);
    const watching = !me && (!!specs.find(isMe) || !!window.__gvIsSpectator);
    const ready = !!me?.isReady;
    const full = ps.length === 2;
    const allReady = full && ps.every(p => p.isReady);
    window.__gvIsSpectator = watching;

    const player = (i) => {
      const p = ps[i];
      if (!p) {
        return '<div class="gvp"><div class="av">➕</div><div class="nm">Rakip bekleniyor...</div><div class="st">Boş Sandalye</div></div>';
      }
      return '<div class="gvp ' + (p.isReady ? 'ready' : '') + '">' +
        '<div class="av">' + (p.color === 'white' ? '⚪' : '🔴') + '</div>' +
        '<div class="nm">' + esc(p.name || 'Oyuncu') + (isMe(p) ? ' <b>(Siz)</b>' : '') + '</div>' +
        '<div class="st">' + (p.isReady ? '✅ HAZIR' : '⏳ BEKLİYOR') + '</div>' +
        '</div>';
    };

    const status = watching
      ? (full ? '👁️ İzleyici olarak bekliyorsunuz. Oyun başlayınca tahtayı göreceksiniz.' : '👁️ İzleyici olarak bekliyorsunuz.')
      : allReady ? '🚀 Oyun başlatılıyor...' : full
        ? (ready ? '⏳ Rakibin de "HAZIRIM" butonuna basması bekleniyor...' : '👉 Oyuna başlamak için "HAZIRIM" butonuna basınız.')
        : '⌛ İkinci oyuncu masaya bekleniyor...';

    const specLine = specs.length ? '<div class="sub">👁️ ' + specs.length + ' izleyici</div>' : '';
    const title = watching ? 'İzleyici' : 'Bekleme Odası';
    const intro = watching
      ? '<div class="spec-banner">👁️ İzleyici modu — hamle yapamazsınız</div>'
      : '<div class="sub">Oyun, her iki oyuncu da <b>HAZIRIM</b> butonuna bastığında başlayacaktır.</div>';
    const readyBtn = watching ? ''
      : '<button class="gv-ready ' + (ready ? 'ready' : '') + '" type="button">' +
        (ready ? '✓ HAZIRSINIZ (İPTAL ETMEK İÇİN TIKLAYIN)' : '▶ OYUNA HAZIRIM!') +
        '</button>';
    const leaveLabel = watching ? '🚪 İzlemeyi Bırak' : '🚪 Odadan Ayrıl';

    const html = '<div class="card">' +
      '<h2>' + gameLabel() + ' Masa #' + roomId + ' — ' + title + '</h2>' +
      intro + specLine +
      (ps.length < 2 ? '<div class="spin"></div>' : '') +
      '<div class="players">' + player(0) + player(1) + '</div>' +
      '<div class="status">' + status + '</div>' +
      readyBtn +
      '<button class="gv-leave" type="button">' + leaveLabel + '</button>' +
      '</div>';

    // ÖNEMLİ: içerik değişmediyse innerHTML'i YENİDEN YAZMA. Eskiden her
    // render'da (scan 300 ms'de bir çağırıyor) tüm düğümler yeniden
    // oluşturuluyordu; kullanıcının HAZIRIM tıklaması tam yeniden yazım
    // anına denk gelirse tıklama ÖKSÜZ düğüme gider ve sunucuya hiç
    // ulaşmazdı ("hazırım basıyorum oyun başlamıyor").
    if (e.__gvLastHtml === html) return;
    e.__gvLastHtml = html;
    e.innerHTML = html;

    e.querySelector('.gv-ready')?.addEventListener('click', () => {
      if (watching) return;
      if (socket && socket.connected) {
        socket.emit('setReady', { ready: !ready });
      }
    });

    e.querySelector('.gv-leave')?.addEventListener('click', leave);
  }

  function esc(v) {
    return String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  // Online tavla istemcisi dosyası (js/tavla-online.js) barındırmada EKSİKSE
  // oda ekranı boş kalmasın: yerel tahta açılır + açık uyarı gösterilir.
  // (Dosya hiç yüklenemediğinde tavla-online.js'in KENDİ bekçisi de
  // çalışamaz; bu ikinci sigorta bu yüzden burada duruyor.)
  function tavlaLocalFallback(why) {
    try {
      if (window.__gvTavlaLocalFallbackShown) return;
      window.__gvTavlaLocalFallbackShown = true;
      const s = state();
      const area = document.getElementById('boardArea');
      if (s && area) {
        s.boards = s.boards || {};
        if (!s.boards.tavla && typeof window.rTavla === 'function') window.rTavla(area);
        else if (s.boards.tavla && typeof window.dTavla === 'function') window.dTavla(area);
      }
      const msg = '⚠️ Online tavla senkronu kurulamadı — tahta şu an ÇEVRİMDIŞI (yerel) görünümde. (' + (why || 'istemci yüklenemedi') + ')';
      if (window.GV && typeof window.GV.toast === 'function') window.GV.toast(msg, 'warning');
      else console.warn('[RoomFix]', msg);
    } catch (e) { console.warn('[RoomFix] tavla yerel görünüm açılamadı:', e); }
  }

  function loadChess() {
    if (!isChess()) return;
    // Tavla odası: tavla istemcisini devreye al (statik yüklüyse sadece boot et).
    if (activeGame() === 'tavla') {
      if (window.__gvTavlaGameStarted && window.__gvTavlaOnlineLoaded) return;
      window.__gvTavlaGameStarted = true;
      window.__gvTavlaOnlineRequested = true;
      if (window.__gvTavlaOnlineLoaded) {
        window.dispatchEvent(new CustomEvent('gv:roomGameStarted', { detail: { roomId } }));
        return;
      }
      if (document.querySelector('script[data-gv-tavla-online]')) return;
      const ts = document.createElement('script');
      ts.src = 'js/tavla-online.js?v=20260819i';
      ts.dataset.gvTavlaOnline = '1';
      ts.async = false;
      let settled = false;
      ts.onload = () => { settled = true; };
      ts.onerror = () => {
        if (settled) return;
        settled = true;
        tavlaLocalFallback('js/tavla-online.js yüklenemedi');
      };
      document.head.appendChild(ts);
      setTimeout(() => {
        if (settled || window.__gvTavlaOnlineLoaded) return;
        settled = true;
        tavlaLocalFallback('istemci zamanında açılamadı');
      }, 6000);
      return;
    }
    // Idempotent: oyun zaten boot edildiyse joinRoom/boot döngüsünü tetikleme.
    if (window.__gvChessGameStarted && window.__gvChessOnlineLoaded) return;
    window.__gvChessGameStarted = true;
    window.__gvChessOnlineRequested = true;
    // chess-online.js index.html içinde statik olarak da yüklüdür; yüklüyse
    // yeniden enjekte etme, sadece boot etmesi için olayı tetikle.
    if (window.__gvChessOnlineLoaded) {
      window.dispatchEvent(new CustomEvent('gv:roomGameStarted', { detail: { roomId } }));
      return;
    }
    if (document.querySelector('script[data-gv-chess-online]')) return;
    const s = document.createElement('script');
    s.src = 'js/chess-online.js?v=20260819i';
    s.dataset.gvChessOnline = '1';
    s.async = false;
    document.head.appendChild(s);
  }

  function connect() {
    if (!roomId || !isChess()) return;
    if (!window.io) {
      const sources = ['js/socket.io.min.js', 'socket.io.min.js', 'https://cdn.socket.io/4.7.5/socket.io.min.js'];
      (function tryNext(i) {
        if (i >= sources.length) return console.error('[RoomFix] Socket.IO yüklenemedi');
        const s = document.createElement('script');
        s.src = sources[i];
        s.onload = connect;
        s.onerror = () => tryNext(i + 1);
        document.head.appendChild(s);
      })(0);
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
        const mePlayer = (r.players || []).find(isMe);
        window.__gvIsSpectator = !mePlayer && !!(r.spectators || []).find(isMe);
        if (started) return;
        if (r.status === 'playing' || r.status === 'finished') {
          started = true;
          hide();
          loadChess();
        } else {
          render();
        }
      });

      socket.on('joinedRoom', p => {
        if (!p || String(p.roomId) !== roomId || !isChess()) return;
        window.__gvIsSpectator = p.role === 'spectator' || !!p.isSpectator;
        if (p.room) {
          room = p.room;
          window.__gvActiveRoom = p.room;
        }
        if (started) return;
        if (p.room && (p.room.status === 'playing' || p.room.status === 'finished')) {
          started = true;
          hide();
          loadChess();
        } else {
          render();
        }
      });

      socket.on('promotedToPlayer', p => {
        if (!p || String(p.roomId) !== roomId || !isChess()) return;
        window.__gvIsSpectator = false;
        window.__gvJoinAsSpectator = false;
        if (p.room) {
          room = p.room;
          window.__gvActiveRoom = p.room;
        }
        started = false;
        render();
      });

      socket.on('roomClosed', () => {
        if (!isChess()) return;
        leave();
      });

      socket.on('gameStarted', p => {
        if (!p || String(p.roomId) !== roomId || !isChess()) return;
        if (p.isSpectator) window.__gvIsSpectator = true;
        if (started) return;
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
        const e = overlay();
        e.innerHTML = '<div class="card"><h2>' + gameLabel() + '</h2><div class="sub">' +
          esc(p?.message || 'Bu oda dolu.') +
          '</div><button class="gv-leave" type="button">🚪 Lobiye Dön</button></div>';
        e.querySelector('.gv-leave')?.addEventListener('click', leave);
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
      durationMinutes: Number(room?.duration || room?.durationMinutes || 10),
      gameId: activeGame(), // 'chess' | 'tavla'
      roomName: room?.name,
      isPrivate: !!room?.isPrivate,
      asSpectator: !!window.__gvJoinAsSpectator || !!window.__gvIsSpectator
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
    room = null;
    started = false;
    roomId = null;
    window.__gvRoomSocket = null;
    window.__gvChessSocket = null;
    window.__gvActiveRoom = null;
    window.__gvActiveRoomId = null;
    window.__gvChessGameStarted = false;
    window.__gvIsSpectator = false;
    window.__gvJoinAsSpectator = false;
    try { localStorage.removeItem('gv-room-id'); } catch (_) {}
    hide();

    // Online satranç istemcisinin durumunu sıfırla (chess-online.js hook'u)
    if (typeof window.__gvChessOnlineReset === 'function') {
      try { window.__gvChessOnlineReset(); } catch (_) {}
    }
    // Online tavla istemcisi için de aynı sıfırlama (tavla-online.js hook'u)
    if (typeof window.__gvTavlaOnlineReset === 'function') {
      try { window.__gvTavlaOnlineReset(); } catch (_) {}
    }
    window.__gvTavlaGameStarted = false;
    window.__gvTavlaOnlineRequested = false;
    window.__gvTavlaLocalFallbackShown = false;

    // Tahta alanını ve oyun sonu overlay'ini temizle
    const boardArea = document.getElementById('boardArea');
    if (boardArea) boardArea.innerHTML = '';
    document.querySelectorAll('.chess-end-overlay, .promo-overlay').forEach(el => el.remove());

    // Reset clocks on UI to 10:00
    const t1 = document.getElementById('t1');
    const t2 = document.getElementById('t2');
    if (t1) t1.textContent = '10:00';
    if (t2) t2.textContent = '10:00';

    const s = state();
    if (s) {
      s.roomWaitingState = null;
      s.roomWaitingInt = null;
      s.curRoom = null;
      s.onlineClock = false; // saat paneli tekrar yerel sisteme açılabilir
    }

    goLobby();
  }

  // Lobiye güvenli dönüş: GV inline script'te "const GV" olarak tanımlı olduğu
  // için window.GV üzerinde DEĞİL, global sözcüksel kapsamda erişilebilir.
  // (Eski kod "typeof page === 'function'" kontrolü yapıyordu; page fonksiyonu
  // IIFE içinde kaldığından bu her zaman false oluyor ve buton çalışmıyordu.)
  function goLobby() {
    try {
      if (typeof GV !== 'undefined' && GV) {
        if (typeof GV.openLobby === 'function') { GV.openLobby(activeGame()); return true; }
        if (typeof GV.page === 'function') { GV.page('games'); return true; }
      }
    } catch (_) {}
    const btn = document.querySelector('.nav-btn[data-p="games"]');
    if (btn) { btn.click(); return true; }
    try { window.location.reload(); } catch (_) {}
    return false;
  }

  function startRealRoomWaiting(r) {
    if (!isChess()) return;
    roomId = String(r?.id || roomIdNow() || '');
    room = r || { id: roomId, name: gameLabel() + ' Masası #' + roomId, maxPlayers: 2, duration: 10, players: [], status: 'waiting' };
    started = false;
    window.__gvActiveRoomId = roomId;
    window.__gvActiveRoom = room;
    if (activeGame() === 'tavla') window.__gvTavlaOnlineRequested = true;
    else window.__gvChessOnlineRequested = true;
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
      window.__gvTavlaOnlineRequested = false;
      hide(); // Ensure chess/tavla overlay is completely hidden on other games like Pişti, Okey!
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
