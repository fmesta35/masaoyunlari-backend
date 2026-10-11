// GameVerse - Render gerçek zamanlı oyun sunucusu
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const scoring = require('./scoring');   // puan/ceza kuralları (tek doğruluk kaynağı)
const ai = require('./ai-player');      // terk eden oyuncunun yerine idareten oynayan yapay zekâ
const { Chess } = require('chess.js');
const tavlaEngine = require('./tavla-engine');
const pistiEngine = require('./pisti-engine');
const batakEngine = require('./batak-engine');
const damaEngine = require('./dama-engine');
const turkDamaEngine = require('./turkdamasi-engine');
const reversiEngine = require('./reversi-engine');
const gomokuEngine = require('./gomoku-engine');
/* TOMBALA — saf motor (tombala-engine.js). Çekiliş zamanlayıcısı burada
   işler, oyuncu hamlesi yoktur: oyun tamamen şansa dayanır. */
let tombalaEngine = null;
try { tombalaEngine = require('./tombala-engine.js'); } catch (_) {}
const kelimelikEngine = require('./kelimelik-engine');
/* ADAM ASMACA — saf motor (adamasmaca-engine.js). Kelime sunucuda saklanır,
   tahminciye yalnız maske gider; sözlük denetimi Kelimelik'in TDK
   sözlüğünden gelir (iki oyun aynı listeyi paylaşır). */
const adamasmacaEngine = require('./adamasmaca-engine.js');
/* PASSAPAROLA — saf motor (passaparola-engine.js). Soru havuzu, doğru cevap
   ve iki oyuncunun saati sunucudadır; istemci yalnız soruyu ve maskeyi görür. */
const passaparolaEngine = require('./passaparola-engine.js');
/* CENGA — saf motor (cenga-engine.js). Kule kuralları, denge analizi ve
   çekişin GİZLİ HEDEFİ sunucudadır; istemci hedefi hiç görmez. */
const cengaEngine = require('./cenga-engine.js');
/* LANGIRT — saf fizik (langirt-engine.js). Fizik SUNUCUDA sabit 50 Hz
   adımlarla işler; istemciler yalnız çubuk hedefi ve şut gönderir. */
const langirtEngine = require('./langirt-engine.js');
/* HAVA HOKEYİ — saf fizik (havahokeyi-engine.js). Langırt gibi gerçek
   zamanlı; fizik sunucuda 120 Hz işler (disk çok hızlanıyor, 50 Hz'de
   tokmağın içinden geçiyordu). */
const havahokeyiEngine = require('./havahokeyi-engine.js');
/* FARK BULMACA — saf motor (fark-engine.js) + ortak sahneler
   (js/fark-sahneler.js, istemciyle AYNI dosya). Sahne, tohum ve tıklama
   doğrulaması sunucuda. */
const farkEngine = require('./fark-engine.js');
/* KIZMA BİRADER (Ludo) — saf motor (kizmabirader-engine.js). ZAR SUNUCUDA
   atılır; istemci yalnız "at" ve "şu piyonu oyna" der. */
const kizmaEngine = require('./kizmabirader-engine.js');
/* METROPOL (Monopoly türevi) — saf motor (metropol-engine.js). Zar, kira,
   kart destesi ve iflas hesabı SUNUCUDA; istemci yalnız düğmeye basar.
   ÇEVRİMİÇİ SAPMA: prototipteki canlı açık artırma yerine, sıradaki oyuncu
   kareyi almazsa diğerlerine SIRAYLA liste fiyatından TEK TUR teklif edilir
   (bkz. metropol-engine.js → reddet). Canlı artırma 4 kişilik bir masayı
   dakikalarca kilitlediği için böyle uyarlandı. */
const metropolEngine = require('./metropol-engine.js');
const kelimelikBildirim = require('./kelimelik-bildirim');
const connect4Engine = require('./connect4-engine');
const bilardoEngine = require('./bilardo-engine');
const battleshipEngine = require('./battleship-engine');
const { db } = require('./db'); // kurucu paneli: üye listesi + masa ayarları (SQLite, yerel mod)
const playCounts = require('./play-counts'); // gerçek "kaç kez oynandı" sayaçları (mod bağımsız)
// İmzalı kimlik belgesi doğrulayıcı (modül seviyesinde, mod bağımsız) —
// requireAdmin() bunu Kurucu Paneli uçlarını Yöncü DDoS korumasından
// bağımsız kılmak için kullanır (bkz. requireAdmin tanımı aşağıda).
const { verifyAttestation } = require('./server-auth');

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
// PWA manifest: Content-Type kesin application/manifest+json olmalı
// (eski default text/plain yerine). Ayrıca static dosyalar cache'ini
// kapat ki deploy sonrası eski manifest.json tarayıcıda kalmasın.
const nodePath = require('path');
app.get('/manifest.json', (_req, res) => {
  res.set('Content-Type', 'application/manifest+json');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(nodePath.join(__dirname, 'manifest.json'));
});

// ---- İSTEMCİ DOSYALARI: yalnız tarayıcının gerçekten istediği yollar ----
// ⚠ GÜVENLİK: Burada eskiden express.static(__dirname) vardı ve DEPONUN
// TAMAMINI yayınlıyordu. server.js / server-auth.js / db.js kaynak kodu,
// yoncu-api/*.php dosyaları ve (yerel modda) data/gameverse.db dahil her
// şey https://sunucu/<yol> adresinden indirilebiliyordu. Artık yalnızca
// js/, css/ ve assets/ klasörleri + index.html + manifest.json servis
// edilir; başka hiçbir depo dosyası dışarıdan erişilebilir değildir.
const staticOpts = {
  fallthrough: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.json')) res.set('Content-Type', 'application/json');
    if (filePath.endsWith('.js')) res.set('Content-Type', 'application/javascript');
  }
};
for (const dir of ['js', 'css', 'assets']) {
  app.use('/' + dir, express.static(nodePath.join(__dirname, dir), staticOpts));
}
// ---- MOBİL UYGULAMA (PWA / Android TWA) KÖK DOSYALARI ----
// Statik servis js/, css/, assets/ ile sınırlandığı için bu iki dosyanın
// kökten servis edilmesi AÇIKÇA tanımlanır. İkisi de kök yolda olmak
// ZORUNDADIR: servis çalışanı kökten yayınlanmazsa tüm siteyi
// kapsayamaz, assetlinks.json kökte olmazsa Android uygulaması alan adı
// sahipliğini doğrulayamaz ve adres çubuğunu gizleyemez.
app.get('/sw.js', (_req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.set('Service-Worker-Allowed', '/');
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(nodePath.join(__dirname, 'sw.js'));
});
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.set('Content-Type', 'application/json');
  res.sendFile(nodePath.join(__dirname, '.well-known', 'assetlinks.json'));
});
/* GİZLİLİK POLİTİKASI — Google Play BAŞVURU ŞARTI: mağaza kaydında herkese
   açık bir gizlilik politikası adresi verilmek zorunda ve o adres uygulama
   içinden de erişilebilir olmalı. Ayrı bir HTML sayfası olarak duruyor
   (tek sayfalık uygulamanın içine gömülseydi Play'in robotu göremezdi:
   metin JavaScript çalışmadan ekrana gelmiyor). */
app.get('/gizlilik-politikasi.html', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(nodePath.join(__dirname, 'gizlilik-politikasi.html'));
});

/* HESAP SİLME SAYFASI — Google Play "Veri güvenliği" formu, hesap açılabilen
   her uygulamadan hesabın ve ilişkili verilerin silinmesini talep etmek için
   AYRI BİR ADRES ister (e-posta tek başına yetmiyor; form bir URL istiyor).
   Politika gibi düz HTML: Play'in incelemecisi JavaScript çalıştırmadan okur. */
app.get('/hesap-silme.html', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(nodePath.join(__dirname, 'hesap-silme.html'));
});

app.get(['/', '/index.html'], (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(nodePath.join(__dirname, 'index.html'));
});

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
const MAX_PLAYERS_BY_GAME = { okey: 4, okey101: 4, pisti: 4, batak: 4, tombala: 6, kizmabirader: 4, metropol: 4 };
/* Oyunun EN AZ kaç kişiyle oynanabildiği. Bir oyuncu ayrılıp masa küçülünce
   "devam edelim mi" oylamasında buna bakılır: batak 3 kişinin altına
   inemez (ihale/koz mantığı iki kişilik değildir), diğerleri 2'ye iner. */
const MIN_PLAYERS_BY_GAME = { okey: 2, okey101: 2, pisti: 2, batak: 3, tombala: 2, kizmabirader: 2, metropol: 2 };
function minOyuncu(gameId) { return MIN_PLAYERS_BY_GAME[gameId] || 2; }
const ONLINE_CARD_GAMES = new Set(['pisti', 'batak']);
const ONLINE_BOARD_GAMES = new Set(['dama','turkdamasi','reversi']);
// Amiral Battı 2 kişilik oynanır (MAX_ROOM_PLAYERS varsayılanı yeterli),
// ek bir maxPlayers girdisine gerek yok.
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
const RECONNECT_GRACE_MS = Number(process.env.GV_RECONNECT_GRACE_MS) || 30000;

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
  //
  // ⚠ ÇÖKME DÜZELTMESİ: bu döngü eskiden `const t`'ye değer atıyordu
  // ("t = undefined"). Mesajın SON parçası tek harfliyse (ör. "tamam o",
  // ya da rakam katlaması sonrası "...-1" → "i") bu satır
  // "TypeError: Assignment to constant variable" fırlatıp SUNUCU SÜRECİNİ
  // düşürüyordu — sıradan bir sohbet mesajıyla tetiklenen gerçek bir
  // çökme yoluydu. Döngü artık son turu (i === tokens.length) sanal bir
  // "ayraç" sayar ve biriken zinciri orada sınar; hiçbir değişkene yeniden
  // atama yapılmaz.
  let run = '';
  for (let i = 0; i <= tokens.length; i++) {
    const t = i < tokens.length ? tokens[i] : null;   // son tur: zinciri kapat
    if (t && t.length === 1) { run += t; continue; }
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
// ============================================================================
// ÜYE YAPTIRIMLARI — SOHBET KISITLAMASI (susturma)
// ============================================================================
// Kurucu bir üyeyi susturduğunda o üye HEM oyun içi (masa) HEM genel
// sohbete yazamaz. Kalıcı kayıt üyelik katmanındadır (yerelde SQLite,
// üretimde Yöncü MySQL); burada yalnızca UYGULAMA ve küçük bir ÖNBELLEK
// vardır — her mesajda veritabanına/PHP'ye gidilmez.
//
// Önbellek sözleşmesi:
//   yok            → hiç sorulmadı (ilk mesajda sorulur)
//   { bitis:null } → SÜRESİZ susturma
//   { bitis:ts }   → ts anına kadar susturma (ts geçince kendiliğinden düşer)
//   { yok:true }   → yaptırım YOK (negatif önbellek, TTL kadar geçerli)
const SANCTION_TTL_MS = Number(process.env.GV_SANCTION_TTL_MS) || 60000;
const sanctionCache = new Map();   // uid -> { yok?, bitis, sebep, ts }

function sanctionCacheSet(uid, y) {
  uid = Number(uid);
  if (!(uid > 0)) return;
  if (!y) sanctionCache.set(uid, { yok: true, ts: Date.now() });
  else sanctionCache.set(uid, { yok: false, bitis: (y.bitis == null ? null : Number(y.bitis)),
                                sebep: String(y.sebep || ''), ts: Date.now() });
}
function sanctionCacheDrop(uid) { sanctionCache.delete(Number(uid)); }

// Üyenin YÜRÜRLÜKTEKİ sohbet yaptırımı (yoksa null). Önbellek bayatsa
// üyelik katmanından tazelenir; uzak modda bu bir PHP çağrısıdır, o
// yüzden fonksiyon async'tir.
async function sohbetYaptirimi(uid) {
  uid = Number(uid);
  if (!(uid > 0)) return null;
  const c = sanctionCache.get(uid);
  const taze = c && (Date.now() - c.ts) < SANCTION_TTL_MS;
  if (taze) {
    if (c.yok) return null;
    if (c.bitis != null && c.bitis <= Date.now()) { sanctionCache.delete(uid); return null; }
    return { bitis: c.bitis, sebep: c.sebep };
  }
  let y = null;
  try {
    if (authApi && typeof authApi.yaptirimAktif === 'function') y = await authApi.yaptirimAktif(uid, 'chat');
  } catch (_) { y = null; }
  // Süresi dolmuşsa yok say (kalıcı katman da böyle sayar).
  if (y && y.bitis != null && Number(y.bitis) <= Date.now()) y = null;
  sanctionCacheSet(uid, y);
  return y ? { bitis: (y.bitis == null ? null : Number(y.bitis)), sebep: String(y.sebep || '') } : null;
}

// "1 gün 3 saat" gibi insan okunur kalan süre (bildirim ve ret mesajları).
function sureMetni(ms) {
  ms = Math.max(0, Math.round(Number(ms) || 0));
  const dk = Math.floor(ms / 60000);
  const gun = Math.floor(dk / 1440), saat = Math.floor((dk % 1440) / 60), kalanDk = dk % 60;
  if (gun >= 365) { const y = Math.floor(gun / 365); return y + ' yıl' + (gun % 365 ? ' ' + (gun % 365) + ' gün' : ''); }
  if (gun > 0) return gun + ' gün' + (saat ? ' ' + saat + ' saat' : '');
  if (saat > 0) return saat + ' saat' + (kalanDk ? ' ' + kalanDk + ' dakika' : '');
  return Math.max(1, kalanDk) + ' dakika';
}
function yaptirimBitisMetni(bitis) {
  if (bitis == null) return 'süresiz (kurucu kaldırana kadar)';
  const d = new Date(Number(bitis));
  return sureMetni(Number(bitis) - Date.now()) + ' (' +
    d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) +
    ' tarihine kadar)';
}
// Kullanıcının mesaj kutusunda göreceği AÇIKLAYICI metin.
function yaptirimAciklama(y) {
  const sebep = y && y.sebep ? ' Gerekçe: ' + y.sebep : '';
  return '🔇 Sohbet yetkiniz kısıtlandı — oyun içi ve genel sohbete mesaj gönderemezsiniz. ' +
         'Kalan süre: ' + yaptirimBitisMetni(y ? y.bitis : null) + '.' + sebep;
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
// Amiral Battı'da filo YERLEŞTİRME ayrı bir bütçedir: 5 gemiyi sürükleyip
// yerleştirmek bir hamleden uzun sürer. Hamle saati ancak muharebe faz
// başladığında devreye girer (bkz. battleshipPlace işleyicisi).
const BATTLESHIP_PLACE_MS = Number(process.env.GV_BATTLESHIP_PLACE_MS) || 90000;
const PISTI_TURN_MS = Number(process.env.GV_PISTI_TURN_MS) || 30000;
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
// Kurucu e-postası: artık VARSAYILAN YOK. Kurucu yetkisi öncelikle
// veritabanındaki is_founder bayrağından gelir; bu değişken yalnızca
// ek/yedek bir eşleşme yoludur. (Eskiden 'kurucu@kurucu.com' sabitti ve
// o hesap sabit "kurucu123" şifresiyle otomatik açılıyordu.)
const ADMIN_EMAIL = String(process.env.GV_ADMIN_EMAIL || '').trim().toLowerCase();
const ALL_GAMES = ['chess', 'tavla', 'okey', 'okey101', 'pisti', 'batak',
  'dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo', 'battleship', 'kelimelik',
  'tombala', 'adamasmaca', 'passaparola', 'cenga', 'langirt', 'havahokeyi', 'fark', 'kizmabirader',
  'metropol'];

/* ===================== HAMLE SÜRESİ (masa başına) =====================
   Kullanıcı isteği: "kurucu panelinde masa düzenlemeler bölümünde oyun
   süresi ayarlanabildiği gibi hamle süreleri de düzenlenebilsin... Hamle
   süreleri ilgili oyundaki tüm oyuncular için geçerli olacak."

   TASARIM: hamle süresi artık MASANIN bir alanı (room.moveLimitMs).
   Kurucu masa satırında saniye olarak girer; girmezse oyunun varsayılanı
   kullanılır. Masadaki herkes aynı süreyi görür, çünkü süre oyuncuya değil
   ODAYA bağlı — durum paketleri bunu moveLimitOf(room) üzerinden okur.

   HER OYUNDA geçerlidir — satranç ve tavla dahil. Bir ara bu ikisi dışarıda
   bırakılmıştı ("ana saatleri var" diye); oysa onlarda da hamle başına
   hükmen mağlubiyet sayacı hep vardı, yalnız 60 sn'ye SABİTLENMİŞTİ ve
   kurucu değiştiremiyordu. Artık süre tek yerden (odaHamleMs) geliyor ve
   kurucunun girdiği değer bütün oyunlarda aynı şekilde uygulanıyor. */
const HAMLE_SN_MIN = 5;
const HAMLE_SN_MAX = 600;

function hamleSaniyeTemizle(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;              // 0 = varsayılanı kullan
  return Math.max(HAMLE_SN_MIN, Math.min(HAMLE_SN_MAX, n));
}

/* Bir oyunun hamle süresi VARSAYILANI (ms). Kurucu masaya özel değer
   girmediğinde bu kullanılır — yani eski davranış birebir korunur. */
function varsayilanHamleMs(gameId, durationMinutes) {
  if (gameId === 'kelimelik') {
    /* Kelimelik'te ana saat yok; masa tipi hamle süresini belirler:
       ⚡ 10 dk → 30 sn · ♟️ 15 dk → 45 sn · 🧠 20 dk → 60 sn */
    return ({ 10: 30000, 15: 45000, 20: 60000 })[durationMinutes] || 45000;
  }
  if (gameId === 'adamasmaca') {
    /* Adam Asmaca'da tek bir hamle süresi iki iş görür: kelime seçmek ve
       harf tahmin etmek. Harf tahmini saniyeler sürer, kelime seçmek daha
       uzun; bu yüzden süre Kelimelik'ten bir tık cömert tutuldu.
       ⚡ 10 dk → 45 sn · ♟️ 15 dk → 60 sn · 🧠 20 dk → 90 sn */
    return ({ 10: 45000, 15: 60000, 20: 90000 })[durationMinutes] || 60000;
  }
  if (gameId === 'passaparola') {
    /* Passaparola'da oyuncu başına AYRI bir saat işler (masa süresine göre
       90/120/180 sn). Genel hamle sayacı buna karışmaz; yine de bir üst
       sınır gerekiyor — tek bir soruda sonsuza kadar beklenmesin diye
       oyuncunun kendi saatinin tamamı kadar süre tanınır. */
    return ({ 10: 90000, 15: 120000, 20: 180000 })[durationMinutes] || 120000;
  }
  if (gameId === 'cenga') {
    /* Cenga'da bir sıra iki adımdır (taş seç → çek); süre ikisi için
       birden işler. ⚡ 10 dk → 30 sn · ♟️ 15 dk → 45 sn · 🧠 20 dk → 60 sn */
    return ({ 10: 30000, 15: 45000, 20: 60000 })[durationMinutes] || 45000;
  }
  if (gameId === 'metropol') {
    /* Metropol'de bir sıra üç adıma kadar sürer (zar at → al/reddet →
       turu bitir); süre üçü için birden işler, bu yüzden cömert tutuldu.
       ⚡ 10 dk → 45 sn · ♟️ 15 dk → 60 sn · 🧠 20 dk → 90 sn */
    return ({ 10: 45000, 15: 60000, 20: 90000 })[durationMinutes] || 60000;
  }
  if (gameId === 'okey' || gameId === 'okey101') return OKEY_TURN_MS;
  if (gameId === 'pisti') return PISTI_TURN_MS;
  return MOVE_FORFEIT_MS;
}
function varsayilanHamleSn(gameId, durationMinutes) {
  const ms = varsayilanHamleMs(gameId, durationMinutes);
  return ms ? Math.round(ms / 1000) : 0;
}

/* Bir masanın GERÇEK hamle süresi (ms): kurucunun girdiği değer, yoksa
   oyunun varsayılanı. TEK YERDEN hesaplanır — createRoom, applyPresetConfig
   ve durum paketleri aynı kuralı uygulasın diye. */
function odaHamleMs(gameId, moveSeconds, durationMinutes) {
  const sn = hamleSaniyeTemizle(moveSeconds);
  return sn > 0 ? sn * 1000 : varsayilanHamleMs(gameId, durationMinutes);
}

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
  dama: 401, turkdamasi: 501, reversi: 601, gomoku: 701, connect4: 801, bilardo: 921,
  battleship: 1001, kelimelik: 1101,
  /* "Diğer Oyunlar"dan taşınan oyunlar 2000'li bloğa alındı: 1400-1700
     aralığını test süiti ÖZEL ODA kimliği olarak kullanıyor (örn. 1501,
     1601) ve hazır masa oraya düşerse özel oda hiç yaratılamıyordu. */
  adamasmaca: 2001, passaparola: 2101, cenga: 2201, langirt: 2301, havahokeyi: 2401, fark: 2501
};
const STANDARD_PRESET_GAMES = Object.keys(PRESET_GAME_BASES);
/* Okey ve 101 Okey'in hazır masaları "taban ID + indeks" şemasını DEĞİL,
   kendi (kişi sayısı × el/süre) kombinasyon şemasını kullanır; bu yüzden
   STANDARD listesinde değiller. Eskiden panel bunu "yapı sabit" sayıp
   yalnız görünürlük düğmesi gösteriyordu (kullanıcı raporu: "okey ve 101
   okey'in masa düzenlerinde masa artırma ve eksiltme düzeltme ayarları
   yok"). Artık kurucu bunların da masasını ekleyip çıkarabiliyor; sunucu
   tarafı zaten destekliyordu (bkz. normPresetConfig). */
const FIXED_PRESET_GAMES = ['okey', 'okey101', 'tombala', 'kizmabirader', 'metropol'];

/* Masa satırı kişi sayısı ve el sayısı da taşıyan oyunlar. Panel bunlara
   ek sütun çizer; normPresetConfig bu alanları korur. */
const MANAGED_CARD_GAMES = ['okey', 'okey101', 'pisti', 'batak', 'tombala', 'kizmabirader', 'metropol'];

/* Bu oyunların masa kimlikleri için AYRILMIŞ aralıklar. Kurucu varsayılan
   masa sayısının üstüne masa eklediğinde yeni kimlik buradan verilir;
   aralıklar çakışmadığı için iki oyunun masası asla aynı odaya düşmez.
   (Aralığın uzunluğu aynı zamanda o oyunun masa sayısı üst sınırıdır.) */
const CARD_TABLE_RANGE = {
  okey:    [301, 330],   // varsayılan 18 masa (301-318) + 12 boş
  /* 101 OKEY — kullanıcı raporu: "masa ekleme butonu kapalı, masa sayısı da
     10 diyor ama 5". Eski aralık yalnız 10 kimlikti (331-340) ve varsayılan
     6 masa onun 6'sını doluyordu; panel ➕ düğmesini 10'da kilitliyordu.
     331-360 arası pisti'ye bitişik olduğu için genişletilemiyordu, bu yüzden
     101 Okey ÇAKIŞMAYAN yeni bir bloğa taşındı: artık okey ile aynı
     kapasitede (40 kimlik) ve varsayılanı da okeyinki gibi 18 masa. */
  okey101: [1201, 1240], // varsayılan 18 masa (1201-1218) + 22 boş
  pisti:   [341, 360],   // varsayılan 18 masa (341-358) +  2 boş
  batak:   [361, 400],   // varsayılan  6 masa (361-366) + 34 boş
  /* TOMBALA: 2-6 kişilik; ikinci değer çekiliş aralığıdır (saniye). */
  tombala: [1301, 1340],  // varsayılan 16 masa (1301-1316) + 24 boş
  /* KIZMA BİRADER: 2/3/4 kişilik; ikinci değer hamle süresi (saniye). */
  kizmabirader: [2601, 2640],  // varsayılan 12 masa (2601-2612) + 28 boş
  /* METROPOL: 2/3/4 kişilik; ikinci değer TUR LİMİTİdir. Limit dolduğunda
     en yüksek varlığa sahip oyuncu kazanır — masa sonsuza kadar sürmesin. */
  metropol: [2701, 2740]  // varsayılan 12 masa (2701-2712) + 28 boş
};
/* 101 Okey'in ESKİ varsayılan kimlikleri. Kayıtlı yapılandırma hâlâ bu altı
   masadan ibaretse (kurucu hiç dokunmamış demektir) yeni 18'li düzene
   kendiliğinden geçilir; kurucu masaları değiştirmişse elleşilmez. */
const OKEY101_ESKI_IDLER = ['331', '332', '333', '334', '335', '336'];
function cardTableLimit(g) {
  const r = CARD_TABLE_RANGE[g];
  return r ? (r[1] - r[0] + 1) : 40;
}

function clampDuration(v, dflt) {
  const n = Math.floor(Number(v));
  return (Number.isFinite(n) && n >= 1 && n <= 240) ? n : (dflt || 10);
}

// Bir oyunun VARSAYILAN 10 masası (isim + tip + süre):
function defaultTablesFor(gameId) {
  const base = PRESET_GAME_BASES[gameId];
  const out = [];
  for (const t of PRESET_TYPES) {
    out.push({ name: `${t.label} Masa #${base + out.length}`, type: t.type,
               durationMinutes: t.durationMinutes,
               /* 0 = "oyunun varsayılanını kullan". Varsayılanı buraya SAYI
                  olarak yazmak cazip görünüyor ama kayıplı: saniyeye
                  yuvarlanıp 5-600 aralığına kırpılıyor, yani varsayılanı
                  kendi sınırlarımıza hapsediyor. Panel zaten varsayılanı
                  kutunun placeholder'ında gösteriyor (sema.hamleVarsayilan). */
               moveSeconds: 0 });
  }
  return out;
}

function defaultPresetConfig() {
  const cfg = {};
  for (const g of STANDARD_PRESET_GAMES) cfg[g] = { visible: true, tables: defaultTablesFor(g) };
  for (const g of FIXED_PRESET_GAMES) cfg[g] = { visible: true, tables: managedCardTables(g) };
  // Kart oyunları güvenli varsayılan: online kapalı; kurucu açınca seed edilir.
  cfg.pisti = { visible: true, tables: managedCardTables('pisti') };
  cfg.batak = { visible: true, tables: managedCardTables('batak') };
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
    const isManagedCardGame = MANAGED_CARD_GAMES.includes(g);
    if (isManagedCardGame && Array.isArray(src.tables)) {
      const defs = managedCardTables(g);
      const bas = (CARD_TABLE_RANGE[g] || [1])[0];
      /* ⚠ KİMLİK ÇAKIŞMASI: eskiden varsayılandan FAZLA masa eklendiğinde
         `defs[defs.length-1]` kullanılıyor ve yeni masa SON varsayılanın
         kimliğini alıyordu; iki masa aynı odaya çöküyordu. Artık kimliksiz
         satıra, oyuna ayrılmış aralıktan indekse karşılık gelen benzersiz
         kimlik verilir (bkz. CARD_TABLE_RANGE). */
      /* 101 OKEY GEÇİŞİ: kayıtlı yapılandırma hâlâ eski 6'lı varsayılansa
         (kurucu hiç dokunmamış) yeni 18'li düzene geç. Kurucu masaları
         değiştirmişse — sayı farklıysa ya da kimlikler eski küme değilse —
         hiçbir şeye dokunulmaz. */
      if (g === 'okey101' && src.tables.length === OKEY101_ESKI_IDLER.length &&
          src.tables.every((x, i) => String((x && x.id) || '') === OKEY101_ESKI_IDLER[i])) {
        cfg[g].tables = defs;
        continue;
      }
      const t = src.tables.slice(0, cardTableLimit(g)).map((x,i) => { const d=defs[i]||{}; x=x&&typeof x==='object'?x:{}; return {id:String(x.id||d.id||(bas+i)),name:String(x.name||d.name||('Masa #'+(bas+i))).slice(0,60),type:(x.type==='fast'||x.type==='thinker')?x.type:'normal',durationMinutes:clampDuration(x.durationMinutes,d.durationMinutes||10),moveSeconds:hamleSaniyeTemizle(x.moveSeconds!==undefined?x.moveSeconds:d.moveSeconds),maxPlayers:Math.max(2,Math.min(Number(x.maxPlayers||d.maxPlayers||2),g==='tombala'?6:4)),rounds:Number(x.rounds||d.rounds)||undefined}; });
      if (t.length) cfg[g].tables=t;
    }
    // ⚠ HATA DÜZELTMESİ: pisti/batak HEM yukarıdaki "yönetilen kart oyunu"
    // listesinde HEM DE STANDARD_PRESET_GAMES'te (PRESET_GAME_BASES'te taban
    // ID'leri var: pisti 341, batak 361) yer alıyordu. Bu yüzden bu ikinci
    // blok pisti/batak için de çalışıyor ve yukarıda doğru şekilde
    // yeniden şekillendirilmiş {id,gameId,maxPlayers,rounds,...} nesnelerini
    // id'SİZ {name,type,durationMinutes} nesneleriyle EZİYORDU. Sonuç:
    // presetTablesFromConfig() tüm masalar için id="undefined" üretiyor,
    // bunların hepsi TEK bir odaya çöküyor ve Kurucu Paneli'nde herhangi bir
    // "Kaydet ve Uygula" (pişti/batak'a hiç dokunulmasa bile — settingsCache
    // her zaman TÜM oyunları gönderir) 18 pişti + 6 batak hazır masasını
    // SİLİYORDU. Düzeltme: bu blok artık yalnız GERÇEKTEN "taban ID + indeks"
    // şemasını kullanan standart oyunlarda (satranç, tavla, dama, ...) çalışır.
    if (STANDARD_PRESET_GAMES.includes(g) && !isManagedCardGame && Array.isArray(src.tables)) {
      const base = PRESET_GAME_BASES[g];
      const dflt = defaultTablesFor(g);
      const t = src.tables.slice(0, 30).map((x, i) => {
        const d = dflt[i] || { name: `Masa #${base + i}`, type: 'normal', durationMinutes: 15 };
        x = x && typeof x === 'object' ? x : {};
        return {
          name: String(x.name || d.name).slice(0, 60),
          type: (x.type === 'fast' || x.type === 'thinker') ? x.type : 'normal',
          durationMinutes: clampDuration(x.durationMinutes, d.durationMinutes),
          /* 0 ya da geçersiz → oyunun varsayılanı kullanılır (bkz. createRoom). */
          moveSeconds: hamleSaniyeTemizle(x.moveSeconds !== undefined ? x.moveSeconds : d.moveSeconds)
        };
      });
      if (t.length) cfg[g].tables = t;
    }
  }
  return cfg;
}

// ---- Geçerli hazır-masa yapılandırması (bellek) ----
let presetConfig = defaultPresetConfig();

// ============================================================================
// POPÜLER OYUN SIRALAMASI (Kurucu Paneli) — kullanıcının isteği: "popüler oyun
// sıralaması kurucu tarafından kurucu panelinde sıralansın". Varsayılan
// ('auto') davranış DEĞİŞMEDİ: ana sayfa gerçek oynanma sayısına göre sıralar
// (bkz. play-counts.js). Kurucu 'manual' moda geçip elle bir sıra + kaç
// oyunun gösterileceğini (count) belirleyebilir.
//
// Kalıcılık, masa ayarlarıyla (presetConfig) AYNI kanaldan (Kurucu Paneli
// "Kaydet ve Uygula") yürür ama YENİ bir Yöncü PHP ucu GEREKTİRMEZ: panel
// bu ayarı `games` nesnesinin içine `_popular` anahtarıyla gizlice ekler —
// admin.php?action=gamesSave/gamesGet zaten HANGİ alanlar olduğuna
// bakmaksızın tüm `games` bloğunu ham JSON olarak saklayıp geri veriyor
// (bkz. yoncu-api/admin.php), o yüzden PHP tarafında değişiklik gerekmedi.
function defaultPopularConfig() { return { mode: 'auto', order: [], count: 0 }; } // count 0 = tümünü göster
function normPopularConfig(raw) {
  const out = defaultPopularConfig();
  if (!raw || typeof raw !== 'object') return out;
  if (raw.mode === 'manual') out.mode = 'manual';
  if (Array.isArray(raw.order)) {
    const seen = new Set();
    out.order = raw.order.map(x => String(x)).filter(id => ALL_GAMES.includes(id) && !seen.has(id) && seen.add(id));
  }
  const c = Math.floor(Number(raw.count));
  out.count = (Number.isFinite(c) && c >= 1 && c <= ALL_GAMES.length) ? c : 0;
  return out;
}
let popularConfig = defaultPopularConfig();

