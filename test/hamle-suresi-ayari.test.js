'use strict';
/* ============================================================================
 * KURUCU PANELİ — MASA BAŞINA HAMLE SÜRESİ
 * ============================================================================
 * Kullanıcı isteği: "kurucu panelinde masa düzenlemeler bölümünde oyun süresi
 * ayarlanabildiği gibi hamle süreleri de düzenlenebilsin. Böylece kurucu
 * istediği oyunda istediği hamle süresi ve oyun süresini düzenleyebilir.
 * Hamle süreleri ilgili oyundaki tüm oyuncular için geçerli olacak."
 *
 * NE DOĞRULANIR:
 *   1) Varsayılanlar KORUNUYOR: kurucu hiçbir şey girmezse her oyun eski
 *      hamle süresiyle açılır (kelimelik masa tipine göre 30/45/60 sn,
 *      okey 30 sn, pişti 30 sn, diğerleri 60 sn).
 *   2) Kurucu bir masanın hamle süresini değiştirince masa GERÇEKTEN
 *      yeni süreyle çalışır (room.moveLimitMs).
 *   3) Süre MASADAKİ HERKES için aynı: iki oyuncunun durum paketinde de
 *      aynı turnLimitMs/moveLimitMs görünür.
 *   4) OKEY'in kendi tur sayacı (turnDeadlineMs) da masanın hamle
 *      süresini kullanır — eskiden sabit OKEY_TURN_MS'ti.
 *   5) KELİMELİK motoru da masanın süresini alır.
 *   6) Sınır dışı değerler kırpılır (5-600 sn), 0/boş "varsayılanı kullan".
 *   7) Satranç/tavlada hamle başına süre YOKTUR: değer girilse bile
 *      yok sayılır ve panel o kutuyu çizmez.
 *   8) Ayar kalıcıdır (yeniden başlatmada korunur) ve lobide görünür.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-hamle-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@kurucu.com';
process.env.GV_ADMIN_PASS = 'test-kurucu-sifresi-9271';
process.env.GV_OKEY_PRESETS = '1';
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
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 9000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}
async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, {
    method: method || (body ? 'POST' : 'GET'), headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const acik = [];

  const T = (await api(BASE, '/api/auth/login',
    { email: 'kurucu@kurucu.com', password: 'test-kurucu-sifresi-9271' })).token;
  assert.ok(T, 'kurucu girişi yapılmalı');

  // ---------- 1) varsayılanlar korunuyor ----------
  const bekle = { kelimelik: null, okey: 30000, pisti: 30000, dama: 60000, battleship: 60000 };
  for (const [g, ms] of Object.entries(bekle)) {
    const oda = [...rooms.values()].find(r => r.isPreset && r.gameId === g);
    assert.ok(oda, g + ' için hazır masa olmalı');
    if (ms === null) continue;
    assert.strictEqual(Number(oda.moveLimitMs), ms,
      g + ' varsayılan hamle süresi korunmalı — ' + oda.moveLimitMs);
  }
  /* Kelimelik masa tipine göre: 10 dk → 30 sn, 15 dk → 45 sn, 20 dk → 60 sn */
  for (const [dk, sn] of [[10, 30000], [15, 45000], [20, 60000]]) {
    const o = [...rooms.values()].find(r => r.isPreset && r.gameId === 'kelimelik' && r.durationMinutes === dk);
    assert.ok(o, dk + ' dk kelimelik masası olmalı');
    assert.strictEqual(Number(o.moveLimitMs), sn, dk + ' dk kelimelik → ' + (sn / 1000) + ' sn');
  }
  console.log('  ✓ 1) kurucu dokunmadıkça her oyun eski hamle süresiyle açılıyor');

  // ---------- 2) şema panele alanı bildiriyor ----------
  const sema = (await api(BASE, '/api/admin/tables', null, 'GET', T)).sema;
  assert.ok(Array.isArray(sema.hamleYok) && sema.hamleYok.includes('chess') && sema.hamleYok.includes('tavla'),
    'satranç ve tavla "hamle süresi yok" listesinde olmalı');
  assert.strictEqual(sema.hamleSinir.min, 5);
  assert.strictEqual(sema.hamleSinir.max, 600);
  assert.strictEqual(Number(sema.hamleVarsayilan.okey), 30, 'okey varsayılanı 30 sn bildirilmeli');
  assert.strictEqual(Number(sema.hamleVarsayilan.dama), 60, 'dama varsayılanı 60 sn bildirilmeli');
  console.log('  ✓ 2) şema hamle süresi alanını, sınırları ve varsayılanları bildiriyor');

  // ---------- 3) kurucu süreyi değiştiriyor ----------
  const ayar = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  ayar.dama.tables[0].moveSeconds = 25;          // dama 1. masa → 25 sn
  ayar.okey.tables[0].moveSeconds = 90;          // okey 1. masa → 90 sn
  ayar.kelimelik.tables[0].moveSeconds = 15;     // kelimelik 1. masa → 15 sn
  ayar.dama.tables[1].moveSeconds = 9999;        // sınır dışı → 600'e kırpılmalı
  ayar.dama.tables[2].moveSeconds = 1;           // sınır dışı → 5'e kırpılmalı
  ayar.chess.tables[0].moveSeconds = 45;         // satrançta YOK SAYILMALI
  let r = await api(BASE, '/api/admin/tables-apply', { games: ayar }, 'POST', T);
  assert.strictEqual(r.ok, true, 'ayar uygulanmalı — ' + JSON.stringify(r).slice(0, 180));

  const damaOda = [...rooms.values()].filter(x => x.isPreset && x.gameId === 'dama')
    .sort((a, b) => Number(a.id) - Number(b.id));
  assert.strictEqual(Number(damaOda[0].moveLimitMs), 25000, 'dama 1. masa 25 sn olmalı');
  assert.strictEqual(Number(damaOda[1].moveLimitMs), 600000, 'sınırın üstü 600 sn\'ye kırpılmalı');
  assert.strictEqual(Number(damaOda[2].moveLimitMs), 5000, 'sınırın altı 5 sn\'ye çıkarılmalı');
  const satrancOda = [...rooms.values()].filter(x => x.isPreset && x.gameId === 'chess')
    .sort((a, b) => Number(a.id) - Number(b.id))[0];
  assert.ok(!satrancOda.moveLimitMs, 'satrançta hamle süresi olmamalı (ana saat var)');
  console.log('  ✓ 3) hamle süresi değişti, sınır dışı değerler kırpıldı, satranç yok saydı');

  // ---------- 4) MASADAKİ HERKES aynı süreyi görüyor ----------
  const odaId = String(damaOda[0].id);
  const a = await connect(BASE, 'Oyuncu1'); acik.push(a);
  const b = await connect(BASE, 'Oyuncu2'); acik.push(b);
  const basladi = [once(a, 'gameStarted', 12000), once(b, 'gameStarted', 12000)];
  for (const s of [a, b]) {
    s.emit('joinRoom', { roomId: odaId, gameId: 'dama', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: damaOda[0].durationMinutes });
    await once(s, 'joinedRoom');
  }
  for (const s of [a, b]) s.emit('setReady', { ready: true });
  const paketler = await Promise.all(basladi);
  for (const p of paketler) {
    assert.strictEqual(Number(p.gameState.turnLimitMs), 25000,
      'her iki oyuncu da aynı hamle süresini görmeli — ' + p.gameState.turnLimitMs);
  }
  console.log('  ✓ 4) hamle süresi masadaki TÜM oyuncular için aynı (25 sn)');

  // ---------- 5) okey kendi tur sayacına masanın süresini yazıyor ----------
  const okeyOda = [...rooms.values()].filter(x => x.isPreset && x.gameId === 'okey')
    .sort((a2, b2) => Number(a2.id) - Number(b2.id))[0];
  assert.strictEqual(Number(okeyOda.moveLimitMs), 90000, 'okey 1. masa 90 sn olmalı');
  const okeycu = [];
  for (let i = 0; i < okeyOda.maxPlayers; i++) {
    const s = await connect(BASE, 'Okey' + i); acik.push(s); okeycu.push(s);
  }
  const okBasladi = okeycu.map(s => once(s, 'gameStarted', 14000));
  for (const s of okeycu) {
    s.emit('joinRoom', { roomId: String(okeyOda.id), gameId: 'okey', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: okeyOda.maxPlayers,
      durationMinutes: okeyOda.durationMinutes, rounds: okeyOda.okeyMaxRounds });
    await once(s, 'joinedRoom');
  }
  for (const s of okeycu) s.emit('setReady', { ready: true });
  const okPak = await Promise.all(okBasladi);
  assert.strictEqual(Number(rooms.get(String(okeyOda.id)).okey.turnDeadlineMs), 90000,
    'okey tur sayacı masanın hamle süresini kullanmalı');
  for (const p of okPak) {
    assert.ok(Number(p.gameState.turnRemainingMs) <= 90000 && Number(p.gameState.turnRemainingMs) > 80000,
      'okey oyuncularına kalan süre 90 sn\'den sayılmalı — ' + p.gameState.turnRemainingMs);
  }
  console.log('  ✓ 5) okey tur sayacı da masanın hamle süresini kullanıyor (90 sn)');

  // ---------- 6) kelimelik motoru masanın süresini alıyor ----------
  const klOda = [...rooms.values()].filter(x => x.isPreset && x.gameId === 'kelimelik')
    .sort((a2, b2) => Number(a2.id) - Number(b2.id))[0];
  assert.strictEqual(Number(klOda.moveLimitMs), 15000, 'kelimelik 1. masa 15 sn olmalı');
  const k1 = await connect(BASE, 'Kel1'); acik.push(k1);
  const k2 = await connect(BASE, 'Kel2'); acik.push(k2);
  const klBasladi = [once(k1, 'gameStarted', 14000), once(k2, 'gameStarted', 14000)];
  for (const s of [k1, k2]) {
    s.emit('joinRoom', { roomId: String(klOda.id), gameId: 'kelimelik', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: klOda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  for (const s of [k1, k2]) s.emit('setReady', { ready: true });
  const klPak = await Promise.all(klBasladi);
  for (const p of klPak) {
    assert.strictEqual(Number(p.gameState.turnLimitMs), 15000,
      'kelimelik oyuncuları 15 sn görmeli — ' + p.gameState.turnLimitMs);
  }
  assert.strictEqual(Number(rooms.get(String(klOda.id)).kelimelik.turnLimitMs), 15000,
    'kelimelik motoru masanın süresiyle kurulmalı');
  console.log('  ✓ 6) kelimelik motoru da masanın hamle süresiyle kuruluyor (15 sn)');

  // ---------- 7) lobide görünüyor ----------
  const lobi = await api(BASE, '/api/rooms?gameId=dama', null, 'GET');
  const lobiOda = (lobi.rooms || []).find(x => String(x.id) === odaId);
  assert.ok(lobiOda, 'masa lobide olmalı');
  assert.strictEqual(Number(lobiOda.moveSeconds), 25,
    'oyuncu masaya oturmadan ÖNCE hamle süresini lobide görebilmeli');
  console.log('  ✓ 7) hamle süresi lobide de görünüyor');

  // ---------- 8) ayar kalıcı ----------
  const kayit = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  assert.strictEqual(Number(kayit.dama.tables[0].moveSeconds), 25, 'ayar kaydedilmeli');
  assert.strictEqual(Number(kayit.dama.tables[1].moveSeconds), 600, 'kırpılmış değer kaydedilmeli');
  assert.strictEqual(Number(kayit.okey.tables[0].moveSeconds), 90, 'okey ayarı kaydedilmeli');
  console.log('  ✓ 8) ayarlar kaydedildi ve geri okunuyor');

  // ---------- 9) 0 / boş → varsayılana dön ----------
  const ayar2 = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  ayar2.kelimelik.tables[0].moveSeconds = 0;
  r = await api(BASE, '/api/admin/tables-apply', { games: ayar2 }, 'POST', T);
  assert.strictEqual(r.ok, true);
  const klSonra = rooms.get(String(klOda.id));
  /* Masa DOLU olduğu için canlı değişmez (oyun sürerken süre değişmemeli);
     kayıt yine de sıfırlanmış olmalı. */
  const kayit2 = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  assert.strictEqual(Number(kayit2.kelimelik.tables[0].moveSeconds) || 0, 0,
    'boş bırakmak "varsayılanı kullan" demeli');
  assert.ok(klSonra, 'dolu masa ayakta kalmalı');
  console.log('  ✓ 9) alanı boşaltmak varsayılana dönüyor, dolu masa oyun ortasında bozulmuyor');

  // ---------- 10) panel arayüzü ----------
  const kod = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-panel.js'), 'utf8');
  assert.ok(/data-edit="hamle"/.test(kod), 'panelde hamle süresi kutusu çizilmeli');
  assert.ok(/HAMLE \(SN\)/.test(kod), 'kutunun etiketi olmalı');
  assert.ok(/function hamleVarMi/.test(kod) && /sema\.hamleYok/.test(kod),
    'hangi oyunda gösterileceği SUNUCUDAN okunmalı');
  assert.ok(/OYUN \(DK\)/.test(kod), 'oyun süresi kutusu da etiketlenmeli');
  assert.ok(/t\.moveSeconds = 0/.test(kod), 'boş bırakmak 0 (varsayılan) olarak yollanmalı');
  console.log('  ✓ 10) panel kutuyu etiketli çiziyor, satranç/tavlada gizliyor');

  for (const s of acik) { try { s.close(); } catch (_) {} }
  server.close();
  console.log('OK hamle süresi: masa başına ayar, tüm oyuncular için ortak, kalıcı');
  process.exit(0);
}
main().catch(e => { console.error('❌ HAMLE SÜRESİ HATASI:', e); process.exit(1); });
