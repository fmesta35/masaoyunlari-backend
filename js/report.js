/* GameVerse — KULLANICIYI BİLDİR (şikayet) + kişisel susturma
 *
 *  Kullanıcı isteği (verbatim):
 *   "Oyun içi sohbette 'Kullanıcıyı Bildir' diye şikayet edilirse
 *    gerekçeleri seçebileceği pop-up çıksın. Maddeler masa oyunlarına
 *    uygun bir şekilde uyarlansın. Küfürlü konuşmalar, cinsel konuşmalar,
 *    dolandırıcılık, dini, siyasi vs. tamamen mesaj yoluyla yapılan
 *    rahatsız edici davranışları engelleme amacıyla... Genel sohbet için
 *    de yapılan yorumların kenarlarında üç nokta olsun. İlgili yorum
 *    şikayet edildiğinde o son 1 dakika içerisindeki sohbetin kaydı
 *    panele kayıt edilir aynı mantıkta."
 *
 *  NE YAPAR
 *   1) Gerekçe seçmeli bir pop-up açar (masa oyunlarına uyarlanmış liste).
 *   2) Şikayeti sunucuya yollar; sunucu O ANKİ sohbet dökümünü dondurup
 *      kurucu paneline yazar (oyun içi: masanın son mesajları, genel
 *      sohbet: SON 1 DAKİKA).
 *   3) Şikayet edilen kişiyi şikayet eden için SUSTURUR (kişisel):
 *      mesajları bir daha çizilmez. Susturma bu tarayıcıda saklanır ve
 *      istenirse geri alınabilir — kurucu kararıyla karıştırılmamalıdır.
 *
 *  Not: gerekçe kodları sunucuya İngilizce/kısa kodla gider (kufur,
 *  cinsel, ...); ekranda gösterilen metin buradaki listeden gelir.
 */
