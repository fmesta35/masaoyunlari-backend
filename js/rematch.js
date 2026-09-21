/* GameVerse — PES ET + RÖVANŞ / YENİDEN OYNA
 *
 *  Kullanıcı isteği (verbatim):
 *   "Oyun içinde pes et butonu da olsun oyun esnasında da basabilir ayrıl
 *    butonuna basar gibi, oyun bittiğinde (yenilgi/zafer olduktan sonra)
 *    lobiye dön butonu yanında rövanş talep et butonu da olsun. Eğer 30
 *    saniye içerisinde tıklama olmazsa otomatik lobiye yönlendirilir veya
 *    karşı rakip odadan çıktıysa diğer oyuncu da otomatik lobiye
 *    yönlendirilir. Eğer rövanş talep ederse oyunculardan biri, diğerine
 *    ekranda uyarı çıkar, kabul ederse aynı odada yeni bir ele
 *    geçebilirler... Bu normal 2 kişiliklerde geçerli. 3-4 kişilik
 *    oyunlarda ise oylamaya sunulur. Herkes kabul ederse ona göre aynı
 *    odada yeni el döngüsüne başlanır (3 el, 1 el, 5 el, 7 el) oyun masa
 *    tipine bağlı olarak."
 *
 *  TASARIM: dört ayrı bitiş ekranı var (arena kartı, satranç, tavla, okey).
 *  Hepsine ayrı ayrı mantık yazmak yerine bu modül:
 *    • '.gv-rematch-btn' sınıflı düğmeleri BELGE düzeyinde dinler
 *      (her bitiş ekranı yalnızca düğmeyi basar, mantık burada),
 *    • soket olaylarını (rematchOffer / rematchDeclined / rematchStarted)
 *      tek yerde karşılar,
 *    • rakipten gelen talebi ekranda KABUL/RED kutusuyla gösterir,
 *    • bitiş ekranı açıkken 30 sn'lik geri sayımı yönetir ve süre dolunca
 *      (ya da rakip odadan çıkınca) lobiye yönlendirir.
 *
 *  PES ET: oyun sürerken üst çubuktaki düğme 'gvResign' yayar. Odadan
 *  ÇIKMAZ (ayrılmaktan farkı budur) — maç kaybedilir ama oyuncu masada
 *  kalır, böylece bitiş ekranından rövanş isteyebilir.
 */
