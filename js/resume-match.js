/* GameVerse — YARIM KALAN MAÇA DÖNÜŞ
 * ==================================
 * Kullanıcının kuralı:
 *   "Oyundan düşmüş oyuncu üye girişi yaparak web sitesine tekrar giriş
 *    yaparsa, ekranda pop-up olarak 'oyuna kaldığın yerden devam et' veya
 *    'pes et' seçenekleri çıkar. Pes ederse ceza puanı alır ve lobiye
 *    döner, kaldığı yerden devam ederse yapay zeka devreden çıkar ve
 *    yapay zekanın bıraktığı yerden oyuncu devam eder."
 *
 * NASIL ÇALIŞIR: 3–4 kişilik bir masadan ayrıldığınızda koltuğunuzu
 * idareci yapay zekâ devralır ve maç sonuna kadar oynar. Koltuk YALNIZ
 * size rezervedir (üye girişi yapmış, sabit ID'li oyuncu). Ziyaretçi
 * olarak oynuyorduysanız koltuk geri alınamaz — sunucu zaten "dönüş yok"
 * cevabı verir ve bu pencere hiç açılmaz.
 *
 * Ceza: ayrılırken −20 puan yazıldı. Devam ederseniz +10 iade edilir ve
 * sonrasında normal puanlama sürer. Pes ederseniz iade yoktur.
 */
