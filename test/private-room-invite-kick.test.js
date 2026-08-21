'use strict';

/*
 * ÖZEL ODA GÜVENLİĞİ + DAVET/ATMA AKIŞI (yerel SQLite modunda uçtan uca)
 *
 *  A) Genel oda: herkes katılabilir (gerileme — davetsiz üye+misafir girer).
 *  B) Özel oda kilidi: misafir GİREMEZ, davetsiz üye GİREMEZ (joinDenied).
 *  C) Davet = giriş hakkı: davetli katılabilir; çoklu davet — İLK GELEN oturur,
 *     dolu masaya sonraki davetli "Oda dolu" reddi alır; masa doluyken yeni
 *     davet de gönderilemez (oyuncu zaten masadaysa da reddedilir).
 *  D) Geçersiz davet: kapalı masaya viaInvite katılım "davet artık geçerli
 *     değil"; oyundaki masaya davetle giriş de geçersizdir.
 *  E) Kurucu ATMA: atılan oyuncu kickedFromRoom alır, yeniden GİREMEZ;
 *     kurucu yeniden davet ederse (yeni hak) tekrar girebilir.
 *  F) Arkadaşlıktan çıkarma: çıkardıktan sonra davet GÖNDERİLEMEZ.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-priv-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');
const { io } = require('socket.io-client');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (ms || 8000)) {
    try { last = await fn(); } catch (e) { last = null; }
    if (last) return last;
    await sleep(100);
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
async function befriend(base, u, v) {
  const r1 = await api(base, '/api/friends/request', { friendId: v.id }, 'POST', u.token);
  assert.ok(r1.ok && r1.requested, 'istek kurulmalı');
  const r2 = await api(base, '/api/friends/accept', { friendId: u.id }, 'POST', v.token);
  assert.ok(r2.ok, 'kabul edilmeli');
}

function conn(base, name) {
  const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('conn ' + name)), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', reject);
  });
}
const once = (s, ev, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms || 8000);
  s.once(ev, p => { clearTimeout(t); res(p); });
});
async function memberSock(base, u) {
  const s = await conn(base, u.name);
  const r = once(s, 'authReady');
  s.emit('authHello', { token: u.token });
  const ar = await r;
  assert.ok(ar.ok, u.name + ' authHello');
  return s;
}
const mk = (u, extra) => Object.assign({
  roomId: '7001', gameId: 'chess', userName: u.name, userKey: 'user:' + u.id, maxPlayers: 2
}, extra || {});

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await verifiedUser(BASE, 'Kurucu', 'kurucu@t.com');
  const B = await verifiedUser(BASE, 'Bora', 'bora@t.com');
  const C = await verifiedUser(BASE, 'Cem', 'cem@t.com');
  const D = await verifiedUser(BASE, 'Deniz', 'deniz@t.com');
  await befriend(BASE, A, B);
  await befriend(BASE, A, C);
  await befriend(BASE, A, D);
  console.log('  ✓ hazırlık) 4 üye, Kurucu herkesle arkadaş');

  const aS = await memberSock(BASE, A);
  const bS = await memberSock(BASE, B);
  const cS = await memberSock(BASE, C);
  const dS = await memberSock(BASE, D);
  const guestS = await conn(BASE, 'guest'); // authHello YOK (misafir)

  // ---------- A) Genel oda: davetsiz herkes (üye + misafir) girebilir ----------
  {
    const j1 = once(dS, 'joinedRoom');
    dS.emit('joinRoom', mk(D, { roomId: '6001' })); // genel oda (isPrivate yok)
    assert.strictEqual((await j1).role, 'player', 'üye genel odaya girer');
    const j2 = once(guestS, 'joinedRoom');
    guestS.emit('joinRoom', { roomId: '6001', gameId: 'chess', userName: 'Misafir', userKey: 'guest:g1:t1', maxPlayers: 2 });
    const gj = await j2;
    assert.ok(gj.role === 'player' || gj.role === 'spectator', 'misafir genel odaya girer/izler');
    dS.emit('leaveRoom'); guestS.emit('leaveRoom');
    await sleep(150);
    console.log('  ✓ A) genel oda herkese açık kaldı (gerileme yok)');
  }

  // ---------- A2) memberToken (soket yükü) ile özel oda — authHello yarışı yok ----------
  {
    const fresh = await conn(BASE, 'freshD'); // authHello GÖNDERMEZ — kimlik yarışı simülasyonu
    const j = once(fresh, 'joinedRoom');
    fresh.emit('joinRoom', mk(D, { roomId: '6002', isPrivate: true, memberToken: D.token }));
    assert.strictEqual((await j).role, 'player', 'memberToken ile özel oda kurulabilmeli (authHello beklemeden)');
    const r2 = serverModule.rooms.get('6002');
    assert.ok(r2 && r2.isPrivate && Number(r2.creatorId) === D.id, 'creatorId token kanıtıyla kurucuya yazılır');
    fresh.emit('leaveRoom');
    await sleep(120);
    const bad = await conn(BASE, 'badTok');
    const d2 = once(bad, 'joinDenied');
    bad.emit('joinRoom', { roomId: '6003', gameId: 'chess', userName: 'Sahte', userKey: 'guest:x:t', isPrivate: true, memberToken: 'bozuk-jeton-123' });
    assert.strictEqual((await d2).code, 'auth', 'bozuk jeton hâlâ reddedilir');
    fresh.disconnect(); bad.disconnect();
    console.log('  ✓ A2) memberToken (soket yükü) ile özel oda kurma — authHello yarışı önemsiz');
  }

  // ---------- Özel oda kur (A) ----------
  const ja = once(aS, 'joinedRoom');
  aS.emit('joinRoom', mk(A, { isPrivate: true, roomName: 'Özel Masa' }));
  assert.strictEqual((await ja).role, 'player', 'kurucu koltukta');
  const room = serverModule.rooms.get('7001');
  assert.ok(room && room.isPrivate && Number(room.creatorId) === A.id, 'özel oda + kurucu kayıtlı');

  // ---------- B) kilit: misafir + davetsiz üye giremez ----------
  let deny = once(guestS, 'joinDenied');
  guestS.emit('joinRoom', { roomId: '7001', gameId: 'chess', userName: 'Misafir', userKey: 'guest:g1:t1' });
  let dmsg = await deny;
  assert.strictEqual(dmsg.code, 'auth', 'misafir özel odaya giremez');
  deny = once(dS, 'joinDenied');
  dS.emit('joinRoom', mk(D));
  dmsg = await deny;
  assert.strictEqual(dmsg.code, 'policy', 'davetsiz üye giremez');
  assert.ok(/davetli/.test(dmsg.reason));
  console.log('  ✓ B) özel oda kilidi: misafir ve davetsiz üye GİREMEDİ (joinDenied)');

  // ---------- C) çoklu davet → İLK GELEN oturur; dolu → "Oda dolu" ----------
  let inv1 = once(bS, 'gameInvite'), sent1 = once(aS, 'inviteSent');
  aS.emit('gameInvite', { toUserId: B.id, roomId: '7001' });
  await Promise.all([inv1, sent1]);
  let inv2 = once(cS, 'gameInvite'), sent2 = once(aS, 'inviteSent');
  aS.emit('gameInvite', { toUserId: C.id, roomId: '7001' }); // çoklu davet serbest
  await Promise.all([inv2, sent2]);

  let jb = once(bS, 'joinedRoom');
  bS.emit('joinRoom', mk(B, { viaInvite: true }));
  assert.strictEqual((await jb).role, 'player', 'davetli B oturdu (ilk gelen)');
  deny = once(cS, 'joinDenied');
  cS.emit('joinRoom', mk(C, { viaInvite: true }));
  dmsg = await deny;
  assert.strictEqual(dmsg.code, 'full', 'masa dolu: ikinci davetli giremez');
  assert.ok(/dolu/i.test(dmsg.reason), '"Oda dolu" uyarısı');

  // masa doluyken yeni davet GÖNDERİLEMEZ
  let rej = once(aS, 'inviteRejected');
  aS.emit('gameInvite', { toUserId: D.id, roomId: '7001' });
  assert.ok(/dolu/i.test((await rej).reason), 'dolu masaya davet reddi');
  // masadaki oyuncuya davet GÖNDERİLEMEZ (masa doluyken "dolu", yoksa "zaten masada")
  rej = once(aS, 'inviteRejected');
  aS.emit('gameInvite', { toUserId: B.id, roomId: '7001' });
  assert.ok(/zaten masada|dolu/i.test((await rej).reason), 'masadakine davet reddi');
  console.log('  ✓ C) çoklu davet: ilk gelen oturdu, "Oda dolu" + dolu masaya davet engeli çalışıyor');

  // ---------- D) geçersiz davet mesajları ----------
  deny = once(cS, 'joinDenied');
  cS.emit('joinRoom', mk(C, { roomId: '7999', viaInvite: true })); // hiç olmayan oda
  dmsg = await deny;
  assert.strictEqual(dmsg.code, 'stale', 'kapalı masa');
  assert.ok(/geçerli değil/i.test(dmsg.reason), '"davet artık geçerli değil" metni');
  // misafir özel masa KURAMAZ
  deny = once(guestS, 'joinDenied');
  guestS.emit('joinRoom', { roomId: '7002', gameId: 'chess', userName: 'Misafir', userKey: 'guest:g1:t1', isPrivate: true, maxPlayers: 2 });
  assert.strictEqual((await deny).code, 'auth', 'misafir özel masa kuramaz');
  console.log('  ✓ D) geçersiz davet + misafir özel masa kurma engeli');

  // ---------- E) kurucu ATMA → giremez; yeniden davet → girebilir ----------
  const kickRes = once(aS, 'kickResult');
  const kickedEv = once(bS, 'kickedFromRoom');
  aS.emit('kickPlayer', { roomId: '7001', userId: B.id });
  assert.ok((await kickRes).ok, 'atma başarılı');
  await kickedEv;
  deny = once(bS, 'joinDenied');
  bS.emit('joinRoom', mk(B));
  assert.strictEqual((await deny).code, 'kicked', 'atılan oyuncu yeniden giremez');

  // yanlış yetki: kurucu olmayan atamaz
  const kickRes2 = once(dS, 'kickResult');
  dS.emit('kickPlayer', { roomId: '7001', userId: A.id });
  assert.ok(!(await kickRes2).ok, 'kurucu olmayan atamaz');

  // yeni davet = yeni giriş hakkı (kickBan temizlenir)
  const inv3 = once(bS, 'gameInvite'), sent3 = once(aS, 'inviteSent');
  aS.emit('gameInvite', { toUserId: B.id, roomId: '7001' });
  await Promise.all([inv3, sent3]);
  jb = once(bS, 'joinedRoom');
  bS.emit('joinRoom', mk(B, { viaInvite: true }));
  assert.strictEqual((await jb).role, 'player', 'yeniden davet edilen tekrar girebildi');
  console.log('  ✓ E) atma: atılan giremedi; yeni davet hakkı yeniden açtı');

  // ---------- D2) oyun başladıktan sonra davetle giriş geçersiz ----------
  aS.emit('setReady', { ready: true });
  bS.emit('setReady', { ready: true });
  await Promise.all([once(aS, 'gameStarted'), once(bS, 'gameStarted')]);
  deny = once(cS, 'joinDenied');
  cS.emit('joinRoom', mk(C, { viaInvite: true })); // C hâlâ davetliydi ama masa oyunda
  dmsg = await deny;
  assert.ok(dmsg.code === 'stale' || dmsg.code === 'full', 'oyundaki masaya davetle giriş reddi');
  assert.ok(/geçerli değil|dolu/i.test(dmsg.reason));
  console.log('  ✓ D2) oyun başladıktan sonra davet geçersiz');

  // ---------- F) arkadaşlıktan çıkarma → listeler iki tarafta güncellenir, davet biter ----------
  const rm = await api(BASE, '/api/friends/remove', { friendId: B.id }, 'POST', A.token);
  assert.ok(rm.ok, 'çıkarma işlendi');
  let lf = await api(BASE, '/api/friends', null, 'GET', A.token);
  assert.ok(!lf.friends.some(x => x.id === B.id), 'A listesinden düştü');
  lf = await api(BASE, '/api/friends', null, 'GET', B.token);
  assert.ok(!lf.friends.some(x => x.id === A.id), 'B listesinden de düştü (iki taraf)');
  // davet testi bekleyen (boş) yeni bir özel masada yapılır: "dolu/oyunda"
  // redleri arkadaşlık reddini maskeler.
  const ja2 = once(aS, 'joinedRoom');
  aS.emit('joinRoom', mk(A, { roomId: '7006', isPrivate: true, roomName: 'İkinci Masa' }));
  assert.strictEqual((await ja2).role, 'player');
  rej = once(aS, 'inviteRejected');
  aS.emit('gameInvite', { toUserId: B.id, roomId: '7006' });
  assert.ok(/arkadaş/i.test((await rej).reason), 'arkadaş olmayana davet reddi');
  console.log('  ✓ F) çıkarma: iki tarafın listesi de güncellendi + davet yolu kapandı');

  console.log('\n✅ PRIVATE-ROOM: özel oda kilidi + davet/atma akışı tümüyle doğru');
  [aS, bS, cS, dS, guestS].forEach(s => s.disconnect());
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
