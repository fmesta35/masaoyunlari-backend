'use strict';
/* ============================================================================
 * ÇIKAN OYUNCU: 45 sn DURAKLAMA → BOT (tur sonuna kadar) → MAÇ SONU
 * ============================================================================
 * GÜNCEL KURAL (kullanıcı, 19.10.2026): "Oyundan çıkan oyuncu için tüm oyun
 * ve hamle süreleri dursun, 45 sn dönüş sayacı başlasın. Dönmezse 2 kişilikte
 * çıkan mağlup; 3-4 kişilikte o tur bitene kadar bot oynar. Tur bitince bot
 * çıkar, oyuncular mevcut puanlarla puanlanır ve oyunun bekleme odasına
 * dönerler." Eski "eksik kişiyle devam" OYLAMASI bu kuralla kalktı.
 *
 * ESKİ BAŞLIK: MASA OYLAMASI — eksik kişiyle devam
 * ============================================================================
 * Kullanıcı isteği: "3 ve 4 kişilik oyunlarda çıkan oyuncu yerini o elde
 * geçerli olmak üzere bir bot devam ettirsin. Ardından o el bittikten sonra
 * tüm oyunculara oylama sunulsun; devam et oylanırsa kalan kişi sayısı
 * kurallarına göre oynamaya devam ederler, oylama başarısız olursa herkes
 * lobiye yönlendirilir."
 *
 * NE DOĞRULANIR:
 *   1) 4 kişilik masada biri çıkınca koltuğu BOT devralır, maç çökmez.
 *   2) El bitince oylama açılır; herkese kimin çıktığı ve yeni kişi sayısı
 *      bildirilir.
 *   3) Kalan İNSANLARIN HEPSİ "devam" derse masa 3 kişiye iner, koltuklar
 *      yeniden numaralanır ve yeni el başlar.
 *   4) Biri "hayır" derse ya da süre dolarsa maç biter (herkes lobiye).
 *   5) 101 Okey de aynı yoldan geçer (bot dalı ayrı yazıldığı için ayrıca
 *      ölçülüyor).
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-oylama-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_OKEY_PRESETS = '1';
process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '600000';
process.env.GV_AI_DELAY_MS = '10';
process.env.GV_MASA_OYLAMA_MS = '6000';
process.env.GV_RECONNECT_GRACE_MS = '1500';   // üretimde 45 sn

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
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 9000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}
const uyu = ms => new Promise(r => setTimeout(r, ms));

let uyeNo = 9100;
async function masaKur(BASE, rooms, gameId, kisi, uye) {
  const oda = [...rooms.values()].filter(r => r.isPreset && r.gameId === gameId && r.maxPlayers === kisi && !r.players.length && r.status === 'waiting')
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  assert.ok(oda, gameId + ' ' + kisi + ' kişilik masa olmalı');
  const ss = [];
  for (let i = 0; i < kisi; i++) ss.push(await connect(BASE, gameId + '-' + i));
  const basladi = ss.map(s => once(s, 'gameStarted', 15000));
  for (const s of ss) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId, userName: s.userName,
      userKey: uye ? ('user:' + (s.uyeNo = ++uyeNo)) : ('test:' + s.userName), maxPlayers: kisi, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  ss.forEach(s => s.emit('setReady', { ready: true }));
  const paketler = await Promise.all(basladi);
  return { oda, ss, paketler };
}

/* Eli hemen bitir: sırası gelen oyuncunun elini tek taşa indirip attır.
   Böylece "el bitti" anına saniyeler içinde geliyoruz. */
function eliBitir(oda, yeni101) {
  const rs = oda.okey.roundState;
  const sira = rs.turn;
  rs.seats.forEach(s => {
    if (yeni101) rs.opened[s] = true;
    rs.hands[s] = [rs.hands[s][0]];
  });
  rs.phase = 'discard';
  return { sira, tileId: rs.hands[sira][0].id };
}

/* KLASİK okey'de atmak eli bitirmez (motor "finish" bekler). Beraberlikle
   bitirmenin en kısa yolu desteyi boşaltıp sırası gelene çektirmek: motor
   deste bitince eli berabere sayıyor. */
function desteyiKurut(oda) {
  const rs = oda.okey.roundState;
  rs.deck = [];
  rs.phase = 'draw';
  return rs.turn;
}


