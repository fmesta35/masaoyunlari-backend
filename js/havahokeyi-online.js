/* ============================================================================
 * HAVA HOKEYİ — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Sıra yoktur: iki oyuncu da aynı anda oynar. Fizik tamamen sunucudadır
 * (havahokeyi-engine.js, 120 Hz); istemci saniyede ~20 kez gelen 'hokeyFrame'
 * paketlerini alır, aralarını yumuşatarak tuvale çizer ve karşılığında tek
 * bir şey yollar: tokmağının gitmesini istediği nokta.
 *
 * Parmağınız/fareniz masanın neresindeyse tokmak oraya koşar; kendi yarı
 * sahanızın dışına çıkamaz (sınırı sunucu uygular, istemci yalnız gösterir).
 *
 * ÖLÇEK: tuval ölçülen alana sığar ve masa oranı (5:3) korunur. Dar ve uzun
 * alanda (dikey telefon) masa 90° ÇEVRİLİR: kaleler yukarı-aşağı gelir,
 * oyuncu kendi yarısını altta görür.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvHavahokeyiLoaded) return;
  window.__gvHavahokeyiLoaded = true;

  var MASA_EN = 1000, MASA_BOY = 600;
  var ALAN = { sol: 48, sag: 952, ust: 48, alt: 552 };
  var KALE_UST = 205, KALE_ALT = 395;
  var DISK_R = 20, TOKMAK_R = 43;
  var kare = null, oncekiKare = null, kareZamani = 0;
  var benimKoltuk = null;
  var cizimId = null, sonOlayNo = -1, sonGonderim = 0;

  function ses(ad) { try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal(ad); } catch (_) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function adOf(seat) {
    try {
      var r = window.__gvActiveRoom || (window.st && st.roomWaitingState && st.roomWaitingState.room);
      var p = r && (r.players || []).find(function (x) { return x.seat === seat; });
      if (p && p.name) return p.name;
    } catch (_) {}
    return 'Koltuk ' + (seat + 1);
  }
  function kirp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* --------------------------------------------------------------- ÇİZİM */
  function ciz(tuval, s) {
    var ctx = tuval.getContext('2d');
    var dar = tuval.__dar;
    var ters = tuval.__ters;          // koltuk 1 masayı ters görür
    var W = tuval.width, H = tuval.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    var ol;
    if (dar) {
      ol = Math.min(W / MASA_BOY, H / MASA_EN);
      ctx.translate((W - MASA_BOY * ol) / 2, (H - MASA_EN * ol) / 2);
      ctx.scale(ol, ol);
      ctx.translate(MASA_BOY, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ol = Math.min(W / MASA_EN, H / MASA_BOY);
      ctx.translate((W - MASA_EN * ol) / 2, (H - MASA_BOY * ol) / 2);
      ctx.scale(ol, ol);
    }
    /* Kendi yarınız HER ZAMAN size yakın tarafta olsun. */
    if (ters) { ctx.translate(MASA_EN, MASA_BOY); ctx.rotate(Math.PI); }

    /* --- masa --- */
    ctx.fillStyle = '#0b1b2b';
    ctx.fillRect(0, 0, MASA_EN, MASA_BOY);
    ctx.fillStyle = '#10263c';
    ctx.fillRect(ALAN.sol - 20, ALAN.ust - 20, (ALAN.sag - ALAN.sol) + 40, (ALAN.alt - ALAN.ust) + 40);
    ctx.fillStyle = '#0e3550';
    ctx.fillRect(ALAN.sol, ALAN.ust, ALAN.sag - ALAN.sol, ALAN.alt - ALAN.ust);
    /* yarı saha vurguları */
    ctx.fillStyle = 'rgba(226,87,76,.10)';
    ctx.fillRect(ALAN.sol, ALAN.ust, (ALAN.sag - ALAN.sol) / 2, ALAN.alt - ALAN.ust);
    ctx.fillStyle = 'rgba(59,130,246,.10)';
    ctx.fillRect(500, ALAN.ust, (ALAN.sag - ALAN.sol) / 2, ALAN.alt - ALAN.ust);

    ctx.strokeStyle = 'rgba(180,225,255,.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(ALAN.sol, ALAN.ust, ALAN.sag - ALAN.sol, ALAN.alt - ALAN.ust);
    ctx.beginPath(); ctx.moveTo(500, ALAN.ust); ctx.lineTo(500, ALAN.alt); ctx.stroke();
    ctx.beginPath(); ctx.arc(500, 300, 74, 0, Math.PI * 2); ctx.stroke();
    /* kale ağızları */
    ['#e2574c', '#3b82f6'].forEach(function (renk, i) {
      var x = i === 0 ? ALAN.sol - 20 : ALAN.sag;
      ctx.fillStyle = renk;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, KALE_UST, 20, KALE_ALT - KALE_UST);
      ctx.globalAlpha = 1;
    });
    /* direkler */
    ctx.fillStyle = '#cfe3f5';
    [[ALAN.sol, KALE_UST], [ALAN.sol, KALE_ALT], [ALAN.sag, KALE_UST], [ALAN.sag, KALE_ALT]]
      .forEach(function (p) {
        ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, Math.PI * 2); ctx.fill();
      });

    if (!s) { ctx.restore(); return; }

    /* --- tokmaklar --- */
    (s.tokmak || []).forEach(function (t, i) {
      var renk = i === 0 ? '#e2574c' : '#3b82f6';
      var koyu = i === 0 ? '#8d2e26' : '#1e4d9b';
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.beginPath(); ctx.arc(t.x + 3, t.y + 6, TOKMAK_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = koyu;
      ctx.beginPath(); ctx.arc(t.x, t.y, TOKMAK_R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = renk;
      ctx.beginPath(); ctx.arc(t.x, t.y, TOKMAK_R - 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = koyu;
      ctx.beginPath(); ctx.arc(t.x, t.y, TOKMAK_R - 18, 0, Math.PI * 2); ctx.fill();
      if (i === benimKoltuk) {
        ctx.strokeStyle = '#ffd666'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(t.x, t.y, TOKMAK_R + 5, 0, Math.PI * 2); ctx.stroke();
      }
    });

    /* --- disk --- */
    var d = s.disk;
    if (d) {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath(); ctx.ellipse(d.x + 2, d.y + 5, DISK_R, DISK_R * .9, 0, 0, Math.PI * 2); ctx.fill();
      var gr = ctx.createRadialGradient(d.x - 5, d.y - 6, 2, d.x, d.y, DISK_R);
      gr.addColorStop(0, '#f4f7fb'); gr.addColorStop(1, '#8e9bb0');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(d.x, d.y, DISK_R, 0, Math.PI * 2); ctx.fill();
    }

    /* --- geri sayım / gol --- */
    if (s.faz === 'gerisayim' || s.faz === 'gol') {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(0, 0, MASA_EN, MASA_BOY);
      ctx.fillStyle = '#ffd666';
      ctx.font = 'bold 92px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.save();
      ctx.translate(500, 300);
      if (ters) ctx.rotate(Math.PI);
      if (dar) ctx.rotate(-Math.PI / 2);
      ctx.fillText(s.faz === 'gol' ? 'GOL!' : String(Math.max(1, Math.ceil(s.fazSn))), 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  /* ⚠ TİTREŞİMİN SEBEBİ BUYDU: eski sürüm k'yı 1.6'ya kadar çıkarıp son
     paketin ÖTESİNE tahmin yürütüyordu (ekstrapolasyon). Yeni paket gelince
     konum geri sıçrıyor, disk ve tokmak sürekli titriyordu.
     Artık YALNIZ iki paket ARASINDA değer üretilir (k ∈ [0,1]) ve payda
     sabit 50 ms değil, ÖLÇÜLEN paket aralığıdır — paket geç kalırsa görüntü
     hızlanıp durmaz, sadece biraz yavaşlar. Bedeli ~bir paketlik (≈50 ms)
     gecikmedir; kendi tokmağınız zaten yerel olarak çizildiği için bu
     gecikme hissedilmez (bkz. yerelTokmak). */
  var kareAraligi = 50;
  function araDeger() {
    if (!kare) return null;
    if (!oncekiKare) return kare;
    var k = kirp((Date.now() - kareZamani) / Math.max(16, kareAraligi), 0, 1);
    var ka = function (x, y) { return x + (y - x) * k; };
    var a = oncekiKare, b = kare;
    return {
      faz: b.faz, fazSn: b.fazSn, skor: b.skor,
      disk: { x: ka(a.disk.x, b.disk.x), y: ka(a.disk.y, b.disk.y) },
      tokmak: (b.tokmak || []).map(function (t, i) {
        var o = (a.tokmak || [])[i];
        return o ? { x: ka(o.x, t.x), y: ka(o.y, t.y) } : t;
      })
    };
  }

  /* ---------------------------------------------- YEREL TOKMAK (tahmin)
     Kendi tokmağınız sunucudan dönmeyi BEKLEMEZ: imleci yerelde, sunucunun
     kullandığı hız ve sınırların AYNISIYLA takip eder. Böylece kontrol
     anında hissedilir; sunucudan gelen konum yalnız yumuşakça düzeltir.
     (Sunucu yine de son sözü söyler — hile mümkün değil.) */
  var yerel = null;        // { x, y }
  var hedef = null;        // imlecin masa koordinatındaki yeri
  var yerelZaman = 0;
  function tokmakKirpYerel(t, oyuncu) {
    var pay = 7;
    var minX = oyuncu === 0 ? ALAN.sol + TOKMAK_R + pay : (MASA_EN / 2) + TOKMAK_R + 8;
    var maxX = oyuncu === 0 ? (MASA_EN / 2) - TOKMAK_R - 8 : ALAN.sag - TOKMAK_R - pay;
    t.x = kirp(t.x, minX, maxX);
    t.y = kirp(t.y, ALAN.ust + TOKMAK_R + pay, ALAN.alt - TOKMAK_R - pay);
    return t;
  }
  function yerelTokmak(sunucuKare) {
    if (benimKoltuk === null || !sunucuKare || !sunucuKare.tokmak) return null;
    var sv = sunucuKare.tokmak[benimKoltuk];
    if (!sv) return null;
    var simdi = Date.now();
    var dt = Math.min(0.1, (simdi - (yerelZaman || simdi)) / 1000);
    yerelZaman = simdi;
    if (!yerel) yerel = { x: sv.x, y: sv.y };
    if (hedef) {
      var dx = hedef.x - yerel.x, dy = hedef.y - yerel.y;
      var uz = Math.hypot(dx, dy);
      var adim = Math.min(uz, 1120 * dt);          // sunucuyla AYNI hız
      if (uz > 0.001) { yerel.x += (dx / uz) * adim; yerel.y += (dy / uz) * adim; }
    }
    /* Sunucuya yumuşak yakınsama: aradaki fark büyürse (paket kaybı, hile
       denemesi, kale sonrası sıfırlama) yerel konum sunucuya çekilir. */
    var fx = sv.x - yerel.x, fy = sv.y - yerel.y;
    var fark = Math.hypot(fx, fy);
    if (fark > 90) { yerel.x = sv.x; yerel.y = sv.y; }
    else if (fark > 1) { var c = Math.min(1, dt * 6); yerel.x += fx * c; yerel.y += fy * c; }
    return tokmakKirpYerel({ x: yerel.x, y: yerel.y }, benimKoltuk);
  }
  /* Çizime verilecek kare: disk ve rakip ara değerden, KENDİ tokmağınız
     yerelden. */
  function cizimKaresi(s) {
    var g = araDeger() || (s ? { faz: s.faz, fazSn: s.fazSn, skor: s.skor,
                                 disk: s.disk, tokmak: s.tokmak } : null);
    if (!g) return null;
    var y = yerelTokmak(kare || g);
    if (y && g.tokmak) { g.tokmak = g.tokmak.slice(); g.tokmak[benimKoltuk] = y; }
    return g;
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'havahokeyi',
    kinds: ['havahokeyi'],
    reject: ['hokeyRejected'],
    events: {
      hokeyFrame: function (p) {
        if (!p || !p.disk) return;
        var simdi = Date.now();
        /* Paket aralığını ÖLÇ (yumuşatılmış): ara değer bunu payda olarak
           kullanır, böylece ağ dalgalanmasında görüntü sıçramaz. */
        if (kareZamani) {
          var d = simdi - kareZamani;
          if (d > 8 && d < 400) kareAraligi = kareAraligi * 0.8 + d * 0.2;
        }
        oncekiKare = kare || p;
        kare = p;
        kareZamani = simdi;
        if (p.olayNo !== sonOlayNo) {
          sonOlayNo = p.olayNo;
          if (p.sonOlay === 'gol') ses('kazandi');
          else if (p.sonOlay === 'vurus') ses('tasKoy');
          else if (p.sonOlay === 'duvar') ses('zil');
        }
        var sk = document.querySelector('#boardArea .hk-skor-yazi');
        if (sk && p.skor) {
          var t = p.skor[0] + ' — ' + p.skor[1];
          if (sk.textContent !== t) sk.textContent = t;
        }
      }
    },

    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.faz + '#' + (s.skor ? s.skor.join('-') : '') +
             '#' + s.golHedefi + '#' + s.seat;
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats) return '<div class="hk-wrap"></div>';
      var h = '<div class="hk-wrap">';
      h += '<div class="hk-ust">' +
        '<span class="hk-takim kirmizi' + (s.seat === 0 ? ' benim' : '') + '">' +
          esc(adOf(0)) + (s.seat === 0 ? ' (Siz)' : '') + '</span>' +
        '<span class="hk-skor-yazi">' + ((s.skor || [])[0] || 0) + ' — ' +
          ((s.skor || [])[1] || 0) + '</span>' +
        '<span class="hk-takim mavi' + (s.seat === 1 ? ' benim' : '') + '">' +
          esc(adOf(1)) + (s.seat === 1 ? ' (Siz)' : '') + '</span>' +
        '</div>';
      h += '<div class="hk-hedef">İlk <b>' + (s.golHedefi || 5) + '</b> golü atan kazanır' +
           (s.status !== 'playing' ? ' · <b>Maç bitti</b>' : '') + '</div>';
      h += '<div class="hk-masa"><canvas class="hk-tuval"></canvas></div>';
      h += '<div class="hk-not">' +
        ((s.seat === 0 || s.seat === 1)
          ? 'Parmağınızı/fareyi masada gezdirin — tokmağınız oraya koşar. Kendi yarı sahanızın dışına çıkamazsınız.'
          : '👁️ İzleyicisiniz — masayı izliyorsunuz.') + '</div>';
      return h + '</div>';
    },

    bind: function (root, m) {
      var s = m.state || {};
      if (s.masaEn) { MASA_EN = s.masaEn; MASA_BOY = s.masaBoy; }
      if (s.alan) ALAN = s.alan;
      if (typeof s.kaleUst === 'number') { KALE_UST = s.kaleUst; KALE_ALT = s.kaleAlt; }
      if (s.diskR) { DISK_R = s.diskR; TOKMAK_R = s.tokmakR; }
      benimKoltuk = (s.seat === 0 || s.seat === 1) ? s.seat : null;

      var tuval = root.querySelector('.hk-tuval');
      if (!tuval) return;
      tuval.__ters = benimKoltuk === 1;

      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var r = alan ? alan.getBoundingClientRect() : { width: 600, height: 500 };
        var ust = root.querySelector('.hk-ust');
        var not = root.querySelector('.hk-not');
        var kullanilan = (ust ? ust.getBoundingClientRect().height : 0) +
                         (not ? not.getBoundingClientRect().height : 0) + 52;
        var g = Math.max(240, r.width);
        var y = Math.max(200, (r.height || 500) - kullanilan);
        var dar = (g / Math.max(1, y)) < 1.12;
        tuval.__dar = dar;
        var oran = dar ? (MASA_BOY / MASA_EN) : (MASA_EN / MASA_BOY);
        var tg = g, ty = Math.round(g / oran);
        if (ty > y) { ty = y; tg = Math.round(y * oran); }
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        tuval.style.width = tg + 'px';
        tuval.style.height = ty + 'px';
        tuval.width = Math.round(tg * dpr);
        tuval.height = Math.round(ty * dpr);
        var _k = cizimKaresi(s); if (_k) ciz(tuval, _k);
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);

      if (cizimId) cancelAnimationFrame(cizimId);
      var don = function () {
        if (!root.isConnected || !tuval.isConnected) { cizimId = null; return; }
        var _k = cizimKaresi(s); if (_k) ciz(tuval, _k);
        cizimId = requestAnimationFrame(don);
      };
      cizimId = requestAnimationFrame(don);

      /* --- tokmak sürme: ekran noktasını masa koordinatına çevir --- */
      function masaNoktasi(e) {
        var r = tuval.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        var x, y;
        if (tuval.__dar) { x = py * MASA_EN; y = (1 - px) * MASA_BOY; }
        else { x = px * MASA_EN; y = py * MASA_BOY; }
        if (tuval.__ters) { x = MASA_EN - x; y = MASA_BOY - y; }
        return { x: x, y: y };
      }
      function gonder(p) {
        if (benimKoltuk === null) return;
        /* Yerel tahmin hemen bu hedefe koşar; paket hızı ayrı. */
        hedef = { x: p.x, y: p.y };
        var simdi = Date.now();
        /* Saniyede ~33 paket yeter; fizik sunucuda 120 Hz'de araları
           kendisi dolduruyor. Daha sık yollamak bant genişliği israfı. */
        if (simdi - sonGonderim < 30) return;
        sonGonderim = simdi;
        m.emit('hokeyMove', { x: Math.round(p.x), y: Math.round(p.y) });
      }
      var basili = false;
      tuval.addEventListener('pointerdown', function (e) {
        if (benimKoltuk === null) return;
        basili = true;
        try { tuval.setPointerCapture(e.pointerId); } catch (_) {}
        gonder(masaNoktasi(e));
        e.preventDefault();
      });
      tuval.addEventListener('pointermove', function (e) {
        /* Farede basılı tutmadan da sürülebilsin (masaüstünde daha akıcı);
           dokunmatikte yalnız basılıyken. */
        if (benimKoltuk === null) return;
        if (e.pointerType !== 'mouse' && !basili) return;
        gonder(masaNoktasi(e));
        e.preventDefault();
      });
      var birak = function (e) {
        if (!basili) return;
        basili = false;
        try { tuval.releasePointerCapture(e.pointerId); } catch (_) {}
      };
      tuval.addEventListener('pointerup', birak);
      tuval.addEventListener('pointercancel', birak);

      if (root.__hkOlcu) {
        window.removeEventListener('resize', root.__hkOlcu);
        window.removeEventListener('orientationchange', root.__hkOlcu);
      }
      root.__hkOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 90); };
      window.addEventListener('resize', root.__hkOlcu);
      window.addEventListener('orientationchange', root.__hkOlcu);
      if (window.visualViewport) {
        if (root.__hkVV) window.visualViewport.removeEventListener('resize', root.__hkVV);
        root.__hkVV = root.__hkOlcu;
        window.visualViewport.addEventListener('resize', root.__hkVV);
      }
    }
  });

  window.addEventListener('gv:roomLeft', function () {
    if (cizimId) { cancelAnimationFrame(cizimId); cizimId = null; }
    kare = null; oncekiKare = null; sonOlayNo = -1; benimKoltuk = null;
    yerel = null; hedef = null; yerelZaman = 0; kareAraligi = 50;
  });

  window.__gvHavahokeyi = { kare: function () { return kare; } };
})();
