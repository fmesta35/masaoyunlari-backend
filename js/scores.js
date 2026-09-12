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

  function getir() {
    var t = token();
    if (!t) { veri = null; uygula(); return Promise.resolve(null); }
    return fetch(BACKEND + '/api/scores/me', {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + t, 'X-GV-Token': t }
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok) { veri = d.ozet || null; uygula(); }
        return veri;
      })
      .catch(function () { return null; });
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
    s.totalScore = Number(veri.toplam) || 0;
    s.scores = s.scores || {};
    // Önce hepsini sıfırla: sunucuda karşılığı olmayan eski yerel değerler
    // ekranda "hayalet puan" olarak kalmasın.
    Object.keys(s.scores).forEach(function (k) { s.scores[k] = 0; });
    (veri.oyunlar || []).forEach(function (o) {
      s.scores[o.gameId] = Math.max(0, Number(o.puan) || 0);
    });
    if (typeof window.updateScoreUI === 'function') window.updateScoreUI();
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

  window.GVScores = {
    refresh: getir,
    veri: function () { return veri; },
    kural: function () { return kural; },
    ayrinti: oyunAyrinti
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', basla, { once: true });
  } else { basla(); }
})();
