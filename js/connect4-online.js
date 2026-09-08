/* GameVerse — Online Connect4. Yaşam döngüsü js/online-arena.js'te. */
(function () {
  'use strict';
  if (window.__gvConnect4OnlineLoaded) return;
  window.__gvConnect4OnlineLoaded = true;
  // Arena henüz yüklenmediyse tanımı kuyruğa bırak (yükleme sırası önemsiz).
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  define({
    id: 'connect4', kinds: ['connect4'], reject: ['connect4Rejected'],
    render: function (m) {
      var s = m.state, mine = (s.turn === s.playerColor) && !m.isSpectator;
      var h = '<div class="c4-wrap"><div class="dama-status">' +
        (s.turn === 'r' ? '🔴 Kırmızı' : '🟡 Sarı') + ' sırası' +
        (m.isSpectator ? ' • 👁️ İzleyici' : (mine ? ' • 👉 Sizin sıranız' : '')) +
        '</div><div class="c4-drop-row">';
      for (var c = 0; c < 7; c++) {
        h += '<button class="c4-drop-btn" data-c="' + c + '"' +
          ((s.board[0][c] || !mine) ? ' disabled' : '') + '>⬇</button>';
      }
      h += '</div><div class="c4-board">';
      for (var r = 0; r < 6; r++) for (var k = 0; k < 7; k++) {
        h += '<div class="c4-c">' + (s.board[r][k] ? '<div class="c4-pc ' + s.board[r][k] + '"></div>' : '') + '</div>';
      }
      return h + '</div></div>';
    },
    bind: function (root, m) {
      root.querySelectorAll('[data-c]').forEach(function (x) {
        x.addEventListener('click', function () {
          if (m.isSpectator) return;
          m.emit('connect4Move', { col: Number(x.dataset.c) });
        });
      });
    }
  });
})();
