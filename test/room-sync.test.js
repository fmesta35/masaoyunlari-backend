'use strict';

/*
 * Regresyon testleri — ODA / LOBİ SENKRONU (satranç + tavla için ortak kurallar):
 *
 *  1) Giren/çıkan oyuncular ANLIK yayınlanır: lobideki abone, masanın
 *     yanındaki oyuncu sayısını (0/2 → 1/2 → 2/2) push ile doğru görür.
 *  2) DOLU + OYNANAN odaya ancak İZLEYİCİ katılabilir: 3. kişi koltuk
 *     alamaz, oyuncu sayısı 2'de kalır, izleyici sayısı ayrıca gösterilir.
 *  3) Oyun bitince oda TAKILI KALMAZ: 'finished' durumu kısa bir süre
 *     sonra kendiliğinden 'waiting'e döner; oyuncular ayrıldıysa kalıcı
 *     masa 0/2 varsayılan haline, normal oda ise listeden silinir.
 *     (Eski hata: sıfırlama yalnızca 'player_left' yolunda vardı; mat /
 *     süre / hamle-timeout bitişlerinde oda sonsuza dek "Oynanıyor" kalıyordu.)
 */

// ÖNEMLİ: server'dan ÖNCE ayarlanmalı (sabitler modül yüklenirken okunur).
process.env.GV_MOVE_WARN_MS = '1200';
process.env.GV_MOVE_FORFEIT_MS = '2500';
process.env.GV_POST_GAME_HOLD_MS = '600';

const assert = require('assert');
const http = require('http');

function loadClient() {
  try { return require('socket.io-client'); } catch (_) {}
  throw new Error('socket.io-client bulunamadı. npm install çalıştırın.');
}

function httpRooms(url, gameId) {
  return new Promise((resolve, reject) => {
    http.get(url + '/api/rooms?gameId=' + gameId, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body).rooms || []); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (timeoutMs || 6000)) {
    last = await fn();
    if (last) return last;
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + label);
}

function connect(io, url, userKey, userName) {
  const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + userName)), 8000);
    socket.on('connect', () => {
      clearTimeout(t);
      socket.userKey = userKey;
      socket.userName = userName;
      resolve(socket);
    });
    socket.on('connect_error', err => { clearTimeout(t); reject(err); });
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + event)), timeoutMs || 8000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

function joinAs(socket, roomId, extra) {
  const payload = Object.assign({
    roomId,
    gameId: 'chess',
    userName: socket.userName,
    userKey: socket.userKey,
    maxPlayers: 2,
    durationMinutes: 12
  }, extra || {});
  const p = once(socket, 'joinedRoom');
  socket.emit('joinRoom', payload);
  return p;
}

