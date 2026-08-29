// GameVerse - Render gerçek zamanlı oyun sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { Chess } = require('chess.js');
const tavlaEngine = require('./tavla-engine');
const pistiEngine = require('./pisti-engine');
const batakEngine = require('./batak-engine');
const damaEngine = require('./dama-engine');
const turkDamaEngine = require('./turkdamasi-engine');
const reversiEngine = require('./reversi-engine');
const gomokuEngine = require('./gomoku-engine');
const { db } = require('./db'); // kurucu paneli: üye listesi + masa ayarları (SQLite, yerel mod)

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
// PWA manifest: Content-Type kesin application/manifest+json olmalı
// (eski default text/plain yerine). Ayrıca static dosyalar cache'ini
// kapat ki deploy sonrası eski manifest.json tarayıcıda kalmasın.
app.get('/manifest.json', (_req, res) => {
  res.set('Content-Type', 'application/manifest+json');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(require('path').join(__dirname, 'manifest.json'));
});
app.use(express.static(__dirname, { setHeaders: (res, path) => {
  if (path.endsWith('.json')) res.set('Content-Type', 'application/json');
  if (path.endsWith('.js')) res.set('Content-Type', 'application/javascript');
}}));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true, methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

const rooms = new Map();

// ---- Üyelik & Sosyal katman (server-auth.js): DB yoksa güvenle devre dışı ----
// emitRoom: kimlik authHello ile sonradan çözülünce (backend soğuk başlangıcı)
// oda kaydının üye alanlarının güncellenmesi gerekir; auth katmanı bunu
// yalnızca DEĞİŞİM anında yayınlar (fonksiyon bildirimi — yukarıda hoist).
let authApi = null;
try {
  authApi = require('./server-auth').installAuth(app, { io, rooms, emitRoom, removePlayerFromRoom });
} catch (e) {
  console.warn('⚠️  server-auth yüklenemedi (üyelik katmanı kapalı):', e.message);
}

const MAX_ROOM_PLAYERS = 2;
// Okey 4 kişilik oynanır; diğerleri ikişer kişilik kalır.
const MAX_PLAYERS_BY_GAME = { okey: 4, okey101: 4, pisti: 4, batak: 4 };
const ONLINE_CARD_GAMES = new Set(['pisti', 'batak']);
const ONLINE_BOARD_GAMES = new Set(['dama','turkdamasi','reversi']);
function maxPlayersFor(gameId) {
  return MAX_PLAYERS_BY_GAME[gameId] || MAX_ROOM_PLAYERS;
}
// 2 kişilik oyunlarda renk atanır (white/black); 4 kişilikte koltuk numarası yeterlidir.
function seatColorFor(room, idx) {
  return maxPlayersFor(room.gameId) > 2 ? null : (idx === 0 ? 'white' : 'black');
}
const MAX_SPECTATORS = 20;
// Terk sonrası oda hemen sıfırlanmaz: kalan oyuncu "Kazandınız" ekranını
// görürken renginin değişmemesi için sonuç bir süre korunur.
const POST_GAME_HOLD_MS = Number(process.env.GV_POST_GAME_HOLD_MS) || 8000;
// Oyun sırasında kopan oyuncuya yeniden bağlanması için tanınan süre (ms).
const RECONNECT_GRACE_MS = 30000;

// ==================== SOHBET (masa içi + genel) ====================
// Kurallar: mesaj GÖNDERMEK üyelere özeldir (misafirler okuyabilir);
// metinler temizlenir, 240 karakterle sınırlanır, soket başına 1 sn hız
// sınırı uygulanır. Geçmiş halka tamponunda tutulur (genel + oda başına).
const CHAT_MAX_LEN = 240;
const CHAT_HISTORY = 50;
const CHAT_RATE_MS = 1000;
// Genel sohbet kuralları: 5 sn bekleme + 1 dk otomatik silinme + link/küfür yasağı.
const CHAT_GLOBAL_RATE_MS = Number(process.env.GV_CHAT_RATE_MS) || 5000;
const CHAT_GLOBAL_TTL_MS = Number(process.env.GV_CHAT_TTL_MS) || 60000;
const chatGlobal = [];            // genel sohbet: son N mesaj

// 1 dakikadan eski genel sohbet mesajlarını düşür (liste zamana göre sıralıdır).
function chatGlobalPrune() {
  const t = now();
  while (chatGlobal.length && t - Number(chatGlobal[0].ts || 0) >= CHAT_GLOBAL_TTL_MS) chatGlobal.shift();
}

// Link paylaşımı engeli: şema, www. ve yaygın alan adı uzantıları.
const CHAT_LINK_RE = /(https?:\/\/|www\.|discord\.gg|[a-z0-9][a-z0-9-]*\.(com|net|org|tr|gg|io|me|xyz|link|site|online|club|tv|app|dev)\b)/i;
function chatHasLink(text) { return CHAT_LINK_RE.test(String(text || '')); }

// Türkçe küfür/argo filtresi (leetspeak + Türkçe harf normalizasyonu).
const CHAT_BAD_EXACT = ['amk', 'aq', 'mk', 'amq', 'oç', 'oc'];
const CHAT_BAD_PREFIX = ['amcık', 'orospu', 'pezevenk', 'piç', 'siktir', 'sikerim', 'sikece', 'yarrak', 'yarak', 'ibne', 'gerizekal', 'dangalak', 'şerefsiz', 'anasın', 'ananı', 'bacını', 'götveren', 'götün', 'yavşak', 'yavsak'];
function chatFold(v) {
  let s = String(v || '').toLocaleLowerCase('tr-TR');
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/ı/g, 'i').replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/@/g, 'a').replace(/\$/g, 's');
  return s.replace(/(.)\1{2,}/g, '$1$1');
}
function chatHasProfanity(text) {
  const s = chatFold(text);
  const tokens = s.split(/[^a-zçşüöği0-9]+/i).filter(Boolean);
  if (tokens.some(t => CHAT_BAD_EXACT.indexOf(t) !== -1)) return true;
  for (const t of tokens) {
    for (const p of CHAT_BAD_PREFIX) { if (t.indexOf(p) === 0) return true; }
  }
  // Harf harf yazma kaçışı ("a q", "s i k t i r"): yan yana tek harfli
  // parçaları birleştirip liste ile karşılaştır (kelime içi yanlış
  // pozitif olmaması için sadece tek-harf zincirleri birleştirilir).
  let run = '';
  for (let i = 0; i <= tokens.length; i++) {
    const t = tokens[i];
    if (t && t.length === 1) { run += t; if (i === tokens.length - 1) t = undefined; else continue; }
    if (run) {
      const r = run; run = '';
      if (CHAT_BAD_EXACT.indexOf(r) !== -1) return true;
      for (const p of CHAT_BAD_PREFIX) { if (r.indexOf(p) === 0) return true; }
    }
  }
  return false;
}
const chatRoomHist = new Map();   // roomId -> son N mesaj

