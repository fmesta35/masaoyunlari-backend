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
    if (t) { h.Authorization = 'Bearer ' + t; h['X-GV-Token'] = t; belgeEkle(h); }
    return fetch(BACKEND + '/api/tournaments', { cache: 'no-store', headers: h })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.ok) { liste = d.liste || []; sonCekme = Date.now(); }
        return liste;
      })
      .catch(function () { return liste; })
      .then(function (x) { yukleniyor = false; return x; });
  }

  /* İmzalı üyelik belgesi (Kurucu Paneli ile aynı başlık): oyun sunucusu
     Yöncü'ye ulaşamasa da üyeyi tanır. */
  function belgeEkle(h) {
    try {
      var a = window.GVAuth && GVAuth.attestation ? GVAuth.attestation() : null;
      if (a) h['X-GV-Attest'] = encodeURIComponent(JSON.stringify(a));
    } catch (_) {}
  }
  function istek(yol, govde) {
    var t = token();
    var h = { 'Content-Type': 'application/json' };
    if (t) { h.Authorization = 'Bearer ' + t; h['X-GV-Token'] = t; belgeEkle(h); }
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

  /* KATILIMCILAR + KURA ÖNCESİ ŞEMA (kullanıcı isteği: "her oyun için grafik
     ve şema olarak turnuva bilgileri, kimlerin kimlerle eşleşeceği listeler
     hâlinde"). Kura başlangıçta çekilir; o ana kadar kontenjana göre boş
     bir braket şeması ve kayıtlı oyuncular gösterilir — eşleşmeler kura
     çekilince aynı şemanın içine yazılır. */
  function turAdi(toplamTur, i) {
    var kalan = toplamTur - i;
    if (kalan === 1) return 'Final';
    if (kalan === 2) return 'Yarı Final';
    if (kalan === 3) return 'Çeyrek Final';
    return (i + 1) + '. Tur';
  }
  function katilimciHtml(t) {
    var k = t.katilimcilar || [];
    if (t.braket) return '';
    var dolu = t.kapasite ? Math.min(100, Math.round(k.length / t.kapasite * 100)) : 0;
    return '<div class="tv-katil-kutu">' +
      '<div class="tv-katil-bas"><b>👥 Kayıtlı oyuncular</b><span>' + k.length + (t.kapasite ? ' / ' + t.kapasite : '') + '</span></div>' +
      (t.kapasite ? '<div class="tv-doluluk"><i style="width:' + dolu + '%"></i></div>' : '') +
      (k.length
        ? '<div class="tv-katil-liste">' + k.map(function (x, i) {
            return '<span class="tv-katil-ad' + (window.st && window.st.user && Number(window.st.user.id) === Number(x.uid) ? ' ben' : '') +
              '"><em>' + (i + 1) + '</em>' + esc(x.name) + '</span>';
          }).join('') + '</div>'
        : '<div class="tv-katil-bos">Henüz kayıt yok — ilk katılan sen ol.</div>') +
    '</div>';
  }
  function semaHtml(t) {
    if (t.braket || !t.kapasite) return '';
    var boy = 2; while (boy < t.kapasite) boy *= 2;
    var turlar = 0; for (var b = boy; b > 1; b /= 2) turlar++;
    var h = '<div class="tv-sema-not">🎲 Eşleşmeler başlangıç saatinde <b>kura</b> ile belirlenir ve bu şemaya yazılır.</div><div class="tv-braket tv-sema">';
    for (var i = 0, mac = boy / 2; i < turlar; i++, mac /= 2) {
      h += '<div class="tv-tur"><div class="tv-tur-ad">' + turAdi(turlar, i) + '</div>';
      for (var j = 0; j < mac; j++) {
        h += '<div class="tv-mac bekliyor"><span class="tv-ok"><i>' + (i === 0 ? 'Kura' : 'Kazanan') +
             '</i></span><span class="tv-vs">vs</span><span class="tv-ok"><i>' + (i === 0 ? 'Kura' : 'Kazanan') + '</i></span></div>';
      }
      h += '</div>';
    }
    return h + '<div class="tv-tur"><div class="tv-tur-ad">Şampiyon</div><div class="tv-mac bekliyor tv-kupa-kutu">🏆</div></div></div>';
  }

  function kartHtml(t) {
    var d = DURUM[t.durum] || DURUM.taslak;
    var misafir = !!(window.st && window.st.isGuest);
    var dugme = '';
    if (t.durum === 'kayit') {
      dugme = t.kayitliyim
        ? '<button class="tv-btn tv-btn-ayril" data-ayril="' + esc(t.id) + '">Kaydı geri çek</button>'
        : '<button class="tv-btn tv-btn-katil" data-katil="' + esc(t.id) + '">⚔️ Turnuvaya Katıl</button>';
    } else if (t.durum === 'hazir' && t.kayitliyim) {
      dugme = '<button class="tv-btn tv-btn-ayril" data-ayril="' + esc(t.id) + '">Kaydı geri çek</button>';
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
      katilimciHtml(t) +
      braketHtml(t) + semaHtml(t) +
      (t.duyurular && t.duyurular.length
        ? '<details class="tv-duyuru"><summary>Duyurular (' + t.duyurular.length + ')</summary>' +
          t.duyurular.slice().reverse().map(function (x) {
            return '<div class="tv-duyuru-sat"><time>' + saat(x.ts) + '</time>' + esc(x.metin) + '</div>';
          }).join('') + '</details>'
        : '') +
    '</div>';
  }

  /* SAYFA HÂLÂ AÇIK MI?
     `yenile()` bir ağ isteğinin ardından çiziyor; istek dönene kadar sayfa
     kapanmış olabilir (test ortamında jsdom penceresi kapanınca `document`
     tanımsızlaşıyor ve "Cannot read properties of undefined" ile süreç
     düşüyordu). Çizimden önce belgenin yaşadığını doğruluyoruz. */
  function sayfaVar() {
    try { return typeof document !== 'undefined' && !!document && !!document.getElementById; }
    catch (_) { return false; }
  }

  function ciz() {
    if (!sayfaVar()) return;
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

  function yenile(zorla) { return cek(zorla).then(function () { ciz(); pencereCiz(); }); }

  /* ---------------------------------------------- AKTİF TURNUVA PENCERESİ
     Ana sayfadaki "⚔️ Aktif Turnuva" kutusu bunu açar (js/canli-pencereler.js).
       · Ziyaretçi: resmî uyarı + Üye Girişi Yap / Üye Ol.
       · Üye, planlanmış turnuva yok: "Güncel bir turnuva planlanmamıştır."
       · Üye, turnuva var: bilgiler, kayıtlı oyuncular, braket şeması,
         Katıl / Ayrıl. Kurucu panelden yapılan her değişiklik sunucudan
         anında yayınlanır (tournamentUpdated) ve pencere kendini tazeler. */
  function uyeUyarisi() {
    var ac = function (id) { if (window.GV && GV.showModal) GV.showModal(id); };
    if (window.GVCanli && GVCanli.bilgi) {
      return GVCanli.bilgi({
        baslik: '⚔️ Turnuvalar', ikon: '🏆',
        altBaslik: 'Turnuvalarımıza yalnızca Masa Oyunları üyeleri katılabilir',
        metin: 'Turnuvaya katılmak ya da kaydınızı geri çekmek için üye girişi yapmanız gerekir. Üyelik ücretsizdir ve birkaç saniye sürer.',
        dugmeler: [{ ad: '🔑 Üye Girişi Yap', sinif: 'btn-p', fn: function () { ac('loginModal'); } },
                   { ad: '📝 Üye Ol', sinif: 'btn-o', fn: function () { ac('registerModal'); } }]
      });
    }
    ac('guestPromptModal');
  }
  function aktifler() {
    var simdi = Date.now();
    return liste.filter(function (t) {
      return t.durum === 'kayit' || t.durum === 'hazir' || t.durum === 'devam' ||
             (t.durum === 'taslak' && Number(t.baslangic || 0) > simdi) ||
             (t.durum === 'ertelendi' && Number(t.baslangic || 0) > simdi);
    });
  }
  function pencereEl() {
    var m = document.getElementById('gvTurnuvaModal');
    if (m) return m;
    m = document.createElement('div');
    m.className = 'modal-bg'; m.id = 'gvTurnuvaModal';
    m.innerHTML = '<div class="modal tv-pencere" role="dialog" aria-modal="true">' +
      '<button class="modal-x" type="button" aria-label="Kapat">✕</button>' +
      '<h2 style="margin:0 0 12px">⚔️ Aktif Turnuvalar</h2><div class="tv-pencere-govde"></div>' +
      '<button class="btn btn-o tv-tum" type="button" style="width:100%;margin-top:6px">Tüm turnuvalar sayfası →</button></div>';
    m.querySelector('.modal-x').addEventListener('click', function () { m.classList.remove('show'); });
    m.addEventListener('click', function (e) { if (e.target === m) m.classList.remove('show'); });
    m.querySelector('.tv-tum').addEventListener('click', function () {
      m.classList.remove('show');
      if (window.GV && GV.page) GV.page('tourn');
    });
    ((window.__gvKaplamaKati && window.__gvKaplamaKati()) || document.body).appendChild(m);
    return m;
  }
  function pencereCiz() {
    if (!sayfaVar()) return;
    var m = document.getElementById('gvTurnuvaModal');
    if (!m || !m.classList.contains('show')) return;
    var g = m.querySelector('.tv-pencere-govde');
    var a = aktifler();
    var sira = { devam: 0, kayit: 1, hazir: 2, taslak: 3, ertelendi: 4 };
    a.sort(function (x, y) { return ((sira[x.durum] || 9) - (sira[y.durum] || 9)) || (Number(x.baslangic || 0) - Number(y.baslangic || 0)); });
    g.innerHTML = a.length ? a.map(kartHtml).join('')
      : '<div class="tv-yok"><div style="font-size:2.4em">🗓️</div><b>Güncel bir turnuva planlanmamıştır.</b>' +
        '<span>Yeni bir turnuva açıldığında burada ve bildirimlerinde göreceksin.</span></div>';
  }
  function pencere() {
    var m = pencereEl();
    var g = m.querySelector('.tv-pencere-govde');
    if (!g.innerHTML) g.innerHTML = '<div class="tv-yok"><span>Yükleniyor…</span></div>';
    if (window.GV && GV.showModal) GV.showModal('gvTurnuvaModal'); else m.classList.add('show');
    pencereCiz();
    return cek(true).then(pencereCiz);
  }
  window.addEventListener('gv:tournamentsSynced', function () { yenile(true); });

  /* ------------------------------------------------------------ olaylar */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    /* Yalnız turnuva kartlarındaki düğmeler (başka pencerelerdeki
       benzer adlı öznitelikler "Turnuva bulunamadı" uyarısı doğuruyordu). */
    var katil = t.closest('.tv-btn[data-katil]');
    if (katil) {
      e.preventDefault();
      if (window.st && window.st.isGuest) return uyeUyarisi();
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

    var ayril = t.closest('.tv-btn[data-ayril]');
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

    var masa = t.closest('.tv-btn[data-oda]');
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
    ['socket', 'gvSocket', '__gvSocket', '__gvLobbySocket', '__gvRoomSocket'].forEach(function (ad) {
      try { if (window[ad] && window[ad].on) soketeBagla(window[ad]); } catch (_) {}
    });
    try { if (window.GVArena && GVArena.socket) soketeBagla(GVArena.socket()); } catch (_) {}
  }
  setInterval(soketAra, 3000);
  /* Pencere açıkken yedek tazeleme (soket kopuksa da güncel kalsın). */
  setInterval(function () {
    var m = document.getElementById('gvTurnuvaModal');
    if (m && m.classList.contains('show') && !document.hidden) yenile(true);
  }, 15000);
  soketAra();

  window.GVTurnuva = { yenile: yenile, ciz: ciz, veri: function () { return liste; }, bagla: soketeBagla,
                       pencere: pencere, aktifler: aktifler, uyeUyarisi: uyeUyarisi };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { yenile(true); }, { once: true });
  } else { yenile(true); }
})();
