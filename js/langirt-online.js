/* ============================================================================
 * LANGIRT — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Maç ekranı kullanıcının verdiği "Kickoff Club" referans oyunuyla AYNIDIR
 * (masa çizimi, skor tabelası, çubuk seçici, şarjlı vuruş, sesler, parçacıklar,
 * ayarlar); bir iframe içinde (assets/oyunlar/langirt.html) çalışır.
 *
 * ÇEVRİMİÇİ KÖPRÜ
 *   · Sıra yoktur: iki oyuncu da aynı anda oynar. Fizik SUNUCUDADIR
 *     (langirt-engine.js = referansın game-engine.ts'inin birebir portu,
 *     sabit 50 Hz). Saniyede ~20 gelen 'langirtFrame' paketleri iframe'e
 *     iletilir; iframe aralarını yumuşatır, kendi çubuklarınızı yerelde
 *     tahmin eder.
 *   · iframe çubuk hedeflerini ('rods') ve vuruşları ('shot') yollar; bu
 *     sayfa bunları soketle ('langirtRods', 'langirtShot') sunucuya iletir.
 *   · Maç sonu ekranı ve rövanş sitenin ortak katmanındadır.
 *
 * Tahta HTML'i ve damga maç boyunca AYNI kalır; iframe yeniden yüklenmez.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvLangirtLoaded) return;
  window.__gvLangirtLoaded = true;

  var SRC = 'assets/oyunlar/langirt.html?online=1&v=20261013f';

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
      dst: 'langirt', t: 'init',
      seat: (mCur && !mCur.isSpectator && (s.seat === 0 || s.seat === 1)) ? s.seat : null,
      names: [adOf(seats[0]), adOf(seats[1])],
      state: s, frame: sonKare
    });
  }
  function iframdenGelen(e) {
    if (!frame || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.src !== 'langirt') return;
    if (d.t === 'ready') { initGonder(); return; }
    if (!mCur || typeof mCur.emit !== 'function') return;
    if (d.t === 'rods' && Array.isArray(d.hedefY)) {
      mCur.emit('langirtRods', { hedefY: d.hedefY.slice(0, 4).map(Number), hassas: !!d.hassas });
    } else if (d.t === 'shot') {
      mCur.emit('langirtShot', { cubuk: Number(d.cubuk) || 0, guc: Number(d.guc) || 0, nisanY: Number(d.nisanY) || 0 });
    }
  }
  function sok() {
    if (dinleyici) window.removeEventListener('message', dinleyici);
    dinleyici = null; frame = null; hazir = false; mCur = null; sonKare = null;
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'langirt',
    kinds: ['langirt'],
    reject: ['langirtRejected'],
    events: {
      langirtFrame: function (p) {
        if (!p || !p.top) return;
        sonKare = p;
        if (hazir) gonder({ dst: 'langirt', t: 'frame', f: p });
      }
    },

    /* Maç boyunca sabit: iframe yeniden yüklenmez. */
    damga: function () { return 'langirt3'; },

    render: function () {
      return '<div class="lg3-wrap"><iframe class="lg3-frame" id="lg3Frame" title="Langırt" allow="fullscreen; autoplay" scrolling="no"></iframe></div>';
    },

    bind: function (root, m) {
      sok();
      mCur = m;
      frame = root.querySelector('#lg3Frame');
      if (frame && !frame.getAttribute('src')) {
        var hedef = frame;
        kaynakBul(function (u) { if (hedef.isConnected && !hedef.getAttribute('src')) hedef.setAttribute('src', u); });
      }
      dinleyici = iframdenGelen;
      window.addEventListener('message', dinleyici);
    }
  });

  window.addEventListener('gv:roomLeft', sok);

  window.__gvLangirt = {
    hazir: function () { return hazir; },
    iframe: function () { return frame; },
    kare: function () { return sonKare; }
  };
})();
