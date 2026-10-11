/* ============================================================================
 * GEZİNTİ — TARAYICI GERİ/İLERİ TUŞU
 * ============================================================================
 * HATA (kullanıcı raporu): "Tüm oyunlarda sayfada geri gele bastığımda hesap
 * silmesi sayfası açılıyor."
 *
 * SEBEBİ: site tek sayfalı (SPA) ama hiçbir sayfa geçişi tarayıcı geçmişine
 * KAYIT BIRAKMIYORDU. Ana sayfa → Oyunlar → lobi → masa yolculuğunun tamamı
 * tek bir geçmiş adımıydı. Bu yüzden GERİ tuşu siteyi tamamen terk edip
 * kullanıcının index.html'den ÖNCE açtığı belgeye dönüyordu — gizlilik ya da
 * hesap-silme sayfasından "Siteye dön" ile gelen herkes GERİ'ye basınca o
 * sayfaya geri düşüyordu.
 *
 * ÇÖZÜMÜ: her iç sayfa geçişi geçmişe bir adım bırakır; GERİ tuşu önce
 * SİTENİN İÇİNDE geri gider (masa → lobi → oyunlar → ana sayfa) ve ancak
 * ana sayfadayken bir kez daha basılırsa siteden çıkılır.
 *
 * MASADAN ÇIKIŞ: masada GERİ'ye basmak "Ayrıl" ile aynı yoldan geçer
 * (guardNavigation): maç sürüyorsa önce terk uyarısı çıkar. Kullanıcı
 * vazgeçerse adım geri konur, masada kalınır — yani GERİ tuşu maçı sessizce
 * terk ettiremez.
 *
 * Bu dosya index.html'in fonksiyonlarını DEĞİŞTİRMEZ, yalnız sarmalar;
 * böylece sayfa mantığı tek yerde kalır.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__gvGezintiLoaded) return;
  window.__gvGezintiLoaded = true;

  var ANAHTAR = 'gv-gezinti';
  var geriGidiyor = false;      // popstate işlenirken yeni adım ekleme
  var hazir = false;

  function S() { try { return (typeof st !== 'undefined') ? st : null; } catch (_) { return null; } }
  function GVx() { return window.GV || null; }

  /* O anki görünümün özeti. Masada oda kimliği de tutulur ki ileri tuşu
     aynı masaya dönebilsin. */
  function simdikiDurum() {
    var s = S();
    var d = { gv: ANAHTAR, page: (s && s.curPage) || 'home' };
    if (d.page === 'lobby' || d.page === 'room') d.game = (s && s.curGame) || null;
    if (d.page === 'room') {
      d.room = window.__gvActiveRoomId ||
        (s && s.roomWaitingState && s.roomWaitingState.room && s.roomWaitingState.room.id) || null;
    }
    return d;
  }
  function ayniMi(a, b) {
    if (!a || !b) return false;
    return a.page === b.page && String(a.game || '') === String(b.game || '') &&
           String(a.room || '') === String(b.room || '');
  }

  /* Görünüm değiştikten SONRA çağrılır: geçmişe bir adım bırakır. */
  function adimBirak() {
    if (!hazir || geriGidiyor) return;
    var yeni = simdikiDurum();
    var simdi = history.state;
    if (simdi && simdi.gv === ANAHTAR && ayniMi(simdi, yeni)) return;   // aynı görünüm
    try { history.pushState(yeni, '', location.pathname + location.search); } catch (_) {}
  }

  /* Bir fonksiyonu sarmala: çalıştıktan sonra geçmişe adım bırak. */
  function sarmala(nesne, ad) {
    if (!nesne || typeof nesne[ad] !== 'function' || nesne[ad].__gvGezinti) return;
    var eski = nesne[ad];
    var yeni = function () {
      var r = eski.apply(this, arguments);
      /* Görünüm değişimi guardNavigation yüzünden iptal edilmiş olabilir;
         bu yüzden adımı DURUMA bakarak bırakıyoruz, çağrıya değil. */
      setTimeout(adimBirak, 0);
      return r;
    };
    yeni.__gvGezinti = true;
    nesne[ad] = yeni;
  }

  /* --------------------------------------------------------------- GERİ */
  function hedefeGit(d) {
    var gv = GVx();
    if (!gv) return;
    if (d.page === 'room') {
      /* Masaya DÖNÜLMEZ: oda terk edildiyse sunucuda koltuk kalmamıştır,
         "ileri" ile boş bir masaya düşmek kafa karıştırır. Lobiye alınır. */
      if (typeof gv.openLobby === 'function') gv.openLobby(d.game || undefined);
      return;
    }
    if (d.page === 'lobby') {
      if (typeof gv.openLobby === 'function') gv.openLobby(d.game || undefined);
      return;
    }
    if (typeof gv.page === 'function') gv.page(d.page || 'home');
  }

  window.addEventListener('popstate', function (e) {
    var s = S();
    var hedef = (e.state && e.state.gv === ANAHTAR) ? e.state : { gv: ANAHTAR, page: 'home' };
    var oncekiSayfa = s && s.curPage;

    geriGidiyor = true;
    try {
      if (oncekiSayfa === 'room') {
        /* Masadan GERİ: "Ayrıl" ile aynı yol. Maç sürüyorsa guardNavigation
           onay ister; kullanıcı vazgeçerse masada kalırız ve attığımız adımı
           geri koyarız (yoksa bir sonraki GERİ siteden atardı). */
        var gv = GVx();
        if (gv && typeof gv.leaveRoom === 'function') gv.leaveRoom();
        else hedefeGit(hedef);
        setTimeout(function () {
          var s2 = S();
          if (s2 && s2.curPage === 'room') {
            /* Çıkış iptal edildi → adımı geri koy, masada kal. */
            try { history.pushState(simdikiDurum(), '', location.pathname + location.search); } catch (_) {}
          }
          geriGidiyor = false;
        }, 0);
        return;
      }
      hedefeGit(hedef);
    } finally {
      if (oncekiSayfa !== 'room') setTimeout(function () { geriGidiyor = false; }, 0);
    }
  });

  /* --------------------------------------------------------------- KURULUM */
  function kur() {
    var gv = GVx();
    if (!gv) return false;
    sarmala(gv, 'page');
    sarmala(gv, 'openLobby');
    sarmala(gv, 'joinRoom');
    sarmala(gv, 'leaveRoom');
    sarmala(gv, 'exitToLobby');
    /* Taban adım: ilk GERİ sitenin içinde kalsın diye bir "ana sayfa"
       adımı bırakılır. Adres çubuğu değişmez. */
    try {
      if (!history.state || history.state.gv !== ANAHTAR) {
        history.replaceState({ gv: ANAHTAR, page: 'home' }, '', location.pathname + location.search);
      }
    } catch (_) {}
    hazir = true;
    adimBirak();
    return true;
  }

  if (!kur()) {
    /* GV henüz tanımlı değilse (betik sırası) kısa aralıklarla dene. */
    var deneme = 0;
    var t = setInterval(function () {
      if (kur() || ++deneme > 60) clearInterval(t);
    }, 100);
  }

  /* Test/teşhis köprüsü */
  window.__gvGezinti = {
    durum: simdikiDurum,
    adimBirak: adimBirak,
    hazir: function () { return hazir; }
  };
})();
