'use strict';

/*
 * SOSYAL AKIŞ — profil, arkadaşlık, oyun daveti, maç geçmişi.
 *
 *  A) Profil: üyelik bilgisi + çevrimiçi bayrağı (authHello olmadan çevrimdışı).
 *  B) Arkadaş: ekle/listele/çıkar; çevrimiçi durumu authHello soketiyle yanar.
 *  C) Davet kuralları (sunucu zorunlu tutar):
 *      1. ÖZEL masanın KURUCUSU, ÇEVRİMİÇİ ARKADAŞINI davet edebilir  → gameInvite gider.
 *      2. Arkadaş OLMAYANA davet reddedilir.
 *      3. Çevrimdışı arkadaşa davet reddedilir.
 *      4. Kurucu OLMAYAN (aynı özel masadaki) davet GÖNDEREMEZ.
 *      5. HERKESE AÇIK masadan davet gönderilemez.
 *      6. Misafir (authHello'suz soket) davet gönderemez.
 *  D) Davet cevabı: alan inviteResponse gönderir → kurucu inviteAnswered alır.
 *  E) Maç geçmişi: iki üye özel masada oynar, biri terk ederse maç HER İKİ
 *     üyenin de profiline işlenir (galibiyet/mağlubiyet ayrımıyla).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// server'dan ÖNCE (db ve zamanlayıcı sabitleri modül yüklenirken okunur).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-social-test-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');
const { io } = require('socket.io-client');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, {
    method: method || (body ? 'POST' : 'GET'),
    headers, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

function connect(url, name) {
  const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + name)), 8000);
    s.on('connect', () => { clearTimeout(t); s.userName = name; resolve(s); });
    s.on('connect_error', reject);
  });
}
function once(socket, event, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), ms || 8000);
    socket.once(event, p => { clearTimeout(t); resolve(p); });
  });
}
// Verilen sürede olay GELMEMELİ (yanlış yayına karşı koruma)
function never(socket, event, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(true), ms || 700);
    socket.once(event, p => { clearTimeout(t); reject(new Error(event + ' gelmemeliydi: ' + JSON.stringify(p))); });
  });
}

async function verifiedUser(base, name, email) {
  const reg = await api(base, '/api/auth/register', { name, email, password: 'ortaksifre9' });
  assert.ok(reg.ok, name + ' kaydı: ' + JSON.stringify(reg));
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId);
  const ver = await api(base, '/api/auth/verify', { token: row.verify_token });
  assert.ok(ver.ok, name + ' onayı');
  const log = await api(base, '/api/auth/login', { email, password: 'ortaksifre9' });
  assert.ok(log.ok && log.token, name + ' girişi');
  return { id: log.user.id, name: log.user.name, token: log.token };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const C = await verifiedUser(BASE, 'Kral', 'kral@test.com');
  const F = await verifiedUser(BASE, 'Dost', 'dost@test.com');
  const S = await verifiedUser(BASE, 'Yaban', 'yaban@test.com');
  const G = await verifiedUser(BASE, 'Uzak', 'uzak@test.com'); // hiç bağlanmayacak (çevrimdışı)
  console.log('  ✓ hazırlık) 4 üye kayıt + onay + giriş');

  // ---------- A) Profil: çevrimdışı üye ----------
  let prof = await api(BASE, '/api/users/' + F.id + '/profile', null, 'GET');
  assert.ok(prof.ok && prof.user.name === 'Dost', 'profil dönmeli');
  assert.strictEqual(prof.online, false, 'bağlı soketi olmayan üye çevrimdışı');
  assert.deepStrictEqual(prof.stats, {}, 'maçı yoksa istatistik boş');
  assert.deepStrictEqual(prof.recent, [], 'maçı yoksa geçmiş boş');
  const missing = await api(BASE, '/api/users/99999/profile', null, 'GET');
  assert.strictEqual(missing.status, 404, 'olmayan üye 404');
  console.log('  ✓ A) profil görüntüleme: bilgiler + çevrimdışı bayrak + boş geçmiş (404 dahil)');

  // ---------- Soketler + authHello ----------
  const cSock = await connect(BASE, 'C');
  const fSock = await connect(BASE, 'F');
  const sSock = await connect(BASE, 'S');
  cSock.emit('authHello', { token: C.token });
  fSock.emit('authHello', { token: F.token });
  sSock.emit('authHello', { token: S.token });
  const [rc, rf] = await Promise.all([once(cSock, 'authReady'), once(fSock, 'authReady'), once(sSock, 'authReady')]);
  assert.ok(rc.ok && rf.ok, 'authHello kabul edilmeli');
  prof = await api(BASE, '/api/users/' + F.id + '/profile', null, 'GET');
  assert.strictEqual(prof.online, true, 'authHello sonrası üye çevrimiçi görünmeli');
  console.log('  ✓ A2) authHello → üye çevrimiçi görünüyor');

  // Misafir davet gönderemez
  const guest = await connect(BASE, 'Guest');
  guest.emit('gameInvite', { toUserId: F.id, roomId: '9001' });
  const grj = await once(guest, 'inviteRejected');
  assert.ok(/üye/i.test(grj.reason), 'misafire üyelik reddi');
  console.log('  ✓ C6) misafir davet gönderemez');

  // ---------- B) Arkadaşlık ----------
  let r = await api(BASE, '/api/friends/add', { friendId: F.id }, 'POST', C.token);
  assert.ok(r.ok && r.friends.some(x => x.id === F.id), 'Kral → Dost arkadaş eklendi');
  assert.strictEqual(r.friends.find(x => x.id === F.id).online, true, 'arkadaş çevrimiçi bayrağı');
  r = await api(BASE, '/api/friends/add', { friendId: G.id }, 'POST', C.token);
  assert.ok(r.ok && r.friends.length === 2, 'Kral → Uzak da eklendi');
  r = await api(BASE, '/api/friends', null, 'GET', C.token);
  assert.strictEqual(r.friends.length, 2, 'liste 2 arkadaş');
  assert.strictEqual(r.friends.find(x => x.id === G.id).online, false, 'Uzak çevrimdışı');
  // karşı yönden de görünmeli (UNION)
  r = await api(BASE, '/api/friends', null, 'GET', F.token);
  assert.ok(r.friends.some(x => x.id === C.id), 'Dost listesinde Kral da görünür');
  // arama
  r = await api(BASE, '/api/users/search?q=dos', null, 'GET', C.token);
  assert.ok(r.ok && r.users.some(u => u.id === F.id), 'isim araması Dost\'u bulmalı');
  r = await api(BASE, '/api/users/search?q=dos', null, 'GET'); // token'sız
  assert.strictEqual(r.status, 401, 'aramada giriş zorunlu');
  console.log('  ✓ B) arkadaş ekle/listele (iki yön) + çevrimiçi durumu + isim arama');

  // ---------- Özel oda kur (Kral) ----------
  const joinPriv = once(cSock, 'joinedRoom');
  cSock.emit('joinRoom', {
    roomId: '9001', gameId: 'chess', userName: 'Kral', userKey: 'user:' + C.id,
    isPrivate: true, maxPlayers: 2, durationMinutes: 10
  });
  const jc = await joinPriv;
  assert.strictEqual(jc.role, 'player', 'kurucu oyuncu olmalı');
  // oda kaydına creatorId yazıldı mı? (özel odalar genel listeye düşmez — doğrudan haritaya bakılır)
  const privRoom = serverModule.rooms.get('9001');
  assert.ok(privRoom && privRoom.isPrivate, 'özel oda oluşmalı');
  assert.strictEqual(privRoom.creatorId, C.id, 'kurucu, ilk oturan üye (Kral) olmalı');

  // ---------- C) Davet kuralları ----------
  // 1) Kurucu → çevrimiçi arkadaş: BAŞARILI
  const inv = once(fSock, 'gameInvite');
  const sent = once(cSock, 'inviteSent');
  cSock.emit('gameInvite', { toUserId: F.id, roomId: '9001' });
  const [invP, sentP] = await Promise.all([inv, sent]);
  assert.ok(invP.fromName === 'Kral' && String(invP.roomId) === '9001' && invP.inviteId, 'davet yükü eksiksiz');
  assert.ok(sentP.ok && sentP.toName === 'Dost', 'gönderene bilgi düşmeli');
  console.log('  ✓ C1) özel masanın kurucusu çevrimiçi arkadaşını davet etti (bildirim yandı)');

  // 2) Arkadaş OLMAYAN: reddedilir
  let rej = once(cSock, 'inviteRejected');
  const noInv1 = never(sSock, 'gameInvite', 700);
  cSock.emit('gameInvite', { toUserId: S.id, roomId: '9001' });
  let rejP = await rej;
  assert.ok(/arkadaş/i.test(rejP.reason), 'arkadaşlık şartı ' + rejP.reason);
  await noInv1;
  console.log('  ✓ C2) arkadaş olmayana davet gitmedi');

  // 3) Çevrimdışı arkadaş: reddedilir
  rej = once(cSock, 'inviteRejected');
  cSock.emit('gameInvite', { toUserId: G.id, roomId: '9001' });
  rejP = await rej;
  assert.ok(/çevrimiçi değil/i.test(rejP.reason), 'çevrimdışı reddi');
  console.log('  ✓ C3) çevrimdışı arkadaşa davet reddedildi');

  // 4) Kurucu OLMAYAN: Dost aynı masaya oturur ama davet GÖNDEREMEZ
  const joinF = once(fSock, 'joinedRoom');
  fSock.emit('joinRoom', {
    roomId: '9001', gameId: 'chess', userName: 'Dost', userKey: 'user:' + F.id
  });
  const jf = await joinF;
  assert.strictEqual(jf.role, 'player');
  rej = once(fSock, 'inviteRejected');
  cSock.emit('authHello', { token: C.token }); // C çevrimiçi kalsın (zaten)
  fSock.emit('gameInvite', { toUserId: C.id, roomId: '9001' });
  rejP = await rej;
  assert.ok(/kurucu/i.test(rejP.reason) || /kuran/i.test(rejP.reason), 'kurucu şartı: ' + rejP.reason);
  console.log('  ✓ C4) kurucu olmayan (aynı özel masada bile) davet gönderemedi');

  // 5) HERKESE AÇIK masadan davet YOK
  rej = once(cSock, 'inviteRejected');
  cSock.emit('gameInvite', { toUserId: F.id, roomId: '107' }); // kalıcı halka açık satranç masası
  rejP = await rej;
  assert.ok(/ÖZEL/i.test(rejP.reason) || /özel/i.test(rejP.reason), 'özel masa şartı: ' + rejP.reason);
  console.log('  ✓ C5) herkese açık masadan davet gönderilemedi');

  // ---------- D) Davet cevabı geri bildirimi ----------
  const ans = once(cSock, 'inviteAnswered');
  fSock.emit('inviteResponse', { fromId: C.id, accepted: true, roomId: '9001' });
  const ansP = await ans;
  assert.ok(ansP.accepted === true && ansP.byName === 'Dost', 'kabul geri bildirimi');
  console.log('  ✓ D) davet cevabı kurucuya ulaştı (inviteAnswered, kabul)');

  const ans2 = once(cSock, 'inviteAnswered');
  fSock.emit('inviteResponse', { fromId: C.id, accepted: false, roomId: '9001' });
  const ans2P = await ans2;
  assert.ok(ans2P.accepted === false, 'ret geri bildirimi');
  console.log('  ✓ D2) ret cevabı da kurucuya ulaştı');

  // ---------- E) Maç geçmişi ----------
  // İki üye zaten 9001'de oturuyor: oyunu başlat, Dost terk etsin → Kral hükmen.
  cSock.emit('setReady', { ready: true });
  fSock.emit('setReady', { ready: true });
  await Promise.all([once(cSock, 'gameStarted'), once(fSock, 'gameStarted')]);
  fSock.emit('leaveRoom');
  const fin = await once(cSock, 'gameEnded');
  assert.strictEqual(fin.reason, 'player_left', 'terk bitişi');
  await sleep(250); // kayıt senkron düşer; DB okuması için kısa pay

  prof = await api(BASE, '/api/users/' + C.id + '/profile', null, 'GET');
  assert.ok(prof.recent.length === 1, 'Kral profilinde 1 maç olmalı');
  assert.strictEqual(prof.recent[0].gameId, 'chess');
  assert.strictEqual(prof.recent[0].won, true, 'Kral kazandı');
  assert.ok(prof.stats.chess && prof.stats.chess.played === 1 && prof.stats.chess.won === 1, 'Kral istatistiği 1/1');
  const names = (prof.recent[0].players || []).map(p => p.name).sort();
  assert.deepStrictEqual(names, ['Dost', 'Kral'], 'maçta iki üye de kayıtlı');
  console.log('  ✓ E1) maç geçmişi kurucunun profiline işlendi (galibiyet)');

  prof = await api(BASE, '/api/users/' + F.id + '/profile', null, 'GET');
  assert.ok(prof.recent.length === 1, 'terk edenin profilinde de maç olmalı');
  assert.strictEqual(prof.recent[0].won, false, 'Dost kaybetti');
  assert.ok(prof.stats.chess.played === 1 && prof.stats.chess.won === 0, 'Dost istatistiği 1/0');
  console.log('  ✓ E2) terk eden üyenin profilinde de mağlubiyet görünüyor');

  // Arkadaş çıkarma akışı da sağlam kalsın
  r = await api(BASE, '/api/friends/remove', { friendId: G.id }, 'POST', C.token);
  assert.ok(r.ok && r.friends.length === 1, 'çıkarma sonrası 1 arkadaş kaldı');
  console.log('  ✓ B2) arkadaşlıktan çıkarma çalışıyor');

  console.log('\n✅ SOCIAL-FLOW: tüm sosyal katman testleri geçti');
  [cSock, fSock, sSock, guest].forEach(s => s.disconnect());
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
