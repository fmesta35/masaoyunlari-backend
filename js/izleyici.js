/* GameVerse — İZLEYİCİ SİSTEMİ (koltuk seçerek izleme + izin yönetimi)
 *
 *  Kullanıcı isteği (verbatim):
 *   "okey, 101 okey, pişti, batak ve amiral battı oyunlarında, dışarıdan
 *    odalarda izleyiciler katılmak isterse, izleyici olarak katılmak
 *    isteyen kişi oyundaki oyuncuların isimlerini pop-up açılarak seçer ve
 *    o oyuncunun ekranından izlemeye devam eder. Oyuncularda 'İzleyiciye
 *    İzin Ver' veya 'İzleyici İznini Kaldır' seçenekleri olacak oyun
 *    esnasında webde ve mobilde. İzleyiciye izin ver seçeneği açıksa —
 *    üye girişi yapan veya yapmayan izleyici olarak katılabilir, eğer
 *    izleyici iznini kaldır derse izleyiciler o oyuncuyu seçemez rengi
 *    sönük gözükür, sadece izin verilen rengi aktif olarak gözükür
 *    oyuncunun kullanıcı adı veya ziyaretçi numarasıyla. (eğer önceden
 *    izleyici var ise de artık oyundan izleyici atılır ve lobiye
 *    yönlendirilerek pop up uyarı mesajıyla oyuncu izleyici iznini kapattı
 *    uyarısı versin)"
 *
 *  TASARIM — NEDEN AYRI BİR MODÜL?
 *  Beş oyunun beş ayrı istemcisi var (okey/101 okey js/okey-online.js,
 *  pişti/batak ve amiral battı GVArena adaptörleri). Üçüne de aynı pencere
 *  ve aynı düğmeyi ayrı ayrı yazmak yerine bu modül oyundan BAĞIMSIZ
 *  çalışır: yalnız soket olaylarını dinler, oda başlığına tek bir düğme
 *  basar ve pop-up'ı kendisi çizer. Koltuk perspektifini zaten SUNUCU
 *  yolluyor (bkz. server.js izleKoltuk) — oyun istemcilerinin tek yaptığı
 *  gelen paketteki seat'i kullanmak.
 *
 *  GÜVENLİK: izin denetimi SUNUCUDA. Buradaki sönük düğme yalnız görsel
 *  kolaylık; istemci kodu değiştirilse bile izin vermeyen bir oyuncunun
 *  ıstakası/gemisi paketlere hiç konmaz.
 */
