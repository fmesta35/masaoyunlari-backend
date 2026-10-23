/* ============================================================================
 * FARK BULMACA — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Ekranda aynı sahnenin iki kopyası vardır: üstte özgün (A), altta 7 nesnesi
 * değiştirilmiş kopya (B). Oyuncu farkı gördüğü yere dokunur.
 *
 * SAHNELER fark-sahneler.js'ten gelir — SUNUCUYLA AYNI DOSYA. Böylece
 * tıklama alanları ile çizimler asla birbirinden ayrı düşmez.
 *
 * Sunucu sahneyi, tohumu ve hangi 7 farkın seçildiğini bildirir (B kopyasını
 * istemci çizdiği için bu bilgi zaten resmin içinde). Buna karşılık HER
 * TIKLAMA sunucuda ölçülür; boşa tıklayan kısa süre kilitlenir.
 *
 * ÖLÇEK: iki kopya geniş alanda YAN YANA, dar alanda ALT ALTA dizilir;
 * SVG'ler görünüm kutusunu (800×520) koruyarak alana sığar.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvFarkLoaded) return;
  window.__gvFarkLoaded = true;

  var sonIsaret = null;      // son doğru bulgunun kimliği (kısa vurgulama)
  var kilitBitis = 0;        // yerel kilit bitişi (sunucu da uyguluyor)
  var sonFazOlay = null;

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
  function F() { return window.GVFark || null; }

  /* Bir kopyanın SVG'si. variant 'a' özgün, 'b' farklı olan. */
  function kopyaSvg(s, variant) {
    var f = F();
    if (!f || s.sahneId === null || s.sahneId === undefined) return '';
    var ic = f.sahneCiz(s.sahneId, {
      seed: s.tohum, uid: variant + s.el + 'x', variant: variant, diffs: s.farkIdleri
    });
    /* Bulunan farkların üstüne halka: iki kopyada da işaretlenir. */
    var halka = '';
    (s.bulunan || []).forEach(function (id) {
      var d = (f.farkKonumlari ? f.farkKonumlari(s.sahneId) : (f.FARK_KONUMLARI[s.sahneId] || [])).find(function (x) { return x.id === id; });
      if (!d) return;
      halka += '<circle class="fk-halka' + (sonIsaret === id ? ' yeni' : '') +
        '" cx="' + d.cx + '" cy="' + d.cy + '" r="' + d.r + '"/>';
    });
    /* El bitince bulunamayanlar da gösterilir (öğretici). */
    if (s.farkAdlari) {
      s.farkAdlari.forEach(function (d) {
        if ((s.bulunan || []).indexOf(d.id) !== -1) return;
        halka += '<circle class="fk-halka kacan" cx="' + d.cx + '" cy="' + d.cy + '" r="' + d.r + '"/>';
      });
    }
    return '<svg class="fk-svg" data-v="' + variant + '" viewBox="0 0 ' +
      f.GORUNUM_EN + ' ' + f.GORUNUM_BOY + '" preserveAspectRatio="xMidYMid meet">' +
      ic + halka + '</svg>';
  }

  function sayacYazi(ms) {
    var sn = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    return Math.floor(sn / 60) + ':' + String(sn % 60).padStart(2, '0');
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'fark',
    kinds: ['fark'],
    reject: ['farkRejected'],
    events: {
      farkSonuc: function (p) {
        if (!p) return;
        if (p.dogru) {
          sonIsaret = p.farkId;
          ses('kazandi');
          setTimeout(function () { sonIsaret = null; }, 1200);
        } else if (!p.zaten) {
          ses('hata');
          kilitBitis = Date.now() + (p.kilitMs || 0);
          uyar('❌ Orada fark yok — ' + Math.round((p.kilitMs || 0) / 100) / 10 +
               ' sn bekleyin.', 'warning');
        }
      },
      farkIlerleme: function () { /* çizimi durum paketi yapıyor */ },
      farkFaz: function (p) {
        if (!p) return;
        var imza = p.olay + '#' + p.el;
        if (sonFazOlay === imza) return;
        sonFazOlay = imza;
        if (p.olay === 'elBasladi') { ses('zil'); uyar('🔍 ' + p.el + '. el başladı!', 'info'); }
        else if (p.olay === 'elBitti') {
          ses('tasKoy');
          uyar(p.kazanan === null || p.kazanan === undefined
            ? '🤝 El berabere bitti.' : '🏅 ' + adOf(p.kazanan) + ' eli aldı!', 'success');
        }
      }
    },

    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.faz + '#' + s.el + '#' + s.sahneId + '#' + s.tohum +
        '#' + (s.bulunan || []).join(',') + '#' + s.rakipBulunan +
        '#' + JSON.stringify(s.skor || {}) + '#' + (s.farkAdlari ? '1' : '0');
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats) return '<div class="fk-wrap"></div>';
      var ben = s.seat;
      var rakip = s.seats.find(function (q) { return q !== ben; });
      var h = '<div class="fk-wrap">';

      /* ÜST ŞERİT: el, skor, ilerleme, süre */
      h += '<div class="fk-ust">';
      h += '<div class="fk-oyuncu' + (ben !== null ? ' benim' : '') + '">' +
        '<span class="fk-ad">' + esc(ben === null ? adOf(s.seats[0]) : adOf(ben)) +
          (ben !== null ? ' (Siz)' : '') + '</span>' +
        '<span class="fk-bul">' +
          (ben === null ? ((s.bulunanSayilari || {})[s.seats[0]] || 0) : (s.bulunan || []).length) +
          ' / ' + (s.toplamFark || 7) + '</span></div>';
      h += '<div class="fk-orta">' +
        '<span class="fk-el">EL ' + s.el + '</span>' +
        '<span class="fk-skor">' + ((s.skor || {})[s.seats[0]] || 0) + ' — ' +
          ((s.skor || {})[s.seats[1]] || 0) + '</span>' +
        '<span class="fk-sure">' + sayacYazi(s.kalanMs) + '</span></div>';
      h += '<div class="fk-oyuncu sag">' +
        '<span class="fk-ad">' + esc(ben === null ? adOf(s.seats[1]) : adOf(rakip)) + '</span>' +
        '<span class="fk-bul">' +
          (ben === null ? ((s.bulunanSayilari || {})[s.seats[1]] || 0) : (s.rakipBulunan || 0)) +
          ' / ' + (s.toplamFark || 7) + '</span></div>';
      h += '</div>';

      h += '<div class="fk-sahne-adi">🖼️ <b>' + esc(s.sahneAdi) + '</b> — ' +
           esc(s.sahneAlt) + '</div>';

      if (!F()) {
        h += '<div class="fk-uyari">Sahne çizimleri yüklenemedi — sayfayı yenileyin.</div>';
        return h + '</div>';
      }

      h += '<div class="fk-resimler">' +
        '<div class="fk-kutu"><span class="fk-etiket">A</span>' + kopyaSvg(s, 'a') + '</div>' +
        '<div class="fk-kutu"><span class="fk-etiket">B</span>' + kopyaSvg(s, 'b') + '</div>' +
        '</div>';

      if (s.faz === 'gerisayim') {
        h += '<div class="fk-perde"><b>' + Math.max(1, Math.ceil((s.kalanMs || 0) / 1000)) +
             '</b><span>Hazır olun…</span></div>';
      } else if (s.faz === 'elSonu' || s.status !== 'playing') {
        var k = s.elKazanani;
        h += '<div class="fk-perde bitti"><b>' +
          (s.status !== 'playing' ? 'Maç bitti'
            : (k === null || k === undefined ? 'El berabere' : esc(adOf(k)) + ' eli aldı')) +
          '</b><span>Kaçırdığınız farklar kırmızı halkayla gösterildi.</span></div>';
      }
      h += '<div class="fk-not">' +
        (ben === null ? '👁️ İzleyicisiniz.'
          : 'Farkı gördüğünüz yere dokunun. Boşa dokunmak kısa süre kilitler — ' +
            'rastgele tıklamak işe yaramaz.') + '</div>';
      return h + '</div>';
    },

    bind: function (root, m) {
      var s = m.state || {};
      var f = F();
      if (!f) return;

      /* --- tıklama: ekran noktasını 800×520 sahne koordinatına çevir --- */
      function tikla(e, svg) {
        if (s.seat === null || s.seat === undefined) return;
        if (m.state && m.state.faz !== 'oyun') return;
        if (Date.now() < kilitBitis) return;
        var r = svg.getBoundingClientRect();
        /* preserveAspectRatio="meet": SVG kutuya ortalanarak sığar, bu yüzden
           kutunun kenarındaki boşluk da hesaba katılmalı. */
        var ol = Math.min(r.width / f.GORUNUM_EN, r.height / f.GORUNUM_BOY);
        var gx = (r.width - f.GORUNUM_EN * ol) / 2;
        var gy = (r.height - f.GORUNUM_BOY * ol) / 2;
        var x = (e.clientX - r.left - gx) / ol;
        var y = (e.clientY - r.top - gy) / ol;
        if (x < 0 || y < 0 || x > f.GORUNUM_EN || y > f.GORUNUM_BOY) return;
        m.emit('farkClick', { x: Math.round(x), y: Math.round(y) });
      }
      root.querySelectorAll('.fk-svg').forEach(function (svg) {
        svg.addEventListener('pointerdown', function (e) { tikla(e, svg); e.preventDefault(); });
      });

      /* --- süre: HTML'i yeniden yazmadan tazele --- */
      if (root.__fkSaat) clearInterval(root.__fkSaat);
      root.__fkSaat = setInterval(function () {
        var gs = m.state;
        if (!gs) return;
        if (typeof gs.kalanMs === 'number' && gs.kalanMs > 0) gs.kalanMs -= 250;
        var el = root.querySelector('.fk-sure');
        if (el) {
          var t = sayacYazi(gs.kalanMs);
          if (el.textContent !== t) el.textContent = t;
          el.classList.toggle('az', (gs.kalanMs || 0) <= 10000);
        }
        var perde = root.querySelector('.fk-perde:not(.bitti) b');
        if (perde && gs.faz === 'gerisayim') {
          perde.textContent = String(Math.max(1, Math.ceil((gs.kalanMs || 0) / 1000)));
        }
      }, 250);

      /* --- ölçü: geniş alanda yan yana, dar alanda alt alta --- */
      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var r = alan ? alan.getBoundingClientRect() : { width: 600, height: 520 };
        var ust = root.querySelector('.fk-ust');
        var ad = root.querySelector('.fk-sahne-adi');
        var not = root.querySelector('.fk-not');
        var pay = (ust ? ust.getBoundingClientRect().height : 0) +
                  (ad ? ad.getBoundingClientRect().height : 0) +
                  (not ? not.getBoundingClientRect().height : 0) + 44;
        var g = Math.max(240, r.width);
        var y = Math.max(220, (r.height || 520) - pay);
        /* İki kopya yan yana mı sığar, alt alta mı? Her kopyanın oranı
           800/520 = 1.54; yan yana gidince toplam oran 3.08 olur. */
        var yanyana = (g / y) > 1.9;
        var kap = root.querySelector('.fk-resimler');
        if (kap) kap.classList.toggle('yanyana', yanyana);
        var kutuG = yanyana ? (g - 10) / 2 : g;
        var kutuY = yanyana ? y : (y - 8) / 2;
        var ol = Math.min(kutuG / f.GORUNUM_EN, kutuY / f.GORUNUM_BOY);
        root.querySelectorAll('.fk-kutu').forEach(function (k) {
          k.style.width = Math.floor(f.GORUNUM_EN * ol) + 'px';
          k.style.height = Math.floor(f.GORUNUM_BOY * ol) + 'px';
        });
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (root.__fkOlcu) {
        window.removeEventListener('resize', root.__fkOlcu);
        window.removeEventListener('orientationchange', root.__fkOlcu);
      }
      root.__fkOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 90); };
      window.addEventListener('resize', root.__fkOlcu);
      window.addEventListener('orientationchange', root.__fkOlcu);
      if (window.visualViewport) {
        if (root.__fkVV) window.visualViewport.removeEventListener('resize', root.__fkVV);
        root.__fkVV = root.__fkOlcu;
        window.visualViewport.addEventListener('resize', root.__fkVV);
      }
    }
  });

  window.addEventListener('gv:roomLeft', function () {
    sonIsaret = null; kilitBitis = 0; sonFazOlay = null;
  });

  window.__gvFarkOyun = { kilit: function () { return kilitBitis; } };
})();
