'use strict';

/*
 * ZİYARETÇİ KİMLİĞİ / SEKME AYRIŞTIRMASI testleri.
 *
 * Canlı hata: aynı tarayıcı profilindeki 4 pencere AYNI userKey'i gönderiyor,
 * sunucu 2.-4. pencereyi "rejoin" sanıp koltuğu devrediyor -> oda 1/4'te
 * takılı kalıyordu ("lobide oyuncular birbirleriyle buluşmuyor").
 *
 * Çözüm (istemci): misafir userKey'i artık  profilId:sekmeId  biçiminde;
 * sekmeId sessionStorage'dadır -> F5 reconnect hakkını korur, yeni pencere
 * yeni koltuk alır. Bu testler SUNUCUNUN bu anahtarlarla doğru davrandığını
 * ve eski akışların (kayıtlı kullanıcı rejoin) bozulmadığını kilitler:
 *
 *  A) Aynı profil + 4 FARKLI sekme anahtarı -> aynı okey masasında 4 koltuk
 *     (lobi listelemesi de 4/4 göstermeli).
 *  B) AYNI anahtarla yeni soket (F5/refresh senaryosu) -> rejoin: koltuk
 *     korunur, oyuncu sayısı 1 kalır.
 *  C) Satranç (2 kişilik) lobisi de aynı düzeltmeden yararlanır: 2 farklı
 *     sekme 2 koltuk alır (çalışan sistem bozulmadı, iyileşti).
 *  D) Kayıtlı kullanıcı ('user:...') DEĞİŞMEDİ: aynı userKey ile ikinci
 *     bağlantı rejoin sayılır (cihazlar arası koltuk devralma korunur).
 */

const assert = require('assert');
const http = require('http');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url, name) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + name)), 8000);
    socket.on('connect', () => { clearTimeout(t); socket.userName = name; resolve(socket); });
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 9000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

function join(socket, roomId, gameId, userKey, maxPlayers) {
  socket.emit('joinRoom', {
    roomId, gameId, userName: socket.userName,
    userKey, maxPlayers, durationMinutes: gameId === 'okey' ? 20 : 10
  });
  return once(socket, 'joinedRoom');
}

function lobbyRoom(url, gameId, roomId) {
  return new Promise((resolve, reject) => {
    http.get(url + '/api/rooms?gameId=' + gameId, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const rooms = JSON.parse(body).rooms || [];
          resolve(rooms.find(r => String(r.id) === String(roomId)) || null);
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;

  // ---- A) Ayni profil, 4 farkli sekme -> Okey masasinda 4 koltuk ----
  {
    const PROF = 'A-ORTAK-PROFIL';
    const socks = [];
    for (let i = 1; i <= 4; i++) {
      const s = await connect(BASE, 'A-pencere-' + i);
      await join(s, '302', 'okey', 'guest:' + PROF + ':tab' + i, 4);
      socks.push(s);
    }
    await sleep(150);
    const room = rooms.get('302');
    assert.ok(room, 'A: oda olusmali');
    assert.strictEqual(room.players.length, 4,
      'A: dort PENCERE (ayni profil, farkli sekme) 4 koltuk almali, once: 1/4');
    assert.deepStrictEqual(room.players.map(p => p.seat).sort(), [0, 1, 2, 3],
      'A: koltuklar 0..3 dolmustur');
    const keys = new Set(room.players.map(p => p.userKey));
    assert.strictEqual(keys.size, 4, 'A: koltuklarin userKeyleri 4 ayri sekme olmali');
    const listed = await lobbyRoom(BASE, 'okey', '302');
    assert.ok(listed, 'A: lobi listelemesi odayi icermeli');
    assert.strictEqual(listed.players, 4, 'A: lobi 4/4 gostermeli (once 1/4 gorunuyordu)');
    socks.forEach(s => s.close());
    console.log('A tamam: ayni profilin 4 penceresi 4/4 koltuga oturdu, lobi 4/4.');
  }

  // ---- B) AYNI anahtarla yeni soket = F5/refresh -> rejoin korunur ----
  {
    const KEY = 'guest:B-PROFIL:tabX';
    const a1 = await connect(BASE, 'B-eski');
    await join(a1, '303', 'okey', KEY, 4);
    let room = rooms.get('303');
    assert.strictEqual(room.players.length, 1, 'B: ilk giris koltuk alir');
    const seat0 = room.players[0];
    a1.close();
    await sleep(200);
    const a2 = await connect(BASE, 'B-yeni');
    await join(a2, '303', 'okey', KEY, 4);
    await sleep(100);
    assert.strictEqual(room.players.length, 1, 'B: ayni anahtar rejoin sayilir, sayi 1 kalir');
    assert.strictEqual(room.players[0].seat, 0, 'B: koltuk korunur');
    assert.strictEqual(room.players[0].id, a2.id, 'B: koltuk yeni sokete devredilir');
    a2.close();
    console.log('B tamam: F5/refresh senaryosu rejoin olarak calisiyor (bozulmadi).');
  }

  // ---- C) Satranc lobisi de 2 farkli sekmeyi 2 koltuga oturtur ----
  {
    const c1 = await connect(BASE, 'C-beyaz');
    const c2 = await connect(BASE, 'C-siyah');
    await join(c1, 'test-identity-chess', 'chess', 'guest:C-PROFIL:tab1', 2);
    await join(c2, 'test-identity-chess', 'chess', 'guest:C-PROFIL:tab2', 2);
    await sleep(100);
    const room = rooms.get('test-identity-chess');
    assert.ok(room, 'C: satranc odasi olusmali');
    assert.strictEqual(room.players.length, 2,
      'C: ayni profilin 2 sekmesi satrancda 2 koltuk almali');
    c1.close(); c2.close();
    console.log('C tamam: satranc lobisinde de 2 sekme 2 koltuk (1/2 takilmasi yok).');
  }

  // ---- D) Kayitli kullanici davranisi DEGISMEDI: ayni 'user:' anahtari rejoin ----
  {
    const d1 = await connect(BASE, 'D-uye');
    await join(d1, '304', 'okey', 'user:42', 4);
    const d2 = await connect(BASE, 'D-uye-ikinci-cihaz');
    await join(d2, '304', 'okey', 'user:42', 4);
    await sleep(100);
    const room = rooms.get('304');
    assert.strictEqual(room.players.length, 1,
      'D: kayitli kullanici profil-genelinde TEK kalir (koltuk devralma)');
    assert.strictEqual(room.players[0].id, d2.id, 'D: koltuk son baglanan cihazda');
    d1.close(); d2.close();
    console.log('D tamam: kayitli kullanici rejoin/devralma akisi korunuyor.');
  }

  server.close();
  console.log('\n✅ guest-tab-identity: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ guest-tab-identity testi basarisiz:', err && err.message ? err.message : err);
  process.exit(1);
});
