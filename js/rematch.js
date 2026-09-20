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
      toast('Rövanş reddedildi.', 'info');
      baslatGeriSayim();
    }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }


  // ---------- Soket olayları ----------
  function bagla(s) {
    if (!s || s.__gvRematch) return;
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
      // Bitiş ekranlarını kaldır; yeni oyun durumu zaten sunucudan gelir.
      document.querySelectorAll('.gv-end, .chess-end-overlay').forEach(function (e) { e.remove(); });
    });

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

  // Bitiş ekranı açıldığında geri sayımı başlat (dört ekran da aynı yoldan).
  var gozlemci = new MutationObserver(function () {
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
  setInterval(function () {
    bagla(sock());
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
  bagla(sock());

  // Biçem
  var css = document.createElement('style');
  css.textContent =
    '.gv-rematch-ask{position:fixed;inset:0;z-index:2147483000;background:rgba(4,6,16,.72);display:flex;align-items:center;justify-content:center;padding:16px}' +
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
