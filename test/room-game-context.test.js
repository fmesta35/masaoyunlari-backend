'use strict';

/*
 * ODA OYUN BAĞLAMI SENKRONU — "aynı masa, farklı oyun adı" karışıklığı:
 *
 *  Kurucu SATRANÇ sayfasındayken özel satranç masası kurar; davetli ise
 *  OKEY sayfasındayken daveti kabul eder. Masa SUNUCUDA tek ve satrançtır
 *  (room.gameId), ama istemci başlığı/oyun modülünü kendi sayfa oyunundan
 *  (st.curGame) alıyordu → davetlide "Okey Masa #X" görünürdü.
 *
 *  Bu test: kurucu satranç masası kurar, davetli okey bağlamındayken kabul
 *  eder → istemci bağlamı masanın gerçek oyununa (satranç) senkronlanır,
 *  bekleme odası başlığı "Satranç Masa #X" yazar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-ctx-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');
const { JSDOM, VirtualConsole } = require('jsdom');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (ms || 15000)) {
    try { last = await fn(); } catch (_) { last = null; }
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
  const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms || 15000);
  s.once(ev, p => { clearTimeout(t); res(p); });
});
function makeVc() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  return vc;
}
async function loadPage(base, token) {
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: makeVc(),
    beforeParse(w) {
      w.GV_BACKEND_URL = base;
      w.fetch = (...a) => fetch(...a);
      try { w.localStorage.setItem('gv-auth-token', token); } catch (_) {}
    }
  });
  const win = dom.window;
  await waitFor(() => (win.st && win.GV ? true : null), 15000, 'sayfa');
  await waitFor(() => (!win.st.isGuest && win.st.user && win.st.user.id ? win.st.user : null), 15000, 'otomatik giriş');
  await waitFor(() => (win.__gvLobbySocket ? win.__gvLobbySocket : null), 15000, 'lobi soketi');
  await once(win.__gvLobbySocket, 'authReady');
  return win;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const A = await verifiedUser(BASE, 'SatrancKurucusu', 'sk@ctx.tr');
  const B = await verifiedUser(BASE, 'OkeyDavetli', 'od@ctx.tr');
  const rq = await api(BASE, '/api/friends/request', { friendId: B.id }, 'POST', A.token);
  assert.ok(rq.ok, 'arkadaşlık isteği');
  const ac = await api(BASE, '/api/friends/accept', { friendId: A.id }, 'POST', B.token);
  assert.ok(ac.ok, 'arkadaşlık kabul');

  // ---------- Kurucu: SATRANÇ bağlamında özel masa kurar ----------
  const winA = await loadPage(BASE, A.token);
  winA.st.curGame = 'chess';
  const ROOM = '9777';
  const jA = once(winA.__gvLobbySocket, 'joinedRoom');
  winA.__gvLobbySocket.emit('joinRoom', {
    roomId: ROOM, gameId: 'chess', userName: A.name, userKey: 'user:' + A.id,
    isPrivate: true, maxPlayers: 2, durationMinutes: 10, memberToken: A.token
  });
  const jA2 = await jA;
  assert.strictEqual(jA2.room.gameId, 'chess', 'sunucudaki masanın oyunu satranç');
  winA.__gvActiveRoom = jA2.room;
  winA.__gvActiveRoomId = ROOM;
  console.log('  ✓ 1) kurucu satranç bağlamında özel satranç masası kurdu (gameId=chess)');

  // ---------- Davetli: OKEY sayfasındayken (st.curGame=okey) ----------
  const winB = await loadPage(BASE, B.token);
  winB.st.curGame = 'okey'; // senaryo: davetli okey lobisinde dolaşıyor
  await waitFor(() => (winB.__gvLobbySocket.__gvSocial ? true : null), 15000, 'social.js bağlı');

  // Kurucu davet eder:
  const bInv = once(winB.__gvLobbySocket, 'gameInvite');
  winA.GVSocial.inviteFriendById(B.id);
  const inv = await bInv;
  assert.strictEqual(inv.gameId, 'chess', 'davet verisinde masanın oyunu taşınır (chess)');
  await waitFor(() => {
    const m = winB.document.getElementById('invitePopupModal');
    return (m && m.classList.contains('show')) ? m : null;
  }, 15000, 'B\'de davet popup');
  console.log('  ✓ 2) davetli (okey sayfasında) daveti aldı');

  // ---------- Kabul → bağlam masanın oyununa senkronlanır ----------
  winB.GV.acceptInvitePopup();
  // clickNotif, davetin gameId\'i ile st.curGame'i günceller:
  assert.strictEqual(winB.st.curGame, 'chess',
    'kabulde istemci oyun bağlamı masanın oyununa çekildi (okey → chess)');

  // Bekleme odası başlığı masanın GERÇEK oyununu yazar:
  const overlay = await waitFor(() => {
    const e = winB.document.getElementById('gv-real-chess-wait');
    return (e && e.innerHTML && e.innerHTML.indexOf('Masa #' + ROOM) !== -1) ? e : null;
  }, 20000, 'B bekleme odasında');
  assert.ok(overlay.innerHTML.indexOf('Satranç Masa #' + ROOM) !== -1,
    'başlık masanın oyununu göstermeli (Satranç), geldiği sayfanın oyununu değil: ' +
    (overlay.innerHTML.match(/<h2>([^<]*)<\/h2>/) || [])[1]);
  console.log('  ✓ 3) davetlide başlık "Satranç Masa #' + ROOM + '" — oyun karışıklığı yok');

  // Sunucuda masada her iki oyuncu:
  await waitFor(() => {
    const r = serverModule.rooms.get(ROOM);
    return (r && r.players.length === 2) ? r : null;
  }, 10000, 'masada iki oyuncu');
  assert.strictEqual(serverModule.rooms.get(ROOM).gameId, 'chess', 'masa hâlâ satranç');
  console.log('  ✓ 4) aynı masa, aynı oyun: ikisi de #' + ROOM + ' satranç masasında');

  console.log('\n✅ ROOM-GAME-CONTEXT: masa oyunu istemci bağlamına senkronlanır');
  winA.close(); winB.close();
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
