// server.js - GameVerse Canlı Sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Chess } = require('chess.js');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use('/js', express.static(path.join(__dirname, 'js')));

app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (!fs.existsSync(indexPath)) return res.status(404).send('index.html bulunamadı');
  res.type('html').send(fs.readFileSync(indexPath, 'utf8'));
});

app.get('/health', (req, res) => res.json({ ok: true, service: 'GameVerse', time: Date.now() }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {};

function createChessState(durationMinutes = 10) {
  const chess = new Chess();
  const ms = Math.max(0, Number(durationMinutes) || 10) * 60 * 1000;
  return {
    fen: chess.fen(),
    turn: 'w',
    history: [],
    status: 'waiting',
    whiteTimeMs: ms,
    blackTimeMs: ms,
    turnStartedAt: null,
    durationMinutes: Math.max(0, Number(durationMinutes) || 10),
    result: null
  };
}

function createGameState(gameId, durationMinutes) {
  if ((gameId || 'chess') === 'chess') return createChessState(durationMinutes);
  return {
    type: gameId || 'chess',
    board: null,
    score: {},
    history: [],
    currentPlayer: 0,
    status: 'waiting'
  };
}

function getRoom(roomId, gameId, maxPlayers, durationMinutes) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      gameId: gameId || 'chess',
      maxPlayers: (gameId || 'chess') === 'chess' ? 2 : (Number(maxPlayers) || 2),
      durationMinutes: Number(durationMinutes) || 10,
      players: [],
      gameState: createGameState(gameId, durationMinutes)
    };
  }
  return rooms[roomId];
}

function getChess(room) {
  const chess = new Chess();
  if (room.gameState?.fen) {
    try { chess.load(room.gameState.fen); } catch (_) {}
  }
  return chess;
}

function chessBoardArray(chess) {
  return chess.board().map(row => row.map(p => p ? (
    p.color === 'w' ? p.type.toUpperCase() : p.type.toLowerCase()
  ) : ''));
}

function chessStateForClient(room) {
  const gs = room.gameState;
  if (room.gameId !== 'chess') return gs;
  const chess = getChess(room);
  return {
    ...gs,
    fen: chess.fen(),
    turn: chess.turn(),
    board: chessBoardArray(chess),
    legalMoves: chess.moves({ verbose: true }).map(m => ({
      from: m.from,
      to: m.to,
      san: m.san,
      promotion: m.promotion || null,
      captured: m.captured || null
    }))
  };
}

function effectiveClock(room) {
  const gs = room.gameState;
  if (room.gameId !== 'chess') return gs;
  let white = gs.whiteTimeMs;
  let black = gs.blackTimeMs;
  if (gs.status === 'playing' && gs.turnStartedAt) {
    const elapsed = Math.max(0, Date.now() - gs.turnStartedAt);
    if (gs.turn === 'w') white = Math.max(0, white - elapsed);
    else black = Math.max(0, black - elapsed);
  }
  return { whiteTimeMs: white, blackTimeMs: black };
}

function roomPayload(room) {
  const gs = chessStateForClient(room);
  if (room.gameId === 'chess') {
    const clock = effectiveClock(room);
    gs.whiteTimeMs = clock.whiteTimeMs;
    gs.blackTimeMs = clock.blackTimeMs;
    gs.serverNow = Date.now();
  }
  return { ...room, gameState: gs };
}

function startChess(room) {
  if (room.gameId !== 'chess') return;
  const duration = Number(room.durationMinutes) || 10;
  room.gameState = createChessState(duration);
  room.gameState.status = 'playing';
  room.gameState.turnStartedAt = Date.now();
  const payload = {
    roomId: room.id,
    gameId: room.gameId,
    players: room.players,
    gameState: chessStateForClient(room),
    serverNow: Date.now()
  };
  io.to(room.id).emit('gameStarted', payload);
  io.to(room.id).emit('roomUpdated', roomPayload(room));
}

function maybeStartRoom(room) {
  if (room.gameId !== 'chess') return;
  if (room.players.length !== 2) return;
  if (!room.players.every(p => p.isReady)) return;
  if (room.gameState.status === 'playing') return;
  startChess(room);
}

