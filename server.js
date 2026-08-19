// GameVerse - Render gerçek zamanlı oyun sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
const tavlaEngine = require('./tavla-engine');

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
const MAX_SPECTATORS = 20;
// Terk sonrası oda hemen sıfırlanmaz: kalan oyuncu "Kazandınız" ekranını
// görürken renginin değişmemesi için sonuç bir süre korunur.
const POST_GAME_HOLD_MS = Number(process.env.GV_POST_GAME_HOLD_MS) || 8000;
// Oyun sırasında kopan oyuncuya yeniden bağlanması için tanınan süre (ms).
const RECONNECT_GRACE_MS = 30000;
// Hamle süresi: 40. saniyede uyarı, 60. saniyede (1 dk) hükmen mağlubiyet.
// DİKKAT: bu sayaç YALNIZCA oyun başında ve gerçek bir hamlede sıfırlanır
// (touchMoveTimer). updateClock() içinde sıfırlanırsa saat döngüsü
// (500 ms'de bir) sayacı sürekli başa döndürür ve denetim ölü kod olur.
const MOVE_WARN_MS = Number(process.env.GV_MOVE_WARN_MS) || 40000;
const MOVE_FORFEIT_MS = Number(process.env.GV_MOVE_FORFEIT_MS) || 60000;
const disconnectTimers = new Map();

// Lobide HER ZAMAN görünen kalıcı hazır masalar: 2 kişilik, masanın kendi
// süresi korunur (istemci ne gönderirse göndersin değişmez), boşken de
// listelenir, oyun bitince silinmez — beklemeye alınır.
// Satranç: #101-#110 — 3 oda tipi: 4x Hızlı (10 dk), 3x Normal (15 dk),
// 3x Düşünen (20 dk).  Bu dağılım YALNIZCA satranca özgüdür.
// Tavla: #201-#210 (5/10/15/20 karışık).
const CHESS_PRESET_TYPES = [
  ...Array(4).fill({ label: '⚡ Hızlı', durationMinutes: 10 }),
  ...Array(3).fill({ label: '♟️ Normal', durationMinutes: 15 }),
  ...Array(3).fill({ label: '🧠 Düşünen', durationMinutes: 20 })
];

function presetRange(startId) {
  const durations = [5, 10, 15, 20, 5, 10, 15, 20, 5, 10];
  return durations.map((d, i) => ({ id: String(startId + i), durationMinutes: d }));
}
const PRESET_TABLES = [
  ...CHESS_PRESET_TYPES.map((t, i) => ({
    id: String(101 + i),
    gameId: 'chess',
    durationMinutes: t.durationMinutes,
    name: `${t.label} Masa #${101 + i}`
  })),
  ...presetRange(201).map(t => ({ ...t, gameId: 'tavla' }))
];

function seedPresetTables() {
  for (const t of PRESET_TABLES) {
    const existing = rooms.get(t.id);
    if (existing) { existing.isPreset = true; continue; }
    const room = createRoom(t.id, t.gameId || 'chess', 2, t.durationMinutes, { name: t.name || ('Masa #' + t.id) });
    room.isPreset = true;
  }
}

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

function lobbyChannel(gameId) {
  return 'lobby:' + String(gameId || 'chess');
}

function createRoom(id, gameId, maxPlayers, durationMinutes, meta) {
  meta = meta || {};
  const duration = Math.max(1, Number(durationMinutes) || 10);
  const name = meta.name ? String(meta.name).slice(0, 60) : ('Masa #' + id);
  const room = {
    id,
    gameId: gameId || 'chess',
    name,
    isPrivate: !!meta.isPrivate,
    maxPlayers: Math.min(Number(maxPlayers) || 2, MAX_ROOM_PLAYERS),
    durationMinutes: duration,
    players: [],
    spectators: [],
    status: 'waiting',
    isPreset: false,
    chess: null,
    tavla: null,
    whiteTimeMs: duration * 60 * 1000,
    blackTimeMs: duration * 60 * 1000,
    turnStartedAt: null,
    moveStartedAt: null,
    moveWarned: false,
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
  room.tavla = null;
  room.result = null;
  room.lastMove = null;
  room.turnStartedAt = null;
  room.moveStartedAt = null;
  room.moveWarned = false;
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

function publicPlayer(p) {
  return {
    id: p.id,
    userKey: p.userKey,
    name: p.name,
    color: p.color,
    seat: p.seat,
    isReady: !!p.isReady
  };
}

function publicSpectator(s) {
  return {
    id: s.id,
    userKey: s.userKey,
    name: s.name
  };
}

function publicRoom(room) {
  const spectators = Array.isArray(room.spectators) ? room.spectators : [];
  return {
    id: room.id,
    gameId: room.gameId,
    name: room.name || ('Masa #' + room.id),
    isPrivate: !!room.isPrivate,
    maxPlayers: room.maxPlayers,
    duration: room.durationMinutes,
    durationMinutes: room.durationMinutes,
    status: room.status,
    players: room.players.map(publicPlayer),
    spectators: spectators.map(publicSpectator),
    spectatorCount: spectators.length,
    readyCount: room.players.filter(p => p.isReady).length
  };
}

function publicLobbyRoom(room) {
  const spectators = Array.isArray(room.spectators) ? room.spectators : [];
  return {
    id: room.id,
    gameId: room.gameId,
    name: room.name || ('Masa #' + room.id),
    maxPlayers: room.maxPlayers,
    players: room.players.length,
    playerList: room.players.map(p => ({ name: p.name, isReady: !!p.isReady, color: p.color })),
    spectatorCount: spectators.length,
    status: room.status,
    isPrivate: !!room.isPrivate,
    duration: room.durationMinutes,
    durationMinutes: room.durationMinutes
  };
}

function listPublicRooms(gameId) {
  // NOT: boş masalar DA listelenir (eskiden `players.length > 0` filtresi
  // yüzünden 0 oyunculu kalıcı masalar lobide görünmüyordu: "Henüz açık
  // masa yok" hatasının sebebi buydu).
  return [...rooms.values()]
    .filter(r => (!gameId || r.gameId === gameId) && !r.isPrivate)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'waiting' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    })
    .map(publicLobbyRoom);
}

