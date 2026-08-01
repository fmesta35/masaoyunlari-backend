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
    // Oda ID'sini string olarak standartlaştırıyoruz
    const safeRoomId = roomId.toString();
    socket.join(safeRoomId);
    socket.roomId = safeRoomId;
    socket.userName = userName;

    // Oda yoksa sunucu hafızasında sıfırdan kur
    if (!rooms[safeRoomId]) {
      rooms[safeRoomId] = {
        id: safeRoomId,
        gameId: gameId || 'satranc',
        maxPlayers: maxPlayers || 2,
        players: []
      };
    }

    const room = rooms[safeRoomId];

    // Kullanıcı önceden eklenmediyse ve yer varsa masaya oturt
    const exists = room.players.find(p => p.id === socket.id);
    if (!exists && room.players.length < room.maxPlayers) {
      
      // 🎲 RASTGELE RENK ATAMA MANTIĞI
      let assignedColor;
      
      if (room.players.length === 0) {
        // İlk katılan oyuncuya %50 şansla Siyah veya Beyaz ata
        assignedColor = Math.random() < 0.5 ? 'white' : 'black';
      } else {
        // İkinci katılan oyuncuya, ilk oyuncunun renginin tam TERSİNİ ata
        const firstPlayerColor = room.players[0].color;
        assignedColor = firstPlayerColor === 'white' ? 'black' : 'white';
      }

      room.players.push({
        id: socket.id,
        name: userName,
        color: assignedColor,
        isReady: false
      });
    }

    // Masadaki HERKESE güncel oyuncu listesini ve renkleri gönder
    io.to(safeRoomId).emit('roomUpdated', room);
    console.log(`[MASA GÜNCELLENDİ] Oda #${safeRoomId} -> ${userName} (${room.players[room.players.length - 1]?.color}) katıldı.`);
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

  // 3. CANLI HAMLE İLETİMİ (Frontend'den gelen 'makeMove' eventini dinler)
  socket.on('makeMove', (data) => {
    if (data && data.roomId) {
      // socket.to() komutu, işlemi yapan SOKET HARİÇ o odadaki herkese veriyi yollar
      socket.to(data.roomId.toString()).emit('moveMade', data);
    }
  });

  // (Opsiyonel) Diğer oyunlar için eski sendGameMove metodunu da yedek olarak tutuyoruz
  socket.on('sendGameMove', (moveData) => {
    if (socket.roomId) {
      io.to(socket.roomId).emit('receiveGameMove', moveData);
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
        // Rakip çıktığı için frontend tarafındaki 'Hükmen Galibiyet' modülünü tetikler
        io.to(roomId).emit('playerLeft', { playerId: socket.id });
        io.to(roomId).emit('roomUpdated', room); // Kalanlara güncel sandalyeleri yolla
      }
    }
    console.log(`[AYRILDI] Soket ayrıldı: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 GameVerse Canlı Sunucu http://localhost:${PORT} adresinde hazır!`);
});
