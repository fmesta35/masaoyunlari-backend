// GameVerse - Render gerçek zamanlı oyun sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(__dirname));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const rooms = new Map();
const MAX_ROOM_PLAYERS = 2;
// Oyun sırasında kopan oyuncuya yeniden bağlanması için tanınan süre (ms).
const RECONNECT_GRACE_MS = 30000;
const disconnectTimers = new Map();

function now() { return Date.now(); }

function playerKey(roomId, player) {
  return roomId + ':' + (player.userKey || player.id);
}

function cancelDisconnectTimer(roomId, player) {
  const key = playerKey(roomId, player);
  const t = disconnectTimers.get(key);
  if (t) {
    clearTimeout(t);
    disconnectTimers.delete(key);
  }
}

function createRoom(id, gameId, maxPlayers, durationMinutes) {
  const duration = Math.max(1, Number(durationMinutes) || 10);
  const room = {
    id,
    gameId: gameId || 'chess',
    maxPlayers: Math.min(Number(maxPlayers) || 2, MAX_ROOM_PLAYERS),
    durationMinutes: duration,
    players: [],
    status: 'waiting',
    chess: null,
    whiteTimeMs: duration * 60 * 1000,
    blackTimeMs: duration * 60 * 1000,
    turnStartedAt: null,
    result: null,
    lastMove: null
  };
  rooms.set(id, room);
  return room;
}

function resetRoomToWaiting(room) {
  if (!room) return;
  room.status = 'waiting';
  room.chess = null;
  room.result = null;
  room.lastMove = null;
  room.turnStartedAt = null;
  const duration = Math.max(1, Number(room.durationMinutes) || 10);
  room.whiteTimeMs = duration * 60 * 1000;
  room.blackTimeMs = duration * 60 * 1000;
  if (Array.isArray(room.players)) {
    room.players.forEach((p, idx) => {
      p.isReady = false;
      p.color = idx === 0 ? 'white' : 'black';
      p.seat = idx;
    });
  }
}

function publicRoom(room) {
  return {
    id: room.id,
    gameId: room.gameId,
    maxPlayers: room.maxPlayers,
    durationMinutes: room.durationMinutes,
    status: room.status,
    players: room.players.map(p => ({
      id: p.id,
      userKey: p.userKey,
      name: p.name,
      color: p.color,
      seat: p.seat,
      isReady: !!p.isReady
    })),
    readyCount: room.players.filter(p => p.isReady).length
  };
}

function updateClock(room) {
  if (!room.chess || room.status !== 'playing' || !room.turnStartedAt) return;
  const elapsed = Math.max(0, now() - room.turnStartedAt);
  if (room.chess.turn() === 'w') room.whiteTimeMs = Math.max(0, room.whiteTimeMs - elapsed);
  else room.blackTimeMs = Math.max(0, room.blackTimeMs - elapsed);
  room.turnStartedAt = now();

  const remaining = room.chess.turn() === 'w' ? room.whiteTimeMs : room.blackTimeMs;
  if (remaining <= 0) {
    room.status = 'finished';
    room.result = { reason: 'timeout', winner: room.chess.turn() === 'w' ? 'black' : 'white' };
  }
}

function mapGameResult(room) {
  if (!room.chess) return null;
  if (room.chess.isCheckmate()) return { reason: 'checkmate', winner: room.chess.turn() === 'w' ? 'black' : 'white' };
  if (room.chess.isStalemate()) return { reason: 'stalemate' };
  if (typeof room.chess.isThreefoldRepetition === 'function' && room.chess.isThreefoldRepetition()) return { reason: 'threefold_repetition' };
  if (typeof room.chess.isInsufficientMaterial === 'function' && room.chess.isInsufficientMaterial()) return { reason: 'insufficient_material' };
  if (typeof room.chess.isDrawByFiftyMoves === 'function' && room.chess.isDrawByFiftyMoves()) return { reason: 'fifty_move' };
  if (typeof room.chess.isDraw === 'function' && room.chess.isDraw()) return { reason: 'draw' };
  return null;
}

function boardArray(chess) {
  return chess.board().map(rank => rank.map(piece => {
    if (!piece) return null;
    return piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
  }));
}

function legalMoves(chess) {
  return chess.moves({ verbose: true }).map(m => ({
    from: m.from,
    to: m.to,
    san: m.san,
    color: m.color,
    piece: m.piece,
    captured: m.captured || null,
    promotion: m.promotion || null,
    flags: m.flags
  }));
}

