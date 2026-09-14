/* GameVerse — Online Amiral Battı (Battleship). Yaşam döngüsü js/online-arena.js'te.
 *
 * Sunucu (server.js:battleshipState) her koltuğa yalnız KENDİ filosunu ve
 * ÜZERİNE GELEN atışları tam gönderir; rakibin vurulmamış gemi konumları
 * hiçbir zaman istemciye ulaşmaz (bkz. server.js'teki "sis-of-war" notu).
 * Bu yüzden bu dosyada rakip gemi konumu tahmin etmeye ÇALIŞMAYIN — sunucu
 * zaten göndermiyor.
 *
 * İki ayrı görünüm:
 *  - 'placing' fazı: kendi filonu yerleştir (yerel — sunucuya yalnız
 *    TAMAMLANMIŞ 5 gemi tek seferde 'battleshipPlace' ile gider).
 *  - 'battle' fazı: iki 10x10 ızgara — solda "Filon" (gelen atışlar),
 *    sağda "Rakip Suları" (attığın atışlar, sıra sendeyken tıklanabilir).
 *
 * "Kendi hamlem / rakibin hamlesi" ayrımı doğal olarak ızgaralardan gelir
 * (ben yalnız rakip sularına ateş ederim, rakip yalnız benim filoma) —
 * ayrıca her atış sunucudan ayrı bir 'battleshipShotResult' yayınıyla da
 * gelir (bkz. server.js); bu olay burada TTS + toast + hamle günlüğü için
 * kullanılır (ızgaradaki kalıcı işaretleme render() içinde state'ten gelir,
 * böylece bir yeniden çizim bu geçici olayla asla yarışmaz).
 */
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
  function shipCssKind(id) {
    // Gemi türüne göre ızgarada farklı renk tonu (CSS'te .bs-cell.ship.k-*).
    return 'k-' + id;
  }

  // ---------------------------------------------------------------- YERLEŞTİRME
  // Odaya/maça özgü YEREL durum: sunucuya YALNIZ "Filoyu Onayla" ile gider,
  // bu yüzden ara adımlar render()'ın aldığı sunucu state'inde YOKTUR —
  // module-level'de saklanır ki rakip hazır olup bir gameStateUpdated
  // geldiğinde yarım bıraktığımız yerleştirme silinmesin.
  var placeState = null;
  function ensurePlaceState(m) {
    var rid = String(m.roomId == null ? '' : m.roomId);
    var fleet = (m.state && m.state.fleetDefs) || [];
    if (!placeState || placeState.roomId !== rid) {
      placeState = { roomId: rid, ships: {}, dir: 'h', selected: fleet[0] ? fleet[0].id : null, submitted: false };
    }
    return placeState;
  }
  function cellsFor(def, r, c, dir) {
    var cells = [];
    for (var i = 0; i < def.size; i++) cells.push(dir === 'v' ? [r + i, c] : [r, c + i]);
    return cells;
  }
  function cellsValid(cells) {
    for (var i = 0; i < cells.length; i++) {
      var r = cells[i][0], c = cells[i][1];
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
    }
    return true;
  }
  function shipAtLocal(ships, r, c) {
    for (var id in ships) {
      if (!ships.hasOwnProperty(id)) continue;
      var cells = ships[id].cells;
      for (var i = 0; i < cells.length; i++) if (cells[i][0] === r && cells[i][1] === c) return id;
    }
    return null;
  }
  function cellsOverlap(cells, ships, ignoreId) {
    for (var id in ships) {
      if (!ships.hasOwnProperty(id) || id === ignoreId) continue;
      var occ = ships[id].cells;
      for (var i = 0; i < cells.length; i++) {
        for (var j = 0; j < occ.length; j++) {
          if (cells[i][0] === occ[j][0] && cells[i][1] === occ[j][1]) return true;
        }
      }
    }
    return false;
  }
  function nextUnplaced(fleetDefs, ships) {
    for (var i = 0; i < fleetDefs.length; i++) if (!ships[fleetDefs[i].id]) return fleetDefs[i].id;
    return null;
  }
  function randomPlacement(fleetDefs) {
    for (var attempt = 0; attempt < 400; attempt++) {
      var ships = {}, ok = true;
      for (var i = 0; i < fleetDefs.length; i++) {
        var def = fleetDefs[i], placed = false;
        for (var tries = 0; tries < 60 && !placed; tries++) {
          var dir = Math.random() < 0.5 ? 'h' : 'v';
          var r = Math.floor(Math.random() * SIZE), c = Math.floor(Math.random() * SIZE);
          var cells = cellsFor(def, r, c, dir);
          if (cellsValid(cells) && !cellsOverlap(cells, ships, def.id)) {
            ships[def.id] = { dir: dir, r: r, c: c, cells: cells };
            placed = true;
          }
        }
        if (!placed) { ok = false; break; }
      }
      if (ok) return ships;
    }
    return {};
  }

  function renderPlacement(m) {
    var s = m.state, ps = ensurePlaceState(m);
    var fleet = s.fleetDefs || [];
    var size = s.size || SIZE;
    var mineReady = !!(s.ready && s.ready.mine) || ps.submitted;
    var oppReady = !!(s.ready && s.ready.opponent);
    var secs = Math.max(0, Math.ceil((Number(s.turnRemainingMs) || 0) / 1000));

    var h = '<div class="bs-wrap"><div class="bs-place">';
    h += '<div class="bs-place-head"><h3>🚢 Filonu Yerleştir</h3><p>' +
      (mineReady
        ? ('Filon hazır — rakibi bekliyorsun' + (oppReady ? '' : ' ⏳'))
        : 'Aşağıdan bir gemi seç, yönünü ayarla, sonra ızgarada yerini işaretle.') +
      '</p>' + (!mineReady && secs > 0 && secs < 999 ? '<div class="bs-countdown">⏱️ ' + secs + ' sn</div>' : '') + '</div>';

    if (!mineReady) {
      h += '<div class="bs-fleet-list">';
      fleet.forEach(function (def) {
        var placed = !!ps.ships[def.id];
        var sel = ps.selected === def.id;
        h += '<button type="button" class="bs-fleet-btn ' + shipCssKind(def.id) + (placed ? ' placed' : '') + (sel ? ' sel' : '') +
          '" data-ship="' + def.id + '">🚢 ' + def.name + ' <span class="bs-fleet-size">(' + def.size + ')</span>' +
          (placed ? ' ✓' : '') + '</button>';
      });
      h += '</div><div class="bs-place-tools">' +
        '<button type="button" class="btn btn-o bs-rotate">↻ Yön: ' + (ps.dir === 'h' ? 'Yatay' : 'Dikey') + '</button>' +
        '<button type="button" class="btn btn-o bs-shuffle">🎲 Rastgele Yerleştir</button>' +
        '<button type="button" class="btn btn-o bs-clear">🗑️ Sıfırla</button></div>';
    }

    h += '<div class="bs-grid-wrap"><div class="bs-grid">' + gridHeader(size);
    for (var r = 0; r < size; r++) {
      h += '<div class="bs-row"><div class="bs-rowlabel">' + (r + 1) + '</div>';
      for (var c = 0; c < size; c++) {
        var shipHere = shipAtLocal(ps.ships, r, c);
        var cls = 'bs-cell' + (shipHere ? ' ship ' + shipCssKind(shipHere) : ' empty');
        h += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '"></div>';
      }
      h += '</div>';
    }
    h += '</div></div>';

    if (!mineReady) {
      var allPlaced = fleet.length > 0 && fleet.every(function (def) { return !!ps.ships[def.id]; });
      h += '<button type="button" class="btn btn-p bs-ready-btn"' + (allPlaced ? '' : ' disabled') + '>✅ Filoyu Onayla</button>';
    }
    h += '</div></div>';
    return h;
  }

  // -------------------------------------------------------------------- ÇARPIŞMA
  var shotLog = { roomId: null, items: [] };
  function resetLogIfNeeded(rid) {
    if (shotLog.roomId !== rid) shotLog = { roomId: rid, items: [] };
  }
  function logShot(rid, p, isMe) {
    resetLogIfNeeded(rid);
    var coord = coordText(p.r, p.c);
    var txt = (isMe ? 'Sen' : 'Rakip') + ' → ' + coord + ': ' +
      (p.result === 'miss' ? 'Iska' : p.result === 'sunk' ? (((p.sunkShip && p.sunkShip.name) || 'Gemi') + ' battı!') : 'İsabet');
    shotLog.items.unshift({ text: txt, mine: isMe, result: p.result });
    if (shotLog.items.length > 8) shotLog.items.length = 8;
  }
  function renderLog() {
    if (!shotLog.items.length) return '<div class="bs-log-empty">Henüz atış yok.</div>';
    return shotLog.items.map(function (it) {
      return '<div class="bs-log-item ' + (it.mine ? 'mine' : 'opp') + ' ' + it.result + '">' + it.text + '</div>';
    }).join('');
  }

  function voiceOn() {
    try { return localStorage.getItem('gv-bs-voice') !== 'off'; } catch (_) { return true; }
  }
  function setVoiceOn(on) {
    try { localStorage.setItem('gv-bs-voice', on ? 'on' : 'off'); } catch (_) {}
  }
  function speak(p, isMe) {
    if (!voiceOn() || !window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') return;
    var coord = coordText(p.r, p.c);
    var phrase;
    if (p.result === 'sunk') {
      var ad = (p.sunkShip && p.sunkShip.name) || 'gemi';
      phrase = isMe ? (ad + ' battırıldı, ' + coord) : ('Filonuzdan ' + ad + ' battı, ' + coord);
    } else if (p.result === 'hit') {
      phrase = isMe ? ('İsabet, ' + coord) : ('İsabet aldınız, ' + coord);
    } else {
      phrase = isMe ? ('Iska, ' + coord) : ('Rakip ıskaladı, ' + coord);
    }
    try {
      var u = new SpeechSynthesisUtterance(phrase);
      u.lang = 'tr-TR'; u.rate = 1.05;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
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
  function gridHeader(size) {
    var h = '<div class="bs-row bs-head"><div class="bs-rowlabel"></div>';
    for (var c = 0; c < size; c++) h += '<div class="bs-collabel">' + colLetter(c) + '</div>';
    return h + '</div>';
  }

  function renderBattle(m) {
    var s = m.state, size = s.size || SIZE;
    var myTurn = !m.isSpectator && s.turn === m.seat;
    var sunkIds = {};
    (s.enemyFleet || []).forEach(function (f) { if (f.sunk) sunkIds[f.id] = true; });

    var h = '<div class="bs-wrap">';
    h += '<div class="bs-status' + (myTurn ? ' mine' : '') + '">' +
      (m.isSpectator ? '👁️ İzleyici' : (myTurn ? '🎯 Sıra sende — ateş et!' : '⏳ Rakip nişan alıyor…')) +
      '<button type="button" class="bs-voice-toggle" title="Seslendirme aç/kapat">' + (voiceOn() ? '🔊' : '🔇') + '</button></div>';

    h += '<div class="bs-battlefield">';
    // --- Kendi filom (üzerime gelen atışlar) ---
    h += '<div class="bs-board-col"><h4>🛡️ Filon</h4><div class="bs-grid bs-mine-grid">' + gridHeader(size);
    for (var r = 0; r < size; r++) {
      h += '<div class="bs-row"><div class="bs-rowlabel">' + (r + 1) + '</div>';
      for (var c = 0; c < size; c++) {
        var mine = (s.myShips || []).some(function (sh) { return sh.cells.some(function (cc) { return cc[0] === r && cc[1] === c; }); });
        var shot = findShot(s.incomingShots, r, c);
        var sunk = shot && shot.shipId && (s.myShips || []).some(function (sh) { return sh.id === shot.shipId && sh.hits.every(Boolean); });
        var cls = 'bs-cell' + (mine ? ' ship' : '');
        if (shot) cls += shot.result === 'miss' ? ' miss' : (sunk ? ' sunk' : ' hit');
        if (isLatest(s.incomingShots, r, c)) cls += ' bs-latest';
        h += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '"></div>';
      }
      h += '</div>';
    }
    h += '</div></div>';

    // --- Rakip suları (benim attığım atışlar) ---
    h += '<div class="bs-board-col"><h4>🌊 Rakip Suları</h4><div class="bs-grid bs-enemy-grid">' + gridHeader(size);
    for (var r2 = 0; r2 < size; r2++) {
      h += '<div class="bs-row"><div class="bs-rowlabel">' + (r2 + 1) + '</div>';
      for (var c2 = 0; c2 < size; c2++) {
        var shot2 = findShot(s.myShots, r2, c2);
        var cls2 = 'bs-cell';
        if (shot2) cls2 += shot2.result === 'miss' ? ' miss' : (sunkIds[shot2.shipId] ? ' sunk' : ' hit');
        else cls2 += myTurn ? ' live' : ' fog';
        if (isLatest(s.myShots, r2, c2)) cls2 += ' bs-latest';
        h += '<div class="' + cls2 + '" data-board="enemy" data-r="' + r2 + '" data-c="' + c2 + '"></div>';
      }
      h += '</div>';
    }
    h += '</div></div>';
    h += '</div>'; // bs-battlefield

    h += '<div class="bs-fleet-status"><div class="bs-fleet-status-title">🚩 Rakip Filosu</div><div class="bs-fleet-status-list">';
    (s.enemyFleet || []).forEach(function (f) {
      h += '<span class="bs-fleet-chip' + (f.sunk ? ' sunk' : '') + '">🚢 ' + f.name + (f.sunk ? ' 💥' : '') + '</span>';
    });
    h += '</div></div>';

    h += '<div class="bs-log">' + renderLog() + '</div>';
    h += '</div>'; // bs-wrap
    return h;
  }

  define({
    id: 'battleship', kinds: ['battleship'], reject: ['battleshipRejected'],
    render: function (m) {
      var s = m.state;
      if (!s) return '';
      return s.phase === 'battle' || s.phase === 'finished' ? renderBattle(m) : renderPlacement(m);
    },
    events: {
      battleshipShotResult: function (p) {
        if (!p || !window.GVArena) return;
        var rid = String(p.roomId == null ? '' : p.roomId);
        if (String(GVArena.roomId()) !== rid) return; // başka/eski odanın paketi
        var mySeat = GVArena.seat();
        var isMe = mySeat !== null && mySeat !== undefined && p.seat === mySeat;
        logShot(rid, p, isMe);
        speak(p, isMe);
        if (window.GV && GV.toast) {
          var coord = coordText(p.r, p.c);
          var txt = (isMe ? '🎯 Sen ' : '💥 Rakip ') + coord + ': ' +
            (p.result === 'miss' ? 'Iska' : (p.result === 'sunk' ? (((p.sunkShip && p.sunkShip.name) || 'Gemi') + ' battı!') : 'İsabet!'));
          GV.toast(txt, p.result === 'miss' ? 'info' : (p.result === 'sunk' ? 'success' : 'warning'));
        }
        GVArena.repaint();
      }
    },
    bind: function (root, m) {
      var s = m.state;
      if (!s) return;

      if (s.phase === 'placing') {
        var ps = ensurePlaceState(m);
        var mineReady = !!(s.ready && s.ready.mine) || ps.submitted;

        root.querySelectorAll('.bs-fleet-btn').forEach(function (btn) {
          btn.addEventListener('click', function () {
            if (mineReady) return;
            var id = btn.dataset.ship;
            if (ps.ships[id]) { delete ps.ships[id]; ps.selected = id; }
            else ps.selected = id;
            if (window.GVArena) GVArena.repaint();
          });
        });
        var rotateBtn = root.querySelector('.bs-rotate');
        if (rotateBtn) rotateBtn.addEventListener('click', function () {
          ps.dir = ps.dir === 'h' ? 'v' : 'h';
          if (window.GVArena) GVArena.repaint();
        });
        var shuffleBtn = root.querySelector('.bs-shuffle');
        if (shuffleBtn) shuffleBtn.addEventListener('click', function () {
          ps.ships = randomPlacement(s.fleetDefs || []);
          ps.selected = nextUnplaced(s.fleetDefs || [], ps.ships);
          if (window.GVArena) GVArena.repaint();
        });
        var clearBtn = root.querySelector('.bs-clear');
        if (clearBtn) clearBtn.addEventListener('click', function () {
          ps.ships = {};
          ps.selected = (s.fleetDefs || [])[0] ? s.fleetDefs[0].id : null;
          if (window.GVArena) GVArena.repaint();
        });
        root.querySelectorAll('.bs-grid .bs-cell').forEach(function (cell) {
          cell.addEventListener('click', function () {
            if (mineReady) return;
            var r = Number(cell.dataset.r), c = Number(cell.dataset.c);
            var existing = shipAtLocal(ps.ships, r, c);
            if (existing) { delete ps.ships[existing]; ps.selected = existing; if (window.GVArena) GVArena.repaint(); return; }
            if (!ps.selected) { if (window.GV && GV.toast) GV.toast('Önce yerleştirilecek gemiyi seç.', 'warning'); return; }
            var def = (s.fleetDefs || []).find(function (d) { return d.id === ps.selected; });
            if (!def) return;
            var cells = cellsFor(def, r, c, ps.dir);
            if (!cellsValid(cells) || cellsOverlap(cells, ps.ships, ps.selected)) {
              if (window.GV && GV.toast) GV.toast('Buraya sığmıyor ya da başka bir gemiyle çakışıyor.', 'warning');
              return;
            }
            ps.ships[ps.selected] = { dir: ps.dir, r: r, c: c, cells: cells };
            ps.selected = nextUnplaced(s.fleetDefs || [], ps.ships);
            if (window.GVArena) GVArena.repaint();
          });
        });
        var readyBtn = root.querySelector('.bs-ready-btn');
        if (readyBtn) readyBtn.addEventListener('click', function () {
          if (readyBtn.disabled || ps.submitted) return;
          var placements = (s.fleetDefs || []).map(function (def) {
            var pl = ps.ships[def.id];
            return { shipId: def.id, r: pl.r, c: pl.c, dir: pl.dir };
          });
          ps.submitted = true;
          m.emit('battleshipPlace', { placements: placements });
          if (window.GVArena) GVArena.repaint();
        });
        return;
      }

      // 'battle' fazı
      var voiceBtn = root.querySelector('.bs-voice-toggle');
      if (voiceBtn) voiceBtn.addEventListener('click', function () {
        setVoiceOn(!voiceOn());
        if (window.GVArena) GVArena.repaint();
      });
      root.querySelectorAll('.bs-enemy-grid .bs-cell.live').forEach(function (cell) {
        cell.addEventListener('click', function () {
          if (m.isSpectator) return;
          m.emit('battleshipFire', { r: Number(cell.dataset.r), c: Number(cell.dataset.c) });
        });
      });
    }
  });
})();
