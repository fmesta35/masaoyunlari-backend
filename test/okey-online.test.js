'use strict';

/*
 * OKEY ONLINE — 4 gerçek oyunculu soket uçtan uca testleri.
 *
 *  A) #901 (4 kişilik özel oda, 2 el): hazırlık→başlama, kişiye özel dağıtım, HAZIRLANMIŞ kazanan el ile
 *     1. el bitişi (skor+1), ara bekleme sonrası 2. el, son elde maç 'completed'.
 *  B) #902: tur disiplini reddetmeleri (must_draw / not_your_turn / must_discard),
 *     önceki atıktan çekme, SIRA sayacı dolunca OTOMATİK OYNAMA, 3. strike'ta
 *     'disqualified' ile maç bitişi.
 *  C) #903: oyun ortasında oyuncu çıkınca 'player_left' bitiş + odanın
 *     evrensel sıfırlayıcıyla bekleme durumuna dönmesi (takılma yok).
 */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '1200';
process.env.GV_OKEY_ROUND_PAUSE_MS = '500';
process.env.GV_OKEY_MAX_ROUNDS = '2';

const assert = require('assert');
const http = require('http');
const ioClient = require('socket.io-client');

let uid = 0;
function T(n, c) { return { id: 't' + (uid++), n, c, isFJ: false }; }

// Gerçek okeyi (ro) içermeyen garanti geçerli 14 taş + 1 fazlalık (standard bitiş).
function craftWinning15(ro) {
  const nums = [1, 2, 3, 4, 5, 6, 7, 8].filter(n => n !== ro.n);
  const [a, b, c2, d, e] = nums;
  const cols = ['t-red', 't-black', 't-blue', 't-yellow'];
  const hand = [];
  cols.forEach(c => hand.push(T(a, c)));
  cols.forEach(c => hand.push(T(b, c)));
  cols.slice(0, 3).forEach(c => hand.push(T(c2, c)));
  cols.slice(0, 3).forEach(c => hand.push(T(d, c)));
  const extra = (ro.c === 't-red' && ro.n === e) ? T(e, 't-black') : T(e, 't-red');
  return { hand: [...hand, extra], extraId: extra.id };
}

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

function join(socket, roomId) {
  socket.emit('joinRoom', {
    roomId, gameId: 'okey', userName: socket.userName,
    userKey: 'test:' + socket.userName, maxPlayers: 4, durationMinutes: 10,
    // Özel odada el sayısı kurucudan gelir: bu süit 2 elli maç kurar.
    rounds: 2
  });
  return once(socket, 'joinedRoom');
}

