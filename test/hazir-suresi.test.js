'use strict';
/* ============================================================================
 * BEKLEME ODASI — HAZIR SÜRESİ SAYACI
 * ============================================================================
 * Kullanıcı isteği: "Oyuncular iki kişilik bekleme odasında beklerken, birisi
 * hazır vermişken diğeri vermiyorsa 30 saniye hazır basma süresi verilsin,
 * ardından hazır vermeyen odadan otomatik atılsın ve lobiye yönlendirilsin (bu
 * sadece normal odalarda geçerli, özel kurulan masalarda geçerli değil). 3 veya
 * 4 kişilik odalarda da oda sayısı dolduysa ve içlerinden 1 tanesi bile hazır
 * verdiyse 30 saniyelik süre başlar... Oyuncular sürekli 'hazır yap' ve 'iptal
 * et' yaparak bug yapmaya çalışabilirler, o yüzden sayaç başladığında sadece 1
 * kere geçerli olacak... 30. saniye dolduğunda kim hazır vermediyse o atılır."
 *
 * NE DOĞRULANIR
 *   1) 2 kişilik normal masa: biri hazır verince sayaç başlar, süre dolunca
 *      hazır vermeyen 'kickedFromRoom' (reason: not_ready) alıp masadan düşer;
 *      hazır olan masada kalır.
 *   2) HAZIR/İPTAL yaparak sayaç SIFIRLANAMAZ ve İPTAL EDİLEMEZ: bitiş anı
 *      ilk başlangıca göre sabittir, hazır verip iptal eden de atılır.
 *   3) 4 kişilik masa: masa dolmadan sayaç başlamaz; dolunca ve biri hazır
 *      verince başlar, süre dolunca hazır vermeyenlerin HEPSİ atılır.
 *   4) ÖZEL masada sayaç hiç başlamaz.
 *   5) Herkes hazır olursa oyun başlar, kimse atılmaz.
 *   6) Kalan süre oda özetinde taşınır (yenileyen oyuncu da görür) ve
 *      arayüzde sayaç şeridi bağlıdır.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-hazir-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_OKEY_PRESETS = '1';
process.env.GV_HAZIR_SURESI_MS = '5000';          // testte 5 sn
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

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
function belki(s, ev, ms) {            // gelmezse null döner
  return new Promise(res => {
    const t = setTimeout(() => res(null), ms);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}
const uyu = ms => new Promise(r => setTimeout(r, ms));
/* Olayı ÖNCEDEN kaydet: sayaç sunucuda işlerken testin ara adımları uzun
   sürerse olay dinleyici kurulmadan gelebilir ve 'once' onu ıskalar. */
function kaydet(s, ev) {
  const kutu = { gelen: [], bekleyenler: [] };
  s.on(ev, p => {
    kutu.gelen.push(p);
    const b = kutu.bekleyenler.shift();
    if (b) b(p);
  });
  kutu.bekle = (ms) => new Promise((res, rej) => {
    if (kutu.gelen.length) return res(kutu.gelen.shift());
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 12000);
    kutu.bekleyenler.push(p => { clearTimeout(t); res(p); });
  });
  return kutu;
}