function chatSanitize(v) {
  return String(v == null ? '' : v)
    .replace(/<[^>]*>/g, '')      // HTML etiketleri
    .replace(/[<>'"`]/g, '')  // kalabilecek tehlikeli karakterler
    .replace(/[\u0000-\u001f\u007f]/g, '') // kontrol karakterleri
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CHAT_MAX_LEN);
}
function chatIsMember(socket, payload) {
  if (typeof socket.userKey === 'string' && socket.userKey.startsWith('user:')) return true;
  const k = payload && payload.memberKey;
  return typeof k === 'string' && k.startsWith('user:');
}
function pushChat(roomId, msg) {
  const hist = chatRoomHist.get(roomId) || [];
  hist.push(msg);
  while (hist.length > CHAT_HISTORY) hist.shift();
  chatRoomHist.set(roomId, hist);
}
// Hamle süresi: 40. saniyede uyarı, 60. saniyede (1 dk) hükmen mağlubiyet.
// DİKKAT: bu sayaç YALNIZCA oyun başında ve gerçek bir hamlede sıfırlanır
// (touchMoveTimer). updateClock() içinde sıfırlanırsa saat döngüsü
// (500 ms'de bir) sayacı sürekli başa döndürür ve denetim ölü kod olur.
const MOVE_WARN_MS = Number(process.env.GV_MOVE_WARN_MS) || 40000;
const MOVE_FORFEIT_MS = Number(process.env.GV_MOVE_FORFEIT_MS) || 60000;
// OKEY: tur başına süre (yerel motordaki 30 sn "SIRA" sayacının sunucu
// karşılığı) + art arda sürünceme toleransı (3. strike = diskalifiye).
const OKEY_TURN_MS = Number(process.env.GV_OKEY_TURN_MS) || 30000;
const OKEY_STRIKES_MAX = Number(process.env.GV_OKEY_STRIKES_MAX) || 3;
const OKEY_MAX_ROUNDS = Number(process.env.GV_OKEY_MAX_ROUNDS) || 3;
// Okey 101: maç, bir oyuncu 101 puana ulaşana kadar SÜRSÜR; el limiti sadece
// sonsuz maçı önleyen GÜVENLİK sınırıdır (varsayılan 99 el).
const OKEY101_MAX_ROUNDS = Number(process.env.GV_OKEY101_MAX_ROUNDS) || 99;
const OKEY_ROUND_PAUSE_MS = Number(process.env.GV_OKEY_ROUND_PAUSE_MS) || 4000;
const disconnectTimers = new Map();

// ================== HAZIR MASALAR (YÖNETİCİ AYARLARINA AÇIK) ==================
// Lobide HER ZAMAN görünen kalıcı hazır masalar: 2 kişilik, masanın kendi
// süresi korunur (istemci ne gönderirse göndersin değişmez), boşken de
// listelenir, oyun bitince silinmez — beklemeye alınır.
//
// Kurucu Paneli (yönetici) şunları yapabilir:
//   - oyunu sitede GÖRÜNÜR / GİZLİ yapmak,
//   - hazır masa SAYISINI artırmak/azaltmak,
//   - masa ADLARINI ve TİPLERİNİ değiştirmek.
// Değişiklikler DATAYA kaydedilir (yerel mod: SQLite 'settings' tablosu;
// uzak mod: Yöncü MySQL — admin.php) ve sunucu DA HEMEN uygular. Dolu
// masalar boşalınca uygulanır (oyuncular içinden alınmaz).
//
// Standart hazır masa tipi: 4x Hızlı (10 dk) + 3x Normal (15 dk) +
// 3x Düşünen (20 dk) = 10 masa. ID aralıkları (sabit, indeks bazlı):
// satranç 101, tavla 201, okey 301 (sabit 18), damas 401, turkdamas 501,
// reversi 601, gomoku 701, connect4 801, bilardo 921.
const ADMIN_EMAIL = (process.env.GV_ADMIN_EMAIL || 'kurucu@kurucu.com').toLowerCase();
const ALL_GAMES = ['chess', 'tavla', 'okey', 'okey101', 'pisti', 'batak',
  'dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo'];

const PRESET_TYPES = [
  ...Array(4).fill({ type: 'fast', label: '⚡ Hızlı', durationMinutes: 10 }),
  ...Array(3).fill({ type: 'normal', label: '♟️ Normal', durationMinutes: 15 }),
  ...Array(3).fill({ type: 'thinker', label: '🧠 Düşünen', durationMinutes: 20 })
];

// Standart (10 masa) hazır masa açan oyunlar + sabit ID tabanları:
const PRESET_GAME_BASES = {
  chess: 101, tavla: 201, pisti: 341, batak: 361,
  // bilardo 921: 901-910 aralığı okey test süitinin oda kimlikleriyle
  // çakışmasın diye atlandı.
  dama: 401, turkdamasi: 501, reversi: 601, gomoku: 701, connect4: 801, bilardo: 921
};
const STANDARD_PRESET_GAMES = Object.keys(PRESET_GAME_BASES);
// Hazır masası SABİT olan oyunlar (panel yalnızca görünürlük yönetir):
const FIXED_PRESET_GAMES = ['okey', 'okey101'];

function clampDuration(v, dflt) {
  const n = Math.floor(Number(v));
  return (Number.isFinite(n) && n >= 1 && n <= 240) ? n : (dflt || 10);
}

// Bir oyunun VARSAYILAN 10 masası (isim + tip + süre):
function defaultTablesFor(gameId) {
  const base = PRESET_GAME_BASES[gameId];
  const out = [];
  for (const t of PRESET_TYPES) {
    out.push({ name: `${t.label} Masa #${base + out.length}`, type: t.type, durationMinutes: t.durationMinutes });
  }
  return out;
}

function defaultPresetConfig() {
  const cfg = {};
  for (const g of STANDARD_PRESET_GAMES) cfg[g] = { visible: true, tables: defaultTablesFor(g) };
  for (const g of FIXED_PRESET_GAMES) cfg[g] = { visible: true };
  // Kart oyunları güvenli varsayılan: online kapalı; kurucu açınca seed edilir.
  cfg.pisti = { visible: true, online: false, tables: [] };
  cfg.batak = { visible: true, online: false, tables: [] };
  // Görünürlüğü yönetilen diğer oyunlar (hazır masaları yok, sitede görünür):
  for (const g of ALL_GAMES) if (!cfg[g]) cfg[g] = { visible: true };
  return cfg;
}

// Ham ayarları (panel/DB'den gelen) varsayılanlarla birleştirip temizle:
function normPresetConfig(raw) {
  const cfg = defaultPresetConfig();
  if (!raw || typeof raw !== 'object') return cfg;
  for (const g of ALL_GAMES) {
    const src = raw[g];
    if (!src || typeof src !== 'object') continue;
    if (typeof src.visible === 'boolean') cfg[g].visible = src.visible;
    if (typeof src.online === 'boolean') cfg[g].online = src.online;
    if (STANDARD_PRESET_GAMES.includes(g) && Array.isArray(src.tables)) {
      const base = PRESET_GAME_BASES[g];
      const dflt = defaultTablesFor(g);
      const t = src.tables.slice(0, 30).map((x, i) => {
        const d = dflt[i] || { name: `Masa #${base + i}`, type: 'normal', durationMinutes: 15 };
        x = x && typeof x === 'object' ? x : {};
        return {
          name: String(x.name || d.name).slice(0, 60),
          type: (x.type === 'fast' || x.type === 'thinker') ? x.type : 'normal',
          durationMinutes: clampDuration(x.durationMinutes, d.durationMinutes)
        };
      });
      if (t.length) cfg[g].tables = t;
    }
  }
  return cfg;
}

// ---- Geçerli hazır-masa yapılandırması (bellek) ----
let presetConfig = defaultPresetConfig();

function gameVisible(id) {
  const c = presetConfig[id];
  return !c || c.visible !== false;
}

// Yapılandırma → somut hazır masa listesi:
function cardPresetTables(gameId, startId) {
  const out=[]; let id=startId;
  const combos=gameId==='pisti' ? [[2,1],[2,3],[2,5],[3,1],[3,3],[3,5],[4,1],[4,3],[4,5]] : [[4,3],[4,5],[4,7]];
  for (const [players, rounds] of combos) for(let n=0;n<2;n++){const rid=String(id++);out.push({id:rid,gameId,maxPlayers:players,durationMinutes:rounds===1?10:rounds===3?15:20,rounds,name:`${players} Kişilik • ${rounds} El — Masa #${rid}`});}
  return out;
}
function presetTablesFromConfig(cfg) {
  const out = [];
  for (const g of STANDARD_PRESET_GAMES) {
    const gc = cfg[g] || {};
    if (gc.visible === false) continue;
    if ((g === 'pisti' || g === 'batak') && gc.online !== true) continue;
    if (g === 'pisti' || g === 'batak') { out.push(...cardPresetTables(g, g === 'pisti' ? 341 : 361)); continue; }
    const base = PRESET_GAME_BASES[g];
    (gc.tables && gc.tables.length ? gc.tables : defaultTablesFor(g)).forEach((t, i) => {
      out.push({
        id: String(base + i),
        gameId: g,
        maxPlayers: g === 'batak' ? 4 : (g === 'pisti' ? 2 : 2),
        rounds: (g === 'pisti' ? [1,3,5][i % 3] : undefined),
        durationMinutes: clampDuration(t.durationMinutes, 10),
        name: String(t.name || `Masa #${base + i}`).slice(0, 60)
      });
    });
  }
  // Okey: sabit 18 masa (yapı değişmez, görünürlük yönetilir):
  if ((cfg.okey || {}).visible !== false && (okeyEngine || process.env.GV_OKEY_PRESETS === '1')) {
    out.push(...okeyPresetTables(301));
  }
  // Okey 101: sabit 6 masa (aynı mekanizma, #331-#336):
  if ((cfg.okey101 || {}).visible !== false && (okeyEngine || process.env.GV_OKEY_PRESETS === '1')) {
    out.push(...okey101PresetTables(331));
  }
  return out;
}
// OKEY: yetkili sunucu motoru (okey-engine.js) bu repoya eklendiği anda masalar
// OTOMATIK açılır; ayrıca GV_OKEY_PRESETS=1 ile önden test edilebilir.
// (Motor yokken masalar tohumlanmaz: kimse hazır basıp takılı kalmaz.)
let okeyEngine = null;
try { okeyEngine = require('./okey-engine.js'); } catch (_) { /* motor henüz yok */ }

// OKEY hazır masaları: (2/3/4 kişilik) × (3/5/7 el), her kombinasyondan
// 2 masa = 18 masa. El sayısını üye masa kurarken seçebilir; hazır masalarda
// el sayısı arttıkça koltuk başına ana süre uzar: 3 el→10 dk, 5 el→15 dk,
// 7 el→20 dk. Kimlikler ardıl: #301-#318 (2k=301-306, 3k=307-312, 4k=313-318).
const OKEY_ROUNDS_DURATION = { 3: 10, 5: 15, 7: 20 };
function okeyPresetTables(startId) {
  const out = [];
  let id = startId;
  for (const players of [2, 3, 4]) {
    for (const rounds of [3, 5, 7]) {
      for (let k = 0; k < 2; k++) {
        const rid = String(id++);
        out.push({
          id: rid,
          gameId: 'okey',
          maxPlayers: players,
          durationMinutes: OKEY_ROUNDS_DURATION[rounds] || 10,
          rounds,
          name: `${players} Kişilik • ${rounds} El — Masa #${rid}`
        });
      }
    }
  }
  return out;
}
// OKEY 101 hazır masaları: (2/3/4 kişilik) × (10/20 dk) = 6 masa. El sayısı
// 101'de ANLAM TAŞIMAZ (maç, bir oyuncu 101 puana ulaşana kadar sürer);
// koltuk başına ana süre masa süresinden gelir. Kimlikler ardıl: #331-#336
// (okey 301-318 aralığından bağımsız).
function okey101PresetTables(startId) {
  const out = [];
  let id = startId;
  for (const players of [2, 3, 4]) {
    for (const dur of [10, 20]) {
      const rid = String(id++);
      out.push({
        id: rid,
        gameId: 'okey101',
        maxPlayers: players,
        durationMinutes: dur,
        name: `${players} Kişilik • ${dur} dk — Masa #${rid}`
      });
    }
  }
  return out;
}

// Sunucu ayağa kalkarken: yapılandırmadaki hazır masaları oluştur.
function seedPresetTables() {
  for (const t of presetTablesFromConfig(presetConfig)) {
    const existing = rooms.get(t.id);
    if (existing) {
      existing.isPreset = true;
      continue;
    }
    const room = createRoom(t.id, t.gameId, t.maxPlayers || 2, t.durationMinutes, { name: t.name, rounds: t.rounds });
    room.isPreset = true;
  }
}

// Kurucu Paneli değişikliklerini CANLI uygula:
//  - eksik hazır masaları oluştur,
//  - BOŞ hazır masalarda isim/tip/süre güncelle,
//  - yapılandırmada kalmayan BOŞ hazır masaları kaldır,
//  - okey görünürlüğünü uygula (gizle → boş okey masaları kalkar).
// Dolu (oyunculu) masalara dokunulmaz; değişiklik boşalınca oturur.
function applyPresetConfig(raw) {
  presetConfig = normPresetConfig(raw);
  const desired = presetTablesFromConfig(presetConfig);
  const desiredIds = new Set(desired.map(t => t.id));
  const touchedGames = new Set();

  for (const t of desired) {
    const existing = rooms.get(t.id);
    if (!existing) {
      const room = createRoom(t.id, t.gameId, t.maxPlayers || 2, t.durationMinutes, { name: t.name, rounds: t.rounds });
      room.isPreset = true;
      touchedGames.add(t.gameId);
    } else if (existing.players.length === 0 && !(existing.spectators || []).length) {
      if (existing.name !== t.name) { existing.name = t.name; touchedGames.add(t.gameId); }
      if (existing.durationMinutes !== t.durationMinutes) {
        existing.durationMinutes = t.durationMinutes;
        existing.whiteTimeMs = t.durationMinutes * 60 * 1000;
        existing.blackTimeMs = t.durationMinutes * 60 * 1000;
        touchedGames.add(t.gameId);
      }
    }
  }
  // Yapılandırmada olmayan BOŞ hazır odaları gerçekten kaldır:
  for (const room of [...rooms.values()]) {
    if (!room.isPreset) continue;
    if (room.gameId === 'okey' || room.gameId === 'okey101') continue; // görünürlük aşağıda, yapı sabit
    if (desiredIds.has(room.id)) continue;
    if (room.players.length === 0 && !(room.spectators || []).length) {
      removePresetRoom(room);
      touchedGames.add(room.gameId);
    }
  }
  // Okey görünürlüğü: gizle → boş okey masaları kalkar; görünür + motor var →
  // eksikler tamamlanır.
  const okeyVisible = (presetConfig.okey || {}).visible !== false;
  if (!okeyVisible) {
    for (const room of [...rooms.values()]) {
      if (!room.isPreset || room.gameId !== 'okey') continue;
      if (room.players.length === 0 && !(room.spectators || []).length) {
        removePresetRoom(room);
        touchedGames.add('okey');
      }
    }
  } else if (okeyEngine || process.env.GV_OKEY_PRESETS === '1') {
    for (const t of okeyPresetTables(301)) {
      if (!rooms.get(t.id)) {
        const room = createRoom(t.id, 'okey', t.maxPlayers, t.durationMinutes, { name: t.name, rounds: t.rounds });
        room.isPreset = true;
        touchedGames.add('okey');
      }
    }
  }
  // Okey 101 görünürlüğü: aynı mekanizma (gizle → boş 101 masaları kalkar;
  // görünür + motor var → eksikler tamamlanır).
  const okey101Visible = (presetConfig.okey101 || {}).visible !== false;
  if (!okey101Visible) {
    for (const room of [...rooms.values()]) {
      if (!room.isPreset || room.gameId !== 'okey101') continue;
      if (room.players.length === 0 && !(room.spectators || []).length) {
        removePresetRoom(room);
        touchedGames.add('okey101');
      }
    }
  } else if (okeyEngine || process.env.GV_OKEY_PRESETS === '1') {
    for (const t of okey101PresetTables(331)) {
      if (!rooms.get(t.id)) {
        const room = createRoom(t.id, 'okey101', t.maxPlayers, t.durationMinutes, { name: t.name });
        room.isPreset = true;
        touchedGames.add('okey101');
      }
    }
  }
  touchedGames.forEach(g => emitLobby(g));
  return presetConfig;
}

// Boş hazır odayı GERÇEKTEN kaldır (preset beklemeye alınmaz; lobide kalkar).
function removePresetRoom(room) {
  if (!room) return;
  cancelRoomReset(room);
  chatRoomHist.delete(room.id);
  (room.spectators || []).forEach(spec => {
    io.to(spec.id).emit('roomClosed', { roomId: room.id, message: 'Masa kaldırıldı.' });
  });
  rooms.delete(room.id);
  console.log(`[ODA #${room.id}] hazır masa kaldırıldı (yönetici ayarı).`);
  emitLobby(room.gameId);
}

// Yerel mod: ayarları SQLite'tan oku:
function loadPresetConfigLocal() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE skey = 'table_settings'").get();
    if (row && row.value) {
      const d = JSON.parse(row.value);
      if (d && typeof d === 'object') presetConfig = normPresetConfig(d);
    }
  } catch (e) { console.warn('⚠️  Masa ayarları okunamadı (varsayılanlar kullanılıyor):', e.message); }
}
function savePresetConfigLocal() {
  if (!db) return;
  try {
    db.prepare("INSERT INTO settings(skey, value, updated_at) VALUES('table_settings', ?, ?) " +
      "ON CONFLICT(skey) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(JSON.stringify(presetConfig), Date.now());
  } catch (e) { console.warn('⚠️  Masa ayarları kaydedilemedi:', e.message); }
}

// Uzak mod: kurucunun Yöncü MySQL'deki ayarlarını EN GÜÇLÜ HÂLDE dene
// (X-GV-Key ile). DDoS koruması engelliyorsa sessizce varsayılanlar kalır;
// kurucu panelden "Kaydet ve Uygula" dediğinde Render CANLI güncellenir.
async function loadPresetConfigRemote() {
  try {
    const base = (process.env.GV_AUTH_API || '').replace(/\/+$/, '');
    if (!base) return;
    const r = await fetch(base + '/admin.php?action=gamesGet', {
      headers: { 'X-GV-Key': process.env.GV_SERVER_KEY || '' },
      signal: AbortSignal.timeout(4000)
    });
    const d = await r.json();
    if (d && d.ok && d.settings) {
      presetConfig = normPresetConfig(d.settings);
      console.log('🎛️  Masa ayarları Yöncü\'den yüklendi.');
    }
  } catch (_) {
    console.log('ℹ️  Masa ayarları Yöncü\'den alınamadı (DDoS/timeout) — varsayılanlar kullanılıyor.');
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
    maxPlayers: Math.max(2, Math.min(Number(maxPlayers) || 2, maxPlayersFor(gameId))),
    durationMinutes: duration,
    // Okey: oda bazlı maç el sayısı (yoksa OKEY_MAX_ROUNDS varsayımı).
    // Masayı kuranın seçimi (3/5/7 el); 1-99 arası kabul edilir.
    cardRounds: (() => { const r = Math.floor(Number(meta.rounds)); return (gameId === 'pisti' && [1,3,5].includes(r)) ? r : undefined; })(),
    okeyMaxRounds: (() => {
      const r = Math.floor(Number(meta.rounds));
      return (r >= 1 && r <= 99) ? r : undefined;
    })(),
    players: [],
    spectators: [],
    status: 'waiting',
    isPreset: false,
    // Özel oda davet hakları: bir davet = bir giriş hakkı. Kurucu yeni davet
    // gönderdiğinde kickBan'daki oyuncu tekrar girme hakkı kazanır.
    invited: new Map(),   // userId -> {ts}
    kickBan: new Set(),   // masadan atılan userId'ler (yeniden davet edilene kadar)
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
  room.cardGame = null;
  room.dama = null;
  room.reversi = null;
  room.gomoku = null;
  room.tavlaNotice = null;
  room.tavlaNoticeSeq = 0;
  if (room.okey && room.okey.between) { clearTimeout(room.okey.between); }
  room.okey = null; // okey el/maç durumu tamamen temizlenir
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
      p.color = seatColorFor(room, idx);
      p.seat = idx;
    });
  }
  // Davet hakları MASAYA aittir, maça değil: masa beklemeye döndüğünde (oyuncu
  // ayrıldı/atıldı ya da maç bitip rövanş kuruldu) cevaplanmamış davetler CANLI
  // kalır. Davetlinin giriş hakkı yalnız şu yollarla kapanır: kurucu onu atar
  // (kickBan), masa kapanır ya da oyun başlar (join anındaki 'stale'/'full'
  // denetimleri). Atılanlar (kickBan) ÖZELLİKLE korunur: yeniden davet edilmeden
  // giremezler. (Aksi halde bir oyuncuyu atmak DİĞER davetlilerin hakkını da
  // silerdi — removePlayerFromRoom bekleyen masada bile buradan geçer.)
  // invited haritasına bilinçli olarak dokunulmaz.
}

