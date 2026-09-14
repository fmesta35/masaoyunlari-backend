'use strict';

/*
 * BİLARDO VURUŞ ANİMASYONU (madde 5): "bilardo oyununun motorunu ve çalışma
 * mantığını flyordie daki gibi yap". flyordie'de bir vuruş yapıldığında top(lar)
 * ekranda GERÇEKTEN yuvarlanıp çarpışarak durur — sonuç aniden "ışınlanmaz".
 * Eski motorda shoot() tüm fiziği tek seferde hesaplayıp yalnız NİHAİ durumu
 * döndürüyordu; istemci hiçbir ara kare görmüyordu.
 *
 * Bu test:
 *  1) Motor seviyesinde shoot()'un artık atışın TÜM yolunu ("frames") da
 *     döndürdüğünü, ilk karenin vuruş öncesi konumla, son karenin de motorun
 *     döndürdüğü NİHAİ top konumlarıyla tutarlı olduğunu doğrular.
 *  2) Gerçek sunucu + iki gerçek soket istemcisiyle: bir vuruş yapıldığında
 *     HER İKİ oyuncunun da "bilardoShotFrames" ile kare kare akışı aldığını,
 *     ve sunucunun yetkili nihai durumunun (gameStateUpdated) bu akış
 *     BİTMEDEN aniden gelmediğini (gerçekçi bir gecikmeyle geldiğini) kontrol
 *     eder. Fizik hâlâ tamamen sunucuda, tek seferde ve hileye kapalı
 *     hesaplanır — sadece SONUCUN anlatımı akıcılaşır.
 */

const assert = require('assert');
const io = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const bilardoEngine = require('../bilardo-engine');

function conn(url, name) {
  const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((ok, no) => { s.once('connect', () => { s.name = name; ok(s); }); s.once('connect_error', no); });
}
const once = (s, e, ms) => new Promise((ok, no) => {
  const t = setTimeout(() => no(new Error('zaman aşımı: ' + e)), ms || 8000);
  s.once(e, p => { clearTimeout(t); ok(p); });
});