function serializeHistory(chess) {
  return chess.history({ verbose: true }).map(m => ({
    from: m.from,
    to: m.to,
    san: m.san,
    color: m.color,
    piece: m.piece,
    captured: m.captured || null,
    promotion: m.promotion || null,
    flags: m.flags
  }));
}

function buildChessState(room) {
  if (!room.chess) return null;
  updateClock(room);
  const chess = room.chess;
  return {
    board: boardArray(chess),
    turn: chess.turn(),
    legalMoves: room.status === 'playing' ? legalMoves(chess) : [],
    history: serializeHistory(chess),
    status: room.status,
    whiteTimeMs: room.whiteTimeMs,
    blackTimeMs: room.blackTimeMs,
    serverNow: now(),
    result: room.result,
    check: typeof chess.isCheck === 'function' ? chess.isCheck() : false,
    fen: chess.fen()
  };
}

function emitRoom(room) {
  io.to(room.id).emit('roomUpdated', publicRoom(room));
}

function emitGameState(room) {
  const state = buildChessState(room);
  if (!state) return;
  room.players.forEach(player => {
    io.to(player.id).emit('gameStateUpdated', {
      roomId: room.id,
      gameState: state,
      playerColor: player.color,
      lastMove: room.lastMove
    });
  });
}

function startChess(room) {
  if (room.status === 'playing') return;
  if (room.players.length !== 2 || !room.players.every(p => p.isReady)) return;

  room.chess = new Chess();
  room.status = 'playing';
  room.result = null;
  room.lastMove = null;
  room.whiteTimeMs = room.durationMinutes * 60 * 1000;
  room.blackTimeMs = room.durationMinutes * 60 * 1000;
  room.turnStartedAt = now();

  const state = buildChessState(room);
  emitRoom(room);
  room.players.forEach(player => {
    io.to(player.id).emit('gameStarted', {
      roomId: room.id,
      playerColor: player.color,
      players: publicRoom(room).players,
      gameState: state
    });
  });
  emitGameState(room);
}

function removePlayerFromRoom(room, player, message) {
  if (!room || !player) return;
  cancelDisconnectTimer(room.id, player);
  room.players = room.players.filter(p => p !== player);

  if (room.players.length === 0) {
    rooms.delete(room.id);
    console.log(`[ODA #${room.id}] boşaldı ve silindi.`);
    return;
  }

  const wasPlaying = room.status === 'playing';
  resetRoomToWaiting(room);
  emitRoom(room);
  if (wasPlaying) {
    io.to(room.id).emit('playerLeft', { roomId: room.id, message: message || 'Rakip oyundan ayrıldı.' });
  }
}

function findExistingPlayer(room, socket, userKey) {
  if (!room || !Array.isArray(room.players)) return null;
  return room.players.find(p => p.id === socket.id) ||
    (userKey ? room.players.find(p => p.userKey && p.userKey === userKey) : null) ||
    (socket.userKey ? room.players.find(p => p.userKey && p.userKey === socket.userKey) : null);
}

