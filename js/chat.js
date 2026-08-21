/* GameVerse — Sohbet (masa içi + genel)
 *
 *  Kurallar (sunucu da doğrular):
 *   - Mesaj GÖNDERME üyelere özeldir; misafirler akışı okuyabilir.
 *   - Oda sayfasındayken "Masa Sohbeti" (oda kanalına), diğer sayfalarda
 *     "Genel Sohbet" (herkese açık) aktiftir.
 *   - Son 50 mesaj sunucuda tutulur; panele geçmiş yüklenir.
 *
 *  Bu modül kendi başına çalışır: soketi (varsa oda soketi, yoksa lobi
 *  soketi) 1 sn'lik taramayla bulur, dinleyicileri bir kez bağlar.
 */
(function () {
  'use strict';

  let built = false;
  let open = false;
  let mode = 'global';       // 'room' | 'global'
  let curRoomId = null;
  let attachedSock = null;
  let lastHistKey = '';
  let unread = 0;
  const seenIds = new Set(); // çift soketten GELEN aynı mesajın yankısını önler

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

  function renderList(messages) {
    const list = document.getElementById('gvChatList');
    if (!list) return;
    // Süresi dolmuş genel sohbet mesajları istemcide de gösterilmez.
    if (mode === 'global' && messages) messages = messages.filter(m => Date.now() - Number(m.ts || 0) < 60000);
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
      return `<div class="gc-msg${mine ? ' mine' : ''}" data-ts="${ts}"><span class="gc-nm"${uid}>${esc(m.name)}</span>${esc(m.text)}<span class="gc-tm">${hm}</span></div>`;
    }).join('');
    scrollEnd();
  }

  function appendMsg(m) {
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
    div.innerHTML = `<span class="gc-nm"${uid}>${esc(m.name)}</span>${esc(m.text)}<span class="gc-tm">${hm}</span>`;
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
    list.innerHTML = (messages || []).map(m => {
      const uid = Number(m.uid) > 0 ? ` data-uid="${Number(m.uid)}"` : '';
      return `<div class="chat-msg"><div class="avatar sm">${esc((m.name || 'O').substring(0, 1))}</div><div class="m-body"><div class="m-name" style="color:var(--accent)"${uid}>${esc(m.name)}</div><div>${esc(m.text)}</div></div></div>`;
    }).join('');
    list.scrollTop = list.scrollHeight;
  }
  function mirrorToGameChat(m) {
    const list = document.getElementById('gameChat');
    if (!list || m.scope !== 'room') return;
    if (curRoomId && String(m.roomId) !== String(curRoomId)) return;
    const nm = m.name || 'Oyuncu';
    const uid = Number(m.uid) > 0 ? ` data-uid="${Number(m.uid)}"` : '';
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<div class="avatar sm">${esc(nm.substring(0, 1))}</div><div class="m-body"><div class="m-name" style="color:var(--accent)"${uid}>${esc(nm)}</div><div>${esc(m.text)}</div></div>`;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  // ---------- Soket ----------
  function pickSocket() {
    if (mode === 'room' && window.__gvRoomSocket) return window.__gvRoomSocket;
    return window.__gvLobbySocket || window.__gvRoomSocket || window.__gvChessSocket || null;
  }

  function attach(sock) {
    if (!sock || sock.__gvChat) return;
    sock.__gvChat = true;
    sock.on('chatMessage', msg => {
      if (!msg) return;
      if (msg.id && seenIds.has(msg.id)) return; // iki soket de açıksa yankı düşmesin
      if (msg.id) { seenIds.add(msg.id); if (seenIds.size > 300) { const it = seenIds.values(); for (let i = 0; i < 150; i++) seenIds.delete(it.next().value); } }
      mirrorToGameChat(msg);
      const mine = msg.scope === 'room'
        ? (mode === 'room' && String(msg.roomId) === String(curRoomId))
        : (mode === 'global');
      if (open && mine) appendMsg(msg);
      else { unread++; paintBadge(); }
    });
    sock.on('chatRejected', p => { toast('💬 ' + ((p && p.reason) || 'Mesaj gönderilemedi.'), 'warning'); });
    sock.on('connect', () => reloadHistory(true));
  }

  function reloadHistory(force) {
    const sock = pickSocket();
    if (!sock || !sock.connected) return;
    const key = mode + ':' + (mode === 'room' ? curRoomId : '*');
    if (!force && key === lastHistKey) return;
    lastHistKey = key;
    sock.emit('chatHistory', { scope: mode, roomId: curRoomId }, res => {
      if (!res || !res.ok) return;
      renderList(res.messages || []);
      if (mode === 'room') paintGameChat(res.messages || []);
    });
  }

  function sendNow() {
    const inp = document.getElementById('gvChatText');
    if (!inp) return;
    const text = String(inp.value || '').trim();
    if (!text) return;
    if (!isMember()) { toast('💬 Sohbette yazabilmek için üye girişi yapmalısınız.', 'warning'); return; }
    const sock = pickSocket();
    if (!sock || !sock.connected) { toast('💬 Bağlantı yok — birazdan tekrar deneyin.', 'error'); return; }
    sock.emit('chatMessage', { scope: mode, roomId: curRoomId, text, name: myName(), memberKey: memberKey() });
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
    const member = isMember();
    // Sohbet SADECE üyeler içindir: misafir ise baloncuk+panel tamamen gizlenir.
    const fabEl = document.getElementById('gvChatFab');
    const panelEl = document.getElementById('gvChatPanel');
    if (!member) {
      if (fabEl) fabEl.style.display = 'none';
      if (panelEl) { panelEl.classList.remove('open'); panelEl.style.display = 'none'; }
      open = false;
      return;
    }
    els();
    document.getElementById('gvChatFab').style.display = '';
    if (panelEl) panelEl.style.display = '';
    const wantRoom = isRoomPage() && !!roomIdNow();
    const nextMode = wantRoom ? 'room' : 'global';
    const nextRoom = wantRoom ? roomIdNow() : null;
    if (nextMode !== mode || String(nextRoom) !== String(curRoomId)) {
      mode = nextMode;
      curRoomId = nextRoom;
      const t = document.getElementById('gvChatTitle');
      if (t) t.textContent = mode === 'room' ? (gameTitle() + ' Masa Sohbeti #' + curRoomId) : '🌐 Genel Sohbet';
      lastHistKey = '';
      renderList([]);
    }
    const inp = document.getElementById('gvChatText');
    const btn = document.getElementById('gvChatSend');
    if (inp) {
      inp.disabled = !member;
      inp.placeholder = member ? 'Mesajınızı yazın...' : 'Mesaj yazmak için giriş yapın (okumaya devam edebilirsiniz)';
    }
    if (btn) btn.disabled = !member;
    const sock = pickSocket();
    if (sock && sock !== attachedSock) { attach(sock); attachedSock = sock; }
    if (open) reloadHistory(false);
    pruneOld();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setInterval(tick, 1000), { once: true });
  else setInterval(tick, 1000);
  setTimeout(tick, 300);
})();