(function () {
  'use strict';

  // Masa oyunlarına uyarlanmış gerekçeler (örnek alınan satış platformunun
  // "ürün/fiyat" maddeleri yerine, mesajla yapılan rahatsızlıklar).
  var GEREKCELER = [
    { kod: 'kufur',        ad: 'Küfür, hakaret veya aşağılayıcı sözler' },
    { kod: 'cinsel',       ad: 'Cinsel içerikli konuşma veya taciz' },
    { kod: 'nefret',       ad: 'Nefret söylemi, ırkçılık veya zorbalık' },
    { kod: 'din_siyaset',  ad: 'Dini veya siyasi propaganda / kışkırtma' },
    { kod: 'dolandirici',  ad: 'Dolandırıcılık, bahis veya para talebi' },
    { kod: 'reklam',       ad: 'Reklam, bağlantı veya istenmeyen mesaj (spam)' },
    { kod: 'hile',         ad: 'Hile, danışıklı oyun veya kasıtlı oyun bozma' },
    { kod: 'kisisel_veri', ad: 'Kişisel bilgi paylaşımı / gizlilik ihlali' },
    { kod: 'tehdit',       ad: 'Tehdit veya şiddet içeren davranış' },
    { kod: 'diger',        ad: 'Diğer' }
  ];

  var MUTE_KEY = 'gv-muted-users';     // kişisel susturma listesi (bu tarayıcı)

  function toast(m, t) {
    if (typeof window.toast === 'function') return window.toast(m, t);
    if (window.GV && typeof GV.toast === 'function') return GV.toast(m, t);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function sock() {
    return window.__gvRoomSocket || window.__gvLobbySocket || window.__gvChessSocket || null;
  }

  // ---------- Kişisel susturma ----------
  function mutedList() {
    try { return JSON.parse(localStorage.getItem(MUTE_KEY) || '[]') || []; } catch (_) { return []; }
  }
  function saveMuted(list) {
    try { localStorage.setItem(MUTE_KEY, JSON.stringify(list.slice(-300))); } catch (_) {}
  }
  function muteKey(uid, name) {
    return (Number(uid) > 0) ? ('u:' + Number(uid)) : ('n:' + String(name || '').toLowerCase());
  }
  function isMuted(uid, name) {
    var l = mutedList();
    return l.indexOf(muteKey(uid, name)) !== -1 ||
           (Number(uid) > 0 && l.indexOf('n:' + String(name || '').toLowerCase()) !== -1);
  }
  function mute(uid, name) {
    var l = mutedList();
    var k = muteKey(uid, name);
    if (l.indexOf(k) === -1) l.push(k);
    saveMuted(l);
  }
  function unmute(uid, name) {
    saveMuted(mutedList().filter(function (k) { return k !== muteKey(uid, name); }));
  }

  // ---------- Pop-up ----------
  function kapat() {
    var el = document.getElementById('gvReportModal');
    if (el) el.remove();
  }

  /* hedef: { uid, name, scope:'room'|'global', roomId, gameId } */
  function ac(hedef) {
    hedef = hedef || {};
    kapat();
    var d = document.createElement('div');
    d.id = 'gvReportModal';
    d.className = 'gv-report-bg';
    d.innerHTML =
      '<div class="gv-report-card" role="dialog" aria-modal="true" aria-label="Kullanıcıyı Bildir">' +
        '<div class="gv-report-head">' +
          '<b>🚩 Kullanıcıyı Bildir</b>' +
          '<span class="gv-report-x" id="gvReportClose">✕</span>' +
        '</div>' +
        '<p class="gv-report-sub">Şikayetiniz kuruculara iletilir ve <b>' + esc(hedef.name || 'bu oyuncu') +
          '</b> sizin için susturulur — mesajlarını bir daha görmezsiniz. ' +
          'Şikayetle birlikte o anki sohbet kaydı da kuruculara iletilir. ' +
          'Susturmayı istediğiniz zaman geri alabilirsiniz.</p>' +
        '<div class="gv-report-list" id="gvReportList">' +
          GEREKCELER.map(function (g, i) {
            return '<label class="gv-report-item">' +
              '<input type="radio" name="gvReportReason" value="' + g.kod + '"' + (i === 0 ? '' : '') + '>' +
              '<span>' + esc(g.ad) + '</span></label>';
          }).join('') +
        '</div>' +
        '<label class="gv-report-note-lbl" for="gvReportNote">EKLEMEK İSTEDİKLERİNİZ</label>' +
        '<textarea id="gvReportNote" class="gv-report-note" maxlength="500" ' +
          'placeholder="Kısaca ne yaşadığınızı yazın (isteğe bağlı)"></textarea>' +
        '<button type="button" class="gv-report-send" id="gvReportSend" disabled>🚫 Sustur ve Şikayet Gönder</button>' +
      '</div>';
    document.body.appendChild(d);

    var gonder = d.querySelector('#gvReportSend');
    d.querySelector('#gvReportClose').addEventListener('click', kapat);
    d.addEventListener('click', function (e) { if (e.target === d) kapat(); });
    d.querySelectorAll('input[name="gvReportReason"]').forEach(function (r) {
      r.addEventListener('change', function () { gonder.disabled = false; });
    });

    gonder.addEventListener('click', function () {
      var sec = d.querySelector('input[name="gvReportReason"]:checked');
      if (!sec) return toast('Lütfen bir gerekçe seçin.', 'warning');
      var s = sock();
      if (!s || !s.connected) return toast('Sunucuya bağlanılamadı — şikayet gönderilemedi.', 'warning');
      gonder.disabled = true;
      gonder.textContent = '⏳ Gönderiliyor…';
      s.emit('reportUser', {
        scope: hedef.scope === 'global' ? 'global' : 'room',
        roomId: hedef.roomId || window.__gvActiveRoomId || null,
        gameId: hedef.gameId || (window.st && st.curGame) || null,
        reportedUid: hedef.uid || null,
        reportedName: hedef.name || '',
        reason: sec.value,
        note: (d.querySelector('#gvReportNote').value || '').slice(0, 500)
      }, function (res) {
        if (res && res.ok) {
          mute(hedef.uid, hedef.name);
          kapat();
          toast('🚩 Şikayetiniz kuruculara iletildi. ' + esc(hedef.name || 'Bu oyuncu') +
                ' sizin için susturuldu.', 'success');
          // Susturma anında görünür olsun: açık sohbetleri tazele.
          if (window.GVChat && typeof GVChat.tazele === 'function') GVChat.tazele();
        } else {
          gonder.disabled = false;
          gonder.textContent = '🚫 Sustur ve Şikayet Gönder';
          toast((res && res.error) || 'Şikayet gönderilemedi.', 'warning');
        }
      });
    });
  }

  // ---------- Biçem ----------
  var css = document.createElement('style');
  css.textContent =
    '.gv-report-bg{position:fixed;inset:0;z-index:2147483100;background:rgba(4,6,16,.72);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.gv-report-card{background:#12122b;border:1px solid rgba(255,255,255,.14);border-radius:16px;width:100%;max-width:420px;max-height:88vh;overflow:auto;padding:16px 18px;box-shadow:0 24px 60px rgba(0,0,0,.6)}' +
    '.gv-report-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;color:#fff;font-size:1.02em}' +
    '.gv-report-x{cursor:pointer;color:#9aa0b4;font-size:1.1em}' +
    '.gv-report-sub{color:#b9bed4;font-size:.82em;line-height:1.5;margin:0 0 12px}' +
    '.gv-report-list{display:flex;flex-direction:column;gap:2px;margin-bottom:12px}' +
    '.gv-report-item{display:flex;align-items:flex-start;gap:10px;padding:9px 8px;border-radius:10px;cursor:pointer;color:#e6e8f4;font-size:.88em;line-height:1.35}' +
    '.gv-report-item:hover{background:rgba(255,255,255,.05)}' +
    '.gv-report-item input{margin-top:2px;accent-color:#6c5ce7;flex-shrink:0}' +
    '.gv-report-note-lbl{display:block;font-size:.7em;letter-spacing:.06em;color:#8a90a8;margin-bottom:6px;font-weight:800}' +
    '.gv-report-note{width:100%;min-height:76px;resize:vertical;background:#0d0d22;border:1px solid rgba(255,255,255,.14);border-radius:10px;color:#fff;padding:9px 10px;font-size:.88em;font-family:inherit;outline:none}' +
    '.gv-report-send{width:100%;margin-top:12px;background:linear-gradient(135deg,#6c5ce7,#4834d4);border:none;color:#fff;border-radius:10px;padding:11px 14px;font-weight:800;cursor:pointer;font-size:.92em}' +
    '.gv-report-send:disabled{opacity:.45;cursor:not-allowed}' +
    /* Genel sohbette mesaj kenarındaki üç nokta */
    '.gc-msg{position:relative}' +
    '.gc-dots{position:absolute;top:4px;right:6px;color:#7d8197;cursor:pointer;font-weight:800;line-height:1;padding:2px 4px;border-radius:6px;opacity:0;transition:opacity .15s}' +
    '.gc-msg:hover .gc-dots,.gc-dots:focus{opacity:1}' +
    '.gc-dots:hover{background:rgba(255,255,255,.08);color:#fff}' +
    '.gv-dots-menu{position:fixed;z-index:2147483200;background:#161a2e;border:1px solid rgba(255,255,255,.16);border-radius:10px;padding:4px;box-shadow:0 12px 32px rgba(0,0,0,.55);min-width:180px}' +
    '.gv-dots-menu button{display:block;width:100%;text-align:left;background:none;border:none;color:#e6e8f4;padding:9px 10px;border-radius:8px;cursor:pointer;font-size:.86em}' +
    '.gv-dots-menu button:hover{background:rgba(255,255,255,.08)}';
  (document.head || document.documentElement).appendChild(css);

  // ---------- Üç nokta menüsü (genel sohbet mesajları) ----------
  function menuKapat() {
    var m = document.getElementById('gvDotsMenu');
    if (m) m.remove();
  }
  document.addEventListener('click', function (e) {
    var dots = e.target.closest && e.target.closest('.gc-dots');
    if (!dots) { menuKapat(); return; }
    e.preventDefault(); e.stopPropagation();
    menuKapat();
    var uid = Number(dots.getAttribute('data-uid')) || null;
    var ad = dots.getAttribute('data-name') || '';
    var scope = dots.getAttribute('data-scope') || 'global';
    var r = dots.getBoundingClientRect();
    var m = document.createElement('div');
    m.id = 'gvDotsMenu';
    m.className = 'gv-dots-menu';
    var susturulu = isMuted(uid, ad);
    m.innerHTML =
      '<button type="button" data-a="report">🚩 Kullanıcıyı Bildir</button>' +
      (susturulu
        ? '<button type="button" data-a="unmute">🔔 Susturmayı kaldır</button>'
        : '<button type="button" data-a="mute">🔕 Bu kullanıcıyı sustur</button>');
    document.body.appendChild(m);
    m.style.left = Math.max(8, Math.min(r.right - 180, window.innerWidth - 190)) + 'px';
    m.style.top = Math.min(r.bottom + 4, window.innerHeight - 110) + 'px';
    m.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var a = b.getAttribute('data-a');
      menuKapat();
      if (a === 'report') ac({ uid: uid, name: ad, scope: scope });
      else if (a === 'mute') { mute(uid, ad); toast('🔕 ' + (ad || 'Kullanıcı') + ' susturuldu.', 'info'); if (window.GVChat && GVChat.tazele) GVChat.tazele(); }
      else if (a === 'unmute') { unmute(uid, ad); toast('🔔 Susturma kaldırıldı.', 'success'); if (window.GVChat && GVChat.tazele) GVChat.tazele(); }
    });
  }, true);
  window.addEventListener('resize', menuKapat);
  window.addEventListener('scroll', menuKapat, true);

  window.GVReport = {
    ac: ac,
    gerekceler: function () { return GEREKCELER.slice(); },
    /* Sohbet çizicileri bunu kullanır: susturulmuş kişinin mesajı çizilmez. */
    susturulmus: isMuted,
    sustur: mute,
    susturmaKaldir: unmute,
    /* Üç nokta düğmesinin işaretlemesi (sohbet çizicisi basar). */
    noktaHtml: function (uid, ad, scope) {
      return '<span class="gc-dots" title="Seçenekler" tabindex="0" data-uid="' + (Number(uid) || '') +
             '" data-name="' + esc(ad || '') + '" data-scope="' + (scope || 'global') + '">⋮</span>';
    }
  };
})();
