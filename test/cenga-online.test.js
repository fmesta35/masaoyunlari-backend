'use strict';
/* ============================================================================
 * CENGA — MOTOR VE ONLINE AKIŞ
 * ============================================================================
 * Kullanıcı isteği: "Diğer Oyunlar klasöründeki oyunları bizim sitemize uygun
 * bir şekilde oynanabilir hale getir... Her biri farklı oyun motoru olacak."
 *
 * Prototip three.js + cannon-es ile 3B fizik kuruyor ve çekme göstergesini
 * 60 Hz'de istemcide işletiyordu. Kurallar (kule, denge analizi, puan) zaten
 * saf ve belirlenimciydi; onlar olduğu gibi sunucuya taşındı. Gerçek zamanlı
 * çekme göstergesi ağ üzerinden sunucu yetkili olamayacağı için GİZLİ HEDEF
 * yöntemine çevrildi: sunucu hedefi saklar, istemci yalnız bandı bilir.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Kule kuruluşu: 18 kat × 3 taş, katlar dönüşümlü eksende.
 *     2) Kilit kuralı: en üstteki tamamlanmış kattan ve üstünden taş
 *        çekilemez.
 *     3) Seçim GİZLİ HEDEF üretir ve hedef görünüme SIZMAZ.
 *     4) Band içi çekiş taşı çıkarır ve en üste koyar; band dışı kule devirir.
 *     5) Denge bozulursa taş çıksa bile kule devrilir.
 *     6) Puanlama: isabet, sıkılık, risk ve seri çarpanı.
 *     7) Süre aşımı: taş seçmediyse sunucu en güvenli taşı seçer.
 *     8) Kuleyi deviren KAYBEDER.
 *   ONLINE
 *     9) Hazır masalar lobide (10 masa, 2 kişilik).
 *    10) Oyun başlıyor; HEDEF İSTEMCİYE GİTMİYOR, sıra kuralı sunucuda.
 *    11) Çekiş iki istemciye de yansıyor; kule devrilince maç bitiyor.
 *   ARAYÜZ
 *    12) İstemci adaptörü, stiller, kurallar, panel ve kapak bağlı.
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

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  // 1) KULE KURULUŞU
  let st = E.macBaslat({ seats: [0, 1], rng: tohumlu(2024) });
  assert.strictEqual(st.izgara.length, 18, 'kule 18 kat olmalı');
  st.izgara.forEach((r, i) => {
    assert.strictEqual(r.length, 3, (i + 1) + '. katta 3 taş olmalı');
    assert.strictEqual(E.katSayisi(r), 3, 'başlangıçta her kat dolu olmalı');
  });
  const idler = st.izgara.flat();
  assert.strictEqual(new Set(idler).size, 54, '54 taşın kimliği benzersiz olmalı');
  assert.strictEqual(E.katEkseni(0), 'x', 'ilk kat x ekseninde');
  assert.strictEqual(E.katEkseni(1), 'z', 'katlar dönüşümlü eksende olmalı');
  assert.strictEqual(E.dengeYuzdesi(E.coz(st.izgara)), 1, 'dolu kule tam dengeli olmalı');
  console.log('  ✓ 1) kule 18 kat × 3 taş, katlar dönüşümlü eksende');

  // 2) KİLİT KURALI
  assert.strictEqual(E.enUstTamKat(st.izgara), 17, 'en üstteki tam kat 17 olmalı');
  assert.strictEqual(E.tasSec(st, 0, 17, 0).reason, 'kat_kilitli',
    'en üstteki tamamlanmış kattan taş çekilememeli');
  assert.strictEqual(E.tasSec(st, 1, 5, 0).reason, 'not_your_turn', 'sırası olmayan seçemez');
  assert.strictEqual(E.tasSec(st, 0, 99, 0).reason, 'gecersiz_tas', 'olmayan kat reddedilmeli');
  console.log('  ✓ 2) en üstteki tamamlanmış kat ve üstü kilitli');

  // 3) GİZLİ HEDEF
  const sec = E.tasSec(st, 0, 5, 1);
  assert.ok(sec.ok, 'alt kattan taş seçilebilmeli');
  assert.strictEqual(sec.hedef, undefined, 'SEÇİM YANITINDA HEDEF OLMAMALI');
  assert.ok(sec.bant > 0 && sec.bant <= 0.30, 'tolerans bandı makul olmalı');
  assert.ok(st.secim.hedef > 0 && st.secim.hedef < 1, 'motorda gizli hedef tutulmalı');
  const g = E.gorunum(st, 0);
  assert.strictEqual(g.secim.hedef, null, 'OYUNCU GÖRÜNÜMÜNDE HEDEF OLMAMALI');
  assert.strictEqual(g.secim.bant, st.secim.bant, 'band istemciye bildirilmeli');
  assert.strictEqual(E.gorunum(st, null).secim.hedef, null, 'izleyici de hedefi görmemeli');
  assert.strictEqual(st.faz, 'cekis', 'seçimden sonra çekiş fazına geçilmeli');
  console.log('  ✓ 3) seçim gizli hedef üretiyor, hedef görünüme sızmıyor');

  // 4) BAND İÇİ ÇEKİŞ
  const idOnce = st.izgara[5][1];
  const r = E.tasCek(st, 0, st.secim.hedef);
  assert.ok(r.basarili && !r.devrildi, 'tam isabette taş temiz çıkmalı');
  assert.strictEqual(r.isabet, 1, 'tam ortada isabet 1 olmalı');
  assert.strictEqual(st.izgara[5][1], -1, 'taş kuleden çıkmalı');
  assert.strictEqual(st.izgara[r.yerlestirildi.kat][r.yerlestirildi.slot], idOnce,
    'çekilen taş en üste konmalı');
  assert.strictEqual(r.yerlestirildi.kat, 18, 'üst kat doluyken yeni kat açılmalı');
  assert.strictEqual(r.yerlestirildi.slot, 1, 'yeni kat ORTA slottan başlamalı');
  assert.strictEqual(st.turn, 1, 'çekişten sonra sıra rakibe geçmeli');
  assert.strictEqual(st.faz, 'secim', 'yeni sıra seçim fazında başlamalı');
  console.log('  ✓ 4) band içi çekiş taşı çıkarıp en üste koyuyor, sıra geçiyor');

  // 5) BAND DIŞI → KULE DEVRİLİR
  {
    const b = E.macBaslat({ seats: [0, 1], rng: tohumlu(77) });
    E.tasSec(b, 0, 4, 0);
    const disari = Math.min(1, b.secim.hedef + b.secim.bant + 0.02);
    const rr = E.tasCek(b, 0, disari);
    assert.strictEqual(rr.devrildi, true, 'band dışında kule devrilmeli');
    assert.strictEqual(b.status, 'finished', 'maç bitmeli');
    assert.strictEqual(b.result.neden, 'denge', 'sebep "taş zorlandı" olmalı');
    assert.strictEqual(b.winner, 1, 'kuleyi DEVİREN kaybetmeli');
    assert.strictEqual(b.result.kaybeden, 0, 'deviren oyuncu kaybeden olmalı');
    assert.strictEqual(E.tasSec(b, 1, 3, 0).reason, 'game_over', 'bitmiş maçta hamle olmaz');
  }
  console.log('  ✓ 5) band dışı çekişte kule devriliyor, deviren kaybediyor');

  // 6) DENGE BOZULURSA TAŞ ÇIKSA BİLE DEVRİLİR
  {
    const b = E.macBaslat({ seats: [0, 1], rng: tohumlu(5) });
    /* 3. katı tek taşa indirince üstündeki yığın taşınamaz hâle gelir. */
    b.izgara[3][0] = -1; b.izgara[3][2] = -1;
    const a = E.coz(b.izgara, b.izgara[3][1]);
    assert.strictEqual(a.dengeli, false, 'son taşı da çekmek dengeyi bozmalı');
    E.tasSec(b, 0, 3, 1);
    const rr = E.tasCek(b, 0, b.secim.hedef);
    assert.strictEqual(rr.basarili, true, 'taş temiz çıkmış olmalı');
    assert.strictEqual(rr.devrildi, true, 'ama kule yeni yüküyle devrilmeli');
    assert.strictEqual(b.result.neden, 'yapi', 'sebep yapısal olmalı');
  }
  console.log('  ✓ 6) denge bozulursa taş temiz çıksa bile kule devriliyor');

  // 7) PUANLAMA ve SERİ
  {
    const b = E.macBaslat({ seats: [0, 1], rng: tohumlu(31) });
    E.tasSec(b, 0, 2, 1);
    const r1 = E.tasCek(b, 0, b.secim.hedef);
    assert.ok(r1.puan > 100, 'temiz çekiş 100 puandan fazla getirmeli');
    assert.strictEqual(r1.kademe, 2, 'tam isabet en yüksek kademe olmalı');
    assert.strictEqual(b.seri[0], 1, 'seri başlamalı');
    assert.strictEqual(b.skor[0], r1.puan, 'puan oyuncuya yazılmalı');
    /* İkinci tam isabet seriyi büyütür ve çarpan devreye girer. */
    E.tasSec(b, 1, 3, 0); E.tasCek(b, 1, b.secim.hedef);
    E.tasSec(b, 0, 4, 2);
    const r2 = E.tasCek(b, 0, b.secim.hedef);
    assert.strictEqual(b.seri[0], 2, 'üst üste iyi çekiş seriyi büyütmeli');
    assert.ok(r2.carpan > 1, 'seri çarpanı devreye girmeli');
    /* Band kenarına yakın çekiş düşük kademe ve seriyi sıfırlar. */
    E.tasSec(b, 1, 5, 1); E.tasCek(b, 1, b.secim.hedef);
    E.tasSec(b, 0, 6, 0);
    const kenar = b.secim.hedef + b.secim.bant * 0.95;
    const r3 = E.tasCek(b, 0, Math.min(1, kenar));
    if (r3.basarili && !r3.devrildi) {
      assert.strictEqual(r3.kademe, 0, 'band kenarında kademe düşmeli');
      assert.strictEqual(b.seri[0], 0, 'kötü çekiş seriyi sıfırlamalı');
    }
  }
  console.log('  ✓ 7) puanlama isabet/sıkılık/riske göre, seri çarpanı çalışıyor');

  // 8) SÜRE AŞIMI
  {
    const b = E.macBaslat({ seats: [0, 1], rng: tohumlu(99) });
    const r1 = E.sureDoldu(b);
    assert.strictEqual(r1.tur, 'secim', 'seçim fazında süre aşımı taş seçtirmeli');
    assert.ok(r1.secim.ok, 'sunucu geçerli bir taş seçmeli');
    assert.strictEqual(b.faz, 'cekis', 'çekiş fazına geçilmeli');
    assert.strictEqual(b.status, 'playing', 'süre aşımı kimseyi masadan atmamalı');
    const guvenli = E.enGuvenliTas(b);
    assert.ok(guvenli && guvenli.kat < E.enUstTamKat(b.izgara),
      'seçilen taş kilitli katın altından olmalı');
    const r2 = E.sureDoldu(b);
    assert.strictEqual(r2.tur, 'cekis', 'çekiş fazında süre aşımı el kaydırmalı');
    assert.ok(r2.sonuc && r2.sonuc.ok, 'çekiş işlenmeli');
  }
  console.log('  ✓ 8) süre aşımında sunucu en güvenli taşı seçiyor, kimse atılmıyor');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 9) HAZIR MASALAR
  const masalar = await httpRooms(BASE, 'cenga');
  assert.strictEqual(masalar.length, 10, 'cenga 10 hazır masa açmalı');
  assert.ok(masalar.every(m => m.maxPlayers === 2), 'masalar iki kişilik olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2201' && String(m.id) <= '2210'),
    'masa kimlikleri 2201-2210 aralığında olmalı');
  console.log('  ✓ 9) hazır masalar lobide: 10 masa, 2 kişilik');

  const oda = masalar[0];
  const A = await connect(BASE, 'cg-A');
  const B = await connect(BASE, 'cg-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'cenga', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA] = await Promise.all(basladi);

  const durumA = kaydet(A, 'gameStateUpdated');
  const durumB = kaydet(B, 'gameStateUpdated');
  const odaNes = rooms.get(String(oda.id));
  const c = odaNes.cenga;

  // 10) GİZLİLİK ve SIRA
  assert.strictEqual(pA.gameState.kind, 'cenga', 'masa paketi cenga olmalı');
  assert.strictEqual(pA.gameState.izgara.length, 18, 'kule 18 kat gitmeli');
  assert.strictEqual(pA.gameState.faz, 'secim', 'oyun seçim fazında başlamalı');
  assert.strictEqual(pA.gameState.secim, null, 'başlangıçta seçim olmamalı');

  const sira = c.turn;
  const sSok = pA.seat === sira ? A : B;
  const dSok = pA.seat === sira ? B : A;
  const sDurum = pA.seat === sira ? durumA : durumB;

  const red = once(dSok, 'cengaRejected', 8000);
  dSok.emit('cengaSelect', { roomId: String(oda.id), kat: 4, slot: 1 });
  assert.strictEqual((await red).reason, 'not_your_turn', 'sırası olmayanın seçimi reddedilmeli');

  const red2 = once(sSok, 'cengaRejected', 8000);
  sSok.emit('cengaSelect', { roomId: String(oda.id), kat: 17, slot: 0 });
  assert.strictEqual((await red2).reason, 'kat_kilitli', 'kilitli kat sunucuda reddedilmeli');

  const secOlay = once(B, 'cengaSelected', 12000);
  sSok.emit('cengaSelect', { roomId: String(oda.id), kat: 6, slot: 1 });
  const so = await secOlay;
  assert.ok(so.bant > 0, 'tolerans bandı duyurulmalı');
  assert.strictEqual(so.hedef, undefined, 'SEÇİM DUYURUSUNDA HEDEF OLMAMALI');
  let gs = await sDurum.bekle();
  while (!gs.gameState.secim) gs = await sDurum.bekle();
  assert.strictEqual(gs.gameState.secim.hedef, null, 'DURUM PAKETİNDE HEDEF OLMAMALI');
  assert.ok(!JSON.stringify(gs.gameState).includes('"tohum"'), 'tohumlar pakete sızmamalı');
  assert.ok(!JSON.stringify(gs.gameState).includes('rngDurum'), 'rastgele durumu sızmamalı');
  console.log('  ✓ 10) oyun başladı, GİZLİ HEDEF istemciye gitmiyor, sıra kuralı sunucuda');

  // 11) ÇEKİŞ ve BİTİŞ
  const cekA = once(A, 'cengaPulled', 12000);
  const cekB = once(B, 'cengaPulled', 12000);
  sSok.emit('cengaPull', { roomId: String(oda.id), el: c.secim.hedef });
  const [cA, cB] = await Promise.all([cekA, cekB]);
  assert.strictEqual(cA.basarili, true, 'tam isabette çekiş başarılı olmalı');
  assert.strictEqual(cA.devrildi, false, 'kule ayakta kalmalı');
  assert.ok(cB.puan > 0, 'puan iki istemciye de bildirilmeli');
  assert.ok(cA.hedef >= 0 && cA.hedef <= 1, 'çekiş bitince hedef geri bildirim olarak açılmalı');
  assert.notStrictEqual(c.turn, sira, 'sıra rakibe geçmeli');

  /* Kuleyi band dışı bir çekişle devirip maçı bitir. */
  {
    const bittiA = kaydet(A, 'gameEnded');
    const bittiB = kaydet(B, 'gameEnded');
    const sira2 = c.turn;
    const s2 = pA.seat === sira2 ? A : B;
    s2.emit('cengaSelect', { roomId: String(oda.id), kat: 3, slot: 0 });
    await once(A, 'cengaSelected', 12000);
    s2.emit('cengaPull', { roomId: String(oda.id),
      el: Math.min(1, c.secim.hedef + c.secim.bant + 0.05) });
    const [sA, sB] = await Promise.all([bittiA.bekle(15000), bittiB.bekle(15000)]);
    assert.strictEqual(sA.gameState.status, 'finished', 'kule devrilince maç bitmeli');
    assert.strictEqual(sA.winnerSeat, sB.winnerSeat, 'iki pakette aynı kazanan olmalı');
    assert.notStrictEqual(sA.winnerSeat, sira2, 'kuleyi deviren kazanamaz');
    assert.notStrictEqual(sA.youWon, sB.youWon, 'biri kazandı diğeri kaybetti');
    assert.ok(sA.gameState.secim === null || sA.gameState.secim.hedef !== null,
      'maç bitince hedef açılabilir');
  }
  console.log('  ✓ 11) çekiş iki istemciye yansıyor, kule devrilince maç bitiyor');

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/cenga:\{name:'Cenga'/.test(sayfa), 'oyun listesinde cenga olmalı');
  assert.ok(/js\/cenga-online\.js/.test(sayfa), 'istemci adaptörü sayfaya bağlanmalı');
  assert.ok(/\.cg-kule\{/.test(sayfa), 'cenga stilleri olmalı');
  assert.ok(/cenga:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'cenga'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/cenga:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');

  const istemci = oku('js/cenga-online.js');
  assert.ok(/kinds: \['cenga'\]/.test(istemci), 'adaptör cenga türünü karşılamalı');
  assert.ok(/--cg-kat/.test(istemci), 'kat yüksekliği ölçülen alana göre verilmeli');
  assert.ok(/--cg-tas/.test(istemci), 'taş eni ölçülen alana göre verilmeli');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');
  assert.ok(/classList\.toggle\('dar'/.test(istemci), 'dar ekranda düzen alt alta geçmeli');
  /* İstemci hedefi HİÇ kullanmamalı: gizli hedefi okuyan bir satır olmamalı. */
  assert.ok(!/secim\.hedef/.test(istemci), 'istemci gizli hedefe dokunmamalı');

  const sunucu = oku('server.js');
  assert.ok(/cenga: 2201/.test(sunucu), 'hazır masa taban kimliği tanımlı olmalı');
  assert.ok(/socket\.on\('cengaSelect'/.test(sunucu), 'seçim olayı sunucuda olmalı');
  assert.ok(/socket\.on\('cengaPull'/.test(sunucu), 'çekiş olayı sunucuda olmalı');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'cenga'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/let STANDARD = \[[^\]]*'cenga'/.test(panel), 'kurucu panelinin listesinde olmalı');
  assert.ok(/cenga: 2201/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'cenga.jpg')), 'kapak görseli olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-cenga.py')), 'kapak üretim betiği olmalı');
  console.log('  ✓ 12) istemci, stiller, kurallar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK cenga: kule kuralları, gizli hedef, denge, online akış, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('CENGA HATASI:', e);
    process.exit(1);
  }
})();
