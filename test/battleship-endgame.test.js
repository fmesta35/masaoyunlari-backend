'use strict';
/*
 * AMİRAL BATTI — MAÇ BİTİŞ YOLLARI (kullanıcı hata raporu)
 *
 *  Rapor: "rakip oyundan çıktı, hamle süresi de bitti; buna rağmen oyun
 *  sonlanıp lobiye yönlendirmedi."
 *
 *  Kök neden: server.js'teki terk (player_left) dalında oyun listesinde
 *  `room.battleship` YOKTU. Oda bu yüzden resetRoomToWaiting()'e düşüyor,
 *  status 'waiting' oluyordu; o andan sonra hamle süresi denetimi de
 *  (status !== 'playing' -> continue) hiç çalışmıyor, sayaç 0'da donuyordu.
 *  Yani tek eksik satır İKİ belirtiyi birden üretiyordu.
 *
 *  Bu test dört bitiş yolunu da kilitler: yerleştirme zaman aşımı (tek ve
 *  çift taraflı), muharebe fazı hamle zaman aşımı, ve terk.
 */
process.env.GV_MOVE_WARN_MS = '400';
process.env.GV_MOVE_FORFEIT_MS = '1500';
// Yerleştirme artık AYRI bir bütçe (canlıda 90 sn); testte kısaltılır.
process.env.GV_BATTLESHIP_PLACE_MS = '2500';

const assert = require('assert');
const io = require('socket.io-client');
const srv = require('../server');

const wait = (s, e, t = 8000) => new Promise((ok, no) => {
  const x = setTimeout(() => no(Error('timeout ' + e)), t);
  s.once(e, p => { clearTimeout(x); ok(p); });
});
const con = (u, n) => new Promise((ok, no) => {
  const s = io(u, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.once('connect', () => { s.n = n; ok(s); });
  s.once('connect_error', no);
});
function waitFor(s, event, pred, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { s.off(event, h); reject(new Error('timeout waiting for ' + event)); }, timeoutMs || 8000);
    function h(p) { if (!pred || pred(p)) { clearTimeout(t); s.off(event, h); resolve(p); } }
    s.on(event, h);
  });
}
const fleet = () => ([
  { shipId: 'carrier', r: 0, c: 0, dir: 'h' },
  { shipId: 'battleship', r: 1, c: 0, dir: 'h' },
  { shipId: 'cruiser', r: 2, c: 0, dir: 'h' },
  { shipId: 'submarine', r: 3, c: 0, dir: 'h' },
  { shipId: 'destroyer', r: 4, c: 0, dir: 'h' }
]);

async function masaKur(url, id) {
  const a = await con(url, id + 'A'), b = await con(url, id + 'B');
  const ja = wait(a, 'joinedRoom'), jb = wait(b, 'joinedRoom');
  const payload = x => ({ roomId: id, gameId: 'battleship', maxPlayers: 2, userName: x.n, userKey: 'bs:' + x.n, durationMinutes: 10 });
  a.emit('joinRoom', payload(a)); b.emit('joinRoom', payload(b));
  await Promise.all([ja, jb]);
  const ga = wait(a, 'gameStarted'), gb = wait(b, 'gameStarted');
  a.emit('setReady', { ready: true }); b.emit('setReady', { ready: true });
  const [pa, pb] = await Promise.all([ga, gb]);
  return { a, b, seatA: pa.seat, seatB: pb.seat };
}

