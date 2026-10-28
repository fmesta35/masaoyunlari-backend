/* ============================================================================
 * TAM EKRAN DÜZENİ — telefonda (özellikle uygulamada) yatay tam ekran
 * ============================================================================
 * Kullanıcı raporları (ekran görüntüleriyle):
 *   · Connect4 / Reversi / Gomoku: tam ekranda hücreler üst üste biniyor,
 *     taşlar tahtanın dışına taşıyor ("taşlar kocaman, ekran küçücük").
 *   · Tavla: tam ekranda tahta minicik; "sıra ve skor bilgisini sol
 *     taraftaki sürelerin altına ver, zar ve Zar At en üstte kalsın, oyun
 *     alanı mümkün olan en geniş olsun".
 *   · Türk / İngiliz Daması: "Beyaz sırası — sizin sıranız ..." yazısı
 *     tahtanın üstünde yer kaplıyor → sol şeride, sürenin altına.
 *   · Fark Bulmaca / Kızma Birader: skor ve oyuncu bilgisi sol şeride,
 *     oyun alanı büyüsün.
 *   · Pişti / Batak: tam ekranda masa dikey bir şeride çöküyordu.
 *
 * KÖK NEDENLER (gerçek Chromium'da 889×400 yatay, uygulama kipi ölçüldü):
 *   1) Tahta genişliği %100 alınıp yüksekliği max-height:%100 ile
 *      kırpılıyordu — kare hücreler (aspect-ratio) tahtanın DIŞINA taşıyordu.
 *   2) js/board-fit.js tam ekranda bu sarmalayıcılara ayrıca transform:scale
 *      uyguluyordu; tahta iki kez küçülüyordu (tavla 157 px'e düştü).
 *   3) Bilgi şeritleri (durum, oyuncular, zar satırı) tahtanın ÜSTÜNDE
 *      yükseklik yiyordu; yatay telefonda yükseklik en kıt kaynak.
 *
 * ÇÖZÜM:
 *   · Tahtalar sarmalayıcının BOYUT container'ından (cqw/cqh) en büyük
 *     sığan ölçüye göre hesaplanır — oran hiçbir zaman bozulmaz.
 *   · Telefonda tam ekranda (dar yan şerit kipi) bilgi şeritlerinin bir
 *     KOPYASI sol şeride, sürelerin altına yazılır; asılları gizlenir.
 *     Kopya canlıdır (oyun her güncellendiğinde yeniden alınır) ve yalnız
 *     gösterim içindir — düğmeler asıl yerlerinde kalır.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.GVFsDuzen) return;

  /* Oyun sarmalayıcısı → sol şeride taşınacak bilgi parçaları */
  var BILGI = [
    { kap: '.dama-wrap,.tdama-wrap,.rv-wrap,.gm-wrap,.c4-wrap', sec: ['.dama-status', '.tdama-info'] },
    /* TAVLA: bilgi yazıları kopyalanır; zar + "Zar At" şeridi ise GERÇEK
       düğüm olarak sol şeride TAŞINIR (düğmeleri çalışmalı — kopya olmaz). */
    { kap: '.tavla-wrap', sec: ['.tavla-dice-area .tavla-info'], tasi: ['.tavla-dice-area'] },
    { kap: '.fk-wrap', sec: ['.fk-ust', '.fk-sahne-adi'] },
    { kap: '.kb-wrap', sec: ['.kb-oyuncular', '.kb-durum'] },
    { kap: '.card-wrap', sec: ['.card-score'] },
    { kap: '.bs-wrap', sec: ['.bs-view-state'] }
  ];
  var KOMPAKT = '(max-width:760px),(max-height:560px) and (orientation:landscape)';

  function oda() { return document.getElementById('pg-room'); }
  function kompaktMi() {
    try { return window.matchMedia(KOMPAKT).matches; } catch (_) { return false; }
  }

  function stil() {
    if (document.getElementById('gv-fs-duzen-stil')) return;
    var s = document.createElement('style');
    s.id = 'gv-fs-duzen-stil';
    s.textContent = [
      /* ---- 1) KARE/ORANLI TAHTALAR: sarmalayıcıya sığan en büyük ölçü ---- */
      '#pg-room.gv-fs .rv-wrap,#pg-room.gv-fs .gm-wrap,#pg-room.gv-fs .c4-wrap{container-type:size;--fs-pay:58px}',
      '#pg-room.gv-fs .c4-wrap{--fs-pay:112px}',
      '#pg-room.gv-fs .rv-board,#pg-room.gv-fs .gm-board{flex:none;box-sizing:border-box;' +
        'width:min(100cqw,calc(100cqh - var(--fs-pay)));height:auto;max-height:none}',
      '#pg-room.gv-fs .c4-board,#pg-room.gv-fs .c4-drop-row{flex:none;box-sizing:border-box;' +
        'width:min(100cqw,calc((100cqh - var(--fs-pay)) * 7 / 6 - 12px));max-height:none}',
      '#pg-room.gv-fs .c4-board{height:auto}',
      '#pg-room.gv-fs .c4-drop-row{margin-bottom:6px}',
      '#pg-room.gv-fs .c4-drop-btn{min-height:30px;padding:4px 0}',
      '#pg-room.gv-fs .dama-wrap,#pg-room.gv-fs .tdama-wrap{--fs-pay:58px}',
      '#pg-room.gv-fs .dama-board,#pg-room.gv-fs .tdama-board{flex:none;' +
        'width:min(100cqw,calc(100cqh - var(--fs-pay)));height:min(100cqw,calc(100cqh - var(--fs-pay)))}',
      '#pg-room.gv-fs .dama-status,#pg-room.gv-fs .tdama-info{flex:none;margin:0;padding:6px 10px}',

      /* ---- 2) TELEFON TAM EKRAN: bilgi sol şeritte ---- */
      '#pg-room.gv-fs.gv-fs-yan .rv-wrap,#pg-room.gv-fs.gv-fs-yan .gm-wrap,' +
        '#pg-room.gv-fs.gv-fs-yan .dama-wrap,#pg-room.gv-fs.gv-fs-yan .tdama-wrap{--fs-pay:2px}',
      '#pg-room.gv-fs.gv-fs-yan .c4-wrap{--fs-pay:44px}',
      '#pg-room.gv-fs.gv-fs-yan #boardArea .gv-fs-gizle{display:none!important}',
      '#pg-room.gv-fs.gv-fs-yan .game-side>#gvFsYan{display:flex!important}',
      '#gvFsYan{display:none;flex-direction:column;gap:6px;margin-top:6px;font-size:.72em;line-height:1.3;min-width:0}',
      '#gvFsYan>*{margin:0!important;max-width:100%;box-sizing:border-box}',
      '#gvFsYan .dama-status,#gvFsYan .tdama-info,#gvFsYan .tavla-info,#gvFsYan .kb-durum,#gvFsYan .card-score{' +
        'background:var(--card);border:1px solid var(--border);border-radius:10px;padding:6px 7px;' +
        'text-align:center;font-weight:700;white-space:normal;word-break:break-word;font-size:1em}',
      /* Fark Bulmaca üst şeridi dikey yığılır */
      '#gvFsYan .fk-ust{display:flex;flex-direction:column;gap:5px}',
      '#gvFsYan .fk-ust>*{width:auto!important;flex:none!important;min-width:0;padding:5px 7px!important}',
      '#gvFsYan .fk-ust .fk-ad{font-size:.95em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block}',
      '#gvFsYan .fk-ust .fk-bul,#gvFsYan .fk-ust .fk-skor{font-size:1.15em}',
      '#gvFsYan .fk-ust .fk-oyuncu.sag{text-align:left}',
      '#gvFsYan .fk-sahne-adi{font-size:.92em;color:var(--text2);text-align:center}',
      /* Kızma Birader oyuncu listesi dikey */
      '#gvFsYan .kb-oyuncular{display:flex;flex-direction:column;gap:5px}',
      '#gvFsYan .kb-oyuncular>*{width:auto!important;height:auto!important;min-height:0!important;flex:none!important;' +
        'padding:5px 6px!important;min-width:0;display:flex;align-items:center;gap:4px;font-size:1em}',
      '#gvFsYan .kb-nokta{flex:none;width:9px;height:9px}',
      '#gvFsYan .kb-oyuncular>*{max-width:100%;overflow:hidden;box-sizing:border-box}',
      '#gvFsYan .kb-ad{flex:1 1 auto;font-size:.95em}',
      '#gvFsYan .kb-evde{font-size:.85em;white-space:nowrap}',
      '#gvFsYan .kb-evde{flex:none;margin-left:auto}',
      '#gvFsYan .kb-ad{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}',
      /* Dar şerit biraz genişler (yatay telefonda genişlik bol, yükseklik kıt) */
      '@media (max-height:560px) and (orientation:landscape){' +
        '#pg-room.gv-fs.gv-fs-yan{grid-template-columns:clamp(104px,14vw,150px) minmax(0,1fr)}' +
        '#pg-room.gv-fs.gv-fs-yan .game-side{overflow-y:auto;max-height:100%;scrollbar-width:none}' +
        '#pg-room.gv-fs.gv-fs-yan .game-side::-webkit-scrollbar{display:none}' +
      '}',

      /* ---- 3) TAVLA (telefon tam ekran) — kullanıcı isteği (ekran görüntüsüyle):
         "tavla oyun ekranını beyaz çerçeve boyutlarında genişlet ve görüntü
         bozukluğu olmadan alana sığmasını sağla; zar atma alanını sol alttaki
         skor tablosunun aşağısında göster". Zar şeridi sol şeride taşınır
         (bkz. tasi), tahta sağdaki alanın TAMAMINI kaplar: genişlik alanın
         eni, yükseklik alanın boyu; haneler esner, pullar daire kalır
         (pul çapı en ve boydan küçük olana göre). */
      '#pg-room.gv-fs.gv-fs-yan .tavla-move-badge{display:none}',
      '#pg-room.gv-fs.gv-fs-yan .tavla-wrap{gap:0;align-items:stretch;justify-content:stretch}',
      '#pg-room.gv-fs.gv-fs-yan .tavla-wrap>.tavla-board{box-sizing:border-box;flex:1 1 auto;min-height:0;' +
        'width:100%;max-width:none;height:100%;display:flex;flex-direction:column;padding:5px;border-width:4px;' +
        '--tv-w:100cqw;--tv-checker:max(9px,min(calc(100cqw / 34),calc((100cqh - 66px) / 11.4)))}',
      '#pg-room.gv-fs.gv-fs-yan .tavla-wrap>.tavla-board>.tavla-row{flex:1 1 0;min-height:0;height:auto;aspect-ratio:auto}',
      '#pg-room.gv-fs.gv-fs-yan .tavla-wrap>.tavla-board>.tavla-num-row{flex:none}',
      '#pg-room.gv-fs.gv-fs-yan .tavla-num-cell{padding:2px 0;font-size:clamp(8px,calc(100cqh / 34),13px)}',
      /* sol şeritteki zar kutusu: zarlar yan yana, düğme altta tam genişlik */
      '#gvFsTasi{display:none}',
      '#pg-room.gv-fs.gv-fs-yan .game-side>#gvFsTasi{display:block!important;margin-top:6px;flex:none}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-dice-area{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;' +
        'gap:6px;margin:0;padding:6px;border-width:1px;border-radius:10px;box-sizing:border-box;width:100%}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-info{display:none}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-dice{gap:6px}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-die{width:34px;height:34px;padding:4px;border-radius:7px;box-sizing:border-box}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-die-face{gap:1px}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-die-face .dot{width:6px;height:6px}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-die-empty{font-size:1.3em}',
      '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-btn{flex:1 1 100%;padding:6px 4px;font-size:.8em;min-height:0;white-space:nowrap}',
      /* alçak telefonlarda (≤380 px) sol şerit sığsın diye daha sıkı */
      '@media (max-height:380px){' +
        '#pg-room.gv-fs.gv-fs-yan .game-side>#gvFsTasi{margin-top:4px}' +
        '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-dice-area{gap:4px;padding:4px}' +
        '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-die{width:28px;height:28px;padding:3px}' +
        '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-die-face .dot{width:5px;height:5px}' +
        '#pg-room.gv-fs.gv-fs-yan #gvFsTasi .tavla-btn{padding:4px;font-size:.76em}' +
        '#pg-room.gv-fs.gv-fs-yan #gvFsYan{gap:4px;margin-top:4px}' +
        '#pg-room.gv-fs.gv-fs-yan #gvFsYan .tavla-info{padding:4px 6px}' +
      '}',

      /* ---- 3b) TAVLA dik telefon (standart görünüm): "Taş toplama alanı
         çok geniş, oyun alanı dar" — toplama ve kırık taş şeritleri
         daraltılır (toplanan taşlar zaten üst üste dizilir), hanelere ve
         pullara yer kalır. */
      '@media (max-width:560px){' +
        '#pg-room:not(.gv-fs) .tavla-off{width:min(60px,8.6vw)}' +
        '#pg-room:not(.gv-fs) .tavla-bar{width:min(42px,6.6vw)}' +
        '#pg-room:not(.gv-fs) .tavla-board{--tv-checker:min(24px,5.3vw);padding:8px;border-width:5px}' +
        '#pg-room:not(.gv-fs) .tavla-zone-label{font-size:8px}' +
        '#pg-room:not(.gv-fs) .tavla-row{gap:1px}' +
        '#pg-room:not(.gv-fs) .tavla-half{gap:1px}' +
      '}',

      /* ---- 4) PİŞTİ / BATAK: masa sarmalayıcının tüm enini kullansın ---- */
      '#pg-room.gv-fs .card-wrap>*{max-width:100%}',
      '#pg-room.gv-fs .card-wrap>.card-table{width:100%;flex:1 1 auto;min-height:0}',

      /* ---- 5) AMİRAL BATTI (yatay telefon): masaüstündeki gibi iki tahta
         yan yana; atış konsolu ve düşman filosu sağ sütunda. Sahne
         şeridi yükseklik yemesin diye gizlenir, "SIRA SENDE" sol şeritte. */
      /* yalnız YATAY ekranda (dikey telefonda eski tek sütun düzeni kalır) */
      '@media (orientation:landscape){' +
        '#pg-room.gv-fs.gv-fs-yan .bs-wrap{container-type:size;display:grid!important;grid-template-columns:auto minmax(140px,1fr);grid-auto-rows:min-content;column-gap:12px;row-gap:6px;align-content:center;justify-content:center;max-width:none;--bs-cell:max(14px,min(30px,calc((100cqh - 46px) / 11),calc((100cqw - 196px) / 22.6)))}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-view,#pg-room.gv-fs.gv-fs-yan .bs-status{display:none!important}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-battlefield{grid-column:1;grid-row:1 / span 6;align-self:center;margin:0;gap:10px}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-console,#pg-room.gv-fs.gv-fs-yan .bs-fleet-status,#pg-room.gv-fs.gv-fs-yan .bs-log{grid-column:2;margin:0;max-width:100%;min-width:0;box-sizing:border-box}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-console{flex-wrap:wrap;gap:6px;padding:6px;justify-content:center}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-radar{display:none}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-console-mid{min-width:0;flex:1 1 100%;text-align:center}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-fire{flex:1 1 100%}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-fleet-status-list{flex-wrap:wrap;gap:3px}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-fleet-chip{font-size:.7em;padding:2px 5px}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-log{max-height:60px;overflow:auto;font-size:.72em}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-place{grid-column:1 / -1;display:grid;grid-template-columns:auto minmax(150px,1fr);grid-template-areas:"grid head" "grid tray" "grid tools" "grid ready";column-gap:12px;row-gap:6px;align-items:center;margin:0}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-place-head{grid-area:head;text-align:left}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-place-head h3{font-size:.95em;margin:0}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-place-head p{font-size:.72em;margin:2px 0 0}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-tray{grid-area:tray;flex-wrap:wrap;justify-content:flex-start;gap:4px}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-tray-ship{padding:3px 6px;font-size:.72em;min-height:0}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-place-tools .btn{padding:4px 8px;font-size:.74em;min-height:0}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-ready-btn{padding:6px 12px;font-size:.82em;min-height:0}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-place-tools{grid-area:tools;flex-wrap:wrap;justify-content:flex-start}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-grid-wrap{grid-area:grid}' +
        '#pg-room.gv-fs.gv-fs-yan .bs-ready-btn{grid-area:ready;justify-self:start}' +
      '}',
      '#gvFsYan .bs-view-state{position:static!important;transform:none!important;display:block;text-align:center;' +
        'padding:6px;border-radius:10px;font-size:1em}',

      /* ---- 6) FARK BULMACA: ipucu satırı telefonda gizlenir ---- */
      '#pg-room.gv-fs.gv-fs-yan .fk-not{display:none}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function yanKutu() {
    var side = document.querySelector('#pg-room .game-side');
    if (!side) return null;
    var k = document.getElementById('gvFsYan');
    if (!k) {
      k = document.createElement('div');
      k.id = 'gvFsYan';
      k.setAttribute('aria-live', 'polite');
      var t = side.querySelector('.timers');
      if (t && t.nextSibling) side.insertBefore(k, t.nextSibling); else side.appendChild(k);
    }
    return k;
  }

  /* Taşınan GERÇEK düğümlerin (tavla zar şeridi) sol şeritteki yuvası:
     bilgi kopyalarının hemen altında. */
  function tasiKutu() {
    var side = document.querySelector('#pg-room .game-side');
    if (!side) return null;
    var k = document.getElementById('gvFsTasi');
    if (!k) {
      k = document.createElement('div');
      k.id = 'gvFsTasi';
      var y = yanKutu();
      if (y && y.parentNode === side) side.insertBefore(k, y.nextSibling); else side.appendChild(k);
    }
    return k;
  }
  /* Tam ekrandan çıkınca taşınan düğüm tahtaya (asıl yerine) geri döner;
     oyun o arada yeniden çizdiyse eskisi atılır. */
  function geriTasi() {
    var k = document.getElementById('gvFsTasi');
    if (!k || !k.firstChild) return;
    var area = document.getElementById('boardArea');
    var el = k.firstElementChild;
    var wrap = area && area.querySelector('.tavla-wrap');
    if (el && wrap && el.classList.contains('tavla-dice-area') && !wrap.querySelector('.tavla-dice-area')) {
      el.querySelectorAll('.gv-fs-gizle').forEach(function (x) { x.classList.remove('gv-fs-gizle'); });
      var tahta = wrap.querySelector('.tavla-board');
      wrap.insertBefore(el, tahta || null);
    }
    k.innerHTML = '';
  }
  function tasi(kural, kok) {
    if (!kural.tasi) { geriTasi(); return; }
    var k = tasiKutu();
    if (!k) return;
    kural.tasi.forEach(function (sec) {
      var el = kok.querySelector(sec);       // oyun yeniden çizdiyse YENİ düğüm
      if (!el) return;
      k.innerHTML = '';
      k.appendChild(el);
    });
  }

  var sonHtml = '';
  function temizle() {
    geriTasi();
    var area = document.getElementById('boardArea');
    if (area) area.querySelectorAll('.gv-fs-gizle').forEach(function (e) { e.classList.remove('gv-fs-gizle'); });
    var k = document.getElementById('gvFsYan');
    if (k && k.innerHTML) k.innerHTML = '';
    sonHtml = '';
  }

  function uygula() {
    var o = oda();
    var area = document.getElementById('boardArea');
    if (!o || !area) return;
    var acik = o.classList.contains('gv-fs') && kompaktMi();
    var kural = null, kok = null;
    if (acik) {
      for (var i = 0; i < BILGI.length && !kural; i++) {
        kok = area.querySelector(BILGI[i].kap);
        if (kok) kural = BILGI[i];
      }
    }
    var aktif = !!kural;
    if (o.classList.contains('gv-fs-yan') !== aktif) {
      o.classList.toggle('gv-fs-yan', aktif);
      tetikle();
    }
    if (!aktif) { if (sonHtml || document.querySelector('#gvFsTasi>*')) temizle(); return; }
    var k = yanKutu();
    if (!k) return;
    tasi(kural, kok);
    var tk = document.getElementById('gvFsTasi');
    var html = '';
    kural.sec.forEach(function (sec) {
      var bulunan = [].slice.call(kok.querySelectorAll(sec));
      /* taşınmış şeridin içindeki bilgi yazıları da kaynaktır */
      if (tk && kural.tasi) bulunan = bulunan.concat([].slice.call(tk.querySelectorAll(sec.replace(/^.*\s/, ''))));
      bulunan.forEach(function (el) {
        if (!el.classList.contains('gv-fs-gizle')) el.classList.add('gv-fs-gizle');
        var c = el.cloneNode(true);
        c.classList.remove('gv-fs-gizle');
        c.removeAttribute('id');
        c.querySelectorAll('[id]').forEach(function (x) { x.removeAttribute('id'); });
        c.querySelectorAll('button,[onclick]').forEach(function (x) {
          x.removeAttribute('onclick'); x.setAttribute('tabindex', '-1');
        });
        html += c.outerHTML;
      });
    });
    if (html !== sonHtml) {
      var ilk = !sonHtml;
      sonHtml = html;
      k.innerHTML = html;
      if (ilk) tetikle();
    }
  }

  /* Oyunların kendi ölçü hesaplayıcıları (fark, kızma) yeniden boyut
     olayını dinliyor: şeritler yer değiştirince bir kez haber ver. */
  var tetikZaman = null;
  function tetikle() {
    if (tetikZaman) return;
    tetikZaman = setTimeout(function () {
      tetikZaman = null;
      try { window.dispatchEvent(new Event('resize')); } catch (_) {}
    }, 60);
  }

  var bekliyor = false;
  function planla() {
    if (bekliyor) return;
    bekliyor = true;
    (window.requestAnimationFrame || setTimeout)(function () { bekliyor = false; uygula(); });
  }

  function kur() {
    stil();
    var area = document.getElementById('boardArea');
    var o = oda();
    if (!area || !o) { setTimeout(kur, 400); return; }
    try {
      new MutationObserver(planla).observe(area, { childList: true, subtree: true, characterData: true });
      new MutationObserver(planla).observe(o, { attributes: true, attributeFilter: ['class'] });
    } catch (_) {}
    /* Masada uzun basınca "Kopyala / Tümünü seç" menüsü çıkmasın. */
    var oyunKok = document.getElementById('pg-room');
    if (oyunKok) oyunKok.addEventListener('contextmenu', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('input,textarea,[contenteditable],.chat-msgs')) return;
      e.preventDefault();
    });
    /* Oda başlığındaki düğmeler (Ses, Tam Ekran, Kurallar...) tıklanınca
       odak bırakılır: oyun tuşları (boşluk/enter) yanlışlıkla onlara basmasın. */
    document.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('#pg-room .gr-actions button') : null;
      if (b) setTimeout(function () { try { b.blur(); } catch (_) {} }, 0);
    }, true);
    window.addEventListener('resize', planla);
    window.addEventListener('orientationchange', function () { setTimeout(planla, 200); });
    setInterval(uygula, 1000);
    uygula();
  }

  window.GVFsDuzen = { uygula: uygula };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kur, { once: true });
  else kur();
})();
