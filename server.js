// server.js - GameVerse Canlı Sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Frontend'i aynı origin'den sun. Böylece Socket.IO istemcisi yanlış host'a bağlanmaz.
app.use('/js', express.static(path.join(__dirname, 'js')));
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (!fs.existsSync(indexPath)) return res.status(404).send('index.html bulunamadı');
  let html = fs.readFileSync(indexPath, 'utf8');
  const bridge = '<script src="/socket.io/socket.io.js"></script><script src="/js/app.js"></script><script src="/js/games.js"></script><script src="/js/realtime.js"></script>';
  if (!html.includes('/js/realtime.js')) {
    html = html.replace(/<\/body>/i, bridge + '</body>');
  }
  res.type('html').send(html);
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const rooms = {};

function createGameState(gameId) {
  return {
    type: gameId || 'chess',
    board: null,
    score: {},
    history: [],
    currentPlayer: 0,
    status: 'waiting'
  };
}

function getRoom(roomId, gameId, maxPlayers) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      id: roomId,
      gameId: gameId || 'chess',
      maxPlayers: Number(maxPlayers) || 2,
      players: [],
      gameState: createGameState(gameId)
    };
  }
  return rooms[roomId];
}

function broadcastState(room, lastMove, senderId) {
  const payload = {
    gameId: room.gameId,
    roomId: room.id,
    gameState: room.gameState,
    lastMove: lastMove || null
  };
  if (senderId) io.to(room.id).except(senderId).emit('gameStateUpdated', payload);
  else io.to(room.id).emit('gameStateUpdated', payload);
}

io.on('connection', socket => {
  console.log(`[BAĞLANDI] ${socket.id}`);

  socket.on('joinRoom', data => {
    data = data || {};
    if (!data.roomId) return;
    const roomId = String(data.roomId);
    const room = getRoom(roomId, data.gameId, data.maxPlayers);

    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = data.userName || 'Oyuncu';

    if (!room.players.some(p => p.id === socket.id) && room.players.length < room.maxPlayers) {
      const color = room.players.length === 0 ? 'white' : 'black';
      room.players.push({
        id: socket.id,
        name: socket.userName,
        color,
        seat: room.players.length,
        isReady: false
      });
    }

    io.to(roomId).emit('roomUpdated', room);
    socket.emit('gameStateUpdated', { gameId: room.gameId, roomId, gameState: room.gameState });
    console.log(`[ODA] ${roomId}: ${socket.userName} katıldı (${room.players.length}/${room.maxPlayers})`);
  });

  socket.on('toggleReady', () => {
    const room = rooms[socket.roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) player.isReady = !player.isReady;
    io.to(socket.roomId).emit('roomUpdated', room);
  });

  socket.on('makeMove', data => {
    if (!data) return;
    const roomId = String(data.roomId || socket.roomId || '');
    const room = rooms[roomId];
    if (!room) return;

    const moveData = data.moveData !== undefined ? data.moveData : data;
    room.gameId = data.gameId || room.gameId;
    room.gameState.type = room.gameId;
    room.gameState.history.push(moveData);
    room.gameState.currentPlayer = room.gameState.currentPlayer === 0 ? 1 : 0;
    room.gameState.status = 'playing';

    const payload = {
      gameId: room.gameId,
      roomId,
      playerId: socket.id,
      playerName: socket.userName,
      moveData,
      gameState: room.gameState
    };

    socket.to(roomId).emit('moveMade', payload);
    socket.to(roomId).emit('receiveGameMove', moveData);
    socket.to(roomId).emit('gameStateUpdated', {
      gameId: room.gameId,
      roomId,
      gameState: room.gameState,
      lastMove: payload
    });
    console.log(`[HAMLE] ${roomId}`, moveData);
  });

  socket.on('sendGameMove', moveData => {
    socket.emit('makeMove', { roomId: socket.roomId, gameId: rooms[socket.roomId]?.gameId, moveData });
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    const room = roomId && rooms[roomId];
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    io.to(roomId).emit('playerLeft', { playerId: socket.id });
    io.to(roomId).emit('roomUpdated', room);
    if (room.players.length === 0) delete rooms[roomId];
    console.log(`[AYRILDI] ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 GameVerse Canlı Sunucu http://localhost:${PORT} adresinde hazır!`));