(function () {
  'use strict';

  var OTO_LOBI_SN = 30;      // kullanıcı isteği: 30 sn sonra otomatik lobi
  var geriSayimInt = null;
  var teklifAcik = false;
  var sonDurum = null;       // {acceptedSeats, need, byName}

  function toast(m, t) {
    if (typeof window.toast === 'function') return window.toast(m, t);
    if (window.GV && typeof GV.toast === 'function') return GV.toast(m, t);
  }
  function sock() {
    return window.__gvRoomSocket || window.__gvChessSocket || window.__gvLobbySocket || null;
  }
  /* Sayfadaki BÜTÜN soketler. Oyun istemcileri (room-waiting-fix, chess,
     tavla, okey...) masaya girerken kendi soketlerini kuruyor ve bu
     değişkenleri birbirine devrediyor; tek bir değişkene bakmak yetmez. */
  var SOKET_ANAHTARLARI = ['__gvRoomSocket', '__gvChessSocket', '__gvLobbySocket', '__gvSocket'];
  function tumSoketler() {
    var out = [];
    for (var i = 0; i < SOKET_ANAHTARLARI.length; i++) {
      var s = window[SOKET_ANAHTARLARI[i]];
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }
  function baglaHepsi() {
    var l = tumSoketler();
    for (var i = 0; i < l.length; i++) { try { bagla(l[i]); } catch (_) {} }
  }
  function odaId() {
    return window.__gvActiveRoomId ||
      (window.st && window.st.curRoom && (window.st.curRoom.id || window.st.curRoom)) || null;
  }
  function bitisEkraniAcikMi() {
    return !!document.querySelector('.gv-end, .chess-end-overlay');
  }
  function lobiyeDon() {
    durdurGeriSayim();
    if (typeof window.__gvRealChessLeave === 'function') return window.__gvRealChessLeave();
    if (window.GV && typeof GV.leaveRoom === 'function') return GV.leaveRoom();
    if (window.GV && typeof GV.openLobby === 'function') return GV.openLobby((window.st && st.curGame) || 'okey');
  }

  // ---------- Bitiş ekranındaki 30 sn'lik geri sayım ----------
  function durdurGeriSayim() {
    if (geriSayimInt) { clearInterval(geriSayimInt); geriSayimInt = null; }
  }
  function baslatGeriSayim() {
    durdurGeriSayim();
    var kalan = OTO_LOBI_SN;
    yazGeriSayim(kalan);
    geriSayimInt = setInterval(function () {
      kalan--;
      // Rövanş oylaması sürerken geri sayım DURUR (kullanıcı karar veriyor).
      if (teklifAcik) { yazGeriSayim(null); return; }
      if (!bitisEkraniAcikMi()) { durdurGeriSayim(); return; }
      yazGeriSayim(kalan);
      if (kalan <= 0) { durdurGeriSayim(); lobiyeDon(); }
    }, 1000);
  }
  function yazGeriSayim(kalan) {
    document.querySelectorAll('.gv-rematch-count').forEach(function (el) {
      el.textContent = kalan == null ? 'Rövanş bekleniyor…' : ('Otomatik lobiye dönüş: ' + kalan + ' sn');
    });
  }

  // ---------- Rakipten gelen talep kutusu ----------
  function kutuKapat() {
    teklifAcik = false;
    var k = document.getElementById('gvRematchAsk');
    if (k) k.remove();
    kilitleBitisDugmesi(false);
  }
  function kutuGoster(p) {
    kutuKapat();
    teklifAcik = true;
    var cokKisi = (p.need || 2) > 2;
    var d = document.createElement('div');
    d.id = 'gvRematchAsk';
    d.className = 'gv-rematch-ask';
    d.innerHTML =
      '<div class="gv-rematch-card">' +
        '<div class="gv-rematch-ico">🔄</div>' +
        '<h3>Rövanş Talebi</h3>' +
        '<p><b>' + esc(p.byName || 'Rakibiniz') + '</b> aynı masada yeniden oynamak istiyor.' +
          (cokKisi ? ' Yeni el için <b>masadaki herkesin</b> kabul etmesi gerekir.' : '') + '</p>' +
        (p.rounds ? '<p class="gv-rematch-sub">Masa tipi: ' + esc(String(p.rounds)) + ' el</p>' : '') +
        '<p class="gv-rematch-sub" id="gvRematchVotes"></p>' +
        '<div class="gv-rematch-row">' +
          '<button type="button" class="btn btn-p" id="gvRematchYes">✅ Kabul Et</button>' +
          '<button type="button" class="btn btn-s" id="gvRematchNo">✖ Reddet</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    d.querySelector('#gvRematchYes').addEventListener('click', function () { oyVer(true); });
    d.querySelector('#gvRematchNo').addEventListener('click', function () { oyVer(false); });
    oylariYaz(p);
    /* ÖNCELİK: "Lobiye Dön / Rövanş Talep Et" ekranı açıkken talep gelirse
       karar kutusu öne geçer (kullanıcı isteği). Bitiş ekranının kendi
       rövanş düğmesi bu sırada kilitlenir; iki taraf aynı anda talep edip
       oylamayı birbirine karıştırmasın. Geri sayım da durur. */
    kilitleBitisDugmesi(true);
    yazGeriSayim(null);
  }
  /* Bitiş ekranındaki "Rövanş Talep Et" düğmesini kilitle/aç. */
  function kilitleBitisDugmesi(kilit) {
    document.querySelectorAll('.gv-rematch-btn').forEach(function (b) {
      if (kilit) {
        if (!b.dataset.gvEskiMetin) b.dataset.gvEskiMetin = b.textContent;
        b.disabled = true;
        b.textContent = '🔄 Karar bekleniyor…';
      } else if (b.dataset.gvEskiMetin) {
        b.disabled = false;
        b.textContent = b.dataset.gvEskiMetin;
        delete b.dataset.gvEskiMetin;
      }
    });
  }
  function oylariYaz(p) {
    var el = document.getElementById('gvRematchVotes');
    if (!el || !p) return;
    var kabul = (p.acceptedSeats || []).length, gerek = p.need || 2;
    el.textContent = 'Kabul edenler: ' + kabul + ' / ' + gerek;
  }
  function oyVer(kabul) {
    var s = sock();
    if (s) s.emit('rematchVote', { roomId: odaId(), accept: !!kabul });
    kutuKapat();
    if (kabul) {
      toast('🔄 Rövanş kabul edildi — diğer oyuncular bekleniyor…', 'info');
      yazGeriSayim(null);
    } else {
      /* Kullanıcı isteği: "hayır derse lobiye döner zaten." Reddeden
         oyuncu zaten yeni el oynamak istemiyor; 30 sn beklemek yerine
         doğrudan lobiye alınır (masadaki diğerlerine ret bildirilir). */
      toast('Rövanş reddedildi — lobiye dönülüyor.', 'info');
      setTimeout(lobiyeDon, 600);
    }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }


  // ---------- Soket olayları ----------
  /* Oyun istemcileri soket devrederken socket.off() çağırıyor; bu, bizim
     dinleyicilerimizi de siliyor. Bayrak açık kalsa bile dinleyici yoksa
     yeniden bağlanmalıyız — yoksa rövanş teklifi sessizce kaybolur. */
  function dinleyiciVar(s) {
    if (!s || typeof s.listeners !== 'function') return true;   // ölçemiyoruz
    try { var l = s.listeners('rematchOffer'); return !!(l && l.length); }
    catch (_) { return true; }
  }
  function bagla(s) {
    if (!s) return;
    if (s.__gvRematch && dinleyiciVar(s)) return;
    s.__gvRematch = true;

    s.on('rematchOffer', function (p) {
      if (!p) return;
      sonDurum = p;
      if (p.isSpectator) return;               // izleyici oylamaya katılmaz
      var bendenMi = !!p.youRequested;
      var oyVerdimMi = !!p.youAccepted;
      if (bendenMi || oyVerdimMi) {
        // Talebi ben açtım / zaten kabul ettim: yalnız durumu göster.
        yazGeriSayim(null);
        if (teklifAcik) oylariYaz(p);
        else toast('🔄 Rövanş talebi gönderildi — ' + ((p.acceptedSeats || []).length) + '/' + p.need + ' kabul.', 'info');
        return;
      }
      kutuGoster(p);
    });

    s.on('rematchDeclined', function (p) {
      kutuKapat();
      sonDurum = null;
      if (p && p.reason === 'no_opponent') toast('Masada rövanş yapacak rakip kalmadı.', 'warning');
      else if (p && p.reason === 'player_left') toast('Rakip masadan ayrıldı — rövanş iptal.', 'warning');
      else toast('Rövanş reddedildi.', 'warning');
      if (bitisEkraniAcikMi()) baslatGeriSayim();
    });

    s.on('rematchStarted', function () {
      kutuKapat();
      durdurGeriSayim();
      sonDurum = null;
      toast('🔄 Rövanş kabul edildi — yeni el başlıyor!', 'success');
      paneliKapat();
    });
    /* YENİ EL BAŞLADI: bitiş paneli artık tahtanın İÇİNDE değil, ayrı bir
       yuvada duruyor. Oyunların kendi "bitiş ekranını kaldır" kodu tahtanın
       içinde arıyor ve bulamıyor — panel ekranda asılı kalırdı. Bu yüzden
       yeni oyun başlar başlamaz panel buradan kapatılır. */
    s.on('gameStarted', function () { paneliKapat(); });

    /* RAKİBİN BAĞLANTISI KOPTU: sunucu kopan oyuncuya yeniden bağlanma
       süresi tanıyor. Eskiden bu süre boyunca kalan oyuncuya HİÇBİR bilgi
       gitmiyordu — tahta donuyor, "rakip çıktı" da denmiyordu (kullanıcı
       raporu: "karşının oyundan çıktığına dair bilgi gelmedi"). Artık
       kopma anında bilgi + geri sayım, dönüşte de haber verilir. */
    var kopukSayac = null;
    function kopukTemizle() {
      if (kopukSayac) { clearInterval(kopukSayac); kopukSayac = null; }
    }
    s.on('playerConnectionLost', function (p) {
      if (!p) return;
      kopukTemizle();
      var kalan = Math.max(1, Math.round((Number(p.graceMs) || 30000) / 1000));
      var ad = esc(p.name || 'Rakip');
      toast('📴 ' + ad + ' bağlantısı koptu. ' + kalan +
            ' sn içinde dönmezse maçı sen kazanacaksın.', 'warning');
      kopukSayac = setInterval(function () {
        kalan -= 10;
        if (kalan <= 0) return kopukTemizle();
        toast('⏳ ' + ad + ' hâlâ dönmedi — ' + kalan + ' sn kaldı.', 'info');
      }, 10000);
    });
    s.on('playerReconnected', function (p) {
      kopukTemizle();
      if (p) toast('🔌 ' + esc(p.name || 'Rakip') + ' oyuna geri döndü.', 'success');
    });
    s.on('gameEnded', function () { kopukTemizle(); });
    s.on('playerLeft', function () { kopukTemizle(); });

    s.on('playerResigned', function (p) {
      if (!p) return;
      toast('🏳️ ' + (p.name || 'Bir oyuncu') + ' pes etti.', 'warning');
    });

    // "Pes Et" düğmesinin ne zaman görüneceğini bilmek için oda durumunu
    // izle (istemciler bunu ortak bir yerde tutmuyordu).
    s.on('roomUpdated', function (r) { if (r && r.status) window.__gvRoomStatus = r.status; });
    s.on('gameStarted', function () { window.__gvRoomStatus = 'playing'; });
    s.on('gameEnded', function () { window.__gvRoomStatus = 'finished'; });
    s.on('rematchStarted', function () { window.__gvRoomStatus = 'playing'; });

    // Rakip odadan çıktıysa: rövanş imkânı yok → kısa bir uyarıdan sonra lobi.
    s.on('playerLeft', function () {
      if (!bitisEkraniAcikMi()) return;
      kutuKapat();
      toast('Rakip masadan ayrıldı — lobiye dönülüyor.', 'info');
      setTimeout(lobiyeDon, 2500);
    });
  }

  // ---------- Düğme kancaları (belge düzeyinde) ----------
  document.addEventListener('click', function (e) {
    var rv = e.target.closest && e.target.closest('.gv-rematch-btn');
    if (rv) {
      e.preventDefault();
      var s = sock();
      if (!s || !s.connected) return toast('Sunucuya bağlanılamadı.', 'warning');
      s.emit('rematchRequest', { roomId: odaId() });
      rv.disabled = true;
      rv.textContent = '⏳ Rakip bekleniyor…';
      yazGeriSayim(null);
      return;
    }
    var pes = e.target.closest && e.target.closest('.gv-resign-btn');
    if (pes) {
      e.preventDefault();
      if (!confirm('🏳️ Pes etmek istediğinize emin misiniz?\n\nBu maçı KAYBETMİŞ sayılacaksınız. Masada kalırsınız; isterseniz rövanş talep edebilirsiniz.')) return;
      var s2 = sock();
      if (!s2 || !s2.connected) return toast('Sunucuya bağlanılamadı.', 'warning');
      s2.emit('gvResign', { roomId: odaId() });
    }
  }, true);

  /* ======================================================================
     MAÇ SONU PANELİNİN YERİ
     ----------------------------------------------------------------------
     Kullanıcı isteği: "rövanş ve lobiye dön pop-up'ın dashboardı direkt
     kapatmaması lazım ki oyunu nasıl kaybedip/kazandıklarını anlasınlar...
     oyun dashboard alanlarının sağına, skor tablolarına yakın, dikey."
     Mobil için: "Siz ve rakip sürelerinin üstüne öncelik gelerek
     gösterilmesi... tam örtüşerek."

     Oyunların bitiş ekranı işaretlemesine DOKUNULMAZ: iki kabuk var
     (.gv-end → arena'nın 8 oyunu, .chess-end-overlay → satranç/tavla/okey)
     ve ikisi de olduğu gibi taşınır. Böylece içlerindeki düğme dinleyicileri
     ve geri sayımları çalışmaya devam eder; her oyuna ayrı kod yazılmaz.
     ====================================================================== */
  var YUVA = 'gvEndSlot';
  function yuva() { return document.getElementById(YUVA); }
  function odaKok() { return document.getElementById('pg-room'); }
  function darMi() {
    try { return window.matchMedia('(max-width:1024px)').matches; }
    catch (_) { return (window.innerWidth || 1200) <= 1024; }
  }
  function tamEkranMi() {
    var r = odaKok();
    return !!(r && r.classList.contains('gv-fs'));
  }
  /* Yuvayı ekran genişliğine göre doğru ebeveyne taşır:
       geniş  → .game-layout içinde, tahtayla yan panelin ARASINA
       dar    → .game-side içinde, SÜRE KARTLARININ önüne (kartlar gizlenir)
       dar+tam ekran → yine .game-layout (altta yatay şerit olur; mobil tam
                       ekranda yan panel 86 px'e daraldığı için oraya sığmaz) */
  function yuvayiKonumla() {
    var y = yuva();
    if (!y) return null;
    var yan = document.querySelector('#pg-room .game-side');
    var duzen = document.querySelector('#pg-room .game-layout');
    var hedef, once;
    if (darMi() && !tamEkranMi() && yan) { hedef = yan; once = yan.querySelector('.timers'); }
    else if (duzen) { hedef = duzen; once = yan && yan.parentNode === duzen ? yan : null; }
    else return y;
    if (y.parentNode !== hedef || (once && y.nextSibling !== once)) {
      hedef.insertBefore(y, once || null);
    }
    return y;
  }
  function bitisEkrani() {
    return document.querySelector('.gv-end, .chess-end-overlay');
  }
  function paneliKapat() {
    document.querySelectorAll('.gv-end, .chess-end-overlay').forEach(function (e) {
      try { e.remove(); } catch (_) {}
    });
    var y = yuva(); if (y) y.innerHTML = '';
    var r = odaKok(); if (r) r.classList.remove('gv-bitis-acik');
  }
  function paneliYerlestir() {
    var ekran = bitisEkrani(), r = odaKok();
    // Oda sayfasından çıkıldıysa panel hiç durmamalı (güvenlik ağı).
    if (ekran && !(r && r.classList.contains('active'))) { paneliKapat(); return; }
    var y = yuvayiKonumla();
    if (!ekran || !y) {
      if (r) r.classList.remove('gv-bitis-acik');
      if (y && y.firstChild) y.innerHTML = '';
      return;
    }
    /* Ekran her durum yayınında yeniden çizilebiliyor (satranç tahtayı
       innerHTML ile kuruyor); o yüzden her seferinde yeniden taşınır. */
    if (ekran.parentNode !== y) {
      y.innerHTML = '';
      y.appendChild(ekran);
    }
    ekran.classList.add('gv-bitis-panel');
    if (r) r.classList.add('gv-bitis-acik');
  }
  try {
    window.addEventListener('resize', function () {
      if (bitisEkrani()) paneliYerlestir();
    }, { passive: true });
    window.addEventListener('gv:roomLeft', paneliKapat);
    /* Tam ekrana girip çıkmak yalnız #pg-room'un SINIFINI değiştiriyor;
       bu ne bir 'resize' ne de bir childList değişimi. Panelin yeri tam
       ekranda farklı olduğu için sınıf değişimini ayrıca izliyoruz
       (yoksa panel bir saniye boyunca yanlış yerde/gizli kalıyordu). */
    var oda = odaKok();
    if (oda && window.MutationObserver) {
      var sonTam = tamEkranMi();
      new MutationObserver(function () {
        /* DİKKAT: paneliYerlestir'in kendisi bu elemana sınıf ekliyor;
           koşulsuz tepki verirsek gözlemci kendi kendini tetikleyip
           sonsuz döngüye girer. Yalnız TAM EKRAN durumu değişince çalışır. */
        var simdi = tamEkranMi();
        if (simdi === sonTam) return;
        sonTam = simdi;
        if (bitisEkrani()) paneliYerlestir();
      }).observe(oda, { attributes: true, attributeFilter: ['class'] });
    }
  } catch (_) {}

  // Bitiş ekranı açıldığında geri sayımı başlat (dört ekran da aynı yoldan).
  var gozlemci = new MutationObserver(function () {
    paneliYerlestir();
    if (bitisEkraniAcikMi()) { if (!geriSayimInt && !teklifAcik) baslatGeriSayim(); return; }
    durdurGeriSayim();
    // ⚠ Teklif kutusu BURADA kapatılmaz: kutu gövdeye eklendiği anda bu
    // gözlemci yeniden tetikleniyor ve (bitiş ekranı henüz çizilmemişse)
    // kutuyu doğduğu anda siliyordu. Kutu yalnız oy verilince, teklif
    // reddedilince ya da rövanş başlayınca kapanır.
  });
  function gozleBasla() {
    if (document.body) gozlemci.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gozleBasla, { once: true });
  else gozleBasla();

  // Soketler sonradan kurulabilir: kısa aralıkla yakala.
  // Aynı tikte "Pes Et" düğmesinin görünürlüğü de ayarlanır: yalnız MAÇ
  // SÜRERKEN ve oyuncuysan görünür (izleyici pes edemez, bekleme odasında
  // pes edilecek maç yoktur).
  /* ⚠ ASIL HATA BURADAYDI: dinleyiciler yalnız 1 sn'lik sayaçla ve yalnız
     TEK bir değişkene (sock()) bağlanıyordu. Maç hızlı bitince (pes etme,
     mat) rakibin soketi henüz bağlanmamış oluyor; sunucu 'rematchOffer'
     gönderiyor ama karşı tarafta dinleyen kimse olmadığı için kutu hiç
     açılmıyordu — kullanıcının gördüğü "talep gitti mi belli değil, takılı
     kaldı" durumu tam olarak buydu. Çözüm: soket DOĞDUĞU ANDA bağlanır.
     window.io sarmalanır; her yeni soket anında dinlemeye alınır. */
  function ioKancasi() {
    var asil = window.io;
    if (typeof asil !== 'function' || asil.__gvRematchKanca) return;
    var sarmal = function () {
      var s = asil.apply(this, arguments);
      try { bagla(s); } catch (_) {}
      return s;
    };
    for (var k in asil) { try { sarmal[k] = asil[k]; } catch (_) {} }
    sarmal.__gvRematchKanca = true;
    try { window.io = sarmal; } catch (_) {}
  }
  ioKancasi();

  setInterval(function () {
    ioKancasi();
    baglaHepsi();
    paneliYerlestir();
    var btn = document.getElementById('gvResignBtn');
    if (!btn) return;
    /* Görünürlük DOĞRUDAN O ANKİ EKRANDAN türetilir; tek seferlik bir
       soket olayını yakalamaya bağlı DEĞİLDİR. (Önce 'gameStarted'
       olayına bakıyordu: olay, modül o sokete bağlanmadan önce gelirse
       düğme hiç görünmüyordu — gerçek bir yarış durumu.)
         oda sayfasındayım + izleyici değilim + tahta çizilmiş +
         bekleme odası kapanmış + bitiş ekranı yok  →  maç sürüyor. */
    var odaSayfasi = !!document.querySelector('#pg-room.active');
    var bekleme = !!document.getElementById('gv-real-chess-wait');
    var ba = document.getElementById('boardArea');
    var tahtaVar = !!(ba && ba.children && ba.children.length > 0);
    var bittiDurum = (window.__gvRoomStatus === 'finished' || window.__gvRoomStatus === 'waiting');
    var gorunur = odaSayfasi && !window.__gvIsSpectator && tahtaVar && !bekleme &&
                  !bitisEkraniAcikMi() && !bittiDurum;
    btn.style.display = gorunur ? '' : 'none';
  }, 1000);
  baglaHepsi();

  // Biçem
  var css = document.createElement('style');
  css.textContent =
    '.gv-rematch-ask{position:fixed;inset:0;z-index:2147483600;background:rgba(4,6,16,.72);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.gv-rematch-card{background:#161a2e;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:22px 20px;max-width:380px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.6)}' +
    '.gv-rematch-ico{font-size:2.4em;margin-bottom:6px}' +
    '.gv-rematch-card h3{margin:0 0 8px;font-size:1.15em;color:#fff}' +
    '.gv-rematch-card p{margin:0 0 10px;color:#c9cde0;font-size:.92em;line-height:1.45}' +
    '.gv-rematch-sub{color:#8a90a8!important;font-size:.82em!important}' +
    '.gv-rematch-row{display:flex;gap:10px;justify-content:center;margin-top:14px}' +
    '.gv-rematch-count{display:block;margin-top:8px;font-size:.82em;color:#8a90a8}' +
    /* İKİ DÜĞME AYRI DURSUN: eşit genişlik, aralarında parmak payı ve
       FARKLI renk. Eskiden ikisi de mor ve bitişikti; yanlış düğmeye
       basmak çok kolaydı. Lobiye dön nötr/gri, Rövanş vurgulu yeşil. */
    '.gv-end-row{display:flex!important;flex-direction:column;gap:12px;align-items:stretch;margin-top:16px}' +
    '@media(min-width:460px){.gv-end-row{flex-direction:row;justify-content:center;gap:16px}}' +
    '.gv-end-row .btn{flex:1 1 0;min-width:170px;min-height:44px;margin:0!important;' +
      'font-weight:700;letter-spacing:.01em;white-space:nowrap}' +
    '.gv-end-row .gv-end-btn{background:#2b3145!important;border:1px solid #454c68!important;color:#dfe4f2!important;box-shadow:none!important}' +
    '.gv-end-row .gv-end-btn:hover{background:#353c55!important;border-color:#5a6386!important}' +
    '.gv-end-row .gv-rematch-btn{background:linear-gradient(180deg,#22c98a,#129a67)!important;' +
      'border:1px solid #3ee0a2!important;color:#06231a!important;box-shadow:0 6px 18px rgba(18,154,103,.32)!important}' +
    '.gv-end-row .gv-rematch-btn:hover{filter:brightness(1.06)}' +
    '.gv-end-row .gv-rematch-btn:disabled{filter:grayscale(.5);opacity:.75}' +
    '.gv-rematch-btn{margin-left:0}';
  (document.head || document.documentElement).appendChild(css);

  window.GVRematch = {
    // Bitiş ekranlarının basacağı ortak düğme + geri sayım satırı.
    butonHtml: function () {
      return '<button type="button" class="btn btn-p gv-rematch-btn">🔄 Rövanş Talep Et</button>';
    },
    /* Rövanş oylaması sürerken bitiş ekranlarının KENDİ geri sayımları
       duraklasın (oyuncu karar verirken lobiye atılmasın). Dört bitiş
       ekranı da tik başına bunu sorar. */
    beklemede: function () { return teklifAcik || !!sonDurum; },
    geriSayimHtml: function () {
      return '<span class="gv-rematch-count">Otomatik lobiye dönüş: ' + OTO_LOBI_SN + ' sn</span>';
    },
    lobiyeDon: lobiyeDon,
    OTO_LOBI_SN: OTO_LOBI_SN
  };
})();