(function () {
  'use strict';
  if (window.__gvIzleyiciYuklendi) return;
  window.__gvIzleyiciYuklendi = true;

  /* Koltuk seçimi YALNIZ gizli bilgi taşıyan oyunlarda anlamlı
     (sunucudaki IZLEME_SECIMLI_OYUNLAR ile aynı liste). */
  var SECIMLI = ['okey', 'okey101', 'pisti', 'batak', 'battleship'];

  var secenekler = [];        // [{seat,name,uid,uye,allowed}]
  var izlenenKoltuk = null;   // izleyiciysem hangi koltuğu izliyorum
  var benimKoltuk = null;     // oyuncuysam kendi koltuğum
  var benimIzin = true;       // oyuncuysam izleyiciye izin veriyor muyum
  var secimliOda = false;
  var pencereAcik = false;
  var cikariliyor = false;

  function toast(m, t) {
    if (typeof window.toast === 'function') return window.toast(m, t);
    if (window.GV && typeof GV.toast === 'function') return GV.toast(m, t);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) {
      return ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c];
    });
  }
  /* Kaplamalar tam ekranda #pg-room'un İÇİNE girmeli, yoksa görünmezler
     (bkz. index.html GV_FS_KAPLAMALAR / __gvKaplamaKati). */
  function kat() {
    return (window.__gvKaplamaKati ? window.__gvKaplamaKati() : document.body);
  }
  var SOKET_ANAHTARLARI = ['__gvRoomSocket', '__gvChessSocket', '__gvLobbySocket', '__gvSocket'];
  function tumSoketler() {
    var out = [], i, s;
    for (i = 0; i < SOKET_ANAHTARLARI.length; i++) {
      s = window[SOKET_ANAHTARLARI[i]];
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }
  function sok() { return tumSoketler()[0] || null; }
  function odaSayfasi() { return !!document.querySelector('#pg-room.active'); }

  /* ------------------------------------------------- OYUNCU SEÇİM PENCERESİ */
  function pencereKapat() {
    pencereAcik = false;
    var o = document.querySelector('.gv-izle-ov');
    if (o) o.remove();
  }

  function pencereAc() {
    if (!secimliOda || !odaSayfasi()) return;
    pencereKapat();
    pencereAcik = true;
    var ov = document.createElement('div');
    ov.className = 'gv-izle-ov';
    ov.innerHTML = kartHtml();
    kat().appendChild(ov);

    ov.addEventListener('click', function (e) {
      var kapat = e.target.closest ? e.target.closest('.gv-izle-kapat') : null;
      if (kapat) { pencereKapat(); return; }
      var dgm = e.target.closest ? e.target.closest('.gv-izle-sec') : null;
      if (!dgm || dgm.disabled) return;
      var s = sok();
      if (!s) { toast('🔌 Sunucu bağlantısı yok.', 'error'); return; }
      s.emit('spectateSeat', { seat: Number(dgm.dataset.seat) });
    });
  }

  function kartHtml() {
    var izinli = secenekler.filter(function (x) { return x.allowed; });
    var h = '<div class="gv-izle-kart">' +
      '<div class="gv-izle-ico">👁️</div>' +
      '<h3>Kimin ekranından izlemek istersin?</h3>' +
      '<p>Seçtiğin oyuncunun gördüğü ekranı (eli / taşları) izlersin. ' +
      'İzleyiciye kapalı olan oyuncular sönük görünür ve seçilemez.</p>';

    if (!secenekler.length) {
      h += '<p class="gv-izle-bos">Masada henüz oyuncu yok.</p>';
    } else if (!izinli.length) {
      h += '<p class="gv-izle-bos">⛔ Bu masadaki oyuncuların hiçbiri şu an ' +
           'izlenmeye izin vermiyor. İzin verdiklerinde buradan seçebilirsin.</p>';
    }

    h += '<div class="gv-izle-liste">';
    secenekler.forEach(function (o) {
      var secili = (o.seat === izlenenKoltuk);
      h += '<button type="button" class="gv-izle-sec' +
        (o.allowed ? '' : ' sonuk') + (secili ? ' secili' : '') + '"' +
        ' data-seat="' + o.seat + '"' + (o.allowed ? '' : ' disabled') +
        ' title="' + (o.allowed ? 'Bu oyuncunun ekranından izle' : 'Bu oyuncu izleyiciye kapalı') + '">' +
        '<span class="gv-izle-kol">' + (o.seat + 1) + '</span>' +
        '<span class="gv-izle-ad">' + esc(o.name || ('Koltuk ' + (o.seat + 1))) + '</span>' +
        '<span class="gv-izle-rozet">' + (o.uye ? '👤 Üye' : '🙋 Ziyaretçi') + '</span>' +
        '<span class="gv-izle-durum">' + (o.allowed ? (secili ? '✅ İzleniyor' : '👁️ İzle') : '⛔ Kapalı') + '</span>' +
        '</button>';
    });
    h += '</div>' +
      '<div class="gv-izle-dgm">' +
      '<button type="button" class="btn btn-o gv-izle-kapat">Kapat</button>' +
      '</div></div>';
    return h;
  }

  function pencereTazele() {
    if (!pencereAcik) return;
    var ov = document.querySelector('.gv-izle-ov');
    if (ov) ov.innerHTML = kartHtml();
  }

  /* ----------------------------------------- ODADAN ÇIKARILMA (izin kalktı) */
  function cikarildiUyar(p) {
    if (cikariliyor) return;
    cikariliyor = true;
    pencereKapat();
    var ad = (p && p.name) || 'Oyuncu';
    var ov = document.createElement('div');
    ov.className = 'gv-izle-ov gv-izle-uyari';
    ov.innerHTML =
      '<div class="gv-izle-kart">' +
      '<div class="gv-izle-ico">🚫</div>' +
      '<h3>İzleme sona erdi</h3>' +
      '<p><b>' + esc(ad) + '</b> izleyici iznini kapattı. Masadan çıkarıldın, ' +
      'lobiye yönlendiriliyorsun.</p>' +
      '<div class="gv-izle-dgm"><button type="button" class="btn gv-izle-lobi">🏠 Lobiye Dön</button></div>' +
      '</div>';
    kat().appendChild(ov);
    var git = function () { try { ov.remove(); } catch (_) {} lobiyeDon(); };
    ov.querySelector('.gv-izle-lobi').addEventListener('click', git);
    setTimeout(git, 6000);          // tıklanmazsa kendiliğinden
  }

  function lobiyeDon() {
    sifirla();
    /* İKİ ADIM: önce oda istemcisinin durumunu TEMİZLE, sonra lobiyi aç.
       Soketi sunucu zaten odadan çıkardı; ama yerel taraf hâlâ "masadayım"
       sanıyor (tahta, saat, izleyici bayrağı). __gvRealChessLeave bu
       temizliği yapan ortak çıkış yoludur — GV.leaveRoom'u çağırmıyoruz
       çünkü o, leave-guard'ın "ayrılmak istediğine emin misin?" onay
       penceresinden geçer; burada ayrılma kararı oyuncunun, izleyicinin
       değil. */
    try {
      if (typeof window.__gvRealChessLeave === 'function') window.__gvRealChessLeave();
    } catch (_) {}
    try {
      if (window.GV && typeof GV.openLobby === 'function') {
        GV.openLobby((window.st && window.st.curGame) || 'okey');
      } else if (window.GV && typeof GV.goHome === 'function') {
        GV.goHome();
      }
    } catch (_) {}
  }

  /* --------------------------------------------- OYUNCUNUN İZİN DÜĞMESİ */
  function dugme() { return document.getElementById('gvIzinBtn'); }

  function dugmeYerlestir() {
    if (dugme()) return dugme();
    var ses = document.getElementById('gvSoundBtn');
    if (!ses || !ses.parentNode) return null;
    var b = document.createElement('button');
    b.id = 'gvIzinBtn';
    b.type = 'button';
    b.className = 'btn btn-o btn-sm';
    b.style.display = 'none';
    b.addEventListener('click', function () {
      var s = sok();
      if (!s) { toast('🔌 Sunucu bağlantısı yok.', 'error'); return; }
      s.emit('setSpectatorPermission', { allow: !benimIzin });
    });
    ses.parentNode.insertBefore(b, ses.nextSibling);
    return b;
  }

  function dugmeYaz() {
    var b = dugmeYerlestir();
    if (!b) return;
    /* Yalnız KOLTUKTAKİ oyuncuya, seçimli oyunlarda, oda sayfasında. */
    var gorunur = odaSayfasi() && secimliOda && !window.__gvIsSpectator && benimKoltuk !== null;
    b.style.display = gorunur ? '' : 'none';
    if (!gorunur) return;
    b.textContent = benimIzin ? '👁️ İzleyici İznini Kaldır' : '🚫 İzleyiciye İzin Ver';
    b.title = benimIzin
      ? 'Şu an izleyiciler senin ekranından izleyebiliyor — kapatmak için tıkla'
      : 'Şu an kimse senin ekranından izleyemiyor — açmak için tıkla';
    b.setAttribute('aria-pressed', benimIzin ? 'true' : 'false');
    b.classList.toggle('gv-izin-kapali', !benimIzin);
  }

  /* ------------------------------------------------------- İZLEYİCİ ROZETİ */
  function rozetYaz() {
    var el = document.getElementById('gvIzleRozet');
    var goster = odaSayfasi() && secimliOda && !!window.__gvIsSpectator;
    if (!goster) { if (el) el.remove(); return; }
    if (!el) {
      var ses = document.getElementById('gvSoundBtn');
      if (!ses || !ses.parentNode) return;
      el = document.createElement('button');
      el.id = 'gvIzleRozet';
      el.type = 'button';
      el.className = 'btn btn-o btn-sm';
      el.title = 'İzlediğin oyuncuyu değiştir';
      el.addEventListener('click', pencereAc);
      ses.parentNode.insertBefore(el, ses);
    }
    var o = secenekler.find(function (x) { return x.seat === izlenenKoltuk; });
    el.textContent = o ? ('👁️ ' + o.name) : '👁️ Oyuncu Seç';
  }

  function sifirla() {
    secenekler = []; izlenenKoltuk = null; benimKoltuk = null;
    benimIzin = true; secimliOda = false; cikariliyor = false;
    pencereKapat();
    var b = dugme(); if (b) b.style.display = 'none';
    var r = document.getElementById('gvIzleRozet'); if (r) r.remove();
  }
  window.addEventListener('gv:roomLeft', sifirla);

  /* ------------------------------------------------------------- SOKETLER */
  function bagla(s) {
    if (!s || s.__gvIzleyiciKanca) return;
    s.__gvIzleyiciKanca = true;

    s.on('spectatorChoices', function (p) {
      if (!p) return;
      secimliOda = (p.secimli !== undefined) ? !!p.secimli : SECIMLI.indexOf(p.gameId) >= 0;
      secenekler = Array.isArray(p.choices) ? p.choices : [];
      if (typeof p.watchSeat === 'number') izlenenKoltuk = p.watchSeat;
      /* İzleyiciysem ve henüz seçim yapmadıysam pencereyi KENDİLİĞİNDEN aç:
         kullanıcı isteği "pop-up açılarak seçer". */
      if (window.__gvIsSpectator && secimliOda && izlenenKoltuk === null) pencereAc();
      else pencereTazele();
      dugmeYaz(); rozetYaz();
    });

    s.on('spectateSeatResult', function (p) {
      if (!p) return;
      if (p.ok) {
        izlenenKoltuk = p.seat;
        pencereKapat();
        toast('👁️ ' + (p.name || 'Oyuncu') + ' ekranından izliyorsun.', 'success');
      } else if (p.reason === 'not_allowed') {
        toast('⛔ ' + (p.name || 'Bu oyuncu') + ' izleyiciye kapalı.', 'warning');
      } else {
        toast('⛔ Bu oyuncu şu an izlenemiyor.', 'warning');
      }
      rozetYaz();
    });

    s.on('spectatorPermissionSet', function (p) {
      if (!p) return;
      benimIzin = !!p.allow;
      dugmeYaz();
      if (p.allow) toast('👁️ İzleyicilere açıldın.', 'success');
      else toast('🚫 İzleyici izni kaldırıldı' +
        (p.ejected ? (' — ' + p.ejected + ' izleyici çıkarıldı.') : '.'), 'info');
    });

    s.on('spectatorEjected', cikarildiUyar);

    /* Oda özeti her değiştiğinde kendi koltuğumu ve izin durumumu tazele:
       tek bir olaya bağlı kalmak yarış durumu yaratıyor (bkz. rematch.js). */
    s.on('roomUpdated', function (r) {
      if (!r) return;
      secimliOda = SECIMLI.indexOf(r.gameId) >= 0;
      var ben = (r.players || []).find(function (x) { return x.id === s.id; });
      var izleyiciyim = (r.spectators || []).some(function (x) { return x.id === s.id; });
      if (ben) { benimKoltuk = ben.seat; benimIzin = ben.allowSpectators !== false; }
      else if (izleyiciyim) { benimKoltuk = null; }
      if (izleyiciyim) {
        var bk = (r.spectators || []).find(function (x) { return x.id === s.id; });
        izlenenKoltuk = (bk && typeof bk.watchSeat === 'number') ? bk.watchSeat : null;
      }
      secenekler = (r.players || []).map(function (x) {
        return { seat: x.seat, name: x.name, uid: x.uid || null,
                 uye: !!x.uid, allowed: x.allowSpectators !== false };
      }).sort(function (a, b) { return a.seat - b.seat; });
      pencereTazele(); dugmeYaz(); rozetYaz();
    });

    s.on('joinedRoom', function (p) {
      cikariliyor = false;
      if (p && p.room) secimliOda = SECIMLI.indexOf(p.room.gameId) >= 0;
    });
  }
  function baglaHepsi() {
    var l = tumSoketler(), i;
    for (i = 0; i < l.length; i++) { try { bagla(l[i]); } catch (_) {} }
  }

  /* io() kancası: oyun istemcileri soketlerini SONRADAN kuruyor. */
  function ioKancasi() {
    var asil = window.io;
    if (typeof asil !== 'function' || asil.__gvIzleyiciKanca) return;
    var sarmal = function () {
      var s = asil.apply(this, arguments);
      try { bagla(s); } catch (_) {}
      return s;
    };
    for (var k in asil) { try { sarmal[k] = asil[k]; } catch (_) {} }
    sarmal.__gvIzleyiciKanca = true;
    try { window.io = sarmal; } catch (_) {}
  }

  ioKancasi(); baglaHepsi();
  setInterval(function () {
    ioKancasi(); baglaHepsi();
    if (!odaSayfasi()) { if (secimliOda || benimKoltuk !== null) sifirla(); return; }
    dugmeYaz(); rozetYaz();
  }, 1000);

  /* --------------------------------------------------------------- BİÇEM */
  var css = document.createElement('style');
  css.textContent =
    '.gv-izle-ov{position:fixed;inset:0;z-index:2147483500;background:rgba(4,6,16,.76);' +
      'backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.gv-izle-kart{background:#161a2e;border:1px solid rgba(255,255,255,.14);border-radius:18px;' +
      'padding:20px 18px;width:min(430px,94vw);max-height:88vh;overflow:auto;text-align:center;' +
      'box-shadow:0 26px 70px rgba(0,0,0,.62)}' +
    '.gv-izle-ico{font-size:2.3em;margin-bottom:4px}' +
    '.gv-izle-kart h3{margin:0 0 8px;font-size:1.1em;color:#fff}' +
    '.gv-izle-kart p{margin:0 0 14px;font-size:.86em;line-height:1.5;color:rgba(255,255,255,.66)}' +
    '.gv-izle-bos{background:rgba(255,255,255,.05);border-radius:10px;padding:10px}' +
    '.gv-izle-liste{display:flex;flex-direction:column;gap:7px;margin-bottom:14px}' +
    '.gv-izle-sec{display:flex;align-items:center;gap:9px;width:100%;padding:10px 12px;' +
      'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:12px;' +
      'color:#fff;font:inherit;font-size:.9em;cursor:pointer;text-align:left;min-height:46px}' +
    '.gv-izle-sec:hover:not(:disabled){background:rgba(0,206,201,.16);border-color:rgba(0,206,201,.5)}' +
    '.gv-izle-sec.secili{background:rgba(0,206,201,.22);border-color:#00cec9}' +
    /* "rengi sönük gözükür" — izin vermeyen oyuncu seçilemez. */
    '.gv-izle-sec.sonuk{opacity:.38;cursor:not-allowed;filter:grayscale(1)}' +
    '.gv-izle-kol{flex:0 0 26px;height:26px;border-radius:50%;background:rgba(255,255,255,.12);' +
      'display:flex;align-items:center;justify-content:center;font-size:.82em;font-weight:700}' +
    '.gv-izle-ad{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
    '.gv-izle-rozet{flex:0 0 auto;font-size:.74em;opacity:.7}' +
    '.gv-izle-durum{flex:0 0 auto;font-size:.76em;opacity:.9}' +
    '.gv-izle-dgm{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}' +
    '#gvIzinBtn.gv-izin-kapali{background:rgba(214,48,49,.18);border-color:rgba(214,48,49,.55);color:#ff9b9b}' +
    /* Telefon: düğmeler tam genişlik, satırlar sıkışmasın. */
    '@media(max-width:560px){' +
      '.gv-izle-kart{padding:16px 13px}' +
      '.gv-izle-sec{font-size:.84em;padding:9px 10px;gap:7px}' +
      '.gv-izle-rozet{display:none}' +
      '.gv-izle-dgm .btn{flex:1}' +
    '}';
  document.head.appendChild(css);
})();
