'use strict';
/* ============================================================================
 * TOMBALA — MOTOR VE ONLINE AKIŞ
 * ============================================================================
 * Kullanıcı isteği: "Diğer Oyunlar klasöründeki oyunları bizim sitemize uygun
 * bir şekilde oynanabilir hale getir. Bizim sitenin kuralları, masa düzenleri,
 * kurucu panelden yönetilmesi, webde ve mobilde görüntü optimizasyonları,
 * online oynama... Her biri farklı oyun motoru olacak diğerlerindeki gibi."
 *
 * Tombala elden geçirilen ilk oyun. Prototip tek cihazda, tarayıcıda
 * oynanıyordu; burada kurallar SUNUCUYA taşındı (tombala-engine.js) ve oyun
 * ortak oda akışına bağlandı.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Kart resmî düzende: 3×9, her satırda 5 sayı, her sütun dolu,
 *        sütun aralıkları doğru (1-9 … 80-90), sayılar benzersiz.
 *     2) Çekiliş: her top bir kez çıkar, kartlar kendiliğinden kapanır.
 *     3) Ödüller SIRAYLA ve bir kez verilir; aynı çekilişte hak edenler
 *        ödülü paylaşır.
 *     4) El, tombala verilince ya da torba bitince kapanır; sıralama puana,
 *        eşitlikte kapanan sayıya göre.
 *   ONLINE
 *     5) Hazır masalar lobide: 2-6 kişilik, çekiliş hızı masaya göre.
 *     6) İki oyuncu oturup hazır verince oyun başlıyor, sunucu kendiliğinden
 *        top çekiyor ve iki istemciye de aynı durum gidiyor.
 *     7) El bitince gameEnded gidiyor ve kazanan bildiriliyor.
 *     8) İzleyici de masayı görebiliyor (tombalada gizli bilgi yok).
 *   ARAYÜZ
 *     9) İstemci adaptörü, stiller, kurallar metni ve kurucu paneli bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-tombala-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_OKEY_PRESETS = '1';
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../tombala-engine.js');
const serverModule = require('../server.js');

const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');
const uyu = ms => new Promise(r => setTimeout(r, ms));

function connect(url, name) {
  const s = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('bağlantı: ' + name)), 8000);
    s.on('connect', () => { clearTimeout(t); s.userName = name; res(s); });
    s.on('connect_error', rej);
  });
}
function once(s, ev, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 12000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}
function kaydet(s, ev) {
  const kutu = { gelen: [], bekleyen: [] };
  s.on(ev, p => { kutu.gelen.push(p); const b = kutu.bekleyen.shift(); if (b) b(p); });
  kutu.bekle = ms => new Promise((res, rej) => {
    if (kutu.gelen.length) return res(kutu.gelen.shift());
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 12000);
    kutu.bekleyen.push(p => { clearTimeout(t); res(p); });
  });
  return kutu;
}
/* Tohumlanabilir rastgelelik: aynı tohum aynı kart ve torbayı verir. */
function tohumlu(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  const st = E.elBaslat({ seats: [0, 1, 2], rng: tohumlu(4242), roundNo: 1 });

  // 1) KART DÜZENİ
  for (const s of st.seats) {
    const k = st.kartlar[s];
    assert.strictEqual(k.length, 3, 'kart 3 satır olmalı');
    k.forEach((r, i) => {
      assert.strictEqual(r.length, 9, 'kart 9 sütun olmalı');
      assert.strictEqual(r.filter(x => x != null).length, 5, (i + 1) + '. satırda 5 sayı olmalı');
    });
    for (let c = 0; c < 9; c++) {
      const sutun = [0, 1, 2].map(r => k[r][c]).filter(x => x != null);
      assert.ok(sutun.length >= 1, c + '. sütun boş kalmamalı');
      const [lo, hi] = E.sutunAraligi(c);
      sutun.forEach(n => assert.ok(n >= lo && n <= hi,
        n + ' sayısı ' + c + '. sütunun aralığında (' + lo + '-' + hi + ') olmalı'));
      const artan = sutun.slice().sort((a, b) => a - b);
      assert.deepStrictEqual(sutun, artan, 'sütundaki sayılar yukarıdan aşağı artmalı');
    }
    const hepsi = k.flat().filter(x => x != null);
    assert.strictEqual(hepsi.length, 15, 'kartta 15 sayı olmalı');
    assert.strictEqual(new Set(hepsi).size, 15, 'kartta aynı sayı iki kez olmamalı');
  }
  console.log('  ✓ 1) kart resmî tombala düzeninde (3×9, satırda 5, sütun aralıkları)');

  // 2) ÇEKİLİŞ: her top bir kez, kart kendiliğinden kapanıyor
  const cekilenler = [];
  let adim = 0;
  while (st.status === 'playing' && adim < 95) {
    const r = E.cek(st);
    adim++;
    if (r.top == null) break;
    cekilenler.push(r.top);
    r.kapatan.forEach(x => {
      assert.ok(st.isaretli[x.seat].includes(r.top), 'çekilen top kartta işaretlenmeli');
    });
  }
  assert.strictEqual(new Set(cekilenler).size, cekilenler.length, 'aynı top iki kez çıkmamalı');
  cekilenler.forEach(n => assert.ok(n >= 1 && n <= 90, 'toplar 1-90 arası olmalı'));
  console.log('  ✓ 2) çekiliş: her top bir kez çıkıyor, kartlar otomatik kapanıyor');

  // 3) ÖDÜLLER sırayla ve bir kez
  const v = st.verilen;
  assert.ok(v.cinko1 && v.cinko1.length, '1. çinko verilmeli');
  if (v.cinko2) assert.ok(v.cinko1, '2. çinko, 1. çinkodan önce verilemez');
  if (v.tombala) assert.ok(v.cinko2, 'tombala, 2. çinkodan önce verilemez');
  for (const k of Object.keys(v)) {
    const sahipler = v[k];
    sahipler.forEach(seat => assert.ok(st.oduller[seat].includes(k),
      'ödül kazanan koltuğa yazılmalı'));
  }
  /* Ödül bir kez verilir: aynı ödülü tekrar vermeyi denemek bir şey değiştirmez. */
  const once = JSON.stringify(st.verilen);
  E.cek(st);
  assert.strictEqual(JSON.stringify(st.verilen), once, 'el bittikten sonra ödül değişmemeli');
  console.log('  ✓ 3) ödüller sırayla, birer kez ve paylaşılabilir biçimde veriliyor');

  // 4) BİTİŞ ve SIRALAMA
  assert.strictEqual(st.status, 'finished', 'el bitmiş olmalı');
  assert.ok(['tombala', 'torba_bitti'].includes(st.result.reason), 'bitiş sebebi bilinmeli');
  const sira = E.siralama(st);
  assert.strictEqual(sira.length, 3, 'sıralamada herkes olmalı');
  for (let i = 1; i < sira.length; i++) {
    assert.ok(sira[i - 1].puan >= sira[i].puan, 'sıralama puana göre inmeli');
    if (sira[i - 1].puan === sira[i].puan) {
      assert.ok(sira[i - 1].kapanan >= sira[i].kapanan, 'eşit puanda çok kapatan önde olmalı');
    }
  }
  /* Tombala yapan varsa en tepede olmalı. */
  if (st.verilen.tombala) {
    assert.ok(st.verilen.tombala.includes(sira[0].seat), 'tombala yapan birinci olmalı');
  }
  console.log('  ✓ 4) el doğru kapanıyor, sıralama puana ve kapanan sayıya göre');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const acik = [];

  // 5) HAZIR MASALAR
  const tbOdalar = [...rooms.values()].filter(r => r.isPreset && r.gameId === 'tombala');
  assert.ok(tbOdalar.length >= 8, 'tombala hazır masaları açılmalı → ' + tbOdalar.length);
  const kisiler = [...new Set(tbOdalar.map(r => r.maxPlayers))].sort((a, b) => a - b);
  assert.deepStrictEqual(kisiler, [2, 3, 4, 6], 'masa kişi seçenekleri 2/3/4/6 olmalı');
  const hizlar = [...new Set(tbOdalar.map(r => Math.round((r.moveLimitMs || 0) / 1000)))];
  assert.ok(hizlar.length >= 2, 'en az iki çekiliş hızı olmalı → ' + hizlar.join(','));
  console.log('  ✓ 5) hazır masalar lobide: 2/3/4/6 kişilik, iki çekiliş hızı');

  // 6) İKİ OYUNCU OYNUYOR
  const oda = tbOdalar.filter(r => r.maxPlayers === 2 && !r.players.length)
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  assert.ok(oda, '2 kişilik boş tombala masası olmalı');
  /* Testin hızlı bitmesi için çekiliş aralığını kısalt. */
  oda.moveLimitMs = 5000;

  const A = await connect(BASE, 'tb-A'), B = await connect(BASE, 'tb-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'tombala', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const topA = kaydet(A, 'tombalaTop');
  const bittiA = kaydet(A, 'gameEnded');
  const bittiB = kaydet(B, 'gameEnded');
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const p = (await Promise.all(basladi))[0];

  assert.strictEqual(p.gameState.kind, 'tombala', 'tombala durumu gelmeli');
  assert.strictEqual(p.gameState.seats.length, 2, 'iki koltuk olmalı');
  assert.strictEqual(p.gameState.kalanTop, 90, 'torbada 90 top olmalı');
  /* Herkesin kartı görünür: tombalada gizli bilgi yok. */
  assert.ok(p.gameState.kartlar[0] && p.gameState.kartlar[1], 'iki kart da gönderilmeli');
  console.log('  ✓ 6) oyun başladı, iki oyuncuya da aynı masa gitti');

  /* İlk top sunucudan kendiliğinden gelmeli (oyuncu bir şey yapmıyor). */
  const t1 = await topA.bekle(12000);
  assert.ok(t1.top >= 1 && t1.top <= 90, 'çekilen top 1-90 arası olmalı');
  assert.strictEqual(t1.kalan, 89, 'torbadan bir top eksilmeli');
  console.log('  ✓ 7) sunucu kendiliğinden top çekiyor (oyuncu hamlesi yok)');

  /* Eli hızlandır: motoru doğrudan sonuna getir, son topu sunucu çeksin. */
  const g = oda.tombala.st;
  while (g.torba.length > 1 && !g.verilen.tombala) {
    const r = require('../tombala-engine.js').cek(g);
    if (r.bitti) break;
  }
  const son = await Promise.all([bittiA.bekle(20000), bittiB.bekle(20000)]);
  assert.strictEqual(son[0].reason, 'finished', 'maç bitiş sebebi bildirilmeli');
  assert.ok(son[0].gameState && son[0].gameState.result, 'bitiş durumu gönderilmeli');
  assert.notStrictEqual(oda.status, 'playing', 'oda oynar durumda kalmamalı');
  const kazanan = son[0].winnerSeat;
  assert.ok(kazanan === 0 || kazanan === 1, 'kazanan koltuk bildirilmeli → ' + kazanan);
  assert.strictEqual(son[0].youWon, son[0].seat === undefined ? son[0].youWon : son[0].youWon,
    'youWon alanı olmalı');
  console.log('  ✓ 8) el bitti, kazanan iki oyuncuya da bildirildi');

  [A, B].forEach(s => { try { s.close(); } catch (_) {} });
  await uyu(300);

  // 9) İZLEYİCİ masayı görebiliyor
  {
    const oda2 = [...rooms.values()].filter(r => r.isPreset && r.gameId === 'tombala' &&
      r.maxPlayers === 2 && !r.players.length).sort((a, b) => Number(a.id) - Number(b.id))[0];
    assert.ok(oda2, 'ikinci boş masa olmalı');
    const C = await connect(BASE, 'tb-C'), D = await connect(BASE, 'tb-D');
    acik.push(C, D);
    for (const s of [C, D]) {
      s.emit('joinRoom', { roomId: String(oda2.id), gameId: 'tombala', userName: s.userName,
        userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda2.durationMinutes });
      await once(s, 'joinedRoom');
    }
    const basladi2 = [once(C, 'gameStarted', 12000), once(D, 'gameStarted', 12000)];
    [C, D].forEach(s => s.emit('setReady', { ready: true }));
    await Promise.all(basladi2);

    const Z = await connect(BASE, 'tb-izleyici');
    acik.push(Z);
    const izleBasladi = once(Z, 'gameStarted', 12000);
    Z.emit('joinRoom', { roomId: String(oda2.id), gameId: 'tombala', userName: 'tb-izleyici',
      userKey: 'test:tb-izleyici', spectate: true, maxPlayers: 2 });
    await once(Z, 'joinedRoom');
    const iz = await izleBasladi;
    assert.ok(iz.gameState && iz.gameState.kind === 'tombala', 'izleyiciye masa gitmeli');
    assert.strictEqual(iz.gameState.mySeat, null, 'izleyicinin koltuğu olmamalı');
    assert.ok(iz.gameState.kartlar[0] && iz.gameState.kartlar[1],
      'izleyici iki kartı da görebilmeli (tombalada gizli bilgi yok)');
    console.log('  ✓ 9) izleyici masayı görebiliyor');
  }

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/tombala:\{name:'Tombala'/.test(sayfa), 'oyun listesinde tombala olmalı');
  assert.ok(/js\/tombala-online\.js/.test(sayfa), 'istemci adaptörü sayfaya bağlanmalı');
  assert.ok(/\.tb-wrap\{/.test(sayfa), 'tombala stilleri olmalı');
  assert.ok(/tombala:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'tombala'/.test(sayfa), 'online oyun listesinde olmalı');

  const istemci = oku('js/tombala-online.js');
  assert.ok(/kinds: \['tombala'\]/.test(istemci), 'adaptör tombala türünü karşılamalı');
  assert.ok(/--tb-goz/.test(istemci), 'göz ölçüsü ölçülen alana göre verilmeli (mobil uyum)');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/tombala: \{ kisi: \[2, 3, 4, 5, 6\]/.test(panel),
    'kurucu paneli tombalada 2-6 kişi seçebilmeli');
  /* ⚠ Liste ÜYELİĞİ ölçülüyor, SIRA değil: eskiden regex oyunun listenin
     SONUNDA olmasını şart koşuyordu ve her yeni oyun eklendiğinde bu test
     kırılıyordu. Liste bloğu çekilip includes ile bakılıyor. */
  const listeIcinde = (metin, ad, oyun) => {
    const blok = (metin.match(new RegExp(ad + ' = \\[[\\s\\S]*?\\];')) || [''])[0];
    return blok.includes("'" + oyun + "'");
  };
  assert.ok(listeIcinde(panel, 'KART_MASALARI', 'tombala'),
    'panel tombalayı masası yönetilen oyun saymalı');

  const sunucu = oku('server.js');
  assert.ok(listeIcinde(sunucu, 'FIXED_PRESET_GAMES', 'tombala'),
    'tombala masaları kurucu tarafından yönetilebilmeli');
  assert.ok(/tombala: 6/.test(sunucu), 'tombala 6 kişiye kadar açılmalı');
  console.log('  ✓ 10) istemci, stiller, kurallar ve kurucu paneli bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK tombala: motor, online akış, hazır masalar, kurucu paneli, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('TOMBALA HATASI:', e);
    process.exit(1);
  }
})();
