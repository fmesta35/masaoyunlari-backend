/* GameVerse — Online Reversi. Yaşam döngüsü js/online-arena.js'te. */
(function () {
  'use strict';
  if (window.__gvReversiOnlineLoaded) return;
  window.__gvReversiOnlineLoaded = true;
  // Arena henüz yüklenmediyse tanımı kuyruğa bırak (yükleme sırası önemsiz).
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  define({
    id: 'reversi', kinds: ['reversi'], reject: ['reversiRejected'],
    render: function (m) {
      var s = m.state, flat = s.board.flat ? s.board.flat() : [].concat.apply([], s.board);
      var mine = (s.turn === s.playerColor) && !m.isSpectator;
      var h = '<div class="rv-wrap"><div class="dama-status">⚫ ' +
        flat.filter(function (x) { return x === 'b'; }).length + ' - ⚪ ' +
        flat.filter(function (x) { return x === 'w'; }).length + ' | Sıra: ' +
        (s.turn === 'b' ? '⚫ Siyah' : '⚪ Beyaz') +
        (m.isSpectator ? ' • 👁️ İzleyici' : (mine ? ' • 👉 Sizin sıranız' : '')) +
        '</div><div class="rv-board">';
      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
        var p = s.board[r][c];
        var ok = mine && (s.legalMoves || []).some(function (x) { return x.to[0] === r && x.to[1] === c; });
        h += '<div class="rv-c' + (ok ? ' valid' : '') + '" data-r="' + r + '" data-c="' + c + '">' +
          (p ? '<div class="rv-pc ' + p + '"></div>' : '') + '</div>';
      }
      return h + '</div></div>';
    },
    bind: function (root, m) {
      root.querySelectorAll('.rv-c').forEach(function (x) {
        x.addEventListener('click', function () {
          if (m.isSpectator) return;
          m.emit('reversiMove', { r: Number(x.dataset.r), c: Number(x.dataset.c) });
        });
      });
    }
  });
})();
