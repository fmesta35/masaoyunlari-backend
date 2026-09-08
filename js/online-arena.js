/* GameVerse — ONLINE OYUN ADAPTÖRLERİ İÇİN ORTAK YAŞAM DÖNGÜSÜ
 *
 *  GİDERİLEN HATA (kullanıcı raporu): "Pişti'den çıkıp Okey'e geçtiğimde Pişti
 *  hâlâ arka planda çalışıyor." Sebebi tek değil, YEDİ ayrı adaptörde aynı
 *  kalıptan geliyordu:
 *
 *   1) Kart istemcisi 500 ms'de bir çalışan bir setInterval ile #boardArea'yı
 *      koşulsuz yeniden yazıyordu; oda değişse de `state` hiç temizlenmediği
 *      için Okey masasının üstüne Pişti masasını basmaya devam ediyordu.
 *   2) Adaptörler PAYLAŞILAN sokete (window.__gvRoomSocket) dinleyici ekliyor
 *      ama ASLA kaldırmıyordu; her odaya girişte dinleyiciler üst üste binerdi.
 *   3) Adaptörler açılışta yakaladıkları roomId'yi tutup eski odaya hamle
 *      göndermeye devam edebiliyordu.
 *   4) `gv:roomGameStarted` dinleyicileri `e` parametresini ALMADAN `e.detail`
 *      okuyordu → ReferenceError; altı adaptör bu olayla hiç açılmıyordu.
 *   5) Adaptörler odaya HER SEFERİNDE rastgele bir misafir anahtarıyla yeniden
 *      katılıyordu (bekleme odası zaten katılmışken) → sunucuda ikinci kimlik.
 *   6) Kart masası her 500 ms'de yeniden çizildiği için tam o ana denk gelen
 *      tıklama öksüz düğüme gidiyor, hamle sunucuya ulaşmıyordu.
 *
 *  Bu katman adaptörlerin ortak işini tek yerde toplar: soket dinleyicilerini
 *  BİR KEZ bağlar, oda kimliğini sürekli doğrular, oda değişince/çıkışta her
 *  şeyi söker ve saat gibi ucuz güncellemeleri innerHTML'i yeniden yazmadan
 *  yapar. Adaptörler yalnız kendi çizimlerini ve tıklamalarını tanımlar.
 */
