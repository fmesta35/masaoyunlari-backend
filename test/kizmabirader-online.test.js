'use strict';
/* ============================================================================
 * KIZMA BİRADER (Ludo) — MOTOR VE ONLINE AKIŞ
 * ============================================================================
 * Prototip tek cihazda, zarı tarayıcıda atıyordu. Burada ZAR VE KURALLAR
 * SUNUCUYA taşındı: istemci yalnız "zar at" ve "şu piyonu oyna" diyor.
 *
 * NE DOĞRULANIR
 *   MOTOR
 *     1) Tahta yapısı: 52 kareli tur, 4×5 ev yolu, başlangıçlar ve güvenli
 *        kareler tutarlı.
 *     2) Renk dağılımı masa büyüklüğüne göre (2 kişi karşılıklı oturur).
 *     3) Üsten çıkmak için 6 gerekir; 6 atan tekrar atar.
 *     4) Üst üste ÜÇ 6 sırayı yakar.
 *     5) Yeme: tek duran rakip üsse döner; GÜVENLİ karede yenmez; yiyen
 *        tekrar atar.
 *     6) Blok: aynı renkten iki piyon kareyi kapatır — rakip geçemez.
 *     7) Merkeze TAM sayıyla girilir; fazla atan oynayamaz.
 *     8) Dördünü sokan sırayı tamamlar, maç biter.
 *     9) Süre aşımı: zarı/hamleyi sunucu oynar, kimse atılmaz.
 *    10) Görünüm: geçerli hamleler YALNIZ sırası olana gider.
 *   ONLINE
 *    11) Hazır masalar lobide (2/3/4 kişilik), kimlik çakışması yok.
 *    12) Oyun başlıyor; sırası olmayan zar atamıyor.
 *    13) Zar ve hamle iki istemciye de yansıyor.
 *   ARAYÜZ
 *    14) İstemci adaptörü, stiller, kurallar, panel ve kapak bağlı.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-kizma-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const E = require('../kizmabirader-engine.js');
const serverModule = require('../server.js');

const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');
const uyu = ms => new Promise(r => setTimeout(r, ms));

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
async function httpRooms(base, gameId) {
  const r = await fetch(base + '/api/rooms?gameId=' + gameId);
  const j = await r.json();
  return j.rooms || j;
}
/* Zarı istediğimiz sayıya sabitleyen motor kurulumu: kuralları ölçerken
   şansın karışmaması gerekiyor. */