function loadPopularConfigLocal() {
  if (!db) return;
  try {
    const row = db.prepare("SELECT value FROM settings WHERE skey = 'popular_games_config'").get();
    if (row && row.value) {
      const d = JSON.parse(row.value);
      if (d && typeof d === 'object') popularConfig = normPopularConfig(d);
    }
  } catch (e) { console.warn('⚠️  Popüler oyun sıralaması okunamadı (varsayılan kullanılıyor):', e.message); }
}
function savePopularConfigLocal() {
  if (!db) return;
  try {
    db.prepare("INSERT INTO settings(skey, value, updated_at) VALUES('popular_games_config', ?, ?) " +
      "ON CONFLICT(skey) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(JSON.stringify(popularConfig), Date.now());
  } catch (e) { console.warn('⚠️  Popüler oyun sıralaması kaydedilemedi:', e.message); }
}

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
function managedCardTables(gameId) { const out=[]; let id=gameId==='okey'?301:gameId==='okey101'?1201:gameId==='pisti'?341:gameId==='tombala'?1301:gameId==='kizmabirader'?2601:gameId==='metropol'?2701:361; const combos=gameId==='okey'?[[2,3],[2,5],[2,7],[3,3],[3,5],[3,7],[4,3],[4,5],[4,7]]:gameId==='okey101'?[[2,10],[2,20],[2,30],[3,10],[3,20],[3,30],[4,10],[4,20],[4,30]]:gameId==='pisti'?[[2,1],[2,3],[2,5],[3,1],[3,3],[3,5],[4,1],[4,3],[4,5]]:gameId==='tombala'?[[2,5],[2,8],[3,5],[3,8],[4,5],[4,8],[6,5],[6,8]]:gameId==='kizmabirader'?[[2,15],[2,30],[3,15],[3,30],[4,15],[4,30]]:gameId==='metropol'?[[2,15],[2,25],[3,15],[3,25],[4,15],[4,25]]:[[4,3],[4,5],[4,7]];for(const [players,rounds] of combos)for(let n=0;n<2;n++){const rid=String(id++);const sure=gameId==='okey101'?rounds:gameId==='tombala'?10:gameId==='kizmabirader'?(rounds<=15?10:15):gameId==='metropol'?(rounds<=15?15:20):(rounds===3?(gameId==='okey'?10:15):(rounds===5?15:20));out.push({id:rid,gameId,maxPlayers:players,rounds,durationMinutes:sure,moveSeconds:(gameId==='tombala'||gameId==='kizmabirader')?rounds:varsayilanHamleSn(gameId,sure),type:(gameId==='tombala'||gameId==='kizmabirader')?(rounds<=15?'fast':'normal'):gameId==='metropol'?(rounds<=15?'normal':'thinker'):(rounds<=1?'fast':rounds>=7?'thinker':'normal'),name:`${players} Kişilik • ${rounds}${gameId==='okey101'?' dk':gameId==='tombala'?' sn çekiliş':gameId==='kizmabirader'?' sn hamle':gameId==='metropol'?' Tur':' El'} — Masa #${rid}`})}return out;}
function presetTablesFromConfig(cfg) {
  const out = [];
  for (const g of STANDARD_PRESET_GAMES) {
    const gc = cfg[g] || {};
    if (gc.visible === false) continue;
    if (g === 'pisti' || g === 'batak') { const defs=Array.isArray(gc.tables)&&gc.tables.length?gc.tables:managedCardTables(g); defs.forEach(t=>out.push({id:String(t.id),gameId:g,maxPlayers:Number(t.maxPlayers)||2,durationMinutes:clampDuration(t.durationMinutes,10),moveSeconds:hamleSaniyeTemizle(t.moveSeconds),rounds:g==='pisti'?Number(t.rounds)||1:undefined,name:String(t.name||('Masa #'+t.id)).slice(0,60)})); continue; }
    const base = PRESET_GAME_BASES[g];
    (gc.tables && gc.tables.length ? gc.tables : defaultTablesFor(g)).forEach((t, i) => {
      out.push({
        id: String(base + i),
        gameId: g,
        maxPlayers: g === 'batak' ? 4 : (g === 'pisti' ? 2 : 2),
        rounds: (g === 'pisti' ? [1,3,5][i % 3] : undefined),
        durationMinutes: clampDuration(t.durationMinutes, 10),
        moveSeconds: hamleSaniyeTemizle(t.moveSeconds),
        name: String(t.name || `Masa #${base + i}`).slice(0, 60)
      });
    });
  }
  /* TOMBALA: kişi sayısı 2-6 arası masa başına ayarlanabildiği için
     standart (kişi=2'ye sabit) yoldan değil, yönetilen masa yolundan geçer. */
  { const gc=cfg.tombala||{}; if (tombalaEngine && gc.visible!==false) {
      const defs=Array.isArray(gc.tables)&&gc.tables.length?gc.tables:managedCardTables('tombala');
      defs.forEach((t,i)=>out.push({id:String(t.id||(1301+i)),gameId:'tombala',
        maxPlayers:Math.max(2,Math.min(Number(t.maxPlayers)||2,6)),
        durationMinutes:clampDuration(t.durationMinutes,10),
        moveSeconds:hamleSaniyeTemizle(t.moveSeconds),
        name:String(t.name||('Masa #'+(t.id||i))).slice(0,60)}));
  } }
  /* KIZMA BİRADER: 2/3/4 kişilik; satırın ikinci degeri hamle suresidir. */
  { const gc=cfg.kizmabirader||{}; if (gc.visible!==false) {
      const defs=Array.isArray(gc.tables)&&gc.tables.length?gc.tables:managedCardTables('kizmabirader');
      defs.forEach((t,i)=>out.push({id:String(t.id||(2601+i)),gameId:'kizmabirader',
        maxPlayers:Math.max(2,Math.min(Number(t.maxPlayers)||2,4)),
        durationMinutes:clampDuration(t.durationMinutes,10),
        moveSeconds:hamleSaniyeTemizle(t.moveSeconds),
        name:String(t.name||('Masa #'+(t.id||i))).slice(0,60)}));
  } }
  /* METROPOL: 2/3/4 kişilik; satırın ikinci degeri TUR LİMİTİdir (rounds). */
  { const gc=cfg.metropol||{}; if (gc.visible!==false) {
      const defs=Array.isArray(gc.tables)&&gc.tables.length?gc.tables:managedCardTables('metropol');
      defs.forEach((t,i)=>out.push({id:String(t.id||(2701+i)),gameId:'metropol',
        maxPlayers:Math.max(2,Math.min(Number(t.maxPlayers)||2,4)),
        durationMinutes:clampDuration(t.durationMinutes,15),
        moveSeconds:hamleSaniyeTemizle(t.moveSeconds),
        rounds:Math.max(5,Math.min(Number(t.rounds)||15,60)),
        name:String(t.name||('Masa #'+(t.id||i))).slice(0,60)}));
  } }
  for (const g of ['okey','okey101']) { const gc=cfg[g]||{}; if(gc.visible===false || (!okeyEngine && process.env.GV_OKEY_PRESETS!=='1')) continue; const defs=Array.isArray(gc.tables)&&gc.tables.length?gc.tables:managedCardTables(g); defs.forEach((t,i)=>out.push({id:String(t.id||((g==='okey'?301:331)+i)),gameId:g,maxPlayers:Number(t.maxPlayers)||2,durationMinutes:clampDuration(t.durationMinutes,10),moveSeconds:hamleSaniyeTemizle(t.moveSeconds),rounds:g==='okey'?Number(t.rounds)||3:undefined,name:String(t.name||('Masa #'+(t.id||i))).slice(0,60)})); }
  return out;
}
// OKEY: yetkili sunucu motoru (okey-engine.js) bu repoya eklendiği anda masalar
// OTOMATIK açılır; ayrıca GV_OKEY_PRESETS=1 ile önden test edilebilir.
// (Motor yokken masalar tohumlanmaz: kimse hazır basıp takılı kalmaz.)
let okeyEngine = null;
try { okeyEngine = require('./okey-engine.js'); } catch (_) { /* motor henüz yok */ }
/* 101 OKEY AYRI MOTOR: gerçek 101 kuralları (22/21 taş, 101 ile açma,
   masaya per koyma, işleme, ceza puanı) klasik okeyden tamamen farklı bir
   oyun. Kullanıcı kararı: "Okey klasik kalsın, 101 değişsin" — bu yüzden
   okey-engine.js'e HİÇ dokunulmadı, 101 masaları bu motora bağlandı. */
let okey101Engine = null;
try { okey101Engine = require('./okey101-engine.js'); } catch (_) {}

/* Odanın hangi kural motorunu kullandığı TEK yerden sorulur; aşağıdaki
   bütün dallar (çekme, atma, zaman aşımı, bot, el sonu) buna bakar. */
function okeyMotoru(room) {
  return (room && room.okey && room.okey.yeni101) ? okey101Engine : okeyEngine;
}
function yeni101Mi(room) { return !!(room && room.okey && room.okey.yeni101); }

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
    const room = createRoom(t.id, t.gameId, t.maxPlayers || 2, t.durationMinutes,
      { name: t.name, rounds: t.rounds, moveSeconds: t.moveSeconds });
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
  // bkz. yukarıdaki "POPÜLER OYUN SIRALAMASI" açıklaması: `_popular` alanı
  // aynı `raw` nesnesinin içinde (normPresetConfig bunu görmezden gelir).
  popularConfig = normPopularConfig(raw && raw._popular);
  const desired = presetTablesFromConfig(presetConfig);
  const desiredIds = new Set(desired.map(t => t.id));
  const touchedGames = new Set();

  for (const t of desired) {
    const existing = rooms.get(t.id);
    if (!existing) {
      const room = createRoom(t.id, t.gameId, t.maxPlayers || 2, t.durationMinutes,
        { name: t.name, rounds: t.rounds, moveSeconds: t.moveSeconds });
      room.isPreset = true;
      touchedGames.add(t.gameId);
    } else if (existing.players.length === 0 && !(existing.spectators || []).length) {
      if (existing.name !== t.name) { existing.name = t.name; touchedGames.add(t.gameId); }
      if (existing.maxPlayers !== (t.maxPlayers || 2)) { existing.maxPlayers = t.maxPlayers || 2; touchedGames.add(t.gameId); }
      const desiredRounds = t.rounds ? Number(t.rounds) : undefined;
      if (existing.okeyMaxRounds !== desiredRounds && t.gameId === 'okey') { existing.okeyMaxRounds = desiredRounds; touchedGames.add(t.gameId); }
      if (existing.cardRounds !== desiredRounds && t.gameId === 'pisti') { existing.cardRounds = desiredRounds; touchedGames.add(t.gameId); }
      if (existing.durationMinutes !== t.durationMinutes) {
        existing.durationMinutes = t.durationMinutes;
        existing.whiteTimeMs = t.durationMinutes * 60 * 1000;
        existing.blackTimeMs = t.durationMinutes * 60 * 1000;
        touchedGames.add(t.gameId);
      }
      /* HAMLE SÜRESİ de canlı güncellenir. Süre değişince oyunun varsayılanı
         da değişebildiği için (kelimelik 10/15/20 dk → 30/45/60 sn) bu
         hesap durationMinutes atandıktan SONRA yapılır. */
      const istenenHamle = odaHamleMs(t.gameId, t.moveSeconds, existing.durationMinutes);
      if (Number(existing.moveLimitMs || 0) !== Number(istenenHamle || 0)) {
        existing.moveLimitMs = istenenHamle;
        touchedGames.add(t.gameId);
      }
    }
  }
  // Yapılandırmada olmayan BOŞ hazır odaları gerçekten kaldır:
  for (const room of [...rooms.values()]) {
    if (!room.isPreset) continue;
    if (desiredIds.has(room.id)) continue;
    if (room.players.length === 0 && !(room.spectators || []).length) {
      removePresetRoom(room);
      touchedGames.add(room.gameId);
    }
  }
  // Okey ve 101 Okey de artık diğer oyunlar gibi desiredIds ile yönetilir.
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
      popularConfig = normPopularConfig(d.settings._popular);
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
    /* HAMLE SÜRESİ: hazır masalarda kurucunun girdiği değer (meta.moveSeconds),
       yoksa oyunun varsayılanı. Masadaki HERKES için geçerlidir; durum
       paketleri bunu moveLimitOf(room) ile okur, okey kendi tur sayacına
       (turnDeadlineMs) bunu yazar, kelimelik motoru turnLimitMs olarak alır. */
    moveLimitMs: odaHamleMs(gameId, meta.moveSeconds, duration),
    result: null,
    lastMove: null
  };
  rooms.set(id, room);
  return room;
}

function resetRoomToWaiting(room) {
  if (!room) return;
  // Maç bitti: yapay zekânın tuttuğu koltuklar serbest kalır. Bot yalnız
  // "el sayısı tamamlanana kadar" oynar (kullanıcının kuralı); yeni maça
  // devam etmez, koltuğu boşaltır.
  (room.players || []).forEach(p => {
    if (!p || !p.aiControlled) return;
    if (p.aiTimer) { clearTimeout(p.aiTimer); p.aiTimer = null; }
  });
  room.players = (room.players || []).filter(p => !p || !p.aiControlled);
  room.status = 'waiting';
  room.chess = null;
  room.tavla = null;
  room.cardGame = null;
  room.dama = null;
  room.reversi = null;
  room.gomoku = null;
  if (room.tombala && room.tombala.timer) { clearTimeout(room.tombala.timer); }
  room.tombala = null;
  room.kelimelik = null;
  room.adamasmaca = null;
  room.passaparola = null;
  room.cenga = null;
  if (room.langirt) langirtDurdur(room);
  room.langirt = null;
  if (room.havahokeyi) havahokeyiDurdur(room);
  room.havahokeyi = null;
  room.fark = null;
  room.kizma = null;
  room.metropol = null;
  room.connect4 = null;
  room.bilardo = null;
  /* AMİRAL BATTI: bu satır eksikti. Rövanş kabul edilince oda "waiting"e
     çekiliyor ama room.battleship eski maçtan (phase:'finished') kalıyordu;
     startBattleship yeni bir motor kurup 'placing' fazına geçirse de istemci
     eski duruma bakıp "Filon hazır — rakibi bekliyorsun" ekranında takılı
     kalıyordu. Durum tamamen temizlenir ki yeni elde filo baştan dizilsin. */
  room.battleship = null;
  room.tavlaNotice = null;
  room.tavlaNoticeSeq = 0;
  if (room.okey && room.okey.between) { clearTimeout(room.okey.between); }
  room.okey = null; // okey el/maç durumu tamamen temizlenir
  room.rematch = null; // bekleyen rövanş oylaması varsa düşer
  masaOylamasiTemizle(room); // bekleyen "eksik kişiyle devam" oylaması da
  hazirSayaciTemizle(room);  // bekleme odasının hazır süresi de sıfırlanır
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
    isReady: !!p.isReady,
    // Koltuk yapay zekâda mı? İstemci bu bayrakla oyuncu kartına
    // "🤖 idareci" rozeti basar; masadaki herkes durumu görür.
    ai: !!p.aiControlled,
    // İZLEYİCİ İZNİ — oyuncu kendi ekranının izlenmesine izin veriyor mu?
    // Varsayılan AÇIK (eski davranış: izleyici masayı serbestçe izlerdi).
    // İstemci bunu hem izleyici seçim penceresinde (sönük/aktif) hem de
    // oyuncunun kendi "İzleyiciye İzin Ver / İznini Kaldır" düğmesinde
    // kullanır. Bkz. izleKoltuk() ve 'setSpectatorPermission'.
    allowSpectators: p.allowSpectators !== false
  };
}

function publicSpectator(s) {
  return {
    id: s.id,
    userKey: s.userKey,
    name: s.name,
    // Hangi koltuğun ekranından izliyor? (seçmediyse null)
    watchSeat: (typeof s.watchSeat === 'number') ? s.watchSeat : null
  };
}

/* ====================================================================
 * KOLTUK SEÇEREK İZLEME
 * ====================================================================
 * Kullanıcı isteği: "okey, 101 okey, pişti, batak ve amiral battı
 * oyunlarında, dışarıdan odalarda izleyiciler katılmak isterse, izleyici
 * olarak katılmak isteyen kişi oyundaki oyuncuların isimlerini pop-up
 * açılarak seçer ve o oyuncunun ekranından izlemeye devam eder.
 * Oyuncularda 'İzleyiciye İzin Ver' veya 'İzleyici İznini Kaldır'
 * seçenekleri olacak... izin verilmeyen oyuncu seçilemez, rengi sönük
 * gözükür... önceden izleyici var ise de artık oyundan izleyici atılır ve
 * lobiye yönlendirilerek pop-up uyarı mesajıyla uyarı versin."
 *
 * NEDEN YALNIZ BU BEŞ OYUN? Gizli bilgi taşıyan oyunlar bunlar: okey/101
 * okey ıstakası, pişti/batak eldeki kâğıtlar, amiral battı gemi yerleşimi.
 * Satranç/dama gibi açık tahtalarda "kimin ekranı" diye bir soru yok,
 * oradaki izleyici eskisi gibi tarafsız görünümü alır.
 *
 * GÜVENLİK: izleyici hiçbir koşulda İZİN VERMEYEN bir oyuncunun gizli
 * bilgisini alamaz. Paket üretilirken koltuk HER SEFERİNDE izleKoltuk()
 * ile yeniden doğrulanır; izin o an kalkmışsa koltuk null'a düşer ve
 * tarafsız görünüm gider. İstemciye "izin yok" deyip paketi yine de
 * göndermek sızıntı olurdu.
 */
const IZLEME_SECIMLI_OYUNLAR = ['okey', 'okey101', 'pisti', 'batak', 'battleship'];
function izlemeSecimliMi(room) {
  return !!room && IZLEME_SECIMLI_OYUNLAR.includes(room.gameId);
}
function izleyiciIzinliMi(room, seat) {
  const p = room && room.players.find(x => x.seat === seat);
  return !!p && p.allowSpectators !== false;
}
/* İzleyicinin O AN hangi koltuğun ekranını göreceği. Seçim yoksa, koltuk
   yoksa ya da izin kalkmışsa null = tarafsız görünüm. */
function izleKoltuk(room, spec) {
  if (!spec || !izlemeSecimliMi(room)) return null;
  const k = spec.watchSeat;
  if (typeof k !== 'number') return null;
  return izleyiciIzinliMi(room, k) ? k : null;
}
/* İzleyici seçim penceresinin içeriği: masadaki oyuncular + izin durumu.
   Ziyaretçinin adı zaten "Ziyaretçi 1234" biçiminde geldiği için ayrıca
   numara üretmeye gerek yok. */
function izlemeSecenekleri(room) {
  if (!izlemeSecimliMi(room)) return [];
  return room.players.map(p => ({
    seat: p.seat,
    name: p.name,
    uid: p.userId || null,
    uye: !!p.userId,
    allowed: p.allowSpectators !== false
  })).sort((a, b) => a.seat - b.seat);
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
    /* Masanın hamle süresi (sn). Kurucu paneli masa başına ayarlayabiliyor;
       oyuncu masaya oturmadan önce lobide de görebilsin. */
    moveSeconds: Number(room.moveLimitMs) > 0 ? Math.round(Number(room.moveLimitMs) / 1000) : null,
    status: room.status,
    players: room.players.map(publicPlayer),
    spectators: spectators.map(publicSpectator),
    spectatorCount: spectators.length,
    readyCount: room.players.filter(p => p.isReady).length,
    /* Hazır süresi sayacı işliyorsa kalan ms. Olay (hazirSayaci) anında
       bildirir; bu alan sayfa yenileyen / yeniden bağlanan oyuncu için
       tek doğru kaynaktır. */
    hazirKalan: hazirSayaciKalan(room) || null,
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
    /* Masanın hamle süresi (sn). Kurucu paneli masa başına ayarlayabiliyor;
       oyuncu masaya oturmadan önce lobide de görebilsin. */
    moveSeconds: Number(room.moveLimitMs) > 0 ? Math.round(Number(room.moveLimitMs) / 1000) : null,
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
    moveLimitMs: moveLimitOf(room),
    moveRemainingMs: Math.max(0, moveLimitOf(room) - moveElapsed),
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
    moveLimitMs: moveLimitOf(room),
    moveRemainingMs: Math.max(0, moveLimitOf(room) - moveElapsed),
    serverNow: now(),
    result: room.result,
    notice: room.tavlaNotice || null,
    lastStep: room.lastMove ? room.lastMove.moveData : null
  };
}

// ---- HAMLE (SIRA) SAATİ: tüm online oyunlarda ORTAK ----
// İstemci sırası gelen oyuncunun KENDİ süre kartında canlı geri sayım
// gösterebilsin diye her tahta/kart durumuna aynı dört alan eklenir.
// (Eskiden bu bilgi yalnız satranç, tavla, okey ve kart oyunlarında vardı;
// dama/türk daması/reversi/gomoku/connect4/bilardo istemcilerinde sıra
// sayacı hiç görünmüyordu.)
function turnSeatOf(room) {
  if (!room) return null;
  if (room.dama) return room.dama.turn === (room.gameId === 'turkdamasi' ? 'w' : 'r') ? 0 : 1;
  if (room.reversi) return room.reversi.turn === 'b' ? 0 : 1;
  if (room.gomoku) return room.gomoku.turn === 'b' ? 0 : 1;
  if (room.kelimelik) return room.kelimelik.turn;
  if (room.adamasmaca) return adamasmacaEngine.siradaki(room.adamasmaca);
  if (room.passaparola) return room.passaparola.status === 'playing' ? room.passaparola.turn : null;
  if (room.cenga) return room.cenga.status === 'playing' ? room.cenga.turn : null;
  if (room.kizma) return kizmaEngine.siradakiKoltuk(room.kizma);
  if (room.metropol) {
    /* TEKLİF turunda sıra teknik olarak zarı atanda kalır, ama bekleyen
       kişi teklifin yapıldığı oyuncudur. Hamle saati de, "sıradaki" uyarısı
       da ONA ait olmalı — yoksa masa, kendi sırası olmayan birini bekleyip
       yanlış kişinin süresini yakardı. */
    const t = room.metropol.teklif;
    if (room.metropol.faz === 'teklif' && t) return t.sira[t.idx];
    return metropolEngine.siradakiKoltuk(room.metropol);
  }
  /* Langırt ve hava hokeyi sıra tabanlı DEĞİL: sırası olan kimse yok. */
  if (room.connect4) return room.connect4.turn === 'r' ? 0 : 1;
  if (room.bilardo) return room.bilardo.turn;
  // Yerleştirme (placing) fazında tur sahibi yok — her iki oyuncu da
  // BAĞIMSIZ olarak filosunu diziyor; hamle-zaman-aşımı saati bu yüzden
  // burada değil, enforceOnlineMoveTimeout içindeki özel dala bağlıdır.
  if (room.battleship) return room.battleship.phase === 'battle' ? room.battleship.turn : null;
  if (room.cardGame) return room.cardGame.turn;
  return null;
}
/* Hamle süresi masaya göre değişebilir (Kelimelik: ⚡30 sn · ♟️45 sn · 🧠60 sn).
   room.moveLimitMs kuruluşta atanır; atanmamışsa eski davranış sürer. */
function moveLimitOf(room) {
  if (room && Number(room.moveLimitMs) > 0) return Number(room.moveLimitMs);
  return (room && room.gameId === 'pisti') ? PISTI_TURN_MS : MOVE_FORFEIT_MS;
}
function moveClockOf(room) {
  const limit = moveLimitOf(room);
  const playing = room.status === 'playing' && !!room.moveStartedAt;
  const seat = turnSeatOf(room);
  // Sırası olan KİMSE YOKSA (ör. Amiral Battı'nın yerleştirme fazı) hamle
  // sayacı da olmamalı: eskiden üstteki şerit orada anlamsız bir geri
  // sayım gösteriyordu. Yerleştirmenin kendi süresi ayrı alanda gider.
  return {
    turnSeat: seat,
    turnLimitMs: limit,
    turnRemainingMs: (playing && seat !== null) ? Math.max(0, limit - (now() - room.moveStartedAt)) : null,
    serverNow: now()
  };
}

// Bilardo durumu: toplar İSTEMCİ PİKSELİNE çevrilerek gönderilir (motor
// içeride SI birimiyle — metre — çalışır). Masa geometrisi de pakete
// eklenir ki istemci kendi kopyasını tutup sunucudan sapmasın.
function bilardoState(room, seat) { const b=room.bilardo; return {kind:'bilardo',status:room.status,turn:b.turn,winner:b.winner,balls:bilardoEngine.viewBalls(b),table:bilardoEngine.constants,seat,playerColor:seat===0?'r':'y',shots:b.shots,score:b.score.slice(),groups:b.groups?b.groups.slice():[null,null],result:b.result||null,lastShot:b.lastShot?{foul:!!b.lastShot.foul,potted:b.lastShot.potted.slice(),firstHit:b.lastShot.firstHit,cueRespot:b.lastShot.cueRespot||null}:null,...moveClockOf(room)}; }
function emitBilardoState(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:bilardoState(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:bilardoState(room,null),isSpectator:true}));}
function startBilardo(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.bilardo=bilardoEngine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?'r':'y',players:publicRoom(room).players,gameState:bilardoState(room,p.seat)}));emitBilardoState(room);}
function connect4State(room, seat) { const c=room.connect4; return {kind:'connect4',status:room.status,turn:c.turn,winner:c.winner,board:c.board.map(x=>x.slice()),seat,playerColor:seat===0?'r':'y',moves:c.moves,result:c.result||null,
  /* Kazandıran dizi: maç bitince istemci bu kareleri tahtada işaretler
     (kullanıcı isteği: "hangi hamleyle bitirdiğini görebilsinler"). */
  kazananKareler:c.kazananKareler||null,...moveClockOf(room)}; }
function emitConnect4State(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:connect4State(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:connect4State(room,null),isSpectator:true}));}
function startConnect4(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.connect4=connect4Engine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?'r':'y',players:publicRoom(room).players,gameState:connect4State(room,p.seat)}));emitConnect4State(room);}
function gomokuState(room, seat) { const g=room.gomoku; return {kind:'gomoku',status:room.status,turn:g.turn,winner:g.winner,board:g.board.map(x=>x.slice()),seat,playerColor:seat===0?'b':'w',moves:g.moves,result:g.result||null,
  kazananKareler:g.kazananKareler||null,...moveClockOf(room)}; }
function emitGomokuState(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:gomokuState(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:gomokuState(room,null),isSpectator:true}));}
/* ---------------------------------------------------------------- KELİMELİK
   Durum paketinde RAKİBİN ISTAKASI YOKTUR: her oyuncuya yalnız kendi taşları
   gönderilir, izleyiciye hiç gönderilmez. Sözlük de istemciye inmez. */
function kelimelikState(room, seat) {
  const k = room.kelimelik;
  return {
    kind: 'kelimelik', status: room.status, turn: k.turn, winner: k.winner,
    board: k.board.map(r => r.map(x => x ? { harf: x.harf, joker: !!x.joker } : null)),
    bonus: kelimelikEngine.BONUS, puanlar: Object.fromEntries(
      Object.keys(kelimelikEngine.HARFLER).map(h => [h, kelimelikEngine.HARFLER[h].p])),
    rack: (seat === 0 || seat === 1) ? k.racks[seat].slice() : [],
    rackCounts: [k.racks[0].length, k.racks[1].length],
    scores: k.scores.slice(), bag: k.bag.length, passStreak: k.passStreak.slice(),
    lastSquares: (k.lastSquares || []).map(x => x.slice()),
    moves: k.moves, history: k.history.slice(-12), seat,
    result: k.result || null, ...moveClockOf(room)
  };
}
function emitKelimelikState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, { roomId: room.id, seat: p.seat, gameState: kelimelikState(room, p.seat), isSpectator: false }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, { roomId: room.id, seat: null, gameState: kelimelikState(room, null), isSpectator: true }));
}
function startKelimelik(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.kelimelik = kelimelikEngine.init({ turnLimitMs: moveLimitOf(room) });
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', { roomId: room.id, seat: p.seat, playerColor: p.seat === 0 ? 'b' : 'w', players: publicRoom(room).players, gameState: kelimelikState(room, p.seat) }));
  emitKelimelikState(room);
}
/* OTOMATİK PAS — kullanıcı kuralı: hamle yapılamıyorsa oyuncu masadan
   ATILMAZ, sırası otomatik pas geçilir. Diskalifiye yalnız üst üste 3
   pastan sonra gelir. Her sıra değişiminden sonra çağrılır; iki taraf da
   oynayamıyorsa zincir maç bitene kadar sürer (en çok 8 tur). */
function kelimelikOtomatikPas(room) {
  const k = room.kelimelik;
  if (!k) return false;
  let oldu = false;
  for (let i = 0; i < 8; i++) {
    if (k.status !== 'playing') break;
    if (!kelimelikEngine.otomatikPasGerekli(k)) break;
    const seat = k.turn;
    const ad = (room.players.find(p => p.seat === seat) || {}).name || ('Koltuk ' + (seat + 1));
    kelimelikEngine.pas(k, seat, true);
    io.to(room.id).emit('kelimelikAutoPass', { roomId: room.id, seat, ad });
    oldu = true;
  }
  return oldu;
}
/* Maç bitişini tek yerden yayınla (hamle, pas, süre aşımı, terk). */
function kelimelikBitisYayinla(room, reason) {
  const k = room.kelimelik;
  room.status = 'finished';
  const hamNeden = reason || (k.result && k.result.reason) || 'finished';
  /* Puan katmanı BERABERLİĞİ nedenden okuyor (bkz. scheduleRoomReset →
     beraberlikNedenleri). Kelimelik'te puanlar eşitse kazanan yoktur;
     neden 'draw' olmazsa iki oyuncu da mağlup sayılıp eksik puan alırdı.
     Ayrıntılı neden gameState.result.reason'da korunur. */
  const neden = (k.winner === null) ? 'draw' : hamNeden;
  room.result = { reason: neden, winnerSeat: k.winner, kelimelikNeden: hamNeden };
  /* DİSKALİFİYE (üst üste 3 pas) masayı terk etmekle aynı sayılır: site
     kuralı gereği terk cezası puanı uygulanır. Maçı bitirme puanı ayrıca
     scheduleRoomReset'te işlenir. */
  if (hamNeden === 'pass_disqualify' && k.winner !== null) {
    const suclu = room.players.find(p => p.seat === (1 - k.winner));
    if (suclu && suclu.userId) {
      try {
        puanYaz([scoring.terkOlayi({ uid: suclu.userId, ad: suclu.name,
          gameId: room.gameId, roomId: room.id })]);
      } catch (e) { console.warn('kelimelik diskalifiye puanı:', e.message); }
    }
  }
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: room.result.reason, winnerSeat: k.winner,
    youWon: k.winner !== null && p.seat === k.winner, gameState: kelimelikState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: room.result.reason, winnerSeat: k.winner,
    youWon: false, isSpectator: true, gameState: kelimelikState(room, null)
  }));
}
/* ========================================================================
 * ADAM ASMACA — oda akışı
 * ========================================================================
 * İki kişilik kelime düellosu. Bir koltuk GİZLEYEN, diğeri TAHMİNCİ; her el
 * sonunda roller değişir. KELİME SUNUCUDA KALIR: tahminciye ve izleyiciye
 * yalnız maske gider (adamasmaca-engine.js → gorunum).
 *
 * El sayısı masa süresinden gelir — ⚡10 dk → 2 el · ♟️15 dk → 4 el ·
 * 🧠20 dk → 6 el. Roller her el değiştiği için sayı daima ÇİFTtir, yoksa
 * bir taraf bir kez fazla gizlerdi.
 * ===================================================================== */
function adamasmacaElSayisi(room) {
  if (Number(room && room.rounds) > 0) return Number(room.rounds);
  return ({ 10: 2, 15: 4, 20: 6 })[Number(room && room.durationMinutes)] || 4;
}
function adamasmacaState(room, seat) {
  const a = room.adamasmaca;
  if (!a) return null;
  return adamasmacaEngine.gorunum(a, (seat === 0 || seat === 1) ? seat : null,
    Object.assign({ status: room.status }, moveClockOf(room)));
}
function emitAdamasmacaState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false,
    gameState: adamasmacaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true,
    gameState: adamasmacaState(room, null)
  }));
}
function startAdamasmaca(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.adamasmaca = adamasmacaEngine.macBaslat({
    seats: room.players.map(p => p.seat).sort((x, y) => x - y),
    elSayisi: adamasmacaElSayisi(room)
  });
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: adamasmacaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true,
    gameState: adamasmacaState(room, null)
  }));
  emitAdamasmacaState(room);
}
/* Maç bitişini TEK yerden yayınla (harf, süre aşımı, terk). */
function adamasmacaBitisYayinla(room, reason) {
  const a = room.adamasmaca;
  if (!a) return;
  room.status = 'finished';
  const ham = reason || (a.result && a.result.reason) || 'finished';
  /* Puan katmanı beraberliği NEDENDEN okuyor (bkz. scheduleRoomReset):
     kazanan yoksa neden 'draw' olmalı, yoksa iki oyuncu da mağlup sayılır. */
  const neden = (a.winner === null || a.winner === undefined) ? 'draw' : ham;
  room.result = { reason: neden, winnerSeat: a.winner == null ? null : a.winner,
                  adamasmacaNeden: ham };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: adamasmacaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: adamasmacaState(room, null)
  }));
}
/* El bitti mi / maç bitti mi — her hamleden sonra tek elden işlenir. */
function adamasmacaSonrasi(room, elOzeti) {
  const a = room.adamasmaca;
  if (elOzeti) {
    io.to(room.id).emit('adamasmacaRoundEnd', { roomId: room.id, el: elOzeti });
  }
  touchMoveTimer(room);
  if (a.status !== 'playing') {
    adamasmacaBitisYayinla(room);
    emitAdamasmacaState(room); emitRoom(room); scheduleRoomReset(room);
    return true;
  }
  emitAdamasmacaState(room);
  return false;
}

