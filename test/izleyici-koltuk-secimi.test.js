'use strict';
/* ============================================================================
 * İZLEYİCİ — KOLTUK SEÇEREK İZLEME + İZİN YÖNETİMİ
 * ============================================================================
 * Kullanıcı isteği (verbatim):
 *   "okey, 101 okey, pişti, batak ve amiral battı oyunlarında, dışarıdan
 *    odalarda izleyiciler katılmak isterse, izleyici olarak katılmak isteyen
 *    kişi oyundaki oyuncuların isimlerini pop-up açılarak seçer ve o
 *    oyuncunun ekranından izlemeye devam eder. Oyuncularda 'İzleyiciye İzin
 *    Ver' veya 'İzleyici İznini Kaldır' seçenekleri olacak oyun esnasında
 *    webde ve mobilde. ... eğer izleyici iznini kaldır derse izleyiciler o
 *    oyuncuyu seçemez rengi sönük gözükür, sadece izin verilen rengi aktif
 *    olarak gözükür oyuncunun kullanıcı adı veya ziyaretçi numarasıyla.
 *    (eğer önceden izleyici var ise de artık oyundan izleyici atılır ve
 *    lobiye yönlendirilerek pop up uyarı mesajıyla oyuncu izleyici iznini
 *    kapattı uyarısı versin)"
 *
 * NE DOĞRULANIR (hepsi SUNUCU tarafında — istemci kodu değiştirilse bile
 * geçerli kalsın diye kural istemciye bırakılmadı):
 *   1) İzleyici odaya girince seçim listesi (spectatorChoices) gelir; her
 *      oyuncu adı + üye/ziyaretçi bilgisi + izin durumuyla listelenir.
 *   2) Koltuk seçen izleyici O KOLTUĞUN ekranını alır (okeyde ıstaka,
 *      amiral battıda kendi gemileri) — seçmeden önce almıyordu.
 *   3) Oyuncu iznini kaldırınca o koltuk listede allowed:false olur ve
 *      seçilemez (sunucu reddeder).
 *   4) O ANDA İZLEYEN varsa odadan ÇIKARILIR: 'spectatorEjected' alır,
 *      odanın izleyici listesinden düşer, artık oda paketi almaz.
 *   5) İzin geri verilince koltuk yeniden seçilebilir.
 *   6) Yalnız koltuktaki oyuncu kendi iznini değiştirebilir (izleyici
 *      'setSpectatorPermission' yollarsa hiçbir şey olmaz).
 * ========================================================================= */