function sabitZar(st, dizi) {
  let i = 0;
  st.rng = () => ((dizi[Math.min(i++, dizi.length - 1)] - 1) + 0.5) / 6;
}

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  // 1) TAHTA YAPISI
  assert.strictEqual(E.TUR_YOLU.length, 52, 'tur 52 kare olmalı');
  assert.strictEqual(new Set(E.TUR_YOLU.map(c => c.join(','))).size, 52,
    'tur kareleri benzersiz olmalı');
  assert.strictEqual(E.EV_YOLU.length, 4, 'dört ev yolu olmalı');
  E.EV_YOLU.forEach((y, i) => assert.strictEqual(y.length, 5, i + '. ev yolu 5 kare olmalı'));
  assert.deepStrictEqual(E.BASLANGIC, [0, 13, 26, 39], 'başlangıçlar 13 kare arayla olmalı');
  E.BASLANGIC.forEach(b => assert.ok(E.GUVENLI.has(b), 'başlangıç karesi güvenli olmalı'));
  [...E.YILDIZ].forEach(y => assert.ok(E.GUVENLI.has(y), 'yıldızlı kare güvenli olmalı'));
  assert.strictEqual(E.BITIS, 57, 'merkez ilerlemesi 57 olmalı (52 tur + 5 ev)');
  console.log('  ✓ 1) tahta yapısı tutarlı: 52 kare tur, 4×5 ev yolu, güvenli kareler');

  // 2) RENK DAĞILIMI
  {
    const iki = E.macBaslat({ seats: [0, 1] });
    assert.deepStrictEqual([iki.renkOf[0], iki.renkOf[1]], [0, 2],
      '2 kişilik masada renkler KARŞILIKLI olmalı');
    const dort = E.macBaslat({ seats: [0, 1, 2, 3] });
    assert.deepStrictEqual([0, 1, 2, 3].map(s => dort.renkOf[s]), [0, 1, 2, 3],
      '4 kişilik masada dört renk de oynamalı');
    Object.keys(dort.piyon).forEach(r => {
      assert.deepStrictEqual(dort.piyon[r], [-1, -1, -1, -1], 'piyonlar üste başlamalı');
    });
  }
  console.log('  ✓ 2) renk dağılımı masa büyüklüğüne göre');

  // 3) ÜSTEN ÇIKIŞ ve 6 TEKRARI
  {
    const st = E.macBaslat({ seats: [0, 1] });
    sabitZar(st, [3]);
    let r = E.zarAt(st, 0);
    assert.strictEqual(r.zar, 3, 'zar sabitlenmeli');
    assert.ok(r.hamleYok, '6 dışında üsten çıkılamaz');
    assert.strictEqual(E.siradakiKoltuk(st), 1, 'hamle yoksa sıra geçmeli');

    const b = E.macBaslat({ seats: [0, 1] });
    sabitZar(b, [6]);
    r = E.zarAt(b, 0);
    assert.strictEqual(r.hamleler.length, 4, '6 atınca dört piyon da çıkabilmeli');
    assert.ok(r.hamleler.every(m => m.cikis), 'hepsi üsten çıkış olmalı');
    assert.strictEqual(E.zarAt(b, 1).reason, 'not_your_turn', 'sırası olmayan atamaz');
    const m = E.piyonOyna(b, 0, 0);
    assert.ok(m.tekrar, '6 atan TEKRAR atmalı');
    assert.strictEqual(E.siradakiKoltuk(b), 0, 'sıra aynı oyuncuda kalmalı');
    assert.strictEqual(b.piyon[0][0], 0, 'piyon başlangıç karesine çıkmalı');
    assert.strictEqual(b.faz, 'zar', 'tekrar hakkında zar fazına dönülmeli');
  }
  console.log('  ✓ 3) üsten çıkmak için 6 gerek, 6 atan tekrar atıyor');

  // 4) ÜÇ ALTI SIRAYI YAKAR
  {
    const st = E.macBaslat({ seats: [0, 1] });
    sabitZar(st, [6, 6, 6]);
    E.zarAt(st, 0); E.piyonOyna(st, 0, 0);
    E.zarAt(st, 0); E.piyonOyna(st, 0, 1);
    const r = E.zarAt(st, 0);
    assert.ok(r.ucAlti, 'üçüncü 6 sırayı yakmalı');
    assert.strictEqual(E.siradakiKoltuk(st), 1, 'sıra rakibe geçmeli');
    assert.strictEqual(st.altiSayisi, 0, 'altı sayacı sıfırlanmalı');
  }
  console.log('  ✓ 4) üst üste üç 6 sırayı yakıyor');

  // 5) YEME ve GÜVENLİ KARE
  {
    const st = E.macBaslat({ seats: [0, 1] });
    /* Kırmızı (renk 0, başlangıç 0) ilerleme 10'da; Yeşil (renk 2,
       başlangıç 26) onu yiyebilmeli. Yeşilin küresel karesi 26+p; kırmızının
       10. karesi küresel 10 → yeşil için p = (10-26+52)%52 = 36. */
    st.piyon[0] = [10, -1, -1, -1];
    st.piyon[2] = [33, -1, -1, -1];
    sabitZar(st, [3]);
    st.sira = 1;                                  // sıra yeşilde
    const r = E.zarAt(st, 1);
    const yiyen = r.hamleler.find(m => m.yenen && m.yenen.length);
    assert.ok(yiyen, 'yeme hamlesi görünmeli');
    const mv = E.piyonOyna(st, 1, yiyen.idx);
    assert.strictEqual(st.piyon[0][0], -1, 'yenen piyon üsse dönmeli');
    assert.ok(mv.tekrar, 'yiyen TEKRAR atmalı');

    /* GÜVENLİ karede yenmez: kırmızıyı 8. kareye (yıldız) koy. */
    const g = E.macBaslat({ seats: [0, 1] });
    g.piyon[0] = [8, -1, -1, -1];
    g.piyon[2] = [(8 - 26 + 52) % 52 - 3, -1, -1, -1];
    sabitZar(g, [3]);
    g.sira = 1;
    const r2 = E.zarAt(g, 1);
    assert.ok(r2.hamleler.every(m => !m.yenen || !m.yenen.length),
      'GÜVENLİ karedeki piyon yenmemeli');
  }
  console.log('  ✓ 5) tek duran rakip yeniyor, güvenli karede yenmiyor, yiyen tekrar atıyor');

  // 6) BLOK
  {
    const st = E.macBaslat({ seats: [0, 1] });
    /* Kırmızının iki piyonu küresel 10'da → blok. Yeşil oradan geçemez. */
    st.piyon[0] = [10, 10, -1, -1];
    const once = (10 - 26 + 52) % 52;             // yeşil için o karenin ilerlemesi
    st.piyon[2] = [once - 2, -1, -1, -1];
    sabitZar(st, [4]);                            // bloğun ÜSTÜNDEN geçmek isterdi
    st.sira = 1;
    const r = E.zarAt(st, 1);
    assert.ok(r.hamleYok || r.hamleler.every(m => m.idx !== 0),
      'rakip bloğunun ÜSTÜNDEN geçilememeli');
    /* Bloğun tam üstüne konmak da yasak. */
    const b = E.macBaslat({ seats: [0, 1] });
    b.piyon[0] = [10, 10, -1, -1];
    b.piyon[2] = [once - 2, -1, -1, -1];
    sabitZar(b, [2]);
    b.sira = 1;
    const r2 = E.zarAt(b, 1);
    assert.ok(r2.hamleYok || r2.hamleler.every(m => m.idx !== 0),
      'rakip bloğunun ÜZERİNE konulamamalı');
  }
  console.log('  ✓ 6) aynı renkten iki piyon kareyi kapatıyor');

  // 7) MERKEZE TAM SAYI
  {
    const st = E.macBaslat({ seats: [0, 1] });
    st.piyon[0] = [55, -1, -1, -1];               // merkeze 2 kala
    sabitZar(st, [4]);
    let r = E.zarAt(st, 0);
    assert.ok(r.hamleYok || r.hamleler.every(m => m.idx !== 0),
      'fazla sayıyla merkeze girilememeli');

    const b = E.macBaslat({ seats: [0, 1] });
    b.piyon[0] = [55, -1, -1, -1];
    sabitZar(b, [2]);
    r = E.zarAt(b, 0);
    const giris = r.hamleler.find(m => m.nereye === E.BITIS);
    assert.ok(giris, 'tam sayıyla merkeze girilebilmeli');
    const mv = E.piyonOyna(b, 0, giris.idx);
    assert.ok(mv.tekrar, 'merkeze sokan TEKRAR atmalı');
    assert.strictEqual(b.piyon[0][0], E.BITIS, 'piyon merkeze yerleşmeli');
  }
  console.log('  ✓ 7) merkeze tam sayıyla giriliyor, giren tekrar atıyor');

  // 8) MAÇ BİTİŞİ
  {
    const st = E.macBaslat({ seats: [0, 1] });
    st.piyon[0] = [E.BITIS, E.BITIS, E.BITIS, 55];
    sabitZar(st, [2]);
    const r = E.zarAt(st, 0);
    const giris = r.hamleler.find(m => m.nereye === E.BITIS);
    const mv = E.piyonOyna(st, 0, giris.idx);
    assert.ok(mv.bitti, 'dördünü sokan maçı bitirmeli');
    assert.strictEqual(st.status, 'finished', 'maç bitmeli');
    assert.strictEqual(st.winner, 0, 'kazanan doğru olmalı');
    assert.strictEqual(st.result.siralama[0].seat, 0, 'birinci sırada kazanan olmalı');
    assert.strictEqual(st.result.siralama.length, 2, 'kalan oyuncu sona yazılmalı');
    assert.strictEqual(E.zarAt(st, 1).reason, 'game_over', 'bitmiş maçta zar atılamaz');
  }
  console.log('  ✓ 8) dört piyonu sokan maçı bitiriyor');

  // 9) SÜRE AŞIMI
  {
    const st = E.macBaslat({ seats: [0, 1] });
    sabitZar(st, [6]);
    const r = E.sureDoldu(st, 0);
    assert.strictEqual(r.tur, 'zar', 'zar fazında süre aşımı zarı attırmalı');
    assert.strictEqual(st.status, 'playing', 'süre aşımı kimseyi masadan atmamalı');
    assert.strictEqual(st.faz, 'secim', 'hamle seçimine geçilmeli');
    const r2 = E.sureDoldu(st, 0);
    assert.strictEqual(r2.tur, 'hamle', 'seçim fazında süre aşımı hamle oynamalı');
    assert.ok(st.piyon[0].some(p => p >= 0), 'bir piyon üsten çıkmış olmalı');
  }
  console.log('  ✓ 9) süre aşımında sunucu oynuyor, kimse atılmıyor');

  // 10) GÖRÜNÜM GİZLİLİĞİ
  {
    const st = E.macBaslat({ seats: [0, 1] });
    sabitZar(st, [6]);
    E.zarAt(st, 0);
    const g0 = E.gorunum(st, 0), g1 = E.gorunum(st, 1), gz = E.gorunum(st, null);
    assert.strictEqual(g0.hamleler.length, 4, 'sırası olan hamlelerini görmeli');
    assert.strictEqual(g1.hamleler.length, 0, 'RAKİP hamleleri GÖRMEMELİ');
    assert.strictEqual(gz.hamleler.length, 0, 'izleyici de görmemeli');
    assert.strictEqual(g1.hamleSayisi, 4, 'kaç hamle olduğu herkese açık olabilir');
    assert.strictEqual(g1.zar, 6, 'atılmış zar herkese açık');
    assert.ok(!JSON.stringify(g0).includes('"rng"'), 'rastgele üreteç sızmamalı');
    assert.ok(Array.isArray(g0.turYolu) && g0.turYolu.length === 52,
      'tahta çizimi için kareler gönderilmeli');
  }
  console.log('  ✓ 10) geçerli hamleler yalnız sırası olana gidiyor');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 11) HAZIR MASALAR
  const masalar = await httpRooms(BASE, 'kizmabirader');
  assert.strictEqual(masalar.length, 12, 'kızma birader 12 hazır masa açmalı');
  const kisiler = new Set(masalar.map(m => m.maxPlayers));
  assert.deepStrictEqual([...kisiler].sort(), [2, 3, 4], '2/3/4 kişilik masalar olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2601' && String(m.id) <= '2612'),
    'masa kimlikleri 2601-2612 aralığında olmalı');
  assert.ok(masalar.every(m => Number(m.moveSeconds) >= 15), 'hamle süresi masadan gelmeli');
  {
    const hepsi = new Map();
    for (const g of (serverModule.ALL_GAMES || ['kizmabirader'])) {
      for (const m of await httpRooms(BASE, g)) {
        const id = String(m.id);
        assert.ok(!hepsi.has(id),
          'masa kimliği çakışıyor: #' + id + ' hem ' + hepsi.get(id) + ' hem ' + g);
        hepsi.set(id, g);
      }
    }
  }
  console.log('  ✓ 11) hazır masalar lobide (2/3/4 kişilik), kimlik çakışması yok');

  const oda = masalar[0];          // 2 kişilik
  const A = await connect(BASE, 'kb-A');
  const B = await connect(BASE, 'kb-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'kizmabirader', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA, pB] = await Promise.all(basladi);

  // 12) SIRA KURALI
  assert.strictEqual(pA.gameState.kind, 'kizmabirader', 'masa paketi kızma birader olmalı');
  assert.strictEqual(pA.gameState.turYolu.length, 52, 'tahta istemciye gitmeli');
  assert.notStrictEqual(pA.gameState.renk, pB.gameState.renk, 'iki oyuncu farklı renk almalı');
  const odaNes = rooms.get(String(oda.id));
  const k = odaNes.kizma;
  const sira = k.seats[k.sira];
  const sSok = pA.seat === sira ? A : B;
  const dSok = pA.seat === sira ? B : A;
  const red = once(dSok, 'kizmaRejected', 8000);
  dSok.emit('kizmaRoll', { roomId: String(oda.id) });
  assert.strictEqual((await red).reason, 'not_your_turn', 'sırası olmayan zar atamamalı');
  console.log('  ✓ 12) oyun başladı, sırası olmayan zar atamıyor');

  // 13) ZAR ve HAMLE YAYINI
  {
    /* Zarı 6'ya sabitle ki kesin bir hamle çıksın. */
    k.rng = () => 0.9;
    const zarA = once(A, 'kizmaDice', 8000);
    const zarB = once(B, 'kizmaDice', 8000);
    sSok.emit('kizmaRoll', { roomId: String(oda.id) });
    const [dA, dB] = await Promise.all([zarA, zarB]);
    assert.strictEqual(dA.zar, 6, 'zar iki istemciye de bildirilmeli');
    assert.strictEqual(dA.zar, dB.zar, 'iki istemci aynı zarı görmeli');
    assert.strictEqual(dA.seat, sira, 'zarı atan koltuk bildirilmeli');

    const hamleA = once(A, 'kizmaMoved', 8000);
    sSok.emit('kizmaMove', { roomId: String(oda.id), idx: 0 });
    const hA = await hamleA;
    assert.strictEqual(hA.hamle.nereden, -1, 'piyon üsten çıkmalı');
    assert.strictEqual(k.piyon[k.renkOf[sira]][0], 0, 'piyon başlangıç karesinde olmalı');
    /* Geçersiz hamle reddedilmeli. */
    const red2 = once(sSok, 'kizmaRejected', 8000);
    sSok.emit('kizmaMove', { roomId: String(oda.id), idx: 9 });
    assert.strictEqual((await red2).reason, 'wrong_phase', 'zar fazında hamle oynanamaz');
  }
  console.log('  ✓ 13) zar ve hamle iki istemciye de yansıyor');

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/kizmabirader:\{name:'Kızma Birader'/.test(sayfa), 'oyun listesinde olmalı');
  assert.ok(/js\/kizmabirader-online\.js/.test(sayfa), 'istemci adaptörü bağlı olmalı');
  assert.ok(/\.kb-tahta\{/.test(sayfa), 'kızma birader stilleri olmalı');
  assert.ok(/kizmabirader:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'kizmabirader'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/kizmabirader:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');

  const istemci = oku('js/kizmabirader-online.js');
  assert.ok(/kinds: \['kizmabirader'\]/.test(istemci), 'adaptör türü karşılamalı');
  assert.ok(/--kb-h/.test(istemci), 'hücre boyu ölçülen alana göre verilmeli');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');
  assert.ok(/classList\.toggle\('dar'/.test(istemci), 'dar ekranda düzen değişmeli');
  /* Tahta SUNUCUDAN gelmeli: istemcide ikinci bir kopya tutulmamalı. */
  assert.ok(/s\.turYolu/.test(istemci), 'istemci tahtayı sunucu paketinden okumalı');
  assert.ok(!/\[6,1\],\[6,2\]/.test(istemci), 'istemci tahtanın kopyasını TUTMAMALI');
  /* Zar istemcide atılmamalı. */
  assert.ok(!/Math\.random\(\)\s*\*\s*6/.test(istemci), 'zar istemcide atılmamalı');

  const sunucu = oku('server.js');
  assert.ok(/kizmabirader: \[2601/.test(sunucu), 'masa kimlik aralığı tanımlı olmalı');
  assert.ok(/socket\.on\('kizmaRoll'/.test(sunucu), 'zar olayı sunucuda olmalı');
  assert.ok(/socket\.on\('kizmaMove'/.test(sunucu), 'hamle olayı sunucuda olmalı');
  /* ⚠ Liste ÜYELİĞİ ölçülüyor, SIRA değil: eski regex oyunun listenin
     SONUNDA olmasını şart koşuyordu ve sonraki oyun eklenince kırıldı. */
  const yonetilen = (sunucu.match(/MANAGED_CARD_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(yonetilen.includes("'kizmabirader'"),
    'kurucu panelinden kişi sayısı yönetilebilmeli');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'kizmabirader'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/kizmabirader: \{ kisi: \[2, 3, 4\]/.test(panel),
    'kurucu paneli 2-4 kişi seçebilmeli');
  assert.ok(/kizmabirader: 2601/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'kizmabirader.jpg')), 'kapak olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-kizmabirader.py')), 'kapak betiği olmalı');
  console.log('  ✓ 14) istemci, stiller, kurallar, kurucu paneli ve kapak bağlı');
}

(async () => {
  try {
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK kızma birader: tahta, zar sunucuda, yeme/blok/merkez kuralları, online akış');
    process.exit(0);
  } catch (e) {
    console.error('KIZMA BİRADER HATASI:', e);
    process.exit(1);
  }
})();
