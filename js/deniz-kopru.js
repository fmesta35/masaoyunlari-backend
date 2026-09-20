/* ==========================================================================
   AMİRAL BATTI — KOMUTA KÖPRÜSÜ KABUĞU
   --------------------------------------------------------------------------
   Oyun tahtasının üstüne bir "köprü camı" (panorama) ve altına bir konsol
   şeridi (radar + hedef okuması + ateş düğmesi) koyar. Camda düşman filosu
   ufukta durur; her gemi, o gemiye kaç isabet aldığınıza göre YANAR ve filo
   battığında suya gömülüp yerinde enkaz bırakır. Yani cam yalnız süs değil,
   oyunun durumunu gösteren ikinci bir gösterge.

   Neden ayrı dosya: js/deniz-sinematik.js atış ANINI oynatır (tek seferlik
   sahne), burası ise SÜREKLİ arka planı çizer. İkisi birbirine karışmasın.

   Dışarı açılan arayüz:
     GVKopru.bagla(camEl, radarEl)   → çizim döngüsünü o elemanlara bağlar
     GVKopru.durum(d)                → { filo:[{ad,boy,vurus,batik}], sira, hedef }
     GVKopru.kopar()                 → döngüyü durdurur (oda kapanınca)
   ========================================================================== */
(function () {
  'use strict';

  var cam = null, cx = null, radar = null, rx = null;
  var durum = { filo: [], sira: false, hedef: null, benimVurus: [] };
  var dongu = 0, olcek = 1;

  function dar() { return (window.innerWidth || 1024) < 720; }
  function azHareket() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_) { return false; }
  }

  function boyutla(el) {
    if (!el || !el.getBoundingClientRect) return null;
    var k = el.getBoundingClientRect();
    if (!k.width || !k.height) return null;
    olcek = Math.min(window.devicePixelRatio || 1, dar() ? 1.5 : 2);
    var g = Math.round(k.width * olcek), y = Math.round(k.height * olcek);
    if (el.width !== g || el.height !== y) { el.width = g; el.height = y; }
    return { g: k.width, y: k.height };
  }

  /* ----------------------------------------------------------- gökyüzü/deniz */
  function manzara(ctx, G, Y, t) {
    var ufuk = Y * 0.62;
    var gr = ctx.createLinearGradient(0, 0, 0, ufuk);
    gr.addColorStop(0, '#0c1b2a'); gr.addColorStop(0.55, '#1b3b4d'); gr.addColorStop(1, '#3a6070');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, G, ufuk);

    // bulut bantları — yavaş kayar
    ctx.save(); ctx.globalAlpha = 0.26;
    for (var i = 0; i < 4; i++) {
      var y = ufuk * (0.20 + i * 0.16);
      var x = ((t * 0.006 * (1 + i * 0.3)) % (G + 420)) - 210;
      ctx.fillStyle = i % 2 ? '#21333f' : '#2d4352';
      ctx.beginPath(); ctx.ellipse(x, y, G * 0.18, ufuk * 0.05 + i, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(G - x * 0.7, y + ufuk * 0.05, G * 0.14, ufuk * 0.04, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    var gr2 = ctx.createLinearGradient(0, ufuk, 0, Y);
    gr2.addColorStop(0, '#1d475a'); gr2.addColorStop(0.45, '#123041'); gr2.addColorStop(1, '#091a25');
    ctx.fillStyle = gr2; ctx.fillRect(0, ufuk, G, Y - ufuk);

    // dalga çizgileri
    ctx.save(); ctx.strokeStyle = '#7fd0e8'; ctx.lineWidth = Math.max(1, Y * 0.006);
    for (var j = 0; j < 9; j++) {
      var p = j / 9, yy = ufuk + (Y - ufuk) * Math.pow(p, 1.7) + 2;
      ctx.globalAlpha = 0.05 + p * 0.11;
      ctx.beginPath();
      for (var x2 = -30; x2 <= G + 30; x2 += 30) {
        var v = yy + Math.sin(x2 * 0.02 + t * 0.0018 + j) * (1.5 + p * 3);
        x2 === -30 ? ctx.moveTo(x2, v) : ctx.lineTo(x2, v);
      }
      ctx.stroke();
    }
    ctx.restore();
    return ufuk;
  }

  /* ------------------------------------------------------------- düşman gemisi */
  function gemi(ctx, x, ufuk, ol, hasar, batma) {
    ctx.save();
    ctx.translate(x, ufuk + 2 + batma * ol * 26);
    ctx.rotate(batma * 0.26);
    ctx.scale(ol, ol);
    ctx.globalAlpha = 1 - batma * 0.9;
    var govde = '#101c25', ust = '#1a2c3a';
    ctx.fillStyle = govde;
    ctx.beginPath();
    ctx.moveTo(-46, 0); ctx.lineTo(44, 0);
    ctx.quadraticCurveTo(53, 2, 45, 8);
    ctx.lineTo(-41, 8);
    ctx.quadraticCurveTo(-49, 5, -46, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = ust;
    ctx.fillRect(-28, -5, 22, 5);
    ctx.fillRect(-6, -13, 16, 13);
    ctx.fillRect(10, -6, 13, 6);
    ctx.fillRect(-23, -10, 5, 5);
    ctx.strokeStyle = ust; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(1, -13); ctx.lineTo(1, -24); ctx.stroke();
    ctx.restore();

    // hasar: gövdenin üstünde alev + yükselen duman
    if (hasar > 0.01 && batma < 0.9) {
      var gx = x, gy = ufuk - 6 * ol, t = Date.now() * 0.006;
      var n = dar() ? 3 : 6;
      ctx.save();
      for (var i = 0; i < n; i++) {
        var p = (t * 0.12 + i * 0.17) % 1;
        ctx.globalAlpha = (1 - p) * 0.28 * hasar;
        ctx.fillStyle = '#1b1f26';
        ctx.beginPath();
        ctx.arc(gx + Math.sin(t + i) * 5 * ol * p, gy - p * 46 * ol, (3 + p * 13) * ol, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      var r = (5 + Math.sin(t * 4) * 1.6) * ol * (0.6 + hasar);
      var g2 = ctx.createRadialGradient(gx, gy, 0, gx, gy, Math.max(1, r * 2.4));
      g2.addColorStop(0, 'rgba(255,240,190,' + (0.9 * hasar) + ')');
      g2.addColorStop(0.35, 'rgba(255,148,40,' + (0.75 * hasar) + ')');
      g2.addColorStop(1, 'rgba(190,40,10,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(gx, gy, Math.max(1, r * 2.4), 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // batmışsa yerinde köpük halkası kalır
    if (batma > 0.55) {
      ctx.save();
      ctx.globalAlpha = (batma - 0.55) * 1.4;
      ctx.strokeStyle = 'rgba(200,232,246,.65)';
      ctx.lineWidth = Math.max(1, ol * 1.2);
      ctx.beginPath(); ctx.ellipse(x, ufuk + 6 * ol, 44 * ol, 7 * ol, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  /* --------------------------------------------------------------- kendi pruva */
  function pruva(ctx, G, Y) {
    ctx.save();
    ctx.fillStyle = '#060d13';
    ctx.beginPath();
    ctx.moveTo(-10, Y + 10);
    ctx.quadraticCurveTo(G * 0.30, Y * 0.86, G * 0.5, Y * 0.83);
    ctx.quadraticCurveTo(G * 0.70, Y * 0.86, G + 10, Y + 10);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(92,200,255,.18)'; ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------- radar */
  function radarCiz(t) {
    if (!rx || !radar) return;
    var o = boyutla(radar); if (!o) return;
    rx.setTransform(olcek, 0, 0, olcek, 0, 0);
    var G = o.g, Y = o.y, cxp = G / 2, cyp = Y / 2, R = Math.min(G, Y) / 2 - 2;
    rx.clearRect(0, 0, G, Y);
    rx.fillStyle = '#04120d'; rx.beginPath(); rx.arc(cxp, cyp, R, 0, Math.PI * 2); rx.fill();
    rx.strokeStyle = 'rgba(79,227,161,.38)'; rx.lineWidth = 1;
    [1, 0.66, 0.33].forEach(function (k) {
      rx.beginPath(); rx.arc(cxp, cyp, R * k, 0, Math.PI * 2); rx.stroke();
    });
    rx.beginPath(); rx.moveTo(cxp - R, cyp); rx.lineTo(cxp + R, cyp);
    rx.moveTo(cxp, cyp - R); rx.lineTo(cxp, cyp + R); rx.stroke();
    // süpürme
    var a = azHareket() ? -Math.PI / 2 : (t * 0.0013) % (Math.PI * 2);
    rx.save(); rx.globalAlpha = 0.30; rx.fillStyle = '#4fe3a1';
    rx.beginPath(); rx.moveTo(cxp, cyp); rx.arc(cxp, cyp, R, a - 0.55, a); rx.closePath(); rx.fill();
    rx.restore();
    // isabetlerim nokta olarak
    (durum.benimVurus || []).forEach(function (v) {
      var px = cxp + (v.c / 9 - 0.5) * R * 1.55;
      var py = cyp + (v.r / 9 - 0.5) * R * 1.55;
      rx.fillStyle = v.isabet ? '#ff6a52' : 'rgba(79,227,161,.55)';
      rx.beginPath(); rx.arc(px, py, v.isabet ? 2.6 : 1.8, 0, Math.PI * 2); rx.fill();
    });
  }

  /* ------------------------------------------------------------------ döngü */
  function kare() {
    if (!cam || !cam.isConnected) { kopar(); return; }
    var t = (window.performance && performance.now) ? performance.now() : Date.now();
    var o = boyutla(cam);
    if (o && cx) {
      var G = o.g, Y = o.y;
      cx.setTransform(olcek, 0, 0, olcek, 0, 0);
      cx.clearRect(0, 0, G, Y);
      var ufuk = manzara(cx, G, Y, t);

      var filo = durum.filo || [];
      var n = Math.max(1, filo.length);
      var ol = Math.max(0.55, Math.min(1.6, G / 620));
      filo.forEach(function (f, i) {
        var x = G * (0.10 + 0.80 * ((i + 0.5) / n));
        var oran = f.boy ? Math.min(1, (f.vurus || 0) / f.boy) : 0;
        gemi(cx, x, ufuk - (i % 2) * Y * 0.035, ol * (0.8 + (f.boy || 3) * 0.06),
             f.batik ? 0.9 : oran, f.batik ? 1 : 0);
      });
      pruva(cx, G, Y);
    }
    radarCiz(t);
    dongu = requestAnimationFrame(kare);
  }

  function bagla(camEl, radarEl) {
    kopar();
    cam = camEl || null; radar = radarEl || null;
    cx = (cam && cam.getContext) ? cam.getContext('2d') : null;
    rx = (radar && radar.getContext) ? radar.getContext('2d') : null;
    if (!cx && !rx) { cam = radar = null; return false; }
    dongu = requestAnimationFrame(kare);
    return true;
  }
  function kopar() {
    if (dongu) { cancelAnimationFrame(dongu); dongu = 0; }
    cam = cx = radar = rx = null;
  }

  window.GVKopru = {
    bagla: bagla,
    kopar: kopar,
    durum: function (d) { if (d) durum = d; return durum; },
    bagliMi: function () { return !!(cam && cam.isConnected); }
  };
})();
