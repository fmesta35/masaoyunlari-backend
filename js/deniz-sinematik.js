/* ==========================================================================
   AMİRAL BATTI — SİNEMATİK SAHNE + SES MOTORU
   --------------------------------------------------------------------------
   Atış sonucu geldiğinde ekranın üstüne şeffaf bir katman açar ve hedefin
   tam üzerinde sahneyi oynatır: ıskada su sütunu, isabette patlama ve
   tutuşan gemi bölümü, batışta zincirleme patlama + geminin yana yatıp
   suya gömülmesi.

   TASARIM KARARLARI
   1) Hazır video/ses dosyası YOK. Görüntü canvas'a çizilir, ses WebAudio ile
      üretilir. Sebebi: dosya yükü yok (oyun bugünkü gibi hızlı açılır),
      sahne TOHUMDAN üretildiği için iki oyuncunun ekranında kare kare aynı
      olur ve alev, isabetin geldiği karede yanar.
   2) Katman <body>'ye position:fixed olarak eklenir. Tahta her atıştan sonra
      yeniden çizildiği için (GVArena.repaint) katmanı tahtanın İÇİNE koymak
      olmaz; dışarıda durur, hedef kareyi ekran koordinatıyla bulur.
   3) Mobilde parçacık sayısı ve çözünürlük düşer; sistem "hareketi azalt"
      diyorsa ya da kullanıcı sesi/sinematiği kapattıysa süreler kısalır.

   Dışarıya açılan arayüz:
     GVDeniz.oynat({tur, hedef, gemiKareleri, tohum, isBenim, bitince})
     GVDeniz.ses.acik() / .ayarla(bool) / .cal(ad)
     GVDeniz.sureler  -> {iska, isabet, batis}
   ========================================================================== */
