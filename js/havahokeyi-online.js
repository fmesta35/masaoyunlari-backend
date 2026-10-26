/* ============================================================================
 * HAVA HOKEYİ — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Görünüm, efektler, sesler, skor/set göstergesi ve renk seçimi kullanıcının
 * verdiği "NEON RINK" referans oyunuyla AYNIDIR; bir iframe içinde
 * (assets/oyunlar/havahokeyi.html) çalışır.
 *
 * ÇEVRİMİÇİ KÖPRÜ
 *   · Fizik SUNUCUDADIR (havahokeyi-engine.js, sabit 120 Hz); iki oyuncu da
 *     aynı anda oynar. Sunucudan ~20 Hz gelen 'hokeyFrame' paketleri aynen
 *     iframe'e iletilir; iframe aralarını yumuşatır, kendi tokmağınızı
 *     yerelde tahmin eder.
 *   · iframe tokmak hedefini ('move') ve renk seçimini ('renk') yollar; bu
 *     sayfa bunları soketle ('hokeyMove', 'hokeyRenk') sunucuya iletir.
 *   · Maç sonu ekranı ve rövanş sitenin ortak katmanındadır.
 *
 * Tahta HTML'i ve damga maç boyunca AYNI kalır; iframe yeniden yüklenmez.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvHavahokeyiLoaded) return;
  window.__gvHavahokeyiLoaded = true;

  var SRC = 'assets/oyunlar/havahokeyi.html?online=1&v=20261027a';

  /* OYUN DOSYASI KAYNAĞI: önce site ile aynı yerden (Yöncü) denenir; dosya
     orada yoksa (yüklenmemiş, ya da host 404/ana sayfa döndürüyor) Render'daki
     kopyaya düşülür. Böylece eksik yükleme iç içe site/404 göstermez. */
  var kaynakSonuc = null, kaynakBekleyen = [];
  function kaynakBul(cb) {
    if (kaynakSonuc) { cb(kaynakSonuc); return; }
    kaynakBekleyen.push(cb);
    if (kaynakBekleyen.length > 1) return;
    var bitir = function (u) { kaynakSonuc = u; var q = kaynakBekleyen; kaynakBekleyen = []; q.forEach(function (f) { f(u); }); };
    var yedek = function () {
      var b = (window.GV_BACKEND_URL || '').replace(/\/$/, '');
      bitir(b ? b + '/' + SRC : SRC);
    };
    try {
      fetch(SRC).then(function (r) {
        return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status));
      }).then(function (t) {
        if (t.length > 50000 && t.indexOf('id="pg-room"') === -1) bitir(SRC); else yedek();
      }).catch(yedek);
    } catch (_) { yedek(); }
  }

  var frame = null, hazir = false, mCur = null, dinleyici = null;
  var sonKare = null;

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
      dst: 'havahokeyi', t: 'init',
      seat: (mCur && !mCur.isSpectator && (s.seat === 0 || s.seat === 1)) ? s.seat : null,
      names: [adOf(seats[0]), adOf(seats[1])],
      state: s
    });
    if (sonKare) gonder({ dst: 'havahokeyi', t: 'frame', f: sonKare });
  }
  function iframdenGelen(e) {
    if (!frame || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.src !== 'havahokeyi') return;
    if (d.t === 'ready') { initGonder(); return; }
    if (!mCur || typeof mCur.emit !== 'function') return;
    if (d.t === 'move') {
      var x = Number(d.x), y = Number(d.y);
      if (isFinite(x) && isFinite(y)) {
        var pk = { x: Math.round(x), y: Math.round(y) };
        /* gecikme telafisi alanları (ekranda görülen an + tokmak konumu/hızı) */
        if (isFinite(Number(d.vt)) && isFinite(Number(d.px)) && isFinite(Number(d.py))) {
          pk.vt = Number(d.vt); pk.px = Math.round(Number(d.px) * 10) / 10; pk.py = Math.round(Number(d.py) * 10) / 10;
          pk.mvx = Math.round(Number(d.mvx) || 0); pk.mvy = Math.round(Number(d.mvy) || 0);
        }
        mCur.emit('hokeyMove', pk);
      }
    } else if (d.t === 'renk' && typeof d.c === 'string') {
      mCur.emit('hokeyRenk', { renk: d.c });
    }
  }
  function sok() {
    if (dinleyici) window.removeEventListener('message', dinleyici);
    dinleyici = null; frame = null; hazir = false; mCur = null; sonKare = null;
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
        sonKare = p;
        if (hazir) gonder({ dst: 'havahokeyi', t: 'frame', f: p });
      }
    },

    /* Maç boyunca sabit: iframe yeniden yüklenmez. */
    damga: function () { return 'havahokeyi3d'; },

    render: function () {
      return '<div class="hk3-wrap"><iframe class="hk3-frame" id="hk3Frame" title="Hava Hokeyi" allow="fullscreen; autoplay" scrolling="no"></iframe></div>';
    },

    bind: function (root, m) {
      sok();
      mCur = m;
      frame = root.querySelector('#hk3Frame');
      if (frame && !frame.getAttribute('src')) {
        var hedef = frame;
        kaynakBul(function (u) { if (hedef.isConnected && !hedef.getAttribute('src')) hedef.setAttribute('src', u); });
      }
      dinleyici = iframdenGelen;
      window.addEventListener('message', dinleyici);
    }
  });

  window.addEventListener('gv:roomLeft', sok);

  window.__gvHavahokeyi = {
    hazir: function () { return hazir; },
    iframe: function () { return frame; },
    kare: function () { return sonKare; }
  };
})();