(function () {
  'use strict';
  if (window.GVResume) return;

  var sorulduMu = false;
  var acik = false;

  function sock() {
    return window.__gvLobbySocket || window.__gvRoomSocket || window.__gvChessSocket || null;
  }

  function uyeMi() {
    try { return !!(window.st && !window.st.isGuest && window.st.user && Number(window.st.user.id) > 0); }
    catch (_) { return false; }
  }

  function sor() {
    var s = sock();
    if (!s || !s.connected || !uyeMi() || acik) return;
    s.emit('gvResumeCheck', {}, function (r) {
      if (!r || !r.ok || !r.devamEdilebilir) return;
      goster(r);
    });
  }

  function kapat() {
    var m = document.getElementById('gvResumeModal');
    if (m) m.remove();
    acik = false;
  }

  function goster(bilgi) {
    if (acik) return;
    acik = true;
    kapat();
    var oyunAdi = (window.GAMES && GAMES[bilgi.gameId] && GAMES[bilgi.gameId].name) || bilgi.gameId || 'Oyun';
    var ikon = (window.GAMES && GAMES[bilgi.gameId] && GAMES[bilgi.gameId].icon) || '🎲';
    var elBilgi = (bilgi.el && bilgi.toplamEl) ? (bilgi.el + '. el / ' + bilgi.toplamEl + ' el') : '';

    var d = document.createElement('div');
    d.id = 'gvResumeModal';
    d.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.72);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(4px)';
    d.innerHTML =
      '<div style="background:var(--bg2,#1c1f26);border:2px solid var(--accent,#4aa3ff);border-radius:16px;' +
        'max-width:420px;width:100%;padding:22px;text-align:center;box-shadow:0 18px 50px rgba(0,0,0,.6)">' +
        '<div style="font-size:2.4em;line-height:1;margin-bottom:8px">' + ikon + '</div>' +
        '<h3 style="margin:0 0 6px;font-size:1.15em">Yarım kalan maçınız var</h3>' +
        '<p style="color:var(--text2,#aab);font-size:.86em;margin:0 0 4px">' +
          oyunAdi + ' — ' + (bilgi.masaAdi || '') + '</p>' +
        (elBilgi ? '<p style="color:var(--text3,#889);font-size:.78em;margin:0 0 12px">' + elBilgi + '</p>' : '<div style="height:8px"></div>') +
        '<p style="color:var(--text2,#aab);font-size:.82em;margin:0 0 16px;line-height:1.5">' +
          'Siz ayrıldıktan sonra koltuğunuzda idareci yapay zekâ oynuyor. ' +
          'Devam ederseniz yapay zekâ çekilir, kaldığı yerden siz oynarsınız ' +
          've ayrılma cezanızın <b>10 puanı iade edilir</b>.</p>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">' +
          '<button id="gvResumeYes" class="btn btn-p" style="flex:1;min-width:150px">▶️ Kaldığım yerden devam et</button>' +
          '<button id="gvResumeNo" class="btn btn-s" style="flex:1;min-width:110px">🏳️ Pes et</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);

    d.querySelector('#gvResumeYes').addEventListener('click', function () {
      var s = sock();
      if (!s || !s.connected) { toast('Sunucuya bağlanılıyor, birkaç saniye sonra tekrar deneyin.', 'warning'); return; }
      s.emit('gvResumeSeat', { roomId: bilgi.roomId }, function (r) {
        kapat();
        if (r && r.ok) {
          toast('▶️ Masaya döndünüz — yapay zekâ çekildi.', 'success');
          masayaGit(r.gameId, r.roomId);
        } else {
          toast('⚠️ ' + ((r && r.error) || 'Masaya dönülemedi.'), 'error');
        }
      });
    });

    d.querySelector('#gvResumeNo').addEventListener('click', function () {
      var s = sock();
      if (s && s.connected) s.emit('gvForfeitSeat', {}, function () {});
      kapat();
      toast('🏳️ Maçtan çekildiniz. Koltuğunuzda yapay zekâ oynamayı sürdürecek.', 'info');
      lobiyeGit(bilgi.gameId);
    });
  }

  function toast(m, t) { if (window.GV && GV.toast) GV.toast(m, t || 'info', 5000); }

  // Masaya dön: önce oyunun lobisini aç (st.curGame doğru kurulsun), sonra
  // odaya gir. GV.joinRoom oda kimliğini tek başına alır; oyun kimliğini
  // st.curGame'den okuduğu için sıralama önemlidir.
  function masayaGit(gameId, roomId) {
    try { localStorage.setItem('gv-room-id', String(roomId)); } catch (_) {}
    try {
      if (window.GV && typeof GV.openLobby === 'function' && gameId) GV.openLobby(gameId);
    } catch (_) {}
    setTimeout(function () {
      try {
        if (window.GV && typeof GV.joinRoom === 'function') GV.joinRoom(String(roomId));
      } catch (_) {}
    }, 250);
  }

  function lobiyeGit(gameId) {
    try {
      if (window.GV && typeof GV.openLobby === 'function' && gameId) { GV.openLobby(gameId); return; }
      if (window.GV && typeof GV.showPage === 'function') GV.showPage('home');
    } catch (_) {}
  }

  // Masadaki herkese anlaşılır bildirim: kim ayrıldı, yerine kim oynuyor.
  var dinleyenler = new WeakSet();
  function bildirimleriBagla() {
    [window.__gvLobbySocket, window.__gvRoomSocket, window.__gvChessSocket].forEach(function (s) {
      if (!s || dinleyenler.has(s)) return;
      dinleyenler.add(s);
      s.on('aiTookSeat', function (p) {
        if (!p) return;
        toast('🤖 ' + (p.mesaj || 'Bir oyuncu ayrıldı; yerine yapay zekâ oynuyor.'), 'warning');
      });
      s.on('aiLeftSeat', function (p) {
        if (!p) return;
        toast('👋 ' + (p.mesaj || 'Oyuncu masaya geri döndü.'), 'success');
      });
      // Maç bitince puan tablosu tazelensin.
      s.on('gameEnded', function () {
        try { window.dispatchEvent(new Event('gv:matchEnded')); } catch (_) {}
      });
    });
  }

  function basla() {
    bildirimleriBagla();
    setInterval(bildirimleriBagla, 3000);
    // Giriş yapıldıktan hemen sonra ve soket hazır olunca sor.
    window.addEventListener('gv:authChanged', function () { sorulduMu = false; setTimeout(sor, 1200); });
    var t = setInterval(function () {
      if (sorulduMu) return;
      var s = sock();
      if (s && s.connected && uyeMi()) { sorulduMu = true; setTimeout(sor, 800); }
    }, 1500);
    setTimeout(function () { clearInterval(t); }, 120000);
  }

  window.GVResume = { sor: sor, kapat: kapat };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', basla, { once: true });
  } else { basla(); }
})();