function publicPlayer(p) {
  return {
    id: p.id,
    userKey: p.userKey,
    uid: p.userId || null,
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
    readyCount: room.players.filter(p => p.isReady).length,
    // Özel masayı kuran ÜYE (davet yetkisi istemcide de gösterilsin diye)
    creatorId: room.creatorId || null,
    // Okey masaları: maç el sayısı (lobi "🀄 X El" rozeti basar)
    rounds: room.okeyMaxRounds || (room.gameId === 'pisti' ? room.cardRounds : null)
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
    playerList: room.players.map(p => ({ name: p.name, isReady: !!p.isReady, color: p.color, uid: p.userId || null })),
    spectatorCount: spectators.length,
    status: room.status,
    isPrivate: !!room.isPrivate,
    duration: room.durationMinutes,
    durationMinutes: room.durationMinutes,
    // Okey masaları: maç el sayısı (lobi "🀄 X El" rozeti basar)
    rounds: room.okeyMaxRounds || (room.gameId === 'pisti' ? room.cardRounds : null)
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

function gomokuState(room, seat) { const g=room.gomoku; return {kind:'gomoku',status:room.status,turn:g.turn,winner:g.winner,board:g.board.map(x=>x.slice()),seat,playerColor:seat===0?'b':'w',moves:g.moves,result:g.result||null}; }
function emitGomokuState(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:gomokuState(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:gomokuState(room,null),isSpectator:true}));}
function startGomoku(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.gomoku=gomokuEngine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?'b':'w',players:publicRoom(room).players,gameState:gomokuState(room,p.seat)}));emitGomokuState(room);}
function reversiState(room, seat) { const r=room.reversi; return {kind:'reversi',status:room.status,turn:r.turn,winner:r.winner,board:r.board.map(x=>x.slice()),seat,playerColor:seat===0?'b':'w',legalMoves:seat===null?[]:r.turn===(seat===0?'b':'w')?reversiEngine.legalMoves(r):[],result:r.result||null}; }
function emitReversiState(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:reversiState(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:reversiState(room,null),isSpectator:true}));}
function startReversi(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.reversi=reversiEngine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?'b':'w',players:publicRoom(room).players,gameState:reversiState(room,p.seat)}));emitReversiState(room);}
function damaState(room, seat) { const d=room.dama; const isTurk=room.gameId==='turkdamasi'; const engine=isTurk?turkDamaEngine:damaEngine; const color=seat===0?(isTurk?'w':'r'):(isTurk?'b':'b'); return {kind:room.gameId,status:room.status,turn:d.turn,winner:d.winner,board:d.board.map(r=>r.slice()),captures:{...d.captures},seat,playerColor:color,legalMoves:seat===null?[]:d.turn===color?engine.allMoves(d):[]}; }
function emitDamaState(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:damaState(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:damaState(room,null),isSpectator:true}));}
function startDama(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.dama=room.gameId==='turkdamasi'?turkDamaEngine.init():damaEngine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?(room.gameId==='turkdamasi'?'w':'r'):'b',players:publicRoom(room).players,gameState:damaState(room,p.seat)}));emitDamaState(room);}

function cardGameState(room, forSeat) {
  const st = room.cardGame;
  if (!st) return null;
  const isPisti = room.gameId === 'pisti';
  const hands = isPisti ? st.hands.map((h,i)=>i===forSeat?h.length:h.length) : st.hands.map(h=>h.length);
  return { kind: room.gameId, status: room.status, phase: st.phase || 'play', turn: st.turn,
    hand: forSeat == null ? [] : (st.hands[forSeat] || []).slice(), handCounts: hands,
    center: (st.center || []).slice(), trick: (st.trick || []).slice(), captures: st.captures ? st.captures.map(x=>x.length) : [],
    scores: (st.scores || []).slice(), bids: st.bids ? st.bids.slice() : [], trump: st.trump,
    deckCount: st.deck ? st.deck.length : 0, tricks: st.tricks ? st.tricks.slice() : [], result: st.result || null
  };
}
function emitCardState(room, event='gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, { roomId: room.id, seat:p.seat, gameState:cardGameState(room,p.seat), isSpectator:false }));
  (room.spectators||[]).forEach(p => emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:cardGameState(room,null),isSpectator:true}));
}
function startCardGame(room) {
  if (room.status==='playing' || room.players.length!==room.maxPlayers || !room.players.every(p=>p.isReady)) return;
  room.status='playing'; room.result=null; room.cardGame=room.gameId==='pisti' ? pistiEngine.init(room.maxPlayers, room.cardRounds||1) : batakEngine.init();
  room.turnStartedAt=now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:null,isSpectator:false,players:publicRoom(room).players,gameState:cardGameState(room,p.seat)}));
  emitCardState(room);
}

// Oyun türüne göre doğru durum üreticisini seç (satranç / tavla).
function buildBoardState(room, opts) {
  if (room.chess) return buildChessState(room, opts);
  if (room.tavla) return buildTavlaState(room, opts);
  if (room.cardGame) return cardGameState(room, opts && opts.seat);
  if (room.dama) return damaState(room, opts && opts.seat);
  if (room.reversi) return reversiState(room, opts && opts.seat);
  if (room.gomoku) return gomokuState(room, opts && opts.seat);
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
  if (room && room.status === 'playing' && room.okey) {
    emitToPlayer({ id: socketId }, 'gameStarted', {
      roomId: room.id,
      seat: player ? player.seat : null,
      playerColor: null,
      isSpectator: !player,
      players: publicRoom(room).players,
      gameState: buildOkeyState(room, player ? player.seat : null)
    });
    emitToPlayer({ id: socketId }, 'gameStateUpdated', {
      roomId: room.id,
      seat: player ? player.seat : null,
      playerColor: null,
      isSpectator: !player,
      gameState: buildOkeyState(room, player ? player.seat : null)
    });
    return;
  }
  if (room && room.status === 'playing' && room.gomoku) { const p=player?player.seat:null; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:gomokuState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:gomokuState(room,p)}); return; }
  if (room && room.status === 'playing' && room.reversi) { const p=player?player.seat:null; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:reversiState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:reversiState(room,p)}); return; }
  if (room && room.status === 'playing' && room.dama) { const p=player?player.seat:null; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:damaState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:damaState(room,p)}); return; }
  if (room && room.status === 'playing' && room.cardGame) { const p = player ? player.seat : null; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:cardGameState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:cardGameState(room,p)}); return; }
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
  cancelRoomReset(room); // yeni oyun başlıyor; bekleyen sıfırlama iptal

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
  cancelRoomReset(room); // yeni oyun başlıyor; bekleyen sıfırlama iptal

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
  if (ONLINE_CARD_GAMES.has(room.gameId)) return startCardGame(room);
  if (room.gameId === 'reversi') return startReversi(room);
  if (room.gameId === 'gomoku') return startGomoku(room);
  if (ONLINE_BOARD_GAMES.has(room.gameId)) return startDama(room);
  // Okey motoru (okey-engine.js + startOkey) entegre edildiğinde devreye girer.
  // 'okey101' aynı motordan, varyant bayrağıyla oynanır (101 puan hedefi).
  if ((room.gameId === 'okey' || room.gameId === 'okey101') && typeof startOkey === 'function') return startOkey(room);
}

// ============== OKEY (2/3/4 kişilik, sunucu yetkili; el sayısı odadan) ==============
// 'okey'  : klasik — kazanan her elde +1 skor; maç, oda el limitinde biter.
// 'okey101': kalan 14 taşın toplamı 101 puana ulaşan el kazanır; kazanan
//            diğer oyuncuların kalan el puanını SKORA ekler (gained). Maç,
//            bir oyuncu 101 puana ulaşana kadar sürer (OKEY101_MAX_ROUNDS
//            güvenlik sınırı).
function startOkey(room) {
  if (!okeyEngine) return; // çağıran zaten kontrol eder; güvence
  if (room.status === 'playing') return;
  if (room.players.length !== room.maxPlayers || !room.players.every(p => p.isReady)) return;
  cancelRoomReset(room);

  room.status = 'playing';
  room.result = null;
  room.lastMove = null;
  const variant = room.gameId === 'okey101' ? 'okey101' : 'standard';
  const seats = room.players.map(p => p.seat).sort((a, b) => a - b);
  const scores = Object.fromEntries(seats.map(s => [s, 0]));
  room.okey = {
    variant,
    roundState: okeyEngine.startRound(1, seats, scores, undefined, undefined, variant),
    currentRound: 1,
    // Okey 101'de el limiti kullanılmaz (maç 101 puanda biter); standartta
    // oda bazlı el sayısı (masayı kuran / hazır masa tanımı belirler).
    maxRounds: variant === 'okey101' ? OKEY101_MAX_ROUNDS : (room.okeyMaxRounds || OKEY_MAX_ROUNDS),
    // Koltuk başına ANA süre (masa süresi 10/15/20 dk, herkesinki ayrı).
    clockMs: Object.fromEntries(seats.map(s => [s, room.durationMinutes * 60 * 1000])),
    clockStartedAt: now(),
    turnDeadlineMs: OKEY_TURN_MS,
    turnStartedAt: now(),
    strikes: Object.fromEntries(seats.map(s => [s, 0])),
    between: null   // eller arası bekleme zamanlayıcısı
  };
  touchMoveTimer(room);
  emitRoom(room);
  emitOkeyState(room, 'gameStarted');
}

