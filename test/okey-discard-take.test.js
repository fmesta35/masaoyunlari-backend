'use strict';

/*
 * OKEY — ATILAN TAŞ ALINAMIYOR HATASI (kullanıcı raporu, verbatim):
 *   "Okey oyununda rakiplerin masaya atılan taşları karşı oyuncular
 *    tarafından alınamıyor. Normal okey kurallarında böyle değil,
 *    kontrol et ve düzelt."
 *
 * KÖK NEDEN: Okey kuralına göre oyuncu, tur sırasında kendinden BİR
 * ÖNCEKİ oyuncunun açık attığı taşı alabilir. İstemci bu oyuncunun EKRAN
 * konumunu sabit "1" (Sol) varsayıyordu. Bu yalnız 4 KİŞİLİK masada
 * doğrudur:
 *    4 kişilik → tur sırası 0→3→2→1, önceki oyuncu pos 1  (Sol)   ✔
 *    3 kişilik → aktif konumlar [0,3,2], önceki oyuncu pos 2 (Karşı) ✘
 *    2 kişilik → aktif konumlar [0,2],   önceki oyuncu pos 2 (Karşı) ✘
 * Bu yüzden 2 ve 3 kişilik masalarda hem atık bölgesi TIKLANABİLİR
 * işaretlenmiyor hem de _okPointerDown() erken `return` ile taş almayı
 * tamamen engelliyordu.
 *
 * DÜZELTME: alınabilir atığın konumu artık masadaki kişi sayısından
 * türetiliyor (_okPrevPos: activePositions TUR SIRASINDA benden başlar,
 * son eleman = bir önceki oyuncu).
 *
 * Bu test GERÇEK sayfayı (jsdom) açar, 2/3/4 kişilik masaların HER BİRİ
 * için yerel okey masasını kurar ve:
 *   1) doğru konumun "alınabilir" (active-take + sürükleme kancası)
 *      işaretlendiğini,
 *   2) yanlış konumların işaretlenMEdiğini,
 *   3) _okPointerDown(event,'left') çağrısının artık erken dönmeyip
 *      gerçekten sürüklemeyi başlattığını (okDrag.type === 'left')
 * doğrular. 3. madde asıl hatayı yakalar: eski kodda 2/3 kişilikte bu
 * çağrı sessizce hiçbir şey yapmıyordu.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-okdisc-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(80);
  }
  throw new Error('zaman aşımı: ' + ne);
}

async function pencere(base) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = base; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV && typeof win.rOkey === 'function', 20000, 'sayfa açılışı');
  return win;
}

// Masayı kur ve "sıra bende / çekme aşaması" durumuna getir; önceki
// oyuncunun atık yığınına bir taş koy.
function masaKur(win, pCount) {
  win.st.roomConfig = { playerCount: pCount };
  const area = win.document.getElementById('boardArea');
  win.rOkey(area);                     // yerel okey masasını başlat
  const ok = win.st.boards.okey;
  ok.myTurn = true;
  ok.phase = 'draw';
  ok.gameEnded = false;
  const prevPos = win._okPrevPos(ok);
  ok.discardPiles[prevPos] = [{ id: 'atik-1', n: 7, c: 't-red', isOkey: false }];
  win.dOkey(area);
  return { ok, prevPos, area };
}

function sahteOlay(win, el) {
  // _okPointerDown gerçek bir olay nesnesi ve currentTarget bekler.
  return {
    cancelable: true,
    preventDefault() {},
    clientX: 100, clientY: 100,
    currentTarget: el,
    touches: null
  };
}

// jsdom düzen (layout) hesaplamaz: her getBoundingClientRect 0×0 döner ve
// _okPointerDown "ölçüsüz eleman" koruması yüzünden erken çıkar. Gerçek
// tarayıcıdaki ölçüyü taklit edip SADECE bu korumayı aşıyoruz; test
// edilen mantık (hangi atık alınabilir) olduğu gibi çalışır.
function olcuVer(el, w, h) {
  el.getBoundingClientRect = () => ({
    width: w, height: h, left: 10, top: 10, right: 10 + w, bottom: 10 + h, x: 10, y: 10
  });
}

function surukleBasla(win, zone) {
  olcuVer(zone, 40, 56);
  const tbl = win.document.querySelector('.okey-table');
  if (tbl) olcuVer(tbl, 900, 560);
  win.__gvOkDragging = false;
  [...win.document.querySelectorAll('.ok-drag-ghost')].forEach(g => g.remove());
  win.GV._okPointerDown(sahteOlay(win, zone), 'left');
  const basladi = !!win.__gvOkDragging;
  [...win.document.querySelectorAll('.ok-drag-ghost')].forEach(g => g.remove());
  win.__gvOkDragging = false;
  return basladi;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const win = await pencere(BASE);

  // 2/3/4 kişilik masaların HEPSİ denenir; beklenen önceki-oyuncu konumu
  // tur sırasından gelir (activePositions'ın son elemanı).
  const beklenen = { 2: 2, 3: 2, 4: 1 };

  for (const pCount of [2, 3, 4]) {
    const { ok, prevPos, area } = masaKur(win, pCount);

    assert.strictEqual(prevPos, beklenen[pCount],
      `${pCount} kişilik masada önceki oyuncu konumu ${beklenen[pCount]} olmalı (bulunan: ${prevPos})`);

    // ---- 1) Doğru bölge alınabilir işaretli mi? ----
    const zones = [...area.querySelectorAll('.ok-disc-zone')];
    assert.ok(zones.length >= 2, pCount + ' kişilik masada atık bölgeleri çizilmeli');
    const prevZone = zones.find(z => Number(z.dataset.pos) === prevPos);
    assert.ok(prevZone, `${pCount} kişilik: önceki oyuncunun (pos ${prevPos}) atık bölgesi çizilmeli`);
    assert.ok(prevZone.classList.contains('active-take'),
      `${pCount} kişilik: önceki oyuncunun atığı ALINABİLİR (active-take) işaretlenmeli`);
    assert.ok((prevZone.getAttribute('onmousedown') || '').includes("'left'"),
      `${pCount} kişilik: önceki oyuncunun atığında sürükleme kancası olmalı`);
    assert.ok((prevZone.querySelector('.ok-disc-label').textContent || '').includes('←'),
      `${pCount} kişilik: alınabilir atık "←" işaretiyle gösterilmeli`);

    // ---- 2) Diğer bölgeler alınabilir OLMAMALI ----
    zones.filter(z => Number(z.dataset.pos) !== prevPos).forEach(z => {
      assert.ok(!z.classList.contains('active-take'),
        `${pCount} kişilik: pos ${z.dataset.pos} atığı alınabilir işaretlenMEmeli`);
    });

    // ---- 3) ASIL HATA: tıklama/sürükleme gerçekten başlıyor mu? ----
    // Eski kodda 2 ve 3 kişilik masada _okPointerDown sessizce return
    // ediyordu; sürükleme hiç başlamıyordu.
    assert.ok(surukleBasla(win, prevZone),
      `${pCount} kişilik: önceki oyuncunun atığına basınca taş alma (sürükleme) BAŞLAMALI ` +
      `— eski hatada 2 ve 3 kişilik masada hiçbir şey olmuyordu`);

    console.log(`  ✓ ${pCount} kişilik masa: önceki oyuncunun (pos ${prevPos}) attığı taş alınabiliyor`);
  }

  // ---- 4) Çekme aşaması DEĞİLKEN alınamaz (kural korunuyor) ----
  {
    const { ok, prevZoneOk } = (() => {
      const r = masaKur(win, 2);
      r.ok.phase = 'discard';            // taş atma aşaması — çekilemez
      win.dOkey(r.area);
      return { ok: r.ok, prevZoneOk: r };
    })();
    const zone = prevZoneOk.area.querySelector(`.ok-disc-zone[data-pos="${prevZoneOk.prevPos}"]`);
    assert.ok(!zone.classList.contains('active-take'),
      'taş ATMA aşamasında atık alınabilir görünmemeli');
    assert.ok(!surukleBasla(win, zone),
      'taş ATMA aşamasında atıktan çekme başlamamalı (kural korunmalı)');
    console.log('  ✓ 4) kural korunuyor: yalnız ÇEKME aşamasında atık alınabiliyor');
  }

  win.close();
  server.close();
  console.log('OK okey atık: 2/3/4 kişilik masaların hepsinde önceki oyuncunun taşı alınabiliyor');
  process.exit(0);
}

main().catch(err => { console.error('❌ OKEY ATIK HATASI:', err); process.exit(1); });
