'use strict';

/*
 * OKEY MASA MODLARI — 2/3/4 kişilik masalar + kurucunun seçtiği el sayısı.
 *
 *  Kullanıcı isteği: üyeler okey lobisinde 2/3/4 kişilik masa kurabilsin;
 *  oynanacak el sayısını (3/5/7) masayı kuran belirlesin; 2 ve 3 kişilik
 *  modda okey el döngüsü buna göre işlesin.
 *
 *  A) 2 kişilik hazır masa (#301): 2 oyuncu oturur, 3. kişi İZLEYİCİ olur;
 *     2×HAZIR → oyun 2 koltukla başlar (15+14=29 taş, deste 76), el sayısı 3.
 *  B) 3 kişilik ÖZEL oda: kurucu 3 kişilik + 5 el seçer → oda bu ayarlarla
 *     yaratılır, lobi 5 El rozeti gösterir; 3×HAZIR → 3 koltukla başlar
 *     (15+14+14=43, deste 62), maxRounds=5.
 *  C) El sayısı doğrulaması: geçersiz rounds (999/'abc') reddedilir —
 *     oda varsayılan (3) ile kalır; '5' kabul edilir.
 *  D) Motor el döngüsü 2 ve 3 koltukla doğru çalışır (dağıtım 15/14,
 *     prev/next sarması, atış→sıra geçişi, öncekinden çekme).
 */

