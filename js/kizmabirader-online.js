/* ============================================================================
 * KIZMA BİRADER (Ludo) — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Tahta 15×15 ızgaradır; kareleri, ev yollarını ve üsleri SUNUCU gönderir
 * (kizmabirader-engine.js → gorunum), istemci kendi kopyasını tutmaz. Böylece
 * çizim ile kural asla birbirinden ayrı düşemez.
 *
 * ZAR SUNUCUDA atılır. İstemci iki şey yollar: "zar at" ve "şu piyonu oyna".
 * Geçerli hamleler de sunucudan gelir ve YALNIZ sırası olana gönderilir.
 *
 * ÖLÇEK: tahta her zaman KARE kalır ve ölçülen alana sığar; hücre boyu
 * (--kb-h) JS'te hesaplanır.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvKizmaLoaded) return;
  window.__gvKizmaLoaded = true;

  var N = 15;                  // ızgara
  var sonZar = null;
  var seciliPiyon = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }
  function ses(ad) { try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal(ad); } catch (_) {} }
  function adOf(seat) {
    try {
      var r = window.__gvActiveRoom || (window.st && st.roomWaitingState && st.roomWaitingState.room);
      var p = r && (r.players || []).find(function (x) { return x.seat === seat; });
      if (p && p.name) return p.name;
    } catch (_) {}
    return 'Koltuk ' + (seat + 1);
  }

  /* Bir piyonun ızgaradaki yeri. İlerleme: -1 üs, 0-51 tur,
     52-56 ev yolu, 57 merkez. */
  function piyonKare(s, renk, ilerleme, idx) {
    if (ilerleme === -1) {
      var k = s.usKoseleri[renk];
      /* Üs 6×6'lık köşe; dört piyon içeride 2×2 dizilir. */
      return [k[0] + 1.5 + (idx % 2) * 2.5, k[1] + 1.5 + Math.floor(idx / 2) * 2.5];
    }
    if (ilerleme >= s.bitisIlerleme) return [7 + (idx % 2) * 0.5 - 0.25, 7 + Math.floor(idx / 2) * 0.5 - 0.25];
    if (ilerleme >= 52) return s.evYolu[renk][ilerleme - 52];
    return s.turYolu[(s.baslangic[renk] + ilerleme) % 52];
  }

  function tahtaHtml(s) {
    var h = '<div class="kb-tahta">';
    /* Zemin: tur kareleri, ev yolları, üsler, merkez. */
    var turSet = {};
    s.turYolu.forEach(function (rc, i) { turSet[rc[0] + ',' + rc[1]] = i; });
    var evSet = {};
    (s.evYolu || []).forEach(function (hucreler, renk) {
      hucreler.forEach(function (rc) { evSet[rc[0] + ',' + rc[1]] = renk; });
    });
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var anahtar = r + ',' + c;
        var sinif = 'kb-hucre', ic = '', stil = '';
        if (turSet[anahtar] !== undefined) {
          var g = turSet[anahtar];
          sinif += ' yol';
          var bas = s.baslangic.indexOf(g);
          if (bas !== -1) { sinif += ' baslangic'; stil = 'background:' + s.renkKodlari[bas] + '33'; }
          if ((s.yildiz || []).indexOf(g) !== -1) { sinif += ' yildiz'; ic = '★'; }
          else if ((s.guvenli || []).indexOf(g) !== -1 && bas === -1) sinif += ' guvenli';
        } else if (evSet[anahtar] !== undefined) {
          sinif += ' ev';
          stil = 'background:' + s.renkKodlari[evSet[anahtar]] + '55';
        } else if (r >= 6 && r <= 8 && c >= 6 && c <= 8) {
          sinif += ' merkez';
        } else {
          var us = -1;
          (s.usKoseleri || []).forEach(function (k, i) {
            if (r >= k[0] && r < k[0] + 6 && c >= k[1] && c < k[1] + 6) us = i;
          });
          if (us !== -1) { sinif += ' us'; stil = 'background:' + s.renkKodlari[us] + '22'; }
          else sinif += ' bos';
        }
        h += '<div class="' + sinif + '" style="grid-row:' + (r + 1) + ';grid-column:' + (c + 1) +
             (stil ? ';' + stil : '') + '">' + ic + '</div>';
      }
    }
    /* Piyonlar: ızgaranın üstünde mutlak konumda. */
    var benimSira = s.turn === s.seat && s.status === 'playing' && s.faz === 'secim';
    var oynanabilir = {};
    (s.hamleler || []).forEach(function (m) { oynanabilir[m.idx] = m; });
    Object.keys(s.piyon || {}).forEach(function (renkStr) {
      var renk = Number(renkStr);
      s.piyon[renk].forEach(function (ilerleme, i) {
        var rc = piyonKare(s, renk, ilerleme, i);
        var benim = benimSira && renk === s.renk && oynanabilir[i];
        h += '<button class="kb-piyon' + (benim ? ' oynanabilir' : '') +
          (seciliPiyon === i && benim ? ' secili' : '') +
          '" type="button" data-idx="' + i + '"' + (benim ? '' : ' disabled') +
          ' style="--kb-r:' + rc[0] + ';--kb-c:' + rc[1] +
          ';background:' + s.renkKodlari[renk] + '" title="' +
          esc(s.renkAdlari[renk]) + ' ' + (i + 1) + '">' + (i + 1) + '</button>';
      });
    });
    return h + '</div>';
  }

  function oyuncularHtml(s) {
    return '<div class="kb-oyuncular">' + s.seats.map(function (q) {
      var renk = s.renkOf[q];
      var bitti = (s.siralama || []).indexOf(renk) !== -1;
      var evde = (s.piyon[renk] || []).filter(function (p) { return p >= s.bitisIlerleme; }).length;
      return '<div class="kb-oyuncu' + (q === s.seat ? ' benim' : '') +
        (q === s.turn && s.status === 'playing' ? ' sirada' : '') + (bitti ? ' bitti' : '') + '">' +
        '<span class="kb-nokta" style="background:' + s.renkKodlari[renk] + '"></span>' +
        '<span class="kb-ad">' + esc(adOf(q)) + (q === s.seat ? ' (Siz)' : '') + '</span>' +
        '<span class="kb-evde">🏠 ' + evde + '/4</span>' +
        (bitti ? '<span class="kb-rozet">' + ((s.siralama.indexOf(renk) + 1)) + '.</span>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function sonHamleHtml(s) {
    var o = s.sonHamle;
    if (!o) return '';
    var ad = s.renkAdlari[o.renk];
    if (o.tur === 'ucAlti') {
      return '<div class="kb-son uyari">🎲 ' + esc(ad) + ' üst üste üç kez 6 attı — sıra yandı.</div>';
    }
    if (o.tur === 'hamleYok') {
      return '<div class="kb-son">🎲 ' + esc(ad) + ' <b>' + o.zar + '</b> attı — geçerli hamle yok.</div>';
    }
    var m = '🎲 ' + esc(ad) + ' <b>' + o.zar + '</b> attı';
    if (o.nereden === -1) m += ' ve üsten piyon çıkardı';
    if (o.yenen && o.yenen.length) {
      m += ' · ⚔️ ' + o.yenen.map(function (v) { return esc(s.renkAdlari[v.renk]); }).join(', ') +
           ' piyonunu yedi!';
    }
    if (o.nereye >= s.bitisIlerleme) m += ' · 🏠 bir piyon merkeze girdi';
    return '<div class="kb-son' + (o.yenen && o.yenen.length ? ' yeme' : '') + '">' + m + '</div>';
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'kizmabirader',
    kinds: ['kizmabirader'],
    reject: ['kizmaRejected'],
    events: {
      kizmaDice: function (p) {
        if (!p) return;
        sonZar = p.zar;
        ses(p.zar === 6 ? 'kazandi' : 'tasKoy');
        if (p.ucAlti) uyar('🎲 Üç kez 6 — sıra yandı!', 'warning');
        else if (p.hamleYok) uyar('🎲 ' + p.zar + ' attınız ama geçerli hamle yok.', 'info');
      },
      kizmaMoved: function (p) {
        seciliPiyon = null;
        if (p && p.hamle && p.hamle.yenen && p.hamle.yenen.length) ses('hata');
      },
      kizmaTimeout: function (p) {
        if (!p) return;
        uyar('⏱ ' + (p.ad || 'Oyuncu') + ' süresini doldurdu — ' +
          (p.tur === 'zar' ? 'zarı sunucu attı.' : 'hamleyi sunucu oynadı.'), 'warning');
      }
    },

    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.faz + '#' + s.turn + '#' + s.zar + '#' +
        JSON.stringify(s.piyon || {}) + '#' + (s.hamleler || []).map(function (x) { return x.idx; }).join(',') +
        '#' + JSON.stringify(s.sonHamle || null) + '#' + (s.siralama || []).join(',');
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats || !s.turYolu) return '<div class="kb-wrap"></div>';
      var benim = s.turn === s.seat && s.status === 'playing' && !m.isSpectator;
      var h = '<div class="kb-wrap">';
      h += oyuncularHtml(s);
      h += sonHamleHtml(s);
      h += '<div class="kb-alan">';
      h += '<div class="kb-sol">' + tahtaHtml(s) + '</div>';
      h += '<div class="kb-sag">';
      h += '<div class="kb-durum">' +
        (s.status !== 'playing' ? 'Maç bitti'
          : benim ? (s.faz === 'zar' ? '🎲 Sıra sizde — zar atın' : '👆 Oynayacağınız piyonu seçin')
                  : '⏳ ' + esc(adOf(s.turn)) + ' oynuyor') +
        ' <span class="kb-sure">(<span class="gv-arena-clock">—</span>)</span></div>';
      h += '<div class="kb-zar' + (s.zar ? ' dolu' : '') + '">' + (s.zar || '—') + '</div>';
      if (s.altiSayisi > 0 && s.status === 'playing') {
        h += '<div class="kb-alti">Üst üste 6: ' + s.altiSayisi + '/3</div>';
      }
      if (benim && s.faz === 'zar') {
        h += '<button class="btn kb-at" type="button">🎲 ZAR AT</button>';
      } else if (benim && s.faz === 'secim') {
        h += '<div class="kb-secenekler">' + (s.hamleler || []).map(function (mv) {
          var etiket = mv.nereden === -1 ? 'Üsten çıkar'
            : (mv.nereye >= s.bitisIlerleme ? 'Merkeze gir'
               : (mv.yenen && mv.yenen.length ? 'Yiyerek ilerle' : 'İlerle'));
          return '<button class="btn secondary kb-sec" type="button" data-idx="' + mv.idx + '">' +
                 (mv.idx + 1) + '. piyon — ' + etiket + '</button>';
        }).join('') + '</div>';
      }
      h += '<div class="kb-ipucu">Üsten çıkmak için <b>6</b> gerek. 6 atan, piyon yiyen ve ' +
           'merkeze giren <b>tekrar atar</b>. Aynı renkten iki piyon bir kareyi <b>kapatır</b>.</div>';
      h += '</div></div></div>';
      return h;
    },

    bind: function (root, m) {
      var s = m.state || {};
      var at = root.querySelector('.kb-at');
      if (at) at.addEventListener('click', function () { m.emit('kizmaRoll', {}); });
      root.querySelectorAll('.kb-sec').forEach(function (b) {
        b.addEventListener('click', function () {
          m.emit('kizmaMove', { idx: Number(b.dataset.idx) });
        });
      });
      /* Tahtadaki piyona doğrudan dokunmak da oynar. */
      root.querySelectorAll('.kb-piyon.oynanabilir').forEach(function (b) {
        b.addEventListener('click', function () {
          m.emit('kizmaMove', { idx: Number(b.dataset.idx) });
        });
      });

      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var r = alan ? alan.getBoundingClientRect() : { width: 600, height: 520 };
        var oy = root.querySelector('.kb-oyuncular');
        var son = root.querySelector('.kb-son');
        var pay = (oy ? oy.getBoundingClientRect().height : 0) +
                  (son ? son.getBoundingClientRect().height : 0) + 32;
        var g = Math.max(240, r.width);
        var y = Math.max(220, (r.height || 520) - pay);
        var dar = g < 640;
        var kap = root.querySelector('.kb-alan');
        if (kap) kap.classList.toggle('dar', dar);
        /* Tahta KARE: dar ekranda genişliğe, geniş ekranda yüksekliğe göre. */
        var kenar = dar ? Math.min(g, y * 0.72) : Math.min(g * 0.6, y);
        var hucre = Math.max(10, Math.floor(kenar / N));
        var tahta = root.querySelector('.kb-tahta');
        if (tahta) {
          tahta.style.setProperty('--kb-h', hucre + 'px');
          tahta.style.width = (hucre * N) + 'px';
          tahta.style.height = (hucre * N) + 'px';
        }
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (root.__kbOlcu) {
        window.removeEventListener('resize', root.__kbOlcu);
        window.removeEventListener('orientationchange', root.__kbOlcu);
      }
      root.__kbOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 80); };
      window.addEventListener('resize', root.__kbOlcu);
      window.addEventListener('orientationchange', root.__kbOlcu);
      if (window.visualViewport) {
        if (root.__kbVV) window.visualViewport.removeEventListener('resize', root.__kbVV);
        root.__kbVV = root.__kbOlcu;
        window.visualViewport.addEventListener('resize', root.__kbVV);
      }
      void s;
    }
  });

  window.addEventListener('gv:roomLeft', function () { sonZar = null; seciliPiyon = null; });
  window.__gvKizma = { zar: function () { return sonZar; } };
})();
