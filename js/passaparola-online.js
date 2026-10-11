/* ============================================================================
 * PASSAPAROLA — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * İki kişilik bilgi yarışması. Ekran üç parçadır:
 *   · İKİ ÇARK — her oyuncunun 27 harfi; yeşil doğru, kırmızı yanlış,
 *     mavi pas, sarı o an sorulan harf.
 *   · SORU PANELİ — soru metni, cevabın harf maskesi ve giriş kutusu.
 *   · SAATLER — oyuncu başına ayrı geri sayım; yalnız sırası olanınki işler.
 *
 * DOĞRU CEVAP SUNUCUDA KALIR: istemciye yalnız soru, harf sayısı ve açılmış
 * harfler gelir. Karşılaştırmayı sunucu yapar (passaparola-engine.js).
 *
 * Ortak katman (js/online-arena.js) #boardArea'yı HTML METNİ DEĞİŞTİĞİNDE
 * yeniden yazar. Saat her saniye değiştiği için saat metni HTML'e DEĞİL,
 * bind sonrası doğrudan düğüme yazılır; böylece cevap kutusu yazarken
 * silinmez.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvPassaparolaLoaded) return;
  window.__gvPassaparolaLoaded = true;

  var taslakCevap = '';          // kutuya yazılan ama gönderilmeyen metin
  var sonOlay = null;

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
  function sureYaz(sn) {
    var n = Math.max(0, Math.floor(Number(sn) || 0));
    return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0');
  }

  /* Bir oyuncunun çarkı: 27 harf, durumuna göre renkli. */
  function carkHtml(s, seat) {
    var d = (s.durum || {})[seat] || {};
    var aktif = (s.aktifHarf || {})[seat];
    var sirada = s.turn === seat && s.status === 'playing';
    return '<div class="pp-cark' + (seat === s.seat ? ' benim' : '') + (sirada ? ' sirada' : '') + '">' +
      '<div class="pp-cark-bas">' +
        '<span class="pp-ad">' + esc(adOf(seat)) + (seat === s.seat ? ' (Siz)' : '') + '</span>' +
        '<span class="pp-dogru">✅ ' + ((s.dogru || {})[seat] || 0) + '</span>' +
        '<span class="pp-saat" data-seat="' + seat + '">' + sureYaz((s.saat || {})[seat]) + '</span>' +
      '</div>' +
      '<div class="pp-harfler">' + (s.harfler || []).map(function (h) {
        var durum = d[h] || 'bos';
        return '<span class="pp-h ' + durum + (h === aktif && sirada ? ' aktif' : '') + '">' + h + '</span>';
      }).join('') + '</div></div>';
  }

  function maskeHtml(s) {
    return '<div class="pp-maske">' + (s.maske || []).map(function (ch) {
      if (ch === ' ') return '<span class="pp-bosluk"></span>';
      return '<span class="pp-mk' + (ch ? ' acik' : '') + '">' + esc(ch || '') + '</span>';
    }).join('') + '</div>';
  }

  function sonOlayHtml(s) {
    var o = s.son;
    if (!o) return '';
    if (o.tur === 'sure') {
      return '<div class="pp-son sure">⏱ ' + esc(adOf(o.seat)) + ' — süresi doldu, sıra rakibe geçti.</div>';
    }
    if (o.tur === 'pas') {
      return '<div class="pp-son pas">🔵 ' + esc(adOf(o.seat)) + ' <b>' + esc(o.harf) +
        '</b> harfini pas geçti.</div>';
    }
    return '<div class="pp-son ' + (o.dogru ? 'dogru' : 'yanlis') + '">' +
      (o.dogru ? '✅ ' : '❌ ') + esc(adOf(o.seat)) + ' <b>' + esc(o.harf) + '</b>: ' +
      (o.dogru ? 'doğru!' : 'yanlış — doğrusu <b>' + esc(o.cevap) + '</b>') + '</div>';
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'passaparola',
    kinds: ['passaparola'],
    reject: ['passaparolaRejected'],
    events: {
      passaparolaResult: function (p) {
        if (!p) return;
        var imza = p.seat + '#' + p.harf + '#' + (p.dogru ? 1 : 0);
        if (sonOlay === imza) return;
        sonOlay = imza;
        ses(p.dogru ? 'kazandi' : 'hata');
        taslakCevap = '';
      },
      passaparolaPassed: function () { ses('tasKoy'); taslakCevap = ''; },
      passaparolaTimeout: function (p) {
        if (!p) return;
        ses('hata');
        uyar('⏱ ' + adOf(p.seat) + ' süresi doldu — sıra rakibe geçti.', 'warning');
        taslakCevap = '';
      }
    },

    /* Damga: SAAT hariç her şey. Saat her saniye değişiyor; HTML'i onun
       için yeniden yazmak cevap kutusunu her saniye siler. */
    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.turn + '#' + (s.soru || '').length + '#' +
        (s.maske || []).join('') + '#' +
        (s.seats || []).map(function (q) {
          var d = (s.durum || {})[q] || {};
          return q + ':' + (s.harfler || []).map(function (h) { return (d[h] || 'b')[0]; }).join('') +
                 ':' + ((s.aktifHarf || {})[q] || '');
        }).join(',') + '#' + JSON.stringify(s.son || null);
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats) return '<div class="pp-wrap"></div>';
      var benimSira = s.turn === s.seat && s.status === 'playing' && !m.isSpectator;
      var h = '<div class="pp-wrap">';
      h += '<div class="pp-carklar">' + s.seats.map(function (q) { return carkHtml(s, q); }).join('') + '</div>';
      h += sonOlayHtml(s);
      h += '<div class="pp-panel">';
      h += '<div class="pp-ust">' +
        '<span class="pp-set">📚 ' + esc(s.setAdi || '') + '</span>' +
        '<span class="pp-sira">' + (s.status !== 'playing' ? 'Maç bitti'
          : benimSira ? '🎯 Sıra sizde' : '⏳ ' + esc(adOf(s.turn)) + ' cevaplıyor') + '</span>' +
        '</div>';
      h += '<div class="pp-soru">' + esc(s.soru || '—') + '</div>';
      h += maskeHtml(s);
      if (s.status !== 'playing' && s.cevap) {
        h += '<div class="pp-cevap-acik">Doğru cevap: <b>' + esc(s.cevap) + '</b></div>';
      }
      h += '<div class="pp-giris-satir">' +
        '<input class="pp-giris" type="text" maxlength="40" autocomplete="off" ' +
        'spellcheck="false" placeholder="Cevabınız"' + (benimSira ? '' : ' disabled') + '>' +
        '<button class="btn pp-gonder" type="button"' + (benimSira ? '' : ' disabled') + '>Cevapla</button>' +
        '</div>';
      h += '<div class="pp-dugmeler">' +
        '<button class="btn secondary pp-pas" type="button"' + (benimSira ? '' : ' disabled') + '>' +
          '🔵 Pas (passaparola)</button>' +
        '<button class="btn secondary pp-harf" type="button"' + (benimSira ? '' : ' disabled') + '>' +
          '💡 Harf al (−' + (s.harfAlCezasi || 5) + ' sn)</button>' +
        '</div>';
      h += '<div class="pp-not">Doğru cevapta sıra sizde kalır; yanlış cevap ve pas sırayı rakibe geçirir.</div>';
      h += '</div></div>';
      return h;
    },

    bind: function (root, m) {
      var s = m.state || {};

      /* --- saat: HTML'den bağımsız tazelenir --- */
      function saatYaz() {
        var gs = m.state || {};
        root.querySelectorAll('.pp-saat').forEach(function (el) {
          var seat = Number(el.dataset.seat);
          var t = sureYaz((gs.saat || {})[seat]);
          if (el.textContent !== t) el.textContent = t;
          el.classList.toggle('az', Number((gs.saat || {})[seat]) <= 10);
        });
      }
      saatYaz();
      if (root.__ppSaat) clearInterval(root.__ppSaat);
      /* Sunucu paketleri saniyede bir gelir; arada yerel sayım yapılır ki
         geri sayım takılmasın. Sunucu paketi geldiğinde değer düzelir. */
      root.__ppSaat = setInterval(function () {
        var gs = m.state;
        if (!gs || gs.status !== 'playing') return;
        var t = gs.turn;
        if (gs.saat && typeof gs.saat[t] === 'number' && gs.saat[t] > 0) gs.saat[t] -= 1;
        saatYaz();
      }, 1000);

      /* --- cevap kutusu --- */
      var kutu = root.querySelector('.pp-giris');
      if (kutu && !kutu.disabled) {
        kutu.value = taslakCevap;
        kutu.addEventListener('input', function () { taslakCevap = this.value; });
        var gonder = function () {
          var v = (kutu.value || '').trim();
          if (!v) return;
          m.emit('passaparolaAnswer', { cevap: v });
          kutu.value = ''; taslakCevap = '';
        };
        kutu.addEventListener('keydown', function (e) { if (e.key === 'Enter') gonder(); });
        var gb = root.querySelector('.pp-gonder');
        if (gb) gb.addEventListener('click', gonder);
        setTimeout(function () { try { kutu.focus(); } catch (_) {} }, 60);
      }
      var pb = root.querySelector('.pp-pas');
      if (pb && !pb.disabled) pb.addEventListener('click', function () {
        taslakCevap = ''; m.emit('passaparolaPass', {});
      });
      var hb = root.querySelector('.pp-harf');
      if (hb && !hb.disabled) hb.addEventListener('click', function () {
        m.emit('passaparolaReveal', {});
      });

      /* --- ölçü: dar ekranda çarklar alt alta, harfler küçülür --- */
      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var g = alan ? alan.getBoundingClientRect().width : 600;
        var dar = g < 620;
        var kap = root.querySelector('.pp-carklar');
        if (kap) kap.classList.toggle('dar', dar);
        /* 27 harf tek satıra sığsın: genişliğe göre harf kutusu. */
        var sutun = dar ? 1 : 2;
        var carkG = (g - (sutun - 1) * 10) / sutun - 20;
        var hk = Math.max(15, Math.min(30, Math.floor((carkG - 26 * 3) / 27)));
        root.style.setProperty('--pp-h', hk + 'px');
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (root.__ppOlcu) {
        window.removeEventListener('resize', root.__ppOlcu);
        window.removeEventListener('orientationchange', root.__ppOlcu);
      }
      root.__ppOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 80); };
      window.addEventListener('resize', root.__ppOlcu);
      window.addEventListener('orientationchange', root.__ppOlcu);
      if (window.visualViewport) {
        if (root.__ppVV) window.visualViewport.removeEventListener('resize', root.__ppVV);
        root.__ppVV = root.__ppOlcu;
        window.visualViewport.addEventListener('resize', root.__ppVV);
      }
      void s;
    }
  });

  window.addEventListener('gv:roomLeft', function () { taslakCevap = ''; sonOlay = null; });

  /* Test/teşhis köprüsü */
  window.__gvPassaparola = { taslak: function () { return taslakCevap; } };
})();
