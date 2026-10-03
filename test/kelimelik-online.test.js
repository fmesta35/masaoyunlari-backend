'use strict';
/* KELİMELİK — ÇEVRİM İÇİ MASA (sunucu yetkili).
   Masa açılışı, ıstakanın gizliliği, hamle doğrulaması, sözlük reddi,
   pas / harf değiştir / karıştır, süre aşımında pas, otomatik pas ve
   ayrılan oyuncunun hükmen mağlup olması burada doğrulanır. */
const assert = require('assert');
const io = require('socket.io-client');
const srv = require('../server');

function conn(url, name) {
  const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((ok, no) => { s.once('connect', () => { s.name = name; ok(s); }); s.once('connect_error', no); });
}
const once = (s, e, ms) => new Promise((ok, no) => {
  const t = setTimeout(() => no(Error('timeout ' + e)), ms || 6000);
  s.once(e, x => { clearTimeout(t); ok(x); });
});
const bekle = ms => new Promise(r => setTimeout(r, ms || 150));

async function masaAc(url, id, sure) {
  const a = await conn(url, 'klA'), b = await conn(url, 'klB');
  const ja = once(a, 'joinedRoom'), jb = once(b, 'joinedRoom');
  const ortak = { roomId: id, gameId: 'kelimelik', maxPlayers: 2, durationMinutes: sure || 15 };
  a.emit('joinRoom', Object.assign({ userName: a.name, userKey: 'test:' + a.name }, ortak));
  b.emit('joinRoom', Object.assign({ userName: b.name, userKey: 'test:' + b.name }, ortak));
  await Promise.all([ja, jb]);
  const ga = once(a, 'gameStarted'), gb = once(b, 'gameStarted');
  a.emit('setReady', { ready: true }); b.emit('setReady', { ready: true });
  const [pa, pb] = await Promise.all([ga, gb]);
  return { a, b, pa, pb };
}