function sayacKalan(oda) { const ok = oda.okey; return ok.turnDeadlineMs - (Date.now() - ok.turnStartedAt); }

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const acik = [];

  // ---------- 1) 2 kişilik 101: çık → duraklama → saat donuk → dön → devam ----------
  {
    const { oda, ss, paketler } = await masaKur(BASE, rooms, 'okey101', 2, true);   // ÜYELER
    acik.push(...ss);
    const cikan = ss[1], kalan = ss[0];
    const durak = once(kalan, 'oyunDuraklatildi', 6000);
    const once1 = sayacKalan(oda);
    cikan.emit('leaveRoom', { roomId: String(oda.id) });
    const d = await durak;
    assert.ok(d.kalanMs > 0 && /duraklatıldı/.test(d.mesaj), 'kalan oyuncuya duraklama + mesaj gitmeli');
    assert.ok(oda.duraklama, 'oda duraklamada olmalı');
    const saatOnce = Object.assign({}, oda.okey.clockMs);
    await uyu(1100);
    const fark = Math.abs(sayacKalan(oda) - once1);
    assert.ok(fark < 700, 'duraklamada hamle sayacı akmamalı (fark ' + fark + ' ms)');
    assert.deepStrictEqual(oda.okey.clockMs, saatOnce, 'duraklamada ana saat de düşmemeli');
    // HER ŞEY DONUK: masada kalan oyuncu da hamle yapamaz
    const rs = oda.okey.roundState, turOnce = rs.turn, fazOnce = rs.phase;
    const ret = once(kalan, 'hamleDuraklamada', 4000);
    kalan.emit('okeyDraw', { roomId: String(oda.id), source: 'deck' });
    kalan.emit('okeyDiscard', { roomId: String(oda.id), tileId: (rs.hands[rs.turn] || [])[0] && rs.hands[rs.turn][0].id });
    await ret;
    await uyu(200);
    assert.strictEqual(rs.turn, turOnce, 'duraklamada sıra değişmemeli');
    assert.strictEqual(rs.phase, fazOnce, 'duraklamada hamle işlenmemeli');
    console.log('  ✓ 1) çıkışta oyun duraklatıldı; saatler ve hamleler dahil her şey dondu');

    const devam = once(kalan, 'oyunDevamEdiyor', 6000);
    cikan.emit('joinRoom', { roomId: String(oda.id), gameId: 'okey101', userName: cikan.userName,
      userKey: 'test:' + cikan.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await devam;
    assert.ok(!oda.duraklama && oda.status === 'playing', 'dönüşte oyun devam etmeli');
    console.log('  ✓ 2) 45 sn içinde dönen oyuncuyla oyun kaldığı yerden devam etti');

    // Bu kez dönmesin → 2 kişilikte çıkan mağlup
    const bitis = once(kalan, 'gameEnded', 8000);
    cikan.emit('leaveRoom', { roomId: String(oda.id) });
    const g = await bitis;
    assert.strictEqual(g.youWon, true, 'kalan oyuncu kazanmalı');
    console.log('  ✓ 3) dönmeyen üye 2 kişilik masada hükmen mağlup sayıldı');
    await uyu(900);
  }

  // ---------- 3b) 2 kişilikte MİSAFİR: dönüş hakkı yok, maç hemen biter ----------
  {
    const { oda, ss } = await masaKur(BASE, rooms, 'okey101', 2, false);
    acik.push(...ss);
    const bitis = once(ss[0], 'gameEnded', 4000);
    const t0 = Date.now();
    ss[1].emit('leaveRoom', { roomId: String(oda.id) });
    const g = await bitis;
    assert.strictEqual(g.youWon, true);
    assert.ok(Date.now() - t0 < 1200 && !oda.duraklama, 'misafirde 45 sn beklenmemeli');
    console.log('  ✓ 3b) 2 kişilikte misafir çıkınca maç beklemeden bitti (dönüş hakkı yalnız üyede)');
    await uyu(900);
  }

  // ---------- 4) 4 kişilik 101: dönmeyen → bot → tur sonu → mevcut puanlarla biter, bekleme odası ----------
  {
    const { oda, ss, paketler } = await masaKur(BASE, rooms, 'okey101', 4);
    acik.push(...ss);
    const siraKoltuk = oda.okey.roundState.turn;
    const cikanIdx = paketler.findIndex(p => p.gameState.mySeat !== siraKoltuk);
    const kalanlar = ss.filter((_, i) => i !== cikanIdx);
    const durak = once(kalanlar[0], 'oyunDuraklatildi', 6000);
    const botHaberi = once(kalanlar[0], 'aiTookSeat', 9000);
    ss[cikanIdx].emit('leaveRoom', { roomId: String(oda.id) });
    const d = await durak;
    assert.ok(/bot/.test(d.mesaj), '3-4 kişilikte mesaj bottan söz etmeli');
    await botHaberi;
    assert.ok(!oda.duraklama, 'bot oturunca saatler yeniden işlemeli');
    assert.strictEqual(oda.players.filter(p => p.aiControlled).length, 1);
    console.log('  ✓ 4) 45 sn dolunca koltuğa geçici bot oturdu, oyun devam etti');

    const turSonu = once(kalanlar[0], 'botTurSonu', 12000);
    const bitisler = kalanlar.map(s => once(s, 'gameEnded', 12000));
    const { sira, tileId } = eliBitir(oda, true);
    const koltukSoket = new Map(paketler.map((p, i) => [p.gameState.mySeat, ss[i]]));
    (koltukSoket.get(sira) || kalanlar[0]).emit('okeyDiscard', { roomId: String(oda.id), tileId });
    if (oda.players.find(p => p.seat === sira && p.aiControlled)) { /* bot sırasıysa bot oynar */ }
    await turSonu;
    const g = (await Promise.all(bitisler))[0];
    assert.strictEqual(g.reason, 'bot_tur_sonu', 'maç tur sonunda mevcut puanlarla bitmeli');
    const bot = oda.players.find(p => p.aiControlled);
    assert.ok(!bot || g.winnerSeat !== bot.seat, 'bot (ayrılan) kazanan olamaz');
    const sonEl = oda.okey && oda.okey.roundState && oda.okey.roundState.result;
    if (sonEl && sonEl.winner !== null && sonEl.winner !== undefined && (!bot || sonEl.winner !== bot.seat)) {
      assert.strictEqual(g.winnerSeat, sonEl.winner, 'puanlama SON TURU kazanana göre yapılmalı');
    }
    await uyu(1200);
    assert.strictEqual(oda.status, 'waiting', 'masa bekleme odasına dönmeli');
    assert.strictEqual(oda.players.filter(p => p.aiControlled).length, 0, 'bot masadan kalkmalı');
    assert.strictEqual(oda.players.length, 3, 'kalan 3 oyuncu bekleme odasında olmalı');
    console.log('  ✓ 5) tur bitince bot kalktı, son turu kazanan galip, herkes bekleme odasında');
  }

  // ---------- 6) ÖZEL MASA: kurucu çıkınca kuruculuk rastgele başka üyeye geçer ----------
  {
    const T = serverModule.__test;
    const oda = { id: 'ozel-test', gameId: 'okey101', isPrivate: true, creatorId: 7, status: 'waiting',
      players: [{ id: 'a', seat: 0, name: 'Kurucu', userId: 7 }, { id: 'b', seat: 1, name: 'Ayşe', userId: 8 },
                { id: 'c', seat: 2, name: 'Misafir', userId: null }],
      spectators: [], maxPlayers: 4, invited: new Map(), kickBan: new Set() };
    rooms.set(oda.id, oda);
    T.removePlayerFromRoom(oda, oda.players[0], 'test');
    assert.strictEqual(oda.creatorId, 8, 'kuruculuk kalan ÜYEYE geçmeli (misafir kurucu olamaz)');
    rooms.delete(oda.id);
    console.log('  ✓ 6) özel masada kurucu çıkınca kuruculuk kalan üyeye geçti');
  }

  for (const s of acik) { try { s.close(); } catch (_) {} }
  server.close();
  console.log('OK çıkan oyuncu: duraklama, 45 sn dönüş, bot tur sonu, kurucu devri');
  process.exit(0);
}
main().catch(e => { console.error('❌ ÇIKAN OYUNCU / DURAKLAMA HATASI:', e); process.exit(1); });
