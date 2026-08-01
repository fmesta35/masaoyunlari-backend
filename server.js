// server.js - GameVerse Canlı Sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

// public klasöründeki index.html ve statik dosyaları servis et
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Tüm odaları hafızada tutan ana veri yapısı
const rooms = {};

io.on('connection', (socket) => {
  console.log(`[BAĞLANDI] Kullanıcı soket kimliği: ${socket.id}`);

  // 1. ODAYA KATILMA / MASA OLUŞTURMA
  socket.on('joinRoom', ({ roomId, userName, maxPlayers, gameId }) => {
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;

    // Oda yoksa sunucu hafızasında sıfırdan kur
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        gameId: gameId || 'okey',
        maxPlayers: maxPlayers || 2,
        players: []
      };
    }

    const room = rooms[roomId];

    // Kullanıcı önceden eklenmediyse ve yer varsa masaya oturt
    const exists = room.players.find(p => p.id === socket.id);
    if (!exists && room.players.length < room.maxPlayers) {
      room.players.push({
        id: socket.id,
        name: userName,
        isReady: false
      });
    }

    // Masadaki HERKESE güncel oyuncu listesini gönder
    io.to(roomId).emit('roomUpdated', room);
    console.log(`[MASA GÜNCELLENDİ] Oda #${roomId} -> ${userName} katıldı (${room.players.length}/${room.maxPlayers})`);
  });

  // 2. HAZIRIM / HAZIR DEĞİLİM BUTONU
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

  // 3. CANLI HAMLE İLETİMİ (Bilardo Vuruşu, Okey Taş Atma, Satranç Hamlesi vs.)
  socket.on('sendGameMove', (moveData) => {
    if (socket.roomId) {
      // Hamleyi yapan hariç odadaki diğer oyunculara gönder
      socket.to(socket.roomId).emit('receiveGameMove', moveData);
    }
  });

  // 4. AYRILMA / BAĞLANTI KOPMASI
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      const room = rooms[roomId];
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[roomId]; // Masa boşaldıysa sunucudan sil
      } else {
        io.to(roomId).emit('roomUpdated', room); // Kalanlara güncelleme yolla
      }
    }
    console.log(`[AYRILDI] Soket ayrıldı: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 GameVerse Canlı Sunucu http://localhost:${PORT} adresinde hazır!`);
});