io.on('connection', socket => {
  console.log(`[BAĞLANDI] ${socket.id}`);

  socket.on('joinRoom', payload => {
    const data = payload || {};
    if (!data.roomId) return;

    const roomId = String(data.roomId);
    const gameId = data.gameId || 'chess';
    let room = rooms.get(roomId);
    if (!room) room = createRoom(roomId, gameId, data.maxPlayers, data.durationMinutes);

    if ((room.status === 'finished' || room.status === 'aborted') && room.players.length < 2) {
      resetRoomToWaiting(room);
    }

    const userKey = data.userKey ? String(data.userKey) : null;
    const name = String(data.userName || 'Oyuncu').slice(0, 40);
    
    socket.userKey = userKey;
    socket.roomId = roomId;
    socket.join(roomId);

    let player = findExistingPlayer(room, socket, userKey);

    if (!player && room.players.length >= room.maxPlayers) {
      socket.emit('roomFull', { roomId, message: 'Bu oda dolu.' });
      return;
    }

    if (player) {
      player.id = socket.id;
      player.name = name || player.name;
      player.userKey = userKey || player.userKey;
      player.disconnectedAt = null;
      cancelDisconnectTimer(roomId, player);
    } else {
      const color = room.players.length === 0 ? 'white' : 'black';
      player = {
        id: socket.id,
        userKey,
        name,
        color,
        seat: room.players.length,
        isReady: false
      };
      room.players.push(player);
    }

    emitRoom(room);

    if (room.status === 'playing') {
      io.to(socket.id).emit('gameStarted', {
        roomId,
        playerColor: player.color,
        players: publicRoom(room).players,
        gameState: buildChessState(room)
      });
      emitGameState(room);
    }
  });

  socket.on('setReady', ({ ready } = {}) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.status !== 'waiting') return;
    const player = findExistingPlayer(room, socket, socket.userKey);
    if (!player) return;
    player.id = socket.id;
    player.isReady = !!ready;
    emitRoom(room);
    startChess(room);
  });

  socket.on('toggleReady', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.status !== 'waiting') return;
    const player = findExistingPlayer(room, socket, socket.userKey);
    if (!player) return;
    player.id = socket.id;
    player.isReady = !player.isReady;
    emitRoom(room);
    startChess(room);
  });

  socket.on('chessMove', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || room.gameId !== 'chess' || room.status !== 'playing' || !room.chess) return;

    const player = findExistingPlayer(room, socket, socket.userKey || (data && data.userKey));
    if (!player) return socket.emit('chessMoveRejected', { roomId, reason: 'not_in_room' });

    player.id = socket.id;

    updateClock(room);
    if (room.status !== 'playing') {
      emitGameState(room);
      return socket.emit('chessMoveRejected', { roomId, reason: 'time_expired', gameState: buildChessState(room) });
    }

    const expectedColor = player.color === 'white' ? 'w' : 'b';
    if (room.chess.turn() !== expectedColor) {
      return socket.emit('chessMoveRejected', { roomId, reason: 'not_your_turn', gameState: buildChessState(room) });
    }

    const from = data && String(data.from || '');
    const to = data && String(data.to || '');
    const promotion = data && data.promotion ? String(data.promotion).toLowerCase() : undefined;
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) {
      return socket.emit('chessMoveRejected', { roomId, reason: 'illegal_move', gameState: buildChessState(room) });
    }

    try {
      const move = room.chess.move({ from, to, ...(promotion ? { promotion } : {}) });
      room.turnStartedAt = now();
      room.lastMove = { moveData: {
        from: move.from,
        to: move.to,
        san: move.san,
        color: move.color,
        piece: move.piece,
        captured: move.captured || null,
        promotion: move.promotion || null,
        flags: move.flags
      } };
      const result = mapGameResult(room);
      if (result) {
        room.result = result;
        room.status = 'finished';
      }

      const state = buildChessState(room);
      room.players.forEach(p => io.to(p.id).emit('chessMoveAccepted', {
        roomId,
        playerColor: p.color,
        move: room.lastMove.moveData,
        gameState: state
      }));
      emitGameState(room);
      if (room.status === 'finished') {
        io.to(room.id).emit('gameEnded', { roomId, reason: room.result?.reason || 'finished', gameState: state });
        emitRoom(room);
      }
    } catch (_) {
      socket.emit('chessMoveRejected', { roomId, reason: 'illegal_move', gameState: buildChessState(room) });
    }
  });

  socket.on('leaveRoom', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const player = findExistingPlayer(room, socket, socket.userKey);
    socket.leave(roomId);
    socket.roomId = null;
    if (player) removePlayerFromRoom(room, player, 'Rakip oyundan ayrıldı.');
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    console.log(`[AYRILDI] ${socket.id}`);

    // Oyun devam ediyorsa oyuncuya yeniden bağlanma süresi tanı (sayfa
    // yenileme, mobil ağ kopması, Render uyku/uyanma vb. durumlar için).
    if (room.status === 'playing') {
      player.disconnectedAt = now();
      const key = playerKey(roomId, player);
      cancelDisconnectTimer(roomId, player);
      const timer = setTimeout(() => {
        disconnectTimers.delete(key);
        const currentRoom = rooms.get(roomId);
        if (!currentRoom) return;
        const stillGone = currentRoom.players.find(p => p === player && p.disconnectedAt);
        if (stillGone) removePlayerFromRoom(currentRoom, player, 'Rakip bağlantısı koptu ve geri dönmedi.');
      }, RECONNECT_GRACE_MS);
      disconnectTimers.set(key, timer);
      return;
    }

    removePlayerFromRoom(room, player, 'Rakip odadan ayrıldı.');
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    const before = room.status;
    updateClock(room);
    if (before !== room.status) {
      const state = buildChessState(room);
      emitGameState(room);
      emitRoom(room);
      io.to(room.id).emit('gameEnded', { roomId: room.id, reason: room.result?.reason || 'timeout', gameState: state });
    }
  }
}, 500);

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 GameVerse Render sunucusu ${PORT} portunda aktif.`));
