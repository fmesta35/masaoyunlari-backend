'use strict';

/*
 * PUAN / CEZA SİSTEMİ + GERÇEK ÇEVRİMİÇİ SAYACI (uçtan uca)
 * =========================================================
 *
 *  1) scoring.js kuralları: tablo değerleri ve el sayısı çarpanı
 *     (3 el ×1, 5 el ×1.25, 7 el ×1.5). Terk (−20) ve dönüş (+10)
 *     ÇARPANSIZDIR — kullanıcının verdiği sabit değerlerdir.
 *  2) Maç bitişinde puanlar üye profiline işlenir ve OYUN TÜRÜNE GÖRE
 *     AYRI raporlanır (/api/scores/me).
 *  3) Masayı terk eden üye ayrılma ANINDA −20 alır; geri dönerse +10
 *     iade edilir ve sonrasında normal puanlama devam eder.
 *  4) Kurucu paneli: elle sıfırlama ve otomatik periyot ayarı — YALNIZ
 *     kurucuya açık; sıfırlama veriyi SİLMEZ, yeni sayım noktası koyar.
 *  5) Çevrimiçi sayacı KİŞİ sayar, soket değil: aynı kişinin üç sekmesi
 *     tek kişidir; nabız kesilince kişi sayımdan düşer.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-score-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@puan.test';
process.env.GV_ADMIN_PASS = 'puan-kurucu-sifresi-4471';
process.env.GV_POST_GAME_HOLD_MS = '300';

const assert = require('assert');
const scoring = require('../scoring.js');
const serverModule = require('../server.js');

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, {
    method: method || (body ? 'POST' : 'GET'), headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function uyeAc(base, ad, mail) {
  const reg = await api(base, '/api/auth/register', { name: ad, email: mail, password: 'ortaksifre9' }, 'POST');
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
  await api(base, '/api/auth/verify', { token: vt }, 'POST');
  const g = await api(base, '/api/auth/login', { email: mail, password: 'ortaksifre9' }, 'POST');
  return { id: g.user.id, token: g.token, name: ad };
}

function bekle(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // ---------- 1) kurallar ----------
  assert.strictEqual(scoring.PUAN.win, 25, 'galibiyet +25');
  assert.strictEqual(scoring.PUAN.draw, 10, 'beraberlik +10');
  assert.strictEqual(scoring.PUAN.loss, 5, 'mağlubiyet +5 (masada kaldı)');
  assert.strictEqual(scoring.PUAN.timeout, 2, 'süre aşımı mağlubiyeti +2');
  assert.strictEqual(scoring.PUAN.win_left, 15, 'rakip terkiyle galibiyet +15');
  assert.strictEqual(scoring.PUAN.leave, -20, 'masayı terk −20');
  assert.strictEqual(scoring.PUAN.rejoin, 10, 'geri dönüş +10');

  assert.strictEqual(scoring.puanHesapla('win', 3), 25, '3 el ×1');
  assert.strictEqual(scoring.puanHesapla('win', 5), 31, '5 el ×1.25');
  assert.strictEqual(scoring.puanHesapla('win', 7), 38, '7 el ×1.5');
  // Terk ve dönüş çarpandan ETKİLENMEZ (kullanıcının sabit değerleri).
  assert.strictEqual(scoring.puanHesapla('leave', 7), -20, 'terk her masada −20');
  assert.strictEqual(scoring.puanHesapla('rejoin', 7), 10, 'dönüş her masada +10');

  // Misafirler puan almaz (uid yok).
  const olaylar = scoring.macOlaylari({
    gameId: 'okey', roomId: '1', elSayisi: 3,
    oyuncular: [{ uid: 7, ad: 'A', kazandi: true }, { uid: 0, ad: 'Misafir' }]
  });
  assert.strictEqual(olaylar.length, 1, 'yalnız üye için olay üretilir');
  assert.strictEqual(olaylar[0].tur, 'win');
  console.log('  ✓ 1) puan tablosu ve el sayısı çarpanı doğru; misafire puan yazılmaz');

  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 2) kurallar ucu ----------
  const kural = await api(BASE, '/api/scores/rules', null, 'GET');
  assert.ok(kural.ok && kural.puan && kural.puan.win === 25, 'kurallar ucu sunucudan gelir');
  assert.ok(kural.periyotlar && kural.periyotlar.haftalik, 'sıfırlama periyotları listelenir');
  console.log('  ✓ 2) /api/scores/rules — puan kuralları tek kaynaktan (istemci hesap yapmaz)');

  // ---------- 3) puanların profile işlenmesi ----------
  const ali = await uyeAc(BASE, 'Ali', 'ali@puan.test');
  const veli = await uyeAc(BASE, 'Veli', 'veli@puan.test');

  const ic = serverModule.__test || {};
  assert.ok(ic.puanYaz && ic.scoring, 'test kancaları açık');

  // Ali dama kazanır (3 el), Veli kaybeder.
  ic.puanYaz(scoring.macOlaylari({
    gameId: 'dama', roomId: '401', elSayisi: 3,
    oyuncular: [{ uid: ali.id, ad: 'Ali', kazandi: true }, { uid: veli.id, ad: 'Veli' }]
  }));
  // Ali okeyde kaybeder (5 el) — oyun türü AYRI tutulmalı.
  ic.puanYaz(scoring.macOlaylari({
    gameId: 'okey', roomId: '301', elSayisi: 5,
    oyuncular: [{ uid: ali.id, ad: 'Ali' }, { uid: veli.id, ad: 'Veli', kazandi: true }]
  }));

  const aliOzet = await api(BASE, '/api/scores/me', null, 'GET', ali.token);
  assert.ok(aliOzet.ok, 'kendi puan özetini okuyabilir');
  const oyunlar = aliOzet.ozet.oyunlar;
  assert.strictEqual(oyunlar.length, 2, 'iki ayrı oyun türü ayrı satır');
  const damaSatiri = oyunlar.find(o => o.gameId === 'dama');
  const okeySatiri = oyunlar.find(o => o.gameId === 'okey');
  assert.strictEqual(damaSatiri.puan, 25, 'dama galibiyeti 25');
  assert.strictEqual(damaSatiri.galibiyet, 1);
  assert.strictEqual(okeySatiri.puan, 6, 'okey mağlubiyeti 5×1.25 = 6');
  assert.strictEqual(okeySatiri.maglubiyet, 1);
  assert.strictEqual(aliOzet.ozet.toplam, 31, 'toplam 25 + 6');
  console.log('  ✓ 3) istatistikler OYUN TÜRÜNE GÖRE AYRI tutuluyor (dama 25, okey 6, toplam 31)');

  // Girişsiz kullanıcı başkasının puanını okuyamaz.
  const yetkisiz = await api(BASE, '/api/scores/me', null, 'GET');
  assert.strictEqual(yetkisiz.status, 401, 'puan özeti üyeliğe bağlı');

  // ---------- 4) terk cezası ve geri dönüş iadesi ----------
  ic.puanYaz([scoring.terkOlayi({ uid: veli.id, ad: 'Veli', gameId: 'okey', roomId: '301' })]);
  let veliOzet = await api(BASE, '/api/scores/me', null, 'GET', veli.token);
  let veliOkey = veliOzet.ozet.oyunlar.find(o => o.gameId === 'okey');
  // Veli okeyde kazanmıştı (25×1.25 = 31), sonra terk etti (−20) → 11
  assert.strictEqual(veliOkey.puan, 11, 'terk cezası uygulandı (31 − 20)');
  assert.strictEqual(veliOkey.terk, 1, 'terk sayısı profilde görünür');

  ic.puanYaz([scoring.donusOlayi({ uid: veli.id, ad: 'Veli', gameId: 'okey', roomId: '301' })]);
  veliOzet = await api(BASE, '/api/scores/me', null, 'GET', veli.token);
  veliOkey = veliOzet.ozet.oyunlar.find(o => o.gameId === 'okey');
  assert.strictEqual(veliOkey.puan, 21, 'geri dönüş +10 iade edildi (net ceza −10)');
  assert.strictEqual(veliOkey.donus, 1, 'dönüş sayısı profilde görünür');
  console.log('  ✓ 4) masayı terk −20, geri dönüş +10 iade; sonrasında normal puanlama sürer');

  // Toplam puan TABANI: eksiye düşmez.
  const bos = await uyeAc(BASE, 'Cezali', 'cezali@puan.test');
  ic.puanYaz([scoring.terkOlayi({ uid: bos.id, ad: 'Cezali', gameId: 'dama', roomId: '401' })]);
  const bosOzet = await api(BASE, '/api/scores/me', null, 'GET', bos.token);
  assert.strictEqual(bosOzet.ozet.toplam, 0, 'toplam puan 0 tabanının altına inmez');
  console.log('  ✓ 4b) toplam puan 0 tabanının altına inmiyor');

  // ---------- 5) sıralama ----------
  const board = await api(BASE, '/api/scores/board?limit=10', null, 'GET');
  assert.ok(board.ok && board.siralama.length >= 2, 'sıralama döner');
  assert.ok(board.siralama[0].puan >= board.siralama[1].puan, 'puana göre azalan');
  const damaBoard = await api(BASE, '/api/scores/board?game=dama&limit=10', null, 'GET');
  assert.ok(damaBoard.siralama.some(r => r.name === 'Ali'), 'oyun türüne göre sıralama');
  console.log('  ✓ 5) sıralama tablosu — genel ve oyun türüne göre');

  // ---------- 6) kurucu paneli: sıfırlama ----------
  const kurucu = await api(BASE, '/api/auth/login',
    { email: 'kurucu@puan.test', password: 'puan-kurucu-sifresi-4471' }, 'POST');
  assert.ok(kurucu.ok && kurucu.user.isFounder, 'kurucu girişi');

  const yetkisizSifir = await api(BASE, '/api/admin/scores/reset', {}, 'POST', ali.token);
  assert.strictEqual(yetkisizSifir.status, 403, 'sıfırlama YALNIZ kurucuya açık');

  const ayar0 = await api(BASE, '/api/admin/scores/settings', null, 'GET', kurucu.token);
  assert.strictEqual(ayar0.periyot, 'kapali', 'başlangıçta otomatik sıfırlama kapalı');
  assert.ok(ayar0.secenekler.haftalik && ayar0.secenekler.aylik && ayar0.secenekler.ceyrek &&
            ayar0.secenekler.yarim && ayar0.secenekler.yillik,
            'haftalık / aylık / 3 aylık / 6 aylık / yıllık seçenekleri var');

  const kotuPeriyot = await api(BASE, '/api/admin/scores/settings', { periyot: 'gunluk' }, 'POST', kurucu.token);
  assert.strictEqual(kotuPeriyot.status, 400, 'tanımsız periyot reddedilir');

  const ayarYaz = await api(BASE, '/api/admin/scores/settings', { periyot: 'aylik' }, 'POST', kurucu.token);
  assert.ok(ayarYaz.ok && ayarYaz.periyot === 'aylik', 'otomatik periyot kaydedildi');
  const ayar1 = await api(BASE, '/api/admin/scores/settings', null, 'GET', kurucu.token);
  assert.strictEqual(ayar1.periyot, 'aylik', 'ayar kalıcı');

  await bekle(5);
  const sifirla = await api(BASE, '/api/admin/scores/reset', {}, 'POST', kurucu.token);
  assert.ok(sifirla.ok, 'elle sıfırlama çalıştı');

  const aliSonra = await api(BASE, '/api/scores/me', null, 'GET', ali.token);
  assert.strictEqual(aliSonra.ozet.toplam, 0, 'sıfırlamadan sonra puan 0');
  assert.strictEqual(aliSonra.ozet.oyunlar.length, 0, 'sıfırlamadan sonra oyun satırı yok');
  // Veri SİLİNMEDİ: ham olaylar duruyor, yalnız sayım noktası ileri alındı.
  const { db } = require('../db');
  const kalan = db.prepare('SELECT COUNT(*) c FROM score_events').get().c;
  assert.ok(kalan > 0, 'sıfırlama veriyi SİLMEZ (geçmiş korunur)');
  console.log('  ✓ 6) kurucu paneli: elle sıfırlama + otomatik periyot (veri silinmeden)');

  // Sıfırlamadan SONRA kazanılan puan yeniden sayılır.
  ic.puanYaz(scoring.macOlaylari({
    gameId: 'dama', roomId: '402', elSayisi: 7,
    oyuncular: [{ uid: ali.id, ad: 'Ali', kazandi: true }]
  }));
  const aliYeni = await api(BASE, '/api/scores/me', null, 'GET', ali.token);
  assert.strictEqual(aliYeni.ozet.toplam, 38, 'yeni dönem puanı sayılıyor (25 × 1.5)');
  console.log('  ✓ 6b) sıfırlama sonrası yeni dönem puanları normal işliyor');

  // ---------- 7) GERÇEK çevrimiçi sayacı ----------
  const s0 = await api(BASE, '/api/live-stats', null, 'GET');
  assert.strictEqual(s0.online, 0, 'kimse nabız atmadıysa çevrimiçi 0 (uydurma sayı yok)');

  // Aynı kişinin ÜÇ sekmesi → TEK kişi.
  for (let i = 0; i < 3; i++) {
    await api(BASE, '/api/live-stats', { uid: null, cihaz: 'cihaz-A' }, 'POST');
  }
  let s1 = await api(BASE, '/api/live-stats', null, 'GET');
  assert.strictEqual(s1.online, 1, 'aynı cihazın 3 sekmesi 1 kişi sayılır');
  assert.strictEqual(s1.guests, 1, 'ziyaretçi olarak sayıldı');
  assert.strictEqual(s1.members, 0, 'üye sayılmadı');

  // Farklı bir ziyaretçi + bir üye.
  await api(BASE, '/api/live-stats', { uid: null, cihaz: 'cihaz-B' }, 'POST');
  await api(BASE, '/api/live-stats', { uid: ali.id, cihaz: 'cihaz-C' }, 'POST');
  s1 = await api(BASE, '/api/live-stats', null, 'GET');
  assert.strictEqual(s1.online, 3, '2 ziyaretçi + 1 üye = 3 kişi');
  assert.strictEqual(s1.members, 1, 'üye sayısı ayrı raporlanıyor');
  assert.strictEqual(s1.guests, 2, 'ziyaretçi sayısı ayrı raporlanıyor');

  // Aynı üye BAŞKA bir cihazdan da girse tek kişidir (kimlik uid'dir).
  await api(BASE, '/api/live-stats', { uid: ali.id, cihaz: 'cihaz-D' }, 'POST');
  s1 = await api(BASE, '/api/live-stats', null, 'GET');
  assert.strictEqual(s1.online, 3, 'aynı üyenin ikinci cihazı yeni kişi değildir');

  // Sekme kapanış işareti: kişi ANINDA düşer.
  await api(BASE, '/api/presence-bye', { uid: null, cihaz: 'cihaz-B' }, 'POST');
  s1 = await api(BASE, '/api/live-stats', null, 'GET');
  assert.strictEqual(s1.online, 2, 'sekmesini kapatan kişi hemen sayımdan düştü');
  assert.strictEqual(s1.tournaments, 0, 'turnuva motoru yok → 0 (uydurma sayı yok)');
  console.log('  ✓ 7) çevrimiçi sayacı KİŞİ sayıyor: çok sekme tek kişi, ayrılan anında düşüyor');

  // ---------- 8) GERÇEK MAÇ AKIŞI: terk eden −20, kalan +15 ----------
  // Buraya kadarki testler puan yazımını doğrudan çağırdı. Bu bölüm
  // sunucunun KENDİ akışını sınar: iki üye masaya oturur, oyun başlar,
  // biri masayı terk eder. Beklenen: terk edene −20, kalana "rakip terk
  // etti" galibiyeti +15.
  const { io: ioClient } = require('socket.io-client');
  const sifirla2 = await api(BASE, '/api/admin/scores/reset', {}, 'POST', kurucu.token);
  assert.ok(sifirla2.ok, 'bölüm 8 için temiz sayfa');
  await bekle(5);

  function baglan(userKey, ad) {
    const sock = ioClient(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('bağlanamadı: ' + ad)), 8000);
      sock.on('connect', () => { clearTimeout(t); sock.userKey = userKey; sock.userName = ad; res(sock); });
      sock.on('connect_error', rej);
    });
  }
  function birKez(sock, olay, ms) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('beklendi: ' + olay)), ms || 6000);
      sock.once(olay, p => { clearTimeout(t); res(p); });
    });
  }
  function otur(sock, roomId) {
    const p = birKez(sock, 'joinedRoom');
    sock.emit('joinRoom', { roomId, gameId: 'chess', userName: sock.userName, userKey: sock.userKey,
                            maxPlayers: 2, durationMinutes: 10, roomName: 'Puan Masası' });
    return p;
  }

  const sockAli = await baglan('user:' + ali.id, 'Ali');
  const sockVeli = await baglan('user:' + veli.id, 'Veli');
  await otur(sockAli, 'puan-masa-1');
  await otur(sockVeli, 'puan-masa-1');
  sockAli.emit('setReady', { ready: true });
  sockVeli.emit('setReady', { ready: true });
  await birKez(sockAli, 'gameStarted');
  await birKez(sockVeli, 'gameStarted');

  // Veli masayı terk ediyor.
  const bitis = birKez(sockAli, 'gameEnded');
  sockVeli.emit('leaveRoom', { roomId: 'puan-masa-1' });
  const son = await bitis;
  assert.strictEqual(son.reason, 'player_left', 'terk nedeni sunucudan geldi');
  await bekle(400);   // puan yazımı ve oda sıfırlama

  const aliMac = await api(BASE, '/api/scores/me', null, 'GET', ali.token);
  const veliMac = await api(BASE, '/api/scores/me', null, 'GET', veli.token);
  const aliSatranc = (aliMac.ozet.oyunlar || []).find(o => o.gameId === 'chess');
  const veliSatranc = (veliMac.ozet.oyunlar || []).find(o => o.gameId === 'chess');
  assert.ok(aliSatranc, 'masada kalan oyuncuya puan işlendi');
  assert.strictEqual(aliSatranc.puan, 15, 'rakibin terkiyle gelen galibiyet +15');
  assert.strictEqual(aliSatranc.galibiyet, 1, 'galibiyet sayacı arttı');
  assert.ok(veliSatranc, 'terk eden oyuncuya ceza işlendi');
  assert.strictEqual(veliSatranc.puan, -20, 'masayı terk −20');
  assert.strictEqual(veliSatranc.terk, 1, 'terk sayacı arttı');
  assert.strictEqual(veliMac.ozet.toplam, 0, 'eksi toplam 0 tabanında gösterilir');
  sockAli.close(); sockVeli.close();
  console.log('  ✓ 8) gerçek maç akışı: terk edene −20, masada kalana +15 otomatik işlendi');

  server.close();
  console.log('\n✅ Puan sistemi ve gerçek çevrimiçi sayacı testleri geçti.');
  process.exit(0);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