/* ========================================================================
 * KIZMA BIRADER (Ludo) - oda akisi
 * ========================================================================
 * 2/3/4 kisilik, sira tabanli. ZAR SUNUCUDA atilir ve gecerli hamleler
 * sunucuda hesaplanir; istemci yalniz "zar at" ve "su piyonu oyna" der.
 * Boylece ne zar sonucu ne de kural istemciden degistirilebilir.
 *
 * Hamle suresi masa satirindan gelir (kurucu panelinden ayarlanir).
 * Suresi dolan oyuncu masadan ATILMAZ: zar atmadiysa sunucu atar, hamle
 * secmediyse ilk gecerli hamle oynanir - site kurali budur.
 * ===================================================================== */
function kizmaState(room, seat) {
  const k = room.kizma;
  if (!k) return null;
  return kizmaEngine.gorunum(k, (typeof seat === 'number') ? seat : null,
    Object.assign({ status: room.status }, moveClockOf(room)));
}
function emitKizmaState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false, gameState: kizmaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true, gameState: kizmaState(room, null)
  }));
}
function startKizma(room) {
  if (room.status === 'playing') return;
  if (room.players.length < 2 || room.players.length !== room.maxPlayers) return;
  if (!room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.kizma = kizmaEngine.macBaslat({
    seats: room.players.map(p => p.seat).sort((a, b) => a - b)
  });
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: kizmaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true, gameState: kizmaState(room, null)
  }));
  emitKizmaState(room);
}
function kizmaBitisYayinla(room, reason) {
  const k = room.kizma;
  if (!k) return;
  room.status = 'finished';
  const ham = reason || (k.result && k.result.reason) || 'finished';
  const neden = (k.winner === null || k.winner === undefined) ? 'draw' : ham;
  room.result = { reason: neden, winnerSeat: k.winner == null ? null : k.winner,
                  siralama: (k.result && k.result.siralama) || [] };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: kizmaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: kizmaState(room, null)
  }));
}
function kizmaSonrasi(room) {
  const k = room.kizma;
  touchMoveTimer(room);
  if (k.status !== 'playing') {
    kizmaBitisYayinla(room);
    emitKizmaState(room); emitRoom(room); scheduleRoomReset(room);
    return true;
  }
  emitKizmaState(room);
  return false;
}

/* ========================================================================
 * METROPOL — oda akışı
 * ========================================================================
 * 2-4 kişilik mülk oyunu. Zar, kart destesi, kira hesabı ve iflas tasfiyesi
 * TAMAMEN SUNUCUDA (metropol-engine.js); istemci yalnız "zar at", "al",
 * "reddet", "ev kur", "ipotek", "turu bitir" der. Deste SIRASI istemciye
 * gitmez — yoksa bir sonraki kart önceden bilinirdi (bkz. gorunum).
 *
 * TUR LİMİTİ masa satırından gelir (kurucu panelinden ayarlanır): limit
 * dolunca en yüksek VARLIĞA sahip oyuncu kazanır. Böylece bir masa
 * saatlerce sürmez — çevrimiçi masada bu şart.
 *
 * Hamle süresi de masa satırından gelir. Süresi dolan oyuncu masadan
 * ATILMAZ: zar atmadıysa sunucu atar, karar vermediyse parası bolsa alır
 * yoksa reddeder, turu bitirmediyse sunucu bitirir — site kuralı budur.
 * ===================================================================== */
function metropolTurLimiti(room) {
  const r = Number(room && room.rounds);
  if (r > 0) return Math.max(5, Math.min(r, 60));
  return ({ 10: 15, 15: 20, 20: 25 })[Number(room && room.durationMinutes)] || 20;
}
function metropolState(room, seat) {
  const m = room.metropol;
  if (!m) return null;
  return metropolEngine.gorunum(m, (typeof seat === 'number') ? seat : null,
    Object.assign({ status: room.status }, moveClockOf(room)));
}
function emitMetropolState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false, gameState: metropolState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true, gameState: metropolState(room, null)
  }));
}
function startMetropol(room) {
  if (room.status === 'playing') return;
  if (room.players.length < 2 || room.players.length !== room.maxPlayers) return;
  if (!room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.metropol = metropolEngine.macBaslat({
    seats: room.players.map(p => p.seat).sort((a, b) => a - b),
    turLimiti: metropolTurLimiti(room)
  });
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: metropolState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true, gameState: metropolState(room, null)
  }));
  emitMetropolState(room);
}
function metropolBitisYayinla(room, reason) {
  const m = room.metropol;
  if (!m) return;
  room.status = 'finished';
  const ham = reason || (m.result && m.result.reason) || 'finished';
  const neden = (m.winner === null || m.winner === undefined) ? 'draw' : ham;
  room.result = { reason: neden, winnerSeat: m.winner == null ? null : m.winner,
                  varlik: (m.result && m.result.varlik) || {} };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: metropolState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: metropolState(room, null)
  }));
}
function metropolSonrasi(room) {
  const m = room.metropol;
  touchMoveTimer(room);
  if (m.status !== 'playing') {
    metropolBitisYayinla(room);
    emitMetropolState(room); emitRoom(room); scheduleRoomReset(room);
    return true;
  }
  emitMetropolState(room);
  return false;
}

/* ========================================================================
 * FARK BULMACA — oda akışı
 * ========================================================================
 * Sıra yoktur: iki oyuncu da aynı anda kendi ekranında fark arar. Sahne,
 * tohum ve hangi 7 farkın seçildiği SUNUCUDA belirlenir; her tıklama
 * sunucuda ölçülür. Fazlar (geri sayım → el → el arası) ana saat
 * döngüsünden ilerletilir.
 *
 * El süresi masa tipinden: ⚡10 dk → 60 sn · ♟️15 dk → 90 sn · 🧠20 dk → 120 sn.
 * Maç 3 elin 2'sini alanındır.
 * ===================================================================== */
function farkElSuresi(room) {
  return ({ 10: 60, 15: 90, 20: 120 })[Number(room && room.durationMinutes)] || 90;
}
function farkState(room, seat) {
  const f = room.fark;
  if (!f) return null;
  return farkEngine.gorunum(f, (seat === 0 || seat === 1) ? seat : null,
    { status: room.status, serverNow: now() });
}
function emitFarkState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false, gameState: farkState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true, gameState: farkState(room, null)
  }));
}
function startFark(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.fark = farkEngine.macBaslat({
    seats: room.players.map(p => p.seat).sort((a, b) => a - b),
    elSuresiSn: farkElSuresi(room)
  });
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: farkState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true, gameState: farkState(room, null)
  }));
  emitFarkState(room);
}
function farkBitisYayinla(room, reason) {
  const f = room.fark;
  if (!f) return;
  room.status = 'finished';
  const ham = reason || (f.result && f.result.reason) || 'finished';
  const neden = (f.winner === null || f.winner === undefined) ? 'draw' : ham;
  room.result = { reason: neden, winnerSeat: f.winner == null ? null : f.winner, farkNeden: ham };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: farkState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: farkState(room, null)
  }));
}
function farkSonrasi(room) {
  const f = room.fark;
  touchMoveTimer(room);
  if (f.status !== 'playing') {
    farkBitisYayinla(room);
    emitFarkState(room); emitRoom(room); scheduleRoomReset(room);
    return true;
  }
  emitFarkState(room);
  return false;
}
/* Faz saati: ana döngüden işlenir (geri sayım → el → el arası → yeni el). */
function farkClockTick(room) {
  const f = room.fark;
  if (!f || f.status !== 'playing') return;
  const r = farkEngine.tik(f, now());
  if (!r.degisti) return;
  if (r.olay) io.to(room.id).emit('farkFaz', { roomId: room.id, olay: r.olay,
    el: f.el, kazanan: r.kazanan === undefined ? null : r.kazanan });
  farkSonrasi(room);
  emitRoom(room);
}

/* ========================================================================
 * HAVA HOKEYİ — oda akışı (GERÇEK ZAMANLI)
 * ========================================================================
 * Langırt ile aynı kalıp, iki farkla:
 *   · Fizik 120 Hz işler. Disk saniyede 1450 birime kadar çıkıyor; 50 Hz'de
 *     bir adımda 29 birim yol alır ve 20 birimlik yarıçapıyla tokmağın
 *     İÇİNDEN geçebilirdi. Prototip de bu yüzden 1/120 kullanıyordu.
 *   · Oyuncu tek bir tokmak sürer (dört çubuk yerine), bu yüzden istemci
 *     yalnız tokmağın hedef noktasını yollar.
 *
 * Hedef gol masa tipinden gelir: ⚡10 dk → 3 · ♟️15 dk → 5 · 🧠20 dk → 7.
 * ===================================================================== */
const HOKEY_ADIM_MS = 1000 / 120;   // 120 Hz fizik
const HOKEY_YAYIN_MS = 50;          // 20 Hz durum paketi
const hokeyOdalari = new Set();
let hokeyTimer = null;

function havahokeyiGolHedefi(room) {
  return ({ 10: 3, 15: 5, 20: 7 })[Number(room && room.durationMinutes)] || 5;
}
function havahokeyiState(room, seat) {
  const h = room.havahokeyi;
  if (!h) return null;
  return havahokeyiEngine.gorunum(h.st, (seat === 0 || seat === 1) ? seat : null,
    { status: room.status, serverNow: now() });
}
function emitHavahokeyiState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false, gameState: havahokeyiState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true, gameState: havahokeyiState(room, null)
  }));
}
function havahokeyiKare(room) {
  const st = room.havahokeyi.st;
  io.to(room.id).emit('hokeyFrame', {
    roomId: room.id, t: now(),
    faz: st.faz, fazSn: Math.round(st.fazSn * 10) / 10,
    disk: { x: Math.round(st.disk.x * 10) / 10, y: Math.round(st.disk.y * 10) / 10,
            vx: Math.round(st.disk.vx), vy: Math.round(st.disk.vy) },
    tokmak: st.tokmak.map(t => ({ x: Math.round(t.x), y: Math.round(t.y) })),
    skor: st.skor, olayNo: st.olayNo, sonOlay: st.sonOlay
  });
}
function havahokeyiDurdur(room) {
  if (room) hokeyOdalari.delete(String(room.id));
  if (!hokeyOdalari.size && hokeyTimer) { clearInterval(hokeyTimer); hokeyTimer = null; }
}
function havahokeyiBasla(room) {
  hokeyOdalari.add(String(room.id));
  if (hokeyTimer) return;
  hokeyTimer = setInterval(havahokeyiDonguAdimi, 16);   // zamanlayıcı 60 Hz,
  if (typeof hokeyTimer.unref === 'function') hokeyTimer.unref();
}
/* Tek genel zamanlayıcı bütün hokey masalarını işletir. Zamanlayıcı 60 Hz
   uyansa da fizik HER ZAMAN 120 Hz sabit adımlarla ilerler: uyanışta ne
   kadar süre geçtiyse o kadar küçük adım atılır. */
function havahokeyiDonguAdimi() {
  for (const id of Array.from(hokeyOdalari)) {
    const room = rooms.get(id);
    if (!room || !room.havahokeyi || room.status !== 'playing') { hokeyOdalari.delete(id); continue; }
    const h = room.havahokeyi;
    const simdi = now();
    let kalan = Math.min(250, simdi - (h.sonAdim || simdi));
    h.sonAdim = simdi;
    let n = 0;
    while (kalan >= HOKEY_ADIM_MS && n < 40) {
      havahokeyiEngine.adim(h.st, HOKEY_ADIM_MS / 1000);
      kalan -= HOKEY_ADIM_MS;
      n++;
      if (h.st.status !== 'playing') break;
    }
    h.sonAdim = simdi - kalan;
    if (h.st.status !== 'playing') { havahokeyiBitir(room); continue; }
    const sinirSn = Math.max(60, Number(room.durationMinutes || 15) * 60);
    if (h.st.gecenSn >= sinirSn) { havahokeyiBitir(room, 'timeout'); continue; }
    if (simdi - (h.sonYayin || 0) >= HOKEY_YAYIN_MS) {
      h.sonYayin = simdi;
      havahokeyiKare(room);
    }
  }
  if (!hokeyOdalari.size && hokeyTimer) { clearInterval(hokeyTimer); hokeyTimer = null; }
}
function startHavahokeyi(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.havahokeyi = {
    st: havahokeyiEngine.macBaslat({
      seats: room.players.map(p => p.seat).sort((a, b) => a - b),
      golHedefi: havahokeyiGolHedefi(room)
    }),
    sonAdim: now(), sonYayin: 0
  };
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: havahokeyiState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true, gameState: havahokeyiState(room, null)
  }));
  emitHavahokeyiState(room);
  havahokeyiBasla(room);
}
function havahokeyiBitir(room, reason) {
  const h = room.havahokeyi;
  if (!h || room.status === 'finished') return;
  havahokeyiDurdur(room);
  if (h.st.status === 'playing') havahokeyiEngine.macBitir(h.st, reason || 'finished');
  room.status = 'finished';
  const w = h.st.winner;
  const neden = (w === null || w === undefined) ? 'draw' : (reason || h.st.result.reason || 'finished');
  room.result = { reason: neden, winnerSeat: w == null ? null : w, skor: h.st.skor };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: havahokeyiState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: havahokeyiState(room, null)
  }));
  emitHavahokeyiState(room); emitRoom(room); scheduleRoomReset(room);
}

/* ========================================================================
 * LANGIRT — oda akışı (GERÇEK ZAMANLI)
 * ========================================================================
 * Bu oyun sıra tabanlı DEĞİL: iki oyuncu da aynı anda oynar. Fizik sunucuda
 * sabit 50 Hz adımlarla işler (langirtEngine.adim), durum paketi ~20 Hz
 * yayınlanır. İstemci yalnız ÇUBUK HEDEFLERİNİ ve ŞUT isteğini yollar;
 * topun nerede olduğuna hep sunucu karar verir.
 *
 * Hedef gol sayısı masa tipinden gelir: ⚡10 dk → 3 gol · ♟️15 dk → 5 gol ·
 * 🧠20 dk → 7 gol.
 * ===================================================================== */
const LANGIRT_ADIM_MS = 20;      // 50 Hz fizik
const LANGIRT_YAYIN_MS = 50;     // 20 Hz durum paketi
const langirtOdalari = new Set();
let langirtTimer = null;

function langirtHedefGol(room) {
  return ({ 10: 3, 15: 5, 20: 7 })[Number(room && room.durationMinutes)] || 5;
}
function langirtState(room, seat) {
  const l = room.langirt;
  if (!l) return null;
  return langirtEngine.gorunum(l.st, (seat === 0 || seat === 1) ? seat : null,
    { status: room.status, serverNow: now() });
}
function emitLangirtState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false, gameState: langirtState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true, gameState: langirtState(room, null)
  }));
}
/* Sahanın gerçek zamanlı paketi: her oyuncuya aynı, küçük ve sık. Durum
   paketinin tamamını 20 Hz yollamak gereksiz; yalnız hareket edenler gider. */
function langirtKare(room) {
  const st = room.langirt.st;
  io.to(room.id).emit('langirtFrame', {
    roomId: room.id,
    t: now(),
    faz: st.faz,
    fazSn: Math.round(st.fazSn * 10) / 10,
    top: { x: Math.round(st.top.x * 10) / 10, y: Math.round(st.top.y * 10) / 10,
           vx: Math.round(st.top.vx), vy: Math.round(st.top.vy) },
    cubuk: { kirmizi: st.cubuk.kirmizi.map(v => Math.round(v)),
             mavi: st.cubuk.mavi.map(v => Math.round(v)) },
    skor: st.skor, olayNo: st.olayNo, sonOlay: st.sonOlay
  });
}
function langirtDurdur(room) {
  if (room) langirtOdalari.delete(String(room.id));
  if (!langirtOdalari.size && langirtTimer) { clearInterval(langirtTimer); langirtTimer = null; }
}
function langirtBasla(room) {
  langirtOdalari.add(String(room.id));
  if (langirtTimer) return;
  langirtTimer = setInterval(langirtDonguAdimi, LANGIRT_ADIM_MS);
  if (typeof langirtTimer.unref === 'function') langirtTimer.unref();
}
/* Tek bir genel zamanlayıcı bütün langırt masalarını işletir: masa başına
   setInterval açmak gereksiz yük olurdu. */
function langirtDonguAdimi() {
  for (const id of Array.from(langirtOdalari)) {
    const room = rooms.get(id);
    if (!room || !room.langirt || room.status !== 'playing') { langirtOdalari.delete(id); continue; }
    const l = room.langirt;
    const simdi = now();
    /* Gerçek geçen süreyi küçük sabit adımlara böl: sunucu bir an takılsa
       bile fizik aynı sonucu versin (değişken dt topu ışınlardı). */
    let kalan = Math.min(250, simdi - (l.sonAdim || simdi));
    l.sonAdim = simdi;
    let adimSayisi = 0;
    while (kalan >= LANGIRT_ADIM_MS && adimSayisi < 12) {
      langirtEngine.adim(l.st, LANGIRT_ADIM_MS / 1000, l.kontrol);
      kalan -= LANGIRT_ADIM_MS;
      adimSayisi++;
      if (l.st.status !== 'playing') break;
    }
    l.sonAdim = simdi - kalan;
    if (l.st.status !== 'playing') { langirtBitir(room); continue; }
    /* MAÇ SÜRESİ: hedef gole ulaşılamazsa masa süresi dolunca maç biter ve
       skor üstünlüğü kazanır (eşitse berabere). Sıra olmadığı için genel
       hamle sayacı burada işlemez; süreyi bu dal kapatır. */
    const sinirSn = Math.max(60, Number(room.durationMinutes || 15) * 60);
    if (l.st.gecenSn >= sinirSn) { langirtBitir(room, 'timeout'); continue; }
    if (simdi - (l.sonYayin || 0) >= LANGIRT_YAYIN_MS) {
      l.sonYayin = simdi;
      langirtKare(room);
    }
  }
  if (!langirtOdalari.size && langirtTimer) { clearInterval(langirtTimer); langirtTimer = null; }
}
function startLangirt(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.langirt = {
    st: langirtEngine.macBaslat({
      seats: room.players.map(p => p.seat).sort((a, b) => a - b),
      hedefGol: langirtHedefGol(room)
    }),
    kontrol: { hedefY: { kirmizi: [], mavi: [] }, hassas: {} },
    sonAdim: now(), sonYayin: 0
  };
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: langirtState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true, gameState: langirtState(room, null)
  }));
  emitLangirtState(room);
  langirtBasla(room);
}
function langirtBitir(room, reason) {
  const l = room.langirt;
  if (!l || room.status === 'finished') return;
  langirtDurdur(room);
  if (l.st.status === 'playing') langirtEngine.macBitir(l.st, reason || 'finished');
  room.status = 'finished';
  const w = l.st.winner;
  const neden = (w === null || w === undefined) ? 'draw' : (reason || l.st.result.reason || 'finished');
  room.result = { reason: neden, winnerSeat: w == null ? null : w, skor: l.st.skor };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: langirtState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: langirtState(room, null)
  }));
  emitLangirtState(room); emitRoom(room); scheduleRoomReset(room);
}

/* ========================================================================
 * CENGA — oda akışı
 * ========================================================================
 * Sıra iki adımdır: önce TAŞ SEÇ, sonra ÇEK. Çekişin gizli hedefi motorda
 * durur ve istemciye asla gönderilmez (cenga-engine.js → gorunum); istemci
 * yalnız tolerans bandını bilir, iğnenin durduğu konumu yollar.
 * ===================================================================== */
function cengaState(room, seat) {
  const c = room.cenga;
  if (!c) return null;
  return cengaEngine.gorunum(c, (seat === 0 || seat === 1) ? seat : null,
    Object.assign({ status: room.status }, moveClockOf(room)));
}
function emitCengaState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false, gameState: cengaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true, gameState: cengaState(room, null)
  }));
}
function startCenga(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.cenga = cengaEngine.macBaslat({ seats: room.players.map(p => p.seat).sort((a, b) => a - b) });
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: cengaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true, gameState: cengaState(room, null)
  }));
  emitCengaState(room);
}
function cengaBitisYayinla(room, reason) {
  const c = room.cenga;
  if (!c) return;
  room.status = 'finished';
  const ham = reason || (c.result && c.result.reason) || 'finished';
  const neden = (c.winner === null || c.winner === undefined) ? 'draw' : ham;
  room.result = { reason: neden, winnerSeat: c.winner == null ? null : c.winner, cengaNeden: ham };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: cengaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: cengaState(room, null)
  }));
}
function cengaSonrasi(room) {
  const c = room.cenga;
  touchMoveTimer(room);
  if (c.status !== 'playing') {
    cengaBitisYayinla(room);
    emitCengaState(room); emitRoom(room); scheduleRoomReset(room);
    return true;
  }
  emitCengaState(room);
  return false;
}

/* ========================================================================
 * PASSAPAROLA — oda akışı
 * ========================================================================
 * İki kişilik bilgi yarışması. Her oyuncunun KENDİ saati vardır ve saat
 * yalnız sırası gelen oyuncunun aleyhine işler; bu yüzden oyun genel hamle
 * sayacını DEĞİL, kendi saat döngüsünü kullanır (okey gibi).
 *
 * Oyuncu başına süre masa tipinden gelir: ⚡10 dk → 90 sn · ♟️15 dk → 120 sn ·
 * 🧠20 dk → 180 sn. Soru seti her maçta rastgele seçilir ve iki oyuncu da
 * AYNI seti oynar.
 * ===================================================================== */
function passaparolaSureSn(room) {
  return ({ 10: 90, 15: 120, 20: 180 })[Number(room && room.durationMinutes)] || 120;
}
function passaparolaState(room, seat) {
  const q = room.passaparola;
  if (!q) return null;
  return passaparolaEngine.gorunum(q, (seat === 0 || seat === 1) ? seat : null,
    { status: room.status, turnSeat: q.status === 'playing' ? q.turn : null,
      serverNow: now() });
}
function emitPassaparolaState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: p.seat, isSpectator: false,
    gameState: passaparolaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, event, {
    roomId: room.id, seat: null, isSpectator: true,
    gameState: passaparolaState(room, null)
  }));
}
function startPassaparola(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  if (!passaparolaEngine.setSayisi()) return;      // soru havuzu yoksa oyun açılmaz
  room.status = 'playing'; room.result = null;
  room.passaparola = passaparolaEngine.macBaslat({
    seats: room.players.map(p => p.seat).sort((a, b) => a - b),
    sureSn: passaparolaSureSn(room)
  });
  room.passaparolaSonTik = now();
  room.turnStartedAt = now(); touchMoveTimer(room); emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, isSpectator: false,
    players: publicRoom(room).players, gameState: passaparolaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true,
    gameState: passaparolaState(room, null)
  }));
  emitPassaparolaState(room);
}
function passaparolaBitisYayinla(room, reason) {
  const q = room.passaparola;
  if (!q) return;
  room.status = 'finished';
  const ham = reason || (q.result && q.result.reason) || 'finished';
  const neden = (q.winner === null || q.winner === undefined) ? 'draw' : ham;
  room.result = { reason: neden, winnerSeat: q.winner == null ? null : q.winner,
                  passaparolaNeden: ham };
  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: room.result.winnerSeat !== null && p.seat === room.result.winnerSeat,
    gameState: passaparolaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: neden, winnerSeat: room.result.winnerSeat,
    youWon: false, isSpectator: true, gameState: passaparolaState(room, null)
  }));
}
/* Her hamleden sonra tek elden: bitti mi, yayınla. */
function passaparolaSonrasi(room) {
  const q = room.passaparola;
  room.passaparolaSonTik = now();     // yeni sıraya temiz saat
  touchMoveTimer(room);
  if (q.status !== 'playing') {
    passaparolaBitisYayinla(room);
    emitPassaparolaState(room); emitRoom(room); scheduleRoomReset(room);
    return true;
  }
  emitPassaparolaState(room);
  return false;
}
/* SAAT DÖNGÜSÜ — ana zamanlayıcıdan saniyede bir işler. Yalnız sırası olan
   oyuncunun saati azalır; sıfırlanınca sıra rakibe geçer. */
function passaparolaClockTick(room) {
  const q = room.passaparola;
  if (!q || q.status !== 'playing') return;
  const gecen = now() - (room.passaparolaSonTik || now());
  const sn = Math.floor(gecen / 1000);
  if (sn < 1) return;
  room.passaparolaSonTik = (room.passaparolaSonTik || now()) + sn * 1000;
  const r = passaparolaEngine.tik(q, sn);
  if (r.sureBitti) {
    io.to(room.id).emit('passaparolaTimeout', { roomId: room.id, seat: r.seat });
    passaparolaSonrasi(room);
    emitRoom(room);
    return;
  }
  if (r.degisti) emitPassaparolaState(room);
}

/* ========================================================================
 * TOMBALA — oda akışı
 * ========================================================================
 * Oyuncu hamlesi YOKTUR: sunucu belirli aralıklarla bir top çeker, kartlar
 * kendiliğinden kapanır. Bu yüzden hamle süresi, sıra ve terk cezası
 * işletilmez; masanın "hamle süresi" ayarı burada ÇEKİLİŞ ARALIĞI anlamına
 * gelir (kurucu panelinden masa başına ayarlanabilir).
 * ====================================================================== */
const TOMBALA_VARSAYILAN_ARALIK_MS = 4000;
const TOMBALA_MIN_ARALIK_MS = 1500;

function tombalaAralikMs(room) {
  const sn = Number(room && room.moveLimitMs) > 0 ? Number(room.moveLimitMs) : 0;
  const ms = sn > 0 ? sn : TOMBALA_VARSAYILAN_ARALIK_MS;
  return Math.max(TOMBALA_MIN_ARALIK_MS, Math.min(20000, ms));
}
function tombalaState(room, seat) {
  const g = room.tombala && room.tombala.st;
  if (!g) return null;
  const v = tombalaEngine.gorunum(g, seat);
  v.status = room.status === 'playing' ? v.status : room.status;
  v.aralikMs = tombalaAralikMs(room);
  v.adlar = room.players.map(p => ({ seat: p.seat, name: p.name, ai: !!p.aiControlled }));
  return v;
}
function emitTombalaState(room, event) {
  const ev = event || 'gameStateUpdated';
  room.players.forEach(p => emitToPlayer(p, ev, {
    roomId: room.id, seat: p.seat, gameState: tombalaState(room, p.seat), isSpectator: false
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, ev, {
    roomId: room.id, seat: null, gameState: tombalaState(room, null), isSpectator: true
  }));
}
function tombalaZamanlayiciDurdur(room) {
  if (room && room.tombala && room.tombala.timer) {
    clearTimeout(room.tombala.timer);
    room.tombala.timer = null;
  }
}
function tombalaZamanlayiciKur(room) {
  tombalaZamanlayiciDurdur(room);
  if (!room || !room.tombala || room.status !== 'playing') return;
  room.tombala.timer = setTimeout(() => tombalaCek(room), tombalaAralikMs(room));
}
/* Eli KAPAT: skoru yaz, gameEnded duyur, odayı sıfırlamaya al. Hem normal
   bitişten (tombala verildi / torba boşaldı) hem de motorun "el çoktan bitti"
   dediği durumdan çağrılır — ikinci durum, eli dışarıdan bitiren bir akış
   (test, yönetici müdahalesi, yeniden yükleme) olduğunda odanın 'playing'
   takılı kalmasını önler. */
function tombalaBitir(room) {
  if (!room || !room.tombala) return;
  if (room.status === 'finished') return;   // iki yoldan da çağrılabilir, bir kez bitsin
  const g = room.tombala.st;
  tombalaZamanlayiciDurdur(room);
  room.status = 'finished';
  const sira = tombalaEngine.siralama(g);
  const kazananSeat = sira.length ? sira[0].seat : null;
  room.result = { winner: kazananSeat, reason: g.result && g.result.reason, siralama: sira };

  /* PUAN: tombala şansa dayanır, bu yüzden terk cezası yoktur; yalnız
     kazanana galibiyet yazılır (diğer oyunlardaki akışın aynısı). */
  try {
    puanYaz(scoring.macOlaylari({
      gameId: room.gameId, roomId: room.id, elSayisi: 1,
      oyuncular: room.players.map(p => ({
        uid: p.userId, ad: p.name, kazandi: p.seat === kazananSeat
      }))
    }));
  } catch (_) {}

  room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: 'finished',
    winnerSeat: kazananSeat, youWon: p.seat === kazananSeat,
    gameState: tombalaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameEnded', {
    roomId: room.id, reason: 'finished', winnerSeat: kazananSeat, youWon: false,
    gameState: tombalaState(room, null)
  }));
  emitRoom(room);
  scheduleRoomReset(room);
}
/* Bir top çek, kartları kapat, ödülleri duyur, el bitmediyse sırayı kur. */
function tombalaCek(room) {
  if (!room || !room.tombala || room.status !== 'playing') return;
  const g = room.tombala.st;
  const r = tombalaEngine.cek(g);
  if (!r.ok) {
    /* Motor "el bitti" diyor ama oda hâlâ oynuyor: eli şimdi kapat, yoksa
       kimseye gameEnded gitmez ve masa sonsuza kadar açık kalır. */
    tombalaZamanlayiciDurdur(room);
    if (r.reason === 'el_bitti') tombalaBitir(room);
    return;
  }

  io.to(room.id).emit('tombalaTop', {
    roomId: room.id, top: r.top, kalan: g.torba.length,
    kapatan: r.kapatan, yeniOduller: r.yeniOduller
  });
  emitTombalaState(room);

  if (!r.bitti) { tombalaZamanlayiciKur(room); return; }
  tombalaBitir(room);
}
function startTombala(room) {
  if (!tombalaEngine) return;
  if (room.status === 'playing') return;
  if (room.players.length < 2 || room.players.length !== room.maxPlayers) return;
  if (!room.players.every(p => p.isReady)) return;
  cancelRoomReset(room);
  room.status = 'playing';
  room.result = null;
  room.tombala = { st: tombalaEngine.elBaslat({ seats: room.players.map(p => p.seat), roundNo: 1 }), timer: null };
  emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: p.seat, players: publicRoom(room).players,
    gameState: tombalaState(room, p.seat)
  }));
  (room.spectators || []).forEach(p => emitToPlayer(p, 'gameStarted', {
    roomId: room.id, seat: null, isSpectator: true, gameState: tombalaState(room, null)
  }));
  tombalaZamanlayiciKur(room);
}

function startGomoku(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.gomoku=gomokuEngine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?'b':'w',players:publicRoom(room).players,gameState:gomokuState(room,p.seat)}));emitGomokuState(room);}
function reversiState(room, seat) { const r=room.reversi; return {kind:'reversi',status:room.status,turn:r.turn,winner:r.winner,board:r.board.map(x=>x.slice()),seat,playerColor:seat===0?'b':'w',legalMoves:seat===null?[]:r.turn===(seat===0?'b':'w')?reversiEngine.legalMoves(r):[],result:r.result||null,...moveClockOf(room)}; }
function emitReversiState(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:reversiState(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:reversiState(room,null),isSpectator:true}));}
function startReversi(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.reversi=reversiEngine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?'b':'w',players:publicRoom(room).players,gameState:reversiState(room,p.seat)}));emitReversiState(room);}
function damaState(room, seat) { const d=room.dama; const isTurk=room.gameId==='turkdamasi'; const engine=isTurk?turkDamaEngine:damaEngine; /* Koltuk 0 açık taşları oynar (Türk daması 'w', İngiliz daması 'r');
     koltuk 1 her iki oyunda da siyahtır. Eski yazım "(isTurk?'b':'b')"
     gereksizce iki dallıydı ve niyeti gizliyordu. */
  const color = seat === 0 ? (isTurk ? 'w' : 'r') : 'b'; return {kind:room.gameId,status:room.status,turn:d.turn,winner:d.winner,board:d.board.map(r=>r.slice()),captures:{...d.captures},seat,playerColor:color,legalMoves:seat===null?[]:d.turn===color?engine.allMoves(d):[],...moveClockOf(room)}; }
function emitDamaState(room,event='gameStateUpdated'){room.players.forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:p.seat,gameState:damaState(room,p.seat),isSpectator:false}));(room.spectators||[]).forEach(p=>emitToPlayer(p,event,{roomId:room.id,seat:null,gameState:damaState(room,null),isSpectator:true}));}
function startDama(room){if(room.status==='playing'||room.players.length!==2||!room.players.every(p=>p.isReady))return;room.status='playing';room.result=null;room.dama=room.gameId==='turkdamasi'?turkDamaEngine.init():damaEngine.init();room.turnStartedAt=now();touchMoveTimer(room);emitRoom(room);room.players.forEach(p=>emitToPlayer(p,'gameStarted',{roomId:room.id,seat:p.seat,playerColor:p.seat===0?(room.gameId==='turkdamasi'?'w':'r'):'b',players:publicRoom(room).players,gameState:damaState(room,p.seat)}));emitDamaState(room);}

