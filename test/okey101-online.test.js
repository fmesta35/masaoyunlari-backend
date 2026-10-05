'use strict';

/*
 * OKEY 101 ONLINE — sunucu yetkili uçtan uca testleri.
 *  A) Lobide okey101 hazır masaları (#331-#336) tohumlanır; klasik okey
 *     masaları (#301-#318) etkilenmez.
 *  B) 4 kişilik maç: istemciye variant='okey101' + target=101 gider;
 *     hazırlanmış 101 eli bitince skor = gained (rakiplerin kalan el
 *     puanı) ve 101 puan MAÇI BİTİRİR ('completed').
 *  C) 2 kişilik maç: düşük gained (< 101) maç DEVAM ETTİRİR (2. el),
 *     101 puana ulaşınca biter. 2. el de 101 varyantıyla kurulur.
 *  D) 101 altı el 'not_101' ile reddedilir; el devam eder.
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '5000';
process.env.GV_OKEY_ROUND_PAUSE_MS = '400';

const assert = require('assert');
const http = require('http');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpRooms(url, gameId) {
  return new Promise((resolve, reject) => {
    http.get(url + '/api/rooms?gameId=' + gameId, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body).rooms || []); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function connect(url, name) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + name)), 8000);
    socket.on('connect', () => { clearTimeout(t); socket.userName = name; resolve(socket); });
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 9000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

// GERÇEKTEN GEÇERLİ 14 taş (dört küme: 13×4, 12×4, 11×3, 10×3 — aynı sayı
// farklı renk) + 1 fazlalık = 15 taşlık garantili 101 eli. Toplam = 163.
// (Düzeltme: eskiden 14 ADET AYNI taş kullanılıyordu — bu, meld/seri
// GEÇERLİLİĞİ artık arandığı için hem geçersiz bir per/seri olurdu HEM DE
// yanlışlıkla "7 çift" gibi okunurdu; bkz. okey-engine.js finish().)
const GROUP_COLORS = ['t-red', 't-black', 't-blue', 't-yellow'];
function craft101Hand(prefix) {
  const hand = [];
  let idc = 0;
  [[13, 4], [12, 4], [11, 3], [10, 3]].forEach(([n, size]) => {
    for (let i = 0; i < size; i++) {
      hand.push({ id: (prefix || 'big') + '-' + (idc++), n, c: GROUP_COLORS[i], isFJ: false, isOkey: false });
    }
  });
  const extra = { id: (prefix || 'big') + '-extra', n: 1, c: 't-black', isFJ: false, isOkey: false };
  hand.push(extra);
  return { hand, extraId: extra.id };
}

// GEÇERLİ ama DÜŞÜK toplamlı 14 taş (dört küme: 1×4, 2×4, 3×3, 4×3) + 1
// fazlalık — "geçerli per/seri ama 101'in altı" durumunu (not_101) test
// etmek için. Toplam = 33.
function craftLow101Hand(prefix) {
  const hand = [];
  let idc = 0;
  [[1, 4], [2, 4], [3, 3], [4, 3]].forEach(([n, size]) => {
    for (let i = 0; i < size; i++) {
      hand.push({ id: (prefix || 'low') + '-' + (idc++), n, c: GROUP_COLORS[i], isFJ: false, isOkey: false });
    }
  });
  const extra = { id: (prefix || 'low') + '-extra', n: 5, c: 't-yellow', isFJ: false, isOkey: false };
  hand.push(extra);
  return { hand, extraId: extra.id };
}

// 14 taş, toplamı tam `total` (testlerde gained'i deterministik kılar).
function knownHand(prefix, seat, total) {
  const out = [];
  let left = total;
  for (let i = 0; i < 13; i++) {
    const v = Math.max(1, Math.min(13, left - (13 - i)));
    out.push({ id: prefix + '-' + seat + '-' + i, n: v, c: 't-blue', isFJ: false, isOkey: false });
    left -= v;
  }
  out.push({ id: prefix + '-' + seat + '-13', n: left, c: 't-blue', isFJ: false, isOkey: false });
  return out;
}

function join101(socket, roomId, nPlayers) {
  socket.emit('joinRoom', {
    roomId,
    gameId: 'okey101',
    userName: socket.userName,
    userKey: 'test:' + socket.userName,
    maxPlayers: nPlayers,
    durationMinutes: 10
  });
  return once(socket, 'joinedRoom');
}

async function setup101Match(BASE, roomId, tag, nPlayers) {
  const socks = [];
  for (let i = 0; i < nPlayers; i++) socks.push(await connect(BASE, tag + '-' + i));
  const started = socks.map(s => once(s, 'gameStarted'));
  for (const s of socks) await join101(s, roomId, nPlayers);
  for (const s of socks) s.emit('setReady', { ready: true });
  const payloads = await Promise.all(started);
  const bySeat = {};
  payloads.forEach((p, i) => { bySeat[p.seat] = { socket: socks[i], state: p.gameState }; });
  return { socks, bySeat, first: payloads[0].gameState };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;

  // ============ A) Lobi: okey101 hazır masaları ============
  {
    const l101 = await httpRooms(BASE, 'okey101');
    assert.ok(l101.length >= 6, 'okey101 hazır masalar lobide (>=6)');
    assert.ok(l101.some(r => String(r.id) === '331' && r.maxPlayers === 2), '2 kişilik masa #331');
    assert.ok(l101.some(r => String(r.id) === '336' && r.maxPlayers === 4 && r.duration === 20), '4 kişilik 20 dk masa #336');
    // 101 masasında EL ROZETİ YOK (maç el sayısıyla bitmez):
    assert.ok(l101.every(r => !r.rounds), 'okey101 lobisinde "El" rozeti yok');
    const lokey = await httpRooms(BASE, 'okey');
    assert.strictEqual(lokey.length, 18, 'klasik okey 18 hazır masası etkilenmedi');
    console.log('  ✓ A) lobi: okey101 6 hazır masa (#331-#336), klasik okey 18 masa aynen');
  }

  // ============ B) 4 kişilik: variant + 101 bitiş → MAÇ biter ============
  /* ----------------------------------------------------------------------
   * B) GERÇEK 101 KURALLARI
   * B/C/D bölümleri eskiden "14 taşın toplamı 101'i geçince okeyFinish ile
   * bit, en YÜKSEK puan kazanır" oyununu ölçüyordu. O oyun artık yok:
   * 101 Okey gerçek kurallarına geçti (22/21 taş, 101 ile açma, masaya per
   * koyma, işleme) ve puanlar CEZA — maçı en DÜŞÜK toplam kazanıyor.
   * Eski senaryoların karşılığı kalmadığı için burası yeniden yazıldı.
   * Kural ayrıntıları test/okey101-motor.test.js'te, uçtan uca akış
   * test/okey101-sunucu.test.js'te ölçülüyor; burada paketin istemciye
   * doğru gittiği ve maç sonunun ceza mantığıyla işlediği doğrulanıyor.
   * -------------------------------------------------------------------- */
  {
    const { socks, bySeat, first } = await setup101Match(BASE, '911', 'B', 4);
    const room = rooms.get('911');
    assert.ok(room, 'oda bulunmalı');
    assert.strictEqual(first.variant, 'okey101', 'istemciye variant=okey101 gider');
    assert.strictEqual(first.kural, '101', 'istemciye gerçek 101 kuralı bildirilir');
    assert.strictEqual(first.cezaSiniri, 101, 'istemciye ceza sınırı gider');
    assert.strictEqual(first.acmaPuani, 101, 'istemciye el açma eşiği gider');
    assert.strictEqual(first.maxRounds, 99, 'güvenlik el limiti 99 (UI değil kural)');
    assert.strictEqual(room.okey.variant, 'okey101', 'oda varyantı okey101');
    assert.strictEqual(room.okey.yeni101, true, '101 masası yeni motorda olmalı');

    const eller = room.okey.roundState.seats
      .map(s => room.okey.roundState.hands[s].length).sort((a, b) => a - b);
    assert.deepStrictEqual(eller, [21, 21, 21, 22], '4 kişide dağıtım 22/21/21/21');
    assert.ok(Array.isArray(first.melds) && first.melds.length === 0, 'el başında masa boş');
    console.log('  ✓ B) 4 kişilik: gerçek 101 motoru, 22/21 dağıtım, masa paketi');

    /* MAÇ SONU: ceza sınırına ulaşan varsa maç biter ve EN DÜŞÜK toplam
       kazanır. Skorları doğrudan kurup son eli bitirerek ölçüyoruz. */
    const seats = room.okey.roundState.seats;
    const sira0 = room.okey.roundState.turn;
    /* Bitiren oyuncuya ceza yazılmaz; sıralamayı ona göre kuruyoruz.
       Kazanması gereken, bitiren DEĞİL en düşük toplama sahip olan. */
    const kazanacak = seats.find(s => s !== sira0);
    seats.forEach(s => { room.okey.roundState.scores[s] = 60; });
    room.okey.roundState.scores[kazanacak] = 5;
    room.okey.roundState.scores[sira0] = 105;         // ceza sınırını aşan
    const bitti = socks.map(x => once(x, 'gameEnded', 12000));
    // Sırası gelen oyuncunun elini bitir: açmış say, tek taş bırak, at.
    const sira = sira0;
    room.okey.roundState.opened[sira] = true;
    const kalanTas = room.okey.roundState.hands[sira][0];
    room.okey.roundState.hands[sira] = [kalanTas];
    /* Bitirmeyenlerin ellerini de sadeleştiriyoruz: 21 taşlık el, ceza
       puanını yüzlerce yapıp kurduğumuz sıralamayı bozuyordu. Herkes
       açmış sayılır ki ceza ikiye katlanmasın. */
    room.okey.roundState.seats.forEach(s2 => {
      if (s2 === sira) return;
      room.okey.roundState.opened[s2] = true;
      room.okey.roundState.hands[s2] = [room.okey.roundState.hands[s2][0]];
    });
    room.okey.roundState.phase = 'discard';
    bySeat[sira].socket.emit('okeyDiscard', { roomId: '911', tileId: kalanTas.id });
    const ge = (await Promise.all(bitti))[0];
    assert.strictEqual(ge.reason, 'completed', 'ceza sınırına ulaşılınca maç biter');
    assert.strictEqual(ge.winnerSeat, kazanacak, 'EN DÜŞÜK ceza toplamı kazanır');
    socks.forEach(x => x.close());
    console.log('  ✓ C) maç ceza sınırında bitiyor ve en düşük toplam kazanıyor');
  }

  server.close();
  console.log('✅ OKEY101-ONLINE: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY101 ONLINE HATASI:', err); process.exit(1); });
