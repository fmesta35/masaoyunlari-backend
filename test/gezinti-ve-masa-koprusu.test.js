'use strict';
/* ============================================================================
 * GEZİNTİ (GERİ TUŞU) ve MASA KÖPRÜSÜ
 * ============================================================================
 * İki kullanıcı raporu bu dosyada kilitleniyor:
 *
 * 1) "Tüm oyunlarda sayfada geri gele bastığımda hesap silmesi sayfası
 *    açılıyor."
 *    SEBEBİ: SPA hiç geçmiş adımı bırakmıyordu; GERİ tuşu siteyi tamamen
 *    terk edip index.html'den önce açılmış belgeye (gizlilik / hesap-silme)
 *    dönüyordu. Artık her iç sayfa geçişi geçmişe bir adım bırakıyor ve
 *    GERİ önce sitenin içinde geri gidiyor (js/gezinti.js).
 *
 * 2) "Yeni eklenen oyunlar eşleşme lobisini bulmadığı için oyuna
 *    bağlanılamıyor."
 *    SEBEBİ: js/room-waiting-fix.js içindeki BRIDGE_GAMES listesi ELLE
 *    yazılmıştı; Tombala, Adam Asmaca, Passaparola, Cenga ve Langırt orada
 *    olmadığı için masada-bekleme görünümü (otur/kalk/hazırım) hiç
 *    çizilmiyor, masanın ortası bomboş kalıyordu. Liste artık
 *    ONLINE_GAMES'ten türetiliyor.
 *
 * NE DOĞRULANIR
 *   KÖPRÜ
 *     1) Köprü listesi ONLINE_GAMES'ten türüyor; ONLINE_GAMES'teki HER oyun
 *        köprüde (yani yeni oyun eklemek için elle liste güncellemek yok).
 *     2) Başlıktan oyun çıkarımı yeni oyunların adlarını tanıyor.
 *     3) index.html'de her online oyunun istemci adaptörü betiği bağlı ve
 *        arena'dan SONRA yükleniyor.
 *     4) Gerçek tarayıcıda: yeni bir oyunun masasına girilince bekleme
 *        görünümü ÇİZİLİYOR (ekran boş kalmıyor).
 *   GEZİNTİ
 *     5) Sayfa geçişleri geçmişe adım bırakıyor.
 *     6) GERİ tuşu sitenin İÇİNDE geri gidiyor (lobi → ana sayfa), belgeyi
 *        terk etmiyor.
 *     7) Masada GERİ: MAÇ YOKKEN onay sormadan lobiye düşüyor (eskiden onay
        kutusu çıkıp oyuncuyu masada kilitliyordu), MAÇ SÜRERKEN terk
        uyarısı çıkıyor ve vazgeçen masada kalıyor.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-gezinti-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');
const { JSDOM, VirtualConsole } = require('jsdom');

const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    let v = null;
    try { v = await fn(); } catch (_) { v = null; }
    if (v) return v;
    await sleep(120);
  }
  throw new Error('zaman aşımı: ' + label);
}
function makeVc() {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  return vc;
}

/* ------------------------------------------------- 1-3) KAYNAK SÖZLEŞMESİ */
function kaynakTesti() {
  const sayfa = oku('index.html');
  const kopru = oku('js/room-waiting-fix.js');

  // 1) Köprü listesi ONLINE_GAMES'ten türemeli
  assert.ok(/function bridgeGames\(\)/.test(kopru), 'köprü listesi bir fonksiyondan gelmeli');
  assert.ok(/window\.ONLINE_GAMES/.test(kopru),
    'köprü listesi ONLINE_GAMES\'ten türemeli — elle yazılan liste yeni oyunda unutuluyor');
  /* Eski ELLE yazılmış sabit artık karar vermemeli: yalnız yedek olarak
     durabilir, karşılaştırmalarda kullanılmamalı. */
  assert.ok(!/BRIDGE_GAMES\.includes/.test(kopru),
    'karar elle yazılan listeye göre verilmemeli');

  const online = (sayfa.match(/const ONLINE_GAMES = \[([^\]]*)\]/) || [])[1] || '';
  const oyunlar = [...online.matchAll(/'([a-z0-9]+)'/g)].map(m => m[1]);
  assert.ok(oyunlar.length >= 17, 'ONLINE_GAMES dolu olmalı — bulunan: ' + oyunlar.length);
  ['kelimelik', 'tombala', 'adamasmaca', 'passaparola', 'cenga', 'langirt']
    .forEach(g => assert.ok(oyunlar.includes(g), g + ' ONLINE_GAMES içinde olmalı'));
  console.log('  ✓ 1) köprü listesi ONLINE_GAMES\'ten türüyor (elle liste yok)');

  // 2) Başlıktan çıkarım yeni adları tanımalı
  ['tombala', 'adamasmaca', 'passaparola', 'cenga', 'langirt'].forEach(g => {
    assert.ok(kopru.includes("return '" + g + "'"),
      g + ' için başlıktan çıkarım olmalı (curGame boş kalırsa yedek yol)');
  });
  console.log('  ✓ 2) başlıktan oyun çıkarımı yeni oyunları tanıyor');

  // 3) Her online oyunun adaptörü bağlı ve arena'dan SONRA
  /* Yorum satırlarındaki dosya adları sayılmasın: yalnız BETİK ETİKETİ. */
  const betikYeri = (dosya) => sayfa.indexOf('<script src="js/' + dosya);
  const arenaYeri = betikYeri('online-arena.js');
  assert.ok(arenaYeri > 0, 'arena betiği sayfaya bağlı olmalı');
  const kendiIstemcisi = ['chess', 'tavla', 'okey', 'okey101'];   // kendi istemcileri var
  oyunlar.filter(g => !kendiIstemcisi.includes(g)).forEach(g => {
    const yer = betikYeri(g + '-online.js');
    assert.ok(yer > 0, g + ' adaptörü sayfaya bağlı olmalı');
    assert.ok(yer > arenaYeri, g + ' adaptörü arena\'dan SONRA yüklenmeli (kuyrukta kalmasın)');
  });
  console.log('  ✓ 3) her online oyunun adaptörü bağlı ve arena\'dan sonra yükleniyor');

  // Gezinti modülü sayfaya bağlı mı?
  const gez = oku('js/gezinti.js');
  assert.ok(/js\/gezinti\.js/.test(sayfa), 'gezinti modülü sayfaya bağlı olmalı');
  assert.ok(/addEventListener\('popstate'/.test(gez), 'GERİ tuşu dinlenmeli');
  assert.ok(/history\.pushState/.test(gez), 'sayfa geçişi geçmişe adım bırakmalı');
  assert.ok(/leaveRoom/.test(gez), 'masada GERİ "Ayrıl" yolundan geçmeli');
}