// ============== AMİRAL BATTI (Battleship) — koltuk-bazlı sis-of-war ==============
// Diğer tahta oyunlarının aksine burada durum tamamen simetrik değil:
// her koltuk kendi filosunu TAM görür, rakibinkini yalnızca "attığım
// atışlar" (isabet/ıska/battı) üzerinden görür — rakibin vurulmamış gemi
// konumları hiçbir zaman istemciye gönderilmez (okey'in gizli-el emsaline
// benzer bir şekillendirme; bkz. buildOkeyState).
function battleshipState(room, seat) {
  const b = room.battleship;
  const other = seat === 0 ? 1 : (seat === 1 ? 0 : null);
  const myShips = (seat !== null && b.ships[seat])
    ? b.ships[seat].map(s => ({ id: s.id, name: s.name, size: s.size, cells: s.cells.map(x => x.slice()), hits: s.hits.slice() }))
    : null;
  // Rakibin bana attığı atışlar — KENDİ tahtamda (isabet/ıska) göstermek için.
  const incomingShots = ((other !== null && b.shots[other]) || []).slice();
  // Benim rakibe attığım atışlar — rakip tahtasının sis-of-war görünümü için.
  const myShots = ((seat !== null && b.shots[seat]) || []).slice();
  // Rakip filosu: yalnızca TÜR + BATTI/BATMADI — konum asla gönderilmez.
  const enemyFleet = battleshipEngine.SHIPS.map(def => {
    const ship = (other !== null && b.ships[other]) ? b.ships[other].find(s => s.id === def.id) : null;
    return { id: def.id, name: def.name, size: def.size, sunk: ship ? ship.hits.every(Boolean) : false };
  });
  return {
    kind: 'battleship',
    status: room.status,
    phase: b.phase,
    macNo: b.macNo || 0,          // her yeni el için benzersiz damga (rövanş)
    seat,
    turn: b.turn,
    winner: b.winner,
    result: b.result,
    ready: { mine: seat !== null ? !!b.ready[seat] : false, opponent: other !== null ? !!b.ready[other] : false },
    // Yerleştirme fazının KENDİ süresi (hamle saatinden bağımsız).
    placeLimitMs: BATTLESHIP_PLACE_MS,
    placeRemainingMs: b.phase === 'placing' && room.moveStartedAt
      ? Math.max(0, BATTLESHIP_PLACE_MS - (now() - room.moveStartedAt)) : null,
    fleetDefs: battleshipEngine.SHIPS,
    size: battleshipEngine.SIZE,
    myShips,
    incomingShots,
    myShots,
    enemyFleet,
    ...moveClockOf(room)
  };
}
function emitBattleshipState(room, event = 'gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, { roomId: room.id, seat: p.seat, gameState: battleshipState(room, p.seat), isSpectator: false }));
  /* İzleyici seçtiği koltuğun EKRANINI görür (gemi yerleşimi dâhil); hiç
     seçmediyse ya da o oyuncu izni kaldırdıysa koltuk null'a düşer ve
     tarafsız görünüm gider. Koltuk her pakette yeniden doğrulanır. */
  (room.spectators || []).forEach(p => { const k = izleKoltuk(room, p); emitToPlayer(p, event, { roomId: room.id, seat: k, gameState: battleshipState(room, k), isSpectator: true }); });
}
function startBattleship(room) {
  if (room.status === 'playing' || room.players.length !== 2 || !room.players.every(p => p.isReady)) return;
  room.status = 'playing'; room.result = null;
  room.battleship = battleshipEngine.init();
  /* EL DAMGASI: rövanşta oda kimliği aynı kaldığı için istemci eski
     yerleşimini (filo dizili + "onayladım") sürdürüyor ve yeni filoyu hiç
     göndermiyordu. Her yeni el benzersiz bir damga taşır; istemci damga
     değişince yerleşimi sıfırdan kurar. */
  room.battleship.macNo = now();
  room.turnStartedAt = now(); touchMoveTimer(room);
  emitRoom(room);
  room.players.forEach(p => emitToPlayer(p, 'gameStarted', { roomId: room.id, seat: p.seat, players: publicRoom(room).players, gameState: battleshipState(room, p.seat) }));
  emitBattleshipState(room);
}