function emitLobby(gameId) {
  const gid = gameId || 'chess';
  io.to(lobbyChannel(gid)).emit('roomsUpdated', { gameId: gid, rooms: listPublicRooms(gid) });
}

// Hamle sayacı SADECE burada sıfırlanır: oyun başında ve gerçek bir hamlede.
// updateClock() her çağrısında (saat döngüsü 500 ms'de bir çalışır) sayacı
// sıfırlamak hamle süresi denetimini tamamen çalışmaz hale getiriyordu:
// elapsed hiç eşiği aşamadığı için ne uyarı ne de hükmen mağlubiyet geliyordu.
function touchMoveTimer(room) {
  room.moveStartedAt = now();
  room.moveWarned = false;
}

// Sıra kimde? ('white' | 'black' | null) — satranç ve tavla için ortak.
function turnColorOf(room) {
  if (room.chess) return room.chess.turn() === 'w' ? 'white' : 'black';
  if (room.tavla) return room.tavla.turn === 'w' ? 'white' : 'black';
  return null;
}

function updateClock(room) {
  if ((!room.chess && !room.tavla) || room.status !== 'playing' || !room.turnStartedAt) return;
  const turnColor = turnColorOf(room);
  if (!turnColor) return;
  const elapsed = Math.max(0, now() - room.turnStartedAt);
  if (turnColor === 'white') room.whiteTimeMs = Math.max(0, room.whiteTimeMs - elapsed);
  else room.blackTimeMs = Math.max(0, room.blackTimeMs - elapsed);
  room.turnStartedAt = now();
  // NOT: room.moveStartedAt ve room.moveWarned'a buraya bilinçli olarak
  // dokunulmaz; bkz. touchMoveTimer.

  const remaining = turnColor === 'white' ? room.whiteTimeMs : room.blackTimeMs;
  if (remaining <= 0) {
    room.status = 'finished';
    room.result = { reason: 'timeout', winner: turnColor === 'white' ? 'black' : 'white' };
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

function buildChessState(room, opts) {
  if (!room.chess) return null;
  updateClock(room);
  const chess = room.chess;
  const hideMoves = !!(opts && opts.hideMoves);
  // Hamle sayacı göstergesi için: bu paketin hazırlandığı andaki kalan süre.
  // İstemci, serverNow üzerinden geçen süreyi düşerek canlı geri sayım yapar.
  const moveElapsed = (room.status === 'playing' && room.moveStartedAt)
    ? Math.max(0, now() - room.moveStartedAt)
    : 0;
  return {
    board: boardArray(chess),
    turn: chess.turn(),
    legalMoves: (!hideMoves && room.status === 'playing') ? legalMoves(chess) : [],
    history: serializeHistory(chess),
    status: room.status,
    whiteTimeMs: room.whiteTimeMs,
    blackTimeMs: room.blackTimeMs,
    moveLimitMs: MOVE_FORFEIT_MS,
    moveRemainingMs: Math.max(0, MOVE_FORFEIT_MS - moveElapsed),
    serverNow: now(),
    result: room.result,
    check: typeof chess.isCheck === 'function' ? chess.isCheck() : false,
    fen: chess.fen()
  };
}

// Testlerde deterministik zar: GV_TAVLA_FORCE_DICE="3,1" tüm zarları sabitler.
function forcedTavlaDice() {
  const raw = String(process.env.GV_TAVLA_FORCE_DICE || '').trim();
  if (!raw) return null;
  const m = raw.split(',').map(x => parseInt(x, 10));
  return (m.length === 2 && m.every(n => n >= 1 && n <= 6)) ? m : null;
}

function buildTavlaState(room, opts) {
  if (!room.tavla) return null;
  updateClock(room);
  const t = room.tavla;
  const hideMoves = !!(opts && opts.hideMoves);
  const moveElapsed = (room.status === 'playing' && room.moveStartedAt)
    ? Math.max(0, now() - room.moveStartedAt)
    : 0;
  return {
    kind: 'tavla',
    points: t.points.map(p => ({ color: p.color, count: p.count })),
    bar: { w: t.bar.w, b: t.bar.b },
    off: { w: t.off.w, b: t.off.b },
    turn: t.turn,
    dice: [t.dice[0], t.dice[1]],
    movesLeft: t.movesLeft.slice(),
    rolled: !!t.rolled,
    legalMoves: (!hideMoves && room.status === 'playing' && t.rolled) ? tavlaEngine.legalSteps(t) : [],
    turnMoves: t.history.length, // tur içi hamle sayısı (Geri Al butonu)
    status: room.status,
    whiteTimeMs: room.whiteTimeMs,
    blackTimeMs: room.blackTimeMs,
    moveLimitMs: MOVE_FORFEIT_MS,
    moveRemainingMs: Math.max(0, MOVE_FORFEIT_MS - moveElapsed),
    serverNow: now(),
    result: room.result,
    notice: room.tavlaNotice || null,
    lastStep: room.lastMove ? room.lastMove.moveData : null
  };
}

// Oyun türüne göre doğru durum üreticisini seç (satranç / tavla).
function buildBoardState(room, opts) {
  if (room.chess) return buildChessState(room, opts);
  if (room.tavla) return buildTavlaState(room, opts);
  return null;
}

function emitRoom(room) {
  io.to(room.id).emit('roomUpdated', publicRoom(room));
  emitLobby(room.gameId);
}

function emitToPlayer(player, event, payload) {
  if (!player || !player.id) return;
  io.to(player.id).emit(event, payload);
}

function emitGameState(room) {
  const state = buildBoardState(room);
  if (!state) return;
  const specState = { ...state, legalMoves: [] };
  room.players.forEach(player => {
    emitToPlayer(player, 'gameStateUpdated', {
      roomId: room.id,
      gameState: state,
      playerColor: player.color,
      lastMove: room.lastMove,
      isSpectator: false
    });
  });
  (room.spectators || []).forEach(spec => {
    emitToPlayer(spec, 'gameStateUpdated', {
      roomId: room.id,
      gameState: specState,
      playerColor: null,
      lastMove: room.lastMove,
      isSpectator: true
    });
  });
}

function emitPlayingSnapshot(room, socketId, player) {
  if (!room || room.status !== 'playing' || (!room.chess && !room.tavla)) return;
  updateClock(room);
  const isSpec = !player;
  const state = buildBoardState(room, { hideMoves: isSpec });
  io.to(socketId).emit('gameStarted', {
    roomId: room.id,
    playerColor: player ? player.color : null,
    isSpectator: isSpec,
    players: publicRoom(room).players,
    gameState: state
  });
  io.to(socketId).emit('gameStateUpdated', {
    roomId: room.id,
    gameState: state,
    playerColor: player ? player.color : null,
    lastMove: room.lastMove,
    isSpectator: isSpec
  });
}

function startChess(room) {
  if (room.status === 'playing') return;
  if (room.players.length !== 2 || !room.players.every(p => p.isReady)) return;

  // Renkler RASTGELE dağıtılır (ilk giren hep beyaz olmasın);
  // beyaz kimdeyse ilk hamleyi o yapar.
  const flip = Math.random() < 0.5;
  room.players[0].color = flip ? 'black' : 'white';
  room.players[1].color = flip ? 'white' : 'black';

  room.chess = new Chess();
  room.status = 'playing';
  room.result = null;
  room.lastMove = null;
  room.whiteTimeMs = room.durationMinutes * 60 * 1000;
  room.blackTimeMs = room.durationMinutes * 60 * 1000;
  room.turnStartedAt = now();
  touchMoveTimer(room); // hamle sayacı oyun başında başlar

  const state = buildChessState(room);
  const specState = { ...state, legalMoves: [] };
  emitRoom(room);
  room.players.forEach(player => {
    emitToPlayer(player, 'gameStarted', {
      roomId: room.id,
      playerColor: player.color,
      isSpectator: false,
      players: publicRoom(room).players,
      gameState: state
    });
  });
  (room.spectators || []).forEach(spec => {
    emitToPlayer(spec, 'gameStarted', {
      roomId: room.id,
      playerColor: null,
      isSpectator: true,
      players: publicRoom(room).players,
      gameState: specState
    });
  });
  emitGameState(room);
}

function startTavla(room) {
  if (room.status === 'playing') return;
  if (room.players.length !== 2 || !room.players.every(p => p.isReady)) return;

  // Satrançtaki gibi renkler RASTGELE dağıtılır; beyaz (w) başlar.
  const flip = Math.random() < 0.5;
  room.players[0].color = flip ? 'black' : 'white';
  room.players[1].color = flip ? 'white' : 'black';

  room.tavla = tavlaEngine.init();
  room.tavlaNotice = null;
  room.status = 'playing';
  room.result = null;
  room.lastMove = null;
  room.whiteTimeMs = room.durationMinutes * 60 * 1000;
  room.blackTimeMs = room.durationMinutes * 60 * 1000;
  room.turnStartedAt = now();
  touchMoveTimer(room); // hamle sayacı oyun başında başlar

  const state = buildTavlaState(room);
  const specState = { ...state, legalMoves: [] };
  emitRoom(room);
  room.players.forEach(player => {
    emitToPlayer(player, 'gameStarted', {
      roomId: room.id,
      playerColor: player.color,
      isSpectator: false,
      players: publicRoom(room).players,
      gameState: state
    });
  });
  (room.spectators || []).forEach(spec => {
    emitToPlayer(spec, 'gameStarted', {
      roomId: room.id,
      playerColor: null,
      isSpectator: true,
      players: publicRoom(room).players,
      gameState: specState
    });
  });
  emitGameState(room);
}

// Oda türüne göre doğru oyunu başlat.
function startRoomGame(room) {
  if (!room) return;
  if (room.gameId === 'tavla') return startTavla(room);
  if (room.gameId === 'chess') return startChess(room);
}

function findExistingPlayer(room, socket, userKey) {
  if (!room || !Array.isArray(room.players)) return null;
  return room.players.find(p => p.id === socket.id) ||
    (userKey ? room.players.find(p => p.userKey && p.userKey === userKey) : null) ||
    (socket.userKey ? room.players.find(p => p.userKey && p.userKey === socket.userKey) : null);
}

function findExistingSpectator(room, socket, userKey) {
  if (!room || !Array.isArray(room.spectators)) return null;
  return room.spectators.find(s => s.id === socket.id) ||
    (userKey ? room.spectators.find(s => s.userKey && s.userKey === userKey) : null) ||
    (socket.userKey ? room.spectators.find(s => s.userKey && s.userKey === socket.userKey) : null);
}

function maybePromoteSpectators(room) {
  if (!room || room.status !== 'waiting') return;
  if (!Array.isArray(room.spectators)) room.spectators = [];
  // "İzle" diyerek gelenler koltuğa TERFİ ETTİRİLMEZ; yalnızca oda dolu
  // olduğu için izleyiciye düşmüş olanlar sıradaki koltuğu alabilir.
  while (room.players.length < room.maxPlayers &&
         room.spectators.some(s => !s.wantsSpectate)) {
    const idx = room.spectators.findIndex(s => !s.wantsSpectate);
    const spec = room.spectators.splice(idx, 1)[0];
    const color = room.players.length === 0 ? 'white' : 'black';
    const player = {
      id: spec.id,
      userKey: spec.userKey,
      name: spec.name,
      color,
      seat: room.players.length,
      isReady: false
    };
    room.players.push(player);
    io.to(spec.id).emit('promotedToPlayer', {
      roomId: room.id,
      playerColor: color,
      room: publicRoom(room)
    });
  }
}

function removeSpectator(room, spec) {
  if (!room || !spec) return;
  room.spectators = (room.spectators || []).filter(s => s !== spec);
  emitRoom(room);
}

function destroyRoom(room) {
  if (!room) return;
  // Kalıcı hazır masalar (#101-#110) ASLA silinmez: boşalınca beklemeye
  // alınır ve lobide görünmeye devam eder.
  if (room.isPreset) {
    resetRoomToWaiting(room);
    console.log(`[ODA #${room.id}] hazır masa boşaldı; beklemeye alındı (silinmedi).`);
    emitRoom(room);
    return;
  }
  (room.spectators || []).forEach(spec => {
    io.to(spec.id).emit('roomClosed', { roomId: room.id, message: 'Oda kapandı.' });
  });
  rooms.delete(room.id);
  console.log(`[ODA #${room.id}] boşaldı ve silindi.`);
  emitLobby(room.gameId);
}

function removePlayerFromRoom(room, player, message) {
  if (!room || !player) return;
  cancelDisconnectTimer(room.id, player);
  room.players = room.players.filter(p => p !== player);

  if (room.players.length === 0) {
    destroyRoom(room);
    return;
  }

  const wasPlaying = room.status === 'playing';
  // Oyun sürerken ayrılan oyuncu HÜKMEN MAĞLUP olur; kalan oyuncu kazanır.
  // (Satranç ve tavla için ortak.)
  if (wasPlaying && (room.chess || room.tavla)) {
    const remaining = room.players[0];
    room.status = 'finished';
    room.result = { reason: 'player_left', winner: remaining ? remaining.color : null };
    const state = buildBoardState(room);

    // KRİTİK: kalan oyuncuya rengine bakmadan "kazandın" bilgisi gönderilir.
    // Eskiden oda hemen sıfırlanıp renkler yeniden dağıtıldığı için istemcideki
    // `winner === playerColor` karşılaştırması false oluyor ve KALAN oyuncu
    // "kaybettiniz" mesajı görüyordu.
    room.players.forEach(p => {
      io.to(p.id).emit('gameEnded', {
        roomId: room.id,
        reason: 'player_left',
        winner: room.result.winner,
        winnerColor: room.result.winner,
        playerColor: p.color,
        youWon: true,
        gameState: state
      });
    });
    (room.spectators || []).forEach(s => {
      io.to(s.id).emit('gameEnded', {
        roomId: room.id,
        reason: 'player_left',
        winner: room.result.winner,
        winnerColor: room.result.winner,
        playerColor: null,
        youWon: false,
        isSpectator: true,
        gameState: { ...state, legalMoves: [] }
      });
    });
    emitGameState(room);
    emitRoom(room);
    io.to(room.id).emit('playerLeft', {
      roomId: room.id,
      youWon: true,
      message: message || 'Rakip oyundan ayrıldı.'
    });

    // Oda, kazanan ekranı görülebilsin diye hemen sıfırlanmaz.
    const roomId = room.id;
    const holdTimer = setTimeout(() => {
      const current = rooms.get(roomId);
      if (!current || current.status !== 'finished') return;
      if (current.players.length === 0) {
        destroyRoom(current);
        return;
      }
      resetRoomToWaiting(current);
      maybePromoteSpectators(current);
      emitRoom(current);
    }, POST_GAME_HOLD_MS);
    if (typeof holdTimer.unref === 'function') holdTimer.unref();
    return;
  }

  resetRoomToWaiting(room);
  maybePromoteSpectators(room);
  emitRoom(room);
}

io.on('connection', socket => {
  console.log(`[BAĞLANDI] ${socket.id}`);

  socket.on('subscribeLobby', payload => {
    const gameId = String((payload && payload.gameId) || 'chess');
    for (const roomName of socket.rooms) {
      if (String(roomName).startsWith('lobby:')) socket.leave(roomName);
    }
    socket.lobbyGameId = gameId;
    socket.join(lobbyChannel(gameId));
    socket.emit('roomsUpdated', { gameId, rooms: listPublicRooms(gameId) });
  });

  socket.on('unsubscribeLobby', () => {
    for (const roomName of socket.rooms) {
      if (String(roomName).startsWith('lobby:')) socket.leave(roomName);
    }
    socket.lobbyGameId = null;
  });

  socket.on('listRooms', payload => {
    const gameId = String((payload && payload.gameId) || 'chess');
    socket.emit('roomsUpdated', { gameId, rooms: listPublicRooms(gameId) });
  });

  socket.on('joinRoom', payload => {
    const data = payload || {};
    if (!data.roomId) return;

    const roomId = String(data.roomId);
    const gameId = data.gameId || 'chess';
    let room = rooms.get(roomId);
    if (!room) {
      room = createRoom(roomId, gameId, data.maxPlayers, data.durationMinutes, {
        name: data.roomName || data.name,
        isPrivate: !!(data.isPrivate)
      });
    } else if (!room.name && (data.roomName || data.name)) {
      room.name = String(data.roomName || data.name).slice(0, 60);
    }

    if ((room.status === 'finished' || room.status === 'aborted') && room.players.length < 2) {
      resetRoomToWaiting(room);
    }

    const userKey = data.userKey ? String(data.userKey) : null;
    const name = String(data.userName || 'Oyuncu').slice(0, 40);
    const wantSpectate = !!(data.asSpectator || data.spectate);

    socket.userKey = userKey;
    socket.roomId = roomId;
    socket.join(roomId);

    let player = findExistingPlayer(room, socket, userKey);
    let spectator = findExistingSpectator(room, socket, userKey);

    // "İzle" ile gelen bağlantı ASLA koltuk almaz / koltuk geri kazanmaz.
    // Aynı tarayıcı (aynı userKey) ikinci sekmede izlemek istediğinde sunucu
    // eskiden onu oyuncu koltuğuna reconnect ediyordu; "Siyah (Siz)" +
    // "sıra sizde değil" hatası buradan geliyordu.
    if (wantSpectate && player && player.id !== socket.id) {
      player = null;
    }

    if (player) {
      player.id = socket.id;
      player.name = name || player.name;
      player.userKey = userKey || player.userKey;
      player.disconnectedAt = null;
      cancelDisconnectTimer(roomId, player);
      if (spectator) room.spectators = room.spectators.filter(s => s !== spectator);
      socket.role = 'player';
    } else if (spectator && (wantSpectate || room.players.length >= room.maxPlayers || room.status === 'playing')) {
      spectator.id = socket.id;
      spectator.name = name || spectator.name;
      spectator.userKey = userKey || spectator.userKey;
      socket.role = 'spectator';
    } else if (!wantSpectate && room.players.length < room.maxPlayers && room.status === 'waiting') {
      if (spectator) room.spectators = room.spectators.filter(s => s !== spectator);
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
      socket.role = 'player';
    } else {
      if (!Array.isArray(room.spectators)) room.spectators = [];
      if (!spectator && room.spectators.length >= MAX_SPECTATORS) {
        socket.emit('roomFull', { roomId, message: 'Oda dolu ve izleyici kotası doldu.' });
        socket.leave(roomId);
        socket.roomId = null;
        socket.role = null;
        return;
      }
      if (!spectator) {
        spectator = { id: socket.id, userKey, name };
        room.spectators.push(spectator);
      } else {
        spectator.id = socket.id;
        spectator.name = name || spectator.name;
        spectator.userKey = userKey || spectator.userKey;
      }
      socket.role = 'spectator';
    }

    // Bilinçli olarak "İzle" diyen kişi boşalan koltuğa otomatik oturtulmaz.
    if (socket.role === 'spectator' && spectator) {
      spectator.wantsSpectate = spectator.wantsSpectate || wantSpectate;
    }

    emitRoom(room);
    socket.emit('joinedRoom', {
      roomId,
      role: socket.role,
      playerColor: player ? player.color : null,
      isSpectator: socket.role === 'spectator',
      room: publicRoom(room)
    });

    if (room.status === 'playing') {
      // Yeniden bağlanan oyuncuya / izleyiciye durumu SADECE ona gönder;
      // tüm odaya yayınlamak rakibin taş seçimini sıfırlıyordu.
      emitPlayingSnapshot(room, socket.id, player || null);
    }
  });

  // İzleyici "hazırım" gönderemez: koltuk yalnızca SOKET kimliğiyle bulunur.
  function seatedPlayer(room) {
    if (!room) return null;
    if (socket.role === 'spectator') return null;
    if ((room.spectators || []).some(s => s.id === socket.id)) return null;
    return room.players.find(p => p.id === socket.id) || null;
  }

  socket.on('setReady', ({ ready } = {}) => {
    const room = rooms.get(socket.roomId);
    if (!room || room.status !== 'waiting') return;
    const player = seatedPlayer(room);
    if (!player) return;
    player.isReady = !!ready;
    emitRoom(room);
    startRoomGame(room);
  });

  socket.on('toggleReady', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.status !== 'waiting') return;
    const player = seatedPlayer(room);
    if (!player) return;
    player.isReady = !player.isReady;
    emitRoom(room);
    startRoomGame(room);
  });

  socket.on('chessMove', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || room.gameId !== 'chess' || room.status !== 'playing' || !room.chess) return;

    // GÜVENLİK: koltuk eşleşmesi SOKET kimliğiyle yapılır. Aksi halde izleyici,
    // oyuncuyla aynı userKey'i (aynı tarayıcı / 2. sekme) göndererek onun
    // koltuğu üzerinden hamle oynayabiliyordu.
    const isSpectatorSocket = socket.role === 'spectator' ||
      (room.spectators || []).some(s => s.id === socket.id);
    const player = isSpectatorSocket ? null : room.players.find(p => p.id === socket.id);
    if (!player) return socket.emit('chessMoveRejected', { roomId, reason: 'not_in_room' });

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
      touchMoveTimer(room); // gerçek hamle: hamle sayacı başa döner
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
        gameState: state,
        isSpectator: false
      }));
      (room.spectators || []).forEach(spec => io.to(spec.id).emit('chessMoveAccepted', {
        roomId,
        playerColor: null,
        move: room.lastMove.moveData,
        gameState: { ...state, legalMoves: [] },
        isSpectator: true
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

  // ==================== TAVLA ====================
  // Koltuk doğrulaması satrançtakiyle aynı: SOKET kimliğiyle yapılır,
  // izleyici ASLA oynayamaz (aynı userKey ile 2. sekme dahil).
  function tavlaSeatedPlayer(room) {
    if (!room || room.gameId !== 'tavla' || room.status !== 'playing' || !room.tavla) return null;
    const isSpectatorSocket = socket.role === 'spectator' ||
      (room.spectators || []).some(s => s.id === socket.id);
    if (isSpectatorSocket) return null;
    return room.players.find(p => p.id === socket.id) || null;
  }

  function tavlaReject(roomId, reason) {
    socket.emit('tavlaRejected', { roomId, reason });
  }

  // Yasal hamle kalmadıysa / zarlar bittiyse sırayı otomatik devreder.
  function tavlaAdvance(room) {
    const t = room.tavla;
    if (!t || room.status !== 'playing' || !t.rolled || t.winner) return;
    if (t.movesLeft.length && tavlaEngine.legalSteps(t).length) return; // hâlâ hamle var
    const noMoves = t.movesLeft.length > 0; // zar vardı ama yasal hamle yoktu
    tavlaEngine.endTurn(t);
    room.turnStartedAt = now();
    touchMoveTimer(room); // yeni oyuncunun hamle süresi başlar
    if (noMoves) {
      room.tavlaNoticeSeq = (room.tavlaNoticeSeq || 0) + 1;
      room.tavlaNotice = {
        id: room.id + ':' + room.tavlaNoticeSeq,
        type: 'no_moves',
        text: 'Yasal hamle yok — sıra otomatik olarak rakibe geçti.'
      };
    }
  }

  function tavlaFinish(room) {
    const t = room.tavla;
    const winnerColor = t.winner === 'w' ? 'white' : 'black';
    const loser = t.winner === 'w' ? 'b' : 'w';
    // Rakip hiç pul çıkaramadıysa MARS
    const reason = t.off[loser] === 0 ? 'mars' : 'win';
    room.status = 'finished';
    room.result = { reason, winner: winnerColor };
    const state = buildTavlaState(room);
    room.players.forEach(p => io.to(p.id).emit('gameEnded', {
      roomId: room.id,
      reason,
      winner: winnerColor,
      winnerColor,
      playerColor: p.color,
      youWon: p.color === winnerColor,
      gameState: state
    }));
    (room.spectators || []).forEach(s => io.to(s.id).emit('gameEnded', {
      roomId: room.id,
      reason,
      winner: winnerColor,
      winnerColor,
      playerColor: null,
      youWon: false,
      isSpectator: true,
      gameState: { ...state, legalMoves: [] }
    }));
    emitGameState(room);
    emitRoom(room);
  }

  socket.on('tavlaRoll', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || room.gameId !== 'tavla' || room.status !== 'playing' || !room.tavla) return;
    const player = tavlaSeatedPlayer(room);
    if (!player) return tavlaReject(roomId, 'not_in_room');
    updateClock(room);
    if (room.status !== 'playing') { emitGameState(room); return tavlaReject(roomId, 'time_expired'); }
    const expectedColor = player.color === 'white' ? 'w' : 'b';
    if (room.tavla.turn !== expectedColor) return tavlaReject(roomId, 'not_your_turn');
    if (room.tavla.rolled) return tavlaReject(roomId, 'already_rolled');
    tavlaEngine.roll(room.tavla, forcedTavlaDice() || undefined);
    room.lastMove = null;
    tavlaAdvance(room); // zar attı ama yasal hamle yoksa pas
    emitGameState(room);
  });

  socket.on('tavlaMove', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || room.gameId !== 'tavla' || room.status !== 'playing' || !room.tavla) return;
    const player = tavlaSeatedPlayer(room);
    if (!player) return tavlaReject(roomId, 'not_in_room');
    updateClock(room);
    if (room.status !== 'playing') { emitGameState(room); return tavlaReject(roomId, 'time_expired'); }
    const t = room.tavla;
    const expectedColor = player.color === 'white' ? 'w' : 'b';
    if (t.turn !== expectedColor) return tavlaReject(roomId, 'not_your_turn');
    if (!t.rolled) return tavlaReject(roomId, 'roll_first');

    const rawFrom = data && data.from;
    const from = rawFrom === 'bar' ? 'bar' : parseInt(rawFrom, 10);
    const rawTo = data && data.to;
    const to = rawTo === 'off' ? 'off' : parseInt(rawTo, 10);
    const fromOk = from === 'bar' || (Number.isInteger(from) && from >= 0 && from <= 23);
    const toOk = to === 'off' || (Number.isInteger(to) && to >= 0 && to <= 23);
    if (!fromOk || !toOk) return tavlaReject(roomId, 'bad_target');

    // Zar değeri mesafeden türetilir; geçerlilik tamamen legalSteps'tedir
    // (vuruş, kapalı kapı, bar zorunluluğu, toplama ve zar-maksimizasyon
    // kurallarının tamamı orada denetlenir).
    let die;
    if (from === 'bar') {
      if (to === 'off') return tavlaReject(roomId, 'bad_target');
      die = expectedColor === 'w' ? 24 - to : to + 1;
    } else if (to === 'off') {
      die = expectedColor === 'w' ? from + 1 : 24 - from;
    } else {
      die = Math.abs(to - from);
    }

    const legal = tavlaEngine.legalSteps(t);
    const step = legal.find(x => x.from === from && x.to === to && x.die === die) ||
      (to === 'off' ? legal.find(x => x.from === from && x.to === 'off') : null);
    if (!step) return tavlaReject(roomId, 'illegal_move');

    tavlaEngine.applyStep(t, step);
    room.lastMove = { moveData: { from: step.from, to: step.to, die: step.die, color: expectedColor } };

    if (t.winner) { tavlaFinish(room); return; }
    tavlaAdvance(room);
    emitGameState(room);
  });

  socket.on('tavlaUndo', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || room.gameId !== 'tavla' || room.status !== 'playing' || !room.tavla) return;
    const player = tavlaSeatedPlayer(room);
    if (!player) return tavlaReject(roomId, 'not_in_room');
    const t = room.tavla;
    const expectedColor = player.color === 'white' ? 'w' : 'b';
    if (t.turn !== expectedColor) return tavlaReject(roomId, 'not_your_turn');
    if (!tavlaEngine.undo(t)) return tavlaReject(roomId, 'nothing_to_undo');
    room.lastMove = null;
    emitGameState(room);
  });

  socket.on('tavlaPass', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || room.gameId !== 'tavla' || room.status !== 'playing' || !room.tavla) return;
    const player = tavlaSeatedPlayer(room);
    if (!player) return tavlaReject(roomId, 'not_in_room');
    const t = room.tavla;
    const expectedColor = player.color === 'white' ? 'w' : 'b';
    if (t.turn !== expectedColor) return tavlaReject(roomId, 'not_your_turn');
    if (!t.rolled) return tavlaReject(roomId, 'roll_first');
    if (tavlaEngine.legalSteps(t).length) return tavlaReject(roomId, 'has_legal_move');
    tavlaAdvance(room);
    emitGameState(room);
  });

  socket.on('leaveRoom', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const player = findExistingPlayer(room, socket, socket.userKey);
    const spectator = findExistingSpectator(room, socket, socket.userKey);
    socket.leave(roomId);
    socket.roomId = null;
    socket.role = null;
    if (player) removePlayerFromRoom(room, player, 'Rakip oyundan ayrıldı.');
    else if (spectator) removeSpectator(room, spectator);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    const spectator = (room.spectators || []).find(s => s.id === socket.id);
    if (spectator) {
      removeSpectator(room, spectator);
    }

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

const clockTimer = setInterval(() => {
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    const before = room.status;
    updateClock(room);
    if (before !== room.status) {
      // ANA SÜRE bitti ('timeout'): kimde dolduysa karşı taraf kazanır.
      // Kişiye özel youWon gönderilir — aksi halde "ters mesaj" hatası
      // yaşanıyordu (kazanan "kaybettiniz", kaybeden "kazandınız" görüyordu).
      const state = buildBoardState(room);
      emitGameState(room);
      emitRoom(room);
      const clockWinner = room.result?.winner || null;
      room.players.forEach(p => io.to(p.id).emit('gameEnded', {
        roomId: room.id,
        reason: room.result?.reason || 'timeout',
        winner: clockWinner,
        winnerColor: clockWinner,
        playerColor: p.color,
        youWon: !!clockWinner && p.color === clockWinner,
        gameState: state
      }));
      (room.spectators || []).forEach(s => io.to(s.id).emit('gameEnded', {
        roomId: room.id,
        reason: room.result?.reason || 'timeout',
        winner: clockWinner,
        winnerColor: clockWinner,
        playerColor: null,
        youWon: false,
        isSpectator: true,
        gameState: { ...state, legalMoves: [] }
      }));
      continue;
    }

    // Hamle süresi denetimi: 40. saniyede uyarı, 60. saniyede hükmen mağlubiyet.
    // 'move_timeout' — terk (player_left) ve ana süre (timeout) ile KARIŞTIRILMAZ.
    // Satranç ve tavla için ortak çalışır (sıra turnColorOf üzerinden bulunur).
    if ((room.chess || room.tavla) && room.moveStartedAt) {
      const elapsed = now() - room.moveStartedAt;
      const turnColor = turnColorOf(room);

      if (!room.moveWarned && elapsed >= MOVE_WARN_MS) {
        room.moveWarned = true;
        io.to(room.id).emit('moveTimeWarning', {
          roomId: room.id,
          color: turnColor,
          remainingMs: Math.max(0, MOVE_FORFEIT_MS - elapsed)
        });
      }

      if (elapsed >= MOVE_FORFEIT_MS) {
        room.status = 'finished';
        room.result = { reason: 'move_timeout', winner: turnColor === 'white' ? 'black' : 'white' };
        const state = buildBoardState(room);
        emitGameState(room);
        emitRoom(room);
        const winner = room.result.winner;
        room.players.forEach(p => io.to(p.id).emit('gameEnded', {
          roomId: room.id,
          reason: 'move_timeout',
          winner,
          winnerColor: winner,
          playerColor: p.color,
          youWon: p.color === winner,
          gameState: state
        }));
        (room.spectators || []).forEach(s => io.to(s.id).emit('gameEnded', {
          roomId: room.id,
          reason: 'move_timeout',
          winner,
          winnerColor: winner,
          playerColor: null,
          youWon: false,
          isSpectator: true,
          gameState: { ...state, legalMoves: [] }
        }));
      }
    }
  }
}, 500);
if (typeof clockTimer.unref === 'function') clockTimer.unref();

app.get('/health', (_req, res) => res.json({
  ok: true,
  rooms: rooms.size,
  players: [...rooms.values()].reduce((n, r) => n + r.players.length, 0),
  spectators: [...rooms.values()].reduce((n, r) => n + (r.spectators || []).length, 0)
}));

app.get('/api/rooms', (req, res) => {
  const gameId = String(req.query.gameId || req.query.game_id || 'chess');
  res.json({ ok: true, gameId, rooms: listPublicRooms(gameId) });
});

function start(port) {
  // Kalıcı hazır masalar sunucu ayağa kalkarken oluşturulur.
  seedPresetTables();
  const listenPort = port !== undefined ? port : (process.env.PORT || 3000);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(listenPort, () => {
      const addr = server.address();
      const actual = addr && typeof addr === 'object' ? addr.port : listenPort;
      console.log(`🚀 GameVerse Render sunucusu ${actual} portunda aktif.`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('Sunucu başlatılamadı:', err);
    process.exit(1);
  });
}

module.exports = { app, server, io, rooms, start, listPublicRooms, publicRoom, seedPresetTables, PRESET_TABLES };