async function main() {
  // ---------- 1) motor seviyesi: frames tutarlılığı ----------
  {
    const st = bilardoEngine.init();
    // NOT: motor içeride SI birimiyle (metre) çalışır; kareler ve istemci
    // görünümü PİKSELDİR. Karşılaştırmalar bu yüzden viewBalls() üzerinden
    // yapılır (fizik motoru baştan yazıldığında bu ayrım netleşti).
    const gorunum0 = bilardoEngine.viewBalls(st);
    const cueX0 = gorunum0[0].x, cueY0 = gorunum0[0].y;
    const r = bilardoEngine.shoot(st, 0, 0.15, 0.85);
    assert.ok(r.ok, 'geçerli vuruş kabul edilmeli');
    const frames = r.shot.frames;
    assert.ok(Array.isArray(frames) && frames.length >= 2, 'birden çok kare üretilmeli (yalnız nihai durum değil)');
    assert.ok(frames.length <= bilardoEngine.constants.maxFrames + 1, 'kare sayısı sınırlı olmalı (ağ yükü taşmasın)');

    const firstCue = frames[0][0];
    assert.ok(Math.abs(firstCue[0] - cueX0) < 0.6 && Math.abs(firstCue[1] - cueY0) < 0.6,
      'ilk kare vuruş ÖNCESİ beyaz topun konumunu yansıtmalı');

    // Beyaz top cepte giderse (fauna/scratch), motor onu vuruş SONRASINDA (kare
    // kaydı bittikten sonra) başa yeniden koyar — bu yüzden o özel durumda son
    // kare (hâlâ cepte) ile nihai durum (yeniden başa konmuş) kasıtlı olarak
    // farklıdır; tıpkı gerçek bilardoda topun tekrar baş noktasına konması gibi.
    const scratch = r.shot.potted.includes('cue');
    const lastFrame = frames[frames.length - 1];
    const gorunumSon = bilardoEngine.viewBalls(st);
    gorunumSon.forEach((b, idx) => {
      if (b.potted) { assert.strictEqual(lastFrame[idx], null, 'cepteki top son karede gösterilmemeli: ' + b.id); return; }
      if (b.id === 'cue' && scratch) return;
      assert.ok(Math.abs(lastFrame[idx][0] - b.x) < 0.6 && Math.abs(lastFrame[idx][1] - b.y) < 0.6,
        'son kare, motorun döndürdüğü NİHAİ top konumuyla eşleşmeli: ' + b.id);
    });
    console.log('  ✓ 1) shoot() artık vuruşun tüm yolunu (frames) tutarlı biçimde döndürüyor');
  }

  // ---------- 2) sunucu: her iki oyuncu da kare kare akışı alıyor, nihai sonuç gecikmeli geliyor ----------
  const srv = require('../server');
  await srv.start(0);
  const url = 'http://127.0.0.1:' + srv.server.address().port;
  const roomId = 'bil-anim-test';
  const a = await conn(url, 'A'), b = await conn(url, 'B');

  const ja = once(a, 'joinedRoom'), jb = once(b, 'joinedRoom');
  a.emit('joinRoom', { roomId, gameId: 'bilardo', maxPlayers: 2, userName: 'A', userKey: 'test:bilA', durationMinutes: 10 });
  b.emit('joinRoom', { roomId, gameId: 'bilardo', maxPlayers: 2, userName: 'B', userKey: 'test:bilB', durationMinutes: 10 });
  await Promise.all([ja, jb]);

  const ga = once(a, 'gameStarted'), gb = once(b, 'gameStarted');
  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  const [pa, pb] = await Promise.all([ga, gb]);

  const mover = pa.seat === pa.gameState.turn ? a : b;

  const framesA = once(a, 'bilardoShotFrames', 5000);
  const framesB = once(b, 'bilardoShotFrames', 5000);
  const t0 = Date.now();
  mover.emit('bilardoShoot', { roomId, angle: 0.12, power: 0.8 });
  const [fa, fb] = await Promise.all([framesA, framesB]);

  assert.strictEqual(fa.roomId, roomId, 'kare akışı doğru odaya damgalanmalı');
  assert.ok(Array.isArray(fa.frames) && fa.frames.length > 5, 'anlamlı sayıda ara kare gelmeli (yalnız 1-2 değil)');
  assert.strictEqual(fa.frames.length, fb.frames.length, 'iki oyuncuya da AYNI kareler gitmeli');
  assert.ok(Array.isArray(fa.meta) && fa.meta.length === 16, 'top kimlik/tip meta bilgisi (id/n/type) gönderilmeli');
  assert.ok(typeof fa.frameMs === 'number' && fa.frameMs > 0, 'kare aralığı (ms) gönderilmeli');

  const upA = once(a, 'gameStateUpdated', 12000);
  const finalState = await upA;
  const totalMs = Date.now() - t0;
  assert.ok(finalState.gameState.shots >= 1, 'nihai (yetkili) durumda vuruş sayacı artmalı');

  const beklenenAsgariGecikme = (fa.frames.length - 1) * fa.frameMs * 0.5;
  assert.ok(totalMs >= beklenenAsgariGecikme,
    'nihai sonuç, top(lar) durmadan ANİDEN gelmemeli (' + totalMs + 'ms geçti, beklenen en az ~' + Math.round(beklenenAsgariGecikme) + 'ms)');
  console.log('  ✓ 2) her iki oyuncu da vuruşu kare kare canlı izliyor; nihai sonuç gerçekçi gecikmeyle geliyor (' +
    totalMs + 'ms, ' + fa.frames.length + ' kare, ~' + fa.frameMs + 'ms/kare)');

  a.disconnect(); b.disconnect();

  // ---------- 3) GERÇEK istemci (jsdom): "bir görünüp bir kaybolma" hatası
  //    bir daha YOK — nihai durum gelince eski (yarım kalmış) animasyon
  //    döngüsü tuvali ASLA geri yazamıyor ----------
  //
  // Kullanıcı raporu: bilardoda toplar "bir görünüp bir kayboluyor, silik,
  // gerçeği yansıtmıyor". Kök neden: eski istemci kodu vuruş animasyonunu
  // sabit adımlı setInterval ile oynatıyordu ve bind() (sunucudan taze/gerçek
  // durum geldiğinde tetiklenen yeniden çizim) bu döngüyü HİÇ iptal etmiyordu.
  // Sekme arka plana alınıp da geri dönüldüğünde veya ana iş parçacığı
  // yoğunken, tarayıcı setInterval çağrılarını geciktirip sonra art arda
  // boşaltıyor; bu da NİHAİ (doğru) kareyi bind() çizdikten SONRA bile eski,
  // güncelliğini yitirmiş kare(ler)in üzerine tekrar yazmasına yol açıyordu.
  //
  // Bu test, istemcinin requestAnimationFrame çağrılarını KASITLI olarak
  // yavaşlatıp (250ms/kare) sunucunun gerçek (çok daha hızlı) gecikmeli nihai
  // durumunun, istemci animasyonu HÂLÂ ortasındayken gelmesini garantiler —
  // tam da hatanın oluştuğu yarış durumunu deterministik biçimde tetikler.
  // Tuval çizimlerini (canvas 2D API) küçük bir sahte bağlamla kaydedip,
  // nihai (yetkili) durum geldikten SONRA tuvale ekstra/eski bir kare daha
  // YAZILMADIĞINI doğrular.
  {
    // Az önceki #2'de zaten çalışan sunucuyu YENİDEN KULLAN — server.js'in
    // http sunucusu tekil (modül kapsamında) olduğundan start()'ı iki kez
    // çağırmak "already listening" hatası verir.
    const BASE = url;

    async function makeClient(label) {
      const vc = new VirtualConsole();
      vc.on('jsdomError', () => {});
      vc.on('error', () => {});
      const dom = await JSDOM.fromURL(BASE + '/index.html', {
        resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
        virtualConsole: vc,
        beforeParse(w) {
          w.GV_BACKEND_URL = BASE;
          w.fetch = (...a) => fetch(...a);
          w.confirm = () => true;

          // ---- tuval 2D bağlamını gözlemlenebilir sahte bir bağlamla değiştir ----
          // (bu ortamda gerçek 'canvas' paketi kurulu değil, getContext('2d') null
          //  döner; bu sahte bağlam olmadan çizim kodu sessizce hiçbir şey yapmaz.)
          w.__drawLog = [];
          let curFrame = null;
          const gradient = { addColorStop() {} };
          const noop = () => {};
          const fakeCtx = new Proxy({}, {
            get(_t, prop) {
              if (prop === 'clearRect') return () => { curFrame = { t: Date.now(), pts: [] }; w.__drawLog.push(curFrame); };
              if (prop === 'translate') return (x, y) => { if (curFrame) curFrame.pts.push([x, y]); };
              if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return () => gradient;
              return noop;
            }
          });
          w.HTMLCanvasElement.prototype.getContext = function (type) { return type === '2d' ? fakeCtx : null; };

          // ---- istemcinin gördüğü SAATİ kasıtlı yavaşlat (gerçek hızın 1/25'i) ----
          // playShotFrames() ilerlemesini DUVAR SAATİNE göre hesaplar (nowMs()).
          // Bu saati yavaşlatmak, istemcinin "az zaman geçti" sanmasına yol
          // açar — sunucunun GERÇEK (yavaşlatılmamış) nihai durumu normal
          // hızında gelirken istemci animasyonu kendi (yavaş) saatine göre
          // HÂLÂ yolun başındadır. Böylece gerçek tarayıcıda sekme arka plana
          // alındığında/CPU yoğunken oluşan yarış durumu güvenilir ve
          // deterministik biçimde tetiklenir — requestAnimationFrame'in
          // KENDİSİ normal hızında (gerçek ~16ms) çalışmaya devam eder, yani
          // DÜZELTME olmasaydı tick() her ~16ms'de bir tuvale gereksiz/eski
          // bir kare daha yazardı.
          if (w.performance && typeof w.performance.now === 'function') {
            const realPerfNow = w.performance.now.bind(w.performance);
            const t0 = realPerfNow();
            const SLOW = 25;
            w.performance.now = () => t0 + (realPerfNow() - t0) / SLOW;
          }
        }
      });
      const win = dom.window;
      win.__gvErrors = [];
      win.addEventListener('error', e => win.__gvErrors.push(String(e.message || e)));
      return { dom, win, label };
    }
    const sleep2 = ms => new Promise(r => setTimeout(r, ms));
    async function waitFor2(fn, timeoutMs, what) {
      const t0 = Date.now();
      while (Date.now() - t0 < (timeoutMs || 20000)) {
        try { const v = fn(); if (v) return v; } catch (_) {}
        await sleep2(100);
      }
      throw new Error('zaman aşımı: ' + what);
    }
    function click2(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

    const roomId2 = 'bil-anim-race-test';
    const A = await makeClient('A'), B = await makeClient('B');
    for (const c of [A, B]) {
      await waitFor2(() => c.win.GV && c.win.st && c.win.GVArena, 25000, c.label + ' hazır');
      await waitFor2(() => typeof c.win.__gvStartRealRoomWaiting === 'function', 25000, c.label + ' roomfix');
      c.win.st.curGame = 'bilardo';
      c.win.GV.joinRoom(roomId2);
    }
    for (const c of [A, B]) {
      await waitFor2(() => c.win.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, c.label + ' HAZIRIM');
      c.win.document.querySelector('#gv-real-chess-wait .gv-ready').click();
    }
    for (const c of [A, B]) {
      await waitFor2(() => c.win.document.querySelector('#boardArea .bil-canvas'), 25000, c.label + ' bilardo tahtası');
    }

    const mover = await waitFor2(() => {
      const s = A.win.GVArena.state();
      return s && s.turn === A.win.GVArena.seat() ? A : (s && s.turn === B.win.GVArena.seat() ? B : null);
    }, 15000, 'sırası gelen oyuncu');
    const watcher = mover === A ? B : A; // rakip pencere: kendi animasyonunu izleyeceğiz

    const shootBtn = watcher.win.document.getElementById('bilOnlineShoot');
    // rakip için buton devre dışı (sırası değil) — animasyon her iki pencerede de
    // aynı sunucu yayınından oynatıldığından watcher'ı gözlemlemek yeterli ve
    // "kendi vuruşum" akışından bağımsız, saf senkronizasyon davranışını test eder
    assert.ok(watcher.win.document.querySelector('#boardArea .bil-canvas'), 'izleyici tahtayı görmeli');

    const moveBtn = mover.win.document.getElementById('bilOnlineShoot');
    click2(mover.win, moveBtn); // varsayılan güçle (%55) vuruş yapar

    // watcher'ın animasyonu (kasıtlı 250ms/kare) başlasın
    await waitFor2(() => watcher.win.__drawLog.length >= 1, 8000, 'watcher animasyonu başlamalı');

    // sunucunun GERÇEK (hızlı) nihai durumu gelene kadar bekle — bu, watcher'ın
    // YAVAŞLATILMIŞ animasyonu daha bitmeden gerçekleşmeli (yarış tetiklenir)
    const finalShots = await waitFor2(() => {
      const s = watcher.win.GVArena.state();
      return s && s.shots >= 1 ? s.shots : null;
    }, 15000, 'watcher nihai (yetkili) durumu almalı');
    assert.ok(finalShots >= 1, 'watcher yetkili durumu almış olmalı');
    const logLenAtFinal = watcher.win.__drawLog.length;

    // ekstra bekleme: DÜZELTME olmasaydı, yavaşlatılmış eski döngü bu pencerede
    // birkaç kare daha (250ms aralıklarla) çizmeye devam ederdi
    await sleep2(1500);
    const logLenAfterWait = watcher.win.__drawLog.length;

    assert.ok(logLenAfterWait <= logLenAtFinal + 2,
      'nihai durum geldikten SONRA tuvale eski/gecikmiş animasyon karesi YAZILMAMALI ' +
      '(nihaide ' + logLenAtFinal + ' kare vardı, 1.5sn sonra ' + logLenAfterWait + ' kare — ' +
      'artış varsa "bir görünüp bir kaybolma" hatası geri gelmiş demektir)');
    console.log('  ✓ 3) nihai durum geldiğinde eski animasyon döngüsü hemen durur — "bir görünüp bir kaybolma" hatası yok (' +
      logLenAtFinal + ' → ' + logLenAfterWait + ' kare, 1.5sn bekleme)');

    for (const c of [A, B]) { try { c.win.close(); } catch (_) {} }
    await sleep2(120);
  }

  srv.server.close();
  console.log('OK bilardo vuruş animasyonu: flyordie tarzı kare kare canlı akış + gecikmeli yetkili sonuç + senkronizasyon güvenliği');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ BİLARDO ANİMASYON TEST HATASI:', e);
  try { require('../server').server.close(); } catch (_) {}
  process.exit(1);
});