function cardGameState(room, forSeat) {
  const st = room.cardGame;
  if (!st) return null;
  const isPisti = room.gameId === 'pisti';
  const hands = isPisti ? st.hands.map((h,i)=>i===forSeat?h.length:h.length) : st.hands.map(h=>h.length);
  return { kind: room.gameId, status: room.status, phase: st.phase || 'play', turn: st.turn,
    hand: forSeat == null ? [] : (st.hands[forSeat] || []).slice(), handCounts: hands,
    center: (st.center || []).slice(), trick: (st.trick || []).slice(), captures: st.captures ? st.captures.map(x=>x.length) : [],
    scores: (st.scores || []).slice(), bids: st.bids ? st.bids.slice() : [], trump: st.trump,
    deckCount: st.deck ? st.deck.length : 0, tricks: st.tricks ? st.tricks.slice() : [], result: st.result || null,
    ...moveClockOf(room)
  };
}
function emitCardState(room, event='gameStateUpdated') {
  room.players.forEach(p => emitToPlayer(p, event, { roomId: room.id, seat:p.seat, gameState:cardGameState(room,p.seat), isSpectator:false }));
  (room.spectators||[]).forEach(p => { const k = izleKoltuk(room, p); emitToPlayer(p,event,{roomId:room.id,seat:k,gameState:cardGameState(room,k),isSpectator:true}); });
  // Sıra yapay zekâdaysa hamlesini zamanla (pişti/batak masaları).
  try { aiSiraKontrol(room); } catch (_) {}
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
  if (room.tombala) return tombalaState(room, opts && opts.seat);
  if (room.kelimelik) return kelimelikState(room, opts && opts.seat);
  if (room.adamasmaca) return adamasmacaState(room, opts && opts.seat);
  if (room.passaparola) return passaparolaState(room, opts && opts.seat);
  if (room.cenga) return cengaState(room, opts && opts.seat);
  if (room.langirt) return langirtState(room, opts && opts.seat);
  if (room.havahokeyi) return havahokeyiState(room, opts && opts.seat);
  if (room.fark) return farkState(room, opts && opts.seat);
  if (room.kizma) return kizmaState(room, opts && opts.seat);
  if (room.metropol) return metropolState(room, opts && opts.seat);
  if (room.connect4) return connect4State(room, opts && opts.seat);
  if (room.bilardo) return bilardoState(room, opts && opts.seat);
  if (room.battleship) return battleshipState(room, opts && opts.seat);
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
  /* KOLTUK SEÇEREK İZLEME: izleyici odaya girdiğinde ya da yeniden
     bağlandığında da seçtiği oyuncunun EKRANINI alır. Oyuncu için bakış
     kendi koltuğu; seçim yoksa veya izin kalkmışsa null (tarafsız). */
  const izleyici = player ? null : (room && (room.spectators || []).find(x => x.id === socketId));
  const bakis = player ? player.seat : izleKoltuk(room, izleyici);
  if (room && room.status === 'playing' && room.okey) {
    emitToPlayer({ id: socketId }, 'gameStarted', {
      roomId: room.id,
      seat: bakis,
      playerColor: null,
      isSpectator: !player,
      players: publicRoom(room).players,
      gameState: buildOkeyState(room, bakis)
    });
    emitToPlayer({ id: socketId }, 'gameStateUpdated', {
      roomId: room.id,
      seat: bakis,
      playerColor: null,
      isSpectator: !player,
      gameState: buildOkeyState(room, bakis)
    });
    return;
  }
  if (room && room.status === 'playing' && room.bilardo) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:bilardoState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:bilardoState(room,p)}); return; }
  if (room && room.status === 'playing' && room.battleship) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:battleshipState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:battleshipState(room,p)}); return; }
  if (room && room.status === 'playing' && room.connect4) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:connect4State(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:connect4State(room,p)}); return; }
  if (room && room.status === 'playing' && room.kizma) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:kizmaState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:kizmaState(room,p)}); return; }
  if (room && room.status === 'playing' && room.metropol) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:metropolState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:metropolState(room,p)}); return; }
  if (room && room.status === 'playing' && room.fark) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:farkState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:farkState(room,p)}); return; }
  if (room && room.status === 'playing' && room.havahokeyi) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:havahokeyiState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:havahokeyiState(room,p)}); return; }
  if (room && room.status === 'playing' && room.langirt) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:langirtState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:langirtState(room,p)}); return; }
  if (room && room.status === 'playing' && room.cenga) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:cengaState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:cengaState(room,p)}); return; }
  if (room && room.status === 'playing' && room.passaparola) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:passaparolaState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:passaparolaState(room,p)}); return; }
  if (room && room.status === 'playing' && room.adamasmaca) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:adamasmacaState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:adamasmacaState(room,p)}); return; }
  if (room && room.status === 'playing' && room.kelimelik) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:kelimelikState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:kelimelikState(room,p)}); return; }
  if (room && room.status === 'playing' && room.tombala) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:tombalaState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:tombalaState(room,p)}); return; }
  if (room && room.status === 'playing' && room.gomoku) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:gomokuState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:gomokuState(room,p)}); return; }
  if (room && room.status === 'playing' && room.reversi) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:reversiState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:reversiState(room,p)}); return; }
  if (room && room.status === 'playing' && room.dama) { const p=bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:damaState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:damaState(room,p)}); return; }
  if (room && room.status === 'playing' && room.cardGame) { const p = bakis; io.to(socketId).emit('gameStarted',{roomId:room.id,seat:p,isSpectator:!player,players:publicRoom(room).players,gameState:cardGameState(room,p)}); io.to(socketId).emit('gameStateUpdated',{roomId:room.id,seat:p,isSpectator:!player,gameState:cardGameState(room,p)}); return; }
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
  if (room.gameId === 'tombala') return startTombala(room);
  if (room.gameId === 'kelimelik') return startKelimelik(room);
  if (room.gameId === 'adamasmaca') return startAdamasmaca(room);
  if (room.gameId === 'passaparola') return startPassaparola(room);
  if (room.gameId === 'cenga') return startCenga(room);
  if (room.gameId === 'langirt') return startLangirt(room);
  if (room.gameId === 'havahokeyi') return startHavahokeyi(room);
  if (room.gameId === 'fark') return startFark(room);
  if (room.gameId === 'kizmabirader') return startKizma(room);
  if (room.gameId === 'metropol') return startMetropol(room);
  if (room.gameId === 'connect4') return startConnect4(room);
  if (room.gameId === 'bilardo') return startBilardo(room);
  if (room.gameId === 'battleship') return startBattleship(room);
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
  /* 101 masaları yeni motora gider; motor yüklenemediyse (dosya yok) eski
     davranışa düşeriz — oyun hiç açılmamasındansa klasik kurallarla açılsın. */
  /* GERÇEK 101 KURALLARI artık varsayılan. Arayüz tarafı hazır: masadaki
     açık perler çiziliyor, "El Aç" penceresi ve işleme çalışıyor
     (js/okey-online.js + js/okey101-ac.js).
     GV_OKEY101_GERCEK=0 ile eski (klasik kurallı) 101'e dönülebilir —
     yayında beklenmedik bir şey çıkarsa kod değiştirmeden geri alma yolu. */
  const yeni101 = variant === 'okey101' && !!okey101Engine &&
                  String(process.env.GV_OKEY101_GERCEK || '1') !== '0';
  const seats = room.players.map(p => p.seat).sort((a, b) => a - b);
  const scores = Object.fromEntries(seats.map(s => [s, 0]));
  room.okey = {
    variant,
    yeni101,
    roundState: yeni101
      ? okey101Engine.startRound(1, seats, scores, undefined, undefined)
      : okeyEngine.startRound(1, seats, scores, undefined, undefined, variant),
    currentRound: 1,
    // Okey 101'de el limiti kullanılmaz (maç 101 puanda biter); standartta
    // oda bazlı el sayısı (masayı kuran / hazır masa tanımı belirler).
    maxRounds: variant === 'okey101' ? OKEY101_MAX_ROUNDS : (room.okeyMaxRounds || OKEY_MAX_ROUNDS),
    // Koltuk başına ANA süre (masa süresi 10/15/20 dk, herkesinki ayrı).
    clockMs: Object.fromEntries(seats.map(s => [s, room.durationMinutes * 60 * 1000])),
    clockStartedAt: now(),
    /* Tur sayacı MASANIN hamle süresinden gelir (kurucu paneli masa başına
       ayarlayabiliyor); masaya değer girilmemişse varsayılan OKEY_TURN_MS. */
    turnDeadlineMs: Number(room.moveLimitMs) > 0 ? Number(room.moveLimitMs) : OKEY_TURN_MS,
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
  /* GERÇEK 101: masadaki açık perler ve kimin açtığı HERKESE açıktır —
     oyunun bütün bilgisi orada. Klasik okeyde bu alanlar hiç gönderilmez,
     eski istemci de etkilenmez. */
  if (yeni101Mi(room)) {
    state.kural = '101';
    state.melds = (st8.melds || []).map(m => ({
      id: m.id, seat: m.seat, tur: m.tur, tiles: m.tiles.slice()
    }));
    state.opened = Object.assign({}, st8.opened);
    state.acmaPuani = okey101Engine.ACMA_PUANI;
    state.ciftAdedi = okey101Engine.CIFT_ACMA_ADEDI;
    state.cezaSiniri = Number(room.okeyTarget) > 0 ? Number(room.okeyTarget) : okey101Engine.CEZA_SINIRI;
  }
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
    const k = izleKoltuk(room, spec);
    emitToPlayer(spec, evt, {
      roomId: room.id,
      seat: k,
      playerColor: null,
      isSpectator: true,
      players: publicRoom(room).players,
      gameState: buildOkeyState(room, k)
    });
  });
  // Sıra yapay zekânın tuttuğu bir koltuktaysa hamlesini zamanla.
  // Buraya bağlamak yeterli: okey masasındaki HER durum değişimi bu
  // fonksiyondan geçer, dolayısıyla bot hiçbir turu kaçırmaz.
  try { aiSiraKontrol(room); } catch (_) {}
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
  /* Kazananı seçer. YÖN OYUNA GÖRE DEĞİŞİR:
       klasik okey / eski 101 : puan KAZANÇ'tır → en YÜKSEK kazanır
       gerçek 101             : puan CEZA'dır   → en DÜŞÜK kazanır
     Bu ayrım atlanırsa 101'de en çok ceza alan oyuncu kazanmış görünür —
     oyunun tamamını tersine çeviren sessiz bir hata olurdu. */
  const scores = room.okey?.roundState?.scores || {};
  const cezaMi = yeni101Mi(room);
  let best = null;
  room.players.forEach(p => {
    if (excludedSeat !== null && excludedSeat !== undefined && p.seat === excludedSeat) return;
    const sc = scores[p.seat] || 0;
    const daha = !best || (cezaMi ? sc < best.score : sc > best.score);
    if (daha) best = { seat: p.seat, score: sc, name: p.name };
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
    const k = izleKoltuk(room, spec);
    emitToPlayer(spec, 'gameEnded', {
      roomId: room.id,
      reason,
      winner: room.result.winner,
      winnerSeat: room.result.winnerSeat,
      winnerName: room.result.winnerName,
      loserSeat: loserSeat ?? null,
      seat: k,
      youWon: false,
      isSpectator: true,
      gameState: buildOkeyState(room, k)
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
  if (yeni101Mi(room)) {
    /* GERÇEK 101: puanlar CEZA'dır, motor el sonunda zaten ekledi. Maç,
       biri ceza sınırına ulaşınca biter ve EN DÜŞÜK toplam kazanır. */
    const sinir = Number(room.okeyTarget) > 0 ? Number(room.okeyTarget) : okey101Engine.CEZA_SINIRI;
    const mac = okey101Engine.macBittiMi(ok.roundState.scores, ok.roundState.seats, sinir);
    ok.macSonucu = mac || null;
    matchOver = !!mac || ok.currentRound >= ok.maxRounds;
  } else if (is101) {
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
  /* EL BİTTİ VE MASADA BOT VAR: kullanıcı isteği — "çıkan oyuncunun yerini
     o EL için bot sürdürsün, el bitince herkese oylama sunulsun". Bot
     koltuğu burada kalkıyor; devam kararını masadaki insanlar veriyor. */
  if (aiKoltuklari(room).length && insanKoltuklari(room).length >= 1) {
    masaOylamasiBaslat(room);
    return;
  }

  ok.between = setTimeout(() => {
    ok.between = null;
    if (room.status !== 'playing') return; // arada maç bitmişse
    if (room.players.length !== room.maxPlayers) { endOkeyMatch(room, 'player_left', null); return; }
    ok.currentRound += 1;
    // Varyant KORUNUR: okey101 masasında 2. el de 101 varyantıyla kurulur.
    ok.roundState = yeni101Mi(room)
      ? okey101Engine.startRound(ok.currentRound, ok.roundState.seats, ok.roundState.scores)
      : okeyEngine.startRound(ok.currentRound, ok.roundState.seats, ok.roundState.scores,
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
    const M = okeyMotoru(room);
    if (ok.roundState.phase === 'draw') {
      const r = M.drawFromDeck(ok.roundState, turnSeat);
      if (r.ok && r.deckEmpty) { okeyRoundFinished(room); return; }
    }
    ok.clockStartedAt = now(); // çekim süresini tur sahibine yazdık
    const hand = ok.roundState.hands[turnSeat] || [];
    /* Okey taşını otomatik atmıyoruz: elin en değerli taşı o, süresi
       dolan oyuncuyu bir de ondan etmeyelim. İki motorda okey denetimi
       ayrı adlarla duruyor. */
    const okeyMi = t => (M === okey101Engine)
      ? okey101Engine.isOkey(t, ok.roundState.realOkey)
      : okeyEngine.isRealOkeyTile(t, ok.roundState.realOkey);
    const nonOkey = hand.find(t => !okeyMi(t));
    const tile = nonOkey || hand[0];
    if (tile) M.discard(ok.roundState, turnSeat, tile.id);
    if (ok.roundState.finished) { okeyRoundFinished(room); return; }
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

// ===========================================================================
// YAPAY ZEKÂ DEVRALMA (3–4 kişilik oyunlar)
// ---------------------------------------------------------------------------
// Kullanıcının kuralı:
//   * 2 kişilik oyunlarda terk = hükmen mağlubiyet (eskisi gibi).
//   * 3–4 kişilik oyunlarda masayı terk eden oyuncunun yerine, MAÇIN EL
//     SAYISI TAMAMLANANA KADAR idareten oynayan bir yapay zekâ geçer.
//   * Koltuğu YALNIZ o koltukta oyuna başlamış ÜYE (sabit ID) geri alabilir.
//     Misafir terk ettiyse koltuk maç sonuna kadar yapay zekâda kalır.
//   * Terk eden −20 ceza alır; geri dönerse +10 iade edilir.
//
// Koltuk odadan SİLİNMEZ: motor durumu (eller, sıra, puanlar) koltuk
// numarasına bağlıdır; koltuğu çıkarmak maçı bozardı. Bunun yerine
// koltuk "yapay zekâ kontrolünde" işaretlenir.
// ===========================================================================
// Hamle gecikmesi: bot anında oynarsa masa "hileli" hissettirir; insanlar
// neler olduğunu takip edemez. Testlerde GV_AI_DELAY_MS ile kısaltılır.
const AI_HAMLE_GECIKME_MS = Math.max(0, Number(process.env.GV_AI_DELAY_MS) || 1400);

function aiOyunuDestekliyor(room) {
  return !!room && ai.aiDestekli(room.gameId) && (room.maxPlayers || 0) >= 3;
}

function aiKoltuklari(room) {
  return (room.players || []).filter(p => p && p.aiControlled);
}
function insanKoltuklari(room) {
  return (room.players || []).filter(p => p && !p.aiControlled);
}

/* ===========================================================================
 * MASA OYLAMASI — "eksik kişiyle devam edelim mi?"
 * ===========================================================================
 * Kullanıcı isteği: "çıkan oyuncu yerini o elde geçerli olmak üzere bir bot
 * devam ettirsin. Ardından o el bittikten sonra tüm oyunculara oylama
 * sunulsun; devam et oylanırsa kalan kişi sayısı kurallarına göre devam
 * ederler, oylama başarısız olursa herkes lobiye yönlendirilir."
 *
 * KARAR KURALI: masadaki İNSANLARIN HEPSİ "devam" demeli. Çoğunluk
 * seçilseydi, devam etmek istemeyen oyuncu kendi istemediği bir maça
 * bağlanmış olurdu; oysa ayrılmak serbest ve maliyetsiz olmalı. Süre
 * dolarsa "hayır" sayılır — yanıt vermeyen biri masayı sonsuza kadar
 * bekletemesin.
 *
 * Oylama BAŞARILIYSA bot koltukları kalkar, masa küçülür ve kalan kişi
 * sayısının kurallarıyla yeni el başlar (4→3, 3→2). Oyunun alt sınırının
 * altına inilecekse (batak 3) oylama anlamsızdır: maç orada biter.
 * ======================================================================== */
/* ==========================================================================
 * BEKLEME ODASI — HAZIR SÜRESİ SAYACI
 * ==========================================================================
 * Kullanıcı isteği: "Oyuncular bekleme odasında beklerken, birisi hazır
 * vermişken diğeri vermiyorsa 30 saniye hazır basma süresi verilsin, ardından
 * hazır vermeyen odadan otomatik atılsın ve lobiye yönlendirilsin... 3 veya 4
 * kişilik odalarda da oda sayısı dolduysa ve içlerinden 1 tanesi bile hazır
 * verdiyse 30 saniyelik süre başlar... Oyuncular sürekli 'hazır yap' ve 'iptal
 * et' yaparak bug yapmaya çalışabilirler, o yüzden sayaç başladığında sadece 1
 * kere geçerli olacak; 30. saniye dolduğunda kim hazır vermediyse o atılır."
 *
 * KURALLAR
 *   - Yalnız NORMAL (hazır/genel) masalarda. Özel masalarda çalışmaz: orada
 *     kurucu kimi beklediğini bilir ve zaten atma yetkisi vardır.
 *   - Masa DOLMADAN sayaç başlamaz: eksik masada bekleyen kimseyi bekletmiyor.
 *   - En az bir oyuncu hazır verdiğinde başlar.
 *   - BİR KEZ başlar ve durdurulamaz: hazır/iptal yapmak sayacı ne sıfırlar
 *     ne de iptal eder (oyun açılmadan masayı kilitleme denemesinin önü).
 *   - Süre dolduğunda hazır OLMAYAN herkes masadan çıkarılır ve lobiye
 *     yönlendirilir; hazır olanlar masada kalır.
 *   - Oyun bu arada başladıysa sayaç işlevsizleşir (status artık 'waiting'
 *     değildir).
 * ======================================================================== */
const HAZIR_SURESI_MS = Math.max(5000, Number(process.env.GV_HAZIR_SURESI_MS) || 30000);

/* Sayacın koşulları: normal masa, bekleme durumunda ve KOLTUKLAR DOLU. */
function hazirSayaciUygunMu(room) {
  if (!room || room.isPrivate) return false;
  if (room.status !== 'waiting') return false;
  const kisi = (room.players || []).length;
  return kisi >= 2 && kisi === room.maxPlayers;
}
function hazirSayaciKalan(room) {
  if (!room || !room.hazirSayac) return 0;
  if (room.status !== 'waiting') return 0;   // oyun başladıysa sayacın anlamı yok
  return Math.max(0, room.hazirSayac.bitis - now());
}
function hazirSayaciTemizle(room) {
  if (!room || !room.hazirSayac) return;
  try { clearTimeout(room.hazirSayac.timer); } catch (_) {}
  room.hazirSayac = null;
}
/* Sayacı başlat. Zaten işliyorsa HİÇBİR ŞEY yapmaz — "bir kez geçerli"
   kuralı tam olarak burada duruyor. */
function hazirSayaciBaslat(room) {
  if (!room) return;
  /* Oyun bu arada başladıysa (herkes hazır verdi) bekleyen sayaç düşer:
     maç sırasında kimse "hazır değil" diye atılmaz. */
  if (room.status !== 'waiting') { hazirSayaciTemizle(room); return; }
  if (room.hazirSayac) return;
  if (!hazirSayaciUygunMu(room)) return;
  if (!(room.players || []).some(p => p && p.isReady)) return;   // kimse hazır değil
  if ((room.players || []).every(p => p && p.isReady)) return;   // herkes hazır: oyun başlıyor
  const bitis = now() + HAZIR_SURESI_MS;
  room.hazirSayac = {
    bitis,
    timer: setTimeout(() => hazirSayaciBitir(room), HAZIR_SURESI_MS)
  };
  io.to(room.id).emit('hazirSayaci', {
    roomId: room.id, kalan: HAZIR_SURESI_MS, sure: HAZIR_SURESI_MS
  });
  console.log(`[ODA #${room.id}] hazır süresi başladı — ${Math.round(HAZIR_SURESI_MS / 1000)} sn`);
  emitRoom(room);
}
/* Süre doldu: hazır olmayan herkes masadan çıkar. */
function hazirSayaciBitir(room) {
  if (!room) return;
  hazirSayaciTemizle(room);
  if (room.status !== 'waiting') return;           // oyun başlamış: iş yok
  const atilacak = (room.players || []).filter(p => p && !p.isReady && !p.aiControlled);
  if (!atilacak.length) return;
  for (const p of atilacak) {
    const sck = io.sockets.sockets.get(p.id);
    if (sck) {
      try {
        sck.emit('kickedFromRoom', {
          roomId: room.id,
          reason: 'not_ready',
          message: 'Hazır süresi doldu — masadan çıkarıldınız.'
        });
        sck.leave(room.id);
        if (sck.roomId === room.id) sck.roomId = null;
        sck.role = null;
      } catch (_) {}
    }
    removePlayerFromRoom(room, p, 'Hazır süresi dolduğu için oyuncu masadan çıkarıldı.');
  }
  console.log(`[ODA #${room.id}] hazır süresi doldu — ${atilacak.length} oyuncu masadan çıkarıldı.`);
  io.to(room.id).emit('hazirSayacSonu', {
    roomId: room.id,
    atilan: atilacak.map(p => p.name || 'Oyuncu')
  });
  emitRoom(room);
  startRoomGame(room);                 // kalanlar hazırsa masa hemen başlar
}

const MASA_OYLAMA_MS = Math.max(5000, Number(process.env.GV_MASA_OYLAMA_MS) || 30000);

function masaOylamasiYayinla(room) {
  const o = room.masaOylama;
  if (!o) return;
  const insanlar = insanKoltuklari(room);
  const ortak = {
    roomId: room.id,
    ayrilanlar: o.ayrilanlar,
    yeniKisi: o.yeniKisi,
    enAz: minOyuncu(room.gameId),
    bitis: o.bitis,
    kalanMs: Math.max(0, o.bitis - now()),
    oyVerenler: insanlar.filter(p => o.votes[p.seat] === true).map(p => p.seat),
    gereken: insanlar.length
  };
  insanlar.forEach(p => emitToPlayer(p, 'masaOylamasi', Object.assign({}, ortak, {
    seat: p.seat, senOyVerdin: o.votes[p.seat] === true
  })));
  (room.spectators || []).forEach(sp => emitToPlayer(sp, 'masaOylamasi',
    Object.assign({}, ortak, { seat: null, senOyVerdin: false, isSpectator: true })));
}

function masaOylamasiBaslat(room) {
  if (!room || room.masaOylama) return;
  const botlar = aiKoltuklari(room);
  const insanlar = insanKoltuklari(room);
  if (!botlar.length || !insanlar.length) return;
  const yeniKisi = insanlar.length;

  /* Alt sınırın altına düşülüyorsa oylamaya gerek yok: oyun o kişi sayısıyla
     oynanamaz. Masada tek insan kaldıysa da aynı — rakipsiz maç olmaz. */
  if (yeniKisi < minOyuncu(room.gameId) || yeniKisi < 2) {
    if (room.okey) endOkeyMatch(room, 'player_left', botlar[0].seat);
    return;
  }

  room.masaOylama = {
    votes: {},
    ayrilanlar: botlar.map(p => p.aiOriginalName || p.name || 'Oyuncu'),
    yeniKisi,
    bitis: now() + MASA_OYLAMA_MS,
    timer: setTimeout(() => masaOylamasiBitir(room, false), MASA_OYLAMA_MS)
  };
  console.log(`[ODA #${room.id}] masa oylaması başladı — ${yeniKisi} kişiyle devam?`);
  masaOylamasiYayinla(room);
}

function masaOylamasiOyVer(room, seat, evet) {
  const o = room && room.masaOylama;
  if (!o) return;
  const p = (room.players || []).find(x => x.seat === seat && !x.aiControlled);
  if (!p) return;
  if (!evet) return masaOylamasiBitir(room, false);
  o.votes[seat] = true;
  const insanlar = insanKoltuklari(room);
  if (insanlar.every(x => o.votes[x.seat] === true)) return masaOylamasiBitir(room, true);
  masaOylamasiYayinla(room);
}

function masaOylamasiTemizle(room) {
  if (room && room.masaOylama && room.masaOylama.timer) clearTimeout(room.masaOylama.timer);
  if (room) room.masaOylama = null;
}

function masaOylamasiBitir(room, devam) {
  if (!room || !room.masaOylama) return;
  const yeniKisi = room.masaOylama.yeniKisi;
  masaOylamasiTemizle(room);
  io.to(room.id).emit('masaOylamaSonucu', { roomId: room.id, devam: !!devam, yeniKisi });

  if (!devam) {
    /* Oylama geçmedi: maç biter, herkes lobiye. Kazanan, o ana kadarki
       skorlara göre belirlenir (okeyLeaderAmong oyuna göre yön seçiyor). */
    if (room.okey) endOkeyMatch(room, 'vote_failed', null);
    else { room.status = 'finished'; emitRoom(room); scheduleRoomReset(room); }
    return;
  }

  /* DEVAM: bot koltukları kalkar, masa küçülür, kalan kişi sayısının
     kurallarıyla YENİ EL başlar. Koltuk numaraları yeniden verilir ki
     motorun sıra döngüsü boşluksuz olsun. */
  const botlar = aiKoltuklari(room);
  botlar.forEach(p => { if (p.aiTimer) { clearTimeout(p.aiTimer); p.aiTimer = null; } });
  room.players = insanKoltuklari(room);
  room.players.forEach((p, i) => { p.seat = i; p.isReady = true; });
  room.maxPlayers = yeniKisi;
  console.log(`[ODA #${room.id}] oylama geçti — ${yeniKisi} kişiyle devam ediliyor.`);

  if (room.okey) {
    const ok = room.okey;
    const seats = room.players.map(p => p.seat);
    /* Puanlar SIFIRDAN başlar: koltuklar yeniden numaralandığı için eski
       skorları taşımak yanlış kişiye yazmak demek olurdu. */
    const scores = Object.fromEntries(seats.map(s => [s, 0]));
    ok.currentRound += 1;
    ok.roundState = yeni101Mi(room)
      ? okey101Engine.startRound(ok.currentRound, seats, scores)
      : okeyEngine.startRound(ok.currentRound, seats, scores,
          undefined, undefined, ok.roundState.variant || ok.variant);
    ok.clockMs = Object.fromEntries(seats.map(s => [s, room.durationMinutes * 60 * 1000]));
    ok.clockStartedAt = now();
    ok.turnStartedAt = now();
    ok.strikes = Object.fromEntries(seats.map(s => [s, 0]));
    touchMoveTimer(room);
    emitRoom(room);
    emitOkeyState(room, 'gameStarted');
    return;
  }
  emitRoom(room);
}

// Koltuğu yapay zekâya devret.
function aiDevral(room, player, sebep) {
  if (!room || !player) return false;
  player.aiControlled = true;
  player.aiSince = now();
  player.isReady = true;
  // Yalnız ÜYE koltuğu geri alabilir: misafirde userId yoktur, o yüzden
  // rezervasyon da yoktur (kullanıcının kuralı).
  player.aiReservedUserId = Number(player.userId) > 0 ? Number(player.userId) : null;
  player.aiOriginalName = player.aiOriginalName || player.name;
  player.name = (player.aiOriginalName || 'Oyuncu') + ' 🤖';
  player.disconnectedAt = null;
  player.id = 'ai:' + room.id + ':' + player.seat;   // soketi yok
  console.log(`[ODA #${room.id}] koltuk ${player.seat} yapay zekâya devredildi (${sebep || 'terk'})` +
              (player.aiReservedUserId ? ` — üye #${player.aiReservedUserId} geri dönebilir` : ' — misafir, geri dönüş yok'));
  io.to(room.id).emit('aiTookSeat', {
    roomId: room.id, seat: player.seat, name: player.name,
    geriDonebilir: !!player.aiReservedUserId,
    mesaj: (player.aiOriginalName || 'Bir oyuncu') + ' masadan ayrıldı; yerine yapay zekâ oynuyor.'
  });
  return true;
}

// Koltuğu geri ver (üye döndü).
function aiBirak(room, player, socket) {
  if (!room || !player) return false;
  player.aiControlled = false;
  player.aiSince = null;
  player.name = player.aiOriginalName || player.name;
  player.aiOriginalName = null;
  player.id = socket.id;
  player.disconnectedAt = null;
  if (player.aiTimer) { clearTimeout(player.aiTimer); player.aiTimer = null; }
  io.to(room.id).emit('aiLeftSeat', {
    roomId: room.id, seat: player.seat, name: player.name,
    mesaj: player.name + ' oyuna geri döndü.'
  });
  return true;
}

// Sırası yapay zekâdaki bir koltuktaysa hamlesini zamanla.
function aiSiraKontrol(room) {
  if (!room || room.status !== 'playing') return;
  const botlar = aiKoltuklari(room);
  if (!botlar.length) return;
  for (const bot of botlar) {
    if (bot.aiTimer) continue;
    if (!aiSirasiMi(room, bot.seat)) continue;
    bot.aiTimer = setTimeout(() => {
      bot.aiTimer = null;
      try { aiOyna(room, bot); } catch (e) { console.warn('yapay zekâ hamlesi başarısız:', e.message); }
    }, AI_HAMLE_GECIKME_MS);
    if (bot.aiTimer.unref) bot.aiTimer.unref();
  }
}

function aiSirasiMi(room, seat) {
  if (room.okey && room.okey.roundState) {
    return !room.okey.between && room.okey.roundState.turn === seat && !room.okey.roundState.finished;
  }
  if (room.cardGame) {
    const c = room.cardGame;
    if (c.finished) return false;
    if (room.gameId === 'batak') {
      if (c.phase === 'bid') return c.bidTurn === seat;
      if (c.phase === 'trump') return c.bidder === seat;
      return c.turn === seat;
    }
    return c.turn === seat;
  }
  return false;
}

// Yapay zekânın hamlesini UYGULA. Gerçek oyuncunun soket yolundan geçen
// motor çağrılarının aynısını kullanır — kural kaçağı olmaz.
function aiOyna(room, bot) {
  if (!rooms.get(room.id) || room.status !== 'playing' || !bot.aiControlled) return;
  if (!aiSirasiMi(room, bot.seat)) return;

  /* GERÇEK 101: ai.okeyHamle klasik okeyin "eli bitir" mantığına göre
     yazıldı (okeyEngine.finish çağırıyor); 101'de o eylem yok. Bot burada
     kuralına uygun ama iddiasız oynar: çek, açabiliyorsa aç, en pahalı
     taşı at. Amaç masayı kilitlememek — insan oyuncunun yerini geçici
     doldurduğu için güçlü oynaması gerekmiyor. */
  if (yeni101Mi(room) && room.okey.roundState) {
    const st8 = room.okey.roundState;
    if (st8.phase === 'draw') {
      let r = okey101Engine.drawFromPrev(st8, bot.seat);
      if (!r.ok) r = okey101Engine.drawFromDeck(st8, bot.seat);
      if (r.ok && r.deckEmpty) { okeyRoundFinished(room); return; }
    }
    const el = (st8.hands || {})[bot.seat] || [];
    if (el.length > 1) {
      /* En pahalı taşı at ama okeyi elde tut (en değerli joker odur). */
      let aday = null;
      for (const t of el) {
        if (okey101Engine.isOkey(t, st8.realOkey)) continue;
        if (!aday || (Number(t.n) || 0) > (Number(aday.n) || 0)) aday = t;
      }
      okey101Engine.discard(st8, bot.seat, (aday || el[0]).id);
    }
    room.okey.turnStartedAt = now();
    touchMoveTimer(room);
    if (st8.finished) { okeyRoundFinished(room); return; }
    emitOkeyState(room, 'okeyAutoPlayed');
    return;
  }

  if (room.okey && room.okey.roundState) {
    const st8 = room.okey.roundState;
    const h = ai.okeyHamle(st8, bot.seat, okeyEngine);
    if (!h) return;
    let res = null;
    if (h.tur === 'draw') {
      res = h.kaynak === 'prev' ? okeyEngine.drawFromPrev(st8, bot.seat) : okeyEngine.drawFromDeck(st8, bot.seat);
      // Yanlış kaynak reddedilirse diğerini dene (kilitlenme olmasın).
      if (!res.ok) res = okeyEngine.drawFromDeck(st8, bot.seat);
      if (!res.ok) res = okeyEngine.drawFromPrev(st8, bot.seat);
    } else if (h.tur === 'finish') {
      res = okeyEngine.finish(st8, bot.seat, h.tileId);
      // Bitiş geçersizse normal atışa düş.
      if (!res.ok) res = okeyEngine.discard(st8, bot.seat, h.tileId);
    } else {
      res = okeyEngine.discard(st8, bot.seat, h.tileId);
    }
    if (!res || !res.ok) {
      // Son çare: elindeki İLK taşı at; oyun asla kilitlenmesin.
      const hand = (st8.hands || [])[bot.seat] || [];
      if (st8.phase === 'discard' && hand.length) okeyEngine.discard(st8, bot.seat, hand[0].id);
      else if (st8.phase === 'draw') okeyEngine.drawFromDeck(st8, bot.seat);
    }
    okeyAdvanceClock(room);
    if (room.okey.strikes) room.okey.strikes[bot.seat] = 0;
    if (st8.finished) okeyRoundFinished(room);
    else emitOkeyState(room);
    emitRoom(room);
    aiSiraKontrol(room);
    return;
  }

  if (room.cardGame) {
    const c = room.cardGame;
    const h = room.gameId === 'batak' ? ai.batakHamle(c, bot.seat) : ai.pistiHamle(c, bot.seat);
    if (!h) return;
    let res = null;
    if (h.tur === 'bid') res = batakEngine.bid(c, bot.seat, h.value);
    else if (h.tur === 'trump') res = batakEngine.trump(c, bot.seat, h.suit);
    else if (room.gameId === 'batak') res = batakEngine.play(c, bot.seat, h.index);
    else res = pistiEngine.play(c, bot.seat, h.index);
    if (res && !res.ok) {
      // Son çare: ilk geçerli kartı sırayla dene.
      const hand = (c.hands || [])[bot.seat] || [];
      for (let i = 0; i < hand.length; i++) {
        const r2 = room.gameId === 'batak' ? batakEngine.play(c, bot.seat, i) : pistiEngine.play(c, bot.seat, i);
        if (r2 && r2.ok) break;
      }
    }
    room.moveStartedAt = now();
    room.moveWarned = false;
    if (c.finished) {
      room.status = 'finished';
      const kazanan = room.gameId === 'batak'
        ? c.scores.indexOf(Math.max(...c.scores))
        : (c.result ? c.result.winner : null);
      room.result = { reason: 'finished', winner: kazanan, winnerSeat: kazanan };
      emitCardState(room);
      room.players.forEach(q => emitToPlayer(q, 'gameEnded', {
        roomId: room.id, reason: 'finished', winnerSeat: kazanan,
        youWon: q.seat === kazanan, gameState: cardGameState(room, q.seat)
      }));
      scheduleRoomReset(room);
    } else {
      emitCardState(room);
    }
    emitRoom(room);
    aiSiraKontrol(room);
  }
}

// Bir üyenin geri dönebileceği (yapay zekânın tuttuğu) koltuğu bul.
function aiBekleyenKoltuk(userId) {
  const uid = Number(userId);
  if (!(uid > 0)) return null;
  for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    const p = (room.players || []).find(x => x && x.aiControlled && Number(x.aiReservedUserId) === uid);
    if (p) return { room, player: p };
  }
  return null;
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
  // OKEY 101 CEZASI: gerçek okeyi açık atan oyuncunun adını da ekleyip
  // odaya bildir (bkz. okey-engine.js discard() → res.penalty).
  if (res.penalty) {
    const penaltyPlayer = (room.players || []).find(p => p.seat === res.penalty.seat);
    io.to(room.id).emit('okeyPenalty', {
      roomId: room.id,
      seat: res.penalty.seat,
      name: penaltyPlayer ? penaltyPlayer.name : null,
      amount: res.penalty.amount,
      reason: res.penalty.reason
    });
  }
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

/* İZNİ KALKAN KOLTUĞU İZLEYENLERİ ODADAN ÇIKAR
   Kullanıcı isteği: "eğer önceden izleyici var ise de artık oyundan izleyici
   atılır ve lobiye yönlendirilerek pop-up uyarı mesajıyla 'oyuncu izleyici
   iznini kapattı' uyarısı versin."
   Çıkarmak ŞART: izleyici odada kalsaydı bir sonraki pakette tarafsız
   görünüme düşerdi ama oyuncunun kararı "beni izlemesin" idi. */
function izleyicileriCikar(room, seat, oyuncuAdi) {
  if (!room) return 0;
  const gidecek = (room.spectators || []).filter(x => x.watchSeat === seat);
  if (!gidecek.length) return 0;
  for (const spec of gidecek) {
    room.spectators = (room.spectators || []).filter(s => s !== spec);
    try {
      io.to(spec.id).emit('spectatorEjected', {
        roomId: room.id,
        gameId: room.gameId,
        seat,
        name: oyuncuAdi || 'Oyuncu',
        reason: 'permission_revoked',
        message: (oyuncuAdi || 'Oyuncu') + ' izleyici iznini kapattı. Lobiye yönlendiriliyorsunuz.'
      });
      const sck = io.sockets.sockets.get(spec.id);
      if (sck) { sck.leave(room.id); sck.roomId = null; sck.role = null; }
    } catch (_) {}
  }
  emitRoom(room);
  return gidecek.length;
}

// Oyun sonrası oda TAKILI KALMAZ: bitişten (mat / süre / hamle hükmen /
// terk / mars) kısa bir süre sonra oda otomatik olarak beklemeye döner.
// Oyuncular hâlâ masadaysa koltukları korunur (rövanş için HAZIRIM yeter);
// oda tamamen boşaldıysa kalıcı masalar sıfırlanır, normal odalar silinir.
// Eskiden bu zamanlayıcı YALNIZCA 'player_left' yolunda kuruluyordu; diğer
// bitişlerde oda lobide sonsuza dek "Oynanıyor 2/2" olarak takılı kalıyordu.
// ---------------------------------------------------------------------------
// PUAN YAZIMI — tek geçit
// Kurallar scoring.js'te, kalıcılık üyelik katmanında (yerel SQLite veya
// Yöncü MySQL). Burada yalnız güvenli çağrı var: puan sistemi çökse bile
// oyun akışı ETKİLENMEZ (try/catch + boş olay ayıklama).
// ---------------------------------------------------------------------------
function puanYaz(olaylar) {
  try {
    const liste = (Array.isArray(olaylar) ? olaylar : [olaylar]).filter(Boolean);
    if (!liste.length) return;
    if (authApi && typeof authApi.puanYaz === 'function') authApi.puanYaz(liste);
  } catch (e) { console.warn('puan yazılamadı:', e.message); }
}

// Terk edip el bitmeden geri dönen üyeye +10 iadesi (iyi niyet).
function puanDonusYaz(room, player) {
  if (!room || !player || !(Number(player.userId) > 0)) return;
  puanYaz([scoring.donusOlayi({
    uid: player.userId, ad: player.name, gameId: room.gameId, roomId: room.id
  })]);
}

function cancelRoomReset(room) {
  if (room && room.resetTimer) {
    clearTimeout(room.resetTimer);
    room.resetTimer = null;
  }
}

/* ---------- PES ET: maçı bitir, oyuncu masada KALSIN ----------
   Ayrılmaktan (removePlayerFromRoom) tek farkı budur: koltuk boşalmaz,
   oda dağılmaz, böylece bitiş ekranından rövanş istenebilir. Kazanan(lar)
   ve bildirim biçimi, "rakip ayrıldı" akışıyla birebir aynıdır ki
   istemcilerin bitiş ekranı hiçbir değişiklik olmadan çalışsın. */
function resignMatch(room, player) {
  if (!room || !player || room.status !== 'playing') return;
  const loserSeat = player.seat;
  const digerler = room.players.filter(p => p.seat !== loserSeat);
  if (!digerler.length) return;

  // OKEY ailesi kendi maç bitirme akışına sahiptir (el/skor hesabı orada).
  if (room.okey && typeof endOkeyMatch === 'function') {
    endOkeyMatch(room, 'resign', loserSeat);
    return;
  }
  /* KELİMELİK: site kuralı gereği pes edenin MASADAKİ PUANI SİLİNİR.
     Motor durumu da bitmiş sayılmalı; yoksa bitiş paketindeki skor eski
     hâliyle kalır ve oyuncu "pes ettim ama puanım duruyor" görür. */
  if (room.kelimelik && room.kelimelik.status === 'playing') {
    kelimelikEngine.pesEt(room.kelimelik, loserSeat);
  }
  /* ADAM ASMACA: pes eden kaybeder; motor durumu da kapatılmalı, yoksa
     bitiş paketinde maç "oynanıyor" görünür ve el sayacı donar. */
  if (room.adamasmaca && room.adamasmaca.status === 'playing') {
    adamasmacaEngine.pesEt(room.adamasmaca, loserSeat);
  }
  /* PASSAPAROLA: pes eden kaybeder; motor durumu kapatılır ki sonuç
     ekranındaki doğru/süre sayıları o anki hâliyle dondurulsun. */
  if (room.passaparola && room.passaparola.status === 'playing') {
    passaparolaEngine.pesEt(room.passaparola, loserSeat);
  }
  /* CENGA: pes eden kaybeder; kule donar ve skorlar o hâliyle kalır. */
  if (room.cenga && room.cenga.status === 'playing') {
    cengaEngine.pesEt(room.cenga, loserSeat);
  }
  /* LANGIRT: pes eden kaybeder; fizik döngüsü de durdurulmalı, yoksa boş
     masada top dönmeye devam eder. */
  if (room.langirt && room.langirt.st.status === 'playing') {
    langirtEngine.pesEt(room.langirt.st, loserSeat);
    langirtDurdur(room);
  }
  /* HAVA HOKEYİ: pes edince fizik döngüsü de durmalı. */
  if (room.havahokeyi && room.havahokeyi.st.status === 'playing') {
    havahokeyiEngine.pesEt(room.havahokeyi.st, loserSeat);
    havahokeyiDurdur(room);
  }
  /* FARK BULMACA: pes eden kaybeder. */
  if (room.fark && room.fark.status === 'playing') {
    farkEngine.pesEt(room.fark, loserSeat);
  }
  /* KIZMA BIRADER: pes eden sona yazilir, kalan tek kisiyse mac biter. */
  if (room.kizma && room.kizma.status === 'playing') {
    kizmaEngine.pesEt(room.kizma, loserSeat);
  }
  /* METROPOL: pes eden iflas sayilir; tek kisi kalirsa mac biter. */
  if (room.metropol && room.metropol.status === 'playing') {
    metropolEngine.pesEt(room.metropol, loserSeat);
  }

  room.status = 'finished';

  if (room.chess || room.tavla) {
    const kazanan = digerler[0];
    room.result = { reason: 'resign', winner: kazanan ? kazanan.color : null, loserSeat };
    const state = buildBoardState(room);
    room.players.forEach(p => {
      io.to(p.id).emit('gameEnded', {
        roomId: room.id, reason: 'resign',
        winner: room.result.winner, winnerColor: room.result.winner,
        playerColor: p.color, loserSeat,
        youWon: p.seat !== loserSeat,
        resignedName: player.name || null,
        gameState: state
      });
    });
    (room.spectators || []).forEach(s => {
      io.to(s.id).emit('gameEnded', {
        roomId: room.id, reason: 'resign',
        winner: room.result.winner, winnerColor: room.result.winner,
        playerColor: null, loserSeat, youWon: false, isSpectator: true,
        resignedName: player.name || null,
        gameState: { ...state, legalMoves: [] }
      });
    });
    emitGameState(room);
  } else {
    // Diğer tüm online oyunlar (dama, türk daması, reversi, gomoku,
    // connect4, bilardo, amiral battı, pişti, batak): kalan oyuncular
    // arasında en yüksek skorlu kazanır (4 kişilik kart masası için).
    const sc = (room.cardGame && Array.isArray(room.cardGame.scores)) ? room.cardGame.scores : [];
    const winnerSeat = digerler.reduce(
      (best, x) => (Number(sc[x.seat] || 0) > Number(sc[best.seat] || 0) ? x : best), digerler[0]).seat;
    room.result = { reason: 'resign', winnerSeat, loserSeat };
    const stateFor = seat =>
      room.dama ? damaState(room, seat) :
      room.reversi ? reversiState(room, seat) :
      room.tombala ? tombalaState(room, seat) :
      room.gomoku ? gomokuState(room, seat) :
      room.kelimelik ? kelimelikState(room, seat) :
      room.adamasmaca ? adamasmacaState(room, seat) :
      room.passaparola ? passaparolaState(room, seat) :
      room.cenga ? cengaState(room, seat) :
      room.langirt ? langirtState(room, seat) :
      room.havahokeyi ? havahokeyiState(room, seat) :
      room.fark ? farkState(room, seat) :
      room.kizma ? kizmaState(room, seat) :
      room.metropol ? metropolState(room, seat) :
      room.connect4 ? connect4State(room, seat) :
      room.bilardo ? bilardoState(room, seat) :
      room.battleship ? battleshipState(room, seat) :
      room.cardGame ? cardGameState(room, seat) : buildBoardState(room);
    room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
      roomId: room.id, reason: 'resign', winnerSeat, loserSeat,
      youWon: p.seat === winnerSeat,
      resignedName: player.name || null,
      gameState: stateFor(p.seat)
    }));
    (room.spectators || []).forEach(sp => emitToPlayer(sp, 'gameEnded', {
      roomId: room.id, reason: 'resign', winnerSeat, loserSeat,
      youWon: false, isSpectator: true,
      resignedName: player.name || null,
      gameState: stateFor(null)
    }));
  }

  io.to(room.id).emit('playerResigned', {
    roomId: room.id, seat: loserSeat, name: player.name || null
  });
  emitRoom(room);
  scheduleRoomReset(room);
}

/* ---------- RÖVANŞ OYLAMASI ----------
   2 kişilik masada "karşı taraf kabul etti mi", 3-4 kişilikte "herkes
   kabul etti mi" aynı mantıkla işler: masadaki TÜM oyuncular evet
   demeden yeni el başlamaz. */
function yayinlaRematch(room) {
  if (!room || !room.rematch) return;
  const koltuklar = room.players.map(p => p.seat);
  const evetler = koltuklar.filter(s => room.rematch.votes[s] === true);
  const ortak = {
    roomId: room.id,
    bySeat: room.rematch.bySeat,
    byName: room.rematch.byName,
    acceptedSeats: evetler,
    seats: koltuklar,
    need: koltuklar.length,
    rounds: room.okeyMaxRounds || room.cardRounds || room.rounds || null
  };
  // Her oyuncuya KENDİ durumu da gönderilir (istemcinin koltuk numarasını
  // bilmesi gerekmesin: bazı oyun istemcileri koltuk yerine renk tutuyor).
  room.players.forEach(p => emitToPlayer(p, 'rematchOffer', Object.assign({}, ortak, {
    youRequested: p.seat === room.rematch.bySeat,
    youAccepted: room.rematch.votes[p.seat] === true
  })));
  (room.spectators || []).forEach(sp => emitToPlayer(sp, 'rematchOffer', Object.assign({}, ortak, {
    youRequested: false, youAccepted: false, isSpectator: true
  })));
  if (koltuklar.length >= 2 && evetler.length === koltuklar.length) {
    baslatRematch(room);
  }
}

function baslatRematch(room) {
  if (!room) return;
  room.rematch = null;
  cancelRoomReset(room);
  // Odayı temiz bir başlangıca çek (motorlar sıfırlanır, koltuklar korunur),
  // sonra herkesi HAZIR sayıp yeni maçı AYNI odada başlat. El sayısı
  // (okeyMaxRounds / cardRounds) oda ayarında durduğundan masa tipine
  // uygun el döngüsü kendiliğinden korunur.
  resetRoomToWaiting(room);
  room.players.forEach(p => { p.isReady = true; });
  startRoomGame(room);
  io.to(room.id).emit('rematchStarted', { roomId: room.id });
  emitRoom(room);
}

function scheduleRoomReset(room) {
  if (!room) return;
  cancelRoomReset(room);
  // GERÇEK OYNANMA SAYACI: üye/ziyaretçi ayrımı yok, authApi'den de
  // BAĞIMSIZ — her tamamlanan maç (buradan, tek yoldan geçer) bir kez
  // sayılır. Ana sayfadaki "Popüler Oyunlar" sıralaması ve kartlardaki
  // "kaç kez oynandı" rakamı buradan gelir (artık uydurma sayı değil).
  if (room.result && !room.__playCounted) {
    room.__playCounted = true;
    try { playCounts.bump(room.gameId); } catch (_) {}
  }
  /* TURNUVA MAÇI: her oyunun bitişi bu tek noktadan geçtiği için kazananı
     brakete buradan işliyoruz (oyun başına ayrı kanca gerekmiyor). */
  if (room.turnuva && room.result) {
    try { turnuvaKatmani.macBitti(room); } catch (e) { console.warn('turnuva sonucu:', e.message); }
  }
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
      // PUAN: maç sonucundan puan olayları üretilip üye profillerine işlenir.
      // Terk edenlerin −20'si ayrılma ANINDA yazıldı; burada yalnız masada
      // kalıp maçı bitirenler puanlanır (terk eden geri döndüyse o da bu
      // listededir ve normal sonuç puanını alır — kullanıcının kuralı).
      const beraberlikNedenleri = ['draw', 'stalemate', 'threefold_repetition',
                                   'fifty_move', 'insufficient_material'];
      const berabere = beraberlikNedenleri.includes(String(res.reason || ''));
      const sureAsimiNedeni = res.reason === 'move_timeout' || res.reason === 'timeout' ||
                              res.reason === 'time_expired';
      puanYaz(scoring.macOlaylari({
        gameId: room.gameId,
        roomId: room.id,
        // El sayısı çarpanı: 3 el ×1, 5 el ×1.25, 7 el ×1.5
        elSayisi: room.okeyMaxRounds || room.cardRounds || 1,
        rakipTerkiyle: res.reason === 'player_left',
        // Yapay zekânın oynadığı koltuklar puan ALMAZ: o eli masadan
        // ayrılmış bir üyenin yerine bot oynadı; galibiyeti ona yazmak
        // masada kalanlara haksızlık olurdu. Geri dönen oyuncu artık
        // aiControlled değildir ve normal puanını alır.
        oyuncular: (room.players || []).filter(p => !p.aiControlled).map(p => ({
          uid: p.userId, ad: p.name,
          kazandi: !!(winnerName && p.name === winnerName),
          berabere,
          // Süre aşımı puanı YALNIZ kaybedene: kazanan tam galibiyet alır.
          sureAsimi: sureAsimiNedeni && !(winnerName && p.name === winnerName)
        }))
      }));
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
  // Bekleyen rövanş oylaması varsa düşer: masadan biri ayrıldıysa aynı
  // kadroyla yeni el kurulamaz. Kalan oyuncuya durum bildirilir ki bitiş
  // ekranı "rakip ayrıldı" akışına geçip lobiye yönlendirebilsin.
  if (room.rematch) {
    room.rematch = null;
    io.to(room.id).emit('rematchDeclined', {
      roomId: room.id, bySeat: player.seat, byName: player.name || 'Oyuncu', reason: 'player_left'
    });
  }
  // Maç geçmişi bütünlüğü: oyun SIRASINDA ayrılan üye de kayda dahil edilsin.
  if (room.status === 'playing') {
    (room.__leftPlayers = room.__leftPlayers || []).push({ name: player.name, userId: player.userId || null });
    // CEZA: masayı terk −20 puan. Maç bitişini beklemeyiz; terk eden
    // oyuncu geri dönerse +10 iadesi AYRI bir olay olarak yazılır
    // (bkz. puanDonusYaz). Misafirlerde uid yoktur → puan işlenmez.
    puanYaz([scoring.terkOlayi({
      uid: player.userId, ad: player.name, gameId: room.gameId, roomId: room.id
    })]);

    // 3–4 KİŞİLİK OYUNLAR: maç ÇÖKMEZ, koltuğu yapay zekâ devralır ve el
    // sayısı tamamlanana kadar idareten oynar. Koltuk odadan silinmez;
    // motorun eli/sırası koltuk numarasına bağlıdır. Üye terk ettiyse
    // koltuk ona rezervedir (geri dönebilir), misafir terk ettiyse maç
    // sonuna kadar yapay zekâda kalır. 2 kişilikte bu yol İŞLEMEZ —
    // orada terk eskisi gibi hükmen mağlubiyettir.
    if (aiOyunuDestekliyor(room) && !player.aiControlled) {
      const kalanInsan = (room.players || []).filter(p => p !== player && !p.aiControlled).length;
      // Masada en az BİR gerçek oyuncu kalmalı; herkes gittiyse botların
      // kendi kendine oynaması anlamsızdır — masa kapanır.
      if (kalanInsan >= 1) {
        aiDevral(room, player, 'masayı terk');
        emitRoom(room);
        if (room.okey) emitOkeyState(room); else if (room.cardGame) emitCardState(room);
        aiSiraKontrol(room);
        return;
      }
      console.log(`[ODA #${room.id}] masada gerçek oyuncu kalmadı; yapay zekâ devralmıyor, masa kapanıyor.`);
      (room.players || []).forEach(p => { if (p.aiTimer) { clearTimeout(p.aiTimer); p.aiTimer = null; } });
      room.players = (room.players || []).filter(p => !p.aiControlled);
    }
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

  // Oyun SÜRERKEN ayrılan oyuncu HÜKMEN MAĞLUP olur — artık TÜM online
  // oyunlarda. Eskiden bunu yalnız satranç, tavla ve okey yapıyordu;
  // dama, türk daması, reversi, gomoku, connect4, bilardo, pişti ve
  // batakta oda sessizce beklemeye dönüyordu. Kalan oyuncu ekranda
  // DONMUŞ bir tahtayla kalıyor, ne "kazandınız" bildirimi görüyor ne de
  // lobiye dönebiliyordu; üstelik oda 'waiting'e düştüğü için hamle
  // süresi denetimi de artık çalışmıyor, sayaç sıfırda takılıp kalıyordu.
  // ⚠ Yeni bir oyun eklendiğinde BU LİSTEYE de eklenmeli: eksik kalırsa oda
  // aşağıdaki resetRoomToWaiting()'e düşer, status 'waiting' olur ve o andan
  // sonra hamle süresi denetimi de çalışmaz (saat 0'da donar). Amiral Battı
  // tam olarak bu yüzden rakip ayrılınca bitmiyordu.
  if (wasPlaying && (room.dama || room.reversi || room.gomoku || room.kelimelik || room.adamasmaca || room.passaparola || room.cenga || room.langirt || room.havahokeyi || room.fark || room.kizma || room.metropol || room.connect4 || room.bilardo || room.battleship || room.cardGame || room.tombala)) {
    const kalanKoltuklar = room.players.map(p => p.seat);
    let winnerSeat = kalanKoltuklar[0];
    if (kalanKoltuklar.length > 1) {
      // 4 kişilik kart masasında maç sürdürülemez: en yüksek skorlu kazanır.
      const sc = (room.cardGame && Array.isArray(room.cardGame.scores)) ? room.cardGame.scores : [];
      winnerSeat = kalanKoltuklar.reduce(
        (best, x) => (Number(sc[x] || 0) > Number(sc[best] || 0) ? x : best), kalanKoltuklar[0]);
    }
    room.status = 'finished';
    room.result = { reason: 'player_left', winnerSeat };
    const stateFor = seat =>
      room.dama ? damaState(room, seat) :
      room.reversi ? reversiState(room, seat) :
      room.tombala ? tombalaState(room, seat) :
      room.gomoku ? gomokuState(room, seat) :
      room.kelimelik ? kelimelikState(room, seat) :
      room.adamasmaca ? adamasmacaState(room, seat) :
      room.passaparola ? passaparolaState(room, seat) :
      room.cenga ? cengaState(room, seat) :
      room.langirt ? langirtState(room, seat) :
      room.havahokeyi ? havahokeyiState(room, seat) :
      room.fark ? farkState(room, seat) :
      room.kizma ? kizmaState(room, seat) :
      room.metropol ? metropolState(room, seat) :
      room.connect4 ? connect4State(room, seat) :
      room.bilardo ? bilardoState(room, seat) :
      room.battleship ? battleshipState(room, seat) :
      cardGameState(room, seat);

    room.players.forEach(p => emitToPlayer(p, 'gameEnded', {
      roomId: room.id,
      reason: 'player_left',
      winnerSeat,
      youWon: p.seat === winnerSeat,
      leftName: player.name || null,
      gameState: stateFor(p.seat)
    }));
    (room.spectators || []).forEach(sp => emitToPlayer(sp, 'gameEnded', {
      roomId: room.id,
      reason: 'player_left',
      winnerSeat,
      youWon: false,
      isSpectator: true,
      leftName: player.name || null,
      gameState: stateFor(null)
    }));
    io.to(room.id).emit('playerLeft', {
      roomId: room.id,
      leftName: player.name || null,
      message: message || 'Rakip masadan ayrıldı.'
    });
    emitRoom(room);
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

  // GERÇEK VARLIK: istemci kim olduğunu (üye uid'i veya kalıcı cihaz
  // anahtarı) bildirir; aynı kişinin kaç sekmesi olursa olsun TEK kişi
  // sayılır. Giriş yapınca istemci bunu tekrar gönderir ve kayıt
  // ziyaretçiden üyeye taşınır.
  socket.on('gvPresence', payload => {
    try { presenceSoketBagla(socket, payload && payload.uid, payload && payload.cihaz); } catch (_) {}
  });
  socket.on('disconnect', () => { try { presenceSoketKopar(socket); } catch (_) {} });

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
  socket.on('chatMessage', async payload => {
    const scope = payload && payload.scope === 'global' ? 'global' : 'room';
    const text = chatSanitize(payload && payload.text);
    if (!text) return;
    // MASA SOHBETİ (room): ziyaretçiler de birbirini görüp yazabilir — kısıtlı
    // katılımcı listesi zaten socket.roomId ile (gerçekten o masaya OTURMUŞ
    // olmakla) sağlanıyor, ayrıca üyelik şartı aranmaz. GENEL sohbet (global,
    // herkese açık site geneli akış) hâlâ yalnızca üyelere açık.
    if (scope === 'global' && !chatIsMember(socket, payload)) {
      return socket.emit('chatRejected', { reason: 'Genel sohbette yazabilmek için üye girişi yapmalısınız. Mesajları okumaya devam edebilirsiniz.' });
    }
    if (chatHasLink(text)) {
      return socket.emit('chatRejected', { reason: '🔗 Link paylaşımı yasaktır.' });
    }
    if (chatHasProfanity(text)) {
      return socket.emit('chatRejected', { reason: '🚫 Küfür ve argo kullanılamaz.' });
    }
    // ---- YAPTIRIM DENETİMİ (kurucunun uyguladığı sohbet kısıtlaması) ----
    // Kullanıcı isteği: "tüm sohbetler kapatılsın kullanıcının (oyun içi ve
    // genel sohbet)". Bu yüzden denetim HER İKİ kapsamda da çalışır.
    // Kimlik yalnız DOĞRULANMIŞ üyeliktir (socket.userId); istemcinin
    // gönderdiği userKey kanıt değildir, yoksa susturulan kişi sekmesini
    // yenileyip misafir gibi yazmaya devam edebilirdi — bu yüzden GENEL
    // sohbet zaten üyelik ister, MASA sohbetinde ise kimliği oda kaydından
    // da çözeriz (aşağıdaki chatUid ile aynı kaynak).
    {
      const rid0 = String(socket.roomId || '');
      const room0 = rid0 ? rooms.get(rid0) : null;
      let uid0 = socket.userId || null;
      if (!uid0 && room0) {
        const pl0 = (room0.players || []).find(p => p.id === socket.id);
        const sp0 = (room0.spectators || []).find(x => x.id === socket.id);
        uid0 = (pl0 || sp0)?.userId || null;
      }
      if (uid0 > 0) {
        const y = await sohbetYaptirimi(uid0);
        if (y) return socket.emit('chatRejected', { reason: yaptirimAciklama(y), yaptirim: { bitis: y.bitis, sebep: y.sebep } });
      }
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

  /* ================== KULLANICIYI BİLDİR (ŞİKAYET) ==================
     Kullanıcı isteği: oyun içi ve genel sohbette rahatsız edici davranış
     bildirilebilsin; kurucu panelinde şikayet eden/edilen, tarih, oda
     bilgisi ve O ANKİ SOHBET DÖKÜMÜ görünsün.

     Sohbet dökümü BURADA dondurulur, çünkü sunucudaki sohbet belleği
     geçicidir: oda geçmişi oda kapanınca silinir, genel sohbet 60 sn
     sonra düşer. Şikayet anında kopyalanmazsa kurucu paneli boş bir
     döküm gösterirdi.
       • oyun içi  → o masanın son 50 mesajı
       • genel     → SON 1 DAKİKANIN mesajları (kullanıcı isteği) */
  socket.on('reportUser', (payload, ack) => {
    const cevap = (o) => { if (typeof ack === 'function') ack(o); };
    const p = payload || {};
    const scope = p.scope === 'global' ? 'global' : 'room';
    const gerekce = String(p.reason || '').slice(0, 40);
    if (!gerekce) return cevap({ ok: false, error: 'Gerekçe seçilmedi.' });

    const rid = String(p.roomId || socket.roomId || '');
    const room = rid ? rooms.get(rid) : null;

    /* Kimlikler SUNUCUDAN çözülür (istemciden gelen ada güvenilmez —
       aksi halde başkasının adına şikayet açılabilirdi).
       Öncelik ÜYELİK KAYDIDIR: masadaki koltuk adı çoğu zaman genel bir
       yer tutucudur ("Oyuncu"), oysa panelde gerçek üye adı görünmeli. */
    function uyeAdi(uid) {
      if (!(Number(uid) > 0) || typeof authApi.userById !== 'function') return '';
      try { const u = authApi.userById(Number(uid)); return (u && u.name) ? String(u.name) : ''; }
      catch (_) { return ''; }
    }
    let koltukAd = '', edenUid = socket.userId || null;
    if (room) {
      const pl = (room.players || []).find(x => x.id === socket.id) ||
                 (room.spectators || []).find(x => x.id === socket.id);
      if (pl) { koltukAd = pl.name || ''; edenUid = pl.userId || edenUid; }
    }
    const edenAd = uyeAdi(edenUid) || koltukAd ||
                   (p.reporterName ? (chatSanitize(String(p.reporterName)) || '') : '') || 'Oyuncu';

    const edilenUid = Number(p.reportedUid) > 0 ? Number(p.reportedUid) : null;
    const edilenAd = uyeAdi(edilenUid) || chatSanitize(String(p.reportedName || '')) || '';
    if (!edilenAd && !edilenUid) return cevap({ ok: false, error: 'Bildirilecek oyuncu belirtilmedi.' });

    // ---- Sohbet dökümünü dondur ----
    let kaynak = [];
    if (scope === 'global') {
      chatGlobalPrune();
      const sinir = Date.now() - 60 * 1000;         // son 1 dakika
      kaynak = chatGlobal.filter(m => Number(m.ts) >= sinir);
    } else {
      kaynak = (chatRoomHist.get(rid) || []).slice(-CHAT_HISTORY);
    }
    const dokum = kaynak.map(m => ({
      ts: Number(m.ts) || 0,
      name: String(m.name || ''),
      uid: m.uid != null ? Number(m.uid) : null,
      text: String(m.text || '').slice(0, 300)
    }));

    Promise.resolve(authApi.raporEkle({
      scope,
      reporterUid: edenUid, reporterName: edenAd,
      reportedUid: edilenUid, reportedName: edilenAd,
      reason: gerekce,
      note: String(p.note || '').slice(0, 500),
      roomId: scope === 'room' ? (rid || null) : null,
      gameId: room ? room.gameId : (p.gameId ? String(p.gameId) : null),
      transcript: dokum
    })).then(r => {
      if (r && r.ok) {
        console.log(`🚩 Şikayet: ${edenAd} → ${edilenAd || ('#' + edilenUid)} (${gerekce}, ${scope}${rid ? ' #' + rid : ''})`);
        cevap({ ok: true, id: r.id || null, kayitliMesaj: dokum.length });
      } else {
        cevap({ ok: false, error: (r && r.error) || 'Şikayet kaydedilemedi.' });
      }
    }).catch(e => cevap({ ok: false, error: e.message }));
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
      const kopuktu = !!player.disconnectedAt;
      player.disconnectedAt = null;
      cancelDisconnectTimer(roomId, player);
      if (spectator) room.spectators = room.spectators.filter(s => s !== spectator);
      socket.role = 'player';
      // Kopan oyuncu geri döndü: bekleyen rakibe haber ver (geri sayım bitti).
      if (kopuktu && room.status === 'playing') {
        room.players.forEach(p => {
          if (p === player) return;
          emitToPlayer(p, 'playerReconnected', {
            roomId: room.id, seat: player.seat, name: player.name || 'Rakip'
          });
        });
      }
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

    /* İZLEYİCİ GİRDİ: hangi oyuncunun ekranından izleyeceğini seçmesi için
       pop-up'ın içeriğini hemen yolla (yalnız seçimli oyunlarda; diğer
       oyunlarda izleyici eskisi gibi tarafsız görünümü alır). */
    if (socket.role === 'spectator' && izlemeSecimliMi(room)) {
      socket.emit('spectatorChoices', {
        roomId: room.id, gameId: room.gameId, secimli: true,
        choices: izlemeSecenekleri(room),
        watchSeat: (spectator && typeof spectator.watchSeat === 'number') ? spectator.watchSeat : null
      });
    }

    if (room.status === 'playing') {
      // Yeniden bağlanan oyuncuya / izleyiciye durumu SADECE ona gönder;
      // tüm odaya yayınlamak rakibin taş seçimini sıfırlıyordu.
      emitPlayingSnapshot(room, socket.id, player || null);
    }
    /* MASA GELEN OYUNCUYLA DOLDUYSA ve içeride hazır veren varsa, hazır
       süresi burada başlar: "hazırım"a basan taraf, geç gelen oyuncunun
       hiç hazır vermemesi yüzünden sonsuza kadar bekletilmesin. */
    hazirSayaciBaslat(room);
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
    /* Hazır süresi: ilk "hazırım" sayacı başlatır. İptal etmek sayacı
       DURDURMAZ (bkz. hazirSayaciBaslat) — masayı kilitleme denemesinin önü. */
    hazirSayaciBaslat(room);
  });

  socket.on('toggleReady', () => {
    const room = rooms.get(socket.roomId);
    if (!room || room.status !== 'waiting') return;
    const player = seatedPlayer(room);
    if (!player) return;
    player.isReady = !player.isReady;
    emitRoom(room);
    startRoomGame(room);
    hazirSayaciBaslat(room);
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

  // ---------- BİLARDO eylemleri (sunucu yetkili) ----------
  // flyordie tarzı akıcı oynanış (madde 5): fizik hâlâ tek seferde ve sunucuda
  // hesaplanır (hile yok), ama sonuç istemcilere önce "kare kare" (bilardoShotFrames)
  // yayılır; masanın gerçek son durumu (gameStateUpdated/gameEnded) topların
  // ekranda yuvarlanma süresi kadar GECİKMELİ gönderilir — böylece oyuncular
  // vuruşun canlı oynandığını görür, sonuç aniden "ışınlanmaz".
  socket.on('bilardoShoot', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room?.bilardo&&room.players.find(x=>x.id===socket.id); if(!p||room.status!=='playing')return socket.emit('bilardoRejected',{roomId:room?.id||data?.roomId,reason:'not_in_room'}); // Falso (spinX/spinY) ve ısteka yükseklik açısı (elevation) da istemciden
    // gelir; hepsi motorda kırpılıp doğrulanır — istemciye GÜVENİLMEZ.
    const r=bilardoEngine.shoot(room.bilardo,p.seat,Number(data.angle),Number(data.power),{spinX:Number(data.spinX)||0,spinY:Number(data.spinY)||0,elevation:Number(data.elevation)||0}); if(!r.ok)return socket.emit('bilardoRejected',{roomId:room.id,reason:r.reason,gameState:bilardoState(room,p.seat)}); touchMoveTimer(room);
    const frames=(r.shot&&r.shot.frames)||[]; const frameMs=(bilardoEngine.constants&&bilardoEngine.constants.frameMs)||17;
    if(frames.length)io.to(room.id).emit('bilardoShotFrames',{roomId:room.id,frames,frameMs,events:r.shot.events||[],meta:room.bilardo.balls.map(b=>({id:b.id,n:b.n,type:b.type}))});
    const finalize=()=>{ if(room.bilardo.status==='finished'){room.status='finished';room.result=room.bilardo.result;} emitBilardoState(room);emitRoom(room);if(room.status==='finished')room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:room.bilardo.result?.reason||'finished',winnerSeat:room.bilardo.winner,youWon:q.seat===room.bilardo.winner,gameState:bilardoState(room,q.seat)})); };
    const animMs=Math.max(0,(frames.length-1)*frameMs);
    if(animMs>0)setTimeout(finalize,animMs); else finalize();
  });

  // ---------- AMİRAL BATTI (Battleship) eylemleri (sunucu yetkili) ----------
  // Yerleştirme: touchMoveTimer() BİLİNÇLİ OLARAK çağrılmaz — tek taraflı
  // yerleştirme, karşı tarafın süresini uzatmamalı (bkz. enforceOnlineMoveTimeout
  // içindeki 'placing' fazı özel dalı: süre maç başından itibaren işler).
  socket.on('battleshipPlace', data => {
    const room = rooms.get(socket.roomId || String(data?.roomId || ''));
    const p = room?.battleship && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return socket.emit('battleshipRejected', { roomId: room?.id || data?.roomId, reason: 'not_in_room' });
    const r = battleshipEngine.place(room.battleship, p.seat, data && data.placements);
    if (!r.ok) return socket.emit('battleshipRejected', { roomId: room.id, reason: r.reason, shipId: r.shipId, gameState: battleshipState(room, p.seat) });
    // Muharebe fazı YENİ başladıysa hamle saatini SIFIRLA: yoksa yerleştirmede
    // geçen süre ilk hamleden düşülüyor ve sırası gelen oyuncu daha ilk
    // atışını yapamadan hükmen mağlup olabiliyordu.
    if (room.battleship.phase === 'battle') touchMoveTimer(room);
    emitBattleshipState(room);
    emitRoom(room);
  });
  socket.on('battleshipFire', data => {
    const room = rooms.get(socket.roomId || String(data?.roomId || ''));
    const p = room?.battleship && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return socket.emit('battleshipRejected', { roomId: room?.id || data?.roomId, reason: 'not_in_room' });
    const r = battleshipEngine.fire(room.battleship, p.seat, data && data.r, data && data.c);
    if (!r.ok) return socket.emit('battleshipRejected', { roomId: room.id, reason: r.reason, gameState: battleshipState(room, p.seat) });
    touchMoveTimer(room);
    // Herkese (her iki oyuncuya + izleyicilere) tek seferlik atış SONUCU
    // yayını — istemci bunu "kendi hamlem" / "rakibin hamlesi" olarak ayırt
    // edip belirgin isabet/ıska/batırma efekti + Türkçe seslendirme tetikler.
    /* Sinematik TOHUMU sunucuda üretilir ve herkese aynı gider: iki oyuncunun
       ve izleyicilerin ekranında kıvılcım dağılımı, duman savruluşu ve
       sarsıntı kare kare aynı olur. kilitMs, sahnenin ne kadar süreceğini
       söyler; istemci o süre boyunca atış düğmelerini kapatır. */
    const cineTohum = ((Date.now() ^ (Number(data.r) * 73856093) ^ (Number(data.c) * 19349663) ^ (p.seat * 83492791)) >>> 0);
    const cineKilit = r.result === 'sunk' ? 4600 : (r.result === 'hit' ? 2600 : 2200);
    io.to(room.id).emit('battleshipShotResult', { roomId: room.id, seat: p.seat, r: Number(data.r), c: Number(data.c), result: r.result, shipId: r.shipId, sunkShip: r.sunkShip, tohum: cineTohum, kilitMs: cineKilit });
    if (room.battleship.phase === 'finished') { room.status = 'finished'; room.result = room.battleship.result; }
    emitBattleshipState(room);
    emitRoom(room);
    if (room.status === 'finished') {
      room.players.forEach(q => emitToPlayer(q, 'gameEnded', { roomId: room.id, reason: room.battleship.result?.reason || 'finished', winnerSeat: room.battleship.winner, youWon: q.seat === room.battleship.winner, gameState: battleshipState(room, q.seat) }));
      (room.spectators || []).forEach(q => { const k = izleKoltuk(room, q); emitToPlayer(q, 'gameEnded', { roomId: room.id, reason: room.battleship.result?.reason || 'finished', winnerSeat: room.battleship.winner, youWon: false, isSpectator: true, seat: k, gameState: battleshipState(room, k) }); });
    }
  });

  // ---------- CONNECT4 eylemleri (sunucu yetkili) ----------
  socket.on('connect4Move', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room?.connect4&&room.players.find(x=>x.id===socket.id); if(!p||room.status!=='playing')return socket.emit('connect4Rejected',{roomId:room?.id||data?.roomId,reason:'not_in_room'}); const r=connect4Engine.play(room.connect4,p.seat,Number(data.col)); if(!r.ok)return socket.emit('connect4Rejected',{roomId:room.id,reason:r.reason,gameState:connect4State(room,p.seat)}); if(room.connect4.status==='finished'){room.status='finished';room.result=room.connect4.result;} touchMoveTimer(room);emitConnect4State(room);emitRoom(room);if(room.status==='finished')room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:room.connect4.winner,youWon:q.seat===room.connect4.winner,gameState:connect4State(room,q.seat)})); });

  // ---------- GOMOKU eylemleri (sunucu yetkili) ----------
  socket.on('gomokuMove', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room?.gomoku&&room.players.find(x=>x.id===socket.id); if(!p||room.status!=='playing')return socket.emit('gomokuRejected',{roomId:room?.id||data?.roomId,reason:'not_in_room'}); const r=gomokuEngine.play(room.gomoku,p.seat,Number(data.r),Number(data.c)); if(!r.ok)return socket.emit('gomokuRejected',{roomId:room.id,reason:r.reason,gameState:gomokuState(room,p.seat)}); if(room.gomoku.status==='finished'){room.status='finished';room.result=room.gomoku.result;} touchMoveTimer(room);emitGomokuState(room);emitRoom(room);if(room.status==='finished')room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:room.gomoku.winner,youWon:q.seat===room.gomoku.winner,gameState:gomokuState(room,q.seat)})); });

  /* ===================================================================== */
  /* KELİMELİK — bütün kurallar sunucuda (kelimelik-engine.js).            */
  /* İstemci yalnız öneri gönderir: tahta, ıstaka ve sözlük burada.        */
  /* ===================================================================== */
  function klOda(data) {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    if (!room || !room.kelimelik) return null;
    return room;
  }
  function klRed(room, reason, ek) {
    socket.emit('kelimelikRejected', Object.assign(
      { roomId: room ? room.id : null, reason: reason }, ek || {}));
  }
  /* Hamle sonrası ortak kuyruk: otomatik pas zinciri → yayın → bitiş. */
  function klSonrasi(room) {
    const k = room.kelimelik;
    if (k.status === 'playing') kelimelikOtomatikPas(room);
    touchMoveTimer(room);
    if (k.status !== 'playing') {
      kelimelikBitisYayinla(room);
      emitKelimelikState(room); emitRoom(room); scheduleRoomReset(room);
      return;
    }
    emitKelimelikState(room); emitRoom(room);
  }

  socket.on('kelimelikMove', data => {
    const room = klOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return klRed(room, 'not_in_room');
    const konumlar = Array.isArray(data && data.konumlar) ? data.konumlar.slice(0, 7) : [];
    const r = kelimelikEngine.play(room.kelimelik, p.seat, konumlar);
    if (!r.ok) return klRed(room, r.reason, { kelimeler: r.kelimeler || null,
      /* Yakın yazımlar: "MARMALAT" reddedilince oyuncuya MARMELAT önerilir
         (kullanıcı raporu). Kelime gerçekten yoksa alan boş gelir. */
      oneriler: r.oneriler || null,
      gameState: kelimelikState(room, p.seat) });
    klSonrasi(room);
  });

  socket.on('kelimelikPass', data => {
    const room = klOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return klRed(room, 'not_in_room');
    const r = kelimelikEngine.pas(room.kelimelik, p.seat, false);
    if (!r.ok) return klRed(room, r.reason);
    klSonrasi(room);
  });

  socket.on('kelimelikSwap', data => {
    const room = klOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return klRed(room, 'not_in_room');
    const r = kelimelikEngine.takas(room.kelimelik, p.seat,
      Array.isArray(data && data.indeksler) ? data.indeksler.slice(0, 7) : []);
    if (!r.ok) return klRed(room, r.reason);
    klSonrasi(room);
  });

  /* Karıştır yalnız SIRALAMAYI değiştirir; sıra geçmez, pas sayılmaz. */
  socket.on('kelimelikShuffle', data => {
    const room = klOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p) return;
    const rack = room.kelimelik.racks[p.seat];
    for (let i = rack.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = rack[i]; rack[i] = rack[j]; rack[j] = t;
    }
    emitToPlayer(p, 'gameStateUpdated', { roomId: room.id, seat: p.seat,
      gameState: kelimelikState(room, p.seat), isSpectator: false });
  });

  /* KELİME BİLDİR — sözlükte olmadığı için reddedilen kelimeyi oyuncu
     bildirir; kayıt yönetici paneline düşer (GET /api/kelimelik/reports). */
  socket.on('kelimelikReport', data => {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    const kelimeler = (Array.isArray(data && data.kelimeler) ? data.kelimeler : [])
      .map(x => kelimelikEngine.trBuyuk(String(x || '').trim()))
      .filter(x => /^[A-ZÇĞİÖŞÜ]{2,15}$/.test(x)).slice(0, 5);
    if (!kelimeler.length) return;
    kelimelikBildirim.ekle({
      kelimeler,
      not: String((data && data.not) || '').slice(0, 120),
      oda: room ? room.id : null,
      kim: socket.userName || null,
      uid: socket.userId || null,
      ts: now()
    });
    socket.emit('kelimelikReported', { ok: true, kelimeler });
  });

  /* ===================================================================== */
  /* ADAM ASMACA — bütün kurallar sunucuda (adamasmaca-engine.js).         */
  /* Kelime hiçbir zaman tahminciye gönderilmez; istemci yalnız kelime     */
  /* önerisi ve harf tahmini yollar.                                       */
  /* ===================================================================== */
  function aaOda(data) {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    if (!room || !room.adamasmaca) return null;
    return room;
  }
  function aaRed(room, reason, ek) {
    socket.emit('adamasmacaRejected', Object.assign(
      { roomId: room ? room.id : null, reason: reason }, ek || {}));
  }
  socket.on('adamasmacaWord', data => {
    const room = aaOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return aaRed(room, 'not_in_room');
    const r = adamasmacaEngine.kelimeSec(room.adamasmaca, p.seat,
      (data && data.kelime) || '', (data && data.ipucu) || '');
    if (!r.ok) return aaRed(room, r.reason, { oneriler: r.oneriler || [] });
    /* Kelime kilitlendi: iki tarafa da duyurulur ama KELİME yollanmaz. */
    io.to(room.id).emit('adamasmacaWordLocked', {
      roomId: room.id, gizleyen: p.seat,
      harfSayisi: [...r.kelime].length, ipucu: room.adamasmaca.ipucu
    });
    touchMoveTimer(room);
    emitAdamasmacaState(room); emitRoom(room);
  });
  /* "Sözlükten öner": sözlük SUNUCUDA olduğu için öneri de buradan gelir ve
     YALNIZ gizleyenin kendi soketine yollanır — rakip kelimeyi görmemeli. */
  socket.on('adamasmacaSuggest', data => {
    const room = aaOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return aaRed(room, 'not_in_room');
    const a = room.adamasmaca;
    if (a.faz !== 'kelime') return aaRed(room, 'wrong_phase');
    if (p.seat !== a.gizleyen) return aaRed(room, 'not_your_turn');
    const kelime = kelimelikEngine.rastgeleKelime(4, 9);
    if (!kelime) return aaRed(room, 'sozluk_yok');
    socket.emit('adamasmacaSuggestion', { roomId: room.id, kelime });
  });
  socket.on('adamasmacaGuess', data => {
    const room = aaOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return aaRed(room, 'not_in_room');
    const r = adamasmacaEngine.harfTahmin(room.adamasmaca, p.seat, (data && data.harf) || '');
    if (!r.ok) return aaRed(room, r.reason);
    io.to(room.id).emit('adamasmacaLetter', {
      roomId: room.id, seat: p.seat, harf: r.harf, dogru: !!r.dogru
    });
    adamasmacaSonrasi(room, r.el || null);
    emitRoom(room);
  });

  /* ===================================================================== */
  /* PASSAPAROLA — doğru cevap ve saat SUNUCUDA. İstemci yalnız yazdığı     */
  /* metni, "pas" ya da "harf al" isteğini gönderir.                       */
  /* ===================================================================== */
  function ppOda(data) {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    if (!room || !room.passaparola) return null;
    return room;
  }
  function ppRed(room, reason) {
    socket.emit('passaparolaRejected', { roomId: room ? room.id : null, reason: reason });
  }
  socket.on('passaparolaAnswer', data => {
    const room = ppOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return ppRed(room, 'not_in_room');
    passaparolaClockTick(room);                       // önce saati güncelle
    if (room.status !== 'playing') return;
    const r = passaparolaEngine.cevapla(room.passaparola, p.seat, (data && data.cevap) || '');
    if (!r.ok) return ppRed(room, r.reason);
    /* Cevap herkese duyurulur — yanlış bilinen sorunun doğrusu da görünsün. */
    io.to(room.id).emit('passaparolaResult', {
      roomId: room.id, seat: p.seat, harf: r.harf, dogru: r.dogru, cevap: r.cevap
    });
    passaparolaSonrasi(room);
    emitRoom(room);
  });
  socket.on('passaparolaPass', data => {
    const room = ppOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return ppRed(room, 'not_in_room');
    passaparolaClockTick(room);
    if (room.status !== 'playing') return;
    const r = passaparolaEngine.pas(room.passaparola, p.seat);
    if (!r.ok) return ppRed(room, r.reason);
    io.to(room.id).emit('passaparolaPassed', { roomId: room.id, seat: p.seat, harf: r.harf });
    passaparolaSonrasi(room);
    emitRoom(room);
  });
  /* ===================================================================== */
  /* CENGA — kule kuralları ve ÇEKİŞİN GİZLİ HEDEFİ sunucuda.              */
  /* İstemci yalnız seçtiği taşı ve iğnenin durduğu konumu gönderir.       */
  /* ===================================================================== */
  function cgOda(data) {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    if (!room || !room.cenga) return null;
    return room;
  }
  function cgRed(room, reason) {
    socket.emit('cengaRejected', { roomId: room ? room.id : null, reason: reason });
  }
  /* ===================================================================== */
  /* LANGIRT — fizik SUNUCUDA. İstemci yalnız çubuk hedefleri ve şut yollar. */
  /* ===================================================================== */
  function lgOda(data) {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    if (!room || !room.langirt) return null;
    return room;
  }
  function lgRed(room, reason) {
    socket.emit('langirtRejected', { roomId: room ? room.id : null, reason: reason });
  }
  /* Çubuk hedefleri saniyede onlarca kez gelir: en ucuz yol, doğrulayıp
     kontrol nesnesine yazmak. Fizik döngüsü bunu kendi adımında okur. */
  /* ===================================================================== */
  /* HAVA HOKEYİ — fizik SUNUCUDA. İstemci yalnız tokmağın hedef noktasını  */
  /* yollar; hangi yarı sahada oynayacağını KOLTUK belirler.                */
  /* ===================================================================== */
  /* ===================================================================== */
  /* FARK BULMACA — her tıklama SUNUCUDA ölçülür.                          */
  /* Hangi farkların seçildiği istemciye gitmek ZORUNDA (B kopyasını o     */
  /* çiziyor), ama tıklamanın gerçekten o alana düştüğünü sunucu doğrular  */
  /* ve boşa tıklayana kısa bir kilit uygular.                             */
  /* ===================================================================== */
  /* ===================================================================== */
  /* KIZMA BIRADER - zar ve kurallar SUNUCUDA.                             */
  /* ===================================================================== */
  function kbOda(data) {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    if (!room || !room.kizma) return null;
    return room;
  }
  function kbRed(room, reason) {
    socket.emit('kizmaRejected', { roomId: room ? room.id : null, reason: reason });
  }
  socket.on('kizmaRoll', data => {
    const room = kbOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return kbRed(room, 'not_in_room');
    const r = kizmaEngine.zarAt(room.kizma, p.seat);
    if (!r.ok) return kbRed(room, r.reason);
    io.to(room.id).emit('kizmaDice', { roomId: room.id, seat: p.seat, zar: r.zar,
      ucAlti: !!r.ucAlti, hamleYok: !!r.hamleYok });
    kizmaSonrasi(room);
    emitRoom(room);
  });
  socket.on('kizmaMove', data => {
    const room = kbOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return kbRed(room, 'not_in_room');
    const r = kizmaEngine.piyonOyna(room.kizma, p.seat, data && data.idx);
    if (!r.ok) return kbRed(room, r.reason);
    io.to(room.id).emit('kizmaMoved', { roomId: room.id, seat: p.seat, hamle: r.hamle });
    kizmaSonrasi(room);
    emitRoom(room);
  });

  /* ===================================================================== */
  /* METROPOL - zar, kira, kart ve iflas hesabi SUNUCUDA.                  */
  /* ===================================================================== */
  function mpOda(data) {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    if (!room || !room.metropol) return null;
    return room;
  }
  function mpRed(room, reason) {
    socket.emit('metropolRejected', { roomId: room ? room.id : null, reason: reason });
  }
  /* Tum Metropol eylemleri ayni kalibi izler: odayi bul, oyuncuyu bul,
     motoru cagir, reddedilirse YALNIZ isteyene sebep don, kabul edilirse
     masaya duyur ve ortak son-islemi (metropolSonrasi) calistir. */
  function mpEylem(data, isim, calistir) {
    const room = mpOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return mpRed(room, 'not_in_room');
    const r = calistir(room.metropol, p.seat);
    if (!r || !r.ok) return mpRed(room, (r && r.reason) || 'gecersiz');
    io.to(room.id).emit('metropolAction', Object.assign(
      { roomId: room.id, seat: p.seat, eylem: isim }, r.yayin || {}));
    metropolSonrasi(room);
    emitRoom(room);
  }
  socket.on('metropolRoll', data => {
    const room = mpOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return mpRed(room, 'not_in_room');
    const r = metropolEngine.zarAt(room.metropol, p.seat);
    if (!r.ok) return mpRed(room, r.reason);
    /* Motorun donduru sonucu OLDUGU GIBI yayinlanir (ucCift, cezaevinde,
       kefalet, kart, kira, iflas...): istemci animasyonu buna gore oynar.
       `ok` ayiklanir, istemciye anlami yok. */
    const yayin = Object.assign({}, r); delete yayin.ok;
    io.to(room.id).emit('metropolDice', Object.assign(
      { roomId: room.id, seat: p.seat }, yayin));
    metropolSonrasi(room);
    emitRoom(room);
  });
  socket.on('metropolBuy',      data => mpEylem(data, 'al',      (m, seat) => metropolEngine.satinAl(m, seat)));
  socket.on('metropolDecline',  data => mpEylem(data, 'reddet',  (m, seat) => metropolEngine.reddet(m, seat)));
  socket.on('metropolBuild',    data => mpEylem(data, 'binaKur', (m, seat) => metropolEngine.binaKur(m, seat, Number(data && data.kare))));
  socket.on('metropolSell',     data => mpEylem(data, 'binaSat', (m, seat) => metropolEngine.binaSat(m, seat, Number(data && data.kare))));
  socket.on('metropolMortgage', data => mpEylem(data, 'ipotek',  (m, seat) => metropolEngine.ipotek(m, seat, Number(data && data.kare))));
  socket.on('metropolBail',     data => mpEylem(data, 'kefalet', (m, seat) => metropolEngine.kefaletOde(m, seat)));
  socket.on('metropolJailCard', data => mpEylem(data, 'cikisKarti', (m, seat) => metropolEngine.cikisKartiKullan(m, seat)));
  socket.on('metropolEndTurn',  data => mpEylem(data, 'turuBitir', (m, seat) => metropolEngine.turuBitir(m, seat)));

  socket.on('farkClick', data => {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    const p = room && room.fark && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return;
    farkClockTick(room);                       // önce fazı güncelle
    if (room.status !== 'playing' || !room.fark) return;
    const r = farkEngine.tikla(room.fark, p.seat, data && data.x, data && data.y, now());
    if (!r.ok) {
      return socket.emit('farkRejected', { roomId: room.id, reason: r.reason,
        kalanMs: r.kalanMs || 0 });
    }
    socket.emit('farkSonuc', { roomId: room.id, dogru: !!r.dogru, zaten: !!r.zaten,
      farkId: r.farkId || null, kilitMs: r.kilitMs || 0, kalan: r.kalan });
    if (r.dogru) {
      /* Rakip yalnız SAYIYI görür; hangi farkı bulduğumuzu değil. */
      io.to(room.id).emit('farkIlerleme', { roomId: room.id, seat: p.seat,
        bulunan: room.fark.bulunan[p.seat].length, toplam: room.fark.farkIdleri.length });
    }
    farkSonrasi(room);
    emitRoom(room);
  });

  socket.on('hokeyMove', data => {
    const room = rooms.get(socket.roomId || String(data && data.roomId || ''));
    const p = room && room.havahokeyi && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return;
    const r = havahokeyiEngine.hedefYaz(room.havahokeyi.st, p.seat,
      data && data.x, data && data.y);
    if (!r.ok) socket.emit('hokeyRejected', { roomId: room.id, reason: r.reason });
  });

  socket.on('langirtRods', data => {
    const room = lgOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return;
    const taraf = langirtEngine.tarafOf(p.seat);
    const r = langirtEngine.hedefYaz(room.langirt.st, taraf, data && data.hedefY);
    if (!r.ok) return lgRed(room, r.reason);
    room.langirt.kontrol.hassas[taraf] = !!(data && data.hassas);
  });
  socket.on('langirtShot', data => {
    const room = lgOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return lgRed(room, 'not_in_room');
    const taraf = langirtEngine.tarafOf(p.seat);
    const r = langirtEngine.sut(room.langirt.st, taraf, {
      cubuk: data && data.cubuk, guc: data && data.guc, nisanY: data && data.nisanY
    });
    if (!r.ok) return lgRed(room, r.reason);
    io.to(room.id).emit('langirtShotFired', {
      roomId: room.id, seat: p.seat, taraf, guc: r.guc, hiz: Math.round(r.hiz)
    });
  });

  socket.on('cengaSelect', data => {
    const room = cgOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return cgRed(room, 'not_in_room');
    const r = cengaEngine.tasSec(room.cenga, p.seat,
      data && data.kat, data && data.slot);
    if (!r.ok) return cgRed(room, r.reason);
    /* Duyuruda HEDEF YOK — yalnız bant ve etiketler. */
    io.to(room.id).emit('cengaSelected', {
      roomId: room.id, seat: p.seat, kat: r.kat, slot: r.slot, bant: r.bant,
      sikilikEtiketi: r.sikilikEtiketi, riskSeviyesi: r.riskSeviyesi, riskEtiketi: r.riskEtiketi
    });
    touchMoveTimer(room);
    emitCengaState(room);
  });
  socket.on('cengaRelease', data => {
    const room = cgOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return cgRed(room, 'not_in_room');
    const r = cengaEngine.secimiBirak(room.cenga, p.seat);
    if (!r.ok) return cgRed(room, r.reason);
    touchMoveTimer(room);
    emitCengaState(room);
  });
  socket.on('cengaPull', data => {
    const room = cgOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return cgRed(room, 'not_in_room');
    const r = cengaEngine.tasCek(room.cenga, p.seat, data && data.el);
    if (!r.ok) return cgRed(room, r.reason);
    /* Çekiş bitti; o taşın hedefi artık sır değil — geri bildirim olsun.
       Her yeni seçim yeni bir gizli hedef üretir. */
    io.to(room.id).emit('cengaPulled', {
      roomId: room.id, seat: p.seat, basarili: !!r.basarili, devrildi: !!r.devrildi,
      isabet: r.isabet, sapma: r.sapma, hedef: r.hedef, puan: r.puan,
      kademe: r.kademe, yerlestirildi: r.yerlestirildi
    });
    cengaSonrasi(room);
    emitRoom(room);
  });

  socket.on('passaparolaReveal', data => {
    const room = ppOda(data);
    const p = room && room.players.find(x => x.id === socket.id);
    if (!p || room.status !== 'playing') return ppRed(room, 'not_in_room');
    passaparolaClockTick(room);
    if (room.status !== 'playing') return;
    const r = passaparolaEngine.harfAl(room.passaparola, p.seat);
    if (!r.ok) return ppRed(room, r.reason);
    emitPassaparolaState(room);
  });

  // ---------- REVERSİ eylemleri (sunucu yetkili) ----------
  socket.on('reversiMove', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room?.reversi&&room.players.find(x=>x.id===socket.id); if(!p||room.status!=='playing')return socket.emit('reversiRejected',{roomId:room?.id||data?.roomId,reason:'not_in_room'}); const r=reversiEngine.play(room.reversi,p.seat,Number(data.r),Number(data.c)); if(!r.ok)return socket.emit('reversiRejected',{roomId:room.id,reason:r.reason,gameState:reversiState(room,p.seat)}); if(r.winner!==undefined&&r.winner!==null||room.reversi.status==='finished'){room.status='finished';room.result=room.reversi.result;} touchMoveTimer(room);emitReversiState(room);emitRoom(room); if(room.status==='finished')room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:room.reversi.winner,youWon:q.seat===room.reversi.winner,gameState:reversiState(room,q.seat)})); });

  // ---------- İNGİLİZ DAMASI eylemleri (sunucu yetkili) ----------
  socket.on('damaMove', data => { const room=rooms.get(socket.roomId||String(data?.roomId||'')); const p=room&&room.dama&&room.players.find(x=>x.id===socket.id); const engine=room?.gameId==='turkdamasi'?turkDamaEngine:damaEngine; const ev=room?.gameId==='turkdamasi'?'turkDamaRejected':'damaRejected'; if(!p||room.status!=='playing') return socket.emit(ev,{roomId:room?.id||data?.roomId,reason:'not_in_room'}); const r=engine.play(room.dama,p.seat,[Number(data.from?.[0]),Number(data.from?.[1])],[Number(data.to?.[0]),Number(data.to?.[1])]); if(!r.ok)return socket.emit(ev,{roomId:room.id,reason:r.reason,gameState:damaState(room,p.seat)}); if(r.winner){room.status='finished';room.result={reason:'finished',winnerSeat:p.seat};} touchMoveTimer(room);emitDamaState(room);emitRoom(room); if(r.winner)room.players.forEach(q=>emitToPlayer(q,'gameEnded',{roomId:room.id,reason:'finished',winnerSeat:p.seat,youWon:q.seat===p.seat,gameState:damaState(room,q.seat)})); });

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
    const M = okeyMotoru(room);
    okeyAct(room, socket, (st8, seat) =>
      source === 'prev' ? M.drawFromPrev(st8, seat) : M.drawFromDeck(st8, seat));
  });

  socket.on('okeyDiscard', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || !data || !data.tileId) return;
    okeyAct(room, socket, (st8, seat) => okeyMotoru(room).discard(st8, seat, String(data.tileId)));
  });

  socket.on('okeyFinish', data => {
    const roomId = socket.roomId || (data && String(data.roomId));
    const room = rooms.get(roomId);
    if (!room || !data || !data.tileId) return;
    /* KLASİK okeye özgü: "14 taşım per, 15.'yi atıp bitiyorum". Gerçek
       101'de bitiş ayrı bir eylem değil — oyuncu taşlarını masaya koyar ve
       son taşını atar; bu yüzden 101 masasında bu olay yok sayılır. */
    if (yeni101Mi(room)) return;
    okeyAct(room, socket, (st8, seat) => okeyEngine.finish(st8, seat, String(data.tileId)));
  });

  /* ---------- GERÇEK 101 OKEY: EL AÇMA ve İŞLEME ----------
     gruplar: [[tileId, ...], ...]  ·  cift: 5 çiftle açılış mı
     Doğrulamanın tamamı motorda; sunucu yalnız girdiyi temizler. İstemciye
     güvenilmez: taşlar oyuncunun elinde mi, toplam 101'e ulaşıyor mu,
     perler geçerli mi — hepsi okey101-engine.js'te sınanır. */
  socket.on('okey101Open', data => {
    const room = rooms.get(socket.roomId || (data && String(data.roomId)));
    if (!room || !yeni101Mi(room) || !data) return;
    const gruplar = (Array.isArray(data.gruplar) ? data.gruplar : [])
      .slice(0, 12)
      .map(g => (Array.isArray(g) ? g : []).slice(0, 14).map(x => String(x)))
      .filter(g => g.length >= 2);
    if (!gruplar.length) return;
    okeyAct(room, socket, (st8, seat) =>
      okey101Engine.openMelds(st8, seat, gruplar, !!data.cift));
  });

  /* MASA OYLAMASI: eksik kişiyle devam edelim mi? (bkz. masaOylamasiBaslat) */
  socket.on('masaOyla', data => {
    const room = rooms.get(socket.roomId || (data && String(data.roomId)));
    if (!room || !room.masaOylama) return;
    const p = (room.players || []).find(x => x.id === socket.id && !x.aiControlled);
    if (!p) return;
    masaOylamasiOyVer(room, p.seat, !!(data && data.evet));
  });

  socket.on('okey101Add', data => {
    const room = rooms.get(socket.roomId || (data && String(data.roomId)));
    if (!room || !yeni101Mi(room) || !data || !data.meldId || !data.tileId) return;
    okeyAct(room, socket, (st8, seat) =>
      okey101Engine.addToMeld(st8, seat, String(data.meldId), String(data.tileId)));
  });

  // ---------- YAPAY ZEKÂDAN KOLTUĞU GERİ ALMA ----------
  // Kullanıcının kuralı: "Oyundan düşmüş oyuncu üye girişi yaparak web
  // sitesine tekrar giriş yaparsa, ekranda pop-up olarak 'oyuna kaldığın
  // yerden devam et' veya 'pes et' seçenekleri çıkar."
  //
  // İstemci giriş yapar yapmaz bunu sorar; sunucu yalnız o üyeye ait
  // rezerve koltuğu döndürür. Misafirler için hiç kayıt yoktur.
  socket.on('gvResumeCheck', (_payload, cb) => {
    const uid = Number(socket.userId);
    const bul = aiBekleyenKoltuk(uid);
    const cevap = bul ? {
      ok: true, devamEdilebilir: true,
      roomId: bul.room.id, gameId: bul.room.gameId, seat: bul.player.seat,
      masaAdi: bul.room.name || ('Masa #' + bul.room.id),
      el: (bul.room.okey && bul.room.okey.currentRound) || null,
      toplamEl: bul.room.okeyMaxRounds || bul.room.cardRounds || null
    } : { ok: true, devamEdilebilir: false };
    if (typeof cb === 'function') cb(cevap);
    else socket.emit('gvResumeState', cevap);
  });

  // "Kaldığın yerden devam et" — yapay zekâ çekilir, oyuncu koltuğa döner.
  socket.on('gvResumeSeat', (payload, cb) => {
    const uid = Number(socket.userId);
    const yanit = (o) => { if (typeof cb === 'function') cb(o); else socket.emit('gvResumeResult', o); };
    if (!(uid > 0)) return yanit({ ok: false, error: 'Koltuğa dönmek için üye girişi gerekir.' });
    const bul = aiBekleyenKoltuk(uid);
    if (!bul) return yanit({ ok: false, error: 'Dönebileceğiniz bir masa kalmadı — maç bitmiş olabilir.' });
    if (payload && payload.roomId && String(payload.roomId) !== String(bul.room.id)) {
      return yanit({ ok: false, error: 'Bu masa size ait değil.' });
    }
    const { room, player } = bul;
    aiBirak(room, player, socket);
    socket.roomId = room.id;
    socket.join(room.id);
    // İYİ NİYET İADESİ: terk edince −20 almıştı, dönünce +10 geri alır.
    // Sonrasında normal puanlama devam eder (kullanıcının kuralı).
    puanDonusYaz(room, player);
    emitRoom(room);
    if (room.okey) emitOkeyState(room); else if (room.cardGame) emitCardState(room);
    yanit({ ok: true, roomId: room.id, gameId: room.gameId, seat: player.seat });
  });

  // "Pes et" — koltuk yapay zekâda kalır, oyuncu lobiye döner. Ceza zaten
  // ayrılırken yazıldı (−20); pes etmek EK ceza getirmez, yalnız geri
  // dönüş hakkı (ve +10 iadesi) kaybedilir.
  socket.on('gvForfeitSeat', (_payload, cb) => {
    const uid = Number(socket.userId);
    const bul = uid > 0 ? aiBekleyenKoltuk(uid) : null;
    if (bul) {
      bul.player.aiReservedUserId = null;   // koltuk artık geri alınamaz
      console.log(`[ODA #${bul.room.id}] üye #${uid} pes etti; koltuk maç sonuna kadar yapay zekâda.`);
    }
    const o = { ok: true, gameId: bul ? bul.room.gameId : null };
    if (typeof cb === 'function') cb(o); else socket.emit('gvForfeitResult', o);
  });

  /* ============ İZLEYİCİ İZNİ (oyuncu tarafı) ============
     Kullanıcı isteği: "Oyuncularda 'İzleyiciye İzin Ver' veya 'İzleyici
     İznini Kaldır' seçenekleri olacak oyun esnasında webde ve mobilde."
     Yalnız KOLTUKTAKİ oyuncu kendi iznini değiştirebilir — izleyici ya da
     başka bir oyuncu adına istek gelirse sessizce yok sayılır. */
  socket.on('setSpectatorPermission', payload => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = findExistingPlayer(room, socket, socket.userKey);
    if (!player || socket.role === 'spectator') return;
    const izin = !!(payload && payload.allow);
    if ((player.allowSpectators !== false) === izin) return;   // değişmedi
    player.allowSpectators = izin;
    let atilan = 0;
    if (!izin) atilan = izleyicileriCikar(room, player.seat, player.name);
    emitRoom(room);
    socket.emit('spectatorPermissionSet', {
      roomId: room.id, seat: player.seat, allow: izin, ejected: atilan
    });
    /* Seçim penceresi açık olan izleyiciler listeyi anında tazelesin. */
    io.to(room.id).emit('spectatorChoices', {
      roomId: room.id, gameId: room.gameId, choices: izlemeSecenekleri(room)
    });
  });

  /* ============ KOLTUK SEÇİMİ (izleyici tarafı) ============
     İzleyici pop-up'tan bir oyuncu seçer; o andan sonra O OYUNCUNUN
     ekranını görür. İzin vermeyen koltuk reddedilir: istemci düğmeyi
     zaten sönük çizer ama kural SUNUCUDA durur. */
  socket.on('spectateSeat', payload => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const spec = findExistingSpectator(room, socket, socket.userKey);
    if (!spec || socket.role !== 'spectator') return;
    if (!izlemeSecimliMi(room)) {
      socket.emit('spectateSeatResult', { ok: false, reason: 'unsupported' });
      return;
    }
    const seat = Number(payload && payload.seat);
    const oyuncu = room.players.find(x => x.seat === seat);
    if (!oyuncu) { socket.emit('spectateSeatResult', { ok: false, reason: 'no_seat' }); return; }
    if (oyuncu.allowSpectators === false) {
      socket.emit('spectateSeatResult', { ok: false, reason: 'not_allowed', name: oyuncu.name });
      return;
    }
    spec.watchSeat = seat;
    socket.emit('spectateSeatResult', { ok: true, seat, name: oyuncu.name });
    emitRoom(room);
    if (room.status === 'playing') emitPlayingSnapshot(room, socket.id, null);
  });

  /* İzleyicinin seçim penceresini (yeniden) doldurması için. */
  socket.on('spectateOptions', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    socket.emit('spectatorChoices', {
      roomId: room.id, gameId: room.gameId,
      secimli: izlemeSecimliMi(room),
      choices: izlemeSecenekleri(room)
    });
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

  /* ================== PES ET (oyun sürerken teslim ol) ==================
     Kullanıcı isteği: "Oyun içinde pes et butonu da olsun, oyun esnasında
     da basabilir ayrıl butonuna basar gibi."
     AYRILMAKTAN FARKI: oyuncu odadan ÇIKMAZ — maçı kaybeder ama masada
     kalır, böylece bitiş ekranından RÖVANŞ isteyebilir. (Ayrılmak odadan
     da çıkarır ve rövanş imkânını yok eder.) */
  socket.on('gvResign', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = findExistingPlayer(room, socket, socket.userKey);
    if (!player) return;                       // izleyici pes edemez
    if (room.status !== 'playing') return;     // yalnız oyun sürerken
    resignMatch(room, player);
  });

  /* ================== RÖVANŞ / YENİDEN OYNA ==================
     Kullanıcı isteği: "oyun bittiğinde lobiye dön butonu yanında rövanş
     talep et butonu da olsun... Eğer rövanş talep ederse oyunculardan biri,
     diğerine ekranda uyarı çıkar, kabul ederse aynı odada yeni bir ele
     geçebilirler... Bu normal 2 kişiliklerde geçerli. 3-4 kişilik oyunlarda
     ise oylamaya sunulur. Herkes kabul ederse ona göre aynı odada yeni el
     döngüsüne başlanır (3 el, 1 el, 5 el, 7 el) oyun masa tipine bağlı."
     El sayısı odanın masa tipinden gelir (okeyMaxRounds/cardRounds), yeni
     maç startRoomGame ile aynı odada kurulduğu için kendiliğinden korunur. */
  socket.on('rematchRequest', () => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const player = findExistingPlayer(room, socket, socket.userKey);
    if (!player) return;
    if (room.status === 'playing') return;      // maç sürüyorsa anlamsız
    if (room.players.length < 2) {
      emitToPlayer(player, 'rematchDeclined', { roomId: room.id, reason: 'no_opponent' });
      return;
    }
    cancelRoomReset(room);                      // oda sıfırlanmasın, rövanş bekleniyor
    /* İKİ OYUNCU DA AYNI ANDA "Rövanş Talep Et" derse: ikinci talep,
       birincinin oylamasını SIFIRLAMAMALI. Aksi halde herkes talep etmiş
       ama kimsenin oyu sayılmamış gibi olur ve masa "karşı taraf kabul
       etti mi belli değil" diye kilitlenirdi. İkinci talep = kabul oyu. */
    if (room.rematch && room.rematch.bySeat !== player.seat) {
      room.rematch.votes[player.seat] = true;
      yayinlaRematch(room);
      return;
    }
    room.rematch = {
      bySeat: player.seat,
      byName: player.name || 'Oyuncu',
      votes: { [player.seat]: true },
      startedAt: Date.now()
    };
    yayinlaRematch(room);
  });

  socket.on('rematchVote', data => {
    const room = rooms.get(socket.roomId);
    if (!room || !room.rematch) return;
    const player = findExistingPlayer(room, socket, socket.userKey);
    if (!player) return;
    const kabul = !!(data && data.accept);
    room.rematch.votes[player.seat] = kabul;
    if (!kabul) {
      io.to(room.id).emit('rematchDeclined', {
        roomId: room.id, bySeat: player.seat, byName: player.name || 'Oyuncu', reason: 'declined'
      });
      room.rematch = null;
      scheduleRoomReset(room);                  // normal akışa dön
      return;
    }
    yayinlaRematch(room);
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
      /* KALAN OYUNCUYA HABER VER. Eskiden bu 30 saniye boyunca karşı tarafa
         HİÇBİR bilgi gitmiyordu: tahta donuyor, "rakip çıktı" da denmiyor,
         oyuncu ne olduğunu anlamadan bekliyordu (kullanıcı raporu). Artık
         kopma anında bilgi ve geri sayım, dönüşte de "geri döndü" gider. */
      room.players.forEach(p => {
        if (p === player) return;
        emitToPlayer(p, 'playerConnectionLost', {
          roomId: room.id, seat: player.seat, name: player.name || 'Rakip',
          graceMs: RECONNECT_GRACE_MS
        });
      });
      (room.spectators || []).forEach(sp => emitToPlayer(sp, 'playerConnectionLost', {
        roomId: room.id, seat: player.seat, name: player.name || 'Oyuncu',
        graceMs: RECONNECT_GRACE_MS, isSpectator: true
      }));
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
  // Sıra kimde? — tek kaynak turnSeatOf() (durum paketleriyle birebir aynı).
  function cardMoveTurn(room) { return turnSeatOf(room); }
function enforceOnlineMoveTimeout(room) {
  if (!room.moveStartedAt || !room.players.length || (!room.dama && !room.reversi && !room.gomoku && !room.kelimelik && !room.adamasmaca && !room.cenga && !room.kizma && !room.metropol && !room.connect4 && !room.bilardo && !room.battleship && !room.cardGame)) return false;
  // Amiral Battı 'placing' fazında kimsenin "sırası" yok (bkz. turnSeatOf),
  // bu yüzden genel tek-koltuklu zaman-aşımı mantığı burada işlemez —
  // ayrı bir dal: süresi dolduğunda HANGİ koltuk(lar) hâlâ hazır değilse
  // o(nlar) hükmen kaybeder (ikisi de değilse oda iptal edilir).
  if (room.battleship && room.battleship.phase === 'placing') {
    const elapsed = now() - room.moveStartedAt;
    if (elapsed < BATTLESHIP_PLACE_MS) return false;
    const notReady = room.battleship.seats.filter(s => !room.battleship.ready[s]);
    if (!notReady.length) return false;
    const stateFor = p => battleshipState(room, p);
    if (notReady.length === 2) {
      room.status = 'aborted'; room.result = { reason: 'placement_timeout' };
      room.players.forEach(p => emitToPlayer(p, 'gameEnded', { roomId: room.id, reason: 'placement_timeout', winnerSeat: null, youWon: false, gameState: stateFor(p.seat) }));
    } else {
      const winner = notReady[0] === 0 ? 1 : 0;
      room.status = 'finished'; room.result = { reason: 'placement_timeout', winnerSeat: winner };
      room.players.forEach(p => emitToPlayer(p, 'gameEnded', { roomId: room.id, reason: 'placement_timeout', winnerSeat: winner, youWon: p.seat === winner, gameState: stateFor(p.seat) }));
    }
    emitBattleshipState(room); emitRoom(room); scheduleRoomReset(room);
    return true;
  }
  const elapsed=now()-room.moveStartedAt, seat=cardMoveTurn(room); if (seat===null) return false;
  const sinir=moveLimitOf(room);
  if (!room.moveWarned && elapsed>=Math.min(MOVE_WARN_MS, sinir-1000)) { room.moveWarned=true; io.to(room.id).emit('moveTimeWarning',{roomId:room.id,seat,remainingMs:Math.max(0,sinir-elapsed)}); }
  if (elapsed<sinir) return false;

  /* KIZMA BIRADER: suresi dolan oyuncu masadan ATILMAZ. Zar atmadiysa
     sunucu atar, hamle secmediyse ilk gecerli hamle oynanir. */
  if (room.kizma) {
    const ad = (room.players.find(x => x.seat === seat) || {}).name || 'Oyuncu';
    const r = kizmaEngine.sureDoldu(room.kizma, seat);
    io.to(room.id).emit('kizmaTimeout', { roomId: room.id, seat, ad,
      tur: r && r.tur, zar: room.kizma.zar });
    kizmaSonrasi(room);
    emitRoom(room);
    return true;
  }

  /* METROPOL: suresi dolan oyuncu masadan ATILMAZ. Zar atmadiysa sunucu
     atar; karar vermediyse parasi bolsa alir, degilse reddeder; turu
     bitirmediyse sunucu bitirir. Teklif turunda bekleyen de reddetmis
     sayilir, yoksa masa tek kisi yuzunden kilitlenirdi. */
  if (room.metropol) {
    const ad = (room.players.find(x => x.seat === seat) || {}).name || 'Oyuncu';
    const r = metropolEngine.sureDoldu(room.metropol, seat);
    io.to(room.id).emit('metropolTimeout', { roomId: room.id, seat, ad,
      tur: r && r.tur, zar: room.metropol.zar });
    metropolSonrasi(room);
    emitRoom(room);
    return true;
  }

  /* CENGA: süresi dolan oyuncu masadan ATILMAZ. Taş seçmediyse sunucu en
     güvenli taşı onun adına seçer; çekişte beklediyse el kayar ve çoğu
     zaman kule devrilir — acele etmemenin bedeli budur. */
  if (room.cenga) {
    const c = room.cenga;
    const ad = (room.players.find(x => x.seat === seat) || {}).name || 'Oyuncu';
    const r = cengaEngine.sureDoldu(c);
    io.to(room.id).emit('cengaTimeout', { roomId: room.id, seat, ad,
      tur: r && r.tur, el: r && r.el });
    cengaSonrasi(room);
    emitRoom(room);
    return true;
  }

  /* ADAM ASMACA: süresi dolan oyuncu masadan ATILMAZ (site kuralı).
     Gizleyen süreyi doldurursa kelimeyi SUNUCU sözlükten seçer — oyun
     durmasın; tahminci doldurursa bir can gider, yani yanlış harf saymış
     olur. Böylece ceza da gecikmeyi yapanın üstünde kalır. */
  if (room.adamasmaca) {
    const a = room.adamasmaca;
    const sonuc = adamasmacaEngine.sureDoldu(a);
    const ad = (room.players.find(x => x.seat === seat) || {}).name || 'Oyuncu';
    if (sonuc && sonuc.tur === 'kelime') {
      io.to(room.id).emit('adamasmacaAutoWord', { roomId: room.id, seat, ad,
        harfSayisi: [...(a.kelime || '')].length });
    } else if (sonuc && sonuc.harf) {
      io.to(room.id).emit('adamasmacaLetter', { roomId: room.id, seat, harf: sonuc.harf,
        dogru: !!(sonuc.sonuc && sonuc.sonuc.dogru), sure: true, ad });
    }
    adamasmacaSonrasi(room, (sonuc && sonuc.sonuc && sonuc.sonuc.el) || null);
    emitRoom(room);
    return true;
  }

  /* KELİMELİK: süresi dolan oyuncu HÜKMEN MAĞLUP OLMAZ — pas geçmiş sayılır.
     Diskalifiye yalnız ÜST ÜSTE 3 pastan sonra gelir (site kuralı). */
  if (room.kelimelik) {
    const k = room.kelimelik;
    kelimelikEngine.pas(k, seat, true);
    io.to(room.id).emit('kelimelikAutoPass', { roomId: room.id, seat,
      ad: (room.players.find(p => p.seat === seat) || {}).name || 'Oyuncu', sure: true });
    if (k.status === 'playing') kelimelikOtomatikPas(room);
    touchMoveTimer(room);
    if (k.status !== 'playing') { kelimelikBitisYayinla(room); emitKelimelikState(room); emitRoom(room); scheduleRoomReset(room); return true; }
    emitKelimelikState(room); emitRoom(room);
    return true;
  }
  // KAZANAN: 2 kişilik masada karşı koltuk. 4 kişilik masalarda (pişti/batak)
  // eskiden koşulsuz "seat===0?1:0" deniyordu — koltuk 2 ya da 3 süreyi
  // doldurduğunda kazanan yanlış ilan ediliyordu. Artık süreyi dolduran
  // ELENİR: kalan koltuklar arasında en yüksek skorlu (yoksa ilk) kazanır.
  let winner;
  if (room.players.length > 2) {
    const sc = (room.cardGame && Array.isArray(room.cardGame.scores)) ? room.cardGame.scores : [];
    const rakipler = room.players.map(p => p.seat).filter(x => x !== seat);
    winner = rakipler.length
      ? rakipler.reduce((best, x) => (Number(sc[x] || 0) > Number(sc[best] || 0) ? x : best), rakipler[0])
      : (seat === 0 ? 1 : 0);
  } else {
    winner = seat === 0 ? 1 : 0;
  }
  room.status='finished'; room.result={reason:'move_timeout',winnerSeat:winner};
  const stateFor=(p)=>room.dama?damaState(room,p):room.reversi?reversiState(room,p):room.gomoku?gomokuState(room,p):room.kelimelik?kelimelikState(room,p):room.adamasmaca?adamasmacaState(room,p):room.cenga?cengaState(room,p):room.kizma?kizmaState(room,p):room.metropol?metropolState(room,p):room.connect4?connect4State(room,p):room.bilardo?bilardoState(room,p):room.battleship?battleshipState(room,p):cardGameState(room,p);
  room.players.forEach(p=>emitToPlayer(p,'gameEnded',{roomId:room.id,reason:'move_timeout',winnerSeat:winner,youWon:p.seat===winner,gameState:stateFor(p.seat)}));
  (room.spectators||[]).forEach(p=>emitToPlayer(p,'gameEnded',{roomId:room.id,reason:'move_timeout',winnerSeat:winner,youWon:false,isSpectator:true,gameState:stateFor(null)}));
  if (room.dama) emitDamaState(room); else if(room.reversi) emitReversiState(room); else if(room.gomoku) emitGomokuState(room); else if(room.kelimelik) emitKelimelikState(room); else if(room.adamasmaca) emitAdamasmacaState(room); else if(room.cenga) emitCengaState(room); else if(room.kizma) emitKizmaState(room); else if(room.metropol) emitMetropolState(room); else if(room.connect4) emitConnect4State(room); else if(room.bilardo) emitBilardoState(room); else if(room.battleship) emitBattleshipState(room); else emitCardState(room);
  emitRoom(room); scheduleRoomReset(room); return true;
}

for (const room of rooms.values()) {
    if (room.status !== 'playing') continue;
    // Okey kendi saat döngüsünü işletir (SIRA sayacı + koltuk ana saatleri).
    if (room.okey) { okeyClockTick(room); continue; }
    // Passaparola da kendi saat döngüsünü işletir (oyuncu başına ayrı saat).
    if (room.passaparola) { passaparolaClockTick(room); continue; }
    // Fark bulmaca da kendi faz saatini işletir (sıra yok, el süresi var).
    if (room.fark) { farkClockTick(room); continue; }
    // Satranç/tavla dışındaki tüm online oyunlarda da hamlesiz 60 sn hükmen mağlubiyet.
    if (enforceOnlineMoveTimeout(room)) continue;
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
      /* Sınır ARTIK masadan geliyor (kurucu panelinden girilen saniye);
         eskiden MOVE_FORFEIT_MS'e sabitti ve değiştirilemiyordu. */
      const sinir = moveLimitOf(room);

      /* Uyarı sınırın içinde kalmalı: 20 sn'lik bir masada 40. saniyede
         uyarmak anlamsız olurdu. Kart oyunlarındaki kuralın aynısı. */
      if (!room.moveWarned && elapsed >= Math.min(MOVE_WARN_MS, sinir - 1000)) {
        room.moveWarned = true;
        io.to(room.id).emit('moveTimeWarning', {
          roomId: room.id,
          color: turnColor,
          remainingMs: Math.max(0, sinir - elapsed)
        });
      }

      if (elapsed >= sinir) {
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
// görünürlük değişimi anında yansır.) `popular`: ana sayfanın "Popüler
// Oyunlar" sıralamasını GERÇEK oynanma sayısına mı (auto) yoksa kurucunun
// elle belirlediği sıraya mı (manual) göre çizeceğini + kaç oyun
// gösterileceğini (count, 0 = tümü) taşır — bkz. yukarıdaki popularConfig.
app.get('/api/games-meta', (_req, res) => {
  res.json({ ok: true, games: ALL_GAMES.map(id => ({ id, visible: gameVisible(id) })), popular: popularConfig });
});

// GERÇEK oynanma sayaçları: ana sayfa "Popüler Oyunlar" sıralaması ve oyun
// kartlarındaki "kaç kez oynandı" rakamı buradan okunur (bkz. play-counts.js).
app.get('/api/game-play-counts', (_req, res) => {
  res.json({ ok: true, counts: playCounts.all() });
});

// Yönetici (kurucu) yetki kontrolü — TÜM /api/admin/* uçlarının tek kapısı.
//
// ⚠ Eskiden yalnız authApi.userFromReq() kullanılıyordu. Üretimde (uzak mod,
// GV_AUTH_API tanımlı) üyelik katmanı bu fonksiyonu HİÇ döndürmüyor; bu
// yüzden kontrol kurucuya bile 403 veriyor ve /api/admin/users,
// /api/admin/tables, /api/admin/stats üretimde tamamen çalışmıyordu.
// Artık kimlik her iki modda da çözülür (yerelde SQLite oturumu, uzakta
// Yöncü PHP auth.php?action=me) ve kurucu olma kuralı tek yerdedir:
// veritabanındaki is_founder bayrağı ya da GV_ADMIN_EMAIL eşleşmesi.
async function requireAdmin(req, res) {
  // HIZLI/GÜVENİLİR YOL: imzalı kimlik belgesi (attestation). Yöncü'nün
  // DDoS koruması Render'ın auth.php?action=me çağrısını engelleyebilir
  // (bkz. auth-remote.js üstteki not) — bu yüzden Kurucu Paneli uçları
  // (puan ayarları/sıfırlama, yaptırımlar, oyun ayarları vb.) artık PHP'ye
  // ayrıca ulaşmadan, tarayıcının X-GV-Attest başlığıyla taşıdığı imzalı
  // belgeyle YERİNDE doğrulanabilir. Belge auth.php?action=attest'ten
  // gelir, "founder" bayrağı imzaya dahildir (taklit edilemez).
  try {
    const raw = req.headers && req.headers['x-gv-attest'];
    if (raw) {
      // İstemci Türkçe karakterli adları (ı,ş,ç...) HTTP başlığına
      // sığdırmak için encodeURIComponent ile gönderiyor (bkz. admin-panel.js).
      const att = verifyAttestation(JSON.parse(decodeURIComponent(String(raw))));
      if (att) {
        if (att.founder) return { id: att.uid, name: att.name, email: null, isFounder: true };
        res.status(403).json({ ok: false, error: 'Yönetici yetkisi gerekli.' });
        return null;
      }
    }
  } catch (_) { /* belge yok/bozuk — yedek yola düş */ }

  let u = null;
  try {
    if (authApi && typeof authApi.userFromReqAsync === 'function') {
      u = await authApi.userFromReqAsync(req);
    } else if (authApi && typeof authApi.userFromReq === 'function') {
      u = authApi.userFromReq(req);
    }
  } catch (_) { u = null; }
  const isFounder = !!u && (
    u.isFounder === true ||
    Number(u.is_founder) === 1 ||
    (!!ADMIN_EMAIL && String(u.email || '').toLowerCase() === ADMIN_EMAIL)
  );
  if (!isFounder) {
    res.status(403).json({ ok: false, error: 'Yönetici yetkisi gerekli.' });
    return null;
  }
  return u;
}

/* ==========================================================================
   TURNUVALAR
   Kurallar tournament-engine.js'te, kalıcılık authApi'de, zaman yönetimi
   tournament-server.js'te. Burada yalnız bağlanıyor: uçlar Express'e,
   maç sonuçları da aşağıdaki scheduleRoomReset kancasına.
   ========================================================================== */
const turnuvaKatmani = require('./tournament-server').kur({
  io, authApi, app, rooms, createRoom, emitRoom, requireAdmin
});

/* KELİME BİLDİRİMLERİ — Kurucu Paneli. Oyuncuların "TDK'de var ama oyun
   kabul etmiyor" diye ilettiği kelimeler; doğrulananlar sözlüğe eklenir. */
app.get('/api/kelimelik/reports', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  res.json({ ok: true, sayilar: kelimelikBildirim.sayilar(),
             kayitlar: kelimelikBildirim.liste({ durum: req.query.durum || null, limit: req.query.limit }) });
});
app.post('/api/kelimelik/reports', async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const kelime = kelimelikEngine.trBuyuk(String((req.body && req.body.kelime) || '').trim());
  const durum = String((req.body && req.body.durum) || '');
  if (!kelimelikBildirim.durumAta(kelime, durum))
    return res.status(400).json({ ok: false, error: 'Kelime ya da durum geçersiz.' });
  res.json({ ok: true, sayilar: kelimelikBildirim.sayilar() });
});

// Kurucu Paneli — üye listesi (yalnız yerel modda Render; uzak modda
// istemci Yöncü PHP'sine /api/admin.php?action=users gider):
app.get('/api/admin/users', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
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
app.post('/api/admin/tables-apply', async (req, res) => {
  // ⚠ GÜVENLİK: Bu uç eskiden YETKİSİZDİ. Diğer tüm /api/admin/* uçları
  // requireAdmin'den geçerken bu geçmiyordu; dolayısıyla internetteki
  // herkes POST atıp CANLI sunucuda oyunları gizleyebiliyor, hazır
  // masaları silip yeniden kurabiliyordu (oyun akışını bozan bir
  // yetkisiz yazma yolu). Artık yalnız kurucu çağırabilir.
  if (!await requireAdmin(req, res)) return;
  const body = (req.body && req.body.games) || (req.body && typeof req.body === 'object' ? req.body : {});
  try {
    applyPresetConfig(body);
    if (!process.env.GV_AUTH_API) { savePresetConfigLocal(); savePopularConfigLocal(); }
    res.json({ ok: true, games: ALL_GAMES.map(id => ({ id, visible: gameVisible(id) })), popular: popularConfig });
  } catch (e) {
    console.error('tables-apply hatası:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Kurucu Paneli — geçerli masa ayarlarını oku (yerel mod; uzak modda
// istemci Yöncü PHP'sine gider):
app.get('/api/admin/tables', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.json({
    ok: true, games: presetConfig, popular: popularConfig,
    /* Panelin hangi oyuna masa ekleyip çıkarabileceğini ve masa
       numaralarının nereden başladığını SUNUCU söyler; istemcide ikinci
       bir liste tutulmaz (yeni oyun eklenince panel kendiliğinden
       masa yönetimi gösterir). */
    sema: {
      standart: STANDARD_PRESET_GAMES,
      sabit: FIXED_PRESET_GAMES,
      /* Masası eklenip çıkarılabilen ve düzenlenebilen BÜTÜN oyunlar.
         Panelin düğmeleri buna bakar; 'sabit' listesi yalnızca "taban ID +
         indeks" şemasını KULLANMAYAN oyunları (okey / 101 okey) işaretler.
         Eskiden panel 'sabit' olanlara hiç düğme çizmiyordu. */
      duzenlenebilir: STANDARD_PRESET_GAMES.concat(FIXED_PRESET_GAMES),
      /* Satırında kişi sayısı / el sayısı da taşıyan oyunlar. */
      kartMasalari: MANAGED_CARD_GAMES,
      /* Her birinin masa sayısı üst sınırı (ayrılmış kimlik aralığı kadar). */
      kartSinir: Object.fromEntries(MANAGED_CARD_GAMES.map(g => [g, cardTableLimit(g)])),
      tabanlar: PRESET_GAME_BASES,
      tipler: PRESET_TYPES.map(t => ({ type: t.type, label: t.label, durationMinutes: t.durationMinutes })),
      /* HAMLE SÜRESİ alanı: oyun başına varsayılan saniye ve kabul edilen
         aralık. Panel bu bilgiyi kendi içinde tutmaz — yeni oyun eklenince
         kendiliğinden doğru davranır. hamleYok artık BOŞ: alan her oyunda
         düzenlenebilir (eski panel sürümleri bu listeye baktığı için alan
         korunuyor). */
      hamleYok: [],
      hamleSinir: { min: HAMLE_SN_MIN, max: HAMLE_SN_MAX },
      hamleVarsayilan: Object.fromEntries(ALL_GAMES.map(g => [g, varsayilanHamleSn(g, 15)])),
      tumOyunlar: ALL_GAMES
    }
  });
});

// Kurucu Paneli / Ana sayfa — canlı istatistikler (yalnız yönetici).
// Metrikler: online üye, aktif/bugünkü oyun, toplam/devam eden/tamamlanan
// maç, günlük-haftalık-aylık yeni üye, 7 günde aktif üye.
//
// KULLANICI RAPORU: "Toplam üye sayısı da sıfır gösteriyor." Kök neden:
// UZAK modda (GV_AUTH_API) kalıcı üyelik Yöncü MySQL'dedir — buradaki
// yerel `db` HER ZAMAN null'dur (bkz. db.js). js/admin-panel.js
// refreshHeroStats() Yöncü sayfasında PHP'nin (admin.php?action=stats —
// GERÇEK sayılar) ve Render'ın (bu uç — CANLI durum) sonuçlarını
// `Object.assign({}, phpStats, renderStats)` ile birleştirir; "canlı"
// olan İKİNCİ kaynak öncelikliydi. Bu uç eskiden totalUsers/newUsersX/
// totalMatches/activeUsers alanlarını `db` yokken de 0 değerleriyle
// DÖNDÜRÜYORDU — Object.assign bu SIFIRLARI PHP'nin gerçek sayılarının
// ÜZERİNE yazıyordu. Çözüm: bu alanlar yalnızca yerel `db` varsa (yerel/
// geliştirme modu) yanıta EKLENİR; UZAK modda hiç yer almazlar, böylece
// istemcideki birleştirme PHP'nin gerçek değerlerini KORUR.
app.get('/api/admin/stats', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const now = Date.now();
  const DAY = 86400000, WEEK = 7 * DAY, MONTH = 30 * DAY;
  /* "BUGÜN" = TAKVİM GÜNÜ, son 24 saat DEĞİL.
     Kullanıcı raporu: "en yakın üye 20 Eylül'de üye olmuş ama istatistikte
     hâlâ 'bugün yeni 1 üye' diyor." Sebep: sayım `now - 24 saat` ile
     yapılıyordu; dün akşam kaydolan bir üye ertesi sabah hâlâ "bugün"
     sayılıyordu. Artık Türkiye saatine (UTC+3, yaz saati yok) göre o günün
     gece yarısından itibaren sayılır. Haftalık/aylık kutular kasıtlı olarak
     "son 7/30 gün" kayan penceresi olarak kalır. */
  const gunBasi = ts => {
    const TR = 3 * 60 * 60 * 1000;
    const t = Number(ts) || Date.now();
    return Math.floor((t + TR) / DAY) * DAY - TR;
  };
  const bugunBasi = gunBasi(now);
  // ⚠ HATA DÜZELTMESİ (kullanıcı raporu: Kurucu Paneli'ndeki "Online
  // Kullanıcı" kutusu hep 0 gösteriyor, ana sayfadaki "Çevrimiçi Oyuncu"
  // ise doğru sayıyı gösteriyordu — aynı anda iki farklı sayı). Kök neden:
  // bu değer authApi.onlineCount()'tan geliyordu; bu sayaç yalnızca soket
  // authHello'su TAMAMLANMIŞ (yani kimliği PHP/imzalı belgeyle doğrulanmış)
  // üyeleri sayar. UZAK modda authHello'nun klasik yolu Render→PHP çağrısı
  // gerektirir; Yöncü'nün DDoS koruması bunu yavaşlatıp süresiz olarak hiç
  // tamamlanmayabiliyor — o zaman soket asla "doğrulanmış" sayılmıyor ve
  // sayaç kalıcı olarak 0'da kalıyordu. Aynı sayfadaki /api/live-stats ise
  // GÜVENİLİR varlık sistemini (presenceSayim — istemcinin kendi bildirdiği
  // kimlik, PHP'ye hiç gerek duymaz) kullanıyor. Artık "Online Kullanıcı"
  // da AYNI güvenilir kaynaktan (yalnız üye girişi yapmış olanlar) okunur —
  // böylece panel her zaman gerçek, tutarlı bir sayı gösterir.
  const onlineUsers = presenceSayim().uye;
  let activeGames = 0, ongoingMatches = 0, totalGames = ALL_GAMES.length;
  try {
    const playingGames = new Set();
    for (const r of rooms.values()) {
      if (r.status === 'playing') { ongoingMatches++; playingGames.add(r.gameId); }
    }
    activeGames = playingGames.size;
  } catch (_) {}
  const stats = { onlineUsers, totalGames, activeGames, ongoingMatches, now };
  if (db) {
    try {
      const totalUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
      const c = db.prepare('SELECT COUNT(*) c FROM matches').get().c;
      const totalMatches = c, completedMatches = c;
      const gamesToday = db.prepare('SELECT COUNT(*) c FROM matches WHERE ts >= ?').get(bugunBasi).c;
      const newUsersToday = db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(bugunBasi).c;
      const newUsersWeek = db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(now - WEEK).c;
      const newUsersMonth = db.prepare('SELECT COUNT(*) c FROM users WHERE created_at >= ?').get(now - MONTH).c;
      // 7 günde en az 1 maçı olan AYRIK üye adedi (son 500 maç taramasıyla):
      const recent = db.prepare('SELECT players FROM matches WHERE ts >= ? ORDER BY ts DESC LIMIT 500').all(now - WEEK);
      const seen = new Set();
      for (const m of recent) {
        try { (JSON.parse(m.players) || []).forEach(p => { if (p && p.id != null) seen.add(p.id); }); } catch (_) {}
      }
      const activeUsers = seen.size;
      Object.assign(stats, {
        totalUsers, activeUsers, gamesToday, totalMatches, completedMatches,
        newUsersToday, newUsersWeek, newUsersMonth
      });
    } catch (e) { console.warn('stats hatası:', e.message); }
  }
  res.json({ ok: true, stats });
});

// ============================================================================
// GERÇEK VARLIK (PRESENCE) SAYACI
// ----------------------------------------------------------------------------
// NEDEN: "çevrimiçi oyuncu" sayısı io.engine.clientsCount ile veriliyordu.
// Bu SOKET sayar, KİŞİ değil: aynı kullanıcının 3 sekmesi 3 kişi gibi
// görünüyor, sayfayı kapatan birinin soketi ise bir süre daha açık kalıp
// olmayan bir kalabalık üretiyordu. Kullanıcının şartı net: "İstatistik
// değerlerimiz ve verilerimiz tamamen gerçeği yansıtmalıdır."
//
// ÇÖZÜM: kişiyi kimliğiyle sayarız.
//   - Üye girişi yapmışsa anahtar  'u:<uid>'  → kaç sekme açarsa açsın 1 kişi
//   - Ziyaretçi ise anahtar        'g:<cihaz anahtarı>' → localStorage'da
//     tutulan kalıcı rastgele anahtar; aynı tarayıcının tüm sekmeleri 1 kişi
// Bir kişi "sitede" sayılır ANCAK:
//   - açık en az bir soketi varsa (oyun/lobi/sohbet sayfası), VEYA
//   - son PRESENCE_TTL içinde HTTP nabzı geldiyse (sadece ana sayfada duran
//     kullanıcı da sayılsın diye).
// Sekme kapanınca soket düşer ve nabız kesilir → kişi en geç TTL içinde
// listeden çıkar. Böylece sayı anlık gerçeği yansıtır.
// ============================================================================
const PRESENCE_TTL = 45000;      // nabız gelmezse kişi bu süre sonunda düşer
const presence = new Map();      // anahtar -> { uye, uid, sonHttp, soketler:Set }

function presenceKey(uid, cihaz) {
  const n = Number(uid);
  if (Number.isInteger(n) && n > 0) return 'u:' + n;
  const t = String(cihaz || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
  return t ? 'g:' + t : null;
}

function presenceGet(key) {
  let e = presence.get(key);
  if (!e) {
    e = { uye: key.charAt(0) === 'u', uid: key.charAt(0) === 'u' ? Number(key.slice(2)) : null,
          sonHttp: 0, soketler: new Set() };
    presence.set(key, e);
  }
  return e;
}

function presenceCanli(e) {
  return e.soketler.size > 0 || (now() - e.sonHttp) < PRESENCE_TTL;
}

// HTTP nabzı (ana sayfada duran, soket açmamış ziyaretçiler için).
//
// ⚠ HATA DÜZELTMESİ (kullanıcı raporu: "çevrimiçi oyuncu sayısı gerçeği
// yansıtmıyor, kurucu + 1 ziyaretçi vardı, toplam 2 olmalıydı ama 3
// gösterdi"): istemci HER nabızda hem uid hem cihaz anahtarını birlikte
// gönderir (bkz. js/live-stats.js). Bir ziyaretçi giriş yaptığında kimliği
// g:cihaz → u:uid'e geçer, ama bu fonksiyon eskiden yalnızca YENİ anahtarı
// güncelliyordu — eski g:cihaz kaydı kendi TTL'i (45 sn) dolana kadar
// "hâlâ sitede" sayılmaya devam ediyordu, yani GERÇEKTE TEK kişi olan
// ziyaretçi giriş yaptığı andan sonraki 45 saniye boyunca ÇİFT sayılıyordu.
// Soket bazlı geçişte (presenceSoketBagla) bu temizlik zaten yapılıyordu;
// aynı mantık burada HTTP nabzı için de uygulanır.
function presenceNabiz(uid, cihaz) {
  const key = presenceKey(uid, cihaz);
  if (!key) return null;
  const e = presenceGet(key);
  e.sonHttp = now();
  if (key.charAt(0) === 'u' && cihaz) {
    const eskiKey = presenceKey(null, cihaz);
    if (eskiKey && eskiKey !== key) {
      const eski = presence.get(eskiKey);
      if (eski) { eski.sonHttp = 0; if (!eski.soketler.size) presence.delete(eskiKey); }
    }
  }
  return e;
}

// Soket bağlanınca/kimliğini bildirince çağrılır.
function presenceSoketBagla(socket, uid, cihaz) {
  const key = presenceKey(uid, cihaz);
  if (!key) return;
  // Ziyaretçiyken giriş yaparsa eski (g:) kaydından soketi sök. AYRICA eski
  // kaydın HTTP nabzını (sonHttp) sıfırlarız: sıfırlamazsak eski ziyaretçi
  // kaydı, giriş öncesi son nabzı yüzünden TTL (45 sn) boyunca "hâlâ
  // sitede" sayılmaya devam eder — GERÇEKTE TEK KİŞİ olan ziyaretçi, giriş
  // yaptığı anda hem eski (g:cihaz) hem yeni (u:uid) kaydıyla ÇİFT
  // sayılırdı (kullanıcı raporu: "çevrimiçi oyuncu sayısı 1'den 3'e
  // yükseliyor, gerçek değeri yansıtmıyor" — birkaç giriş/çıkış denemesi
  // her seferinde bir hayalet kayıt daha ekliyordu). Aynı ziyaretçinin
  // BAŞKA bir sekmesi hâlâ o eski kimlikle geziniyorsa, o sekmenin kendi
  // HTTP nabzı en geç 20 sn içinde sonHttp'yi zaten yeniden tazeler —
  // burada sıfırlamak o durumda kalıcı bir kayıp yaratmaz.
  if (socket.__gvPKey && socket.__gvPKey !== key) {
    const eskiKey = socket.__gvPKey;
    const eski = presence.get(eskiKey);
    if (eski) eski.sonHttp = 0;
    presenceSoketKopar(socket);
  }
  socket.__gvPKey = key;
  presenceGet(key).soketler.add(socket.id);
}

function presenceSoketKopar(socket) {
  const key = socket.__gvPKey;
  if (!key) return;
  const e = presence.get(key);
  if (!e) return;
  e.soketler.delete(socket.id);
  // Soketi kalmadıysa ve HTTP nabzı da eskiyse kişiyi hemen düşür:
  // sekmeyi kapatan biri sayacı şişirmesin.
  if (!presenceCanli(e)) presence.delete(key);
}

function presenceSupur() {
  for (const [k, e] of presence) {
    // Sunucuda gerçekten bağlı olmayan soket kimliklerini ayıkla (Render
    // uyku/uyanma sonrası hayalet kayıtlar oluşabiliyor).
    for (const sid of e.soketler) {
      if (!io.sockets.sockets.get(sid)) e.soketler.delete(sid);
    }
    if (!presenceCanli(e)) presence.delete(k);
  }
}

function presenceSayim() {
  presenceSupur();
  let uye = 0, ziyaretci = 0;
  for (const e of presence.values()) { if (e.uye) uye++; else ziyaretci++; }
  return { toplam: uye + ziyaretci, uye, ziyaretci };
}

const presenceTimer = setInterval(presenceSupur, 15000);
if (presenceTimer.unref) presenceTimer.unref();

// CANLI SAYAÇLAR (KAMU) — ana sayfadaki karşılama şeridi için.
// Ana sayfada bu sayılar SABİT yazılmıştı (3.421 çevrimiçi, 1.205 aktif oda
// gibi uydurma değerler): siteye kim girerse girsin aynı rakamları
// görüyordu. Bu uç gerçek durumu döndürür ve yönetici yetkisi istemez;
// hiçbir kişisel bilgi taşımaz, yalnızca sayılar.
// POST ile çağrıldığında gövdedeki { uid, cihaz } aynı zamanda varlık
// nabzıdır — istemci tek istekte hem "buradayım" der hem sayıları alır.
function liveStatsGovde() {
  let aktifOda = 0, oynanan = 0, masadaki = 0;
  for (const r of rooms.values()) {
    const n = (r.players || []).length;
    if (n > 0) aktifOda++;
    if (r.status === 'playing') oynanan++;
    masadaki += n;
  }
  const k = presenceSayim();
  return {
    ok: true,
    online: k.toplam,          // sitede GERÇEKTEN bulunan kişi sayısı
    members: k.uye,            // bunların üye girişi yapmış olanları
    guests: k.ziyaretci,       // ziyaretçiler
    activeRooms: aktifOda,
    playingRooms: oynanan,
    seatedPlayers: masadaki,
    tournaments: 0,            // turnuva motoru henüz yok — uydurma sayı vermiyoruz
    now: Date.now()
  };
}

app.get('/api/live-stats', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(liveStatsGovde());
});

// ============================================================================
// PUAN UÇLARI
// ============================================================================
// Üyenin KENDİ puan özeti — oyun türüne göre AYRI (kullanıcının isteği:
// "Profilde tutulacak istatistikler, oyun türlerine göre ayrı ayrı
// gösterilecek."). Yetki: oturum sahibi kendi verisini görür.
app.get('/api/scores/me', async (req, res) => {
  let u = null;
  try {
    if (authApi && typeof authApi.userFromReqAsync === 'function') u = await authApi.userFromReqAsync(req);
  } catch (_) { u = null; }
  if (!u) return res.status(401).json({ ok: false, error: 'Puanları görmek için üye girişi yapmalısınız.' });
  let ozet = null;
  try { ozet = await authApi.puanOzet(u.id); } catch (_) { ozet = null; }
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, ozet: ozet || { toplam: 0, oyunlar: [], genel: {} },
             etiketler: scoring.ETIKET });
});

// Sıralama (kamu) — puan tablosunun herkese açık görünümü.
app.get('/api/scores/board', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const game = req.query.game ? String(req.query.game).slice(0, 24) : null;
  let siralama = [];
  try {
    if (authApi && typeof authApi.puanSiralama === 'function') {
      siralama = await authApi.puanSiralama(limit, game);
    }
  } catch (_) { siralama = []; }
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, siralama: siralama || [] });
});

