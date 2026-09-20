/* =====================================================================
   AMİRAL BATTI — SİNEMATİK + SES TESTİ
   ---------------------------------------------------------------------
   Neyi kilitliyor:
     1) Sunucu her atış sonucuna TOHUM ve SAHNE SÜRESİ (kilitMs) ekliyor.
     2) Tohum iki oyuncuya da AYNI gidiyor — iki ekranda aynı sahne oynasın.
     3) Sahne süreleri sonuca göre doğru (ıska < isabet < batış).
     4) İstemcide ses tercihi varsayılan AÇIK, kapatılabiliyor ve
        tarayıcıda saklanıyor (gv-ses).
     5) Oda başlığındaki 🔊 düğmesi tercihi değiştiriyor ve etiketi
        Türkçe olarak güncelliyor.
     6) Ses kapalıyken hiçbir ses üretilmiyor.
     7) Sinematik motoru yoksa/çizemiyorsa oyun bozulmuyor ve ekranda
        artık bir katman bırakmıyor.
   ===================================================================== */
const assert = require('assert');
const ioClient = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function baglan(base) { return ioClient(base, { transports: ['websocket'], forceNew: true }); }

function bekleOlay(sock, ad, sart, ms) {
  return new Promise((res, rej) => {
    const zt = setTimeout(() => rej(new Error('zaman aşımı: ' + ad)), ms || 8000);
    sock.on(ad, p => {
      if (sart && !sart(p)) return;
      clearTimeout(zt); res(p);
    });
  });
}

async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { const v = fn(); if (v) return v; await sleep(60); }
  throw new Error('zaman aşımı: ' + ne);
}