process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const http = require('http');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');
const engine = require('../okey-engine.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpRooms(url, gameId) {
  return new Promise((resolve, reject) => {
    http.get(url + '/api/rooms?gameId=' + gameId, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body).rooms || []); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

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
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 8000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

function join(socket, roomId, maxPlayers, rounds) {
  socket.emit('joinRoom', {
    roomId, gameId: 'okey', userName: socket.userName,
    userKey: 'test:' + socket.userName + ':' + roomId, maxPlayers, durationMinutes: 10,
    rounds
  });
  return once(socket, 'joinedRoom');
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;

  // ============ A) 2 kişilik hazır masa (#301) ============
  {
    const a = await connect(BASE, 'A-1');
    const b = await connect(BASE, 'A-2');
    const iz = await connect(BASE, 'A-iz');
    const j1 = await join(a, '301', 2, 3);
    assert.strictEqual(j1.role, 'player');
    const j2 = await join(b, '301', 2, 3);
    assert.strictEqual(j2.role, 'player');
    const j3 = await join(iz, '301', 2, 3);
    assert.strictEqual(j3.role, 'spectator', '2 kişilik masada 3. kişi izleyici olmalı');

    const listed = await httpRooms(BASE, 'okey').then(rs => rs.find(r => String(r.id) === '301'));
    assert.strictEqual(listed.players, 2, 'lobi 2/2 göstermeli');
    assert.strictEqual(listed.maxPlayers, 2);
    assert.strictEqual(listed.rounds, 3, '#301 → 3 El rozeti');

    const g1 = once(a, 'gameStarted');
    once(b, 'gameStarted');
    a.emit('setReady', { ready: true });
    b.emit('setReady', { ready: true });
    const p1 = await g1;
    const gs = p1.gameState;
    assert.deepStrictEqual(Object.keys(gs.handCounts).sort(), ['0', '1'], '2 koltuk');
    const total = Object.values(gs.handCounts).reduce((x, y) => x + y, 0);
    assert.strictEqual(total, 29, '2 kişide 15+14=29 taş');
    assert.strictEqual(gs.deckCount, 76, 'deste 76 (106-1-29)');
    assert.strictEqual(gs.maxRounds, 3, '#301 masa tanımı 3 el');
    assert.strictEqual(gs.status, 'playing');
    a.close(); b.close(); iz.close();
    await sleep(150);
    console.log('  ✓ A) 2 kişilik hazır masa: 2/2 + izleyici; 29 taş/deste 76; 3 el');
  }

  // ============ B) 3 kişilik ÖZEL oda, kurucu 5 el seçti ============
  {
    const s1 = await connect(BASE, 'B-1');
    const first = once(s1, 'joinedRoom');
    s1.emit('joinRoom', {
      roomId: '1601', gameId: 'okey', userName: 'B-1', userKey: 'test:B-1:1601',
      maxPlayers: 3, durationMinutes: 15, rounds: 5, roomName: 'Üçlü Dost Masası'
    });
    await first;
    await sleep(80);
    const room = rooms.get('1601');
    assert.ok(room, 'özel oda yaratılmalı');
    assert.strictEqual(room.maxPlayers, 3, '3 kişilik');
    assert.strictEqual(room.okeyMaxRounds, 5, 'kurucunun seçtiği 5 el saklanmalı');

    const listed = await httpRooms(BASE, 'okey').then(rs => rs.find(r => String(r.id) === '1601'));
    assert.ok(listed, 'özel oda lobide listelenmeli');
    assert.strictEqual(listed.maxPlayers, 3);
    assert.strictEqual(listed.rounds, 5, 'lobi rozeti 5 El');

    const s2 = await connect(BASE, 'B-2');
    const s3 = await connect(BASE, 'B-3');
    await join(s2, '1601', 3, 5);
    const started = [s1, s2, s3].map(s => once(s, 'gameStarted'));
    await join(s3, '1601', 3, 5);
    [s1, s2, s3].forEach(s => s.emit('setReady', { ready: true }));
    const payloads = await Promise.all(started);
    const gs = payloads[0].gameState;
    assert.deepStrictEqual(Object.keys(gs.handCounts).sort(), ['0', '1', '2'], '3 koltuk');
    const total = Object.values(gs.handCounts).reduce((x, y) => x + y, 0);
    assert.strictEqual(total, 43, '3 kişide 15+14+14=43 taş');
    assert.strictEqual(gs.deckCount, 62, 'deste 62 (106-1-43)');
    assert.strictEqual(gs.maxRounds, 5, 'kurucunun 5 el seçimi uygulanmalı');
    [s1, s2, s3].forEach(s => s.close());
    await sleep(150);
    console.log('  ✓ B) 3 kişilik özel oda: 43 taş/deste 62/5 el; lobi "5 El" rozeti');
  }

  // ============ C) El sayısı doğrulaması ============
  {
    const c1 = await connect(BASE, 'C-1');
    await join(c1, '1602', 4, 999);           // sınır dışı
    const bad = rooms.get('1602');
    assert.strictEqual(bad.okeyMaxRounds, undefined, 'geçersiz rounds saklanmaz (varsayılana düşer)');
    const c2 = await connect(BASE, 'C-2');
    await join(c2, '1603', 3, '5');           // string '5' kabul
    const good = rooms.get('1603');
    assert.strictEqual(good.okeyMaxRounds, 5, "'5' → 5 kabul edilir");
    c1.close(); c2.close();
    console.log('  ✓ C) rounds doğrulaması: 999 red, \'5\' kabul');
  }

  // ============ D) Motor el döngüsü 2 ve 3 koltukla ============
  {
    for (const N of [2, 3]) {
      const seats = Array.from({ length: N }, (_, i) => i);
      const scores = Object.fromEntries(seats.map(s => [s, 0]));
      const st = engine.startRound(1, seats, scores);
      const nums = Object.values(st.hands).map(h => h.length).sort((x, y) => x - y);
      const exp = N === 2 ? [14, 15] : [14, 14, 15];
      assert.deepStrictEqual(nums, exp, `${N} kişi: dağıtım ${exp}`);
      assert.strictEqual(st.hands[st.starter].length, 15, 'başlayan 15');
      assert.strictEqual(st.phase, 'discard', 'başlayan çekmeden atar');
      for (const s of seats) {
        assert.strictEqual(engine.nextSeatOf(st, s), seats[(seats.indexOf(s) + 1) % N]);
        assert.strictEqual(engine.prevSeatOf(st, s), seats[(seats.indexOf(s) + N - 1) % N]);
      }
      // Tam döngü: başlayan atar → sıra geçer; sonraki öncekinden ÇEKER, atar.
      const cur = st.turn;
      const discarded = st.hands[cur][0];
      const r1 = engine.discard(st, cur, discarded.id);
      assert.ok(r1.ok, `${N} kişi: atış kabul`);
      const nxt = engine.nextSeatOf(st, cur);
      assert.strictEqual(st.turn, nxt, `${N} kişi: sıra geçti`);
      assert.strictEqual(st.phase, 'draw');
      const r2 = engine.drawFromPrev(st, nxt);
      assert.ok(r2.ok, `${N} kişi: öncekinin atığından çekme kabul`);
      assert.strictEqual(st.hands[nxt].length, 15, 'çeken 15e çıkar');
      const d2 = st.hands[nxt][0];
      const r3 = engine.discard(st, nxt, d2.id);
      assert.ok(r3.ok, `${N} kişi: ikinci atış kabul`);
    }
    console.log('  ✓ D) motor: 2 ve 3 koltuklu el döngüsü (dağıtım/sıra/çek-at) doğru');
  }

  server.close();
  console.log('\n✅ okey-table-modes: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ okey-table-modes:', err && err.stack ? err.stack : err); process.exit(1); });
