// server.js - GameVerse Canlı Sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// Statik dosyaları servis et
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const rooms = {};

io.on('connection', (socket) => {
  console.log(`[BAĞLANDI] Kullanıcı: ${socket.id}`);

  // 1. ODAYA KATILMA
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
        status: 'waiting'
      };
    }

    const room = rooms[safeRoomId];

    const exists = room.players.find(p => p.id === socket.id);
    if (!exists && room.players.length < room.maxPlayers) {
      let assignedColor = 'white';
      if (room.players.length === 1) assignedColor = room.players[0].color === 'white' ? 'black' : 'white';
      else if (room.players.length > 1) assignedColor = 'spectator';

      room.players.push({
        id: socket.id,
        name: userName || `Oyuncu ${room.players.length + 1}`,
        color: assignedColor,
        seat: room.players.length,
        isReady: false
      });
    }

    io.to(safeRoomId).emit('roomUpdated', room);
    console.log(`[ODA #${safeRoomId}] ${userName} katıldı.`);
  });

  // 2. HAZIRIM / İPTAL BUTONU
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

  // 3. EVRENSEL HAMLE İLETİMİ (TÜM OYUNLAR İÇİN)
  socket.on('makeMove', (data) => {
    if (!data) return;
    const roomId = (data.roomId || socket.roomId)?.toString();
    if (roomId) {
      // socket.to() = Gönderen hariç odadaki herkese ilet
      socket.to(roomId).emit('moveMade', {
        gameId: data.gameId || rooms[roomId]?.gameId,
        moveData: data.moveData || data
      });
      console.log(`[HAMLE -> Oda #${roomId}]`, data.moveData?.action || 'Satranç Hamlesi');
    }
  });

  // 4. BAĞLANTI KOPMASI
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit('playerLeft', { playerId: socket.id });
        io.to(roomId).emit('roomUpdated', room);
      }
    }
    console.log(`[AYRILDI] ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 GameVerse Canlı Sunucu http://localhost:${PORT} adresinde aktif!`);
});
