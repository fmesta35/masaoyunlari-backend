/* ============================================================================
 * MASA OYLAMASI — "eksik kişiyle devam edelim mi?"
 * ============================================================================
 * Kullanıcı isteği: 3-4 kişilik bir masada biri çıkarsa yerini o EL boyunca
 * bot sürdürür; el bitince masadaki herkese oylama sunulur. Devam oylanırsa
 * kalan kişi sayısının kurallarıyla oynanmaya devam edilir, oylama geçmezse
 * herkes lobiye döner.
 *
 * Karar sunucuda (server.js → masaOylamasi*). Burası yalnız pencereyi çizip
 * oyu iletiyor; sayaç da sunucunun bildirdiği bitiş anından hesaplanıyor,
 * yani iki taraf aynı süreyi görüyor.
 * ========================================================================= */
(function () {
  'use strict';
  var KUTU = 'masaOylamaKutu';
  var sonVeri = null, sayacInt = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function soket() {
    return window.__gvRoomSocket || window.__gvChessSocket || null;
  }
  function kapat() {
    if (sayacInt) { clearInterval(sayacInt); sayacInt = null; }
    sonVeri = null;
    var ov = document.getElementById(KUTU);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  function kalanSn() {
    if (!sonVeri) return 0;
    return Math.max(0, Math.round((sonVeri.bitis - Date.now()) / 1000));
  }

  function ciz() {
    var v = sonVeri;
    if (!v) return;
    var ov = document.getElementById(KUTU);
    if (!ov) {
      ov = document.createElement('div');
      ov.id = KUTU;
      ov.className = 'mo-ov';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) {
        var b = e.target.closest('[data-oy]');
        if (!b) return;
        var s = soket();
        if (s) s.emit('masaOyla', { roomId: v.roomId, evet: b.getAttribute('data-oy') === 'evet' });
        // Oy verdikten sonra pencere beklemede kalır; sonuç sunucudan gelir.
        var alt = ov.querySelector('.mo-dugmeler');
        if (alt) alt.innerHTML = '<div class="mo-bekle">Oyun verildi — diğer oyuncular bekleniyor…</div>';
      });
    }
    var kim = (v.ayrilanlar || []).map(esc).join(', ') || 'Bir oyuncu';
    var h = '<div class="mo-kutu">';
    h += '<div class="mo-bas">👋 Masada eksik var</div>';
    h += '<p class="mo-metin"><b>' + kim + '</b> masadan ayrıldı. Bu el yerine yapay zekâ oynadı.</p>';
    h += '<p class="mo-metin"><b>' + v.yeniKisi + ' kişiyle</b> devam edilsin mi? Devam edilirse ' +
         v.yeniKisi + ' kişilik kurallarla yeni el başlar.</p>';
    if (v.isSpectator) {
      h += '<div class="mo-bekle">Oyuncular karar veriyor…</div>';
    } else if (v.senOyVerdin) {
      h += '<div class="mo-bekle">Oyun verildi — diğer oyuncular bekleniyor…</div>';
    } else {
      h += '<div class="mo-dugmeler">' +
           '<button type="button" class="mo-hayir" data-oy="hayir">Lobiye Dön</button>' +
           '<button type="button" class="mo-evet" data-oy="evet">Devam Et</button>' +
           '</div>';
    }
    h += '<div class="mo-alt"><span id="moSayac">' + kalanSn() + ' sn</span>' +
         '<span>' + (v.oyVerenler || []).length + ' / ' + v.gereken + ' kabul</span></div>';
    h += '<div class="mo-not">Yanıt verilmezse masa dağılır ve herkes lobiye döner.</div>';
    h += '</div>';
    ov.innerHTML = h;

    if (sayacInt) clearInterval(sayacInt);
    sayacInt = setInterval(function () {
      var el = document.getElementById('moSayac');
      if (!el) return;
      el.textContent = kalanSn() + ' sn';
      if (kalanSn() <= 0) { clearInterval(sayacInt); sayacInt = null; }
    }, 500);
  }

  function bagla(s) {
    if (!s || s.__moBagli) return;
    s.__moBagli = true;
    s.on('masaOylamasi', function (v) { sonVeri = v; ciz(); });
    s.on('masaOylamaSonucu', function (v) {
      kapat();
      if (!window.GV || !GV.toast) return;
      if (v && v.devam) GV.toast('✅ ' + v.yeniKisi + ' kişiyle devam ediliyor.', 'success', 5000);
      else GV.toast('🚪 Masa dağıldı — lobiye dönülüyor.', 'info', 5000);
    });
    // Oda kapanırsa pencere ekranda kalmasın.
    s.on('gameEnded', kapat);
    s.on('roomLeft', kapat);
  }

  // Soket sayfa yüklendikten SONRA kuruluyor; göründüğünde bağlan.
  setInterval(function () { bagla(soket()); }, 700);
  window.GVMasaOylama = { kapat: kapat };
})();
