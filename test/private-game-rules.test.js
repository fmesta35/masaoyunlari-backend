'use strict';

/*
 * ÖZEL OYUN KURALLARI — kullanıcı senaryosunun uçtan uca regresyon testi.
 *
 *  Senaryo: üye kayıt olup E-POSTA ONAYINDAN geçtikten sonra "Özel oyun
 *  oluştur" komutunu kullanır. Sunucunun KESİNLİKLE uygulaması gerekenler:
 *
 *   1) E-posta onaylı üye girişi AKTİF:
 *        - kayıt → onay linki üretilir; onaysız giriş 403 (needVerify)
 *        - onaydan sonra giriş başarılı, oturum token'ı alınır
 *   2) Özel masada YALNIZCA masa kurucusu, KENDİ arkadaş listesindeki
 *      arkadaşını davet edebilir:
 *        - arkadaş OLMAYANA davet reddi
 *        - arkadaş katıldıktan SONRA bile kurucu hakları KURUCUDA kalır
 *          (ikinci oturan davet/atma yetkisi DEVRALAMAZ)
 *        - kurucu olmayan üye (aynı masada otursa bile) davet GÖNDEREMEZ
 *   3) Kurucu, arkadaşının arkadaş listesinde AKTİF (çevrimiçi) olup
 *      olmadığını görebilir: /api/friends her arkadaşta online bayrağını
 *      döndürür (authHello soketiyle yanar).
 *   4) Özel oyuna YALNIZCA davetli kullanıcı gelebilir:
 *        - misafir giremez (auth)
 *        - davetsiz üye giremez (policy)
 *   5) Çoklu davette İLK BAĞLANAN katılır: 2 kişilik masada ikinci davetli
 *      "Oda dolu" reddi alır.
 *   6) Sahte/bozuk jetonla özel masa KURULAMAZ (kesin geçersiz → auth reddi).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-pgrules-'));
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

async function registerUser(base, name, email) {
  const reg = await api(base, '/api/auth/register', { name, email, password: 'ortaksifre9' });
  assert.ok(reg.ok, name + ' kaydı: ' + JSON.stringify(reg));
  assert.strictEqual(reg.mailSent, false, 'SMTP kapalıyken mailSent=false (link logda)');
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token, verified FROM users WHERE id = ?').get(reg.userId);
  assert.ok(row && row.verify_token, 'onay jetonu üretilmeli');
  assert.strictEqual(Number(row.verified), 0, 'yeni üye ONAYSIZ başlar');
  return { id: reg.userId, email, verifyToken: row.verify_token };
}

async function befriend(base, u, v) {
  const r1 = await api(base, '/api/friends/request', { friendId: v.id }, 'POST', u.token);
  assert.ok(r1.ok && (r1.requested || r1.accepted), 'istek kurulmalı');
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
const never = (s, ev, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => res(true), ms || 700);
  s.once(ev, p => { clearTimeout(t); rej(new Error(ev + ' gelmemeliydi: ' + JSON.stringify(p))); });
});

async function memberSock(base, u) {
  const s = await conn(base, u.name);
  const r = once(s, 'authReady');
  s.emit('authHello', { token: u.token });
  const ar = await r;
  assert.ok(ar.ok, u.name + ' authHello');
  return s;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1) E-posta onaylı üye girişi aktif ----------
  const A = await registerUser(BASE, 'Kurucu', 'kurucu@pgr.com');
  let l = await api(BASE, '/api/auth/login', { email: A.email, password: 'ortaksifre9' });
  assert.strictEqual(l.status, 403, 'onaysız üye giriş YAPAMAZ');
  assert.ok(l.needVerify, 'needVerify bayrağı');
  l = await api(BASE, '/api/auth/verify', { token: A.verifyToken });
  assert.ok(l.ok, 'onay bağlantısı işler');
  l = await api(BASE, '/api/auth/login', { email: A.email, password: 'ortaksifre9' });
  assert.ok(l.ok && l.token, 'onaylı üye giriş yapar, token alır');
  A.token = l.token; A.id = l.user.id;

  const B = await registerUser(BASE, 'Berk', 'berk@pgr.com');
  const C = await registerUser(BASE, 'Ceyda', 'ceyda@pgr.com');
  for (const u of [B, C]) {
    const v = await api(BASE, '/api/auth/verify', { token: u.verifyToken });
    assert.ok(v.ok, u.email + ' onayı');
    l = await api(BASE, '/api/auth/login', { email: u.email, password: 'ortaksifre9' });
    assert.ok(l.ok && l.token, u.email + ' girişi');
    u.token = l.token; u.id = l.user.id;
  }
  await befriend(BASE, A, B);
  await befriend(BASE, A, C);
  console.log('  ✓ 1) e-posta onaylı üye girişi aktif (onaysız 403 → onay → giriş)');

  // ---------- Soketler ----------
  const aS = await memberSock(BASE, A);
  const bS = await memberSock(BASE, B);
  const cS = await memberSock(BASE, C);
  const guestS = await conn(BASE, 'guest');

  // ---------- 3) Kurucu arkadaşının AKTİF olma durumunu görür ----------
  let fr = await api(BASE, '/api/friends', null, 'GET', A.token);
  assert.ok(fr.ok, 'arkadaş listesi döner');
  assert.strictEqual(fr.friends.length, 2, 'kurucunun 2 arkadaşı var');
  assert.strictEqual(fr.friends.find(f => f.id === B.id).online, true, 'çevrimiçi arkadaş AKTİF görünür');
  assert.strictEqual(fr.friends.find(f => f.id === C.id).online, true, 'diğer çevrimiçi arkadaş da aktif');
  // C çıkış yapınca (soket kapanınca) aktif durumu sönük düşer
  cS.disconnect();
  await sleep(300);
  fr = await api(BASE, '/api/friends', null, 'GET', A.token);
  assert.strictEqual(fr.friends.find(f => f.id === C.id).online, false, 'çevrimdışı arkadaş AKTİF değil');
  const cS2 = await memberSock(BASE, C); // geri bağlan
  console.log('  ✓ 2) kurucu arkadaşının aktif/çevrimiçi durumunu arkadaş listesinde görüyor');

  // ---------- Özel oyun oluştur (kurucu) ----------
  const ROOM = '8001';
  const ja = once(aS, 'joinedRoom');
  aS.emit('joinRoom', {
    roomId: ROOM, gameId: 'chess', userName: 'Kurucu', userKey: 'user:' + A.id,
    isPrivate: true, maxPlayers: 2, durationMinutes: 10
  });
  const jaP = await ja;
  assert.strictEqual(jaP.role, 'player', 'kurucu koltukta');
  assert.strictEqual(Number(jaP.room.creatorId), A.id, 'oda kaydında kurucu = üreten üye');
  const room = serverModule.rooms.get(ROOM);
  assert.ok(room && room.isPrivate && Number(room.creatorId) === A.id);
  console.log('  ✓ 3) "özel oyun oluştur": kurucu koltukta, creatorId kayıtlı');

  // ---------- 4b) Özel oyuna YALNIZCA davetli kullanıcı gelebilir ----------
  let deny = once(guestS, 'joinDenied');
  guestS.emit('joinRoom', { roomId: ROOM, gameId: 'chess', userName: 'Misafir', userKey: 'guest:pg:t1' });
  let dmsg = await deny;
  assert.strictEqual(dmsg.code, 'auth', 'misafir özel odaya giremez');
  deny = once(cS2, 'joinDenied');
  cS2.emit('joinRoom', { roomId: ROOM, gameId: 'chess', userName: 'Ceyda', userKey: 'user:' + C.id });
  dmsg = await deny;
  assert.strictEqual(dmsg.code, 'policy', 'DAVETSİZ üye (arkadaş olsa bile) giremez');
  assert.ok(/davetli/i.test(dmsg.reason));
  console.log('  ✓ 4) özel oyuna yalnızca davetli kullanıcı gelebilir (misafir + davetsiz üye reddi)');

  // ---------- 5) Çoklu davet → İLK BAĞLANAN katılır ----------
  // Kurucu, kendi arkadaş listesindeki İKİ arkadaşını (B ve C) aynı masaya
  // davet eder — çoklu davet serbesttir; koltukları ilk bağlanacaklar alır.
  const invC = once(cS2, 'gameInvite');
  const sentC = once(aS, 'inviteSent');
  aS.emit('gameInvite', { toUserId: C.id, roomId: ROOM });
  await Promise.all([invC, sentC]);
  const invB = once(bS, 'gameInvite');
  const sentB = once(aS, 'inviteSent');
  aS.emit('gameInvite', { toUserId: B.id, roomId: ROOM });
  await Promise.all([invB, sentB]);

  // İLK B bağlanır → koltuğu o alır
  const jb = once(bS, 'joinedRoom');
  bS.emit('joinRoom', { roomId: ROOM, gameId: 'chess', userName: 'Berk', userKey: 'user:' + B.id, viaInvite: true });
  const jbP = await jb;
  assert.strictEqual(jbP.role, 'player', 'ilk bağlanan davetli koltuğu aldı');
  // SONRA C bağlanır → masa dolu (2/2) → "Oda dolu"
  deny = once(cS2, 'joinDenied');
  cS2.emit('joinRoom', { roomId: ROOM, gameId: 'chess', userName: 'Ceyda', userKey: 'user:' + C.id, viaInvite: true });
  dmsg = await deny;
  assert.strictEqual(dmsg.code, 'full', 'ikinci davetli: oda dolu');
  assert.ok(/dolu/i.test(dmsg.reason));
  console.log('  ✓ 5) çoklu davet: ilk bağlanan katıldı, ikinci davetli "Oda dolu" aldı');

  // ---------- 2b) Kurucu hakları KURUCUDA KALDI (devralınmadı) ----------
  assert.strictEqual(Number(room.creatorId), A.id, 'B katıldı ama creatorId hâlâ kurucu');
  // Kurucu olmayan (aynı masada oturan B) davet GÖNDEREMEZ:
  let rej = once(bS, 'inviteRejected');
  bS.emit('gameInvite', { toUserId: A.id, roomId: ROOM });
  let rejP = await rej;
  assert.ok(/kurucu/i.test(rejP.reason) || /kuran/i.test(rejP.reason), 'B davet gönderemez: ' + rejP.reason);
  // Kurucu DAHA DA davet edebilir (masa doluyken "dolu" — yetki hâlâ onda):
  rej = once(aS, 'inviteRejected');
  aS.emit('gameInvite', { toUserId: C.id, roomId: ROOM });
  rejP = await rej;
  assert.ok(/dolu/i.test(rejP.reason), 'kurucu yetkisiyle davet denedi, masa dolu dedi');
  // Kurucu atabilir, B atamaz:
  const kickByB = once(bS, 'kickResult');
  bS.emit('kickPlayer', { roomId: ROOM, userId: A.id });
  assert.ok(!(await kickByB).ok, 'kurucu olmayan ATAMAZ');
  const kickByA = once(aS, 'kickResult');
  const kicked = once(bS, 'kickedFromRoom');
  aS.emit('kickPlayer', { roomId: ROOM, userId: B.id });
  assert.ok((await kickByA).ok, 'kurucu atar');
  await kicked;
  console.log('  ✓ 6) arkadaş katıldıktan sonra dahi davet/atma yetkisi YALNIZCA kurucuda');

  // ---------- 2c) Arkadaş OLMAYANA davet gidemez ----------
  // B atıldı + yeniden davet edilmedi → giremez; ayrıca A, B'nin ARKADAŞLIKTAN
  // ÇIKARILMADAN da "arkadaş olmayan" testini D üyesiyle yapmak için:
  const D = await registerUser(BASE, 'Derya', 'derya@pgr.com');
  const vD = await api(BASE, '/api/auth/verify', { token: D.verifyToken });
  assert.ok(vD.ok, 'D onayı');
  l = await api(BASE, '/api/auth/login', { email: D.email, password: 'ortaksifre9' });
  D.token = l.token; D.id = l.user.id;
  const dS = await memberSock(BASE, D);
  // A, D'ye davet edemez (arkadaş değiller). Önce masayı boşalt: B atıldı, masa 1/1.
  rej = once(aS, 'inviteRejected');
  aS.emit('gameInvite', { toUserId: D.id, roomId: ROOM });
  rejP = await rej;
  assert.ok(/arkadaş/i.test(rejP.reason), 'arkadaş olmayan üye davet EDİLEMEZ: ' + rejP.reason);
  const noD = await never(dS, 'gameInvite', 700);
  assert.ok(noD, 'arkadaş olmayan davet bildirimi ALMADI');
  // Çevrimdışı arkadaş da davet edilemez: C soketini kapat
  cS2.disconnect();
  await sleep(300);
  rej = once(aS, 'inviteRejected');
  aS.emit('gameInvite', { toUserId: C.id, roomId: ROOM });
  rejP = await rej;
  assert.ok(/çevrimiçi değil/i.test(rejP.reason), 'çevrimdışı arkadaş davet edilemez');
  console.log('  ✓ 7) davet yalnız KURUCUNUN arkadaş listesindeki, ÇEVRİMİÇİ arkadaşına gider');

  // ---------- 6) Sahte jetonla özel masa kurulamaz ----------
  const bad = await conn(BASE, 'badTok');
  const d2 = once(bad, 'joinDenied');
  bad.emit('joinRoom', { roomId: '8009', gameId: 'chess', userName: 'Sahte', userKey: 'guest:pg:x', isPrivate: true, memberToken: 'gecersiz-jeton-123' });
  dmsg = await d2;
  assert.strictEqual(dmsg.code, 'auth', 'sahte jetonla özel masa kurulamaz');
  assert.strictEqual(serverModule.rooms.get('8009'), undefined, 'reddedilen kurma girişimi boş oda bırakmaz');
  // Sahte jetonla MEVCUT özel odaya da girilemez:
  const bad2 = await conn(BASE, 'badTok2');
  const d3 = once(bad2, 'joinDenied');
  bad2.emit('joinRoom', { roomId: ROOM, gameId: 'chess', userName: 'Sahte2', userKey: 'guest:pg:y', memberToken: 'gecersiz-jeton-456' });
  dmsg = await d3;
  assert.strictEqual(dmsg.code, 'auth', 'sahte jetonla mevcut özel odaya girilemez');
  console.log('  ✓ 8) sahte/bozuk jeton: özel masa ne kurulur ne girilir (kesin red + boş oda kalmaz)');

  console.log('\n✅ PRIVATE-GAME-RULES: özel oyun kuralları uçtan uca doğru');
  [aS, bS, dS, guestS, bad, bad2].forEach(s => { try { s.disconnect(); } catch (_) {} });
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
