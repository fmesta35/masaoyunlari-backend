'use strict';

/*
 * ARKADAŞLIK İSTEĞİ AKIŞI (yerel SQLite modunda uçtan uca)
 *
 *  A) İstek gönderme artık DİREKT EKLEMEZ: istek bekleyenlerde durur,
 *     iki tarafın da arkadaş listesi boş kalır.
 *  B) /api/friends/requests: gelen/giden istekler doğru taraflarda görünür.
 *  C) Anlık bildirim: friendRequestPing yalnızca GERÇEKTEN bekleyen istek
 *     varsa karşı tarafa 'friendRequest' iletilir (sahte ping engellenir).
 *  D) Red: istek silinir, arkadaşlık KURULMAZ; 'friendDeclined' (kind=declined).
 *     İptal: gönderen geri çeker; 'friendDeclined' (kind=cancelled).
 *  E) Kabul: iki taraf da arkadaş olur; istek sahibine 'friendAccepted'.
 *  F) Çapraz istek: iki taraf birbirine istek gönderirse otomatik kabul.
 *  G) Aynı isteğin tekrarı 409; kendine istek 400; arkadaşa istek 409.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-freq-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');

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

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const { io } = require('socket.io-client');

  const A = await verifiedUser(BASE, 'Ali', 'ali@t.com');
  const B = await verifiedUser(BASE, 'Bora', 'bora@t.com');
  const C = await verifiedUser(BASE, 'Cem', 'cem@t.com');
  const D = await verifiedUser(BASE, 'Deniz', 'deniz@t.com');

  // ---------- A) istek direkt ekleMEZ ----------
  let r = await api(BASE, '/api/friends/request', { friendId: B.id }, 'POST', A.token);
  assert.ok(r.ok && r.requested && !r.accepted, 'istek kurulmalı');
  r = await api(BASE, '/api/friends', null, 'GET', A.token);
  assert.ok(r.ok && r.friends.length === 0, 'A listesi hâlâ BOŞ olmalı');
  r = await api(BASE, '/api/friends', null, 'GET', B.token);
  assert.ok(r.ok && r.friends.length === 0, 'B listesi hâlâ BOŞ olmalı');
  console.log('  ✓ A) istek gönderildi ama kimse listeye EKLENMEDİ (direkt ekleme yok)');

  // ---------- B) istekler doğru taraflarda ----------
  r = await api(BASE, '/api/friends/requests', null, 'GET', B.token);
  assert.ok(r.ok && r.incoming.some(x => x.id === A.id) && r.outgoing.length === 0, 'B gelen isteği görmeli');
  r = await api(BASE, '/api/friends/requests', null, 'GET', A.token);
  assert.ok(r.ok && r.outgoing.some(x => x.id === B.id) && r.incoming.length === 0, 'A giden isteği görmeli');
  console.log('  ✓ B) /requests: gelen/giden istekler doğru taraflarda listeleniyor');

  // ---------- G) kural ihlalleri ----------
  r = await api(BASE, '/api/friends/request', { friendId: B.id }, 'POST', A.token);
  assert.strictEqual(r.status, 409, 'aynı istek tekrarı 409');
  r = await api(BASE, '/api/friends/request', { friendId: A.id }, 'POST', A.token);
  assert.strictEqual(r.status, 400, 'kendine istek 400');
  console.log('  ✓ G) mükerrer istek 409, kendine istek 400');

  // ---------- soket bağlantıları ----------
  const conn = name => new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    const t = setTimeout(() => reject(new Error('conn ' + name)), 8000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
    s.on('connect_error', reject);
  });
  const once = (s, ev, ms) => new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms || 8000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
  const aSock = await conn('A'), bSock = await conn('B');
  const cSock = await conn('C'), dSock = await conn('D');
  aSock.emit('authHello', { token: A.token });
  bSock.emit('authHello', { token: B.token });
  cSock.emit('authHello', { token: C.token });
  dSock.emit('authHello', { token: D.token });
  await Promise.all([once(aSock, 'authReady'), once(bSock, 'authReady'), once(cSock, 'authReady'), once(dSock, 'authReady')]);

  // ---------- C) anlık bildirim: gerçek istek ping'i iletilir ----------
  const gotReq = once(bSock, 'friendRequest');
  aSock.emit('friendRequestPing', { toUserId: B.id }); // A → B bekleyen istek var (A adımında kuruldu)
  const frq = await gotReq;
  assert.strictEqual(Number(frq.fromId), A.id);
  assert.strictEqual(frq.fromName, 'Ali');
  // sahte ping: C → D arasında istek YOK → bildirim gitmemeli
  let ghost = false;
  dSock.on('friendRequest', () => { ghost = true; });
  cSock.emit('friendRequestPing', { toUserId: D.id });
  await sleep(600);
  assert.ok(!ghost, 'bekleyen istek olmadan bildirim gitmemeli');
  console.log('  ✓ C) anlık bildirim doğrulamalı: gerçek istek ulaştı, sahte ping engellendi');

  // ---------- D) red: arkadaşlık KURULMAZ + declined bildirimi ----------
  const gotDec = once(aSock, 'friendDeclined');
  r = await api(BASE, '/api/friends/decline', { friendId: A.id }, 'POST', B.token); // B reddediyor
  assert.ok(r.ok, 'red işlenebilmeli');
  bSock.emit('friendDeclinePing', { toUserId: A.id, kind: 'declined' });
  const dec = await gotDec;
  assert.strictEqual(dec.kind, 'declined');
  r = await api(BASE, '/api/friends', null, 'GET', A.token);
  assert.ok(r.friends.length === 0, 'red sonrası arkadaş YOK');
  r = await api(BASE, '/api/friends/requests', null, 'GET', B.token);
  assert.ok(r.incoming.length === 0, 'red sonrası bekleyen istek kalmadı');
  console.log('  ✓ D) red: istek silindi, arkadaşlık kurulmadı, gönderene declined bildirimi düştü');

  // ---------- E) kabul: iki taraf da arkadaş ----------
  r = await api(BASE, '/api/friends/request', { friendId: D.id }, 'POST', A.token); // A → D
  assert.ok(r.ok && r.requested);
  const gotAcc = once(aSock, 'friendAccepted');
  r = await api(BASE, '/api/friends/accept', { friendId: A.id }, 'POST', D.token); // D kabul ediyor
  assert.ok(r.ok && r.accepted && r.friends.some(x => x.id === A.id), 'kabul arkadaş listesiyle dönmeli');
  dSock.emit('friendAcceptPing', { toUserId: A.id });
  const acc = await gotAcc;
  assert.strictEqual(Number(acc.byId), D.id);
  r = await api(BASE, '/api/friends', null, 'GET', A.token);
  assert.ok(r.friends.some(x => x.id === D.id), 'A listesinde D var');
  r = await api(BASE, '/api/friends', null, 'GET', D.token);
  assert.ok(r.friends.some(x => x.id === A.id), 'D listesinde A var');
  r = await api(BASE, '/api/friends/request', { friendId: D.id }, 'POST', A.token);
  assert.strictEqual(r.status, 409, 'zaten arkadaşsa istek 409');
  console.log('  ✓ E) kabul: iki taraf da arkadaş oldu, istek sahibine accepted bildirimi düştü');

  // ---------- iptal (kind=cancelled) ----------
  r = await api(BASE, '/api/friends/request', { friendId: B.id }, 'POST', C.token); // C → B
  assert.ok(r.ok && r.requested);
  const gotCancel = once(bSock, 'friendDeclined');
  r = await api(BASE, '/api/friends/decline', { friendId: B.id }, 'POST', C.token); // C geri çekiyor
  assert.ok(r.ok);
  cSock.emit('friendDeclinePing', { toUserId: B.id, kind: 'cancelled' });
  const cn = await gotCancel;
  assert.strictEqual(cn.kind, 'cancelled');
  console.log('  ✓ D2) iptal: gönderen isteği geri çekebildi, karşı tarafa cancelled bildirimi');

  // ---------- F) çapraz istek → otomatik kabul ----------
  r = await api(BASE, '/api/friends/request', { friendId: C.id }, 'POST', B.token); // B → C
  assert.ok(r.ok && r.requested);
  r = await api(BASE, '/api/friends/request', { friendId: B.id }, 'POST', C.token); // C → B (karşılık)
  assert.ok(r.ok && r.accepted, 'çapraz istek otomatik kabul olmalı');
  r = await api(BASE, '/api/friends', null, 'GET', C.token);
  assert.ok(r.friends.some(x => x.id === B.id), 'C listesinde B var');
  console.log('  ✓ F) iki taraf birbirine istek gönderirse otomatik arkadaş olurlar');

  // ---------- arkadaştan çıkarma sonrası tekrar istek ----------
  r = await api(BASE, '/api/friends/remove', { friendId: D.id }, 'POST', A.token);
  assert.ok(r.ok);
  r = await api(BASE, '/api/friends/request', { friendId: D.id }, 'POST', A.token);
  assert.ok(r.ok && r.requested, 'çıkardıktan sonra tekrar istek gönderilebilmeli');
  console.log('  ✓ H) çıkarma sonrası yeniden istek akışı çalışıyor');

  console.log('\n✅ FRIEND-REQUESTS: istek → bildirim → kabul/red akışı tümüyle doğru');
  [aSock, bSock, cSock, dSock].forEach(s => s.disconnect());
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
