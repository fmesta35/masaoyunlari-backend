/* ============================================================================
 * ANA SAYFA CANLI KUTULARI — tıklanabilir pencereler
 * ============================================================================
 * Kullanıcı isteği: "Mobilde ve webde aktif odalar, aktif turnuvalar
 * tıklanabilir ve yönlendirilebilir olsun; çevrimiçi oyuncuya tıklanınca
 * isimler görünsün."
 *
 *   👥 Çevrimiçi Oyuncu → kimler sitede: ziyaretçi adları tam
 *      ("Ziyaretçi#655"), üyeler gizlilik için kısaltılmış ve üye
 *      numarasıyla ("faz***#0008"). Liste sayaçla AYNI kaynaktan gelir ve
 *      pencere açıkken birkaç saniyede bir tazelenir: biri girince listede
 *      belirir, çıkınca kaybolur.
 *   🏠 Aktif Oda → oyun oyun aktif masalar. Masada BEKLEYEN oyuncu olan
 *      oyunda "Katıl" o masaya oturtur (Hızlı Eşleş ile aynı mantık).
 *   ⚔️ Aktif Turnuva → js/tournaments.js'in turnuva penceresi.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.GVCanli) return;

  var BACKEND = String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  var acikPencere = null;     // 'online' | 'oda' | null
  var tazeleZaman = null;

  function esc(x) {
    return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function oyun(gid) { var G = window.GAMES || {}; return G[gid] || { name: gid, icon: '🎮' }; }
  function uyeMi() { return !!(window.st && window.st.user && !window.st.isGuest && Number(window.st.user.id) > 0); }

  function stil() {
    if (document.getElementById('gv-canli-stil')) return;
    var s = document.createElement('style');
    s.id = 'gv-canli-stil';
    s.textContent =
      '.hl-item.hl-tik{cursor:pointer;transition:transform .15s,background .15s;-webkit-tap-highlight-color:transparent;font:inherit;color:inherit;width:100%}' +
      '.hl-item.hl-tik:hover{background:rgba(255,255,255,.22);transform:translateY(-1px)}' +
      '.hl-item.hl-tik:focus-visible{outline:2px solid #fff;outline-offset:2px}' +
      '.hl-item.hl-tik .hl-lbl::after{content:" ›";opacity:.75}' +
      '.gvc-modal{max-width:460px;width:94%}' +
      '.gvc-ust{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:2px 0 12px}' +
      '.gvc-sayi{font-family:var(--mono);font-weight:800;font-size:1.6em;color:var(--accent,#00cec9)}' +
      '.gvc-alt{font-size:.82em;color:var(--text2)}' +
      '.gvc-liste{display:flex;flex-direction:column;gap:6px;max-height:min(56vh,440px);overflow-y:auto;padding-right:2px}' +
      '.gvc-kisi{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:10px;background:var(--card);border:1px solid var(--border);font-size:.92em}' +
      '.gvc-kisi .nokta{width:9px;height:9px;border-radius:50%;background:#2ecc71;box-shadow:0 0 0 3px rgba(46,204,113,.18);flex:none}' +
      '.gvc-kisi .ad{flex:1;min-width:0;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.2px}' +
      '.gvc-kisi .rozet{font-size:.72em;padding:2px 8px;border-radius:20px;flex:none}' +
      '.gvc-kisi .rozet.uye{background:rgba(108,92,231,.22);color:#b9b0ff;border:1px solid rgba(108,92,231,.5)}' +
      '.gvc-kisi .rozet.zy{background:rgba(255,255,255,.07);color:var(--text2);border:1px solid var(--border)}' +
      '.gvc-kisi.tik{cursor:pointer}.gvc-kisi.tik:hover{border-color:var(--primary2,#a29bfe)}' +
      '.gvc-not{font-size:.76em;color:var(--text3);margin-top:12px;line-height:1.5}' +
      '.gvc-bos{padding:22px 10px;text-align:center;color:var(--text2);font-size:.92em;line-height:1.55}' +
      '.gvc-oyun{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;background:var(--card);border:1px solid var(--border)}' +
      '.gvc-oyun .ikon{font-size:1.5em;flex:none}' +
      '.gvc-oyun .bilgi{flex:1;min-width:0}' +
      '.gvc-oyun .bilgi b{display:block;font-size:.95em}' +
      '.gvc-oyun .bilgi span{font-size:.76em;color:var(--text2)}' +
      '.gvc-oyun .bilgi .bek{color:#2ecc71;font-weight:700}' +
      '.gvc-oyun .btn{flex:none;padding:7px 14px;font-size:.84em}' +
      '.gvc-resmi{text-align:center;padding:6px 4px 2px}' +
      '.gvc-resmi .ikon{font-size:2.6em;line-height:1;margin-bottom:8px}' +
      '.gvc-resmi h3{margin:0 0 8px;font-size:1.12em}' +
      '.gvc-resmi p{margin:0 0 16px;color:var(--text2);font-size:.9em;line-height:1.55}' +
      '.gvc-dugmeler{display:flex;gap:8px;flex-wrap:wrap}.gvc-dugmeler .btn{flex:1 1 140px}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* Ortak pencere kabuğu (sitenin .modal-bg düzeni; tam ekranda da çalışır). */
  function pencere(id, baslik) {
    stil();
    var m = document.getElementById(id);
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal-bg';
      m.id = id;
      m.innerHTML = '<div class="modal gvc-modal" role="dialog" aria-modal="true">' +
        '<button class="modal-x" type="button" aria-label="Kapat">✕</button>' +
        '<h2 class="gvc-baslik" style="margin:0 0 4px"></h2><div class="gvc-govde"></div></div>';
      m.querySelector('.modal-x').addEventListener('click', function () { kapat(id); });
      m.addEventListener('click', function (e) { if (e.target === m) kapat(id); });
      var kat = (window.__gvKaplamaKati && window.__gvKaplamaKati()) || document.body;
      kat.appendChild(m);
    }
    m.querySelector('.gvc-baslik').innerHTML = baslik;
    return m;
  }
  function goster(id) {
    if (window.GV && GV.showModal) GV.showModal(id);
    else { var m = document.getElementById(id); if (m) m.classList.add('show'); }
  }
  function kapat(id) {
    var m = document.getElementById(id);
    if (m) m.classList.remove('show');
    if (tazeleZaman) { clearInterval(tazeleZaman); tazeleZaman = null; }
    acikPencere = null;
  }
  function dongu(fn, ms) {
    if (tazeleZaman) clearInterval(tazeleZaman);
    tazeleZaman = setInterval(function () {
      var m = document.getElementById(acikPencere === 'online' ? 'gvOnlineModal' : 'gvOdaModal');
      if (!m || !m.classList.contains('show')) { clearInterval(tazeleZaman); tazeleZaman = null; acikPencere = null; return; }
      fn();
    }, ms);
  }

  /* -------------------------------------------------------- ÇEVRİMİÇİ */
  function onlineCiz(d) {
    var m = document.getElementById('gvOnlineModal');
    if (!m) return;
    var g = m.querySelector('.gvc-govde');
    if (!d || !d.ok) { g.innerHTML = '<div class="gvc-bos">Liste şu an alınamadı — birazdan tekrar denenecek.</div>'; return; }
    var uye = d.liste.filter(function (k) { return k.uye; }).length;
    var zy = d.liste.length - uye;
    var h = '<div class="gvc-ust"><span class="gvc-sayi">' + d.toplam + '</span>' +
      '<span class="gvc-alt">kişi çevrimiçi · ' + uye + ' üye · ' + zy + ' ziyaretçi</span></div>';
    if (!d.liste.length) h += '<div class="gvc-bos">Şu anda çevrimiçi kimse görünmüyor.</div>';
    else {
      h += '<div class="gvc-liste">' + d.liste.map(function (k) {
        return '<div class="gvc-kisi' + (k.uye && uyeMi() ? ' tik' : '') + '"' +
          (k.uye ? ' data-no="' + esc(k.no) + '"' : '') + '>' +
          '<span class="nokta"></span><span class="ad">' + esc(k.ad) + '</span>' +
          '<span class="rozet ' + (k.uye ? 'uye">👤 Üye' : 'zy">Ziyaretçi') + '</span></div>';
      }).join('') + '</div>';
    }
    h += '<div class="gvc-not">🔒 Gizlilik için üyelerin yalnız ilk 3 harfi ve üye numarası görünür. ' +
      (uyeMi() ? 'Bir üyeye dokunarak <b>numarasıyla arkadaşlık isteği</b> gönderebilirsin.'
               : 'Üye olursan oyuncuları <b>üye numarasıyla</b> arkadaş ekleyebilirsin.') + '</div>';
    g.innerHTML = h;
    g.querySelectorAll('.gvc-kisi.tik').forEach(function (el) {
      el.addEventListener('click', function () {
        var no = el.getAttribute('data-no');
        kapat('gvOnlineModal');
        if (window.GV && GV.openFriends) GV.openFriends();
        setTimeout(function () {
          var inp = document.getElementById('friendsAddInput');
          if (inp) { inp.value = no; try { inp.focus(); } catch (_) {} }
        }, 120);
      });
    });
  }
  function onlineGetir() {
    return fetch(BACKEND + '/api/online-list', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(onlineCiz);
  }
  function onlineAc() {
    pencere('gvOnlineModal', '👥 Çevrimiçi Oyuncular');
    var g = document.querySelector('#gvOnlineModal .gvc-govde');
    if (g && !g.innerHTML) g.innerHTML = '<div class="gvc-bos">Yükleniyor…</div>';
    goster('gvOnlineModal');
    acikPencere = 'online';
    // Kendi kaydımız sayılsın diye önce nabız, sonra liste.
    try { if (window.GVLiveStats) GVLiveStats.refresh(); } catch (_) {}
    setTimeout(onlineGetir, 250);
    dongu(onlineGetir, 5000);
  }

  /* ------------------------------------------------------- AKTİF ODA */
  function odaCiz(d) {
    var m = document.getElementById('gvOdaModal');
    if (!m) return;
    var g = m.querySelector('.gvc-govde');
    if (!d || !d.ok) { g.innerHTML = '<div class="gvc-bos">Masalar şu an alınamadı — birazdan tekrar denenecek.</div>'; return; }
    var liste = d.liste.filter(function (x) { return !window.gvGameVisible || window.gvGameVisible(x.gameId); });
    var bekleyen = liste.reduce(function (a, x) { return a + x.bekleyen; }, 0);
    var h = '<div class="gvc-ust"><span class="gvc-sayi">' + liste.reduce(function (a, x) { return a + x.bekleyen + x.oynanan + x.ozel; }, 0) +
      '</span><span class="gvc-alt">aktif masa · ' + bekleyen + ' masada oyuncu bekliyor</span></div>';
    if (!liste.length) {
      h += '<div class="gvc-bos">Şu anda aktif masa yok.<br>Bir oyunda <b>⚡ Hızlı Eşleş</b> ile ilk masayı sen açabilirsin.</div>';
    } else {
      h += '<div class="gvc-liste">' + liste.map(function (x) {
        var o = oyun(x.gameId);
        var satir = [];
        if (x.bekleyen) satir.push('<span class="bek">' + x.bekleyen + ' masada ' + x.bekleyenOyuncu + ' oyuncu bekliyor</span>');
        if (x.oynanan) satir.push(x.oynanan + ' masa oynanıyor');
        if (x.ozel) satir.push(x.ozel + ' özel masa');
        var dugme = x.bekleyen
          ? '<button class="btn btn-p" type="button" data-katil="' + esc(x.gameId) + '">⚡ Katıl</button>'
          : '<button class="btn btn-o" type="button" data-lobi="' + esc(x.gameId) + '">Lobiye Git</button>';
        return '<div class="gvc-oyun"><span class="ikon">' + o.icon + '</span>' +
          '<div class="bilgi"><b>' + esc(o.name) + '</b><span>' + satir.join(' · ') + '</span></div>' + dugme + '</div>';
      }).join('') + '</div>';
    }
    h += '<div class="gvc-not">⚡ <b>Katıl</b>, o oyunda masada bekleyen oyuncunun yanına oturtur — Hızlı Eşleş ile aynı.</div>';
    g.innerHTML = h;
    g.querySelectorAll('[data-katil]').forEach(function (b) {
      b.addEventListener('click', function () {
        var gid = b.getAttribute('data-katil');
        kapat('gvOdaModal');
        if (window.GV && GV.quickMatchFor) GV.quickMatchFor(gid, b);
        else if (window.GV && GV.openLobby) GV.openLobby(gid);
      });
    });
    g.querySelectorAll('[data-lobi]').forEach(function (b) {
      b.addEventListener('click', function () {
        kapat('gvOdaModal');
        if (window.GV && GV.openLobby) GV.openLobby(b.getAttribute('data-lobi'));
      });
    });
  }
  function odaGetir() {
    return fetch(BACKEND + '/api/active-rooms', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(odaCiz);
  }
  function odaAc() {
    pencere('gvOdaModal', '🏠 Aktif Odalar');
    var g = document.querySelector('#gvOdaModal .gvc-govde');
    if (g && !g.innerHTML) g.innerHTML = '<div class="gvc-bos">Yükleniyor…</div>';
    goster('gvOdaModal');
    acikPencere = 'oda';
    odaGetir();
    dongu(odaGetir, 5000);
  }

  /* ---------------------------------------------------- AKTİF TURNUVA */
  function turnuvaAc() {
    if (window.GVTurnuva && GVTurnuva.pencere) return GVTurnuva.pencere();
    if (window.GV && GV.page) GV.page('tourn');
  }

  /* Resmî bilgi penceresi (turnuva üyelik uyarısı vb.) */
  function bilgi(o) {
    var m = pencere('gvBilgiModal', o.baslik || '');
    var g = m.querySelector('.gvc-govde');
    g.innerHTML = '<div class="gvc-resmi"><div class="ikon">' + (o.ikon || 'ℹ️') + '</div>' +
      (o.altBaslik ? '<h3>' + o.altBaslik + '</h3>' : '') + '<p>' + (o.metin || '') + '</p>' +
      '<div class="gvc-dugmeler">' + (o.dugmeler || []).map(function (d, i) {
        return '<button type="button" class="btn ' + (d.sinif || 'btn-p') + '" data-i="' + i + '">' + d.ad + '</button>';
      }).join('') + '</div></div>';
    g.querySelectorAll('[data-i]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = o.dugmeler[Number(b.getAttribute('data-i'))];
        kapat('gvBilgiModal');
        if (d && d.fn) setTimeout(d.fn, 60);
      });
    });
    goster('gvBilgiModal');
  }

  /* Kutuları tıklanabilir yap (klavye ile de: Enter/Boşluk). */
  function bagla() {
    stil();
    var esle = { hlOnline: onlineAc, hlRooms: odaAc, hlTourn: turnuvaAc };
    Object.keys(esle).forEach(function (id) {
      var v = document.getElementById(id);
      var kutu = v && v.closest ? v.closest('.hl-item') : null;
      if (!kutu || kutu.__gvTik) return;
      kutu.__gvTik = true;
      kutu.classList.add('hl-tik');
      kutu.setAttribute('role', 'button');
      kutu.setAttribute('tabindex', '0');
      kutu.addEventListener('click', esle[id]);
      kutu.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); esle[id](); }
      });
    });
  }

  window.GVCanli = { online: onlineAc, odalar: odaAc, turnuva: turnuvaAc, bilgi: bilgi, kapat: kapat };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bagla, { once: true });
  else bagla();
  setTimeout(bagla, 1500);
})();