process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '30000';

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url, name) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('bağlantı zaman aşımı: ' + name)), 8000);
    socket.on('connect', () => { clearTimeout(t); socket.userName = name; resolve(socket); });
    socket.on('connect_error', reject);
  });
}
function once(socket, event, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('zaman aşımı: ' + event)), ms || 9000);
    socket.once(event, p => { clearTimeout(t); resolve(p); });
  });
}
/* Olay GELMEMELİ: belirtilen süre boyunca sessiz kalmalı. */
function gelmemeli(socket, event, ms) {
  return new Promise((resolve, reject) => {
    const el = p => reject(new Error('beklenmeyen olay geldi: ' + event + ' → ' + JSON.stringify(p)));
    socket.on(event, el);
    setTimeout(() => { socket.off(event, el); resolve(); }, ms || 700);
  });
}
function join(socket, roomId, gameId, maxPlayers, extra) {
  socket.emit('joinRoom', Object.assign({
    roomId, gameId, userName: socket.userName, userKey: 'test:' + socket.userName,
    maxPlayers, durationMinutes: 10
  }, extra || {}));
  return once(socket, 'joinedRoom');
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const acik = [];

  /* =================================================================
   * A) OKEY MASASI — dört oyuncu, bir izleyici
   * ================================================================= */
  const ODA = 'izle-okey';
  const oyuncular = [];
  for (let i = 0; i < 4; i++) {
    const s = await connect(BASE, 'Oyuncu' + (i + 1));
    acik.push(s); oyuncular.push(s);
  }
  const basladi = oyuncular.map(s => once(s, 'gameStarted', 12000));
  for (const s of oyuncular) await join(s, ODA, 'okey', 4);
  for (const s of oyuncular) s.emit('setReady', { ready: true });
  const acilis = await Promise.all(basladi);
  const koltuk = {};                       // koltuk → soket
  acilis.forEach((p, i) => { koltuk[p.seat] = oyuncular[i]; });
  const room = rooms.get(ODA);
  assert.ok(room, 'okey masası kurulmalı');

  // ---- 1) izleyici girince seçim listesi gelir
  const izleyici = await connect(BASE, 'Meraklı'); acik.push(izleyici);
  const secimSozu = once(izleyici, 'spectatorChoices', 9000);
  const girdi = await join(izleyici, ODA, 'okey', 4, { asSpectator: true });
  assert.strictEqual(girdi.role, 'spectator', 'beşinci kişi izleyici olmalı');
  const secim = await secimSozu;
  assert.strictEqual(secim.secimli, true, 'okey koltuk seçimli bir oyun olmalı');
  assert.strictEqual(secim.choices.length, 4, 'dört oyuncu da listelenmeli');
  assert.ok(secim.choices.every(c => c.allowed), 'varsayılan: herkes izlenmeye açık');
  assert.ok(secim.choices.every(c => typeof c.name === 'string' && c.name.length),
    'her seçenek oyuncunun kullanıcı adı/ziyaretçi adıyla gelmeli');
  assert.strictEqual(secim.watchSeat, null, 'henüz koltuk seçmedi');
  console.log('  ✓ 1) izleyici girince oyuncu seçim listesi geldi (4 oyuncu, hepsi açık)');

  // ---- 2) seçmeden önce TARAFSIZ görünüm: kimsenin ıstakası yok
  const tarafsiz = await once(izleyici, 'gameStateUpdated', 3000).catch(() => null);
  if (tarafsiz) {
    assert.strictEqual(tarafsiz.gameState.mySeat, null, 'koltuk seçmeden önce bakış tarafsız olmalı');
    assert.ok(!(tarafsiz.gameState.myHand || []).length, 'koltuk seçmeden önce hiçbir el görünmemeli');
  }

  // ---- 3) koltuk seçince O OYUNCUNUN ekranı gelir
  const hedefKoltuk = 2;
  const sonucSozu = once(izleyici, 'spectateSeatResult', 9000);
  const durumSozu = once(izleyici, 'gameStateUpdated', 9000);
  izleyici.emit('spectateSeat', { seat: hedefKoltuk });
  const sonuc = await sonucSozu;
  assert.strictEqual(sonuc.ok, true, 'izin veren koltuk seçilebilmeli');
  assert.strictEqual(sonuc.seat, hedefKoltuk);
  const izlenen = await durumSozu;
  assert.strictEqual(izlenen.isSpectator, true, 'izleyici hâlâ izleyici (hamle yapamaz)');
  assert.strictEqual(izlenen.seat, hedefKoltuk, 'paket izlenen koltuğun bakışıyla gelmeli');
  assert.strictEqual(izlenen.gameState.mySeat, hedefKoltuk, 'durum paketi o koltuğun bakışı olmalı');
  const tasSayisi = (izlenen.gameState.myHand || []).filter(Boolean).length;
  assert.ok(tasSayisi >= 14, 'izleyici artık o oyuncunun ıstakasını görmeli — ' + tasSayisi + ' taş');
  /* Gerçekten O OYUNCUNUN eli mi? Sunucudaki el ile karşılaştır. */
  const gercekEl = room.okey.roundState.hands[hedefKoltuk].filter(Boolean).map(t => t.id).sort();
  const gorunenEl = (izlenen.gameState.myHand || []).filter(Boolean).map(t => t.id).sort();
  assert.deepStrictEqual(gorunenEl, gercekEl,
    'izleyicinin gördüğü ıstaka, izlediği oyuncunun GERÇEK eli olmalı');
  console.log('  ✓ 2) koltuk seçildi → izleyici o oyuncunun ekranını (ıstakasını) görüyor');

  // ---- 4) oyuncu iznini kaldırır: izleyici ÇIKARILIR
  const cikarmaSozu = once(izleyici, 'spectatorEjected', 9000);
  const onaySozu = once(koltuk[hedefKoltuk], 'spectatorPermissionSet', 9000);
  koltuk[hedefKoltuk].emit('setSpectatorPermission', { allow: false });
  const cikarma = await cikarmaSozu;
  assert.strictEqual(cikarma.reason, 'permission_revoked');
  assert.strictEqual(cikarma.seat, hedefKoltuk);
  assert.ok(/izleyici iznini kapattı/i.test(cikarma.message || ''),
    'uyarı mesajı "oyuncu izleyici iznini kapattı" demeli — ' + cikarma.message);
  const onay = await onaySozu;
  assert.strictEqual(onay.allow, false);
  assert.strictEqual(onay.ejected, 1, 'izleyen tek kişi çıkarılmalı');
  assert.ok(!(room.spectators || []).some(x => x.id === izleyici.id),
    'çıkarılan izleyici odanın izleyici listesinden düşmeli');
  /* Artık oda paketi ALMAMALI: odadan gerçekten çıkarıldı. */
  await gelmemeli(izleyici, 'gameStateUpdated', 800);
  console.log('  ✓ 3) izin kaldırılınca izleyici odadan çıkarıldı ve uyarı mesajı aldı');

  // ---- 5) izni kalkan koltuk LİSTEDE sönük (allowed:false) ve SEÇİLEMEZ
  const izleyici2 = await connect(BASE, 'Meraklı2'); acik.push(izleyici2);
  const secim2Sozu = once(izleyici2, 'spectatorChoices', 9000);
  await join(izleyici2, ODA, 'okey', 4, { asSpectator: true });
  const secim2 = await secim2Sozu;
  const kapali = secim2.choices.find(c => c.seat === hedefKoltuk);
  assert.ok(kapali, 'izni kalkan oyuncu listede DURMALI (sönük gösterilecek)');
  assert.strictEqual(kapali.allowed, false, 'izni kalkan koltuk allowed:false olmalı');
  assert.strictEqual(secim2.choices.filter(c => c.allowed).length, 3,
    'yalnız izin veren üç koltuk aktif görünmeli');
  const red = once(izleyici2, 'spectateSeatResult', 9000);
  izleyici2.emit('spectateSeat', { seat: hedefKoltuk });
  const redSonuc = await red;
  assert.strictEqual(redSonuc.ok, false, 'sunucu izin vermeyen koltuğu REDDETMELİ');
  assert.strictEqual(redSonuc.reason, 'not_allowed');
  /* Reddedilince gizli bilgi de sızmamalı. */
  const bosDurum = await new Promise(r => {
    const el = p => { izleyici2.off('gameStateUpdated', el); r(p); };
    izleyici2.on('gameStateUpdated', el);
    setTimeout(() => { izleyici2.off('gameStateUpdated', el); r(null); }, 900);
  });
  if (bosDurum) {
    assert.strictEqual(bosDurum.gameState.mySeat, null, 'reddedilen izleyici bakışı tarafsız kalmalı');
    assert.strictEqual((bosDurum.gameState.myHand || []).length, 0,
      'reddedilen izleyiciye ıstaka SIZMAMALI');
  }
  console.log('  ✓ 4) izni kalkan koltuk sönük (allowed:false) ve sunucu seçimini reddediyor');

  // ---- 6) izin geri verilince yeniden seçilebilir
  const geriOnay = once(koltuk[hedefKoltuk], 'spectatorPermissionSet', 9000);
  koltuk[hedefKoltuk].emit('setSpectatorPermission', { allow: true });
  assert.strictEqual((await geriOnay).allow, true);
  const kabul = once(izleyici2, 'spectateSeatResult', 9000);
  const durum2 = once(izleyici2, 'gameStateUpdated', 9000);
  izleyici2.emit('spectateSeat', { seat: hedefKoltuk });
  assert.strictEqual((await kabul).ok, true, 'izin geri gelince koltuk yeniden seçilebilmeli');
  const d2 = await durum2;
  assert.ok((d2.gameState.myHand || []).filter(Boolean).length >= 14,
    'izin geri verilince ıstaka yeniden görünmeli');
  console.log('  ✓ 5) izin geri verilince koltuk yeniden seçilebiliyor');

  // ---- 7) İZLEYİCİ başkasının iznini DEĞİŞTİREMEZ
  const onceki = room.players.find(p => p.seat === 0).allowSpectators;
  izleyici2.emit('setSpectatorPermission', { allow: false });
  await sleep(500);
  assert.strictEqual(room.players.find(p => p.seat === 0).allowSpectators, onceki,
    'izleyici bir oyuncunun iznini değiştirememeli');
  console.log('  ✓ 6) izleyici oyuncuların iznini değiştiremiyor (yetki sunucuda)');

  /* =================================================================
   * B) AÇIK TAHTALI OYUN (satranç) — koltuk seçimi YOK
   *    Gizli bilgi olmadığı için izleyici eskisi gibi tarafsız görünümü
   *    alır; pop-up hiç açılmaz. Bu, davranışın gerilemediğini gösterir.
   * ================================================================= */
  const sa = await connect(BASE, 'Satranc1'); acik.push(sa);
  const sb = await connect(BASE, 'Satranc2'); acik.push(sb);
  const sc = await connect(BASE, 'SatrancIzle'); acik.push(sc);
  await join(sa, 'izle-sat', 'chess', 2);
  await join(sb, 'izle-sat', 'chess', 2);
  await join(sc, 'izle-sat', 'chess', 2, { asSpectator: true });
  await gelmemeli(sc, 'spectatorChoices', 800);
  console.log('  ✓ 7) satranç gibi açık tahtalı oyunlarda koltuk seçimi istenmiyor');

  for (const s of acik) { try { s.close(); } catch (_) {} }
  server.close();
  console.log('OK izleyici: koltuk seçimi, oyuncu ekranından izleme, izin kaldırma + çıkarma, izin iadesi');
  process.exit(0);
}
main().catch(e => { console.error('❌ İZLEYİCİ TESTİ HATASI:', e); process.exit(1); });
