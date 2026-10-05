'use strict';
/* ============================================================================
 * MASA OYLAMASI — eksik kişiyle devam
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

async function masaKur(BASE, rooms, gameId, kisi) {
  const oda = [...rooms.values()].filter(r => r.isPreset && r.gameId === gameId && r.maxPlayers === kisi)
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  assert.ok(oda, gameId + ' ' + kisi + ' kişilik masa olmalı');
  const ss = [];
  for (let i = 0; i < kisi; i++) ss.push(await connect(BASE, gameId + '-' + i));
  const basladi = ss.map(s => once(s, 'gameStarted', 15000));
  for (const s of ss) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId, userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: kisi, durationMinutes: oda.durationMinutes });
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

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const acik = [];

  // ---------- 1-3) 101 OKEY: çıkış → bot → oylama → devam ----------
  {
    const { oda, ss, paketler } = await masaKur(BASE, rooms, 'okey101', 4);
    acik.push(...ss);
    assert.strictEqual(oda.players.length, 4, 'masa 4 kişilik kurulmalı');

    // Sırası gelmeyen bir oyuncu çıksın (çıkış sırayı bozmasın)
    const siraKoltuk = oda.okey.roundState.turn;
    const cikanIdx = paketler.findIndex(p => p.gameState.mySeat !== siraKoltuk);
    const cikan = ss[cikanIdx];
    const botHaberi = once(ss[(cikanIdx + 1) % 4], 'aiTookSeat', 9000);
    cikan.emit('leaveRoom', { roomId: String(oda.id) });
    const bh = await botHaberi;
    assert.ok(bh && bh.seat !== undefined, 'çıkan koltuğu bot devralmalı');
    assert.strictEqual(oda.players.length, 4, 'koltuk silinmemeli (motor sırası bozulmasın)');
    assert.strictEqual(oda.players.filter(p => p.aiControlled).length, 1, 'tam bir bot koltuğu olmalı');
    assert.strictEqual(oda.status, 'playing', 'maç çökmemeli');
    console.log('  ✓ 1) 4 kişilik 101 masasında çıkan oyuncunun koltuğunu bot devraldı');

    // Eli bitir → oylama açılmalı
    const kalanlar = ss.filter((s, i) => i !== cikanIdx);
    const oylamalar = kalanlar.map(s => once(s, 'masaOylamasi', 12000));
    const { sira, tileId } = eliBitir(oda, true);
    const siraSoket = kalanlar.find((s, i) => paketler.filter((_, j) => j !== cikanIdx)[i].gameState.mySeat === sira);
    (siraSoket || kalanlar[0]).emit('okeyDiscard', { roomId: String(oda.id), tileId });
    const oy = (await Promise.all(oylamalar))[0];
    assert.strictEqual(oy.yeniKisi, 3, 'yeni kişi sayısı 3 olmalı');
    assert.strictEqual(oy.gereken, 3, 'kalan 3 insanın hepsi oy vermeli');
    assert.ok(Array.isArray(oy.ayrilanlar) && oy.ayrilanlar.length === 1, 'ayrılanın adı bildirilmeli');
    console.log('  ✓ 2) el bitince oylama açıldı: "3 kişiyle devam?" (3 oy gerekiyor)');

    // Hepsi evet → 3 kişiyle yeni el
    const sonuclar = kalanlar.map(s => once(s, 'masaOylamaSonucu', 12000));
    const yeniEl = kalanlar.map(s => once(s, 'gameStarted', 12000));
    kalanlar.forEach(s => s.emit('masaOyla', { roomId: String(oda.id), evet: true }));
    const sonuc = (await Promise.all(sonuclar))[0];
    assert.strictEqual(sonuc.devam, true, 'oylama geçmeli');
    const yeni = (await Promise.all(yeniEl))[0];
    assert.strictEqual(oda.players.length, 3, 'masa 3 kişiye inmeli');
    assert.strictEqual(oda.maxPlayers, 3, 'oda kapasitesi 3 olmalı');
    assert.strictEqual(oda.players.filter(p => p.aiControlled).length, 0, 'bot koltuğu kalkmalı');
    assert.deepStrictEqual(oda.players.map(p => p.seat).sort(), [0, 1, 2],
      'koltuklar boşluksuz yeniden numaralanmalı');
    const eller = oda.okey.roundState.seats.map(s => oda.okey.roundState.hands[s].length).sort();
    assert.deepStrictEqual(eller, [21, 21, 22], '3 kişilik 101 dağıtımı 22/21/21 olmalı');
    assert.strictEqual(yeni.gameState.seats.length, 3, 'istemciye 3 koltuk bildirilmeli');
    console.log('  ✓ 3) oylama geçti: masa 3 kişiye indi, 3 kişilik kurallarla yeni el başladı');

    ss.forEach(s => { try { s.close(); } catch (_) {} });
    await uyu(120);
  }

  // ---------- 4) OYLAMA GEÇMEZSE maç biter ----------
  {
    const { oda, ss, paketler } = await masaKur(BASE, rooms, 'okey', 4);
    acik.push(...ss);
    const siraKoltuk = oda.okey.roundState.turn;
    const cikanIdx = paketler.findIndex(p => p.gameState.mySeat !== siraKoltuk);
    const kalanlar = ss.filter((s, i) => i !== cikanIdx);
    const botHaberi = once(kalanlar[0], 'aiTookSeat', 9000);
    ss[cikanIdx].emit('leaveRoom', { roomId: String(oda.id) });
    await botHaberi;

    const oylamalar = kalanlar.map(s => once(s, 'masaOylamasi', 12000));
    const sira = desteyiKurut(oda);
    const kalanPaketler = paketler.filter((_, j) => j !== cikanIdx);
    const siraSoket = kalanlar.find((s, i) => kalanPaketler[i].gameState.mySeat === sira);
    assert.ok(siraSoket, 'sırası gelen koltuk insan olmalı');
    siraSoket.emit('okeyDraw', { roomId: String(oda.id), source: 'deck' });
    await Promise.all(oylamalar);

    const bitti = kalanlar.map(s => once(s, 'gameEnded', 12000));
    const sonuclar = kalanlar.map(s => once(s, 'masaOylamaSonucu', 12000));
    kalanlar[0].emit('masaOyla', { roomId: String(oda.id), evet: false });
    const sonuc = (await Promise.all(sonuclar))[0];
    assert.strictEqual(sonuc.devam, false, 'tek "hayır" oylamayı düşürmeli');
    const ge = (await Promise.all(bitti))[0];
    assert.strictEqual(ge.reason, 'vote_failed', 'maç oylama düştüğü için bitmeli');
    assert.notStrictEqual(oda.status, 'playing', 'oda oynar durumda kalmamalı');
    console.log('  ✓ 4) "hayır" oyu masayı dağıttı, herkese maç sonu gitti');
    ss.forEach(s => { try { s.close(); } catch (_) {} });
    await uyu(120);
  }

  // ---------- 5) SÜRE DOLARSA da masa dağılır ----------
  {
    const { oda, ss, paketler } = await masaKur(BASE, rooms, 'okey101', 3);
    acik.push(...ss);
    const siraKoltuk = oda.okey.roundState.turn;
    const cikanIdx = paketler.findIndex(p => p.gameState.mySeat !== siraKoltuk);
    const kalanlar = ss.filter((s, i) => i !== cikanIdx);
    const botHaberi = once(kalanlar[0], 'aiTookSeat', 9000);
    ss[cikanIdx].emit('leaveRoom', { roomId: String(oda.id) });
    await botHaberi;

    const oylamalar = kalanlar.map(s => once(s, 'masaOylamasi', 12000));
    const { sira, tileId } = eliBitir(oda, true);
    const kalanPaketler = paketler.filter((_, j) => j !== cikanIdx);
    const siraSoket = kalanlar.find((s, i) => kalanPaketler[i].gameState.mySeat === sira);
    (siraSoket || kalanlar[0]).emit('okeyDiscard', { roomId: String(oda.id), tileId });
    const oy = (await Promise.all(oylamalar))[0];
    assert.strictEqual(oy.yeniKisi, 2, '3 kişilikte biri çıkınca 2 kalır');

    // Kimse oy vermiyor → süre dolsun (GV_MASA_OYLAMA_MS = 6 sn)
    const sonuc = await once(kalanlar[0], 'masaOylamaSonucu', 14000);
    assert.strictEqual(sonuc.devam, false, 'yanıt gelmezse oylama düşmeli');
    console.log('  ✓ 5) yanıt verilmezse oylama düşüyor, masa dağılıyor');
    ss.forEach(s => { try { s.close(); } catch (_) {} });
  }

  // ---------- 6) ARAYÜZ bağlı mı ----------
  const sayfa = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/js\/masa-oylama\.js/.test(sayfa), 'oylama penceresi sayfaya bağlanmalı');
  assert.ok(/\.mo-ov\{/.test(sayfa), 'pencere stili olmalı');
  const js = fs.readFileSync(path.join(__dirname, '..', 'js', 'masa-oylama.js'), 'utf8');
  assert.ok(/masaOylamasi/.test(js) && /masaOyla/.test(js), 'pencere olayları dinlemeli ve oy yollamalı');
  assert.ok(/masaOylamaSonucu/.test(js), 'sonuç gelince pencere kapanmalı');
  console.log('  ✓ 6) oylama penceresi sayfaya bağlı');

  for (const s of acik) { try { s.close(); } catch (_) {} }
  server.close();
  console.log('OK masa oylaması: bot devralma, el sonu oylaması, devam/dağılma');
  process.exit(0);
}
main().catch(e => { console.error('❌ MASA OYLAMA HATASI:', e); process.exit(1); });
