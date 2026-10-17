'use strict';
/* TEK KİŞİLİK OYUNLAR — motor, masa akışı, izleyici röle, arayüz bağları
   Apex Garage / Gölge Labirenti / AYLA: 1 koltuklu masa, "Hazırım" oyunu başlatır,
   izleyiciye özet + görüntü karesi iletilir, oyuncu çıkınca masa biter. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-solo-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../solo-engine.js');
const serverModule = require('../server.js');
const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');

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
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 12000);
    s.once(ev, p => { clearTimeout(t); res(p); });
  });
}
const bekle = ms => new Promise(r => setTimeout(r, ms));
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

function motorTesti() {
  assert.deepStrictEqual(E.OYUN_IDLERI.sort(), ['apexgarage', 'ayla', 'golgelabirenti']);
  assert.ok(E.tekKisilikMi('ayla') && !E.tekKisilikMi('okey'));
  const s = E.macBaslat({ oyun: 'ayla', seat: 0, simdi: 1000 });
  assert.strictEqual(s.status, 'playing');
  assert.strictEqual(E.ozetKaydet(s, { durum: 'oynuyor', skor: 120, seviye: '2<b>', metin: 'x' }, 2000), true);
  assert.strictEqual(s.ozet.seviye, '2b', 'etiket karakterleri temizlenmeli');
  assert.strictEqual(E.ozetKaydet(s, { skor: 5 }, 2100), false, 'sık özet yoksayılmalı');
  assert.strictEqual(E.ozetKaydet(s, { skor: -9, durum: 'x' }, 3000), true);
  assert.strictEqual(s.ozet.skor, 0); assert.strictEqual(s.ozet.durum, 'oynuyor');
  assert.strictEqual(s.enYuksekSkor, 120, 'en yüksek skor korunmalı');
  assert.strictEqual(E.kareKabul(s, 'data:text/html;base64,AAAA', 5000), false, 'yalnız JPEG');
  assert.strictEqual(E.kareKabul(s, 'data:image/jpeg;base64,' + 'A'.repeat(100 * 1024), 5000), false, 'büyük kare reddedilir');
  assert.strictEqual(E.kareKabul(s, JPG, 5000), true);
  assert.strictEqual(E.kareKabul(s, JPG, 5100), false, 'hız sınırı');
  const g = E.gorunum(s, 0);
  assert.strictEqual(g.kind, 'ayla'); assert.strictEqual(g.solo, true); assert.strictEqual(g.seat, 0);
  assert.strictEqual(E.gorunum(s, null).seat, null);
  E.pesEt(s);
  assert.strictEqual(s.status, 'finished');
  assert.strictEqual(E.ozetKaydet(s, { skor: 1 }, 99999), false, 'biten oturum kabul etmez');
  console.log('  ✓ 1) solo motor: özet temizliği, hız sınırı, kare doğrulama, görünüm');
}

async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const acik = [];
  for (const oyun of ['apexgarage', 'golgelabirenti', 'ayla']) {
    const r = await (await fetch(BASE + '/api/rooms?gameId=' + oyun)).json();
    const masalar = r.rooms || r;
    assert.strictEqual(masalar.length, 6, oyun + ': 6 hazır masa');
    assert.ok(masalar.every(m => m.maxPlayers === 1), oyun + ': masalar tek kişilik');
  }
  console.log('  ✓ 2) üç oyun için 6 şer tek kişilik hazır masa lobide');

  const oyun = 'golgelabirenti';
  const oda = ((await (await fetch(BASE + '/api/rooms?gameId=' + oyun)).json()).rooms || [])[0];
  const rid = String(oda.id);
  const P = await connect(BASE, 'solo-P');
  const W = await connect(BASE, 'solo-W');
  acik.push(P, W);
  P.emit('joinRoom', { roomId: rid, gameId: oyun, userName: 'solo-P', userKey: 'test:P', maxPlayers: 1, durationMinutes: oda.durationMinutes });
  await once(P, 'joinedRoom');
  const basladi = once(P, 'gameStarted', 12000);
  P.emit('setReady', { ready: true });
  const gs = await basladi;
  assert.strictEqual(gs.gameState.kind, oyun);
  assert.strictEqual(gs.gameState.solo, true);
  console.log('  ✓ 3) tek oyuncu "Hazırım" deyince oyun doğrudan başladı');

  W.emit('joinRoom', { roomId: rid, gameId: oyun, userName: 'solo-W', userKey: 'test:W', maxPlayers: 1, durationMinutes: oda.durationMinutes });
  const j = await once(W, 'joinedRoom');
  assert.strictEqual(j.role, 'spectator', 'ikinci kişi izleyici olmalı');

  const oz = once(W, 'soloOzet');
  P.emit('soloOzet', { ozet: { durum: 'oynuyor', skor: 77, seviye: '3', metin: 'Test' } });
  const o = await oz;
  assert.strictEqual(o.ozet.skor, 77);
  const kare = once(W, 'soloKare');
  P.emit('soloKare', { img: JPG });
  assert.strictEqual((await kare).img, JPG);
  console.log('  ✓ 4) izleyici oyuncunun özetini ve ekran karesini alıyor');

  // izleyici yollayamaz
  let sizdi = false;
  P.once('soloOzet', () => { sizdi = true; });
  W.emit('soloOzet', { ozet: { skor: 999 } });
  await bekle(500);
  assert.ok(!sizdi, 'izleyicinin özeti kabul edilmemeli');
  console.log('  ✓ 5) izleyici özet/kare yollayamıyor');

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/apexgarage:\{name:/.test(sayfa) && /golgelabirenti:\{name:/.test(sayfa) && /ayla:\{name:/.test(sayfa), 'GAMES kayıtları');
  assert.ok(/js\/tek-kisilik-online\.js/.test(sayfa), 'adaptör bağlı');
  assert.ok(/homeSolo/.test(sayfa) && /Tek Kişilik Oyunlar/.test(sayfa), 'ana sayfa bölümü');
  assert.ok(/\.tk-wrap\{/.test(sayfa) && /\.tk-frame\{/.test(sayfa), 'iframe stilleri');
  const ist = oku('js/tek-kisilik-online.js');
  assert.ok(/kinds: IDLER/.test(ist) && /e\.source !== frame\.contentWindow/.test(ist) && /damga: function/.test(ist));
  const sunucu = oku('server.js');
  assert.ok(/socket\.on\('soloOzet'/.test(sunucu) && /socket\.on\('soloKare'/.test(sunucu));
  const panel = oku('js/admin-panel.js');
  assert.ok(/apexgarage: 2801/.test(panel) && /golgelabirenti: 2851/.test(panel) && /ayla: 2901/.test(panel), 'panel taban numaraları');
  for (const f of ['apexgarage', 'golgelabirenti', 'ayla']) {
    assert.ok(fs.existsSync(path.join(KOK, 'assets/covers', f + '.jpg')), f + ' kapağı');
    const h = oku('assets/oyunlar/tek-' + f + '.html');
    assert.ok(/src:\s*'tekkisilik'|src:"tekkisilik"|tekkisilik/.test(h), f + ': köprü enjekte');
  }
  console.log('  ✓ 6) istemci, ana sayfa bölümü, panel, kapaklar ve oyun dosyaları bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK tek kişilik oyunlar: motor, masa akışı, izleyici rölesi, arayüz');
    process.exit(0);
  } catch (e) { console.error('TEK KİŞİLİK HATASI:', e); process.exit(1); }
})();