// Puan tablosu kuralları (istemci "nasıl puan kazanırım" ekranını buradan
// çizer — kuralların tek kaynağı sunucudur, istemci kendi tablosunu tutmaz).
app.get('/api/scores/rules', (_req, res) => {
  res.json({ ok: true, puan: scoring.PUAN, etiket: scoring.ETIKET,
             carpanlar: { '3': 1, '5': 1.25, '7': 1.5 },
             periyotlar: scoring.PERIYOT_ETIKET });
});

// ---- KURUCU: puan sıfırlama (İstatistikler başlığı altında) ----
// İki seçenek (kullanıcının isteği):
//   1) ELLE  — kurucu butona basar, puanlar o an sıfırlanır
//   2) OTOMATİK — haftalık / aylık / 3 aylık / 6 aylık / yıllık periyot
// Sıfırlama VERİ SİLMEZ: yeni bir "sıfırlama noktası" işaretlenir ve
// toplamlar o andan itibaren sayılır. Böylece yanlışlıkla basılırsa
// geçmiş kayıt kaybolmaz.
app.get('/api/admin/scores/settings', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  let ayar = { periyot: 'kapali', sonSifirlama: 0 };
  try { ayar = (await authApi.puanAyarOku()) || ayar; } catch (_) {}
  res.json({ ok: true, periyot: ayar.periyot || 'kapali',
             sonSifirlama: ayar.sonSifirlama || 0,
             secenekler: scoring.PERIYOT_ETIKET });
});