/* --------------------------------------------------- 4-7) GERÇEK TARAYICI */
async function tarayiciTesti(BASE) {
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: makeVc(),
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); }
  });
  const win = dom.window;
  await waitFor(() => (win.st && win.GV ? true : null), 20000, 'sayfa açıldı');
  await waitFor(() => (typeof win.__gvStartRealRoomWaiting === 'function' ? true : null),
    20000, 'masa köprüsü yüklendi');
  await waitFor(() => (win.__gvGezinti && win.__gvGezinti.hazir() ? true : null),
    20000, 'gezinti hazır');

  // 4) YENİ OYUNUN MASASI: bekleme görünümü çizilmeli
  for (const oyun of ['cenga', 'passaparola', 'adamasmaca', 'langirt', 'tombala',
                      'havahokeyi', 'fark', 'kizmabirader', 'metropol']) {
    win.st.curGame = oyun;
    win.GV.openLobby(oyun);
    /* "Masalar yükleniyor..." satırı da .room sınıfını taşıyor; gerçek
       masayı Katıl düğmesinden ayırt ediyoruz. */
    const satirlar = await waitFor(() => {
      const r = [...win.document.querySelectorAll('#roomList .room')]
        .filter(x => x.querySelector('[onclick*="joinRoom"]'));
      return r.length ? r : null;
    }, 20000, oyun + ' lobisinde masa yok');
    assert.ok(satirlar.length >= 1,
      oyun + ' lobisinde hazır masalar listelenmeli — bulunan: ' + satirlar.length);

    /* Masa numarası satırın metninde ya da "Katıl" düğmesinin onclick
       çağrısında durur (GV.joinRoom('2201')). İkisine de bak. */
    const satir = satirlar[0];
    const dugme = satir.querySelector('[onclick*="joinRoom"]');
    const masaId = (satir.textContent.match(/#(\d+)/) || [])[1] ||
      ((dugme && dugme.getAttribute('onclick') || '').match(/joinRoom\('([^']+)'/) || [])[1];
    assert.ok(masaId, oyun + ' masa numarası okunmalı — satır: ' +
      satir.textContent.replace(/\s+/g, ' ').slice(0, 90));
    win.GV.joinRoom(masaId);
    /* KRİTİK: masada-bekleme katmanı ÇİZİLMELİ. Köprü listesi bu oyunu
       tanımazsa katman hiç açılmıyor ve oyuncu bomboş bir masaya bakıyordu
       — kullanıcının bildirdiği hata tam olarak buydu. */
    const katman = await waitFor(() => {
      const el = win.document.getElementById('gv-real-chess-wait');
      return (el && el.textContent.trim().length > 20) ? el : null;
    }, 15000, oyun + ' masasında bekleme görünümü çizilmedi (ekran boş)');
    const yazi = katman.textContent.replace(/\s+/g, ' ');
    assert.ok(/HAZIR|BEKLİYOR|Boş Sandalye|Rakip bekleniyor/i.test(yazi),
      oyun + ' masasında otur/hazırım görünümü olmalı — bulunan: ' + yazi.slice(0, 90));
    assert.ok(yazi.includes('#' + masaId), 'bekleme başlığı doğru masayı göstermeli');
    /* sorma:true ile GERÇEKTEN çık: argümansız leaveRoom onay sorar ve
       jsdom'un varsayılan confirm'i false döndürdüğü için oyuncu masada
       KALIYORDU — sonraki bölümler kirli durumla başlıyordu. */
    win.GV.leaveRoom({ sorma: true });
    await waitFor(() => (win.st.curPage !== 'room' ? true : null), 10000,
      oyun + ' masasından çıkılamadı');
    await sleep(250);
  }
  console.log('  ✓ 4) yeni oyunların masasında bekleme görünümü çiziliyor (ekran boş değil)');

  // 5) Sayfa geçişi geçmişe adım bırakıyor
  const baslangic = win.history.length;
  win.GV.page('games');
  await sleep(120);
  win.GV.openLobby('cenga');
  await sleep(200);
  assert.ok(win.history.length > baslangic,
    'sayfa geçişleri geçmişe adım bırakmalı — eskiden hiç bırakmıyordu');
  assert.ok(win.history.state && win.history.state.gv === 'gv-gezinti',
    'geçmiş adımı bu sitenin olmalı');
  assert.strictEqual(win.history.state.page, 'lobby', 'son adım lobi olmalı');
  console.log('  ✓ 5) sayfa geçişleri geçmişe adım bırakıyor');

  // 6) GERİ sitenin İÇİNDE geri gidiyor
  const belge = win.document;
  win.history.back();
  await waitFor(() => (win.st.curPage !== 'lobby' ? true : null), 8000,
    'GERİ ile lobiden çıkılmadı');
  assert.strictEqual(win.document, belge, 'GERİ belgeyi terk etmemeli (site içinde kalmalı)');
  assert.ok(['games', 'home'].includes(win.st.curPage),
    'GERİ bir önceki İÇ sayfaya dönmeli — bulunan: ' + win.st.curPage);
  console.log('  ✓ 6) GERİ tuşu sitenin içinde geri gidiyor, belgeyi terk etmiyor');

  // 7) Masada GERİ → lobiye düşüyor (maç yokken onay sorulmadan)
  win.GV.openLobby('cenga');
  const cl = await waitFor(() => {
    const r = [...win.document.querySelectorAll('#roomList .room')]
      .filter(x => x.querySelector('[onclick*="joinRoom"]'));
    return r.length > 1 ? r : null;
  }, 20000, 'cenga lobisi');
  const s2 = cl[1];
  const d2 = s2.querySelector('[onclick*="joinRoom"]');
  const id2 = (s2.textContent.match(/#(\d+)/) || [])[1] ||
    ((d2 && d2.getAttribute('onclick') || '').match(/joinRoom\('([^']+)'/) || [])[1];
  win.GV.joinRoom(id2);
  await waitFor(() => (win.st.curPage === 'room' ? true : null), 10000, 'masaya girilmedi');

  /* 7a) MAÇ YOKKEN: GERİ onay SORMADAN lobiye düşürmeli.
     ⚠ Eskiden burada da "Ayrılmak istediğine emin misin?" çıkıyordu ve
     kullanıcı masada KİLİTLİ kalıyordu: geri tuşuna her basışta kutu
     açılıyor, hiçbir yere gidilmiyordu (kullanıcı raporu). Geri tuşu zaten
     açık bir "geri dön" isteğidir; onay kutusuyla karşılanmaz. */
  let soruldu = 0;
  win.confirm = (m) => { soruldu++; return false; };
  win.history.back();
  await waitFor(() => (win.st.curPage !== 'room' ? true : null), 10000,
    'maç yokken GERİ masadan çıkarmadı');
  assert.strictEqual(soruldu, 0,
    'bekleme odasında GERİ onay SORMAMALI — sorulan: ' + soruldu);
  assert.strictEqual(win.st.curPage, 'lobby', 'maç yokken GERİ lobiye düşürmeli');
  assert.strictEqual(win.document, belge, 'masada GERİ de belgeyi terk etmemeli');

  /* 7b) MAÇ SÜRERKEN sessiz çıkış YASAK. Geri tuşunun kullandığı
     `leaveRoom({sorma:true})` yalnız bekleme odasındaki "Ayrılmak istediğine
     emin misin?" sorusunu atlar. Maç sürerken devreye js/leave-guard.js
     girer ve KENDİ terk uyarısını açar (yerleşik confirm'i bilerek susturur);
     oyuncu "Hayır, Oyunda Kal" derse masada kalır. Böylece geri tuşu bir
     maçı sessizce terk ettirip hükmen yenilgi ve ceza puanı yazdıramaz. */
  const cl2 = await waitFor(() => {
    const r = [...win.document.querySelectorAll('#roomList .room')]
      .filter(x => x.querySelector('[onclick*="joinRoom"]'));
    return r.length > 2 ? r : null;
  }, 20000, 'cenga lobisi (2. tur)');
  const d3 = cl2[2].querySelector('[onclick*="joinRoom"]');
  const id3 = (cl2[2].textContent.match(/#(\d+)/) || [])[1] ||
    ((d3 && d3.getAttribute('onclick') || '').match(/joinRoom\('([^']+)'/) || [])[1];
  win.GV.joinRoom(id3);
  await waitFor(() => (win.st.curPage === 'room' ? true : null), 10000, 'masaya girilmedi (2)');

  /* "Maç sürüyor" durumunu arena üzerinden taklit et: hem hasActiveMatch()
     hem de leave-guard'ın canliTahta() denetimi buraya bakar. */
  const arenaEski = win.GVArena && win.GVArena.state;
  if (win.GVArena) win.GVArena.state = () => ({ status: 'playing' });
  assert.ok(win.GV.hasActiveGame(), 'test kurulumu: maç aktif sayılmalı');

  win.GV.leaveRoom({ sorma: true });
  const uyari = await waitFor(() => win.document.querySelector('.gvlg-overlay'), 6000,
    'maç sürerken sessiz çıkış YASAK: terk uyarısı açılmalı');
  assert.ok(/hükmen mağlup/i.test(uyari.textContent),
    'uyarı hükmen yenilgiyi söylemeli — bulunan: ' + uyari.textContent.replace(/\s+/g, ' ').slice(0, 80));
  uyari.querySelector('.gvlg-no').click();
  await sleep(400);
  assert.strictEqual(win.st.curPage, 'room', '"Oyunda Kal" denince masada kalınmalı');
  assert.ok(!win.document.querySelector('.gvlg-overlay'), 'uyarı kapanmalı');

  /* "Evet, Terk Et" → masadan çıkılmalı. */
  win.GV.leaveRoom({ sorma: true });
  const uyari2 = await waitFor(() => win.document.querySelector('.gvlg-overlay'), 6000,
    'terk uyarısı ikinci kez açılmalı');
  if (win.GVArena && arenaEski) win.GVArena.state = arenaEski;   // artık maç yok
  uyari2.querySelector('.gvlg-yes').click();
  await waitFor(() => (win.st.curPage !== 'room' ? true : null), 10000,
    'terk onaylandığı hâlde masadan çıkılmadı');

  console.log('  ✓ 7) masada GERİ maç yokken sormadan lobiye düşürüyor; maç sürerken sessiz çıkış yasak');

  win.close();
}

(async () => {
  let server;
  try {
    kaynakTesti();
    server = await serverModule.start(0);
    await tarayiciTesti('http://127.0.0.1:' + server.address().port);
    console.log('OK gezinti ve masa köprüsü: GERİ tuşu site içinde, yeni oyunlar masada açılıyor');
    if (server) server.close();
    process.exit(0);
  } catch (e) {
    console.error('GEZİNTİ/KÖPRÜ HATASI:', e);
    if (server) server.close();
    process.exit(1);
  }
})();
