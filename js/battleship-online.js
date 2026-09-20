/* ============================================================================
 * GameVerse — ÇEVRİMİÇİ AMİRAL BATTI. Yaşam döngüsü js/online-arena.js'te.
 * ============================================================================
 * Sunucu (server.js + battleship-engine.js) her koltuğa YALNIZ kendi filosunu
 * ve üzerine gelen atışları gönderir; rakibin vurulmamış gemi konumları
 * istemciye hiç ulaşmaz. Bu yüzden burada rakip konumu tahmin etmeye
 * çalışmayın — veri yok.
 *
 * YERLEŞTİRME (kullanıcı isteği):
 *   • gemiler SÜRÜKLE-BIRAK ile diziliyor (masaüstü ve dokunmatik aynı kod:
 *     Pointer Events),
 *   • her gemi kendi üstten görünüm ÇİZİMİYLE gösteriliyor (kare kutu değil),
 *     çizim tam olarak kapladığı hücrelere oturuyor,
 *   • yerleşmiş her geminin ucunda tıklanabilir bir DÖNDÜRME tutamağı var
 *     (yatay ↔ dikey); ayrıca üstteki "Yön" düğmesi henüz dizilmemiş gemiler
 *     için varsayılanı değiştirir,
 *   • yerleştirme süresi sunucudan gelir (90 sn) ve yerinde sayar — geri
 *     sayım için tahtanın tamamı yeniden çizilmez (sürükleme bozulmasın).
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvBattleshipOnlineLoaded) return;
  window.__gvBattleshipOnlineLoaded = true;
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  var SIZE = 10;
  function colLetter(c) { return String.fromCharCode(65 + c); }
  function coordText(r, c) { return colLetter(c) + (r + 1); }

  // ---------------------------------------------------------- GEMİ ÇİZİMLERİ
  /* Her gemi, kapladığı hücre sayısına göre (n×100)×100 birimlik bir
     viewBox'a çizilir; kutuya tam oturur. Çizimler özgündür (üstten
     görünüm siluetler): pruva sağda, güverte detayları ölçeklenir. */
  function shipArt(id, n) {
    var W = n * 100, H = 100;
    var g = '<defs><linearGradient id="bsg' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#b9cee0"/><stop offset=".45" stop-color="#7f9bb5"/>' +
      '<stop offset="1" stop-color="#3d586f"/></linearGradient></defs>';
    // Gövde: kıçta yuvarlak, pruvada sivri
    var hull = '<path d="M14,22 H' + (W - 46) + ' L' + (W - 8) + ',50 L' + (W - 46) + ',78 H14 ' +
      'a14,14 0 0 1 -14,-14 V36 a14,14 0 0 1 14,-14 Z" fill="url(#bsg' + id + ')" ' +
      'stroke="#22384b" stroke-width="4" stroke-linejoin="round"/>';
    var deck = '';
    if (id === 'carrier') {
      deck =
        '<rect x="24" y="30" width="' + (W - 92) + '" height="40" rx="6" fill="#9db6cc" opacity=".85"/>' +
        '<line x1="40" y1="50" x2="' + (W - 80) + '" y2="50" stroke="#f2f6fa" stroke-width="5" ' +
        'stroke-dasharray="26 20" opacity=".9"/>' +
        '<rect x="' + (W * 0.58) + '" y="60" width="52" height="26" rx="5" fill="#2b3f54"/>' +
        '<rect x="' + (W * 0.58 + 14) + '" y="42" width="16" height="22" rx="3" fill="#2b3f54"/>';
    } else if (id === 'battleship') {
      deck =
        '<rect x="' + (W * 0.36) + '" y="28" width="' + (W * 0.2) + '" height="44" rx="6" fill="#2b3f54"/>' +
        '<circle cx="' + (W * 0.22) + '" cy="50" r="19" fill="#31485f" stroke="#1d2f40" stroke-width="3"/>' +
        '<rect x="' + (W * 0.22) + '" y="45" width="42" height="10" rx="4" fill="#1d2f40"/>' +
        '<circle cx="' + (W * 0.66) + '" cy="50" r="17" fill="#31485f" stroke="#1d2f40" stroke-width="3"/>' +
        '<rect x="' + (W * 0.66) + '" y="46" width="38" height="9" rx="4" fill="#1d2f40"/>';
    } else if (id === 'cruiser') {
      deck =
        '<rect x="' + (W * 0.40) + '" y="30" width="' + (W * 0.17) + '" height="40" rx="6" fill="#2b3f54"/>' +
        '<circle cx="' + (W * 0.24) + '" cy="50" r="16" fill="#31485f" stroke="#1d2f40" stroke-width="3"/>' +
        '<rect x="' + (W * 0.24) + '" y="46" width="34" height="9" rx="4" fill="#1d2f40"/>' +
        '<rect x="' + (W * 0.63) + '" y="36" width="18" height="28" rx="5" fill="#1d2f40"/>';
    } else if (id === 'submarine') {
      // Denizaltı: sigar gövde + kule
      hull = '<rect x="6" y="28" width="' + (W - 34) + '" height="44" rx="22" ' +
        'fill="url(#bsg' + id + ')" stroke="#22384b" stroke-width="4"/>' +
        '<path d="M' + (W - 30) + ',30 L' + (W - 4) + ',50 L' + (W - 30) + ',70 Z" fill="#6d8aa4" stroke="#22384b" stroke-width="4" stroke-linejoin="round"/>';
      deck =
        '<rect x="' + (W * 0.42) + '" y="22" width="' + Math.max(34, W * 0.14) + '" height="26" rx="6" fill="#2b3f54"/>' +
        '<line x1="' + (W * 0.44) + '" y1="18" x2="' + (W * 0.44) + '" y2="4" stroke="#2b3f54" stroke-width="5"/>' +
        '<line x1="24" y1="50" x2="' + (W - 44) + '" y2="50" stroke="#dfe9f2" stroke-width="3" opacity=".45"/>';
    } else { // destroyer
      deck =
        '<rect x="' + (W * 0.40) + '" y="32" width="' + (W * 0.20) + '" height="36" rx="5" fill="#2b3f54"/>' +
        '<circle cx="' + (W * 0.24) + '" cy="50" r="14" fill="#31485f" stroke="#1d2f40" stroke-width="3"/>' +
        '<rect x="' + (W * 0.24) + '" y="46" width="30" height="8" rx="4" fill="#1d2f40"/>' +
        '<line x1="' + (W * 0.50) + '" y1="30" x2="' + (W * 0.50) + '" y2="8" stroke="#1d2f40" stroke-width="5"/>';
    }
    return '<svg class="bs-art" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" ' +
      'aria-hidden="true" focusable="false">' + g + hull + deck + '</svg>';
  }

  // ------------------------------------------------------------ YERLEŞTİRME
  var placeState = null;
  function ensurePlaceState(m) {
    var rid = String(m.roomId == null ? '' : m.roomId);
    if (!placeState || placeState.roomId !== rid) {
      placeState = { roomId: rid, ships: {}, dir: 'h', submitted: false, bitis: 0 };
    }
    return placeState;
  }
  function cellsFor(size, r, c, dir) {
    var out = [];
    for (var i = 0; i < size; i++) out.push(dir === 'v' ? [r + i, c] : [r, c + i]);
    return out;
  }
  function inBounds(cells) {
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] < 0 || cells[i][0] >= SIZE || cells[i][1] < 0 || cells[i][1] >= SIZE) return false;
    }
    return true;
  }
  function overlaps(cells, ships, ignoreId) {
    for (var id in ships) {
      if (!ships.hasOwnProperty(id) || id === ignoreId) continue;
      var occ = ships[id].cells;
      for (var i = 0; i < cells.length; i++)
        for (var j = 0; j < occ.length; j++)
          if (cells[i][0] === occ[j][0] && cells[i][1] === occ[j][1]) return true;
    }
    return false;
  }
  function canPlace(cells, ships, ignoreId) { return inBounds(cells) && !overlaps(cells, ships, ignoreId); }
  function nextUnplaced(fleet, ships) {
    for (var i = 0; i < fleet.length; i++) if (!ships[fleet[i].id]) return fleet[i].id;
    return null;
  }
  function randomPlacement(fleet) {
    for (var attempt = 0; attempt < 400; attempt++) {
      var ships = {}, ok = true;
      for (var i = 0; i < fleet.length; i++) {
        var def = fleet[i], placed = false;
        for (var t = 0; t < 80 && !placed; t++) {
          var dir = Math.random() < 0.5 ? 'h' : 'v';
          var r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
          var cells = cellsFor(def.size, r, c, dir);
          if (canPlace(cells, ships, def.id)) { ships[def.id] = { r: r, c: c, dir: dir, cells: cells }; placed = true; }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return ships;
    }
    return {};
  }

  // ------------------------------------------------------------------ ÇİZİM
  function boardHTML(size, inner, extraClass) {
    var h = '<div class="bs-board ' + (extraClass || '') + '"><div class="bs-corner"></div>' +
      '<div class="bs-collabels">';
    for (var c = 0; c < size; c++) h += '<span>' + colLetter(c) + '</span>';
    h += '</div><div class="bs-rowlabels">';
    for (var r = 0; r < size; r++) h += '<span>' + (r + 1) + '</span>';
    h += '</div><div class="bs-cells">' + inner + '</div></div>';
    return h;
  }
  function shipDiv(def, pl, opts) {
    var o = opts || {};
    return '<div class="bs-ship' + (o.cls ? ' ' + o.cls : '') + '" data-ship="' + def.id + '" ' +
      'data-size="' + def.size + '" data-dir="' + pl.dir + '" ' +
      'style="--r:' + pl.r + ';--c:' + pl.c + ';--n:' + def.size + '" ' +
      'title="' + def.name + ' (' + def.size + ')">' +
      '<div class="bs-ship-art">' + shipArt(def.id, def.size) + '</div>' +
      (o.rotate ? '<button type="button" class="bs-rot" title="Yönü çevir (yatay/dikey)">⟳</button>' : '') +
      '</div>';
  }

  function renderPlacement(m) {
    var s = m.state, ps = ensurePlaceState(m);
    var fleet = s.fleetDefs || [];
    var size = s.size || SIZE;
    var mineReady = !!(s.ready && s.ready.mine) || ps.submitted;
    var oppReady = !!(s.ready && s.ready.opponent);
    /* YERLEŞTİRME SÜRESİ — MUTLAK BİTİŞ ANINA bağlanır.
       Eskiden her çizimde s.placeRemainingMs'ten yeniden başlıyordu; "Sıfırla"
       düğmesi tahtayı yeniden çizdiği için süre de baştan alıyor ve oyuncu
       sıfırlaya bastıkça süre hiç bitmiyordu. Bitiş anı fazın başında BİR KEZ
       hesaplanır, sonraki çizimler aynı andan sayar. */
    if (!ps.bitis && Number(s.placeRemainingMs) > 0) {
      ps.bitis = Date.now() + Number(s.placeRemainingMs);
    }
    var sec = ps.bitis ? Math.max(0, Math.ceil((ps.bitis - Date.now()) / 1000))
                       : Math.max(0, Math.ceil((Number(s.placeRemainingMs) || 0) / 1000));

    var h = '<div class="bs-wrap"><div class="bs-place">';
    h += '<div class="bs-place-head"><h3>🚢 Filonu Yerleştir</h3><p>' +
      (mineReady ? ('Filon hazır — rakibi bekliyorsun' + (oppReady ? '' : ' ⏳'))
                 : 'Gemileri ızgaraya <b>sürükleyip bırak</b>. Yerleşen geminin ucundaki <b>⟳</b> ile yönünü çevir.') +
      '</p>' + (!mineReady ? '<div class="bs-countdown">⏱️ <span id="bsClock">' + sec + '</span> sn</div>' : '') + '</div>';

    if (!mineReady) {
      // Dizilmemiş gemiler: sürüklenebilir tepsi
      var kalan = fleet.filter(function (d) { return !ps.ships[d.id]; });
      h += '<div class="bs-tray" id="bsTray">';
      if (!kalan.length) {
        h += '<div class="bs-tray-done">✅ Tüm gemiler yerleşti — onaylayabilirsin.</div>';
      } else {
        kalan.forEach(function (def) {
          h += '<div class="bs-tray-ship" data-ship="' + def.id + '" data-size="' + def.size + '" ' +
            'style="--n:' + def.size + '" title="Sürükleyip ızgaraya bırak">' +
            '<div class="bs-tray-art' + (ps.dir === 'v' ? ' v' : '') + '">' + shipArt(def.id, def.size) + '</div>' +
            '<span class="bs-tray-name">' + def.name + ' <b>(' + def.size + ')</b></span></div>';
        });
      }
      h += '</div>';
      h += '<div class="bs-place-tools">' +
        '<button type="button" class="btn btn-o bs-dir">↻ Yön: ' + (ps.dir === 'h' ? 'Yatay' : 'Dikey') + '</button>' +
        '<button type="button" class="btn btn-o bs-shuffle">🎲 Rastgele Yerleştir</button>' +
        '<button type="button" class="btn btn-o bs-clear" title="Yalnız yerleşimi boşaltır — süre devam eder">🗑️ Yerleşimi Temizle</button></div>';
    }

    // Izgara + yerleşmiş gemiler
    var inner = '';
    for (var r = 0; r < size; r++)
      for (var c = 0; c < size; c++)
        inner += '<div class="bs-cell" data-r="' + r + '" data-c="' + c + '"></div>';
    fleet.forEach(function (def) {
      var pl = ps.ships[def.id];
      if (pl) inner += shipDiv(def, pl, { rotate: !mineReady, cls: mineReady ? 'locked' : '' });
    });
    h += '<div class="bs-grid-wrap">' + boardHTML(size, inner, 'bs-place-grid') + '</div>';

    if (!mineReady) {
      var allPlaced = fleet.length > 0 && fleet.every(function (d) { return !!ps.ships[d.id]; });
      h += '<button type="button" class="btn btn-p bs-ready-btn"' + (allPlaced ? '' : ' disabled') +
        '>✅ Filoyu Onayla</button>';
    }
    h += '</div></div>';
    return h;
  }

  // -------------------------------------------------------------- MUHAREBE
  var shotLog = { roomId: null, items: [] };
  function resetLogIfNeeded(rid) { if (shotLog.roomId !== rid) shotLog = { roomId: rid, items: [] }; }
  function logShot(rid, p, isMe) {
    resetLogIfNeeded(rid);
    var txt = (isMe ? 'Sen' : 'Rakip') + ' → ' + coordText(p.r, p.c) + ': ' +
      (p.result === 'miss' ? 'Iska' : p.result === 'sunk'
        ? (((p.sunkShip && p.sunkShip.name) || 'Gemi') + ' battı!') : 'İsabet');
    shotLog.items.unshift({ text: txt, mine: isMe, result: p.result });
    if (shotLog.items.length > 8) shotLog.items.length = 8;
  }
  function renderLog() {
    if (!shotLog.items.length) return '<div class="bs-log-empty">Henüz atış yok.</div>';
    return shotLog.items.map(function (it) {
      return '<div class="bs-log-item ' + (it.mine ? 'mine' : 'opp') + ' ' + it.result + '">' + it.text + '</div>';
    }).join('');
  }
  function voiceOn() { try { return localStorage.getItem('gv-bs-voice') !== 'off'; } catch (_) { return true; } }
  function setVoiceOn(on) { try { localStorage.setItem('gv-bs-voice', on ? 'on' : 'off'); } catch (_) {} }
  function speak(p, isMe) {
    if (!voiceOn() || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
    var coord = coordText(p.r, p.c), phrase;
    if (p.result === 'sunk') {
      var ad = (p.sunkShip && p.sunkShip.name) || 'gemi';
      phrase = isMe ? (ad + ' battırıldı, ' + coord) : ('Filonuzdan ' + ad + ' battı, ' + coord);
    } else if (p.result === 'hit') phrase = isMe ? ('İsabet, ' + coord) : ('İsabet aldınız, ' + coord);
    else phrase = isMe ? ('Iska, ' + coord) : ('Rakip ıskaladı, ' + coord);
    try {
      var u = new SpeechSynthesisUtterance(phrase);
      u.lang = 'tr-TR'; u.rate = 1.05;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch (_) {}
  }
  /* ------------------------------------------------------------------
     SİNEMATİK KÖPRÜSÜ
     Atışın hangi tahtada göründüğünü bulur (atan rakip sularına, savunan
     kendi filosuna bakar), hedef karenin ekran üzerindeki yerini ölçer ve
     js/deniz-sinematik.js'e devreder. Motor yoksa oyun eskisi gibi çalışır.
     ------------------------------------------------------------------ */
  function hucreKutusu(gridSec, r, c) {
    var el = document.querySelector(gridSec + ' .bs-cell[data-r="' + r + '"][data-c="' + c + '"]');
    if (!el || !el.getBoundingClientRect) return null;
    var k = el.getBoundingClientRect();
    return (k.width > 0 && k.height > 0) ? k : null;
  }
  function sinematikOynat(p, isMe) {
    if (!window.GVDeniz || typeof GVDeniz.oynat !== 'function') return;
    // Atan oyuncu atışı RAKİP sularında görür; hedefteki oyuncu KENDİ filosunda.
    var grid = isMe ? '.bs-enemy-grid' : '.bs-mine-grid';
    var hedef = hucreKutusu(grid, p.r, p.c);
    if (!hedef) return;
    var gemiKareleri = [];
    if (p.result === 'sunk' && p.sunkShip && p.sunkShip.cells) {
      p.sunkShip.cells.forEach(function (cc) {
        var k = hucreKutusu(grid, cc[0], cc[1]);
        if (k) gemiKareleri.push(k);
      });
    }
    try {
      GVDeniz.oynat({
        tur: p.result, hedef: hedef, gemiKareleri: gemiKareleri,
        tohum: Number(p.tohum) || ((p.r + 1) * 31 + (p.c + 1) * 7),
        isBenim: isMe,
        bitince: function () { if (window.GVArena) GVArena.repaint(); }
      });
    } catch (_) {}
  }

  function findShot(shots, r, c) {
    if (!shots) return null;
    for (var i = 0; i < shots.length; i++) if (shots[i].r === r && shots[i].c === c) return shots[i];
    return null;
  }
  function isLatest(shots, r, c) {
    return !!(shots && shots.length && shots[shots.length - 1].r === r && shots[shots.length - 1].c === c);
  }
  // myShips[].cells → çizim için {r,c,dir}
  function anchorOf(ship) {
    var cs = ship.cells;
    var dir = (cs.length > 1 && cs[1][0] !== cs[0][0]) ? 'v' : 'h';
    return { r: cs[0][0], c: cs[0][1], dir: dir };
  }

  function renderBattle(m) {
    var s = m.state, size = s.size || SIZE;
    var myTurn = !m.isSpectator && s.turn === m.seat;
    var sunkIds = {};
    (s.enemyFleet || []).forEach(function (f) { if (f.sunk) sunkIds[f.id] = true; });

    /* ---------------- KOMUTA KÖPRÜSÜ KABUĞU ----------------
       Üstte panoramik cam (düşman filosu ufukta, aldığı isabete göre yanar),
       ortada taktik ızgaralar, altta konsol (radar + hedef okuması + ateş).
       Izgaraların işaretlemesi ve sınıfları DEĞİŞMEDİ — yalnız çevresi. */
    var kalanGemi = (s.enemyFleet || []).filter(function (f) { return !f.sunk; }).length;
    var h = '<div class="bs-wrap bs-bridge">';
    h += '<div class="bs-view">' +
           '<canvas class="bs-sea" id="bsSea" aria-hidden="true"></canvas>' +
           '<div class="bs-view-hud">' +
             '<span>KERTERİZ ' + String(20 + ((s.myShots || []).length * 7) % 340).padStart(3, '0') + '°' +
               ' · DÜŞMAN FİLO ' + kalanGemi + '/' + ((s.enemyFleet || []).length || 5) + '</span>' +
             '<span>DENİZ 3 · GÖRÜŞ 8 NM</span>' +
           '</div>' +
           '<div class="bs-view-state' + (myTurn ? ' mine' : '') + '">' +
             (m.isSpectator ? '👁️ İZLEYİCİ' : (myTurn ? '🎯 SIRA SENDE' : '⏳ RAKİP NİŞAN ALIYOR')) +
           '</div>' +
         '</div>';
    /* Sıra durumu camdaki rozette yazıyor; burada tekrar etmiyoruz.
       Bu şerit yalnız sesli anlatım anahtarını taşır. */
    h += '<div class="bs-status bs-status-thin">' +
      '<span class="bs-voice-label">Sesli anlatım</span>' +
      '<button type="button" class="bs-voice-toggle" title="Seslendirme aç/kapat">' + (voiceOn() ? '🔊' : '🔇') + '</button></div>';

    h += '<div class="bs-battlefield">';
    // --- Kendi filom: gemi çizimleri + üzerine gelen atışlar ---
    var mineInner = '';
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        var shot = findShot(s.incomingShots, r, c);
        var sunk = shot && shot.shipId && (s.myShips || []).some(function (sh) {
          return sh.id === shot.shipId && sh.hits.every(Boolean);
        });
        var cls = 'bs-cell';
        if (shot) cls += shot.result === 'miss' ? ' miss' : (sunk ? ' sunk' : ' hit');
        if (isLatest(s.incomingShots, r, c)) cls += ' bs-latest';
        mineInner += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '"></div>';
      }
    }
    (s.myShips || []).forEach(function (sh) {
      var a = anchorOf(sh);
      var battik = sh.hits.every(Boolean);
      mineInner += shipDiv({ id: sh.id, name: sh.name, size: sh.size }, a,
        { cls: 'locked under' + (battik ? ' wrecked' : '') });
    });
    h += '<div class="bs-board-col"><h4>🛡️ Filon</h4>' + boardHTML(size, mineInner, 'bs-mine-grid') + '</div>';

    // --- Rakip suları: sis-of-war ---
    var enemyInner = '';
    for (var r2 = 0; r2 < size; r2++) {
      for (var c2 = 0; c2 < size; c2++) {
        var s2 = findShot(s.myShots, r2, c2);
        var cls2 = 'bs-cell';
        if (s2) cls2 += s2.result === 'miss' ? ' miss' : (sunkIds[s2.shipId] ? ' sunk' : ' hit');
        else cls2 += myTurn ? ' live' : ' fog';
        if (isLatest(s.myShots, r2, c2)) cls2 += ' bs-latest';
        enemyInner += '<div class="' + cls2 + '" data-board="enemy" data-r="' + r2 + '" data-c="' + c2 + '"></div>';
      }
    }
    h += '<div class="bs-board-col"><h4>🌊 Rakip Suları</h4>' + boardHTML(size, enemyInner, 'bs-enemy-grid') + '</div>';
    h += '</div>';

    /* Konsol: radar, seçili hedef ve ATEŞ düğmesi. Hedef önce SEÇİLİR,
       sonra ateşlenir — dokunmatikte yanlış kareye basmayı önler. */
    if (!m.isSpectator) {
      h += '<div class="bs-console">' +
             '<canvas class="bs-radar" id="bsRadar" aria-hidden="true"></canvas>' +
             '<div class="bs-console-mid">' +
               '<div class="bs-console-label">HEDEF</div>' +
               '<div class="bs-console-target" id="bsTarget">—</div>' +
               '<div class="bs-console-hint" id="bsHint">' +
                 (myTurn ? 'Rakip sularından bir kare seç' : 'Sıranı bekle') + '</div>' +
             '</div>' +
             '<button type="button" class="bs-fire" id="bsFire" disabled>ATEŞ</button>' +
           '</div>';
    }

    h += '<div class="bs-fleet-status"><div class="bs-fleet-status-title">🚩 Rakip Filosu</div><div class="bs-fleet-status-list">';
    (s.enemyFleet || []).forEach(function (f) {
      h += '<span class="bs-fleet-chip' + (f.sunk ? ' sunk' : '') + '">🚢 ' + f.name + (f.sunk ? ' 💥' : '') + '</span>';
    });
    h += '</div></div><div class="bs-log">' + renderLog() + '</div></div>';
    return h;
  }

  // ------------------------------------------------- SÜRÜKLE-BIRAK MOTORU
  // Masaüstü ve dokunmatik için TEK kod yolu (Pointer Events). HTML5
  // drag-and-drop bilerek kullanılmadı: mobilde güvenilir çalışmıyor.
  var drag = null;
  var clockTimer = null;

  function cellSizeOf(cells) {
    var one = cells.querySelector('.bs-cell');
    return one ? one.getBoundingClientRect().width : 30;
  }
  function cellFromPoint(cells, x, y) {
    var r = cells.getBoundingClientRect();
    var cs = cellSizeOf(cells);
    if (!cs) return null;
    var c = Math.floor((x - r.left) / cs), rr = Math.floor((y - r.top) / cs);
    if (rr < 0 || rr >= SIZE || c < 0 || c >= SIZE) return null;
    return { r: rr, c: c };
  }
  function clearPreview(cells) {
    cells.querySelectorAll('.bs-cell.ok,.bs-cell.bad').forEach(function (el) {
      el.classList.remove('ok', 'bad');
    });
  }
  function showPreview(cells, target, size, dir, ships, ignoreId) {
    clearPreview(cells);
    if (!target) return null;
    var list = cellsFor(size, target.r, target.c, dir);
    var ok = canPlace(list, ships, ignoreId);
    list.forEach(function (p) {
      if (p[0] < 0 || p[0] >= SIZE || p[1] < 0 || p[1] >= SIZE) return;
      var el = cells.querySelector('.bs-cell[data-r="' + p[0] + '"][data-c="' + p[1] + '"]');
      if (el) el.classList.add(ok ? 'ok' : 'bad');
    });
    return ok ? list : null;
  }

  define({
    id: 'battleship', kinds: ['battleship'], reject: ['battleshipRejected'],
    events: {
      battleshipShotResult: function (p) {
        if (!p || !window.GVArena) return;
        var rid = String(p.roomId == null ? '' : p.roomId);
        if (String(GVArena.roomId()) !== rid) return;
        var mySeat = GVArena.seat();
        var isMe = mySeat !== null && mySeat !== undefined && p.seat === mySeat;
        // Sinematik, tahta yeniden çizilmeden ÖNCE ölçülmeli: repaint sonrası
        // eski hücre düğümleri kaybolur. Ölçüler ekran koordinatındadır.
        sinematikOynat(p, isMe);
        logShot(rid, p, isMe);
        speak(p, isMe);
        if (window.GV && GV.toast) {
          var txt = (isMe ? '🎯 Sen ' : '💥 Rakip ') + coordText(p.r, p.c) + ': ' +
            (p.result === 'miss' ? 'Iska' : (p.result === 'sunk'
              ? (((p.sunkShip && p.sunkShip.name) || 'Gemi') + ' battı!') : 'İsabet!'));
          GV.toast(txt, p.result === 'miss' ? 'info' : (p.result === 'sunk' ? 'success' : 'warning'));
        }
        GVArena.repaint();
      }
    },
    render: function (m) {
      var s = m.state;
      if (!s) return '';
      return (s.phase === 'battle' || s.phase === 'finished') ? renderBattle(m) : renderPlacement(m);
    },
    bind: function (root, m) {
      var s = m.state;
      if (!s) return;
      if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }

      if (s.phase === 'placing') {
        var ps = ensurePlaceState(m);
        var fleet = s.fleetDefs || [];
        var mineReady = !!(s.ready && s.ready.mine) || ps.submitted;
        var cells = root.querySelector('.bs-place-grid .bs-cells');
        var defOf = function (id) { return fleet.find(function (d) { return d.id === id; }); };
        var yenile = function () { if (window.GVArena) GVArena.repaint(); };

        /* Geri sayım: tahtayı YENİDEN ÇİZMEDEN yerinde işler — aksi halde
           saniyede bir yeniden çizim sürükleme işlemini koparırdı. */
        var clockEl = root.querySelector('#bsClock');
        if (clockEl && !mineReady) {
          // Kalan süre her saniye MUTLAK bitiş anından hesaplanır; yeniden
          // çizim (sürükleme, sıfırlama, dönüş) süreyi etkilemez.
          var okuKalan = function () {
            return ps.bitis ? Math.max(0, Math.ceil((ps.bitis - Date.now()) / 1000))
                            : Math.max(0, Math.ceil((Number(s.placeRemainingMs) || 0) / 1000));
          };
          clockTimer = setInterval(function () {
            if (clockEl.isConnected === false) { clearInterval(clockTimer); clockTimer = null; return; }
            var kalan = okuKalan();
            clockEl.textContent = String(kalan);
            clockEl.parentNode.classList.toggle('urgent', kalan <= 15);
          }, 250);
        }
        if (mineReady || !cells) return;

        // ---- sürüklemeyi başlat (tepsiden ya da tahtadaki gemiden) ----
        function startDrag(e, shipId, fromBoard, grabIndex) {
          var def = defOf(shipId);
          if (!def) return;
          var dir = fromBoard ? ps.ships[shipId].dir : ps.dir;
          drag = { id: shipId, size: def.size, dir: dir, fromBoard: fromBoard,
                   grab: grabIndex || 0, placedOk: null };
          // Tahtadaki gemiyi geçici olarak kaldır ki kendi kendine çakışmasın
          if (fromBoard) { drag.prev = ps.ships[shipId]; delete ps.ships[shipId]; }
          var ghost = document.createElement('div');
          ghost.className = 'bs-drag-ghost';
          ghost.style.setProperty('--n', def.size);
          ghost.dataset.dir = dir;
          ghost.style.setProperty('--cell', cellSizeOf(cells) + 'px');
          ghost.innerHTML = '<div class="bs-ship-art">' + shipArt(def.id, def.size) + '</div>';
          document.body.appendChild(ghost);
          drag.ghost = ghost;
          moveGhost(e.clientX, e.clientY);
          try { e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); } catch (_) {}
          drag.captureEl = e.target;
          e.preventDefault();
        }
        function moveGhost(x, y) {
          if (!drag || !drag.ghost) return;
          var cs = cellSizeOf(cells);
          var ox = drag.dir === 'h' ? (drag.grab + 0.5) * cs : cs / 2;
          var oy = drag.dir === 'v' ? (drag.grab + 0.5) * cs : cs / 2;
          drag.ghost.style.left = (x - ox) + 'px';
          drag.ghost.style.top = (y - oy) + 'px';
        }
        function onMove(e) {
          if (!drag) return;
          moveGhost(e.clientX, e.clientY);
          var hit = cellFromPoint(cells, e.clientX, e.clientY);
          var anchor = hit ? (drag.dir === 'h'
            ? { r: hit.r, c: hit.c - drag.grab }
            : { r: hit.r - drag.grab, c: hit.c }) : null;
          drag.placedOk = showPreview(cells, anchor, drag.size, drag.dir, ps.ships, drag.id);
          e.preventDefault();
        }
        function onUp() {
          if (!drag) return;
          var d = drag; drag = null;
          if (d.ghost && d.ghost.parentNode) d.ghost.parentNode.removeChild(d.ghost);
          clearPreview(cells);
          if (d.placedOk) {
            ps.ships[d.id] = { r: d.placedOk[0][0], c: d.placedOk[0][1], dir: d.dir, cells: d.placedOk };
          } else if (d.fromBoard && d.prev) {
            // geçersiz bırakma: gemi tepsiye döner (kullanıcı yeniden dizebilir)
          }
          yenile();
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        // bind() yeniden çalıştığında bu dinleyiciler root ile birlikte
        // düşer; yine de aynı düğümde iki kez bağlanmasın diye işaretliyoruz.
        root.__bsCleanup = function () {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
        };

        root.querySelectorAll('.bs-tray-ship').forEach(function (el) {
          el.addEventListener('pointerdown', function (e) {
            startDrag(e, el.dataset.ship, false, 0);
          });
        });
        root.querySelectorAll('.bs-place-grid .bs-ship').forEach(function (el) {
          el.addEventListener('pointerdown', function (e) {
            if (e.target.closest && e.target.closest('.bs-rot')) return;   // döndürme düğmesi
            var pl = ps.ships[el.dataset.ship];
            if (!pl) return;
            var cs = cellSizeOf(cells);
            var r = el.getBoundingClientRect();
            var grab = pl.dir === 'h' ? Math.floor((e.clientX - r.left) / cs)
                                      : Math.floor((e.clientY - r.top) / cs);
            startDrag(e, el.dataset.ship, true, Math.max(0, Math.min(Number(el.dataset.size) - 1, grab)));
          });
        });
        // ---- döndürme tutamağı ----
        root.querySelectorAll('.bs-rot').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation(); e.preventDefault();
            var el = btn.closest('.bs-ship');
            var id = el.dataset.ship, pl = ps.ships[id];
            if (!pl) return;
            var yeni = pl.dir === 'h' ? 'v' : 'h';
            var list = cellsFor(Number(el.dataset.size), pl.r, pl.c, yeni);
            if (!canPlace(list, ps.ships, id)) {
              if (window.GV && GV.toast) GV.toast('↻ Burada dönemez — yer yok.', 'warning');
              return;
            }
            ps.ships[id] = { r: pl.r, c: pl.c, dir: yeni, cells: list };
            yenile();
          });
        });
        // ---- araçlar ----
        var dirBtn = root.querySelector('.bs-dir');
        if (dirBtn) dirBtn.addEventListener('click', function () { ps.dir = ps.dir === 'h' ? 'v' : 'h'; yenile(); });
        var sh = root.querySelector('.bs-shuffle');
        if (sh) sh.addEventListener('click', function () { ps.ships = randomPlacement(fleet); yenile(); });
        var cl = root.querySelector('.bs-clear');
        // Yalnız gemileri kaldırır: ps.bitis'e DOKUNMAZ, yani süre devam eder.
        if (cl) cl.addEventListener('click', function () { ps.ships = {}; yenile(); });
        // ---- boş hücreye tıklayarak da yerleştir (erişilebilir yedek yol) ----
        cells.addEventListener('click', function (e) {
          var cell = e.target.closest && e.target.closest('.bs-cell');
          if (!cell || drag) return;
          var id = nextUnplaced(fleet, ps.ships);
          if (!id) return;
          var def = defOf(id);
          var list = cellsFor(def.size, Number(cell.dataset.r), Number(cell.dataset.c), ps.dir);
          if (!canPlace(list, ps.ships, id)) {
            if (window.GV && GV.toast) GV.toast('Buraya sığmıyor — başka bir yer seç.', 'warning');
            return;
          }
          ps.ships[id] = { r: list[0][0], c: list[0][1], dir: ps.dir, cells: list };
          yenile();
        });
        var ready = root.querySelector('.bs-ready-btn');
        if (ready) ready.addEventListener('click', function () {
          if (ready.disabled || ps.submitted) return;
          var placements = fleet.map(function (def) {
            var pl = ps.ships[def.id];
            return { shipId: def.id, r: pl.r, c: pl.c, dir: pl.dir };
          });
          ps.submitted = true;
          m.emit('battleshipPlace', { placements: placements });
          yenile();
        });
        return;
      }

      // ------------------------------- muharebe fazı -------------------------------
      var voiceBtn = root.querySelector('.bs-voice-toggle');
      if (voiceBtn) voiceBtn.addEventListener('click', function () {
        setVoiceOn(!voiceOn());
        if (window.GVArena) GVArena.repaint();
      });
      /* ---------------- KÖPRÜ: panorama + radar ---------------- */
      if (window.GVKopru) {
        var enemyHits = {};
        (s.myShots || []).forEach(function (v) {
          if (v.result !== 'miss' && v.shipId) enemyHits[v.shipId] = (enemyHits[v.shipId] || 0) + 1;
        });
        GVKopru.durum({
          filo: (s.enemyFleet || []).map(function (f) {
            return { ad: f.name, boy: f.size, vurus: enemyHits[f.id] || 0, batik: !!f.sunk };
          }),
          sira: myTurn,
          benimVurus: (s.myShots || []).map(function (v) {
            return { r: v.r, c: v.c, isabet: v.result !== 'miss' };
          })
        });
        GVKopru.bagla(root.querySelector('#bsSea'), root.querySelector('#bsRadar'));
      }

      /* ---------------- HEDEF SEÇ → ATEŞ ----------------
         Kareye basınca hedef KİLİTLENİR, ateş konsoldaki düğmeyle (ya da
         aynı kareye ikinci kez basarak) verilir. Dokunmatikte yanlış kareye
         basıp atış harcamak böylece mümkün olmuyor. */
      // DİKKAT: myTurn renderBattle'ın yerel değişkeni; bind ayrı bir
      // fonksiyon olduğu için burada YENİDEN hesaplanmalı (aksi halde
      // ReferenceError bind'i yarıda keser ve hiçbir dinleyici bağlanmaz).
      var myTurn = !m.isSpectator && s.turn === m.seat;
      var secili = null;
      var hedefEl = root.querySelector('#bsTarget');
      var ipucuEl = root.querySelector('#bsHint');
      var atesEl = root.querySelector('#bsFire');

      function hedefYaz() {
        if (hedefEl) hedefEl.textContent = secili ? coordText(secili.r, secili.c) : '—';
        if (atesEl) atesEl.disabled = !(secili && myTurn);
        if (ipucuEl) {
          ipucuEl.textContent = !myTurn ? 'Sıranı bekle'
            : (secili ? 'ATEŞ düğmesine bas' : 'Rakip sularından bir kare seç');
        }
      }
      function ates() {
        if (!secili || m.isSpectator) return;
        if (window.GVDeniz && GVDeniz.oynuyor && GVDeniz.oynuyor()) return;
        if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.uyandir();
        if (window.GVDeniz && GVDeniz.ses && GVDeniz.ses.acik()) GVDeniz.ses.cal('ates');
        var v = secili; secili = null; hedefYaz();
        m.emit('battleshipFire', { r: v.r, c: v.c });
      }
      if (atesEl) atesEl.addEventListener('click', ates);

      root.querySelectorAll('.bs-enemy-grid .bs-cell.live').forEach(function (cell) {
        cell.addEventListener('click', function () {
          if (m.isSpectator) return;
          if (window.GVDeniz && GVDeniz.oynuyor && GVDeniz.oynuyor()) return;
          var r = Number(cell.dataset.r), c = Number(cell.dataset.c);
          // Aynı kareye ikinci basış = onay (konsolu kullanmak istemeyenler için).
          if (secili && secili.r === r && secili.c === c) { ates(); return; }
          root.querySelectorAll('.bs-enemy-grid .bs-cell.aim')
              .forEach(function (e) { e.classList.remove('aim'); });
          cell.classList.add('aim');
          secili = { r: r, c: c };
          if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.uyandir();
          hedefYaz();
        });
      });
      hedefYaz();
    }
  });
})();