// Dört oyunculu masayı kur, başlat, koltuk→soket haritası döndür.
async function setupMatch(BASE, roomId, tag) {
  const socks = [];
  for (let i = 0; i < 4; i++) socks.push(await connect(BASE, tag + '-' + i));
  const started = socks.map(s => once(s, 'gameStarted'));
  for (const s of socks) await join(s, roomId);
  for (const s of socks) s.emit('setReady', { ready: true });
  const payloads = await Promise.all(started);
  const bySeat = {};
  const states = {}; // koltuk → en güncel kişisel gameState
  payloads.forEach((p, i) => {
    bySeat[p.seat] = { socket: socks[i], state: p.gameState };
    states[p.seat] = p.gameState;
  });
  socks.forEach(s => {
    s.on('gameStateUpdated', p => { states[p.seat] = p.gameState; });
    s.on('okeyAutoPlayed', p => { states[p.seat] = p.gameState; });
    s.on('okeyRoundEnded', p => { states[p.seat] = p.gameState; });
    s.on('gameStarted', p => { states[p.seat] = p.gameState; });
    s.on('okeyRejected', () => { /* reddetmeler ayrıca doğrulanıyor */ });
  });
  return { socks, bySeat, states, first: payloads[0].gameState };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;

  // ============ A) Tam maç: 2 el, ikisi de hazırlanmış kazanç ============
  {
    const { socks, bySeat, first } = await setupMatch(BASE, '901', 'A');
    const room = rooms.get('901') || rooms.get(901);
    assert.ok(room, 'oda bulunmalı');
    const starterSeat = first.turn;

    // --- El 1: başlayana kazanan el ver, ortaya bitir ---
    const w1 = craftWinning15(first.realOkey);
    room.okey.roundState.hands[starterSeat] = w1.hand;
    const roundEnded1 = once(bySeat[starterSeat].socket, 'okeyRoundEnded');
    bySeat[starterSeat].socket.emit('okeyFinish', { tileId: w1.extraId });
    const re1 = await roundEnded1;
    assert.strictEqual(re1.gameState.finished, true, 'el bitti');
    assert.deepStrictEqual(re1.gameState.result, { winner: starterSeat, winType: 'standard' });
    assert.strictEqual(re1.gameState.scores[starterSeat], 1, 'skor +1');
    console.log('  ✓ A1) hazırlanmış el ortaya bitti → okeyRoundEnded + skor 1');

    // --- El 2: ara bekleme (500 ms) sonrası yeni dağıtım ---
    const gs2 = await once(bySeat[starterSeat].socket, 'gameStateUpdated');
    assert.strictEqual(gs2.gameState.round, 2, '2. el başladı');
    assert.strictEqual(gs2.gameState.scores[starterSeat], 1, 'skorlar ele taşındı');
    assert.strictEqual(gs2.gameState.deckCount, 48, 'yeni elde deste 48');

    // Son eli de bitir → maç 'completed'
    const starter2 = gs2.gameState.turn;
    const w2 = craftWinning15(gs2.gameState.realOkey);
    room.okey.roundState.hands[starter2] = w2.hand;
    const ge = await (async () => {
      const p = once(bySeat[starter2].socket, 'gameEnded');
      bySeat[starter2].socket.emit('okeyFinish', { tileId: w2.extraId });
      return p;
    })();
    assert.strictEqual(ge.reason, 'completed', 'son el bitince maç tamamlanır');
    const expectedWinner = (starter2 === starterSeat) ? starter2 : Math.min(starterSeat, starter2);
    assert.strictEqual(ge.winnerSeat, expectedWinner,
      'en yüksek skorlu kazanır (eşitlikte düşük koltuk)');
    console.log('  ✓ A2) 2. el bitti → maç completed, kazanan ilan edildi');

    for (const s of socks) s.disconnect();
    await sleep(300);
  }

  // ============ B) Tur disiplini + otomatik oynama + diskalifiye ============
  {
    const { socks, bySeat, states, first } = await setupMatch(BASE, '902', 'B');
    const order = first.seats.slice(); // [0,1,2,3]
    const turnSeat = first.turn;
    const nextSeat = order[(order.indexOf(turnSeat) + 1) % order.length];

    // B1) Başlayan (phase=discard) çekmeye kalkarsa reddedilir
    const rej1 = once(bySeat[turnSeat].socket, 'okeyRejected');
    bySeat[turnSeat].socket.emit('okeyDraw', { source: 'deck' });
    assert.strictEqual((await rej1).reason, 'must_discard', '15 taşla çekemez');
    console.log('  ✓ B1) must_discard reddi');

    // B2) Sırası olmayan atarsa reddedilir
    const rej2 = once(bySeat[nextSeat].socket, 'okeyRejected');
    bySeat[nextSeat].socket.emit('okeyDiscard', { tileId: 'x' });
    assert.strictEqual((await rej2).reason, 'not_your_turn');
    console.log('  ✓ B2) not_your_turn reddi');

    // B3) Başlayan atar → sıra geçer; atık herkese açık yığına düşer
    const thr = bySeat[turnSeat].state.myHand[0];
    const upd1 = once(bySeat[nextSeat].socket, 'gameStateUpdated');
    bySeat[turnSeat].socket.emit('okeyDiscard', { tileId: thr.id });
    const u1 = await upd1;
    assert.strictEqual(u1.gameState.turn, nextSeat, 'sıra geçti');
    assert.strictEqual(u1.gameState.phase, 'draw');
    assert.strictEqual(u1.gameState.discardPiles[turnSeat][0].id, thr.id, 'atık herkese açık');

    // B4) Sıra sahibi çekmeden atamaz (must_draw)
    const rej3 = once(bySeat[nextSeat].socket, 'okeyRejected');
    bySeat[nextSeat].socket.emit('okeyDiscard', { tileId: u1.gameState.myHand[0].id });
    assert.strictEqual((await rej3).reason, 'must_draw');
    console.log('  ✓ B3-B4) atık yayını + must_draw reddi');

    // B5) Önceki koltuğun atığını çeker → eline AYNI taş gelir
    const upd2 = once(bySeat[nextSeat].socket, 'gameStateUpdated');
    bySeat[nextSeat].socket.emit('okeyDraw', { source: 'prev' });
    const u2 = await upd2;
    assert.strictEqual(u2.gameState.myHand.length, 15, 'çekince el 15');
    assert.ok(u2.gameState.myHand.some(t => t.id === thr.id), 'çekilen taş = önceki atık');
    assert.strictEqual(u2.gameState.discardPiles[turnSeat].length, 0, 'yığından düştü');
    console.log('  ✓ B5) önceki atıktan çekme (taş kimliği korunuyor)');

    // B6) AFK senaryosu: nextSeat hiç oynamaz (15 taşı var, atması lazım);
    // diğer 3 koltuk sıraları gelince hemen oynar. AFK her turunda strike alır,
    // 3. strike'ta maç 'disqualified' ile biter.
    const afkSeat = nextSeat;
    const helpers = order.filter(x => x !== afkSeat);
    const autoCount = { n: 0 };
    socks[0].on('okeyAutoPlayed', () => { autoCount.n++; });
    const endedP = once(socks[0], 'gameEnded', 30000);
    const t0 = Date.now();
    while (Date.now() - t0 < 25000) {
      for (const seat of helpers) {
        try {
          const g = states[seat];
          if (!g || g.status !== 'playing' || g.finished) continue;
          if (g.turn !== seat) continue;
          if (g.phase === 'draw') {
            bySeat[seat].socket.emit('okeyDraw', { source: 'deck' });
            await sleep(60);
            const g2 = states[seat];
            if (g2 && g2.turn === seat && g2.phase === 'discard') {
              bySeat[seat].socket.emit('okeyDiscard', { tileId: g2.myHand[0].id });
            }
          } else if (g.phase === 'discard') {
            bySeat[seat].socket.emit('okeyDiscard', { tileId: g.myHand[0].id });
          }
        } catch (e) { /* sıra yarışı — zararsız */ }
        await sleep(40);
      }
      const st = states[helpers[0]];
      if (st && st.matchResult) break;
      await sleep(120);
    }
    const fin = await endedP;
    assert.strictEqual(fin.reason, 'disqualified', '3 strike = diskalifiye');
    assert.strictEqual(fin.loserSeat, afkSeat, 'AFK oyuncu kaybetti');
    assert.ok(autoCount.n >= 1, 'otomatik oynama yayını geldi');
    console.log(`  ✓ B6) SIRA dolunca otomatik oyna ×${autoCount.n}, 3. strike → disqualified`);

    for (const s of socks) s.disconnect();
    await sleep(300);
  }

  // ============ C) Oyuncu terki → player_left + oda beklemeye döner ============
  {
    const { socks } = await setupMatch(BASE, '903', 'C');
    const ended = once(socks[0], 'gameEnded');
    socks[2].emit('leaveRoom'); // 🚪 Ayrıl düğmesi akışı (disconnect 30 sn yeniden-bağlanma payı tanır)
    const ge = await ended;
    assert.strictEqual(ge.reason, 'player_left', 'terk edince maç player_left biter');
    assert.ok(typeof ge.winnerSeat === 'number', 'kalanlardan lider kazanır');
    assert.strictEqual(ge.youWon, ge.seat === ge.winnerSeat, 'youWon kişiye özel');
    await sleep(900); // POST_GAME_HOLD_MS=400 + sıfırlama payı
    const roomNow = await httpRooms(BASE, 'okey').then(rs => rs.find(r => String(r.id) === '903'));
    assert.strictEqual(roomNow.status, 'waiting', 'oda beklemeye döndü (takılma yok)');
    assert.strictEqual(roomNow.players, 3, 'kalan 3 oyuncu odada');
    console.log('  ✓ C1) player_left bitiş + oda evrensel sıfırlayıcıyla beklemeye döndü');

    for (const s of socks) if (s.connected) s.disconnect();
    await sleep(300);
  }

  server.close();
  console.log('OK okey online regressions');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY ONLINE HATASI:', err); process.exit(1); });
