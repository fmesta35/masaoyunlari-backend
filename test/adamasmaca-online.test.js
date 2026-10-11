'use strict';
/* ============================================================================
 * ADAM ASMACA — MOTOR VE ONLINE AKIŞ
 * ============================================================================
 * Kullanıcı isteği: "Diğer Oyunlar klasöründeki oyunları bizim sitemize uygun
 * bir şekilde oynanabilir hale getir... Her biri farklı oyun motoru olacak
 * diğerlerindeki gibi."
 *
 * Prototip tek cihazda, iki kişinin sırayla ekranı devrettiği bir oyundu.
 * Burada kurallar SUNUCUYA taşındı: KELİME artık sunucuda saklanıyor ve
 * tahminciye yalnız MASKE gidiyor — yani istemciden kopyalanamıyor.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Kelime denetimi: uzunluk, Türkçe harf ve TDK sözlüğü; yanlış
 *        yazılan kelimeye "bunu mu demek istedin" önerisi.
 *     2) Rol kuralı: tahminci kelime seçemez, gizleyen harf tahmin edemez.
 *     3) Tahmin: doğru harf tüm geçtiği yerlerde açılır, yanlış harf can
 *        götürür, aynı harf iki kez denenemez.
 *     4) El sonu ve puanlama (çözen: 40+can×10, asan: 40+açılmayan×5),
 *        roller değişir, maç el sayısı dolunca biter.
 *     5) Süre aşımı: gizleyenin yerine sunucu kelime seçer, tahminci bir
 *        can kaybeder — kimse masadan atılmaz.
 *   ONLINE
 *     6) Hazır masalar lobide (2 kişilik, üç masa tipi).
 *     7) Oyun başlıyor; KELİME TAHMİNCİYE GİTMİYOR (gizlilik).
 *     8) Harf tahmini iki istemciye de yansıyor.
 *     9) Maç bitince iki tarafa da gameEnded gidiyor.
 *    10) İzleyici masayı görüyor ama kelimeyi göremiyor.
 *   ARAYÜZ
 *    11) İstemci adaptörü, stiller, kurallar metni ve kurucu paneli bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-asmaca-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../adamasmaca-engine.js');
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
  // 1) KELİME DENETİMİ
  assert.strictEqual(E.kelimeyiOlc('AB').reason, 'kelime_kisa', '2 harf kısa olmalı');
  assert.strictEqual(E.kelimeyiOlc('ABCDEFGHIJKLMNO').reason, 'kelime_uzun', '15 harf uzun olmalı');
  assert.strictEqual(E.kelimeyiOlc('KEL1ME').reason, 'gecersiz_harf', 'rakam kabul edilmemeli');
  assert.strictEqual(E.kelimeyiOlc('WXQ').reason, 'gecersiz_harf', 'Türkçe olmayan harf olmamalı');
  const yok = E.kelimeyiOlc('MARMALAT');
  assert.strictEqual(yok.reason, 'sozlukte_yok', 'sözlükte olmayan kelime reddedilmeli');
  assert.ok((yok.oneriler || []).includes('MARMELAT'), '"bunu mu demek istedin" önerisi gelmeli');
  assert.ok(E.kelimeyiOlc('kelebek').ok, 'küçük harf de kabul edilmeli');
  assert.strictEqual(E.kelimeyiOlc('kelebek').kelime, 'KELEBEK', 'kelime büyük harfe çevrilmeli');
  console.log('  ✓ 1) kelime denetimi: uzunluk, Türkçe harf, TDK sözlüğü ve öneri');

  // 2) ROL KURALI
  let st = E.macBaslat({ seats: [0, 1], elSayisi: 2 });
  assert.strictEqual(st.gizleyen, 0, 'ilk eli koltuk 0 gizler');
  assert.strictEqual(E.siradaki(st), 0, 'kelime fazında sıra gizleyende');
  assert.strictEqual(E.kelimeSec(st, 1, 'KELEBEK').reason, 'not_your_turn',
    'tahminci kelime seçememeli');
  assert.ok(E.kelimeSec(st, 0, 'KELEBEK').ok, 'gizleyen kelimeyi seçebilmeli');
  assert.strictEqual(st.faz, 'tahmin', 'kelime kilitlenince tahmin fazına geçilmeli');
  assert.strictEqual(E.siradaki(st), 1, 'tahmin fazında sıra tahmincide');
  assert.strictEqual(E.harfTahmin(st, 0, 'A').reason, 'not_your_turn',
    'gizleyen harf tahmin edememeli');
  assert.strictEqual(E.kelimeSec(st, 0, 'ELMA').reason, 'wrong_phase',
    'kelime kilitliyken yenisi seçilememeli');
  console.log('  ✓ 2) roller: tahminci kelime seçemez, gizleyen harf tahmin edemez');

  // 3) TAHMİN
  assert.deepStrictEqual(E.maske(st), [null, null, null, null, null, null, null],
    'başlangıçta hiçbir harf açık olmamalı');
  const k1 = E.harfTahmin(st, 1, 'E');
  assert.ok(k1.ok && k1.dogru, 'E harfi KELEBEK içinde olmalı');
  assert.deepStrictEqual(E.maske(st), [null, 'E', null, 'E', null, 'E', null],
    'doğru harf GEÇTİĞİ HER YERDE açılmalı');
  assert.strictEqual(E.harfTahmin(st, 1, 'E').reason, 'harf_denendi',
    'aynı harf iki kez denenememeli');
  const y1 = E.harfTahmin(st, 1, 'Z');
  assert.ok(y1.ok && !y1.dogru, 'Z harfi kelimede yok');
  assert.strictEqual(st.yanlis, 1, 'yanlış harf bir can götürmeli');
  assert.strictEqual(E.harfTahmin(st, 1, 'ş').reason, undefined,
    'küçük harf de kabul edilmeli (büyütülür)');
  console.log('  ✓ 3) tahmin: doğru harf hepsini açar, yanlış harf can götürür');

  // 4) EL SONU, PUAN ve ROL DEĞİŞİMİ
  st = E.macBaslat({ seats: [0, 1], elSayisi: 2 });
  E.kelimeSec(st, 0, 'ELMA');
  ['E', 'L', 'M'].forEach(h => E.harfTahmin(st, 1, h));
  const son = E.harfTahmin(st, 1, 'A');
  assert.ok(son.bitti && son.el, 'kelime çözülünce el bitmeli');
  assert.strictEqual(son.el.tahminciKazandi, true, 'tahminci kazanmalı');
  assert.strictEqual(son.el.puan, 40 + 6 * 10, 'hatasız çözümde 40 + 6 can × 10 puan');
  assert.strictEqual(st.skor[1], 100, 'puan tahminciye yazılmalı');
  assert.strictEqual(st.gizleyen, 1, 'el sonunda roller değişmeli');
  assert.strictEqual(st.el, 2, 'ikinci ele geçilmeli');
  assert.strictEqual(st.status, 'playing', 'maç henüz bitmemeli');

  // ikinci el: tahminci asılsın
  E.kelimeSec(st, 1, 'ZEYTİN');
  ['B', 'C', 'Ç', 'D', 'F', 'G'].forEach(h => E.harfTahmin(st, 0, h));
  assert.strictEqual(st.status, 'finished', 'el sayısı dolunca maç bitmeli');
  assert.strictEqual(st.sonEl.tahminciKazandi, false, '6 yanlışta gizleyen kazanır');
  assert.strictEqual(st.sonEl.puan, 40 + 6 * 5,
    'ZEYTİN 6 farklı harf, hiçbiri açılmadı: 40 + 6 × 5 puan');
  assert.strictEqual(st.winner, 1, 'toplam puanı yüksek olan kazanmalı');
  console.log('  ✓ 4) el sonu, puanlama, rol değişimi ve maç bitişi');

  // tek sayı verilse bile el sayısı ÇİFTe yuvarlanır (roller eşit dağılsın)
  assert.strictEqual(E.macBaslat({ seats: [0, 1], elSayisi: 3 }).elSayisi, 4,
    'tek el sayısı çifte yuvarlanmalı');

  // 5) SÜRE AŞIMI
  st = E.macBaslat({ seats: [0, 1], elSayisi: 2 });
  const oto = E.sureDoldu(st, tohumlu(7));
  assert.strictEqual(oto.tur, 'kelime', 'kelime fazında süre aşımı kelime seçtirir');
  assert.ok(oto.kelime && oto.kelime.length >= 3, 'sunucu sözlükten kelime seçmeli');
  assert.strictEqual(st.faz, 'tahmin', 'kelime seçilince tahmin fazına geçilmeli');
  assert.strictEqual(st.status, 'playing', 'süre aşımı kimseyi masadan atmamalı');
  const canOnce = st.maxYanlis - st.yanlis;
  const oto2 = E.sureDoldu(st, tohumlu(9));
  assert.strictEqual(oto2.tur, 'tahmin', 'tahmin fazında süre aşımı harf denetir');
  assert.strictEqual(st.maxYanlis - st.yanlis, canOnce - 1,
    'süresi dolan tahminci bir can kaybetmeli');
  console.log('  ✓ 5) süre aşımı: kelimeyi sunucu seçer, tahminci bir can kaybeder');

  // GİZLİLİK: motor görünümünde kelime yalnız gizleyene açık
  st = E.macBaslat({ seats: [0, 1], elSayisi: 2 });
  E.kelimeSec(st, 0, 'KELEBEK');
  assert.strictEqual(E.gorunum(st, 0).kelime, 'KELEBEK', 'gizleyen kendi kelimesini görür');
  assert.strictEqual(E.gorunum(st, 1).kelime, null, 'tahminci kelimeyi GÖREMEZ');
  assert.strictEqual(E.gorunum(st, null).kelime, null, 'izleyici kelimeyi GÖREMEZ');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const acik = [];

  // 6) HAZIR MASALAR
  const masalar = await httpRooms(BASE, 'adamasmaca');
  assert.strictEqual(masalar.length, 10, 'adam asmaca 10 hazır masa açmalı');
  assert.ok(masalar.every(m => m.maxPlayers === 2), 'masalar iki kişilik olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2001' && String(m.id) <= '2010'),
    'masa kimlikleri 2001-2010 aralığında olmalı');
  const tipler = new Set(masalar.map(m => m.duration));
  assert.deepStrictEqual([...tipler].sort((a, b) => a - b), [10, 15, 20],
    'üç masa tipi de olmalı (10/15/20 dk)');
  assert.ok(masalar.every(m => Number(m.moveSeconds) >= 45),
    'hamle süresi kelime seçmeye yetecek kadar olmalı');
  console.log('  ✓ 6) hazır masalar lobide: 10 masa, 2 kişilik, üç tip');

  const oda = masalar[0];
  const A = await connect(BASE, 'aa-A');
  const B = await connect(BASE, 'aa-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'adamasmaca', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA, pB] = await Promise.all(basladi);

  const durumA = kaydet(A, 'gameStateUpdated');
  const durumB = kaydet(B, 'gameStateUpdated');

  // 7) GİZLİLİK — kelime tahminciye gitmez
  const gizleyen = pA.gameState.gizleyen;
  const gSok = pA.seat === gizleyen ? A : B;
  const tSok = pA.seat === gizleyen ? B : A;
  const gDurum = pA.seat === gizleyen ? durumA : durumB;
  const tDurum = pA.seat === gizleyen ? durumB : durumA;
  assert.strictEqual(pA.gameState.kind, 'adamasmaca', 'masa paketi adam asmaca olmalı');
  assert.strictEqual(pA.gameState.faz, 'kelime', 'oyun kelime fazında başlamalı');
  assert.strictEqual(pB.gameState.gizleyen, gizleyen, 'iki istemci aynı gizleyeni görmeli');

  const kilit = once(tSok, 'adamasmacaWordLocked', 12000);
  gSok.emit('adamasmacaWord', { roomId: String(oda.id), kelime: 'KELEBEK', ipucu: 'Tırtılın dönüştüğü canlı' });
  const kp = await kilit;
  assert.strictEqual(kp.harfSayisi, 7, 'rakip yalnız harf sayısını öğrenmeli');
  assert.ok(!('kelime' in kp), 'kilit duyurusunda kelime OLMAMALI');

  let tg = await tDurum.bekle();
  while (tg.gameState.faz !== 'tahmin') tg = await tDurum.bekle();
  assert.strictEqual(tg.gameState.kelime, null, 'TAHMİNCİYE KELİME GÖNDERİLMEMELİ');
  assert.strictEqual(tg.gameState.harfSayisi, 7, 'tahminci harf sayısını görmeli');
  assert.strictEqual(tg.gameState.ipucu, 'Tırtılın dönüştüğü canlı', 'ipucu tahminciye gitmeli');
  let gg = await gDurum.bekle();
  while (gg.gameState.faz !== 'tahmin') gg = await gDurum.bekle();
  assert.strictEqual(gg.gameState.kelime, 'KELEBEK', 'gizleyen kendi kelimesini görmeli');
  console.log('  ✓ 7) oyun başladı, kelime SUNUCUDA kaldı — tahminciye gitmiyor');

  // 8) HARF TAHMİNİ iki tarafa da yansıyor
  const harfA = once(A, 'adamasmacaLetter', 12000);
  const harfB = once(B, 'adamasmacaLetter', 12000);
  tSok.emit('adamasmacaGuess', { roomId: String(oda.id), harf: 'E' });
  const [hA, hB] = await Promise.all([harfA, harfB]);
  assert.strictEqual(hA.harf, 'E', 'harf duyurusu A oyuncusuna gitmeli');
  assert.strictEqual(hB.dogru, true, 'E harfi KELEBEK içinde olmalı');
  let tg2 = await tDurum.bekle();
  while (!(tg2.gameState.maske || []).includes('E')) tg2 = await tDurum.bekle();
  assert.deepStrictEqual(tg2.gameState.maske, [null, 'E', null, 'E', null, 'E', null],
    'maske tahminciye açılmış hâliyle gitmeli');

  // sıra kuralı: gizleyen harf gönderemez
  const red = once(gSok, 'adamasmacaRejected', 8000);
  gSok.emit('adamasmacaGuess', { roomId: String(oda.id), harf: 'K' });
  assert.strictEqual((await red).reason, 'not_your_turn', 'gizleyenin tahmini reddedilmeli');
  console.log('  ✓ 8) harf tahmini iki istemciye de yansıyor, sıra kuralı sunucuda');

  // 9) MAÇ BİTİŞİ — kelimeyi tamamla, sonra ikinci eli de bitir
  const bittiA = kaydet(A, 'gameEnded');
  const bittiB = kaydet(B, 'gameEnded');
  for (const h of ['K', 'L', 'B']) {
    tSok.emit('adamasmacaGuess', { roomId: String(oda.id), harf: h });
    await new Promise(r => setTimeout(r, 90));
  }
  /* İkinci el: roller değişti, yeni gizleyen eski tahmincidir. */
  let yeni = await tDurum.bekle();
  while (yeni.gameState.faz !== 'kelime') yeni = await tDurum.bekle();
  const g2 = yeni.gameState.gizleyen;
  const gSok2 = pA.seat === g2 ? A : B;
  const tSok2 = pA.seat === g2 ? B : A;
  gSok2.emit('adamasmacaWord', { roomId: String(oda.id), kelime: 'ELMA' });
  await new Promise(r => setTimeout(r, 160));
  /* İkinci elde BİR yanlış: iki el de hatasız çözülürse puanlar eşitlenir
     ve maç berabere biter — kazananı sınamak için fark bırakıyoruz. */
  for (const h of ['Z', 'E', 'L', 'M', 'A']) {
    tSok2.emit('adamasmacaGuess', { roomId: String(oda.id), harf: h });
    await new Promise(r => setTimeout(r, 90));
  }
  const [sonA, sonB] = await Promise.all([bittiA.bekle(15000), bittiB.bekle(15000)]);
  assert.ok(sonA && sonB, 'iki oyuncuya da gameEnded gitmeli');
  assert.strictEqual(sonA.gameState.status, 'finished', 'maç bitmiş olmalı');
  assert.strictEqual(sonA.winnerSeat, sonB.winnerSeat, 'iki pakette aynı kazanan olmalı');
  assert.notStrictEqual(sonA.youWon, sonB.youWon, 'biri kazandı diğeri kaybetti');
  assert.ok(sonA.gameState.kelime, 'maç bitince kelime açılmalı');
  console.log('  ✓ 9) maç bitti, kazanan iki oyuncuya da doğru bildirildi');

  // 10) İZLEYİCİ
  {
    const oda2 = masalar[1];
    const C = await connect(BASE, 'aa-C'), D = await connect(BASE, 'aa-D');
    acik.push(C, D);
    for (const s of [C, D]) {
      s.emit('joinRoom', { roomId: String(oda2.id), gameId: 'adamasmaca', userName: s.userName,
        userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda2.durationMinutes });
      await once(s, 'joinedRoom');
    }
    const bas2 = [once(C, 'gameStarted', 12000), once(D, 'gameStarted', 12000)];
    [C, D].forEach(s => s.emit('setReady', { ready: true }));
    const [pC] = await Promise.all(bas2);
    const gC = pC.gameState.gizleyen === pC.seat ? C : D;
    gC.emit('adamasmacaWord', { roomId: String(oda2.id), kelime: 'ZEYTİN' });
    await new Promise(r => setTimeout(r, 200));

    const Z = await connect(BASE, 'aa-izleyici');
    acik.push(Z);
    const izBasladi = once(Z, 'gameStarted', 12000);
    Z.emit('joinRoom', { roomId: String(oda2.id), gameId: 'adamasmaca', userName: 'aa-izleyici',
      userKey: 'test:aa-izleyici', spectate: true, maxPlayers: 2 });
    await once(Z, 'joinedRoom');
    const iz = await izBasladi;
    assert.strictEqual(iz.gameState.kind, 'adamasmaca', 'izleyiciye masa gitmeli');
    assert.strictEqual(iz.gameState.seat, null, 'izleyicinin koltuğu olmamalı');
    assert.strictEqual(iz.gameState.kelime, null, 'İZLEYİCİ KELİMEYİ GÖREMEMELİ');
    assert.strictEqual(iz.gameState.harfSayisi, 6, 'izleyici harf sayısını görebilmeli');
    console.log('  ✓ 10) izleyici masayı görüyor ama kelimeyi göremiyor');
  }

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/adamasmaca:\{name:'Adam Asmaca'/.test(sayfa), 'oyun listesinde adam asmaca olmalı');
  assert.ok(/js\/adamasmaca-online\.js/.test(sayfa), 'istemci adaptörü sayfaya bağlanmalı');
  assert.ok(/\.aa-wrap\{/.test(sayfa), 'adam asmaca stilleri olmalı');
  assert.ok(/adamasmaca:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'adamasmaca'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/adamasmaca:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');

  const istemci = oku('js/adamasmaca-online.js');
  assert.ok(/kinds: \['adamasmaca'\]/.test(istemci), 'adaptör adam asmaca türünü karşılamalı');
  assert.ok(/--aa-kutu/.test(istemci), 'harf kutusu ölçülen alana göre verilmeli (mobil uyum)');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');
  assert.ok(/gv-arena-clock/.test(istemci), 'hamle süresi tahtada görünmeli');
  assert.ok(/aa-oyun'\)[\s\S]*?classList\.toggle\('dar'/.test(istemci),
    'dar ekranda düzen alt alta geçmeli');

  const sunucu = oku('server.js');
  assert.ok(/adamasmaca: 2001/.test(sunucu), 'hazır masa taban kimliği tanımlı olmalı');
  assert.ok(/socket\.on\('adamasmacaWord'/.test(sunucu), 'kelime olayı sunucuda olmalı');
  assert.ok(/socket\.on\('adamasmacaGuess'/.test(sunucu), 'tahmin olayı sunucuda olmalı');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'adamasmaca'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/let STANDARD = \[[^\]]*'adamasmaca'/.test(panel),
    'kurucu panelinin yedek listesinde de olmalı');
  assert.ok(/adamasmaca: 2001/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'adamasmaca.jpg')),
    'kapak görseli olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-adamasmaca.py')),
    'kapak üretim betiği olmalı');
  console.log('  ✓ 11) istemci, stiller, kurallar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK adam asmaca: motor, gizlilik, online akış, hazır masalar, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('ADAM ASMACA HATASI:', e);
    process.exit(1);
  }
})();