async function main() {
  await srv.start(0);
  const url = 'http://127.0.0.1:' + srv.server.address().port;
  const rooms = srv.rooms;

  // ---------- 1) masa açılışı + durum paketi ----------
  {
    const { a, b, pa, pb } = await masaAc(url, 'kl-1');
    assert.strictEqual(pa.gameState.kind, 'kelimelik');
    assert.strictEqual(pa.gameState.board.length, 15);
    assert.strictEqual(pa.gameState.bag, 100 - 14, 'torbada 86 taş kalmalı');
    assert.strictEqual(pa.gameState.rack.length, 7, 'kendi ıstakası gelmeli');
    assert.deepStrictEqual(pa.gameState.rackCounts, [7, 7]);
    assert.ok(pa.gameState.bonus && pa.gameState.bonus[7][7] === 'merkez', 'bonus düzeni gelmeli');
    // RAKİBİN ISTAKASI PAKETTE OLMAMALI
    assert.notDeepStrictEqual(pa.gameState.rack, pb.gameState.rack);
    assert.ok(!('racks' in pa.gameState), 'iki ıstaka birden gönderilmemeli');
    assert.ok(!('bagTiles' in pa.gameState), 'torbanın içeriği gönderilmemeli');
    assert.strictEqual(pa.gameState.turnLimitMs, 60000, '15 dk masa → 60 sn hamle');
    a.disconnect(); b.disconnect();
  }

  // ---------- 2) masa tipi hamle süresini belirler ----------
  {
    const { a, b, pa } = await masaAc(url, 'kl-hizli', 10);
    assert.strictEqual(pa.gameState.turnLimitMs, 30000, '10 dk masa → 30 sn hamle');
    a.disconnect(); b.disconnect();
  }
  {
    const { a, b, pa } = await masaAc(url, 'kl-dusunen', 20);
    assert.strictEqual(pa.gameState.turnLimitMs, 90000, '20 dk masa → 90 sn hamle');
    a.disconnect(); b.disconnect();
  }

  // ---------- 3) sıra ve hamle doğrulaması ----------
  {
    const { a, b } = await masaAc(url, 'kl-2');
    const oda = rooms.get('kl-2');
    // sırası olmayan oynayamaz
    const red = once(b, 'kelimelikRejected');
    b.emit('kelimelikMove', { roomId: 'kl-2', konumlar: [{ r: 7, c: 7, harf: 'A' }] });
    assert.strictEqual((await red).reason, 'not_your_turn');

    // ıstakada olmayan harf reddedilir
    oda.kelimelik.racks[0] = ['K', 'E', 'D', 'İ', 'A', 'L', 'M'];
    const red2 = once(a, 'kelimelikRejected');
    a.emit('kelimelikMove', { roomId: 'kl-2', konumlar: [{ r: 7, c: 7, harf: 'Z' }, { r: 7, c: 8, harf: 'Z' }] });
    assert.strictEqual((await red2).reason, 'istakanda_yok');

    // sözlükte olmayan kelime reddedilir ve KELİMELER geri gönderilir
    const red3 = once(a, 'kelimelikRejected');
    a.emit('kelimelikMove', { roomId: 'kl-2', konumlar: [{ r: 7, c: 7, harf: 'K' }, { r: 7, c: 8, harf: 'M' }] });
    const r3 = await red3;
    assert.strictEqual(r3.reason, 'sozlukte_yok');
    assert.deepStrictEqual(r3.kelimeler, ['KM'], 'reddedilen kelime Kelime Bildir için dönmeli');

    // geçerli hamle: KEDİ merkezden → 12 puan
    const gu = once(a, 'gameStateUpdated');
    a.emit('kelimelikMove', { roomId: 'kl-2', konumlar: [
      { r: 7, c: 7, harf: 'K' }, { r: 7, c: 8, harf: 'E' },
      { r: 7, c: 9, harf: 'D' }, { r: 7, c: 10, harf: 'İ' }] });
    const s = (await gu).gameState;
    assert.strictEqual(s.scores[0], 12, 'merkez kelime×2');
    assert.strictEqual(s.turn, 1, 'sıra rakibe geçmeli');
    assert.strictEqual(s.board[7][7].harf, 'K');
    assert.strictEqual(s.rack.length, 7, 'ıstaka yeniden dolmalı');
    assert.strictEqual(s.bag, 100 - 14 - 4);
    a.disconnect(); b.disconnect();
  }

  // ---------- 4) pas, diskalifiye ve harf değiştir ----------
  {
    const { a, b } = await masaAc(url, 'kl-3');
    const oda = rooms.get('kl-3');
    a.emit('kelimelikPass', { roomId: 'kl-3' });
    await bekle();
    assert.strictEqual(oda.kelimelik.passStreak[0], 1);
    assert.strictEqual(oda.kelimelik.turn, 1);

    // harf değiştir: pas sayacını sıfırlar, sıra geçer, torba korunur
    const torbaOnce = oda.kelimelik.bag.length;
    b.emit('kelimelikSwap', { roomId: 'kl-3', indeksler: [0, 1] });
    await bekle();
    assert.strictEqual(oda.kelimelik.passStreak[1], 0, 'değişim pas sayılmaz');
    assert.strictEqual(oda.kelimelik.bag.length, torbaOnce, 'torbadaki toplam korunmalı');
    assert.strictEqual(oda.kelimelik.racks[1].length, 7);
    assert.strictEqual(oda.kelimelik.turn, 0);

    // karıştır: sıra GEÇMEZ, yalnız kendi ıstakası değişir
    const sira = oda.kelimelik.turn;
    const p3 = once(a, 'gameStateUpdated');
    a.emit('kelimelikShuffle', { roomId: 'kl-3' });
    const s3 = (await p3).gameState;
    assert.strictEqual(s3.turn, sira, 'karıştır sırayı geçirmemeli');
    assert.strictEqual(s3.rack.length, 7);

    // üst üste 3 pas → diskalifiye, rakip hükmen kazanır
    oda.kelimelik.passStreak = [2, 0];
    oda.kelimelik.totalPasses = 0;
    oda.kelimelik.turn = 0;
    oda.kelimelik.scores = [40, 10];
    const bit = once(a, 'gameEnded');
    a.emit('kelimelikPass', { roomId: 'kl-3' });
    const e = await bit;
    assert.strictEqual(e.reason, 'pass_disqualify');
    assert.strictEqual(e.winnerSeat, 1, 'rakip hükmen kazanmalı');
    assert.strictEqual(e.youWon, false);
    assert.strictEqual(e.gameState.scores[0], 0, 'diskalifiye olanın puanı silinmeli');
    a.disconnect(); b.disconnect();
  }

  // ---------- 5) süresi dolan oyuncu PAS sayılır (hükmen mağlup olmaz) ----------
  {
    const { a, b } = await masaAc(url, 'kl-4');
    const oda = rooms.get('kl-4');
    const pas = once(a, 'kelimelikAutoPass', 8000);
    oda.moveStartedAt = Date.now() - 999999;      // süreyi doldur
    const p = await pas;
    assert.strictEqual(p.seat, 0);
    assert.strictEqual(p.sure, true, 'süre aşımı pas olarak işaretlenmeli');
    assert.strictEqual(oda.status, 'playing', 'süre aşımı maçı BİTİRMEMELİ');
    assert.strictEqual(oda.kelimelik.passStreak[0], 1);
    assert.strictEqual(oda.kelimelik.turn, 1, 'sıra rakibe geçmeli');
    a.disconnect(); b.disconnect();
  }

  // ---------- 6) hamle yoksa OTOMATİK PAS (oyuncu atılmaz) ----------
  {
    const { a, b } = await masaAc(url, 'kl-5');
    const oda = rooms.get('kl-5');
    oda.kelimelik.bag = [];
    oda.kelimelik.racks[0] = ['Ğ', 'Ğ'];
    oda.kelimelik.racks[1] = ['K', 'E', 'D', 'İ'];
    oda.kelimelik.turn = 0;
    const oto = once(a, 'kelimelikAutoPass', 8000);
    // rakibin hamlesi sırayı 0'a getirsin → otomatik pas devreye girer
    oda.kelimelik.turn = 1;
    const gu = once(b, 'gameStateUpdated', 8000);
    b.emit('kelimelikPass', { roomId: 'kl-5' });
    const p = await oto;
    assert.strictEqual(p.seat, 0, 'hamlesi olmayan oyuncu otomatik pas geçmeli');
    await gu;
    assert.strictEqual(oda.status, 'playing', 'otomatik pas maçı bitirmemeli');
    assert.ok(oda.players.some(x => x.seat === 0), 'oyuncu masadan ATILMAMALI');
    a.disconnect(); b.disconnect();
  }

  // ---------- 7) oyun sürerken ayrılan hükmen mağlup olur ----------
  {
    const { a, b } = await masaAc(url, 'kl-6');
    const bit = once(b, 'gameEnded', 8000);
    a.emit('leaveRoom');
    const e = await bit;
    assert.strictEqual(e.reason, 'player_left');
    assert.strictEqual(e.youWon, true, 'kalan oyuncu kazanmalı');
    assert.strictEqual(e.gameState.kind, 'kelimelik', 'bitiş paketinde kelimelik durumu olmalı');
    b.disconnect();
  }

  // ---------- 8) izleyici: ıstaka gelmez ----------
  {
    const { a, b } = await masaAc(url, 'kl-7');
    const c = await conn(url, 'klİzleyici');
    /* Dinleyici joinRoom'dan ÖNCE kurulmalı: sunucu oynanan masanın
       anlık görüntüsünü joinedRoom ile aynı işlemde yolluyor. */
    const g0 = once(c, 'gameStarted', 8000);
    const j = once(c, 'joinedRoom');
    c.emit('joinRoom', { roomId: 'kl-7', gameId: 'kelimelik', maxPlayers: 2,
      userName: c.name, userKey: 'test:izleyici', durationMinutes: 15, asSpectator: true });
    await j;
    const g = await g0;
    assert.strictEqual(g.isSpectator, true);
    assert.deepStrictEqual(g.gameState.rack, [], 'izleyiciye ıstaka gönderilmemeli');
    assert.deepStrictEqual(g.gameState.rackCounts, [7, 7], 'taş SAYISI görünebilir');
    a.disconnect(); b.disconnect(); c.disconnect();
  }

  // ---------- 9) RÖVANŞ: iki taraf da kabul edince yeni oyun ----------
  {
    const { a, b } = await masaAc(url, 'kl-rv');
    const oda = rooms.get('kl-rv');
    // maçı bitir (pes)
    const bit = once(b, 'gameEnded', 8000);
    oda.kelimelik.scores = [55, 20];
    a.emit('gvResign');
    const bitP = await bit;
    assert.strictEqual(oda.status, 'finished');
    assert.strictEqual(oda.kelimelik.scores[0], 0, 'pes edenin masadaki puanı silinmeli');
    assert.strictEqual(bitP.gameState.scores[0], 0, 'bitiş paketinde de silinmiş olmalı');

    const basladiA = once(a, 'rematchStarted', 10000);
    const basladiB = once(b, 'rematchStarted', 10000);
    a.emit('rematchRequest', { roomId: 'kl-rv' });
    await bekle(300);
    assert.strictEqual(oda.status, 'finished', 'tek taraflı kabulle yeni oyun BAŞLAMAMALI');
    b.emit('rematchRequest', { roomId: 'kl-rv' });
    await Promise.all([basladiA, basladiB]);
    await bekle(300);
    assert.strictEqual(oda.status, 'playing', 'iki taraf da kabul edince yeni oyun başlamalı');
    assert.ok(oda.kelimelik, 'yeni motor kurulmalı');
    assert.deepStrictEqual(oda.kelimelik.scores, [0, 0], 'skorlar sıfırlanmalı');
    assert.strictEqual(oda.kelimelik.bag.length, 100 - 14, 'torba yeniden dolmalı');
    assert.strictEqual(oda.kelimelik.board.flat().filter(Boolean).length, 0, 'tahta boşalmalı');
    a.disconnect(); b.disconnect();
  }

  // ---------- 10) hazır masalar: #1101–#1110, hepsi 2 kişilik ----------
  {
    const res = await fetch(url + '/api/rooms?gameId=kelimelik');
    const data = await res.json();
    assert.strictEqual(data.ok, true);
    assert.ok(data.rooms.length >= 10, 'on hazır masa olmalı, bulunan: ' + data.rooms.length);
    const hazir = data.rooms.filter(r => Number(r.id) >= 1101 && Number(r.id) <= 1110);
    assert.strictEqual(hazir.length, 10, '#1101–#1110 aralığı dolu olmalı');
    assert.ok(hazir.every(r => Number(r.maxPlayers) === 2), 'hepsi 2 kişilik olmalı');
    const sureler = hazir.map(r => Number(r.durationMinutes)).sort((x, y) => x - y);
    assert.deepStrictEqual(sureler, [10, 10, 10, 10, 15, 15, 15, 20, 20, 20],
      '4 Hızlı / 3 Normal / 3 Düşünen');
  }

  srv.server.close();
  /* fetch'in keep-alive bağlantısı süreci açık tutabiliyor; test bittiğinde
     açıkça çıkılır (diğer süit dosyaları gibi zincire takılmasın). */
  console.log('OK kelimelik online: masa, ıstaka gizliliği, sözlük, pas/diskalifiye, süre, otomatik pas, terk, izleyici, rövanş, hazır masalar');
  setTimeout(() => process.exit(0), 50).unref();
}
main().catch(e => { console.error(e); try { srv.server.close(); } catch (_) {} process.exit(1); });
