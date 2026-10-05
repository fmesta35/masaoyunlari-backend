'use strict';
/* ============================================================================
 * 101 OKEY — SUNUCU AKIŞI (gerçek soketlerle)
 * ============================================================================
 * Motor testi kuralları ölçer; bu test kuralların OYUNA bağlandığını ölçer:
 * doğru motor seçiliyor mu, durum paketi masayı taşıyor mu, açma/işleme
 * soket olayları çalışıyor mu, ve KLASİK okey bu değişiklikten etkilenmedi mi
 * (kullanıcı kararı: "Okey klasik kalsın, 101 değişsin").
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-ok101-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_OKEY_PRESETS = '1';
process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '600000';     // test sırasında zaman aşımı olmasın
process.env.GV_OKEY101_GERCEK = '1';        // gerçek 101 kuralları (bkz. startOkey)

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');
const E = require('../okey101-engine.js');

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
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 9000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}

async function masaKur(BASE, rooms, gameId, kisi) {
  const oda = [...rooms.values()].filter(r => r.isPreset && r.gameId === gameId && r.maxPlayers === kisi)
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  assert.ok(oda, gameId + ' için ' + kisi + ' kişilik masa olmalı');
  const soketler = [];
  for (let i = 0; i < kisi; i++) soketler.push(await connect(BASE, gameId + '-O' + i));
  const basladi = soketler.map(s => once(s, 'gameStarted', 15000));
  for (const s of soketler) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId, userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: kisi, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  for (const s of soketler) s.emit('setReady', { ready: true });
  const paketler = await Promise.all(basladi);
  return { oda, soketler, paketler };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const acik = [];

  // ---------- 1) 101 masası YENİ motoru kullanıyor ----------
  const a = await masaKur(BASE, rooms, 'okey101', 2);
  acik.push(...a.soketler);
  const oda = a.oda;
  assert.strictEqual(oda.okey.yeni101, true, '101 masası yeni motora bağlanmalı');
  const eller = oda.okey.roundState.seats.map(s => oda.okey.roundState.hands[s].length).sort();
  assert.deepStrictEqual(eller, [21, 22], '101 masasında dağıtım 22/21 olmalı');
  console.log('  ✓ 1) 101 masası yeni motorla kuruldu, dağıtım 22/21');

  // ---------- 2) durum paketi masayı ve açılış bilgisini taşıyor ----------
  for (const p of a.paketler) {
    const gs = p.gameState;
    assert.strictEqual(gs.kural, '101', 'paket 101 kuralını bildirmeli');
    assert.ok(Array.isArray(gs.melds), 'paket masadaki perleri taşımalı');
    assert.strictEqual(gs.melds.length, 0, 'el başında masa boş');
    assert.ok(gs.opened && Object.keys(gs.opened).length === 2, 'kimin açtığı herkese açık olmalı');
    assert.strictEqual(gs.acmaPuani, E.ACMA_PUANI, 'açma puanı (101) paketle gelmeli');
    assert.strictEqual(gs.ciftAdedi, E.CIFT_ACMA_ADEDI, 'çift sayısı paketle gelmeli');
    assert.ok(gs.myHand.length === 21 || gs.myHand.length === 22, 'oyuncu kendi elini görmeli');
  }
  console.log('  ✓ 2) durum paketi: masa, açılış durumu ve 101 eşiği herkese gidiyor');

  /* ---------- 3) AÇMA: elini kurup soketten aç ----------
     Eli test için SUNUCUDA kuruyoruz (doğal dağıtımda 101 beklemek
     belirsiz sürer); açma yolunun tamamı gerçek soket olayından geçiyor. */
  const st8 = oda.okey.roundState;
  const sira = st8.turn;
  const sahibi = a.soketler[a.paketler.findIndex(p => p.gameState.mySeat === sira)];
  assert.ok(sahibi, 'sırası gelen oyuncunun soketi bulunmalı');
  let no = 0;
  const T = (c, n) => ({ id: 'kur-' + (++no), c, n, isFJ: false });
  const el = [T('t-red', 10), T('t-red', 11), T('t-red', 12),
              T('t-blue', 7), T('t-blue', 8), T('t-blue', 9),
              T('t-yellow', 12), T('t-red', 12), T('t-blue', 12),
              T('t-black', 4), T('t-black', 5), T('t-black', 6),
              T('t-red', 13), T('t-black', 1)];   // 🔴13 işlenecek, ⚫1 atılacak
  st8.hands[sira] = el.slice();
  st8.phase = 'discard';

  const az = [[el[0].id, el[1].id, el[2].id], [el[3].id, el[4].id, el[5].id]];
  sahibi.emit('okey101Open', { roomId: String(oda.id), gruplar: az });
  const red = await once(sahibi, 'okeyRejected', 6000);
  assert.strictEqual(red.reason, 'below_101', '101 altı açılış sunucuda reddedilmeli');
  assert.strictEqual(st8.melds.length, 0, 'reddedilen açılış masaya bir şey koymamalı');
  assert.strictEqual(st8.hands[sira].length, 14, 'reddedilen açılışta taşlar elde kalmalı');

  const tam = az.concat([[el[6].id, el[7].id, el[8].id], [el[9].id, el[10].id, el[11].id]]);
  const guncel = once(sahibi, 'gameStateUpdated', 6000);
  sahibi.emit('okey101Open', { roomId: String(oda.id), gruplar: tam });
  const p1 = await guncel;
  assert.strictEqual(p1.gameState.melds.length, 4, '108 puanlık açılış dört peri masaya koymalı');
  assert.strictEqual(p1.gameState.opened[sira], true, 'oyuncu açılmış görünmeli');
  assert.strictEqual(st8.hands[sira].length, 2, 'açılıştan sonra elde 2 taş kalmalı');
  console.log('  ✓ 3) açma: 101 altı reddediliyor, 108 ile dört per masaya çıkıyor');

  // ---------- 4) İŞLEME ----------
  const kirmizi = st8.melds.find(m => m.tiles.some(t => t.id === el[0].id));
  assert.strictEqual(kirmizi.tiles.length, 3, 'işlemeden önce per üç taş');
  if (process.env.GV_OK101_AYIKLA) sahibi.onAny((ev, p) => console.log('[OLAY]', ev, (p && p.reason) || ''));

  /* Önce UYMAYAN taş: ⚫1 kırmızı seriye girmemeli. Sıra önemli — elde iki
     taş varken denenir, çünkü motor "atacak taş bırakmalısın" kuralını
     per doğrulamasından ÖNCE uygular ve tek taşla gelen istek o yüzden
     reddedilir (bu da doğru davranış, ama ölçmek istediğimiz bu değil). */
  const red3 = once(sahibi, 'okeyRejected', 6000);
  sahibi.emit('okey101Add', { roomId: String(oda.id), meldId: kirmizi.id, tileId: el[13].id });
  const r3 = await red3;
  assert.strictEqual(r3.reason, 'bad_meld', 'uymayan taş sunucuda reddedilmeli');
  assert.strictEqual(kirmizi.tiles.length, 3, 'reddedilen işleme peri bozmamalı');
  assert.strictEqual(st8.hands[sira].length, 2, 'reddedilen taş ele geri dönmeli');

  // Uyan taş: 🔴13 → 🔴10-11-12
  const g2 = Promise.race([
    once(sahibi, 'gameStateUpdated', 6000),
    once(sahibi, 'okeyRejected', 6000).then(r => { throw new Error('işleme reddedildi: ' + JSON.stringify(r.reason) + ' / ' + JSON.stringify(r.detail || '')); })
  ]);
  sahibi.emit('okey101Add', { roomId: String(oda.id), meldId: kirmizi.id, tileId: el[12].id });
  const p2 = await g2;
  const kirmiziYeni = p2.gameState.melds.find(m => m.id === kirmizi.id);
  assert.strictEqual(kirmiziYeni.tiles.length, 4, '🔴13 seriye işlenip per dörde çıkmalı');
  assert.strictEqual(st8.hands[sira].length, 1, 'işlenen taş elden düşmeli');

  // ---------- 4b) SON TAŞI ATINCA EL BİTER ----------
  /* El bitince sunucu 'gameStateUpdated' DEĞİL 'okeyRoundEnded' yayınlar
     (okeyAct → okeyRoundFinished). İki kişilik masada bu aynı zamanda maçı
     bitirdiği için 'gameEnded' de gelir. */
  const bitti = Promise.race([
    once(sahibi, 'okeyRoundEnded', 8000),
    once(sahibi, 'gameEnded', 8000)
  ]);
  sahibi.emit('okeyDiscard', { roomId: String(oda.id), tileId: el[13].id });
  const son = await bitti;
  const sonuc = (son.gameState && son.gameState.result) || oda.okey.roundState.result || {};
  assert.strictEqual(sonuc.winner, sira, 'son taşı atan eli bitirmeli');
  assert.strictEqual(sonuc.cezalar[sira], 0, 'bitirene ceza yazılmamalı');
  assert.ok(sonuc.cezalar[1 - sira] > 0, 'bitirmeyene kalan taşlarının cezası yazılmalı');
  console.log('  ✓ 4) işleme çalışıyor, uymayan taş reddediliyor, son atış eli bitiriyor');

  // ---------- 5) KLASİK OKEY DEĞİŞMEDİ ----------
  const b = await masaKur(BASE, rooms, 'okey', 2);
  acik.push(...b.soketler);
  assert.ok(!b.oda.okey.yeni101, 'klasik okey eski motorda kalmalı');
  const klasikEller = b.oda.okey.roundState.seats
    .map(s => b.oda.okey.roundState.hands[s].length).sort();
  assert.deepStrictEqual(klasikEller, [14, 15], 'klasik okeyde dağıtım 14/15 olarak KORUNMALI');
  for (const p of b.paketler) {
    assert.ok(p.gameState.kural === undefined, 'klasik pakette 101 alanları olmamalı');
    assert.ok(p.gameState.melds === undefined, 'klasik pakette masa alanı olmamalı');
  }
  console.log('  ✓ 5) klasik okey dokunulmadan duruyor (14/15, eski paket)');

  /* ---------- 6) ARAYÜZ: masa, El Aç ve kurallar yerinde ----------
     Sunucu doğru çalışsa bile arayüz eski kalırsa oyun oynanamaz; üç
     bağlantı noktası burada yazılı. */
  const istemci = fs.readFileSync(path.join(__dirname, '..', 'js', 'okey-online.js'), 'utf8');
  assert.ok(/function gercek101/.test(istemci), 'istemci gerçek 101 kuralını paketten anlamalı');
  assert.ok(/ok101-masa/.test(istemci), 'masadaki açık perler çizilmeli');
  assert.ok(/_ok101Ac/.test(istemci) && /_ok101Isle/.test(istemci),
    'El Aç ve işleme işleyicileri bulunmalı');
  assert.ok(/okFinishZone/.test(istemci) && /!gercek101\(gs\)/.test(istemci),
    '"ORTAYA BİTİR" bölgesi 101\'de çizilmemeli (bitiş ayrı eylem değil)');
  const acPenceresi = fs.readFileSync(path.join(__dirname, '..', 'js', 'okey101-ac.js'), 'utf8');
  assert.ok(/GVOkey101Ac/.test(acPenceresi), 'açma penceresi dışa açılmalı');
  const sayfa = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/js\/okey101-ac\.js/.test(sayfa), 'açma penceresi sayfaya bağlanmalı');
  assert.ok(/ok101-masa\{/.test(sayfa), 'masadaki perlerin stili olmalı');
  /* Kurallar metni OYUNUN kurallarını anlatmalı; eski metin "14 taşını
     101 puana ulaştır" diyordu ve artık yanlış. */
  assert.ok(/22<\/b>, diğerlerine <b>21/.test(sayfa), 'kurallar 22/21 dağıtımını anlatmalı');
  assert.ok(/toplamı en az 101/.test(sayfa), 'kurallar el açma eşiğini anlatmalı');
  assert.ok(/İşleme/.test(sayfa), 'kurallar işlemeyi anlatmalı');
  assert.ok(/ceza puanı/i.test(sayfa), 'kurallar ceza puanını anlatmalı');
  console.log('  ✓ 6) arayüz bağlantıları ve kurallar metni yeni oyuna göre');

  for (const s of acik) { try { s.close(); } catch (_) {} }
  server.close();
  console.log('OK 101 okey sunucu akışı: motor seçimi, paket, açma, işleme, klasik korundu');
  process.exit(0);
}
main().catch(e => { console.error('❌ 101 OKEY SUNUCU HATASI:', e); process.exit(1); });
