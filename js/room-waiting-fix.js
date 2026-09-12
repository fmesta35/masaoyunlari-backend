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

  // Gerçek (soket) bekleme odası kullanan oyunlar: satranç, tavla, okey,
  // 101 okey + 10'ar hazır masa açılan damalar/reversi/gomoku/connect4/bilardo.
  // Bu oyunlarda lobi masaları, özel masa ve "özel oyun oluştur" aynı
  // masada-bekleme görünümünü (otur/kalk/hazırım/izle) kullanır.
  // (Kart oyunları ve diğerleri için ilgili online modül ayrıca devreye girer.)
  const BRIDGE_GAMES = ['chess', 'satranc', 'satranç', 'tavla', 'okey', 'okey101',
    'pisti', 'batak', 'dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo'];
  const normGame = (g) => {
    g = String(g || '').toLowerCase().trim();
    if (g === 'satranc' || g === 'satranç') return 'chess';
    return g;
  };

  function isChess() {
    const s = state();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = normGame(g);

    // curGame AÇIKÇA tanımlıysa onunla karar ver: köprü oyunu ise evet,
    // değilse (Pişti, Batak) hayır — yerel akış korunur.
    if (g) return BRIDGE_GAMES.includes(g);

    // curGame boşsa başlık/istemci bayrağından çıkar:
    const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
    if (/satranç|satranc|tavla/i.test(title)) return true;
    if (/okey/i.test(title)) return true; // 'Okey' ve '101 Okey' ikisi de sunucu yetkili
    if (/pişti|pisti|batak|dama|reversi|gomoku|connect|bilardo/i.test(title)) return true;

    return !!window.__gvChessOnlineRequested || !!window.__gvTavlaOnlineRequested || !!window.__gvOkeyOnlineRequested || !!window.__gvOnlineRequested;
  }

  // Bu köprü tüm gerçek-masa oyunlarının odalarını yönetir; aktif oyunu döndürür.
  function activeGame() {
    const s = state();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = normGame(g);
    if (BRIDGE_GAMES.includes(g)) return g;
    if (!g) {
      const title = (document.getElementById('grTitle')?.textContent || '').toLowerCase();
      if (/tavla/i.test(title)) return 'tavla';
      if (/pişti|pisti/i.test(title)) return 'pisti';
      if (/batak/i.test(title)) return 'batak';
      if (/okey/i.test(title) && /101/.test(title)) return 'okey101';
      if (/okey/i.test(title)) return 'okey';
      if (/dama|dama/i.test(title) && /türk/i.test(title)) return 'turkdamasi';
      if (/dama/i.test(title)) return 'dama';
      if (/reversi/i.test(title)) return 'reversi';
      if (/gomoku/i.test(title)) return 'gomoku';
      if (/connect/i.test(title)) return 'connect4';
      if (/bilardo/i.test(title)) return 'bilardo';
    }
    return 'chess';
  }

  function gameLabel() {
    const g = activeGame();
    const def = window.GAMES && window.GAMES[g];
    return def ? (def.icon + ' ' + def.name) : '♟️ Satranç';
  }

  // ODAYI AÇAN OYUN BAĞLAMI: masanın oyunu SUNUCUDA (room.gameId) saklanır;
  // istemci başlık/oyun modülünü kendi sayfa oyunundan (st.curGame) alırdı —
  // kurucu satranç masası kurar, davetli OKEY sayfasındayken katılırsa
  // masanın adı karşı tarafta "Okey Masa #X" görünürdü (aynı masa, farklı
  // oyun adı karışıklığı). Sunucu odası gameId taşırken istemci oyun
  // bağlamı ona senkronlanır → herkes aynı oyun adını/modülünü görür.
  function syncCurGameToRoom(r) {
    try {
      const s = state();
      if (!s || !r || !r.gameId) return;
      const g = normGame(r.gameId);
      if (!BRIDGE_GAMES.includes(g)) return; // köprü dışı oyun: dokunma
      if (s.curGame !== g) s.curGame = g;
    } catch (_) {}
  }

  // Koltuk sayısı odadan okunur: okey/101 okey 2/3/4 kişilik olabilir (hazır
  // masaların ve üyelerin kurduğu masaların kapasitesi sunucudan gelir),
  // satranç/tavla 2.
  function maxSeats() {
    const n = Number(room?.maxPlayers) || Number(state()?.roomConfig?.playerCount) || 0;
    if (n >= 2) return n;
    const g = activeGame();
    return (g === 'okey' || g === 'okey101') ? 4 : 2;
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
/* z-index: 1800 — index.html'deki .modal-bg (z-index:2000) ve .toast-wrap
   (z-index:3000) ile aynı seviyede DEĞİL; böylece "📩 Davet Gönder" penceresi
   ve toast bildirimleri bekleme odası overlay'inin ÜZERİNDE görünür.
   Davet/arkadaş modalı açıldığında kullanıcı modal içeriğini görebilir. */
#gv-real-chess-wait{position:fixed;inset:0;z-index:1800;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(6,7,20,.88);backdrop-filter:blur(12px)}
#gv-real-chess-wait .card{width:min(92vw,620px);background:var(--bg2,#111128);color:var(--text,#fff);border:1px solid var(--border2,rgba(255,255,255,.15));border-radius:18px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.65)}
#gv-real-chess-wait h2{margin:0 0 7px;font-size:1.35rem;color:var(--primary,#6c5ce7);text-align:center}
#gv-real-chess-wait .sub{color:var(--text2,#aaa);font-size:.9rem;margin-bottom:18px;text-align:center}
/* ---- GERÇEK MASA GÖRÜNÜMÜ (bekleme odası) ----
   Oyuncular artık kutu ızgarasında değil, keçe kaplı yuvarlak bir masanın
   ETRAFINDA otururlar. Koltuk sayısına göre (2/3/4) yerleşim değişir; boş
   koltuk gerçekten "boş sandalye" gibi görünür. */
#gv-real-chess-wait .players{
  position:relative;width:min(100%,430px);margin:16px auto;aspect-ratio:1 / .92;
  --gv-seat-w:28%;
}
#gv-real-chess-wait .players .gv-felt{
  position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:40%;height:44%;border-radius:50%;
  background:radial-gradient(circle at 50% 38%, #1c8a51, #0a3f22 78%);
  border:7px solid #4a2c1a;
  box-shadow:inset 0 0 34px rgba(0,0,0,.6), 0 14px 34px rgba(0,0,0,.55);
  display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  color:#f9ca24;font-weight:900;letter-spacing:.04em;font-size:.74rem;padding:6px;line-height:1.15;
}
#gv-real-chess-wait .players .gv-felt small{display:block;color:rgba(255,255,255,.62);font-weight:700;font-size:.68rem;letter-spacing:0;margin-top:3px}
.gvp{
  position:absolute;width:var(--gv-seat-w);box-sizing:border-box;
  padding:9px 8px 10px;text-align:center;
  background:linear-gradient(180deg,var(--card,#1a1a3e),rgba(0,0,0,.35));
  border:2px solid var(--border,rgba(255,255,255,.10));border-radius:14px;
  transition:all .3s ease;box-shadow:0 6px 16px rgba(0,0,0,.45);
}
.gvp::after{                                    /* sandalye sırtı */
  content:'';position:absolute;left:50%;transform:translateX(-50%);
  width:52%;height:9px;border-radius:0 0 9px 9px;
  background:linear-gradient(180deg,#5c3a1a,#3a2410);bottom:-9px;
}
.gvp.seat-top::after{top:-9px;bottom:auto;border-radius:9px 9px 0 0}
.gvp.seat-left::after,.gvp.seat-right::after{display:none}
.gvp.seat-bottom{left:50%;bottom:0;transform:translateX(-50%)}
.gvp.seat-top{left:50%;top:0;transform:translateX(-50%)}
.gvp.seat-left{left:0;top:50%;transform:translateY(-50%)}
.gvp.seat-right{right:0;top:50%;transform:translateY(-50%)}
.gvp.ready{border-color:var(--success,#00b894);box-shadow:0 0 22px rgba(0,184,148,.28);background:linear-gradient(180deg,rgba(0,184,148,.16),rgba(0,0,0,.35))}
.gvp .av{font-size:1.9rem;line-height:1;margin-bottom:5px}
.gvp .nm{font-weight:700;min-height:20px;font-size:.85rem;overflow:hidden;text-overflow:ellipsis}
.gvp .st{font-size:.72rem;color:var(--text2,#aaa);margin-top:4px;font-weight:bold}
.gvp.ready .st{color:#00b894}
.gvp.gvp-empty{background:rgba(255,255,255,.03);border-style:dashed;opacity:.9}
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
@media(max-width:650px){
  #gv-real-chess-wait .card{padding:16px}
  #gv-real-chess-wait .players{width:min(100%,330px);--gv-seat-w:31%}
  .gvp{padding:7px 5px 8px}
  .gvp .av{font-size:1.5rem}
  .gvp .nm{font-size:.76rem}
  .gvp .st{font-size:.64rem}
  .gvp-kick{padding:3px 8px;font-size:.68rem;margin-top:6px}
  #gv-real-chess-wait .players .gv-felt{font-size:.64rem;border-width:5px;width:34%;height:38%}
}
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
    // watching: kullanıcı GERÇEKTEN izleyici mi? Yalnızca specs listesinde
    // görünüyorsa VEYA sunucu onu spectator olarak atamışsa. Oyuncu
    // henüz join etmediği için `me` null olabilir; bu durumda watching
    // false kalmalı (tarayıcı yenilenince socket.id değişir, eski oyuncu
    // koltukta kalır, yeni socket ile me null olur, ama bu izleyici
    // moduna geçtiği anlamına gelmez).
    const watching = !me && (!!specs.find(isMe) || socket.role === 'spectator');
    const ready = !!me?.isReady;
    const seats = maxSeats();
    const _ag = activeGame();
    const isOkeyGame = _ag === 'okey' || _ag === 'okey101';
    const SAYI = { 2: 'iki', 3: 'üç', 4: 'dört' };
    const full = ps.length === seats;
    const allReady = full && ps.every(p => p.isReady);
    // watching'i sadece gerçekten izleyici olduğunda set et; aksi halde
    // oyuncu olarak yeniden join etmesi gerekir.
    if (watching) window.__gvIsSpectator = true;
    else if (socket && socket.id && ps.some(p => isMe(p))) window.__gvIsSpectator = false;

    // Özel masada kurucu: boş ➕ koltuk tıklanabilir (arkadaş daveti) ve
    // dolu koltuktaki oyuncuyu masadan ATABİLİR.
    const myMemberId = (() => { const s = state(); return (s && !s.isGuest && s.user && s.user.id) ? Number(s.user.id) : null; })();
    const amCreator = !!(room && room.isPrivate && myMemberId && Number(room.creatorId || 0) > 0 && Number(room.creatorId) === myMemberId);

    // Okeyde koltuk renkleri masa görünümüyle uyumlu: turuncu/mavi/kırmızı/mor.
    const seatAva = ['🟠', '🔵', '🔴', '🟣'];
    // Koltuk YERLEŞİMİ: masa etrafında saat yönünde. Kendi koltuğum her zaman
    // ALT tarafa gelir (gerçek masada olduğu gibi) — 2/3/4 kişilik masaların
    // hepsinde geçerlidir.
    const myIdx = (() => { const k = ps.findIndex(isMe); return k >= 0 ? k : 0; })();
    const SEAT_POS = {
      2: ['seat-bottom', 'seat-top'],
      3: ['seat-bottom', 'seat-left', 'seat-right'],
      4: ['seat-bottom', 'seat-left', 'seat-top', 'seat-right']
    };
    const seatPos = (i) => {
      const table = SEAT_POS[seats] || SEAT_POS[4];
      const rel = ((i - myIdx) % seats + seats) % seats;
      return table[rel] || 'seat-bottom';
    };

    const player = (i) => {
      const p = ps[i];
      const sp = seatPos(i);
      if (!p) {
        const emptyTxt = isOkeyGame ? ('Sandalye ' + (i + 1)) : 'Rakip bekleniyor';
        if (amCreator && !watching) {
          return '<div class="gvp gvp-empty gvp-inv ' + sp + '" data-gv-invite="1" title="Arkadaşını davet et"><div class="av">🪑</div><div class="nm">' + emptyTxt + '</div><div class="st">📩 Davet Gönder</div></div>';
        }
        return '<div class="gvp gvp-empty ' + sp + '"><div class="av">🪑</div><div class="nm">' + emptyTxt + '</div><div class="st">Boş Sandalye</div></div>';
      }
      // Koltuk yapay zekâdaysa (oyuncu masayı terk etti, bot idareten
      // oynuyor) bunu masadaki herkes görsün — kimin gerçek oyuncu
      // olduğu belirsiz kalmasın.
      const botKoltuk = !!p.ai;
      const ava = botKoltuk ? '🤖' : (isOkeyGame
        ? seatAva[i % seatAva.length]
        : (p.color === 'white' ? '⚪' : '🔴'));
      const nmHtml = Number(p.uid) > 0 && !isMe(p)
        ? '<span class="gv-u" data-uid="' + Number(p.uid) + '">' + esc(p.name || 'Oyuncu') + '</span>'
        : esc(p.name || 'Oyuncu');
      const kickBtn = (amCreator && !isMe(p) && Number(p.uid) > 0)
        ? '<button class="gvp-kick" type="button" data-gv-kick="' + Number(p.uid) + '" data-gv-kname="' + esc(p.name || 'Oyuncu') + '">🚪 Masadan At</button>'
        : '';
      return '<div class="gvp ' + sp + ' ' + (p.isReady ? 'ready' : '') + '">' +
        '<div class="av">' + ava + '</div>' +
        '<div class="nm">' + nmHtml + (isMe(p) ? ' <b>(Siz)</b>' : '') + '</div>' +
        '<div class="st">' + (botKoltuk ? '🤖 İdareci' : (p.isReady ? '✅ HAZIR' : '⏳ BEKLİYOR')) + '</div>' +
        kickBtn +
        '</div>';
    };

    // Online motoru henüz olmayan oyunlarda "başlatılıyor" yerine dürüst
    // bir bekleme mesajı göster (masada otur/kalk/hazırım çalışmaya devam
    // eder; motor eklendiğinde oyun otomatik başlar).
    const engineReady = ['chess', 'tavla', 'okey', 'okey101'].includes(_ag);
    const status = watching
      ? (full ? '👁️ İzleyici olarak bekliyorsunuz. Oyun başlayınca masayı göreceksiniz.' : '👁️ İzleyici olarak bekliyorsunuz.')
      : allReady ? (engineReady ? '🚀 Oyun başlatılıyor...' : '⏳ Tüm oyuncular hazır — online oyun bu masada aktif edildiğinde başlayacak.') : full
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
      '<div class="players"><div class="gv-felt">' + esc(gameLabel()) +
        '<small>' + seats + ' kişilik masa</small></div>' + seatCells + '</div>' +
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

  // Oyun istemcisi index.html'ye eklenmemiş/eski cache'te kalmış olsa bile
  // gameStarted anında doğru adaptörü yükle. Önceki sürümde desteklenmeyen
  // oyunlarda bekleme overlay'i kapanıyor fakat hiçbir çizici bağlanmıyordu.
  // Ortak yaşam döngüsü katmanı (adaptörler buna kayıt olur). Eski/önbellekli
  // index.html'lerde statik etiket olmayabilir — burada garantiye alınır.
  function ensureArena(cb) {
    if (window.GVArena || document.querySelector('script[data-gv-arena]')) return cb();
    const tag = document.createElement('script');
    tag.src = 'js/online-arena.js?v=20260904b';
    tag.async = false;
    tag.dataset.gvArena = '1';
    tag.onload = cb; tag.onerror = cb;
    document.head.appendChild(tag);
  }

  function ensureOnlineAdapter(payload, done) {
    const game = activeGame();
    const files = { dama:'dama-online.js', turkdamasi:'turkdamasi-online.js', reversi:'reversi-online.js', gomoku:'gomoku-online.js', connect4:'connect4-online.js', bilardo:'bilardo-online.js' };
    const file = files[game];
    if (!file) return done();
    const flag = '__gv' + game.charAt(0).toUpperCase() + game.slice(1) + 'OnlineLoaded';
    if (window[flag]) return done();
    const existing = document.querySelector('script[data-gv-online-adapter="' + game + '"]');
    if (existing) { existing.addEventListener('load', done, { once:true }); existing.addEventListener('error', done, { once:true }); return; }
    ensureArena(function () {
      const tag = document.createElement('script');
      tag.src = 'js/' + file + '?v=20260904b';
      tag.async = false; tag.dataset.gvOnlineAdapter = game;
      tag.onload = done; tag.onerror = done;
      document.head.appendChild(tag);
    });
  }

  function loadChess() {
    if (!isChess()) return;
    // Oyun istemcileri statik olarak index.html'de yüklenir; gameStarted
    // olayı ilgili online adaptöre dağıtılır.
    if (!['chess', 'tavla', 'okey', 'okey101'].includes(activeGame())) return;
    // Okey odası (klasik VEYA 101): okey istemcisini devreye al (statik
    // yüklüyse sadece boot et). Varyant sunucu durumundan gelir.
    if (activeGame() === 'okey' || activeGame() === 'okey101') {
      if (window.__gvOkeyGameStarted && window.__gvOkeyOnlineLoaded) return;
      window.__gvOkeyGameStarted = true;
      window.__gvOkeyOnlineRequested = true;
      if (window.__gvOkeyOnlineLoaded) {
        window.dispatchEvent(new CustomEvent('gv:roomGameStarted', { detail: { roomId } }));
        return;
      }
      if (document.querySelector('script[data-gv-okey-online]')) return;
      const os = document.createElement('script');
      os.src = 'js/okey-online.js?v=20260825a';
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

      // Soket bağlandığında join() çağrılmadan ÖNCE authHello gönder — üye
      // ise socket.userId hemen yazılır, yoksa oluşacak yarış durumunu
      // ("Özel masa kurmak için üye girişi gerekli" yanlışlığı) önler.
      // Misafirlerde token yok, auth.js zaten boş geçer.
      socket.on('connect', () => {
        try { if (window.GVAuth && typeof GVAuth.authHello === 'function' && window.GVAuth.token && window.GVAuth.token()) {
          window.GVAuth.authHello(socket);
        } } catch (_) {}
        join();
      });
      socket.on('roomUpdated', r => {
        if (!r || String(r.id) !== roomId || !isChess()) return;
        syncCurGameToRoom(r); // masanın gerçek oyunu istemci bağlamıyla eşitlensin
        room = r;
        window.__gvActiveRoom = r;
        const mePlayer = (r.players || []).find(isMe);
        window.__gvIsSpectator = !mePlayer && !!(r.spectators || []).find(isMe);
        if (started) return;
        // roomUpdated yalnızca oda özetidir; status=playing paketi tek
        // başına tahtayı açmamalı. Aksi halde eski/stale bir oda özeti,
        // bütün oyuncular HAZIRIM demeden boş yerel tahta gösterebiliyordu.
        // Gerçek geçiş yalnızca sunucunun gameStarted paketiyle yapılır.
        render();
      });

      socket.on('joinedRoom', p => {
        if (!p || String(p.roomId) !== roomId || !isChess()) return;
        window.__gvRoomJoined = true; // oda kaydı sunucuda oturdu — HAZIRIM güvenle gönderilebilir
        window.__gvIsSpectator = p.role === 'spectator' || !!p.isSpectator;
        if (p.room) {
          syncCurGameToRoom(p.room); // masanın oyunu = masanın oyunu (başlık/modül)
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
        // roomUpdated, gameStarted'dan önce geldiğinde `started` zaten true
        // olabilir. Adaptörü önce yükle; sonra olay yayınla ki Yöncü'de
        // eksik/eski index.html olsa bile tahta boş kalmasın.
        ensureOnlineAdapter(p, () => window.dispatchEvent(new CustomEvent('gv:roomGameStarted', { detail: p })));
        if (started) return;
        started = true;
        hide();
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
        try { console.warn('[GV-DBG] joinDenied geldi:', p); } catch (_) {}
        if (retryAfterAuthDeny(p)) return; // authHello yarışı — sessizce yeniden dene
        showBlockOverlay(p.reason || 'Bu masaya girilmedi.');
      });
      // Sonradan ODAKİ oyuncunun jetonunun KESİN geçersiz olduğunun anlaşıldığı
      // durum (sunucu arka planda doğruladı): retry YOK — jeton geçersiz,
      // kullanıcı yeniden giriş yapmalı.
      socket.on('joinFailed', p => {
        if (!p || String(p.roomId) !== roomId || !isChess()) return;
        try { console.warn('[GV-DBG] joinFailed geldi:', p); } catch (_) {}
        showBlockOverlay(p.reason || 'Bu masaya girilmedi.');
      });
      // Arka plan doğrulama HÂLÂ cevap vermedi (PHP soğuk başlangıcı) —
      // oyuncu odada KALIR, sadece uyarı verilir; PHP cevap verince
      // yetkiler otomatik aktifleşir (authHello/sinkronizasyon). Kesin
      // GEÇERSİZ token'da sunucu 'joinFailed' gönderir ve oyuncuyu
      // masadan alır (yukarıdaki joinFailed handler'ı).
      socket.on('authPending', p => {
        if (!p) return;
        try { window.GV && GV.toast && GV.toast('⚠️ ' + (p.reason || 'Üyelik henüz doğrulanamadı. Sayfa yenilenirse normalleşir.'), 'warning', 6000); } catch (_) {}
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

  // Kimlik hazır mı? Üye ise ve auth.js henüz yüklenmediyse (window.GVAuth
  // undefined olabilir), üye token'ını taşıyamayız. Bu fonksiyon:
  //  - auth.js yüklenene kadar kısa süre bekler,
  //  - authHello'yu gönderir (sunucu tarafında socket.userId yazılır),
  //  - memberToken'ın dolu olduğundan emin olur.
  // PHP soğuk başlangıcı 10 sn'ye kadar sürebilir, ama sunucu tarafında
  // yaptığımız politika: özel odaya girişte memberToken varsa 800 ms'lik
  // kısa bekleme sonrası userId hâlâ yoksa bile oyuncuyu kabul edip
  // arka planda userId çözüyor. Bu yüzden istemci burada 600 ms bekler;
  // çoğu istek bu kadar sürede çözülür, geri kalanlar sunucu tarafında
  // arka planda çözülüp oyuncu zaten odada olduğu için userId atanır.
  function ensureAuthedForPrivate() {
    return new Promise(resolve => {
      const tok = (window.GVAuth && typeof GVAuth.token === 'function') ? (GVAuth.token() || '') : '';
      const s = state();
      const isMember = s && !s.isGuest && s.user && s.user.id;
      if (!isMember || !tok) return resolve(true); // misafir: sunucu zaten reddeder
      // Zaten authReady geldiyse bekleme
      if (socket && socket.userId) return resolve(true);
      let settled = false;
      const onReady = (p) => {
        if (settled) return;
        settled = true;
        try { socket.off('authReady', onReady); } catch (_) {}
        resolve(true);
      };
      try {
        socket.on('authReady', onReady);
        socket.emit('authHello', { token: tok });
      } catch (_) { return resolve(false); }
      // 600 ms'lik kısa bekleme: çoğu PHP cevabı bu kadar sürede gelir.
      // Gelen cevapla çoğu kullanıcı bekleme odasını sorunsuz açar;
      // gelmezse yine de join'i gönder — sunucu memberToken yedeğiyle
      // arka planda çözecek (joinDenied'a düşmek yerine).
      setTimeout(() => {
        if (settled) return;
        settled = true;
        try { socket.off('authReady', onReady); } catch (_) {}
        resolve(false);
      }, 600);
    });
  }

  async function join() {
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

    // memberToken burada bir kez hesaplanır (auth.js yüklendikten sonra
    // doğru döner; yarış durumunda boş olabilir ama sunucu tarafı yine
    // doğrulamayı dener).
    const memberToken = (window.GVAuth && typeof GVAuth.token === 'function' && window.GVAuth.token())
      ? String(window.GVAuth.token())
      : undefined;

    // DEBUG: Bu log'lar özel oda kurma sorununu teşhis için. Kullanıcı F12
    // konsolundan bunları görebilir; auth yarışı sırasında sunucudan gelen
    // cevapları takip edebiliriz.
    try {
      const s = state();
      console.log('[GV-DBG] join() başladı', {
        roomId, isPrivate: !!(room && room.isPrivate),
        hasMemberToken: !!memberToken, tokenLen: memberToken ? memberToken.length : 0,
        hasGVAuth: !!window.GVAuth,
        isGuest: !!(s && s.isGuest), userId: s && s.user && s.user.id
      });
    } catch (_) {}

    // ÖZEL ODA yarış durumu: kullanıcı üye ama socket.userId henüz yazılmamış
    // olabilir. authHello gönder, 2 sn authReady bekle, sonra join() gönder.
    if (room && room.isPrivate) {
      await ensureAuthedForPrivate();
    }
    // asSpectator: yalnızca kullanıcı GERÇEKTEN izleme moduna geçtiyse
    // (örn. dolu masada "İzle" butonuna bastığında) true olmalı. Sayfa
    // yenilenmesi veya socket yeniden bağlanması sırasında __gvIsSpectator
    // stale true olabilir, bu da oyuncunun yanlışlıkla izleyici olarak
    // girmesine neden olur. Burada oda henüz kurulmadıysa veya oyuncu
    // listesinde ben yoksa bile asla spectator olma.
    const wasSpectator = !!window.__gvJoinAsSpectator;
    socket.emit('joinRoom', {
      memberToken, // her durumda doğru token (undefined olabilir ama auth.js yüklüyse dolu)
      memberAttestation: (window.GVAuth && typeof GVAuth.attestation === 'function' ? (GVAuth.attestation() || undefined) : undefined),
      roomId,
      userName: userName(),
      userKey: userKey(),
      maxPlayers: maxSeats(), // okey 2/3/4, satranç/tavla 2 (kalıcı masalarda sunucu kendi değerini korur)
      durationMinutes: Number(room?.duration || room?.durationMinutes || 10),
      gameId: activeGame(), // 'chess' | 'tavla' | 'okey' | 'okey101'
      rounds: rCfg > 0 ? rCfg : undefined,
      roomName: room?.name,
      isPrivate: !!room?.isPrivate,
      // Kullanıcı açıkça "İzle" diyerek bu bayrağı koyduysa veya zaten izleyici
      // olarak odada kayıtlıysa spectator olarak devam et; aksi halde oyuncu.
      asSpectator: wasSpectator,
      viaInvite
    });
  }

  // Özel masa kilidi "code:'auth'" ile reddederse: büyük olasılıkla authHello
  // yarışı (soket açıldı ama üye kimliği henüz PHP/SQLite'tan dönmedi). Üyeyse
  // kısa aralıklarla birkaç kez yeniden dene; misafirse / hak etmişse reddetme.
  // PHP soğuk başlangıcı 18 sn sürebilir; 25 × 900 ms = 22.5 sn retry
  // penceresi PHP'nin cevap vermesini karşılar.
  let authRetry = 0;
  function retryAfterAuthDeny(p) {
    if (!p || p.code !== 'auth') return false;
    const s = state();
    const isMember = s && !s.isGuest && s.user && s.user.id;
    if (!isMember || authRetry >= 25) return false; // ~22.5 sn: PHP soğuk başlangıcını tam karşılar
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
    var leftRoomId = roomId || window.__gvActiveRoomId || null;
    window.__gvChessOnlineRequested = false;
    try {
      if (socket && socket.connected) {
        // ÖNCE haber ver, SONRA kapat. Aynı anda yapıldığında 'leaveRoom'
        // paketi çıkmadan bağlantı kapanıyordu: sunucu yalnızca kopmayı
        // görüyor, oyunu bitirmek yerine 30 sn'lik yeniden bağlanma
        // süresi başlatıyordu. Rakip bu sürede donmuş tahtayla bekliyordu.
        var sk = socket;
        try { sk.emit('leaveRoom'); } catch (_) {}
        setTimeout(function () { try { sk.disconnect(); } catch (_) {} }, 250);
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

    // KART / DAMA / REVERSİ / GOMOKU / CONNECT4 / BİLARDO adaptörleri:
    // hepsi ortak yaşam döngüsüne (js/online-arena.js) kayıtlıdır. Kayıtlı
    // sıfırlayıcıları çağır + olayı yay. Eskiden bu adaptörlerin HİÇBİR
    // sıfırlama kancası yoktu; kart istemcisinin 500 ms'lik zamanlayıcısı
    // odadan çıkıldıktan sonra da #boardArea'yı ezmeye devam ediyor,
    // kullanıcı Okey'e geçtiğinde Pişti masası arka planda çiziliyordu.
    (window.__gvOnlineResets || []).forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[Oda] online sıfırlama', e); }
    });
    try {
      window.dispatchEvent(new CustomEvent('gv:roomLeft', { detail: { roomId: leftRoomId } }));
    } catch (_) {}

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
    // Oda nesnesi gameId taşıyorsa (lobi/davet) istemci bağlamını ona çek —
    // bu sayede isChess()/aktif oyun kararı masanın OYUNUNA göre yapılır.
    syncCurGameToRoom(r);
    if (!isChess()) return;
    roomId = String(r?.id || roomIdNow() || '');
    room = r || { id: roomId, name: gameLabel() + ' Masası #' + roomId, maxPlayers: maxSeats(), duration: 10, players: [], status: 'waiting' };
    started = false;
    window.__gvActiveRoomId = roomId;
    window.__gvActiveRoom = room;
    const ag = activeGame();
    if (ag === 'tavla') window.__gvTavlaOnlineRequested = true;
    else if (ag === 'okey' || ag === 'okey101') window.__gvOkeyOnlineRequested = true;
    else if (ag === 'chess') window.__gvChessOnlineRequested = true;
    else window.__gvOnlineRequested = true; // damalar/reversi/gomoku/connect4/bilardo
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
      window.__gvOnlineRequested = false;
      hide(); // Ensure real-room overlay is completely hidden on other games like Pişti, 101!
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
