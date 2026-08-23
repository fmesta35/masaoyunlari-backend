'use strict';

/*
 * /api/online-status — arkadaş/profil çevrimiçi bayraklarının kaynağı.
 *
 *  PHP'de çevrimiçi durumu YOK (Render soket haritasında yaşar). Yeni
 *  mimaride istemci bu ucu Render'dan çağırıp PHP listesine bayrağı
 *  kendisi birleştirir; uç hiçbir PHP çağrısı yapmaz (DDoS dayanıklı).
 *  1) Bağlı+doğrulanmış üye online=true görünür.
 *  2) Bağlı olmayan üye online=false.
 *  3) Üye kimliği olmadan bayrak SIZMAZ (harita boş döner).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-onstat-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');
const { io } = require('socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
  return { id: log.user.id, token: log.token };
}
const once = (s, ev, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms || 8000);
  s.once(ev, p => { clearTimeout(t); res(p); });
});

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const A = await verifiedUser(BASE, 'Bir', 'bir@os.tr');
  const B = await verifiedUser(BASE, 'Iki', 'iki@os.tr');
  const C = await verifiedUser(BASE, 'Uc', 'uc@os.tr'); // bağlanmayacak

  const aS = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise(r => aS.on('connect', r));
  const ready = once(aS, 'authReady');
  aS.emit('authHello', { token: A.token });
  await ready;
  await sleep(200);

  // 1-2) üye kimliğiyle: bağlı=true, bağlı olmayan=false
  let r = await api(BASE, '/api/online-status', { ids: [A.id, B.id, C.id], token: A.token }, 'POST');
  assert.ok(r.ok && typeof r.online === 'object', 'harita döndü');
  assert.strictEqual(r.online[A.id], true, 'bağlı üye online=true');
  assert.strictEqual(r.online[B.id], false, 'bağlantısız üye online=false');
  assert.strictEqual(r.online[C.id], false, 'üçüncü üye online=false');
  console.log('  ✓ 1-2) üye: bağlı üye online=true, diğerleri false');

  // 3) üyesiz çağrı: bayrak sızmaZ (boş harita)
  r = await api(BASE, '/api/online-status', { ids: [A.id] }, 'POST');
  assert.ok(r.ok, 'ok ama');
  assert.strictEqual(r.online[A.id], undefined, 'üyesiz çağrıda bayrak yok');
  console.log('  ✓ 3) üye kimliği olmadan bayrak döndürülmedi');

  aS.disconnect();
  serverModule.io && serverModule.io.close();
  server.close();
  console.log('\n✅ ONLINE-STATUS: çevrimiçi bayrak ucu doğru çalışıyor');
  process.exit(0);
}
main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
