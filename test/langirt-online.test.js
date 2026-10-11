'use strict';
/* ============================================================================
 * LANGIRT — FİZİK MOTORU VE GERÇEK ZAMANLI ONLINE AKIŞ
 * ============================================================================
 * Kullanıcı isteği: "Diğer Oyunlar klasöründeki oyunları bizim sitemize uygun
 * bir şekilde oynanabilir hale getir... Her biri farklı oyun motoru olacak."
 *
 * Prototip (Next.js) fiziği TARAYICIDA, kare hızına bağlı olarak işletiyordu;
 * hızlı makinedeki oyuncu avantajlıydı ve top konumuna istemci karar
 * veriyordu. Burada fizik SUNUCUYA taşındı ve SABİT 50 Hz adımlarla işliyor;
 * istemci yalnız çubuk hedefi ve şut gönderiyor.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Saha ve çubuk tanımları prototiple aynı; maç geri sayımla başlıyor.
 *     2) Fizik BELİRLENİMCİ: aynı girdi aynı sonucu veriyor (sabit adım).
 *     3) Çubuklar sınırları aşamıyor; hassas modda daha yavaş gidiyor.
 *     4) Şut yalnız topa yakın çubukla yapılabiliyor; güç hızı artırıyor.
 *     5) Gol sayılıyor, top ortaya dönüyor, hedef golde maç bitiyor.
 *     6) Top kale ağzı dışında yan banttan sekiyor (gol sayılmıyor).
 *   ONLINE
 *     7) Hazır masalar lobide (10 masa, 2 kişilik) ve kimlikler başka
 *        oyunun aralığına ÇAKIŞMIYOR.
 *     8) Oyun başlıyor, sunucu kendiliğinden kare yayınlıyor (hamle yok).
 *     9) Çubuk hedefi gönderilince sahadaki çubuk gerçekten oynuyor —
 *        ve oyuncu YALNIZ KENDİ takımının çubuklarını oynatabiliyor.
 *    10) Hedef gole ulaşılınca iki oyuncuya da gameEnded gidiyor.
 *    11) İzleyici masayı görebiliyor.
 *   ARAYÜZ
 *    12) İstemci adaptörü, stiller, kurallar, panel ve kapak bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-langirt-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../langirt-engine.js');
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
async function httpRooms(base, gameId) {
  const r = await fetch(base + '/api/rooms?gameId=' + gameId);
  const j = await r.json();
  return j.rooms || j;
}
/* Geri sayımı bitirip oyun fazına geç. */
function oyunaGec(st) {
  /* Geri sayım 2,35 sn; golden sonra ayrıca 1,35 sn ara var — 300 adım
     (6 sn) ikisini de rahat geçer. */
  for (let i = 0; i < 300 && st.faz !== 'oyun'; i++) E.adim(st, 0.02, {});
  return st;
}

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  // 1) SAHA ve BAŞLANGIÇ
  let st = E.macBaslat({ seats: [0, 1], hedefGol: 3 });
  assert.strictEqual(E.SAHA_EN, 1000, 'saha eni 1000 birim olmalı');
  assert.strictEqual(E.SAHA_BOY, 600, 'saha boyu 600 birim olmalı');
  assert.strictEqual(E.CUBUKLAR.kirmizi.length, 4, 'her takımda 4 çubuk olmalı');
  assert.strictEqual(E.CUBUKLAR.mavi.length, 4, 'her takımda 4 çubuk olmalı');
  assert.deepStrictEqual(E.CUBUKLAR.kirmizi.map(c => c.adet), [1, 2, 5, 3],
    'kırmızı çubuk dizilimi prototiple aynı olmalı');
  assert.deepStrictEqual(E.CUBUKLAR.mavi.map(c => c.adet), [1, 2, 5, 3],
    'mavi çubuk dizilimi prototiple aynı olmalı');
  assert.strictEqual(st.faz, 'gerisayim', 'maç geri sayımla başlamalı');
  assert.strictEqual(st.top.vx, 0, 'geri sayımda top durmalı');
  assert.strictEqual(E.tarafOf(0), 'kirmizi', 'koltuk 0 kırmızı olmalı');
  assert.strictEqual(E.tarafOf(1), 'mavi', 'koltuk 1 mavi olmalı');
  oyunaGec(st);
  assert.strictEqual(st.faz, 'oyun', 'geri sayım bitince oyun başlamalı');
  assert.notStrictEqual(st.top.vx, 0, 'başlama vuruşuyla top hareket etmeli');
  console.log('  ✓ 1) saha ve çubuklar prototiple aynı, maç geri sayımla başlıyor');

  // 2) BELİRLENİMCİLİK — aynı girdi aynı sonucu vermeli
  {
    const kontrol = { hedefY: { kirmizi: [250, 260, 270, 280], mavi: [330, 340, 350, 360] } };
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    const b = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    for (let i = 0; i < 500; i++) { E.adim(a, 0.02, kontrol); E.adim(b, 0.02, kontrol); }
    assert.deepStrictEqual(
      { x: a.top.x, y: a.top.y, s: a.skor },
      { x: b.top.x, y: b.top.y, s: b.skor },
      'sabit adımlı fizik iki çalıştırmada AYNI sonucu vermeli');
    /* Farklı adım boyu farklı sonuç verir — sunucunun sabit adım kullanması
       tam da bu yüzden gerekli (istemcide kare hızı değişkendir). */
    const c = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    for (let i = 0; i < 250; i++) E.adim(c, 0.04, kontrol);
    assert.notStrictEqual(Math.round(c.top.x), Math.round(a.top.x),
      'değişken adım farklı sonuç verir — bu yüzden fizik sunucuda sabit adımla işler');
  }
  console.log('  ✓ 2) fizik belirlenimci: sabit adımda aynı girdi aynı sonucu veriyor');

  // 3) ÇUBUK SINIRLARI ve HASSAS MOD
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    for (let i = 0; i < 100; i++) E.adim(a, 0.02, { hedefY: { kirmizi: [9999, -9999, 9999, -9999] } });
    E.CUBUKLAR.kirmizi.forEach(function (d, i) {
      assert.ok(a.cubuk.kirmizi[i] >= d.minY - 0.01 && a.cubuk.kirmizi[i] <= d.maxY + 0.01,
        i + '. çubuk sınırların dışına çıkamaz');
    });
    /* Hassas modda çubuk aynı sürede daha az yol alır. */
    const h = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    const n = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    const hedef = { kirmizi: [415, 420, 380, 405] };
    for (let i = 0; i < 5; i++) {
      E.adim(h, 0.02, { hedefY: hedef, hassas: { kirmizi: true } });
      E.adim(n, 0.02, { hedefY: hedef });
    }
    assert.ok(h.cubuk.kirmizi[0] < n.cubuk.kirmizi[0],
      'hassas modda çubuk daha yavaş gitmeli (nişan almak için)');
  }
  console.log('  ✓ 3) çubuklar sınırları aşmıyor, hassas mod daha yavaş');

  // 4) ŞUT
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 5 }));
    a.top.x = 820; a.top.y = 300; a.top.vx = 0; a.top.vy = 0;
    a.cubuk.kirmizi = [300, 300, 300, 300];
    assert.strictEqual(E.sut(a, 'kirmizi', { cubuk: 0, guc: 1, nisanY: 300 }).reason, 'top_uzak',
      'topa uzak çubukla şut atılamamalı');
    const r = E.sut(a, 'kirmizi', { cubuk: 3, guc: 1, nisanY: 300 });
    assert.ok(r.ok, 'topa yakın çubukla şut atılabilmeli');
    assert.ok(a.top.vx > 400, 'şut topu ileri fırlatmalı');
    /* Düşük güçle aynı şut daha yavaş olmalı. */
    const b = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 5 }));
    b.top.x = 820; b.top.y = 300; b.top.vx = 0; b.top.vy = 0;
    b.cubuk.kirmizi = [300, 300, 300, 300];
    const r2 = E.sut(b, 'kirmizi', { cubuk: 3, guc: 0, nisanY: 300 });
    assert.ok(r2.hiz < r.hiz, 'düşük güçte şut daha yavaş olmalı');
    /* Nişan yukarıdaysa top yukarı gitmeli. */
    const c = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 5 }));
    c.top.x = 820; c.top.y = 300; c.top.vx = 0; c.top.vy = 0;
    c.cubuk.kirmizi = [300, 300, 300, 300];
    E.sut(c, 'kirmizi', { cubuk: 3, guc: 1, nisanY: 140 });
    assert.ok(c.top.vy < 0, 'yukarı nişanda top yukarı gitmeli');
  }
  console.log('  ✓ 4) şut yalnız topa yakın çubukla, güç ve nişan etkili');

  // 5) GOL ve MAÇ BİTİŞİ
  {
    /* Hedef gol yalnız 3/5/7/10 olabilir (prototipteki kural); masalarımız
       3/5/7 kullanıyor. Burada en kısası seçildi. */
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    assert.strictEqual(a.hedefGol, 3, 'geçerli hedef gol korunmalı');
    assert.strictEqual(E.macBaslat({ seats: [0, 1], hedefGol: 4 }).hedefGol, 5,
      'geçersiz hedef gol varsayılana düşmeli');
    const golAt = () => {
      a.top.x = 870; a.top.y = 300; a.top.vx = 900; a.top.vy = 0;
      a.cubuk.mavi = [185, 180, 220, 195];
      a.hedefY.mavi = [185, 180, 220, 195];
      for (let i = 0; i < 60 && a.faz === 'oyun'; i++) {
        E.adim(a, 0.02, { hedefY: { mavi: [185, 180, 220, 195] } });
      }
    };
    golAt();
    assert.strictEqual(a.skor.kirmizi, 1, 'kale ağzından çıkan top gol olmalı');
    assert.strictEqual(a.faz, 'gol', 'golden sonra kısa bir ara olmalı');
    assert.strictEqual(a.top.x, 500, 'top ortaya dönmeli');
    /* Ara bitince yeniden geri sayım, sonra oyun. */
    for (let i = 0; i < 80 && a.faz !== 'gerisayim'; i++) E.adim(a, 0.02, {});
    assert.strictEqual(a.faz, 'gerisayim', 'ara bitince geri sayım gelmeli');
    oyunaGec(a); golAt();
    assert.strictEqual(a.skor.kirmizi, 2, 'ikinci gol de sayılmalı');
    assert.strictEqual(a.status, 'playing', 'hedefe varılmadan maç bitmemeli');
    oyunaGec(a); golAt();
    assert.strictEqual(a.skor.kirmizi, 3, 'üçüncü gol de sayılmalı');
    assert.strictEqual(a.status, 'finished', 'hedef gole ulaşınca maç bitmeli');
    assert.strictEqual(a.faz, 'bitti', 'faz bitti olmalı');
    assert.strictEqual(a.winner, 0, 'kırmızı (koltuk 0) kazanmalı');
  }
  console.log('  ✓ 5) gol sayılıyor, top ortaya dönüyor, hedef golde maç bitiyor');

  // 6) KALE AĞZI DIŞI = SEKME
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], hedefGol: 3 }));
    a.top.x = 870; a.top.y = 150; a.top.vx = 900; a.top.vy = 0;   // kale ağzının ÜSTÜ
    a.cubuk.mavi = [420, 420, 380, 405]; a.hedefY.mavi = [420, 420, 380, 405];
    for (let i = 0; i < 40; i++) E.adim(a, 0.02, { hedefY: { mavi: [420, 420, 380, 405] } });
    assert.strictEqual(a.skor.kirmizi, 0, 'kale ağzı dışından gol olmamalı');
    assert.ok(a.top.x <= E.SAHA.sag, 'top sahanın içinde kalmalı');
    assert.ok(a.top.vx < 0, 'top yan banttan geri sekmeli');
  }
  console.log('  ✓ 6) kale ağzı dışında top sekiyor, gol sayılmıyor');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 7) HAZIR MASALAR + ÇAKIŞMA DENETİMİ
  const masalar = await httpRooms(BASE, 'langirt');
  assert.strictEqual(masalar.length, 10, 'langırt 10 hazır masa açmalı');
  assert.ok(masalar.every(m => m.maxPlayers === 2), 'masalar iki kişilik olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2301' && String(m.id) <= '2310'),
    'masa kimlikleri 2301-2310 aralığında olmalı');
  /* ÇAKIŞMA: iki oyunun hazır masası AYNI kimliğe düşerse ikincisi hiç
     açılmaz (ya da özel oda yaratılamaz). Bütün lobi bir kez taranır. */
  {
    const tumIdler = new Map();
    const oyunlar = ['chess', 'tavla', 'okey', 'okey101', 'pisti', 'batak', 'dama',
      'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo', 'battleship',
      'kelimelik', 'tombala', 'adamasmaca', 'passaparola', 'cenga', 'langirt'];
    for (const g of oyunlar) {
      for (const m of await httpRooms(BASE, g)) {
        const id = String(m.id);
        assert.ok(!tumIdler.has(id),
          'masa kimliği çakışıyor: #' + id + ' hem ' + tumIdler.get(id) + ' hem ' + g);
        tumIdler.set(id, g);
      }
    }
  }
  console.log('  ✓ 7) hazır masalar lobide ve hiçbir masa kimliği çakışmıyor');

  const oda = masalar[0];
  const A = await connect(BASE, 'lg-A');
  const B = await connect(BASE, 'lg-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'langirt', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  const kareA = kaydet(A, 'langirtFrame');
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA, pB] = await Promise.all(basladi);

  // 8) SUNUCU KENDİLİĞİNDEN KARE YAYINLIYOR
  assert.strictEqual(pA.gameState.kind, 'langirt', 'masa paketi langırt olmalı');
  assert.strictEqual(pA.gameState.taraf, pA.seat === 0 ? 'kirmizi' : 'mavi',
    'oyuncuya kendi takımı bildirilmeli');
  assert.strictEqual(pB.gameState.hedefGol, pA.gameState.hedefGol, 'hedef gol ortak olmalı');
  const k1 = await kareA.bekle(8000);
  assert.ok(k1 && k1.top, 'sunucu kendiliğinden kare yayınlamalı (oyuncu hamlesi yok)');
  const sayac = kareA.gelen.length;
  await uyu(400);
  assert.ok(kareA.gelen.length > sayac, 'kareler akmaya devam etmeli');
  console.log('  ✓ 8) sunucu kendiliğinden kare yayınlıyor (gerçek zamanlı)');

  // 9) ÇUBUK HAREKETİ ve TAKIM SINIRI
  const odaNes = rooms.get(String(oda.id));
  const l = odaNes.langirt;
  {
    /* Geri sayım bitmeden çubuklar oynamaz (prototipteki kural): önce
       oyun fazını bekle. */
    for (let i = 0; i < 80 && l.st.faz !== 'oyun'; i++) await uyu(60);
    assert.strictEqual(l.st.faz, 'oyun', 'geri sayım bitip oyun başlamalı');
    const kirmiziSok = pA.seat === 0 ? A : B;
    const maviSok = pA.seat === 0 ? B : A;
    /* Kırmızı oyuncu kendi çubuklarını oynatır. */
    const onceY = l.st.cubuk.kirmizi[0];
    kirmiziSok.emit('langirtRods', { roomId: String(oda.id), hedefY: [410, 410, 375, 400] });
    await uyu(400);
    assert.notStrictEqual(Math.round(l.st.cubuk.kirmizi[0]), Math.round(onceY),
      'kendi çubuğu hareket etmeli');
    assert.ok(l.st.cubuk.kirmizi[0] > onceY, 'çubuk istenen yöne gitmeli');
    /* Mavi oyuncunun gönderdiği hedef KIRMIZI çubukları etkilememeli:
       sunucu koltuktan takımı kendisi bulur, istemci seçemez. */
    const kirmiziHedef = l.st.hedefY.kirmizi.slice();
    const maviOnce = l.st.cubuk.mavi[0];
    maviSok.emit('langirtRods', { roomId: String(oda.id), hedefY: [190, 185, 225, 200] });
    await uyu(350);
    assert.deepStrictEqual(l.st.hedefY.kirmizi, kirmiziHedef,
      'bir oyuncu RAKİBİN çubuklarını oynatamamalı');
    assert.notStrictEqual(Math.round(l.st.cubuk.mavi[0]), Math.round(maviOnce),
      'mavi kendi çubuğunu oynatabilmeli');
    /* Sınır dışı hedef kırpılmalı. */
    kirmiziSok.emit('langirtRods', { roomId: String(oda.id), hedefY: [99999, 99999, 99999, 99999] });
    await uyu(300);
    E.CUBUKLAR.kirmizi.forEach(function (d, i) {
      assert.ok(l.st.cubuk.kirmizi[i] <= d.maxY + 0.5, i + '. çubuk sınırı aşmamalı');
    });
  }
  console.log('  ✓ 9) çubuklar oynuyor; kimse rakibinin çubuğunu oynatamıyor');

  // 10) MAÇ BİTİŞİ
  {
    const bittiA = kaydet(A, 'gameEnded');
    const bittiB = kaydet(B, 'gameEnded');
    /* Hedef gole bir kala skoru ayarla, sonra topu kaleye yolla. */
    l.st.skor.kirmizi = l.st.hedefGol - 1;
    l.st.faz = 'oyun'; l.st.fazSn = 0;
    l.st.top.x = 880; l.st.top.y = 300; l.st.top.vx = 950; l.st.top.vy = 0;
    l.st.cubuk.mavi = [185, 180, 220, 195];
    l.st.hedefY.mavi = [185, 180, 220, 195];
    const [sA, sB] = await Promise.all([bittiA.bekle(15000), bittiB.bekle(15000)]);
    assert.strictEqual(sA.gameState.status, 'finished', 'hedef golde maç bitmeli');
    assert.strictEqual(sA.winnerSeat, 0, 'kırmızı kazanmalı');
    assert.strictEqual(sA.winnerSeat, sB.winnerSeat, 'iki pakette aynı kazanan olmalı');
    assert.notStrictEqual(sA.youWon, sB.youWon, 'biri kazandı diğeri kaybetti');
  }
  console.log('  ✓ 10) hedef gole ulaşılınca iki oyuncuya da bitiş gidiyor');

  // 11) İZLEYİCİ
  {
    const oda2 = masalar[1];
    const C = await connect(BASE, 'lg-C'), D = await connect(BASE, 'lg-D');
    acik.push(C, D);
    for (const s of [C, D]) {
      s.emit('joinRoom', { roomId: String(oda2.id), gameId: 'langirt', userName: s.userName,
        userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda2.durationMinutes });
      await once(s, 'joinedRoom');
    }
    const bas2 = [once(C, 'gameStarted', 12000), once(D, 'gameStarted', 12000)];
    [C, D].forEach(s => s.emit('setReady', { ready: true }));
    await Promise.all(bas2);

    const Z = await connect(BASE, 'lg-izleyici');
    acik.push(Z);
    const izKare = kaydet(Z, 'langirtFrame');
    const izBasladi = once(Z, 'gameStarted', 12000);
    Z.emit('joinRoom', { roomId: String(oda2.id), gameId: 'langirt', userName: 'lg-izleyici',
      userKey: 'test:lg-izleyici', spectate: true, maxPlayers: 2 });
    await once(Z, 'joinedRoom');
    const iz = await izBasladi;
    assert.strictEqual(iz.gameState.kind, 'langirt', 'izleyiciye masa gitmeli');
    assert.strictEqual(iz.gameState.seat, null, 'izleyicinin koltuğu olmamalı');
    assert.strictEqual(iz.gameState.taraf, null, 'izleyicinin takımı olmamalı');
    const ik = await izKare.bekle(8000);
    assert.ok(ik && ik.top, 'izleyici de kareleri almalı');
    console.log('  ✓ 11) izleyici masayı ve akan kareleri görebiliyor');
  }

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/langirt:\{name:'Langırt'/.test(sayfa), 'oyun listesinde langırt olmalı');
  assert.ok(/js\/langirt-online\.js/.test(sayfa), 'istemci adaptörü sayfaya bağlanmalı');
  assert.ok(/\.lg-tuval\{/.test(sayfa), 'langırt stilleri olmalı');
  assert.ok(/langirt:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'langirt'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/langirt:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');
  assert.ok(/touch-action:none/.test(sayfa), 'tuvalde dokunma kaydırmayı tetiklememeli');

  const istemci = oku('js/langirt-online.js');
  assert.ok(/kinds: \['langirt'\]/.test(istemci), 'adaptör langırt türünü karşılamalı');
  assert.ok(/langirtFrame/.test(istemci), 'gerçek zamanlı kareleri dinlemeli');
  assert.ok(/araDeger/.test(istemci), 'paketler arası yumuşatma olmalı');
  assert.ok(/devicePixelRatio/.test(istemci), 'tuval ekran yoğunluğuna göre ölçeklenmeli');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');
  assert.ok(/tuval\.__dar/.test(istemci), 'dar ekranda saha çevrilmeli');
  /* Fizik İSTEMCİDE OLMAMALI: topun hızını istemci entegre etmemeli. */
  assert.ok(!/top\.x \+= .*vx \* dt/.test(istemci), 'istemci fiziği kendi işletmemeli');

  const sunucu = oku('server.js');
  assert.ok(/langirt: 2301/.test(sunucu), 'hazır masa taban kimliği tanımlı olmalı');
  assert.ok(/socket\.on\('langirtRods'/.test(sunucu), 'çubuk olayı sunucuda olmalı');
  assert.ok(/socket\.on\('langirtShot'/.test(sunucu), 'şut olayı sunucuda olmalı');
  assert.ok(/LANGIRT_ADIM_MS = 20/.test(sunucu), 'fizik 50 Hz sabit adımla işlemeli');
  assert.ok(/langirtEngine\.tarafOf\(p\.seat\)/.test(sunucu),
    'takım KOLTUKTAN bulunmalı — istemci seçememeli');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'langirt'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/let STANDARD = \[[^\]]*'langirt'/.test(panel), 'kurucu panelinin listesinde olmalı');
  assert.ok(/langirt: 2301/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'langirt.jpg')), 'kapak görseli olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-langirt.py')), 'kapak üretim betiği olmalı');
  console.log('  ✓ 12) istemci, stiller, kurallar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK langırt: sunucu yetkili fizik, gerçek zamanlı akış, hazır masalar, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('LANGIRT HATASI:', e);
    process.exit(1);
  }
})();
