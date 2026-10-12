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
  /* Hamle günlüğü: yeni olaylar sağ paneldeki "Hamleler"e yazılır; mobilde
     tahtanın ortasında SABİT boyutlu küçük bir şeritte son 5 olay görünür. */
  var gorulenGunluk = null, tikerKayit = [];
  var TIKER_SATIR = 5, TIKER_OMUR_MS = 10000;
  /* Piyon animasyonu: gösterilen konum hedefe KARE KARE yaklaşır. */
  var piyonGoster = {}, piyonHedef = {}, piyonDongu = null, piyonBaslama = 0, piyonHazir = false;
  var PIYON_ADIM_MS = 120, aktifKok = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uyar(t, tur) { try { if (window.GV && GV.toast) GV.toast(t, tur || 'info'); } catch (_) {} }
  function ses(ad) { try { if (window.GVDeniz && GVDeniz.ses) GVDeniz.ses.cal(ad); } catch (_) {} }
  function adOfTam(seat) {
    try {
      var r = window.__gvActiveRoom || (window.st && st.roomWaitingState && st.roomWaitingState.room);
      var p = r && (r.players || []).find(function (x) { return x.seat === seat; });
      if (p && p.name) return p.name;
    } catch (_) {}
    return 'Koltuk ' + (seat + 1);
  }
  var adOf = adOfTam;
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
  /* UYARLANIR ÇERÇEVE: üst/alt kenarda C kare, yan kenarlarda R kare
     (C + R = 18, köşeler dahil 40 kare). Masaüstü/yatayda C = R = 9 (klasik
     tahta). Dar (telefon dikey) ekranda üst/alt kareler 30 px'e düşüp kare
     adı YATAY sığmıyordu; orada C küçülür, yan sütunlar uzar ve her ad
     soldan sağa okunur. Sıra yine saat yönünün tersidir; 0 sağ alt köşe. */
  function yerHesapla(i, C, R) {
    var k1 = C + 1, k2 = C + R + 2, k3 = 2 * C + R + 3;
    if (i <= k1) return { r: R + 2, c: C + 2 - i, kenar: 'alt', kose: i === 0 || i === k1 };
    if (i <= k2) return { r: R + 2 - (i - k1), c: 1, kenar: 'sol', kose: i === k2 };
    if (i <= k3) return { r: 1, c: 1 + (i - k2), kenar: 'ust', kose: i === k3 };
    return { r: 1 + (i - k3), c: C + 2, kenar: 'sag', kose: false };
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
      h += '<div class="mp-piyon' + (bekleyenP === o.seat ? ' sirada' : '') + '" data-seat="' + o.seat + '" data-kare="' + i + '" style="grid-row:' +
           (rc[0] + 1) + ';grid-column:' + (rc[1] + 1) + ';--mp-dx:' + (n % 2) + ';--mp-dy:' +
           Math.floor(n / 2) + ';background:' + PIYON_RENK[s.seats.indexOf(o.seat) % 4] + '">' +
           PIYON_SIM[s.seats.indexOf(o.seat) % 4] + '</div>';
    });
    /* ORTA ALAN. Gerçek tahtada burası boştur; biz geniş ekranda KONTROL
       PANELİNİ buraya taşıyoruz (bkz. bind → panelYerlestir). Böylece tahta
       ekranın tüm genişliğini kullanabiliyor ve hiçbir yere boşluk kalmıyor. */
    h += '<div class="mp-orta">' +
         '<div class="mp-orta-ust"><div class="mp-logo">METROPOL</div>' + ortaHtml(s) + '</div>' +
         '<div class="mp-orta-yuva"></div>' + tikerHtml() + '</div>';
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
    if (s.havuz !== null && s.havuz !== undefined && s.havuz > 0) {
      h += '<div class="mp-havuz">🅿️ Park havuzu: ' + para(s.havuz) + '</div>';
    }
    return h;
  }
  /* Sunucu günlüğü makine okunur ("kira:1:0:28"); burada Türkçeleşir. */
  function gunlukMetni(s, g, kisa) {
    var pr = String(g).split(':');
    var adOf = kisa ? function (seat) { return PIYON_SIM[s.seats.indexOf(seat) % 4] || '•'; } : adOfTam;
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

  /* ------------------ HAMLE GÜNLÜĞÜ ------------------ */
  function kayitEkle(tam, kisa, eski) {
    try {
      var el = document.getElementById('moveHist');
      if (el) {
        el.insertAdjacentHTML('beforeend', '<div class="mv"><span>' + (el.children.length + 1) + '.</span><span>' + esc(tam) + '</span></div>');
        el.scrollTop = el.scrollHeight;
      }
    } catch (_) {}
    tikerKayit.push({ m: kisa, t: eski ? 0 : Date.now() });
    if (tikerKayit.length > 30) tikerKayit.shift();
  }
  function gunlukYaz(s) {
    var simdi = (s.gunluk || []).slice();
    var yeni, ilk = gorulenGunluk === null;
    if (ilk) yeni = simdi;
    else {
      var k = Math.min(gorulenGunluk.length, simdi.length);
      for (; k > 0; k--) {
        if (gorulenGunluk.slice(-k).join('\u0001') === simdi.slice(0, k).join('\u0001')) break;
      }
      yeni = simdi.slice(k);
    }
    gorulenGunluk = simdi;
    yeni.forEach(function (g) { kayitEkle(gunlukMetni(s, g), gunlukMetni(s, g, true), ilk); });
  }
  function tikerHtml() {
    var simdi = Date.now();
    var liste = tikerKayit.filter(function (k) { return simdi - k.t < TIKER_OMUR_MS + 400; }).slice(-TIKER_SATIR);
    return '<div class="mp-tiker" aria-hidden="true">' + liste.map(function (k, i) {
      var yas = simdi - k.t;
      var yeni = i === liste.length - 1 && yas < 600;
      return '<div class="mp-tk' + (yeni ? ' yeni' : '') + '" style="animation-delay:' + (yeni ? '0s,' : '') + '-' + yas + 'ms">' +
             esc(k.m) + '</div>';
    }).join('') + '</div>';
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
        ses('zar');
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
        if (sonZarAnahtar !== null) {
          /* Yeni atış: Hamleler'e yazılır, piyon zar görüldükten SONRA yürür. */
          piyonBaslama = Date.now() + 900;
          var atan = (s.oyuncular || []).filter(function (o) { return o.seat === s.turn; })[0];
          var hedefKare = atan && s.kareler[atan.konum];
          var zt = s.zar[0] + '-' + s.zar[1] + (hedefKare ? ' → ' + hedefKare.ad : '');
          kayitEkle(adOfTam(s.turn) + ' 🎲 ' + zt, (PIYON_SIM[s.seats.indexOf(s.turn) % 4] || '') + ' 🎲 ' + zt);
        }
        sonZarAnahtar = zarAnahtar;
      } else if (sonZarAnahtar === null) sonZarAnahtar = zarAnahtar;

      gunlukYaz(s);
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
      /* MOBİL (dokunmatik, dar) — yalnız telefon/küçük tablet; masaüstüne dokunmaz. */
      function mobilMi() {
        try {
          return !!(window.matchMedia && window.matchMedia('(pointer:coarse)').matches && (window.innerWidth || 0) <= 1000);
        } catch (_) { return false; }
      }
      function oyuncuYerlestir(fs, mobilYatay) {
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
        if ((fs || yanda || mobilYatay) && yan) {
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
      /* YAZI ÖLÇÜMÜ: kelime genişliği GERÇEK yazı tipiyle canvas'ta ölçülür
         (100 px'te bir kez, sonra orantılanır). Canvas yoksa (jsdom) tahmin.
         ⚠ CSS min()/clamp() kullanılmaz (jsdom'u bozuyor, bkz. index.html). */
      var olcer = { ctx: null, aile: null, bellek: {} };
      try { olcer.ctx = document.createElement('canvas').getContext('2d'); } catch (_) { olcer.ctx = null; }
      function gen(k, f) {
        if (!olcer.ctx) return k.length * f * 0.72;
        if (olcer.bellek[k] === undefined) {
          olcer.ctx.font = '800 100px ' + olcer.aile;
          olcer.bellek[k] = olcer.ctx.measureText(k).width / 100;
        }
        return olcer.bellek[k] * f;
      }
      /* Kelimeler w genişliğinde satırlara dizilip (fiyatla birlikte) h
         yüksekliğine sığacak EN BÜYÜK punto. Kelime asla ortadan bölünmez. */
      function puntoBul(kelimeler, fiyatVar, w, h, fMax) {
        for (var f = fMax; f >= 6; f -= 0.25) {
          if (kelimeler.some(function (k) { return gen(k, f) > w; })) continue;
          var satir = 1, uz = 0;
          for (var j = 0; j < kelimeler.length; j++) {
            var l = gen(kelimeler[j], f);
            if (uz === 0) uz = l;
            else if (uz + f * 0.28 + l <= w) uz += f * 0.28 + l;
            else { satir++; uz = l; }
          }
          if (satir * f * 1.1 + (fiyatVar ? f * 0.82 * 1.25 : 0) <= h) return { f: f, ok: true };
        }
        return { f: 6, ok: false };
      }
      /* Bir karenin yazı kutusu (dolgu ve renk bandı düşülmüş). */
      function kutu(y, d, bantVar) {
        if (y.kose) {
          var yatayBant = bantVar && (y.kenar === 'alt' || y.kenar === 'ust');
          return { w: d.Dx * (bantVar && !yatayBant ? 0.80 : 1) - 14, h: (yatayBant ? d.D * 0.76 : d.D) - 10, g: 'kose' };
        }
        if (y.kenar === 'ust' || y.kenar === 'alt') return { w: d.Wt - 9, h: d.D * 0.76 - 13, g: 'ust' };
        return { w: d.Dx * 0.80 - 8, h: d.Hs - 8, g: 'yan' };
      }
      /* Aday çerçevenin ölçüleri. */
      function duzenAday(C, G, Y, ortada, kompakt, yanOran, bhZorla) {
        var R = 18 - C, BW = G, BH;
        if (C === 9) {
          BH = ortada ? Y : Math.min(Y * 0.8, G * 1.6);
          var oranUst = kompakt ? 2.4 : 1.95, oranAlt = kompakt ? 0.6 : (ortada ? 0.82 : 0.62);
          if (BW / BH > oranUst) BW = BH * oranUst;
          if (BW / BH < oranAlt) BH = BW / oranAlt;
        } else {
          BH = ortada ? Y : Math.min(Y * 0.96, G * 2.1);
        }
        if (bhZorla) BH = bhZorla;
        var D = Math.round(Math.min(BW, BH) * (kompakt ? 0.135 : 0.108));
        D = Math.max(22, Math.min(D, 96));
        var genisTahta = BW / BH >= 1.15;
        var Dx = genisTahta ? Math.round(Math.max(D, Math.min(BW * (yanOran || (kompakt ? 0.095 : 0.088)), 150)))
                            : Math.round(Math.max(D, BW * (C === 9 ? 0.2 : yanOran)));
        if (!genisTahta) D = Math.round(Math.max(D, Math.min(BW * 0.15, 72)));
        return { C: C, R: R, BW: BW, BH: BH, D: D, Dx: Dx,
                 Wt: (BW - 2 * Dx) / C, Hs: (BH - 2 * D) / R };
      }
      /* Her aday için tüm karelerin puntosu hesaplanır; EN KÜÇÜK puntosu en
         büyük olan çerçeve seçilir (klasik 9×9 okunur kalıyorsa o tercih). */
      function duzenSec(kareler, G, Y, ortada, kompakt, dikeyMobil) {
        var adaylar = [[9, 0]];
        if (dikeyMobil) {
          /* DİKEY TELEFON: en sıkı (kısa) tahta, yazı ≥ ~9.5 px kalsın.
             Aday: yan sütun genişliği × tahta yüksekliği. */
          adaylar = [];
          [2, 3, 4].forEach(function (C) {
            [0.2, 0.23, 0.26, 0.29, 0.32, 0.35, 0.38].forEach(function (o) {
              [1.45, 1.55, 1.65, 1.75, 1.85, 2.0, 2.2].forEach(function (bh) { adaylar.push([C, o, G * bh]); });
            });
          });
        }
        if (G < Y * 0.9) [8, 7, 6, 5, 4, 3, 2].forEach(function (C) {
          [0.22, 0.26, 0.3, 0.34, 0.38].forEach(function (o) { adaylar.push([C, o]); });
        });
        /* Basık yatay ekran (telefon yatay tam ekran): yan kareler alçak
           kalıyorsa yan sütunlar genişler; gerekirse üst/alta 1-3 kare
           daha alınıp yan sütunlar kısalır. */
        if (G > Y * 1.3 && Y < 520) [9, 10, 11, 12].forEach(function (C) {
          [0.11, 0.13, 0.15].forEach(function (o) { adaylar.push([C, o]); });
        });
        var enIyi = null;
        adaylar.forEach(function (a) {
          var d = duzenAday(a[0], G, Y, ortada, kompakt, a[1], a[2]);
          if (d.Wt < 18 || d.Hs < 18) return;
          if (dikeyMobil && (d.BW - 2 * d.Dx < 116 || d.BH - 2 * d.D < 300)) return;   // orta alan zar+şerit sığsın
          var enKucuk = 99, sonuc = [];
          kareler.forEach(function (k) {
            var y = yerHesapla(k.i, d.C, d.R);
            var b = kutu(y, d, k.bant);
            var fMax = Math.min(18, d.D * 0.24, b.g === 'yan' ? d.Hs * 0.5 : 99);
            var p = puntoBul(k.kelimeler, k.fiyatVar, b.w, b.h, fMax);
            if (!p.ok) p.f = 5;
            enKucuk = Math.min(enKucuk, p.f);
            sonuc.push({ k: k, y: y, f: p.f, ok: p.ok, g: b.g });
          });
          d.puan = enKucuk; d.sonuc = sonuc;
          if (!enIyi) { enIyi = d; return; }
          if (dikeyMobil) {
            var HEDEF = 8.5, dOk = d.puan >= HEDEF, eOk = enIyi.puan >= HEDEF;
            if (dOk && !eOk) enIyi = d;
            else if (dOk && eOk) { if (d.BH < enIyi.BH - 1 || (Math.abs(d.BH - enIyi.BH) <= 1 && d.puan > enIyi.puan + 0.2)) enIyi = d; }
            else if (!dOk && !eOk && d.puan > enIyi.puan + 0.2) enIyi = d;
            return;
          }
          if (enIyi.C === 9 && enIyi.puan >= 9) return;           // klasik tahta yeterince okunur
          if (d.puan > enIyi.puan + 0.2) enIyi = d;
        });
        return enIyi;
      }
      function duzenUygula(tahta, d) {
        var C = d.C, R = d.R;
        tahta.style.gridTemplateColumns = d.Dx + 'px repeat(' + C + ',' + d.Wt + 'px) ' + d.Dx + 'px';
        tahta.style.gridTemplateRows = d.D + 'px repeat(' + R + ',' + d.Hs + 'px) ' + d.D + 'px';
        tahta.style.setProperty('--mp-d', d.D + 'px');
        tahta.style.setProperty('--mp-yan', d.Dx + 'px');
        tahta.style.setProperty('--mp-wt', d.Wt + 'px');
        tahta.style.setProperty('--mp-hs', d.Hs + 'px');
        tahta.classList.add('yan-yatay');
        tahta.classList.remove('ust-dik');
        tahta.classList.toggle('uyarli', C !== 9);
        var enDar = Math.min(d.D, d.Wt * 1.3, d.Hs * 1.3, d.Dx);
        tahta.style.setProperty('--mp-pyn', Math.round(Math.max(12, enDar * 0.36)) + 'px');
        tahta.style.setProperty('--mp-bf', Math.round(Math.max(8, Math.min(d.D * 0.19, d.Wt * 0.22, d.Hs * 0.3))) + 'px');
        tahta.style.width = Math.round(2 * d.Dx + C * d.Wt) + 'px';
        tahta.style.height = Math.round(2 * d.D + R * d.Hs) + 'px';
        var orta = tahta.querySelector('.mp-orta');
        if (orta) { orta.style.gridRow = '2 / ' + (R + 2); orta.style.gridColumn = '2 / ' + (C + 2); }
        piyonYerlestir(tahta, C, R);
        /* Aynı kenardaki kareler eşit görünsün: kenarın ortanca puntosu tavan. */
        var gruplar = {};
        d.sonuc.forEach(function (x) { (gruplar[x.g] = gruplar[x.g] || []).push(x.f); });
        var tavan = {};
        Object.keys(gruplar).forEach(function (g) {
          var a = gruplar[g].sort(function (p, q) { return p - q; });
          tavan[g] = a[Math.floor(a.length / 2)] * 1.06;
        });
        d.sonuc.forEach(function (x) {
          var el = x.k.el, y = x.y;
          el.style.gridRow = y.r; el.style.gridColumn = y.c;
          ['alt', 'sol', 'ust', 'sag'].forEach(function (kn) { el.classList.toggle('kenar-' + kn, kn === y.kenar); });
          el.classList.toggle('kose', y.kose);
          /* Köşeye düşen renkli mülkte bant yazının üstüne binmesin. */
          el.style.padding = '';
          if (y.kose && x.k.bant) {
            if (y.kenar === 'alt') el.style.paddingTop = (d.D * 0.24) + 'px';
            else if (y.kenar === 'ust') el.style.paddingBottom = (d.D * 0.24) + 'px';
            else if (y.kenar === 'sol') el.style.paddingRight = '20%';
          }
          var f = Math.min(x.f, tavan[x.g]);
          x.k.ad.style.fontSize = f + 'px';
          x.k.ad.classList.toggle('kir', !x.ok);
          if (x.k.fiyat) x.k.fiyat.style.fontSize = Math.max(6, Math.min(f * 0.82, 14)) + 'px';
        });
      }
      function olcuYaz() {
        var odaEl = document.getElementById('pg-room');
        var fs = !!(odaEl && odaEl.classList.contains('gv-fs'));
        var mobil = mobilMi() && !fs;
        var yatayEkran = (window.innerWidth || 0) > (window.innerHeight || 0);
        var mobilYatay = mobil && yatayEkran, mobilDikey = mobil && !yatayEkran;
        oyuncuYerlestir(fs, mobilYatay);
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
        /* MOBİL standart pencere: sayfa zaten aşağı kayar, bu yüzden tahta
           görünen yüksekliğe SIKIŞTIRILMAZ. Yatayda klasik oran (genişliğin
           ~%62'si), dikeyde uzun isimler 2 satıra sığsın diye genişliğin
           ~2.2 katı kadar yükseklik verilir. */
        if (mobilYatay) Y = Math.max(Y, Math.round(G * 0.62));
        if (mobilDikey) Y = Math.round(G * 2.0);
        var genis = G >= 900 && Y >= 430;
        /* KOMPAKT: tam ekran ama alan dar (telefon). Tahta TÜM alanı alır,
           panel yine tahtanın ortasına girer ama sadeleşir: zar + düğmeler
           + mülkler; zarlar atıştan sonra kaybolur. */
        var kompakt = (fs || mobil) && !genis;
        var ortada = genis || kompakt;
        /* ⚠ Sınıf .mp-wrap'a yazılır, root'a DEĞİL: arena bind'e #boardArea'yı
           veriyor; sınıf oraya yazılınca .mp-wrap.genis kuralları hiç
           tutmuyordu (panel ortaya taşınıyor ama koyu zemin yazı rengiyle
           okunmaz kalıyordu). */
        var sarmal = root.querySelector('.mp-wrap') || root;
        sarmal.classList.toggle('genis', genis);
        sarmal.classList.toggle('kompakt', kompakt);
        sarmal.classList.toggle('dar', !ortada);
        sarmal.classList.toggle('dikey', mobilDikey);
        sarmal.classList.toggle('mobil', mobilMi());
        panelYerlestir(ortada);

        var tahta = root.querySelector('.mp-tahta');
        if (tahta) {
          /* Karelerin adları/fiyatları bir kez toplanır, sonra adaylar denenir. */
          var kareler = [];
          tahta.querySelectorAll('.mp-kare').forEach(function (el) {
            var ad = el.querySelector('.mp-ad'), fiyat = el.querySelector('.mp-fiyat');
            if (!ad) return;
            if (olcer.aile === null) { try { olcer.aile = getComputedStyle(ad).fontFamily || 'sans-serif'; } catch (_) { olcer.aile = 'sans-serif'; } }
            kareler.push({ el: el, i: Number(el.getAttribute('data-kare')), ad: ad, fiyat: fiyat,
              fiyatVar: !!(fiyat && fiyat.textContent), bant: !!el.querySelector('.mp-bant'),
              kelimeler: String(ad.textContent || '').split(/\s+/).filter(Boolean) });
          });
          var duz = duzenSec(kareler, G, Y, ortada, kompakt, mobilDikey);
          if (duz) duzenUygula(tahta, duz);
          root.__mpDuzen = duz;
        }
        /* Açık bilgi kartı varsa yeni ölçüye göre yeniden konumlansın. */
        if (acikKart !== null) {
          var kp = document.getElementById('mpKartPop');
          var kk = root.querySelector('.mp-kare[data-kare="' + acikKart + '"]');
          if (kp && kk) kartKonumla(kp, kk);
        }
      }
      olcuYaz();
      piyonKur(root);
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


  /* ------------------ PİYON ANİMASYONU ------------------
     Sunucu piyonu doğrudan hedef kareye koyar; burada ekranda gösterilen
     konum hedefe kare kare yaklaşır (zar atıldıktan sonra hızlandırılmış
     yürüyüş). Cezaevine gidiş/geri gitme gibi uzun sıçrayışlar direkt olur. */
  function piyonYerlestir(tahta, C, R) {
    if (!tahta) return;
    var sayac = {};
    tahta.querySelectorAll('.mp-piyon[data-seat]').forEach(function (p) {
      var sd = p.getAttribute('data-seat');
      var kare = piyonGoster[sd] != null ? piyonGoster[sd] : Number(p.getAttribute('data-kare'));
      var y = yerHesapla(kare, C, R);
      var n = sayac[kare] = (sayac[kare] || 0);
      sayac[kare]++;
      p.style.gridRow = y.r; p.style.gridColumn = y.c;
      p.style.setProperty('--mp-dx', n % 2);
      p.style.setProperty('--mp-dy', Math.floor(n / 2));
    });
  }
  function piyonGuncelle() {
    var tahta = aktifKok && aktifKok.querySelector ? aktifKok.querySelector('.mp-tahta') : null;
    var d = aktifKok && aktifKok.__mpDuzen;
    if (tahta && d) piyonYerlestir(tahta, d.C, d.R);
  }
  function piyonAdimla() {
    piyonDongu = null;
    if (!aktifKok || !document.body.contains(aktifKok)) return;
    var bekle = Date.now() < piyonBaslama, ilerledi = false, kalan = false;
    Object.keys(piyonHedef).forEach(function (sd) {
      if (piyonGoster[sd] === piyonHedef[sd]) return;
      if (!bekle) { piyonGoster[sd] = (piyonGoster[sd] + 1) % 40; ilerledi = true; }
      if (piyonGoster[sd] !== piyonHedef[sd]) kalan = true;
    });
    if (ilerledi) { piyonGuncelle(); ses('piyonAdim'); }
    var bekleyen = Object.keys(piyonHedef).some(function (sd) { return piyonGoster[sd] !== piyonHedef[sd]; });
    if (bekleyen || kalan) piyonDongu = setTimeout(piyonAdimla, bekle ? 60 : PIYON_ADIM_MS);
  }
  function piyonKur(kok) {
    aktifKok = kok;
    var yeniHedef = {};
    kok.querySelectorAll('.mp-piyon[data-seat]').forEach(function (p) {
      var sd = p.getAttribute('data-seat'), h = Number(p.getAttribute('data-kare'));
      yeniHedef[sd] = h;
      if (piyonGoster[sd] == null || !piyonHazir) { piyonGoster[sd] = h; return; }
      var ileri = (h - piyonGoster[sd] + 40) % 40;
      if (ileri > 13) piyonGoster[sd] = h;           // sıçrayış: kare kare yürütme
    });
    piyonHedef = yeniHedef;
    piyonHazir = true;
    piyonGuncelle();
    var bekleyen = Object.keys(piyonHedef).some(function (sd) { return piyonGoster[sd] !== piyonHedef[sd]; });
    if (bekleyen && !piyonDongu) piyonDongu = setTimeout(piyonAdimla, 60);
  }

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
    gorulenGunluk = null; tikerKayit = [];
    piyonGoster = {}; piyonHedef = {}; piyonHazir = false; piyonBaslama = 0;
    if (piyonDongu) { clearTimeout(piyonDongu); piyonDongu = null; }
    oyuncuYuvasiniSil();
  });
  window.__gvMetropol = { kart: function () { return sonKart; } };
})();
