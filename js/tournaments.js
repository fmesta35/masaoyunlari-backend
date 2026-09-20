/* ==========================================================================
   TURNUVA SAYFASI (istemci)
   --------------------------------------------------------------------------
   Veri tamamen sunucudan gelir (/api/tournaments). Sayfada üç şey var:
     1) Turnuva kartları: kurucunun belirlediği kayıt penceresi, başlangıç
        saati, kontenjan ve özel not. Kayıt açıksa "Turnuvaya Katıl".
     2) Braket tablosu: eşleşmeler HERKESE AÇIK — tur tur, kazanan işaretli.
     3) Şampiyon ilanı: turnuva bitince sayfanın üstünde kupa ve büyük
        harflerle "ŞU OYUNUN BİRİNCİSİ: ŞU KULLANICI".

   Ziyaretçi katılamaz (sunucu da reddeder); düğme onu üyelik ekranına yollar.
   ========================================================================== */
(function () {
  'use strict';
  if (window.GVTurnuva) return;

  var BACKEND = String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  var TOK = 'gv-auth-token';
  var liste = [];
  var yukleniyor = false;
  var sonCekme = 0;

  function token() { try { return localStorage.getItem(TOK); } catch (_) { return null; } }
  function esc(x) {
    return String(x == null ? '' : x)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function oyunAdi(gid) {
    var G = window.GAMES || {};
    return (G[gid] && G[gid].name) || gid;
  }
  function oyunIkon(gid) {
    var G = window.GAMES || {};
    return (G[gid] && G[gid].icon) || '🎮';
  }
  function tarih(ms) {
    if (!ms) return '—';
    try {
      return new Date(Number(ms)).toLocaleString('tr-TR',
        { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (_) { return ''; }
  }
  function saat(ms) {
    if (!ms) return '—';
    try { return new Date(Number(ms)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return ''; }
  }

  var DURUM = {
    taslak:   { ad: 'Kayıtlar açılmadı', sinif: 'bekle' },
    kayit:    { ad: 'Kayıtlar açık',     sinif: 'acik' },
    hazir:    { ad: 'Başlamayı bekliyor', sinif: 'hazir' },
    devam:    { ad: 'Devam ediyor',      sinif: 'devam' },
    bitti:    { ad: 'Tamamlandı',        sinif: 'bitti' },
    iptal:    { ad: 'İptal edildi',      sinif: 'iptal' },
    ertelendi:{ ad: 'Ertelendi',         sinif: 'iptal' }
  };

  /* -------------------------------------------------------------- veri */
  function cek(zorla) {
    if (yukleniyor) return Promise.resolve(liste);
    if (!zorla && Date.now() - sonCekme < 8000) return Promise.resolve(liste);
    yukleniyor = true;
    var t = token();
    var h = { 'Cache-Control': 'no-store' };
    if (t) { h.Authorization = 'Bearer ' + t; h['X-GV-Token'] = t; }
    return fetch(BACKEND + '/api/tournaments', { cache: 'no-store', headers: h })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok) { liste = d.liste || []; sonCekme = Date.now(); }
        return liste;
      })
      .catch(function () { return liste; })
      .then(function (x) { yukleniyor = false; return x; });
  }

  function istek(yol, govde) {
    var t = token();
    var h = { 'Content-Type': 'application/json' };
    if (t) { h.Authorization = 'Bearer ' + t; h['X-GV-Token'] = t; }
    return fetch(BACKEND + yol, { method: 'POST', headers: h, body: JSON.stringify(govde || {}) })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .catch(function () { return { ok: false, error: 'Sunucuya ulaşılamadı.' }; });
  }

  /* ------------------------------------------------------------- çizim */
  function sampiyonHtml(t) {
    if (t.durum !== 'bitti' || !t.sampiyon) return '';
    return '<div class="tv-sampiyon">' +
      '<div class="tv-kupa">🏆</div>' +
      '<div class="tv-sampiyon-alt">' + esc(oyunAdi(t.gameId)) + ' BİRİNCİSİ</div>' +
      '<div class="tv-sampiyon-ad">' + esc(t.sampiyon.name) + '</div>' +
      '<div class="tv-sampiyon-not">' + esc(t.ad) + '</div>' +
    '</div>';
  }

  function macHtml(m, t) {
    var a = m.a ? esc(m.a.name) : '<i>—</i>';
    var b = m.b ? esc(m.b.name) : (m.durum === 'bay' ? '<i>bay</i>' : '<i>—</i>');
    var aKaz = m.kazanan && m.a && m.a.uid === m.kazanan;
    var bKaz = m.kazanan && m.b && m.b.uid === m.kazanan;
    var durum = m.durum === 'bitti' ? 'bitti' : (m.durum === 'oynaniyor' ? 'oynuyor'
              : (m.durum === 'bay' ? 'bay' : 'bekliyor'));
    return '<div class="tv-mac ' + durum + '">' +
      '<span class="tv-ok' + (aKaz ? ' kazandi' : (m.kazanan ? ' kaybetti' : '')) + '">' + a + '</span>' +
      '<span class="tv-vs">vs</span>' +
      '<span class="tv-ok' + (bKaz ? ' kazandi' : (m.kazanan ? ' kaybetti' : '')) + '">' + b + '</span>' +
    '</div>';
  }

  function braketHtml(t) {
    if (!t.braket || !t.braket.turlar) return '';
    var h = '<div class="tv-braket">';
    t.braket.turlar.forEach(function (tur, i) {
      h += '<div class="tv-tur"><div class="tv-tur-ad">' + esc(t.braket.turAdlari[i]) + '</div>';
      tur.forEach(function (m) { h += macHtml(m, t); });
      h += '</div>';
    });
    h += '</div>';
    return h;
  }

  function kartHtml(t) {
    var d = DURUM[t.durum] || DURUM.taslak;
    var misafir = !!(window.st && window.st.isGuest);
    var dugme = '';
    if (t.durum === 'kayit') {
      dugme = t.kayitliyim
        ? '<button class="tv-btn tv-btn-ayril" data-ayril="' + esc(t.id) + '">Kaydı geri çek</button>'
        : '<button class="tv-btn tv-btn-katil" data-katil="' + esc(t.id) + '">⚔️ Turnuvaya Katıl</button>';
    } else if (t.durum === 'devam' && t.benimMac && t.benimMac.roomId) {
      dugme = '<button class="tv-btn tv-btn-masa" data-oda="' + esc(t.benimMac.roomId) +
              '" data-oyun="' + esc(t.gameId) + '">🎮 Maçına Git</button>';
    }
    var doluluk = t.kapasite ? (t.katilimci + ' / ' + t.kapasite) : String(t.katilimci);

    return '<div class="tv-kart">' +
      sampiyonHtml(t) +
      '<div class="tv-ust">' +
        '<div class="tv-ikon">' + oyunIkon(t.gameId) + '</div>' +
        '<div class="tv-basl"><div class="tv-ad">' + esc(t.ad) + '</div>' +
          '<div class="tv-oyun">' + esc(oyunAdi(t.gameId)) + '</div></div>' +
        '<span class="tv-rozet ' + d.sinif + '">' + d.ad + '</span>' +
      '</div>' +
      '<div class="tv-bilgi">' +
        '<div><span>Kayıt</span><b>' + saat(t.kayitAcilis) + ' – ' + saat(t.kayitKapanis) + '</b></div>' +
        '<div><span>Başlangıç</span><b>' + tarih(t.baslangic) + '</b></div>' +
        '<div><span>Katılımcı</span><b>' + doluluk + '</b></div>' +
      '</div>' +
      (t.not ? '<div class="tv-not">📌 ' + esc(t.not) + '</div>' : '') +
      (misafir && t.durum === 'kayit'
        ? '<div class="tv-uyari">Turnuvaya yalnızca üyeler katılabilir.</div>' : '') +
      dugme +
      braketHtml(t) +
      (t.duyurular && t.duyurular.length
        ? '<details class="tv-duyuru"><summary>Duyurular (' + t.duyurular.length + ')</summary>' +
          t.duyurular.slice().reverse().map(function (x) {
            return '<div class="tv-duyuru-sat"><time>' + saat(x.ts) + '</time>' + esc(x.metin) + '</div>';
          }).join('') + '</details>'
        : '') +
    '</div>';
  }

  function ciz() {
    var el = document.getElementById('tournList');
    if (!el) return;
    var sekme = (window.st && window.st.currentTournTab) || 'all';
    var gosterilecek = liste.filter(function (t) { return sekme === 'all' || t.gameId === sekme; });

    if (!gosterilecek.length) {
      el.innerHTML = '<div class="card center" style="padding:40px;color:var(--text3)">' +
        (sekme === 'all'
          ? 'Şu anda planlanmış turnuva yok. Kurucu turnuva açtığında burada görünecek.'
          : oyunAdi(sekme) + ' için planlanmış turnuva yok.') + '</div>';
      return;
    }
    var sira = { devam: 0, kayit: 1, hazir: 2, taslak: 3, bitti: 4, ertelendi: 5, iptal: 6 };
    gosterilecek.sort(function (a, b) {
      var f = (sira[a.durum] || 9) - (sira[b.durum] || 9);
      return f !== 0 ? f : (Number(a.baslangic || 0) - Number(b.baslangic || 0));
    });
    el.innerHTML = gosterilecek.map(kartHtml).join('');
  }

  function yenile(zorla) { return cek(zorla).then(ciz); }

  /* ------------------------------------------------------------ olaylar */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var katil = t.closest('[data-katil]');
    if (katil) {
      e.preventDefault();
      if (window.st && window.st.isGuest) {
        if (window.showModal) return window.showModal('guestPromptModal');
      }
      katil.disabled = true;
      istek('/api/tournaments/' + katil.getAttribute('data-katil') + '/katil').then(function (r) {
        katil.disabled = false;
        if (r && r.ok) {
          if (window.GV && GV.toast) GV.toast('✅ Turnuvaya kaydoldun. Eşleşmen başlangıçta burada görünecek.', 'success');
          yenile(true);
        } else if (window.GV && GV.toast) {
          GV.toast('⚠️ ' + ((r && r.error) || 'Kayıt yapılamadı.'), 'error');
        }
      });
      return;
    }

    var ayril = t.closest('[data-ayril]');
    if (ayril) {
      e.preventDefault();
      ayril.disabled = true;
      istek('/api/tournaments/' + ayril.getAttribute('data-ayril') + '/ayril').then(function (r) {
        ayril.disabled = false;
        if (r && r.ok) { if (window.GV && GV.toast) GV.toast('Kaydın geri çekildi.', 'info'); yenile(true); }
        else if (window.GV && GV.toast) GV.toast('⚠️ ' + ((r && r.error) || 'İşlem yapılamadı.'), 'error');
      });
      return;
    }

    var masa = t.closest('[data-oda]');
    if (masa) {
      e.preventDefault();
      var oda = masa.getAttribute('data-oda'), oyun = masa.getAttribute('data-oyun');
      if (window.st) window.st.curGame = oyun;
      if (window.GV && GV.joinRoom) GV.joinRoom(oda);
    }
  });

  /* Sunucu turnuvada bir şey değiştiğinde haber verir. */
  function soketeBagla(sock) {
    if (!sock || sock.__gvTurnuva) return;
    sock.__gvTurnuva = true;
    sock.on('tournamentUpdated', function () { yenile(true); });
    sock.on('tournamentNotice', function (p) {
      if (!p) return;
      if (window.addNotification) window.addNotification(p.baslik || '🏆 Turnuva', p.metin || '');
      if (window.GV && GV.toast) GV.toast('🏆 ' + (p.metin || 'Turnuva duyurusu'), 'info');
      yenile(true);
    });
  }
  function soketAra() {
    ['socket', 'gvSocket', '__gvSocket'].forEach(function (ad) {
      try { if (window[ad] && window[ad].on) soketeBagla(window[ad]); } catch (_) {}
    });
    try { if (window.GVArena && GVArena.socket) soketeBagla(GVArena.socket()); } catch (_) {}
  }
  setInterval(soketAra, 3000);
  soketAra();

  window.GVTurnuva = { yenile: yenile, ciz: ciz, veri: function () { return liste; }, bagla: soketeBagla };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { yenile(true); }, { once: true });
  } else { yenile(true); }
})();