app.post('/api/admin/scores/settings', async (req, res) => {
  const u = await requireAdmin(req, res);
  if (!u) return;
  const p = String((req.body && req.body.periyot) || 'kapali');
  if (!Object.prototype.hasOwnProperty.call(scoring.PERIYOTLAR, p)) {
    return res.status(400).json({ ok: false, error: 'Geçersiz periyot.' });
  }
  let r = { ok: false };
  try { r = (await authApi.puanAyarYaz(p)) || { ok: false }; } catch (e) { r = { ok: false, error: e.message }; }
  if (!r.ok) return res.status(500).json({ ok: false, error: r.error || 'Ayar kaydedilemedi.' });
  console.log('[PUAN] otomatik sıfırlama periyodu: ' + p + ' (kurucu #' + u.id + ')');
  res.json({ ok: true, periyot: p });
});

app.post('/api/admin/scores/reset', async (req, res) => {
  const u = await requireAdmin(req, res);
  if (!u) return;
  let r = { ok: false };
  try { r = (await authApi.puanSifirla(u.id, 'manuel')) || { ok: false }; }
  catch (e) { r = { ok: false, error: e.message }; }
  if (!r.ok) return res.status(500).json({ ok: false, error: r.error || 'Sıfırlanamadı.' });
  console.log('[PUAN] tüm puanlar ELLE sıfırlandı (kurucu #' + u.id + ')');
  res.json({ ok: true, ts: r.ts || Date.now() });
});

