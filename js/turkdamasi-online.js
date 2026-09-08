/* GameVerse — Online Türk Daması. Yaşam döngüsü js/online-arena.js'te.
 * NOT: eski sürüm odaya gameId:'dama' ile katılıyordu (yanlış oyun kimliği).
 *
 * SEÇİM GÖSTERİMİ: İngiliz damasıyla birebir aynı kurallar — oynanabilir
 * taşlar halkalı, seçilen taş vurgulu, gidilebilecek kareler sarı,
 * yenebilecek kareler kırmızı. (Kullanıcı raporu: "tıkladığım taşın hangi
 * taş olduğu gözükmüyor".)
 */
(function () {
  'use strict';
  if (window.__gvTurkdamasiOnlineLoaded) return;
  window.__gvTurkdamasiOnlineLoaded = true;
  window.__gvTurkDamaOnlineLoaded = true;          // eski bayrak adı (geriye dönük)
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  var sel = null;
  var selState = null;

  function ayni(a, r, c) { return !!a && a[0] === r && a[1] === c; }

  define({
    id: 'turkdamasi', kinds: ['turkdamasi'], reject: ['turkDamaRejected', 'damaRejected'],

    render: function (m) {
      var s = m.state;
      var mine = (s.turn === s.playerColor) && !m.isSpectator;
      if (selState !== s) { sel = null; selState = s; }
      if (!mine) sel = null;

      var lm = (s.legalMoves || []);
      var hedefler = sel ? lm.filter(function (x) { return ayni(sel, x.from[0], x.from[1]); }) : [];
      // Türk damasında yeme ZORUNLUDUR: yiyebilen taş varsa yalnız onlar oynar.
      var zorunluYeme = mine && lm.some(function (x) { return x.captures && x.captures.length; });

      var h = '<div class="dama-wrap"><div class="dama-status">' +
        (s.turn === 'w' ? '⚪ Beyaz' : '⚫ Siyah') + ' sırası' +
        (m.isSpectator ? ' • 👁️ İzleyici' : (mine ? ' • 👉 Sizin sıranız' : ' • ⏳ Rakip düşünüyor')) +
        (zorunluYeme && !sel ? ' — ⚠️ yeme zorunlu' : (mine && !sel ? ' — oynatmak istediğiniz taşa dokunun' : '')) +
        '</div><div class="dama-board">';

      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
        var p = s.board[r][c];
        var cls = 'dama-c ' + ((r + c) % 2 ? 'd' : 'l');
        if (mine && lm.some(function (x) { return x.from[0] === r && x.from[1] === c; })) cls += ' movable';
        if (ayni(sel, r, c)) cls += ' sel';
        var hedef = hedefler.filter(function (x) { return x.to[0] === r && x.to[1] === c; })[0];
        if (hedef) cls += (hedef.captures && hedef.captures.length) ? ' target target-eat' : ' target';
        h += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '">' +
          (p ? '<div class="dama-pc ' + (p.toLowerCase() === 'w' ? 'r' : 'b') +
               (p === p.toUpperCase() ? ' king' : '') + '"></div>' : '') +
          '</div>';
      }
      return h + '</div></div>';
    },

    bind: function (root, m) {
      root.querySelectorAll('.dama-c').forEach(function (x) {
        x.addEventListener('click', function () {
          if (m.isSpectator) return;
          var r = Number(x.dataset.r), c = Number(x.dataset.c);

          if (sel && x.classList.contains('target')) {
            m.emit('damaMove', { from: sel, to: [r, c] });
            sel = null;
            if (m.repaint) m.repaint();
            return;
          }
          if (ayni(sel, r, c)) { sel = null; if (m.repaint) m.repaint(); return; }
          if (x.classList.contains('movable')) {
            sel = [r, c];
            if (m.repaint) m.repaint();
            return;
          }
          if (sel) { sel = null; if (m.repaint) m.repaint(); return; }

          var s = m.state;
          if (s && s.turn !== s.playerColor) {
            if (window.GV && GV.toast) GV.toast('⏳ Sıra sizde değil.', 'info', 1800);
          } else if (s && s.board[r][c]) {
            var zorunlu = (s.legalMoves || []).some(function (q) { return q.captures && q.captures.length; });
            if (window.GV && GV.toast) {
              GV.toast(zorunlu ? '⚠️ Yeme zorunlu — yiyebilen taşlardan birini oynayın.'
                               : '🚫 Bu taşın oynayabileceği hamle yok.', 'warning', 2200);
            }
          }
        });
      });
    }
  });
})();
