/* ============================================================================
 * PASSAPAROLA — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * İki kişilik bilgi yarışması — EŞZAMANLI: iki yarışmacı aynı soruları
 * aynı anda, kendi çarkında ve kendi saatiyle (180 sn) cevaplar; kimse
 * rakibinin sorusunu görmez. İkisi de bitirince bütün sorular, cevaplar
 * ve sonuç birlikte açılır (rövanş ortak katmandan). Ekran üç parçadır:
 *   · İKİ ÇARK — her oyuncunun 27 harfi; yeşil doğru, kırmızı yanlış,
 *     mavi pas, sarı o an sorulan harf.
 *   · SORU PANELİ — soru metni, cevabın harf maskesi ve giriş kutusu.
 *   · SAATLER — oyuncu başına ayrı geri sayım; oynayan herkesinki işler.
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

  var taslakCevap = '';
  var odakta = false;          // cevap kutusu odakta mıydı (yeniden çizimde korunur)
  var sonSoruImza = '';
  function dokunmatik() {
    try { return window.matchMedia('(pointer: coarse)').matches; } catch (_) { return false; }
  }          // kutuya yazılan ama gönderilmeyen metin
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
  /* CEVAP KUTUSU NEDEN BOZULUYORDU (kullanıcı raporu: "yazı yazacağım
     noktada imleç sürekli aktif oluyor, sürekli tıklama döngüsü var, yazı
     düzgün yazılmıyor"): çarkın HTML'i saati ve RAKİBİN ilerlemesini de
     içeriyordu. Saat her saniye, rakip her cevapta değiştiği için ortak
     yaşam döngüsü bütün masayı — cevap kutusu dahil — yeniden yazıyor ve
     kutuya tekrar odaklanıyordu: klavye kapanıp açılıyor, yazılan harf ve
     klavyenin kelime önerisi kayboluyordu. Artık HTML yalnız SİZİN
     durumunuzdan oluşur; saat ve rakibin çarkı yerinde (DOM üzerinden)
     tazelenir, kutu yalnız sizin cevabınız işlendiğinde yeniden kurulur. */
  function carkIc(s, seat) {
    var d = (s.durum || {})[seat] || {};
    var aktif = (s.aktifHarf || {})[seat];
    var sirada = !!(s.oynuyor && s.oynuyor[seat]) && s.status === 'playing';
    return {
      sirada: sirada,
      dogru: (s.dogru || {})[seat] || 0,
      harfler: (s.harfler || []).map(function (h) {
        var durum = d[h] || 'bos';
        return '<span class="pp-h ' + durum + (h === aktif && sirada ? ' aktif' : '') + '">' + h + '</span>';
      }).join('')
    };
  }
  function carkHtml(s, seat, yalin) {
    var c = carkIc(s, seat);
    if (yalin) {                     // rakip: içerik bind'de yerinde yazılır
      c.harfler = (s.harfler || []).map(function (h) { return '<span class="pp-h bos">' + h + '</span>'; }).join('');
      c.dogru = '';
    }
    return '<div class="pp-cark' + (seat === s.seat ? ' benim' : '') + (c.sirada && !yalin ? ' sirada' : '') +
      '" data-seat="' + seat + '"' + (yalin ? ' data-yalin="1"' : '') + '>' +
      '<div class="pp-cark-bas">' +
        '<span class="pp-ad">' + esc(adOf(seat)) + (seat === s.seat ? ' (Siz)' : '') + '</span>' +
        '<span class="pp-dogru">✅ ' + c.dogru + '</span>' +
        '<span class="pp-saat" data-seat="' + seat + '"></span>' +
      '</div>' +
      '<div class="pp-harfler">' + c.harfler + '</div></div>';
  }

  function maskeHtml(s) {
    return '<div class="pp-maske">' + (s.maske || []).map(function (ch) {
      if (ch === ' ') return '<span class="pp-bosluk"></span>';
      return '<span class="pp-mk' + (ch ? ' acik' : '') + '">' + esc(ch || '') + '</span>';
    }).join('') + '</div>';
  }

  function sonOlayHtml(s) {
    var o = s.son;
    if (!o || s.status !== 'playing') return '';
    if (o.tur === 'sure') return '<div class="pp-son sure">⏱ Süreniz doldu.</div>';
    if (o.tur === 'pas') return '<div class="pp-son pas">🔵 <b>' + esc(o.harf) + '</b> harfini pas geçtiniz.</div>';
    return '<div class="pp-son ' + (o.dogru ? 'dogru' : 'yanlis') + '">' +
      (o.dogru ? '✅ <b>' + esc(o.harf) + '</b>: doğru!' :
       '❌ <b>' + esc(o.harf) + '</b>: yanlış — doğrusu <b>' + esc(o.cevap) + '</b>') + '</div>';
  }

  var DURUM_IKON = { dogru: '✅', yanlis: '❌', pas: '🔵', bos: '—' };
  /* Maç sonu: iki taraf da bitirdi — sonuç + bütün sorular ve cevaplar. */
  function ozetHtml(s, m) {
    var r = s.result || {};
    var w = s.winner;
    var baslik;
    if (w === null || w === undefined) baslik = '🤝 Berabere';
    else if (!m.isSpectator && w === s.seat) baslik = '🏆 Kazandınız!';
    else if (!m.isSpectator) baslik = '😔 ' + esc(adOf(w)) + ' kazandı';
    else baslik = '🏆 ' + esc(adOf(w)) + ' kazandı';
    var d = r.dogru || s.dogru || {};
    var h = '<div class="pp-sonuc">' + baslik + '</div>';
    h += '<div class="pp-not" style="text-align:center">' + (s.seats || []).map(function (q) {
      return esc(adOf(q)) + ': <b>' + (d[q] || 0) + '</b> doğru · ' + sureYaz((s.saat || {})[q]) + ' kaldı';
    }).join(' &nbsp;|&nbsp; ') + (r.sureFarki ? ' — eşitlik kalan süreyle bozuldu' : '') + '</div>';
    if (s.ozet && s.ozet.length) {
      h += '<div class="pp-ozet-kap"><table class="pp-ozet"><thead><tr><th></th><th>Soru</th><th>Cevap</th>' +
        (s.seats || []).map(function (q) { return '<th>' + esc(adOf(q)).slice(0, 10) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + s.ozet.map(function (x) {
          return '<tr><td class="h">' + esc(x.harf) + '</td><td>' + esc(x.soru) + '</td><td class="c">' + esc(x.cevap) + '</td>' +
            (s.seats || []).map(function (q) { return '<td class="d">' + (DURUM_IKON[(x.durum || {})[q]] || '—') + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>';
    }
    return h;
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
        var ben = window.__gvPassaparolaSeat;
        if (p.seat === ben) {
          ses('hata'); taslakCevap = '';
          uyar('⏱ Süreniz doldu — rakibinizin bitirmesi bekleniyor.', 'warning');
        } else {
          uyar('⏱ ' + adOf(p.seat) + ' adlı yarışmacının süresi doldu.', 'info');
        }
      }
    },

    /* Damga: SAAT hariç her şey. Saat her saniye değişiyor; HTML'i onun
       için yeniden yazmak cevap kutusunu her saniye siler. */
    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + JSON.stringify(s.oynuyor || {}) + '#' + (s.soru || '') + '#' +
        (s.ozet ? 'Z' : '') + '#' + (s.winner == null ? '' : s.winner) + '#' +
        (s.maske || []).join('') + '#' +
        (s.seats || []).filter(function (q) {
          return m.isSpectator || s.status !== 'playing' || q === s.seat;
        }).map(function (q) {
          var d = (s.durum || {})[q] || {};
          return q + ':' + (s.harfler || []).map(function (h) { return (d[h] || 'b')[0]; }).join('') +
                 ':' + ((s.aktifHarf || {})[q] || '');
        }).join(',') + '#' + JSON.stringify(s.son || null);
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats) return '<div class="pp-wrap"></div>';
      window.__gvPassaparolaSeat = m.isSpectator ? null : s.seat;
      var oynuyorum = s.status === 'playing' && !m.isSpectator && !!(s.oynuyor && s.oynuyor[s.seat]);
      var h = '<div class="pp-wrap">';
      var canli = s.status === 'playing' && !m.isSpectator;
      h += '<div class="pp-carklar">' + s.seats.map(function (q) {
        return carkHtml(s, q, canli && q !== s.seat);
      }).join('') + '</div>';
      h += sonOlayHtml(s);
      h += '<div class="pp-panel">';
      var durumYazi = s.status !== 'playing' ? '🏁 Yarışma bitti'
        : m.isSpectator ? '👀 İki yarışmacı aynı anda oynuyor'
        : oynuyorum ? '🎯 Yarışma sürüyor — rakibiniz de aynı anda cevaplıyor'
        : '✅ Bitirdiniz — rakibinizin bitirmesi bekleniyor';
      h += '<div class="pp-ust"><span class="pp-set">📚 ' + esc(s.setAdi || '') + '</span>' +
        '<span class="pp-sira">' + durumYazi + '</span>' +
        (oynuyorum ? '<span class="pp-yaz-saat">⏱ <span class="pp-saat" data-seat="' + s.seat + '"></span>' +
          ' · <b>' + esc(((s.aktifHarf || {})[s.seat]) || '') + '</b></span>' : '') + '</div>';
      if (s.status !== 'playing') {
        h += ozetHtml(s, m);
        h += '</div></div>';
        return h;
      }
      if (!oynuyorum) {
        h += '<div class="pp-bekle">' + (m.isSpectator
          ? 'Yarışmacılar kendi sorularını aynı anda cevaplıyor. Sorular ve doğru cevaplar maç bitince burada açılacak.'
          : 'Siz bitirdiniz. Rakibiniz bitirince (ya da süresi dolunca) sonuçlar ve bütün cevaplar birlikte açılacak.') + '</div>';
        h += '</div></div>';
        return h;
      }
      h += '<div class="pp-soru">' + esc(s.soru || '—') + '</div>';
      h += maskeHtml(s);
      h += '<div class="pp-giris-satir">' +
        '<input class="pp-giris" type="text" maxlength="40" autocomplete="off" ' +
        'spellcheck="false" placeholder="Cevabınız">' +
        '<button class="btn pp-gonder" type="button">Cevapla</button>' +
        '</div>';
      h += '<div class="pp-dugmeler">' +
        '<button class="btn secondary pp-pas" type="button">🔵 Pas (passaparola)</button>' +
        '<button class="btn secondary pp-harf" type="button">💡 Harf al (−' + (s.harfAlCezasi || 5) + ' sn)</button>' +
        '</div>';
      h += '<div class="pp-not">İki yarışmacı aynı soruları aynı anda cevaplar; kimse rakibinin sorusunu görmez. ' +
        'Doğru, yanlış ya da pas — çarkınız sıradaki harfe geçer. Sonuçlar ikiniz de bitirince açılır.</div>';
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
        if (gs.duraklatildi || m.duraklatildi) return;      // masa duraklatıldıysa saat donuk
        (gs.seats || []).forEach(function (t) {
          if (!(gs.oynuyor && gs.oynuyor[t])) return;
          if (gs.saat && typeof gs.saat[t] === 'number' && gs.saat[t] > 0) gs.saat[t] -= 1;
        });
        saatYaz();
        rakipYaz();
      }, 1000);
      rakipYaz();

      /* --- rakibin çarkı: yerinde tazelenir (HTML yeniden yazılmaz) --- */
      function rakipYaz() {
        var gs = m.state || {};
        root.querySelectorAll('.pp-cark[data-yalin]').forEach(function (el) {
          var c = carkIc(gs, Number(el.dataset.seat));
          el.classList.toggle('sirada', c.sirada);
          var hk = el.querySelector('.pp-harfler');
          if (hk && hk.__ppSon !== c.harfler) { hk.innerHTML = c.harfler; hk.__ppSon = c.harfler; }
          var dk = el.querySelector('.pp-dogru');
          var dt = '✅ ' + c.dogru;
          if (dk && dk.textContent !== dt) dk.textContent = dt;
        });
      }

      /* --- cevap kutusu --- */
      var kutu = root.querySelector('.pp-giris');
      if (kutu && !kutu.disabled) {
        kutu.value = taslakCevap;
        kutu.addEventListener('input', function () { taslakCevap = this.value; });
        kutu.addEventListener('focus', function () { odakta = true; });
        kutu.addEventListener('blur', function () { setTimeout(function () {
          if (!document.activeElement || !document.activeElement.classList ||
              !document.activeElement.classList.contains('pp-giris')) odakta = false;
        }, 0); });
        var gonder = function () {
          var v = (kutu.value || '').trim();
          if (!v) return;
          m.emit('passaparolaAnswer', { cevap: v });
          kutu.value = ''; taslakCevap = '';
        };
        kutu.addEventListener('keydown', function (e) { if (e.key === 'Enter') gonder(); });
        var gb = root.querySelector('.pp-gonder');
        if (gb) gb.addEventListener('click', gonder);
        /* Düğmeye basmak kutudan odağı almasın: telefonda klavye kapanıp
           açılmasın, oyuncu yazmayı kesintisiz sürdürsün. */
        root.querySelectorAll('.pp-gonder,.pp-pas,.pp-harf').forEach(function (b) {
          b.addEventListener('pointerdown', function (e) { if (odakta) e.preventDefault(); });
          b.addEventListener('mousedown', function (e) { if (odakta) e.preventDefault(); });
        });
        /* YAZMA KİPİ: kutu odakta ve görünen alan alçaksa (klavye açık) */
        var wrap = root.querySelector('.pp-wrap');
        var yazKipi = function () {
          if (!wrap) return;
          var vv = window.visualViewport;
          var gy = vv && vv.height ? vv.height : window.innerHeight;
          var ac = (document.activeElement === kutu) && gy < 480;
          if (wrap.classList.contains('pp-yaz') !== ac) {
            wrap.classList.toggle('pp-yaz', ac);
            if (ac) setTimeout(function () {
              try { kutu.scrollIntoView({ block: 'center' }); } catch (_) {}
            }, 60);
          }
        };
        kutu.addEventListener('focus', function () { setTimeout(yazKipi, 250); });
        kutu.addEventListener('blur', function () { setTimeout(yazKipi, 120); });
        if (root.__ppYazVV && window.visualViewport) window.visualViewport.removeEventListener('resize', root.__ppYazVV);
        root.__ppYazVV = yazKipi;
        if (window.visualViewport) window.visualViewport.addEventListener('resize', yazKipi);
        setTimeout(yazKipi, 300);
        /* Odak YALNIZ kutu zaten odaktaysa (yazmaya devam) ya da bu sorunun
           ilk çiziminde geri verilir — her çizimde zorla odaklamak telefonda
           klavyeyi kapatıp açıyordu. İmleç sona konur. */
        var soruImza = String(s.soru || '') + '#' + ((s.aktifHarf || {})[s.seat] || '');
        var ilkCizim = soruImza !== sonSoruImza;
        sonSoruImza = soruImza;
        if (odakta || (ilkCizim && !dokunmatik())) {
          setTimeout(function () {
            try {
              kutu.focus({ preventScroll: true });
              var n = kutu.value.length;
              kutu.setSelectionRange(n, n);
            } catch (_) {}
          }, 30);
        }
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

  window.addEventListener('gv:roomLeft', function () { taslakCevap = ''; sonOlay = null; odakta = false; sonSoruImza = ''; });

  /* Test/teşhis köprüsü */
  window.__gvPassaparola = { taslak: function () { return taslakCevap; } };
})();