// ============================================================================
// KURUCU: ÜYE YAPTIRIMLARI (şimdilik yalnız SOHBET / MESAJ kısıtlaması)
// ============================================================================
// Kullanıcının isteği: "üyelere yaptırım uyarlama özelliği gelsin ... tüm
// sohbetler kapatılsın kullanıcının (oyun içi ve genel sohbet) 1 gün, 1
// hafta, 1 ay, 1 yıl, sınırsız, belirli süreli girilen süre de sessizlik.
// Kısıtlama getirildiğinde ilgili kullanıcıya bildirim gider."
//
// Süre seçenekleri TEK KAYNAK burada tanımlıdır; kurucu paneli listeyi bu
// uçtan okur, böylece istemci ile sunucu asla ayrışmaz.
const YAPTIRIM_SURELERI = {
  '1g':      { etiket: '1 Gün',    ms: 86400000 },
  '1h':      { etiket: '1 Hafta',  ms: 7 * 86400000 },
  '1a':      { etiket: '1 Ay',     ms: 30 * 86400000 },
  '1y':      { etiket: '1 Yıl',    ms: 365 * 86400000 },
  'sinirsiz':{ etiket: 'Sınırsız', ms: null },
  'ozel':    { etiket: 'Belirli süre (dakika)', ms: 0 }   // dakika alanından gelir
};
const YAPTIRIM_TURLERI = {
  chat: { etiket: 'Sohbet ve mesaj kısıtlaması',
          aciklama: 'Oyun içi (masa) ve genel sohbete mesaj gönderemez.' }
};
const YAPTIRIM_OZEL_MAX_DK = 525600;   // 1 yıl — üstü "sınırsız" ile yapılır

// Yaptırım süre seçenekleri + türleri (panel bu listeyi çizer).
app.get('/api/admin/sanctions/options', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.json({ ok: true,
    // ms: istemcinin (Yöncü sayfasında) PHP'ye DOĞRUDAN yazarken sureMs'i
    // kendisi hesaplayabilmesi için (bkz. js/admin-panel.js applySanction).
    sureler: Object.keys(YAPTIRIM_SURELERI).map(k => ({ id: k, etiket: YAPTIRIM_SURELERI[k].etiket, ms: YAPTIRIM_SURELERI[k].ms })),
    turler: Object.keys(YAPTIRIM_TURLERI).map(k => ({ id: k, ...YAPTIRIM_TURLERI[k] })),
    ozelMaxDakika: YAPTIRIM_OZEL_MAX_DK });
});

// Yürürlükteki tüm yaptırımlar (panel listesi).
app.get('/api/admin/sanctions', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  let liste = [];
  try { liste = (await authApi.yaptirimListe()) || []; } catch (_) { liste = []; }
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, liste });
});

/* UYARI GEÇMİŞİ (kullanıcı isteği: panelde "Uyarılar" sütunu + "Notlar").
   Yürürlükteki listenin aksine KALDIRILMIŞ ve SÜRESİ DOLMUŞ kayıtları da
   döndürür; panel bundan hem "kaç uyarı" sayısını hem de "kaçıncı uyarı,
   hangi tarihte, ne kadar süreyle" ayrıntısını üretir (katlamalı ceza).
   uid verilmezse TÜM üyelerin geçmişi tek çağrıda gelir. */
app.get('/api/admin/sanctions/history', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const uid = Number(req.query.uid) || 0;
  let liste = [];
  try { liste = (await authApi.yaptirimGecmis(uid || null, Number(req.query.limit) || 2000)) || []; }
  catch (_) { liste = []; }
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, liste });
});

/* ŞİKAYETLER — kurucu paneli listesi. scope=room (oyun içi) | global. */
app.get('/api/admin/reports', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const scope = (req.query.scope === 'room' || req.query.scope === 'global') ? req.query.scope : null;
  let liste = [];
  try { liste = (await authApi.raporListe({ scope, limit: Number(req.query.limit) || 200 })) || []; }
  catch (_) { liste = []; }
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, liste });
});

// Yaptırım UYGULA. Kalıcı kayıt üyelik katmanına yazılır (yerelde SQLite,
// üretimde Yöncü MySQL), ardından Render ANINDA uygular: önbellek tazelenir
// ve kullanıcının açık tüm sekmelerine AÇIKLAYICI bildirim düşer.
app.post('/api/admin/sanctions', async (req, res) => {
  const u = await requireAdmin(req, res);
  if (!u) return;
  const b = req.body || {};
  const uid = Number(b.userId || b.uid);
  if (!(uid > 0)) return res.status(400).json({ ok: false, error: 'Kullanıcı seçilmedi.' });
  if (Number(uid) === Number(u.id)) return res.status(400).json({ ok: false, error: 'Kendinize yaptırım uygulayamazsınız.' });
  const tur = String(b.tur || 'chat');
  if (!YAPTIRIM_TURLERI[tur]) return res.status(400).json({ ok: false, error: 'Geçersiz yaptırım türü.' });
  const sureId = String(b.sure || 'sinirsiz');
  const secim = YAPTIRIM_SURELERI[sureId];
  if (!secim) return res.status(400).json({ ok: false, error: 'Geçersiz süre seçeneği.' });
  let sureMs = secim.ms;                                  // null → süresiz
  if (sureId === 'ozel') {
    const dk = Math.floor(Number(b.dakika));
    if (!(dk > 0) || dk > YAPTIRIM_OZEL_MAX_DK) {
      return res.status(400).json({ ok: false, error: 'Süre 1 ile ' + YAPTIRIM_OZEL_MAX_DK + ' dakika arasında olmalı.' });
    }
    sureMs = dk * 60000;
  }
  const sebep = String(b.sebep || '').replace(/[<>]/g, '').trim().slice(0, 240);

  let r = { ok: false };
  try {
    r = (await authApi.yaptirimUygula({ uid, tur, sureMs, sebep, byUid: u.id })) || { ok: false };
  } catch (e) { r = { ok: false, error: e.message }; }
  if (!r.ok) return res.status(500).json({ ok: false, error: r.error || 'Yaptırım kaydedilemedi.' });

  const bitis = (sureMs == null) ? null : Date.now() + sureMs;
  if (tur === 'chat') sanctionCacheSet(uid, { bitis, sebep });

  // Kullanıcıya AÇIKLAYICI anlık bildirim (çevrimdışıysa bir sonraki
  // mesaj denemesinde aynı açıklamayı ret mesajı olarak görür).
  try {
    if (authApi && typeof authApi.emitToUser === 'function') {
      authApi.emitToUser(uid, 'chatSanction', {
        tur, bitis, sebep,
        baslik: '🔇 Sohbet kısıtlaması uygulandı',
        aciklama: yaptirimAciklama({ bitis, sebep }),
        sureMetni: yaptirimBitisMetni(bitis)
      });
    }
  } catch (_) {}
  console.log('[YAPTIRIM] #' + uid + ' ' + tur + ' kısıtlandı (' + (bitis ? new Date(bitis).toISOString() : 'süresiz') + ') — kurucu #' + u.id);
  res.json({ ok: true, yaptirim: { userId: uid, tur, bitis, sebep } });
});

// Yaptırımı KALDIR.
app.post('/api/admin/sanctions/lift', async (req, res) => {
  const u = await requireAdmin(req, res);
  if (!u) return;
  const uid = Number((req.body && (req.body.userId || req.body.uid)));
  if (!(uid > 0)) return res.status(400).json({ ok: false, error: 'Kullanıcı seçilmedi.' });
  const tur = String((req.body && req.body.tur) || 'chat');
  let r = { ok: false };
  try { r = (await authApi.yaptirimKaldir(uid, u.id, tur)) || { ok: false }; }
  catch (e) { r = { ok: false, error: e.message }; }
  if (!r.ok) return res.status(500).json({ ok: false, error: r.error || 'Kaldırılamadı.' });
  if (tur === 'chat') sanctionCacheSet(uid, null);
  try {
    if (authApi && typeof authApi.emitToUser === 'function') {
      authApi.emitToUser(uid, 'chatSanctionLifted', {
        tur,
        baslik: '✅ Sohbet kısıtlaması kaldırıldı',
        aciklama: 'Sohbet kısıtlamanız kaldırıldı — oyun içi ve genel sohbete yeniden yazabilirsiniz.'
      });
    }
  } catch (_) {}
  console.log('[YAPTIRIM] #' + uid + ' ' + tur + ' kısıtlaması kaldırıldı — kurucu #' + u.id);
  res.json({ ok: true, kaldirilan: r.kaldirilan || 0 });
});

// SENKRONİZASYON: kalıcı yazma tarayıcıdan PHP'ye DOĞRUDAN gittiğinde
// (bkz. js/admin-panel.js — Yöncü sayfasında admin.php/social.php'ye
// doğrudan bearer ile gider, Render'ın X-GV-Key'li çağrısı DDoS korumasıyla
// engellenebildiği için) Render'ın haberi olması gerekir: yaptırım önbelleği
// (soket katmanında ANINDA reddetme) ve kullanıcıya anlık bildirim.
// Bu uç PHP'ye HİÇ yazmaz — yalnız Render'ın kendi belleğini günceller,
// tıpkı /api/admin/tables-apply'ın uzak modda ayarı YENİDEN kaydetmemesi gibi.
app.post('/api/admin/sanctions/sync', async (req, res) => {
  const u = await requireAdmin(req, res);
  if (!u) return;
  const b = req.body || {};
  const uid = Number(b.userId || b.uid);
  if (!(uid > 0)) return res.status(400).json({ ok: false, error: 'Kullanıcı seçilmedi.' });
  const tur = String(b.tur || 'chat');
  const eylem = String(b.action || 'apply');
  try {
    if (eylem === 'lift') {
      if (tur === 'chat') sanctionCacheSet(uid, null);
      if (authApi && typeof authApi.emitToUser === 'function') {
        authApi.emitToUser(uid, 'chatSanctionLifted', {
          tur, baslik: '✅ Sohbet kısıtlaması kaldırıldı',
          aciklama: 'Sohbet kısıtlamanız kaldırıldı — oyun içi ve genel sohbete yeniden yazabilirsiniz.'
        });
      }
    } else {
      const bitis = b.bitis == null ? null : Number(b.bitis);
      const sebep = String(b.sebep || '');
      if (tur === 'chat') sanctionCacheSet(uid, { bitis, sebep });
      if (authApi && typeof authApi.emitToUser === 'function') {
        authApi.emitToUser(uid, 'chatSanction', {
          tur, bitis, sebep,
          baslik: '🔇 Sohbet kısıtlaması uygulandı',
          aciklama: yaptirimAciklama({ bitis, sebep }),
          sureMetni: yaptirimBitisMetni(bitis)
        });
      }
    }
  } catch (_) {}
  res.json({ ok: true });
});

// ÜYENİN KENDİ yaptırım durumu: giriş yaptığında/sayfayı yenilediğinde
// sohbet kutusunun kilitli görünmesi için (kurucu yetkisi GEREKMEZ, kişi
// yalnız kendi durumunu görür).
app.get('/api/sanctions/me', async (req, res) => {
  let u = null;
  try {
    if (authApi && typeof authApi.userFromReqAsync === 'function') u = await authApi.userFromReqAsync(req);
  } catch (_) { u = null; }
  res.set('Cache-Control', 'no-store');
  if (!u || !u.id) return res.json({ ok: true, yaptirim: null });
  const y = await sohbetYaptirimi(u.id);
  res.json({ ok: true, yaptirim: y ? { tur: 'chat', bitis: y.bitis, sebep: y.sebep,
                                       aciklama: yaptirimAciklama(y) } : null });
});

// OTOMATİK SIFIRLAMA ZAMANLAYICISI
// Kurucu bir periyot seçtiyse, süresi dolduğunda puanlar kendiliğinden
// sıfırlanır. Saatte bir kontrol yeter (periyotlar en az haftalık).
async function puanOtomatikKontrol() {
  if (!authApi || typeof authApi.puanAyarOku !== 'function') return;
  try {
    const ayar = (await authApi.puanAyarOku()) || {};
    const ms = scoring.PERIYOTLAR[String(ayar.periyot || 'kapali')] || 0;
    if (!ms) return;                                   // kapalı
    const son = Number(ayar.sonSifirlama) || 0;
    // Hiç sıfırlanmadıysa ilk periyodu ŞİMDİDEN başlat (geçmişi silme).
    if (!son) { await authApi.puanSifirla(null, 'otomatik'); return; }
    if (Date.now() - son >= ms) {
      await authApi.puanSifirla(null, 'otomatik');
      console.log('[PUAN] otomatik sıfırlama uygulandı (' + ayar.periyot + ')');
    }
  } catch (e) { console.warn('otomatik puan sıfırlama kontrolü başarısız:', e.message); }
}
const puanTimer = setInterval(puanOtomatikKontrol, 3600000);
if (puanTimer.unref) puanTimer.unref();
setTimeout(puanOtomatikKontrol, 30000);   // açılıştan 30 sn sonra bir kez

// Sekme kapanırken gönderilen "ayrılıyorum" işareti (sendBeacon).
// Nabız kesilse de kişi 45 sn daha sayılırdı; bu uç sayacı ANINDA düzeltir.
app.post('/api/presence-bye', (req, res) => {
  try {
    const b = req.body || {};
    const key = presenceKey(b.uid, b.cihaz || b.k);
    const e = key ? presence.get(key) : null;
    // Soketi hâlâ açıksa kişi gerçekten sitededir (başka sekmesi olabilir):
    // yalnız HTTP nabzını sıfırlarız, kaydı silmeyiz.
    if (e) { e.sonHttp = 0; if (!e.soketler.size) presence.delete(key); }
  } catch (_) {}
  res.json({ ok: true });
});

app.post('/api/live-stats', (req, res) => {
  const b = req.body || {};
  presenceNabiz(b.uid, b.cihaz || b.k);
  res.set('Cache-Control', 'no-store');
  res.json(liveStatsGovde());
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

// ---- Bilinmeyen yol + statik hata işleyicisi ----
// Express'in varsayılan işleyicisi 403/404 durumlarında sunucu yığın izini
// (dosya yolları dahil) loglara ve bazı durumlarda cevaba basıyordu.
// Dizin kaçışı denemelerinde bu hem gürültü hem bilgi sızıntısıdır.
app.use((req, res) => res.status(404).json({ ok: false, error: 'Bulunamadı.' }));
app.use((err, _req, res, _next) => {
  const code = (err && (err.status || err.statusCode)) || 500;
  if (code >= 500) console.error('Sunucu hatası:', err && err.message);
  res.status(code).json({ ok: false, error: code === 403 ? 'Erişim yok.' : code === 404 ? 'Bulunamadı.' : 'Sunucu hatası.' });
});

// Ayarlar → hazır masalar → dinleme. Uzak modda ayarların Yöncü'den
// gelmesi (en fazla 4 sn) beklenir; erişilemezse varsayılanlarla kurulur.
async function start(port) {
  if (process.env.GV_AUTH_API) await loadPresetConfigRemote();
  else { loadPresetConfigLocal(); loadPopularConfigLocal(); }
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
  // Sirasi kimde: hamle saatinin kime islediğini testler de dogrulayabilsin
  // (orn. Metropol'de TEKLIF turunda saat teklifin yapildigi oyunculadir).
  turnSeatOf,
  // Yönetici (kurucu) paneli + hazır masa yönetimi (testler için de export):
  ALL_GAMES, STANDARD_PRESET_GAMES, PRESET_GAME_BASES, defaultPresetConfig, normPresetConfig,
  presetTablesFromConfig, applyPresetConfig, loadPresetConfigLocal, savePresetConfigLocal, gameVisible,
  // Popüler oyun sıralaması (Kurucu Paneli — testler için de export):
  defaultPopularConfig, normPopularConfig, loadPopularConfigLocal, savePopularConfigLocal,
  // Puan sistemi test kancaları (yalnız testler kullanır; üretimde etkisi yok).
  // chatGlobal: şikayet dökümünün "son 1 dakika" süzgecini sınamak için —
  // test bir mesajın zaman damgasını geriye alıp süzgecin onu ELEDİĞİNİ
  // doğrular (gerçekte 1 dakika beklemek gerekirdi).
  __test: { puanYaz, puanDonusYaz, scoring, presenceSayim, chatGlobal: () => chatGlobal } };
// Eski test uyumluluğu: PRESET_TABLES artık yapılandırmadan üretilir.
Object.defineProperty(module.exports, 'PRESET_TABLES', { get: () => presetTablesFromConfig(presetConfig) });
Object.defineProperty(module.exports, 'popularConfig', { get: () => popularConfig });
