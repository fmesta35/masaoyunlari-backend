/* ============================================================================
 * ADAM ASMACA — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * İki kişilik kelime düellosu. İki ekran vardır:
 *   · KELİME EKRANI — gizleyen oyuncu kelimeyi ve isterse ipucunu yazar.
 *     Rakibe bu sırada yalnız "kelime seçiliyor" bekleme ekranı gider.
 *   · TAHMİN EKRANI — darağacı, maske kutucukları, canlar ve Türkçe klavye.
 *
 * Kurallar ve KELİME tamamen sunucudadır (adamasmaca-engine.js); bu dosya
 * yalnız ÇİZER ve iki olay gönderir: adamasmacaWord, adamasmacaGuess.
 *
 * ÖNEMLİ: ortak katman (js/online-arena.js) #boardArea'nın innerHTML'ini
 * HTML METNİ DEĞİŞTİĞİNDE yeniden yazar. Kelime kutusuna yazılan metin
 * HTML'i değiştirmediği için yazarken kutu yok olmaz; yine de güvenlik
 * olsun diye değer modül içinde saklanır ve her çizimden sonra geri konur.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvAdamAsmacaLoaded) return;
  window.__gvAdamAsmacaLoaded = true;

  var KLAVYE = ['ABCÇDEFGĞH', 'IİJKLMNOÖP', 'RSŞTUÜVYZ'];
  var taslakKelime = '';     // kutuya yazılan ama henüz kilitlenmeyen kelime
  var taslakIpucu = '';
  var sonHarf = null;        // aynı harf iki kez duyurulmasın

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }
  function ses(ad) { try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal(ad); } catch (_) {} }
  function trBuyuk(s) {
    try { return String(s == null ? '' : s).toLocaleUpperCase('tr-TR'); }
    catch (_) { return String(s == null ? '' : s).replace(/i/g, 'İ').toUpperCase(); }
  }

  function adOf(m, seat) {
    try {
      var r = window.__gvActiveRoom || (window.st && st.roomWaitingState && st.roomWaitingState.room);
      var p = r && (r.players || []).find(function (x) { return x.seat === seat; });
      if (p && p.name) return p.name;
    } catch (_) {}
    return 'Koltuk ' + (seat + 1);
  }

  /* --------------------------------------------------------------- DARAĞACI
     Yanlış sayısına göre parça parça çizilir; altı parça = asıldı. */
  function daragaci(yanlis, max) {
    var p = function (n) { return yanlis >= n ? ' class="aa-p gorunur"' : ' class="aa-p"'; };
    return '<svg class="aa-svg' + (yanlis >= max ? ' olu' : '') + '" viewBox="0 0 160 180" ' +
      'role="img" aria-label="' + yanlis + ' / ' + max + ' yanlış">' +
      /* sehpa her zaman görünür */
      '<path class="aa-sehpa" d="M14 170 H86 M50 170 V16 M50 16 H118 M118 16 V40 M50 46 L80 16"/>' +
      '<circle' + p(1) + ' cx="118" cy="54" r="14"/>' +
      '<line' + p(2) + ' x1="118" y1="68" x2="118" y2="114"/>' +
      '<line' + p(3) + ' x1="118" y1="78" x2="98" y2="100"/>' +
      '<line' + p(4) + ' x1="118" y1="78" x2="138" y2="100"/>' +
      '<line' + p(5) + ' x1="118" y1="114" x2="100" y2="146"/>' +
      '<line' + p(6) + ' x1="118" y1="114" x2="136" y2="146"/>' +
      '</svg>';
  }

  function canlarHtml(s) {
    var h = '';
    for (var i = 0; i < s.maxYanlis; i++) {
      h += '<span class="aa-can' + (i < s.kalanCan ? ' dolu' : ' bos') + '">♥</span>';
    }
    return '<div class="aa-canlar">' + h +
      '<span class="aa-can-yazi">' + s.kalanCan + ' / ' + s.maxYanlis + ' hak</span></div>';
  }

  function maskeHtml(s) {
    var acik = s.status !== 'playing' || !!(s.kelime && s.seat === s.gizleyen);
    var harfler = s.maske || [];
    if (!harfler.length) return '';
    var gercek = s.kelime ? [].slice.call(s.kelime) : [];
    return '<div class="aa-maske">' + harfler.map(function (h, i) {
      var g = h || (acik && gercek[i]) || '';
      var sinif = h ? 'aa-kutu acik' : (g ? 'aa-kutu kacirilan' : 'aa-kutu');
      return '<span class="' + sinif + '">' + esc(g || '') + '</span>';
    }).join('') + '</div>';
  }

  function skorHtml(s) {
    var a = s.seats[0], b = s.seats[1];
    function kart(seat) {
      var rol = seat === s.gizleyen ? 'GİZLEYEN' : 'TAHMİNCİ';
      return '<div class="aa-skor' + (seat === s.seat ? ' benim' : '') +
        (seat === s.turn ? ' sirada' : '') + '">' +
        '<span class="aa-skor-ad">' + esc(adOf(s, seat)) + (seat === s.seat ? ' (Siz)' : '') + '</span>' +
        '<span class="aa-skor-rol">' + rol + '</span>' +
        '<span class="aa-skor-p">' + (s.skor[seat] || 0) + '</span></div>';
    }
    return '<div class="aa-skorlar">' + kart(a) +
      '<div class="aa-el">EL<b>' + s.el + '</b>/' + s.elSayisi + '</div>' + kart(b) + '</div>';
  }

  /* -------------------------------------------------------- KELİME EKRANI */
  function kelimeEkrani(s) {
    var benim = s.seat === s.gizleyen;
    if (!benim) {
      return '<div class="aa-bekle">' +
        '<div class="aa-bekle-ikon">🔒</div>' +
        '<div class="aa-bekle-bas">' + esc(adOf(s, s.gizleyen)) + ' kelimeyi seçiyor</div>' +
        '<div class="aa-bekle-alt">Hazır olduğunda tahmin sırası sizde olacak. ' +
        'Kalan süre: <span class="gv-arena-clock">—</span></div></div>';
    }
    return '<div class="aa-kelime-kutu">' +
      '<div class="aa-kelime-bas">🔒 Kelimeyi siz gizliyorsunuz</div>' +
      '<div class="aa-kelime-alt">Sözlükte bulunan 3-14 harflik <b>tek bir Türkçe kelime</b> yazın. ' +
      'Rakibiniz yalnız harf sayısını görür. Kalan süre: <span class="gv-arena-clock">—</span></div>' +
      '<input class="aa-giris aa-k-kelime" type="text" maxlength="20" autocomplete="off" ' +
      'spellcheck="false" placeholder="KELİME">' +
      '<input class="aa-giris aa-k-ipucu" type="text" maxlength="60" autocomplete="off" ' +
      'placeholder="İpucu (isteğe bağlı)">' +
      '<div class="aa-kelime-dugmeler">' +
      '<button class="btn secondary aa-oner" type="button">🎲 Sözlükten öner</button>' +
      '<button class="btn aa-kilitle" type="button">🔒 Kelimeyi kilitle</button>' +
      '</div>' +
      '<div class="aa-hata"></div></div>';
  }

  /* -------------------------------------------------------- TAHMİN EKRANI */
  function tahminEkrani(s) {
    var benim = s.seat === s.tahminci && s.status === 'playing';
    var h = '<div class="aa-oyun">';
    h += '<div class="aa-sol">' + daragaci(s.yanlis, s.maxYanlis) + canlarHtml(s) + '</div>';
    h += '<div class="aa-sag">';
    h += '<div class="aa-durum">' +
         (s.status !== 'playing' ? 'Maç bitti'
            : benim ? '🎯 Sıra sizde — bir harf seçin'
            : '⏳ ' + esc(adOf(s, s.tahminci)) + ' tahmin ediyor') +
         ' <span class="aa-sure">(<span class="gv-arena-clock">—</span>)</span></div>';
    h += '<div class="aa-ipucu">' + (s.ipucu ? '💡 ' + esc(s.ipucu) : '💡 İpucu yok') +
         ' · <b>' + s.harfSayisi + '</b> harf</div>';
    h += maskeHtml(s);
    h += '<div class="aa-klavye' + (benim ? '' : ' kapali') + '">';
    KLAVYE.forEach(function (satir) {
      h += '<div class="aa-kl-satir">';
      [].slice.call(satir).forEach(function (ch) {
        var denendi = (s.tahminler || []).indexOf(ch) !== -1;
        var isabet = denendi && (s.maske || []).indexOf(ch) !== -1;
        h += '<button class="aa-tus' + (denendi ? (isabet ? ' isabet' : ' iska') : '') +
             '" type="button" data-h="' + ch + '"' +
             ((denendi || !benim) ? ' disabled' : '') + '>' + ch + '</button>';
      });
      h += '</div>';
    });
    h += '</div></div></div>';
    return h;
  }

  function sonElHtml(s) {
    var e = s.sonEl;
    if (!e || s.faz !== 'kelime') return '';
    return '<div class="aa-son-el' + (e.tahminciKazandi ? ' kazandi' : ' asildi') + '">' +
      (e.tahminciKazandi ? '🎉 ' : '💀 ') +
      '<b>' + e.el + '. el:</b> kelime <b>' + esc(e.kelime) + '</b> — ' +
      esc(adOf(s, e.kazanan)) + ' +' + e.puan + ' puan</div>';
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'adamasmaca',
    kinds: ['adamasmaca'],
    reject: ['adamasmacaRejected'],
    events: {
      /* Harf duyurusu: ses ve kısa uyarı. Çizimi durum paketi yapar. */
      adamasmacaLetter: function (p) {
        if (!p || !p.harf) return;
        var imza = p.harf + '#' + (p.seat || 0) + '#' + (p.dogru ? 1 : 0);
        if (sonHarf === imza) return;
        sonHarf = imza;
        ses(p.dogru ? 'zil' : 'hata');
        if (p.sure) uyar('⏱ Süre doldu — ' + (p.ad || 'oyuncu') + ' adına "' + p.harf + '" denendi.', 'warning');
      },
      adamasmacaWordLocked: function (p) {
        if (!p) return;
        ses('tasKoy');
        taslakKelime = ''; taslakIpucu = '';
      },
      adamasmacaAutoWord: function (p) {
        if (!p) return;
        uyar('⏱ Süre doldu — kelimeyi sunucu sözlükten seçti (' + (p.harfSayisi || '?') + ' harf).', 'warning');
      },
      /* Öneri yalnız gizleyenin soketine gelir; kutuya yazılır. */
      adamasmacaSuggestion: function (p) {
        if (!p || !p.kelime) return;
        taslakKelime = String(p.kelime);
        var kutu = document.querySelector('#boardArea .aa-k-kelime');
        if (kutu) { kutu.value = taslakKelime; try { kutu.focus(); } catch (_) {} }
        ses('tasKoy');
      },
      adamasmacaRoundEnd: function (p) {
        if (!p || !p.el) return;
        ses(p.el.tahminciKazandi ? 'kazandi' : 'hata');
      }
    },

    /* Damga: sunucu durumu gerçekten değişince yeniden çiz. */
    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.faz + '#' + s.el + '#' + s.yanlis + '#' +
             (s.tahminler || []).join('') + '#' + (s.maske || []).join('') + '#' +
             s.gizleyen + '#' + JSON.stringify(s.skor || {});
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats) return '<div class="aa-wrap"></div>';
      var h = '<div class="aa-wrap">';
      h += skorHtml(s);
      h += sonElHtml(s);
      h += (s.faz === 'kelime') ? kelimeEkrani(s) : tahminEkrani(s);
      return h + '</div>';
    },

    bind: function (root, m) {
      var s = m.state || {};

      /* --- kelime ekranı --- */
      var kIn = root.querySelector('.aa-k-kelime');
      if (kIn) {
        kIn.value = taslakKelime;
        kIn.addEventListener('input', function () {
          this.value = trBuyuk(this.value).replace(/[^ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ]/g, '');
          taslakKelime = this.value;
        });
        var ipIn = root.querySelector('.aa-k-ipucu');
        if (ipIn) {
          ipIn.value = taslakIpucu;
          ipIn.addEventListener('input', function () { taslakIpucu = this.value; });
        }
        var hata = root.querySelector('.aa-hata');
        var kilitle = function () {
          var k = (kIn.value || '').trim();
          if (k.length < 3) { if (hata) hata.textContent = 'Kelime en az 3 harf olmalı.'; return; }
          if (hata) hata.textContent = '';
          m.emit('adamasmacaWord', { kelime: k, ipucu: ipIn ? ipIn.value : '' });
        };
        var kb = root.querySelector('.aa-kilitle');
        if (kb) kb.addEventListener('click', kilitle);
        kIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') kilitle(); });
        if (ipIn) ipIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') kilitle(); });
        var oner = root.querySelector('.aa-oner');
        if (oner) oner.addEventListener('click', function () {
          /* Sözlük SUNUCUDA; öneri de oradan gelir ve yalnız bu sokete
             yollanır (rakip kelimeyi görmemeli). */
          if (hata) hata.textContent = '';
          m.emit('adamasmacaSuggest', {});
        });
        setTimeout(function () { try { kIn.focus(); } catch (_) {} }, 60);
      }

      /* --- klavye --- */
      root.querySelectorAll('.aa-tus').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.disabled) return;
          m.emit('adamasmacaGuess', { harf: b.dataset.h });
        });
      });

      /* --- fiziksel klavye: sıra bendeyse harf tuşları da çalışsın --- */
      if (root.__aaTus) document.removeEventListener('keydown', root.__aaTus);
      root.__aaTus = function (e) {
        if (!m.state || m.state.faz !== 'tahmin' || m.state.status !== 'playing') return;
        if (m.state.seat !== m.state.tahminci) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        var t = e.target && e.target.tagName;
        if (t === 'INPUT' || t === 'TEXTAREA') return;
        var ch = trBuyuk(e.key);
        if (ch.length !== 1 || 'ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ'.indexOf(ch) === -1) return;
        if ((m.state.tahminler || []).indexOf(ch) !== -1) return;
        m.emit('adamasmacaGuess', { harf: ch });
      };
      document.addEventListener('keydown', root.__aaTus);

      /* --- ölçü: dar ekranda darağacı üstte, geniş ekranda solda --- */
      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var g = alan ? alan.getBoundingClientRect().width : 600;
        var oyun = root.querySelector('.aa-oyun');
        if (oyun) oyun.classList.toggle('dar', g < 560);
        var maske = root.querySelector('.aa-maske');
        if (maske && s.harfSayisi) {
          /* Kutu genişliği harf sayısına göre: uzun kelime taşmasın. */
          var kullanilabilir = Math.max(200, (g < 560 ? g : g * 0.62) - 24);
          var kutu = Math.floor((kullanilabilir - (s.harfSayisi - 1) * 5) / s.harfSayisi);
          maske.style.setProperty('--aa-kutu', Math.max(20, Math.min(46, kutu)) + 'px');
        }
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (root.__aaOlcu) {
        window.removeEventListener('resize', root.__aaOlcu);
        window.removeEventListener('orientationchange', root.__aaOlcu);
      }
      root.__aaOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 80); };
      window.addEventListener('resize', root.__aaOlcu);
      window.addEventListener('orientationchange', root.__aaOlcu);
      if (window.visualViewport) {
        if (root.__aaVV) window.visualViewport.removeEventListener('resize', root.__aaVV);
        root.__aaVV = root.__aaOlcu;
        window.visualViewport.addEventListener('resize', root.__aaVV);
      }
    }
  });

  window.addEventListener('gv:roomLeft', function () {
    taslakKelime = ''; taslakIpucu = ''; sonHarf = null;
  });

  /* Test/teşhis köprüsü */
  window.__gvAdamAsmaca = {
    taslak: function () { return taslakKelime; },
    klavye: KLAVYE
  };
})();
