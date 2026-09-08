/* GameVerse — Online İngiliz Daması. Yaşam döngüsü js/online-arena.js'te.
 *
 * SEÇİM GÖSTERİMİ (kullanıcı raporu): "tıkladığım taşın hangi taş olduğu
 * gözükmüyor". Eskiden oynanabilir HER taşa yeşil nokta konuyor, seçilen
 * taş yalnızca ince bir çerçeve alıyor, gidebileceği kareler ise hiç
 * gösterilmiyordu. Artık satrançtaki gibi:
 *   • oynanabilir taşlar hafif bir halka ile belirtilir,
 *   • seçilen taş belirgin biçimde vurgulanır,
 *   • gidebileceği kareler sarı nokta, yiyebileceği kareler kırmızı ile
 *     işaretlenir.
 */
(function () {
  'use strict';
  if (window.__gvDamaOnlineLoaded) return;
  window.__gvDamaOnlineLoaded = true;
  // Arena henüz yüklenmediyse tanımı kuyruğa bırak (yükleme sırası önemsiz).
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  var sel = null;        // seçili kare [r,c]
  var selState = null;   // seçimin yapıldığı sunucu durumu (değişince seçim düşer)

  function ayni(a, r, c) { return !!a && a[0] === r && a[1] === c; }
  function hamleler(s) { return (s && s.legalMoves) || []; }

  define({
    id: 'dama', kinds: ['dama'], reject: ['damaRejected'],

    render: function (m) {
      var s = m.state;
      var mine = (s.turn === s.playerColor) && !m.isSpectator;
      // Sunucudan yeni durum geldiyse seçim geçersizdir.
      if (selState !== s) { sel = null; selState = s; }
      if (!mine) sel = null;

      var lm = hamleler(s);
      var hedefler = sel ? lm.filter(function (x) { return ayni(sel, x.from[0], x.from[1]); }) : [];

      var h = '<div class="dama-wrap"><div class="dama-status">' +
        (s.turn === 'r' ? '🔴 Kırmızı' : '⚫ Siyah') + ' sırası' +
        (m.isSpectator ? ' • 👁️ İzleyici' : (mine ? ' • 👉 Sizin sıranız' : ' • ⏳ Rakip düşünüyor')) +
        (mine && !sel ? ' — oynatmak istediğiniz taşa dokunun' : '') +
        '</div><div class="dama-board">';

      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
        var p = s.board[r][c];
        var cls = 'dama-c ' + ((r + c) % 2 ? 'd' : 'l');
        if (mine && lm.some(function (x) { return x.from[0] === r && x.from[1] === c; })) cls += ' movable';
        if (ayni(sel, r, c)) cls += ' sel';
        var hedef = hedefler.filter(function (x) { return x.to[0] === r && x.to[1] === c; })[0];
        if (hedef) cls += (hedef.captures && hedef.captures.length) ? ' target target-eat' : ' target';
        h += '<div class="' + cls + '" data-r="' + r + '" data-c="' + c + '">' +
          (p ? '<div class="dama-pc ' + (p.toLowerCase() === 'r' ? 'r' : 'b') +
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

          // 1) Hedef kareye dokunuldu → hamleyi gönder
          if (sel && x.classList.contains('target')) {
            m.emit('damaMove', { from: sel, to: [r, c] });
            sel = null;
            if (m.repaint) m.repaint();
            return;
          }
          // 2) Seçili taşa tekrar dokunuldu → seçimi bırak
          if (ayni(sel, r, c)) { sel = null; if (m.repaint) m.repaint(); return; }
          // 3) Oynanabilir bir taşa dokunuldu → seç (başka taş seçiliyse değiştir)
          if (x.classList.contains('movable')) {
            sel = [r, c];
            if (m.repaint) m.repaint();
            return;
          }
          // 4) Boş/oynanamaz kare → seçimi temizle, sebebini söyle
          if (sel) { sel = null; if (m.repaint) m.repaint(); return; }
          if (m.state && m.state.turn !== m.state.playerColor) {
            if (window.GV && GV.toast) GV.toast('⏳ Sıra sizde değil.', 'info', 1800);
          } else if (m.state && m.state.board[r][c]) {
            if (window.GV && GV.toast) GV.toast('🚫 Bu taşın oynayabileceği hamle yok.', 'warning', 1800);
          }
        });
      });
    }
  });
})();