io.on('connection', socket => {
  console.log(`[BAĞLANDI] ${socket.id}`);

  socket.on('joinRoom', data => {
    data = data || {};
    if (!data.roomId) return;

    const roomId = String(data.roomId);
    const room = getRoom(roomId, data.gameId, data.maxPlayers, data.durationMinutes);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = data.userName || 'Oyuncu';

    let player = data.userKey ? room.players.find(p => p.userKey === String(data.userKey)) : null;
    if (!player) player = room.players.find(p => p.id === socket.id);

    if (!player && room.players.length < room.maxPlayers) {
      const whiteAlready = room.players.some(p => p.color === 'white');
      const blackAlready = room.players.some(p => p.color === 'black');
      const color = (!whiteAlready && !blackAlready)
        ? (Math.random() < 0.5 ? 'white' : 'black')
        : (whiteAlready ? 'black' : 'white');

      player = {
        id: socket.id,
        userKey: data.userKey ? String(data.userKey) : null,
        name: socket.userName,
        color,
        seat: room.players.length,
        isReady: false
      };
      room.players.push(player);
    } else if (player) {
      player.id = socket.id;
      player.name = socket.userName || player.name;
    }

    socket.playerColor = player?.color || null;

    io.to(roomId).emit('roomUpdated', roomPayload(room));
    socket.emit('gameStateUpdated', {
      gameId: room.gameId,
      roomId,
      playerColor: socket.playerColor,
      gameState: chessStateForClient(room)
    });

    if (room.gameId === 'chess' && room.gameState.status === 'playing') {
      socket.emit('gameStarted', {
        roomId,
        gameId: room.gameId,
        players: room.players,
        playerColor: socket.playerColor,
        gameState: chessStateForClient(room),
        serverNow: Date.now()
      });
    }
  });

  socket.on('toggleReady', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.isReady = !player.isReady;
    io.to(socket.roomId).emit('roomUpdated', roomPayload(room));
    maybeStartRoom(room);
  });

  socket.on('chessMove', data => {
    const room = rooms[socket.roomId];
    if (!room || room.gameId !== 'chess' || room.gameState.status !== 'playing') return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const chess = getChess(room);
    const expectedColor = chess.turn();
    const playerColor = player.color === 'white' ? 'w' : 'b';
    if (playerColor !== expectedColor) {
      socket.emit('chessMoveRejected', { reason: 'not_your_turn', gameState: chessStateForClient(room) });
      return;
    }

    const clock = effectiveClock(room);
    const movingTime = expectedColor === 'w' ? clock.whiteTimeMs : clock.blackTimeMs;
    if (movingTime <= 0) {
      room.gameState.whiteTimeMs = clock.whiteTimeMs;
      room.gameState.blackTimeMs = clock.blackTimeMs;
      room.gameState.status = 'finished';
      room.gameState.result = { reason: 'timeout', winner: expectedColor === 'w' ? 'black' : 'white' };
      io.to(room.id).emit('gameEnded', { roomId: room.id, reason: 'timeout', gameState: chessStateForClient(room) });
      return;
    }

    const from = String(data?.from || '');
    const to = String(data?.to || '');
    const promotion = data?.promotion ? String(data.promotion).toLowerCase() : undefined;
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) {
      socket.emit('chessMoveRejected', { reason: 'invalid_coordinates', gameState: chessStateForClient(room) });
      return;
    }

    let move;
    try {
      move = chess.move({ from, to, ...(promotion ? { promotion } : {}) });
    } catch (_) {
      move = null;
    }
    if (!move) {
      socket.emit('chessMoveRejected', { reason: 'illegal_move', gameState: chessStateForClient(room) });
      return;
    }

    room.gameState.whiteTimeMs = clock.whiteTimeMs;
    room.gameState.blackTimeMs = clock.blackTimeMs;
    room.gameState.fen = chess.fen();
    room.gameState.turn = chess.turn();
    room.gameState.history.push({
      ply: room.gameState.history.length + 1,
      from: move.from,
      to: move.to,
      san: move.san,
      color: move.color,
      captured: move.captured || null,
      promotion: move.promotion || null
    });
    room.gameState.turnStartedAt = Date.now();

    if (chess.isCheckmate()) {
      room.gameState.status = 'finished';
      room.gameState.result = { reason: 'checkmate', winner: player.color, san: move.san };
    } else if (chess.isStalemate()) {
      room.gameState.status = 'finished';
      room.gameState.result = { reason: 'stalemate', winner: null, san: move.san };
    } else if (chess.isDraw()) {
      room.gameState.status = 'finished';
      room.gameState.result = { reason: 'draw', winner: null, san: move.san };
    }

    const payload = {
      roomId: room.id,
      gameId: 'chess',
      playerId: socket.id,
      playerColor: player.color,
      move: {
        from: move.from,
        to: move.to,
        san: move.san,
        color: move.color,
        captured: move.captured || null,
        promotion: move.promotion || null
      },
      gameState: chessStateForClient(room),
      serverNow: Date.now()
    };

    io.to(room.id).emit('chessMoveAccepted', payload);
    if (room.gameState.status === 'finished') io.to(room.id).emit('gameEnded', payload);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const room = roomId && rooms[roomId];
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    io.to(roomId).emit('playerLeft', { playerId: socket.id });
    io.to(roomId).emit('roomUpdated', roomPayload(room));
    if (room.players.length === 0) delete rooms[roomId];
  });
});

setInterval(() => {
  for (const room of Object.values(rooms)) {
    if (room.gameId !== 'chess' || room.gameState.status !== 'playing') continue;
    const clock = effectiveClock(room);
    if (clock.whiteTimeMs <= 0 || clock.blackTimeMs <= 0) {
      const loser = clock.whiteTimeMs <= 0 ? 'white' : 'black';
      room.gameState.whiteTimeMs = clock.whiteTimeMs;
      room.gameState.blackTimeMs = clock.blackTimeMs;
      room.gameState.status = 'finished';
      room.gameState.result = { reason: 'timeout', winner: loser === 'white' ? 'black' : 'white' };
      io.to(room.id).emit('gameEnded', {
        roomId: room.id,
        reason: 'timeout',
        gameState: chessStateForClient(room)
      });
    }
  }
}, 250);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 GameVerse Canlı Sunucu http://localhost:${PORT} adresinde hazır!`));