// Herkese KİŞİYE ÖZEL okey durumu gönderilir (kendi eli açık, rakiplerin
// elleri gizli; atıklar ve gösterge herkese açık).
function buildOkeyState(room, forSeat) {
  const ok = room.okey;
  const st8 = ok.roundState;
  const publicHands = {};
  for (const seat of st8.seats) {
    publicHands[seat] = st8.hands[seat].length;
  }
  const state = {
    kind: 'okey',
    // İstemci varyantı (Kontrol/101 hedefi) buradan öğrenir:
    // 'standard' = klasik per/çift bitiş, 'okey101' = 14 taş toplamı ≥ target.
    variant: st8.variant || (ok.variant || 'standard'),
    target: st8.target != null ? st8.target : (st8.variant === 'okey101' ? (okeyEngine.OKEY101_TARGET || 101) : null),
    status: room.status,
    round: ok.currentRound,
    maxRounds: ok.maxRounds,
    seats: st8.seats,
    turn: st8.turn,
    starter: st8.starter,
    phase: st8.phase,
    deckCount: st8.deck.length,
    indicator: st8.indicator,
    realOkey: st8.realOkey,
    handCounts: publicHands,
    discardPiles: Object.fromEntries(st8.seats.map(x => [x, (st8.discardPiles[x] || []).slice()])),
    scores: Object.assign({}, ok.roundState.scores, {}),
    strikes: Object.assign({}, ok.strikes),
    clockMs: room.status === 'playing' ? okeyLiveClocks(room) : Object.assign({}, ok.clockMs),
    turnRemainingMs: Math.max(0, ok.turnDeadlineMs - (now() - ok.turnStartedAt)),
    players: room.players.map(p => ({ seat: p.seat, name: p.name, isReady: !!p.isReady })),
    serverNow: now(),
    finished: st8.finished,
    result: st8.result,
    matchResult: room.result || null
  };
  // Kendi eli yalnızca sahibine gider.
  if (forSeat !== null && forSeat !== undefined && st8.hands[forSeat]) {
    state.mySeat = forSeat;
    state.myHand = st8.hands[forSeat].slice();
  } else {
    state.mySeat = null;
    state.myHand = null;
  }
  return state;
}

function okeyLiveClocks(room) {
  // Tur oyuncusunun ana saati canlı azalır; diğerleri durur.
  const ok = room.okey;
  const clocks = Object.assign({}, ok.clockMs);
  if (room.status === 'playing' && ok.clockStartedAt && !ok.between) {
    const elapsed = Math.max(0, now() - ok.clockStartedAt);
    const t = ok.roundState.turn;
    clocks[t] = Math.max(0, (clocks[t] || 0) - elapsed);
  }
  return clocks;
}

function emitOkeyState(room, event) {
  const evt = event || 'gameStateUpdated';
  room.players.forEach(player => {
    emitToPlayer(player, evt, {
      roomId: room.id,
      seat: player.seat,
      playerColor: null,
      isSpectator: false,
      players: publicRoom(room).players,
      gameState: buildOkeyState(room, player.seat)
    });
  });
  (room.spectators || []).forEach(spec => {
    emitToPlayer(spec, evt, {
      roomId: room.id,
      seat: null,
      playerColor: null,
      isSpectator: true,
      players: publicRoom(room).players,
      gameState: buildOkeyState(room, null)
    });
  });
}

// Tur sahibi değişince çağrılır: ana saat muhasebesi + tur sayacı sıfırlanır.
function okeyAdvanceClock(room) {
  const ok = room.okey;
  if (!ok || room.status !== 'playing' || ok.between) return;
  const t = ok.roundState.turn;
  if (ok.clockStartedAt) {
    const elapsed = Math.max(0, now() - ok.clockStartedAt);
    ok.clockMs[t] = Math.max(0, (ok.clockMs[t] || 0) - elapsed);
  }
  ok.clockStartedAt = now();
  ok.turnStartedAt = now();
  touchMoveTimer(room);
}

function okeyName(room, seat) {
  const p = room.players.find(x => x.seat === seat);
  return p ? p.name : ('Koltuk ' + (seat + 1));
}

function okeyLeaderAmong(room, excludedSeat) {
  // Kalan oyuncular arasından en yüksek skorlu; eşitlikte daha düşük koltuk.
  const scores = room.okey?.roundState?.scores || {};
  let best = null;
  room.players.forEach(p => {
    if (excludedSeat !== null && excludedSeat !== undefined && p.seat === excludedSeat) return;
    const sc = scores[p.seat] || 0;
    if (!best || sc > best.score) best = { seat: p.seat, score: sc, name: p.name };
  });
  return best;
}

// Maç bitişi (herhangi bir neden): kazananı belirler, herkese kişiye özel
// sonuç gönderir, odayı evrensel sıfırlayıcıya havale eder (takılmaz).
function endOkeyMatch(room, reason, loserSeat) {
  const ok = room.okey;
  if (!ok || room.status !== 'playing') return;
  if (ok.between) { clearTimeout(ok.between); ok.between = null; }
  room.status = 'finished';
  const leader = okeyLeaderAmong(room, (reason === 'player_left' || reason === 'timeout' || reason === 'disqualified') ? loserSeat : null);
  room.result = {
    reason,
    winner: leader ? leader.seat : null,
    winnerSeat: leader ? leader.seat : null,
    winnerName: leader ? leader.name : null
  };
  room.players.forEach(p => {
    emitToPlayer(p, 'gameEnded', {
      roomId: room.id,
      reason,
      winner: room.result.winner,
      winnerSeat: room.result.winnerSeat,
      winnerName: room.result.winnerName,
      loserSeat: loserSeat ?? null,
      seat: p.seat,
      youWon: leader ? p.seat === leader.seat : false,
      isSpectator: false,
      gameState: buildOkeyState(room, p.seat)
    });
  });
  (room.spectators || []).forEach(spec => {
    emitToPlayer(spec, 'gameEnded', {
      roomId: room.id,
      reason,
      winner: room.result.winner,
      winnerSeat: room.result.winnerSeat,
      winnerName: room.result.winnerName,
      loserSeat: loserSeat ?? null,
      seat: null,
      youWon: false,
      isSpectator: true,
      gameState: buildOkeyState(room, null)
    });
  });
  emitRoom(room);
  scheduleRoomReset(room);
}

// El bitişi (bir oyuncu ortaya bitirdi veya deste bitti).
function okeyRoundFinished(room) {
  const ok = room.okey;
  if (!ok || !ok.roundState.finished || ok.between) return;
  okeyAdvanceClock(room); // açık saati kapat
  const is101 = (ok.roundState.variant || ok.variant) === 'okey101';
  const res = ok.roundState.result || { winner: null, winType: 'draw' };
  if (res.winner !== null && res.winner !== undefined) {
    if (!is101) {
      ok.roundState.scores[res.winner] = (ok.roundState.scores[res.winner] || 0) + 1;
    }
    // okey101: motor finish() içinde kazananın skoruna diğerlerinin kalan
    // el puanını (gained) ZATEN ekledi — burada tekrar sayma.
  }
  // MAÇ SONU:
  //  - standart : el limiti (masa tanımı / OKEY_MAX_ROUNDS)
  //  - okey101  : bir oyuncu 101 puana ulaştı (veya güvenlik el limiti)
  let matchOver;
  if (is101) {
    const target = okeyEngine.OKEY101_TARGET || 101;
    const someoneReached = Object.keys(ok.roundState.scores).some(
      s => (ok.roundState.scores[s] || 0) >= target);
    matchOver = someoneReached || ok.currentRound >= ok.maxRounds;
  } else {
    matchOver = ok.currentRound >= ok.maxRounds;
  }
  emitOkeyState(room, 'okeyRoundEnded');

  if (matchOver) {
    endOkeyMatch(room, 'completed', null);
    return;
  }
  ok.between = setTimeout(() => {
    ok.between = null;
    if (room.status !== 'playing') return; // arada maç bitmişse
    if (room.players.length !== room.maxPlayers) { endOkeyMatch(room, 'player_left', null); return; }
    ok.currentRound += 1;
    // Varyant KORUNUR: okey101 masasında 2. el de 101 varyantıyla kurulur.
    ok.roundState = okeyEngine.startRound(ok.currentRound, ok.roundState.seats, ok.roundState.scores,
      undefined, undefined, ok.roundState.variant || ok.variant);
    ok.clockStartedAt = now();
    ok.turnStartedAt = now();
    touchMoveTimer(room);
    emitRoom(room);
    emitOkeyState(room);
  }, OKEY_ROUND_PAUSE_MS);
}

// 500 ms'lik saat döngüsü her 'playing' okey odası için çağrılır.
function okeyClockTick(room) {
  const ok = room.okey;
  if (!ok || room.status !== 'playing' || ok.between) return;

  // 1) ANA SAAT: tur sahibinin süresi dolduysa diskalifiye.
  const elapsed = Math.max(0, now() - ok.clockStartedAt);
  const turnSeat = ok.roundState.turn;
  const remain = (ok.clockMs[turnSeat] || 0) - elapsed;
  if (remain <= 0) {
    endOkeyMatch(room, 'timeout', turnSeat);
    return;
  }

  // 2) TUR SAYACI (SIRA): dolunca otomatik eylem + strike.
  const turnElapsed = now() - ok.turnStartedAt;
  if (turnElapsed >= ok.turnDeadlineMs) {
    ok.strikes[turnSeat] = (ok.strikes[turnSeat] || 0) + 1;
    if (ok.strikes[turnSeat] >= OKEY_STRIKES_MAX) {
      endOkeyMatch(room, 'disqualified', turnSeat);
      return;
    }
    // Otomatik oyna: çekme aşamasındaysa desteden çek; sonra okey OLMAYAN
    // ilk taşı at (yoksa ilk taşı).
    if (ok.roundState.phase === 'draw') {
      const r = okeyEngine.drawFromDeck(ok.roundState, turnSeat);
      if (r.ok && r.deckEmpty) { okeyRoundFinished(room); return; }
    }
    ok.clockStartedAt = now(); // çekim süresini tur sahibine yazdık
    const hand = ok.roundState.hands[turnSeat] || [];
    const nonOkey = hand.find(t => !okeyEngine.isRealOkeyTile(t, ok.roundState.realOkey));
    const tile = nonOkey || hand[0];
    if (tile) okeyEngine.discard(ok.roundState, turnSeat, tile.id);
    ok.turnStartedAt = now();
    touchMoveTimer(room);
    emitOkeyState(room, 'okeyAutoPlayed');
  }
}

function okeyGuard(room, socket) {
  if (!okeyEngine || (room.gameId !== 'okey' && room.gameId !== 'okey101') || room.status !== 'playing' || !room.okey) return null;
  if (room.okey.between) return null;
  const isSpectatorSocket = socket.role === 'spectator' ||
    (room.spectators || []).some(x => x.id === socket.id);
  const player = isSpectatorSocket ? null : room.players.find(p => p.id === socket.id);
  return player;
}

function okeyAct(room, socket, act) {
  const player = okeyGuard(room, socket);
  if (!player) return false;
  const ok = room.okey;
  const res = act(ok.roundState, player.seat);
  if (!res.ok) {
    socket.emit('okeyRejected', { roomId: room.id, reason: res.reason, gameState: buildOkeyState(room, player.seat) });
    return false;
  }
  // Başarılı eylem: saatleri muhasebele, strike sıfırla, herkese yayınla.
  okeyAdvanceClock(room);
  ok.strikes[player.seat] = 0;
  if (ok.roundState.finished) {
    okeyRoundFinished(room);
  } else {
    emitOkeyState(room);
  }
  emitRoom(room);
  return true;
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
    const player = {
      id: spec.id,
      userKey: spec.userKey,
      // Özel odada userKey yedeği yok (bkz. joinRoom koltuk alanları).
      userId: spec.userId || (room.isPrivate ? null : (authApi ? authApi.uidFromUserKey(spec.userKey) : null)),
      name: spec.name,
      color: seatColorFor(room, room.players.length),
      seat: room.players.length,
      isReady: false
    };
    room.players.push(player);
    io.to(spec.id).emit('promotedToPlayer', {
      roomId: room.id,
      playerColor: player.color,
      seat: player.seat,
      room: publicRoom(room)
    });
  }
}

