/* ============================================================================
 * TEK KİŞİLİK OYUNLAR — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Apex Garage (3B araba modifiye + sokak yarışı), Gölge Labirenti (birinci
 * şahıs labirent) ve AYLA: Mührün Bekçisi — kullanıcının verdiği referans
 * oyunlar BİREBİR aynı çalışır; her biri bir iframe içinde açılır
 * (assets/oyunlar/tek-*.html).
 *
 * MASA AKIŞI
 *   · Masa 1 koltukludur. Oyuncu bekleme odasında "Hazırım" deyince oyun
 *     başlar ve masadan ayrılana dek sürer (oyun içindeki "tekrar dene" döngüsü
 *     sitenin maç sonunu tetiklemez).
 *   · Oyun oyuncunun tarayıcısında çalışır. iframe saniyede bir özet yollar
 *     ('ozet': skor, seviye, durum); bu sayfa onu sunucuya iletir.
 *   · İZLEYİCİ: masada izleyici varsa sunucu 'izleyici' sayısını bildirir; o
 *     zaman iframe oyun ekranının küçük JPEG karelerini (≈4/sn) yollar. İzleyici
 *     bu kareleri ve özeti canlı görür. İzleyici kalmayınca akış durur.
 *
 * KÖPRÜ İLETİLERİ
 *   iframe → sayfa : {src:'tekkisilik', t:'ready'|'ozet'|'kare', ...}
 *   sayfa → iframe : {dst:'tekkisilik',  t:'init', ad, izle}  /  {t:'izle', on}
 *
 * Tahta HTML'i ve damga oyun boyunca AYNI kalır; iframe yeniden yüklenmez.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvTekKisilikLoaded) return;
  window.__gvTekKisilikLoaded = true;

  var SURUM = '20261018d';
  var OYUNLAR = {
    apexgarage:     { ad: 'Apex Garage',      ikon: '🏎️', dosya: 'assets/oyunlar/tek-apexgarage.html' },
    golgelabirenti: { ad: 'Gölge Labirenti',  ikon: '🌀', dosya: 'assets/oyunlar/tek-golgelabirenti.html' },
    ayla:           { ad: 'AYLA: Mührün Bekçisi', ikon: '🔮', dosya: 'assets/oyunlar/tek-ayla.html' }
  };
  var IDLER = Object.keys(OYUNLAR);
  window.TEK_KISILIK_OYUNLAR = IDLER.slice();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* OYUN DOSYASI KAYNAĞI: önce site ile aynı yerden (Yöncü) denenir; dosya
     orada yoksa (yüklenmemiş, ya da host 404/ana sayfa döndürüyor) Render'daki
     kopyaya düşülür. Böylece eksik yükleme iç içe site/404 göstermez. */
  var kaynakSonuc = {}, kaynakBekleyen = {};
  function kaynakBul(oyun, cb) {
    if (kaynakSonuc[oyun]) { cb(kaynakSonuc[oyun]); return; }
    var q = kaynakBekleyen[oyun] = kaynakBekleyen[oyun] || [];
    q.push(cb);
    if (q.length > 1) return;
    var SRC = OYUNLAR[oyun].dosya + '?v=' + SURUM;
    var bitir = function (u) {
      kaynakSonuc[oyun] = u;
      var l = kaynakBekleyen[oyun]; kaynakBekleyen[oyun] = [];
      l.forEach(function (f) { f(u); });
    };
    var yedek = function () {
      var b = (window.GV_BACKEND_URL || '').replace(/\/$/, '');
      bitir(b ? b + '/' + SRC : SRC);
    };
    try {
      fetch(SRC).then(function (r) {
        return r.ok ? r.text() : Promise.reject(new Error('http ' + r.status));
      }).then(function (t) {
        if (t.length > 20000 && t.indexOf('id="pg-room"') === -1) bitir(SRC); else yedek();
      }).catch(yedek);
    } catch (_) { yedek(); }
  }

  var frame = null, hazir = false, mCur = null, dinleyici = null, izleSon = null;
  var izleyiciPanel = null;

  function adOf(seat) {
    try {
      var r = window.__gvActiveRoom || (window.st && st.roomWaitingState && st.roomWaitingState.room);
      var p = r && (r.players || []).find(function (x) { return x.seat === seat; });
      if (p && p.name) return p.name;
    } catch (_) {}
    return 'Oyuncu';
  }
  function gonder(msg) {
    if (!frame || !frame.contentWindow) return;
    try { frame.contentWindow.postMessage(msg, '*'); } catch (_) {}
  }
  function izleBildir(n) {
    var on = Number(n) > 0;
    if (izleSon === on) return;
    izleSon = on;
    if (hazir) gonder({ dst: 'tekkisilik', t: 'izle', on: on });
  }
  function iframdenGelen(e) {
    if (!frame || e.source !== frame.contentWindow) return;
    var d = e.data;
    if (!d || d.src !== 'tekkisilik') return;
    if (d.t === 'ready') {
      hazir = true;
      var s = (mCur && mCur.state) || {};
      gonder({ dst: 'tekkisilik', t: 'init', ad: adOf(s.seat), izle: Number(s.izleyici) > 0 });
      izleSon = Number(s.izleyici) > 0;
      return;
    }
    if (!mCur || typeof mCur.emit !== 'function' || mCur.isSpectator) return;
    if (d.t === 'ozet' && d.ozet && typeof d.ozet === 'object') {
      mCur.emit('soloOzet', { ozet: d.ozet });
    } else if (d.t === 'kare' && typeof d.img === 'string') {
      mCur.emit('soloKare', { img: d.img });
    }
  }
  function sok() {
    if (dinleyici) window.removeEventListener('message', dinleyici);
    dinleyici = null; frame = null; hazir = false; mCur = null; izleSon = null; izleyiciPanel = null;
    var pr = document.getElementById('pg-room');
    if (pr) pr.classList.remove('tk-solo');
  }

  /* ---------------- İZLEYİCİ GÖRÜNÜMÜ ---------------- */
  var DURUM_YAZI = { menu: 'Ana menüde', oynuyor: 'Oynuyor', duraklat: 'Duraklattı', bitti: 'Oyun bitti', garaj: 'Garajda' };
  function izleyiciYaz(oz) {
    var p = izleyiciPanel;
    if (!p || !p.isConnected) return;
    oz = oz || {};
    var set = function (sel, txt) { var el = p.querySelector(sel); if (el && el.textContent !== txt) el.textContent = txt; };
    set('.tk-i-skor', String(Number(oz.skor) || 0));
    set('.tk-i-seviye', oz.seviye || '—');
    set('.tk-i-durum', DURUM_YAZI[oz.durum] || 'Oynuyor');
    set('.tk-i-metin', oz.metin || '');
    set('.tk-i-ayrinti', oz.ayrinti || '');
  }
  function izleyiciKare(img) {
    var p = izleyiciPanel;
    if (!p || !p.isConnected) return;
    var el = p.querySelector('.tk-i-img');
    var bos = p.querySelector('.tk-i-bos');
    if (el) { el.src = img; el.style.display = 'block'; }
    if (bos) bos.style.display = 'none';
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'tekkisilik',
    kinds: IDLER,
    reject: [],
    /* Olaylar tek adaptörde toplanır (arena aynı olay adı için son
       tanımı kullanır); üç oyun aynı iletişimi paylaşır. */
    events: {
      soloOzet: function (p) { if (p && p.ozet) izleyiciYaz(p.ozet); },
      soloKare: function (p) { if (p && typeof p.img === 'string') izleyiciKare(p.img); }
    },

    /* Oyun boyunca sabit: iframe yeniden yüklenmez. */
    damga: function (m) {
      return 'tek-' + ((m.state && m.state.oyun) || '') + (m.isSpectator ? '-izle' : '-oyna');
    },

    render: function (m) {
      var oyun = (m.state && m.state.oyun) || '';
      var g = OYUNLAR[oyun] || { ad: 'Oyun', ikon: '🎮' };
      /* Her durum paketinde çağrılır: izleyici sayısı değişince iframe'e
         haber ver (görüntü akışı yalnız izleyici varken açılır). */
      if (!m.isSpectator && m.state) izleBildir(m.state.izleyici);
      if (m.isSpectator) {
        return '<div class="tk-izle">' +
          '<div class="tk-i-ust"><span class="tk-i-rozet">👁️ CANLI İZLEME</span>' +
            '<b>' + esc(g.ikon + ' ' + g.ad) + '</b>' +
            '<span class="tk-i-durum">Oynuyor</span></div>' +
          '<div class="tk-i-ekran"><img class="tk-i-img" alt="Oyuncunun ekranı" style="display:none">' +
            '<div class="tk-i-bos">📡 Oyuncunun görüntüsü bekleniyor…</div></div>' +
          '<div class="tk-i-alt">' +
            '<div class="tk-i-kutu"><span>SKOR</span><b class="tk-i-skor">0</b></div>' +
            '<div class="tk-i-kutu"><span>SEVİYE</span><b class="tk-i-seviye">—</b></div>' +
            '<div class="tk-i-kutu tk-i-genis"><span>DURUM</span><b class="tk-i-metin"></b><i class="tk-i-ayrinti"></i></div>' +
          '</div></div>';
      }
      return '<div class="tk-wrap"><iframe class="tk-frame" id="tkFrame" title="' + esc(g.ad) +
        '" allow="fullscreen; autoplay; gamepad" scrolling="no"></iframe></div>';
    },

    bind: function (root, m) {
      sok();
      mCur = m;
      /* Tek kişilik masada rakip süresi / "Sen vs Rakip" / hamle listesi anlamsız. */
      var pr = document.getElementById('pg-room');
      if (pr) pr.classList.add('tk-solo');
      var oyun = (m.state && m.state.oyun) || '';
      if (m.isSpectator) {
        izleyiciPanel = root.querySelector('.tk-izle');
        izleyiciYaz(m.state && m.state.ozet);
        return;
      }
      frame = root.querySelector('#tkFrame');
      if (frame && OYUNLAR[oyun] && !frame.getAttribute('src')) {
        var hedef = frame;
        kaynakBul(oyun, function (u) { if (hedef.isConnected && !hedef.getAttribute('src')) hedef.setAttribute('src', u); });
      }
      dinleyici = iframdenGelen;
      window.addEventListener('message', dinleyici);
    }
  });

  window.addEventListener('gv:roomLeft', sok);

  window.__gvTekKisilik = {
    oyunlar: OYUNLAR,
    hazir: function () { return hazir; },
    iframe: function () { return frame; }
  };
})();