(function () {
  'use strict';

  var SURELER = { iska: 2200, isabet: 2600, batis: 4600 };
  var SES_ANAHTAR = 'gv-ses';

  /* ---------------------------------------------------------------- yardımcı */
  function kolay(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
  function pencere(t, a, b) { return kolay((t - a) / (b - a)); }
  function yumusa(x) { return x * x * (3 - 2 * x); }

  // Tohumlu rastgelelik: aynı tohum -> aynı kıvılcım dağılımı (iki ekran aynı).
  function rastgele(tohum) {
    var a = (tohum || 1) >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function azHareket() {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) { return false; }
  }
  function darEkran() { return (window.innerWidth || 1024) < 720; }

  /* ====================================================================== SES
     Tamamı WebAudio ile üretilir; ses dosyası indirilmez.
     Tarayıcılar sesi ancak kullanıcı etkileşiminden sonra açtığı için
     AudioContext ilk tıklamada uyandırılır.
     ===================================================================== */
  var ctx = null, anaKazanc = null, sesAcikOnbellek = null;

  function sesAcik() {
    if (sesAcikOnbellek !== null) return sesAcikOnbellek;
    try { sesAcikOnbellek = localStorage.getItem(SES_ANAHTAR) !== 'off'; }
    catch (_) { sesAcikOnbellek = true; }
    return sesAcikOnbellek;
  }
  function sesAyarla(acik) {
    sesAcikOnbellek = !!acik;
    try { localStorage.setItem(SES_ANAHTAR, acik ? 'on' : 'off'); } catch (_) {}
    if (anaKazanc && ctx) {
      try { anaKazanc.gain.setTargetAtTime(acik ? 0.9 : 0, ctx.currentTime, 0.02); } catch (_) {}
    }
    if (acik) uyandir();
  }

  function uyandir() {
    if (!sesAcik()) return null;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        anaKazanc = ctx.createGain();
        anaKazanc.gain.value = 0.9;
        anaKazanc.connect(ctx.destination);
      }
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      return ctx;
    } catch (_) { return null; }
  }

  // Tarayıcı kuralı: ses ilk kullanıcı hareketinden sonra açılabilir.
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    try { document.addEventListener(ev, function () { uyandir(); }, { once: true, passive: true }); }
    catch (_) { document.addEventListener(ev, function () { uyandir(); }); }
  });

  function gurultuTamponu(sn) {
    var n = Math.max(1, Math.floor(ctx.sampleRate * sn));
    var buf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /* --- tek bir gürültü katmanı: süzgeci süpüren, sönümlenen ses --- */
  function gurultu(o) {
    var t0 = ctx.currentTime + (o.gecikme || 0);
    var src = ctx.createBufferSource();
    src.buffer = gurultuTamponu(o.sure + 0.05);
    var f = ctx.createBiquadFilter();
    f.type = o.tip || 'lowpass';
    f.Q.value = o.q || 1;
    f.frequency.setValueAtTime(o.f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, o.f1), t0 + o.sure);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.hacim, t0 + (o.atak || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.sure);
    src.connect(f); f.connect(g); g.connect(anaKazanc);
    src.start(t0); src.stop(t0 + o.sure + 0.05);
  }

  /* --- tek bir osilatör: ıslık, gümbürtü, metal iniltisi --- */
  function ton(o) {
    var t0 = ctx.currentTime + (o.gecikme || 0);
    var osc = ctx.createOscillator();
    osc.type = o.dalga || 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.sure);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.hacim, t0 + (o.atak || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.sure);
    osc.connect(g); g.connect(anaKazanc);
    osc.start(t0); osc.stop(t0 + o.sure + 0.05);
  }

  var SESLER = {
    /* Top atışı: kısa, sert, göğüste hissedilen bir gümbürtü. */
    ates: function () {
      gurultu({ f0: 1800, f1: 120, sure: 0.42, hacim: 0.55, tip: 'lowpass', atak: 0.004 });
      ton({ f0: 150, f1: 42, sure: 0.38, hacim: 0.45, dalga: 'sine' });
    },

    /* ISKA: merminin ıslığı -> denize düşen boş bomba "blop"u -> dalga sesi.
       Kullanıcının istediği "denize düşen boş bomba sesi + dalga" bu üçlü. */
    iska: function () {
      ton({ f0: 900, f1: 260, sure: 0.50, hacim: 0.12, dalga: 'sine' });          // düşüş ıslığı
      gurultu({ f0: 2600, f1: 380, sure: 0.30, hacim: 0.50, tip: 'bandpass', q: 0.8,
                gecikme: 0.48, atak: 0.005 });                                     // suya çarpma
      ton({ f0: 220, f1: 70, sure: 0.26, hacim: 0.34, dalga: 'sine', gecikme: 0.49 }); // boş "blop"
      gurultu({ f0: 700, f1: 180, sure: 1.25, hacim: 0.26, tip: 'lowpass',
                gecikme: 0.62, atak: 0.30 });                                      // geri dökülen dalga
      gurultu({ f0: 420, f1: 120, sure: 1.05, hacim: 0.15, tip: 'lowpass',
                gecikme: 1.05, atak: 0.42 });                                      // köpüğün çekilişi
    },

    /* İSABET: önce çeliğe çarpan metal tınısı, hemen ardından patlama. */
    isabet: function () {
      ton({ f0: 1400, f1: 520, sure: 0.10, hacim: 0.30, dalga: 'square' });        // metale çarpma
      ton({ f0: 980, f1: 380, sure: 0.13, hacim: 0.22, dalga: 'triangle', gecikme: 0.01 });
      gurultu({ f0: 3200, f1: 140, sure: 0.85, hacim: 0.62, tip: 'lowpass',
                gecikme: 0.04, atak: 0.006 });                                     // patlama
      ton({ f0: 90, f1: 34, sure: 0.70, hacim: 0.50, dalga: 'sine', gecikme: 0.04 });
      gurultu({ f0: 900, f1: 240, sure: 1.10, hacim: 0.16, tip: 'lowpass',
                gecikme: 0.30, atak: 0.24 });                                      // yangının uğultusu
    },

    /* BATIŞ: cephanelik patlaması + geminin metal iniltisi + suyun kapanışı. */
    batis: function () {
      SESLER.isabet();
      gurultu({ f0: 4200, f1: 90, sure: 1.70, hacim: 0.80, tip: 'lowpass',
                gecikme: 0.52, atak: 0.008 });                                     // büyük patlama
      ton({ f0: 70, f1: 26, sure: 1.50, hacim: 0.62, dalga: 'sine', gecikme: 0.52 });
      ton({ f0: 180, f1: 62, sure: 1.40, hacim: 0.18, dalga: 'sawtooth', gecikme: 0.95 }); // metal iniltisi
      gurultu({ f0: 1100, f1: 160, sure: 1.60, hacim: 0.34, tip: 'lowpass',
                gecikme: 1.70, atak: 0.55 });                                      // suyun kapanması
      gurultu({ f0: 520, f1: 130, sure: 1.20, hacim: 0.18, tip: 'lowpass',
                gecikme: 2.60, atak: 0.50 });                                      // son köpük
    }
  };

  function sesCal(ad) {
    if (!sesAcik() || !SESLER[ad]) return false;
    if (!uyandir()) return false;
    try { SESLER[ad](); return true; } catch (_) { return false; }
  }

  /* =================================================================== KATMAN */
  var cam = null, cx = null, olcek = 1;

  function katmanHazirla() {
    if (cam && cam.isConnected) return cam;
    cam = document.createElement('canvas');
    cam.className = 'gv-deniz-cam';
    cam.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cam);
    cx = cam.getContext ? cam.getContext('2d') : null;
    boyutla();
    try { window.addEventListener('resize', boyutla, { passive: true }); } catch (_) {}
    return cam;
  }

  function boyutla() {
    if (!cam) return;
    var g = window.innerWidth || 1024, y = window.innerHeight || 768;
    // Mobilde piksel oranını 2 ile sınırlıyoruz: fazlası kare hızını düşürür.
    olcek = Math.min(window.devicePixelRatio || 1, darEkran() ? 1.5 : 2);
    cam.width = Math.round(g * olcek);
    cam.height = Math.round(y * olcek);
    cam.style.width = g + 'px';
    cam.style.height = y + 'px';
  }

  function katmanKaldir() {
    if (cam && cam.parentNode) cam.parentNode.removeChild(cam);
    cam = null; cx = null;
  }

  /* ============================================================ SAHNE ÇİZİMİ */
  var sahne = null, donguId = 0;

  function merkez(k) { return { x: k.left + k.width / 2, y: k.top + k.height / 2 }; }

  function patlama(x, y, p, r0) {
    var r = r0 * (0.25 + yumusa(kolay(p)) * 1.15);
    var gr = cx.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    gr.addColorStop(0, 'rgba(255,255,244,' + (1 - p) + ')');
    gr.addColorStop(0.28, 'rgba(255,196,80,' + (1 - p) * 0.95 + ')');
    gr.addColorStop(0.62, 'rgba(238,96,24,' + (1 - p) * 0.68 + ')');
    gr.addColorStop(1, 'rgba(90,30,10,0)');
    cx.fillStyle = gr;
    cx.beginPath(); cx.arc(x, y, Math.max(1, r), 0, Math.PI * 2); cx.fill();
  }

  function suSutunu(x, y, p, g) {
    var yuk = Math.sin(kolay(p) * Math.PI) * g * 3.4;
    var gr = cx.createLinearGradient(x, y, x, y - Math.max(1, yuk));
    gr.addColorStop(0, 'rgba(220,240,250,0.06)');
    gr.addColorStop(0.35, 'rgba(226,244,255,0.60)');
    gr.addColorStop(1, 'rgba(255,255,255,0.05)');
    cx.fillStyle = gr;
    var g0 = g * 0.62 * (1 + p * 0.7);
    cx.beginPath();
    cx.moveTo(x - g0, y);
    cx.quadraticCurveTo(x - g0 * 0.45, y - yuk * 0.7, x - g0 * 0.22, y - yuk);
    cx.lineTo(x + g0 * 0.22, y - yuk);
    cx.quadraticCurveTo(x + g0 * 0.45, y - yuk * 0.7, x + g0, y);
    cx.closePath(); cx.fill();
    // yayılan halka dalga
    cx.save();
    cx.globalAlpha = (1 - p) * 0.55;
    cx.strokeStyle = 'rgba(210,238,250,.9)';
    cx.lineWidth = Math.max(1.5, g * 0.06);
    cx.beginPath();
    cx.ellipse(x, y + g * 0.1, g * 0.7 + p * g * 2.4, g * 0.22 + p * g * 0.7, 0, 0, Math.PI * 2);
    cx.stroke();
    cx.restore();
  }

  function alev(x, y, olcu, faz, guc) {
    var n = darEkran() ? 4 : 7;
    for (var i = 0; i < n; i++) {
      var p = (faz * 0.7 + i * 0.14) % 1;
      cx.globalAlpha = (1 - p) * 0.30 * guc;
      cx.fillStyle = '#1d2128';
      cx.beginPath();
      cx.arc(x + Math.sin(faz * 2 + i) * olcu * 0.3 * p, y - p * olcu * 2.4,
             olcu * (0.28 + p * 0.85) * guc, 0, Math.PI * 2);
      cx.fill();
    }
    cx.globalAlpha = 1;
    var h = (0.7 + Math.sin(faz * 9) * 0.3) * guc;
    var r = Math.max(1, olcu * 0.95 * h);
    var gr = cx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,240,190,' + (0.95 * guc) + ')');
    gr.addColorStop(0.35, 'rgba(255,150,40,' + (0.78 * guc) + ')');
    gr.addColorStop(1, 'rgba(200,40,10,0)');
    cx.fillStyle = gr;
    cx.beginPath(); cx.arc(x, y - olcu * 0.2, r, 0, Math.PI * 2); cx.fill();
  }

  /* Batan gemi silueti: kendi karelerinin üstüne çizilir, yatar ve iner. */
  function batanGemi(kareler, yat, in_, sonme) {
    if (!kareler || !kareler.length) return;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    kareler.forEach(function (k) {
      x0 = Math.min(x0, k.left); y0 = Math.min(y0, k.top);
      x1 = Math.max(x1, k.left + k.width); y1 = Math.max(y1, k.top + k.height);
    });
    var g = x1 - x0, y = y1 - y0, mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    var dikey = y > g;
    cx.save();
    cx.translate(mx, my + in_);
    cx.rotate(dikey ? Math.PI / 2 : 0);
    cx.rotate(yat);
    var uzun = dikey ? y : g, kisa = dikey ? g : y;
    cx.globalAlpha = 1 - sonme * 0.85;
    cx.fillStyle = '#14202a';
    cx.beginPath();
    cx.moveTo(-uzun * 0.48, -kisa * 0.20);
    cx.lineTo(uzun * 0.40, -kisa * 0.20);
    cx.quadraticCurveTo(uzun * 0.52, 0, uzun * 0.40, kisa * 0.24);
    cx.lineTo(-uzun * 0.44, kisa * 0.24);
    cx.closePath(); cx.fill();
    cx.fillStyle = '#1e3140';
    cx.fillRect(-uzun * 0.16, -kisa * 0.44, uzun * 0.26, kisa * 0.26);
    cx.fillRect(-uzun * 0.34, -kisa * 0.34, uzun * 0.12, kisa * 0.16);
    cx.restore();
    cx.globalAlpha = 1;
  }

  function ciz(t, simdi) {
    var s = sahne;
    cx.setTransform(olcek, 0, 0, olcek, 0, 0);
    cx.clearRect(0, 0, cam.width / olcek, cam.height / olcek);

    var o = merkez(s.hedef);
    var g = Math.max(14, s.hedef.width);          // bir karenin eni: tüm ölçüler buna göre
    var sar = 0;

    if (!s.sade) {
      if (t > 60 && t < 380) sar = 4 * (1 - pencere(t, 60, 380));
      if (s.tur !== 'iska' && t > 620 && t < 950) sar = Math.max(sar, 9 * (1 - pencere(t, 620, 950)));
      if (s.tur === 'batis' && t > 1150 && t < 1600) sar = Math.max(sar, 14 * (1 - pencere(t, 1150, 1600)));
    }
    if (sar) cx.translate(Math.sin(simdi * 0.09) * sar, Math.cos(simdi * 0.13) * sar * 0.6);

    /* --- 1) mermi izi: ekranın alt kenarından hedefe --- */
    var mi = pencere(t, 80, 620);
    if (mi > 0 && mi < 1) {
      var bx = s.baslangic.x, by = s.baslangic.y;
      cx.strokeStyle = 'rgba(255,186,96,.85)';
      cx.lineWidth = Math.max(2, g * 0.14);
      cx.lineCap = 'round';
      cx.beginPath();
      var k0 = Math.max(0, mi - 0.24);
      for (var k = k0; k <= mi + 0.0001; k += 0.02) {
        var px = bx + (o.x - bx) * k;
        var py = by + (o.y - by) * k - Math.sin(k * Math.PI) * g * 3.2;
        if (k === k0) cx.moveTo(px, py); else cx.lineTo(px, py);
      }
      cx.stroke();
      var ux = bx + (o.x - bx) * mi;
      var uy = by + (o.y - by) * mi - Math.sin(mi * Math.PI) * g * 3.2;
      cx.fillStyle = '#fff3d0';
      cx.beginPath(); cx.arc(ux, uy, Math.max(2, g * 0.16), 0, Math.PI * 2); cx.fill();
    }

    /* --- 2) hedef kilidi halkası --- */
    var kl = pencere(t, 0, 620);
    if (kl < 1) {
      cx.save();
      cx.strokeStyle = 'rgba(255,75,55,' + (0.85 - kl * 0.5) + ')';
      cx.lineWidth = Math.max(1.5, g * 0.08);
      var rr = g * (1.9 - kl * 0.9);
      cx.beginPath(); cx.arc(o.x, o.y, rr, 0, Math.PI * 2); cx.stroke();
      cx.restore();
    }

    /* --- 3) sonuca göre --- */
    if (s.tur === 'iska') {
      var pi = pencere(t, 620, 1700);
      if (pi > 0 && pi < 1) suSutunu(o.x, o.y + g * 0.2, pi, g);
    } else {
      var pp = pencere(t, 620, 1150);
      if (pp > 0 && pp < 1) patlama(o.x, o.y, pp, g * 1.9);

      var sp = pencere(t, 660, 1400);
      if (sp > 0 && sp < 1) {
        cx.save(); cx.globalAlpha = 1 - sp;
        for (var i = 0; i < s.kivilcim.length; i++) {
          var kv = s.kivilcim[i];
          var d = sp * g * 3.4 * kv.h;
          var qx = o.x + Math.cos(kv.a) * d;
          var qy = o.y + Math.sin(kv.a) * d + sp * sp * g * 1.1;
          cx.fillStyle = kv.o > 1 ? '#ffd48a' : '#ff8c3a';
          cx.fillRect(qx, qy, Math.max(2, g * 0.09), Math.max(2, g * 0.09));
        }
        cx.restore();
      }
      // isabet alan kare bundan sonra yanmaya devam eder
      if (t > 800) alev(o.x, o.y, g * 0.55, simdi * 0.006, 1 - pencere(t, s.sure - 700, s.sure));
    }

    if (s.tur === 'batis') {
      // zincirleme ikincil patlamalar geminin boyunca
      for (var j = 0; j < s.zincir.length; j++) {
        var z = s.zincir[j];
        var pz = pencere(t, 760 + j * 170, 1180 + j * 170);
        if (pz > 0 && pz < 1) patlama(z.x, z.y, pz, g * 1.4);
      }
      // cephanelik
      var pc = pencere(t, 1150, 1750);
      if (pc > 0 && pc < 1) patlama(o.x, o.y, pc, g * 3.4);
      // gemi yatar, iner, kaybolur
      var yat = yumusa(pencere(t, 1400, 3400)) * 0.34;
      var inis = yumusa(pencere(t, 1800, 4100)) * g * 1.5;
      var sonme = pencere(t, 3200, 4300);
      batanGemi(s.gemiKareleri, yat, inis, sonme);
      // yerinde kalan köpük çemberi
      var pk = pencere(t, 3400, 4600);
      if (pk > 0 && pk < 1) {
        cx.save();
        cx.globalAlpha = Math.sin(pk * Math.PI) * 0.6;
        cx.strokeStyle = 'rgba(214,238,250,.9)';
        cx.lineWidth = Math.max(1.5, g * 0.07);
        cx.beginPath();
        cx.ellipse(o.x, o.y, g * (1 + pk * 2.2), g * (0.4 + pk * 0.8), 0, 0, Math.PI * 2);
        cx.stroke();
        cx.restore();
      }
    }

    /* --- 4) ekran parlaması --- */
    if (!s.sade) {
      var f = 0;
      if (s.tur !== 'iska' && t > 615) f = Math.max(f, 0.22 * (1 - pencere(t, 620, 860)));
      if (s.tur === 'batis' && t > 1145) f = Math.max(f, 0.40 * (1 - pencere(t, 1150, 1500)));
      if (f > 0.01) {
        cx.setTransform(olcek, 0, 0, olcek, 0, 0);
        cx.fillStyle = 'rgba(255,236,206,' + f + ')';
        cx.fillRect(0, 0, cam.width / olcek, cam.height / olcek);
      }
    }
  }

  function dongu() {
    if (!sahne || !cx) return;
    var simdi = (window.performance && performance.now) ? performance.now() : Date.now();
    var t = (simdi - sahne.t0) / sahne.hiz;
    if (t >= sahne.sure) { bitir(); return; }
    try { ciz(t, simdi); } catch (_) { bitir(); return; }
    donguId = requestAnimationFrame(dongu);
  }

  function bitir() {
    var bitince = sahne && sahne.bitince;
    sahne = null;
    if (donguId) { cancelAnimationFrame(donguId); donguId = 0; }
    katmanKaldir();
    var ba = document.getElementById('boardArea');
    if (ba) ba.classList.remove('gv-sarsinti', 'gv-sarsinti-sert');
    if (typeof bitince === 'function') { try { bitince(); } catch (_) {} }
  }

  /* -------------------------------------------------------------- oynatıcı */
  function oynat(o) {
    o = o || {};
    var tur = (o.tur === 'sunk' || o.tur === 'batis') ? 'batis'
            : (o.tur === 'hit' || o.tur === 'isabet') ? 'isabet' : 'iska';

    sesCal(tur === 'iska' ? 'iska' : (tur === 'batis' ? 'batis' : 'isabet'));

    var hedef = o.hedef;
    if (!hedef || !hedef.width) { if (o.bitince) o.bitince(); return null; }
    // Canvas bağlamı yoksa (çok eski tarayıcı ya da test ortamı) sessizce
    // vazgeçilir: katman geride bırakılmaz, oyun eskisi gibi akar.
    if (!katmanHazirla() || !cx) { katmanKaldir(); if (o.bitince) o.bitince(); return null; }
    if (sahne) bitir();                                   // üst üste binmesin

    var sade = !!o.sade || azHareket();
    var rnd = rastgele(o.tohum || 1);
    var kvSayi = darEkran() ? 12 : 22;
    var kivilcim = [];
    for (var i = 0; i < kvSayi; i++) {
      kivilcim.push({ a: rnd() * Math.PI * 2, h: 0.5 + rnd() * 1.3, o: 0.7 + rnd() * 0.7 });
    }
    var kareler = o.gemiKareleri || [];
    var zincir = kareler.slice(0, 4).map(function (k) { return merkez(k); });
    if (!zincir.length) zincir = [merkez(hedef)];

    sahne = {
      tur: tur, hedef: hedef, gemiKareleri: kareler, zincir: zincir,
      kivilcim: kivilcim, sade: sade,
      sure: SURELER[tur], hiz: sade ? 2.2 : 1,            // sade kipte süre kısalır
      // Mermi kendi tarafımızdan gelir: ben atıyorsam alttan, rakip atıyorsa üstten.
      baslangic: o.isBenim === false
        ? { x: (window.innerWidth || 1024) * 0.5, y: -40 }
        : { x: (window.innerWidth || 1024) * 0.22, y: (window.innerHeight || 768) + 40 },
      t0: (window.performance && performance.now) ? performance.now() : Date.now(),
      bitince: o.bitince
    };

    var ba = document.getElementById('boardArea');
    if (ba && !sade) ba.classList.add(tur === 'iska' ? 'gv-sarsinti' : 'gv-sarsinti-sert');

    donguId = requestAnimationFrame(dongu);
    return sahne.sure / sahne.hiz;
  }

  /* ================================================== SES AÇ/KAPAT DÜĞMESİ
     Oda başlığındaki #gvSoundBtn. Tercih tarayıcıda saklanır, bütün
     oyunlarda ve bütün odalarda geçerlidir. Tahta sık sık yeniden
     çizildiği için olay dinleyicisi düğmeye değil belgeye bağlanır. */
  function dugmeYenile() {
    var b = document.getElementById('gvSoundBtn');
    if (!b) return;
    var acik = sesAcik();
    b.textContent = acik ? '🔊 Ses' : '🔇 Ses';
    b.setAttribute('aria-pressed', acik ? 'true' : 'false');
    b.title = acik ? 'Oyun seslerini kapat' : 'Oyun seslerini aç';
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('#gvSoundBtn');
    if (!b) return;
    e.preventDefault();
    sesAyarla(!sesAcik());
    dugmeYenile();
    if (sesAcik()) sesCal('ates');                 // açınca kısa bir örnek
    if (window.GV && GV.toast) GV.toast(sesAcik() ? '🔊 Oyun sesleri açık' : '🔇 Oyun sesleri kapalı', 'info');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dugmeYenile);
  else dugmeYenile();

  window.GVDeniz = {
    dugmeYenile: dugmeYenile,
    oynat: oynat,
    durdur: bitir,
    sureler: SURELER,
    oynuyor: function () { return !!sahne; },
    ses: {
      acik: sesAcik,
      ayarla: sesAyarla,
      cal: sesCal,
      anahtar: SES_ANAHTAR,
      uyandir: uyandir
    }
  };
})();
