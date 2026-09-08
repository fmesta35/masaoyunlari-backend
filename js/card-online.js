/* GameVerse — Pişti / Batak online kart masaları. Sunucu yetkilidir.
 * Yaşam döngüsü js/online-arena.js'e devredildi: oda değişince kendiliğinden
 * susar (eskiden 500 ms'lik interval Okey masasının üstüne Pişti basıyordu).
 */
(function () {
  'use strict';
  if (window.__gvCardOnlineLoaded) return;
  window.__gvCardOnlineLoaded = true;
  // Arena henüz yüklenmediyse tanımı kuyruğa bırak (yükleme sırası önemsiz).
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var isRed = function (s) { return s === '♥' || s === '♦'; };
  var cardHtml = function (c, extra) {
    return '<div class="pcard ' + (isRed(c.s) ? 'red' : 'black') + '"' + (extra || '') + '>' +
      '<div class="cr">' + esc(c.r) + '</div><div class="cs">' + esc(c.s) + '</div></div>';
  };

  define({
    id: 'card',
    kinds: ['pisti', 'batak'],
    reject: ['pistiRejected', 'batakRejected'],

    render: function (m) {
      var s = m.state;
      var pisti = s.kind === 'pisti';
      var myTurn = (s.turn === m.seat) && !m.isSpectator;
      var h = '<div class="card-wrap" style="max-width:760px;margin:auto"><div class="card-score">';
      h += '<b>' + (pisti ? '🃏 PİŞTİ' : '🎯 BATAK') + '</b>';
      h += '<span>⏱ <span class="gv-arena-clock">0 sn</span></span>';
      h += '<span>Skor: ' + esc((s.scores || []).join(' / ')) + '</span>';
      if (!pisti) {
        h += '<span>İhaleler: ' + esc((s.bids || []).map(function (b) { return b == null ? '—' : b; }).join(' / ')) + '</span>';
        h += '<span>Koz: ' + esc(s.trump || '—') + '</span>';
      }
      h += '</div><div class="card-table"><div class="card-center-pile">';
      var pile = s.center || s.trick || [];
      h += pile.length ? pile.map(function (c) { return cardHtml(c, ''); }).join('')
                       : '<span style="color:#aaa">Masa</span>';
      h += '</div></div>';
      h += '<div class="gv-card-turn">' + (m.isSpectator ? '👁️ İzleyici' : (myTurn ? '👉 Sıra sizde' : '⏳ Rakip oynuyor...')) + '</div>';
      h += '<div class="hand-row">';
      (s.hand || []).forEach(function (c, i) {
        h += '<button class="pcard ' + (isRed(c.s) ? 'red' : 'black') + '" data-i="' + i + '"' +
          (myTurn && s.phase !== 'bid' && s.phase !== 'trump' ? '' : ' disabled') +
          ' style="cursor:pointer"><div class="cr">' + esc(c.r) + '</div><div class="cs">' + esc(c.s) + '</div></button>';
      });
      h += '</div>';
      if (!pisti && s.phase === 'bid' && myTurn) {
        h += '<div class="gv-card-actions">';
        [4, 5, 6, 7, 8, 9, 10, 11, 12, 13].forEach(function (v) { h += '<button data-bid="' + v + '">' + v + '</button>'; });
        h += '<button data-bid="pass">Pas</button></div>';
      }
      if (!pisti && s.phase === 'trump' && myTurn) {
        h += '<div class="gv-card-actions">';
        ['♠', '♥', '♦', '♣'].forEach(function (v) { h += '<button data-trump="' + v + '">' + v + '</button>'; });
        h += '</div>';
      }
      return h + '</div>';
    },

    bind: function (root, m) {
      var pisti = m.state.kind === 'pisti';
      root.querySelectorAll('[data-i]').forEach(function (b) {
        b.addEventListener('click', function () {
          m.emit(pisti ? 'pistiPlay' : 'batakPlay', { index: Number(b.dataset.i) });
        });
      });
      root.querySelectorAll('[data-bid]').forEach(function (b) {
        b.addEventListener('click', function () {
          m.emit('batakBid', { value: b.dataset.bid === 'pass' ? 'pass' : Number(b.dataset.bid) });
        });
      });
      root.querySelectorAll('[data-trump]').forEach(function (b) {
        b.addEventListener('click', function () { m.emit('batakTrump', { suit: b.dataset.trump }); });
      });
    }
  });
})();