/* Sınır içi, çakışmasız klasik dizilim (battleship-online testiyle aynı). */
function yerlesim() {
  return [
    { shipId: 'carrier', r: 0, c: 0, dir: 'h' },
    { shipId: 'battleship', r: 1, c: 0, dir: 'h' },
    { shipId: 'cruiser', r: 2, c: 0, dir: 'h' },
    { shipId: 'submarine', r: 3, c: 0, dir: 'h' },
    { shipId: 'destroyer', r: 4, c: 0, dir: 'h' }
  ];
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1-3) SUNUCU: tohum ve sahne süresi ----------
  {
    const A = baglan(BASE), B = baglan(BASE);
    const oda = 'sinema-1';
    // Yerleştirme reddedilirse sessizce beklemektense hemen görelim.
    [A, B].forEach(sk => sk.on('battleshipRejected', r => console.log('  ! yerleştirme/atış reddi:', JSON.stringify(r))));
    await sleep(350);
    const kA = bekleOlay(A, 'gameStarted'), kB = bekleOlay(B, 'gameStarted');
    A.emit('joinRoom', { roomId: oda, gameId: 'battleship', maxPlayers: 2, userName: 'A', userKey: 'sin:A' });
    B.emit('joinRoom', { roomId: oda, gameId: 'battleship', maxPlayers: 2, userName: 'B', userKey: 'sin:B' });
    await sleep(500);
    A.emit('setReady', { ready: true });
    B.emit('setReady', { ready: true });
    const [pA, pB] = await Promise.all([kA, kB]);
    await sleep(400);

    const savasA = bekleOlay(A, 'gameStateUpdated', p => p.gameState && p.gameState.phase === 'battle', 12000);
    A.emit('battleshipPlace', { roomId: oda, placements: yerlesim() });
    await sleep(350);
    B.emit('battleshipPlace', { roomId: oda, placements: yerlesim() });
    const savas = await savasA;
    const sira = savas.gameState.turn;
    const koltuklar = { [pA.seat]: A, [pB.seat]: B };
    const siradaki = koltuklar[sira], oteki = koltuklar[sira === 0 ? 1 : 0];

    // (9,9) boş su — filonun tamamı ilk beş satırda.
    const iskaA = bekleOlay(A, 'battleshipShotResult', p => p.r === 9 && p.c === 9);
    const iskaB = bekleOlay(B, 'battleshipShotResult', p => p.r === 9 && p.c === 9);
    siradaki.emit('battleshipFire', { roomId: oda, r: 9, c: 9 });
    const i1 = await iskaA, i2 = await iskaB;

    assert.strictEqual(i1.result, 'miss', '(9,9) ıska olmalı');
    assert.ok(Number.isFinite(i1.tohum), 'atış sonucunda sinematik tohumu olmalı');
    assert.strictEqual(i1.tohum, i2.tohum,
      'TOHUM iki oyuncuda AYNI olmalı — yoksa ekranlarda farklı sahne oynar');
    assert.strictEqual(i1.kilitMs, 2200, 'ıska sahnesi 2200 ms sürmeli');

    // Rakibin destroyer'ı (4,0)-(4,1): iki isabet = batış.
    const v1 = bekleOlay(oteki, 'battleshipShotResult', p => p.r === 4 && p.c === 0, 12000);
    oteki.emit('battleshipFire', { roomId: oda, r: 4, c: 0 });
    const vur = await v1;
    assert.strictEqual(vur.result, 'hit', 'destroyer başına isabet bekleniyordu');
    assert.strictEqual(vur.kilitMs, 2600, 'isabet sahnesi 2600 ms sürmeli');
    assert.ok(vur.kilitMs > i1.kilitMs, 'isabet sahnesi ıskadan uzun olmalı');
    assert.notStrictEqual(vur.tohum, i1.tohum, 'her atışın tohumu ayrı olmalı');

    // Sıra motorda her atıştan sonra kesin olarak el değiştirir; isabetten
    // sonra tekrar 'siradaki' koltuktadır. Bir ıska ile sırayı geri verip
    // ikinci isabetle gemiyi batırıyoruz.
    await sleep(400);
    siradaki.emit('battleshipFire', { roomId: oda, r: 8, c: 8 });
    await sleep(400);
    const b1 = bekleOlay(oteki, 'battleshipShotResult', p => p.r === 4 && p.c === 1, 12000);
    oteki.emit('battleshipFire', { roomId: oda, r: 4, c: 1 });
    const bat = await b1;
    assert.strictEqual(bat.result, 'sunk', 'ikinci isabet gemiyi batırmalı');
    assert.strictEqual(bat.kilitMs, 4600, 'batış sahnesi 4600 ms sürmeli');
    assert.ok(bat.sunkShip && Array.isArray(bat.sunkShip.cells) && bat.sunkShip.cells.length === 2,
      'batan geminin kareleri gelmeli — sinematik gemiyi oraya çizer');

    A.close(); B.close();
    console.log('  ✓ 1-3) sunucu tohumu ve sahne sürelerini iki oyuncuya da aynı gönderiyor');
  }

  // ---------- 4-7) İSTEMCİ: ses tercihi, düğme, katman ----------
  {
    const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
    const dom = await JSDOM.fromURL(BASE + '/index.html', {
      resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); }
    });
    const win = dom.window;
    await bekle(() => (win.GVDeniz ? true : null), 20000, 'sinematik motoru yüklenmeli');

    // 4) varsayılan açık + saklanıyor
    assert.strictEqual(win.GVDeniz.ses.acik(), true, 'ses varsayılan olarak AÇIK olmalı');
    assert.strictEqual(win.GVDeniz.ses.anahtar, 'gv-ses', 'tercih anahtarı gv-ses olmalı');
    win.GVDeniz.ses.ayarla(false);
    assert.strictEqual(win.GVDeniz.ses.acik(), false, 'ses kapatılabilmeli');
    assert.strictEqual(win.localStorage.getItem('gv-ses'), 'off', 'tercih tarayıcıda saklanmalı');

    // 6) kapalıyken hiçbir efekt çalmamalı
    assert.strictEqual(win.GVDeniz.ses.cal('isabet'), false, 'ses kapalıyken efekt çalmamalı');
    win.GVDeniz.ses.ayarla(true);
    assert.strictEqual(win.localStorage.getItem('gv-ses'), 'on', 'yeniden açılabilmeli');

    // 5) oda başlığındaki düğme
    const btn = win.document.getElementById('gvSoundBtn');
    assert.ok(btn, 'oda başlığında ses düğmesi olmalı');
    win.GVDeniz.dugmeYenile();
    assert.ok(/Ses/.test(btn.textContent) && /🔊/.test(btn.textContent),
      'ses açıkken düğme "🔊 Ses" göstermeli — bulunan: ' + btn.textContent.trim());
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(win.GVDeniz.ses.acik(), false, 'düğme sesi kapatmalı');
    assert.ok(/🔇/.test(btn.textContent), 'kapalıyken düğme 🔇 göstermeli');
    assert.strictEqual(btn.getAttribute('aria-pressed'), 'false', 'düğme durumu erişilebilir olmalı');
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.strictEqual(win.GVDeniz.ses.acik(), true, 'düğme sesi geri açmalı');
    assert.ok(/🔊/.test(btn.textContent), 'açıkken düğme 🔊 göstermeli');

    // 7) çizim yapılamayan ortamda oyun bozulmamalı, katman geride kalmamalı
    let bittiMi = false;
    win.GVDeniz.oynat({
      tur: 'hit', tohum: 1234,
      hedef: { left: 100, top: 100, width: 30, height: 30 },
      bitince: function () { bittiMi = true; }
    });
    await sleep(120);
    assert.strictEqual(win.document.querySelectorAll('.gv-deniz-cam').length, 0,
      'sahne oynatılamadıysa ekranda artık katman kalmamalı');
    assert.ok(bittiMi, 'sahne oynatılamasa bile "bitince" geri çağrısı tetiklenmeli');
    assert.strictEqual(win.GVDeniz.oynuyor(), false, 'sahne oynuyor görünmemeli');

    win.close();
    console.log('  ✓ 4-7) ses tercihi, Türkçe aç/kapat düğmesi ve güvenli geri çekilme çalışıyor');
  }

  server.close();
  console.log('OK amiral battı sinematik + ses');
  process.exit(0);
}

main().catch(e => { console.error('❌ SİNEMATİK HATASI:', e); process.exit(1); });