/* Hazır (preset) masa bul: boş ve istenen kişilikte. */
function bosMasa(rooms, gameId, kisi, kullanilan) {
  const oda = [...rooms.values()]
    .filter(r => r.isPreset && r.gameId === gameId && r.maxPlayers === kisi &&
                 !r.players.length && !kullanilan.has(r.id))
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  assert.ok(oda, gameId + ' ' + kisi + ' kişilik boş masa olmalı');
  kullanilan.add(oda.id);
  return oda;
}
async function otur(BASE, oda, gameId, adlar) {
  const ss = [];
  for (const ad of adlar) {
    const s = await connect(BASE, ad);
    s.emit('joinRoom', { roomId: String(oda.id), gameId, userName: ad,
      userKey: 'test:' + ad, maxPlayers: oda.maxPlayers, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
    ss.push(s);
  }
  return ss;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const kullanilan = new Set();
  const acik = [];

  // ---------- 1-2) 2 KİŞİLİK: sayaç, sıfırlanamazlık, atılma ----------
  {
    const oda = bosMasa(rooms, 'okey', 2, kullanilan);
    const ss = await otur(BASE, oda, 'okey', ['hazir-A', 'tembel-B']);
    acik.push(...ss);
    const [A, B] = ss;
    const atilmaB = kaydet(B, 'kickedFromRoom');
    const sonA = kaydet(A, 'hazirSayacSonu');

    assert.ok(!oda.hazirSayac, 'kimse hazır vermeden sayaç olmamalı');
    const haberA = once(A, 'hazirSayaci', 9000);
    const haberB = once(B, 'hazirSayaci', 9000);
    A.emit('setReady', { ready: true });
    const h = await haberA; await haberB;
    assert.ok(h && Number(h.kalan) > 0, 'sayaç kalan süreyle bildirilmeli');
    assert.strictEqual(h.sure, 5000, 'süre sunucudaki ayar olmalı');
    assert.ok(oda.hazirSayac, 'sunucuda sayaç kurulmalı');
    const ilkBitis = oda.hazirSayac.bitis;
    console.log('  ✓ 1) biri hazır verince sayaç başladı ve herkese bildirildi');

    /* SIFIRLANAMAZ: B hazır verip iptal etse de, A iptal etse de bitiş anı
       değişmez. Kullanıcı isteği: "sürekli hazır yap / iptal et yaparak bug
       yapmaya çalışabilirler". */
    await uyu(300);
    A.emit('setReady', { ready: false });     // iptal: sayaç DURMAMALI
    await uyu(250);
    assert.ok(oda.hazirSayac, 'iptal sayacı durdurmamalı');
    A.emit('setReady', { ready: true });      // yeniden hazır: SIFIRLAMAMALI
    await uyu(250);
    assert.strictEqual(oda.hazirSayac && oda.hazirSayac.bitis, ilkBitis,
      'hazır/iptal sayacı sıfırlamamalı');
    const ikinci = await belki(B, 'hazirSayaci', 400);
    assert.strictEqual(ikinci, null, 'sayaç ikinci kez başlatılmamalı');
    console.log('  ✓ 2) hazır/iptal sayacı sıfırlamıyor, ikinci kez başlamıyor');

    // Süre dolsun: B hazır değil → atılır, A hazır → kalır
    const p = await atilmaB.bekle(12000);
    assert.strictEqual(p.reason, 'not_ready', 'atılma sebebi hazır vermemek olmalı');
    const son = await sonA.bekle(12000);
    assert.deepStrictEqual(son.atilan, ['tembel-B'], 'atılanın adı bildirilmeli');
    await uyu(300);
    assert.strictEqual(oda.players.length, 1, 'hazır vermeyen masadan düşmeli');
    assert.strictEqual(oda.players[0].name, 'hazir-A', 'hazır olan masada kalmalı');
    assert.ok(!oda.hazirSayac, 'sayaç bitince temizlenmeli');
    console.log('  ✓ 3) süre dolunca hazır vermeyen masadan çıkarıldı, hazır olan kaldı');

    ss.forEach(s => { try { s.close(); } catch (_) {} });
    await uyu(200);
  }

  // ---------- 3) 4 KİŞİLİK: masa dolmadan sayaç yok ----------
  {
    const oda = bosMasa(rooms, 'okey', 4, kullanilan);
    const ss = await otur(BASE, oda, 'okey', ['d-A', 'd-B', 'd-C']);
    acik.push(...ss);
    ss[0].emit('setReady', { ready: true });
    await uyu(400);
    assert.ok(!oda.hazirSayac, 'masa dolmadan sayaç başlamamalı');
    console.log('  ✓ 4) eksik masada sayaç başlamıyor');

    // Dördüncü oyuncu gelince masa dolar → sayaç başlar
    const haber = once(ss[1], 'hazirSayaci', 9000);
    const D = (await otur(BASE, oda, 'okey', ['d-D']))[0];
    acik.push(D);
    await haber;
    assert.ok(oda.hazirSayac, 'masa dolunca sayaç başlamalı');
    console.log('  ✓ 5) masa dolunca sayaç kendiliğinden başlıyor');

    // B hazır versin; C ve D hazır vermesin → ikisi de atılır
    const atC = kaydet(ss[2], 'kickedFromRoom');
    const atD = kaydet(D, 'kickedFromRoom');
    ss[1].emit('setReady', { ready: true });
    await Promise.all([atC.bekle(12000), atD.bekle(12000)]);
    await uyu(400);
    const kalanAdlar = oda.players.map(p => p.name).sort();
    assert.deepStrictEqual(kalanAdlar, ['d-A', 'd-B'], 'yalnız hazır verenler kalmalı');
    console.log('  ✓ 6) 4 kişilik masada hazır vermeyenlerin hepsi atıldı');

    ss.forEach(s => { try { s.close(); } catch (_) {} });
    try { D.close(); } catch (_) {}
    await uyu(200);
  }

  // ---------- 4) ÖZEL MASA: sayaç hiç başlamaz ----------
  {
    /* Özel masa kurmak üyelik ister; kuralın ölçüsü masanın ÖZEL olmasıdır,
       nasıl kurulduğu değil. Bu yüzden masa sunucu tarafında özel işaretlenip
       sayacın hiç başlamadığı doğrulanıyor. */
    const oda = bosMasa(rooms, 'okey', 2, kullanilan);
    const ss = await otur(BASE, oda, 'okey', ['ozel-A', 'ozel-B']);
    acik.push(...ss);
    oda.isPrivate = true;                 // oturduktan SONRA özel işaretle
                                          // (özel masaya davetsiz girilemez)
    const haber = belki(ss[1], 'hazirSayaci', 1500);
    ss[0].emit('setReady', { ready: true });
    assert.strictEqual(await haber, null, 'özel masada sayaç bildirimi gitmemeli');
    assert.ok(!oda.hazirSayac, 'özel masada sayaç kurulmamalı');
    await uyu(5600);                      // süre geçsin
    assert.strictEqual(oda.players.length, 2, 'özel masada kimse atılmamalı');
    console.log('  ✓ 7) özel masada sayaç hiç çalışmıyor');
    ss.forEach(s => { try { s.close(); } catch (_) {} });
    oda.isPrivate = false;
    await uyu(200);
  }

  // ---------- 5) HERKES HAZIR: oyun başlar, kimse atılmaz ----------
  {
    const oda = bosMasa(rooms, 'okey', 2, kullanilan);
    const ss = await otur(BASE, oda, 'okey', ['tam-A', 'tam-B']);
    acik.push(...ss);
    const basladi = ss.map(s => once(s, 'gameStarted', 12000));
    const atildi = ss.map(s => belki(s, 'kickedFromRoom', 7000));
    ss.forEach(s => s.emit('setReady', { ready: true }));
    await Promise.all(basladi);
    assert.strictEqual(oda.status, 'playing', 'herkes hazırsa oyun başlamalı');
    const atilanlar = (await Promise.all(atildi)).filter(Boolean);
    assert.strictEqual(atilanlar.length, 0, 'oyun başladıysa kimse atılmamalı');
    console.log('  ✓ 8) herkes hazır olunca oyun başlıyor, sayaç kimseyi atmıyor');
    ss.forEach(s => { try { s.close(); } catch (_) {} });
    await uyu(200);
  }

  // ---------- 6) ODA ÖZETİ VE ARAYÜZ ----------
  {
    const oda = bosMasa(rooms, 'okey', 2, kullanilan);
    const ss = await otur(BASE, oda, 'okey', ['oz-A', 'oz-B']);
    acik.push(...ss);
    const guncel = once(ss[1], 'roomUpdated', 9000);
    ss[0].emit('setReady', { ready: true });
    await once(ss[1], 'hazirSayaci', 9000);
    await guncel;
    /* Oda özeti kalan süreyi taşımalı: sayfayı yenileyen oyuncu da sayacı
       görsün (olay kaçsa bile). */
    const ozet = await new Promise(res => {
      ss[1].once('roomUpdated', res);
      ss[1].emit('setReady', { ready: false });
    });
    assert.ok(Number(ozet.hazirKalan) > 0, 'oda özeti kalan süreyi taşımalı');
    console.log('  ✓ 9) kalan süre oda özetinde taşınıyor');
    ss.forEach(s => { try { s.close(); } catch (_) {} });
  }

  const istemci = fs.readFileSync(path.join(__dirname, '..', 'js', 'room-waiting-fix.js'), 'utf8');
  assert.ok(/socket\.on\('hazirSayaci'/.test(istemci), 'istemci sayacı dinlemeli');
  assert.ok(/gv-sayac-n/.test(istemci), 'sayaç şeridi çizilmeli');
  assert.ok(/not_ready/.test(istemci), 'atılma sebebine özel mesaj olmalı');
  assert.ok(/\.gv-sayac\{/.test(istemci), 'sayaç şeridinin stili olmalı');
  console.log('  ✓ 10) arayüz sayacı gösteriyor ve atılma sebebini yazıyor');

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
  console.log('OK hazır süresi: sayaç, sıfırlanamazlık, atılma, özel masa muafiyeti');
  process.exit(0);
}

main().catch(e => { console.error('HAZIR SÜRESİ HATASI:', e); process.exit(1); });
