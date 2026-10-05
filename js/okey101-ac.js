/* ============================================================================
 * 101 OKEY — EL AÇMA PENCERESİ
 * ============================================================================
 * Açma, masa üstünde yapılamayacak kadar çok adımlı: oyuncu birden fazla per
 * kurup toplamı en az 101'e taşımak zorunda. Istakada tek tek seçmeye
 * çalışmak hem telefonda hem webde karışıyordu; bu yüzden kendi penceresi
 * var:  taşa dokun → per sepetine düşer → "Peri Bitir" → sıradakini kur →
 * "Aç". Toplam puan canlı yazıyor, yani oyuncu 101'e ulaşıp ulaşmadığını
 * GÖNDERMEDEN önce görüyor.
 *
 * Buradaki puan yalnız YARDIMCI. Kuralın tamamı sunucuda (okey101-engine.js)
 * sınanıyor: taş gerçekten oyuncuda mı, perler geçerli mi, toplam 101'e
 * ulaşıyor mu. Pencere yanılsa bile sunucu yanlış açılışı reddeder.
 * ========================================================================= */
(function () {
  'use strict';
  var KUTU_ID = 'ok101AcKutu';
  var durum = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function okeyMi(t, ok) { return !!(ok && t && !t.isFJ && t.c === ok.c && t.n === ok.n); }
  function renkSinifi(t) { return t.isFJ ? (t.dc || 't-red') : t.c; }

  function tasHtml(t, ok, secili) {
    return '<button type="button" class="ok101a-t ' + renkSinifi(t) +
      (okeyMi(t, ok) ? ' is-okey' : '') + (secili ? ' sec' : '') +
      '" data-id="' + esc(t.id) + '"><b>' + (t.n || '') + '</b><i></i></button>';
  }

  function ciz() {
    var k = document.getElementById(KUTU_ID);
    if (!k || !durum) return;
    var d = durum;
    var kalan = d.eller.filter(function (t) { return d.kullanilan.indexOf(t.id) === -1; });
    var toplam = d.perler.reduce(function (a, p) { return a + d.puanla(p); }, 0);
    var sepetPuan = d.sepet.length ? d.puanla(d.sepet) : 0;
    var yeter = d.cift ? (d.perler.length >= d.ciftAdedi) : (toplam >= d.acmaPuani);

    var h = '';
    h += '<div class="ok101a-bas">';
    h += '<b>' + (d.cift ? '👯 Çift Açma' : '🎴 El Aç') + '</b>';
    h += '<button type="button" class="ok101a-x" data-act="kapat">✕</button>';
    h += '</div>';

    h += '<div class="ok101a-kip">';
    h += '<button type="button" class="ok101a-sek' + (d.cift ? '' : ' etkin') + '" data-act="kip-per">Perle aç (en az ' + d.acmaPuani + ')</button>';
    h += '<button type="button" class="ok101a-sek' + (d.cift ? ' etkin' : '') + '" data-act="kip-cift">' + d.ciftAdedi + ' çiftle aç</button>';
    h += '</div>';

    h += '<div class="ok101a-ozet' + (yeter ? ' tamam' : '') + '">';
    h += d.cift
      ? ('Hazır çift: <b>' + d.perler.length + ' / ' + d.ciftAdedi + '</b>')
      : ('Toplam: <b>' + toplam + '</b> / ' + d.acmaPuani + (yeter ? ' ✓' : ''));
    h += '</div>';

    // Kurulan perler
    h += '<div class="ok101a-perler">';
    if (!d.perler.length) {
      h += '<div class="ok101a-bos">Henüz ' + (d.cift ? 'çift' : 'per') + ' kurmadın</div>';
    }
    d.perler.forEach(function (p, i) {
      h += '<div class="ok101a-per"><span class="ok101a-per-no">' + (i + 1) + '</span>';
      p.forEach(function (t) { h += tasHtml(t, d.realOkey, false); });
      if (!d.cift) h += '<span class="ok101a-per-p">' + d.puanla(p) + '</span>';
      h += '<button type="button" class="ok101a-geri" data-act="per-sil" data-i="' + i + '" title="Bu peri boz">↩</button>';
      h += '</div>';
    });
    h += '</div>';

    // Kurulmakta olan per (sepet)
    h += '<div class="ok101a-sepet' + (d.sepet.length ? ' dolu' : '') + '">';
    h += '<span class="ok101a-et">' + (d.cift ? 'ÇİFT' : 'PER') + '</span>';
    if (!d.sepet.length) h += '<span class="ok101a-ipucu">Aşağıdan taş seç</span>';
    d.sepet.forEach(function (t) { h += tasHtml(t, d.realOkey, true); });
    if (!d.cift && d.sepet.length) h += '<span class="ok101a-per-p">' + sepetPuan + '</span>';
    h += '<button type="button" class="ok101a-ok" data-act="per-bitir"' +
         (d.sepet.length < (d.cift ? 2 : 3) ? ' disabled' : '') + '>' +
         (d.cift ? 'Çifti Bitir' : 'Peri Bitir') + '</button>';
    h += '</div>';

    // Elde kalan taşlar
    h += '<div class="ok101a-el">';
    kalan.forEach(function (t) { h += tasHtml(t, d.realOkey, false); });
    h += '</div>';

    h += '<div class="ok101a-alt">';
    h += '<span class="ok101a-not">Açtıktan sonra atacak en az bir taşın kalmalı.</span>';
    h += '<button type="button" class="ok101a-ac" data-act="gonder"' + (yeter ? '' : ' disabled') + '>Aç</button>';
    h += '</div>';

    k.innerHTML = h;
  }

  function tiklama(e) {
    var d = durum;
    if (!d) return;
    var t = e.target.closest('[data-act], .ok101a-t');
    if (!t) return;
    var act = t.getAttribute('data-act');

    if (act === 'kapat') return kapat();
    if (act === 'kip-per' || act === 'kip-cift') {
      d.cift = (act === 'kip-cift');
      d.perler = []; d.sepet = []; d.kullanilan = [];
      return ciz();
    }
    if (act === 'per-bitir') {
      if (d.sepet.length < (d.cift ? 2 : 3)) return;
      d.perler.push(d.sepet.slice());
      d.sepet = [];
      return ciz();
    }
    if (act === 'per-sil') {
      var i = Number(t.getAttribute('data-i'));
      var p = d.perler.splice(i, 1)[0] || [];
      p.forEach(function (x) {
        var j = d.kullanilan.indexOf(x.id);
        if (j !== -1) d.kullanilan.splice(j, 1);
      });
      return ciz();
    }
    if (act === 'gonder') {
      var gruplar = d.perler.map(function (p) { return p.map(function (x) { return x.id; }); });
      if (!gruplar.length) return;
      d.gonder(gruplar, d.cift);
      return kapat();
    }

    // Taşa dokunma: sepete al / sepetten çıkar
    var id = t.getAttribute('data-id');
    if (!id) return;
    var sepette = d.sepet.findIndex(function (x) { return x.id === id; });
    if (sepette !== -1) {
      d.sepet.splice(sepette, 1);
      var j2 = d.kullanilan.indexOf(id);
      if (j2 !== -1) d.kullanilan.splice(j2, 1);
      return ciz();
    }
    if (d.kullanilan.indexOf(id) !== -1) return;   // kurulmuş bir perde
    var tas = d.eller.find(function (x) { return x.id === id; });
    if (!tas) return;
    d.sepet.push(tas);
    d.kullanilan.push(id);
    ciz();
  }

  function kapat() {
    durum = null;
    var ov = document.getElementById(KUTU_ID + 'Ov');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function ac(secenek) {
    kapat();
    durum = {
      eller: (secenek.eller || []).slice(),
      realOkey: secenek.realOkey,
      acmaPuani: Number(secenek.acmaPuani) || 101,
      ciftAdedi: Number(secenek.ciftAdedi) || 5,
      puanla: secenek.puanla || function () { return 0; },
      gonder: secenek.gonder || function () {},
      cift: false,
      perler: [],
      sepet: [],
      kullanilan: []
    };
    var ov = document.createElement('div');
    ov.id = KUTU_ID + 'Ov';
    ov.className = 'ok101a-ov';
    var kutu = document.createElement('div');
    kutu.id = KUTU_ID;
    kutu.className = 'ok101a-kutu';
    ov.appendChild(kutu);
    ov.addEventListener('click', function (e) { if (e.target === ov) kapat(); });
    kutu.addEventListener('click', tiklama);
    document.body.appendChild(ov);
    ciz();
  }

  window.GVOkey101Ac = { ac: ac, kapat: kapat };
})();
