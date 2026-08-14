// server.js - GameVerse Canlı Sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// Oda verileri sunucu belleğinde tutulur.
// gameState eklenmesiyle yeni bağlanan oyuncuya mevcut oyun durumu da aktarılabilir.
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[BAĞLANDI] Kullanıcı soket kimliği: ${socket.id}`);

  // 1. ODAYA KATILMA / MASA OLUŞTURMA
  socket.on('joinRoom', ({ roomId, userName, maxPlayers, gameId }) => {
    if (!roomId) return;

    const safeRoomId = roomId.toString();
    socket.join(safeRoomId);
    socket.roomId = safeRoomId;
    socket.userName = userName;

    if (!rooms[safeRoomId]) {
      rooms[safeRoomId] = {
        id: safeRoomId,
        gameId: gameId || 'chess',
        maxPlayers: maxPlayers || 2,
        players: [],
        gameState: {
          history: [],
          currentPlayer: 0,
          status: 'waiting'
        }
      };
    }

    const room = rooms[safeRoomId];

    const exists = room.players.find(p => p.id === socket.id);
    if (!exists && room.players.length < room.maxPlayers) {
      let assignedColor;
      if (room.players.length === 0) {
        assignedColor = Math.random() < 0.5 ? 'white' : 'black';
      } else {
        const firstPlayerColor = room.players[0].color;
        assignedColor = firstPlayerColor === 'white' ? 'black' : 'white';
      }

      room.players.push({
        id: socket.id,
        name: userName || `Oyuncu ${room.players.length + 1}`,
        color: assignedColor,
        seat: room.players.length,
        isReady: false
      });
    }

    io.to(safeRoomId).emit('roomUpdated', room);

    // Yeni katılan istemci mevcut oyun durumunu da alsın.
    socket.emit('gameStateUpdated', {
      gameId: room.gameId,
      gameState: room.gameState
    });

    console.log(`[MASA GÜNCELLENDİ] Oda #${safeRoomId} -> ${userName} (${room.players.find(p => p.id === socket.id)?.color}) katıldı.`);
  });

  // 2. HAZIRIM / HAZIR DEĞİLİM
  socket.on('toggleReady', () => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.isReady = !player.isReady;
      io.to(roomId).emit('roomUpdated', room);
    }
  });

  // 3. CANLI HAMLE İLETİMİ
  socket.on('makeMove', (data) => {
    if (!data) return;

    const roomId = (data.roomId || socket.roomId)?.toString();
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    const moveData = data.moveData || data;

    // Sunucu tarafında hamle geçmişini tut.
    room.gameState.history.push({
      playerId: socket.id,
      playerName: socket.userName || null,
      move: moveData,
      timestamp: Date.now()
    });
    room.gameState.currentPlayer = room.gameState.currentPlayer === 0 ? 1 : 0;
    room.gameState.status = 'playing';

    const payload = {
      gameId: data.gameId || room.gameId || 'chess',
      roomId,
      playerId: socket.id,
      playerName: socket.userName || null,
      moveData,
      gameState: room.gameState
    };

    // Hamleyi yapan hariç rakibe gönder.
    socket.to(roomId).emit('moveMade', payload);

    // Eski frontend event adıyla da gönder; mevcut/legacy oyun ekranları için uyumluluk.
    socket.to(roomId).emit('receiveGameMove', moveData);

    // State tabanlı istemciler için de yayınla.
    socket.to(roomId).emit('gameStateUpdated', {
      gameId: payload.gameId,
      gameState: room.gameState,
      lastMove: payload
    });

    console.log(`[HAMLE İLETİLDİ] Oda #${roomId}:`, moveData);
  });

  // 4. YEDEK/ESKİ HAMLE EVENTİ
  socket.on('sendGameMove', (moveData) => {
    const roomId = socket.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    room.gameState.history.push({
      playerId: socket.id,
      playerName: socket.userName || null,
      move: moveData,
      timestamp: Date.now()
    });
    room.gameState.currentPlayer = room.gameState.currentPlayer === 0 ? 1 : 0;
    room.gameState.status = 'playing';

    socket.to(roomId).emit('receiveGameMove', moveData);
    socket.to(roomId).emit('moveMade', {
      gameId: room.gameId || 'chess',
      roomId,
      playerId: socket.id,
      playerName: socket.userName || null,
      moveData,
      gameState: room.gameState
    });
    socket.to(roomId).emit('gameStateUpdated', {
      gameId: room.gameId || 'chess',
      gameState: room.gameState,
      lastMove: moveData
    });
  });

  // 5. AYRILMA / BAĞLANTI KOPMASI
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomId];
        console.log(`[ODA SİLİNDİ] Boşalan Oda #${roomId} kaldırıldı.`);
      } else {
        io.to(roomId).emit('playerLeft', { playerId: socket.id });
        io.to(roomId).emit('roomUpdated', room);
      }
    }
    console.log(`[AYRILDI] Soket ayrıldı: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 GameVerse Canlı Sunucu http://localhost:${PORT} adresinde hazır!`);
});