function removeSpectator(room, spec) {
  if (!room || !spec) return;
  room.spectators = (room.spectators || []).filter(s => s !== spec);
  emitRoom(room);
}

// Oyun sonrası oda TAKILI KALMAZ: bitişten (mat / süre / hamle hükmen /
// terk / mars) kısa bir süre sonra oda otomatik olarak beklemeye döner.
// Oyuncular hâlâ masadaysa koltukları korunur (rövanş için HAZIRIM yeter);
// oda tamamen boşaldıysa kalıcı masalar sıfırlanır, normal odalar silinir.
// Eskiden bu zamanlayıcı YALNIZCA 'player_left' yolunda kuruluyordu; diğer
// bitişlerde oda lobide sonsuza dek "Oynanıyor 2/2" olarak takılı kalıyordu.
function cancelRoomReset(room) {
  if (room && room.resetTimer) {
    clearTimeout(room.resetTimer);
    room.resetTimer = null;
  }
}

function scheduleRoomReset(room) {
  if (!room) return;
  cancelRoomReset(room);
  // Maç geçmişi: bitişte (her yol buradan geçer) üyeli oyuncular için tek
  // defalık kayıt düşülür (profilde "Son Maçlar" ve istatistikler bundan okunur).
  if (authApi && room.result && !room.__matchRecorded) {
    room.__matchRecorded = true;
    try {
      const res = room.result;
      const winnerName =
        res.winnerSeat !== undefined && res.winnerSeat !== null
          ? ((room.players.find(p => p.seat === res.winnerSeat) || {}).name || null)
          : res.winner
            ? ((room.players.find(p => p.color === res.winner) || room.players.find(p => p.seat === res.winner) || {}).name || null)
            : null;
      const players = (room.players || []).map(p => ({
        id: p.userId || null,
        name: p.name,
        won: !!(winnerName && p.name === winnerName)
      }));
      (room.__leftPlayers || []).forEach(lp => players.push({ id: lp.userId || null, name: lp.name, won: false }));
      authApi.recordMatch({
        gameId: room.gameId,
        roomId: room.id,
        players,
        winnerName,
        reason: res.reason || 'finished'
      });
    } catch (e) { console.warn('maç kaydı atlandı:', e.message); }
  }
  const roomId = room.id;
  const timer = setTimeout(() => {
    const current = rooms.get(roomId);
    if (!current) return;
    if (current.resetTimer === timer) current.resetTimer = null;
    if (current.status !== 'finished' && current.status !== 'aborted') return;
    if (current.players.length === 0) {
      destroyRoom(current);
      return;
    }
    resetRoomToWaiting(current);
    maybePromoteSpectators(current);
    emitRoom(current);
  }, POST_GAME_HOLD_MS);
  if (typeof timer.unref === 'function') timer.unref();
  room.resetTimer = timer;
}

function destroyRoom(room) {
  if (!room) return;
  cancelRoomReset(room);
  chatRoomHist.delete(room.id); // masa sohbeti geçmişi odayla birlikte silinir
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
  // Maç geçmişi bütünlüğü: oyun SIRASINDA ayrılan üye de kayda dahil edilsin.
  if (room.status === 'playing') {
    (room.__leftPlayers = room.__leftPlayers || []).push({ name: player.name, userId: player.userId || null });
  }
  room.players = room.players.filter(p => p !== player);

  if (room.players.length === 0) {
    destroyRoom(room);
    return;
  }

  const wasPlaying = room.status === 'playing';
  // Okey: oyun sürerken ayrılan HÜKMEN MAĞLUP; lider kalan arasından seçilir.
  if (wasPlaying && room.okey) {
    endOkeyMatch(room, 'player_left', player.seat);
    room.players.forEach(p => emitToPlayer(p, 'playerLeft', {
      roomId: room.id,
      message: message || 'Bir oyuncu oyundan ayrıldı.',
      seat: p.seat,
      youWon: room.result ? p.seat === room.result.winnerSeat : false,
      isSpectator: false
    }));
    (room.spectators || []).forEach(s => emitToPlayer(s, 'playerLeft', {
      roomId: room.id,
      message: message || 'Bir oyuncu oyundan ayrıldı.',
      seat: null,
      youWon: false,
      isSpectator: true
    }));
    emitRoom(room);
    return;
  }
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

    // Oda, kazanan ekranı görülebilsin diye hemen sıfırlanmaz; kısa bir
    // beklemenin ardından evrensel sıfırlayıcı beklemeye alır.
    scheduleRoomReset(room);
    return;
  }

  resetRoomToWaiting(room);
  maybePromoteSpectators(room);
  emitRoom(room);
}

