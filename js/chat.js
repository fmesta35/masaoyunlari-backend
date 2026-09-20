/* GameVerse — Sohbet (masa içi + genel): İKİ AYRI KANAL
 *
 *  ⚠ KULLANICI İSTEĞİ (verbatim): "Masa / oyun içi sohbeti ile genel
 *  sohbetler tamamen ayrı şeyler. birbirinden bağımsız ilerlet. Sohbetler
 *  aynı gösteriyor."
 *
 *  ESKİ (HATALI) DAVRANIŞ: tek bir `mode` değişkeni vardı; oyuncu masaya
 *  oturunca çekmece de 'room' moduna geçiyor, böylece masa mesajları HEM
 *  masadaki gömülü kutuda HEM de mesaj balonundaki çekmecede görünüyordu —
 *  yani iki arayüz aynı sohbeti gösteriyordu, genel sohbete masadayken
 *  hiç erişilemiyordu.
 *
 *  YENİ (DOĞRU) DAVRANIŞ — iki kanal artık TAMAMEN bağımsız:
 *    • Mesaj balonu / çekmece (#gvChatPanel)  → HER ZAMAN GENEL SOHBET.
 *      Oyuncu masada otururken bile balona tıklayıp genel sohbete
 *      yazabilir/okuyabilir.
 *    • Masadaki gömülü kutu (#gameChat)       → HER ZAMAN MASA SOHBETİ
 *      (yalnız o odanın kanalı; #gcInput ile scope:'room' gönderilir).
 *    • Masa sohbeti aç/kapa anahtarı YALNIZ gömülü kutuyu susturur; genel
 *      sohbet bundan hiç etkilenmez.
 *
 *  Kurallar (sunucu da doğrular):
 *   - Genel sohbete yazmak üyelere özeldir; misafirler akışı okuyabilir.
 *   - Masa sohbetine masadaki herkes (ziyaretçiler dahil) yazabilir.
 *   - Son 50 mesaj sunucuda tutulur; panele geçmiş yüklenir.
 *
 *  Bu modül kendi başına çalışır: soketleri (oda ve/veya lobi) 1 sn'lik
 *  taramayla bulur, dinleyicileri her sokete bir kez bağlar.
 */
