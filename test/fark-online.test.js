'use strict';
/* ============================================================================
 * FARK BULMACA — SAHNELER, MOTOR VE ONLINE AKIŞ
 * ============================================================================
 * Prototip Next.js + Postgres üzerineydi; oyunun kendisi değil, BARINDIRMASI
 * uyumsuzdu. Kurallar (4 sahne × 13 fark, elde 7 fark, 90 sn, 3 elin 2'si) ve
 * SVG çizimler taşındı; sahneler sunucu ile istemcinin ORTAK kullandığı tek
 * bir dosyada (fark-sahneler.js).
 *
 * NE DOĞRULANIR
 *   SAHNELER
 *     1) Dört sahne var, her birinde 13 fark; tıklama alanları makul.
 *     2) Sahneler SVG üretiyor; A ve B kopyaları birbirinden FARKLI.
 *     3) Aynı tohum aynı resmi veriyor (iki oyuncu aynı şeyi görmeli).
 *     4) Seçilen HER fark, A ile B arasında gerçekten bir değişiklik
 *        yaratıyor — "fark" diye işaretlenip aslında aynı kalan nesne yok.
 *   MOTOR
 *     5) El geri sayımla başlıyor, süre dolunca kapanıyor.
 *     6) Doğru tıklama sayılıyor; boş tıklama KİLİTLİYOR; bulunmuş farka
 *        yeniden dokunmak ceza değil.
 *     7) 7 farkı bulan eli alıyor; süre dolarsa çok bulan kazanıyor.
 *     8) Maç 3 elin 2'sini alanın.
 *     9) Görünümde rakibin BULDUKLARI gizli, yalnız sayısı görünüyor.
 *   ONLINE
 *    10) Hazır masalar lobide, kimlik çakışması yok.
 *    11) Oyun başlıyor; iki oyuncu AYNI sahneyi ve AYNI farkları alıyor.
 *    12) Tıklama sunucuda doğrulanıyor; uydurma koordinat kabul edilmiyor.
 *    13) El ve maç bitişi iki istemciye de gidiyor.
 *   ARAYÜZ
 *    14) İstemci adaptörü, sahne dosyası, stiller, kurallar, panel, kapak.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-fark-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const ioClient = require('socket.io-client');
const S = require('../fark-sahneler.js');
const E = require('../fark-engine.js');
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
function kaydet(s, ev) {
  const kutu = { gelen: [], bekleyen: [] };
  s.on(ev, p => { kutu.gelen.push(p); const b = kutu.bekleyen.shift(); if (b) b(p); });
  kutu.bekle = ms => new Promise((res, rej) => {
    if (kutu.gelen.length) return res(kutu.gelen.shift());
    const t = setTimeout(() => rej(new Error('zaman aşımı: ' + ev)), ms || 12000);
    kutu.bekleyen.push(p => { clearTimeout(t); res(p); });
  });
  return kutu;
}
async function httpRooms(base, gameId) {
  const r = await fetch(base + '/api/rooms?gameId=' + gameId);
  const j = await r.json();
  return j.rooms || j;
}
function tohumlu(seed) {
  let x = seed >>> 0;
  return () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}
const konum = (sahne, id) => (S.FARK_KONUMLARI[sahne] || []).find(d => d.id === id);

/* ---------------------------------------------------------------- SAHNELER */
function sahneTesti() {
  // 1) YAPI
  assert.strictEqual(S.sahneSayisi(), 4, 'dört sahne olmalı');
  assert.strictEqual(S.SAHNE_BILGI.length, 4, 'dört sahne bilgisi olmalı');
  for (let i = 0; i < 4; i++) {
    const liste = S.FARK_KONUMLARI[i];
    assert.strictEqual(liste.length, 13, i + '. sahnede 13 fark olmalı');
    const idler = liste.map(d => d.id);
    assert.strictEqual(new Set(idler).size, 13, 'fark kimlikleri benzersiz olmalı');
    liste.forEach(d => {
      assert.ok(d.cx >= 0 && d.cx <= S.GORUNUM_EN, d.ad + ': cx görünüm kutusunda olmalı');
      assert.ok(d.cy >= 0 && d.cy <= S.GORUNUM_BOY, d.ad + ': cy görünüm kutusunda olmalı');
      assert.ok(d.r >= 20 && d.r <= 70, d.ad + ': tıklama alanı makul olmalı (r=' + d.r + ')');
      assert.ok(d.ad && d.ad.length > 2, 'her farkın Türkçe adı olmalı');
    });
    assert.ok(S.SAHNE_BILGI[i].ad && S.SAHNE_BILGI[i].alt, i + '. sahnenin adı ve alt başlığı');
  }
  console.log('  ✓ 1) dört sahne, her birinde 13 fark, tıklama alanları makul');

  // 2) ÇİZİM ve A/B AYRIMI
  for (let i = 0; i < 4; i++) {
    const secim = S.farkSec(13, 7, 1234 + i);
    const a = S.sahneCiz(i, { seed: 1234 + i, uid: 'a', variant: 'a', diffs: secim });
    const b = S.sahneCiz(i, { seed: 1234 + i, uid: 'b', variant: 'b', diffs: secim });
    assert.ok(a.length > 2000, i + '. sahne A çizimi dolu olmalı');
    assert.ok(b.length > 2000, i + '. sahne B çizimi dolu olmalı');
    assert.ok(/^<g>/.test(a) && /<\/g>$/.test(a), 'çıktı geçerli bir SVG grubu olmalı');
    assert.ok(!/undefined|NaN|\[object/.test(a), i + '. sahne A çiziminde bozuk değer olmamalı');
    assert.ok(!/undefined|NaN|\[object/.test(b), i + '. sahne B çiziminde bozuk değer olmamalı');
    /* uid dışındaki her şeyi karşılaştır: iki kopya AYNI olmamalı. */
    assert.notStrictEqual(a.replace(/"a/g, '"X'), b.replace(/"b/g, '"X'),
      i + '. sahnede A ve B kopyaları aynı — fark uygulanmamış');
  }
  console.log('  ✓ 2) dört sahne de çiziliyor, A ve B kopyaları birbirinden farklı');

  // 3) AYNI TOHUM AYNI RESİM
  {
    const secim = S.farkSec(13, 7, 777);
    const bir = S.sahneCiz(0, { seed: 777, uid: 'u', variant: 'a', diffs: secim });
    const iki = S.sahneCiz(0, { seed: 777, uid: 'u', variant: 'a', diffs: secim });
    assert.strictEqual(bir, iki, 'aynı tohum birebir aynı resmi vermeli');
    const baska = S.sahneCiz(0, { seed: 778, uid: 'u', variant: 'a', diffs: secim });
    assert.notStrictEqual(bir, baska, 'farklı tohum farklı süsleme vermeli');
    assert.deepStrictEqual(S.farkSec(13, 7, 999), S.farkSec(13, 7, 999),
      'fark seçimi de tohuma bağlı olmalı');
  }
  console.log('  ✓ 3) aynı tohum aynı resmi veriyor (iki oyuncu aynı şeyi görüyor)');

  // 4) HER FARK GERÇEKTEN BİR DEĞİŞİKLİK YARATIYOR
  /* Tek tek dene: yalnız o farkı uygula, A ile karşılaştır. Bir nesne
     "fark" diye işaretlenip çizimde hiç değişmiyorsa oyuncu onu asla
     bulamaz — oyunu bozan sessiz bir hata olurdu. */
  for (let i = 0; i < 4; i++) {
    const a = S.sahneCiz(i, { seed: 500, uid: 'u', variant: 'a', diffs: [] });
    for (let id = 1; id <= 13; id++) {
      const b = S.sahneCiz(i, { seed: 500, uid: 'u', variant: 'b', diffs: [id] });
      assert.notStrictEqual(a, b,
        i + '. sahnede ' + id + ' numaralı fark (' + konum(i, id).ad +
        ') çizimde HİÇBİR değişiklik yapmıyor');
    }
  }
  console.log('  ✓ 4) 4 sahne × 13 farkın tamamı çizimde gerçek bir değişiklik yapıyor');

  // Tıklama alanı eşlemesi
  {
    const d = konum(0, 1);
    assert.strictEqual(S.farkBul(0, d.cx, d.cy, [1]), 1, 'merkeze tıklama farkı bulmalı');
    assert.strictEqual(S.farkBul(0, d.cx + d.r + 5, d.cy, [1]), null, 'alan dışı bulmamalı');
    assert.strictEqual(S.farkBul(0, d.cx, d.cy, [2]), null, 'seçilmemiş fark sayılmamalı');
  }
}

/* ------------------------------------------------------------------ MOTOR */
function motorTesti() {
  const rng = tohumlu(31337);
  let st = E.macBaslat({ seats: [0, 1], elSuresiSn: 30, rng });

  // 5) GERİ SAYIM ve EL
  assert.strictEqual(st.faz, 'gerisayim', 'el geri sayımla başlamalı');
  assert.strictEqual(st.el, 1, 'ilk el');
  assert.strictEqual(st.farkIdleri.length, 7, 'elde 7 fark seçilmeli');
  let t = Date.now();
  assert.strictEqual(E.tik(st, t).degisti, false, 'geri sayım dolmadan faz değişmemeli');
  t += E.GERI_SAYIM_MS + 10;
  assert.strictEqual(E.tik(st, t).olay, 'elBasladi', 'geri sayım bitince el başlamalı');
  assert.strictEqual(st.faz, 'oyun', 'oyun fazına geçilmeli');
  console.log('  ✓ 5) el geri sayımla başlıyor');

  // 6) TIKLAMA KURALLARI
  {
    const d = konum(st.sahneId, st.farkIdleri[0]);
    const r1 = E.tikla(st, 0, d.cx, d.cy, t);
    assert.ok(r1.ok && r1.dogru, 'doğru nokta fark saymalı');
    const r2 = E.tikla(st, 0, d.cx, d.cy, t + 5);
    assert.ok(r2.ok && !r2.dogru && r2.zaten, 'bulunmuş farka dokunmak ceza OLMAMALI');
    assert.strictEqual(E.tikla(st, 0, 2, 2, t + 10).kilitMs, E.YANLIS_KILIT_MS,
      'boş yere tıklamak kilitlemeli');
    assert.strictEqual(E.tikla(st, 0, d.cx, d.cy, t + 20).reason, 'tikla_kilitli',
      'kilitliyken tıklama reddedilmeli');
    /* Görünüm dışı koordinat ve sırası olmayan koltuk. */
    assert.strictEqual(E.tikla(st, 0, -5, 10, t + E.YANLIS_KILIT_MS + 50).reason,
      'gecersiz_hamle', 'görünüm dışı koordinat reddedilmeli');
    assert.strictEqual(E.tikla(st, 5, 10, 10, t).reason, 'not_in_room',
      'masada olmayan tıklayamaz');
  }
  console.log('  ✓ 6) doğru tıklama sayılıyor, boş tıklama kilitliyor, çift dokunma ceza değil');

  // 7) ELİ TAMAMLAMA
  {
    let tt = t + E.YANLIS_KILIT_MS + 100;
    let son = null;
    st.farkIdleri.slice(1).forEach(id => {
      const d = konum(st.sahneId, id);
      son = E.tikla(st, 0, d.cx, d.cy, tt); tt += 5;
    });
    assert.ok(son.tamamladi, '7 farkı bulunca el bitmeli');
    assert.strictEqual(st.skor[0], 1, 'eli bulan almalı');
    assert.strictEqual(st.faz, 'elSonu', 'el sonu fazına geçilmeli');
  }
  /* Süre dolunca: çok bulan kazanır. */
  {
    const b = E.macBaslat({ seats: [0, 1], elSuresiSn: 10, rng: tohumlu(5) });
    let tb = Date.now() + E.GERI_SAYIM_MS + 10;
    E.tik(b, tb);
    const d = konum(b.sahneId, b.farkIdleri[0]);
    E.tikla(b, 1, d.cx, d.cy, tb);
    const r = E.tik(b, tb + 10 * 1000 + 50);
    assert.strictEqual(r.olay, 'elBitti', 'süre dolunca el bitmeli');
    assert.strictEqual(b.elKazanani, 1, 'çok fark bulan eli almalı');
    /* Hiç kimse bulamazsa el berabere. */
    const c = E.macBaslat({ seats: [0, 1], elSuresiSn: 10, rng: tohumlu(6) });
    let tc = Date.now() + E.GERI_SAYIM_MS + 10;
    E.tik(c, tc);
    E.tik(c, tc + 10 * 1000 + 50);
    assert.strictEqual(c.elKazanani, null, 'eşitlikte el berabere olmalı');
    assert.strictEqual(c.skor[0] + c.skor[1], 0, 'berabere elde puan verilmemeli');
  }
  console.log('  ✓ 7) 7 farkı bulan eli alıyor; süre dolunca çok bulan kazanıyor');

  // 8) MAÇ: 3 ELİN 2'Sİ
  {
    const m = E.macBaslat({ seats: [0, 1], elSuresiSn: 30, rng: tohumlu(21) });
    let tm = Date.now();
    const eliAl = (seat) => {
      tm += E.GERI_SAYIM_MS + 10; E.tik(m, tm);
      m.farkIdleri.forEach(id => {
        const d = konum(m.sahneId, id);
        E.tikla(m, seat, d.cx, d.cy, tm); tm += 3;
      });
    };
    eliAl(0);
    assert.strictEqual(m.status, 'playing', 'bir elde maç bitmemeli');
    tm += E.EL_ARASI_MS + 10; E.tik(m, tm);
    assert.strictEqual(m.el, 2, 'ikinci ele geçilmeli');
    assert.notStrictEqual(m.farkIdleri.join(), '', 'yeni elde yeni farklar seçilmeli');
    eliAl(0);
    assert.strictEqual(m.status, 'finished', 'ikinci eli de alan maçı kazanmalı');
    assert.strictEqual(m.winner, 0, 'kazanan doğru olmalı');
    assert.strictEqual(m.skor[0], 2, 'skor 2 olmalı');
  }
  console.log('  ✓ 8) maç 3 elin 2\'sini alanın');

  // 9) GÖRÜNÜM GİZLİLİĞİ
  {
    const g = E.macBaslat({ seats: [0, 1], elSuresiSn: 30, rng: tohumlu(9) });
    let tg = Date.now() + E.GERI_SAYIM_MS + 10; E.tik(g, tg);
    const d = konum(g.sahneId, g.farkIdleri[0]);
    E.tikla(g, 1, d.cx, d.cy, tg);
    const g0 = E.gorunum(g, 0);
    assert.strictEqual(g0.rakipBulunan, 1, 'rakibin KAÇ fark bulduğu görünmeli');
    assert.deepStrictEqual(g0.bulunan, [], 'kendi bulduklarım boş olmalı');
    assert.ok(!JSON.stringify(g0).includes('"kilitBitis"'), 'iç durum sızmamalı');
    assert.ok(!JSON.stringify(g0).includes('_rng'), 'rastgele üreteç sızmamalı');
    assert.strictEqual(g0.farkAdlari, null, 'el sürerken fark adları açıklanmamalı');
    const g1 = E.gorunum(g, 1);
    assert.deepStrictEqual(g1.bulunan, [g.farkIdleri[0]], 'bulan kendi bulduğunu görmeli');
    /* Farkların KİMLİKLERİ gönderilir — resmi çizen istemci (kaçınılmaz). */
    assert.strictEqual(g0.farkIdleri.length, 7, 'B kopyasını çizebilmek için gerekli');
  }
  console.log('  ✓ 9) rakibin buldukları gizli, yalnız sayısı paylaşılıyor');
}

/* ----------------------------------------------------------------- ONLINE */
async function onlineTesti() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const rooms = serverModule.rooms;
  const acik = [];

  // 10) HAZIR MASALAR
  const masalar = await httpRooms(BASE, 'fark');
  assert.strictEqual(masalar.length, 10, 'fark bulmaca 10 hazır masa açmalı');
  assert.ok(masalar.every(m => m.maxPlayers === 2), 'masalar iki kişilik olmalı');
  assert.ok(masalar.every(m => String(m.id) >= '2501' && String(m.id) <= '2510'),
    'masa kimlikleri 2501-2510 aralığında olmalı');
  {
    const hepsi = new Map();
    for (const g of (serverModule.ALL_GAMES || ['fark'])) {
      for (const m of await httpRooms(BASE, g)) {
        const id = String(m.id);
        assert.ok(!hepsi.has(id), 'masa kimliği çakışıyor: #' + id);
        hepsi.set(id, g);
      }
    }
  }
  console.log('  ✓ 10) hazır masalar lobide, kimlik çakışması yok');

  const oda = masalar[0];
  const A = await connect(BASE, 'fk-A');
  const B = await connect(BASE, 'fk-B');
  acik.push(A, B);
  for (const s of [A, B]) {
    s.emit('joinRoom', { roomId: String(oda.id), gameId: 'fark', userName: s.userName,
      userKey: 'test:' + s.userName, maxPlayers: 2, durationMinutes: oda.durationMinutes });
    await once(s, 'joinedRoom');
  }
  const basladi = [once(A, 'gameStarted', 12000), once(B, 'gameStarted', 12000)];
  [A, B].forEach(s => s.emit('setReady', { ready: true }));
  const [pA, pB] = await Promise.all(basladi);

  // 11) AYNI SAHNE, AYNI FARKLAR
  assert.strictEqual(pA.gameState.kind, 'fark', 'masa paketi fark bulmaca olmalı');
  assert.strictEqual(pA.gameState.sahneId, pB.gameState.sahneId, 'iki oyuncu AYNI sahneyi almalı');
  assert.strictEqual(pA.gameState.tohum, pB.gameState.tohum, 'tohum ortak olmalı');
  assert.deepStrictEqual(pA.gameState.farkIdleri, pB.gameState.farkIdleri,
    'iki oyuncu AYNI farkları almalı');
  assert.strictEqual(pA.gameState.farkIdleri.length, 7, 'elde 7 fark olmalı');
  assert.strictEqual(pA.gameState.faz, 'gerisayim', 'el geri sayımla başlamalı');
  assert.ok(pA.gameState.sahneAdi, 'sahne adı gitmeli');
  console.log('  ✓ 11) oyun başladı, iki oyuncu aynı sahneyi ve aynı farkları aldı');

  // 12) TIKLAMA DOĞRULAMASI
  const odaNes = rooms.get(String(oda.id));
  const f = odaNes.fark;
  for (let i = 0; i < 80 && f.faz !== 'oyun'; i++) await uyu(80);
  assert.strictEqual(f.faz, 'oyun', 'geri sayım bitmeli');
  {
    const d = konum(f.sahneId, f.farkIdleri[0]);
    const sonucA = once(A, 'farkSonuc', 8000);
    A.emit('farkClick', { roomId: String(oda.id), x: d.cx, y: d.cy });
    const r = await sonucA;
    assert.strictEqual(r.dogru, true, 'doğru tıklama kabul edilmeli');
    assert.strictEqual(r.farkId, f.farkIdleri[0], 'bulunan fark bildirilmeli');

    /* UYDURMA koordinat: farkın kimliği doğru olsa bile nokta yanlışsa
       sayılmaz — sunucu KONUMU ölçüyor. */
    const sonucB = once(A, 'farkSonuc', 8000);
    A.emit('farkClick', { roomId: String(oda.id), x: 3, y: 3 });
    const r2 = await sonucB;
    assert.strictEqual(r2.dogru, false, 'boş noktaya tıklama sayılmamalı');
    assert.ok(r2.kilitMs > 0, 'boş tıklama kilitlemeli');
    /* Kilitliyken gönderilen tıklama reddedilmeli. */
    const red = once(A, 'farkRejected', 8000);
    A.emit('farkClick', { roomId: String(oda.id), x: d.cx, y: d.cy });
    assert.strictEqual((await red).reason, 'tikla_kilitli', 'kilitliyken reddedilmeli');

    /* Rakip sayıyı görüyor, kimliği değil. */
    const gB = await (async () => {
      const kutu = kaydet(B, 'gameStateUpdated');
      B.emit('farkClick', { roomId: String(oda.id), x: 5, y: 5 });   // kilit al, durum gelsin
      let g = await kutu.bekle(8000);
      for (let i = 0; i < 10 && g.gameState.rakipBulunan === 0; i++) g = await kutu.bekle(8000);
      return g.gameState;
    })();
    assert.strictEqual(gB.rakipBulunan, 1, 'rakibin bulduğu SAYI görünmeli');
    assert.deepStrictEqual(gB.bulunan, [], 'rakibin hangi farkı bulduğu görünmemeli');
  }
  console.log('  ✓ 12) tıklama sunucuda doğrulanıyor, uydurma koordinat kabul edilmiyor');

  // 13) EL ve MAÇ BİTİŞİ
  {
    const bittiA = kaydet(A, 'gameEnded');
    const bittiB = kaydet(B, 'gameEnded');
    /* Maçı hızlandır: skoru bire çek, sonra kalan farkları A bulsun. */
    f.skor[0] = 1;
    f.kilitBitis[0] = 0;
    for (const id of f.farkIdleri) {
      const d = konum(f.sahneId, id);
      A.emit('farkClick', { roomId: String(oda.id), x: d.cx, y: d.cy });
      await uyu(60);
    }
    const [sA, sB] = await Promise.all([bittiA.bekle(15000), bittiB.bekle(15000)]);
    assert.strictEqual(sA.gameState.status, 'finished', 'maç bitmeli');
    assert.strictEqual(sA.winnerSeat, 0, 'iki eli alan kazanmalı');
    assert.strictEqual(sA.winnerSeat, sB.winnerSeat, 'iki pakette aynı kazanan');
    assert.notStrictEqual(sA.youWon, sB.youWon, 'biri kazandı diğeri kaybetti');
    assert.ok(Array.isArray(sA.gameState.farkAdlari), 'bitişte farkların adları açıklanmalı');
  }
  console.log('  ✓ 13) el ve maç bitişi iki istemciye de gidiyor');

  acik.forEach(s => { try { s.close(); } catch (_) {} });
  server.close();
}

/* ---------------------------------------------------------------- ARAYÜZ */
function arayuzTesti() {
  const sayfa = oku('index.html');
  assert.ok(/fark:\{name:'Fark Bulmaca'/.test(sayfa), 'oyun listesinde fark bulmaca olmalı');
  assert.ok(/js\/fark-online\.js/.test(sayfa), 'istemci adaptörü bağlı olmalı');
  assert.ok(/<script src="fark-sahneler\.js/.test(sayfa), 'ORTAK sahne dosyası sayfaya bağlı olmalı');
  /* Sahneler adaptörden ÖNCE yüklenmeli, yoksa GVFark tanımsız olur. */
  assert.ok(sayfa.indexOf('<script src="fark-sahneler.js') <
            sayfa.indexOf('<script src="js/fark-online.js'),
    'sahne dosyası adaptörden önce yüklenmeli');
  assert.ok(/\.fk-wrap\{/.test(sayfa), 'fark bulmaca stilleri olmalı');
  assert.ok(/fark:`<div class="rules-content">/.test(sayfa), 'kurallar metni olmalı');
  assert.ok(/ONLINE_GAMES = \[[^\]]*'fark'/.test(sayfa), 'online oyun listesinde olmalı');
  assert.ok(/fark:\[\]/.test(sayfa), 'ROOMS kaydı olmalı');

  const istemci = oku('js/fark-online.js');
  assert.ok(/kinds: \['fark'\]/.test(istemci), 'adaptör türü karşılamalı');
  assert.ok(/window\.GVFark/.test(istemci), 'adaptör ortak sahne modülünü kullanmalı');
  assert.ok(/orientationchange/.test(istemci), 'yön değişiminde ölçü tazelenmeli');
  assert.ok(/classList\.toggle\('yanyana'/.test(istemci),
    'geniş alanda yan yana, dar alanda alt alta dizilmeli');
  assert.ok(/preserveAspectRatio/.test(istemci), 'SVG oranını korumalı');

  /* Sahne dosyası HEM Node'da HEM tarayıcıda çalışmalı (UMD). */
  const sahneler = oku('fark-sahneler.js');
  assert.ok(/module\.exports/.test(sahneler) && /kok\.GVFark/.test(sahneler),
    'sahne dosyası hem sunucuda hem tarayıcıda yüklenebilmeli');

  const sunucu = oku('server.js');
  assert.ok(/fark: 2501/.test(sunucu), 'hazır masa taban kimliği tanımlı olmalı');
  assert.ok(/socket\.on\('farkClick'/.test(sunucu), 'tıklama olayı sunucuda olmalı');
  assert.ok(/farkClockTick\(room\); continue;/.test(sunucu), 'faz saati ana döngüde olmalı');
  const tumOyunlar = (sunucu.match(/ALL_GAMES = \[[\s\S]*?\];/) || [''])[0];
  assert.ok(tumOyunlar.includes("'fark'"), 'oyun listesine eklenmeli');

  const panel = oku('js/admin-panel.js');
  assert.ok(/let STANDARD = \[[^\]]*'fark'/.test(panel), 'kurucu panelinde olmalı');
  assert.ok(/fark: 2501/.test(panel), 'panelin taban numarası güncel olmalı');

  assert.ok(fs.existsSync(path.join(KOK, 'assets', 'covers', 'fark.jpg')), 'kapak olmalı');
  assert.ok(fs.existsSync(path.join(KOK, 'tools', 'kapak-fark.py')), 'kapak betiği olmalı');
  console.log('  ✓ 14) istemci, ortak sahne dosyası, stiller, kurallar, panel ve kapak bağlı');
}

(async () => {
  try {
    sahneTesti();
    motorTesti();
    await onlineTesti();
    arayuzTesti();
    console.log('OK fark bulmaca: sahneler, motor, tıklama doğrulaması, online akış, arayüz');
    process.exit(0);
  } catch (e) {
    console.error('FARK BULMACA HATASI:', e);
    process.exit(1);
  }
})();