io.on('connection', socket => {
  console.log(`[BAĞLANDI] ${socket.id}`);
  if (authApi) authApi.attachSocket(socket);

  socket.on('subscribeLobby', payload => {
    const gameId = String((payload && payload.gameId) || 'chess');
    for (const roomName of socket.rooms) {
      if (String(roomName).startsWith('lobby:')) socket.leave(roomName);
    }
    socket.lobbyGameId = gameId;
    // Genel sohbet için kimliği sakla (üyelik denetimi chatMessage'da yapılır).
    if (payload && payload.userKey && typeof socket.userKey !== 'string') socket.userKey = String(payload.userKey);
    socket.join(lobbyChannel(gameId));
    socket.emit('roomsUpdated', { gameId, rooms: listPublicRooms(gameId) });
  });

  // ---- SOHBET: masa içi (room) ve genel (global) ----
  socket.on('chatMessage', payload => {
    const scope = payload && payload.scope === 'global' ? 'global' : 'room';
    const text = chatSanitize(payload && payload.text);
    if (!text) return;
    if (!chatIsMember(socket, payload)) {
      return socket.emit('chatRejected', { reason: 'Sohbette yazabilmek için üye girişi yapmalısınız. Mesajları okumaya devam edebilirsiniz.' });
    }
    if (chatHasLink(text)) {
      return socket.emit('chatRejected', { reason: '🔗 Link paylaşımı yasaktır.' });
    }
    if (chatHasProfanity(text)) {
      return socket.emit('chatRejected', { reason: '🚫 Küfür ve argo kullanılamaz.' });
    }
    const t = now();
    const rateMs = scope === 'global' ? CHAT_GLOBAL_RATE_MS : CHAT_RATE_MS;
    if (socket.__lastChatAt && t - socket.__lastChatAt < rateMs) {
      return socket.emit('chatRejected', { reason: 'Çok hızlı gönderiyorsunuz (' + (rateMs / 1000) + ' sn sınırı).' });
    }
    socket.__lastChatAt = t;

    const roomId = String(socket.roomId || '');
    const room = roomId ? rooms.get(roomId) : null;
    // Gösterilecek isim: oda kaydından, yoksa paketten.
    let name = null;
    let chatUid = socket.userId || null;
    if (room) {
      const pl = (room.players || []).find(p => p.id === socket.id);
      const sp = (room.spectators || []).find(s => s.id === socket.id);
      name = (pl || sp)?.name || null;
      chatUid = (pl || sp)?.userId || chatUid;
    }
    name = chatSanitize(name || (payload && payload.name) || 'Oyuncu') || 'Oyuncu';
    const msg = { id: 'm' + t + '-' + Math.floor(Math.random() * 1e6), name, text, ts: t, scope, uid: chatUid };

    if (scope === 'room') {
      if (!room) return socket.emit('chatRejected', { reason: 'Masa sohbeti için bir odada olmalısınız.' });
      msg.roomId = roomId;
      pushChat(roomId, msg);
      io.to(roomId).emit('chatMessage', msg);
    } else {
      chatGlobalPrune();
      chatGlobal.push(msg);
      while (chatGlobal.length > CHAT_HISTORY) chatGlobal.shift();
      io.emit('chatMessage', msg); // genel sohbet herkese açık akar
    }
    // UZAK modda sohbet MySQL'e de yazılır (kayıtlı kalıcılık isteği).
    if (authApi && typeof authApi.logChat === 'function') {
      try { authApi.logChat(msg); } catch (_) {}
    }
  });

  socket.on('chatHistory', (payload, ack) => {
    if (typeof ack !== 'function') return;
    const scope = payload && payload.scope === 'global' ? 'global' : 'room';
    const rid = String((payload && payload.roomId) || socket.roomId || '');
    if (scope === 'global') chatGlobalPrune(); // süresi dolan genel mesajlar geçmişe gelmez
    const list = scope === 'global' ? chatGlobal : (chatRoomHist.get(rid) || []);
    ack({ ok: true, scope, messages: list.slice(-CHAT_HISTORY) });
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

  // Üyelik kanıtını soket mesajının İÇİNDEN doğrula. authHello'nun bu sokete
  // düşmesini beklemeye gerek kalmaz (yarış); ayrıca HTTP başlığı hiç
  // kullanılmadığı için FastCGI kırpmasından da bağımsızdır. Özel oda kapısı
  // bunu çağırır; başarılıysa socket.userId anında yazılır.
  //
  // YARIŞ GÜVENCESİ: PHP soğuk başlangıcı sırasında 8+ sn sürebilir.
  // Çağıran await ederek bloklanır; eğer cevap gelirse hemen döner, yoksa
  // 18 sn timeout'tan sonra null döner. Bu süre zarfında sunucu joinRoom'u
  // bekletmesin diye Promise.race ile çağrı kısa tutulur, ama davranış
  // yine de güvenli: timeout olursa socket.userId null kalır ve
  // joinDenied 'code:auth' döner, istemci retryAfterAuthDeny ile tekrar dener.
  async function ensureSocketIdentity(data) {
    if (socket.userId) return true;
    if (!authApi) return false;
    // 1) İmzalı kimlik belgesi (auth.php attest) — PHP'ye GEREK DUYMADAN
    //    Render'da yerinde doğrulanır (Yöncü DDoS korumasına bağışıklık).
    const att = data && data.memberAttestation;
    if (att && typeof att === 'object' && typeof authApi.verifyIdentityFull === 'function') {
      try {
        const full = await authApi.verifyIdentityFull({ attestation: att });
        if (full && full.uid) {
          socket.userId = Number(full.uid);
          socket.userKey = 'user:' + Number(full.uid);
          return true;
        }
      } catch (_) {}
    }
    // 2) Token (yerel DB / PHP önbelleği sıcakken).
    const t = data && typeof data.memberToken === 'string' ? data.memberToken : '';
    if (!t || t.length > 256) return false;
    try {
      const uid = await authApi.verifyToken(t);
      if (uid) { socket.userId = Number(uid); socket.userKey = 'user:' + Number(uid); return true; }
    } catch (_) {}
    return false;
  }

  socket.on('joinRoom', async payload => {
    const data = payload || {};
    if (!data.roomId) return;

    const roomId = String(data.roomId);
    const gameId = data.gameId || 'chess';
    let room = rooms.get(roomId);
    // Bu joinRoom çağrısında oda yeni KURULDUYSA ve özel oda kilidi oyuncuyu
    // reddederse (misafir / geçersiz jeton), boş kabuk odanın kalması için
    // reddedilişte derhal kapatılır.
    let justCreated = false;
    if (!room) {
      // Davet bildirimine tıklanıp gelindi ama masa artık yok → geçersiz davet.
      if (data.viaInvite) {
        socket.emit('joinDenied', { roomId, code: 'stale', reason: 'Bu davet artık geçerli değil — masa kapanmış.' });
        return;
      }
      // ÖZEL masa kurmak üyelik ister (misafirler yalnızca genel masa kurabilir).
      // Kimlik önce authHello'dan; yoksa bu mesajdaki memberToken ile
      // doğrulanır. Token YOKSA (misafir) oda KURULMAZ ve 'auth' reddi
      // döner. Token varsa doğrulama aşağıdaki özel oda kilidinde (en fazla
      // 3 sn) beklenir: kesin GEÇERSİZ token'da oda kurulur ama oyuncu
      // reddedilir ve boş oda derhal kapatılır; PHP soğuk başlangıcı gibi
      // "bilinmeyen" durumlarda oyuncu şartlı kabul edilir (eski davranış).
    if (data.isPrivate && !socket.userId) {
      const hasToken = data.memberToken && typeof data.memberToken === 'string' && data.memberToken.length > 0;
      const hasAttestation = !!(data.memberAttestation && typeof data.memberAttestation === 'object');
      const hasCred = hasToken || hasAttestation;
      console.log('[JOINROOM]', socket.id, 'isPrivate=true, userId=', socket.userId, 'hasToken=', hasToken, 'hasAttestation=', hasAttestation, 'tokenLen=', hasToken ? data.memberToken.length : 0);
      if (!hasCred) {
        await ensureSocketIdentity(data);
        if (!socket.userId) {
          socket.emit('joinDenied', { roomId, code: 'auth', reason: 'Özel masa kurmak için üye girişi gerekli.' });
          return;
        }
      }
      // Kimlik kanıtı var (token ve/veya imzalı belge): çözümün kesin
      // doğrulanmasını özel oda kilidi bekletir; odayı kuruyoruz,
      // reddedilirse hemen aşağıda kapatılır (boş özel oda lobide kalmaz).
    }
      room = createRoom(roomId, gameId, data.maxPlayers, data.durationMinutes, {
        name: data.roomName || data.name,
        isPrivate: !!(data.isPrivate),
        // Okey: masayı kuran oyuncu 3/5/7 el seçimini burada gönderir.
        rounds: (gameId === 'okey' || gameId === 'pisti') ? data.rounds : undefined
      });
      justCreated = true;
    } else if (!room.name && (data.roomName || data.name)) {
      room.name = String(data.roomName || data.name).slice(0, 60);
    }

    // Arka planda çözülen kimlik sonradan gelirse, o an bu odaya zaten
    // bağlı olan oyuncunun userId'si güncellenir (kurucu hakları için).
    if (socket.userId && room.isPrivate && !room.creatorId) {
      const me = room.players.find(p => p.id === socket.id);
      if (me) room.creatorId = socket.userId;
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

    // ÖZEL oda KOLTUK DEVRALMA KORUMASI: istemci userKey'siyle (p.id !==
    // socket.id) bir koltuğa/izleyiciliğe DEVRALMA deniyorsa ve sunucuda
    // doğrulanmış kimlik başkasına aitsse devralma reddedilir — başka üyenin
    // oturumu ele geçirilemez. Doğrulanmamış soket (aynı kullanıcının ikinci
    // sekmesi / auth yarışı) serbest: kimlik doğrulandığında kendi uid'si
    // eşleşirse oturum devam eder.
    if (room.isPrivate && player && player.id !== socket.id && player.userId &&
        socket.userId && Number(player.userId) !== Number(socket.userId)) {
      player = null;
    }
    if (room.isPrivate && spectator && spectator.id !== socket.id && spectator.userId &&
        socket.userId && Number(spectator.userId) !== Number(socket.userId)) {
      spectator = null;
    }

    // "İzle" ile gelen bağlantı ASLA koltuk almaz / koltuk geri kazanmaz.
    // Aynı tarayıcı (aynı userKey) ikinci sekmede izlemek istediğinde sunucu
    // eskiden onu oyuncu koltuğuna reconnect ediyordu; "Siyah (Siz)" +
    // "sıra sizde değil" hatası buradan geliyordu.
    if (wantSpectate && player && player.id !== socket.id) {
      player = null;
    }

    // ===== ÖZEL ODA KİLİDİ: kurucu + davetli üyeler dışında kimse giremez =====
    //  Halen koltukta olanın (reconnect/rejoin) hakkı dokunulmaz. Yeni gelenlerde
    //  kimlik YALNIZ token doğrulamalı üyeliktir (socket.userId; userKey güvenilmez).
    //  "İlk bağlanan katılır": çoklu davette ilk oturana koltuk gider; masa
    //  dolunca sonraki davetli 'full' reddi alır (aşağıdaki sıralama).
    if (room.isPrivate && !player) {
      if (!room.invited || typeof room.invited.has !== 'function') room.invited = new Map();
      if (!room.kickBan || typeof room.kickBan.has !== 'function') room.kickBan = new Set();
      const hasToken = data.memberToken && typeof data.memberToken === 'string' && data.memberToken.length > 0;
      const hasAttestation = !!(data.memberAttestation && typeof data.memberAttestation === 'object');
      const hasCred = hasToken || hasAttestation;
      const lockStart = Date.now();
      // Kimlik doğrulaması (en fazla 3 sn) beklenirken oda BOŞ kalabilir;
      // 5 sn'lik süpürücü bu boşluğu görüp odayı silmesin. Her bekleyen
      // katılımda sayaç artar, sonuçta (red/kabul) azaltılır.
      room.__pendingJoints = (room.__pendingJoints || 0) + 1;

      // 1) Hızlı yol: authHello işlenmişse (veya imzalı belge hemen
      //    doğrulanırsa) 800 ms'lik yarış çoğu durumda hiç tüketilmez.
      if (!socket.userId && hasCred) {
        try {
          await Promise.race([
            ensureSocketIdentity(data),
            new Promise(res => setTimeout(res, 800))
          ]);
        } catch (_) {}
      }
      let uid = socket.userId || null;

      // 2) KARARLI KARAR: kimlik kanıtı var (token ve/veya imzalı belge) ama
      //    kimlik hâlâ çözülemediyse üyelik katmanından en fazla 3 sn
      //    beklenir (toplam bütçe). Sonuç:
      //      - üye bulundu       → normal doğrulanmış giriş
      //      - kesin GEÇERSİZ     → 'auth' reddi (sahte jetonlu kullanıcı
      //                             özel odaya GİREMEZ, oda kurulduysa kapatılır)
      //      - BİLİNMEYEN (PHP soğuk başlangıcı gibi cevap gelmedi) →
      //        "şartlı kabul": oyuncu arka planda çözülür; sonuç geçerliyse
      //        yetkiler verilir, kesin geçersiz çıkarsa masadan alınır.
      let deny = null;
      if (!uid && hasCred && authApi && typeof authApi.verifyIdentityFull === 'function') {
        const budgetLeft = Math.max(50, 3000 - (Date.now() - lockStart));
        let full = null;
        try {
          full = await Promise.race([
            authApi.verifyIdentityFull({ token: data.memberToken, attestation: data.memberAttestation }),
            new Promise(res => setTimeout(() => res(null), budgetLeft))
          ]);
        } catch (_) { full = null; }
        if (full && full.uid) {
          socket.userId = Number(full.uid);
          socket.userKey = 'user:' + Number(full.uid);
          uid = socket.userId;
        } else if (full && full.status === 'invalid') {
          deny = {
            code: 'auth',
            reason: justCreated
              ? 'Özel masa kurmak için üye girişi gerekli.'
              : 'Üyelik doğrulanamadı — bu özel masaya giremezsiniz.'
          };
        }
      }
      const hasPendingAuth = !uid && hasCred; // kanıt var (token/belge), sonuç BİLİNMEYEN → şartlı kabul

      if (!deny) {
        if (!uid && !hasPendingAuth) deny = { code: 'auth', reason: 'Bu masa özel — yalnızca üyeler ve davetliler girebilir.' };
        // Kurucu serbest; henüz kurucusu YOKSA (yeni kurulmuş boş masa) ilk oturan
        // üye kurucu olur — bootstrap girişi de serbesttir.
        else if (!hasPendingAuth && Number(uid) === Number(room.creatorId)) { /* kurucu */ }
        else if (!hasPendingAuth && !room.creatorId) { /* bootstrap: ilk oturan kurucu olur */ }
        else if (!hasPendingAuth && room.kickBan.has(Number(uid)) && !room.invited.has(Number(uid)))
          deny = { code: 'kicked', reason: 'Bu masadan atıldınız — kurucu yeniden davet edene kadar giremezsiniz.' };
        else if (!hasPendingAuth && !room.invited.has(Number(uid)))
          deny = { code: 'policy', reason: 'Bu masa özel — yalnızca davetli üyeler girebilir.' };
        else if (!hasPendingAuth && !wantSpectate && room.status !== 'waiting')
          deny = { code: 'stale', reason: 'Bu davet artık geçerli değil — masa oyunda.' };
        else if (!hasPendingAuth && !wantSpectate && room.players.length >= room.maxPlayers)
          deny = { code: 'full', reason: 'Oda dolu — masada yer kalmadı.' };
      }
      if (deny) {
        room.__pendingJoints = Math.max(0, (room.__pendingJoints || 0) - 1);
        socket.emit('joinDenied', { roomId, ...deny });
        // Bu bağlantı için YENİ kurulmuş oda reddedildiyse boş kabuk kalmasın
        // (oda haritasında ölü özel oda kalmaz; lobi listesi de temiz kalır).
        if (justCreated) { try { destroyRoom(room); } catch (_) { rooms.delete(roomId); } }
        socket.leave(roomId);
        socket.roomId = null;
        socket.userKey = null;
        socket.role = null;
        return;
      }
      // hasPendingAuth: üye token göndermiş ama sonuç BİLİNMEYEN (örn. PHP
      // soğuk başlangıcı) → arka planda doğrula, sonucu işle. Aşağıdaki
      // oyuncu ekleme akışı normal devam eder; sonuç gelince:
      //   - GEÇERLİ  → yetkiler verilir (userId, kurucu vb.)
      //   - GEÇERSİZ → kullanıcı üye DEĞİL: özel masadan ALINIR (joinFailed)
      //   - cevap yok → 'authPending' uyarısı (eski davranış)
      if (hasPendingAuth) {
        console.log('[JOINROOM] token var ama sonuç BİLİNMEYEN — arka plan verifyTokenFull başlatılıyor.');
        if (authApi && typeof authApi.verifyTokenFull === 'function') {
          authApi.verifyIdentityFull({ token: data.memberToken, attestation: data.memberAttestation }).then(full => {
            if (socket.roomId !== roomId) return; // socket başka odaya geçmiş
            const rNow = rooms.get(roomId);
            if (!rNow) return;
            if (full && full.uid) {
              socket.userId = Number(full.uid);
              socket.userKey = 'user:' + Number(full.uid);
              const me = rNow.players.find(p => p.id === socket.id);
              if (me) me.userId = socket.userId;
              // Eğer bu oyuncu ilk oturan ve oda hâlâ kurucusuzsa, kurucu yap.
              if (rNow.isPrivate && !rNow.creatorId && me) {
                rNow.creatorId = socket.userId;
              }
              try { socket.emit('authReady', { ok: true, user: { id: socket.userId } }); } catch (_) {}
              try { emitRoom(rNow); } catch (_) {}
            } else if (full && full.status === 'invalid') {
              // Kesin sonuç: bu token GEÇERSİZ — oyuncu ne üye ne davetli.
              // Eski davranış ("odada kalır") özel masaya sahte jetonla
              // girişe yol açıyordu; şimdi masadan alınır.
              console.log('[JOINROOM] arka plan verifyTokenFull GEÇERSİZ — oyuncu özel masadan alınıyor.');
              const me = rNow.players.find(p => p.id === socket.id);
              try { socket.leave(roomId); } catch (_) {}
              socket.roomId = null;
              socket.role = null;
              if (me) {
                try { removePlayerFromRoom(rNow, me, 'Üyelik doğrulanamadı.'); } catch (_) {}
              }
              try { socket.emit('joinFailed', { roomId, code: 'auth', reason: 'Üyelik doğrulanamadı — bu özel masada kalamazsınız. Lütfen yeniden giriş yapın.' }); } catch (_) {}
            } else {
              console.log('[JOINROOM] arka plan verifyTokenFull BİLİNMEYEN (PHP cevap vermedi) — oyuncu odada kalır.');
              try { socket.emit('authPending', { ok: false, reason: 'Üyelik doğrulanamadı (PHP cevap vermedi). Davet gönderme gibi işlemler çalışmayabilir; sayfayı yenileyin.' }); } catch (_) {}
            }
          }).catch(_ => {
            console.log('[JOINROOM] arka plan verifyTokenFull HATA — oyuncu odada kalır.');
            try { socket.emit('authPending', { ok: false, reason: 'Bağlantı hatası. Sayfayı yenileyin.' }); } catch (_) {}
          });
        }
      }
      // Katılım kararı verildi (kabul) — süpürücü koruması sona erer.
      room.__pendingJoints = Math.max(0, (room.__pendingJoints || 0) - 1);
    }

    if (player) {
      player.id = socket.id;
      player.name = name || player.name;
      player.userKey = userKey || player.userKey;
      // ÖZEL odada kullanıcı kimliği SADECE doğrulanmış jetondan gelir
      // (socket.userId). İstemcinin 'user:N' userKey'si KANİT değildir:
      // sahte N kurucu/maç kayıtlarına sızmıştı (bkz. creatorId hırsızlığı).
      // Genel odada eski userKey yedeği korunur.
      player.userId = player.userId || socket.userId || (room.isPrivate ? null : (authApi ? authApi.uidFromUserKey(userKey) : null));
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
      player = {
        id: socket.id,
        userKey,
        userId: socket.userId || (room.isPrivate ? null : (authApi ? authApi.uidFromUserKey(userKey) : null)),
        name,
        color: seatColorFor(room, room.players.length),
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
        spectator = { id: socket.id, userKey, userId: socket.userId || (room.isPrivate ? null : (authApi ? authApi.uidFromUserKey(userKey) : null)), name };
        room.spectators.push(spectator);
      } else {
        spectator.id = socket.id;
        spectator.name = name || spectator.name;
        spectator.userKey = userKey || spectator.userKey;
        spectator.userId = spectator.userId || socket.userId || (room.isPrivate ? null : (authApi ? authApi.uidFromUserKey(userKey) : null));
      }
      socket.role = 'spectator';
    }

    // Özel masanın kurucusu (davet + atma hakkı onundur): YALNIZCA henüz
    // kurucusu yoksa, ilk koltuk alan üye kaydedilir. creatorId SONRAKİ
    // katılımlarda ASLA değiştirilmez — bir arkadaş katıldığı anda kurucu
    // haklarını devralıyordu (davet/atma yetkisi çalınıyordu; "sadece masa
    // kurucusu davet edebilir" kuralı bozuluyordu). Aynı üye yeniden
    // bağlansa bile aynı uid olduğu için bu kuralı ihlal etmez; kurucusuz
    // kalması tek olası yol, PHP timeout yarışında userId'siz oturan kurucunun
    // doğrulamasının sonradan gelmesidir (o da yukarıdaki .then() içinde
    // `!room.creatorId` korumasıyla atanır).
    if (player && player.userId && room.isPrivate && !room.creatorId) {
      room.creatorId = player.userId;
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
        scheduleRoomReset(room); // oda finished'da takılı kalmasın
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
    scheduleRoomReset(room); // tavla bitişinde de oda takılı kalmasın
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

  // ---------- GOMOKU eylemleri (sunucu yetkili) ----------
  socket.on('gomokuMove', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room?.gomoku&&room.players.find(x=>x.id===socket.id); if(!p||room.status!=='playing')return socket.emit('gomokuRejected',{roomId:room?.id||data?.roomId,reason:'not_in_room'}); const r=gomokuEngine.play(room.gomoku,p.seat,Number(data.r),Number(data.c)); if(!r.ok)return socket.emit('gomokuRejected',{roomId:room.id,reason:r.reason,gameState:gomokuState(room,p.seat)}); if(room.gomoku.status==='finished'){room.status='finished';room.result=room.gomoku.result;} emitGomokuState(room);emitRoom(room);if(room.status==='finished')room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:room.gomoku.winner,youWon:q.seat===room.gomoku.winner,gameState:gomokuState(room,q.seat)})); });

  // ---------- REVERSİ eylemleri (sunucu yetkili) ----------
  socket.on('reversiMove', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room?.reversi&&room.players.find(x=>x.id===socket.id); if(!p||room.status!=='playing')return socket.emit('reversiRejected',{roomId:room?.id||data?.roomId,reason:'not_in_room'}); const r=reversiEngine.play(room.reversi,p.seat,Number(data.r),Number(data.c)); if(!r.ok)return socket.emit('reversiRejected',{roomId:room.id,reason:r.reason,gameState:reversiState(room,p.seat)}); if(r.winner!==undefined&&r.winner!==null||room.reversi.status==='finished'){room.status='finished';room.result=room.reversi.result;} emitReversiState(room);emitRoom(room); if(room.status==='finished')room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:room.reversi.winner,youWon:q.seat===room.reversi.winner,gameState:reversiState(room,q.seat)})); });

  // ---------- İNGİLİZ DAMASI eylemleri (sunucu yetkili) ----------
  socket.on('damaMove', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room&&room.dama&&room.players.find(x=>x.id===socket.id); const engine=room?.gameId==='turkdamasi'?turkDamaEngine:damaEngine; const ev=room?.gameId==='turkdamasi'?'turkDamaRejected':'damaRejected'; if(!p||room.status!=='playing') return socket.emit(ev,{roomId:room?.id||data?.roomId,reason:'not_in_room'}); const r=engine.play(room.dama,p.seat,[Number(data.from?.[0]),Number(data.from?.[1])],[Number(data.to?.[0]),Number(data.to?.[1])]); if(!r.ok)return socket.emit(ev,{roomId:room.id,reason:r.reason,gameState:damaState(room,p.seat)}); if(r.winner){room.status='finished';room.result={reason:'finished',winnerSeat:p.seat};} emitDamaState(room);emitRoom(room); if(r.winner)room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:p.seat,youWon:q.seat===p.seat,gameState:damaState(room,q.seat)})); });

  // ---------- PİŞTİ / BATAK eylemleri (sunucu yetkili) ----------
  function cardGuard(room) { return room && ONLINE_CARD_GAMES.has(room.gameId) && room.status==='playing' && room.cardGame && room.players.find(p=>p.id===socket.id); }
  function cardReject(roomId, reason) { socket.emit(roomId && rooms.get(roomId)?.gameId==='batak' ? 'batakRejected' : 'pistiRejected', {roomId,reason}); }
  socket.on('pistiPlay', data => { const room=rooms.get(socket.roomId || String(data?.roomId||'')), p=cardGuard(room); if(!p||room.gameId!=='pisti')return cardReject(room?.id||data?.roomId,'not_in_room'); const r=pistiEngine.play(room.cardGame,p.seat,Number(data.index)); if(!r.ok)return cardReject(room.id,r.reason); if(room.cardGame.finished){room.status='finished';room.result={reason:'finished',winner:room.cardGame.result.winner}; emitCardState(room); room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:room.result.winner,youWon:q.seat===room.result.winner,gameState:cardGameState(room,q.seat)}));} else emitCardState(room); emitRoom(room); });
  socket.on('batakBid', data => { const room=rooms.get(socket.roomId || String(data?.roomId||'')), p=cardGuard(room); if(!p||room.gameId!=='batak')return cardReject(room?.id||data?.roomId,'not_in_room'); const r=batakEngine.bid(room.cardGame,p.seat,data.value); if(!r.ok)return cardReject(room.id,r.reason); emitCardState(room); });
  socket.on('batakTrump', data => { const room=rooms.get(socket.roomId || String(data?.roomId||'')), p=cardGuard(room); if(!p||room.gameId!=='batak')return cardReject(room?.id||data?.roomId,'not_in_room'); const r=batakEngine.trump(room.cardGame,p.seat,data.suit); if(!r.ok)return cardReject(room.id,r.reason); emitCardState(room); });
  socket.on('batakPlay', data => { const room=rooms.get(socket.roomId || String(data?.roomId||'')), p=cardGuard(room); if(!p||room.gameId!=='batak')return cardReject(room?.id||data?.roomId,'not_in_room'); const r=batakEngine.play(room.cardGame,p.seat,Number(data.index)); if(!r.ok)return cardReject(room.id,r.reason); if(room.cardGame.finished){room.status='finished';room.result={reason:'finished',scores:room.cardGame.scores.slice()}; emitCardState(room); const winner=room.cardGame.scores.indexOf(Math.max(...room.cardGame.scores)); room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:winner,youWon:q.seat===winner,gameState:cardGameState(room,q.seat)}));} else emitCardState(room); emitRoom(room); });

  // ---------- OKEY eylemleri (sunucu yetkili) ----------
  socket.on('okeyDraw', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room) return;
    const source = (data && data.source) === 'prev' ? 'prev' : 'deck';
    okeyAct(room, socket, (st8, seat) =>
      source === 'prev' ? okeyEngine.drawFromPrev(st8, seat) : okeyEngine.drawFromDeck(st8, seat));
  });

  socket.on('okeyDiscard', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || !data || !data.tileId) return;
    okeyAct(room, socket, (st8, seat) => okeyEngine.discard(st8, seat, String(data.tileId)));
  });

  socket.on('okeyFinish', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || !data || !data.tileId) return;
    okeyAct(room, socket, (st8, seat) => okeyEngine.finish(st8, seat, String(data.tileId)));
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

  // Kurucunun özel masadan oyuncu ATMA yetkisi. Atılan oyuncu, kurucu ona
  // yeniden davet gönderene kadar odaya giremez (kickBan); her yeni davet
  // yeni bir giriş hakkı açar (gameInvite kickBan'i temizler).
  socket.on('kickPlayer', payload => {
    const roomId = String((payload && payload.roomId) || socket.roomId || '');
    const room = rooms.get(roomId);
    const tell = (ok, reason, extra) => socket.emit('kickResult', Object.assign({ ok, reason: reason || null }, extra || {}));
    if (!room) return tell(false, 'Masa bulunamadı.');
    if (!room.isPrivate) return tell(false, 'Atma yalnızca özel masalarda geçerlidir.');
    const meId = socket.userId || (authApi ? authApi.uidFromUserKey(socket.userKey) : null);
    if (!meId || Number(room.creatorId) !== Number(meId)) return tell(false, 'Yalnızca masanın kurucusu oyuncu atabilir.');
    const targetId = Number(payload && payload.userId);
    if (!targetId || targetId === Number(meId)) return tell(false, 'Kendinizi atamazsınız.');
    const tp = (room.players || []).find(p => Number(p.userId) === targetId);
    if (!tp) return tell(false, 'Oyuncu masada değil.');
    if (!room.kickBan || typeof room.kickBan.add !== 'function') room.kickBan = new Set();
    room.kickBan.add(targetId);
    if (room.invited && typeof room.invited.delete === 'function') room.invited.delete(targetId);
    const mePlayer = (room.players || []).find(p => Number(p.userId) === Number(meId));
    const tSock = io.sockets.sockets.get(tp.id);
    if (tSock) {
      try {
        tSock.emit('kickedFromRoom', { roomId: room.id, byName: (mePlayer && mePlayer.name) || 'Kurucu' });
        tSock.leave(room.id);
        if (tSock.roomId === room.id) tSock.roomId = null;
        tSock.role = null;
      } catch (_) {}
    }
    removePlayerFromRoom(room, tp, 'Kurucu oyuncuyu masadan attı.');
    tell(true, null, { name: tp.name, userId: targetId });
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

// HAYALET KOLTUK TEMİZLEYİCİ — lobinin her zaman GERÇEK sayıları göstermesi
// için: beklemede / bitmiş odalarda koltuğu işgal ediyor GÖRÜNEN ama soketi
// artık bağlı olmayan oyuncular (ve izleyiciler) düşürülür. Sekme kapanışı,
// ağ kopması, Render uyku/uyanma gibi durumlarda 'disconnect' olayı geç veya
// hiç düşmeyebilir; bu süpürme gerçek bağlantı durumunu (io.sockets) tek
// doğru kaynak sayarak lobiyi kendi kendine iyileştirir. 'playing' odalara
// KESİNLİKLE dokunulmaz — orada 30 sn'lik yeniden bağlanma hakkı işler.
function socketAlive(id) {
  const s = id ? io.sockets.sockets.get(id) : null;
  return !!(s && s.connected);
}

function purgeGhostPlayers(room) {
  if (!room || room.status === 'playing') return false;
  let changed = false;
  room.players = (room.players || []).filter(p => {
    if (socketAlive(p.id)) return true;
    cancelDisconnectTimer(room.id, p);
    changed = true;
    console.log(`[ODA #${room.id}] hayalet oyuncu düşürüldü: ${p.name || p.id} (lobi senkronu)`);
    return false;
  });
  room.spectators = (room.spectators || []).filter(s => {
    if (socketAlive(s.id)) return true;
    changed = true;
    return false;
  });
  return changed;
}

let lastRoomSweep = 0;
const clockTimer = setInterval(() => {
  // Takılmış oda süpürücüsü (5 sn'de bir): bitiş zamanlayıcısı her bitişte
  // zaten kurulur; bu, beklenmedik bir yolla 'finished' kalan ya da bomboş
  // durumda listede kalan kalıcı olmayan odaları kendi kendine iyileştirir.
  if (now() - lastRoomSweep >= 5000) {
    lastRoomSweep = now();
    for (const room of rooms.values()) {
      // 1) Hayalet senkronu (yalnız beklemede/bitişte).
      if (room.status !== 'playing' && purgeGhostPlayers(room)) {
        if (!room.players.length && !(room.spectators || []).length) {
          destroyRoom(room); // kalıcı masa -> beklemeye; normal oda -> silinir
        } else {
          room.players.forEach((p, idx) => { p.seat = idx; });
          emitRoom(room); // lobiye taze gerçek sayılar yayınlanır
        }
        continue;
      }
      if ((room.status === 'finished' || room.status === 'aborted') && !room.resetTimer) {
        scheduleRoomReset(room);
      } else if (!room.isPreset && room.players.length === 0 && !(room.spectators || []).length && !(room.__pendingJoints > 0)) {
        // __pendingJoints: özel oda kilidinde kimlik doğrulaması bekleyen
        // katılım varken (en fazla 3 sn) oda "geçici boş" kalır; silinmez.
        destroyRoom(room);
      }
    }
  }
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    // Okey kendi saat döngüsünü işletir (SIRA sayacı + koltuk ana saatleri).
    if (room.okey) { okeyClockTick(room); continue; }
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
      scheduleRoomReset(room); // ana süre bitişi: oda finished'da kalmasın
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
        scheduleRoomReset(room); // hamle hükmen mağlubiyeti: oda takılı kalmasın
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

// Oyun görünürlük meta'sı (KAMU): istemci oyun menüsünü + lobiyi
// gizli oyunlardan süzer. (Yöneticinin kurucu panelinden yaptığı
// görünürlük değişimi anında yansır.)
app.get('/api/games-meta', (_req, res) => {
  res.json({ ok: true, games: ALL_GAMES.map(id => ({ id, visible: gameVisible(id) })) });
});

// Yönetici (kurucu) yetki kontrolü: oturum sahibi ADMIN_EMAIL ise geçer.
function requireAdmin(req, res) {
  const u = (authApi && typeof authApi.userFromReq === 'function') ? authApi.userFromReq(req) : null;
  if (!u || !u.email || String(u.email).toLowerCase() !== ADMIN_EMAIL) {
    res.status(403).json({ ok: false, error: 'Yönetici yetkisi gerekli.' });
    return null;
  }
  return u;
}

// Kurucu Paneli — üye listesi (yalnız yerel modda Render; uzak modda
// istemci Yöncü PHP'sine /api/admin.php?action=users gider):
app.get('/api/admin/users', (req, res) => {
  if (!requireAdmin(req, res)) return;
  if (!db) return res.json({ ok: true, users: [] });
  try {
    const rows = db.prepare('SELECT id, name, email, created_at FROM users ORDER BY created_at ASC, id ASC LIMIT 500').all();
    res.json({ ok: true, users: rows.map(r => ({
      id: r.id, name: r.name, email: r.email, createdAt: r.created_at,
      role: String(r.email).toLowerCase() === ADMIN_EMAIL ? 'kurucu' : 'uye'
    })) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Kurucu Paneli — hazır masa ayarlarını UYGULA (görünürlük / masa sayısı /
// ad-tip). Üretimde (uzak mod) kalıcı kayıt Yöncü MySQL'dedir: istemci önce
// admin.php?action=gamesSave ile kaydeder, sonra burayı çağırarak Render'ı
// CANLI günceller. Yerel modda bu uç aynı zamanda SQLite'a yazar.
app.post('/api/admin/tables-apply', (req, res) => {
  const body = (req.body && req.body.games) || (req.body && typeof req.body === 'object' ? req.body : {});
  try {
    applyPresetConfig(body);
    if (!process.env.GV_AUTH_API) savePresetConfigLocal();
    res.json({ ok: true, games: ALL_GAMES.map(id => ({ id, visible: gameVisible(id) })) });
  } catch (e) {
    console.error('tables-apply hatası:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Kurucu Paneli — geçerli masa ayarlarını oku (yerel mod; uzak modda
// istemci Yöncü PHP'sine gider):
app.get('/api/admin/tables', (req, res) => {
  if (!requireAdmin(req, res)) return;
  res.json({ ok: true, games: presetConfig });
});

// Kurucu Paneli / Ana sayfa — canlı istatistikler (yalnız yönetici).
// Metrikler: online üye, aktif/bugünkü oyun, toplam/devam eden/tamamlanan
// maç, günlük-haftalık-aylık yeni üye, 7 günde aktif üye.
app.get('/api/admin/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const now = Date.now();
  const DAY = 86400000, WEEK = 7 * DAY, MONTH = 30 * DAY;
  const onlineUsers = (authApi && typeof authApi.onlineCount === 'function') ? authApi.onlineCount() : 0;
  let activeGames = 0, ongoingMatches = 0, totalGames = ALL_GAMES.length;
  try {
    const playingGames = new Set();
    for (const r of rooms.values()) {
      if (r.status === 'playing') { ongoingMatches++; playingGames.add(r.gameId); }
    }
    activeGames = playingGames.size;
  } catch (_) {}
  let totalMatches = 0, completedMatches = 0, gamesToday = 0, activeUsers = 0, totalUsers = 0;
  let newUsersToday = 0, newUsersWeek = 0, newUsersMonth = 0;
  if (db) {
    try {
      totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      const c = db.prepare('SELECT COUNT(*) c FROM matches').get().c;
      totalMatches = c; completedMatches = c;
      gamesToday = db.prepare('SELECT COUNT(*) c FROM matches WHERE ts >= ?').get(now - DAY).c;
      newUsersToday = db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(now - DAY).c;
      newUsersWeek = db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(now - WEEK).c;
      newUsersMonth = db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(now - MONTH).c;
      // 7 günde en az 1 maçı olan AYRIK üye adedi (son 500 maç taramasıyla):
      const recent = db.prepare('SELECT players FROM matches WHERE ts >= ? ORDER BY ts DESC LIMIT 500').all(now - WEEK);
      const seen = new Set();
      for (const m of recent) {
        try { (JSON.parse(m.players) || []).forEach(p => { if (p && p.id != null) seen.add(p.id); }); } catch (_) {}
      }
      activeUsers = seen.size;
    } catch (e) { console.warn('stats hatası:', e.message); }
  }
  res.json({
    ok: true,
    stats: {
      onlineUsers,
      totalGames,
      activeGames,
      activeUsers,
      totalUsers,
      gamesToday,
      totalMatches,
      ongoingMatches,
      completedMatches,
      newUsersToday,
      newUsersWeek,
      newUsersMonth,
      now
    }
  });
});

// Çevrimiçi durum haritalaması (arkadaş listesi / profil bayrakları).
// NEDEN BURADA: çevrimiçi durum Render'ın soket haritasında yaşar; Yöncü
// PHP'si bunu bilemez. Yeni mimaride tarayıcı üyelik uçlarına PHP'ye
// doğrudan gittiği için eskiden Render proxy'sinin yaptığı online
// birleştirmesi ISTEMCİ tarafına taşındı: istemci /api/friends (PHP) +
// bu uç (Render) yan yana çağırıp bayrakları kendisi birleştirir.
// Bu uç hiçbir PHP çağrısı yapmaz → DDoS korumasından etkilenmez.
// Yetki: doğrulanmış üye (öncelik: imzalı attest belgesi; yedek: token).
app.post('/api/online-status', async (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids)
    ? req.body.ids.map(x => Number(x)).filter(n => Number.isInteger(n) && n > 0).slice(0, 100)
    : [];
  const online = {};
  if (!ids.length || !authApi || typeof authApi.isOnline !== 'function') {
    return res.json({ ok: true, online });
  }
  // Kimlik doğrulaması (attest PHP'siz çalışır; token yedek).
  let member = null;
  if (authApi && typeof authApi.verifyIdentityFull === 'function') {
    try {
      const full = await authApi.verifyIdentityFull({
        token: (req.body && req.body.token) || null,
        attestation: (req.body && req.body.attestation) || null
      });
      member = full && full.uid ? full.uid : null;
    } catch (_) {}
  }
  if (!member) return res.json({ ok: true, online }); // üyesiz: boş harita (bayraklar sızmasın)
  ids.forEach(id => { online[id] = authApi.isOnline(id); });
  res.json({ ok: true, online });
});

// Kamuya açık teşhis nabzı: üyelik katmanının hangi modda çalıştığını söyler
// (gizli veri yok). "Özel masa kurulamıyor" gibi vakalarda uzaktan bakım için.
app.get('/api/gv-health', (req, res) => {
  res.json({
    ok: true,
    memberReady: !!(authApi && typeof authApi.verifyToken === 'function'),
    privateRooms: true,
    time: Date.now()
  });
});

// PHP bağlantı testi: arkadaş listesi neden boş sorusunu yanıtlar.
// 3 sn'de timeout olur; istemci bu route'u çağırarak PHP'nin canlı
// olup olmadığını teyit edebilir.
app.get('/api/_php_probe', async (req, res) => {
  if (!authApi || !authApi.verifyToken) return res.json({ ok: false, reason: 'auth not ready' });
  const auth = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const token = auth && auth[1] ? String(auth[1]) : (req.headers['x-gv-token'] ? String(req.headers['x-gv-token']) : '');
  if (!token) return res.json({ ok: false, reason: 'no token' });
  const t0 = Date.now();
  try {
    const uid = await authApi.verifyToken(token);
    res.json({ ok: !!uid, uid: uid || null, ms: Date.now() - t0, tokenLen: token.length });
  } catch (e) {
    res.json({ ok: false, error: e && e.message, ms: Date.now() - t0 });
  }
});

// PHP bağlantı testi (TOKEN GEREKTİRMEYEN): istemci giriş yapmasa bile
// PHP'nin canlı olup olmadığını ve ne cevap verdiğini görsün. PHP URL'si
// yanlışsa veya PHP çalışmıyorsa kök neden budur. F12'de:
//   fetch('/api/_php_ping').then(r=>r.json()).then(console.log)
app.get('/api/_php_ping', async (req, res) => {
  const remote = require('./auth-remote');
  if (!remote.enabled() || !remote.REMOTE) {
    return res.json({ ok: false, reason: 'GV_AUTH_API env tanımsız veya boş', remote: '' });
  }
  const t0 = Date.now();
  try {
    // PHP'ye basit bir GET — action=ping yoksa 400/404 döner, ama
    // bağlantının canlı olduğunu gördüğümüzde sorun PHP'nin iç mantığında.
    const r = await fetch(remote.REMOTE + '/auth.php?action=ping', {
      method: 'GET',
      signal: AbortSignal.timeout(4000)
    });
    let body = '';
    try { body = await r.text(); } catch (_) {}
    res.json({
      ok: r.ok,
      status: r.status,
      contentType: r.headers.get('content-type') || '',
      bodyPreview: String(body).slice(0, 200),
      ms: Date.now() - t0,
      remote: remote.REMOTE
    });
  } catch (e) {
    res.json({
      ok: false,
      error: e.name === 'TimeoutError' || e.name === 'AbortError' ? 'PHP timeout (4 sn)' : (e.message || String(e)),
      ms: Date.now() - t0,
      remote: remote.REMOTE
    });
  }
});

// Ayarlar → hazır masalar → dinleme. Uzak modda ayarların Yöncü'den
// gelmesi (en fazla 4 sn) beklenir; erişilemezse varsayılanlarla kurulur.
async function start(port) {
  if (process.env.GV_AUTH_API) await loadPresetConfigRemote();
  else loadPresetConfigLocal();
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

module.exports = { app, server, io, rooms, start, listPublicRooms, publicRoom, seedPresetTables,
  // Yönetici (kurucu) paneli + hazır masa yönetimi (testler için de export):
  ALL_GAMES, STANDARD_PRESET_GAMES, PRESET_GAME_BASES, defaultPresetConfig, normPresetConfig,
  presetTablesFromConfig, applyPresetConfig, loadPresetConfigLocal, savePresetConfigLocal, gameVisible };
// Eski test uyumluluğu: PRESET_TABLES artık yapılandırmadan üretilir.
Object.defineProperty(module.exports, 'PRESET_TABLES', { get: () => presetTablesFromConfig(presetConfig) });