async function main() {
  await srv.start(0);
  const url = 'http://127.0.0.1:' + srv.server.address().port;

  // ---- 1) İki taraf da filosunu yerleştirmezse: masa iptal edilir ----
  {
    const { a, b } = await masaKur(url, 'bs-end-1');
    const [ea, eb] = await Promise.all([wait(a, 'gameEnded'), wait(b, 'gameEnded')]);
    assert.strictEqual(ea.reason, 'placement_timeout');
    assert.strictEqual(eb.reason, 'placement_timeout');
    assert.strictEqual(ea.winnerSeat, null, 'iki taraf da yerleştirmediyse kazanan yok');
    a.disconnect(); b.disconnect();
    console.log('  ✓ 1) iki taraf da filosunu dizmezse masa iptal (placement_timeout, kazanan yok)');
  }

  // ---- 2) Yalnız biri yerleştirirse: yerleştiren hükmen kazanır ----
  {
    const { a, b, seatA } = await masaKur(url, 'bs-end-2');
    a.emit('battleshipPlace', { roomId: 'bs-end-2', placements: fleet() });
    const [ea, eb] = await Promise.all([wait(a, 'gameEnded'), wait(b, 'gameEnded')]);
    assert.strictEqual(ea.reason, 'placement_timeout');
    assert.strictEqual(ea.winnerSeat, seatA, 'filosunu dizen taraf kazanır');
    assert.strictEqual(ea.youWon, true);
    assert.strictEqual(eb.youWon, false);
    a.disconnect(); b.disconnect();
    console.log('  ✓ 2) yalnız biri dizerse o kazanır (placement_timeout)');
  }

  // ---- 3) Muharebe fazında sırası gelen ateş etmezse: hükmen mağlup ----
  {
    const id = 'bs-end-3';
    const { a, b } = await masaKur(url, id);
    const battleA = waitFor(a, 'gameStateUpdated', p => p.gameState.phase === 'battle');
    const battleB = waitFor(b, 'gameStateUpdated', p => p.gameState.phase === 'battle');
    a.emit('battleshipPlace', { roomId: id, placements: fleet() });
    b.emit('battleshipPlace', { roomId: id, placements: fleet() });
    const [sa] = await Promise.all([battleA, battleB]);
    const turnSeat = sa.gameState.turn;                 // sırası gelen ateş ETMEYECEK
    const [ea, eb] = await Promise.all([wait(a, 'gameEnded'), wait(b, 'gameEnded')]);
    assert.strictEqual(ea.reason, 'move_timeout');
    assert.strictEqual(ea.winnerSeat, turnSeat === 0 ? 1 : 0, 'süreyi dolduran değil, rakibi kazanır');
    a.disconnect(); b.disconnect();
    console.log('  ✓ 3) muharebede süresinde ateş etmeyen hükmen mağlup (move_timeout)');
  }

  // ---- 4) ASIL HATA: rakip masayı terk ederse maç HEMEN biter ----
  {
    const id = 'bs-end-4';
    const { a, b, seatA } = await masaKur(url, id);
    const battleA = waitFor(a, 'gameStateUpdated', p => p.gameState.phase === 'battle');
    const battleB = waitFor(b, 'gameStateUpdated', p => p.gameState.phase === 'battle');
    a.emit('battleshipPlace', { roomId: id, placements: fleet() });
    b.emit('battleshipPlace', { roomId: id, placements: fleet() });
    await Promise.all([battleA, battleB]);

    const sonA = wait(a, 'gameEnded', 4000);
    b.emit('leaveRoom');                                // rakip "Ayrıl" dedi
    const ea = await sonA;
    assert.strictEqual(ea.reason, 'player_left', 'terk eden olunca sebep player_left olmalı');
    assert.strictEqual(ea.winnerSeat, seatA, 'masada kalan kazanır');
    assert.strictEqual(ea.youWon, true, 'kalan oyuncu "kazandınız" görmeli');
    assert.ok(ea.gameState && ea.gameState.kind === 'battleship', 'bitiş paketi amiral battı durumu taşımalı');
    a.disconnect(); b.disconnect();
    console.log('  ✓ 4) rakip terk edince maç anında biter (player_left) — asıl hata');
  }

  // ---- 5) Terkin ardından oda yeniden 'waiting'e DÜŞMEMELİ ----
  // Asıl hatanın ikinci belirtisi buydu: oda waiting'e düşünce hamle süresi
  // denetimi de duruyor (status !== 'playing' -> continue) ve sayaç 0'da
  // donuyordu. Bitiş 'finished' olmalı ki sonuç ekranı + sıfırlama işlesin.
  {
    const id = 'bs-end-5';
    const { a, b } = await masaKur(url, id);
    const battleA = waitFor(a, 'gameStateUpdated', p => p.gameState.phase === 'battle');
    const battleB = waitFor(b, 'gameStateUpdated', p => p.gameState.phase === 'battle');
    a.emit('battleshipPlace', { roomId: id, placements: fleet() });
    b.emit('battleshipPlace', { roomId: id, placements: fleet() });
    await Promise.all([battleA, battleB]);
    const odaSon = waitFor(a, 'roomUpdated', p => p.status === 'finished', 4000);
    b.emit('leaveRoom');
    const oda = await odaSon;
    assert.strictEqual(oda.status, 'finished', 'terk sonrası oda finished olmalı (waiting DEĞİL)');
    a.disconnect(); b.disconnect();
    console.log('  ✓ 5) terk sonrası oda "finished" — sessizce waiting\'e düşmüyor');
  }

  // ---- 6) Yerleştirmede geçen süre İLK HAMLEDEN düşülmemeli ----
  // Hata: hamle saati maç başında başlıyordu; yerleştirme hamle süresinden
  // uzun sürdüğünde muharebe başlar başlamaz sırası gelen oyuncu daha ilk
  // atışını yapamadan hükmen mağlup oluyordu. Hamle saati artık faz
  // 'battle'a geçtiği anda sıfırlanır.
  {
    const id = 'bs-end-6';
    const { a, b } = await masaKur(url, id);
    // Hamle süresinden (1500 ms) DAHA UZUN bekle, ama yerleştirme
    // süresini (2500 ms) aşma:
    await new Promise(r => setTimeout(r, 1900));
    const battleA = waitFor(a, 'gameStateUpdated', p => p.gameState.phase === 'battle');
    a.emit('battleshipPlace', { roomId: id, placements: fleet() });
    b.emit('battleshipPlace', { roomId: id, placements: fleet() });
    await battleA;
    // Muharebe başladıktan sonra, hamle süresi kadar bekle: maç BİTMEMELİ.
    let erkenBitis = null;
    a.once('gameEnded', p => { erkenBitis = p; });
    await new Promise(r => setTimeout(r, 1200));
    assert.strictEqual(erkenBitis, null,
      'yerleştirmede geçen süre yüzünden ilk hamlede hükmen mağlubiyet OLMAMALI');
    a.disconnect(); b.disconnect();
    console.log('  ✓ 6) hamle saati muharebe başlayınca sıfırlanıyor (yerleştirme süresi hamleden düşülmüyor)');
  }

  srv.server.close();
  console.log('OK amiral battı bitiş yolları: yerleştirme/hamle zaman aşımı + terk + saat sıfırlama');
}
main().catch(e => { console.error(e); try { srv.server.close(); } catch (_) {} process.exit(1); });
