'use strict';

/*
 * İMZALI BELGELER (attest + friendProof) — Yöncü DDoS korumasına dayanıklılık.
 *
 *  Üretimde Yöncü'nün DDoS/anti-bot koruması Render'ın SUNUCU-SUNUCU PHP
 *  isteklerini 303+HTML ile engelliyor (tarayıcı istekleri serbest). Bu
 *  yüzden Render'ın PHP'ye erişemediği bir ortam simüle edilir
 *  (GV_AUTH_API = erişilemeyen adres) ve doğrulananlar:
 *
 *   1) authHello + geçerli attest belgesi → kimlik PHP'ye GEREK DUYMADAN
 *      doğrulanır (authReady ok) — "Üyelik sunucusundan boş cevap" kalıcı
 *      çözümü.
 *   2) Sahte (imzası bozuk) / süresi dolmuş belge → reddedilir.
 *   3) PHP'ye erişilemeyen ortamda YALNIZCA token ile kimlik doğrulanamaz
 *      (beklenen davranış — belge gerekir).
 *   4) Özel oda: belgeyle kimliklenen kurucu masa kurar + creatorId kaydedilir.
 *   5) Davet: friendProof belgesiyle arkadaş davet EDİLEBİLİR (PHP'siz);
 *      belgesiz + PHP erişilemezse "yalnızca arkadaş" reddi.
 *   6) Davetsiz üye (geçerli belgeyle bile) özel odaya giremez (policy).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-attest-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';
// Render'ın PHP'ye ulaşamadığı ortamı simüle et (DDoS 303 engeli).
process.env.GV_AUTH_API = 'http://127.0.0.1:9/api';
const KEY = 'test-attest-key-0123456789-abcdef';
process.env.GV_SERVER_KEY = KEY;

const assert = require('assert');
const crypto = require('crypto');
const serverModule = require('../server.js');
const { io } = require('socket.io-client');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function sign(msg) {
  return crypto.createHmac('sha256', KEY).update(msg).digest('hex');
}
function makeAttest(id, name, opts = {}) {
  const ts = opts.ts !== undefined ? opts.ts : Date.now();
  const exp = opts.exp !== undefined ? opts.exp : ts + 10 * 60 * 1000;
  const sig = opts.sig !== undefined ? opts.sig : sign(id + '|' + name + '|' + ts + '|' + exp);
  return { id, name, ts, exp, sig };
}
function makeFriendProof(a, b, opts = {}) {
  const ts = opts.ts !== undefined ? opts.ts : Date.now();
  const exp = opts.exp !== undefined ? opts.exp : ts + 10 * 60 * 1000;
  const sig = opts.sig !== undefined ? opts.sig : sign('friend|' + a + '|' + b + '|' + ts + '|' + exp);
  return { a, b, ts, exp, sig };
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
const never = (s, ev, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => res(true), ms || 700);
  s.once(ev, p => { clearTimeout(t); rej(new Error(ev + ' gelmemeliydi: ' + JSON.stringify(p))); });
});

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const AID = 101, BID = 202, CID = 303;
  const attA = makeAttest(AID, 'Kral');
  const attB = makeAttest(BID, 'Dost');
  const attC = makeAttest(CID, 'Yaban');

  // ---------- 1) authHello + geçerli belge → PHP'siz kimlik ----------
  const aS = await conn(BASE, 'A');
  const rA = once(aS, 'authReady');
  aS.emit('authHello', { attestation: attA }); // token YOK — belge yetmeli
  const arA = await rA;
  assert.ok(arA.ok && Number(arA.user.id) === AID, 'belgeyle kimlik doğrulandı (PHP çağrısı yok)');
  console.log('  ✓ 1) authHello + attest: PHP erişilmes de kimlik doğrulandı');

  // ---------- 2) sahte / süresi dolmuş belge reddedilir ----------
  const bad1 = await conn(BASE, 'bad1');
  const rB1 = once(bad1, 'authReady');
  bad1.emit('authHello', { attestation: makeAttest(999, 'Sahte', { sig: 'otuziki-sifirli-sahte-imza' }) });
  const arB1 = await rB1;
  assert.ok(!arB1.ok, 'imzası bozuk belge reddedildi');

  const bad2 = await conn(BASE, 'bad2');
  const rB2 = once(bad2, 'authReady');
  bad2.emit('authHello', { attestation: makeAttest(999, 'Eski', { ts: Date.now() - 20 * 60 * 1000, exp: Date.now() - 10 * 60 * 1000 }) });
  const arB2 = await rB2;
  assert.ok(!arB2.ok, 'süresi dolmuş belge reddedildi');

  // ---------- 3) PHP erişilemezken YALNIZ token yetmez (beklenen) ----------
  const tOnly = await conn(BASE, 'tokOnly');
  const rT = once(tOnly, 'authReady');
  tOnly.emit('authHello', { token: 'erisilemez-php-tokeni' });
  const arT = await rT;
  assert.ok(!arT.ok, "PHP'ye erişilemeyen ortamda yalnız token doğrulanamaz");
  console.log('  ✓ 2) sahte/imzasız/süresi dolmuş belgeler reddedildi');
  console.log('  ✓ 3) PHP erişilemezken token tek başına yetmiyor (belge akışı gerekli)');

  // ---------- 4) belgeyle özel masa kur + creatorId ----------
  const bS = await conn(BASE, 'B');
  const rB = once(bS, 'authReady');
  bS.emit('authHello', { attestation: attB });
  await rB;
  const cS = await conn(BASE, 'C');
  const rC = once(cS, 'authReady');
  cS.emit('authHello', { attestation: attC });
  await rC;

  const ROOM = '9300';
  const jA = once(aS, 'joinedRoom');
  aS.emit('joinRoom', {
    roomId: ROOM, gameId: 'chess', userName: 'Kral', userKey: 'user:' + AID,
    isPrivate: true, maxPlayers: 2, memberAttestation: attA
  });
  const jaP = await jA;
  assert.strictEqual(jaP.role, 'player', 'belgeyle kurucu koltukta');
  const room = serverModule.rooms.get(ROOM);
  assert.ok(room && room.isPrivate && Number(room.creatorId) === AID, 'creatorId belgeyle doğrulanan üyeye yazıldı');
  console.log('  ✓ 4) Belgeyle özel masa kuruldu + kurucu kaydedildi (PHP çağrısı yok)');

  // ---------- 5a) friendProof ile davet (PHP'siz) ----------
  const invB = once(bS, 'gameInvite');
  const sentB = once(aS, 'inviteSent');
  aS.emit('gameInvite', {
    toUserId: BID, roomId: ROOM,
    friendProof: makeFriendProof(AID, BID),
    toName: 'Dost'
  });
  const [ivB, sndB] = await Promise.all([invB, sentB]);
  assert.ok(ivB.inviteId && ivB.fromName === 'Kral', 'belgeyle davet iletildi');
  assert.strictEqual(sndB.toName, 'Dost', 'toName taşındı');
  console.log('  ✓ 5) friendProof belgesiyle davet gitti (PHP çağrısı gerekmedi)');

  // ---------- 5b) belgesiz + PHP erişilemez → "yalnızca arkadaş" reddi ----------
  const rej = once(aS, 'inviteRejected');
  const noC = never(cS, 'gameInvite', 700);
  aS.emit('gameInvite', { toUserId: CID, roomId: ROOM }); // proof YOK
  const rj = await rej;
  assert.ok(/arkadaş/i.test(rj.reason), 'belgesiz davet (PHP kapalı) reddi: ' + rj.reason);
  await noC;
  console.log('  ✓ 6) belgesiz davet, PHP erişilemezken "yalnızca arkadaş" kuralıyla reddedildi');

  // ---------- 6) davetsiz üye özel odaya giremez (geçerli belgeyle bile) ----------
  const denyC = once(cS, 'joinDenied');
  cS.emit('joinRoom', {
    roomId: ROOM, gameId: 'chess', userName: 'Yaban', userKey: 'user:' + CID,
    memberAttestation: attC
  });
  const dc = await denyC;
  assert.strictEqual(dc.code, 'policy', 'davetsiz üye policy reddi aldı');
  console.log('  ✓ 7) davetsiz üye (geçerli belgeyle) özel odaya giremedi');

  // ---------- 7) davetli üye belgeyle girebilir; ilk bağlanan koltuğu alır ----------
  const jB = once(bS, 'joinedRoom');
  bS.emit('joinRoom', { roomId: ROOM, gameId: 'chess', userName: 'Dost', userKey: 'user:' + BID, memberAttestation: attB, viaInvite: true });
  const jbP = await jB;
  assert.strictEqual(jbP.role, 'player', 'davetli üye belgeyle oturdu');
  assert.strictEqual(Number(serverModule.rooms.get(ROOM).creatorId), AID, 'kurucu hakkı korunuyor (devralınmadı)');
  console.log('  ✓ 8) davetli üye belgeyle katıldı; kurucu hakkı kurucuda kaldı');

  console.log('\n✅ ATTEST-FLOW: DDoS ortamında imzalı belgelerle üyelik + özel oyun kuralları çalışıyor');
  [aS, bS, cS, bad1, bad2, tOnly].forEach(s => { try { s.disconnect(); } catch (_) {} });
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
