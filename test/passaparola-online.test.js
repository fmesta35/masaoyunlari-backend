'use strict';
/* ============================================================================
 * PASSAPAROLA — MOTOR VE ONLINE AKIŞ
 * ============================================================================
 * Kullanıcı isteği: "Diğer Oyunlar klasöründeki oyunları bizim sitemize uygun
 * bir şekilde oynanabilir hale getir... Her biri farklı oyun motoru olacak."
 *
 * Prototip tek cihazda, iki kişinin aynı ekranı devrettiği bir yarışmaydı ve
 * bütün sorular/cevaplar tarayıcıdaydı. Burada SORU HAVUZU VE DOĞRU CEVAPLAR
 * SUNUCUYA taşındı; istemci yalnız soruyu ve maskeyi görüyor. İki oyuncunun
 * ayrı saati de sunucuda işliyor.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Soru havuzu yüklendi; her sette 27 harfin tamamı var.
 *     2) Cevap karşılaştırma Türkçeye duyarlı ve hoşgörülü (büyük/küçük,
 *        şapka, boşluk, noktalama).
 *     3) DOĞRU → sıra oyuncuda kalır; YANLIŞ ve PAS → sıra rakibe geçer.
 *     4) Pas geçilen harfe, cevaplanmamış harf kalmayınca dönülür.
 *     5) Harf al: bir harf açar ve 5 saniye yakar.
 *     6) Saat yalnız SIRASI OLANIN aleyhine işler; biterse sıra geçer,
 *        ikisi de oynayamazsa maç biter ve doğru sayısına göre kazanan çıkar.
 *   ONLINE
 *     7) Hazır masalar lobide (10 masa, 2 kişilik, üç tip).
 *     8) Oyun başlıyor; DOĞRU CEVAP İSTEMCİYE GİTMİYOR.
 *     9) Cevap/pas iki istemciye de yansıyor, sıra kuralı sunucuda.
 *    10) İzleyici masayı görüyor ama cevabı göremiyor.
 *   ARAYÜZ
 *    11) İstemci adaptörü, stiller, kurallar metni, panel ve kapak bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-passaparola-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../passaparola-engine.js');
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
/* Motorun o anki sorusunun doğru cevabı (yalnız TEST bilir — istemci bilmez). */
function dogruCevap(st) {
  const q = E.aktifSoru(st, st.turn);
  return q ? q.answer : '';
}

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  // 1) SORU HAVUZU
  const setler = E.setleriYukle();
  assert.ok(setler.length >= 3, 'en az üç soru seti olmalı — bulunan: ' + setler.length);
  setler.forEach(s => {
    const harfler = s.questions.map(q => q.letter);
    E.HARFLER.forEach(h => assert.ok(harfler.includes(h),
      s.name + ' setinde ' + h + ' harfinin sorusu eksik'));
    s.questions.forEach(q => {
      assert.ok(q.question && q.question.length > 10, 'soru metni olmalı');
      assert.ok(q.answer && q.answer.length >= 2, 'cevap olmalı');
    });
  });
  assert.strictEqual(E.HARFLER.length, 27, 'çark 27 harf olmalı (J yok)');
  console.log('  ✓ 1) soru havuzu yüklendi, her sette 27 harfin sorusu var');

  // 2) CEVAP KARŞILAŞTIRMA
  assert.ok(E.cevapDogruMu('ankara', 'Ankara'), 'küçük harf kabul edilmeli');
  assert.ok(E.cevapDogruMu('  ANKARA ', 'Ankara'), 'baştaki/sondaki boşluk yok sayılmalı');
  assert.ok(E.cevapDogruMu('İSTANBUL', 'istanbul'), 'Türkçe büyük/küçük doğru eşleşmeli');
  assert.ok(E.cevapDogruMu('kahve altı', 'Kahvaltı') === false, 'farklı kelime kabul edilmemeli');
  assert.ok(E.cevapDogruMu('cep telefonu', 'Cep Telefonu'), 'boşluklu cevap eşleşmeli');
  assert.ok(E.cevapDogruMu('ceptelefonu', 'Cep Telefonu'), 'boşluksuz yazım da kabul edilmeli');
  assert.ok(!E.cevapDogruMu('', 'Ankara'), 'boş cevap doğru sayılmamalı');
  assert.ok(E.cevapDogruMu('elma', 'Armut', ['Elma']), 'alternatif cevap kabul edilmeli');
  console.log('  ✓ 2) cevap karşılaştırma Türkçeye duyarlı ve hoşgörülü');

  // 3) SIRA KURALI
  let st = E.macBaslat({ seats: [0, 1], setId: 1, sureSn: 60 });
  assert.strictEqual(st.turn, 0, 'ilk sıra koltuk 0');
  assert.strictEqual(E.aktifHarf(st, 0), 'A', 'çark A harfinden başlamalı');
  assert.strictEqual(E.cevapla(st, 1, 'ankara').reason, 'not_your_turn',
    'sırası olmayan cevaplayamaz');
  let d = dogruCevap(st);
  assert.ok(E.cevapla(st, 0, d).dogru, 'doğru cevap kabul edilmeli');
  assert.strictEqual(st.turn, 0, 'DOĞRU cevapta sıra oyuncuda KALMALI');
  assert.strictEqual(E.aktifHarf(st, 0), 'B', 'çark sıradaki harfe geçmeli');
  const r = E.cevapla(st, 0, 'kesinlikle yanlış bir cevap');
  assert.strictEqual(r.dogru, false, 'yanlış cevap yanlış sayılmalı');
  assert.strictEqual(st.turn, 1, 'YANLIŞ cevapta sıra rakibe geçmeli');
  assert.strictEqual(st.durum[0]['A'], 'dogru', 'A harfi yeşil olmalı');
  assert.strictEqual(st.durum[0]['B'], 'yanlis', 'B harfi kırmızı olmalı');
  assert.ok(E.pas(st, 1).ok, 'rakip pas geçebilmeli');
  assert.strictEqual(st.turn, 0, 'PAS sırayı rakibe geçirmeli');
  assert.strictEqual(st.durum[1]['A'], 'pas', 'pas geçilen harf mavi olmalı');
  console.log('  ✓ 3) doğru → sıra kalır, yanlış ve pas → sıra geçer');

  // 4) PAS GEÇİLEN HARFE DÖNÜŞ
  st = E.macBaslat({ seats: [0, 1], setId: 1, sureSn: 600 });
  E.pas(st, 0);                                   // A pas
  st.turn = 0;                                    // sırayı geri al (test kolaylığı)
  assert.strictEqual(E.aktifHarf(st, 0), 'B', 'pastan sonra sıradaki harfe geçilmeli');
  /* A dışındaki 26 harfi yanlış cevapla → geriye yalnız pas geçilen A kalır. */
  for (let i = 0; i < 26; i++) {
    st.turn = 0;
    E.cevapla(st, 0, '___yanlış___');
  }
  st.turn = 0;
  assert.strictEqual(E.aktifHarf(st, 0), 'A',
    'cevaplanmamış harf kalmayınca pas geçilen harfe DÖNÜLMELİ');
  console.log('  ✓ 4) cevaplanmamış harf bitince pas geçilen harflere dönülüyor');

  // 5) HARF AL
  st = E.macBaslat({ seats: [0, 1], setId: 1, sureSn: 60 });
  const maskeOnce = E.cevapMaskesi(st, 0).filter(x => x).length;
  const ha = E.harfAl(st, 0, () => 0);
  assert.ok(ha.ok, 'harf al çalışmalı');
  assert.strictEqual(st.saat[0], 55, 'harf al 5 saniye yakmalı');
  assert.strictEqual(E.cevapMaskesi(st, 0).filter(x => x).length, maskeOnce + 1,
    'bir harf daha açılmalı');
  assert.strictEqual(E.harfAl(st, 1, () => 0).reason, 'not_your_turn',
    'sırası olmayan harf alamaz');
  st.saat[0] = 4;
  assert.strictEqual(E.harfAl(st, 0, () => 0).reason, 'sure_yetmez',
    '5 saniyeden az kalan harf alamaz');
  console.log('  ✓ 5) harf al bir harf açıyor ve 5 saniye yakıyor');

  // 6) SAAT ve BİTİŞ
  st = E.macBaslat({ seats: [0, 1], setId: 1, sureSn: 10 });
  E.tik(st, 3);
  assert.strictEqual(st.saat[0], 7, 'yalnız sırası olanın saati işlemeli');
  assert.strictEqual(st.saat[1], 10, 'sırası olmayanın saati DURMALI');
  const t = E.tik(st, 7);
  assert.ok(t.sureBitti, 'saat bitince bildirilmeli');
  assert.strictEqual(st.turn, 1, 'saati biten oyuncudan sıra geçmeli');
  assert.strictEqual(st.status, 'playing', 'rakip oynayabildiği sürece maç sürmeli');
  /* Koltuk 1 bir doğru yapsın, sonra onun da saati bitsin → maç biter. */
  E.cevapla(st, 1, dogruCevap(st));
  E.tik(st, 10);
  assert.strictEqual(st.status, 'finished', 'iki saat de bitince maç bitmeli');
  assert.strictEqual(st.winner, 1, 'çok doğru yapan kazanmalı');
  assert.strictEqual(st.result.dogru[1], 1, 'kazananın doğru sayısı yazılmalı');

  /* Beraberlik: doğru sayıları eşitse saati çok kalan kazanır. */
  const b = E.macBaslat({ seats: [0, 1], setId: 1, sureSn: 30 });
  b.saat[0] = 0; b.saat[1] = 12;
  E.macBitir(b, 'finished');
  assert.strictEqual(b.winner, 1, 'doğru eşitken saati çok kalan kazanmalı');
  assert.strictEqual(b.result.sureFarki, true, 'sonuç "süre farkı" diye işaretlenmeli');
  console.log('  ✓ 6) saat yalnız sırası olanda işliyor, bitiş ve beraberlik kuralı doğru');

  // GİZLİLİK
  st = E.macBaslat({ seats: [0, 1], setId: 1, sureSn: 60 });
  const g0 = E.gorunum(st, 0);
  assert.strictEqual(g0.cevap, null, 'OYUNCUYA DOĞRU CEVAP GÖNDERİLMEMELİ');
  assert.ok(g0.soru && g0.soru.length > 10, 'soru metni gitmeli');
  assert.ok(g0.harfSayisi > 0, 'cevabın harf sayısı gitmeli');
  assert.ok(!JSON.stringify(g0).includes('"answer"'), 'görünümde ham soru nesnesi olmamalı');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 7) HAZIR MASALAR
  const masalar = await httpRooms(BASE, 'passaparola');
  assert.strictEqual(masalar.length, 10, 'passaparola 10 hazır masa açmalı');
  assert.ok(masalar.every(m => m.maxPlayers === 2), 'masalar iki kişilik olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2101' && String(m.id) <= '2110'),
    'masa kimlikleri 2101-2110 aralığında olmalı');
  const sureler = new Set(masalar.map(m => m.duration));
  assert.deepStrictEqual([...sureler].sort((a, b) => a - b), [10, 15, 20], 'üç masa tipi olmalı');
  console.log('  ✓ 7) hazır masalar lobide: 10 masa, 2 kişilik, üç tip');

  const oda = masalar[0];
  const A = await connect(BASE, 'pp-A');
  const B = await connect(BASE, 'pp-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'passaparola', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA, pB] = await Promise.all(basladi);

  // 8) GİZLİLİK
  assert.strictEqual(pA.gameState.kind, 'passaparola', 'masa paketi passaparola olmalı');
  assert.strictEqual(pA.gameState.cevap, null, 'DOĞRU CEVAP İSTEMCİYE GİTMEMELİ');
  assert.ok(pA.gameState.soru && pA.gameState.soru.length > 10, 'soru metni gitmeli');
  assert.strictEqual(pA.gameState.setAdi, pB.gameState.setAdi, 'iki oyuncu AYNI seti oynamalı');
  assert.strictEqual(pA.gameState.harfler.length, 27, 'çark 27 harf olmalı');
  assert.strictEqual(pA.gameState.saat[0], pA.gameState.sureSn, 'saatler dolu başlamalı');
  const paket = JSON.stringify(pA.gameState);
  assert.ok(!paket.includes('"answer"'), 'pakette ham soru nesnesi olmamalı');
  console.log('  ✓ 8) oyun başladı, doğru cevap SUNUCUDA kaldı');

  const durumA = kaydet(A, 'gameStateUpdated');
  const durumB = kaydet(B, 'gameStateUpdated');
  const odaNes = rooms.get(String(oda.id));
  const q = odaNes.passaparola;

  // 9) CEVAP ve PAS
  const sira = q.turn;
  const sSok = pA.seat === sira ? A : B;
  const dSok = pA.seat === sira ? B : A;
  /* Sırası OLMAYAN cevaplayamaz. */
  const red = once(dSok, 'passaparolaRejected', 8000);
  dSok.emit('passaparolaAnswer', { roomId: String(oda.id), cevap: 'deneme' });
  assert.strictEqual((await red).reason, 'not_your_turn', 'sırası olmayanın cevabı reddedilmeli');

  const sonucA = once(A, 'passaparolaResult', 12000);
  const sonucB = once(B, 'passaparolaResult', 12000);
  const cevap = dogruCevap(q);
  sSok.emit('passaparolaAnswer', { roomId: String(oda.id), cevap: cevap });
  const [rA, rB] = await Promise.all([sonucA, sonucB]);
  assert.strictEqual(rA.dogru, true, 'doğru cevap doğru bildirilmeli');
  assert.strictEqual(rA.cevap, cevap, 'cevap olaydan sonra açıklanmalı');
  assert.strictEqual(rB.seat, sira, 'cevaplayan koltuk bildirilmeli');
  assert.strictEqual(q.turn, sira, 'doğru cevapta sıra aynı oyuncuda kalmalı');

  let gA = await durumA.bekle();
  while (gA.gameState.durum[sira][rA.harf] !== 'dogru') gA = await durumA.bekle();
  assert.strictEqual(gA.gameState.cevap, null, 'yeni soruda cevap yine gizli olmalı');

  /* PAS → sıra geçer. */
  const pasOlay = once(B, 'passaparolaPassed', 12000);
  sSok.emit('passaparolaPass', { roomId: String(oda.id) });
  await pasOlay;
  assert.notStrictEqual(q.turn, sira, 'pas sırayı rakibe geçirmeli');
  console.log('  ✓ 9) cevap ve pas iki istemciye yansıyor, sıra kuralı sunucuda');

  /* HARF AL: maske bir harf daha açılır, saat 5 sn yanar. */
  {
    const yeniSira = q.turn;
    const ySok = pA.seat === yeniSira ? A : B;
    const yDurum = pA.seat === yeniSira ? durumA : durumB;
    const saatOnce = q.saat[yeniSira];
    const acikOnce = E.cevapMaskesi(q, yeniSira).filter(x => x).length;
    ySok.emit('passaparolaReveal', { roomId: String(oda.id) });
    let g = await yDurum.bekle();
    for (let i = 0; i < 12 && g.gameState.maske.filter(x => x).length <= acikOnce; i++) {
      g = await yDurum.bekle();
    }
    assert.ok(g.gameState.maske.filter(x => x).length > acikOnce, 'harf al bir harf açmalı');
    assert.ok(q.saat[yeniSira] <= saatOnce - 5, 'harf al 5 saniye yakmalı');
  }

  // MAÇ BİTİŞİ: saatleri tüketerek bitir
  {
    const bittiA = kaydet(A, 'gameEnded');
    const bittiB = kaydet(B, 'gameEnded');
    q.saat[0] = 1; q.saat[1] = 1;
    const [sA, sB] = await Promise.all([bittiA.bekle(15000), bittiB.bekle(15000)]);
    assert.strictEqual(sA.gameState.status, 'finished', 'maç bitmeli');
    assert.strictEqual(sA.winnerSeat, sB.winnerSeat, 'iki pakette aynı kazanan olmalı');
    assert.ok(sA.gameState.result, 'sonuç özeti gitmeli');
  }

  // 10) İZLEYİCİ
  {
    const oda2 = masalar[1];
    const C = await connect(BASE, 'pp-C'), D = await connect(BASE, 'pp-D');
    acik.push(C, D);
    for (const s of [C, D]) {
      s.emit('joinRoom', { roomId: String(oda2.id), gameId: 'passaparola', userName: s.userName,
        userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda2.durationMinutes });
      await once(s, 'joinedRoom');
    }
    const bas2 = [once(C, 'gameStarted', 12000), once(D, 'gameStarted', 12000)];
    [C, D].forEach(s => s.emit('setReady', { ready: true }));
    await Promise.all(bas2);

    const Z = await connect(BASE, 'pp-izleyici');
    acik.push(Z);
    const izBasladi = once(Z, 'gameStarted', 12000);
    Z.emit('joinRoom', { roomId: String(oda2.id), gameId: 'passaparola', userName: 'pp-izleyici',
      userKey: 'test:pp-izleyici', spectate: true, maxPlayers: 2 });
    await once(Z, 'joinedRoom');
    const iz = await izBasladi;
    assert.strictEqual(iz.gameState.kind, 'passaparola', 'izleyiciye masa gitmeli');
    assert.strictEqual(iz.gameState.seat, null, 'izleyicinin koltuğu olmamalı');
    assert.strictEqual(iz.gameState.cevap, null, 'İZLEYİCİ CEVABI GÖREMEMELİ');
    assert.ok(iz.gameState.soru, 'izleyici soruyu görebilmeli');
    console.log('  ✓ 10) izleyici masayı görüyor ama cevabı göremiyor');
  }

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/passaparola:\{name:'Passaparola'/.test(sayfa), 'oyun listesinde passaparola olmalı');
  assert.ok(/js\/passaparola-online\.js/.test(sayfa), 'istemci adaptörü sayfaya bağlanmalı');
  assert.ok(/\.pp-wrap\{/.test(sayfa), 'passaparola stilleri olmalı');
  assert.ok(/passaparola:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'passaparola'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/passaparola:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');

  const istemci = oku('js/passaparola-online.js');
  assert.ok(/kinds: \['passaparola'\]/.test(istemci), 'adaptör passaparola türünü karşılamalı');
  assert.ok(/--pp-h/.test(istemci), 'harf kutusu ölçülen alana göre verilmeli (mobil uyum)');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');
  assert.ok(/classList\.toggle\('dar'/.test(istemci), 'dar ekranda çarklar alt alta geçmeli');
  /* Saat HTML damgasına GİRMEMELİ: her saniye yeniden çizim cevap kutusunu siler. */
  const damga = istemci.slice(istemci.indexOf('damga:'), istemci.indexOf('render:'));
  assert.ok(!/s\.saat/.test(damga), 'saat damgaya girmemeli (kutu her saniye silinmesin)');

  const sunucu = oku('server.js');
  assert.ok(/passaparola: 2101/.test(sunucu), 'hazır masa taban kimliği tanımlı olmalı');
  assert.ok(/socket\.on\('passaparolaAnswer'/.test(sunucu), 'cevap olayı sunucuda olmalı');
  assert.ok(/socket\.on\('passaparolaPass'/.test(sunucu), 'pas olayı sunucuda olmalı');
  assert.ok(/socket\.on\('passaparolaReveal'/.test(sunucu), 'harf al olayı sunucuda olmalı');
  assert.ok(/passaparolaClockTick\(room\); continue;/.test(sunucu),
    'passaparola kendi saat döngüsünü işletmeli');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'passaparola'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/let STANDARD = \[[^\]]*'passaparola'/.test(panel), 'kurucu panelinin listesinde olmalı');
  assert.ok(/passaparola: 2101/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'passaparola.jpg')), 'kapak görseli olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-passaparola.py')), 'kapak üretim betiği olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'passaparola-sorular.json')), 'soru havuzu dosyası olmalı');
  console.log('  ✓ 11) istemci, stiller, kurallar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK passaparola: motor, gizlilik, saat, online akış, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('PASSAPAROLA HATASI:', e);
    process.exit(1);
  }
})();
