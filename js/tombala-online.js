/* ============================================================================
 * TOMBALA — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Tombalada oyuncu hamlesi yoktur: sunucu belirli aralıklarla bir top çeker,
 * kartlar kendiliğinden kapanır. Bu yüzden burada tıklanacak bir tahta da
 * yok — ekran ÇEKİLEN TOP, torba durumu, herkesin kartı ve ödül panosundan
 * ibarettir. Kurallar ve çekiliş tamamen sunucudadır (tombala-engine.js);
 * bu dosya yalnız ÇİZER.
 *
 * Ortak yaşam döngüsüne (js/online-arena.js) bağlanır: oda soketini kendisi
 * dinlemez, adaptör sözleşmesini (render/bind/damga/events) uygular.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvTombalaOnlineLoaded) return;
  window.__gvTombalaOnlineLoaded = true;

  var SATIR = 3, SUTUN = 9;
  var sonTopGosterilen = null;     // aynı top iki kez duyurulmasın

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }
  function ses(ad) { try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal(ad); } catch (_) {} }

  function adOf(s, seat) {
    var a = (s.adlar || []).find(function (x) { return x.seat === seat; });
    if (!a) return 'Oyuncu ' + (seat + 1);
    return (a.ai ? '🤖 ' : '') + a.name;
  }

  /* Bir kartın HTML'i. İşaretli sayılar kapanmış görünür; tamamlanan satır
     ayrıca vurgulanır. */
  function kartHtml(s, seat, benimMi) {
    var kart = (s.kartlar || {})[seat] || [];
    var isaretli = (s.isaretli || {})[seat] || [];
    var satirTam = (s.satirTam || {})[seat] || [];
    var oduller = (s.oduller || {})[seat] || [];
    var kapanan = isaretli.length;

    var h = '<div class="tb-kart' + (benimMi ? ' benim' : '') + '">';
    h += '<div class="tb-kart-bas">' +
         '<span class="tb-ad">' + esc(adOf(s, seat)) + (benimMi ? ' <b>(Siz)</b>' : '') + '</span>' +
         '<span class="tb-sayac">' + kapanan + '/15</span>' +
         '</div>';
    if (oduller.length) {
      h += '<div class="tb-rozetler">' + oduller.map(function (k) {
        var t = (s.odulTanim || []).find(function (o) { return o.key === k; });
        return '<span class="tb-rozet ' + k + '">' + esc(t ? t.ad : k) + '</span>';
      }).join('') + '</div>';
    }
    h += '<div class="tb-izgara">';
    for (var r = 0; r < SATIR; r++) {
      h += '<div class="tb-satir' + (satirTam[r] ? ' tam' : '') + '">';
      for (var c = 0; c < SUTUN; c++) {
        var n = kart[r] ? kart[r][c] : null;
        if (n == null) { h += '<span class="tb-goz bos"></span>'; continue; }
        var acik = isaretli.indexOf(n) !== -1;
        h += '<span class="tb-goz' + (acik ? ' acik' : '') +
             (s.sonTop === n && acik ? ' son' : '') + '" data-n="' + n + '">' + n + '</span>';
      }
      h += '</div>';
    }
    h += '</div></div>';
    return h;
  }

  function panoHtml(s) {
    return '<div class="tb-pano">' + (s.odulTanim || []).map(function (o) {
      var kz = (s.verilen || {})[o.key] || [];
      return '<div class="tb-odul' + (kz.length ? ' verildi' : '') + '">' +
        '<span class="tb-odul-ad">' + esc(o.ad) + '</span>' +
        '<span class="tb-odul-kim">' +
          (kz.length ? kz.map(function (q) { return esc(adOf(s, q)); }).join(' & ') : '—') +
        '</span></div>';
    }).join('') + '</div>';
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'tombala',
    kinds: ['tombala'],
    reject: [],
    events: {
      /* Yeni top: kısa bir duyuru ve ses. Durum paketi zaten arkasından
         geliyor, çizimi o yapıyor. */
      tombalaTop: function (p) {
        if (!p || p.top == null) return;
        if (sonTopGosterilen === p.top) return;
        sonTopGosterilen = p.top;
        ses('tasKoy');
        (p.yeniOduller || []).forEach(function (o) {
          ses('zil');
          uyar('🏅 ' + o.ad + ': ' + (o.seats || []).length + ' oyuncu kazandı!', 'success');
        });
      }
    },

    /* Damga: yalnız SUNUCU durumu değiştiğinde yeniden çiz. */
    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.sonTop + '#' + (s.kalanTop || 0) + '#' +
             (s.seats || []).map(function (q) {
               return q + ':' + ((s.isaretli || {})[q] || []).length +
                      ':' + ((s.oduller || {})[q] || []).join('|');
             }).join(',');
    },

    render: function (m) {
      var s = m.state || {};
      var seats = s.seats || [];
      var h = '<div class="tb-wrap">';

      /* ÜST ŞERİT: çekilen top + torba durumu. */
      h += '<div class="tb-ust">';
      h += '<div class="tb-top' + (s.sonTop != null ? ' dolu' : '') + '">' +
           (s.sonTop != null ? s.sonTop : '—') + '</div>';
      h += '<div class="tb-ust-bilgi">' +
           '<div class="tb-kalan">🎱 Torbada <b>' + (s.kalanTop || 0) + '</b> top</div>' +
           '<div class="tb-son5">' + (s.cekilen || []).slice(-8).reverse().map(function (n, i) {
             return '<span class="tb-mini' + (i === 0 ? ' ilk' : '') + '">' + n + '</span>';
           }).join('') + '</div>' +
           '</div>';
      h += '</div>';

      h += panoHtml(s);

      h += '<div class="tb-kartlar">';
      seats.forEach(function (q) { h += kartHtml(s, q, q === s.mySeat); });
      h += '</div>';

      h += '<div class="tb-not">Toplar kendiliğinden çekilir ve kartınız otomatik kapanır — ' +
           'yapmanız gereken bir şey yok, bol şans!</div>';
      return h + '</div>';
    },

    bind: function (root, m) {
      /* Çizimden sonra ölçü: kart ızgarası dar ekranda taşmasın. Kartın
         göz genişliği ölçülen alana göre verilir (sabit vw tahmini tam
         ekranda ve bölünmüş ekranda tutmuyor). */
      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var g = alan ? alan.getBoundingClientRect().width : 600;
        var kartlar = root.querySelectorAll('.tb-kart');
        /* Geniş alanda iki kart yan yana sığar; dar alanda tek sütun. */
        var sutun = g >= 640 ? 2 : 1;
        var kartG = Math.max(220, Math.floor((g - (sutun - 1) * 10) / sutun) - 2);
        var goz = Math.max(18, Math.min(44, Math.floor((kartG - 22) / SUTUN) - 3));
        root.style.setProperty('--tb-goz', goz + 'px');
        var kutu = root.querySelector('.tb-kartlar');
        if (kutu) kutu.style.gridTemplateColumns = 'repeat(' + sutun + ',minmax(0,1fr))';
        void kartlar;
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (root.__tbOlcu) {
        window.removeEventListener('resize', root.__tbOlcu);
        window.removeEventListener('orientationchange', root.__tbOlcu);
      }
      root.__tbOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 80); };
      window.addEventListener('resize', root.__tbOlcu);
      window.addEventListener('orientationchange', root.__tbOlcu);
      if (window.visualViewport) {
        if (root.__tbVV) window.visualViewport.removeEventListener('resize', root.__tbVV);
        root.__tbVV = root.__tbOlcu;
        window.visualViewport.addEventListener('resize', root.__tbVV);
      }
      void m;
    }
  });

  window.addEventListener('gv:roomLeft', function () { sonTopGosterilen = null; });

  /* Test/teşhis köprüsü */
  window.__gvTombala = { sonTop: function () { return sonTopGosterilen; } };
})();