(function () {
  'use strict';
  if (window.GVArena) return;

  var defs = [];        // tanımlı adaptörler
  var active = null;    // tahtayı o an çizen adaptör örneği
  var bound = null;     // dinleyicilerin bağlı olduğu soket
  var handlers = null;  // {ev: fn} — sökmek için saklanır
  var tickTimer = null;

  function S() { try { return (typeof st !== 'undefined') ? st : null; } catch (_) { return null; } }
  function socketNow() { return window.__gvRoomSocket || window.__gvChessSocket || null; }

  function roomNow() {
    var s = S();
    var cand = [
      window.__gvActiveRoomId,
      window.__gvActiveRoom && window.__gvActiveRoom.id,
      s && s.roomWaitingState && s.roomWaitingState.room && s.roomWaitingState.room.id
    ];
    for (var i = 0; i < cand.length; i++) {
      if (cand[i] !== null && cand[i] !== undefined && String(cand[i]) !== '') return String(cand[i]);
    }
    // localStorage SON çare: oda terk edilince silinir, ama bazı akışlarda
    // geç silinebiliyor — bu yüzden yukarıdaki canlı kaynaklar önceliklidir.
    try { return String(localStorage.getItem('gv-room-id') || ''); } catch (_) { return ''; }
  }

  function boardEl() { return document.getElementById('boardArea'); }

  function findDef(kind) {
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].kinds.indexOf(kind) !== -1) return defs[i];
    }
    return null;
  }

  /* Tahtayı yalnız BU katmanın bastığı içerik varsa temizle — okey/satranç/
     tavla istemcilerinin çizdiği masaya asla dokunma. */
  function clearBoard() {
    var a = boardEl();
    if (a && a.__gvArenaOwner) {
      a.innerHTML = '';
      a.__gvArenaOwner = null;
      a.__gvArenaHtml = null;
      a.__gvArenaNode = null;
    }
  }

  function paint(force) {
    if (!active || !active.state) return;
    // Oda değiştiyse (başka masaya geçildi ya da çıkıldı) ÇİZME ve bırak.
    if (String(active.roomId) !== roomNow()) { stop(); return; }
    var a = boardEl();
    if (!a) return;
    var html = active.def.render(active);
    if (force || a.__gvArenaHtml !== html || a.__gvArenaOwner !== active.def.id) {
      a.innerHTML = html;
      a.__gvArenaHtml = html;
      a.__gvArenaOwner = active.def.id;
      // Sahiplik KANITI: yazdığımız düğümü sakla. Başka bir istemci
      // (okey/satranç/tavla) #boardArea'yı yeniden yazarsa bu düğüm DOM'dan
      // düşer ve bu katman kendini susturur — masaların üst üste binmesi
      // teknik olarak imkânsız hale gelir.
      a.__gvArenaNode = a.firstElementChild;
      if (active.def.bind) { try { active.def.bind(a, active); } catch (e) { console.error('[Arena] bind', e); } }
    }
    updateClock();
  }

  /* Saat metni innerHTML yeniden yazılmadan güncellenir: 500 ms'de bir tüm
     masayı basmak, tam o ana denk gelen tıklamayı öldürüyordu. */
  function updateClock() {
    if (!active || !active.state) return;
    var a = boardEl();
    if (!a || a.__gvArenaOwner !== active.def.id) return;
    var el = a.querySelector('.gv-arena-clock');
    if (!el) return;
    var sec = Math.max(0, Math.ceil((Number(active.state.turnRemainingMs) || 0) / 1000));
    var txt = sec + ' sn';
    if (el.textContent !== txt) el.textContent = txt;
  }

  /* ÜSTTEKİ SÜRE ŞERİDİ (#topTimers)
     Bu oyunlarda ANA saat yoktur — sunucu yalnız hamle süresini işletir.
     Şerit bu yüzden donmuş bir "10:00" gösteriyordu ve sıranın kimde
     olduğu yalnız tahtanın üstündeki yazıdan anlaşılıyordu. Artık şerit
     sıra bilgisini taşır: sırası gelen kart vurgulanır ve hamle geri
     sayımı DOĞRUDAN o kartın içinde işler (js/move-clock.js). */
  function seatCountOf(gs) {
    if (gs && Array.isArray(gs.handCounts) && gs.handCounts.length) return gs.handCounts.length;
    return 2;
  }
  function setName(card, txt) {
    var el = card && card.querySelector('.timer-name');
    if (el && el.textContent !== txt) el.textContent = txt;
  }
  function syncStrip() {
    if (!window.GVMoveClock) return;
    var gs = active && active.state;
    var strip = document.getElementById('topTimers');
    if (!gs || !strip) { if (window.GVMoveClock) GVMoveClock.clear(); return; }
    var cards = strip.querySelectorAll('.timer');
    if (cards.length < 2) return;

    var n = seatCountOf(gs);
    var me = (typeof active.seat === 'number') ? active.seat : null;
    var turn = (typeof gs.turnSeat === 'number') ? gs.turnSeat
             : (typeof gs.turn === 'number') ? gs.turn : null;
    var idx = 0;

    if (active.isSpectator || me === null) {
      if (n <= 2) {
        setName(cards[0], '🔵 Koltuk 1'); setName(cards[1], '🔴 Koltuk 2');
        idx = (turn === 1) ? 1 : 0;
      } else {
        setName(cards[0], '👁️ Sıradaki koltuk'); setName(cards[1], '⏳ Diğer koltuklar');
        idx = 0;
      }
    } else if (n <= 2) {
      setName(cards[0], '🔵 Siz'); setName(cards[1], '🔴 Rakip');
      idx = (turn === me) ? 0 : 1;
    } else {
      setName(cards[0], '🔵 Siz'); setName(cards[1], '🔴 Rakipler');
      idx = (turn === me) ? 0 : 1;
    }

    var kalan = gs.turnRemainingMs;
    if (gs.status === 'playing' && typeof kalan === 'number' && kalan >= 0) {
      GVMoveClock.set({
        activeIndex: idx,
        remainingMs: kalan,
        limitMs: gs.turnLimitMs,
        serverNow: gs.serverNow,
        mainClock: false          // bu oyunlarda ana saat yok: sayaç BÜYÜK gösterilir
      });
    } else {
      GVMoveClock.clear();
    }
  }

  function onState(p) {
    if (!p || !p.gameState) return;
    var kind = p.gameState.kind;
    var def = findDef(kind);
    if (!def) return;                                   // okey/satranç/tavla kendi istemcisinde
    var rid = String(p.roomId == null ? '' : p.roomId);
    var cur = roomNow();
    if (!cur || rid !== cur) return;                    // BAŞKA/ESKİ odanın paketi — yoksay
    if (!active || active.def.id !== def.id) {
      active = { def: def, state: null, seat: null, roomId: rid, emit: emitFor(def) };
    }
    active.state = p.gameState;
    active.roomId = rid;
    if (p.seat !== undefined && p.seat !== null) active.seat = p.seat;
    active.isSpectator = !!p.isSpectator;
    paint(false);
    syncStrip();
  }

  function emitFor(def) {
    return function (ev, data) {
      var s = socketNow();
      if (!s || !s.connected) {
        if (window.GV && GV.toast) GV.toast('🔌 Sunucu bağlantısı yok — hamle gönderilemedi.', 'error');
        return;
      }
      var rid = roomNow();
      if (!rid || (active && String(active.roomId) !== rid)) return;   // eski odaya hamle GÖNDERME
      s.emit(ev, Object.assign({ roomId: rid }, data || {}));
    };
  }

  function onReject(p) {
    var reason = (p && p.reason) || 'bilinmiyor';
    if (window.GV && GV.toast) GV.toast('Hamle reddedildi: ' + reason, 'warning');
  }

  function attach() {
    var s = socketNow();
    if (s === bound) return;
    detach();
    if (!s) return;
    handlers = { gameStarted: onState, gameStateUpdated: onState };
    defs.forEach(function (d) {
      (d.reject || []).forEach(function (ev) { handlers[ev] = onReject; });
    });
    Object.keys(handlers).forEach(function (ev) { s.on(ev, handlers[ev]); });
    bound = s;
  }

  function detach() {
    if (bound && handlers) {
      Object.keys(handlers).forEach(function (ev) {
        try { bound.off(ev, handlers[ev]); } catch (_) {}
      });
    }
    bound = null;
    handlers = null;
  }

  /* Adaptörü durdur: çizim yok, durum yok, tahta bu katmana aitse temizlenir. */
  function stop() {
    active = null;
    clearBoard();
    try { if (window.GVMoveClock) GVMoveClock.clear(); } catch (_) {}
  }

  /* Odadan çıkış / masa değişimi: her şeyi söker. */
  function reset() {
    stop();
    detach();
  }

  function tick() {
    attach();                       // soket değiştiyse yeniden bağlan
    if (!active) return;
    if (String(active.roomId) !== roomNow()) { stop(); return; }
    var a = boardEl();
    if (!a) return;
    // Masa başka bir istemci (okey/satranç/tavla) tarafından ele geçirildiyse
    // bu adaptör susar — üstüne yazmaz.
    if (a.__gvArenaOwner !== active.def.id) { active = null; return; }
    if (a.__gvArenaNode && !a.contains(a.__gvArenaNode)) {   // masa el değiştirdi
      a.__gvArenaOwner = null; a.__gvArenaHtml = null; a.__gvArenaNode = null;
      active = null;
      return;
    }
    if (active.state && Number(active.state.turnRemainingMs) > 0) {
      active.state.turnRemainingMs = Math.max(0, Number(active.state.turnRemainingMs) - 500);
    }
    updateClock();   // tahta içindeki küçük saat (kart masası)
    // Kart içindeki büyük geri sayımı GVMoveClock kendi 250 ms'lik
    // döngüsünde sayar; burada yalnız vurgu/isim tazelenir.
  }

  window.GVArena = {
    define: function (def) {
      if (!def || !def.id || !Array.isArray(def.kinds) || typeof def.render !== 'function') return;
      if (defs.some(function (d) { return d.id === def.id; })) return;
      defs.push(def);
      detach();                     // yeni reject olayları için yeniden bağla
      attach();
    },
    reset: reset,
    stop: stop,
    roomId: roomNow,
    activeId: function () { return active ? active.def.id : null; },
    /* Teşhis/test: tahtayı çizen adaptörün son sunucu durumu */
    state: function () { return active ? active.state : null; },
    seat: function () { return active ? active.seat : null; },
    /* Test/teşhis: dışarıdan durum enjekte etmek için */
    _onState: onState
  };

  // Adaptör dosyası arena'dan ÖNCE yüklenmiş olabilir (dinamik yükleme,
  // eski index.html, farklı önbellek): kuyrukta bekleyen tanımları al.
  var queued = window.__gvArenaQueue || [];
  window.__gvArenaQueue = { push: function (d) { window.GVArena.define(d); } };
  queued.forEach(function (d) { window.GVArena.define(d); });

  // Oda terk edildiğinde bekleme odası köprüsü burayı çağırır (ve olay yayar).
  window.__gvOnlineResets = window.__gvOnlineResets || [];
  window.__gvOnlineResets.push(reset);
  window.addEventListener('gv:roomLeft', reset);
  window.addEventListener('gv:roomGameStarted', attach);
  window.addEventListener('gv:roomReady', attach);

  tickTimer = setInterval(tick, 500);
  attach();
})();
