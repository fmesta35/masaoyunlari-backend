'use strict';

/*
 * DAVET AKIŞI UÇTAN UCA (jsdom + gerçek sunucu) — kullanıcı senaryosu:
 *
 *  1) REGRESYON: window.addNotification sayfada global (eski sürümde IIFE
 *     içinde kalmıştı → davet/arkadaşlık bildirimleri istemcide SESSİZCE
 *     DÜŞÜYOR; sunucu yolluyordu, alan kullanıcı görmüyordu).
 *  2) Kurucu (A) özel masa kurup arkadaşını (B) davet eder:
 *       - B'nin soketi gameInvite ALIR (sunucu yayını),
 *       - A'nın davet penceresinde rozet "⏳ Davetli" olur.
 *  3) B'nin SAYFASINDA (ikinci jsdom): davet popup'ı görünür;
 *     "Kabul Et" → odaya bağlanır (joinedRoom, koltukta).
 *  4) Kabul SONUCU A'ya düşer: rozet "✅ Kabul edildi" olur.
 *  5) B yeniden davet edilip REDDEDİNCE: A'da rozet "❌ Reddedildi" olur.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-invite-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');
const { io } = require('socket.io-client');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (ms || 12000)) {
    try { last = await fn(); } catch (e) { last = null; }
    if (last) return last;
    await sleep(150);
  }
  throw new Error('zaman aşımı: ' + label);
}
async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function verifiedUser(base, name, email) {
  const reg = await api(base, '/api/auth/register', { name, email, password: 'ortaksifre9' });
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId);
  await api(base, '/api/auth/verify', { token: row.verify_token });
  const log = await api(base, '/api/auth/login', { email, password: 'ortaksifre9' });
  return { id: log.user.id, name: log.user.name, token: log.token };
}
const once = (s, ev, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms || 12000);
  s.once(ev, p => { clearTimeout(t); res(p); });
});

function makeVc() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  return vc;
}
async function loadPage(base, token, name) {
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: makeVc(),
    beforeParse(w) {
      w.GV_BACKEND_URL = base;
      w.fetch = (...a) => fetch(...a);
      w.confirm = () => true;
      try { w.localStorage.setItem('gv-auth-token', token); } catch (_) {}
    }
  });
  const win = dom.window;
  await waitFor(() => (win.st && win.GV && win.GVSocial ? true : null), 15000, 'sayfa açılışı (' + name + ')');
  await waitFor(() => (!win.st.isGuest && win.st.user && win.st.user.id ? win.st.user : null), 15000, 'otomatik giriş (' + name + ')');
  return win;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await verifiedUser(BASE, 'Kurucu', 'kurucu@inv.tr');
  const B = await verifiedUser(BASE, 'Davetli', 'davetli@inv.tr');
  const rq = await api(BASE, '/api/friends/request', { friendId: B.id }, 'POST', A.token);
  assert.ok(rq.ok, 'arkadaşlık isteği');
  const ac = await api(BASE, '/api/friends/accept', { friendId: A.id }, 'POST', B.token);
  assert.ok(ac.ok, 'arkadaşlık kabul');

  // ---------- A: kurucunun sayfası ----------
  const winA = await loadPage(BASE, A.token, 'A');

  // 1) REGRESYON: addNotification global — bildirimler sessiz düşmesin
  assert.strictEqual(typeof winA.addNotification, 'function',
    'window.addNotification global olmalı (yoksa davet bildirimi sessiz düşer)');
  console.log('  ✓ 1) window.addNotification global (sessiz bildirim düşüşü regresyonu kapandı)');

  // A'nın lobi soketi kimlikli mi? (authReady ok — 1.5 sn'lik authHello taraması)
  const sockA = winA.__gvLobbySocket;
  assert.ok(sockA, 'A lobi soketi kuruldu');
  let arA = await once(sockA, 'authReady');
  assert.ok(arA.ok, 'A soket kimliği doğrulandı (authReady)');

  // A özel masa kurar (soketi üzerinden — gerçek istemci davranışı)
  const ROOM = '9501';
  const joinedA = once(sockA, 'joinedRoom');
  sockA.emit('joinRoom', {
    roomId: ROOM, gameId: 'chess', userName: A.name, userKey: 'user:' + A.id,
    isPrivate: true, maxPlayers: 2, durationMinutes: 10, memberToken: A.token
  });
  const jA = await joinedA;
  assert.strictEqual(jA.role, 'player', 'kurucu koltukta');
  // pencere için aktif oda bağlamı (davet rozetleri bu odaya aittir)
  winA.__gvActiveRoom = jA.room;
  winA.__gvActiveRoomId = ROOM;
  console.log('  ✓ 2) kurucu özel masada (koltukta)');

  // B'nin SAYFASI açılsın (daveti orada görecek kullanıcı)
  const winB = await loadPage(BASE, B.token, 'B');
  const sockB = winB.__gvLobbySocket;
  assert.ok(sockB, 'B lobi soketi kuruldu');
  let arB = await once(sockB, 'authReady');
  assert.ok(arB.ok, 'B soket kimliği doğrulandı (authReady)');
  // social.js dinleyicisi bağlandı mı?
  await waitFor(() => (sockB.__gvSocial ? true : null), 12000, 'social.js B soketine bağlı');

  // ---------- 1. DAVET: B REDDEDER ----------
  // A davet penceresini açar (liste dolmalı)
  winA.GV.showInviteModal();
  await waitFor(() => {
    const el = winA.document.getElementById('inviteFriendList');
    return (el && /Davet Gönder/.test(el.innerHTML)) ? el : null;
  }, 12000, 'davet penceresinde arkadaş listesi');

  const bInvite = once(sockB, 'gameInvite');
  const aSent = once(sockA, 'inviteSent');
  winA.GVSocial.inviteFriendById(B.id);
  const [bInv, aSnd] = await Promise.all([bInvite, aSent]);
  assert.ok(bInv.inviteId && String(bInv.roomId) === ROOM, 'B davet BİLDİRİMİNİ aldı (sunucu yayını)');
  assert.strictEqual(aSnd.toName, B.name, 'A gönderene bilgi aldı');
  console.log('  ✓ 3) davet: B bildirimini aldı, A "gönderildi" geri bildirimi aldı');

  // A'nın davet penceresinde "⏳ Davetli" rozeti (inviteSent → yeniden boyama)
  await waitFor(() => {
    const el = winA.document.getElementById('inviteFriendList');
    return (el && /Davetli/.test(el.innerHTML)) ? el : null;
  }, 12000, 'A penceresinde "Davetli" rozeti');
  console.log('  ✓ 4) A\'nın davet penceresinde rozet: ⏳ Davetli');

  // B'nin sayfasında popup + REDDET → A'da "❌ Reddedildi"
  const popup = await waitFor(() => {
    const m = winB.document.getElementById('invitePopupModal');
    return (m && m.classList.contains('show')) ? m : null;
  }, 12000, 'B\'de davet popup\'ı görünür');
  assert.ok(/Kurucu/.test(popup.innerHTML), 'popup gönderen ismini gösterir');
  assert.ok(/Kabul Et/.test(popup.innerHTML) && /Reddet/.test(popup.innerHTML),
    'popupta Kabul Et + Reddet seçenekleri var');
  winB.GV.declineInvitePopup();
  await waitFor(() => {
    const el = winA.document.getElementById('inviteFriendList');
    return (el && /Reddedildi/.test(el.innerHTML)) ? el : null;
  }, 12000, 'A\'da "Reddedildi" rozeti');
  console.log('  ✓ 5) B "Reddet" dedi → A\'daki rozet: ❌ Reddedildi');

  // ---------- 2. DAVET (yenileme): B KABUL EDER → odaya bağlanır ----------
  const bInv2 = once(sockB, 'gameInvite');
  const aSent2 = once(sockA, 'inviteSent');
  winA.GVSocial.inviteFriendById(B.id);
  await Promise.all([bInv2, aSent2]);
  await waitFor(() => {
    const m = winB.document.getElementById('invitePopupModal');
    return (m && m.classList.contains('show')) ? m : null;
  }, 12000, 'B\'de ikinci davet popup\'ı');
  // Kabul → odaya bağlan (B'nin sayfası gerçek room-waiting akışını çalıştırır;
  // join, room-waiting-fix'in kendi soketi üzerinden gittiği için SUNUCU
  // tarafındaki oda üyeliğini izliyoruz — B koltuğa oturana kadar bekle).
  winB.GV.acceptInvitePopup();
  await waitFor(() => {
    const r = serverModule.rooms.get(ROOM);
    return (r && r.players.some(p => Number(p.userId) === B.id)) ? r : null;
  }, 20000, 'B kabul edince odada (koltukta)');
  assert.ok(winB.st.curRoom === ROOM || winB.__gvActiveRoomId === ROOM, 'B sayfası odada');
  console.log('  ✓ 6) B "Kabul Et" dedi → odaya bağlandı, koltukta');

  // ---------- A'ya kabul SONUCU düşer: rozet "✅ Kabul edildi" ----------
  await waitFor(() => {
    const el = winA.document.getElementById('inviteFriendList');
    return (el && /Kabul edildi/.test(el.innerHTML)) ? el : null;
  }, 12000, 'A\'da "Kabul edildi" rozeti');
  console.log('  ✓ 7) A\'daki rozet güncellendi: ✅ Kabul edildi');

  console.log('\n✅ INVITE-NOTIFICATION: davet → bildirim → kabul/red → rozet akışı uçtan uca doğru');
  winA.close(); winB.close();
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
