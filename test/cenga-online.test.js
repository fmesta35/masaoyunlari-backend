'use strict';
/* ============================================================================
 * CENGA — SUNUCU DURUMU, KARE RÖLESİ VE ÇEVRİMİÇİ AKIŞ
 * ============================================================================
 * Kullanıcı isteği: "Cenga ... sana ilettiğim dosyalardaki gibi değil, örnek
 * videodakilere de bak. Aynı o kod ve videodakiler gibi olsunlar."
 *
 * Oyun artık referans kodun KENDİSİ: three.js 3B kule, cannon-es çöküş
 * fiziği, yeşil bölgeyi takip eden çekme göstergesi (assets/oyunlar/
 * cenga3d.html). Fizik sırası olanın tarayıcısında çalışır; sunucu kare
 * rölesi, sıra/skor kaydı ve bitişi yönetir.
 *
 * NE DOĞRULANIR
 *   MOTOR (cenga-engine.js)
 *     1) Maç başlangıcı: tohum, sıra, boş kayıt.
 *     2) Sıra devri: geçerli kule + puan kabul edilir, sıra rakibe geçer.
 *     3) Geçersiz devirler reddedilir (yanlış koltuk, bozuk kule, kendine devir).
 *     4) Bitiş: kaybeden kendi koltuğu olmak zorunda (taş bitmesi hariç).
 *     5) Süre aşımı: ardışık üçüncüde hükmen mağlubiyet; devirde sayaç sıfırlanır.
 *     6) Pes ve görünüm (kule kaydı/skor, izleyici koltuğu null).
 *   ONLINE
 *     7) Hazır masalar lobide (10 masa, 2 kişilik).
 *     8) Oyun başlıyor; yalnız SIRASI OLAN kare yollayabilir ve kareler rakibe ulaşır.
 *     9) Sıra devri sunucuya yazılır, rakibe iletilir, geç gelen kuleyi görür.
 *    10) Kule devrilince maç biter; yanlış kişiyi kaybettirme denemesi reddedilir.
 *   ARAYÜZ
 *    11) İstemci adaptörü, iframe oyunu, stiller, kurallar ve kapak bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-cenga-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../cenga-engine.js');
const serverModule = require('../server.js');

const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');

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
async function httpRooms(base, gameId) {
  const r = await fetch(base + '/api/rooms?gameId=' + gameId);
  const j = await r.json();
  return j.rooms || j;
}
function tohumlu(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}


function kule(tersle) {
  const a = [];
  for (let l = 0; l < 18; l++) for (let s = 0; s < 3; s++) a.push([l, s]);
  if (tersle) { a[0] = [18, 1]; a[1] = [18, 0]; a[2] = [18, 2]; }   // üç taşı yeni kata taşı
  return a;
}
function oyuncular(p0, p1) {
  return [{ name: 'A', score: p0, streak: 1, pulls: 1 }, { name: 'B', score: p1, streak: 0, pulls: 0 }];
}

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  // 1) BAŞLANGIÇ
  const c = E.macBaslat({ seats: [1, 0] });
  assert.deepStrictEqual(c.seats, [0, 1], 'koltuklar sıralı olmalı');
  assert.strictEqual(c.turn, 0, 'ilk sıra en küçük koltukta');
  assert.strictEqual(c.status, 'playing');
  assert.ok(Number.isInteger(c.seed) && c.seed > 0, 'iki istemci aynı kuleyi kursun diye tohum olmalı');
  assert.strictEqual(c.settled, null, 'başlangıçta kayıtlı kule yok (istemci tohumdan kurar)');
  console.log('  ✓ 1) maç tohumla başlıyor, sıra ilk koltukta');

  // 2) SIRA DEVRİ
  const r = E.turDevret(c, 0, { current: 1, turn: 1, settled: kule(true), players: oyuncular(284, 0), stability: 0.8 });
  assert.ok(r.ok, 'geçerli devir kabul edilmeli: ' + JSON.stringify(r));
  assert.strictEqual(c.turn, 1, 'sıra rakibe geçmeli');
  assert.strictEqual(c.skor[0], 284, 'puan sunucuda tutulmalı');
  assert.strictEqual(c.settled.length, 54, 'yerleşmiş kule kaydedilmeli');
  assert.strictEqual(c.tur, 1);
  console.log('  ✓ 2) sıra devri: kule + puan kaydı, sıra rakibe geçti');

  // 3) GEÇERSİZ DEVİRLER
  assert.strictEqual(E.turDevret(c, 0, { current: 0, turn: 2, settled: kule(), players: oyuncular(0, 0) }).reason,
    'not_your_turn', 'sırası olmayan devredemez');
  assert.strictEqual(E.turDevret(c, 1, { current: 1, turn: 2, settled: kule(), players: oyuncular(0, 0) }).reason,
    'gecersiz_tur', 'sırayı kendine devredemez');
  const bozuk = kule(); bozuk[5] = bozuk[4].slice();
  assert.strictEqual(E.turDevret(c, 1, { current: 0, turn: 2, settled: bozuk, players: oyuncular(0, 0) }).reason,
    'gecersiz_tas', 'iki taş aynı yerde olamaz');
  assert.strictEqual(E.turDevret(c, 1, { current: 0, turn: 2, settled: kule().slice(1), players: oyuncular(0, 0) }).reason,
    'gecersiz_tas', 'taş sayısı 54 olmalı');
  assert.strictEqual(E.turDevret(c, 1, { current: 5, turn: 2, settled: kule(), players: oyuncular(0, 0) }).reason,
    'gecersiz_tur', 'olmayan oyuncu sırası reddedilmeli');
  const tasan = kule(); tasan[0] = [999, 1];
  assert.strictEqual(E.turDevret(c, 1, { current: 0, turn: 2, settled: tasan, players: oyuncular(0, 0) }).reason,
    'gecersiz_tas', 'kule yüksekliği sınırlı olmalı');
  const asiri = E.turDevret(c, 1, { current: 0, turn: 2, settled: kule(), players: oyuncular(1e12, -5) });
  assert.ok(asiri.ok && c.skor[0] === 1e6 && c.skor[1] === 0, 'puanlar sınırlanmalı');
  console.log('  ✓ 3) geçersiz devirler reddediliyor, puanlar sınırlanıyor');

  // 4) BİTİŞ
  const b = E.macBaslat({ seats: [0, 1] });
  assert.strictEqual(E.bitir(b, 1, { loser: 1, reason: 'balance' }).reason, 'not_your_turn');
  assert.strictEqual(E.bitir(b, 0, { loser: 1, reason: 'balance' }).reason, 'gecersiz_tur',
    'rakibi kaybettirme reddedilmeli');
  const bit = E.bitir(b, 0, { loser: 0, reason: 'structure', players: oyuncular(120, 80) });
  assert.ok(bit.ok && b.status === 'finished' && b.winner === 1 && b.loser === 0, 'kuleyi deviren kaybeder');
  assert.strictEqual(b.result.neden, 'yapi');
  assert.strictEqual(E.bitir(b, 0, { loser: 0, reason: 'balance' }).reason, 'game_over', 'ikinci bitiş yok');
  const n = E.macBaslat({ seats: [0, 1] });
  const nr = E.bitir(n, 0, { loser: 1, reason: 'nomoves' });
  assert.ok(nr.ok && n.winner === 0 && n.result.neden === 'tas_bitti', 'taş kalmazsa sıradaki oyuncu kaybeder');
  console.log('  ✓ 4) bitiş: deviren kaybeder, taş bitmesi sıradaki oyuncuya yazılır');

  // 5) SÜRE AŞIMI
  const t = E.macBaslat({ seats: [0, 1] });
  assert.strictEqual(E.sureDoldu(t).hukmen, false);
  assert.strictEqual(E.sureDoldu(t).hukmen, false);
  E.turDevret(t, 0, { current: 1, turn: 1, settled: kule(), players: oyuncular(10, 0) });
  assert.strictEqual(t.zamanAsimi, 0, 'devirde aşım sayacı sıfırlanmalı');
  E.sureDoldu(t); E.sureDoldu(t);
  const son = E.sureDoldu(t);
  assert.ok(son.hukmen && t.status === 'finished' && t.loser === 1 && t.winner === 0, 'üçüncü aşımda hükmen mağlubiyet');
  console.log('  ✓ 5) süre aşımı: üçüncü ardışıkta hükmen mağlubiyet, devirde sıfırlanıyor');

  // 6) PES ve GÖRÜNÜM
  const p = E.macBaslat({ seats: [0, 1] });
  E.turDevret(p, 0, { current: 1, turn: 1, settled: kule(), players: oyuncular(50, 20) });
  const gA = E.gorunum(p, 0, { turnRemainingMs: 1000 });
  assert.strictEqual(gA.kind, 'cenga'); assert.strictEqual(gA.seat, 0);
  assert.strictEqual(gA.settled.length, 54); assert.strictEqual(gA.turnRemainingMs, 1000);
  assert.strictEqual(E.gorunum(p, null).seat, null, 'izleyici koltuğu null');
  E.pesEt(p, 1);
  assert.ok(p.status === 'finished' && p.winner === 0 && p.result.reason === 'resign', 'pes eden kaybeder');
  console.log('  ✓ 6) görünüm kule/skor taşıyor, pes eden kaybediyor');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 7) HAZIR MASALAR
  const masalar = await httpRooms(BASE, 'cenga');
  assert.strictEqual(masalar.length, 10, 'cenga 10 hazır masa açmalı');
  assert.ok(masalar.every(m => m.maxPlayers === 2), 'masalar iki kişilik olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2201' && String(m.id) <= '2210'), 'masa kimlikleri 2201-2210');
  console.log('  ✓ 7) hazır masalar lobide: 10 masa, 2 kişilik');

  const oda = masalar[0];
  const rid = String(oda.id);
  const A = await connect(BASE, 'cg-A');
  const B = await connect(BASE, 'cg-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: rid, gameId: 'cenga', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA, pB] = await Promise.all(basladi);
  const c = rooms.get(rid).cenga;

  // 8) YALNIZ SIRASI OLAN KARE YOLLAR
  assert.strictEqual(pA.gameState.kind, 'cenga');
  assert.strictEqual(pA.gameState.seed, pB.gameState.seed, 'iki oyuncu aynı tohumla aynı kuleyi kurmalı');
  assert.deepStrictEqual(pA.gameState.seats, [0, 1]);
  const sSok = pA.seat === c.turn ? A : B;
  const dSok = sSok === A ? B : A;
  const kareGelen = kaydet(dSok, 'cengaNet');
  const sahteGelen = kaydet(sSok, 'cengaNet');
  dSok.emit('cengaNet', { t: 'f', ph: 'select', roomId: rid });          // sırası olmayan
  sSok.emit('cengaNet', { t: 'f', ph: 'pull', b: [[3, 0, 1, 0, 0, 0, 0, 1]], roomId: rid });
  const kare = await kareGelen.bekle(6000);
  assert.strictEqual(kare.ph, 'pull', 'sıradakinin karesi rakibe ulaşmalı');
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(sahteGelen.gelen.length, 0, 'sırası olmayanın karesi aktarılmamalı');
  console.log('  ✓ 8) yalnız sırası olan kare yolluyor, kareler rakibe ulaşıyor');

  // 9) SIRA DEVRİ
  const durumD = kaydet(dSok, 'gameStateUpdated');
  const devir = { t: 'turn', current: dSok === A ? 0 : 1, turn: 1, settled: kule(true), players: oyuncular(300, 0), stability: 0.9, roomId: rid };
  devir.current = c.seats.indexOf(dSok === A ? pA.seat : pB.seat);
  const devirGelen = kaydet(dSok, 'cengaNet');
  const bozukRed = once(sSok, 'cengaRejected', 6000);
  sSok.emit('cengaNet', Object.assign({}, devir, { settled: kule().slice(2) }));
  assert.strictEqual((await bozukRed).reason, 'gecersiz_tas', 'bozuk kule reddedilmeli');
  sSok.emit('cengaNet', devir);
  const dv = await devirGelen.bekle(6000);
  assert.strictEqual(dv.t, 'turn', 'devir paketi rakibe iletilmeli');
  assert.strictEqual(c.turn, dSok === A ? pA.seat : pB.seat, 'sıra sunucuda rakibe geçmeli');
  let gs = await durumD.bekle(6000);
  while (gs.gameState.tur !== 1) gs = await durumD.bekle(6000);
  assert.strictEqual(gs.gameState.settled.length, 54, 'durum paketi yerleşmiş kuleyi taşımalı');
  assert.strictEqual(gs.gameState.skor[sSok === A ? pA.seat : pB.seat], 300, 'puan durum paketinde');
  // eski sıra sahibi artık kare yollayamaz
  const eskiGelen = kaydet(dSok, 'cengaNet');
  sSok.emit('cengaNet', { t: 'f', ph: 'select', roomId: rid });
  await new Promise(r => setTimeout(r, 300));
  assert.strictEqual(eskiGelen.gelen.length, 0, 'sırasını devreden artık kare yollayamaz');
  console.log('  ✓ 9) sıra devri sunucuya yazıldı, rakibe iletildi, eski sahip susturuldu');

  // 10) BİTİŞ
  const bittiA = kaydet(A, 'gameEnded');
  const bittiB = kaydet(B, 'gameEnded');
  const yeniSira = dSok;   // sıra artık bu soketin
  const yeniSeat = yeniSira === A ? pA.seat : pB.seat;
  const hileli = once(yeniSira, 'cengaRejected', 6000);
  yeniSira.emit('cengaNet', { t: 'over', roomId: rid, info: { loser: 1 - c.seats.indexOf(yeniSeat), reason: 'balance' } });
  assert.strictEqual((await hileli).reason, 'gecersiz_tur', 'rakibi kaybettirme reddedilmeli');
  yeniSira.emit('cengaNet', { t: 'over', roomId: rid,
    info: { loser: c.seats.indexOf(yeniSeat), reason: 'balance', players: oyuncular(300, 120), turn: 1 } });
  const [sA, sB] = await Promise.all([bittiA.bekle(15000), bittiB.bekle(15000)]);
  assert.strictEqual(sA.gameState.status, 'finished', 'kule devrilince maç bitmeli');
  assert.strictEqual(sA.reason, 'kule_devrildi', 'bitiş nedeni kule devrilmesi olmalı');
  assert.strictEqual(sA.winnerSeat, sB.winnerSeat, 'iki pakette aynı kazanan');
  assert.notStrictEqual(sA.winnerSeat, yeniSeat, 'kuleyi deviren kazanamaz');
  assert.notStrictEqual(sA.youWon, sB.youWon, 'biri kazandı diğeri kaybetti');
  console.log('  ✓ 10) kule devrilince maç bitiyor, rakibi kaybettirme denemesi reddediliyor');

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/cenga:\{name:'Cenga'/.test(sayfa), 'oyun listesinde cenga olmalı');
  assert.ok(/js\/cenga-online\.js/.test(sayfa), 'istemci adaptörü sayfaya bağlanmalı');
  assert.ok(/\.cg3-wrap\{/.test(sayfa) && /\.cg3-frame\{/.test(sayfa), 'iframe stilleri olmalı');
  assert.ok(/#pg-room\.gv-fs \.cg3-wrap/.test(sayfa), 'tam ekranda alan doldurulmalı');
  assert.ok(/cenga:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'cenga'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/cenga:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');

  const istemci = oku('js/cenga-online.js');
  assert.ok(/kinds: \['cenga'\]/.test(istemci), 'adaptör cenga türünü karşılamalı');
  assert.ok(/assets\/oyunlar\/cenga3d\.html\?online=1/.test(istemci), 'referans oyun iframe ile açılmalı');
  assert.ok(/emit\('cengaNet'/.test(istemci), 'kareler sunucuya soketle iletilmeli');
  assert.ok(/e\.source !== frame\.contentWindow/.test(istemci), 'yalnız kendi iframe\'inden paket kabul edilmeli');
  assert.ok(/damga: function/.test(istemci), 'iframe maç boyunca yeniden yüklenmemeli (damga)');
  assert.ok(/gv:roomLeft/.test(istemci), 'odadan çıkınca temizlenmeli');

  const oyun = oku('assets/oyunlar/cenga3d.html');
  assert.ok(oyun.length > 500000, 'derlenmiş oyun (three.js + cannon-es) dosyada olmalı');
  assert.ok(/CENGA/.test(oyun) && /cenga3d/.test(oyun), 'oyun dosyası referans Cenga olmalı');
  assert.ok(/URLSearchParams/.test(oyun) && /gv-ses/.test(oyun), 'çevrimiçi mod ve site ses anahtarı bağlı olmalı');

  const sunucu = oku('server.js');
  assert.ok(/cenga: 2201/.test(sunucu), 'hazır masa taban kimliği tanımlı olmalı');
  assert.ok(/socket\.on\('cengaNet'/.test(sunucu), 'kare rölesi sunucuda olmalı');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'cenga'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/let STANDARD = \[[^\]]*'cenga'/.test(panel), 'kurucu panelinin listesinde olmalı');
  assert.ok(/cenga: 2201/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'cenga.jpg')), 'kapak görseli olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-cenga.py')), 'kapak üretim betiği olmalı');
  console.log('  ✓ 11) istemci, iframe oyunu, stiller, kurallar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK cenga: sunucu kaydı, kare rölesi, sıra devri, bitiş, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('CENGA HATASI:', e);
    process.exit(1);
  }
})();
