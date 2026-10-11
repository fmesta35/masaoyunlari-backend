/* ============================================================================
 * CENGA — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Sıra iki adımdır:
 *   1) TAŞ SEÇ — kule yandan görünümde çizilir; kilitli katlar soluk, çekilebilir
 *      taşlar tıklanabilir.
 *   2) ÇEK — iğne 0..1 arasında gidip gelir; oyuncu "ÇEK"e bastığı andaki konum
 *      sunucuya gider. Hedef SUNUCUDA gizlidir, istemci yalnız bandın
 *      GENİŞLİĞİNİ bilir — bu yüzden hile yapılamaz.
 *
 * Kule, prototipteki gibi 3B değil: aynı ızgara (kat × 3 slot) yandan,
 * katlar dönüşümlü eksenlerde çizilir. Böylece hem telefonda akıcı kalır
 * hem de sunucu durumuyla birebir aynı şeyi gösterir.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvCengaLoaded) return;
  window.__gvCengaLoaded = true;

  var igne = 0.5;          // iğnenin o anki konumu (0..1)
  var yon = 1;             // iğnenin gidiş yönü
  var animasyon = null;    // requestAnimationFrame kimliği
  var sonCekis = null;

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

  /* ------------------------------------------------------------------ KULE
     Her kat bir satır; katlar dönüşümlü olarak "boyuna" ve "enine" çizilir.
     Boyuna katta üç taş yan yana görünür; enine katta taşlar bize dönüktür
     ve tek bir geniş blok gibi çizilir (üçe bölünmüş hâlde). */
  function kuleHtml(s) {
    var izgara = s.izgara || [];
    var izinli = s.izinliKat;
    var sec = s.secim;
    var benimSira = s.turn === s.seat && s.status === 'playing' && s.faz === 'secim';
    var h = '<div class="cg-kule">';
    for (var k = izgara.length - 1; k >= 0; k--) {
      var satir = izgara[k];
      if (satir.every(function (x) { return x < 0; }) && k >= izgara.length - 1) {
        /* en üstteki tamamen boş katı çizme (kule yükseldikçe boş kalır) */
        if (k > 0 && izgara[k - 1].every(function (x) { return x < 0; })) continue;
      }
      var enine = (k % 2 === 1);
      var acik = k < izinli;
      h += '<div class="cg-kat' + (enine ? ' enine' : '') + (acik ? ' acik' : ' kilitli') +
           '" data-kat="' + k + '">';
      for (var sl = 0; sl < 3; sl++) {
        var id = satir[sl];
        if (id < 0) { h += '<span class="cg-bos"></span>'; continue; }
        var secili = sec && sec.kat === k && sec.slot === sl;
        h += '<button class="cg-tas' + (secili ? ' secili' : '') +
             '" type="button" data-kat="' + k + '" data-slot="' + sl + '"' +
             ((acik && benimSira) ? '' : ' disabled') + '></button>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  function skorHtml(s) {
    return '<div class="cg-skorlar">' + s.seats.map(function (q) {
      return '<div class="cg-skor' + (q === s.seat ? ' benim' : '') +
        (q === s.turn && s.status === 'playing' ? ' sirada' : '') + '">' +
        '<span class="cg-ad">' + esc(adOf(q)) + (q === s.seat ? ' (Siz)' : '') + '</span>' +
        '<span class="cg-p">' + ((s.skor || {})[q] || 0) + '</span>' +
        '<span class="cg-alt">' + ((s.cekis || {})[q] || 0) + ' çekiş' +
          (((s.seri || {})[q] || 0) > 1 ? ' · 🔥' + s.seri[q] : '') + '</span>' +
        '</div>';
    }).join('') +
    '<div class="cg-denge"><span class="cg-denge-yazi">DENGE</span>' +
      '<span class="cg-denge-cubuk"><i style="width:' +
        Math.round(Math.max(0, Math.min(1, s.denge || 0)) * 100) + '%"></i></span>' +
      '<span class="cg-kat-sayi">' + (s.ustKat || 0) + ' kat</span></div>';
  }

  function gostergeHtml(s) {
    var sec = s.secim;
    if (!sec) return '';
    var benim = s.turn === s.seat && s.status === 'playing';
    var yuzde = Math.round(sec.bant * 200);   // bandın toplam genişliği (%)
    return '<div class="cg-gosterge">' +
      '<div class="cg-g-bas">' +
        '<span class="cg-rozet r' + sec.riskSeviyesi + '">' + esc(sec.riskEtiketi) + '</span>' +
        '<span class="cg-rozet gri">Tutuş: ' + esc(sec.sikilikEtiketi) + '</span>' +
        '<span class="cg-rozet gri">Tolerans: %' + yuzde + '</span>' +
      '</div>' +
      '<div class="cg-ray"><i class="cg-igne"></i></div>' +
      '<div class="cg-g-alt">' +
        (benim
          ? 'Hedef gizli — iğneyi doğru anda durdurun. <b>Band dışına çıkarsanız kule devrilir.</b>'
          : esc(adOf(s.turn)) + ' taşı çekiyor…') +
      '</div>' +
      (benim ? '<div class="cg-g-dugmeler">' +
        '<button class="btn secondary cg-birak" type="button">↩ Başka taş</button>' +
        '<button class="btn cg-cek" type="button">✊ ÇEK</button></div>' : '') +
      '</div>';
  }

  function sonHtml(s) {
    if (s.status !== 'playing' && s.result) {
      var r = s.result;
      var neden = r.neden === 'yapi' ? 'Kule yeni yükü taşıyamadı'
                : r.neden === 'tas_bitti' ? 'Çekilecek taş kalmadı'
                : r.reason === 'resign' ? 'Rakip pes etti' : 'Taş zorlandı, kule devrildi';
      return '<div class="cg-son cokus">💥 ' + esc(neden) + ' — ' +
        esc(adOf(r.kaybeden)) + ' kuleyi devirdi.</div>';
    }
    var o = s.son;
    if (!o) return '';
    var etiket = o.kademe === 2 ? 'Kusursuz' : o.kademe === 1 ? 'Temiz' : 'Zorlu';
    return '<div class="cg-son k' + o.kademe + '">✊ ' + esc(adOf(o.seat)) + ' — ' +
      esc(etiket) + ' çekiş, <b>+' + o.puan + '</b> puan' +
      (o.carpan > 1 ? ' (×' + o.carpan.toFixed(2) + ')' : '') + '</div>';
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'cenga',
    kinds: ['cenga'],
    reject: ['cengaRejected'],
    events: {
      cengaSelected: function () { ses('tasKoy'); },
      cengaPulled: function (p) {
        if (!p) return;
        var imza = p.seat + '#' + p.hedef + '#' + p.sapma;
        if (sonCekis === imza) return;
        sonCekis = imza;
        if (p.devrildi) { ses('hata'); uyar('💥 Kule devrildi!', 'error'); }
        else ses(p.kademe === 2 ? 'kazandi' : 'zil');
      },
      cengaTimeout: function (p) {
        if (!p) return;
        uyar('⏱ ' + (p.ad || 'Oyuncu') + ' süresini doldurdu — ' +
          (p.tur === 'secim' ? 'taşı sunucu seçti.' : 'el kaydı.'), 'warning');
      }
    },

    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.faz + '#' + s.turn + '#' + s.tur + '#' +
        (s.izgara || []).map(function (r) { return r.join('.'); }).join('|') + '#' +
        JSON.stringify(s.secim || null) + '#' + JSON.stringify(s.son || null);
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats) return '<div class="cg-wrap"></div>';
      var benimSira = s.turn === s.seat && s.status === 'playing' && !m.isSpectator;
      var h = '<div class="cg-wrap">';
      h += skorHtml(s);
      h += sonHtml(s);
      h += '<div class="cg-alan">';
      h += '<div class="cg-sol">' + kuleHtml(s) + '</div>';
      h += '<div class="cg-sag">';
      h += '<div class="cg-durum">' +
        (s.status !== 'playing' ? 'Maç bitti'
          : s.faz === 'secim'
            ? (benimSira ? '🎯 Sıra sizde — çekilecek taşı seçin'
                         : '⏳ ' + esc(adOf(s.turn)) + ' taş seçiyor')
            : (benimSira ? '✊ İğneyi durdurun' : '⏳ ' + esc(adOf(s.turn)) + ' çekiyor')) +
        ' <span class="cg-sure">(<span class="gv-arena-clock">—</span>)</span></div>';
      h += gostergeHtml(s);
      if (s.faz === 'secim') {
        h += '<div class="cg-ipucu">En üstteki <b>tamamlanmış kat</b> ve üstü kilitlidir. ' +
             'Çekilen taş en üste konur; kule devrilirse <b>deviren kaybeder</b>.</div>';
      }
      h += '</div></div></div>';
      return h;
    },

    bind: function (root, m) {
      var s = m.state || {};

      /* --- taş seçimi --- */
      root.querySelectorAll('.cg-tas').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.disabled) return;
          m.emit('cengaSelect', { kat: Number(b.dataset.kat), slot: Number(b.dataset.slot) });
        });
      });

      /* --- çekiş göstergesi: iğne gider gelir, oyuncu durdurur --- */
      if (animasyon) { cancelAnimationFrame(animasyon); animasyon = null; }
      var igneEl = root.querySelector('.cg-igne');
      var benimCekis = s.faz === 'cekis' && s.turn === s.seat &&
                       s.status === 'playing' && !m.isSpectator;
      if (igneEl && s.secim) {
        /* Hız bandın darlığıyla artar: zor taşta iğne daha hızlı gider. */
        var hiz = 0.55 + (0.30 - s.secim.bant) * 2.4;
        var sonT = 0;
        igne = 0.5; yon = 1;
        var don = function (t) {
          if (!root.isConnected) { animasyon = null; return; }
          if (!sonT) sonT = t;
          var dt = Math.min(0.05, (t - sonT) / 1000);
          sonT = t;
          igne += yon * hiz * dt;
          if (igne >= 1) { igne = 1; yon = -1; }
          if (igne <= 0) { igne = 0; yon = 1; }
          igneEl.style.left = (igne * 100) + '%';
          animasyon = requestAnimationFrame(don);
        };
        animasyon = requestAnimationFrame(don);

        if (benimCekis) {
          var cek = function () {
            if (animasyon) { cancelAnimationFrame(animasyon); animasyon = null; }
            m.emit('cengaPull', { el: Math.max(0, Math.min(1, igne)) });
          };
          var cb = root.querySelector('.cg-cek');
          if (cb) cb.addEventListener('click', cek);
          var bb = root.querySelector('.cg-birak');
          if (bb) bb.addEventListener('click', function () { m.emit('cengaRelease', {}); });
          /* Boşluk tuşu da çeker — masaüstünde daha hızlı. */
          if (root.__cgTus) document.removeEventListener('keydown', root.__cgTus);
          root.__cgTus = function (e) {
            if (e.code !== 'Space' && e.key !== ' ') return;
            var t = e.target && e.target.tagName;
            if (t === 'INPUT' || t === 'TEXTAREA') return;
            e.preventDefault();
            cek();
          };
          document.addEventListener('keydown', root.__cgTus);
        }
      }

      /* --- ölçü: dar ekranda kule üstte, gösterge altta --- */
      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var g = alan ? alan.getBoundingClientRect().width : 600;
        var y = alan ? alan.getBoundingClientRect().height : 520;
        var dar = g < 620;
        var kap = root.querySelector('.cg-alan');
        if (kap) kap.classList.toggle('dar', dar);
        /* Kule 18+ kat; yüksekliği alana sığsın diye kat yüksekliği ölçülür. */
        var kat = Math.max(2, (m.state && m.state.izgara ? m.state.izgara.length : 18) + 1);
        var kule = root.querySelector('.cg-kule');
        if (kule) {
          var pay = dar ? 0.46 : 0.80;
          var hedefY = Math.max(180, Math.min(520, y * pay));
          var kh = Math.max(7, Math.min(20, Math.floor(hedefY / kat)));
          kule.style.setProperty('--cg-kat', kh + 'px');
          var genislik = (dar ? g : g * 0.46) - 24;
          kule.style.setProperty('--cg-tas', Math.max(14, Math.min(44, Math.floor(genislik / 3) - 4)) + 'px');
        }
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (root.__cgOlcu) {
        window.removeEventListener('resize', root.__cgOlcu);
        window.removeEventListener('orientationchange', root.__cgOlcu);
      }
      root.__cgOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 80); };
      window.addEventListener('resize', root.__cgOlcu);
      window.addEventListener('orientationchange', root.__cgOlcu);
      if (window.visualViewport) {
        if (root.__cgVV) window.visualViewport.removeEventListener('resize', root.__cgVV);
        root.__cgVV = root.__cgOlcu;
        window.visualViewport.addEventListener('resize', root.__cgVV);
      }
    }
  });

  window.addEventListener('gv:roomLeft', function () {
    if (animasyon) { cancelAnimationFrame(animasyon); animasyon = null; }
    sonCekis = null;
  });

  /* Test/teşhis köprüsü */
  window.__gvCenga = { igne: function () { return igne; } };
})();
