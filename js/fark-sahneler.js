/* ============================================================================
 * FARK BULMACA — SAHNELER (sunucu ve istemci ORTAK)
 * ============================================================================
 * Dört sahne, her birinde 13 "farklanabilir" nesne. Her elde bunlardan 7'si
 * tohumla seçilir ve B kopyasında değiştirilir; oyuncular farkları bulur.
 *
 * Bu dosya hem Node'da (sunucu: hangi fark nerede) hem tarayıcıda (istemci:
 * sahneyi çiz) çalışır. Sahneler SVG METNİ üretir; React yoktur.
 *
 * ÇİZİMLER yerel prototipten (multiplayer-difference-finding-game) birebir
 * taşındı: JSX, h() adında küçük bir fabrika ile SVG metnine çevrildi.
 * Koordinatlar 800×520'lik ortak görünüm kutusundadır ve FARK_KONUMLARI
 * ile BİREBİR eşleşmek zorundadır — biri değişirse diğeri de değişmeli.
 * ========================================================================= */
(function (kok, fabrika) {
  if (typeof module === 'object' && module.exports) module.exports = fabrika();
  else kok.GVFark = fabrika();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var GORUNUM_EN = 800, GORUNUM_BOY = 520;
  var EL_BASINA_FARK = 7;

  /* ---------------------------------------------------------- JSX FABRİKASI
     h('rect', {x:1}, cocuk...) → '<rect x="1">cocuk</rect>'. Prototipteki
     JSX ağacı buraya olduğu gibi derlendi; bu yüzden fabrika React'in
     davranışını (dizi çocuklar, false/null atlama, camelCase öznitelik)
     taklit etmek zorunda. */
  var BOS_ETIKET = { circle:1, rect:1, line:1, path:1, ellipse:1, polygon:1,
    polyline:1, stop:1, use:1, image:1 };
  var OZNITELIK = {
    strokeWidth:'stroke-width', strokeLinecap:'stroke-linecap',
    strokeLinejoin:'stroke-linejoin', strokeDasharray:'stroke-dasharray',
    strokeOpacity:'stroke-opacity', fillOpacity:'fill-opacity', fillRule:'fill-rule',
    clipPath:'clip-path', clipRule:'clip-rule', stopColor:'stop-color',
    stopOpacity:'stop-opacity', textAnchor:'text-anchor', fontSize:'font-size',
    fontWeight:'font-weight', fontFamily:'font-family',
    dominantBaseline:'dominant-baseline', strokeMiterlimit:'stroke-miterlimit',
    markerEnd:'marker-end', gradientUnits:'gradient-units',
    patternUnits:'pattern-units', xlinkHref:'xlink:href',
    letterSpacing:'letter-spacing', paintOrder:'paint-order',
    vectorEffect:'vector-effect', shapeRendering:'shape-rendering'
  };
  function kacir(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function duzle(c, out) {
    if (c === null || c === undefined || c === false || c === true) return;
    if (Array.isArray(c)) { for (var i = 0; i < c.length; i++) duzle(c[i], out); return; }
    if (typeof c === 'string' || typeof c === 'number') { out.push(String(c)); return; }
    if (c && c.__svg !== undefined) out.push(c.__svg);
  }
  function h(etiket, ozl) {
    var cocuk = Array.prototype.slice.call(arguments, 2);
    if (typeof etiket === 'function') {
      var p = {};
      for (var q in (ozl || {})) p[q] = ozl[q];
      p.children = cocuk.length === 1 ? cocuk[0] : cocuk;
      return etiket(p);
    }
    var o = ozl || {}, a = '';
    for (var k in o) {
      if (k === 'children' || k === 'key' || k === 'ref') continue;
      var v = o[k];
      if (v === null || v === undefined || v === false) continue;
      a += ' ' + (OZNITELIK[k] || k) + '="' + kacir(v === true ? '' : v) + '"';
    }
    var ic = [];
    duzle(cocuk, ic); duzle(o.children, ic);
    var g = ic.join('');
    var s = (!g && BOS_ETIKET[etiket]) ? '<' + etiket + a + '/>'
          : '<' + etiket + a + '>' + g + '</' + etiket + '>';
    return { __svg: s, toString: function () { return s; } };
  }
  function Fragment(p) {
    var ic = []; duzle(p && p.children, ic);
    var s = ic.join('');
    return { __svg: s, toString: function () { return s; } };
  }

  /* Tohumlanabilir rastgelelik: aynı tohum iki istemcide AYNI sahneyi verir
     (süslemelerin yeri de eşleşmeli, yoksa her şey "fark" gibi görünür). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------- SAHNE ÇİZİMLERİ */
  function cloud(x, y, s, op = 1) {
    return h("g", { transform: `translate(${x} ${y}) scale(${s})`, opacity: op }, h("ellipse", { cx: 0, cy: 0, rx: 36, ry: 17, fill: "#ffffff" }), h("ellipse", { cx: 28, cy: 5, rx: 28, ry: 13, fill: "#ffffff" }), h("ellipse", { cx: -29, cy: 7, rx: 24, ry: 11, fill: "#ffffff" }), h("ellipse", { cx: 4, cy: -10, rx: 24, ry: 12, fill: "#ffffff" }));
  }
  function beachScene({ seed, uid, variant, diffs }) {
    const B = (id) => variant === "b" && diffs.has(id);
    const rng = mulberry32(seed);
    const sparkles = Array.from({ length: 12 }, () => ({
      x: 30 + rng() * 740,
      y: 205 + rng() * 95,
      r: 2 + rng() * 2.5,
      o: 0.25 + rng() * 0.4
    }));
    const shells = Array.from({ length: 9 }, () => ({
      x: 24 + rng() * 752,
      y: 350 + rng() * 155,
      c: ["#f9a8d4", "#fde68a", "#93c5fd", "#fca5a5"][Math.floor(rng() * 4)]
    }));
    const driftX = (rng() - 0.5) * 60;
    return h("g", null, h("defs", null, h("linearGradient", { id: `${uid}sky`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#8fd8ff" }), h("stop", { offset: "1", stopColor: "#eaf9ff" })), h("linearGradient", { id: `${uid}sea`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#5eead4" }), h("stop", { offset: "1", stopColor: "#0e9bb8" })), h("linearGradient", { id: `${uid}sand`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#ffe4a6" }), h("stop", { offset: "1", stopColor: "#f7c877" })), h("radialGradient", { id: `${uid}sung`, cx: "0.5", cy: "0.5", r: "0.5" }, h("stop", { offset: "0", stopColor: "#fff7cc", stopOpacity: "0.9" }), h("stop", { offset: "1", stopColor: "#fff7cc", stopOpacity: "0" }))), h("rect", { x: 0, y: 0, width: 800, height: 330, fill: `url(#${uid}sky)` }), h("circle", { cx: 92, cy: 86, r: 120, fill: `url(#${uid}sung)` }), h("g", { stroke: "#ffb703", strokeWidth: 7, strokeLinecap: "round" }, (B(1) ? [0, 60, 120, 180, 240, 300] : [0, 45, 90, 135, 180, 225, 270, 315]).map((a) => {
      const rad = a * Math.PI / 180;
      return h(
        "line",
        {
          key: a,
          x1: 92 + Math.cos(rad) * 44,
          y1: 86 + Math.sin(rad) * 44,
          x2: 92 + Math.cos(rad) * 62,
          y2: 86 + Math.sin(rad) * 62
        }
      );
    })), h("circle", { cx: 92, cy: 86, r: 32, fill: "#ffcf4d" }), cloud(608 + driftX, 66, 1), cloud(428, 160, 0.6, 0.9), cloud(206, 74, 0.75, 0.95), !B(2) && cloud(248, 60, 0.42, 0.9), h("g", { stroke: "#475569", strokeWidth: 3.2, fill: "none", strokeLinecap: "round" }, h("path", { d: "M 386,84 Q 393,75 400,84 Q 407,75 414,84" }), h("path", { d: "M 414,98 Q 421,89 428,98 Q 435,89 442,98" }), !B(3) && h("path", { d: "M 444,78 Q 451,69 458,78 Q 465,69 472,78" })), !B(4) && h("g", { transform: "translate(332 148)" }, h("path", { d: "M 0,26 C -8,40 10,44 2,60", stroke: "#94a3b8", strokeWidth: 2, fill: "none" }), h("path", { d: "M 0,-24 L 17,0 L 0,24 L -17,0 Z", fill: "#f43f5e" }), h("path", { d: "M 0,-24 L 17,0 L 0,0 Z", fill: "#fb7185" }), h("path", { d: "M 0,-24 L 0,24 M -17,0 L 17,0", stroke: "#be123c", strokeWidth: 1.4 }), h("path", { d: "M 0,24 C -5,32 6,36 1,44 C -3,50 5,53 2,58", stroke: "#f43f5e", strokeWidth: 2.4, fill: "none", strokeLinecap: "round" })), h(
      "path",
      {
        d: "M0,196 C 100,188 200,204 300,197 S 500,188 600,197 S 750,204 800,196 L800,340 L0,340 Z",
        fill: `url(#${uid}sea)`
      }
    ), h("g", { stroke: "#ffffff", strokeWidth: 3, opacity: 0.55, fill: "none", strokeLinecap: "round" }, h("path", { d: "M 130,212 Q 160,206 190,212" }), h("path", { d: "M 390,228 Q 425,221 460,228" }), h("path", { d: "M 640,214 Q 668,208 696,214" })), sparkles.map((s, i) => h(
      "rect",
      {
        key: i,
        x: s.x,
        y: s.y,
        width: s.r * 2.4,
        height: s.r * 2.4,
        rx: 1,
        transform: `rotate(45 ${s.x} ${s.y})`,
        fill: "#ffffff",
        opacity: s.o
      }
    )), h("g", { transform: "translate(604 192)" }, h("line", { x1: 0, y1: 12, x2: 0, y2: -36, stroke: "#475569", strokeWidth: 3 }), h("path", { d: "M 6,-32 L 6,8 L 34,8 Z", fill: B(5) ? "#ef4444" : "#ffffff" }), h("path", { d: "M -5,-26 L -5,8 L -26,8 Z", fill: "#f1f5f9" }), h("path", { d: "M -36,12 L 36,12 L 21,26 L -23,26 Z", fill: "#b45309" }), h("path", { d: "M 0,-36 L 12,-32 L 0,-28 Z", fill: "#f43f5e" })), !B(7) && h("g", { transform: "translate(466 246)" }, h("ellipse", { cx: 0, cy: 0, rx: 13, ry: 7.5, fill: "#38bdf8" }), h("path", { d: "M 12,0 L 22,-7 L 22,7 Z", fill: "#0ea5e9" }), h("circle", { cx: -7, cy: -2, r: 1.8, fill: "#0c4a6e" }), h("g", { fill: "#ffffff", opacity: 0.85 }, h("circle", { cx: -6, cy: 12, r: 2.4 }), h("circle", { cx: 4, cy: 14, r: 3 }), h("circle", { cx: 14, cy: 11, r: 2 })), h("path", { d: "M -16,14 Q 0,20 18,14", stroke: "#ffffff", strokeWidth: 2.4, fill: "none", opacity: 0.7 })), h("path", { d: "M0,318 C 120,306 260,320 400,313 S 680,304 800,314 L800,520 L0,520 Z", fill: `url(#${uid}sand)` }), h("path", { d: "M0,318 C 120,306 260,320 400,313 S 680,304 800,314", stroke: "#eab308", strokeWidth: 3, opacity: 0.35, fill: "none" }), shells.map((s, i) => h("circle", { key: i, cx: s.x, cy: s.y, r: 2.6, fill: s.c, opacity: 0.7 })), h("g", null, h("path", { d: "M 742,512 C 738,420 730,330 714,168", stroke: "#a16207", strokeWidth: 18, fill: "none", strokeLinecap: "round" }), h("path", { d: "M 736,430 L 748,428 M 731,340 L 742,336 M 722,255 L 733,250", stroke: "#854d0e", strokeWidth: 4, strokeLinecap: "round" }), h("g", { stroke: "#15803d", strokeWidth: 10, fill: "none", strokeLinecap: "round" }, h("path", { d: "M 712,158 Q 656,122 616,138" }), h("path", { d: "M 712,158 Q 668,98 628,96" }), h("path", { d: "M 712,158 Q 720,88 706,66" }), h("path", { d: "M 712,158 Q 764,102 792,112" }), h("path", { d: "M 712,158 Q 776,142 796,168" })), h("g", { fill: "#854d0e" }, !B(6) && h("circle", { cx: 698, cy: 160, r: 9.5 }), h("circle", { cx: 724, cy: 164, r: 9.5 }), h("circle", { cx: 711, cy: 147, r: 9.5 }))), h("g", null, h("ellipse", { cx: 556, cy: 398, rx: 72, ry: 10, fill: "#d97706", opacity: 0.25 }), h("line", { x1: 556, y1: 272, x2: 556, y2: 398, stroke: "#94a3b8", strokeWidth: 5, strokeLinecap: "round" }), (() => {
      const cx = 556, cy = 272, r = 84;
      const main = B(8) ? "#2563eb" : "#ef4444";
      const panels = [];
      for (let i = 0; i < 6; i++) {
        const a1 = Math.PI + i * Math.PI / 6;
        const a2 = Math.PI + (i + 1) * Math.PI / 6;
        panels.push(
          h(
            "path",
            {
              key: i,
              d: `M ${cx},${cy} L ${(cx + r * Math.cos(a1)).toFixed(1)},${(cy + r * Math.sin(a1)).toFixed(1)} A ${r},${r} 0 0 1 ${(cx + r * Math.cos(a2)).toFixed(1)},${(cy + r * Math.sin(a2)).toFixed(1)} Z`,
              fill: i % 2 === 0 ? main : "#ffffff",
              stroke: "rgba(0,0,0,0.08)",
              strokeWidth: 1
            }
          )
        );
      }
      return h("g", null, panels);
    })(), h("circle", { cx: 556, cy: 186, r: 4.5, fill: B(8) ? "#2563eb" : "#ef4444" })), h("g", { transform: "translate(694 378)" }, h("ellipse", { cx: 0, cy: 22, rx: 20, ry: 4.5, fill: "#d97706", opacity: 0.25 }), h("circle", { cx: 0, cy: 0, r: 22, fill: B(9) ? "#22c55e" : "#ef4444" }), h("ellipse", { cx: 0, cy: 0, rx: 20, ry: 8, fill: "#ffffff", transform: "rotate(-28)", opacity: 0.95 }), h("circle", { cx: 0, cy: 0, r: 6.5, fill: "#3b82f6" }), h("ellipse", { cx: -7, cy: -9, rx: 6, ry: 3.4, fill: "#ffffff", opacity: 0.5, transform: "rotate(-28)" })), h("g", { transform: "translate(150 428)" }, h("ellipse", { cx: 0, cy: 12, rx: 18, ry: 4, fill: "#d97706", opacity: 0.25 }), h("g", { stroke: "#f87171", strokeWidth: 3, fill: "none", strokeLinecap: "round" }, h("path", { d: "M -12,4 L -22,10 M -6,8 L -14,16 M 12,4 L 22,10 M 6,8 L 14,16" })), h("ellipse", { cx: 0, cy: 0, rx: 16, ry: 10.5, fill: "#f87171" }), h("line", { x1: -6, y1: -9, x2: -8, y2: -16, stroke: "#f87171", strokeWidth: 2.6 }), h("line", { x1: 6, y1: -9, x2: 8, y2: -16, stroke: "#f87171", strokeWidth: 2.6 }), h("circle", { cx: -8, cy: -18, r: 3.4, fill: "#0f172a" }), h("circle", { cx: 8, cy: -18, r: 3.4, fill: "#0f172a" }), h("circle", { cx: 15, cy: -9, r: 7, fill: "#ef4444" }), h("path", { d: "M 15,-16 L 19,-10 M 15,-16 L 11,-10", stroke: "#ef4444", strokeWidth: 3, strokeLinecap: "round" }), !B(10) && h("g", null, h("circle", { cx: -17, cy: -9, r: 7, fill: "#ef4444" }), h("path", { d: "M -17,-16 L -13,-10 M -17,-16 L -21,-10", stroke: "#ef4444", strokeWidth: 3, strokeLinecap: "round" }))), !B(11) && h("g", { transform: "translate(332 452)" }, h(
      "path",
      {
        d: "M0,-18 L4.4,-6 L17,-5.5 L7,2 L10.5,14.5 L0,7.5 L-10.5,14.5 L-7,2 L-17,-5.5 L-4.4,-6 Z",
        fill: "#fb923c",
        stroke: "#f97316",
        strokeWidth: 1.5
      }
    ), h("g", { fill: "#ffedd5" }, h("circle", { cx: 0, cy: -10, r: 1.6 }), h("circle", { cx: 9, cy: -2, r: 1.6 }), h("circle", { cx: 5, cy: 9, r: 1.6 }), h("circle", { cx: -6, cy: 9, r: 1.6 }), h("circle", { cx: -9, cy: -2, r: 1.6 }))), h("g", { transform: "translate(452 446)" }, h("ellipse", { cx: 0, cy: 18, rx: 18, ry: 4, fill: "#d97706", opacity: 0.25 }), !B(12) && h("g", null, h("line", { x1: 14, y1: -24, x2: 26, y2: 4, stroke: "#f43f5e", strokeWidth: 4.5, strokeLinecap: "round" }), h("path", { d: "M 22,2 L 32,4 L 28,14 L 20,10 Z", fill: "#f43f5e" })), h("path", { d: "M -15,-10 L 15,-10 L 11,16 L -11,16 Z", fill: "#14b8a6" }), h("rect", { x: -17, y: -13, width: 34, height: 6, rx: 3, fill: "#0d9488" }), h("path", { d: "M -12,-13 Q 0,-26 12,-13", stroke: "#0d9488", strokeWidth: 3, fill: "none" })), h("g", { transform: "translate(252 404)" }, h("g", { transform: "rotate(-12)" }, h("rect", { x: -12, y: -14, width: 15, height: 28, rx: 7.5, fill: "#6366f1" }), h("path", { d: "M -4.5,-6 L -9,4 M -4.5,-6 L 0,4", stroke: "#ffffff", strokeWidth: 1.8, fill: "none" })), !B(13) && h("g", { transform: "translate(24 6) rotate(9)" }, h("rect", { x: -8, y: -14, width: 15, height: 28, rx: 7.5, fill: "#8b5cf6" }), h("path", { d: "M -0.5,-6 L -5,4 M -0.5,-6 L 4,4", stroke: "#ffffff", strokeWidth: 1.8, fill: "none" }))));
  }

  function pine(x, baseY, s, col = "#0e3b21") {
    return h("g", { transform: `translate(${x} ${baseY}) scale(${s})` }, h("rect", { x: -4, y: -14, width: 8, height: 14, fill: "#4a2c1a" }), h("path", { d: `M 0,-104 L 13,-78 L 6,-78 L 20,-52 L 11,-52 L 26,-26 L -26,-26 L -11,-52 L -20,-52 L -6,-78 L -13,-78 Z`, fill: col }));
  }
  function campScene({ seed, uid, variant, diffs }) {
    const B = (id) => variant === "b" && diffs.has(id);
    const rng = mulberry32(seed);
    const stars = Array.from({ length: 70 }, () => ({
      x: rng() * 800,
      y: rng() * 280,
      r: 0.8 + rng() * 1.6,
      o: 0.3 + rng() * 0.6
    }));
    const fireflies = Array.from({ length: 8 }, () => ({
      x: 40 + rng() * 720,
      y: 380 + rng() * 120
    }));
    return h("g", null, h("defs", null, h("linearGradient", { id: `${uid}sky`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#141033" }), h("stop", { offset: "0.65", stopColor: "#322460" }), h("stop", { offset: "1", stopColor: "#5b3f8c" })), h("linearGradient", { id: `${uid}gr`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#193a22" }), h("stop", { offset: "1", stopColor: "#0f2817" })), h("radialGradient", { id: `${uid}au`, cx: "0.5", cy: "0.5", r: "0.5" }, h("stop", { offset: "0", stopColor: "#34d399", stopOpacity: "0.22" }), h("stop", { offset: "1", stopColor: "#34d399", stopOpacity: "0" })), h("radialGradient", { id: `${uid}fg`, cx: "0.5", cy: "0.5", r: "0.5" }, h("stop", { offset: "0", stopColor: "#fb923c", stopOpacity: "0.45" }), h("stop", { offset: "1", stopColor: "#fb923c", stopOpacity: "0" })), h("mask", { id: `${uid}moon` }, h("circle", { cx: 96, cy: 84, r: 27, fill: "#ffffff" }), h("circle", { cx: 107, cy: 79, r: 24, fill: "#000000" }))), h("rect", { x: 0, y: 0, width: 800, height: 400, fill: `url(#${uid}sky)` }), h("ellipse", { cx: 420, cy: 110, rx: 360, ry: 90, fill: `url(#${uid}au)` }), stars.map((s, i) => h("circle", { key: i, cx: s.x, cy: s.y, r: s.r, fill: "#ffffff", opacity: s.o })), h("circle", { cx: 96, cy: 84, r: 42, fill: "#fde68a", opacity: 0.12 }), B(1) ? h("g", null, h("circle", { cx: 96, cy: 84, r: 27, fill: "#fde68a" }), h("circle", { cx: 88, cy: 78, r: 4, fill: "#fcd34d", opacity: 0.7 }), h("circle", { cx: 102, cy: 92, r: 3, fill: "#fcd34d", opacity: 0.7 })) : h("circle", { cx: 96, cy: 84, r: 27, fill: "#fde68a", mask: `url(#${uid}moon)` }), !B(2) && h("g", { transform: "translate(322 62)" }, h("circle", { r: 10, fill: "#fef08a", opacity: 0.25 }), h("path", { d: "M 0,-14 L 3,-3 L 14,0 L 3,3 L 0,14 L -3,3 L -14,0 L -3,-3 Z", fill: "#fef08a" })), !B(3) && h("g", null, h("line", { x1: 586, y1: 50, x2: 652, y2: 88, stroke: "#e0e7ff", strokeWidth: 3, strokeLinecap: "round", opacity: 0.9 }), h("line", { x1: 574, y1: 44, x2: 596, y2: 57, stroke: "#e0e7ff", strokeWidth: 2, strokeLinecap: "round", opacity: 0.4 }), h("circle", { cx: 655, cy: 90, r: 3.4, fill: "#ffffff" })), h(
      "path",
      {
        d: "M0,240 L120,150 L230,232 L330,140 L440,236 L560,150 L646,134 L740,196 L800,166 L800,400 L0,400 Z",
        fill: "#2a2358"
      }
    ), h(
      "path",
      {
        d: "M0,300 L140,214 L262,296 L420,206 L560,300 L700,224 L800,300 L800,410 L0,410 Z",
        fill: "#1e1a45"
      }
    ), !B(4) && h("g", null, h("line", { x1: 646, y1: 136, x2: 646, y2: 106, stroke: "#cbd5e1", strokeWidth: 2.5 }), h("path", { d: "M 646,106 L 672,112 L 646,120 Z", fill: "#f43f5e" })), h("path", { d: "M0,372 Q200,352 400,368 T800,360 L800,520 L0,520 Z", fill: `url(#${uid}gr)` }), pine(52, 470, 1.3), pine(346, 452, 0.8), pine(770, 486, 1.1), pine(520, 478, 1.2, "#0c3320"), pine(628, 500, 0.85, "#0c3320"), h("g", { transform: "translate(742 362) scale(1.7)" }, h("rect", { x: -4, y: -14, width: 8, height: 14, fill: "#4a2c1a" }), h("path", { d: `M 0,-104 L 13,-78 L 6,-78 L 20,-52 L 11,-52 L 26,-26 L -26,-26 L -11,-52 L -20,-52 L -6,-78 L -13,-78 Z`, fill: "#0e3b21" }), !B(6) && h("path", { d: "M 0,-104 L 13,-78 L 6,-78 L 8.6,-82 L 0,-88 L -8.6,-82 L -6,-78 L -13,-78 Z", fill: "#e2e8f0" })), h("g", null, h("path", { d: "M 166,432 C 168,362 170,300 172,246", stroke: "#4a2c1a", strokeWidth: 14, fill: "none", strokeLinecap: "round" }), h("path", { d: "M 171,318 L 212,300", stroke: "#4a2c1a", strokeWidth: 8, strokeLinecap: "round" }), h("g", { transform: "translate(178 222)" }, h("path", { d: "M -10,-14 L -15,-24 L -5,-18 Z", fill: "#8d6e63" }), h("path", { d: "M 10,-14 L 15,-24 L 5,-18 Z", fill: "#8d6e63" }), h("ellipse", { cx: 0, cy: 0, rx: 14.5, ry: 17, fill: "#a1887f" }), h("ellipse", { cx: 0, cy: 6, rx: 8.5, ry: 9, fill: "#d7ccc8" }), B(5) ? h("g", { stroke: "#1f2937", strokeWidth: 2.2, fill: "none", strokeLinecap: "round" }, h("path", { d: "M -9,-4 Q -5,0 -1.5,-4" }), h("path", { d: "M 1.5,-4 Q 5.5,0 9,-4" })) : h("g", null, h("circle", { cx: -6, cy: -4, r: 5.6, fill: "#ffffff" }), h("circle", { cx: 6, cy: -4, r: 5.6, fill: "#ffffff" }), h("circle", { cx: -6, cy: -4, r: 2.4, fill: "#1f2937" }), h("circle", { cx: 6, cy: -4, r: 2.4, fill: "#1f2937" })), h("path", { d: "M 0,1 L -3,5 L 3,5 Z", fill: "#fbbf24" }))), h("g", null, h("ellipse", { cx: 624, cy: 424, rx: 84, ry: 9, fill: "#000000", opacity: 0.25 }), h("path", { d: "M 548,420 L 624,292 L 700,420 Z", fill: "#f97316", stroke: "#ea580c", strokeWidth: 3, strokeLinejoin: "round" }), h("path", { d: "M 624,292 L 700,420 L 650,420 Z", fill: "#ea580c", opacity: 0.55 }), B(7) ? h("g", null, h("path", { d: "M 598,420 L 624,332 L 650,420 Z", fill: "#c2410c" }), h("path", { d: "M 624,332 L 624,420", stroke: "#9a3412", strokeWidth: 2.5 })) : h("g", null, h("path", { d: "M 598,420 L 624,332 L 650,420 Z", fill: "#1f2937" }), h("path", { d: "M 606,420 L 624,352 L 642,420 Z", fill: "#fbbf24", opacity: 0.3 }))), !B(8) && h("g", { fill: "#94a3b8", opacity: 0.32 }, h("circle", { cx: 392, cy: 248, r: 10 }), h("circle", { cx: 402, cy: 226, r: 12.5 }), h("circle", { cx: 394, cy: 201, r: 9 })), h("circle", { cx: 400, cy: 336, r: 52, fill: `url(#${uid}fg)` }), h("g", null, h("rect", { x: 382, y: 344, width: 36, height: 8, rx: 4, fill: "#7c4a21", transform: "rotate(-14 400 348)" }), h("rect", { x: 382, y: 344, width: 36, height: 8, rx: 4, fill: "#5d3a1a", transform: "rotate(12 400 348)" }), h("path", { d: "M 400,306 C 384,326 386,344 400,352 C 414,344 416,326 400,306 Z", fill: "#fb923c" }), h("path", { d: "M 400,318 C 392,331 393,343 400,348 C 407,343 408,331 400,318 Z", fill: "#fde047" })), !B(9) && h("g", null, h("line", { x1: 504, y1: 314, x2: 448, y2: 346, stroke: "#d6a35c", strokeWidth: 4, strokeLinecap: "round" }), h("rect", { x: 438, y: 340, width: 15, height: 12, rx: 4, fill: "#ffffff", transform: "rotate(-30 445 346)" })), h("g", { transform: "translate(534 444)" }, h("ellipse", { cx: 0, cy: 24, rx: 26, ry: 5, fill: "#000000", opacity: 0.25 }), h("rect", { x: -20, y: -26, width: 40, height: 48, rx: 13, fill: B(10) ? "#f43f5e" : "#0ea5e9" }), h("rect", { x: -13, y: -4, width: 26, height: 20, rx: 7, fill: B(10) ? "#be123c" : "#0369a1" }), h("path", { d: "M -8,-26 Q 0,-36 8,-26", stroke: B(10) ? "#be123c" : "#0369a1", strokeWidth: 4.5, fill: "none", strokeLinecap: "round" }), h("line", { x1: -20, y1: -10, x2: -26, y2: 8, stroke: B(10) ? "#be123c" : "#0369a1", strokeWidth: 5, strokeLinecap: "round" })), h("g", null, h("rect", { x: 108, y: 452, width: 8, height: 14, rx: 3.5, fill: "#fef3c7" }), h("path", { d: "M 96,452 A 16,12 0 0 1 128,452 Z", fill: "#ef4444" }), h("circle", { cx: 106, cy: 444, r: 2.2, fill: "#ffffff" }), h("circle", { cx: 119, cy: 441, r: 2.2, fill: "#ffffff" }), !B(11) && h("g", { transform: "translate(138 470) scale(0.72)" }, h("rect", { x: -4, y: 0, width: 8, height: 14, rx: 3.5, fill: "#fef3c7" }), h("path", { d: "M -16,0 A 16,12 0 0 1 16,0 Z", fill: "#ef4444" }), h("circle", { cx: -5, cy: -7, r: 2.4, fill: "#ffffff" }), h("circle", { cx: 6, cy: -5, r: 2.4, fill: "#ffffff" }))), !B(12) && h("g", { transform: "translate(284 430)" }, h("path", { d: "M -6,10 C -26,2 -22,-24 -2,-26", stroke: "#b45309", strokeWidth: 9.5, fill: "none", strokeLinecap: "round" }), h("ellipse", { cx: 4, cy: 2, rx: 10, ry: 13.5, fill: "#c07a3a" }), h("circle", { cx: 11, cy: -14, r: 8, fill: "#c07a3a" }), h("path", { d: "M 8,-20 L 4,-27 L 11,-23 Z", fill: "#c07a3a" }), h("circle", { cx: 13, cy: -15, r: 1.9, fill: "#1f2937" }), h("ellipse", { cx: 17, cy: -4, rx: 4.4, ry: 5.4, fill: "#92400e" })), h("g", { transform: "translate(716 458)" }, h("rect", { x: -16, y: -12, width: 32, height: 24, rx: 5, fill: "#8d5a2b" }), h("ellipse", { cx: 0, cy: -12, rx: 16, ry: 5.5, fill: "#b07a45" }), h("ellipse", { cx: 0, cy: -12, rx: 9, ry: 3, fill: "none", stroke: "#8d5a2b", strokeWidth: 1.6 }), !B(13) && h("g", null, h("line", { x1: 2, y1: -50, x2: -6, y2: -10, stroke: "#a16207", strokeWidth: 5, strokeLinecap: "round" }), h("path", { d: "M 2,-52 C 12,-52 16,-44 12,-38 C 6,-36 -2,-40 -2,-46 Z", fill: "#94a3b8" }))), fireflies.map((f, i) => h("g", { key: i }, h("circle", { cx: f.x, cy: f.y, r: 4.5, fill: "#bef264", opacity: 0.22 }), h("circle", { cx: f.x, cy: f.y, r: 1.8, fill: "#d9f99d" }))));
  }

  function spaceScene({ seed, uid, variant, diffs }) {
    const B = (id) => variant === "b" && diffs.has(id);
    const rng = mulberry32(seed);
    const stars = Array.from({ length: 110 }, () => ({
      x: rng() * 800,
      y: rng() * 520,
      r: 0.7 + rng() * 1.7,
      o: 0.25 + rng() * 0.65
    }));
    const pluses = Array.from({ length: 5 }, () => ({
      x: 60 + rng() * 680,
      y: 40 + rng() * 380,
      s: 0.6 + rng() * 0.7
    }));
    const alienHead = (x, y, s) => h("g", { transform: `translate(${x} ${y}) scale(${s})` }, h("ellipse", { cx: 0, cy: 0, rx: 9, ry: 10.5, fill: "#4ade80" }), h("ellipse", { cx: -3.4, cy: -1.5, rx: 2.4, ry: 3.4, fill: "#14532d", transform: "rotate(-14)" }), h("ellipse", { cx: 3.4, cy: -1.5, rx: 2.4, ry: 3.4, fill: "#14532d", transform: "rotate(14)" }));
    return h("g", null, h("defs", null, h("radialGradient", { id: `${uid}bg`, cx: "0.5", cy: "0.45", r: "0.75" }, h("stop", { offset: "0", stopColor: "#1b1146" }), h("stop", { offset: "1", stopColor: "#060313" })), h("radialGradient", { id: `${uid}neb1`, cx: "0.5", cy: "0.5", r: "0.5" }, h("stop", { offset: "0", stopColor: "#7c3aed", stopOpacity: "0.32" }), h("stop", { offset: "1", stopColor: "#7c3aed", stopOpacity: "0" })), h("radialGradient", { id: `${uid}neb2`, cx: "0.5", cy: "0.5", r: "0.5" }, h("stop", { offset: "0", stopColor: "#0ea5e9", stopOpacity: "0.22" }), h("stop", { offset: "1", stopColor: "#0ea5e9", stopOpacity: "0" })), h("linearGradient", { id: `${uid}sat`, x1: "0", y1: "0", x2: "1", y2: "1" }, h("stop", { offset: "0", stopColor: "#c084fc" }), h("stop", { offset: "1", stopColor: "#7c3aed" })), h("linearGradient", { id: `${uid}rock`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#ffffff" }), h("stop", { offset: "1", stopColor: "#c7d2fe" })), h("linearGradient", { id: `${uid}tail`, x1: "0", y1: "0", x2: "1", y2: "0" }, h("stop", { offset: "0", stopColor: "#bae6fd", stopOpacity: "0.9" }), h("stop", { offset: "1", stopColor: "#bae6fd", stopOpacity: "0" })), h("linearGradient", { id: `${uid}fire`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#fde047" }), h("stop", { offset: "1", stopColor: "#f97316" })), h("linearGradient", { id: `${uid}moon`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#d4d8dd" }), h("stop", { offset: "1", stopColor: "#6b7280" }))), h("rect", { x: 0, y: 0, width: 800, height: 520, fill: `url(#${uid}bg)` }), h("ellipse", { cx: 620, cy: 140, rx: 250, ry: 110, fill: `url(#${uid}neb1)` }), h("ellipse", { cx: 180, cy: 330, rx: 210, ry: 95, fill: `url(#${uid}neb2)` }), stars.map((s, i) => h("circle", { key: i, cx: s.x, cy: s.y, r: s.r, fill: "#ffffff", opacity: s.o })), pluses.map((p, i) => h("g", { key: i, transform: `translate(${p.x} ${p.y}) scale(${p.s})`, stroke: "#c4b5fd", strokeWidth: 1.6, opacity: 0.7 }, h("line", { x1: -5, y1: 0, x2: 5, y2: 0 }), h("line", { x1: 0, y1: -5, x2: 0, y2: 5 }))), h("circle", { cx: 150, cy: 116, r: 48, fill: `url(#${uid}neb1)` }), h("circle", { cx: 150, cy: 116, r: 30, fill: `url(#${uid}sat)` }), h("ellipse", { cx: 143, cy: 108, rx: 9, ry: 5, fill: "#e9d5ff", opacity: 0.5 }), !B(1) && h("g", { transform: "rotate(-18 150 116)" }, h("ellipse", { cx: 150, cy: 116, rx: 54, ry: 13, fill: "none", stroke: "#e9c46a", strokeWidth: 7, opacity: 0.9 }), h("ellipse", { cx: 150, cy: 116, rx: 54, ry: 13, fill: "none", stroke: "#b08d3e", strokeWidth: 2, opacity: 0.8 })), !B(4) && h("g", { transform: "translate(494 52)" }, h("circle", { r: 9, fill: "#ffffff", opacity: 0.3 }), h("path", { d: "M 0,-15 L 2.6,-2.6 L 15,0 L 2.6,2.6 L 0,15 L -2.6,2.6 L -15,0 L -2.6,-2.6 Z", fill: "#ffffff" })), !B(5) && h("g", null, h("line", { x1: 646, y1: 30, x2: 720, y2: 82, stroke: "#e0e7ff", strokeWidth: 3, strokeLinecap: "round", opacity: 0.9 }), h("line", { x1: 634, y1: 24, x2: 658, y2: 40, stroke: "#e0e7ff", strokeWidth: 2, strokeLinecap: "round", opacity: 0.35 }), h("circle", { cx: 723, cy: 84, r: 3.2, fill: "#ffffff" })), B(3) ? h("g", { transform: "translate(322 78)" }, h("circle", { r: 12, fill: "#9ca3af" }), h("circle", { cx: -4, cy: -3, r: 2.6, fill: "#6b7280" }), h("circle", { cx: 5, cy: 4, r: 2, fill: "#6b7280" })) : h("g", null, h("path", { d: "M 330,72 L 412,32 L 398,48 L 416,56 L 334,86 Z", fill: `url(#${uid}tail)`, opacity: 0.85 }), h("circle", { cx: 322, cy: 78, r: 12.5, fill: "#e0f2fe", stroke: "#7dd3fc", strokeWidth: 2 })), h("g", { transform: "translate(560 122)" }, h("path", { d: "M 0,18 L -40,108 L 40,108 Z", fill: "#67e8f9", opacity: 0.1 }), B(2) ? h("g", null, alienHead(-14, -14, 0.78), alienHead(16, -14, 0.78)) : alienHead(0, -16, 1), h("path", { d: "M -44,-2 A 44,30 0 0 1 44,-2 Z", fill: "#67e8f9", opacity: 0.32, stroke: "#a5f3fc", strokeWidth: 1.5 }), h("ellipse", { cx: 0, cy: 4, rx: 50, ry: 15, fill: "#9fb0c3" }), h("ellipse", { cx: 0, cy: 8.5, rx: 50, ry: 13, fill: "#64748b" }), [-32, -16, 0, 16, 32].map((x) => h("circle", { key: x, cx: x, cy: 12, r: 3.2, fill: "#fde047" }))), h("circle", { cx: 96, cy: 302, r: 30, fill: `url(#${uid}neb2)` }), h("circle", { cx: 96, cy: 302, r: 20, fill: B(10) ? "#a78bfa" : "#34d399" }), h("circle", { cx: 90, cy: 296, r: 4, fill: B(10) ? "#7c3aed" : "#059669" }), h("circle", { cx: 103, cy: 308, r: 3, fill: B(10) ? "#7c3aed" : "#059669" }), h("circle", { cx: 99, cy: 294, r: 2, fill: B(10) ? "#7c3aed" : "#059669" }), h("g", { transform: "translate(726 222)" }, !B(6) && h("rect", { x: -50, y: -8, width: 36, height: 16, rx: 2, fill: "#3b82f6", stroke: "#1d4ed8", strokeWidth: 2 }), h("rect", { x: 14, y: -8, width: 36, height: 16, rx: 2, fill: "#3b82f6", stroke: "#1d4ed8", strokeWidth: 2 }), h("rect", { x: -10, y: -12, width: 20, height: 24, rx: 3.5, fill: "#cbd5e1", stroke: "#94a3b8", strokeWidth: 2 }), h("line", { x1: 0, y1: 12, x2: 0, y2: 22, stroke: "#94a3b8", strokeWidth: 2.5 }), h("circle", { cx: 0, cy: 26, r: 5, fill: "none", stroke: "#94a3b8", strokeWidth: 2.5 })), h("g", { transform: "translate(406 212)" }, h("rect", { x: -17, y: -12, width: 34, height: 28, rx: 7, fill: "#cbd5e1" }), h("rect", { x: -14, y: -8, width: 28, height: 32, rx: 9, fill: "#f8fafc", stroke: "#cbd5e1", strokeWidth: 1.5 }), h("line", { x1: -7, y1: 24, x2: -9, y2: 42, stroke: "#f8fafc", strokeWidth: 8, strokeLinecap: "round" }), h("line", { x1: 7, y1: 24, x2: 9, y2: 42, stroke: "#f8fafc", strokeWidth: 8, strokeLinecap: "round" }), h("path", { d: "M -13,46 L -4,46 M 5,46 L 14,46", stroke: "#cbd5e1", strokeWidth: 5, strokeLinecap: "round" }), B(8) ? h("g", null, h("line", { x1: -13, y1: -2, x2: -25, y2: 15, stroke: "#f8fafc", strokeWidth: 8, strokeLinecap: "round" }), h("circle", { cx: -26, cy: 17, r: 5, fill: "#f8fafc" })) : h("g", null, h("line", { x1: -13, y1: -2, x2: -29, y2: -23, stroke: "#f8fafc", strokeWidth: 8, strokeLinecap: "round" }), h("circle", { cx: -30, cy: -25, r: 5, fill: "#f8fafc" })), h("line", { x1: 13, y1: -2, x2: 27, y2: 11, stroke: "#f8fafc", strokeWidth: 8, strokeLinecap: "round" }), h("circle", { cx: 28, cy: 13, r: 5, fill: "#f8fafc" }), h("circle", { cx: 0, cy: -22, r: 13.5, fill: "#f8fafc", stroke: "#cbd5e1", strokeWidth: 1.5 }), h("circle", { cx: 0, cy: -22, r: 9, fill: "#fbbf24", opacity: 0.88 }), h("circle", { cx: 0, cy: 0, r: 3.4, fill: "#ef4444" }), h("circle", { cx: -8, cy: 0, r: 2.4, fill: "#3b82f6" })), !B(9) && h("path", { d: "M 420,238 C 472,268 522,296 600,318", stroke: "#94a3b8", strokeWidth: 2.6, strokeDasharray: "7 6", fill: "none", opacity: 0.9 }), h("g", { transform: "translate(640 318) rotate(-12)" }, h("path", { d: "M -10,34 C -14,54 0,64 0,64 C 0,64 14,54 10,34 Z", fill: `url(#${uid}fire)` }), h("path", { d: "M -17,16 L -33,40 L -17,34 Z", fill: "#ef4444" }), h("path", { d: "M 17,16 L 33,40 L 17,34 Z", fill: "#ef4444" }), h("rect", { x: -18, y: -46, width: 36, height: 82, rx: 16, fill: `url(#${uid}rock)`, stroke: "#94a3b8", strokeWidth: 1.5 }), h("path", { d: "M -18,-37 A 18,20 0 0 1 18,-37 Z", fill: "#ef4444" }), h("rect", { x: -18, y: 6, width: 36, height: 12, fill: B(7) ? "#14b8a6" : "#ef4444" }), h("circle", { cx: 0, cy: -18, r: 7.5, fill: "#67e8f9", stroke: "#475569", strokeWidth: 3 })), h("path", { d: "M0,470 Q400,442 800,466 L800,520 L0,520 Z", fill: `url(#${uid}moon)` }), h("ellipse", { cx: 130, cy: 492, rx: 26, ry: 7, fill: "#6b7280", opacity: 0.7 }), h("ellipse", { cx: 380, cy: 502, rx: 20, ry: 6, fill: "#6b7280", opacity: 0.7 }), h("ellipse", { cx: 770, cy: 494, rx: 22, ry: 6, fill: "#6b7280", opacity: 0.7 }), !B(12) && h("g", null, h("ellipse", { cx: 560, cy: 470, rx: 21, ry: 7.5, fill: "#4b5563" }), h("path", { d: "M 539,470 A 21,7.5 0 0 1 581,470", stroke: "#9ca3af", strokeWidth: 2, fill: "none" })), !B(11) && h("g", null, h("ellipse", { cx: 224, cy: 447, rx: 12, ry: 3, fill: "#4b5563", opacity: 0.6 }), h("line", { x1: 224, y1: 447, x2: 224, y2: 404, stroke: "#e5e7eb", strokeWidth: 3, strokeLinecap: "round" }), h("path", { d: "M 224,404 L 256,409 L 256,421 L 224,416 Z", fill: "#ef4444" }), h("circle", { cx: 232, cy: 410, r: 2, fill: "#ffffff" })), h("ellipse", { cx: 700, cy: 442, rx: 27, ry: 8.5, fill: "#4b5563" }), !B(13) && h("g", null, h("ellipse", { cx: 700, cy: 428, rx: 11, ry: 12.5, fill: "#4ade80" }), h("ellipse", { cx: 696, cy: 426, rx: 2.6, ry: 3.6, fill: "#14532d", transform: "rotate(-12 696 426)" }), h("ellipse", { cx: 704, cy: 426, rx: 2.6, ry: 3.6, fill: "#14532d", transform: "rotate(12 704 426)" }), h("path", { d: "M 700,416 L 700,406", stroke: "#4ade80", strokeWidth: 2.5 }), h("circle", { cx: 700, cy: 404, r: 2.6, fill: "#a3e635" }), h("path", { d: "M 689,436 A 27,8.5 0 0 0 711,436", stroke: "#4b5563", strokeWidth: 6, fill: "none" })));
  }

  function flower(x, y, s) {
    return h("g", { transform: `translate(${x} ${y}) scale(${s})` }, h("line", { x1: 0, y1: 8, x2: 0, y2: 34, stroke: "#3f9d4e", strokeWidth: 4, strokeLinecap: "round" }), h("path", { d: "M 0,22 Q -10,18 -12,10", stroke: "#3f9d4e", strokeWidth: 3.5, fill: "none", strokeLinecap: "round" }), [0, 45, 90, 135, 180, 225, 270, 315].map((a) => h("ellipse", { key: a, cx: 0, cy: -11, rx: 4.6, ry: 8.5, fill: "#fbbf24", transform: `rotate(${a})` })), h("circle", { r: 7, fill: "#92400e" }), h("circle", { r: 4, fill: "#78350f" }));
  }
  function sheep(x, y, s) {
    return h("g", { transform: `translate(${x} ${y}) scale(${s})` }, h("line", { x1: -8, y1: 14, x2: -8, y2: 26, stroke: "#374151", strokeWidth: 4, strokeLinecap: "round" }), h("line", { x1: 8, y1: 14, x2: 8, y2: 26, stroke: "#374151", strokeWidth: 4, strokeLinecap: "round" }), h("g", { fill: "#f8fafc" }, h("circle", { cx: -10, cy: 2, r: 10 }), h("circle", { cx: 0, cy: -5, r: 12 }), h("circle", { cx: 11, cy: 1, r: 10 }), h("circle", { cx: 0, cy: 4, r: 11 })), h("ellipse", { cx: 17, cy: 6, rx: 7, ry: 6, fill: "#374151" }), h("circle", { cx: 19, cy: 4.5, r: 1.4, fill: "#f8fafc" }));
  }
  function farmScene({ seed, uid, variant, diffs }) {
    const B = (id) => variant === "b" && diffs.has(id);
    const rng = mulberry32(seed);
    const grass = Array.from({ length: 16 }, () => ({
      x: 20 + rng() * 760,
      y: 448 + rng() * 60
    }));
    const posies = Array.from({ length: 12 }, () => ({
      x: 30 + rng() * 740,
      y: 392 + rng() * 110,
      c: ["#f472b6", "#c084fc", "#facc15", "#fb7185"][Math.floor(rng() * 4)]
    }));
    return h("g", null, h("defs", null, h("linearGradient", { id: `${uid}sky`, x1: "0", y1: "0", x2: "0", y2: "1" }, h("stop", { offset: "0", stopColor: "#aee7ff" }), h("stop", { offset: "1", stopColor: "#fdf6c9" })), h("radialGradient", { id: `${uid}sung`, cx: "0.5", cy: "0.5", r: "0.5" }, h("stop", { offset: "0", stopColor: "#fff7cc", stopOpacity: "0.9" }), h("stop", { offset: "1", stopColor: "#fff7cc", stopOpacity: "0" }))), h("rect", { x: 0, y: 0, width: 800, height: 330, fill: `url(#${uid}sky)` }), h("circle", { cx: 74, cy: 78, r: 110, fill: `url(#${uid}sung)` }), h("g", { stroke: "#fbbf24", strokeWidth: 6, strokeLinecap: "round" }, [15, 60, 105, 150, 195, 240, 285, 330].map((a) => {
      const rad = a * Math.PI / 180;
      return h(
        "line",
        {
          key: a,
          x1: 74 + Math.cos(rad) * 42,
          y1: 78 + Math.sin(rad) * 42,
          x2: 74 + Math.cos(rad) * 58,
          y2: 78 + Math.sin(rad) * 58
        }
      );
    })), h("circle", { cx: 74, cy: 78, r: 30, fill: "#ffd166" }), h("g", { transform: "translate(566 66)" }, h("ellipse", { rx: 38, ry: 16, fill: "#ffffff", opacity: 0.95 }), h("ellipse", { cx: 30, cy: 6, rx: 26, ry: 12, fill: "#ffffff", opacity: 0.95 }), h("ellipse", { cx: -28, cy: 8, rx: 22, ry: 10, fill: "#ffffff", opacity: 0.95 })), h("g", { transform: "translate(212 88)" }, B(1) ? null : h("g", null, h("ellipse", { cx: -10, cy: -24, rx: 7, ry: 17, fill: "#ffffff", transform: "rotate(-10 -10 -24)" }), h("ellipse", { cx: 10, cy: -25, rx: 7, ry: 17, fill: "#ffffff", transform: "rotate(12 10 -25)" })), h("ellipse", { rx: 34, ry: 15, fill: "#ffffff" }), h("ellipse", { cx: 26, cy: 6, rx: 24, ry: 11, fill: "#ffffff" })), h("path", { d: "M0,300 Q200,230 420,292 T800,268 L800,520 L0,520 Z", fill: "#8ed18f" }), h("path", { d: "M0,362 Q240,296 470,354 T800,338 L800,520 L0,520 Z", fill: "#6fbf7a" }), h("path", { d: "M0,452 Q400,428 800,452 L800,520 L0,520 Z", fill: "#e9c37d" }), h("path", { d: "M0,470 Q400,448 800,470 M0,492 Q400,470 800,492", stroke: "#d9a15b", strokeWidth: 5, fill: "none", opacity: 0.7 }), !B(2) && h("g", null, h("line", { x1: 392, y1: 204, x2: 392, y2: 162, stroke: "#374151", strokeWidth: 3 }), h("line", { x1: 368, y1: 176, x2: 416, y2: 176, stroke: "#374151", strokeWidth: 2.4 }), h("path", { d: "M 416,176 L 408,171 L 408,181 Z", fill: "#374151" }), h("g", { fill: "#374151", transform: "translate(392 150)" }, h("circle", { cx: 0, cy: 0, r: 6.5 }), h("circle", { cx: 7, cy: -5, r: 4 }), h("path", { d: "M 9.5,-7 L 14,-5.5 L 10,-3.5 Z", fill: "#b45309" }), h("path", { d: "M -5,2 Q -14,0 -13,-8 Q -6,-6 -4,-2 Z" }))), h("g", null, h("rect", { x: 312, y: 256, width: 160, height: 112, fill: "#dc2626" }), h("path", { d: "M 472,256 L 472,368 L 312,368 L 312,256 Z", fill: "none", stroke: "#b91c1c", strokeWidth: 2 }), h("path", { d: "M 300,258 L 340,202 L 444,202 L 484,258 Z", fill: "#7f1d1d" }), h("rect", { x: 372, y: 222, width: 40, height: 34, fill: "#991b1b", stroke: "#fecaca", strokeWidth: 3 }), h("path", { d: "M 372,222 L 412,256 M 412,222 L 372,256", stroke: "#fecaca", strokeWidth: 3 }), B(3) ? h("g", null, h("rect", { x: 352, y: 292, width: 80, height: 76, fill: "#451a03" }), h("ellipse", { cx: 392, cy: 358, rx: 30, ry: 12, fill: "#fbbf24" }), h("ellipse", { cx: 376, cy: 348, rx: 16, ry: 9, fill: "#fcd34d" }), h("ellipse", { cx: 408, cy: 350, rx: 14, ry: 8, fill: "#fcd34d" }), h("rect", { x: 352, y: 292, width: 80, height: 76, fill: "none", stroke: "#7f1d1d", strokeWidth: 4 })) : h("g", null, h("rect", { x: 352, y: 292, width: 80, height: 76, fill: "#991b1b", stroke: "#fecaca", strokeWidth: 4 }), h("path", { d: "M 356,296 L 428,364 M 428,296 L 356,364", stroke: "#fecaca", strokeWidth: 5 }), h("line", { x1: 392, y1: 292, x2: 392, y2: 368, stroke: "#fecaca", strokeWidth: 3 }))), h("g", null, h("path", { d: "M 648,320 L 696,320 L 687,186 L 657,186 Z", fill: "#d6d3d1", stroke: "#a8a29e", strokeWidth: 2 }), h("rect", { x: 664, y: 292, width: 16, height: 28, rx: 3, fill: "#78716c" }), h("g", { transform: "translate(672 176)" }, (B(4) ? [0, 120, 240] : [45, 135, 225, 315]).map((a) => h("path", { key: a, d: "M 0,0 L -8,-62 L 8,-62 Z", fill: "#f5f5f4", stroke: "#a8a29e", strokeWidth: 2, transform: `rotate(${a})` })), h("circle", { r: 6.5, fill: "#78716c" }))), h("g", null, h("path", { d: "M 584,370 C 587,332 583,312 579,292", stroke: "#7c4a21", strokeWidth: 12, strokeLinecap: "round", fill: "none" }), h("circle", { cx: 558, cy: 274, r: 31, fill: "#3f9d4e" }), h("circle", { cx: 620, cy: 270, r: 33, fill: "#3f9d4e" }), h("circle", { cx: 590, cy: 244, r: 35, fill: "#45b156" }), h("g", { fill: "#dc2626" }, h("circle", { cx: 568, cy: 264, r: 6 }), h("circle", { cx: 606, cy: 252, r: 6 }), h("circle", { cx: 588, cy: 286, r: 6 }), !B(5) && h("circle", { cx: 630, cy: 278, r: 6 }), !B(5) && h("circle", { cx: 556, cy: 292, r: 6 }))), h("g", { stroke: "#fff7ed", strokeWidth: 5, strokeLinecap: "round" }, h("line", { x1: 30, y1: 424, x2: 300, y2: 424 }), h("line", { x1: 30, y1: 438, x2: 300, y2: 438 }), [46, 90, 134, 178, 222, 266].map((x) => h("line", { key: x, x1: x, y1: 412, x2: x, y2: 444 })), h("line", { x1: 520, y1: 424, x2: 790, y2: 424 }), h("line", { x1: 520, y1: 438, x2: 790, y2: 438 }), [536, 580, 624, 712, 756].map((x) => h("line", { key: x, x1: x, y1: 412, x2: x, y2: 444 }))), h("g", { transform: "translate(178 406)" }, h("line", { x1: -22, y1: 12, x2: -22, y2: 32, stroke: "#ffffff", strokeWidth: 7 }), h("line", { x1: 22, y1: 12, x2: 22, y2: 32, stroke: "#ffffff", strokeWidth: 7 }), h("ellipse", { cx: 0, cy: 0, rx: 34, ry: 20, fill: "#ffffff", stroke: "#e5e7eb", strokeWidth: 1.5 }), !B(6) && h("ellipse", { cx: 8, cy: -2, rx: 13, ry: 9, fill: "#1f2937", transform: "rotate(-18 8 -2)" }), h("line", { x1: 33, y1: -6, x2: 40, y2: -18, stroke: "#ffffff", strokeWidth: 4, strokeLinecap: "round" }), h("circle", { cx: 41, cy: -20, r: 3.2, fill: "#1f2937" }), h("circle", { cx: -38, cy: -14, r: 14.5, fill: "#ffffff", stroke: "#e5e7eb", strokeWidth: 1.5 }), h("ellipse", { cx: -38, cy: -6, rx: 9, ry: 6.5, fill: "#fbcfe8" }), h("circle", { cx: -42, cy: -7, r: 1.4, fill: "#831843" }), h("circle", { cx: -34, cy: -7, r: 1.4, fill: "#831843" }), h("circle", { cx: -44, cy: -18, r: 2.2, fill: "#1f2937" }), h("path", { d: "M -48,-26 L -54,-32 L -46,-30 Z M -28,-26 L -22,-32 L -30,-30 Z", fill: "#fde68a" }), h("ellipse", { cx: -52, cy: -16, rx: 5, ry: 3.4, fill: "#ffffff", stroke: "#e5e7eb", transform: "rotate(-30 -52 -16)" }), h("ellipse", { cx: -24, cy: -16, rx: 5, ry: 3.4, fill: "#ffffff", stroke: "#e5e7eb", transform: "rotate(30 -24 -16)" })), sheep(322, 436, 1), !B(7) && sheep(356, 448, 0.78), h("g", { transform: "translate(472 434)" }, !B(8) && h("ellipse", { cx: -18, cy: 16, rx: 7, ry: 9.5, fill: "#fef3c7", stroke: "#eab308", strokeWidth: 1.5 }), h("line", { x1: -3, y1: 10, x2: -3, y2: 20, stroke: "#f59e0b", strokeWidth: 3, strokeLinecap: "round" }), h("line", { x1: 5, y1: 10, x2: 5, y2: 20, stroke: "#f59e0b", strokeWidth: 3, strokeLinecap: "round" }), h("ellipse", { cx: 0, cy: 0, rx: 13.5, ry: 10.5, fill: "#ffffff" }), h("path", { d: "M -12,-2 Q -20,-6 -22,-14 M -10,-4 Q -16,-10 -16,-16", stroke: "#ffffff", strokeWidth: 4, fill: "none", strokeLinecap: "round" }), h("circle", { cx: 13, cy: -9, r: 7, fill: "#ffffff" }), h("path", { d: "M 9,-15 C 8,-19 11,-20 12,-17 C 13,-21 16,-20 16,-16 C 18,-18 20,-16 18,-13", fill: "#ef4444" }), h("path", { d: "M 19,-9 L 25,-7 L 19,-5 Z", fill: "#fb923c" }), h("circle", { cx: 14.5, cy: -10, r: 1.5, fill: "#1f2937" })), h("g", { transform: "translate(548 452)" }, h("ellipse", { cx: 0, cy: 12, rx: 36, ry: 9, fill: "#a16207", opacity: 0.75 }), !B(9) && h("g", null, h("ellipse", { cx: 2, cy: -2, rx: 17.5, ry: 11.5, fill: "#fda4af" }), h("circle", { cx: -14, cy: -7, r: 9, fill: "#fda4af" }), h("path", { d: "M -18,-13 L -22,-20 L -13,-16 Z", fill: "#f9a8d4" }), h("circle", { cx: -17, cy: -6, r: 4, fill: "#f472b6" }), h("circle", { cx: -18.4, cy: -6.5, r: 0.9, fill: "#831843" }), h("circle", { cx: -15.6, cy: -6.5, r: 0.9, fill: "#831843" }), h("circle", { cx: -12, cy: -10, r: 1.6, fill: "#1f2937" }), h("path", { d: "M 18,-6 Q 24,-8 23,-13", stroke: "#f9a8d4", strokeWidth: 3, fill: "none", strokeLinecap: "round" }), h("circle", { cx: 8, cy: 0, r: 3, fill: "#a16207", opacity: 0.6 }), h("circle", { cx: -4, cy: 3, r: 2.4, fill: "#a16207", opacity: 0.6 }))), flower(62, 368, 1), flower(92, 352, 1.15), !B(10) && flower(122, 372, 0.9), h("g", { transform: "translate(718 440)" }, h("ellipse", { cx: 0, cy: 24, rx: 28, ry: 5, fill: "#b45309", opacity: 0.3 }), h("circle", { r: 25, fill: "#fbbf24", stroke: "#d97706", strokeWidth: 2.5 }), h("circle", { r: 14, fill: "none", stroke: "#d97706", strokeWidth: 2, opacity: 0.7 }), h("circle", { r: 6, fill: "none", stroke: "#d97706", strokeWidth: 2, opacity: 0.7 }), !B(11) && h("g", { stroke: "#b45309", strokeWidth: 3.4 }, h("line", { x1: -8.5, y1: -23.4, x2: -8.5, y2: 23.4 }), h("line", { x1: 8.5, y1: -23.4, x2: 8.5, y2: 23.4 }))), h("g", null, h("ellipse", { cx: 248, cy: 476, rx: 62, ry: 19, fill: "#7dd3fc", stroke: "#38bdf8", strokeWidth: 2.5 }), h("path", { d: "M 208,474 Q 218,470 228,474 M 268,480 Q 278,476 288,480", stroke: "#38bdf8", strokeWidth: 2, fill: "none" }), h("g", { transform: "translate(228 468)" }, h("ellipse", { cx: 0, cy: 4, rx: 11, ry: 7, fill: "#fbbf24" }), h("circle", { cx: 9, cy: -3, r: 5, fill: "#fbbf24" }), h("path", { d: "M 13,-3 L 18,-2 L 13,-0.5 Z", fill: "#f97316" }), h("circle", { cx: 10, cy: -4, r: 1.1, fill: "#1f2937" })), !B(12) && h("g", { transform: "translate(272 476) scale(0.82)" }, h("ellipse", { cx: 0, cy: 4, rx: 11, ry: 7, fill: "#fbbf24" }), h("circle", { cx: 9, cy: -3, r: 5, fill: "#fbbf24" }), h("path", { d: "M 13,-3 L 18,-2 L 13,-0.5 Z", fill: "#f97316" }), h("circle", { cx: 10, cy: -4, r: 1.1, fill: "#1f2937" }))), !B(13) && h("g", { transform: "translate(500 194)" }, h("ellipse", { cx: -8, cy: -3, rx: 9, ry: 13, fill: "#f472b6", transform: "rotate(-24)" }), h("ellipse", { cx: 8, cy: -3, rx: 9, ry: 13, fill: "#c084fc", transform: "rotate(24)" }), h("ellipse", { cx: -6, cy: 8, rx: 5.5, ry: 8, fill: "#c084fc", transform: "rotate(-24)" }), h("ellipse", { cx: 6, cy: 8, rx: 5.5, ry: 8, fill: "#f472b6", transform: "rotate(24)" }), h("line", { x1: 0, y1: -12, x2: 0, y2: 12, stroke: "#374151", strokeWidth: 2.6, strokeLinecap: "round" }), h("path", { d: "M -1,-12 Q -5,-18 -8,-19 M 1,-12 Q 5,-18 8,-19", stroke: "#374151", strokeWidth: 1.6, fill: "none" })), grass.map((g_, i) => h(
      "path",
      {
        key: i,
        d: `M ${g_.x},${g_.y} q 2,-8 4,0 M ${g_.x + 6},${g_.y} q 2,-6 4,0`,
        stroke: "#65a30d",
        strokeWidth: 2.2,
        fill: "none",
        strokeLinecap: "round"
      }
    )), posies.map((p, i) => h("g", { key: i, transform: `translate(${p.x} ${p.y})` }, h("line", { x1: 0, y1: 2, x2: 0, y2: 9, stroke: "#65a30d", strokeWidth: 2 }), h("circle", { r: 3, fill: p.c }))));
  }  var SAHNE_BILGI = [
    { id: 0, ad: "Gün Batımı Plajı", alt: "Kum, deniz ve saklanan 7 fark" },
    { id: 1, ad: "Kamp Gecesi", alt: "Ay ışığında çadır ve kamp ateşi" },
    { id: 2, ad: "Derin Uzay", alt: "Roketler, uzaylılar ve yıldızlar" },
    { id: 3, ad: "Neşeli Çiftlik", alt: "Ahır, hayvanlar ve rüzgar gülü" },
  ];

  /* Her sahnede 13 farklanabilir nesne. cx/cy/r, 800×520 görünüm
     kutusundaki TIKLAMA ALANIdır ve çizimlerle birebir eşleşir. */
  var FARK_KONUMLARI = {
    0: [
      { id: 1, cx: 92, cy: 86, r: 48, ad: "Güneşin ışınları" },
      { id: 2, cx: 218, cy: 70, r: 36, ad: "Kücük bulut" },
      { id: 3, cx: 424, cy: 92, r: 42, ad: "Kuş sürüsü" },
      { id: 4, cx: 332, cy: 148, r: 36, ad: "Uçurtma" },
      { id: 5, cx: 604, cy: 192, r: 44, ad: "Yelkenlinin yelkeni" },
      { id: 6, cx: 711, cy: 155, r: 40, ad: "Hindistan cevizleri" },
      { id: 7, cx: 466, cy: 246, r: 32, ad: "Zıplayan balık" },
      { id: 8, cx: 556, cy: 272, r: 58, ad: "Şemsiyenin rengi" },
      { id: 9, cx: 694, cy: 378, r: 32, ad: "Plaj topu" },
      { id: 10, cx: 150, cy: 428, r: 34, ad: "Yengecin kıskacı" },
      { id: 11, cx: 332, cy: 452, r: 28, ad: "Deniz yıldızı" },
      { id: 12, cx: 452, cy: 446, r: 32, ad: "Kürek" },
      { id: 13, cx: 252, cy: 404, r: 32, ad: "Terlikler" },
    ],
    1: [
      { id: 1, cx: 96, cy: 84, r: 40, ad: "Ay'ın şekli" },
      { id: 2, cx: 322, cy: 62, r: 28, ad: "Parlayan yıldız" },
      { id: 3, cx: 622, cy: 74, r: 36, ad: "Kayan yıldız" },
      { id: 4, cx: 646, cy: 134, r: 28, ad: "Zirve bayrağı" },
      { id: 5, cx: 178, cy: 222, r: 32, ad: "Baykuşun gözleri" },
      { id: 6, cx: 742, cy: 172, r: 38, ad: "Çamın karlı tepesi" },
      { id: 7, cx: 624, cy: 384, r: 50, ad: "Çadırın kapısı" },
      { id: 8, cx: 398, cy: 242, r: 48, ad: "Ateşin dumanı" },
      { id: 9, cx: 476, cy: 336, r: 40, ad: "Marshmallow çubuğu" },
      { id: 10, cx: 534, cy: 444, r: 32, ad: "Sırt çantası" },
      { id: 11, cx: 116, cy: 462, r: 28, ad: "Mantarlar" },
      { id: 12, cx: 284, cy: 430, r: 30, ad: "Sincap" },
      { id: 13, cx: 716, cy: 440, r: 48, ad: "Kütükteki balta" },
    ],
    2: [
      { id: 1, cx: 150, cy: 116, r: 50, ad: "Gezegen halkası" },
      { id: 2, cx: 560, cy: 122, r: 42, ad: "UFO'daki uzaylılar" },
      { id: 3, cx: 322, cy: 78, r: 36, ad: "Kuyruklu yıldız" },
      { id: 4, cx: 494, cy: 52, r: 24, ad: "Işıldayan yıldız" },
      { id: 5, cx: 688, cy: 60, r: 34, ad: "Kayan yıldız" },
      { id: 6, cx: 726, cy: 222, r: 36, ad: "Uydu panelleri" },
      { id: 7, cx: 640, cy: 318, r: 46, ad: "Roket şeritleri" },
      { id: 8, cx: 406, cy: 212, r: 44, ad: "Astronotun kolu" },
      { id: 9, cx: 505, cy: 282, r: 34, ad: "Güvenlik halatı" },
      { id: 10, cx: 96, cy: 302, r: 32, ad: "Küçük gezegen" },
      { id: 11, cx: 232, cy: 430, r: 34, ad: "Ay bayrağı" },
      { id: 12, cx: 560, cy: 470, r: 30, ad: "Ekstra krater" },
      { id: 13, cx: 700, cy: 428, r: 30, ad: "Kraterdeki uzaylı" },
    ],
    3: [
      { id: 1, cx: 212, cy: 88, r: 36, ad: "Tavşan bulut" },
      { id: 2, cx: 392, cy: 178, r: 30, ad: "Horoz rüzgar gülü" },
      { id: 3, cx: 392, cy: 328, r: 52, ad: "Ahır kapısı" },
      { id: 4, cx: 672, cy: 172, r: 52, ad: "Yel değirmeni kanatları" },
      { id: 5, cx: 590, cy: 298, r: 42, ad: "Elmalar" },
      { id: 6, cx: 178, cy: 406, r: 38, ad: "İneğin benekleri" },
      { id: 7, cx: 332, cy: 438, r: 34, ad: "İkinci koyun" },
      { id: 8, cx: 472, cy: 434, r: 26, ad: "Tavuk ve yumurta" },
      { id: 9, cx: 548, cy: 452, r: 32, ad: "Domuzcuk" },
      { id: 10, cx: 90, cy: 362, r: 36, ad: "Ay çiçekleri" },
      { id: 11, cx: 718, cy: 440, r: 36, ad: "Saman balyası" },
      { id: 12, cx: 248, cy: 472, r: 32, ad: "Ördekler" },
      { id: 13, cx: 500, cy: 194, r: 26, ad: "Kelebek" },
    ],
  };


  /* ======================================================================
   * ÜRETİLEN SAHNELER (kullanıcı isteği: "Fark bulmacada 500/1000'den fazla
   * örnek, zorluk seviyeleri karışık olsun").
   * ======================================================================
   * Elle çizilmiş 4 sahnenin yanına, kimliğinden (sahneId) DETERMİNİSTİK
   * olarak üretilen 1200 sahne eklendi. Aynı kimlik sunucuda da istemcide de
   * birebir aynı resmi ve aynı tıklama alanlarını verir — sunucu doğrulaması
   * (farkBul) bu yüzden değişmeden çalışır.
   *
   *   · 10 tema (çayır, deniz altı, gece şehri, kış, çöl, sonbahar, lunapark,
   *     bahçe partisi, orman, sahil kasabası), her temanın kendi nesneleri.
   *   · Her sahnede 13 farklanabilir nesne; her el bunlardan 7'si seçilir.
   *   · ZORLUK sahneye işlenir:
   *       Kolay — iri nesneler, belirgin farklar (nesne yok / zıt renk)
   *       Orta  — orta boy nesneler, renk / büyüklük / ayna farkları
   *       Zor   — küçük nesneler, ince farklar (detay eksik, yakın renk,
   *               hafif büyüme, küçük dönme) ve daha kalabalık süsleme
   * ==================================================================== */
  var URETILEN_SAHNE = 1200;
  var ELLE_SAHNE = 4;

  var TEMALAR = [
    { ad: 'Çayır', gok: ['#7dd3fc', '#e0f2fe'], yer: ['#86efac', '#4ade80'], ufuk: 0.42,
      nesne: ['agac', 'cicek', 'kelebek', 'kus', 'mantar', 'ev', 'balon', 'gunes'] },
    { ad: 'Deniz Altı', gok: ['#0ea5e9', '#0c4a6e'], yer: ['#fde68a', '#f59e0b'], ufuk: 0.78,
      nesne: ['balik', 'denizyildizi', 'yosun', 'kabuk', 'balik', 'kabarcik', 'denizyildizi', 'balik'] },
    { ad: 'Gece Şehri', gok: ['#0f172a', '#312e81'], yer: ['#334155', '#1e293b'], ufuk: 0.62,
      nesne: ['bina', 'yildiz', 'araba', 'lamba', 'bina', 'ay', 'yildiz', 'araba'] },
    { ad: 'Kış Masalı', gok: ['#bfdbfe', '#eff6ff'], yer: ['#ffffff', '#e2e8f0'], ufuk: 0.5,
      nesne: ['kardanadam', 'cam', 'hediye', 'yildiz', 'ev', 'cam', 'kus', 'hediye'] },
    { ad: 'Çöl Vahası', gok: ['#fdba74', '#fef3c7'], yer: ['#fcd34d', '#d97706'], ufuk: 0.5,
      nesne: ['kaktus', 'palmiye', 'deve', 'gunes', 'kaktus', 'piramit', 'kus', 'palmiye'] },
    { ad: 'Sonbahar Yolu', gok: ['#fed7aa', '#fff7ed'], yer: ['#d97706', '#92400e'], ufuk: 0.48,
      nesne: ['agac', 'mantar', 'semsiye', 'kus', 'ev', 'yaprak', 'agac', 'yaprak'] },
    { ad: 'Lunapark', gok: ['#f0abfc', '#fdf4ff'], yer: ['#a78bfa', '#7c3aed'], ufuk: 0.55,
      nesne: ['balon', 'kalp', 'yildiz', 'hediye', 'dondurma', 'balon', 'semsiye', 'kalp'] },
    { ad: 'Bahçe Partisi', gok: ['#a7f3d0', '#ecfdf5'], yer: ['#65a30d', '#3f6212'], ufuk: 0.45,
      nesne: ['cicek', 'dondurma', 'balon', 'hediye', 'kelebek', 'cicek', 'semsiye', 'pasta'] },
    { ad: 'Orman Derinliği', gok: ['#bbf7d0', '#f0fdf4'], yer: ['#166534', '#14532d'], ufuk: 0.46,
      nesne: ['cam', 'agac', 'mantar', 'kus', 'tavsan', 'mantar', 'cam', 'kelebek'] },
    { ad: 'Sahil Kasabası', gok: ['#93c5fd', '#dbeafe'], yer: ['#fde68a', '#fbbf24'], ufuk: 0.5,
      nesne: ['ev', 'semsiye', 'gemi', 'kus', 'palmiye', 'kabuk', 'gemi', 'denizyildizi'] }
  ];
  var ZORLUK_AD = ['', 'Kolay', 'Orta', 'Zor'];
  var RENKLER = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#a16207', '#64748b'];

  function tamsayiKarma(n) {
    var x = (n | 0) * 2654435761;
    x = (x ^ (x >>> 16)) >>> 0;
    return x || 1;
  }
  /* Renk biraz kaydır (zor farklar için yakın ton). */
  function renkKaydir(hex, miktar) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = function (v) { return Math.max(0, Math.min(255, Math.round(v + miktar))); };
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }

  /* ---- Nesne çizimleri: (0,0) merkezli, ~70px kutu; c = ana renk,
     d = detay var mı (false → "detay" farkı uygulanmış). */
  var NESNE = {
    agac: function (c, d) { return '<rect x="-7" y="5" width="14" height="32" rx="3" fill="#92400e"/>' +
      '<circle cx="0" cy="-12" r="26" fill="' + c + '"/>' + (d ? '<circle cx="-9" cy="-18" r="5" fill="#dc2626"/><circle cx="10" cy="-6" r="5" fill="#dc2626"/>' : ''); },
    cicek: function (c, d) { var s = '<rect x="-2" y="2" width="4" height="34" fill="#16a34a"/>';
      for (var i = 0; i < (d ? 6 : 5); i++) { var a = i * Math.PI * 2 / (d ? 6 : 5); s += '<circle cx="' + (Math.cos(a) * 13).toFixed(1) + '" cy="' + (-10 + Math.sin(a) * 13).toFixed(1) + '" r="9" fill="' + c + '"/>'; }
      return s + '<circle cx="0" cy="-10" r="7" fill="#fde047"/>'; },
    kelebek: function (c, d) { return '<ellipse cx="-14" cy="-6" rx="14" ry="18" fill="' + c + '"/><ellipse cx="14" cy="-6" rx="14" ry="18" fill="' + c + '"/>' +
      '<ellipse cx="-11" cy="14" rx="9" ry="10" fill="' + c + '" opacity=".8"/><ellipse cx="11" cy="14" rx="9" ry="10" fill="' + c + '" opacity=".8"/>' +
      '<rect x="-3" y="-20" width="6" height="40" rx="3" fill="#1f2937"/>' + (d ? '<circle cx="-14" cy="-8" r="5" fill="#fff"/><circle cx="14" cy="-8" r="5" fill="#fff"/>' : ''); },
    kus: function (c, d) { return '<ellipse cx="0" cy="0" rx="22" ry="15" fill="' + c + '"/><circle cx="17" cy="-10" r="10" fill="' + c + '"/>' +
      '<polygon points="26,-11 36,-8 26,-5" fill="#f59e0b"/><circle cx="20" cy="-12" r="2.5" fill="#111"/>' + (d ? '<path d="M -6,-2 Q 0,-16 10,-2" fill="' + renkKaydir(c, -50) + '"/>' : ''); },
    mantar: function (c, d) { return '<rect x="-8" y="0" width="16" height="26" rx="5" fill="#fef3c7"/><path d="M -28,4 Q 0,-40 28,4 Z" fill="' + c + '"/>' +
      (d ? '<circle cx="-10" cy="-10" r="4.5" fill="#fff"/><circle cx="8" cy="-14" r="4" fill="#fff"/><circle cx="14" cy="-3" r="3.5" fill="#fff"/>' : ''); },
    ev: function (c, d) { return '<rect x="-26" y="-8" width="52" height="40" fill="' + c + '"/><polygon points="-32,-8 0,-36 32,-8" fill="#b91c1c"/>' +
      '<rect x="-6" y="12" width="12" height="20" fill="#78350f"/>' + (d ? '<rect x="-21" y="0" width="11" height="10" fill="#bae6fd"/><rect x="10" y="0" width="11" height="10" fill="#bae6fd"/>' : ''); },
    balon: function (c, d) { return '<path d="M 0,26 Q -6,36 2,46" stroke="#475569" stroke-width="2" fill="none"/><ellipse cx="0" cy="-2" rx="20" ry="25" fill="' + c + '"/>' +
      '<polygon points="-4,22 4,22 0,28" fill="' + c + '"/>' + (d ? '<ellipse cx="-7" cy="-11" rx="5" ry="8" fill="#fff" opacity=".6"/>' : ''); },
    gunes: function (c, d) { var s = ''; for (var i = 0; i < (d ? 8 : 6); i++) { var a = i * Math.PI * 2 / (d ? 8 : 6);
      s += '<line x1="' + (Math.cos(a) * 24).toFixed(1) + '" y1="' + (Math.sin(a) * 24).toFixed(1) + '" x2="' + (Math.cos(a) * 34).toFixed(1) + '" y2="' + (Math.sin(a) * 34).toFixed(1) + '" stroke="#f59e0b" stroke-width="5" stroke-linecap="round"/>'; }
      return s + '<circle cx="0" cy="0" r="19" fill="' + c + '"/>'; },
    balik: function (c, d) { return '<ellipse cx="0" cy="0" rx="26" ry="15" fill="' + c + '"/><polygon points="22,0 38,-13 38,13" fill="' + c + '"/>' +
      '<circle cx="-14" cy="-4" r="3" fill="#111"/>' + (d ? '<path d="M -4,-13 L -4,13 M 6,-13 L 6,13" stroke="#fff" stroke-width="3" opacity=".7"/>' : ''); },
    denizyildizi: function (c, d) { var p = []; for (var i = 0; i < 10; i++) { var r = i % 2 ? 11 : 28, a = -Math.PI / 2 + i * Math.PI / 5; p.push((Math.cos(a) * r).toFixed(1) + ',' + (Math.sin(a) * r).toFixed(1)); }
      return '<polygon points="' + p.join(' ') + '" fill="' + c + '"/>' + (d ? '<circle cx="0" cy="0" r="4" fill="#fff"/><circle cx="0" cy="-13" r="2.5" fill="#fff"/>' : ''); },
    yosun: function (c, d) { return '<path d="M -10,34 Q -22,8 -8,-8 Q 2,-24 -6,-38" stroke="' + c + '" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<path d="M 6,34 Q 18,10 6,-4" stroke="' + c + '" stroke-width="7" fill="none" stroke-linecap="round"/>' + (d ? '<path d="M 16,34 Q 26,20 20,8" stroke="' + c + '" stroke-width="6" fill="none" stroke-linecap="round"/>' : ''); },
    kabuk: function (c, d) { var s = '<path d="M -26,14 Q 0,-34 26,14 Z" fill="' + c + '"/>';
      if (d) for (var i = -2; i <= 2; i++) s += '<line x1="0" y1="14" x2="' + (i * 10) + '" y2="-12" stroke="#fff" stroke-width="2" opacity=".7"/>';
      return s; },
    kabarcik: function (c, d) { return '<circle cx="0" cy="0" r="16" fill="none" stroke="' + c + '" stroke-width="3"/><circle cx="16" cy="-20" r="9" fill="none" stroke="' + c + '" stroke-width="3"/>' +
      (d ? '<circle cx="-14" cy="-24" r="6" fill="none" stroke="' + c + '" stroke-width="3"/>' : ''); },
    bina: function (c, d) { var s = '<rect x="-22" y="-40" width="44" height="76" fill="' + c + '"/>';
      for (var y = -32; y < 28; y += 14) for (var x = -15; x < 15; x += 14) if (d || y !== -18) s += '<rect x="' + x + '" y="' + y + '" width="8" height="8" fill="#fde047"/>';
      return s; },
    yildiz: function (c, d) { var p = []; for (var i = 0; i < 10; i++) { var r = i % 2 ? 10 : 24, a = -Math.PI / 2 + i * Math.PI / 5; p.push((Math.cos(a) * r).toFixed(1) + ',' + (Math.sin(a) * r).toFixed(1)); }
      return '<polygon points="' + p.join(' ') + '" fill="' + c + '"/>' + (d ? '<circle cx="0" cy="0" r="4" fill="#fff" opacity=".85"/>' : ''); },
    araba: function (c, d) { return '<rect x="-32" y="-6" width="64" height="20" rx="6" fill="' + c + '"/><path d="M -18,-6 L -10,-22 L 14,-22 L 22,-6 Z" fill="' + c + '"/>' +
      (d ? '<path d="M -12,-8 L -7,-18 L 12,-18 L 17,-8 Z" fill="#bae6fd"/>' : '') + '<circle cx="-18" cy="16" r="8" fill="#111"/><circle cx="18" cy="16" r="8" fill="#111"/>'; },
    lamba: function (c, d) { return '<rect x="-3" y="-20" width="6" height="56" fill="#475569"/><path d="M -16,-20 L 16,-20 L 8,-34 L -8,-34 Z" fill="#334155"/>' +
      '<circle cx="0" cy="-14" r="' + (d ? 9 : 5) + '" fill="' + c + '"/>'; },
    ay: function (c, d) { return '<circle cx="0" cy="0" r="24" fill="' + c + '"/><circle cx="12" cy="-6" r="20" fill="#0f172a"/>' + (d ? '<circle cx="-12" cy="6" r="3" fill="' + renkKaydir(c, -40) + '"/>' : ''); },
    kardanadam: function (c, d) { return '<circle cx="0" cy="16" r="20" fill="#fff" stroke="#cbd5e1"/><circle cx="0" cy="-16" r="14" fill="#fff" stroke="#cbd5e1"/>' +
      '<rect x="-12" y="-36" width="24" height="8" fill="' + c + '"/><rect x="-8" y="-46" width="16" height="12" fill="' + c + '"/>' +
      (d ? '<polygon points="0,-15 12,-13 0,-11" fill="#f97316"/>' : '') + '<circle cx="0" cy="10" r="2.5" fill="#111"/><circle cx="0" cy="20" r="2.5" fill="#111"/>'; },
    cam: function (c, d) { return '<rect x="-4" y="22" width="8" height="14" fill="#78350f"/><polygon points="0,-38 -18,-8 18,-8" fill="' + c + '"/>' +
      '<polygon points="0,-22 -24,22 24,22" fill="' + c + '"/>' + (d ? '<circle cx="-8" cy="6" r="4" fill="#f43f5e"/><circle cx="7" cy="-12" r="3.5" fill="#fde047"/>' : ''); },
    hediye: function (c, d) { return '<rect x="-22" y="-14" width="44" height="36" fill="' + c + '"/><rect x="-4" y="-14" width="8" height="36" fill="#fde047"/>' +
      (d ? '<path d="M 0,-14 C -18,-32 -22,-12 0,-14 C 22,-12 18,-32 0,-14" fill="#fde047"/>' : '') + '<rect x="-24" y="-20" width="48" height="8" fill="' + renkKaydir(c, -30) + '"/>'; },
    kaktus: function (c, d) { return '<rect x="-9" y="-34" width="18" height="70" rx="9" fill="' + c + '"/><rect x="-28" y="-10" width="12" height="26" rx="6" fill="' + c + '"/>' +
      (d ? '<rect x="16" y="-22" width="12" height="24" rx="6" fill="' + c + '"/>' : '') + '<circle cx="0" cy="-36" r="5" fill="#ec4899"/>'; },
    palmiye: function (c, d) { var s = '<path d="M 0,36 Q -6,0 0,-24" stroke="#92400e" stroke-width="7" fill="none"/>';
      var n = d ? 5 : 4; for (var i = 0; i < n; i++) { var a = Math.PI + i * Math.PI / (n - 1); s += '<path d="M 0,-24 Q ' + (Math.cos(a) * 20).toFixed(1) + ',' + (-24 + Math.sin(a) * 20 - 10).toFixed(1) + ' ' + (Math.cos(a) * 36).toFixed(1) + ',' + (-24 + Math.sin(a) * 26 + 6).toFixed(1) + '" stroke="' + c + '" stroke-width="6" fill="none" stroke-linecap="round"/>'; }
      return s; },
    deve: function (c, d) { return '<ellipse cx="0" cy="0" rx="28" ry="14" fill="' + c + '"/>' + '<ellipse cx="-6" cy="-14" rx="10" ry="' + (d ? 10 : 4) + '" fill="' + c + '"/>' +
      (d ? '<ellipse cx="10" cy="-12" rx="8" ry="8" fill="' + c + '"/>' : '') + '<rect x="22" y="-26" width="7" height="22" fill="' + c + '"/><ellipse cx="30" cy="-26" rx="8" ry="5" fill="' + c + '"/>' +
      '<rect x="-20" y="8" width="5" height="22" fill="' + c + '"/><rect x="14" y="8" width="5" height="22" fill="' + c + '"/>'; },
    piramit: function (c, d) { return '<polygon points="0,-34 -38,30 38,30" fill="' + c + '"/><polygon points="0,-34 0,30 38,30" fill="' + renkKaydir(c, -35) + '"/>' +
      (d ? '<rect x="-5" y="14" width="10" height="16" fill="#451a03"/>' : ''); },
    semsiye: function (c, d) { return '<path d="M 0,-14 L 0,30 Q 0,36 -6,34" stroke="#334155" stroke-width="3" fill="none"/><path d="M -32,-10 Q 0,-46 32,-10 Z" fill="' + c + '"/>' +
      (d ? '<path d="M -11,-10 Q 0,-46 11,-10 Z" fill="#fff" opacity=".5"/>' : ''); },
    yaprak: function (c, d) { return '<path d="M 0,-30 Q 26,-6 0,28 Q -26,-6 0,-30 Z" fill="' + c + '"/>' + (d ? '<path d="M 0,-26 L 0,28" stroke="' + renkKaydir(c, -50) + '" stroke-width="2.5"/>' : ''); },
    kalp: function (c, d) { return '<path d="M 0,26 C -40,-4 -18,-32 0,-12 C 18,-32 40,-4 0,26 Z" fill="' + c + '"/>' + (d ? '<ellipse cx="-11" cy="-10" rx="4" ry="6" fill="#fff" opacity=".6"/>' : ''); },
    dondurma: function (c, d) { return '<polygon points="-14,0 14,0 0,36" fill="#d97706"/><circle cx="0" cy="-8" r="15" fill="' + c + '"/>' +
      (d ? '<circle cx="0" cy="-26" r="11" fill="' + renkKaydir(c, 60) + '"/>' : '') + '<circle cx="3" cy="-12" r="2" fill="#dc2626"/>'; },
    pasta: function (c, d) { return '<rect x="-28" y="-4" width="56" height="30" rx="4" fill="' + c + '"/><rect x="-28" y="-6" width="56" height="7" fill="#fff"/>' +
      (d ? '<rect x="-2" y="-22" width="4" height="16" fill="#facc15"/><ellipse cx="0" cy="-25" rx="3" ry="5" fill="#f97316"/>' : ''); },
    tavsan: function (c, d) { return '<ellipse cx="0" cy="12" rx="20" ry="16" fill="' + c + '"/><circle cx="0" cy="-10" r="12" fill="' + c + '"/>' +
      '<ellipse cx="-6" cy="-32" rx="4" ry="12" fill="' + c + '"/>' + (d ? '<ellipse cx="6" cy="-32" rx="4" ry="12" fill="' + c + '"/>' : '') + '<circle cx="-4" cy="-12" r="2" fill="#111"/>'; },
    gemi: function (c, d) { return '<path d="M -34,6 L 34,6 L 24,24 L -24,24 Z" fill="' + c + '"/><rect x="-2" y="-34" width="4" height="40" fill="#475569"/>' +
      '<polygon points="2,-32 26,0 2,0" fill="#f8fafc"/>' + (d ? '<polygon points="-2,-26 -22,0 -2,0" fill="#e2e8f0"/>' : ''); }
  };
  var NESNE_AD = { agac: 'Ağaç', cicek: 'Çiçek', kelebek: 'Kelebek', kus: 'Kuş', mantar: 'Mantar', ev: 'Ev', balon: 'Balon', gunes: 'Güneş',
    balik: 'Balık', denizyildizi: 'Deniz yıldızı', yosun: 'Yosun', kabuk: 'Deniz kabuğu', kabarcik: 'Kabarcıklar', bina: 'Bina', yildiz: 'Yıldız',
    araba: 'Araba', lamba: 'Sokak lambası', ay: 'Hilal', kardanadam: 'Kardan adam', cam: 'Çam ağacı', hediye: 'Hediye paketi', kaktus: 'Kaktüs',
    palmiye: 'Palmiye', deve: 'Deve', piramit: 'Piramit', semsiye: 'Şemsiye', yaprak: 'Yaprak', kalp: 'Kalp', dondurma: 'Dondurma',
    pasta: 'Pasta', tavsan: 'Tavşan', gemi: 'Yelkenli' };
  var SIMETRIK = { cicek: 1, gunes: 1, yildiz: 1, denizyildizi: 1, kalp: 1, balon: 1, hediye: 1, pasta: 1, kabuk: 1, cam: 0, lamba: 1, bina: 1, yaprak: 1, kardanadam: 1, dondurma: 0 };
  var FARK_TUR_AD = { yok: 'kayıp', renk: 'renk', buyuk: 'boyut', ayna: 'yön', detay: 'detay', don: 'açı' };

  var _uretimOnbellek = {};
  /* Üretilen sahnenin TAM tanımı (tema, zorluk, 13 nesne ve her birinin
     farkı). Kimlikten deterministik; önbellekte tutulur. */
  function uretilenSahne(sahneId) {
    if (_uretimOnbellek[sahneId]) return _uretimOnbellek[sahneId];
    var no = sahneId - ELLE_SAHNE;
    var rng = mulberry32(tamsayiKarma(no + 7919));
    var tema = TEMALAR[no % TEMALAR.length];
    var zorluk = 1 + (Math.floor(no / TEMALAR.length) % 3);     // temalar ve zorluklar dengeli dağılır
    var olcek = zorluk === 1 ? 1.18 : zorluk === 2 ? 0.95 : 0.72;
    /* 13 nesne: 5×3 ızgarada (2 göz boş) titreşimli konumlar → çakışma yok. */
    var gozler = []; for (var gy = 0; gy < 3; gy++) for (var gx = 0; gx < 5; gx++) gozler.push([gx, gy]);
    for (var i = gozler.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = gozler[i]; gozler[i] = gozler[j]; gozler[j] = t; }
    gozler = gozler.slice(0, 13);
    var turlerK = ['yok', 'renk', 'yok', 'renk', 'buyuk'];
    var turlerO = ['renk', 'buyuk', 'ayna', 'yok', 'detay', 'renk'];
    var turlerZ = ['detay', 'renk', 'detay', 'don', 'buyuk', 'detay'];
    var turler = zorluk === 1 ? turlerK : zorluk === 2 ? turlerO : turlerZ;
    var nesneler = gozler.map(function (g, k) {
      var tip = tema.nesne[Math.floor(rng() * tema.nesne.length)];
      var renk = RENKLER[Math.floor(rng() * RENKLER.length)];
      var cx = Math.round(80 + g[0] * 160 + (rng() - 0.5) * 60);
      var cy = Math.round(110 + g[1] * 140 + (rng() - 0.5) * 40);
      var s = olcek * (0.85 + rng() * 0.3);
      var fark = turler[Math.floor(rng() * turler.length)];
      /* Simetrik nesnede ayna farkı görünmez → renk farkına çevir. */
      if (fark === 'ayna' && SIMETRIK[tip]) fark = 'renk';
      var yeniRenk;
      if (zorluk === 3) yeniRenk = renkKaydir(renk, rng() < 0.5 ? 55 : -55);
      else { do { yeniRenk = RENKLER[Math.floor(rng() * RENKLER.length)]; } while (yeniRenk === renk); }
      var ayna = rng() < 0.5;
      return { id: k + 1, tip: tip, renk: renk, yeniRenk: yeniRenk, cx: cx, cy: cy, s: s, fark: fark, ayna: ayna,
               don: Math.round((rng() - 0.5) * 16) };
    });
    /* Tıklama alanı: nesne boyuna göre (en az 24 px). */
    var konum = nesneler.map(function (n) {
      return { id: n.id, cx: n.cx, cy: n.cy, r: Math.max(24, Math.round(38 * n.s)),
               ad: (NESNE_AD[n.tip] || 'Nesne') + ' (' + FARK_TUR_AD[n.fark] + ')' };
    });
    var r = { id: sahneId, tema: tema, zorluk: zorluk, nesneler: nesneler, konum: konum,
              bilgi: { id: sahneId, ad: tema.ad + ' • ' + ZORLUK_AD[zorluk] + ' #' + (no + 1),
                       alt: ZORLUK_AD[zorluk] + ' seviye — 7 farkı bul', zorluk: zorluk } };
    _uretimOnbellek[sahneId] = r;
    return r;
  }

  function uretilenCiz(sahneId, o) {
    var tn = uretilenSahne(sahneId);
    var tema = tn.tema, uid = String(o.uid || 's');
    var B = function (id) { return o.variant === 'b' && o.diffs.has(id); };
    var ufukY = Math.round(GORUNUM_BOY * tema.ufuk);
    var rng = mulberry32((Number(o.seed) || 1) ^ tamsayiKarma(sahneId));
    var s = '<defs><linearGradient id="' + uid + 'g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tema.gok[0] + '"/><stop offset="1" stop-color="' + tema.gok[1] + '"/></linearGradient>' +
            '<linearGradient id="' + uid + 'y" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tema.yer[0] + '"/><stop offset="1" stop-color="' + tema.yer[1] + '"/></linearGradient></defs>';
    s += '<rect x="0" y="0" width="' + GORUNUM_EN + '" height="' + GORUNUM_BOY + '" fill="url(#' + uid + 'g)"/>';
    s += '<path d="M0,' + ufukY + ' C 200,' + (ufukY - 18) + ' 600,' + (ufukY + 18) + ' 800,' + ufukY + ' L800,520 L0,520 Z" fill="url(#' + uid + 'y)"/>';
    /* Süsleme (fark DEĞİL): iki kopyada birebir aynı, el tohumundan. Zor
       sahnelerde daha kalabalık → farklar gözden kaçar. */
    var susSay = tn.zorluk === 3 ? 46 : tn.zorluk === 2 ? 28 : 14;
    for (var i = 0; i < susSay; i++) {
      var x = (rng() * GORUNUM_EN).toFixed(1), y = (rng() * GORUNUM_BOY).toFixed(1), rr = (1.5 + rng() * 3).toFixed(1);
      s += '<circle cx="' + x + '" cy="' + y + '" r="' + rr + '" fill="#ffffff" opacity="' + (0.15 + rng() * 0.3).toFixed(2) + '"/>';
    }
    tn.nesneler.forEach(function (n) {
      var degis = B(n.id);
      if (degis && n.fark === 'yok') return;
      var renk = (degis && n.fark === 'renk') ? n.yeniRenk : n.renk;
      var sc = n.s * (degis && n.fark === 'buyuk' ? (tn.zorluk === 3 ? 1.22 : 1.4) : 1);
      var ayna = n.ayna !== (degis && n.fark === 'ayna');
      var don = n.don + (degis && n.fark === 'don' ? 28 : 0);
      var detay = !(degis && n.fark === 'detay');
      var ciz = NESNE[n.tip] || NESNE.yildiz;
      s += '<g transform="translate(' + n.cx + ' ' + n.cy + ') rotate(' + don + ') scale(' + (ayna ? -sc : sc).toFixed(3) + ' ' + sc.toFixed(3) + ')">' + ciz(renk, detay) + '</g>';
    });
    return s;
  }

  function sahneBilgi(id) {
    id = Number(id) || 0;
    if (id < ELLE_SAHNE) return SAHNE_BILGI[id] || null;
    if (id < ELLE_SAHNE + URETILEN_SAHNE) return uretilenSahne(id).bilgi;
    return null;
  }
  function farkKonumlari(id) {
    id = Number(id) || 0;
    if (id < ELLE_SAHNE) return FARK_KONUMLARI[id] || [];
    if (id < ELLE_SAHNE + URETILEN_SAHNE) return uretilenSahne(id).konum;
    return [];
  }
  function sahneZorlugu(id) { var b = sahneBilgi(id); return (b && b.zorluk) || 2; }

  /* Toplam sahne: 4 elle çizilmiş + 1200 üretilmiş. */
  function sahneSayisi() { return ELLE_SAHNE + URETILEN_SAHNE; }
  function sahneFarkSayisi(id) { return farkKonumlari(id).length; }

  /* Bir eldeki farkları tohumla seç: iki istemci de AYNI 7 farkı görür. */
  function farkSec(toplam, adet, tohum) {
    var rng = mulberry32(tohum);
    var dizi = [];
    for (var i = 1; i <= toplam; i++) dizi.push(i);
    for (var j = dizi.length - 1; j > 0; j--) {
      var k = Math.floor(rng() * (j + 1));
      var t = dizi[j]; dizi[j] = dizi[k]; dizi[k] = t;
    }
    return dizi.slice(0, adet).sort(function (a, b) { return a - b; });
  }

  /* Tıklanan noktada bir fark var mı? Döner: farkın id'si ya da null.
     Çakışan alanlarda MERKEZE EN YAKIN olan kazanır. */
  function farkBul(sahneId, x, y, gecerliIdler) {
    var liste = farkKonumlari(sahneId);
    var izin = gecerliIdler ? (gecerliIdler instanceof Set ? gecerliIdler : new Set(gecerliIdler)) : null;
    var enIyi = null, enYakin = Infinity;
    for (var i = 0; i < liste.length; i++) {
      var d = liste[i];
      if (izin && !izin.has(d.id)) continue;
      var uz = Math.hypot(x - d.cx, y - d.cy);
      if (uz <= d.r && uz < enYakin) { enYakin = uz; enIyi = d.id; }
    }
    return enIyi;
  }


  /* ----------------------------------------------------------- SAHNE LİSTESİ */
  var SAHNELER = [beachScene, campScene, spaceScene, farmScene];

  /* Bir sahnenin SVG'si. variant 'a' özgün, 'b' farkların uygulandığı kopya. */
  function sahneCiz(sahneId, opts) {
    var o = opts || {};
    var kume = o.diffs instanceof Set ? o.diffs : new Set(o.diffs || []);
    if ((Number(sahneId) || 0) >= ELLE_SAHNE) {
      return uretilenCiz(Number(sahneId), { seed: o.seed, uid: o.uid, variant: o.variant === 'b' ? 'b' : 'a', diffs: kume });
    }
    var fn = SAHNELER[Number(sahneId) || 0] || SAHNELER[0];
    var r = fn({ seed: Number(o.seed) || 1, uid: String(o.uid || 's'),
                 variant: o.variant === 'b' ? 'b' : 'a', diffs: kume });
    return (r && r.__svg !== undefined) ? r.__svg : String(r);
  }

  return {
    GORUNUM_EN: GORUNUM_EN, GORUNUM_BOY: GORUNUM_BOY,
    EL_BASINA_FARK: EL_BASINA_FARK,
    SAHNE_BILGI: SAHNE_BILGI, FARK_KONUMLARI: FARK_KONUMLARI,
    sahneSayisi: sahneSayisi, sahneFarkSayisi: sahneFarkSayisi,
    sahneBilgi: sahneBilgi, farkKonumlari: farkKonumlari, sahneZorlugu: sahneZorlugu,
    ELLE_SAHNE: ELLE_SAHNE, URETILEN_SAHNE: URETILEN_SAHNE, TEMALAR: TEMALAR,
    farkSec: farkSec, farkBul: farkBul, mulberry32: mulberry32,
    sahneCiz: sahneCiz, _h: h, _Fragment: Fragment
  };
});
