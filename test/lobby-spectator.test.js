'use strict';

const assert = require('assert');
const http = require('http');

function loadClient() {
  try { return require('socket.io-client'); } catch (_) {}
  try { return require('socket.io-client/dist/socket.io.js'); } catch (_) {}
  throw new Error('socket.io-client bulunamadı. npm install çalıştırın.');
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
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
    socket.on('connect_error', err => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for ' + event)), timeoutMs || 5000);
    socket.once(event, payload => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

function joinAs(socket, extra) {
  const payload = Object.assign({
    roomId: 'test-lobby-1',
    gameId: 'chess',
    userName: socket.userName,
    userKey: socket.userKey,
    maxPlayers: 2,
    durationMinutes: 10,
    roomName: 'Test Masası'
  }, extra || {});
  const p = once(socket, 'joinedRoom');
  socket.emit('joinRoom', payload);
  return p;
}

async function main() {
  process.env.PORT = '0';
  const { start, rooms, server } = require('../server');
  const { io } = loadClient();
  await start(0);
  const port = server.address().port;
  const url = 'http://127.0.0.1:' + port;

  const a = await connect(io, url, 'user:a', 'Ali');
  const b = await connect(io, url, 'user:b', 'Ayşe');
  const c = await connect(io, url, 'user:c', 'Can');

  const lobbySeen = once(c, 'roomsUpdated');
  c.emit('subscribeLobby', { gameId: 'chess' });
  await lobbySeen;

  const joinedA = await joinAs(a);
  assert.strictEqual(joinedA.role, 'player');
  assert.strictEqual(joinedA.isSpectator, false);

  const roomsAfterA = await once(c, 'roomsUpdated');
  assert.ok(roomsAfterA.rooms.some(r => r.id === 'test-lobby-1' && r.players === 1), 'lobi 1 oyuncuyu görmeli');

  const joinedB = await joinAs(b);
  assert.strictEqual(joinedB.role, 'player');
  assert.strictEqual(joinedB.room.players.length, 2);

  const roomsAfterB = await once(c, 'roomsUpdated');
  const listed = roomsAfterB.rooms.find(r => r.id === 'test-lobby-1');
  assert.ok(listed, 'lobi masayı listemeli');
  assert.strictEqual(listed.players, 2);

  const joinedC = await joinAs(c);
  assert.strictEqual(joinedC.role, 'spectator', 'üçüncü kişi izleyici olmalı');
  assert.strictEqual(joinedC.isSpectator, true);
  assert.ok((joinedC.room.spectators || []).length >= 1);

  const api = await httpGet(url + '/api/rooms?gameId=chess');
  assert.strictEqual(api.ok, true);
  assert.ok(api.rooms.some(r => r.id === 'test-lobby-1' && r.spectatorCount >= 1));

  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  const startedC = await once(c, 'gameStarted');
  assert.strictEqual(startedC.isSpectator, true);
  assert.strictEqual(startedC.playerColor, null);
  assert.ok(startedC.gameState);
  assert.deepStrictEqual(startedC.gameState.legalMoves, []);

  const room = rooms.get('test-lobby-1');
  assert.strictEqual(room.status, 'playing');
  const white = room.players.find(p => p.color === 'white');
  const mover = white.userKey === 'user:a' ? a : b;
  const rejected = once(c, 'chessMoveRejected');
  c.emit('chessMove', { roomId: 'test-lobby-1', from: 'e2', to: 'e4', userKey: 'user:c' });
  const rej = await rejected;
  assert.strictEqual(rej.reason, 'not_in_room');

  const accepted = once(c, 'chessMoveAccepted');
  mover.emit('chessMove', { roomId: 'test-lobby-1', from: 'e2', to: 'e4', userKey: white.userKey });
  const acc = await accepted;
  assert.strictEqual(acc.isSpectator, true);
  assert.ok(acc.gameState.history.length >= 1);

  a.disconnect();
  b.disconnect();
  c.disconnect();
  await new Promise(resolve => setTimeout(resolve, 50));
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  console.log('OK lobby-sync + spectator');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
