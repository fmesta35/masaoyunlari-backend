/* GameVerse - Authoritative Online Okey Client (4 gerçek oyuncu)
 * Backend SUNUCUDA yetkilidir (dağıtım, çekme, atma, bitiş doğrulaması,
 * SIRA sayacı, ana süreler, skorlar). Bu modül sunucu durumunu yerel okey
 * görünümüyle BİREBİR aynı işaretleme/CSS (.okey-table, .ok-tile...) üzerinden
 * boyar; GV._ok* tıklamalarını (online odadayken) sunucuya yönlendirir.
 * Satranç/tavla istemcilerinden BAĞIMSIZDIR.
 */
(function () {
  'use strict';
  if (window.__gvOkeyOnlineLoaded) return;
  window.__gvOkeyOnlineLoaded = true;

  const BACKEND = window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com';
  const SLOT_COUNT = 15;
  const COLOR_DOT = { 't-red': '🔴', 't-black': '⚫', 't-blue': '🔵', 't-yellow': '🟡' };

  let socket = null;
  let roomId = null;
  let mySeat = null;          // 0..3 veya null (izleyici)
  let gameState = null;       // sunucudan gelen yetkili durum (kind:'okey')
  let active = false;
  let clockInt = null;
  let isSpectator = !!window.__gvIsSpectator;
  let fallbackTimer = null;
  let autoReturnTimer = null;
  let endYouWon = null;
  let roundInfo = null;       // el sonu ara ekranı {round,title,desc}
  let prevSnap = null;        // 📝 Hamleler farkı için
  let prevStrikes = 0;        // otomatik oynama uyarısı için
  let turnWarnKey = null;     // SIRA son-an uyarısı tur başına bir kez
  let endOverlayFor = null;   // aynı maç için ikinci overlay açılmasın

  // Istaka DÜZENİ istemciye aittir (sunucu sıralamayı umursamaz): 2 raf × 15
  // slot taş kimlikleri. Sırala/sürükle-bırak yalnız bu düzeni değiştirir.
  let rackIds = { 0: new Array(SLOT_COUNT).fill(null), 1: new Array(SLOT_COUNT).fill(null) };

  function getState() {
    try { return typeof st !== 'undefined' ? st : null; } catch (_) { return null; }
  }

  // DOM'a YALNIZCA değişiklik varsa yaz (titreşim önlemi — tavla ile aynı kural).
  function setText(el, txt) {
    if (el && el.textContent !== txt) el.textContent = txt;
  }

  // Online oyun: yerel (bot) zamanlayıcılarının #t1/#t2'ye yazması mühürlenir.
  function claimClockOwnership() {
    const s = getState();
    if (s) s.onlineClock = true;
  }
  function releaseClockOwnership() {
    const s = getState();
    if (s) s.onlineClock = false;
  }

  function isOkeyRoom() {
    const s = getState();
    let g = s?.curGame || window.__gvCurrentGame || window.currentGame || '';
    if (g === null || g === undefined || g === 'null' || g === 'undefined') g = '';
    g = String(g).toLowerCase().trim();
    if (g === 'okey') return true;
    if (g) return false;
    const title = document.getElementById('grTitle')?.textContent || '';
    return /okey/i.test(title) && !/101/.test(title);
  }

  function getRoomId() {
    const s = getState();
    const values = [roomId, window.__gvActiveRoomId, window.__gvActiveRoom?.id, window.currentRoomId, window.roomId, s?.roomWaitingState?.room?.id, localStorage.getItem('gv-room-id'), new URLSearchParams(location.search).get('roomId'), new URLSearchParams(location.search).get('room')];
    return values.find(v => v !== undefined && v !== null && String(v) !== '')?.toString() || null;
  }

  function getUserName() {
    const s = getState();
    return s?.user?.name || s?.user?.username || localStorage.getItem('gv-user-name') || 'Oyuncu';
  }

  // Sekme/pencere bazlı parça: room-waiting-fix.js ile AYNI mantık. Aynı
  // profildeki farklı pencereler ayrı koltuk alır (4 gerçek oyuncu); F5
  // aynı sekmede kaldığı için (sessionStorage) reconnect eşleşmesi korunur.
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
      if (!window.__gvTabId) window.__gvTabId = Math.random().toString(36).slice(2, 10);
      return window.__gvTabId;
    }
  }

  function userKey() {
    const s = getState();
    const u = s?.user;
    const stable = u && (u.id || u.userId || u.username || u.email);
    if (stable) return 'user:' + String(stable);
    let id = localStorage.getItem('gv-chess-guest-id') || localStorage.getItem('gv-room-guest-key');
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'guest-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    }
    localStorage.setItem('gv-chess-guest-id', id);
    return 'guest:' + id + ':' + tabKey();
  }

  function clearDuplicateToasts() {
    const wrap = document.getElementById('toastWrap');
    if (wrap) wrap.innerHTML = '';
  }

  function toast(message, type) {
    clearDuplicateToasts();
    if (window.GV && typeof window.GV.toast === 'function') {
      try { window.GV.toast(message, type || 'info'); return; } catch (_) {}
    }
    console.log(`[Okey] (${type}): ${message}`);
  }

  function esc(v) {
    return String(v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function fmt(ms) {
    const sec = Math.ceil(Math.max(0, Number(ms) || 0) / 1000);
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }

  function injectStyle() {
    if (document.getElementById('gv-okey-online-style')) return;
    const style = document.createElement('style');
    style.id = 'gv-okey-online-style';
    style.textContent = `
      .ok-pclock{color:#f9ca24;font-size:.62em;font-weight:800;font-variant-numeric:tabular-nums;white-space:nowrap}
      .ok-spec-lock{pointer-events:none!important;opacity:.45!important;filter:grayscale(.4)}
      .ok-turn-timer.urgent{color:#ff6b81!important;border-color:#ff6b81!important;animation:gvOkeyDanger .5s infinite alternate}
      @keyframes gvOkeyDanger{from{box-shadow:0 0 0 rgba(255,71,87,0)}to{box-shadow:0 0 14px rgba(255,71,87,.65)}}
      .chess-end-overlay{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(6,7,20,0.88);backdrop-filter:blur(12px)}
      .chess-end-modal{background:#111128;border:1px solid rgba(255,255,255,0.15);padding:28px;border-radius:18px;text-align:center;color:#fff;box-shadow:0 20px 60px rgba(0,0,0,0.7);max-width:430px;width:92%}
      .chess-end-modal h2{margin:12px 0 8px;font-size:1.5rem;color:#f9ca24}
      .chess-end-modal p{color:#aaa;margin-bottom:14px;font-size:.98rem;line-height:1.5}
      .end-icon{font-size:3rem}
    `;
    document.head.appendChild(style);
  }

  // ---------- Koltuk ↔ görünüm konumu (0=Sen, 1=Sol, 2=Karşı, 3=Sağ) ----------
  // Sunucu sırası koltuk sıralamasını izler (0→1→2→…). Bana GÖRE önceki oyuncu
  // (atığını alabileceğim) SOLDA, sonraki SAĞDA gösterilir — yerel masa
  // düzeniyle ve gerçek okey (saat yönünün tersi) akışıyla aynı.
  // Masa 2/3/4 kişilik olabilir:
  //   4 kişi → Sol+Karşı+Sağ (klasik düzen)
  //   3 kişi → Sol (önceki) + Sağ (sonraki); Karşı boş kalır
  //   2 kişi → rakip Karşı'da (Sol/Sağ boş)
  function seatMapping() {
    const seats = (gameState && gameState.seats && gameState.seats.length) ? gameState.seats.slice() : [0, 1, 2, 3];
    const N = seats.length;
    const anchor = (mySeat !== null && seats.includes(mySeat)) ? mySeat : seats[0];
    const idx = seats.indexOf(anchor);
    // Tur-ofseti → görünüm pozisyonu: ofset 0 = ben; 1 = sıradaki oyuncu
    // (sağım), N-1 = önceki oyuncu (solum — atığından çekebildiğim).
    const POS_BY_OFFSET = N === 2 ? [0, 2] : N === 3 ? [0, 3, 1] : [0, 3, 2, 1];
    return {
      seats, anchor, N,
      seatAt(pos) {
        if (pos === 0) return anchor;
        const off = POS_BY_OFFSET.indexOf(pos);
        if (off <= 0) return null;
        return seats[(idx + off) % N];
      },
      posOf(seat) {
        if (seat === anchor) return 0;
        const i = seats.indexOf(seat);
        if (i === -1) return -1;
        const off = (i - idx + N) % N;
        return off < POS_BY_OFFSET.length ? POS_BY_OFFSET[off] : -1;
      },
      activePositions() { return POS_BY_OFFSET.slice(0, N); },
      // Atığını alabileceğim oyuncu (tur sırasında benden bir önceki).
      prevSeat() { return seats[(idx + N - 1) % N]; },
      nextSeat() { return seats[(idx + 1) % N]; }
    };
  }

  function playerName(seat) {
    const p = (gameState?.players || []).find(x => x.seat === seat);
    return p ? (p.name || 'Oyuncu') : ('Koltuk ' + (seat + 1));
  }

  function mePlaying() {
    return !isSpectator && mySeat !== null && gameState && gameState.status === 'playing' && !gameState.finished;
  }
  function myTurnNow() {
    return mePlaying() && gameState.turn === mySeat;
  }

  // ---------- Istaka senkronu (düzen korunur, yeni taşlar ilk boşluğa) ----------
  function syncRack(hand) {
    const byId = {};
    (hand || []).forEach(t => { byId[t.id] = t; });
    [0, 1].forEach(sh => {
      for (let i = 0; i < SLOT_COUNT; i++) {
        if (rackIds[sh][i] && !byId[rackIds[sh][i]]) rackIds[sh][i] = null;
      }
    });
    const placed = new Set();
    [0, 1].forEach(sh => rackIds[sh].forEach(id => { if (id) placed.add(id); }));
    const fresh = (hand || []).filter(t => !placed.has(t.id));
    let fi = 0;
    [1, 0].forEach(sh => { // yerel dağıtımla aynı: önce üst raf (1)
      for (let i = 0; i < SLOT_COUNT && fi < fresh.length; i++) {
        if (!rackIds[sh][i]) rackIds[sh][i] = fresh[fi++].id;
      }
    });
    const rack = { 0: new Array(SLOT_COUNT).fill(null), 1: new Array(SLOT_COUNT).fill(null) };
    [0, 1].forEach(sh => {
      for (let i = 0; i < SLOT_COUNT; i++) if (rackIds[sh][i]) rack[sh][i] = byId[rackIds[sh][i]];
    });
    return rack;
  }

  function resyncIdsFromBoard() {
    const s = getState();
    const ok = s?.boards?.okey;
    if (!ok || !ok.rack) return;
    [0, 1].forEach(sh => {
      for (let i = 0; i < SLOT_COUNT; i++) rackIds[sh][i] = ok.rack[sh][i] ? ok.rack[sh][i].id : null;
    });
  }

  // ---------- Sunucu durumu → yerel okey görünüm nesnesi ----------
  function buildOk(gs) {
    const map = seatMapping();
    const playing = gs.status === 'playing' && !gs.finished;
    const myTurn = myTurnNow();
    const rack = syncRack(gs.myHand);
    const pCounts = {}, scores = {}, piles = {};
    [0, 1, 2, 3].forEach(pos => {
      const seat = map.seatAt(pos);
      pCounts[pos] = (seat === null || seat === undefined) ? 0 : ((gs.handCounts && gs.handCounts[seat]) || 0);
      scores[pos] = (seat === null || seat === undefined) ? 0 : ((gs.scores && gs.scores[seat]) || 0);
      piles[pos] = (seat !== null && seat !== undefined && gs.discardPiles && gs.discardPiles[seat]) ? gs.discardPiles[seat].slice() : [];
    });
    return {
      pCount: map.N,
      activePositions: map.activePositions(),
      rack,
      deck: { length: gs.deckCount || 0 },     // çizici yalnız .length kullanır
      indicator: gs.indicator,
      realOkey: gs.realOkey,
      pCounts,
      aiHandPool: [],
      turnIndex: map.posOf(gs.turn),
      myTurn,
      phase: myTurn ? gs.phase : 'wait',
      gameEnded: !playing,
      discardPiles: piles,
      turnTime: Math.ceil(Math.max(0, Number(gs.turnRemainingMs) || 0) / 1000),
      strikes: (gs.strikes && mySeat !== null) ? (gs.strikes[mySeat] || 0) : 0,
      maxRounds: gs.maxRounds,
      currentRound: gs.round,
      scores,
      roundWinnerInfo: roundInfo,
      sortMode: (getState()?.boards?.okey?.sortMode) || undefined,
      bots: { 0: false, 1: false, 2: false, 3: false },
      // çevrimiçine özel ek alanlar (yerel çizici görmezden gelir)
      _map: map,
      _gs: gs
    };
  }

  // ---------- Tablo çizimi (yerel dOkey işaretlemesiyle birebir + isim/saat) ----------
  function tileColor(t) { return t.isFJ ? (t.dc || 't-red') : t.c; }

  function drawTable(area, ok) {
    const gs = ok._gs;
    const map = ok._map;
    const POS_LABEL = ['Sen', 'Sol', 'Karşı', 'Sağ'];
    const iC = { 't-red': '#8b0000', 't-black': '#1a1a1a', 't-blue': '#1e3a8a', 't-yellow': '#e67e22' }[ok.indicator?.c] || '#8b0000';

    let h = '<div class="okey-table">';

    if (ok.roundWinnerInfo) {
      h += '<div class="ok-win-overlay"><div class="ok-win-box">' +
        '<div class="ok-win-title">' + ok.roundWinnerInfo.title + '</div>' +
        '<div class="ok-win-desc">' + ok.roundWinnerInfo.desc + '</div>' +
        '<div style="margin-top:15px;font-size:0.8em;color:var(--accent)">Diğer el hazırlanıyor...</div>' +
        '</div></div>';
    }

    h += `<div class="ok-turn-timer${ok.turnTime <= 10 && !ok.gameEnded ? ' urgent' : ''}"><span class="tt-label">SIRA</span><span id="okTimerVal">${ok.turnTime}</span></div>`;

    const sTxt = map.activePositions().map(p => POS_LABEL[p] + ':' + ok.scores[p]).join(' | ');
    h += `<div style="position:absolute;top:8px;left:10px;z-index:9;background:rgba(0,0,0,.7);color:var(--text);padding:4px 10px;border-radius:10px;font-size:.7em;border:1px solid var(--border)">El ${ok.currentRound}/${ok.maxRounds} (${map.N} Kişilik) • <span style="color:var(--gold)">${sTxt}</span></div>`;

    // Rakip panelleri: üst=Karşı(2), sol=Sol(1), sağ=Sağ(3) — yalnızca
    // masadaki GERÇEK koltuklar çizilir (2 kişilikte yalnız Karşı,
    // 3 kişilikte Sol+Sağ).
    [['top', 2, 'c1'], ['left', 1, 'c2'], ['right', 3, 'c3']].forEach(([pos, pIdx, cCls]) => {
      const seat = map.seatAt(pIdx);
      if (seat === null || seat === undefined) return;
      const turnCls = ok.turnIndex === pIdx ? ' turn' : '';
      const nm = POS_LABEL[pIdx] + ' • ' + esc(playerName(seat));
      const clock = `<span class="ok-pclock" data-okey-clock="${seat}">🕐 ${fmt(gs.clockMs ? gs.clockMs[seat] : 0)}</span>`;
      h += `<div class="ok-player ${pos} ${cCls}${turnCls}"><div class="p-ava">👤</div><div><div class="p-name">${nm}</div><div class="p-count">${ok.pCounts[pIdx]} taş • ${clock}</div></div></div>`;
      h += `<div class="ok-opp-rack ${pos}">`;
      for (let i = 0; i < ok.pCounts[pIdx]; i++) h += '<div class="ok-opp-t"></div>';
      h += '</div>';
    });

    // Orta alan: deste + gösterge + ortaya bitir
    h += '<div class="ok-center">';
    h += `<div class="ok-deck" onmousedown="GV._okPointerDown(event, 'deck')" ontouchstart="GV._okPointerDown(event, 'deck')"><span class="ok-deck-cnt">${ok.deck.length}</span><div class="ok-deck-t"></div><div class="ok-deck-t"></div><div class="ok-deck-t"></div></div>`;
    h += `<div class="ok-indicator" style="border:2px solid #b8a878"><span class="ind-label">GÖSTERGE</span><div class="ok-num" style="color:${iC}">${ok.indicator ? ok.indicator.n : '-'}</div><div class="ok-dot" style="background:${iC}"></div></div>`;
    h += '<div class="ok-finish-zone" id="okFinishZone"><span style="font-size:0.75em;font-weight:800;color:#f1c40f;">🏆 ORTAYA BİTİR</span></div>';
    h += '</div>';

    h += '<div class="ok-throw-zone" id="okThrowZone"><span class="ok-throw-label">📤 TAŞ AT</span><span class="ok-throw-empty">Sürükle</span></div>';

    // Atık bölgeleri (aktif görünüm konumları). Önceki oyuncunun (tur
    // sırasında benden bir önce oturanın) en üst atığı TIKLANABİLİR —
    // 2/3/4 kişide bu oyuncunun ekran konumu değişir, tıklama her zaman
    // 'left' (prev) eylemine gider.
    const prevPos = map.posOf(map.prevSeat());
    map.activePositions().forEach(pos => {
      const pile = ok.discardPiles[pos] || [];
      const topTile = pile.length ? pile[pile.length - 1] : null;
      const isPrevZone = pos === prevPos && pos !== 0;
      const canTake = isPrevZone && topTile && ok.myTurn && ok.phase === 'draw';
      const attrs = canTake ? ` onmousedown="GV._okPointerDown(event, 'left')" ontouchstart="GV._okPointerDown(event, 'left')" style="cursor:grab"` : '';
      const lbl = (isPrevZone ? '← ' : '') + POS_LABEL[pos];
      h += `<div class="ok-disc-zone${canTake ? ' active-take' : ''}" data-pos="${pos}"${attrs}><span class="ok-disc-label">${lbl}</span>`;
      if (topTile) {
        const cc = tileColor(topTile);
        h += `<div class="ok-disc-tile ${cc}"><div class="dt-num">${topTile.n}</div><div class="dt-dot"></div></div>`;
      }
      h += '</div>';
    });

    h += `<div class="ok-actions"${isSpectator ? ' style="display:none"' : ''}>
      <button class="ok-act" onclick="GV._okCheck()">✅ Kontrol</button>
      <button class="ok-act" onclick="GV._okSort()">🔄 Sırala</button>
      <button class="ok-act" style="background:linear-gradient(135deg,#e74c3c,#c0392b);border-color:#8b1a1a" onclick="GV._okSurrender()">🏳️ Pes Et</button>
    </div>`;

    const meTurn = ok.turnIndex === 0 ? ' turn' : '';
    const meLabel = isSpectator ? '👁️ İzleyici' : 'Sen • ' + esc(playerName(map.anchor));
    const meClock = (mySeat !== null && gs.clockMs)
      ? `<span class="ok-pclock" data-okey-clock="${map.anchor}">🕐 ${fmt(gs.clockMs[map.anchor])}</span>` : '';
    h += `<div class="ok-me${meTurn}"><div class="ok-me-ava">👤</div><div class="ok-me-name">${meLabel} ${meClock}</div></div>`;

    // Kendi ıstakam (izleyicide boş)
    h += '<div class="ok-rack-wrap"><div class="ok-rack">';
    [1, 0].forEach(sh => {
      h += '<div class="ok-shelf"><div class="ok-shelf-inner">';
      for (let i = 0; i < SLOT_COUNT; i++) {
        const t = ok.rack[sh][i];
        if (t) {
          const cc = tileColor(t);
          const posLeftPct = (i * 100 / 15).toFixed(2);
          h += `<div class="ok-tile ${cc}${t.isOkey ? ' is-okey' : ''}" style="left:${posLeftPct}%;" onmousedown="GV._okPointerDown(event, 'tile', ${sh}, ${i})" ontouchstart="GV._okPointerDown(event, 'tile', ${sh}, ${i})"><div class="ok-num">${t.n}</div><div class="ok-dot"></div></div>`;
        }
      }
      h += '</div></div>';
    });
    h += '</div></div></div>';

    area.innerHTML = h;
  }

  function render() {
    if (!gameState) return;
    injectStyle();
    const area = document.getElementById('boardArea');
    if (!area) return;
    const s = getState();
    const ok = buildOk(gameState);
    if (s) {
      s.boards = s.boards || {};
      s.boards.okey = ok; // yerel sürükle-bırak mekanikleri bu nesne üzerinde çalışır
    }
    drawTable(area, ok);
  }

  // ---------- 📝 Hamleler (sunucu farkından türetilir) ----------
  function appendMove(text) {
    const el = document.getElementById('moveHist');
    if (!el) return;
    el.innerHTML += `<div class="mv"><span>${el.children.length + 1}.</span><span>${esc(text)}</span></div>`;
    el.scrollTop = el.scrollHeight;
  }

  function tileText(t) {
    if (!t) return '?';
    if (t.isFJ) return '⭐' + t.n;
    const dot = COLOR_DOT[t.c] || '⬜';
    return t.isOkey ? `🃏OKEY(${dot}${t.n})` : `${dot}${t.n}`;
  }

  function dispName(seat) {
    if (seat === mySeat && !isSpectator) return 'Sen';
    return playerName(seat);
  }
  function dispNameEsc(seat) { return esc(dispName(seat)); }

  function diffMoves(gs) {
    const cur = { round: gs.round, piles: {}, counts: {} };
    (gs.seats || []).forEach(seat => {
      cur.piles[seat] = (gs.discardPiles?.[seat] || []).length;
      cur.counts[seat] = gs.handCounts?.[seat] || 0;
    });
    const prev = prevSnap;
    if (!prev || prev.round !== cur.round) {
      if (prev) appendMove(`🀄 El ${cur.round}/${gs.maxRounds} başladı`);
    } else {
      (gs.seats || []).forEach(seat => {
        if (cur.piles[seat] > (prev.piles[seat] || 0)) {
          const pile = gs.discardPiles[seat];
          appendMove(`📤 ${dispName(seat)} ${tileText(pile[pile.length - 1])} attı`);
        } else if (cur.counts[seat] > (prev.counts[seat] || 0)) {
          appendMove(`🧲 ${dispName(seat)} taş çekti`);
        }
      });
    }
    prevSnap = cur;
  }

  // ---------- Saat / SIRA rozeti ----------
  function updateClock() {
    const gs = gameState;
    if (!gs) return;
    const playing = gs.status === 'playing' && !gs.finished;
    const sincePack = gs.serverNow ? Math.max(0, Date.now() - Number(gs.serverNow)) : 0;

    const el = document.getElementById('okTimerVal');
    if (el) {
      const remain = Math.max(0, Number(gs.turnRemainingMs || 0) - (playing ? sincePack : 0));
      const secs = Math.ceil(remain / 1000);
      setText(el, String(secs));
      const wrap = el.closest('.ok-turn-timer');
      if (wrap) wrap.classList.toggle('urgent', playing && secs <= 10);
      // Sıramsa ve süre azalıyorsa tur başına bir kez uyar
      if (playing && myTurnNow() && secs <= 10) {
        const key = gs.round + ':' + gs.turn + ':' + Math.ceil(Number(gs.turnRemainingMs || 0) / 1000);
        if (turnWarnKey !== key) {
          turnWarnKey = key;
          toast(`⏰ Hamle süreniz dolmak üzere! ${secs} sn içinde oynamazsanız otomatik oynanır (3. uyarıda diskalifiye).`, 'error');
        }
      }
    }

    if (gs.clockMs) {
      document.querySelectorAll('[data-okey-clock]').forEach(span => {
        const seat = Number(span.getAttribute('data-okey-clock'));
        let ms = Number(gs.clockMs[seat] || 0);
        if (playing && seat === gs.turn) ms = Math.max(0, ms - sincePack);
        setText(span, '🕐 ' + fmt(ms));
      });
    }
  }

  function startClock() {
    if (clockInt) clearInterval(clockInt);
    clockInt = setInterval(updateClock, 250);
    updateClock();
  }

  // ---------- El sonu ara ekranı ----------
  const WIN_TEXT = { standard: 'Normal bitiş', pairs: '🔥 Çifte gitti!', okey: '🃏 Okey atarak bitirdi!', draw: 'Deste bitti' };
  function handleRoundEnded(gs) {
    const res = gs.result || {};
    if (res.winType === 'draw' || res.winner === null || res.winner === undefined) {
      roundInfo = { round: gs.round, title: '🤝 El Berabere', desc: 'Deste bitti — kimse puan alamadı.' };
    } else {
      const nm = (res.winner === mySeat && !isSpectator) ? '🏆 Eli KAZANDINIZ!' : `🏆 ${esc(playerName(res.winner))} eli kazandı!`;
      const sLine = (gs.seats || []).map(s2 => `${dispNameEsc(s2)}:${gs.scores?.[s2] || 0}`).join('  •  ');
      roundInfo = { round: gs.round, title: nm, desc: `${WIN_TEXT[res.winType] || ''}<br>Skor — ${sLine}` };
    }
    appendMove(`🏆 El ${gs.round} bitti — ${res.winner === null || res.winner === undefined ? 'berabere' : dispName(res.winner) + ' kazandı'}`);
  }

  // ---------- Maç sonu kaplaması ----------
  function renderEndOverlay() {
    if (!gameState) return;
    if (endOverlayFor === (roomId + ':' + gameState.round + ':' + (gameState.matchResult?.reason || 'x'))) return;
    endOverlayFor = roomId + ':' + gameState.round + ':' + (gameState.matchResult?.reason || 'x');
    const res = gameState.matchResult || {};
    const reason = res.reason || 'completed';
    const winnerName = res.winnerName || 'Bir oyuncu';
    const iWon = endYouWon === true;
    const sLine = (gameState.seats || []).map(s2 => `${dispNameEsc(s2)}: ${gameState.scores?.[s2] || 0}`).join('  •  ');

    let title = '🏁 MAÇ BİTTİ';
    let desc = '';
    if (reason === 'completed') {
      title = iWon ? '🏆 MAÇI KAZANDINIZ!' : '🏁 MAÇ BİTTİ';
      desc = isSpectator ? `${esc(winnerName)} maçı kazandı.`
        : iWon ? '🎉 Tebrikler, en yüksek skoru siz yaptınız!' : `💔 ${esc(winnerName)} maçı kazandı.`;
    } else if (reason === 'player_left') {
      title = '🚪 OYUN TERK EDİLDİ';
      desc = isSpectator ? `Bir oyuncu ayrıldı. ${esc(winnerName)} kazandı.`
        : iWon ? '🏆 Rakip oyundan ayrıldı — KAZANDINIZ!' : '💔 Oyundan ayrıldığınız için KAYBETTİNİZ.';
    } else if (reason === 'timeout') {
      title = '⏰ ANA SÜRE DOLDU';
      desc = isSpectator ? `${esc(winnerName)} kazandı (süre aşımı).`
        : iWon ? '🏆 Rakibin ana süresi doldu — KAZANDINIZ!' : '💔 Ana süreniz doldu — KAYBETTİNİZ.';
    } else if (reason === 'disqualified') {
      title = '⚠️ SÜREKLİ SÜRE AŞIMI';
      desc = isSpectator ? `${esc(winnerName)} kazandı (rakip 3 kez süre aştı).`
        : iWon ? '🏆 Rakip 3 kez SIRA süresini doldurdu — KAZANDINIZ!' : '💔 3 kez SIRA süresini doldurdunuz — DİSKALİFİYE oldunuz.';
    }
    const html = `<div class="chess-end-overlay"><div class="chess-end-modal"><div class="end-icon">🀄</div>` +
      `<h2>${title}</h2><p>${desc}</p>` +
      `<p style="color:#f9ca24;font-weight:700">Skorlar — ${sLine}</p>` +
      `<button class="btn btn-p" style="margin-top:8px;padding:10px 20px;cursor:pointer;" onclick="window.__gvRealChessLeave()">🚪 Odadan Ayrıl ve Lobiye Dön</button></div></div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function autoReturnToLobby() {
    if (autoReturnTimer) return;
    autoReturnTimer = setTimeout(() => {
      autoReturnTimer = null;
      if (typeof window.__gvRealChessLeave === 'function') window.__gvRealChessLeave();
      else if (typeof window.leaveRoom === 'function') window.leaveRoom();
    }, 6000);
  }

  // ---------- Durum uygulama ----------
  function apply(gs, evName) {
    if (!gs || gs.kind !== 'okey') return;
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    gameState = gs;
    claimClockOwnership();
    active = true;

    if (roundInfo && gs.round !== roundInfo.round) roundInfo = null; // yeni el başladı
    if (evName === 'okeyRoundEnded') handleRoundEnded(gs);

    // Otomatik oynama uyarısı (kendi strike sayacım arttıysa)
    if (mySeat !== null && gs.strikes) {
      const cur = gs.strikes[mySeat] || 0;
      if (cur > prevStrikes && evName === 'okeyAutoPlayed') {
        toast(`⏱ SIRA süreniz doldu — otomatik oynandı! (Uyarı ${cur}/3, 3. uyarıda DİSKALİFİYE)`, 'error');
      }
      prevStrikes = cur;
    }

    // Yerel (bot) okey sayacı artıklarını kesin durdur
    const s = getState();
    if (s && s.okTimerInt) { clearInterval(s.okTimerInt); s.okTimerInt = null; }

    diffMoves(gs);
    render();
    startClock();
  }

  // ---------- Çözücü (istemci tarafı "Kontrol" ipucu — sunucuyla AYNI kurallar) ----------
  function isRealOkeyT(t, ro) { return t && !t.isFJ && t.c === ro.c && t.n === ro.n; }
  function checkPairs14(tiles, ro) {
    if (tiles.length !== 14) return false;
    let okeys = 0;
    const rest = [];
    tiles.forEach(t => { if (isRealOkeyT(t, ro)) okeys++; else rest.push(t); });
    const map = {};
    rest.forEach(t => { const k = t.c + '-' + t.n; map[k] = (map[k] || 0) + 1; });
    let singles = 0;
    Object.values(map).forEach(c => { if (c % 2) singles++; });
    return okeys >= singles;
  }
  function checkPer14(tiles, ro) {
    if (tiles.length !== 14) return false;
    let okeys = 0;
    const reg = [];
    tiles.forEach(t => { if (isRealOkeyT(t, ro)) okeys++; else reg.push(t); });
    reg.sort((a, b) => a.c.localeCompare(b.c) || a.n - b.n);
    return solveR(reg, okeys);
  }
  function solveR(regular, okeys) {
    if (regular.length === 0) return true;
    if (regular.length + okeys < 3) return false;
    const first = regular[0];
    const sameNum = regular.filter(t => t.n === first.n);
    const uniq = []; const seen = new Set();
    sameNum.forEach(t => { if (!seen.has(t.c)) { seen.add(t.c); uniq.push(t); } });
    for (let size = 3; size <= 4; size++) {
      for (let need = 0; need <= okeys; need++) {
        const req = size - need;
        if (req >= 1 && uniq.length >= req) {
          const combo = uniq.slice(0, req);
          const rem = [...regular];
          let valid = true;
          combo.forEach(ct => {
            const i = rem.findIndex(r => r.id === ct.id);
            if (i !== -1) rem.splice(i, 1); else valid = false;
          });
          if (valid && solveR(rem, okeys - need)) return true;
        }
      }
    }
    // Dönüşümlü seri (13→1); first serinin herhangi bir üyesi olabilir
    for (let len = 5; len >= 3; len--) {
      for (let anchor = 0; anchor < len; anchor++) {
        for (let need = 0; need <= okeys; need++) {
          const rem = [...regular];
          let left = need;
          let possible = true;
          for (let step = 0; step < len; step++) {
            let target = first.n + (step - anchor);
            target = ((target - 1) % 13 + 13) % 13 + 1;
            const i = rem.findIndex(r => r.c === first.c && r.n === target);
            if (i !== -1) rem.splice(i, 1);
            else if (left > 0) left--;
            else { possible = false; break; }
          }
          if (possible && left === 0 && solveR(rem, okeys - need)) return true;
        }
      }
    }
    return false;
  }

  function onlineCheck() {
    if (isSpectator) return toast('👁️ İzleyici modunda kontrol yok.', 'info');
    const gs = gameState;
    if (!gs || !gs.myHand) return;
    const tiles = gs.myHand;
    if (tiles.length === 15 && myTurnNow() && gs.phase === 'discard') {
      toast('🔍 Eliniz bitiş için kontrol ediliyor...', 'info');
      let canWin = false;
      for (let i = 0; i < tiles.length; i++) {
        const test14 = tiles.filter((_, idx) => idx !== i);
        if (checkPairs14(test14, gs.realOkey) || checkPer14(test14, gs.realOkey)) { canWin = true; break; }
      }
      if (canWin) toast('🎉 Eliniz bitmeye uygun! 15. taşı ORTAYA BİTİR kutusuna sürükleyin.', 'success');
      else toast('⚠️ Eliniz henüz bitmeye uygun değil. Perleri tamamlayın veya çifte gidin.', 'warning');
    } else {
      let msg = `📊 Elinizde ${tiles.length} taş var. `;
      if (!myTurnNow()) msg += '⏳ Sıra sizde değil.';
      else if (gs.phase === 'draw') msg += '🎯 Taş çekmelisiniz (desteden veya soldan)!';
      else msg += '📤 Taş atmalısınız!';
      toast(msg, 'info');
    }
  }

  // ---------- Online eylemler ----------
  function onlineActive() {
    return !!(active && gameState && isOkeyRoom());
  }

  function rackTile(sh, sl) {
    const s = getState();
    return s?.boards?.okey?.rack?.[sh]?.[sl] || null;
  }

  function onlineDraw(source) {
    if (!onlineActive()) return;
    if (isSpectator) return toast('👁️ İzleyicisiniz — taş çekemezsiniz.', 'info');
    if (!myTurnNow()) return toast('⏳ Sıra sizde değil!', 'warning');
    if (gameState.phase !== 'draw') return toast('📤 Taş atmalısınız!', 'warning');
    socket?.emit('okeyDraw', { roomId, source });
  }

  function onlineDiscard(sh, sl) {
    if (!onlineActive()) return;
    const t = rackTile(sh, sl);
    if (!t) return;
    socket?.emit('okeyDiscard', { roomId, tileId: t.id });
  }

  function onlineFinish(sh, sl) {
    if (!onlineActive()) return;
    const t = rackTile(sh, sl);
    if (!t) return;
    socket?.emit('okeyFinish', { roomId, tileId: t.id });
  }

  // ---------- Yerel (botlu) okey ile köprü: online odadayken GV._ok* sarmalanır ----------
  function wrapLocalHandlers() {
    if (window.__gvOkeyHandlersWrapped) return;
    if (!window.GV || typeof window.GV._okPointerDown !== 'function') return;
    window.__gvOkeyHandlersWrapped = true;
    const orig = {
      pd: window.GV._okPointerDown,
      draw: window.GV._okDraw,
      drawL: window.GV._okDrawL,
      discard: window.GV._okDiscardTile,
      finish: window.GV._okTryFinishGame,
      check: window.GV._okCheck,
      sort: window.GV._okSort,
      surrender: window.GV._okSurrender,
      rackDrop: window.GV._okHandleRackDrop
    };
    window.__gvOkeyLocalHandlers = orig;

    window.GV._okPointerDown = function (e, type, sh, sl) {
      if (onlineActive()) {
        if (isSpectator) { toast('👁️ İzleyici modunda hamle yapamazsınız.', 'info'); return; }
        if (type !== 'tile') {
          if (!myTurnNow()) { toast('⏳ Sıra sizde değil!', 'warning'); return; }
          if (gameState.phase !== 'draw') { toast('📤 Önce taş atmalısınız!', 'warning'); return; }
          if (type === 'left' && !(gameState.discardPiles?.[seatMapping().prevSeat()] || []).length) {
            toast('⚠️ Önceki oyuncunun atığı yok — orta desteden çekin.', 'warning'); return;
          }
        }
        // Sürükle-bırak görselliği yerel motora aittir; commit noktaları
        // (_okDraw/_okDrawL/_okDiscardTile/_okTryFinishGame) aşağıda sunucuya bağlı.
      }
      return orig.pd && orig.pd(e, type, sh, sl);
    };
    window.GV._okDraw = function () { if (onlineActive()) return onlineDraw('deck'); return orig.draw && orig.draw(); };
    window.GV._okDrawL = function () { if (onlineActive()) return onlineDraw('prev'); return orig.drawL && orig.drawL(); };
    window.GV._okDiscardTile = function (sh, sl) { if (onlineActive()) return onlineDiscard(sh, sl); return orig.discard && orig.discard(sh, sl); };
    window.GV._okTryFinishGame = function (sh, sl) { if (onlineActive()) return onlineFinish(sh, sl); return orig.finish && orig.finish(sh, sl); };
    window.GV._okCheck = function () { if (onlineActive()) return onlineCheck(); return orig.check && orig.check(); };
    window.GV._okSort = function () {
      const r = orig.sort && orig.sort();
      if (onlineActive()) resyncIdsFromBoard();
      return r;
    };
    window.GV._okHandleRackDrop = function (cx, cy, sh, sl) {
      const r = orig.rackDrop && orig.rackDrop(cx, cy, sh, sl);
      if (onlineActive()) { resyncIdsFromBoard(); refreshChrome(); }
      return r;
    };
    window.GV._okSurrender = function () {
      if (onlineActive()) {
        if (isSpectator) return toast('👁️ İzleyici modunda bu işlem yok.', 'info');
        if (!confirm('🏳️ Pes etmek istediğinize emin misiniz?\n\nMaçı KAYBETMİŞ sayılacaksınız ve lobiye yönlendirileceksiniz.')) return;
        if (typeof window.__gvRealChessLeave === 'function') window.__gvRealChessLeave();
        else if (typeof window.leaveRoom === 'function') window.leaveRoom();
        return;
      }
      return orig.surrender && orig.surrender();
    };
  }

  // Yerel sürükle-bırak/sırala sonrası kendi çizicim isim+saat süslemesini
  // geri basar (yerel dOkey genel isimler kullanır).
  function refreshChrome() {
    if (!onlineActive()) return;
    render();
    updateClock();
  }

  // ---------- Soket ----------
  function loadSocketClient(done) {
    if (window.io) return done();
    const sources = ['js/socket.io.min.js', 'socket.io.min.js', 'https://cdn.socket.io/4.7.5/socket.io.min.js'];
    (function tryNext(i) {
      if (i >= sources.length) return toast('🔌 Socket.IO istemcisi yüklenemedi.', 'error');
      const s = document.createElement('script');
      s.src = sources[i];
      s.onload = done;
      s.onerror = () => tryNext(i + 1);
      document.head.appendChild(s);
    })(0);
  }

  function join() {
    if (!socket?.connected) return;
    roomId = getRoomId();
    if (!roomId) return;
    localStorage.setItem('gv-room-id', roomId);
    socket.emit('joinRoom', {
      memberToken: (window.GVAuth && GVAuth.token ? (GVAuth.token() || undefined) : undefined),
      roomId,
      userName: getUserName(),
      userKey: userKey(),
      maxPlayers: 4,
      durationMinutes: 10, // kalıcı masalarda sunucu bunu YOK SAYAR (masanın süresi korunur)
      gameId: 'okey',
      asSpectator: !!window.__gvJoinAsSpectator || !!window.__gvIsSpectator
    });
  }

  function attach() {
    if (!socket || socket.__gvOkeyBound) return;
    socket.__gvOkeyBound = true;

    socket.on('gameStarted', payload => {
      if (!payload || String(payload.roomId) !== String(roomId) || !isOkeyRoom()) return;
      if (!payload.gameState || payload.gameState.kind !== 'okey') return;
      active = true;
      endYouWon = null;
      roundInfo = null;
      prevSnap = null;
      prevStrikes = 0;
      turnWarnKey = null;
      endOverlayFor = null;
      rackIds = { 0: new Array(SLOT_COUNT).fill(null), 1: new Array(SLOT_COUNT).fill(null) };
      if (payload.isSpectator) {
        isSpectator = true;
        window.__gvIsSpectator = true;
        mySeat = null;
      } else {
        isSpectator = false;
        if (typeof payload.seat === 'number') mySeat = payload.seat;
      }
      apply(payload.gameState, 'gameStarted');
      toast(`🀄 Okey başladı — El ${payload.gameState.round}/${payload.gameState.maxRounds}. Bol şans!`, 'success');
    });

    socket.on('gameStateUpdated', payload => {
      if (!payload || String(payload.roomId) !== String(roomId) || !isOkeyRoom()) return;
      if (!payload.gameState || payload.gameState.kind !== 'okey') return;
      if (payload.isSpectator) { isSpectator = true; window.__gvIsSpectator = true; }
      if (typeof payload.seat === 'number') mySeat = payload.seat;
      apply(payload.gameState, 'gameStateUpdated');
    });

    socket.on('okeyRoundEnded', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      if (!payload.gameState || payload.gameState.kind !== 'okey') return;
      if (typeof payload.seat === 'number') mySeat = payload.seat;
      apply(payload.gameState, 'okeyRoundEnded');
    });

    socket.on('okeyAutoPlayed', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      if (!payload.gameState || payload.gameState.kind !== 'okey') return;
      if (typeof payload.seat === 'number') mySeat = payload.seat;
      apply(payload.gameState, 'okeyAutoPlayed');
    });

    socket.on('okeyRejected', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      const messages = {
        not_your_turn: '⏳ Sıra sizde değil!',
        must_draw: '🧲 Önce taş çekmelisiniz!',
        must_discard: '📤 Taş atmalısınız (15 taşla çekilemez)!',
        tile_not_found: '⚠️ Taş bulunamadı — ıstaka sunucuyla tazelendi.',
        not_a_win_hand: '⚠️ Eliniz henüz bitmeye uygun değil! Perlerinizi veya çiftlerinizi kontrol edin.',
        no_discard: '⚠️ Sol oyuncunun atığı yok — orta desteden çekin.',
        round_over: '🏁 El bitti, yeni el bekleniyor...'
      };
      toast(messages[payload.reason] || '⚠️ Hamle reddedildi.', 'warning');
      if (payload.gameState && payload.gameState.kind === 'okey') apply(payload.gameState, 'resync');
    });

    socket.on('gameEnded', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      if (!payload.gameState || payload.gameState.kind !== 'okey') return;
      if (payload.isSpectator) { isSpectator = true; window.__gvIsSpectator = true; }
      if (typeof payload.seat === 'number') mySeat = payload.seat;
      if (typeof payload.youWon === 'boolean' && !isSpectator) endYouWon = payload.youWon;
      apply(payload.gameState, 'gameEnded');
      appendMove(`🏁 Maç bitti${payload.winnerName ? ' — kazanan: ' + payload.winnerName : ''}`);
      renderEndOverlay();
      if (payload.reason !== 'completed') autoReturnToLobby();
    });

    socket.on('playerLeft', payload => {
      if (!payload || String(payload.roomId) !== String(roomId)) return;
      if (!isSpectator && payload && typeof payload.youWon === 'boolean') endYouWon = payload.youWon;
    });
  }

  function connect() {
    roomId = getRoomId();
    if (!roomId || !isOkeyRoom()) return;
    loadSocketClient(() => {
      if (socket && window.__gvRoomSocket && socket !== window.__gvRoomSocket) {
        try { socket.off && socket.off(); } catch (_) {}
        socket = null;
      }
      if (socket) {
        attach();
        if (socket.connected) join(); else socket.once('connect', join);
        return;
      }
      socket = window.__gvRoomSocket || window.__gvChessSocket || window.io(BACKEND, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 700
      });
      window.__gvRoomSocket = socket;
      attach();
      if (socket.connected) join(); else socket.once('connect', join);
    });
  }

  // Odadan ayrılırken room-waiting-fix.js tarafından çağrılır.
  window.__gvOkeyOnlineReset = function () {
    active = false;
    releaseClockOwnership();
    gameState = null;
    mySeat = null;
    isSpectator = false;
    endYouWon = null;
    roundInfo = null;
    prevSnap = null;
    prevStrikes = 0;
    turnWarnKey = null;
    endOverlayFor = null;
    rackIds = { 0: new Array(SLOT_COUNT).fill(null), 1: new Array(SLOT_COUNT).fill(null) };
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
    if (autoReturnTimer) { clearTimeout(autoReturnTimer); autoReturnTimer = null; }
    roomId = null;
    if (clockInt) { clearInterval(clockInt); clockInt = null; }
    const s = getState();
    if (s && s.okTimerInt) { clearInterval(s.okTimerInt); s.okTimerInt = null; }
    document.querySelectorAll('.chess-end-overlay').forEach(el => el.remove());
    socket = null;
  };

  // ---------- "Masa açılmıyor" koruması ----------
  // Odaya girildi ama birkaç saniye içinde sunucudan okey durumu gelmediyse
  // ekran BOŞ KALMASIN: yerel masa açılır ve kullanıcı açıkça bilgilendirilir.
  // Sunucu durumu sonradan ulaşırsa apply() üzerine geçer (kesintisiz).
  function scheduleLocalFallback() {
    if (fallbackTimer) clearTimeout(fallbackTimer);
    fallbackTimer = setTimeout(() => {
      fallbackTimer = null;
      if (gameState || !isOkeyRoom()) return; // sunucu durumu zaten gelmiş
      const s = getState();
      const area = document.getElementById('boardArea');
      if (!area) return;
      injectStyle();
      if (s && typeof window.rOkey === 'function') {
        s.boards = s.boards || {};
        if (!s.boards.okey) window.rOkey(area);
        toast('⚠️ Sunucu senkronu kurulamadı — okey şu an ÇEVRİMDIŞI (yerel) görünümde. Online senkron için sayfayı yenileyin (Ctrl+F5).', 'warning');
      } else if (!s) {
        area.innerHTML = '<div style="max-width:420px;margin:40px auto;padding:28px;text-align:center;' +
          'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:16px;color:#fff">' +
          '<div style="font-size:2.4em">🀄</div><h3 style="margin:10px 0 8px">Okey masası açılamadı</h3>' +
          '<p style="color:#aaa;font-size:.92em;margin-bottom:14px">Sunucuya bağlanılamadı. Lütfen sayfayı yenileyin (Ctrl+F5) ve tekrar katılın.</p>' +
          '<button onclick="window.location.reload()" style="padding:10px 18px;border-radius:10px;border:0;background:#6c5ce7;color:#fff;font-weight:700;cursor:pointer">🔄 Sayfayı Yenile</button></div>';
      }
    }, 4000);
  }

  function boot() {
    wrapLocalHandlers();
    if (!isOkeyRoom()) return;
    roomId = getRoomId();
    if (roomId) connect();
    scheduleLocalFallback();
  }

  window.addEventListener('gv:roomGameStarted', boot);
  window.addEventListener('gv:roomReady', event => {
    if (event.detail?.gameId === 'okey' || event.detail?.roomId) {
      if (isOkeyRoom()) {
        window.__gvOkeyOnlineRequested = true;
        if (event.detail?.roomId) roomId = String(event.detail.roomId);
        boot();
      }
    }
  });
  window.addEventListener('DOMContentLoaded', wrapLocalHandlers, { once: true });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
