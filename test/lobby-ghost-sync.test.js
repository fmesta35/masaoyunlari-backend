'use strict';

/*
 * LOBİ HAYALET SENKRONU — "odada kimse yok ama lobi 1/2 (veya dolu) görünüyor"
 * hatasının kalıcı çözümünün testleri.
 *
 *  Sunucu 5 sn'lik süpürmede beklemede/bitişteki odalarda soketi GERÇEKTE bağlı
 *  olmayan oyuncuları düşürür (io.sockets tek doğru kaynak) ve lobiye taze
 *  sayıları yayınlar. 'playing' odalara DOKUNULMAZ (30 sn reconnect hakkı).
 *
 *  A) Beklemedeki masada ölü soketli koltuk -> takip eden süpürmede düşer;
 *     masa 0/2 olarak listelenir (preset masa beklemeye alınır, silinmez).
 *  B) OYNANAN maçta oyuncu soket kimliği bozuk görünse bile süpürme ona
 *     dokunmaz (reconnect hakkı korunur) -> koltuklar yerinde kalır.
 */

const assert = require('assert');
const http = require('http');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

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

function join(socket, roomId, gameId, maxPlayers) {
  socket.emit('joinRoom', {
    roomId, gameId, userName: socket.userName,
    userKey: 'test:' + socket.userName + ':' + roomId, maxPlayers, durationMinutes: 10
  });
  return once(socket, 'joinedRoom');
}

async function waitFor(fn, what, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 15000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(250);
  }
  throw new Error('bekleme zaman aşımı: ' + what);
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;

  // ---------- A) Beklemedeki masada hayalet koltuk düşer, lobi 0/2 ----------
  {
    const s = await connect(BASE, 'Hayalet-A');
    await join(s, '202', 'tavla', 2);
    let room = rooms.get('202');
    assert.strictEqual(room.players.length, 1, 'A: oyuncu koltuğa oturdu');

    // Gerçek hayalet taklidi: kayıtlı soket kimliği ölü bir kimliğe çevrilir
    // (sekme kapanıp disconnect düşmeden soket haritadan uçunca oluşan durum).
    room.players[0].id = 'dead-socket-A';

    await waitFor(() => rooms.get('202') && rooms.get('202').players.length === 0, 'A: hayalet koltuk süpürüldü', 15000);
    room = rooms.get('202');
    assert.strictEqual(room.status, 'waiting', 'A: preset masa beklemeye alındı (silinmedi)');
    assert.strictEqual(rooms.get('202') !== undefined, true, 'A: kalıcı masa haritada kalır');

    const listed = await httpRooms(BASE, 'tavla').then(rs => rs.find(r => String(r.id) === '202'));
    assert.strictEqual(listed.players, 0, 'A: lobi senkron — 0/2 görünür');
    assert.strictEqual((listed.playerList || []).length, 0, 'A: isim listesi de temiz');
    s.close();
    console.log('  ✓ A) Ölü soketli koltuk süpürüldü; lobi 0/2 ve isimsiz (senkron)');
  }

  // ---------- B) 'playing' odada süpürme oyuncuya DOKUNMAZ ----------
  {
    const w = await connect(BASE, 'Oynama-Beyaz');
    const b = await connect(BASE, 'Oynama-Siyah');
    const started = [w, b].map(x => once(x, 'gameStarted'));
    await join(w, '102', 'chess', 2);
    await join(b, '102', 'chess', 2);
    w.emit('setReady', { ready: true });
    b.emit('setReady', { ready: true });
    await Promise.all(started);
    const room = rooms.get('102');
    assert.strictEqual(room.status, 'playing');

    // Soket kimliği bozulmuş gibi yap; bağlantılar hâlâ açık olabilir—ama
    // asıl nokta: 'playing' odadaki oyuncu ASLA süpürülmez.
    room.players[0].id = 'dead-socket-B';
    await sleep(6500); // en az bir süpürme periyodu geçsin
    assert.strictEqual(room.status, 'playing', 'B: maç sürüyor');
    assert.strictEqual(room.players.length, 2, 'B: playing odada oyuncu düşürülmez (reconnect hakkı)');
    w.close(); b.close();
    console.log('  ✓ B) Oynanan odada süpürme koltuklara dokunmadı (2/2 korundu)');
  }

  await sleep(300);
  server.close();
  console.log('\n✅ lobby-ghost-sync: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ lobby-ghost-sync:', err && err.stack ? err.stack : err); process.exit(1); });