(function () {
  'use strict';

  let built = false;
  let open = false;
  // ÇEKMECE HER ZAMAN GENEL SOHBETTİR — bu değişken artık asla 'room'
  // olmaz. (Sunucuya gönderilen scope ve geçmiş isteği bunu kullanır.)
  const mode = 'global';
  // Masadaki gömülü kutunun (#gameChat) bağlı olduğu oda; masada
  // değilken null. Çekmeceyi ETKİLEMEZ.
  let curRoomId = null;
  let attachedSock = null;
  let lastHistKey = '';       // genel sohbet geçmişi anahtarı (çekmece)
  let lastRoomHistKey = '';   // masa sohbeti geçmişi anahtarı (gömülü kutu)
  let unread = 0;             // yalnız GENEL sohbetin okunmamışları
  const seenIds = new Set(); // çift soketten GELEN aynı mesajın yankısını önler

  /* ---------- SOHBET AÇ/KAPA (kişisel tercih, bu tarayıcıya özel) ----------
     Kullanıcı isteği: oyuncular oyun içinde birbirlerinin mesajlarını
     görmek istemezse tek dokunuşla susturabilsin. KAPALIYKEN oda sohbeti
     bu kullanıcıya HİÇ çizilmez (mesaj sunucudan gelmeye devam eder,
     yalnızca gösterilmez) ve okunmamış rozeti de artmaz. Yeniden açınca
     akış o andan itibaren görünür — geçmiş sunucudan tazelenir.
     Tercih localStorage'da tutulur, sayfa yenilense de korunur. */
  const MUTE_KEY = 'gv-chat-muted';
  let sohbetKapali = (function () {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (_) { return false; }
  })();

  function anahtarUygula() {
    const btn = document.getElementById('gvChatToggle');
    if (btn) {
      btn.classList.toggle('on', !sohbetKapali);
      btn.classList.toggle('off', sohbetKapali);
      btn.setAttribute('aria-checked', sohbetKapali ? 'false' : 'true');
      const txt = btn.querySelector('.chat-switch-txt');
      if (txt) txt.textContent = sohbetKapali ? 'Masa Sohbeti Kapalı' : 'Masa Sohbeti Açık';
    }
    const liste = document.getElementById('gameChat');
    const kapaliNot = document.getElementById('gvChatOff');
    const girdiSatiri = document.getElementById('gvChatInputRow');
    if (liste) { liste.hidden = sohbetKapali; if (sohbetKapali) liste.innerHTML = ''; }
    if (kapaliNot) kapaliNot.hidden = !sohbetKapali;
    if (girdiSatiri) girdiSatiri.hidden = sohbetKapali;
    // NOT: çekmece (#gvChatList) artık GENEL sohbettir; masa anahtarı onu
    // hiçbir koşulda temizlemez/kapatmaz.
  }
  function anahtarBagla() {
    const btn = document.getElementById('gvChatToggle');
    if (!btn || btn.__gvBagli) return;
    btn.__gvBagli = true;
    btn.addEventListener('click', () => {
      sohbetKapali = !sohbetKapali;
      try { localStorage.setItem(MUTE_KEY, sohbetKapali ? '1' : '0'); } catch (_) {}
      anahtarUygula();
      if (!sohbetKapali) { lastHistKey = ''; reloadHistory(true); }
      // ⚠ NOT (kullanıcı isteği): bu anahtar YALNIZ bu masanın oyun içi
      // sohbetini susturur — genel sohbet bundan ETKİLENMEZ, kullanıcı
      // istediği an mesaj balonuna tıklayıp genel sohbete erişebilir.
      // Mesaj metni bunu açıkça belirtir ki "genel sohbet de kapandı"
      // yanlış izlenimine yol açmasın.
      toast(sohbetKapali ? '🔕 Masa sohbeti kapatıldı — bu masadaki mesajlar gösterilmeyecek (genel sohbet etkilenmez).' : '🔔 Masa sohbeti açıldı.',
            sohbetKapali ? 'warning' : 'success');
    });
  }

  /* ---------- KURUCU YAPTIRIMI (sohbet kısıtlaması) ----------
     Kurucu bir üyeyi susturduğunda o üye HEM masa HEM genel sohbete
     yazamaz. Bu KİŞİSEL anahtardan (yukarısı) tamamen ayrıdır:
      * anahtar  = kullanıcının kendi tercihi, istediği an geri alır
      * yaptırım = kurucunun kararı, kullanıcı kaldıramaz
     Son söz her zaman SUNUCUNUNDUR (mesaj yine de gönderilirse reddedilir);
     buradaki kilit yalnızca kullanıcıya durumu AÇIKÇA göstermek içindir. */
  let yaptirim = null;          // { bitis, sebep, aciklama } | null
  let yaptirimSoruldu = false;  // /api/sanctions/me bir kez sorulsun

  function backendUrl() {
    return String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  }
  function yaptirimBitti() {
    return !!(yaptirim && yaptirim.bitis != null && Number(yaptirim.bitis) <= Date.now());
  }
  function susturulduMu() { if (yaptirimBitti()) yaptirim = null; return !!yaptirim; }

  // Sayfa açılışında / girişten sonra kendi durumunu sor: kullanıcı
  // kısıtlıyken sekmeyi yenilese de kutuyu KİLİTLİ bulur.
  function yaptirimSor() {
    if (yaptirimSoruldu || !isMember()) return;
    yaptirimSoruldu = true;
    let tok = null;
    try { tok = localStorage.getItem('gv-auth-token'); } catch (_) {}
    if (!tok) { yaptirimSoruldu = false; return; }
    fetch(backendUrl() + '/api/sanctions/me', {
      headers: { Authorization: 'Bearer ' + tok, 'X-GV-Token': tok }
    }).then(r => r.json()).then(d => {
      yaptirim = (d && d.ok && d.yaptirim) ? d.yaptirim : null;
      yaptirimUygulaUI();
      // Kullanıcı kısıtlıyken siteye YENİDEN girdiyse (bildirim anında
      // çevrimdışıydı) durumu bir kez açıkça hatırlat: sohbet kutusu yalnız
      // masadayken görünür, ana sayfadaki kullanıcı yoksa hiçbir şey görmezdi.
      if (yaptirim) toast('🔇 ' + (yaptirim.aciklama || 'Sohbet yetkiniz kısıtlandı.'), 'warning');
    }).catch(() => { yaptirimSoruldu = false; });
  }

  // Kısıtlı kullanıcının masa sohbetinde gördüğü AÇIKLAYICI kutu.
  function yaptirimUygulaUI() {
    const kisitli = susturulduMu();
    let ban = document.getElementById('gvChatBan');
    const inputRow = document.getElementById('gvChatInputRow');
    if (kisitli && !ban && inputRow && inputRow.parentNode) {
      ban = document.createElement('div');
      ban.className = 'chat-off chat-ban';
      ban.id = 'gvChatBan';
      inputRow.parentNode.insertBefore(ban, inputRow);
    }
    if (ban) {
      ban.hidden = !kisitli;
      if (kisitli) {
        ban.innerHTML = '<div class="chat-off-ico">🔇</div>' +
          '<div class="chat-off-t">Sohbet Kısıtlandı</div>' +
          '<div class="chat-off-s">' + esc(yaptirim.aciklama ||
            ('Oyun içi ve genel sohbete mesaj gönderemezsiniz.' + (yaptirim.sebep ? ' Gerekçe: ' + yaptirim.sebep : ''))) +
          '</div>';
      }
    }
    // Masa içi kutu ve gezinme panelindeki yazma alanı kilitlenir.
    const gi = document.getElementById('gcInput');
    if (gi) {
      gi.disabled = kisitli;
      if (kisitli) gi.placeholder = 'Sohbet kısıtlandı';
      else if (gi.placeholder === 'Sohbet kısıtlandı') gi.placeholder = 'Mesaj...';
    }
    if (inputRow && kisitli) inputRow.hidden = true;
  }

  function st8() { return window.st || {}; }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }
  function toast(msg, type) {
    if (window.GV && typeof window.GV.toast === 'function') { try { window.GV.toast(msg, type || 'info'); return; } catch (_) {} }
  }

  function isMember() {
    const s = st8();
    if (s.isGuest === false) return !!(s.user && (s.user.id || s.user.userId || s.user.username || s.user.email || s.user.name));
    return false;
  }
  function memberKey() {
    const u = st8().user || {};
    const stable = u.id || u.userId || u.username || u.email || u.name;
    return stable ? 'user:' + String(stable) : null;
  }
  function myName() { return (st8().user && (st8().user.name || st8().user.username)) || 'Oyuncu'; }

  function isRoomPage() {
    const pg = document.getElementById('pg-room');
    return !!(pg && pg.classList.contains('active')) || String(st8().curPage || '').toLowerCase() === 'room';
  }
  function roomIdNow() {
    const s = st8();
    const a = [window.__gvActiveRoomId, window.__gvActiveRoom && window.__gvActiveRoom.id,
      s.roomWaitingState && (s.roomWaitingState.room && s.roomWaitingState.room.id || s.roomWaitingState.roomId),
      localStorage.getItem('gv-room-id')];
    for (const x of a) { if (x !== undefined && x !== null && String(x) !== '') return String(x); }
    return null;
  }

  function gameTitle() {
    const t = (document.getElementById('grTitle') && document.getElementById('grTitle').textContent) || '';
    if (/okey/i.test(t) && !/101/.test(t)) return '🀄';
    if (/tavla/i.test(t)) return '🎲';
    if (/satran/i.test(t)) return '♟️';
    return '💬';
  }

  // ---------- UI ----------
  function css() {
    if (document.getElementById('gv-chat-style')) return;
    const s = document.createElement('style');
    s.id = 'gv-chat-style';
    s.textContent = `
      /* MİNİK BALONCUK: yalnız ikon, sağ kenara yapışık sekme. Büyük mor
         "Sohbet" hapı masa satırlarının (Katıl düğmesinin) üstüne binip
         tıklamayı engelliyordu; 42px'lik kenar sekmesi bu sorunu bitirir. */
      #gvChatFab{position:fixed;right:0;bottom:96px;z-index:2147482000;background:linear-gradient(135deg,#6c5ce7,#4834d4);color:#fff;border:none;border-radius:13px 0 0 13px;width:42px;height:48px;padding:0;font-size:19px;font-weight:800;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:.95;transition:transform .18s ease,opacity .18s ease}
      #gvChatFab:hover{opacity:1;transform:translateX(-3px)}
      #gvChatFab .gv-chat-badge{position:absolute;top:-7px;left:-7px;background:#e74c3c;border:2px solid #12122b;border-radius:20px;padding:1px 6px;font-size:.62em;line-height:1.35;display:none}
      /* SAĞDAN ÇEKMECE PANEL: sağ kenara dayalı, x ekseninde kayarak açılır/
         kapanır. Kapalıyken ekranın dışında durur; hiçbir şeyin üstünü örtmez. */
      #gvChatPanel{position:fixed;right:0;top:0;bottom:0;height:100vh;height:100dvh;z-index:2147482001;width:340px;max-width:94vw;background:#12122b;border-left:1px solid rgba(255,255,255,.14);border-radius:0;box-shadow:-18px 0 50px rgba(0,0,0,.65);display:flex;flex-direction:column;overflow:hidden;transform:translateX(106%);visibility:hidden;transition:transform .28s ease,visibility 0s linear .28s}
      #gvChatPanel.open{transform:translateX(0);visibility:visible;transition:transform .28s ease}
      #gvChatPanel .gc-head{padding:10px 12px;background:rgba(255,255,255,.05);display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.08)}
      #gvChatPanel .gc-head b{font-size:.95em}
      #gvChatPanel .gc-head span{cursor:pointer;color:#9aa0b4;font-size:1.1em}
      #gvChatPanel .gc-list{flex:1;overflow-y:auto;padding:10px;display:flex;flex-direction:column;gap:7px}
      #gvChatPanel .gc-msg{font-size:.85em;line-height:1.35;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);padding:7px 9px;border-radius:9px;color:#e6e8f4;word-break:break-word}
      #gvChatPanel .gc-msg .gc-nm{color:#f9ca24;font-weight:800;margin-right:6px}
      #gvChatPanel .gc-msg .gc-tm{color:#7d8197;font-size:.72em;margin-left:6px}
      #gvChatPanel .gc-msg.mine{background:rgba(108,92,231,.18);border-color:rgba(108,92,231,.45)}
      #gvChatPanel .gc-empty{color:#7d8197;font-size:.8em;text-align:center;margin-top:22px}
      #gvChatPanel .gc-input{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.08)}
      #gvChatPanel .gc-input input{flex:1;background:#0d0d22;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;padding:9px 10px;font-size:.9em;outline:none}
      #gvChatPanel .gc-input input:disabled{opacity:.55}
      #gvChatPanel .gc-input button{background:linear-gradient(135deg,#00b894,#00a381);border:none;color:#fff;border-radius:8px;padding:0 14px;font-weight:800;cursor:pointer}
      #gvChatPanel .gc-input button:disabled{opacity:.45;cursor:not-allowed}
      #gvChatPanel .gc-note{font-size:.68em;color:#7d8197;padding:0 10px 8px}
      /* Son masa satırı, kenardaki sohbet sekmesinin bandından yukarı
         kaydırılabilsin — "Katıl düğmesine tıklanamıyor" şikayetinin kök
         nedeni listenin sonunda baloncuğun satırın üstünde kalmasıydı. */
      .rooms-list{padding-bottom:132px;scroll-padding-bottom:132px}
    `;
    document.head.appendChild(s);
  }

  function els() {
    if (built) return;
    built = true;
    css();
    const fab = document.createElement('button');
    fab.id = 'gvChatFab';
    fab.type = 'button';
    fab.innerHTML = '💬<span class="gv-chat-badge" id="gvChatBadge"></span>';
    fab.title = 'Sohbeti aç/kapat';
    fab.setAttribute('aria-label', 'Sohbet panelini aç/kapat');
    fab.addEventListener('click', () => {
      open = !open;
      panel().classList.toggle('open', open);
      if (open) { unread = 0; paintBadge(); scrollEnd(); reloadHistory(true); }
    });
    document.body.appendChild(fab);

    const p = document.createElement('div');
    p.id = 'gvChatPanel';
    p.innerHTML =
      '<div class="gc-head"><b id="gvChatTitle">🌐 Genel Sohbet</b><span id="gvChatClose">✕</span></div>' +
      '<div class="gc-list" id="gvChatList"></div>' +
      '<div class="gc-input"><input id="gvChatText" type="text" maxlength="240" placeholder="Mesajınızı yazın..."><button id="gvChatSend" type="button">➤</button></div>' +
      '<div class="gc-note">💡 Mesajlar 1 dk sonra silinir • ard arda en az 5 sn bekleyin • link ve küfür yasaktır. Yalnızca üyeler yazabilir.</div>';
    document.body.appendChild(p);
    p.querySelector('#gvChatClose').addEventListener('click', () => { open = false; p.classList.remove('open'); });
    const send = () => sendNow();
    p.querySelector('#gvChatSend').addEventListener('click', send);
    p.querySelector('#gvChatText').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }

  const panel = () => document.getElementById('gvChatPanel');

  function paintBadge() {
    const b = document.getElementById('gvChatBadge');
    if (!b) return;
    b.style.display = unread > 0 ? '' : 'none';
    b.textContent = unread > 9 ? '9+' : String(unread);
  }

  function scrollEnd() {
    const list = document.getElementById('gvChatList');
    if (list) list.scrollTop = list.scrollHeight;
  }

  /* ŞİKAYET / KİŞİSEL SUSTURMA (js/report.js ile ortak)
     Kullanıcı, bir oyuncuyu bildirdiğinde o kişi KENDİSİ için susturulur:
     mesajları bir daha çizilmez. Susturma yalnız bu tarayıcıdadır ve
     kullanıcı istediğinde geri alabilir — kurucunun yaptırımıyla
     karıştırılmamalıdır. */
  function susturulmusMu(m) {
    return !!(window.GVReport && window.GVReport.susturulmus &&
              window.GVReport.susturulmus(m && m.uid, m && m.name));
  }
  function suz(messages) {
    return (messages || []).filter(m => !susturulmusMu(m));
  }
  // Genel sohbet mesajının kenarındaki üç nokta (bildir / sustur menüsü).
  function noktaHtml(m, scope) {
    if (!window.GVReport || !window.GVReport.noktaHtml) return '';
    if ((m.name || '') === myName()) return '';        // kendi mesajım
    return window.GVReport.noktaHtml(m.uid, m.name, scope || 'global');
  }

  function renderList(messages) {
    const list = document.getElementById('gvChatList');
    if (!list) return;
    // NOT: burası YALNIZ genel sohbeti çizer. Masa sohbeti anahtarı bu
    // listeyi etkilemez (iki kanal tamamen ayrıdır).
    // Süresi dolmuş genel sohbet mesajları istemcide de gösterilmez.
    if (mode === 'global' && messages) messages = messages.filter(m => Date.now() - Number(m.ts || 0) < 60000);
    messages = suz(messages);
    if (!messages || !messages.length) {
      list.innerHTML = '<div class="gc-empty">Henüz mesaj yok — ilk mesajı siz yazın! 👋</div>';
      return;
    }
    list.innerHTML = messages.map(m => {
      const time = new Date(Number(m.ts) || Date.now());
      const hm = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2);
      const mine = (m.name || '') === myName();
      const uid = Number(m.uid) > 0 ? ` data-uid="${Number(m.uid)}"` : '';
      const ts = Number(m.ts) || Date.now();
      return `<div class="gc-msg${mine ? ' mine' : ''}" data-ts="${ts}">${noktaHtml(m, 'global')}<span class="gc-nm"${uid}>${esc(m.name)}</span>${esc(m.text)}<span class="gc-tm">${hm}</span></div>`;
    }).join('');
    scrollEnd();
  }

  function appendMsg(m) {
    if (susturulmusMu(m)) return;                      // susturulmuş kişi çizilmez
    const list = document.getElementById('gvChatList');
    if (!list) return;
    const empty = list.querySelector('.gc-empty');
    if (empty) empty.remove();
    const time = new Date(Number(m.ts) || Date.now());
    const hm = ('0' + time.getHours()).slice(-2) + ':' + ('0' + time.getMinutes()).slice(-2);
    const mine = (m.name || '') === myName();
    const uid = Number(m.uid) > 0 ? ` data-uid="${Number(m.uid)}"` : '';
    const div = document.createElement('div');
    div.className = 'gc-msg' + (mine ? ' mine' : '');
    div.dataset.ts = Number(m.ts) || Date.now();
    div.innerHTML = `${noktaHtml(m, 'global')}<span class="gc-nm"${uid}>${esc(m.name)}</span>${esc(m.text)}<span class="gc-tm">${hm}</span>`;
    list.appendChild(div);
    scrollEnd();
  }

  // Genel sohbette 60 sn'i geçen mesajları panelden kaldır (sunucu da süzer).
  function pruneOld() {
    if (mode !== 'global') return;
    const list = document.getElementById('gvChatList');
    if (!list) return;
    const cutoff = Date.now() - 60 * 1000;
    list.querySelectorAll('.gc-msg[data-ts]').forEach(el => {
      if (Number(el.dataset.ts || 0) < cutoff) el.remove();
    });
  }
  setInterval(pruneOld, 4000);

  // Oyun sayfasındaki KART sohbetine de yansıt (eski yerel kutunun yerine
  // gerçek oda sohbeti akar; iki arayüz de aynı akışı gösterir).
  function paintGameChat(messages) {
    const list = document.getElementById('gameChat');
    if (!list) return;
    if (sohbetKapali) { list.innerHTML = ''; return; }   // kapalıyken hiç çizilmez
    list.innerHTML = suz(messages).map(m => {
      const uid = Number(m.uid) > 0 ? ` data-uid="${Number(m.uid)}"` : '';
      return `<div class="chat-msg">${noktaHtml(m, 'room')}<div class="avatar sm">${esc((m.name || 'O').substring(0, 1))}</div><div class="m-body"><div class="m-name" style="color:var(--accent)"${uid}>${esc(m.name)}</div><div>${esc(m.text)}</div></div></div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  }
  function mirrorToGameChat(m) {
    if (sohbetKapali) return;                            // kapalıyken hiç çizilmez
    if (susturulmusMu(m)) return;                        // susturulmuş kişi çizilmez
    const list = document.getElementById('gameChat');
    if (!list || m.scope !== 'room') return;
    if (curRoomId && String(m.roomId) !== String(curRoomId)) return;
    const nm = m.name || 'Oyuncu';
    const uid = Number(m.uid) > 0 ? ` data-uid="${Number(m.uid)}"` : '';
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `${noktaHtml(m, 'room')}<div class="avatar sm">${esc(nm.substring(0, 1))}</div><div class="m-body"><div class="m-name" style="color:var(--accent)"${uid}>${esc(nm)}</div><div>${esc(m.text)}</div></div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  // ---------- Soket ----------
  function pickSocket() {
    return window.__gvLobbySocket || window.__gvRoomSocket || window.__gvChessSocket || null;
  }

  /* İki kanal iki FARKLI soketten gelebilir: masa mesajları oda soketine,
     genel mesajlar lobi soketine düşer. Bu yüzden eldeki TÜM soketlere
     dinleyici bağlanır (attach kendi içinde yinelemeye karşı korumalı).
     Eskiden yalnız "seçilen" tek sokete bağlanıyordu; masadayken lobi
     soketi dinlenmediği için genel sohbet masada sessiz kalıyordu. */
  function attachAll() {
    [window.__gvRoomSocket, window.__gvLobbySocket, window.__gvChessSocket]
      .forEach(s => { if (s) { attach(s); selamla(s); } });
  }

  /* GENEL SOHBET HAZIR BİR SOKET BEKLİYORDU — ve çoğu zaman yoktu.
     Lobi soketi yalnızca bir OYUN LOBİSİ açıldığında kuruluyor; ana
     sayfadan sohbeti açan kullanıcı ne mesaj gönderebiliyor ("Bağlantı
     yok" uyarısı) ne de başkalarının mesajlarını görebiliyordu — sohbet
     boş görünüyordu. Sohbet artık soketi gerektiğinde KENDİ kurar ve
     kimliğini bildirir. */
  let kurulumBasladi = false;
  // ⚠ HATA DÜZELTMESİ (kullanıcı raporu: "yaptırım uyguladım ama kullanıcıya
  // bildirim gitmemiş, kısıtlama da uygulanmamış — her yerden rahatça
  // yazabiliyor"). Kök neden: bu fonksiyon kendi zayıf authHello'sunu
  // gönderiyordu — yalnızca {token}, HİÇ imzalı belge (attestation)
  // eklemiyordu. Sunucu tarafında {token}-yalnız authHello, Render'ın
  // Yöncü PHP'sine GİDEN (remote.me) yavaş/DDoS korumasına takılabilen
  // "klasik yol"u zorluyor — soğuk başlangıçta veya DDoS koruması
  // devredeyken socket.userId HİÇ çözülmeyebiliyordu. O olmadan hem
  // yaptırım denetimi (uid0 = socket.userId) hem de bildirim hedefi
  // (authApi.emitToUser → online Map'te uid araması) sessizce boş kalır.
  // js/auth.js'in GVAuth.authHello'su ise İMZALI BELGEYİ de ekler; bu
  // Render'da YERİNDE (PHP'ye hiç gitmeden) doğrulanır, yani DDoS
  // korumasından bağımsızdır — odaya katılma gibi diğer tüm akışlar zaten
  // bunu kullanıyordu, sohbet soketi kullanmıyordu. Artık aynı güvenilir
  // yolu paylaşıyor.
  function selamla(sock) {
    if (!sock) return;
    let tok = null;
    try { tok = localStorage.getItem('gv-auth-token'); } catch (_) {}
    if (tok) {
      // Üye: SADECE GVAuth'un güvenilir (imzalı belge önceliği) authHello'sunu
      // kullan — kendi zayıf {token}-yalnız yolumuzu ASLA göndermeyelim (bu,
      // DDoS korumasına takılabilen yavaş yolu zorlardı). GVAuth sayfa
      // açılışında henüz yüklenmemiş olabilir (çok kısa bir pencere); bu
      // durumda bu turu sessizce atlarız — chat.js'in kendi tick() döngüsü
      // saniyede bir tekrar dener, GVAuth hazır olur olmaz doğru yoldan
      // selamlar (bkz. js/auth.js: authHelloAll da aynı soketi ayrıca 1.5
      // sn'de bir tarar).
      if (window.GVAuth && typeof window.GVAuth.authHello === 'function') {
        window.GVAuth.authHello(sock);
      }
      return;
    }
    // Misafir: yalnız görünen ad/anahtar bildirilir — üyelik yetkisi
    // vermez, sadece isim gösterimi içindir.
    const hello = () => {
      try { sock.emit('authHello', { userKey: memberKey(), name: myName() }); } catch (_) {}
    };
    if (sock.connected) hello();
    if (!sock.__gvChatHello) { sock.__gvChatHello = true; sock.on('connect', hello); }
  }
  function ensureSocket() {
    const varOlan = pickSocket();
    if (varOlan) { attach(varOlan); selamla(varOlan); return varOlan; }
    if (kurulumBasladi || !window.io) return null;
    kurulumBasladi = true;
    try {
      const backend = String(window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
      const sock = window.io(backend, {
        transports: ['websocket', 'polling'],
        reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 800
      });
      window.__gvLobbySocket = window.__gvLobbySocket || sock;
      attach(sock);
      selamla(sock);
      sock.on('connect', () => reloadHistory(true));
      if (sock.connected) reloadHistory(true);
      return sock;
    } catch (_) { return null; }
  }

  function attach(sock) {
    if (!sock || sock.__gvChat) return;
    sock.__gvChat = true;
    sock.on('chatMessage', msg => {
      if (!msg) return;
      if (msg.id && seenIds.has(msg.id)) return; // iki soket de açıksa yankı düşmesin
      if (msg.id) { seenIds.add(msg.id); if (seenIds.size > 300) { const it = seenIds.values(); for (let i = 0; i < 150; i++) seenIds.delete(it.next().value); } }
      // ---- İKİ KANAL, İKİ AYRI HEDEF (kullanıcı isteği) ----
      // MASA mesajı yalnız masadaki gömülü kutuya gider; çekmeceye ASLA
      // düşmez ve genel sohbetin okunmamış rozetini artırmaz.
      if (msg.scope === 'room') {
        if (sohbetKapali) return;            // masa sohbeti susturulduysa çizilmez
        mirrorToGameChat(msg);
        return;
      }
      // GENEL mesaj yalnız çekmeceye gider; masadaki kutuya karışmaz.
      if (open) appendMsg(msg);
      else { unread++; paintBadge(); }
    });
    sock.on('chatRejected', p => {
      // Sunucu yaptırım yüzünden reddettiyse durumu hemen yansıt (kullanıcı
      // başka bir cihazdan kısıtlanmış olabilir).
      if (p && p.yaptirim) { yaptirim = Object.assign({ aciklama: p.reason }, p.yaptirim); yaptirimUygulaUI(); }
      toast('💬 ' + ((p && p.reason) || 'Mesaj gönderilemedi.'), 'warning');
    });
    // KURUCU YAPTIRIMI — anlık bildirim (server.js /api/admin/sanctions).
    sock.on('chatSanction', p => {
      if (!p) return;
      yaptirim = { bitis: (p.bitis == null ? null : Number(p.bitis)), sebep: String(p.sebep || ''), aciklama: String(p.aciklama || '') };
      yaptirimUygulaUI();
      toast('🔇 ' + (p.aciklama || 'Sohbet yetkiniz kısıtlandı.'), 'warning');
    });
    sock.on('chatSanctionLifted', () => {
      yaptirim = null;
      yaptirimUygulaUI();
      const ir = document.getElementById('gvChatInputRow');
      if (ir && !sohbetKapali) ir.hidden = false;
      toast('✅ Sohbet kısıtlamanız kaldırıldı.', 'success');
    });
    sock.on('connect', () => reloadHistory(true));
  }

  /* İKİ KANAL, İKİ AYRI GEÇMİŞ:
       • genel sohbet geçmişi  → çekmece (#gvChatList)
       • masa sohbeti geçmişi  → masadaki gömülü kutu (#gameChat)
     Eskiden tek bir geçmiş çekilip HER İKİ arayüze de basılıyordu; masaya
     oturan oyuncu çekmecede de masa mesajlarını görüyordu. */
  function reloadHistory(force) {
    const sock = pickSocket();
    if (!sock || !sock.connected) return;
    if (force || 'global:*' !== lastHistKey) {
      lastHistKey = 'global:*';
      sock.emit('chatHistory', { scope: 'global' }, res => {
        if (!res || !res.ok) return;
        renderList(res.messages || []);
      });
    }
    reloadRoomHistory(force);
  }

  function reloadRoomHistory(force) {
    if (!curRoomId) return;
    // Masa geçmişi ODA soketinden istenir (sunucu socket.roomId ile
    // yetkilendirir); yoksa eldeki sokete düşülür.
    const sock = window.__gvRoomSocket || pickSocket();
    if (!sock || !sock.connected) return;
    const key = 'room:' + curRoomId;
    if (!force && key === lastRoomHistKey) return;
    lastRoomHistKey = key;
    const istenen = curRoomId;
    sock.emit('chatHistory', { scope: 'room', roomId: istenen }, res => {
      if (!res || !res.ok) return;
      // Yanıt gecikirken oda değişmiş olabilir — eski masanın mesajlarını
      // yeni masaya basma (oyun değiştirince sohbet taşınması hatası).
      if (String(istenen) !== String(curRoomId)) return;
      paintGameChat(res.messages || []);
    });
  }

  function sendNow() {
    const inp = document.getElementById('gvChatText');
    if (!inp) return;
    const text = String(inp.value || '').trim();
    if (!text) return;
    if (!isMember()) { toast('💬 Sohbette yazabilmek için üye girişi yapmalısınız.', 'warning'); return; }
    if (susturulduMu()) {
      toast('🔇 ' + (yaptirim.aciklama || 'Sohbet yetkiniz kısıtlandı.'), 'warning');
      return;
    }
    const sock = ensureSocket();
    if (!sock || !sock.connected) {
      toast('💬 Sunucuya bağlanılıyor — birkaç saniye sonra tekrar deneyin.', 'warning');
      return;
    }
    // Çekmeceden gönderilen mesaj HER ZAMAN genel sohbete gider (masada
    // otururken bile) — masa sohbeti için masadaki kendi kutusu kullanılır.
    sock.emit('chatMessage', { scope: 'global', roomId: null, text, name: myName(), memberKey: memberKey() });
    inp.value = '';
    inp.focus();
    // Genel sohbette 5 sn bekleme kuralı: butonu geri sayımla kilitle (sunucu da reddeder).
    if (mode === 'global') {
      const btn = document.getElementById('gvChatSend');
      if (btn) {
        let left = 5;
        btn.disabled = true;
        btn.textContent = String(left);
        const iv = setInterval(() => {
          left--;
          if (left <= 0) { clearInterval(iv); btn.textContent = '➤'; btn.disabled = !isMember(); }
          else btn.textContent = String(left);
        }, 1000);
      }
    }
  }

  // ---------- Durum taraması ----------
  function tick() {
    // Aç/kapa anahtarı MİSAFİR için de çalışmalı: aşağıdaki üye-olmayan
    // dalı erken return ettiği için bu iki çağrı en üstte durur.
    anahtarBagla();
    anahtarUygula();
    yaptirimSor();          // üye girişi varsa kendi kısıtlama durumunu öğren
    yaptirimUygulaUI();     // süresi dolduysa kilit kendiliğinden kalkar
    const member = isMember();
    // GEZİNME BALONCUĞU + genel sohbet paneli üyelere özeldir. AMA masa
    // içindeki gömülü sohbet kutusu (#gameChat, index.html'de ayrı bir
    // eleman) ziyaretçiler için de akmalı — aksi halde soket hiç
    // bağlanmadığından ne geçmiş ne canlı mesaj hiç ulaşmaz ve "ziyaretçiler
    // birbirinin mesajını göremiyor" hatası oluşur. Bu yüzden misafirken de
    // masadaysak soketi kurup dinleyiciyi bağlıyoruz; yalnız baloncuk/panel
    // gizli kalır.
    const fabEl = document.getElementById('gvChatFab');
    const panelEl = document.getElementById('gvChatPanel');
    // MASA KANALI (gömülü #gameChat) — üye/misafir farkı gözetmez, iki
    // dalda da aynı şekilde işler. Oda değişince kutu ANINDA boşalır ki
    // önceki masanın mesajları yeni masaya taşınmasın.
    const odaSayfasi = isRoomPage() && !!roomIdNow();
    const yeniOda = odaSayfasi ? roomIdNow() : null;
    if (String(yeniOda) !== String(curRoomId)) {
      curRoomId = yeniOda;
      lastRoomHistKey = '';
      paintGameChat([]);
    }

    if (!member) {
      if (fabEl) fabEl.style.display = 'none';
      if (panelEl) { panelEl.classList.remove('open'); panelEl.style.display = 'none'; }
      open = false;
      // Misafir de masa sohbetini okuyabilmeli (ve yazabilmeli): soketi kur,
      // dinleyiciyi bağla, masa geçmişini getir. Çekmece (genel sohbet)
      // misafire kapalı olduğu için yalnız MASA kanalı işler.
      if (odaSayfasi) {
        const sock = ensureSocket();
        if (sock && sock !== attachedSock) { attach(sock); attachedSock = sock; }
        attachAll();
        reloadRoomHistory(false);
      }
      return;
    }
    els();
    ensureSocket();          // üye girişi varsa sohbet her sayfada canlıdır
    document.getElementById('gvChatFab').style.display = '';
    if (panelEl) panelEl.style.display = '';
    // Çekmece HER ZAMAN genel sohbet: başlık sabittir, masaya oturmak
    // çekmeceyi değiştirmez.
    const t = document.getElementById('gvChatTitle');
    if (t && t.textContent !== '🌐 Genel Sohbet') t.textContent = '🌐 Genel Sohbet';

    const inp = document.getElementById('gvChatText');
    const btn = document.getElementById('gvChatSend');
    // Çekmece genel sohbet olduğundan masa sohbeti anahtarı burada
    // KULLANILMAZ; yalnız kurucu yaptırımı yazmayı engelleyebilir.
    const kisitli = susturulduMu();   // KURUCU yaptırımı (kullanıcı kaldıramaz)
    if (inp) {
      inp.disabled = !member || kisitli;
      inp.placeholder = kisitli ? '🔇 Sohbet yetkiniz kısıtlandı'
        : (member ? 'Mesajınızı yazın...' : 'Mesaj yazmak için giriş yapın (okumaya devam edebilirsiniz)');
    }
    if (btn) btn.disabled = !member || kisitli;
    const sock = pickSocket();
    if (sock && sock !== attachedSock) { attach(sock); attachedSock = sock; }
    attachAll();
    // Genel sohbet geçmişi yalnız çekmece açıkken tazelenir; masa geçmişi
    // ise masadayken HER ZAMAN (çekmece kapalı olsa da kutu dolu olmalı).
    if (open) reloadHistory(false);
    if (curRoomId) reloadRoomHistory(false);
    pruneOld();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setInterval(tick, 1000), { once: true });
  else setInterval(tick, 1000);
  setTimeout(tick, 300);

  /* Dışa açık küçük API: bir kullanıcı susturulduğunda (js/report.js)
     açık sohbetlerin ANINDA tazelenmesi için. Geçmiş sunucudan yeniden
     çekilir; susturulan kişinin mesajları süzgeçten geçemez. */
  window.GVChat = {
    tazele: function () {
      lastHistKey = ''; lastRoomHistKey = '';
      reloadHistory(true);
      reloadRoomHistory(true);
    }
  };
})();
