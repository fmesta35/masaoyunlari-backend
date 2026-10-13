/* ============================================================================
 * CENGA — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Oyun, kullanıcının verdiği referans kodla BİREBİR aynıdır: 3B ahşap kule
 * (three.js), çöküş fiziği (cannon-es), "yeşil bölgeyi takip et" çekme
 * göstergesi, puan/seri/konfeti ve sesler. Bir iframe içinde
 * (assets/oyunlar/cenga3d.html) çalışır.
 *
 * ÇEVRİMİÇİ KÖPRÜ
 *   · SIRASI OLAN oyuncunun tarayıcısı oyunu yürütür ve kare paketlerini
 *     bu sayfaya postMessage ile yollar; bu sayfa onları soketle sunucuya
 *     ('cengaNet') iletir, sunucu rakibe/izleyicilere aktarır.
 *   · Gelen 'cengaNet' paketleri iframe'e aynen verilir; iframe sırası
 *     olmayan oyuncuda aynayı oynatır.
 *   · Maç sonu ekranı, süre şeridi ve rövanş sitenin ortak katmanındadır.
 *
 * Tahta HTML'i ve damga her durum güncellemesinde AYNI kalır; böylece iframe
 * bir maç boyunca yeniden yüklenmez (yeni maç = yeni tohum = yeni damga).
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvCengaLoaded) return;
  window.__gvCengaLoaded = true;

  var SRC = 'assets/oyunlar/cenga3d.html?online=1&v=20261013c';

  var frame = null;     // geçerli iframe
  var hazir = false;    // iframe 'ready' dedi ve init gönderildi
  var kuyruk = [];      // init'ten önce gelen paketler
  var mCur = null;      // geçerli adaptör örneği (m)
  var dinleyici = null; // window 'message' dinleyicisi

  function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }

  function adOf(seat) {
    try {
      var r = window.__gvActiveRoom || (window.st && st.roomWaitingState && st.roomWaitingState.room);
      var p = r && (r.players || []).find(function (x) { return x.seat === seat; });
      if (p && p.name) return p.name;
    } catch (_) {}
    return 'Oyuncu ' + (seat + 1);
  }

  function gonder(msg) {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage(msg, '*'); } catch (_) {}
  }

  function initGonder() {
    var s = (mCur && mCur.state) || {};
    var seats = s.seats || [0, 1];
    hazir = true;
    gonder({
      dst: 'cenga3d', t: 'init',
      count: seats.length,
      names: seats.map(adOf),
      seed: s.seed || 1,
      me: (mCur && !mCur.isSpectator) ? seats.indexOf(s.seat) : -1,
      settled: s.settled || null,
      current: Math.max(0, seats.indexOf(s.turn)),
      turn: s.tur || 0,
      players: s.players || null,
      stability: typeof s.stability === 'number' ? s.stability : 1
    });
    var q = kuyruk; kuyruk = [];
    q.forEach(function (m) { gonder({ dst: 'cenga3d', t: 'net', m: m }); });
  }

  function iframdenGelen(e) {
    if (!frame || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.src !== 'cenga3d') return;
    if (d.t === 'ready') { initGonder(); return; }
    if (d.t === 'net' && d.m && mCur && typeof mCur.emit === 'function') {
      mCur.emit('cengaNet', d.m);
    }
  }

  function sok() {
    if (dinleyici) window.removeEventListener('message', dinleyici);
    dinleyici = null; frame = null; hazir = false; kuyruk = []; mCur = null;
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'cenga',
    kinds: ['cenga'],
    reject: ['cengaRejected'],
    events: {
      cengaNet: function (m) {
        if (!m) return;
        if (!hazir) { kuyruk.push(m); if (kuyruk.length > 400) kuyruk.shift(); return; }
        gonder({ dst: 'cenga3d', t: 'net', m: m });
      },
      cengaTimeout: function (p) {
        if (!p) return;
        if (mCur && mCur.state && mCur.state.seat === p.seat && !mCur.isSpectator) {
          gonder({ dst: 'cenga3d', t: 'net', m: { t: 'timeout' } });
        } else {
          uyar('⏱ ' + (p.ad || 'Oyuncu') + ' süresini doldurdu.', 'warning');
        }
      }
    },

    /* Aynı tohum = aynı maç: tahta yeniden kurulmaz. */
    damga: function (m) { var s = m.state || {}; return 'cenga3d#' + (s.seed || 0); },

    render: function () {
      return '<div class="cg3-wrap"><iframe class="cg3-frame" id="cg3Frame" src="' + SRC +
        '" title="Cenga" allow="fullscreen; autoplay" scrolling="no"></iframe></div>';
    },

    bind: function (root, m) {
      sok();
      mCur = m;
      frame = root.querySelector('#cg3Frame');
      dinleyici = iframdenGelen;
      window.addEventListener('message', dinleyici);
    }
  });

  window.addEventListener('gv:roomLeft', sok);

  /* Test/teşhis köprüsü */
  window.__gvCenga = {
    hazir: function () { return hazir; },
    iframe: function () { return frame; }
  };
})();
