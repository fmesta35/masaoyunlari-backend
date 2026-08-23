'use strict';

/*
 * ARKADAŞLIK BİLDİRİMİ UÇTAN UCA (jsdom, iki sayfa + gerçek sunucu):
 *
 *  1) A → B arkadaşlık isteği: B'nin BİLDİRİMİ yanar ve bildirimin
 *     ÜZERİNDE "✓ Kabul Et / ✗ Reddet" butonları görünür.
 *  2) B bildiriden REDDEDER → A'ya "reddedildi" bildirimi gider,
 *     arkadaşlık KURULMAZ (listelerde birbirleri yok).
 *  3) A tekrar ister → B bildiriden KABUL EDER → A'ya "kabul edildi /
 *     arkadaş oldunuz" bildirimi gider, listelerde birbirleri görünür.
 *  4) B, ARKADAŞ LİSTESİNDEKİ 🗑 butonuyla A'yı çıkarır → iki taraftaki
 *     listelerde arkadaşlık kalkar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-fnotif-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (ms || 15000)) {
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
  const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms || 15000);
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
      w.confirm = () => true; // removeFriend onay diyaloğu otomatik evet
      try { w.localStorage.setItem('gv-auth-token', token); } catch (_) {}
    }
  });
  const win = dom.window;
  await waitFor(() => (win.st && win.GV && win.GVSocial ? true : null), 15000, 'sayfa açılışı (' + name + ')');
  await waitFor(() => (!win.st.isGuest && win.st.user && win.st.user.id ? win.st.user : null), 15000, 'otomatik giriş (' + name + ')');
  return win;
}
function firstNotif(win, type) {
  return (win.st.notifications || []).find(n => n.actionData && n.actionData.type === type) || null;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const A = await verifiedUser(BASE, 'Alper', 'alper@fn.tr');
  const B = await verifiedUser(BASE, 'Buse', 'buse@fn.tr');

  const winA = await loadPage(BASE, A.token, 'A');
  const winB = await loadPage(BASE, B.token, 'B');
  const sockA = winA.__gvLobbySocket, sockB = winB.__gvLobbySocket;
  assert.ok(sockA && sockB, 'iki sayfanın lobi soketi kuruldu');
  assert.ok((await once(sockA, 'authReady')).ok, 'A kimlikli');
  assert.ok((await once(sockB, 'authReady')).ok, 'B kimlikli');
  await waitFor(() => (sockB.__gvSocial ? true : null), 15000, 'social.js B soketine bağlı');
  await waitFor(() => (sockA.__gvSocial ? true : null), 15000, 'social.js A soketine bağlı');
  console.log('  ✓ hazırlık) iki sayfa açık, soketler kimlikli + social.js bağlı');

  // ---------- 1) A → B isteği: B'de BİLDİRİM + ÜZERİNDE butonlar ----------
  winA.GVSocial.sendRequest(B.id);
  const reqNotif = await waitFor(() => firstNotif(winB, 'friendRequest'), 15000, 'B\'ye arkadaşlık isteği bildirimi');
  assert.strictEqual(Number(reqNotif.actionData.fromId), A.id, 'bildirim A\'dan');
  await waitFor(() => {
    const el = winB.document.getElementById('notifList');
    return (el && /Kabul Et/.test(el.innerHTML) && /Reddet/.test(el.innerHTML)) ? el : null;
  }, 15000, 'bildirim üzerinde Kabul Et/Reddet butonları');
  console.log('  ✓ 1) B\'ye bildirim gitti; bildirim ÜZERİNDE "Kabul Et / Reddet" butonları var');

  // ---------- 2) B bildiriden REDDEDER → A'ya bildirim, arkadaşlık YOK ----------
  winB.GV.friendNotifAction(reqNotif.id, 'decline');
  await waitFor(() => firstNotif(winA, 'friendDeclined'), 15000, 'A\'ya "reddedildi" bildirimi');
  assert.ok(!firstNotif(winB, 'friendRequest'), 'B\'de bekleyen isteği kalktı (butonla yanıtlandı)');
  // listelerde birbirleri YOK
  await sleep(300);
  winA.GV.searchFriends('');
  winB.GV.searchFriends('');
  await sleep(300);
  assert.ok(!/Buse/.test(winA.document.getElementById('gvFriendsModalList').innerHTML), 'A listesinde Buse YOK');
  assert.ok(!/Alper/.test(winB.document.getElementById('gvFriendsModalList').innerHTML), 'B listesinde Alper YOK');
  console.log('  ✓ 2) B reddetti → A\'ya bildirim gitti, eklenmediler (listeler temiz)');

  // ---------- 3) A tekrar ister → B bildiriden KABUL EDER ----------
  winA.GVSocial.sendRequest(B.id);
  const reqNotif2 = await waitFor(() => firstNotif(winB, 'friendRequest'), 15000, 'B\'ye ikinci istek bildirimi');
  winB.GV.friendNotifAction(reqNotif2.id, 'accept');
  await waitFor(() => firstNotif(winA, 'friendAccepted'), 15000, 'A\'ya "kabul edildi" bildirimi');
  // listelerde birbirleri GÖRÜNÜR
  await waitFor(() => {
    winA.GV.searchFriends('');
    return /Buse/.test(winA.document.getElementById('gvFriendsModalList').innerHTML) ? true : null;
  }, 15000, 'A listesinde Buse');
  await waitFor(() => {
    winB.GV.searchFriends('');
    return /Alper/.test(winB.document.getElementById('gvFriendsModalList').innerHTML) ? true : null;
  }, 15000, 'B listesinde Alper');
  // 🗑 butonu satırlarda var mı?
  assert.ok(/🗑/.test(winA.document.getElementById('gvFriendsModalList').innerHTML), 'arkadaş satırında 🗑 (çıkar) butonu');
  console.log('  ✓ 3) B kabul etti → A\'ya bildirim gitti, iki listeye de eklendiler; satırlarda 🗑 var');

  // ---------- 4) B, listeden 🗑 ile A'yı çıkarır ----------
  winB.GVSocial.removeFriend(A.id); // confirm() stub=true
  await waitFor(async () => {
    winB.GV.searchFriends('');
    return !/Alper/.test(winB.document.getElementById('gvFriendsModalList').innerHTML) ? true : null;
  }, 15000, 'B listesinde Alper kalktı');
  await waitFor(async () => {
    // A'ya "çıkarıldı" bildirimi yok (tasarım gereği); listesi periyodik
    // taramada tazellenir — testte elle de tazeleyip hızlandırıyoruz.
    await winA.GVSocial.refreshFriends();
    winA.GV.searchFriends('');
    await sleep(50);
    return !/Buse/.test(winA.document.getElementById('gvFriendsModalList').innerHTML) ? true : null;
  }, 15000, 'A listesinde Buse kalktı');
  console.log('  ✓ 4) B listeden 🗑 ile çıkardı → her iki listeden de arkadaşlık kalktı');

  console.log('\n✅ FRIEND-NOTIFICATION: istek → bildirim(butonlu) → kabul/red → listeden çıkarma uçtan uca doğru');
  winA.close(); winB.close();
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
