/* GameVerse — Online Gomoku. Yaşam döngüsü js/online-arena.js'te. */
(function () {
  'use strict';
  if (window.__gvGomokuOnlineLoaded) return;
  window.__gvGomokuOnlineLoaded = true;
  // Arena henüz yüklenmediyse tanımı kuyruğa bırak (yükleme sırası önemsiz).
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  define({
    id: 'gomoku', kinds: ['gomoku'], reject: ['gomokuRejected'],
    render: function (m) {
      var s = m.state, mine = (s.turn === s.playerColor) && !m.isSpectator;
      var h = '<div class="gm-wrap"><div class="dama-status">Sıra: ' +
        (s.turn === 'b' ? '⚫ Siyah' : '⚪ Beyaz') +
        (m.isSpectator ? ' • 👁️ İzleyici' : (mine ? ' • 👉 Sizin sıranız' : '')) +
        '</div><div class="gm-board">';
      for (var r = 0; r < 15; r++) for (var c = 0; c < 15; c++) {
        var p = s.board[r][c];
        h += '<div class="gm-c" data-r="' + r + '" data-c="' + c + '">' +
          (p ? '<div class="gm-pc ' + p + '"></div>' : '') + '</div>';
      }
      return h + '</div></div>';
    },
    bind: function (root, m) {
      root.querySelectorAll('.gm-c').forEach(function (x) {
        x.addEventListener('click', function () {
          if (m.isSpectator) return;
          m.emit('gomokuMove', { r: Number(x.dataset.r), c: Number(x.dataset.c) });
        });
      });
    }
  });
})();
