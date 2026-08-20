/* GameVerse — Sosyal katman: profil + oyun geçmişi + arkadaş + davet
 *
 *  - İsme tıkla → profil kartı (üyelik tarihi, oyun istatistikleri, son maçlar)
 *    İsimler şuralarda tıklanabilir: sohbet baloncuğu, oyun-içi sohbet kartı,
 *    lobi masa listesindeki oyuncular, bekleme odası koltukları, maç geçmişi.
 *  - Arkadaşlık: İSTEK → bildirim → KABUL/RED akışı (gerçek veritabanı:
 *    /api/friends + /api/friends/requests). Doğrudan listeye ekleme YOK;
 *    istek karşı tarafa bildirim olarak düşer, o kabul ederse arkadaş olunur.
 *    Anlık uyarı soket ping'iyle, kaçanlar 8 sn'lik taramayla yakalanır.
 *  - Oyun daveti: yalnızca KURDUĞUNUZ ÖZEL masadan, yalnızca ARKADAŞINIZA;
 *    sunucu iki kuralı da zorunlu tutar. Davet alanın bildirimi yanar
 *    (addNotification + davet penceresi), kabulde odaya bağlanır ve gönderene
 *    kabul/ret geri bildirimi düşer (inviteAnswered).
 */
(function () {
  'use strict';

  const BACKEND = (window.GV_BACKEND_URL || 'https://masaoyunlari-backend.onrender.com').replace(/\/+$/, '');
  const REASON_TR = {
    checkmate: 'Şah mat', stalemate: 'Pat', draw: 'Beraberlik',
    fifty_move: '50 hamle kuralı', insufficient_material: 'Yetersiz taş',
    threefold_repetition: 'Üçlü tekrar', move_timeout: 'Hamle süresi doldu',
    timeout: 'Süre doldu', player_left: 'Oyuncu ayrıldı', finished: 'Oyun bitti'
  };

  function st8() { return window.st || {}; }
  function myUser() { const s = st8(); return (!s.isGuest && s.user && s.user.id) ? s.user : null; }
  function myId() { const u = myUser(); return u ? Number(u.id) : null; }
  function tok() { try { return localStorage.getItem('gv-auth-token'); } catch (_) { return null; } }
  function toast(m, t, ms) { if (window.GV && GV.toast) GV.toast(m, t || 'info', ms || 5000); }
  function showModal(id) { if (window.GV && GV.showModal) GV.showModal(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function gameLabel(gid) {
    const g = (window.GAMES && window.GAMES[gid]) || null;
    return g ? (g.icon + ' ' + g.name) : ('🎮 ' + gid);
  }
  function relTime(ts) {
    const d = Date.now() - Number(ts || 0);
    const m = Math.floor(d / 60000);
    if (m < 1) return 'az önce';
    if (m < 60) return m + ' dk önce';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' sa önce';
    return Math.floor(h / 24) + ' gün önce';
  }

  const PHP = (window.GV_PHP_API || '').replace(/\/+$/, '');
  function urlFor(path) {
    if (!PHP) return BACKEND + path;
    let m = path.match(/^\/api\/users\/(\d+)\/profile$/);
    if (m) return PHP + '/social.php?action=profile&id=' + m[1];
    m = path.match(/^\/api\/users\/search\?q=(.*)$/);
    if (m) return PHP + '/social.php?action=search&q=' + m[1];
    m = path.match(/^\/api\/auth\/(\w+)$/);
    if (m) return PHP + '/auth.php?action=' + m[1];
    if (path === '/api/friends') return PHP + '/social.php?action=friends';
    m = path.match(/^\/api\/friends\/(\w+)$/);
    if (m) return PHP + '/social.php?action=' + ({
      add: 'friendRequest', request: 'friendRequest', requests: 'friendRequests',
      accept: 'friendAccept', decline: 'friendDecline', remove: 'friendRemove'
    }[m[1]] || m[1]);
    return BACKEND + path;
  }

  async function api(path, body, method) {
    // auth.js yüklendiyse ortak yardımcıyı kullan (ayarı tek yerde).
    if (window.GVAuth && typeof GVAuth.api === 'function') return GVAuth.api(path, body, method);
    const headers = { 'Content-Type': 'application/json' };
    const t = tok();
    if (t) headers.Authorization = 'Bearer ' + t;
    const r = await fetch(urlFor(path), {
      method: method || (body ? 'POST' : 'GET'),
      headers, body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await r.json(); } catch (_) {}
    return { status: r.status, ...(data || { ok: false, error: 'Sunucuya ulaşılamadı.' }) };
  }

  // ---------------- Stil ----------------
  function injectCss() {
    if (document.getElementById('gvSocialCss')) return;
    const s = document.createElement('style');
    s.id = 'gvSocialCss';
    s.textContent = `
.gv-u{cursor:pointer}
.gv-u:hover{text-decoration:underline;color:var(--accent,#8f7bff)!important}
#gvProfileModal{position:fixed;inset:0;z-index:2147482400;background:rgba(6,7,20,.85);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px)}
#gvProfileModal .gvpf-card{background:#12122b;border:1px solid rgba(255,255,255,.15);border-radius:16px;max-width:460px;width:94%;max-height:86vh;overflow-y:auto;padding:22px;color:#fff}
.gvpf-head{display:flex;align-items:center;gap:14px;margin-bottom:14px}
.gvpf-ava{width:56px;height:56px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:1.7em;font-weight:800;background:linear-gradient(135deg,#6c5ce7,#8f7bff);flex:none}
.gvpf-online{font-size:.78em;color:#00b894;font-weight:700}
.gvpf-offline{font-size:.78em;color:#8a8fa3}
.gvpf-chips{display:flex;flex-wrap:wrap;gap:7px;margin:10px 0 14px}
.gvpf-chip{background:#0d0d22;border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:6px 10px;font-size:.78em}
.gvpf-match{display:flex;align-items:center;gap:10px;padding:9px 10px;background:#0d0d22;border:1px solid rgba(255,255,255,.08);border-radius:10px;margin-bottom:7px;font-size:.82em}
.gvpf-res{font-weight:800;flex:none}
.gvpf-won{color:#00b894}.gvpf-lost{color:#ff7675}.gvpf-draw{color:#fdcb6e}
.gvpf-btn{cursor:pointer;border:none;border-radius:9px;padding:9px 13px;font-weight:800;font-size:.84em;color:#fff}
.gvpf-act{display:flex;gap:8px;margin-top:14px;flex-wrap:wrap}
.gv-fr-req{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;background:rgba(108,92,231,.10);border:1px solid rgba(108,92,231,.35);border-radius:10px}
.gv-fr-req .gv-fr-btns{display:flex;gap:6px;flex:none}
`;
    document.head.appendChild(s);
  }

  // ---------------- Arkadaş önbelleği ----------------
  let friendsCache = null;   // [{id,name,online,since}]
  let friendsBusy = false;

  function isFriend(id) { return (friendsCache || []).some(f => Number(f.id) === Number(id)); }

  async function refreshFriends() {
    if (!myId()) { friendsCache = null; return null; }
    if (friendsBusy) return friendsCache;
    friendsBusy = true;
    try {
      const r = await api('/api/friends', null, 'GET');
      if (r.ok) friendsCache = r.friends || [];
    } catch (_) {}
    friendsBusy = false;
    return friendsCache;
  }

  // ---------------- Arkadaşlık İSTEKLERİ (kabul/red akışı) ----------------
  //  Akış: A istek gönderir → B'nin 🔔 bildirimi yanar → B 👥 penceresindeki
  //  "Arkadaş İstekleri" bölümünden Kabul/Reddeder → kabulde iki taraf da
  //  arkadaş listesine girer, istek silinir. Doğrudan ekleme YOKTUR.
  let requestsCache = null;      // {incoming:[{id,name,since}], outgoing:[...]}
  let requestsBusy = false;
  let snapSeeded = false;        // ilk tarama sessiz tohumlanır (bildirim seli olmasın)
  let seenIncoming = new Set();  // bilinen gelen istek id'leri
  let seenOutgoing = new Set();  // bilinen giden istek id'leri
  const notifiedDone = new Set();// 'acc:<id>' / 'dec:<id>' — aynı sonuç bir kez bildirilir

  function notifyBell(title, desc, actionData) {
    const addNotif = (window.GV && typeof GV.addNotification === 'function' && GV.addNotification)
      || (typeof window.addNotification === 'function' && window.addNotification);
    if (addNotif) addNotif(title, desc, actionData || null);
    else toast(title + ' — ' + desc, 'info');
  }

  function nameOf(id) {
    id = Number(id);
    const f = (friendsCache || []).find(x => Number(x.id) === id);
    if (f) return f.name;
    const rq = requestsCache || { incoming: [], outgoing: [] };
    const r = rq.incoming.concat(rq.outgoing).find(x => Number(x.id) === id);
    return r ? r.name : ('Oyuncu #' + id);
  }

  function reqStateWith(uid) {
    uid = Number(uid);
    if (isFriend(uid)) return 'friend';
    const rq = requestsCache;
    if (rq && rq.incoming.some(r => Number(r.id) === uid)) return 'in';
    if (rq && rq.outgoing.some(r => Number(r.id) === uid)) return 'out';
    return 'none';
  }

  function updateReqBadge(n) {
    const b = document.getElementById('friendsBadgeCount');
    if (!b) return;
    b.textContent = n;
    b.style.display = n > 0 ? 'inline-flex' : 'none';
  }

  // Anlık soket + periyodik tarama ORTAK dedupe: yeni gelen istek → bildirim;
  // biten giden istek → kabul/red sonucu bildirimi.
  function digestRequests() {
    const rq = requestsCache;
    if (!rq) return;
    const inIds = new Set(rq.incoming.map(r => Number(r.id)));
    const outIds = new Set(rq.outgoing.map(r => Number(r.id)));
    if (!snapSeeded) { snapSeeded = true; seenIncoming = inIds; seenOutgoing = outIds; return; }
    rq.incoming.forEach(r => {
      const id = Number(r.id);
      if (!seenIncoming.has(id)) {
        seenIncoming.add(id);
        notifyBell('👥 Arkadaşlık İsteği!',
          r.name + ' sana arkadaşlık isteği gönderdi — 👥 Arkadaşlarım penceresinden cevaplayabilirsin.',
          { type: 'friendRequest', fromId: id, fromName: r.name });
      }
    });
    [...seenIncoming].forEach(id => { if (!inIds.has(id) && !isFriend(id)) seenIncoming.delete(id); });
    [...seenOutgoing].forEach(id => {
      if (outIds.has(id)) return;
      seenOutgoing.delete(id);
      const nm = nameOf(id);
      if (isFriend(id)) {
        if (!notifiedDone.has('acc:' + id)) {
          notifiedDone.add('acc:' + id);
          notifyBell('✅ İstek kabul edildi', nm + ' arkadaşlık isteğini kabul etti — artık arkadaşsınız! 🎉',
            { type: 'friendAccepted', fromId: id, fromName: nm });
        }
      } else if (!notifiedDone.has('dec:' + id)) {
        notifiedDone.add('dec:' + id);
        notifyBell('🚫 İstek yanıtlandı', nm + ' arkadaşlık isteğini kabul etmedi.',
          { type: 'friendDeclined', fromId: id, fromName: nm });
      }
    });
    outIds.forEach(id => seenOutgoing.add(id));
  }

  async function refreshRequests() {
    if (!myId()) { requestsCache = null; updateReqBadge(0); return null; }
    if (requestsBusy) return requestsCache;
    requestsBusy = true;
    try {
      const r = await api('/api/friends/requests', null, 'GET');
      if (r.ok) {
        requestsCache = { incoming: r.incoming || [], outgoing: r.outgoing || [] };
        digestRequests();
      }
    } catch (_) {}
    requestsBusy = false;
    updateReqBadge(requestsCache ? requestsCache.incoming.length : 0);
    return requestsCache;
  }

  // ---------------- İstek satırları (üst bar 👥 penceresi, üst bölüm) ----------------
  function paintRequests() {
    const list = document.getElementById('gvFrReqList');
    if (!list) return;
    const sec = document.getElementById('gvFrReqSec');
    const count = document.getElementById('gvFrReqCount');
    const rq = requestsCache;
    const inc = rq ? rq.incoming : [];
    const out = rq ? rq.outgoing : [];
    if (count) count.textContent = inc.length;
    if (!rq) { list.innerHTML = '<div style="padding:6px;text-align:center;color:var(--text3);font-size:.78em;">Yükleniyor...</div>'; return; }
    let html = '';
    inc.forEach(r => {
      html += `<div class="gv-fr-req">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer" data-uid="${Number(r.id)}">
          <div class="avatar sm">${esc(String(r.name).charAt(0))}</div>
          <div style="min-width:0">
            <div style="font-weight:700;font-size:.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</div>
            <div style="font-size:.7em;color:var(--text3)">arkadaşlık isteği gönderdi • ${relTime(r.since)}</div>
          </div>
        </div>
        <div class="gv-fr-btns">
          <button class="btn btn-sm btn-p" style="padding:3px 9px;font-size:.74em" onclick="event.stopPropagation();GVSocial.acceptRequest(${Number(r.id)})">✓ Kabul Et</button>
          <button class="btn btn-sm btn-d" style="padding:3px 8px;font-size:.74em" onclick="event.stopPropagation();GVSocial.declineRequest(${Number(r.id)})">✗ Reddet</button>
        </div>
      </div>`;
    });
    out.forEach(r => {
      html += `<div class="gv-fr-req" style="background:rgba(253,203,110,.06);border-color:rgba(253,203,110,.25)">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;cursor:pointer" data-uid="${Number(r.id)}">
          <div class="avatar sm">${esc(String(r.name).charAt(0))}</div>
          <div style="min-width:0">
            <div style="font-weight:700;font-size:.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</div>
            <div style="font-size:.7em;color:var(--text3)">⏳ istek gönderildi, yanıt bekleniyor • ${relTime(r.since)}</div>
          </div>
        </div>
        <div class="gv-fr-btns">
          <button class="btn btn-sm btn-s" style="padding:3px 9px;font-size:.74em" onclick="event.stopPropagation();GVSocial.declineRequest(${Number(r.id)})">İptal</button>
        </div>
      </div>`;
    });
    list.innerHTML = html || '<div style="padding:6px;text-align:center;color:var(--text3);font-size:.78em;">Bekleyen arkadaşlık isteği yok.</div>';
  }

  function paintAll() {
    paintFriends('');
    paintRequests();
    if (openUid != null) paintProfile(openUid);
  }

  // ---------------- İstek eylemleri ----------------
  function pickSock() {
    return window.__gvRoomSocket || window.__gvLobbySocket || window.__gvChessSocket || null;
  }
  function ping(ev, toUserId, extra) {
    const s = pickSock();
    if (s && s.connected) { try { s.emit(ev, { toUserId: Number(toUserId), ...(extra || {}) }); } catch (_) {} }
  }

  async function sendRequest(uid, knownName) {
    if (!myId()) return showModal('guestPromptModal');
    const r = await api('/api/friends/request', { friendId: Number(uid) });
    if (r.ok && r.accepted) {
      friendsCache = r.friends || friendsCache;
      await refreshRequests();
      toast(`🎉 ${r.toName || knownName || 'Oyuncu'} size zaten istek göndermişti — arkadaş oldunuz!`, 'success');
    } else if (r.ok) {
      await refreshRequests();
      toast(`📨 ${r.toName || knownName || 'Oyuncu'} kullanıcısına arkadaşlık isteği gönderildi — kabul edince listenize eklenecek.`, 'success');
      ping('friendRequestPing', uid);
    } else {
      toast('⚠️ ' + (r.error || 'İstek gönderilemedi.'), 'error');
    }
    paintAll();
  }

  async function acceptRequest(fromId) {
    if (!myId()) return showModal('guestPromptModal');
    const r = await api('/api/friends/accept', { friendId: Number(fromId) });
    if (r.ok) {
      friendsCache = r.friends || friendsCache;
      notifiedDone.add('acc:' + Number(fromId));
      await refreshRequests();
      toast(`✅ ${r.fromName || nameOf(fromId)} ile arkadaş oldunuz! 🎉`, 'success');
      ping('friendAcceptPing', fromId);
    } else {
      toast('⚠️ ' + (r.error || 'Kabul edilemedi.'), 'error');
      await refreshRequests();
    }
    paintAll();
  }

  async function declineRequest(otherId) {
    if (!myId()) return showModal('guestPromptModal');
    const wasIncoming = reqStateWith(otherId) === 'in';
    const nm = nameOf(otherId);
    const r = await api('/api/friends/decline', { friendId: Number(otherId) });
    if (r.ok) {
      notifiedDone.add('dec:' + Number(otherId));
      await refreshRequests();
      toast(wasIncoming ? `İstek reddedildi (${nm}).` : `İstek iptal edildi (${nm}).`, 'info');
      ping('friendDeclinePing', otherId, { kind: wasIncoming ? 'declined' : 'cancelled' });
    } else {
      toast('⚠️ ' + (r.error || 'İşlem başarısız.'), 'error');
      await refreshRequests();
    }
    paintAll();
  }

  // ---------------- Arkadaş listesi (üst bar 👥 penceresi; eski #friendsList yedeği) ----------------
  function friendsEl() { return document.getElementById('gvFriendsModalList') || document.getElementById('friendsList'); }
  function paintFriends(q) {
    const el = friendsEl();
    if (!el) return;
    const list = (friendsCache || []).filter(f =>
      !q || f.name.toLowerCase().includes(String(q).toLowerCase()));
    if (!list.length) {
      el.innerHTML = friendsCache === null
        ? '<div style="padding:8px;text-align:center;color:var(--text3);font-size:0.8em;">Arkadaşlar yükleniyor...</div>'
        : '<div style="padding:8px;text-align:center;color:var(--text3);font-size:0.8em;">Henüz arkadaşınız yok — bir oyuncunun ismine tıklayıp profilinden ekleyin! 👥</div>';
      return;
    }
    el.innerHTML = list.map(f => `
    <div class="friend">
      <div style="display:flex;align-items:center;gap:8px;cursor:pointer" data-uid="${Number(f.id)}">
        <div class="avatar sm">${esc(String(f.name).charAt(0))}</div>
        <div>
          <div style="font-weight:600;font-size:.85em" data-uid="${Number(f.id)}">${esc(f.name)}</div>
          <div style="font-size:.72em;color:${f.online ? 'var(--success)' : 'var(--text3)'}">
            <span class="${f.online ? 'online-dot' : 'offline-dot'}"></span> ${f.online ? 'Çevrimiçi' : 'Çevrimdışı'}
          </div>
        </div>
      </div>
      <button class="btn btn-sm ${f.online ? 'btn-a' : 'btn-s'}" style="padding:2px 6px;font-size:0.7em;"
        ${f.online ? '' : 'disabled style="opacity:0.4"'}
        onclick="event.stopPropagation();window.GVSocial && GVSocial.inviteFriendById(${Number(f.id)})">Davet Et</button>
    </div>`).join('');
  }

  function renderFriendsMember(q) {
    const el = friendsEl();
    if (!el) return;
    if (!myId()) return; // misafir görünümü index.html'nin kendi fonksiyonunda
    if (friendsCache === null) {
      paintFriends(q);
      refreshFriends().then(() => paintFriends(q));
      return;
    }
    paintFriends(q);
  }

  // ---------------- Davet kuralları ----------------
  function currentRoom() {
    const r = window.__gvActiveRoom || null;
    if (r && window.__gvActiveRoomId && String(r.id) === String(window.__gvActiveRoomId)) return r;
    return null;
  }
  function canInvite() {
    const me = myId();
    const r = currentRoom();
    return !!(me && r && r.isPrivate && Number(r.creatorId) === Number(me));
  }
  function explainNoInvite() {
    if (!myId()) { showModal('guestPromptModal'); return; }
    const r = currentRoom();
    if (!r) toast('⚠️ Davet için önce bir ÖZEL masa kurun (masada beklerken davet edebilirsiniz).', 'warning');
    else if (!r.isPrivate) toast('⚠️ Davet yalnızca ÖZEL masalardan gönderilebilir.', 'warning');
    else if (Number(r.creatorId) !== Number(myId())) toast('⚠️ Daveti yalnızca masayı kuran oyuncu gönderebilir.', 'warning');
    else toast('⚠️ Şu an davet gönderilemez.', 'warning');
  }
  function inviteFriendById(uid) {
    if (!myId()) return showModal('guestPromptModal');
    if (!canInvite()) return explainNoInvite();
    const sock = window.__gvRoomSocket;
    if (!sock || !sock.connected) return toast('⚠️ Sunucu bağlantısı yok — birazdan tekrar deneyin.', 'error');
    const r = currentRoom();
    sock.emit('gameInvite', { toUserId: Number(uid), roomId: String(r.id) });
    // Sonuç 'inviteSent' / 'inviteRejected' olaylarıyla bildirilecek.
  }

  // ---------------- Profil penceresi ----------------
  let profileCache = {}; // uid -> {user, online, stats, recent}
  let openUid = null;

  function profileModal() {
    let ov = document.getElementById('gvProfileModal');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'gvProfileModal';
    ov.style.display = 'none';
    ov.innerHTML = '<div class="gvpf-card" id="gvProfileCard"></div>';
    ov.addEventListener('click', e => { if (e.target === ov) ov.style.display = 'none'; });
    document.body.appendChild(ov);
    return ov;
  }

  function statChips(stats) {
    const keys = Object.keys(stats || {});
    if (!keys.length) return '<div style="color:#8a8fa3;font-size:.8em;margin:8px 0">Henüz kayıtlı maçı yok.</div>';
    return '<div class="gvpf-chips">' + keys.map(k => {
      const st = stats[k];
      return `<div class="gvpf-chip">${esc(gameLabel(k))}: <b>${st.played}</b> maç • <b style="color:#00b894">${st.won}</b> galibiyet</div>`;
    }).join('') + '</div>';
  }

  function matchRows(recent) {
    if (!recent || !recent.length) return '<div style="color:#8a8fa3;font-size:.8em">Son maç bulunamadı.</div>';
    return recent.map(m => {
      const cls = m.won ? 'gvpf-won' : (m.winner ? 'gvpf-lost' : 'gvpf-draw');
      const resTxt = m.won ? '✅ Galibiyet' : (m.winner ? '❌ Mağlubiyet' : '🤝 Beraberlik');
      const names = (m.players || []).map(p => {
        const nm = esc(p.name || 'Oyuncu');
        const mark = p.won ? '🏆 ' : '';
        return Number(p.id) > 0 ? `<span class="gv-u" data-uid="${Number(p.id)}">${mark}${nm}</span>` : (mark + nm);
      }).join(' · ');
      return `<div class="gvpf-match">
        <div class="gvpf-res ${cls}">${resTxt}</div>
        <div style="flex:1">
          <div>${esc(gameLabel(m.gameId))} — Masa #${esc(m.roomId)}</div>
          <div style="color:#9aa0b4;font-size:.88em">${names}</div>
          <div style="color:#6a6f85;font-size:.8em">${esc(REASON_TR[m.reason] || m.reason || '')} • ${relTime(m.ts)}</div>
        </div>
      </div>`;
    }).join('');
  }

  function paintProfile(uid) {
    const card = document.getElementById('gvProfileCard');
    if (!card) return;
    const p = profileCache[uid];
    if (!p) { card.innerHTML = '<div style="text-align:center;padding:30px;color:#9aa0b4">Profil yükleniyor...</div>'; return; }
    if (p.error) { card.innerHTML = `<div style="text-align:center;padding:30px;color:#ff7675">⚠️ ${esc(p.error)}</div>`; return; }
    const me = myId();
    const self = Number(me) === Number(uid);
    const friend = isFriend(uid);
    const joined = p.user.createdAt ? new Date(Number(p.user.createdAt)).toLocaleDateString('tr-TR') : '—';
    const onl = p.online
      ? '<span class="gvpf-online">● Çevrimiçi</span>'
      : '<span class="gvpf-offline">○ Çevrimdışı</span>';
    let actions = '<div class="gvpf-act">';
    if (!self) {
      if (me) {
        const rst = reqStateWith(uid);
        if (rst === 'friend') {
          actions += `<button class="gvpf-btn" style="background:#3a3d5c" onclick="GVSocial.toggleFriend(${Number(uid)})">🗑 Arkadaşlıktan Çıkar</button>`;
        } else if (rst === 'out') {
          actions += `<button class="gvpf-btn" style="background:#5c4a1f" title="İsteği geri çekmek için tıkla" onclick="GVSocial.toggleFriend(${Number(uid)})">⏳ İstek Gönderildi (İptal)</button>`;
        } else if (rst === 'in') {
          actions += `<button class="gvpf-btn" style="background:linear-gradient(135deg,#00b894,#00a381)" onclick="GVSocial.acceptRequest(${Number(uid)})">✓ İsteği Kabul Et</button>`;
          actions += `<button class="gvpf-btn" style="background:#3a3d5c" onclick="GVSocial.declineRequest(${Number(uid)})">✗ Reddet</button>`;
        } else {
          actions += `<button class="gvpf-btn" style="background:linear-gradient(135deg,#6c5ce7,#8f7bff)" onclick="GVSocial.toggleFriend(${Number(uid)})">📨 Arkadaşlık İsteği Gönder</button>`;
        }
        if (p.online && rst === 'friend') {
          actions += `<button class="gvpf-btn" style="background:linear-gradient(135deg,#00b894,#00a381)" onclick="GVSocial.inviteFriendById(${Number(uid)})">🎮 Oyuna Davet Et</button>`;
        }
      } else {
        actions += `<button class="gvpf-btn" style="background:linear-gradient(135deg,#6c5ce7,#8f7bff)" onclick="GV.hideModal&&document.getElementById('gvProfileModal').style.display='none';GV.showModal('loginModal')">🔑 Arkadaş eklemek için giriş yap</button>`;
      }
    }
    actions += `<button class="gvpf-btn" style="background:#23264a" onclick="document.getElementById('gvProfileModal').style.display='none'">Kapat</button></div>`;

    card.innerHTML = `
      <div class="gvpf-head">
        <div class="gvpf-ava">${esc(String(p.user.name).charAt(0))}</div>
        <div>
          <div style="font-size:1.25em;font-weight:800">${esc(p.user.name)}</div>
          ${onl}
          <div style="font-size:.75em;color:#8a8fa3">Üyelik: ${joined}</div>
        </div>
      </div>
      <h3 style="margin:6px 0 4px;font-size:.95em">📊 Oyun İstatistikleri</h3>
      ${statChips(p.stats)}
      <h3 style="margin:10px 0 6px;font-size:.95em">🕘 Son Maçlar</h3>
      ${matchRows(p.recent)}
      ${actions}`;
  }

  async function openProfile(uid) {
    uid = Number(uid);
    if (!(uid > 0)) return;
    injectCss();
    openUid = uid;
    const ov = profileModal();
    ov.style.display = 'flex';
    if (!profileCache[uid]) paintProfile(uid); // yükleme placeholder'ı
    const r = await api('/api/users/' + uid + '/profile', null, 'GET');
    if (r.ok && r.user) profileCache[uid] = r;
    else profileCache[uid] = { error: r.error || 'Profil yüklenemedi.' };
    if (openUid === uid) paintProfile(uid);
  }

  // Profil kartındaki tek buton: duruma göre istek gönder / iptal / kabul / çıkar
  async function toggleFriend(uid) {
    if (!myId()) return showModal('guestPromptModal');
    const rst = reqStateWith(uid);
    if (rst === 'friend') {
      const r = await api('/api/friends/remove', { friendId: Number(uid) });
      if (r.ok) {
        friendsCache = r.friends;
        toast('Arkadaşlıktan çıkarıldı.', 'info');
      } else toast('⚠️ ' + (r.error || 'İşlem başarısız.'), 'error');
      paintAll();
    } else if (rst === 'out') {
      return declineRequest(uid);       // isteği geri çek
    } else if (rst === 'in') {
      return acceptRequest(uid);        // bana gelen isteği kabul et
    } else {
      return sendRequest(uid);          // yeni istek gönder
    }
  }

  // isimden istek gönder (üst penceredeki ekleme kutusu) — önce üye araması yapılır
  async function addFriendByName(name) {
    if (!myId()) return showModal('guestPromptModal');
    name = String(name || '').trim();
    if (name.length < 2) return toast('Kullanıcı adı en az 2 karakter olmalı.', 'warning');
    const s = await api('/api/users/search?q=' + encodeURIComponent(name), null, 'GET');
    if (!s.ok) return toast('⚠️ ' + (s.error || 'Arama başarısız.'), 'error');
    const exact = (s.users || []).find(u => u.name.toLowerCase() === name.toLowerCase());
    const target = exact || (s.users || [])[0];
    if (!target) return toast(`"${name}" adında bir üye bulunamadı.`, 'warning');
    if (Number(target.id) === Number(myId())) return toast('Kendinize istek gönderemezsiniz. 🙂', 'warning');
    const rst = reqStateWith(target.id);
    if (rst === 'friend') return toast(`${target.name} zaten arkadaş listenizde!`, 'info');
    if (rst === 'out') return toast(`⏳ ${target.name} kullanıcısına zaten istek gönderdiniz — yanıt bekleniyor.`, 'info');
    if (rst === 'in') return acceptRequest(target.id); // bana istek göndermiş → "ekle" = kabul
    return sendRequest(target.id, target.name);
  }

  // ---------------- Davet alma / cevaplama ----------------
  const seenInvites = new Set();
  function onGameInvite(inv) {
    if (!inv || !inv.inviteId) return;
    if (seenInvites.has(inv.inviteId)) return;
    seenInvites.add(inv.inviteId);
    if (seenInvites.size > 100) seenInvites.delete(seenInvites.values().next().value);
    // addNotification index.html'de GLOBAL fonksiyon (GV nesnesine export
    // edilmemiş) — iki yoldan da eriş.
    const addNotif = (window.GV && typeof GV.addNotification === 'function' && GV.addNotification)
      || (typeof window.addNotification === 'function' && window.addNotification);
    if (!addNotif) return;
    addNotif(
      '🎮 Oyun Daveti!',
      `${inv.fromName} seni "${inv.roomName || ('Masa #' + inv.roomId)}" masasına davet ediyor!`,
      { type: 'gameInvite', sender: inv.fromName, fromId: inv.fromId, gameId: inv.gameId, roomId: String(inv.roomId) }
    );
  }

  function emitInviteResponse(actionData, accepted) {
    if (!actionData || !actionData.fromId) return;
    const sock = window.__gvRoomSocket || window.__gvLobbySocket || window.__gvChessSocket;
    if (sock && sock.connected) {
      sock.emit('inviteResponse', { fromId: Number(actionData.fromId), accepted: !!accepted, roomId: String(actionData.roomId || '') });
    }
  }

  function attach(sock) {
    if (!sock || sock.__gvSocial) return;
    sock.__gvSocial = true;
    sock.on('gameInvite', onGameInvite);
    // Arkadaşlık isteği anlık bildirimleri (çevrimdışıysa periyodik tarama yakalar)
    sock.on('friendRequest', p => {
      if (!p || !p.fromId) return;
      seenIncoming.add(Number(p.fromId)); // tarama dedupe: ikinci bildirim basılmasın
      notifyBell('👥 Arkadaşlık İsteği!',
        p.fromName + ' sana arkadaşlık isteği gönderdi — 👥 Arkadaşlarım penceresinden cevaplayabilirsin.',
        { type: 'friendRequest', fromId: Number(p.fromId), fromName: p.fromName });
      refreshRequests().then(paintRequests);
    });
    sock.on('friendAccepted', p => {
      if (!p || !p.byId) return;
      notifiedDone.add('acc:' + Number(p.byId));
      notifyBell('✅ İstek kabul edildi', p.byName + ' arkadaşlık isteğini kabul etti — artık arkadaşsınız! 🎉',
        { type: 'friendAccepted', fromId: Number(p.byId), fromName: p.byName });
      friendsCache = null;
      refreshFriends().then(() => refreshRequests()).then(paintAll);
    });
    sock.on('friendDeclined', p => {
      if (!p || !p.byId) return;
      notifiedDone.add('dec:' + Number(p.byId));
      const txt = p.kind === 'cancelled'
        ? p.byName + ' arkadaşlık isteğini geri çekti.'
        : p.byName + ' arkadaşlık isteğini kabul etmedi.';
      notifyBell('🚫 İstek yanıtlandı', txt,
        { type: 'friendDeclined', fromId: Number(p.byId), fromName: p.byName });
      refreshRequests().then(paintAll);
    });
    sock.on('inviteRejected', p => toast('⚠️ ' + ((p && p.reason) || 'Davet gönderilemedi.'), 'warning'));
    sock.on('inviteSent', p => toast(`📩 ${(p && p.toName) || 'Arkadaşınız'} oyuna davet edildi! Katılması bekleniyor...`, 'success'));
    sock.on('inviteAnswered', p => {
      if (!p) return;
      toast(p.accepted
        ? `✅ ${p.byName} davetinizi kabul etti, masaya geliyor!`
        : `❌ ${p.byName} davetinizi reddetti.`, p.accepted ? 'success' : 'info');
    });
  }
  setInterval(() => {
    [window.__gvRoomSocket, window.__gvLobbySocket, window.__gvChessSocket].forEach(attach);
  }, 900);

  // ---------------- Mevcut fonksiyonların üzerine bağlan ----------------
  function hook() {
    if (!window.GV || hook.done) return;
    const GV = window.GV;

    // Her iki erişim yolunu da bağla (eski kod bare-global, yeni kod GV.*).
    const both = (name, fn) => { GV[name] = fn; window[name] = fn; };

    // Arkadaş listesi: üyelerde gerçek liste, misafirde mevcut uyarı
    const origSearch = GV.searchFriends;
    both('searchFriends', function (q) {
      if (myId()) return renderFriendsMember(q || '');
      if (typeof origSearch === 'function') return origSearch.apply(this, arguments);
    });
    both('renderFriends', function () { window.searchFriends(''); });

    // İsimle arkadaş ekle (gerçek arama + gerçek kayıt)
    both('addFriend', function (name) { addFriendByName(name); });

    // Üst bardaki 👥 Arkadaşlarım penceresi (sol alt bölümün yerini aldı)
    const openFriendsReal = function () {
      if (!myId()) return showModal('guestPromptModal');
      window.GV.showModal('friendsModal');
      renderFriendsMember('');
      paintRequests();
      refreshFriends().then(() => renderFriendsMember(''));
      refreshRequests().then(paintRequests);
    };
    both('openFriends', openFriendsReal);
    // 🔔 bildirimine tıklayınca aynı pencere açılır (istekler bölümü üstte)
    both('openFriendRequests', openFriendsReal);
    both('addFriendFromModal', function () {
      const inp = document.getElementById('friendsAddInput');
      const v = (inp && inp.value || '').trim();
      if (inp) inp.value = '';
      addFriendByName(v);
    });
    both('filterFriends', function (q) { renderFriendsMember(q || ''); });

    // Profil: indexteki sahte skorlu modal yerine gerçek profil
    both('openFriendProfile', function (name) {
      const f = (friendsCache || []).find(x => String(x.name).toLowerCase() === String(name).toLowerCase());
      if (f) return openProfile(f.id);
      // isim listede yoksa üye aramasıyla bul
      api('/api/users/search?q=' + encodeURIComponent(name), null, 'GET').then(r => {
        const u = (r.users || []).find(x => x.name.toLowerCase() === String(name).toLowerCase());
        if (u) openProfile(u.id);
        else toast('Profil bulunamadı: ' + name, 'warning');
      });
    });

    // Stok inviteFriend (isimle): SAHTE koltuk doldurmayı iptal — gerçek davet yolla
    both('inviteFriend', function (name) {
      const f = (friendsCache || []).find(x => String(x.name).toLowerCase() === String(name).toLowerCase());
      if (f) return inviteFriendById(f.id);
      explainNoInvite();
    });

    // Özel masadan davet penceresi: gerçek arkadaş listesiyle doldur
    const realShowInvite = async function () {
      if (!myId()) return showModal('guestPromptModal');
      const el = document.getElementById('inviteFriendList');
      if (el) {
        await refreshFriends();
        const list = friendsCache || [];
        el.innerHTML = list.length ? list.map(f => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--bg3);border-radius:8px">
          <div style="display:flex;align-items:center;gap:8px;cursor:pointer" data-uid="${Number(f.id)}">
            <div class="avatar sm">${esc(String(f.name).charAt(0))}</div>
            <span style="font-weight:600;font-size:0.9em">${esc(f.name)} ${f.online ? '🟢' : '🔴'}</span>
          </div>
          <button class="btn btn-sm btn-p" ${f.online ? '' : 'disabled style="opacity:0.4"'}
            onclick="window.GVSocial && GVSocial.inviteFriendById(${Number(f.id)})">Davet Gönder</button>
        </div>`).join('')
          : '<div style="padding:10px;text-align:center;color:var(--text3);font-size:.85em">Henüz arkadaşınız yok. Bir profilden arkadaş ekleyin!</div>';
      }
      showModal('inviteFriendModal');
    };
    both('showInviteModal', realShowInvite);

    // Davet popup'ı kabul/ret → gönderene geri bildirim
    const origAccept = GV.acceptInvitePopup;
    const wrappedAccept = function () {
      const n = st8().activeInviteData;
      const fresh = n && (Date.now() - Number(n.time || 0)) / 1000 <= 30;
      if (fresh) emitInviteResponse(n.actionData, true);
      if (typeof origAccept === 'function') return origAccept.apply(this, arguments);
    };
    both('acceptInvitePopup', wrappedAccept);
    const origDecline = GV.declineInvitePopup;
    const wrappedDecline = function () {
      const n = st8().activeInviteData;
      if (n) emitInviteResponse(n.actionData, false);
      if (typeof origDecline === 'function') return origDecline.apply(this, arguments);
    };
    both('declineInvitePopup', wrappedDecline);

    // 8 sn'de bir çevrimiçi durumları + arkadaşlık isteklerini tazele
    // (anlık soket bildirimi kaçarsa — çevrimdışıydı vs. — buradan yakalanır)
    setInterval(async () => {
      if (!myId()) return;
      await refreshFriends();
      await refreshRequests();
      paintFriends('');
      paintRequests();
    }, 8000);

    // Bağlanma anında üyeyse listeyi hemen doldur
    if (myId() && friendsCache === null) {
      refreshFriends().then(() => paintFriends(''));
    }

    hook.done = true;
  }
  hook.done = false;
  setInterval(hook, 500);

  // Üyelik durumu/ilk yükleme bekçisi: auth.js /api/auth/me cevabını alıp st'yi
  // doldurduktan sonra renderFriends çağrısı hook'tan önce koşmuş olabilir;
  // bu bekçi üyelik tespit edilir edilmez gerçek listeyi basar (en fazla 1.2 sn
  // mock liste görünür, sonra gerçek arkadaşlar gelir). Çıkışta önbellek sıfırlanır.
  setInterval(() => {
    if (myId()) {
      if (friendsCache === null && !friendsBusy) {
        refreshFriends().then(() => paintFriends(''));
      }
      if (requestsCache === null && !requestsBusy) {
        refreshRequests().then(paintRequests);
      }
    } else if (friendsCache !== null || requestsCache !== null) {
      friendsCache = null;
      requestsCache = null;
      snapSeeded = false;
      seenIncoming = new Set();
      seenOutgoing = new Set();
      updateReqBadge(0);
    }
  }, 1200);

  // İsme tıklama → profil (sayfanın her yerinde, tek dinleyici)
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-uid]') : null;
    if (!el) return;
    const uid = Number(el.getAttribute('data-uid'));
    if (uid > 0) {
      e.preventDefault();
      openProfile(uid);
    }
  });

  window.GVSocial = {
    openProfile, inviteFriendById, canInvite, toggleFriend,
    refreshFriends, isFriend,
    sendRequest, acceptRequest, declineRequest, refreshRequests, reqStateWith,
    _test: { paintFriends, renderFriendsMember, paintRequests, digestRequests }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectCss, { once: true });
  else injectCss();
})();
