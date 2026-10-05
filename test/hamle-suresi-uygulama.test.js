'use strict';
/* ============================================================================
 * HAMLE SÜRESİ GERÇEKTEN UYGULANIYOR MU? (14 oyunun hepsinde)
 * ============================================================================
 * Kullanıcı isteği: "bazı oyunların hamle sürelerini değiştiremiyorum. Tüm
 * oyunların hamle süreleri kurucu tarafından belirlenen manuel süre ile
 * senkron çalışması gerek. Düzgün çalıştığından emin ol."
 *
 * Kardeş test (hamle-suresi-ayari) ayarın KAYDEDİLDİĞİNİ doğruluyor. Bu test
 * bir adım ötesini soruyor: ayar gerçekten İŞLİYOR mu?
 *
 *   1) ODAYA YAZILIYOR MU — 14 oyunun her birinde kurucunun girdiği saniye
 *      room.moveLimitMs'e geçiyor mu. (Satranç ve tavla bir ara bu listenin
 *      DIŞINDAYDI: onlarda hamle sayacı 60 sn'ye sabitti ve panel kutuyu
 *      hiç çizmiyordu — kullanıcının bildirdiği hata buydu.)
 *   2) OYUNCUYA GİDİYOR MU — masaya oturan herkesin durum paketinde aynı
 *      sınır görünüyor mu. Sunucu doğru bilse bile pakete yazılmazsa
 *      ekrandaki geri sayım yanlış olur.
 *   3) SÜRE DOLUNCA ÇALIŞIYOR MU — 5 sn'lik bir masada sunucu gerçekten
 *      5 sn sonra devreye giriyor mu. Satranç ve tavla için ayrı ayrı
 *      denenir: ikisinde de hükmen mağlubiyet 'move_timeout' ile gelmeli.
 *      Burası asıl kanıt; kalan maddeler ona hazırlık.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-hamle-uyg-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@kurucu.com';
process.env.GV_ADMIN_PASS = 'test-kurucu-sifresi-9271';
process.env.GV_OKEY_PRESETS = '1';
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const SN = 5;          // sınırın en küçüğü — bekleme süresi kısa kalsın
const MS = SN * 1000;

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
  try { return await r.json(); } catch (_) { return { ok: false, status: r.status }; }
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const acik = [];

  const giris = await api(BASE, '/api/auth/login',
    { email: 'kurucu@kurucu.com', password: process.env.GV_ADMIN_PASS });
  assert.ok(giris.ok && giris.token, 'kurucu girişi: ' + JSON.stringify(giris).slice(0, 160));
  const T = giris.token;

  // ---------- 1) 14 oyunun HEPSİNDE oda süreyi alıyor mu ----------
  const ayar = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  const oyunlar = Object.keys(ayar).filter(g => Array.isArray(ayar[g].tables) && ayar[g].tables.length);
  assert.ok(oyunlar.length >= 12, 'masa tanımı olan oyunlar listelenmeli — ' + oyunlar.length);
  for (const g of oyunlar) ayar[g].tables.forEach(t => { t.moveSeconds = SN; });
  const r = await api(BASE, '/api/admin/tables-apply', { games: ayar }, 'POST', T);
  assert.strictEqual(r.ok, true, 'ayar uygulanmalı — ' + JSON.stringify(r).slice(0, 200));

  const eksik = [];
  for (const g of oyunlar) {
    const odalar = [...rooms.values()].filter(x => x.isPreset && x.gameId === g);
    if (!odalar.length) { eksik.push(g + ' (masa açılmadı)'); continue; }
    const yanlis = odalar.filter(o => Number(o.moveLimitMs) !== MS);
    if (yanlis.length) eksik.push(g + ' → ' + yanlis.map(o => o.moveLimitMs).join(','));
  }
  assert.deepStrictEqual(eksik, [],
    'şu oyunlarda kurucunun girdiği hamle süresi odaya geçmedi:\n  ' + eksik.join('\n  '));
  console.log('  ✓ 1) ' + oyunlar.length + ' oyunun bütün masaları ' + SN + ' sn hamle süresini aldı');

  /* Masaya iki oyuncu oturt ve gameStarted paketlerini topla. */
  async function masayaOtur(oda, kisi) {
    const soketler = [];
    for (let i = 0; i < kisi; i++) {
      const s = await connect(BASE, oda.gameId + '-O' + i);
      acik.push(s); soketler.push(s);
    }
    const basladi = soketler.map(s => once(s, 'gameStarted', 15000));
    for (const s of soketler) {
      s.emit('joinRoom', {
        roomId: String(oda.id), gameId: oda.gameId, userName: s.userName,
        userKey: 'test:' + s.userName, maxPlayers: oda.maxPlayers,
        durationMinutes: oda.durationMinutes, rounds: oda.okeyMaxRounds
      });
      await once(s, 'joinedRoom');
    }
    for (const s of soketler) s.emit('setReady', { ready: true });
    return { soketler, paketler: await Promise.all(basladi) };
  }

  /* Her bölüm AYRI masa kullansın: aynı masaya ikinci kez oturmak,
     önceki maçın bitiş/sıfırlama penceresine denk gelip takılıyor. */
  function oda(g, sira) {
    const hepsi = [...rooms.values()].filter(x => x.isPreset && x.gameId === g)
      .sort((a, b) => Number(a.id) - Number(b.id));
    assert.ok(hepsi[sira || 0], g + ': ' + ((sira || 0) + 1) + '. masa olmalı');
    return hepsi[sira || 0];
  }

  // ---------- 2) durum paketi doğru sınırı taşıyor mu ----------
  /* Her oyun türünden birer temsilci: tahta (satranç), zar (tavla),
     taş (dama), kart (pişti) ve kelime (kelimelik). Beşi de ayrı durum
     paketi üreticisi kullanıyor; sınır birinde unutulursa burada çıkar. */
  for (const g of ['chess', 'tavla', 'dama', 'pisti', 'kelimelik']) {
    const masa = oda(g, 0);
    const { soketler, paketler } = await masayaOtur(masa, 2);
    for (const p of paketler) {
      const gs = p.gameState || {};
      const sinir = Number(gs.moveLimitMs || gs.turnLimitMs || 0);
      assert.strictEqual(sinir, MS,
        g + ': oyuncunun durum paketindeki hamle sınırı ' + MS + ' olmalı, ' + sinir + ' geldi');
    }
    for (const s of soketler) { try { s.close(); } catch (_) {} }
  }
  console.log('  ✓ 2) satranç, tavla, dama, pişti ve kelimelik paketleri aynı sınırı taşıyor');

  // ---------- 3) SÜRE DOLUNCA GERÇEKTEN DEVREYE GİRİYOR MU ----------
  /* Asıl kanıt. Kullanıcının bildirdiği hata satranç ve tavladaydı:
     sayaç masanın süresine değil, koda gömülü 60 sn'ye bakıyordu. 5 sn'lik
     masada hiç hamle yapılmazsa sunucu 5-7 sn içinde 'move_timeout' ile
     maçı bitirmeli. Eski kodda bu olay 60 sn'den önce HİÇ gelmezdi. */
  for (const g of ['chess', 'tavla']) {
    const masa = oda(g, 1);   // 2. masa: 2. bölümdeki maç karışmasın
    const { soketler } = await masayaOtur(masa, 2);
    const t0 = Date.now();
    const bitti = await Promise.race([
      once(soketler[0], 'gameEnded', 13000),
      new Promise(res => setTimeout(() => res(null), 13000))
    ]);
    const gecen = Date.now() - t0;
    assert.ok(bitti, g + ': ' + SN + ' sn hamle süresi dolduğu hâlde maç bitmedi — ' +
      'sayaç masanın süresine bakmıyor (eskiden 60 sn\'ye sabitti)');
    assert.strictEqual(bitti.reason, 'move_timeout',
      g + ': bitiş sebebi move_timeout olmalı, "' + bitti.reason + '" geldi');
    assert.ok(gecen >= MS - 1500 && gecen <= MS + 6000,
      g + ': bitiş ' + SN + ' sn civarında olmalı, ' + Math.round(gecen / 1000) + ' sn sürdü');
    for (const s of soketler) { try { s.close(); } catch (_) {} }
  }
  console.log('  ✓ 3) satranç ve tavlada süre dolunca ' + SN + ' sn içinde move_timeout geldi');

  // ---------- 4) uyarı sınırın içinde kalıyor mu ----------
  /* 5 sn'lik masada 40. saniyede uyarmak anlamsız olurdu; uyarı sınırın
     1 sn altına çekiliyor. Sunucu kaynağında bu kural iki yerde de
     (kart dalı ve satranç/tavla dalı) aynı olmalı. */
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const uyarilar = kaynak.match(/Math\.min\(\s*MOVE_WARN_MS\s*,\s*sinir\s*-\s*1000\s*\)/g) || [];
  assert.ok(uyarilar.length >= 2,
    'hamle uyarısı HER dalda sınırın içinde kalmalı (Math.min(MOVE_WARN_MS, sinir-1000)) — ' +
    uyarilar.length + ' yerde bulundu');
  assert.ok(!/HAMLE_SURESI_YOK/.test(kaynak),
    'hiçbir oyun hamle süresi ayarının dışında bırakılmamalı');
  console.log('  ✓ 4) uyarı eşiği sınırın içinde, dışarıda bırakılan oyun yok');

  for (const s of acik) { try { s.close(); } catch (_) {} }
  server.close();
  console.log('OK hamle süresi uygulaması: 14 oyun, paketler ve zaman aşımı');
  process.exit(0);
}
main().catch(e => { console.error('❌ HAMLE SÜRESİ UYGULAMA HATASI:', e); process.exit(1); });
