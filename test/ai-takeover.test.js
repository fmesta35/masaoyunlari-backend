'use strict';

/*
 * YAPAY ZEKÂ DEVRALMA + YARIM MAÇA DÖNÜŞ (uçtan uca)
 * ==================================================
 *
 * Kullanıcının kuralı:
 *   * 2 kişilik oyunlarda terk = hükmen mağlubiyet (DEĞİŞMEDİ).
 *   * 3–4 kişilik oyunlarda terk edenin koltuğunu, maçın el sayısı
 *     tamamlanana kadar idareci yapay zekâ devralır.
 *   * Koltuğu YALNIZ o koltukta oyuna başlamış ÜYE geri alabilir;
 *     misafir terk ettiyse koltuk maç sonuna kadar yapay zekâda kalır.
 *   * Terk −20; geri dönüş +10 iade; pes etmek iade getirmez.
 *
 * Bu test gerçek soketlerle 4 kişilik okey masası kurar.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-ai-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';
// Yapay zekâ gecikmesi üretimde 1.4 sn; testte beklemeyelim.
process.env.GV_AI_DELAY_MS = '60';

const assert = require('assert');
const { io: ioClient } = require('socket.io-client');
const serverModule = require('../server.js');
const aiModul = require('../ai-player.js');

function connect(url, name) {
  const s = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('bağlanamadı: ' + name)), 8000);
    s.on('connect', () => { clearTimeout(t); s.userName = name; res(s); });
    s.on('connect_error', rej);
  });
}
function once(s, ev, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('beklendi: ' + ev)), ms || 9000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}
function bekle(ms) { return new Promise(r => setTimeout(r, ms)); }

function katil(s, roomId, userKey) {
  s.emit('joinRoom', {
    roomId, gameId: 'okey', userName: s.userName, userKey,
    maxPlayers: 4, durationMinutes: 10, rounds: 3
  });
  return once(s, 'joinedRoom');
}

async function masaKur(BASE, roomId, anahtarlar) {
  const socks = [];
  for (let i = 0; i < 4; i++) socks.push(await connect(BASE, 'O' + i));
  const basladi = socks.map(s => once(s, 'gameStarted'));
  for (let i = 0; i < 4; i++) await katil(socks[i], roomId, anahtarlar[i]);
  for (const s of socks) s.emit('setReady', { ready: true });
  const p = await Promise.all(basladi);
  const koltuk = {};
  p.forEach((x, i) => { koltuk[x.seat] = socks[i]; });
  return { socks, koltuk };
}

async function main() {
  // ---------- 0) yapay zekâ saf mantığı ----------
  assert.ok(aiModul.aiDestekli('okey') && aiModul.aiDestekli('pisti') && aiModul.aiDestekli('batak'),
    'okey/pişti/batak yapay zekâ destekli');
  assert.ok(!aiModul.aiDestekli('dama') && !aiModul.aiDestekli('chess'),
    '2 kişilik oyunlarda yapay zekâ devralmaz');

  // Batak: bot ASLA ihaleye girmez (masadaki gerçek oyuncuların ihalesini bozmaz).
  const batakSt = { phase: 'bid', bidTurn: 2, bids: [null, null, null, null], hands: [[], [], [], []] };
  assert.deepStrictEqual(aiModul.batakHamle(batakSt, 2), { tur: 'bid', value: 'pass' }, 'bot pas geçer');
  // Batak: renge uymak zorunlu — uyan kartların EN DÜŞÜĞÜNÜ oynar.
  const oyunSt = {
    phase: 'play', turn: 1, trick: [{ s: '♠', r: '5', v: 5, p: 0 }],
    hands: [[], [{ s: '♥', r: 'A', v: 14 }, { s: '♠', r: 'K', v: 13 }, { s: '♠', r: '7', v: 7 }], [], []]
  };
  assert.deepStrictEqual(aiModul.batakHamle(oyunSt, 1), { tur: 'play', index: 2 },
    'renge uyan en düşük kart (♠7) oynanır');
  console.log('  ✓ 0) yapay zekâ mantığı: kurallara uyar, ihaleye girmez, agresif oynamaz');

  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const rooms = serverModule.rooms;

  // ---------- 1) 4 kişilik masada terk → yapay zekâ devralır ----------
  const anahtarlar = ['user:501', 'user:502', 'misafir:g1', 'user:504'];
  const { socks, koltuk } = await masaKur(BASE, 'ai-masa-1', anahtarlar);
  const oda = rooms.get('ai-masa-1');
  assert.strictEqual(oda.status, 'playing', 'maç başladı');
  assert.strictEqual(oda.players.length, 4, '4 koltuk dolu');

  // 'user:502' anahtarlı oyuncunun koltuğunu bul ve masayı terk ettir.
  const ayrilan = oda.players.find(p => p.userKey === 'user:502');
  assert.ok(ayrilan, 'üye oyuncu bulundu');
  const ayrilanKoltuk = ayrilan.seat;
  const ayrilanSoket = koltuk[ayrilanKoltuk];
  const devralmaHaberi = once(socks.find(s => s !== ayrilanSoket), 'aiTookSeat', 8000);
  ayrilanSoket.emit('leaveRoom', { roomId: 'ai-masa-1' });
  const haber = await devralmaHaberi;

  assert.strictEqual(haber.seat, ayrilanKoltuk, 'devralınan koltuk bildirildi');
  assert.strictEqual(haber.geriDonebilir, true, 'üye koltuğu geri alabilir');
  assert.strictEqual(oda.status, 'playing', 'maç ÇÖKMEDİ — devam ediyor');
  assert.strictEqual(oda.players.length, 4, 'koltuk odada duruyor (motor bozulmaz)');
  const bot = oda.players.find(p => p.seat === ayrilanKoltuk);
  assert.strictEqual(bot.aiControlled, true, 'koltuk yapay zekâda');
  assert.strictEqual(Number(bot.aiReservedUserId), 502, 'koltuk terk eden ÜYEYE rezerve');
  console.log('  ✓ 1) 4 kişilik masada terk: maç çökmedi, koltuğu yapay zekâ devraldı');

  // ---------- 2) yapay zekâ gerçekten oynuyor ----------
  // Sıra bota gelene kadar diğer oyuncular oynar; botun turu geldiğinde
  // hamleyi KENDİSİ yapmalı, masa kilitlenmemeli.
  const st0 = oda.okey.roundState;
  const baslangicTur = st0.turn;
  let tur = 0;
  // En çok 12 hamle boyunca masayı akıt: sırası insandaysa biz oynarız,
  // sırası bottaysa beklemek yeterli.
  while (tur < 12 && !st0.finished) {
    const sira = st0.turn;
    if (sira === ayrilanKoltuk) {
      // Bir bot turu İKİ eylemdir (çek + at); ikisini de kendisi yapmalı.
      const oncekiFaz = st0.phase;
      await bekle(700);
      assert.ok(st0.turn !== sira || st0.phase !== oncekiFaz,
        'yapay zekâ hamlesini yaptı — masa kilitlenmedi');
      if (st0.turn === sira) { await bekle(700); }
      assert.notStrictEqual(st0.turn, sira, 'yapay zekâ turu tamamlayıp sırayı devretti');
    } else {
      const s = koltuk[sira];
      if (st0.phase === 'draw') s.emit('okeyDraw', { roomId: 'ai-masa-1', source: 'deck' });
      else {
        const el = st0.hands[sira];
        s.emit('okeyDiscard', { roomId: 'ai-masa-1', tileId: el[el.length - 1].id });
      }
      await bekle(120);
    }
    tur++;
  }
  assert.ok(tur > 0 && st0.turn !== baslangicTur, 'masa akmaya devam etti');
  console.log('  ✓ 2) yapay zekâ sırası gelince kurallara uygun hamle yapıyor (masa kilitlenmiyor)');

  // ---------- 3) YALNIZ ilgili üye koltuğu geri alabilir ----------
  const yabanci = await connect(BASE, 'Yabanci');
  yabanci.userId = 999;
  const red = await new Promise(res => yabanci.emit('gvResumeSeat', { roomId: 'ai-masa-1' }, res));
  assert.strictEqual(red.ok, false, 'başkası koltuğu alamaz');

  // Kimliği doğru üyeye (502) bağlı bir soket koltuğu geri alır.
  const donen = await connect(BASE, 'Donen');
  // authHello yerine doğrudan sunucu tarafında kimlik atanır (test ortamı).
  const donenSunucuSoketi = serverModule.io.sockets.sockets.get(donen.id);
  donenSunucuSoketi.userId = 502;
  donenSunucuSoketi.userKey = 'user:502';

  const kontrol = await new Promise(res => donen.emit('gvResumeCheck', {}, res));
  assert.strictEqual(kontrol.devamEdilebilir, true, 'yarım maç bulundu');
  assert.strictEqual(kontrol.roomId, 'ai-masa-1');
  assert.strictEqual(kontrol.seat, ayrilanKoltuk);

  const geri = await new Promise(res => donen.emit('gvResumeSeat', { roomId: 'ai-masa-1' }, res));
  assert.strictEqual(geri.ok, true, 'üye koltuğuna döndü');
  const geriBot = oda.players.find(p => p.seat === ayrilanKoltuk);
  assert.strictEqual(geriBot.aiControlled, false, 'yapay zekâ çekildi');
  assert.strictEqual(geriBot.id, donen.id, 'koltuk yeni sokete bağlandı');
  assert.ok(!/🤖/.test(geriBot.name), 'oyuncu adı eski haline döndü');
  console.log('  ✓ 3) koltuğu YALNIZ ilgili üye geri alabiliyor; yapay zekâ çekiliyor');

  socks.forEach(s => s.close());
  donen.close(); yabanci.close();
  await bekle(200);

  // ---------- 4) MİSAFİR terk ederse koltuk geri alınamaz ----------
  const { socks: s2, koltuk: k2 } = await masaKur(BASE, 'ai-masa-2',
    ['user:601', 'misafir:g9', 'user:603', 'user:604']);
  const oda2 = rooms.get('ai-masa-2');
  const misafir = oda2.players.find(p => p.userKey === 'misafir:g9');
  const misafirSoket = k2[misafir.seat];
  const haber2 = once(s2.find(s => s !== misafirSoket), 'aiTookSeat', 8000);
  misafirSoket.emit('leaveRoom', { roomId: 'ai-masa-2' });
  const h2 = await haber2;
  assert.strictEqual(h2.geriDonebilir, false, 'misafir koltuğu için geri dönüş YOK');
  const bot2 = oda2.players.find(p => p.seat === misafir.seat);
  assert.strictEqual(bot2.aiControlled, true, 'koltuk yapay zekâda');
  assert.strictEqual(bot2.aiReservedUserId, null, 'misafir koltuğu kimseye rezerve değil');
  console.log('  ✓ 4) misafir terk ettiğinde koltuk maç sonuna kadar yapay zekâda kalıyor');

  // ---------- 5) "Pes et" koltuğu bırakır ----------
  const { socks: s3, koltuk: k3 } = await masaKur(BASE, 'ai-masa-3',
    ['user:701', 'user:702', 'user:703', 'user:704']);
  const oda3 = rooms.get('ai-masa-3');
  const pesEden = oda3.players.find(p => p.userKey === 'user:702');
  const pesSoket = k3[pesEden.seat];
  const haber3 = once(s3.find(s => s !== pesSoket), 'aiTookSeat', 8000);
  pesSoket.emit('leaveRoom', { roomId: 'ai-masa-3' });
  await haber3;

  const pesDonen = await connect(BASE, 'PesEden');
  const pesSunucu = serverModule.io.sockets.sockets.get(pesDonen.id);
  pesSunucu.userId = 702; pesSunucu.userKey = 'user:702';
  const pesSonuc = await new Promise(res => pesDonen.emit('gvForfeitSeat', {}, res));
  assert.strictEqual(pesSonuc.ok, true, 'pes etme kabul edildi');
  const pesBot = oda3.players.find(p => p.seat === pesEden.seat);
  assert.strictEqual(pesBot.aiReservedUserId, null, 'pes edince koltuk rezervasyonu düşer');
  const tekrar = await new Promise(res => pesDonen.emit('gvResumeCheck', {}, res));
  assert.strictEqual(tekrar.devamEdilebilir, false, 'pes ettikten sonra dönüş penceresi çıkmaz');
  assert.strictEqual(pesBot.aiControlled, true, 'koltukta yapay zekâ oynamayı sürdürüyor');
  console.log('  ✓ 5) "pes et": koltuk yapay zekâda kalıyor, dönüş hakkı düşüyor');

  s2.forEach(s => s.close()); s3.forEach(s => s.close()); pesDonen.close();
  await bekle(200);

  // ---------- 6) 2 KİŞİLİK oyun DEĞİŞMEDİ ----------
  const c1 = await connect(BASE, 'S1');
  const c2 = await connect(BASE, 'S2');
  const bas = [once(c1, 'gameStarted'), once(c2, 'gameStarted')];
  for (const [s, k] of [[c1, 'user:801'], [c2, 'user:802']]) {
    s.emit('joinRoom', { roomId: 'iki-kisi-1', gameId: 'chess', userName: s.userName,
                         userKey: k, maxPlayers: 2, durationMinutes: 10 });
    await once(s, 'joinedRoom');
  }
  c1.emit('setReady', { ready: true }); c2.emit('setReady', { ready: true });
  await Promise.all(bas);
  const bitti = once(c1, 'gameEnded', 8000);
  c2.emit('leaveRoom', { roomId: 'iki-kisi-1' });
  const son = await bitti;
  assert.strictEqual(son.reason, 'player_left', '2 kişilikte terk hâlâ hükmen mağlubiyet');
  assert.strictEqual(son.youWon, true, 'kalan oyuncu kazandı');
  const oda4 = rooms.get('iki-kisi-1');
  assert.ok(!(oda4.players || []).some(p => p.aiControlled), '2 kişilikte yapay zekâ devralmaz');
  console.log('  ✓ 6) 2 kişilik oyunlarda davranış DEĞİŞMEDİ (terk = hükmen mağlubiyet)');

  c1.close(); c2.close();
  server.close();
  console.log('\n✅ Yapay zekâ devralma ve yarım maça dönüş testleri geçti.');
  process.exit(0);
}

main().catch(e => { console.error('❌ HATA:', e); process.exit(1); });
