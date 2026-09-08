/* GameVerse — Online Bilardo. Yaşam döngüsü js/online-arena.js'te. */
(function () {
  'use strict';
  if (window.__gvBilardoOnlineLoaded) return;
  window.__gvBilardoOnlineLoaded = true;
  // Arena henüz yüklenmediyse tanımı kuyruğa bırak (yükleme sırası önemsiz).
  var define = function (d) {
    if (window.GVArena) return window.GVArena.define(d);
    (window.__gvArenaQueue = window.__gvArenaQueue || []).push(d);
  };

  define({
    id: 'bilardo', kinds: ['bilardo'], reject: ['bilardoRejected'],
    render: function (m) {
      var s = m.state, mine = (s.turn === m.seat) && !m.isSpectator;
      var h = '<div class="bil-wrap"><div class="bil-info">🎱 Sıra: ' +
        (s.turn === 0 ? 'Oyuncu 1' : 'Oyuncu 2') + '　 Skor: ' + (s.score || []).join(' - ') +
        (m.isSpectator ? '　 👁️ İzleyici' : (mine ? '　 👉 Sizin sıranız' : '')) +
        '</div><div class="bil-table" style="position:relative;width:min(90vw,640px);height:min(45vw,320px);min-height:220px;margin:auto;background:#087442;border:20px solid #3d2415;border-radius:14px">';
      (s.balls || []).filter(function (b) { return !b.potted; }).forEach(function (b) {
        var col = b.type === 'cue' ? '#fff' : b.type === 'eight' ? '#111' : b.type === 'stripe' ? '#f5d76e' : '#e74c3c';
        // Top boyu da YÜZDELİ: masa dar ekranda küçülünce toplar da
        // küçülür (sabit 24 px'te toplar masayı ve cepleri taşırıyordu).
        h += '<div style="position:absolute;left:' + ((b.x / 640) * 100) + '%;top:' + ((b.y / 320) * 100) +
          '%;width:3.75%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:' + col + ';border:2px solid #ddd;box-sizing:border-box"></div>';
      });
      h += '</div><div style="display:flex;gap:8px;justify-content:center;align-items:center;margin-top:12px">' +
        '<label style="font-size:.85em">Güç <input id="bilPower" type="range" min="1" max="10" value="5"></label>' +
        '<label style="font-size:.85em">Açı <input id="bilAngle" type="range" min="0" max="359" value="0"></label>' +
        '<button id="bilShoot" class="btn btn-p btn-sm"' + (mine ? '' : ' disabled') + '>🎱 Vur</button></div></div>';
      return h;
    },
    bind: function (root, m) {
      var b = root.querySelector('#bilShoot');
      if (!b) return;
      b.addEventListener('click', function () {
        if (m.isSpectator) return;
        m.emit('bilardoShoot', {
          angle: Number(root.querySelector('#bilAngle').value) * Math.PI / 180,
          power: Number(root.querySelector('#bilPower').value)
        });
      });
    }
  });
})();
