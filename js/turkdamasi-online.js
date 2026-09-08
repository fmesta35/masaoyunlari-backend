/* GameVerse — Online Türk Daması. Yaşam döngüsü js/online-arena.js'te.
 * NOT: eski sürüm odaya gameId:'dama' ile katılıyordu (yanlış oyun kimliği). */
(function () {
  'use strict';
  if (window.__gvTurkdamasiOnlineLoaded) return;
  window.__gvTurkdamasiOnlineLoaded = true;
  window.__gvTurkDamaOnlineLoaded = true;          // eski bayrak adı (geriye dönük)
  // Arena henüz yüklenmediyse tanımı kuyruğa bırak (yükleme sırası önemsiz).
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };
  var sel = null;

  define({
    id: 'turkdamasi', kinds: ['turkdamasi'], reject: ['turkDamaRejected', 'damaRejected'],
    render: function (m) {
      var s = m.state, mine = (s.turn === s.playerColor) && !m.isSpectator;
      var h = '<div class="dama-wrap"><div class="dama-status">' +
        (s.turn === 'w' ? '⚪ Beyaz' : '⚫ Siyah') + ' sırası' +
        (m.isSpectator ? ' • 👁️ İzleyici' : (mine ? ' • 👉 Sizin sıranız' : '')) +
        '</div><div class="dama-board">';
      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
        var p = s.board[r][c];
        var ok = mine && (s.legalMoves || []).some(function (x) { return x.from[0] === r && x.from[1] === c; });
        h += '<div class="dama-c ' + ((r + c) % 2 ? 'd' : 'l') + (ok ? ' valid' : '') +
          '" data-r="' + r + '" data-c="' + c + '">' +
          (p ? '<div class="dama-pc ' + (p.toLowerCase() === 'w' ? 'r' : 'b') + (p === p.toUpperCase() ? ' king' : '') + '"></div>' : '') +
          '</div>';
      }
      return h + '</div></div>';
    },
    bind: function (root, m) {
      sel = null;
      root.querySelectorAll('.dama-c').forEach(function (x) {
        x.addEventListener('click', function () {
          if (m.isSpectator) return;
          var q = [Number(x.dataset.r), Number(x.dataset.c)];
          if (!sel) {
            if (!x.classList.contains('valid')) return;
            sel = q; x.classList.add('sel'); return;
          }
          m.emit('damaMove', { from: sel, to: q });
          sel = null;
        });
      });
    }
  });
})();
