/* ============================================================================
 * ONAY PENCERESİ — Android uygulamasında confirm() yerine
 * ============================================================================
 * Kullanıcı raporu: "Çoğu oyunda Pes Et butonu çalışmıyor" (mobil uygulama).
 *
 * KÖK NEDEN: Android kabuğu WebView'e bir WebChromeClient vermiyor. Bu
 * durumda WebView window.confirm()/alert() pencerelerini HİÇ GÖSTERMEZ ve
 * confirm() anında `false` döner. Sitedeki "Pes Et", "Ayrıl", "masadan at",
 * "arkadaşlıktan çıkar" gibi bütün onaylı işlemler bu yüzden uygulamada
 * sessizce iptal oluyordu (web tarayıcısında çalıştığı için fark edilmedi).
 *
 * ÇÖZÜM (uygulamayı yeniden yayınlamadan): uygulamada window.confirm sitenin
 * kendi penceresiyle değiştirilir. confirm() eşzamanlıdır, pencere ise
 * yanıt bekler; bu yüzden:
 *   1) İlk çağrıda pencere açılır ve false dönülür (işlem o an durur).
 *   2) Oyuncu "Evet" derse aynı mesaja TEK SEFERLİK onay yazılır ve işlemi
 *      başlatan öğeye (son dokunulan düğme) yeniden tıklanır. İşlem kendi
 *      kodunu baştan çalıştırır, confirm() bu kez true döner.
 *   3) Tıklamayla başlamayan çağrılar için (geri tuşu vb.) mesaja özel bir
 *      "yeniden çalıştırıcı" kaydedilebilir: GVOnay.yeniden(metinParcasi, fn).
 * Web tarayıcısında tarayıcının kendi penceresi kullanılmaya devam eder.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.GVOnay) return;

  function uygulamaMi() {
    try {
      if (window.MasaOyunlariApp) return true;
      if (window.GVApp && (GVApp.nativeApp || GVApp.webview)) return true;
      return /MasaOyunlariApp|; wv\)/.test(navigator.userAgent || '');
    } catch (_) { return false; }
  }

  function esc(x) {
    return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var stilVar = false;
  function stil() {
    if (stilVar) return;
    stilVar = true;
    var s = document.createElement('style');
    s.textContent =
      '.gv-onay{position:fixed;inset:0;z-index:2147483640;background:rgba(4,6,16,.72);display:flex;' +
        'align-items:center;justify-content:center;padding:16px;-webkit-user-select:none;user-select:none}' +
      '.gv-onay-kart{background:#161a2e;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:20px 18px;' +
        'max-width:380px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.6);color:#e9ecf6}' +
      '.gv-onay-metin{white-space:pre-line;font-size:.95em;line-height:1.5;margin:0 0 16px}' +
      '.gv-onay-dugme{display:flex;gap:10px}' +
      '.gv-onay-dugme button{flex:1;min-height:44px;border-radius:12px;font-weight:700;font-size:.95em;cursor:pointer;border:1px solid}' +
      '.gv-onay-hayir{background:#2b3145;border-color:#454c68;color:#dfe4f2}' +
      '.gv-onay-evet{background:linear-gradient(180deg,#ff6b6b,#d63031);border-color:#ff8a8a;color:#fff}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* Promise döndüren pencere — yeni kod doğrudan bunu kullanabilir. */
  function sor(metin, evetAd, hayirAd) {
    stil();
    return new Promise(function (coz) {
      var d = document.createElement('div');
      d.className = 'gv-onay';
      d.setAttribute('role', 'dialog');
      d.innerHTML = '<div class="gv-onay-kart"><p class="gv-onay-metin">' + esc(metin) + '</p>' +
        '<div class="gv-onay-dugme"><button type="button" class="gv-onay-hayir">' + esc(hayirAd || 'Vazgeç') + '</button>' +
        '<button type="button" class="gv-onay-evet">' + esc(evetAd || 'Evet') + '</button></div></div>';
      var bitti = false;
      function kapat(sonuc) {
        if (bitti) return;
        bitti = true;
        try { d.remove(); } catch (_) {}
        coz(sonuc);
      }
      d.querySelector('.gv-onay-evet').addEventListener('click', function (e) { e.stopPropagation(); kapat(true); });
      d.querySelector('.gv-onay-hayir').addEventListener('click', function (e) { e.stopPropagation(); kapat(false); });
      d.addEventListener('click', function (e) { if (e.target === d) kapat(false); });
      var kat = (window.__gvKaplamaKati && window.__gvKaplamaKati()) || document.body;
      kat.appendChild(d);
    });
  }

  var yenidenciler = [];
  function yeniden(parca, fn) { yenidenciler.push({ parca: String(parca), fn: fn }); }

  if (!uygulamaMi()) {
    window.GVOnay = { sor: sor, yeniden: yeniden, aktif: false };
    return;
  }

  /* Son dokunulan öğe (onay sonrası yeniden tıklanacak) */
  var sonHedef = null, sonZaman = 0;
  document.addEventListener('click', function (e) {
    if (e.target && e.target.closest && e.target.closest('.gv-onay')) return;
    var el = e.target && e.target.closest ? e.target.closest('button,a,[onclick],[role="button"],.btn') : null;
    sonHedef = el || e.target;
    sonZaman = Date.now();
  }, true);

  var onaylar = Object.create(null);     // metin → tek seferlik "evet"
  var acik = false;
  var asil = window.confirm;
  window.confirm = function (metin) {
    var m = String(metin == null ? '' : metin);
    if (onaylar[m]) { delete onaylar[m]; return true; }
    if (acik) return false;
    var hedef = (Date.now() - sonZaman < 1500) ? sonHedef : null;
    var calistir = null;
    if (!hedef) {
      for (var i = 0; i < yenidenciler.length; i++) {
        if (m.indexOf(yenidenciler[i].parca) !== -1) { calistir = yenidenciler[i].fn; break; }
      }
    }
    acik = true;
    sor(m, 'Evet', 'Vazgeç').then(function (evet) {
      acik = false;
      if (!evet) return;
      onaylar[m] = true;
      setTimeout(function () { delete onaylar[m]; }, 3000);   // kullanılmazsa bayatlamasın
      try {
        if (hedef && hedef.isConnected && typeof hedef.click === 'function') hedef.click();
        else if (calistir) calistir();
        else delete onaylar[m];
      } catch (_) { delete onaylar[m]; }
    });
    return false;
  };
  window.confirm.__gvOnay = true;
  window.confirm.__asil = asil;

  /* alert() de uygulamada görünmüyordu: kısa bilgi notu olarak göster. */
  window.alert = function (metin) {
    try { if (window.GV && GV.toast) { GV.toast(String(metin == null ? '' : metin), 'info', 5000); return; } } catch (_) {}
    sor(String(metin == null ? '' : metin), 'Tamam', 'Kapat');
  };

  /* Geri tuşu / kod içinden çağrılan "Ayrıl" onayı: tıklama yok, yeniden
     çalıştırıcı devreye girer. */
  yeniden('Ayrılmak istediğine emin misin?', function () {
    try { if (window.GV && GV.leaveRoom) GV.leaveRoom({ sorma: true }); } catch (_) {}
  });

  window.GVOnay = { sor: sor, yeniden: yeniden, aktif: true };
})();