async function main() {
  const { start, server } = require('../server');
  const { io } = loadClient();
  await start(0);
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port;
  const ROOM = '107';    // kalıcı ♞ Normal (15 dk) masa
  const CUSTOM = '5007'; // kullanıcı masası (kalıcı değil)

  // Lobideki abonenin aldığı TÜM push'ları kaydet (son snapshot + geçmiş).
  const lobby = await connect(io, url, 'user:lobi', 'Lobi');
  let latest = null;
  const pushes = [];
  lobby.on('roomsUpdated', payload => {
    if (payload && payload.gameId === 'chess') {
      latest = payload.rooms || [];
      pushes.push(latest);
    }
  });
  lobby.emit('subscribeLobby', { gameId: 'chess' });
  await waitFor(() => (latest && latest.length ? latest : null), 6000, 'ilk lobi listesi');
  const roomIn = rooms => (rooms || []).find(x => String(x.id) === ROOM);

  // --- 1) lobiye giren/çıkan oyuncu sayıları ANLIK ve GERÇEK yansır ---
  const a = await connect(io, url, 'user:a', 'Ali');
  const b = await connect(io, url, 'user:b', 'Ayşe');

  await joinAs(a, ROOM);
  let row = await waitFor(() => {
    const r = roomIn(latest);
    return r && r.players === 1 && r.status === 'waiting' ? r : null;
  }, 6000, '1/2 push');
  console.log('  ✓ 1a) ilk oyuncu girişi lobiye anında yansıyor (1/2 Bekliyor)');

  await joinAs(b, ROOM);
  row = await waitFor(() => {
    const r = roomIn(latest);
    return r && r.players === 2 && r.status === 'waiting' ? r : null;
  }, 6000, '2/2 push');
  console.log('  ✓ 1b) ikinci oyuncu girişi lobiye anında yansıyor (2/2 Dolu)');

  // --- 2) DOLU + OYNANAN odaya yalnızca İZLEYİCİ katılabilir ---
  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  await Promise.all([once(a, 'gameStarted'), once(b, 'gameStarted')]);

  row = await waitFor(() => {
    const r = roomIn(latest);
    return r && r.status === 'playing' && r.players === 2 ? r : null;
  }, 6000, 'playing push');
  console.log('  ✓ 2a) oyun başlayınca oda lobide 2/2 "Oynanıyor" görünüyor');

  const c = await connect(io, url, 'user:c', 'Cem');
  const joinedC = await joinAs(c, ROOM); // normal "Katıl" istese bile...
  assert.strictEqual(joinedC.role, 'spectator', 'oynanan dolu odaya katılan izleyici olmalı');
  row = await waitFor(() => {
    const r = roomIn(latest);
    return r && r.players === 2 && r.spectatorCount === 1 ? r : null;
  }, 6000, 'izleyici push');
  console.log('  ✓ 2b) oynanan dolu odada koltuk sayısı 2 sabit kalıyor, izleyici ayrı sayılıyor');

  // --- 3) oyun bitince oda TAKILI KALMAMALI (hamle süresi bitişi) ---
  const endA = once(a, 'gameEnded', 10000);
  const endB = once(b, 'gameEnded', 10000);
  const [ea] = await Promise.all([endA, endB]);
  assert.strictEqual(ea.reason, 'move_timeout');

  row = await waitFor(() => {
    const r = roomIn(latest);
    return r && r.status === 'finished' && r.players === 2 ? r : null;
  }, 6000, 'finished push');
  console.log('  ✓ 3a) bitiş anında oda "finished" olarak yayınlanıyor');

  // Bekleme süresi (600 ms) dolunca oda KENDİLİĞİNDEN beklemeye dönmeli.
  row = await waitFor(() => {
    const r = roomIn(latest);
    return r && r.status === 'waiting' && r.players === 2 ? r : null;
  }, 6000, 'otomatik waiting push');
  assert.ok(
    (row.playerList || []).every(p => !p.isReady),
    'sıfırlama sonrası iki oyuncu da yeniden HAZIRIM basabilmeli (isReady=false)'
  );
  console.log('  ✓ 3b) biten oda kendiliğinden beklemeye dönüyor — TAKILI KALMIYOR (rövanş hazır)');

  // İzleyici terfisinin çalıştığını hızlıca doğrula: C oyuncu olmak istemişti,
  // koltuk boşalınca değil — oda doluyken bekliyor; şimdi RÖVANŞA gerek yok.

  // --- 4) oyuncular ayrılınca kalıcı masa 0/2 VARSAYILAN haline döner ---
  a.emit('leaveRoom');
  b.emit('leaveRoom');
  c.emit('leaveRoom');
  row = await waitFor(() => {
    const r = roomIn(latest);
    return r && r.status === 'waiting' && r.players === 0 && r.spectatorCount === 0 ? r : null;
  }, 6000, '0/2 push');
  assert.strictEqual(Number(row.duration), 15, 'kalıcı masanın kendi süresi korunmalı (#107 Normal 15 dk)');
  console.log('  ✓ 4) herkes çıkınca kalıcı masa 0/2 varsayılan moda döndü (silinmedi, süresi korundu)');

  // --- 5) KALICI OLMAYAN oda: terk bitişi → bekleme → herkes çıkınca SİLİNİR ---
  const d = await connect(io, url, 'user:d', 'Deniz');
  const e = await connect(io, url, 'user:e', 'Ece');
  await joinAs(d, CUSTOM);
  await joinAs(e, CUSTOM);
  d.emit('setReady', { ready: true });
  e.emit('setReady', { ready: true });
  await Promise.all([once(d, 'gameStarted'), once(e, 'gameStarted')]);

  d.emit('leaveRoom'); // oyun sırasında terk → hükmen mağlubiyet
  const endE = await once(e, 'gameEnded', 8000);
  assert.strictEqual(endE.reason, 'player_left');
  assert.strictEqual(endE.youWon, true, 'kalan oyuncu kazandığını görmeli');

  await waitFor(async () => {
    const rooms = await httpRooms(url, 'chess');
    const r = rooms.find(x => String(x.id) === CUSTOM);
    return r && r.status === 'waiting' && r.players === 1 ? r : null;
  }, 6000, 'terk sonrası otomatik waiting');
  console.log('  ✓ 5a) terkle biten oda da beklemeye dönüyor (takılı değil), kalan oyuncu 1/2');

  e.emit('leaveRoom');
  await waitFor(async () => {
    const rooms = await httpRooms(url, 'chess');
    return rooms.some(x => String(x.id) === CUSTOM) ? null : true;
  }, 6000, 'oda REST listesinden silindi');
  await waitFor(() => {
    const snap = pushes[pushes.length - 1];
    return snap && !snap.some(x => String(x.id) === CUSTOM) ? true : null;
  }, 6000, 'oda lobi push listesinden silindi');
  console.log('  ✓ 5b) son oyuncu da çıkınca normal oda listeden SİLİNİYOR (hayalet 0/2 kalmıyor)');

  const finalRooms = await httpRooms(url, 'chess');
  const preset = finalRooms.find(x => String(x.id) === ROOM);
  assert.ok(preset && preset.players === 0 && preset.status === 'waiting',
    'kalıcı masa REST üzerinden de 0/2 waiting görünmeli');
  console.log('  ✓ 5c) REST listesi de senkron (kalıcı 0/2, normal oda yok)');

  for (const s of [lobby, a, b, c, d, e]) { try { s.disconnect(); } catch (_) {} }
  await sleep(50);
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  console.log('OK oda/lobi senkronu regressions');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
