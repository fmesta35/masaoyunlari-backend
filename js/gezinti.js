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
  var izleyici = null;          // görünüm izleyicisinin zamanlayıcısı

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

  /* ⚠ SARMALAMA TEK BAŞINA YETMEZ. index.html'in kendi içinde `openLobby(...)`
     ve `page('room')` DOĞRUDAN çağrılıyor (maç bitince lobiye dönüş, masaya
     katılma vb.); bu çağrılar GV nesnesinin üzerinden geçmediği için sarmalanan
     kopyaya hiç uğramıyor ve geçmişe adım BIRAKILMIYORDU. Sonuç: oyuncu masaya
     girip GERİ'ye bastığında site tamamen terk ediliyor, "Siteye dön" ile
     gelinen gizlilik/hesap-silme sayfası açılıyordu.
     ÇÖZÜMÜ: görünümü İZLE. Sarmalayıcılar anında adım bırakmayı sürdürür
     (hızlı tepki), izleyici de kaçan her geçişi yakalar.
     İki ÜST ÜSTE aynı okunduğunda adım atılır; böylece geçiş sırasındaki
     yarım durumlar geçmişe yazılmaz. */
  var sonOkuma = null;
  function izleTik() {
    if (!hazir || geriGidiyor) return;
    var simdi = simdikiDurum();
    if (!ayniMi(simdi, sonOkuma)) { sonOkuma = simdi; return; }  // önce oturması beklenir
    adimBirak();
  }

  /* Bir fonksiyonu sarmala: çalıştıktan sonra geçmişe adım bırak. */
  function sarmala(nesne, ad) {
    if (!nesne || typeof nesne[ad] !== 'function' || nesne[ad].__gvGezinti) return;
    var eski = nesne[ad];
    var yeni = function () {
      var r = eski.apply(this, arguments);
      /* ⚠ ADIM SENKRON BIRAKILIR. Eskiden `setTimeout(adimBirak, 0)` vardı ve
         bu GERÇEK bir hataydı: index.html'in sayfa fonksiyonları st.curPage'i
         ZATEN senkron yazar, ama 0 ms'lik geri çağrı meşgul bir ana iş
         parçacığında (yavaş telefon, oyun açılışı, soket trafiği) BİR SONRAKİ
         geçişten SONRA çalışabiliyordu. O zaman adım yanlış görünümle
         yazılıyor ya da hiç yazılmıyordu — masaya girip GERİ'ye basan
         kullanıcı lobiye değil siteden dışarı düşüyordu.
         Görünüm değişimi guardNavigation ile iptal edilmişse adimBirak
         zaten DURUMA bakar ve aynı görünüm için adım atmaz. */
      adimBirak();
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
        /* sorma:true → bekleme odasından çıkarken "emin misin?" SORULMAZ.
           Geri tuşu zaten açık bir "geri dön" isteğidir; onay kutusu çıkınca
           kullanıcı masada kilitli kalıyordu (her GERİ bir kutu açıp hiçbir
           yere gitmiyordu). Maç sürüyorsa terk uyarısı yine çıkar. */
        if (gv && typeof gv.leaveRoom === 'function') gv.leaveRoom({ sorma: true });
        else hedefeGit(hedef);
        /* Çıkış sunucuya bildiriliyorsa lobiye geçiş ASENKRONdur; bu yüzden
           hemen değil, kısa bir süre sonra bakılır. Hâlâ masadaysak çıkış
           iptal edilmiş demektir (maç sürüyordu, kullanıcı vazgeçti) ve
           attığımız adım geri konur — yoksa bir sonraki GERİ siteden atardı. */
        setTimeout(function () {
          var s2 = S();
          if (s2 && s2.curPage === 'room') {
            /* Hâlâ masadayız. İKİ ayrı sebep olabilir, ayırt etmek şart:
               (a) MAÇ SÜRÜYOR ve kullanıcı terk uyarısında vazgeçti →
                   masada kalmak DOĞRU; attığımız adımı geri koyarız,
                   yoksa bir sonraki GERİ siteden atardı.
               (b) Maç yok ama çıkış sunucuya bildirilip lobiye geçiş
                   HİÇ GELMEDİ (soket yanıtı düşmüş/gecikmiş) → kullanıcı
                   masada KİLİTLİ kalır, geri tuşu "çalışmıyor" görünür.
                   Bu durumda lobiye kendimiz götürürüz. Geri tuşu
                   sunucunun yanıtına bağlı kalmamalı. */
            var macVar = false;
            try { macVar = !!(gv && typeof gv.hasActiveGame === 'function' && gv.hasActiveGame()); } catch (_) {}
            if (macVar) {
              try { history.pushState(simdikiDurum(), '', location.pathname + location.search); } catch (_) {}
            } else if (gv && typeof gv.openLobby === 'function') {
              var s3 = S();
              gv.openLobby((s3 && s3.curGame) || undefined);
            }
          }
          sonOkuma = simdikiDurum();
          geriGidiyor = false;
        }, 600);
        return;
      }
      hedefeGit(hedef);
    } finally {
      if (oncekiSayfa !== 'room') setTimeout(function () {
        sonOkuma = simdikiDurum();
        geriGidiyor = false;
      }, 0);
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
    sonOkuma = simdikiDurum();
    if (!izleyici) izleyici = setInterval(izleTik, 200);
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
    hazir: function () { return hazir; },
    /* Teşhis: GERİ işlenirken adım bırakma kapalıdır; kilitli kalırsa
       hiçbir geçiş geçmişe yazılmaz (gerçekten yaşanan bir hataydı). */
    gerideMi: function () { return geriGidiyor; },
    /* Testler zamanlayıcı beklemesin diye izleme adımı elle tetiklenebilir. */
    izleTik: function () { izleTik(); izleTik(); }
  };
})();
