/* ============================================================================
 * METROPOL — ONLINE İSTEMCİ (ortak yaşam döngüsü adaptörü)
 * ============================================================================
 * Tahta 11×11'lik bir çerçeve: 40 kare kenarlara dizilir, orta alan bilgi
 * paneline kalır. Kare listesini, sahiplik/bina durumunu ve oyuncuların
 * parasını SUNUCU gönderir (metropol-engine.js → gorunum); istemci kendi
 * kopyasını TUTMAZ — çizim ile kural asla ayrı düşemez.
 *
 * ZAR, KART, KİRA ve İFLAS hesabı sunucudadır. İstemci yalnız niyet yollar:
 * metropolRoll / metropolBuy / metropolDecline / metropolBuild /
 * metropolSell / metropolMortgage / metropolBail / metropolJailCard /
 * metropolEndTurn.
 *
 * ÖLÇEK: tahta her zaman KAREdir; kare boyu (--mp-k) JS'te ölçülen alandan
 * hesaplanır, böylece hem masaüstünde hem telefonda taşmadan sığar.
 * Saat `.gv-arena-clock` içine yazılır — HTML'e saniye GİRMEZ, yoksa her
 * saniye yeniden çizim olur ve düğme dokunuşları kaybolurdu.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvMetropolLoaded) return;
  window.__gvMetropolLoaded = true;

  var N = 11;                 // 11×11 çerçeve: 40 kare kenarlarda
  var acikGrup = null;        // sağ panelde açık duran mülk grubu
  var sonKart = null;
  /* Son zar atışının anahtarı ve zamanı. KOMPAKT (telefon tam ekran)
     düzende zarlar tahtanın ortasında yalnız atış beklenirken ve atıştan
     sonraki birkaç saniye görünür, sonra kaybolur (bkz. render). */
  var sonZarAnahtar = null, sonZarZaman = 0;
  var ZAR_GORUNME_MS = 2600;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }
  function ses(ad) { try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal(ad); } catch (_) {} }
  function adOf(seat) {
    try {
      var r = window.__gvActiveRoom || (window.st && st.roomWaitingState && st.roomWaitingState.room);
      var p = r && (r.players || []).find(function (x) { return x.seat === seat; });
      if (p && p.name) return p.name;
    } catch (_) {}
    return 'Koltuk ' + (seat + 1);
  }
  function para(n) {
    /* Binlik ayracı: 1500 → "1.500₺". Oyuncu rakamı bir bakışta okusun. */
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '₺';
  }
  var PIYON_RENK = ['#e23b3b', '#2f7de0', '#1fae57', '#e8b322'];
  var PIYON_SIM = ['🚗', '🎩', '🐕', '🚢'];

  /* 40 kareyi 11×11 çerçeveye yerleştir. 0 = sağ alt köşe (KALKIŞ), sayma
     saat yönünün TERSİNE (prototipteki gibi): alt kenar sağdan sola, sonra
     sol kenar aşağıdan yukarıya, üst kenar soldan sağa, sağ kenar yukarıdan
     aşağıya. */
  function kareYeri(i) {
    if (i <= 10) return [N - 1, N - 1 - i];        // alt kenar
    if (i <= 20) return [N - 1 - (i - 10), 0];     // sol kenar
    if (i <= 30) return [0, i - 20];               // üst kenar
    return [i - 30, N - 1];                        // sağ kenar
  }
  function kenarOf(i) {
    return i <= 10 ? 'alt' : i <= 20 ? 'sol' : i <= 30 ? 'ust' : 'sag';
  }

  function kareIc(s, k, d) {
    var h = '';
    var renk = k.g ? (s.grupRenkleri || {})[k.g] : null;
    if (renk) h += '<div class="mp-bant" style="background:' + renk + '"></div>';
    h += '<div class="mp-ad">' + esc(kisaAd(k)) + '</div>';
    if (k.t === 'mulk' || k.t === 'gar' || k.t === 'idare') {
      h += '<div class="mp-fiyat">' + (d && d.sahip !== null ? '' : para(k.p)) + '</div>';
    }
    if (d && d.sahip !== null) {
      h += '<div class="mp-sahip" style="background:' + PIYON_RENK[s.seats.indexOf(d.sahip) % 4] + '"></div>';
    }
    if (d && d.ev > 0) {
      h += '<div class="mp-bina">' + (d.ev >= 5 ? '🏨' : Array(d.ev + 1).join('🏠')) + '</div>';
    }
    if (d && d.ipotek) h += '<div class="mp-ipotek">📄</div>';
    return h;
  }
  function kisaAd(k) {
    if (k.t === 'go') return 'KALKIŞ';
    if (k.t === 'cezaevi') return 'CEZAEVİ';
    if (k.t === 'park') return 'PARK';
    if (k.t === 'cezaevineGit' || k.t === 'gocezaevi') return 'CEZAEVİNE GİT';
    if (k.t === 'sans') return 'ŞANS';
    if (k.t === 'fon') return 'FON';
    if (k.t === 'vergi') return 'VERGİ';
    return k.ad;
  }

  function tahtaHtml(s) {
    var h = '<div class="mp-tahta">';
    (s.kareler || []).forEach(function (k, i) {
      var rc = kareYeri(i);
      var d = (s.durum || [])[i] || {};
      var sinif = 'mp-kare k-' + k.t + ' kenar-' + kenarOf(i);
      if (i === 0 || i === 10 || i === 20 || i === 30) sinif += ' kose';
      if (s.satilik === i) sinif += ' satilik';
      h += '<div class="' + sinif + '" data-kare="' + i + '" style="grid-row:' +
           (rc[0] + 1) + ';grid-column:' + (rc[1] + 1) + '">' + kareIc(s, k, d) + '</div>';
    });
    /* Piyonlar: aynı karede birden fazla piyon olabilir, yan yana dizilir. */
    var sayac = {};
    (s.oyuncular || []).forEach(function (o) {
      if (o.iflas) return;
      var i = o.konum;
      sayac[i] = (sayac[i] || 0);
      var rc = kareYeri(i);
      var n = sayac[i]++;
      var bekleyenP = (s.faz === 'teklif' && s.teklif) ? s.teklif.seat : s.turn;
      h += '<div class="mp-piyon' + (bekleyenP === o.seat ? ' sirada' : '') + '" style="grid-row:' +
           (rc[0] + 1) + ';grid-column:' + (rc[1] + 1) + ';--mp-dx:' + (n % 2) + ';--mp-dy:' +
           Math.floor(n / 2) + ';background:' + PIYON_RENK[s.seats.indexOf(o.seat) % 4] + '">' +
           PIYON_SIM[s.seats.indexOf(o.seat) % 4] + '</div>';
    });
    /* ORTA ALAN. Gerçek tahtada burası boştur; biz geniş ekranda KONTROL
       PANELİNİ buraya taşıyoruz (bkz. bind → panelYerlestir). Böylece tahta
       ekranın tüm genişliğini kullanabiliyor ve hiçbir yere boşluk kalmıyor. */
    h += '<div class="mp-orta">' +
         '<div class="mp-orta-ust"><div class="mp-logo">METROPOL</div>' + ortaHtml(s) + '</div>' +
         '<div class="mp-orta-yuva"></div></div>';
    h += '</div>';
    return h;
  }

  /* ===================================================================
     KARE BİLGİ KARTI — bir kareye tıklanınca/dokununca açılan minik
     pencere: fiyat, kira kademeleri, bina maliyeti, ipotek, sahip.
     Pencere #pg-room'un içine eklenir (tam ekranda da görünsün diye) ve
     tahta yeniden çizildiğinde içeriği tazelenir (bkz. bind → kartTazele).
     =================================================================== */
  var acikKart = null;        // açık bilgi kartının kare indeksi
  function kartHtml(s, i) {
    var k = (s.kareler || [])[i];
    if (!k) return '';
    var d = (s.durum || [])[i] || {};
    var renk = k.g ? (s.grupRenkleri || {})[k.g] : null;
    var basRenk = renk || (k.t === 'sans' ? '#e8a81c' : k.t === 'fon' ? '#2a63d8'
                : k.t === 'vergi' ? '#c0392b' : k.t === 'gar' ? '#2d3436'
                : k.t === 'idare' ? '#00838f' : '#3b6b35');
    var ad = k.ad || kisaAd(k);
    if (k.t === 'sans') ad = 'ŞANS';
    if (k.t === 'fon') ad = 'TOPLULUK FONU';
    var h = '<div class="mp-kb-bas" style="background:' + basRenk + '">' +
      (k.g ? '<div class="mp-kb-grup">' + esc((s.grupAdlari || {})[k.g] || '') + ' grubu</div>' : '') +
      '<div class="mp-kb-ad">' + esc(ad) + '</div></div><div class="mp-kb-govde">';
    var satir = function (a, b, vurgu) {
      return '<div class="mp-kb-sat' + (vurgu ? ' vurgu' : '') + '"><span>' + a + '</span><b>' + b + '</b></div>';
    };
    if (k.t === 'mulk' && k.r) {
      h += satir('Fiyat', para(k.p));
      h += '<div class="mp-kb-ara">Kira</div>';
      h += satir('Arsa', para(k.r[0]), d.sahip !== null && d.ev === 0);
      h += satir('Grubun tamamı (binasız)', para(k.r[0] * 2));
      for (var e = 1; e <= 4; e++) h += satir(Array(e + 1).join('🏠') + ' ' + e + ' ev', para(k.r[e]), d.ev === e);
      h += satir('🏨 Otel', para(k.r[5]), d.ev >= 5);
      h += '<div class="mp-kb-ara"></div>';
      h += satir('Ev / otel maliyeti', para(k.b));
      h += satir('İpotek değeri', para(Math.floor(k.p / 2)));
    } else if (k.t === 'gar') {
      h += satir('Fiyat', para(k.p));
      h += '<div class="mp-kb-ara">Kira (sahibin gar sayısına göre)</div>';
      h += satir('1 gar', para(25)) + satir('2 gar', para(50)) + satir('3 gar', para(100)) + satir('4 gar', para(200));
      h += satir('İpotek değeri', para(Math.floor(k.p / 2)));
    } else if (k.t === 'idare') {
      h += satir('Fiyat', para(k.p));
      h += '<div class="mp-kb-ara">Kira (atılan zarın toplamı ×)</div>';
      h += satir('1 idare', 'zar × 4') + satir('2 idare', 'zar × 10');
      h += satir('İpotek değeri', para(Math.floor(k.p / 2)));
    } else if (k.t === 'vergi') {
      h += '<p class="mp-kb-not">Bu kareye gelen <b>' + para(k.a) + '</b> vergi öder.</p>';
    } else if (k.t === 'sans') {
      h += '<p class="mp-kb-not">Bu kareye gelen bir <b>Şans</b> kartı çeker: para kazanabilir, ödeyebilir ya da başka bir kareye gidebilir.</p>';
    } else if (k.t === 'fon') {
      h += '<p class="mp-kb-not">Bu kareye gelen bir <b>Topluluk Fonu</b> kartı çeker.</p>';
    } else if (k.t === 'go') {
      h += '<p class="mp-kb-not">Buradan her geçişte <b>' + para(s.maas || 200) + '</b> maaş alınır.</p>';
    } else if (k.t === 'cezaevi') {
      h += '<p class="mp-kb-not">Yalnızca ziyaret. Cezaevindeyseniz çift atarak, <b>' + para(s.kefalet || 50) + '</b> kefalet ödeyerek ya da çıkış kartıyla çıkarsınız.</p>';
    } else if (k.t === 'park') {
      h += '<p class="mp-kb-not">Ücretsiz park — burada hiçbir şey olmaz.' +
           (s.havuz ? ' Park havuzu: <b>' + para(s.havuz) + '</b>.' : '') + '</p>';
    } else {
      h += '<p class="mp-kb-not">Bu kareye gelen doğrudan <b>cezaevine</b> gider.</p>';
    }
    if (k.t === 'mulk' || k.t === 'gar' || k.t === 'idare') {
      var sahip = d.sahip === null || d.sahip === undefined ? null : d.sahip;
      h += '<div class="mp-kb-sahip">' + (sahip === null
        ? '🏷️ Satılık — henüz sahibi yok'
        : '<span class="mp-kb-nokta" style="background:' + PIYON_RENK[s.seats.indexOf(sahip) % 4] + '"></span>' +
          'Sahibi: <b>' + esc(adOf(sahip)) + '</b>' + (sahip === s.seat ? ' (siz)' : '') +
          (d.ev > 0 ? ' · ' + (d.ev >= 5 ? '🏨' : Array(d.ev + 1).join('🏠')) : '') +
          (d.ipotek ? ' · 📄 ipotekli' : '')) + '</div>';
    }
    return h + '</div>';
  }
  function kartKapat() {
    acikKart = null;
    var p = document.getElementById('mpKartPop');
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }
  /* Pencereyi tıklanan karenin yanına, ekranın içinde kalacak biçimde koy. */
  function kartKonumla(pop, kare) {
    if (!pop || !kare) return;
    var r = kare.getBoundingClientRect();
    var vw = window.innerWidth || 800, vh = window.innerHeight || 600;
    var pw = pop.offsetWidth || 240, ph = pop.offsetHeight || 260;
    var x = r.left + r.width / 2 - pw / 2;
    var y = r.bottom + 6;
    if (y + ph > vh - 6) y = r.top - ph - 6;              // altta yer yoksa üste
    if (y < 6) { y = Math.max(6, (vh - ph) / 2); x = r.right + 6 > vw - pw - 6 ? r.left - pw - 6 : r.right + 6; }
    x = Math.max(6, Math.min(x, vw - pw - 6));
    y = Math.max(6, Math.min(y, vh - ph - 6));
    pop.style.left = Math.round(x) + 'px';
    pop.style.top = Math.round(y) + 'px';
  }
  function kartAc(s, i, kare) {
    var oda = document.getElementById('pg-room') || document.body;
    var pop = document.getElementById('mpKartPop');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'mpKartPop';
      pop.className = 'mp-kb';
      pop.setAttribute('role', 'dialog');
      pop.addEventListener('click', function (e) {
        if (e.target.closest('.mp-kb-kapat')) kartKapat();
        e.stopPropagation();
      });
    }
    if (pop.parentNode !== oda) oda.appendChild(pop);
    acikKart = i;
    pop.innerHTML = '<button type="button" class="mp-kb-kapat" aria-label="Kapat">✕</button>' + kartHtml(s, i);
    kartKonumla(pop, kare);
  }
  /* Dışarı tıklayınca / Esc ile kapanır. Bir kez bağlanır. */
  document.addEventListener('click', function (e) {
    if (acikKart === null) return;
    if (e.target.closest && (e.target.closest('#mpKartPop') || e.target.closest('.mp-kare'))) return;
    kartKapat();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && acikKart !== null) kartKapat(); });

  function ortaHtml(s) {
    var h = '';
    if (s.sonKart && s.sonKart.metin) {
      h += '<div class="mp-kart ' + (s.sonKart.tur === 'sans' ? 'sans' : 'fon') + '">' +
           '<div class="mp-kart-bas">' + (s.sonKart.tur === 'sans' ? '🎲 ŞANS' : '🏛️ TOPLULUK FONU') + '</div>' +
           '<div class="mp-kart-metin">' + esc(s.sonKart.metin) + '</div></div>';
    }
    h += '<div class="mp-gunluk">' + (s.gunluk || []).slice(-6).map(function (g) {
      return '<div>' + esc(gunlukMetni(s, g)) + '</div>';
    }).join('') + '</div>';
    if (s.havuz !== null && s.havuz !== undefined && s.havuz > 0) {
      h += '<div class="mp-havuz">🅿️ Park havuzu: ' + para(s.havuz) + '</div>';
    }
    return h;
  }
  /* Sunucu günlüğü makine okunur ("kira:1:0:28"); burada Türkçeleşir. */
  function gunlukMetni(s, g) {
    var pr = String(g).split(':');
    var kareAd = function (i) { return ((s.kareler || [])[Number(i)] || {}).ad || ('#' + i); };
    switch (pr[0]) {
      case 'aldi':        return adOf(+pr[1]) + ' ' + kareAd(pr[2]) + ' aldı';
      case 'teklifAldi':  return adOf(+pr[1]) + ' teklifle ' + kareAd(pr[2]) + ' aldı';
      case 'kira':        return adOf(+pr[1]) + ' → ' + adOf(+pr[2]) + ' kira ' + para(pr[3]);
      case 'maas':        return adOf(+pr[1]) + ' maaş aldı';
      case 'bina':        return adOf(+pr[1]) + ' ' + kareAd(pr[2]) + ' bina ' + pr[3];
      case 'iflas':       return adOf(+pr[1]) + ' İFLAS etti';
      case 'cezaevi':     return adOf(+pr[1]) + ' cezaevine gitti';
      case 'vergi':       return adOf(+pr[1]) + ' vergi ödedi ' + para(pr[2]);
      case 'kart':        return adOf(+pr[1]) + ' ' + (pr[2] === 'sans' ? 'şans' : 'fon') + ' kartı çekti';
      case 'havuz':       return adOf(+pr[1]) + ' park havuzunu aldı ' + para(pr[2]);
      default:            return String(g);
    }
  }

  function oyuncularHtml(s) {
    /* Sırada görünen kişi: teklif turunda teklifin yapıldığı oyuncu,
       normalde zarı atacak oyuncu. Sunucu hamle saatini de ona işletiyor. */
    var bekleyen = (s.faz === 'teklif' && s.teklif) ? s.teklif.seat : s.turn;
    return '<div class="mp-oyuncular">' + (s.oyuncular || []).map(function (o) {
      var k = s.seats.indexOf(o.seat) % 4;
      return '<div class="mp-oy' + (bekleyen === o.seat ? ' sirada' : '') + (o.iflas ? ' iflas' : '') +
             (o.seat === s.seat ? ' ben' : '') + '">' +
             '<span class="mp-oy-sim" style="background:' + PIYON_RENK[k] + '">' + PIYON_SIM[k] + '</span>' +
             '<span class="mp-oy-ad">' + esc(adOf(o.seat)) + '</span>' +
             '<span class="mp-oy-para">' + para(o.para) + '</span>' +
             '<span class="mp-oy-varlik">varlık ' + para(o.varlik) + '</span>' +
             (o.cezaevi ? '<span class="mp-oy-ceza">🔒 ' + o.cezaTur + '/3</span>' : '') +
             (o.cikisKarti > 0 ? '<span class="mp-oy-kart">🎫' + o.cikisKarti + '</span>' : '') +
             (o.iflas ? '<span class="mp-oy-iflas">İFLAS</span>' : '') +
             '</div>';
    }).join('') + '</div>';
  }

  /* Oyuncunun kendi mülk listesi: bina kur / sat / ipotek düğmeleri burada. */
  function mulkPaneli(s, benim) {
    var benimKoltuk = s.seat;
    if (benimKoltuk === null || benimKoltuk === undefined) return '';
    var sahipli = (s.durum || []).filter(function (d) { return d.sahip === benimKoltuk; });
    if (!sahipli.length) return '<div class="mp-mulk bos">Henüz mülkünüz yok.</div>';
    var kur = s.kurulabilir || [];
    return '<div class="mp-mulk">' + sahipli.map(function (d) {
      var k = (s.kareler || [])[d.i] || {};
      var renk = k.g ? (s.grupRenkleri || {})[k.g] : '#888';
      return '<div class="mp-mulk-sat">' +
        '<span class="mp-mulk-bant" style="background:' + renk + '"></span>' +
        '<span class="mp-mulk-ad">' + esc(k.ad || '') + '</span>' +
        (d.ipotek ? '<span class="mp-mulk-ip">📄 ipotekli</span>'
                  : '<span class="mp-mulk-ev">' + (d.ev >= 5 ? '🏨' : d.ev ? Array(d.ev + 1).join('🏠') : '—') + '</span>') +
        (benim ? (
          (kur.indexOf(d.i) !== -1 ? '<button class="btn mini mp-kur" type="button" data-kare="' + d.i + '">+🏠 ' + para(k.b) + '</button>' : '') +
          (d.ev > 0 ? '<button class="btn mini secondary mp-sat" type="button" data-kare="' + d.i + '">-🏠</button>' : '') +
          '<button class="btn mini secondary mp-ipotek" type="button" data-kare="' + d.i + '">' +
            (d.ipotek ? 'İpoteği kaldır' : 'İpotek ' + para(Math.floor((k.p || 0) / 2))) + '</button>'
        ) : '') +
        '</div>';
    }).join('') + '</div>';
  }

  if (!window.GVArena && !window.__gvArenaQueue) window.__gvArenaQueue = { push: function () {} };
  var define = (window.GVArena && window.GVArena.define) || function (d) { window.__gvArenaQueue.push(d); };

  define({
    id: 'metropol',
    kinds: ['metropol'],
    reject: ['metropolRejected'],
    events: {
      metropolDice: function (p) {
        if (!p) return;
        ses('tasKoy');
        if (p.ucCift) uyar('🎲 Üçüncü çift — doğruca cezaevine!', 'warning');
        else if (p.cezaevinde) uyar('🔒 Çift gelmedi — cezaevinde kaldınız (' + (3 - (p.kalanHak || 0)) + '/3).', 'info');
        else if (p.cezadanCikti) uyar('🎉 Çift attınız — cezaevinden çıktınız!', 'success');
        else if (p.kefalet) uyar('💸 Üçüncü denemede çift gelmedi — 50₺ kefalet kesildi.', 'warning');
        else if (p.iflas) uyar('💀 Bir oyuncu iflas etti.', 'warning');
        else if (p.satilik) ses('kazandi');
      },
      metropolAction: function (p) {
        if (!p) return;
        if (p.eylem === 'al' || p.eylem === 'binaKur') ses('kazandi');
        else ses('tasKoy');
      },
      metropolTimeout: function (p) {
        if (!p) return;
        var ne = p.tur === 'zar' ? 'zarı sunucu attı'
               : p.tur === 'alir' ? 'kareyi sunucu aldı'
               : p.tur === 'reddeder' || p.tur === 'teklif' ? 'teklif reddedildi'
               : 'turu sunucu bitirdi';
        uyar('⏱ ' + (p.ad || 'Oyuncu') + ' süresini doldurdu — ' + ne + '.', 'warning');
      }
    },

    /* DAMGA: saniye GİRMEZ. Saat .gv-arena-clock ile güncellenir, yoksa her
       saniye yeniden çizim olur ve düğmeler tam basılırken kaybolurdu. */
    damga: function (m) {
      var s = m.state || {};
      return (s.status || '') + '#' + s.faz + '#' + s.turn + '#' + s.tur + '#' + (s.zar || []).join(',') +
        '#' + (s.durum || []).map(function (d) { return d.sahip + '/' + d.ev + '/' + (d.ipotek ? 1 : 0); }).join('|') +
        '#' + (s.oyuncular || []).map(function (o) { return o.para + '/' + o.konum + '/' + (o.cezaevi ? 1 : 0) + '/' + (o.iflas ? 1 : 0); }).join('|') +
        '#' + s.satilik + '#' + JSON.stringify(s.teklif || null) +
        '#' + (s.kurulabilir || []).join(',') + '#' + (s.gunluk || []).join(';') +
        '#' + JSON.stringify(s.sonKart || null) + '#' + acikGrup;
    },

    render: function (m) {
      var s = m.state || {};
      if (!s.seats || !s.kareler) return '<div class="mp-wrap"></div>';
      var benimSira = s.turn === s.seat && s.status === 'playing' && !m.isSpectator;
      var teklifBende = !!(s.teklif && s.teklif.seat === s.seat) && !m.isSpectator;
      var satilikKare = (s.satilik !== null && s.satilik !== undefined) ? s.kareler[s.satilik] : null;
      var teklifKare = s.teklif ? s.kareler[s.teklif.kare] : null;

      /* Yeni atış mı? Anahtar tur+sıra+zar+çift: aynı değerlerin art arda
         gelmesi (3-4 ardından yine 3-4) yeni atışı gizlemesin. */
      var zarAnahtar = (s.zar && s.zar[0]) ? (s.tur + '|' + s.turn + '|' + s.zar.join(',') + '|' + s.cift) : '';
      if (zarAnahtar && zarAnahtar !== sonZarAnahtar) {
        /* İlk çizimde (sayfa yenileme/yeniden bağlanma) eski atışı "yeni"
           saymayalım. */
        sonZarZaman = sonZarAnahtar === null ? 0 : Date.now();
        sonZarAnahtar = zarAnahtar;
      } else if (sonZarAnahtar === null) sonZarAnahtar = zarAnahtar;

      var h = '<div class="mp-wrap">';
      h += oyuncularHtml(s);
      h += '<div class="mp-alan">';
      h += '<div class="mp-sol">' + tahtaHtml(s) + '</div>';
      /* Dar ekranda panelin ineceği yer; geniş ekranda panel tahtanın
         ORTASINA taşınır (bkz. bind → panelYerlestir). */
      h += '<div class="mp-alt-yuva"></div>';
      h += '</div>';
      h += '<div class="mp-panel">';

      /* Durum satırı + saat */
      h += '<div class="mp-durum">' +
        (s.status !== 'playing' ? 'Maç bitti'
          : teklifBende ? '🏷️ ' + esc(teklifKare ? teklifKare.ad : '') + ' size teklif edildi'
          : benimSira ? (s.faz === 'zar' ? '🎲 Sıra sizde — zar atın'
                       : s.faz === 'karar' ? '🏷️ ' + esc(satilikKare ? satilikKare.ad : '') + ' — alır mısınız?'
                       : '✅ Turunuzu bitirebilirsiniz')
          /* TEKLİF turunda bekleyen kişi zarı atan DEĞİL, teklifin yapıldığı
             oyuncudur; masa kimi beklediğini doğru görsün. */
          : (s.faz === 'teklif' && s.teklif)
              ? '⏳ ' + esc(adOf(s.teklif.seat)) + ' teklifi değerlendiriyor'
          : '⏳ ' + esc(adOf(s.turn)) + ' oynuyor') +
        ' <span class="mp-sure">(<span class="gv-arena-clock">—</span>)</span></div>';

      h += '<div class="mp-tur">Tur ' + s.tur + (s.turLimiti ? ' / ' + s.turLimiti : '') + '</div>';
      /* Zar kutusunun KOMPAKT düzendeki görünürlüğü: atış bekleniyorsa sabit,
         atıştan hemen sonra ise kısa süre görünüp sönen bir animasyonla.
         Gecikme NEGATİF verilir ki araya giren yeniden çizimler animasyonu
         baştan başlatmasın. */
      var zarBekliyor = benimSira && s.faz === 'zar';
      var zarGecen = Date.now() - sonZarZaman;
      var zarSinif = zarBekliyor ? ' zar-goster'
                   : (zarAnahtar && zarGecen < ZAR_GORUNME_MS ? ' zar-yeni' : '');
      var zarStil = zarSinif === ' zar-yeni' ? ' style="animation-delay:-' + zarGecen + 'ms"' : '';
      h += '<div class="mp-zarlar' + zarSinif + '"' + zarStil + '>' +
        '<span class="mp-zar">' + (s.zar && s.zar[0] ? s.zar[0] : '—') + '</span>' +
        '<span class="mp-zar">' + (s.zar && s.zar[1] ? s.zar[1] : '—') + '</span>' +
        (s.cift > 0 ? '<span class="mp-cift">çift ' + s.cift + '/3</span>' : '') + '</div>';

      /* Düğmeler */
      var benKoltuk = s.seat, benOyuncu = (s.oyuncular || []).find(function (o) { return o.seat === benKoltuk; }) || {};
      h += '<div class="mp-dugmeler">';
      if (s.status === 'playing') {
        if (benimSira && benOyuncu.cezaevi) {
          h += '<button class="btn mp-at" type="button">🎲 ÇİFT DENE</button>';
          h += '<button class="btn secondary mp-kefalet" type="button">💸 Kefalet ' + para(s.kefalet) + '</button>';
          if (benOyuncu.cikisKarti > 0) {
            h += '<button class="btn secondary mp-cikis" type="button">🎫 Çıkış kartı kullan</button>';
          }
        } else if (benimSira && s.faz === 'zar') {
          h += '<button class="btn mp-at" type="button">🎲 ZAR AT</button>';
        } else if (benimSira && s.faz === 'karar' && satilikKare) {
          h += '<button class="btn mp-al" type="button">🏷️ ' + para(satilikKare.p) + ' — AL</button>';
          h += '<button class="btn secondary mp-reddet" type="button">Almayacağım</button>';
        } else if (teklifBende && teklifKare) {
          h += '<button class="btn mp-al" type="button">🏷️ ' + para(teklifKare.p) + ' — AL</button>';
          h += '<button class="btn secondary mp-reddet" type="button">Geç</button>';
        } else if (benimSira && s.faz === 'bitir') {
          h += '<button class="btn mp-bitir" type="button">✅ TURU BİTİR</button>';
        }
      }
      h += '</div>';

      var mulkYok = !(s.durum || []).some(function (d) { return d.sahip === s.seat; });
      h += '<div class="mp-mulk-bas' + (mulkYok ? ' bos' : '') + '">Mülkleriniz</div>';
      h += mulkPaneli(s, benimSira && (s.faz === 'zar' || s.faz === 'bitir'));
      h += '<div class="mp-ipucu">Grubun <b>tamamına</b> sahip olunca bina kurulur ve binalar <b>dengeli</b> yükselir. ' +
           'Nakit sıkıştığında bina satın ya da mülk ipotek edin — yetmezse sunucu otomatik tasfiye eder. ' +
           'Almadığınız kare diğer oyunculara <b>liste fiyatından tek tur</b> teklif edilir.</div>';
      h += '</div></div>';
      return h;
    },

    bind: function (root, m) {
      var s = m.state || {};
      function bagla(sinif, olay, veri) {
        root.querySelectorAll(sinif).forEach(function (b) {
          b.addEventListener('click', function () {
            m.emit(olay, veri ? veri(b) : {});
          });
        });
      }
      bagla('.mp-at', 'metropolRoll');
      bagla('.mp-al', 'metropolBuy');
      bagla('.mp-reddet', 'metropolDecline');
      bagla('.mp-bitir', 'metropolEndTurn');
      bagla('.mp-kefalet', 'metropolBail');
      bagla('.mp-cikis', 'metropolJailCard');
      bagla('.mp-kur', 'metropolBuild', function (b) { return { kare: Number(b.dataset.kare) }; });
      bagla('.mp-sat', 'metropolSell', function (b) { return { kare: Number(b.dataset.kare) }; });
      bagla('.mp-ipotek', 'metropolMortgage', function (b) { return { kare: Number(b.dataset.kare) }; });

      /* Kareye tıklama/dokunma → bilgi kartı. Aynı kareye tekrar basınca kapanır. */
      var tahtaEl = root.querySelector('.mp-tahta');
      if (tahtaEl) tahtaEl.addEventListener('click', function (e) {
        var kare = e.target.closest('.mp-kare');
        if (!kare) return;
        var i = Number(kare.getAttribute('data-kare'));
        if (acikKart === i) { kartKapat(); return; }
        kartAc(s, i, kare);
      });
      /* Durum değiştiyse (sahip, ev, ipotek) açık kartın içeriği güncellenir. */
      if (acikKart !== null) {
        var acikKare = root.querySelector('.mp-kare[data-kare="' + acikKart + '"]');
        if (acikKare) kartAc(s, acikKart, acikKare); else kartKapat();
      }

      /* ===================================================================
         ÖLÇÜ — TAHTA EKRANIN YATAYINI DOLDURUR
         ===================================================================
         Tahta mantıksal olarak hâlâ 11×11'dir (dört köşe kare KALKIŞ /
         CEZAEVİ / PARK / CEZAEVİNE GİT yerinde kalsın diye), ama hücreler
         KARE DEĞİLDİR: çerçeve derinliği (--mp-d) ile kenar hücrelerinin
         genişliği (--mp-wt) ve yüksekliği (--mp-hs) ayrı ayrı hesaplanır.
         Böylece tahta 1:1'e hapsolmadan ekranın en-boy oranına yayılır;
         geniş ekranda kare boyu neredeyse iki katına çıkar ve kare adları
         rahat okunur. (Eskiden tahta kareydi, yüksekliğe sıkışıyor ve
         yanında kocaman bir boşluk kalıyordu.)

         GENİŞ ekranda kontrol paneli tahtanın ORTASINA taşınır — gerçek
         tahtada da orası boştur ve böylece hiçbir piksel boşa gitmez.
         DAR ekranda panel tahtanın altına iner. */
      /* TAM EKRANDA oyuncu çipleri tahtanın üstünden alınıp YAN PANELE,
         puan tablosunun (Sen vs Rakip) üstüne taşınır: tahta o şeridin
         yüksekliği kadar dikeyde büyür. Tam ekrandan çıkınca geri döner.
         Yuva #boardArea'nın DIŞINDA olduğundan yeniden çizimde silinmez;
         bu yüzden her çizimde içi tazelenir. */
      function oyuncuYerlestir(fs) {
        var wrap = root.querySelector('.mp-wrap');
        if (!wrap) return;
        var oda = document.getElementById('pg-room');
        var yan = oda && oda.querySelector('.game-side');
        var yuva = document.getElementById('mpYanOyuncular');
        var oy = wrap.querySelector('.mp-oyuncular') || (yuva && yuva.querySelector('.mp-oyuncular'));
        /* Yan panel tahtanın SAĞINDA duruyorsa (masaüstü) ya da tam ekransa
           çipler oraya gider. Telefonda dikeyde yan panel tahtanın ALTINDA
           kalır; orada çipler tahtanın üstünde, tek satırda kalır. */
        var alanEl = document.getElementById('boardArea');
        var yanda = false;
        if (yan && alanEl && yan.offsetParent !== null) {
          var ra = alanEl.getBoundingClientRect(), ry = yan.getBoundingClientRect();
          yanda = ry.width > 0 && ry.left >= ra.right - 4;
        }
        if ((fs || yanda) && yan) {
          if (!yuva) { yuva = document.createElement('div'); yuva.id = 'mpYanOyuncular'; }
          if (yuva.parentNode !== yan) {
            var puan = yan.querySelector('.score-panel');
            var tim = yan.querySelector('.timers');
            var once = (puan && puan.parentNode === yan) ? puan
                     : (tim && tim.parentNode === yan) ? tim.nextSibling : yan.firstChild;
            yan.insertBefore(yuva, once || null);
          }
          if (oy && oy.parentNode !== yuva) { yuva.innerHTML = ''; yuva.appendChild(oy); }
        } else {
          if (oy && oy.parentNode !== wrap) wrap.insertBefore(oy, wrap.firstChild);
          if (yuva && yuva.parentNode) yuva.parentNode.removeChild(yuva);
        }
      }
      function panelYerlestir(genis) {
        var panel = root.querySelector('.mp-panel');
        var yuva = root.querySelector(genis ? '.mp-orta-yuva' : '.mp-alt-yuva');
        if (panel && yuva && panel.parentNode !== yuva) yuva.appendChild(panel);
      }
      /* HER KAREYE AYRI YAZI BOYU: kare adındaki EN UZUN KELİME tek satıra
         sığacak, satırlar da (fiyatla birlikte) karenin yüksekliğine
         sığacak en büyük punto seçilir. Böylece "BAKIRKÖY" → "BAKIRKO Y"
         gibi kelime ortasından kırılma olmaz, kısa adlar da büyük yazılır.
         ⚠ CSS min()/clamp() kullanılmaz (jsdom'u bozuyor, bkz. index.html). */
      function yaziSigdir(tahta, D, Dx, Wt, Hs, yanYatay, ustDik) {
        var KAR = 0.72;       // ölçüm yoksa: kalın büyük harf ortalama genişliği (em)
        /* Kelime genişliği GERÇEK yazı tipiyle canvas'ta ölçülür (100 px'te
           bir kez, sonra orantılanır). Canvas yoksa (jsdom) tahmine düşer. */
        var ctx = null, aile = null, olcu = {}, gruplar = {};
        try { ctx = (yaziSigdir.c = yaziSigdir.c || document.createElement('canvas')).getContext('2d'); } catch (_) { ctx = null; }
        function gen(k, f) {
          if (!ctx) return k.length * f * KAR;
          if (olcu[k] === undefined) { ctx.font = '800 100px ' + aile; olcu[k] = ctx.measureText(k).width / 100; }
          return olcu[k] * f;
        }
        tahta.querySelectorAll('.mp-kare').forEach(function (kare) {
          var adEl = kare.querySelector('.mp-ad');
          if (!adEl) return;
          var fiyatEl = kare.querySelector('.mp-fiyat');
          var fiyatVar = !!(fiyatEl && fiyatEl.textContent);
          var kose = kare.classList.contains('kose');
          var yan = kare.classList.contains('kenar-sol') || kare.classList.contains('kenar-sag');
          var w, h;
          if (kose) { w = Dx - 6; h = D - 6; }
          else if (!yan && ustDik) { w = D * 0.76 - 5; h = Wt - 4; }   // döndürülmüş üst/alt
          else if (!yan) { w = Wt - 5; h = D * 0.76 - 3; }
          else if (yanYatay) { w = Dx * 0.80 - 6; h = Hs - 4; }
          else { w = Hs - 5; h = D * 0.76 - 4; }    // döndürülmüş yazı
          if (aile === null) { try { aile = getComputedStyle(adEl).fontFamily || 'sans-serif'; } catch (_) { aile = 'sans-serif'; } }
          var kelimeler = String(adEl.textContent || '').split(/\s+/).filter(Boolean);
          w -= 2;   // yuvarlama/kenarlık payı
          var fMax = Math.min(18, D * 0.24, kose ? D * 0.22 : 99);
          var f = fMax, sigdi = false;
          for (; f >= 6; f -= 0.25) {
            var tasti = kelimeler.some(function (k) { return gen(k, f) > w; });
            if (tasti) continue;
            /* Kelimeleri satırlara diz. */
            var satir = 1, uz = 0;
            kelimeler.forEach(function (k) {
              var l = gen(k, f);
              if (uz === 0) uz = l;
              else if (uz + f * 0.28 + l <= w) uz += f * 0.28 + l;
              else { satir++; uz = l; }
            });
            var yuk = satir * f * 1.1 + (fiyatVar ? f * 0.82 * 1.25 : 0);
            if (yuk <= h) { sigdi = true; break; }
          }
          if (!sigdi) f = 6;
          var grup = kose ? 'kose' : yan ? 'yan' : 'ust';
          (gruplar[grup] = gruplar[grup] || []).push({ ad: adEl, fiyat: fiyatEl, f: f, kir: !sigdi });
        });
        /* AYNI KENARDAKİ kareler göze eşit görünsün: hiçbir kare kendi
           kenarının ortanca puntosundan büyük yazılmaz (kısa adlar — "ŞİŞLİ",
           "FON" — tek başına kocaman olmasın). Uzun adlar zaten küçüktür. */
        Object.keys(gruplar).forEach(function (g) {
          var liste = gruplar[g];
          var sirali = liste.map(function (x) { return x.f; }).sort(function (a, b) { return a - b; });
          var tavan = sirali[Math.floor(sirali.length / 2)] * 1.06;
          liste.forEach(function (x) {
            var f = Math.min(x.f, tavan);
            x.ad.style.fontSize = f + 'px';
            x.ad.classList.toggle('kir', x.kir);
            if (x.fiyat) x.fiyat.style.fontSize = Math.max(6, Math.min(f * 0.82, 14)) + 'px';
          });
        });
      }
      function olcuYaz() {
        var odaEl = document.getElementById('pg-room');
        var fs = !!(odaEl && odaEl.classList.contains('gv-fs'));
        oyuncuYerlestir(fs);
        var alan = document.getElementById('boardArea');
        var r = alan ? alan.getBoundingClientRect() : { width: 1000, height: 640 };
        var oy = root.querySelector('.mp-oyuncular');
        var pay = (oy ? oy.getBoundingClientRect().height : 0) + 26;
        var G = Math.max(260, r.width);
        /* ⚠ Kullanılabilir YÜKSEKLİK, #boardArea'nın kendi yüksekliği DEĞİL:
           o kutu sayfanın altından taşabiliyor ve tahtanın son sırası ekranın
           dışında kalıyordu. Görünen alanla sınırla. */
        var gorunen = (window.innerHeight || 700) - r.top - 12;
        var Y = Math.max(240, Math.min(r.height || 640, gorunen) - pay);

        /* Panel ortaya ancak yeterli yer varsa girer: orta alan 9 hücre
           genişliğinde ve 9 hücre yüksekliğindedir, bu da en az ~420×300
           piksel ister. Altında kalırsa panel okunmaz hâle gelirdi. */
        var genis = G >= 900 && Y >= 430;
        /* KOMPAKT: tam ekran ama alan dar (telefon). Tahta TÜM alanı alır,
           panel yine tahtanın ortasına girer ama sadeleşir: zar + düğmeler
           + mülkler; zarlar atıştan sonra kaybolur. */
        var kompakt = fs && !genis;
        var ortada = genis || kompakt;
        /* ⚠ Sınıf .mp-wrap'a yazılır, root'a DEĞİL: arena bind'e #boardArea'yı
           veriyor; sınıf oraya yazılınca .mp-wrap.genis kuralları hiç
           tutmuyordu (panel ortaya taşınıyor ama koyu zemin yazı rengiyle
           okunmaz kalıyordu). */
        var sarmal = root.querySelector('.mp-wrap') || root;
        sarmal.classList.toggle('genis', genis);
        sarmal.classList.toggle('kompakt', kompakt);
        sarmal.classList.toggle('dar', !ortada);
        panelYerlestir(ortada);

        /* Dar ekranda tahta yüksekliğin yalnız bir kısmını alır (altında
           panel var); geniş ekranda tüm alanı kaplar. */
        /* Dar ekranda (telefon dikey) tahta altındaki panele yer bırakır ama
           eskisinden UZUNDUR: yan karelerin yüksekliği artar, dik yazılan
           kare adları sığar ("HARBİY E" gibi kırılmalar biter). */
        var BW = G, BH = ortada ? Y : Math.min(Y * 0.8, G * 1.6);
        /* En-boy oranını makul tut: çok yayvan tahta okunmaz olur. Telefon
           tam ekranında (kompakt) yatayda daha yayvan, dikeyde daha uzun
           tahtaya izin verilir: amaç ekranın EN GENİŞ kullanımı. */
        var oranUst = kompakt ? 2.4 : 1.95, oranAlt = kompakt ? 0.6 : (ortada ? 0.82 : 0.62);
        if (BW / BH > oranUst) BW = BH * oranUst;
        if (BW / BH < oranAlt) BH = BW / oranAlt;

        /* Çerçeve derinliği: gerçek tahtadaki gibi kenarın ~%10'u. */
        /* ÇERÇEVE ASİMETRİKTİR: üst/alt kenarın derinliği D, yan sütunların
           genişliği Dx. Yatay (geniş) tahtada yan karelerin yüksekliği azdır;
           eskiden bu karelerde yazı 90° döndürülüp 58 px'e sıkışıyordu
           ("HARBİY E"). Artık yan sütunlar daha geniştir ve yazı YATAY
           yazılır — okunur. Dikey/kare tahtada eski döndürülmüş düzen kalır. */
        var D = Math.round(Math.min(BW, BH) * (kompakt ? 0.135 : 0.108));
        D = Math.max(22, Math.min(D, 96));
        /* Yan sütunlarda yazı HER ZAMAN yataydır (masaüstündeki görünüm).
           Dikey/dar tahtada (telefon) yan sütunlar tahta genişliğinin ~%19'u
           olur; bu durumda üst/alt kareler daralır ve oradaki yazı DÖNDÜRÜLÜR
           (ustDik), çerçeve derinliği de buna göre artar. */
        var yanYatay = true;
        var genisTahta = BW / BH >= 1.15;
        var Dx = genisTahta ? Math.round(Math.max(D, Math.min(BW * (kompakt ? 0.095 : 0.088), 150)))
                            : Math.round(Math.max(D, BW * 0.18));
        var Wt = Math.max(16, (BW - 2 * Dx) / 9);
        var ustDik = Wt < 44;
        if (ustDik) {
          D = Math.round(Math.max(D, Math.min(BH * 0.15, 96)));
        }
        var Hs = Math.max(16, (BH - 2 * D) / 9);

        var tahta = root.querySelector('.mp-tahta');
        if (tahta) {
          tahta.style.setProperty('--mp-d', D + 'px');
          tahta.style.setProperty('--mp-yan', Dx + 'px');
          tahta.classList.toggle('yan-yatay', yanYatay);
          tahta.classList.toggle('ust-dik', ustDik);
          /* Piyon ve bina boyu en dar hücreye göre: dar üst/alt karelerde taşmasın. */
          var enDar = Math.min(D, Wt * 1.3, Hs * 1.3, Dx);
          tahta.style.setProperty('--mp-pyn', Math.round(Math.max(12, enDar * 0.36)) + 'px');
          tahta.style.setProperty('--mp-bf', Math.round(Math.max(8, Math.min(D * 0.19, Wt * 0.22, Hs * 0.3))) + 'px');
          tahta.style.setProperty('--mp-wt', Wt + 'px');
          tahta.style.setProperty('--mp-hs', Hs + 'px');
          /* Yazı boyları BURADA hesaplanır (CSS min() değil): kare adı hem
             çerçeve derinliğine hem de o kenardaki hücre uzunluğuna sığmalı.
             Üst/altta uzunluk GENİŞLİK, yanlarda YÜKSEKLİKtir. */
          var kucuk = function (a, b) { return Math.round(Math.min(a, b) * 10) / 10; };
          tahta.style.setProperty('--mp-ad-ust', kucuk(D * 0.20, Wt * 0.19) + 'px');
          tahta.style.setProperty('--mp-fi-ust', kucuk(D * 0.18, Wt * 0.17) + 'px');
          tahta.style.setProperty('--mp-ad-yan', kucuk(D * 0.20, Hs * 0.21) + 'px');
          tahta.style.setProperty('--mp-fi-yan', kucuk(D * 0.18, Hs * 0.19) + 'px');
          tahta.style.width = Math.round(2 * Dx + 9 * Wt) + 'px';
          tahta.style.height = Math.round(2 * D + 9 * Hs) + 'px';
          yaziSigdir(tahta, D, Dx, Wt, Hs, yanYatay, ustDik);
        }
        /* Açık bilgi kartı varsa yeni ölçüye göre yeniden konumlansın. */
        if (acikKart !== null) {
          var kp = document.getElementById('mpKartPop');
          var kk = root.querySelector('.mp-kare[data-kare="' + acikKart + '"]');
          if (kp && kk) kartKonumla(kp, kk);
        }
      }
      olcuYaz();
      requestAnimationFrame(olcuYaz);
      if (root.__mpOlcu) {
        window.removeEventListener('resize', root.__mpOlcu);
        window.removeEventListener('orientationchange', root.__mpOlcu);
      }
      root.__mpOlcu = function () { olcuYaz(); setTimeout(olcuYaz, 80); };
      /* Tam ekrana geçiş/çıkış: düzen sınıfı (gv-fs) olaydan bir kare sonra
         değişebiliyor; sınıf değişimini doğrudan izle. */
      aktifOlcu = root.__mpOlcu;
      gozcuKur();
      window.addEventListener('resize', root.__mpOlcu);
      window.addEventListener('orientationchange', root.__mpOlcu);
      if (window.visualViewport) {
        if (root.__mpVV) window.visualViewport.removeEventListener('resize', root.__mpVV);
        root.__mpVV = root.__mpOlcu;
        window.visualViewport.addEventListener('resize', root.__mpVV);
      }
      void s;
    }
  });

  var aktifOlcu = null, gozcu = null;
  function gozcuKur() {
    if (gozcu || typeof MutationObserver === 'undefined') return;
    var oda = document.getElementById('pg-room');
    if (!oda) return;
    var onceki = oda.classList.contains('gv-fs');
    gozcu = new MutationObserver(function () {
      var simdi = oda.classList.contains('gv-fs');
      if (simdi === onceki) return;
      onceki = simdi;
      if (aktifOlcu && document.querySelector('#boardArea .mp-wrap')) aktifOlcu();
      else oyuncuYuvasiniSil();
    });
    gozcu.observe(oda, { attributes: true, attributeFilter: ['class'] });
    /* Masada başka bir oyuna geçilirse (#boardArea yeniden çizilir, Metropol
       yoktur) yan paneldeki oyuncu çipleri artık kalmasın. */
    var alan = document.getElementById('boardArea');
    if (alan) new MutationObserver(function () {
      if (!alan.querySelector('.mp-wrap')) oyuncuYuvasiniSil();
    }).observe(alan, { childList: true });
  }
  function oyuncuYuvasiniSil() {
    var y = document.getElementById('mpYanOyuncular');
    if (y && y.parentNode) y.parentNode.removeChild(y);
  }
  window.addEventListener('gv:roomLeft', function () {
    acikGrup = null; sonKart = null; aktifOlcu = null;
    kartKapat();
    sonZarAnahtar = null; sonZarZaman = 0;
    oyuncuYuvasiniSil();
  });
  window.__gvMetropol = { kart: function () { return sonKart; } };
})();
