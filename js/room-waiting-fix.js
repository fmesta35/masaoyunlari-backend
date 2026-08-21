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

    // If curGame is explicitly another game (Pişti, 101 Okey etc.), it is NOT chess/tavla/okey!
    if (g && g !== 'chess' && g !== 'satranc' && g !== 'satranç' && g !== 'tavla' && g !== 'okey') {
      return false;
    }

    if (g === 'chess' || g === 'satranç' || g === 'satranc' || g === 'tavla' || g === 'okey') return true;

    const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
    if (/satranç|satranc|tavla/i.test(title)) return true;
    if (/okey/i.test(title) && !/101/.test(title)) return true;

    return !!window.__gvChessOnlineRequested || !!window.__gvTavlaOnlineRequested || !!window.__gvOkeyOnlineRequested;
  }

  // Bu köprü satranç, tavla ve okey odalarını yönetir; aktif oyunu döndürür.
  function activeGame() {
    const s = state();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = String(g).toLowerCase().trim();
    if (g === 'tavla' || g === 'okey') return g;
    if (!g) {
      const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
      if (/tavla/i.test(title)) return 'tavla';
      if (/okey/i.test(title) && !/101/.test(title)) return 'okey';
    }
    return 'chess';
  }

  function gameLabel() {
    const g = activeGame();
    return g === 'tavla' ? '🎲 Tavla' : g === 'okey' ? '🀄 Okey' : '♟️ Satranç';
  }

  // Koltuk sayısı odadan okunur: okey 2/3/4 kişilik olabilir (hazır masaların
  // ve üyelerin kurduğu masaların kapasitesi sunucudan gelir), satranç/tavla 2.
  function maxSeats() {
    const n = Number(room?.maxPlayers) || Number(state()?.roomConfig?.playerCount) || 0;
    if (n >= 2) return n;
    return activeGame() === 'okey' ? 4 : 2;
  }

  function isRoomPage() {
    const s = state();
    return !!(document.getElementById('pg-room')?.classList.contains('active') || String(s?.curPage || '').toLowerCase() === 'room');
  }

  function userName() {
    const s = state();
    return s?.user?.name || s?.user?.username || localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  // Sekme/pencere bazlı parça: aynı tarayıcı PROFİLİNDEKİ her pencere aynı
  // localStorage misafir kimliğini paylaştığı için (bkz. "4 tarayıcı lobide
  // buluşamıyor" hatası: sunucu 2.-4. pencereyi rejoin sanıp oda 1/4'te
  // takılıyordu) misafir userKey'ine pencere başına bir parça eklenir.
  // sessionStorage F5/yenilemede AYNI sekmede korunur → reconnect hakkı
  // kaybolmaz; yeni pencerede/sekmede taze üretilir → sıradaki boş koltuk.
  function tabKey() {
    try {
      let t = sessionStorage.getItem('gv-tab-id');
      if (!t) {
        t = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8)
          : Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('gv-tab-id', t);
      }
      return t;
    } catch (_) {
      // Depolama kapalıysa bellek içi kimlik (yine pencere bazında ayrı).
      if (!window.__gvTabId) window.__gvTabId = Math.random().toString(36).slice(2, 10);
      return window.__gvTabId;
    }
  }

  function userKey() {
    const s = state();
    const u = s?.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    // Kayıtlı kullanıcı kasti olarak profil genelinde TEK kalır: başka
    // cihazdan/sekmeden girince koltuğunu devralabilmesi için.
    if (stable) return 'user:' + String(stable);
    let id = localStorage.getItem('gv-chess-guest-id');
    if (!id) {
      id = window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      localStorage.setItem('gv-chess-guest-id', id);
    }
    return 'guest:' + id + ':' + tabKey();
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
.gvp.gvp-inv{cursor:pointer;border-style:dashed}
.gvp.gvp-inv:hover{border-color:var(--primary,#6c5ce7);background:rgba(108,92,231,.14)}
.gvp.gvp-inv .st{color:var(--primary,#6c5ce7)}
.gvp-kick{margin-top:9px;padding:5px 12px;border:1px solid rgba(255,118,117,.5);background:rgba(255,118,117,.12);color:#ff7675;border-radius:8px;cursor:pointer;font-weight:700;font-size:.8rem}
.gvp-kick:hover{background:rgba(255,118,117,.25)}
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
    const seats = maxSeats();
    const isOkeyGame = activeGame() === 'okey';
    const SAYI = { 2: 'iki', 3: 'üç', 4: 'dört' };
    const full = ps.length === seats;
    const allReady = full && ps.every(p => p.isReady);
    window.__gvIsSpectator = watching;

    // Özel masada kurucu: boş ➕ koltuk tıklanabilir (arkadaş daveti) ve
    // dolu koltuktaki oyuncuyu masadan ATABİLİR.
    const myMemberId = (() => { const s = state(); return (s && !s.isGuest && s.user && s.user.id) ? Number(s.user.id) : null; })();
    const amCreator = !!(room && room.isPrivate && myMemberId && Number(room.creatorId || 0) > 0 && Number(room.creatorId) === myMemberId);

    // Okeyde koltuk renkleri masa görünümüyle uyumlu: turuncu/mavi/kırmızı/mor.
    const seatAva = ['🟠', '🔵', '🔴', '🟣'];
    const player = (i) => {
      const p = ps[i];
      if (!p) {
        const emptyTxt = isOkeyGame ? ('Sandalye ' + (i + 1) + ' — oyuncu bekleniyor...') : 'Rakip bekleniyor...';
        if (amCreator && !watching) {
          return '<div class="gvp gvp-inv" data-gv-invite="1" title="Arkadaşını davet et"><div class="av">➕</div><div class="nm">' + emptyTxt + '</div><div class="st">📩 Davet Gönder</div></div>';
        }
        return '<div class="gvp"><div class="av">➕</div><div class="nm">' + emptyTxt + '</div><div class="st">Boş Sandalye</div></div>';
      }
      const ava = isOkeyGame
        ? seatAva[i % seatAva.length]
        : (p.color === 'white' ? '⚪' : '🔴');
      const nmHtml = Number(p.uid) > 0 && !isMe(p)
        ? '<span class="gv-u" data-uid="' + Number(p.uid) + '">' + esc(p.name || 'Oyuncu') + '</span>'
        : esc(p.name || 'Oyuncu');
      const kickBtn = (amCreator && !isMe(p) && Number(p.uid) > 0)
        ? '<button class="gvp-kick" type="button" data-gv-kick="' + Number(p.uid) + '" data-gv-kname="' + esc(p.name || 'Oyuncu') + '">🚪 Masadan At</button>'
        : '';
      return '<div class="gvp ' + (p.isReady ? 'ready' : '') + '">' +
        '<div class="av">' + ava + '</div>' +
        '<div class="nm">' + nmHtml + (isMe(p) ? ' <b>(Siz)</b>' : '') + '</div>' +
        '<div class="st">' + (p.isReady ? '✅ HAZIR' : '⏳ BEKLİYOR') + '</div>' +
        kickBtn +
        '</div>';
    };

    const status = watching
      ? (full ? '👁️ İzleyici olarak bekliyorsunuz. Oyun başlayınca masayı göreceksiniz.' : '👁️ İzleyici olarak bekliyorsunuz.')
      : allReady ? '🚀 Oyun başlatılıyor...' : full
        ? (ready ? '⏳ Diğer oyuncuların da "HAZIRIM" demesi bekleniyor...' : '👉 Oyuna başlamak için "HAZIRIM" butonuna basınız.')
        : (isOkeyGame
          ? ('⌛ ' + ps.length + '/' + seats + ' oyuncu masada — ' + (seats - ps.length) + ' oyuncu daha bekleniyor...')
          : '⌛ İkinci oyuncu masaya bekleniyor...');

    const specLine = specs.length ? '<div class="sub">👁️ ' + specs.length + ' izleyici</div>' : '';
    const title = watching ? 'İzleyici' : 'Bekleme Odası';
    const intro = watching
      ? '<div class="spec-banner">👁️ İzleyici modu — hamle yapamazsınız</div>'
      : (isOkeyGame
        ? '<div class="sub">Oyun, <b>' + (SAYI[seats] || seats) + ' oyuncu</b> da <b>HAZIRIM</b> butonuna bastığında başlayacaktır.</div>'
        : '<div class="sub">Oyun, her iki oyuncu da <b>HAZIRIM</b> butonuna bastığında başlayacaktır.</div>');
    const readyBtn = watching ? ''
      : '<button class="gv-ready ' + (ready ? 'ready' : '') + '" type="button">' +
        (ready ? '✓ HAZIRSINIZ (İPTAL ETMEK İÇİN TIKLAYIN)' : '▶ OYUNA HAZIRIM!') +
        '</button>';
    const leaveLabel = watching ? '🚪 İzlemeyi Bırak' : '🚪 Odadan Ayrıl';

    let seatCells = '';
    for (let i = 0; i < seats; i++) seatCells += player(i);

    const html = '<div class="card">' +
      '<h2>' + gameLabel() + ' Masa #' + roomId + ' — ' + title + '</h2>' +
      intro + specLine +
      (!full ? '<div class="spin"></div>' : '') +
      '<div class="players">' + seatCells + '</div>' +
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

    // Boş ➕ koltuk (özel masanın kurucusu): arkadaş davet penceresini aç —
    // birden fazla kişi davet edilebilir, ilk katılan koltuğu alır.
    e.querySelectorAll('[data-gv-invite]').forEach(el => el.addEventListener('click', () => {
      if (window.GV && typeof GV.showInviteModal === 'function') GV.showInviteModal();
    }));
    // Kurucunun "Masadan At" butonları (sunucu tekrar doğrular).
    e.querySelectorAll('[data-gv-kick]').forEach(btn => btn.addEventListener('click', ev => {
      ev.stopPropagation();
      const uid = Number(btn.getAttribute('data-gv-kick'));
      const nm = btn.getAttribute('data-gv-kname') || 'Oyuncu';
      if (!(uid > 0)) return;
      if (!confirm(nm + ' masadan atılsın mı? Yeniden davet edene kadar bu masaya giremez.')) return;
      if (socket && socket.connected) socket.emit('kickPlayer', { roomId, userId: uid });
    }));

    e.querySelector('.gv-ready')?.addEventListener('click', () => {
      if (watching) return;
      const send = () => {
        if (socket && socket.connected) socket.emit('setReady', { ready: !ready });
      };
      // Bağlantı henüz kurulmadıysa ya da oda kaydı (joinedRoom) dönmediyse
      // setReady boşluğa gider (soket joinRoom'dan ÖNCE flush edilebilir —
      // yavaş bağlantıda "hazırım basıyorum başlamıyor" yarışı). Oda kaydı
      // oturana kadar kısa aralıklarla dene.
      if (socket && socket.connected && window.__gvRoomJoined) return send();
      let tries = 0;
      const t = setInterval(() => {
        tries++;
        if (socket && socket.connected && window.__gvRoomJoined) { clearInterval(t); send(); }
        else if (tries > 60) clearInterval(t);
      }, 100);
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

  // Online okey istemcisi (js/okey-online.js) barındırmada EKSİKSE ekran boş
  // kalmasın: yerel okey masası açılır + açık uyarı gösterilir (tavla sigortası
  // ile aynı kalıp; sunucu durumu ulaşırsa istemci üzerine geçer).
  function okeyLocalFallback(why) {
    try {
      if (window.__gvOkeyLocalFallbackShown) return;
      window.__gvOkeyLocalFallbackShown = true;
      const s = state();
      const area = document.getElementById('boardArea');
      if (s && area) {
        s.boards = s.boards || {};
        if (!s.boards.okey && typeof window.rOkey === 'function') window.rOkey(area);
        else if (s.boards.okey && typeof window.dOkey === 'function') window.dOkey(area);
      }
      const msg = '⚠️ Online okey senkronu kurulamadı — masa şu an ÇEVRİMDIŞI (yerel) görünümde. (' + (why || 'istemci yüklenemedi') + ')';
      if (window.GV && typeof window.GV.toast === 'function') window.GV.toast(msg, 'warning');
      else console.warn('[RoomFix]', msg);
    } catch (e) { console.warn('[RoomFix] okey yerel görünüm açılamadı:', e); }
  }

  function loadChess() {
    if (!isChess()) return;
    // Okey odası: okey istemcisini devreye al (statik yüklüyse sadece boot et).
    if (activeGame() === 'okey') {
      if (window.__gvOkeyGameStarted && window.__gvOkeyOnlineLoaded) return;
      window.__gvOkeyGameStarted = true;
      window.__gvOkeyOnlineRequested = true;
      if (window.__gvOkeyOnlineLoaded) {
        window.dispatchEvent(new CustomEvent('gv:roomGameStarted', { detail: { roomId } }));
        return;
      }
      if (document.querySelector('script[data-gv-okey-online]')) return;
      const os = document.createElement('script');
      os.src = 'js/okey-online.js?v=20260820e';
      os.dataset.gvOkeyOnline = '1';
      os.async = false;
      let oSettled = false;
      os.onload = () => { oSettled = true; };
      os.onerror = () => {
        if (oSettled) return;
        oSettled = true;
        okeyLocalFallback('js/okey-online.js yüklenemedi');
      };
      document.head.appendChild(os);
      setTimeout(() => {
        if (oSettled || window.__gvOkeyOnlineLoaded) return;
        oSettled = true;
        okeyLocalFallback('istemci zamanında açılamadı');
      }, 6000);
      return;
    }
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
      ts.src = 'js/tavla-online.js?v=20260820e';
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
    s.src = 'js/chess-online.js?v=20260820e';
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
        window.__gvRoomJoined = true; // oda kaydı sunucuda oturdu — HAZIRIM güvenle gönderilebilir
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
        showBlockOverlay(p?.message || 'Bu oda dolu.');
      });

      // Özel oda kilidi: kurucu/davetli değilsen, masa doluysa veya davet
      // geçersizse sunucu girişi reddeder — sebebi kart üzerinde göster.
      socket.on('joinDenied', p => {
        if (!p || String(p.roomId) !== roomId || !isChess()) return;
        if (retryAfterAuthDeny(p)) return; // authHello yarışı — sessizce yeniden dene
        showBlockOverlay(p.reason || 'Bu masaya girilmedi.');
      });
      socket.on('joinedRoom', () => { authRetry = 0; });

      // Kurucu masadan attıysa: odadan düş + kalıcı bilgi (yeniden davet şart)
      socket.on('kickedFromRoom', p => {
        if (!p || String(p.roomId) !== String(roomId)) return;
        try { window.GV && GV.toast && GV.toast('🚪 Kurucu sizi masadan attı — yeniden davet edilmeden giremezsiniz.', 'warning', 6000); } catch (_) {}
        leave();
      });
      // Atma işleminin sonucu (kurucunun ekranına düşer)
      socket.on('kickResult', p => {
        if (!p) return;
        try {
          window.GV && GV.toast && GV.toast(
            p.ok ? ('🚪 ' + (p.name || 'Oyuncu') + ' masadan atıldı.') : ('⚠️ ' + (p.reason || 'Atılamadı.')),
            p.ok ? 'success' : 'warning');
        } catch (_) {}
      });
    }
    join();
  }

  function join() {
    if (!socket?.connected || !roomId || !isChess()) return;
    localStorage.setItem('gv-room-id', roomId);
    // Okey: masayı kuranın seçtiği el sayısı (3/5/7) yeni odaya taşınır;
    // mevcut (hazır) masalarda sunucu kendi rounds değerini korur.
    const rCfg = Number(room?.rounds || state()?.roomConfig?.rounds) || 0;
    // Davet bildiriminden GELİNDİYSE ilk katılımda viaInvite taşınır (tek
    // kullanımlık): oda artık yoksa sunucu yeni oda AÇMAK yerine "davet
    // artık geçerli değil" reddi döner.
    const viaInvite = !!window.__gvJoinViaInvite;
    window.__gvJoinViaInvite = false;
    socket.emit('joinRoom', {
      roomId,
      userName: userName(),
      userKey: userKey(),
      maxPlayers: maxSeats(), // okey 2/3/4, satranç/tavla 2 (kalıcı masalarda sunucu kendi değerini korur)
      durationMinutes: Number(room?.duration || room?.durationMinutes || 10),
      gameId: activeGame(), // 'chess' | 'tavla' | 'okey'
      rounds: rCfg > 0 ? rCfg : undefined,
      roomName: room?.name,
      isPrivate: !!room?.isPrivate,
      asSpectator: !!window.__gvJoinAsSpectator || !!window.__gvIsSpectator,
      viaInvite
    });
  }

  // Özel masa kilidi "code:'auth'" ile reddederse: büyük olasılıkla authHello
  // yarışı (soket açıldı ama üye kimliği henüz PHP/SQLite'tan dönmedi). Üyeyse
  // kısa aralıklarla birkaç kez yeniden dene; misafirse / hak etmişse reddetme.
  let authRetry = 0;
  function retryAfterAuthDeny(p) {
    if (!p || p.code !== 'auth') return false;
    const s = state();
    const isMember = s && !s.isGuest && s.user && s.user.id;
    if (!isMember || authRetry >= 5) return false;
    authRetry++;
    try { window.GVAuth && GVAuth.authHelloAll && GVAuth.authHelloAll(); } catch (_) {}
    setTimeout(join, 900);
    return true;
  }
  function showBlockOverlay(msg) {
    const e = overlay();
    e.innerHTML = '<div class="card"><h2>' + gameLabel() + '</h2><div class="sub">' +
      esc(msg || 'Bu masaya girilmedi.') +
      '</div><button class="gv-leave" type="button">🚪 Lobiye Dön</button></div>';
    e.querySelector('.gv-leave')?.addEventListener('click', leave);
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
    window.__gvRoomJoined = false;
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
    // Online okey istemcisi sıfırlaması (okey-online.js hook'u)
    if (typeof window.__gvOkeyOnlineReset === 'function') {
      try { window.__gvOkeyOnlineReset(); } catch (_) {}
    }
    window.__gvOkeyGameStarted = false;
    window.__gvOkeyOnlineRequested = false;
    window.__gvOkeyLocalFallbackShown = false;

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
    room = r || { id: roomId, name: gameLabel() + ' Masası #' + roomId, maxPlayers: maxSeats(), duration: 10, players: [], status: 'waiting' };
    started = false;
    window.__gvActiveRoomId = roomId;
    window.__gvActiveRoom = room;
    if (activeGame() === 'tavla') window.__gvTavlaOnlineRequested = true;
    else if (activeGame() === 'okey') window.__gvOkeyOnlineRequested = true;
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
      window.__gvOkeyOnlineRequested = false;
      hide(); // Ensure chess/tavla/okey overlay is completely hidden on other games like Pişti, 101!
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
