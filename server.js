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
    if (!roomId) return;

    // Oda ID'sini metin (string) olarak standartlaştırıyoruz
    const safeRoomId = roomId.toString();
    socket.join(safeRoomId);
    socket.roomId = safeRoomId;
    socket.userName = userName;

    // Oda yoksa sunucu hafızasında sıfırdan kur
    if (!rooms[safeRoomId]) {
      rooms[safeRoomId] = {
        id: safeRoomId,
        gameId: gameId || 'chess',
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
        // İlk katılan oyuncuya %50 şansla Beyaz veya Siyah ata
        assignedColor = Math.random() < 0.5 ? 'white' : 'black';
      } else {
        // İkinci katılan oyuncuya ilk oyuncunun renginin tam TERSİNİ ata
        const firstPlayerColor = room.players[0].color;
        assignedColor = firstPlayerColor === 'white' ? 'black' : 'white';
      }

      room.players.push({
        id: socket.id,
        name: userName || `Oyuncu ${room.players.length + 1}`,
        color: assignedColor, // 'white' veya 'black'
        seat: room.players.length, // 0 veya 1
        isReady: false
      });
    }

    // Masadaki HERKESE güncel oyuncu listesini ve renkleri gönder
    io.to(safeRoomId).emit('roomUpdated', room);
    console.log(`[MASA GÜNCELLENDİ] Oda #${safeRoomId} -> ${userName} (${room.players.find(p => p.id === socket.id)?.color}) katıldı.`);
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
    if (!data) return;

    // Frontend roomId göndermediyse soket üzerindeki mevcudu kullan
    const roomId = (data.roomId || socket.roomId)?.toString();

    if (roomId) {
      // socket.to(...) -> Hamleyi yapan SOKET HARİÇ odadaki rakibe iletir
      socket.to(roomId).emit('moveMade', {
        gameId: data.gameId || 'chess',
        moveData: data.moveData || data
      });
      console.log(`[HAMLE İLETİLDİ] Oda #${roomId}:`, data.moveData || data);
    }
  });

  // (Yedek/Eski Sistem Desteği)
  socket.on('sendGameMove', (moveData) => {
    if (socket.roomId) {
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
        delete rooms[roomId]; // Masa boşaldıysa hafızadan sil
        console.log(`[ODA SİLİNDİ] Boşalan Oda #${roomId} kaldırıldı.`);
      } else {
        // Kalan rakibe bildirim gönder ve sandalyeleri güncelle
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
