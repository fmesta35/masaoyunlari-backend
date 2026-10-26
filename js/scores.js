/* GameVerse — PUAN / İSTATİSTİK İSTEMCİSİ
 * =======================================
 * Puanlar İSTEMCİDE hesaplanmaz. Kurallar ve toplamlar sunucudadır
 * (scoring.js + score_events); burada yalnız okunur ve ekrana yazılır.
 * Böylece tarayıcı konsolundan puan şişirilemez.
 *
 * Kullanıcının isteği: "Profilde tutulacak istatistikler, oyun türlerine
 * göre ayrı ayrı gösterilecek." — bu yüzden /api/scores/me oyun oyun
 * döner ve İstatistikler sayfasındaki kartlar oyun başına galibiyet /
 * mağlubiyet / terk sayısını da gösterir.
 */
(function () {
  'use strict';
  if (window.GVScores) return;

  var BACKEND = String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  var TOK = 'gv-auth-token';
  var veri = null;      // { toplam, oyunlar:[...], genel:{...} }
  var kural = null;     // puan tablosu (nasıl puan kazanılır ekranı)
  var timer = null;

  function token() { try { return localStorage.getItem(TOK); } catch (_) { return null; } }

  /* VERİ YOLU (kullanıcı raporu: "maç geçmişi var ama toplam puan 0, liderlik
     ve istatistikte veri yok"): puanlar Yöncü MySQL'de duruyor ve Yöncü'nün
     DDoS koruması oyun sunucusunun (Render) oraya ULAŞMASINI engelliyor —
     Render'ın /api/scores/* uçları bu yüzden hep boş dönüyordu. Site Yöncü'de
     açıldığında veri DOĞRUDAN Yöncü'den okunur (tarayıcı korumayı geçer);
     başka bir adresten açıldıysa eski yol (Render) kullanılır. */
  var YONCU = /(^|\.)masaoyunlari\.com\.tr$/i.test(location.hostname);
  var PHP_SOCIAL = '/api/social.php';
  function jsonAl(url, h) {
    return fetch(url, { cache: 'no-store', headers: h || {} })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  function getir() {
    var t = token();
    if (!t) { veri = null; uygula(); return Promise.resolve(null); }
    var h = { Authorization: 'Bearer ' + t, 'X-GV-Token': t };
    var once = YONCU
      ? jsonAl(PHP_SOCIAL + '?action=scoreSummary&token=' + encodeURIComponent(t), h)
      : Promise.resolve(null);
    return once.then(function (d) {
      if (d && d.ok && d.ozet) return d;
      return jsonAl(BACKEND + '/api/scores/me', h);
    }).then(function (d) {
      if (d && d.ok) { veri = d.ozet || null; uygula(); }
      return veri;
    });
  }

  function kurallariGetir() {
    if (kural) return Promise.resolve(kural);
    return fetch(BACKEND + '/api/scores/rules', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && d.ok) kural = d; return kural; })
      .catch(function () { return null; });
  }

  // Sunucudan gelen toplamları arayüzün okuduğu st nesnesine yazar.
  function uygula() {
    var s = window.st;
    if (!s) return;
    if (!veri) { if (typeof window.updateScoreUI === 'function') window.updateScoreUI(); return; }
    /* st.totalScore salt-okunur bir HESAPLANAN alandır (oyun puanlarının
       toplamı, bkz. index.html). Eskiden buraya doğrudan yazılıyordu; katı
       kipte bu "only a getter" hatası fırlatıp uygula()'yı yarıda kesiyor,
       ekran hiç güncellenmiyordu (veri ilk kez gerçekten gelince ortaya
       çıktı). Toplam, aşağıda yazılan oyun puanlarından kendiliğinden çıkar. */
    s.scores = s.scores || {};
    // Önce hepsini sıfırla: sunucuda karşılığı olmayan eski yerel değerler
    // ekranda "hayalet puan" olarak kalmasın.
    Object.keys(s.scores).forEach(function (k) { s.scores[k] = 0; });
    (veri.oyunlar || []).forEach(function (o) {
      s.scores[o.gameId] = Math.max(0, Number(o.puan) || 0);
    });
    try { if (typeof window.updateScoreUI === 'function') window.updateScoreUI(); } catch (_) { /* sayfa kapanıyor */ }
  }

  // İstatistikler sayfasındaki kart için oyun bazlı ayrıntı.
  function oyunAyrinti(gameId) {
    if (!veri) return null;
    return (veri.oyunlar || []).find(function (o) { return o.gameId === gameId; }) || null;
  }

  function basla() {
    getir();
    kurallariGetir();
    if (!timer) timer = setInterval(getir, 60000);
    // Giriş/çıkışta hemen tazele (jeton değişti).
    window.addEventListener('gv:authChanged', getir);
    // Maç bitince puan hemen görünsün.
    window.addEventListener('gv:matchEnded', function () { setTimeout(getir, 1200); });
  }

  /* ---------------------------------------------------------------
     SIRALAMA (liderlik tablosu) — GERÇEK veriden.
     Sayfa eskiden gömülü örnek adları (GrandMaster_TR, OkeyEfendisi…)
     gösteriyordu; artık sunucudaki puan olaylarından gelen gerçek üyeler
     listelenir. Oyun başına ayrı çekilir ve 60 sn önbelleklenir.
     --------------------------------------------------------------- */
  var sirCache = {};                 // { anahtar: {t, liste} }
  function siralamaGetir(gameId) {
    var anahtar = gameId || 'genel';
    var c = sirCache[anahtar];
    if (c && (Date.now() - c.t) < 60000) return Promise.resolve(c.liste);
    var q = 'limit=15' + (gameId ? '&game=' + encodeURIComponent(gameId) : '');
    var once = YONCU ? jsonAl(PHP_SOCIAL + '?action=scoreBoard&' + q) : Promise.resolve(null);
    return once
      .then(function (d) {
        if (d && d.ok && Array.isArray(d.siralama)) return d;
        return jsonAl(BACKEND + '/api/scores/board?' + q);
      })
      .then(function (d) {
        var liste = (d && d.ok && Array.isArray(d.siralama)) ? d.siralama : [];
        sirCache[anahtar] = { t: Date.now(), liste: liste };
        return liste;
      })
      .catch(function () { return (sirCache[anahtar] || {}).liste || []; });
  }

  window.GVScores = {
    refresh: getir,
    siralama: siralamaGetir,
    siralamaTemizle: function () { sirCache = {}; },
    veri: function () { return veri; },
    kural: function () { return kural; },
    ayrinti: oyunAyrinti
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', basla, { once: true });
  } else { basla(); }
})();
