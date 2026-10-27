'use strict';
/* ============================================================================
 * HAVA HOKEYİ — FİZİK MOTORU VE GERÇEK ZAMANLI ONLINE AKIŞ
 * ============================================================================
 * Prototip (customizable-air-hockey-game) fiziği TARAYICIDA işletiyordu.
 * Burada fizik SUNUCUYA taşındı ve SABİT 120 Hz adımlarla işliyor; istemci
 * yalnız tokmağının gitmesini istediği noktayı gönderiyor.
 *
 * 120 Hz NEDEN: disk saniyede 1450 birime kadar çıkabiliyor. 50 Hz'de bir
 * adımda 29 birim yol alır ve 20 birimlik yarıçapıyla 43 birimlik tokmağın
 * İÇİNDEN geçebilir. Bu dosya o tünelleme durumunu da ölçüyor.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Masa ölçüleri prototiple aynı; maç geri sayımla başlıyor.
 *     2) Fizik belirlenimci (sabit adım).
 *     3) Tokmak KENDİ yarı sahasının dışına çıkamıyor.
 *     4) Hızlı disk tokmağın içinden GEÇMİYOR (120 Hz'in sebebi).
 *     5) Hareket eden tokmak diske hız katıyor (vuruş).
 *     6) Gol sayılıyor, servis gol yiyende, hedef golde maç bitiyor.
 *     7) Kale ağzı dışında disk sekiyor; direk köşeden gol olmasını önlüyor.
 *   ONLINE
 *     8) Hazır masalar lobide ve hiçbir masa kimliği başka oyunla çakışmıyor.
 *     9) Sunucu kendiliğinden kare yayınlıyor.
 *    10) Oyuncu KENDİ tokmağını oynatıyor; rakibininkini oynatamıyor.
 *    11) Hedef golde iki oyuncuya da gameEnded gidiyor.
 *    12) İzleyici masayı ve kareleri görüyor.
 *   ARAYÜZ
 *    13) İstemci adaptörü, stiller, kurallar, panel ve kapak bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-hokey-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../havahokeyi-engine.js');
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
const ADIM = 1 / 120;
function oyunaGec(st) {
  for (let i = 0; i < 900 && st.faz !== 'oyun'; i++) E.adim(st, ADIM);
  return st;
}

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  // 1) MASA ve BAŞLANGIÇ
  let st = E.macBaslat({ seats: [0, 1], golHedefi: 3 });
  assert.strictEqual(E.MASA_EN, 1000, 'masa eni 1000 birim');
  assert.strictEqual(E.MASA_BOY, 600, 'masa boyu 600 birim');
  assert.strictEqual(E.TOKMAK_R, 43, 'tokmak yarıçapı prototiple aynı');
  assert.strictEqual(E.DISK_R, 20, 'disk yarıçapı prototiple aynı');
  assert.strictEqual(st.faz, 'gerisayim', 'maç geri sayımla başlamalı');
  assert.strictEqual(st.disk.vx, 0, 'geri sayımda disk durmalı');
  oyunaGec(st);
  assert.strictEqual(st.faz, 'oyun', 'geri sayım bitince oyun başlamalı');
  /* Gerçek kural: servis diski servis atanın yarı sahasına DURGUN konur,
     oyuncu kendisi vurur (kendiliğinden fırlatılmaz). */
  assert.strictEqual(st.disk.vx, 0, 'servis diski kendiliğinden fırlatılmamalı');
  assert.ok(st.disk.x < 500, 'ilk servis koltuk 0\'ın yarı sahasında');
  console.log('  ✓ 1) masa ölçüleri prototiple aynı, maç geri sayımla başlıyor, servis diski durgun');

  // 2) BELİRLENİMCİLİK
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 3 }));
    const b = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 3 }));
    [a, b].forEach(x => { E.hedefYaz(x, 0, 300, 220); E.hedefYaz(x, 1, 700, 380); });
    for (let i = 0; i < 1200; i++) { E.adim(a, ADIM); E.adim(b, ADIM); }
    assert.deepStrictEqual({ x: a.disk.x, y: a.disk.y, s: a.skor },
                           { x: b.disk.x, y: b.disk.y, s: b.skor },
                           'sabit adımlı fizik aynı sonucu vermeli');
  }
  console.log('  ✓ 2) fizik belirlenimci: aynı girdi aynı sonucu veriyor');

  // 3) TOKMAK KENDİ YARI SAHASINDA
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 3 }));
    E.hedefYaz(a, 0, 9999, 9999);     // koltuk 0 karşı sahaya kaçmak istiyor
    E.hedefYaz(a, 1, -9999, -9999);
    for (let i = 0; i < 400; i++) E.adim(a, ADIM);
    assert.ok(a.tokmak[0].x < 500, 'koltuk 0 orta çizgiyi geçememeli');
    assert.ok(a.tokmak[1].x > 500, 'koltuk 1 orta çizgiyi geçememeli');
    assert.ok(a.tokmak[0].y <= E.ALAN.alt - E.TOKMAK_R, 'tokmak alt banttan taşmamalı');
    assert.ok(a.tokmak[1].y >= E.ALAN.ust + E.TOKMAK_R, 'tokmak üst banttan taşmamalı');
    /* Hedef de kırpılmalı: istemci saçma değer yollarsa sunucu düzeltir. */
    assert.ok(a.hedef[0].x < 500, 'sunucu hedefi de kendi yarısına kırpmalı');
  }
  console.log('  ✓ 3) tokmak kendi yarı sahasının dışına çıkamıyor');

  // 4) TÜNELLEME YOK — 120 Hz'in asıl sebebi
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 9 }));
    /* Tokmağı sabit bir noktaya oturt, diski üzerine tam hızla sür. */
    a.tokmak[1] = { x: 700, y: 300, vx: 0, vy: 0 };
    a.hedef[1] = { x: 700, y: 300 };
    a.disk.x = 450; a.disk.y = 300;
    a.disk.vx = E.DISK_TAVANI; a.disk.vy = 0;
    let gecti = true;
    for (let i = 0; i < 90; i++) {
      E.adim(a, ADIM);
      if (a.disk.vx < 0) { gecti = false; break; }   // geri sekti → çarptı
    }
    assert.strictEqual(gecti, false,
      'TAM HIZLI disk tokmağın içinden geçmemeli — bu yüzden fizik 120 Hz');
  }
  console.log('  ✓ 4) tam hızlı disk tokmağın içinden geçmiyor (120 Hz gerekçesi)');

  // 5) HAREKET EDEN TOKMAK VURUŞ YAPIYOR
  {
    const durgun = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 9 }));
    const hizli = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 9 }));
    /* Vuruş gücü SALINIMLA kazanılır (tokmak ivme sınırlı): tokmak 150 birim
       geriden koşarak gelir. */
    [durgun, hizli].forEach(x => {
      x.disk.x = 300; x.disk.y = 300; x.disk.vx = 0; x.disk.vy = 0;
      x.tokmak[0] = { x: 300 - (E.DISK_R + E.TOKMAK_R) - 150, y: 300, vx: 0, vy: 0 };
      x.hedef[0] = { x: x.tokmak[0].x, y: 300 };
    });
    /* Hızlı olanın tokmağı diske doğru koşsun. */
    E.hedefYaz(hizli, 0, 430, 300);
    for (let i = 0; i < 40; i++) { E.adim(durgun, ADIM); E.adim(hizli, ADIM); }
    /* HIZ BÜYÜKLÜĞÜNE bakılır, yönüne değil: vurulan disk bu sürede karşı
       banda çarpıp geri dönmüş olabilir (vx negatife düşer) ama hızlıdır. */
    const dHiz = Math.hypot(durgun.disk.vx, durgun.disk.vy);
    const hHiz = Math.hypot(hizli.disk.vx, hizli.disk.vy);
    assert.ok(dHiz < 10, 'durgun tokmak diski itmemeli — bulunan: ' + dHiz.toFixed(1));
    assert.ok(hHiz > 600, 'hareket eden tokmak diske belirgin hız katmalı — bulunan: ' +
      hHiz.toFixed(1));
    assert.notStrictEqual(Math.round(hizli.disk.x), 300, 'vurulan disk yerinden kalkmalı');
    assert.ok(hHiz <= E.DISK_TAVANI + 0.01, 'disk hız tavanını aşmamalı');
  }
  console.log('  ✓ 5) hareket eden tokmak diske hız katıyor');

  // 6) GOL, SERVİS ve MAÇ BİTİŞİ
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 3, maxSet: 1 }));
    assert.strictEqual(E.macBaslat({ seats: [0, 1], golHedefi: 4 }).golHedefi, 5,
      'geçersiz hedef gol varsayılana düşmeli');
    const golAt = () => {
      a.disk.x = 900; a.disk.y = 300; a.disk.vx = 900; a.disk.vy = 0;
      E.hedefYaz(a, 1, 620, 190);
      a.tokmak[1] = { x: 620, y: 190, vx: 0, vy: 0 };
      for (let i = 0; i < 200 && a.faz === 'oyun'; i++) E.adim(a, ADIM);
    };
    golAt();
    assert.strictEqual(a.skor[0], 1, 'kale ağzından çıkan disk gol olmalı');
    assert.strictEqual(a.faz, 'gol', 'golden sonra kısa ara olmalı');
    assert.strictEqual(a.servisYonu, -1, 'servis GOL YİYENDE olmalı');
    oyunaGec(a); golAt();
    assert.strictEqual(a.skor[0], 2, 'ikinci gol de sayılmalı');
    assert.strictEqual(a.status, 'playing', 'hedefe varılmadan maç bitmemeli');
    oyunaGec(a); golAt();
    assert.strictEqual(a.skor[0], 3, 'üçüncü gol de sayılmalı');
    assert.strictEqual(a.status, 'finished', 'hedef golde maç bitmeli');
    assert.strictEqual(a.winner, 0, 'koltuk 0 kazanmalı');
  }
  console.log('  ✓ 6) gol sayılıyor, servis gol yiyende, hedef golde maç bitiyor');

  // 6b) SET MANTIĞI ve RENK
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 3 }));
    assert.strictEqual(a.maxSet, 3, 'varsayılan 3 set olmalı');
    const golAt = () => {
      a.disk.x = 900; a.disk.y = 300; a.disk.vx = 900; a.disk.vy = 0;
      E.hedefYaz(a, 1, 620, 190);
      a.tokmak[1] = { x: 620, y: 190, vx: 0, vy: 0 };
      for (let i = 0; i < 200 && a.faz === 'oyun'; i++) E.adim(a, ADIM);
    };
    golAt(); oyunaGec(a); golAt(); oyunaGec(a); golAt();
    assert.deepStrictEqual(a.setler, [1, 0], 'üç gol bir set getirmeli');
    assert.deepStrictEqual(a.skor, [0, 0], 'set sonrası goller sıfırlanmalı');
    assert.strictEqual(a.status, 'playing', 'tek set maçı bitirmemeli');
    assert.strictEqual(a.setSonu, true, 'set sonu işaretlenmeli');
    oyunaGec(a); golAt(); oyunaGec(a); golAt(); oyunaGec(a); golAt();
    assert.deepStrictEqual(a.setler, [2, 0], 'ikinci set de alınmalı');
    assert.strictEqual(a.status, 'finished', 'çoğunluk setle maç bitmeli');
    assert.strictEqual(a.winner, 0, 'koltuk 0 kazanmalı');
    assert.deepStrictEqual(E.gorunum(a, 0).setler, [2, 0], 'görünüm set bilgisini taşımalı');
    const r = E.macBaslat({ seats: [0, 1], golHedefi: 3 });
    assert.ok(E.renkYaz(r, 1, '#a3e635').ok, 'listedeki renk kabul edilmeli');
    assert.strictEqual(r.renk[1], '#a3e635', 'renk yazılmalı');
    assert.ok(!E.renkYaz(r, 1, 'red').ok, 'listede olmayan renk reddedilmeli');
    assert.strictEqual(r.renk[1], '#a3e635', 'geçersiz renk değeri bozmamalı');
  }
  console.log('  ✓ 6b) set mantığı ve renk seçimi');

  // 7) KALE AĞZI DIŞI ve DİREK
  {
    const a = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 5 }));
    a.disk.x = 900; a.disk.y = 120; a.disk.vx = 900; a.disk.vy = 0;  // ağzın üstü
    E.hedefYaz(a, 1, 700, 380);
    for (let i = 0; i < 120; i++) E.adim(a, ADIM);
    assert.strictEqual(a.skor[0], 0, 'kale ağzı dışından gol olmamalı');
    assert.ok(a.disk.x <= E.ALAN.sag + 1, 'disk masanın içinde kalmalı');
    assert.ok(a.disk.vx < 0, 'disk yan banttan geri sekmeli');

    /* Direk: tam köşeye (kale ağzının sınırına) gelen disk içeri girmemeli. */
    const b = oyunaGec(E.macBaslat({ seats: [0, 1], golHedefi: 5 }));
    b.disk.x = 860; b.disk.y = 205; b.disk.vx = 700; b.disk.vy = 0;
    E.hedefYaz(b, 1, 620, 380);
    b.tokmak[1] = { x: 620, y: 380, vx: 0, vy: 0 };
    for (let i = 0; i < 80; i++) E.adim(b, ADIM);
    assert.ok(b.disk.x <= E.ALAN.sag + E.DISK_R + 2 || b.skor[0] === 0,
      'direkten dönen disk kaleye girmemeli');
  }
  console.log('  ✓ 7) kale ağzı dışında disk sekiyor, direkler görevini yapıyor');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 8) HAZIR MASALAR + ÇAKIŞMA
  const masalar = await httpRooms(BASE, 'havahokeyi');
  assert.strictEqual(masalar.length, 10, 'hava hokeyi 10 hazır masa açmalı');
  assert.ok(masalar.every(m => m.maxPlayers === 2), 'masalar iki kişilik olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2401' && String(m.id) <= '2410'),
    'masa kimlikleri 2401-2410 aralığında olmalı');
  {
    const hepsi = new Map();
    for (const g of (require('../server.js').ALL_GAMES || [
      'chess', 'tavla', 'okey', 'okey101', 'pisti', 'batak', 'dama', 'turkdamasi',
      'reversi', 'gomoku', 'connect4', 'bilardo', 'battleship', 'kelimelik',
      'tombala', 'adamasmaca', 'passaparola', 'cenga', 'langirt', 'havahokeyi'])) {
      for (const m of await httpRooms(BASE, g)) {
        const id = String(m.id);
        assert.ok(!hepsi.has(id),
          'masa kimliği çakışıyor: #' + id + ' hem ' + hepsi.get(id) + ' hem ' + g);
        hepsi.set(id, g);
      }
    }
  }
  console.log('  ✓ 8) hazır masalar lobide ve hiçbir masa kimliği çakışmıyor');

  const oda = masalar[0];
  const A = await connect(BASE, 'hk-A');
  const B = await connect(BASE, 'hk-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'havahokeyi', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const kareA = kaydet(A, 'hokeyFrame');
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA, pB] = await Promise.all(basladi);

  // 9) KARE AKIŞI
  assert.strictEqual(pA.gameState.kind, 'havahokeyi', 'masa paketi hava hokeyi olmalı');
  assert.strictEqual(pB.gameState.golHedefi, pA.gameState.golHedefi, 'hedef gol ortak');
  const k1 = await kareA.bekle(8000);
  assert.ok(k1 && k1.disk, 'sunucu kendiliğinden kare yayınlamalı');
  const n0 = kareA.gelen.length;
  await uyu(400);
  assert.ok(kareA.gelen.length > n0, 'kareler akmaya devam etmeli');
  console.log('  ✓ 9) sunucu kendiliğinden kare yayınlıyor');

  // 10) KENDİ TOKMAĞI
  const odaNes = rooms.get(String(oda.id));
  const h = odaNes.havahokeyi;
  {
    for (let i = 0; i < 90 && h.st.faz !== 'oyun'; i++) await uyu(60);
    assert.strictEqual(h.st.faz, 'oyun', 'geri sayım bitmeli');
    const sol = pA.seat === 0 ? A : B;      // koltuk 0 = sol yarı
    const sag = pA.seat === 0 ? B : A;
    const solOnce = h.st.tokmak[0].y;
    sol.emit('hokeyMove', { roomId: String(oda.id), x: 200, y: 480 });
    await uyu(400);
    assert.ok(h.st.tokmak[0].y > solOnce, 'kendi tokmağı istenen yöne gitmeli');
    /* Rakip aynı noktayı yollasa bile KENDİ tokmağı oynar: takım koltuktan
       bulunuyor, istemci seçemiyor. */
    const solHedef = { x: h.st.hedef[0].x, y: h.st.hedef[0].y };
    const sagOnce = h.st.tokmak[1].y;
    sag.emit('hokeyMove', { roomId: String(oda.id), x: 200, y: 120 });
    await uyu(400);
    assert.deepStrictEqual({ x: h.st.hedef[0].x, y: h.st.hedef[0].y }, solHedef,
      'bir oyuncu RAKİBİN tokmağını oynatamamalı');
    assert.ok(h.st.tokmak[1].x > 500, 'rakibin tokmağı kendi yarısında kalmalı');
    assert.notStrictEqual(Math.round(h.st.tokmak[1].y), Math.round(sagOnce),
      'rakip kendi tokmağını oynatabilmeli');
  }
  console.log('  ✓ 10) herkes kendi tokmağını oynatıyor, rakibininkini oynatamıyor');

  // 11) MAÇ BİTİŞİ
  {
    const bittiA = kaydet(A, 'gameEnded');
    const bittiB = kaydet(B, 'gameEnded');
    h.st.skor[0] = h.st.golHedefi - 1;
    h.st.setler[0] = 1;   // bir set önde: bu gol maçı bitirir
    h.st.faz = 'oyun'; h.st.fazSn = 0;
    h.st.disk.x = 930; h.st.disk.y = 300; h.st.disk.vx = 1200; h.st.disk.vy = 0;
    h.st.tokmak[1] = { x: 620, y: 190, vx: 0, vy: 0 };
    h.st.hedef[1] = { x: 620, y: 190 };
    const [sA, sB] = await Promise.all([bittiA.bekle(15000), bittiB.bekle(15000)]);
    assert.strictEqual(sA.gameState.status, 'finished', 'hedef golde maç bitmeli');
    assert.strictEqual(sA.winnerSeat, 0, 'koltuk 0 kazanmalı');
    assert.strictEqual(sA.winnerSeat, sB.winnerSeat, 'iki pakette aynı kazanan');
    assert.notStrictEqual(sA.youWon, sB.youWon, 'biri kazandı diğeri kaybetti');
  }
  console.log('  ✓ 11) hedef golde iki oyuncuya da bitiş gidiyor');

  // 12) İZLEYİCİ
  {
    const oda2 = masalar[1];
    const C = await connect(BASE, 'hk-C'), D = await connect(BASE, 'hk-D');
    acik.push(C, D);
    for (const s of [C, D]) {
      s.emit('joinRoom', { roomId: String(oda2.id), gameId: 'havahokeyi', userName: s.userName,
        userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda2.durationMinutes });
      await once(s, 'joinedRoom');
    }
    const bas2 = [once(C, 'gameStarted', 12000), once(D, 'gameStarted', 12000)];
    [C, D].forEach(s => s.emit('setReady', { ready: true }));
    await Promise.all(bas2);

    const Z = await connect(BASE, 'hk-izleyici');
    acik.push(Z);
    const izKare = kaydet(Z, 'hokeyFrame');
    const izBasladi = once(Z, 'gameStarted', 12000);
    Z.emit('joinRoom', { roomId: String(oda2.id), gameId: 'havahokeyi', userName: 'hk-izleyici',
      userKey: 'test:hk-izleyici', spectate: true, maxPlayers: 2 });
    await once(Z, 'joinedRoom');
    const iz = await izBasladi;
    assert.strictEqual(iz.gameState.kind, 'havahokeyi', 'izleyiciye masa gitmeli');
    assert.strictEqual(iz.gameState.seat, null, 'izleyicinin koltuğu olmamalı');
    const ik = await izKare.bekle(8000);
    assert.ok(ik && ik.disk, 'izleyici de kareleri almalı');
    console.log('  ✓ 12) izleyici masayı ve akan kareleri görüyor');
  }

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/havahokeyi:\{name:'Hava Hokeyi'/.test(sayfa), 'oyun listesinde hava hokeyi olmalı');
  assert.ok(/js\/havahokeyi-online\.js/.test(sayfa), 'istemci adaptörü bağlı olmalı');
  assert.ok(/\.hk3-frame\{/.test(sayfa), 'hava hokeyi iframe stilleri olmalı');
  assert.ok(/havahokeyi:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'havahokeyi'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/havahokeyi:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');

  const istemci = oku('js/havahokeyi-online.js');
  assert.ok(/kinds: \['havahokeyi'\]/.test(istemci), 'adaptör türü karşılamalı');
  assert.ok(/hokeyFrame/.test(istemci), 'gerçek zamanlı kareleri dinlemeli');
  assert.ok(/hokeyMove/.test(istemci) && /hokeyRenk/.test(istemci), 'tokmak ve renk olayları iletilmeli');
  assert.ok(/assets\/oyunlar\/havahokeyi\.html/.test(istemci), 'referans oyun iframe ile yüklenmeli');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets/oyunlar/havahokeyi.html')), 'oyun paketi dosyası olmalı');
  assert.ok(!/disk\.x \+= .*vx \* dt/.test(istemci), 'istemci fiziği kendi işletmemeli');

  const sunucu = oku('server.js');
  assert.ok(/havahokeyi: 2401/.test(sunucu), 'hazır masa taban kimliği tanımlı olmalı');
  assert.ok(/socket\.on\('hokeyMove'/.test(sunucu), 'tokmak olayı sunucuda olmalı');
  assert.ok(/HOKEY_ADIM_MS = 1000 \/ 120/.test(sunucu), 'fizik 120 Hz sabit adımla işlemeli');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'havahokeyi'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/let STANDARD = \[[^\]]*'havahokeyi'/.test(panel), 'kurucu panelinde olmalı');
  assert.ok(/havahokeyi: 2401/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'havahokeyi.jpg')), 'kapak olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-havahokeyi.py')), 'kapak betiği olmalı');
  console.log('  ✓ 13) istemci, stiller, kurallar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK hava hokeyi: sunucu yetkili 120 Hz fizik, gerçek zamanlı akış, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('HAVA HOKEYİ HATASI:', e);
    process.exit(1);
  }
})();
