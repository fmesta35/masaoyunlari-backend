/* ============================================================================
 * LANGIRT — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Bu oyun SIRA TABANLI DEĞİL: iki oyuncu da aynı anda oynar. Fizik tamamen
 * sunucudadır (langirt-engine.js, 50 Hz); istemci saniyede ~20 kez gelen
 * 'langirtFrame' paketlerini alır, aradaki boşluğu YUMUŞATARAK çizer ve
 * karşılığında yalnız iki şey yollar:
 *   · langirtRods — dört çubuğun hedef yüksekliği (parmak/fare konumundan)
 *   · langirtShot — topa yakın çubukla vuruş (güç + nişan)
 *
 * NEDEN TUVAL: saha 1000×600 birimdir ve her karede top + 8 çubuk × 11 adam
 * hareket eder. DOM düğümleriyle bu kadar hareketi 20 Hz'de çizmek telefonda
 * tutmuyor; tuval bir çizim çağrısıyla hallediyor.
 *
 * ÖLÇEK: tuval, ölçülen alana göre boyutlanır ve saha oranı (5:3) korunur;
 * dar ekranda (dikey telefon) saha 90° ÇEVRİLEREK çizilir, böylece kaleler
 * yukarı-aşağı gelir ve alan boşa gitmez.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvLangirtLoaded) return;
  window.__gvLangirtLoaded = true;

  var SAHA_EN = 1000, SAHA_BOY = 600;
  var SAHA = { sol: 108, sag: 892, ust: 92, alt: 508, kaleUst: 220, kaleAlt: 380 };
  var CUBUKLAR = null;        // sunucudan gelir
  var kare = null;            // son gelen paket
  var oncekiKare = null;      // bir önceki paket (ara değer için)
  var kareZamani = 0;
  var benimTaraf = null;
  var cizimId = null;
  var sonOlayNo = -1;
  var hedefY = null;          // yerel çubuk hedefleri (iyimser çizim için)
  var seciliCubuk = 0;
  var sonGonderim = 0;
  var sutGucu = 0;
  var sutBasladi = 0;

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
    var W = tuval.width, H = tuval.height;
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    /* Dar ekranda saha 90° çevrilir: kaleler yukarı-aşağı gelir. */
    var ol;
    if (dar) {
      ol = Math.min(W / SAHA_BOY, H / SAHA_EN);
      ctx.translate((W - SAHA_BOY * ol) / 2, (H - SAHA_EN * ol) / 2);
      ctx.scale(ol, ol);
      ctx.translate(SAHA_BOY, 0);
      ctx.rotate(Math.PI / 2);
    } else {
      ol = Math.min(W / SAHA_EN, H / SAHA_BOY);
      ctx.translate((W - SAHA_EN * ol) / 2, (H - SAHA_BOY * ol) / 2);
      ctx.scale(ol, ol);
    }

    /* --- saha --- */
    ctx.fillStyle = '#10532f';
    ctx.fillRect(SAHA.sol - 34, SAHA.ust - 34, (SAHA.sag - SAHA.sol) + 68, (SAHA.alt - SAHA.ust) + 68);
    ctx.fillStyle = '#157a44';
    ctx.fillRect(SAHA.sol, SAHA.ust, SAHA.sag - SAHA.sol, SAHA.alt - SAHA.ust);
    /* çim şeritleri */
    ctx.fillStyle = 'rgba(255,255,255,.035)';
    for (var i = 0; i < 8; i += 2) {
      var sw = (SAHA.sag - SAHA.sol) / 8;
      ctx.fillRect(SAHA.sol + i * sw, SAHA.ust, sw, SAHA.alt - SAHA.ust);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(SAHA.sol, SAHA.ust, SAHA.sag - SAHA.sol, SAHA.alt - SAHA.ust);
    ctx.beginPath(); ctx.moveTo(500, SAHA.ust); ctx.lineTo(500, SAHA.alt); ctx.stroke();
    ctx.beginPath(); ctx.arc(500, 300, 62, 0, Math.PI * 2); ctx.stroke();
    /* kaleler */
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(SAHA.sol - 34, SAHA.kaleUst, 34, SAHA.kaleAlt - SAHA.kaleUst);
    ctx.fillRect(SAHA.sag, SAHA.kaleUst, 34, SAHA.kaleAlt - SAHA.kaleUst);

    if (!s || !CUBUKLAR) { ctx.restore(); return; }

    /* --- çubuklar ve adamlar --- */
    ['kirmizi', 'mavi'].forEach(function (taraf) {
      var renk = taraf === 'kirmizi' ? '#e2574c' : '#3b82f6';
      var koyu = taraf === 'kirmizi' ? '#8d2e26' : '#1e4d9b';
      var benim = taraf === benimTaraf;
      (CUBUKLAR[taraf] || []).forEach(function (d, ci) {
        var merkez = (s.cubuk[taraf] || [])[ci];
        if (typeof merkez !== 'number') return;
        /* mil */
        ctx.strokeStyle = 'rgba(210,216,228,.55)'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(d.x, SAHA.ust - 30); ctx.lineTo(d.x, SAHA.alt + 30); ctx.stroke();
        if (benim && ci === seciliCubuk) {
          ctx.strokeStyle = 'rgba(255,214,102,.9)'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(d.x, SAHA.ust - 30); ctx.lineTo(d.x, SAHA.alt + 30); ctx.stroke();
        }
        var ilkY = merkez - ((d.adet - 1) * d.aralik) / 2;
        for (var k = 0; k < d.adet; k++) {
          var y = ilkY + k * d.aralik;
          ctx.fillStyle = koyu;
          ctx.beginPath(); ctx.ellipse(d.x, y + 4, 15, 23, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = renk;
          ctx.beginPath(); ctx.ellipse(d.x, y, 15, 22, 0, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.25)';
          ctx.beginPath(); ctx.ellipse(d.x - 4, y - 7, 6, 8, 0, 0, Math.PI * 2); ctx.fill();
        }
      });
    });

    /* --- top --- */
    var t = s.top;
    ctx.fillStyle = 'rgba(0,0,0,.38)';
    ctx.beginPath(); ctx.ellipse(t.x + 3, t.y + 5, 12, 11, 0, 0, Math.PI * 2); ctx.fill();
    var gr = ctx.createRadialGradient(t.x - 4, t.y - 5, 2, t.x, t.y, 13);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#c9ced9');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(t.x, t.y, 12, 0, Math.PI * 2); ctx.fill();

    /* --- geri sayım / gol yazısı --- */
    if (s.faz === 'gerisayim' || s.faz === 'gol') {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(SAHA.sol, SAHA.ust, SAHA.sag - SAHA.sol, SAHA.alt - SAHA.ust);
      ctx.fillStyle = '#ffd666';
      ctx.font = 'bold 86px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      if (dar) { ctx.save(); ctx.translate(500, 300); ctx.rotate(-Math.PI / 2); ctx.translate(-500, -300); }
      ctx.fillText(s.faz === 'gol' ? 'GOL!' : String(Math.ceil(s.fazSn)), 500, 300);
      if (dar) ctx.restore();
    }
    ctx.restore();
  }

  /* İki paket arasını yumuşat: 20 Hz paket, 60 Hz çizim. */
  function araDeger() {
    if (!kare) return null;
    if (!oncekiKare) return kare;
    var dt = Date.now() - kareZamani;
    var k = kirp(dt / 50, 0, 1.6);
    var a = oncekiKare, b = kare;
    var karisim = function (x, y) { return x + (y - x) * k; };
    var out = {
      faz: b.faz, fazSn: b.fazSn, skor: b.skor,
      top: { x: karisim(a.top.x, b.top.x), y: karisim(a.top.y, b.top.y) },
      cubuk: { kirmizi: [], mavi: [] }
    };
    ['kirmizi', 'mavi'].forEach(function (tf) {
      out.cubuk[tf] = (b.cubuk[tf] || []).map(function (v, i) {
        var o = (a.cubuk[tf] || [])[i];
        return typeof o === 'number' ? karisim(o, v) : v;
      });
    });
    return out;
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'langirt',
    kinds: ['langirt'],
    reject: ['langirtRejected'],
    events: {
      /* Gerçek zamanlı kare: durum paketinden AYRI ve çok daha sık gelir. */
      langirtFrame: function (p) {
        if (!p || !p.top) return;
        oncekiKare = kare || p;
        kare = p;
        kareZamani = Date.now();
        if (p.olayNo !== sonOlayNo) {
          sonOlayNo = p.olayNo;
          if (p.sonOlay === 'gol') ses('kazandi');
          else if (p.sonOlay === 'sut') ses('hata');
          else if (p.sonOlay === 'carpma' || p.sonOlay === 'vurus') ses('tasKoy');
        }
        var sk = document.querySelector('#boardArea .lg-skor-yazi');
        if (sk && p.skor) {
          var t = p.skor.kirmizi + ' — ' + p.skor.mavi;
          if (sk.textContent !== t) sk.textContent = t;
        }
      },
      langirtShotFired: function () { ses('hata'); }
    },

    /* Damga: tuval TEK BAŞINA her karede yeniden çiziliyor; HTML yalnız
       faz/skor değişince yenilenmeli, yoksa tuval her pakette sıfırlanır. */
    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.faz + '#' + (s.skor ? s.skor.kirmizi + '-' + s.skor.mavi : '') +
             '#' + s.hedefGol + '#' + s.seat;
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats) return '<div class="lg-wrap"></div>';
      var h = '<div class="lg-wrap">';
      h += '<div class="lg-ust">' +
        '<span class="lg-takim kirmizi' + (s.seat === 0 ? ' benim' : '') + '">' +
          esc(adOf(0)) + (s.seat === 0 ? ' (Siz)' : '') + '</span>' +
        '<span class="lg-skor-yazi">' + ((s.skor || {}).kirmizi || 0) + ' — ' +
          ((s.skor || {}).mavi || 0) + '</span>' +
        '<span class="lg-takim mavi' + (s.seat === 1 ? ' benim' : '') + '">' +
          esc(adOf(1)) + (s.seat === 1 ? ' (Siz)' : '') + '</span>' +
        '</div>';
      h += '<div class="lg-hedef">İlk <b>' + (s.hedefGol || 5) + '</b> golü atan kazanır' +
           (s.status !== 'playing' ? ' · <b>Maç bitti</b>' : '') + '</div>';
      h += '<div class="lg-saha"><canvas class="lg-tuval"></canvas></div>';
      if (s.seat === 0 || s.seat === 1) {
        h += '<div class="lg-kumanda">' +
          '<div class="lg-cubuklar">' +
            [0, 1, 2, 3].map(function (i) {
              var ad = ['Kaleci', 'Defans', 'Orta saha', 'Forvet'][i];
              return '<button class="lg-cubuk' + (i === seciliCubuk ? ' secili' : '') +
                     '" type="button" data-c="' + i + '">' + ad + '</button>';
            }).join('') +
          '</div>' +
          '<button class="btn lg-sut" type="button">⚽ ŞUT (basılı tut)</button>' +
          '<div class="lg-guc"><i></i></div>' +
          '<div class="lg-not">Sahada parmağınızı/fareyi yukarı-aşağı sürükleyerek ' +
            'seçili çubuğu oynatın. Şut için düğmeyi basılı tutup bırakın.</div>' +
          '</div>';
      } else {
        h += '<div class="lg-not">👁️ İzleyicisiniz — masayı izliyorsunuz.</div>';
      }
      return h + '</div>';
    },

    bind: function (root, m) {
      var s = m.state || {};
      CUBUKLAR = s.cubuklar || CUBUKLAR;
      if (s.saha) SAHA = s.saha;
      if (s.sahaEn) { SAHA_EN = s.sahaEn; SAHA_BOY = s.sahaBoy; }
      benimTaraf = s.taraf || null;
      if (!hedefY) hedefY = [300, 300, 300, 300];

      var tuval = root.querySelector('.lg-tuval');
      if (!tuval) return;

      /* --- ölçü: alanı doldur, saha oranını koru --- */
      function olcuYaz() {
        var alan = document.getElementById('boardArea');
        var r = alan ? alan.getBoundingClientRect() : { width: 600, height: 500 };
        var kutu = root.querySelector('.lg-saha');
        if (!kutu) return;
        var ku = root.querySelector('.lg-kumanda');
        var ust = root.querySelector('.lg-ust');
        var kullanilan = (ku ? ku.getBoundingClientRect().height : 0) +
                         (ust ? ust.getBoundingClientRect().height : 0) + 58;
        var g = Math.max(240, r.width);
        var y = Math.max(200, (r.height || 500) - kullanilan);
        /* Dar ve uzun alanda sahayı çevirmek daha çok yer kazandırır. */
        var dik = g / Math.max(1, y);
        var dar = dik < 1.12;
        tuval.__dar = dar;
        var oran = dar ? (SAHA_BOY / SAHA_EN) : (SAHA_EN / SAHA_BOY);
        var tg = g, ty = Math.round(g / oran);
        if (ty > y) { ty = y; tg = Math.round(y * oran); }
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        tuval.style.width = tg + 'px';
        tuval.style.height = ty + 'px';
        tuval.width = Math.round(tg * dpr);
        tuval.height = Math.round(ty * dpr);
        ciz(tuval, araDeger() || { faz: s.faz, fazSn: s.fazSn, skor: s.skor,
                                   top: s.top, cubuk: s.cubuk });
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);

      /* --- çizim döngüsü --- */
      if (cizimId) cancelAnimationFrame(cizimId);
      var don = function () {
        if (!root.isConnected || !tuval.isConnected) { cizimId = null; return; }
        var v = araDeger();
        if (!v) v = { faz: s.faz, fazSn: s.fazSn, skor: s.skor, top: s.top, cubuk: s.cubuk };
        ciz(tuval, v);
        cizimId = requestAnimationFrame(don);
      };
      cizimId = requestAnimationFrame(don);

      /* --- çubuk seçimi --- */
      root.querySelectorAll('.lg-cubuk').forEach(function (b) {
        b.addEventListener('click', function () {
          seciliCubuk = Number(b.dataset.c) || 0;
          root.querySelectorAll('.lg-cubuk').forEach(function (x) {
            x.classList.toggle('secili', Number(x.dataset.c) === seciliCubuk);
          });
        });
      });

      /* --- sahada sürükleme: seçili çubuğu oynat --- */
      function sahaYsi(e) {
        var r = tuval.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width;
        var py = (e.clientY - r.top) / r.height;
        /* Çevrilmiş sahada ekranın X'i sahanın Y'sidir. */
        return tuval.__dar ? px * SAHA_BOY : py * SAHA_BOY;
      }
      function gonder(y, hassas) {
        if (!benimTaraf) return;
        hedefY[seciliCubuk] = y;
        var simdi = Date.now();
        /* Saniyede en çok ~33 paket: daha sıkı yollamak bant genişliğini
           boşa harcar, fizik zaten 50 Hz'de araya giriyor. */
        if (simdi - sonGonderim < 30) return;
        sonGonderim = simdi;
        m.emit('langirtRods', { hedefY: hedefY.slice(), hassas: !!hassas });
      }
      var basili = false, sonY = null, yavas = false;
      tuval.addEventListener('pointerdown', function (e) {
        if (!benimTaraf) return;
        basili = true; sonY = sahaYsi(e);
        try { tuval.setPointerCapture(e.pointerId); } catch (_) {}
        gonder(sonY, false);
        e.preventDefault();
      });
      tuval.addEventListener('pointermove', function (e) {
        if (!basili) return;
        var y = sahaYsi(e);
        yavas = Math.abs(y - (sonY == null ? y : sonY)) < 3;
        sonY = y;
        gonder(y, yavas);
        e.preventDefault();
      });
      var birak = function (e) {
        if (!basili) return;
        basili = false;
        try { tuval.releasePointerCapture(e.pointerId); } catch (_) {}
      };
      tuval.addEventListener('pointerup', birak);
      tuval.addEventListener('pointercancel', birak);

      /* --- şut: basılı tut, güç dolsun, bırak --- */
      var sutBtn = root.querySelector('.lg-sut');
      var gucEl = root.querySelector('.lg-guc i');
      var gucTimer = null;
      function gucBasla() {
        sutBasladi = Date.now(); sutGucu = 0;
        if (gucTimer) clearInterval(gucTimer);
        gucTimer = setInterval(function () {
          sutGucu = Math.min(1, (Date.now() - sutBasladi) / 700);
          if (gucEl) gucEl.style.width = (sutGucu * 100) + '%';
        }, 30);
      }
      function gucBitir() {
        if (gucTimer) { clearInterval(gucTimer); gucTimer = null; }
        var guc = sutGucu; sutGucu = 0;
        if (gucEl) gucEl.style.width = '0%';
        m.emit('langirtShot', { cubuk: seciliCubuk, guc: guc, nisanY: hedefY[seciliCubuk] });
      }
      if (sutBtn) {
        sutBtn.addEventListener('pointerdown', function (e) { gucBasla(); e.preventDefault(); });
        sutBtn.addEventListener('pointerup', function (e) { gucBitir(); e.preventDefault(); });
        sutBtn.addEventListener('pointerleave', function () { if (gucTimer) gucBitir(); });
      }

      if (root.__lgOlcu) {
        window.removeEventListener('resize', root.__lgOlcu);
        window.removeEventListener('orientationchange', root.__lgOlcu);
      }
      root.__lgOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 90); };
      window.addEventListener('resize', root.__lgOlcu);
      window.addEventListener('orientationchange', root.__lgOlcu);
      if (window.visualViewport) {
        if (root.__lgVV) window.visualViewport.removeEventListener('resize', root.__lgVV);
        root.__lgVV = root.__lgOlcu;
        window.visualViewport.addEventListener('resize', root.__lgVV);
      }
    }
  });

  window.addEventListener('gv:roomLeft', function () {
    if (cizimId) { cancelAnimationFrame(cizimId); cizimId = null; }
    kare = null; oncekiKare = null; hedefY = null; sonOlayNo = -1; seciliCubuk = 0;
  });

  /* Test/teşhis köprüsü */
  window.__gvLangirt = {
    kare: function () { return kare; },
    cubuk: function () { return seciliCubuk; }
  };
})();
