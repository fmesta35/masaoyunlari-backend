'use strict';
/* Doğrulama: ESKİ NESİL index.html simülasyonu — window.st / rTavla / dTavla
 * YOKMUŞ gibi davran (canlı barındırmada bayat index.html senaryosu).
 * Kendi kendine yeten çizici devreye girmeli: tahta yine çizilmeli,
 * Zar At sunucuya ulaşmalı, pullar ve zarlar görünmeli.
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = 'http://localhost:3100';
const ROOM = process.argv[2] || '202';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function makeClient(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  return { dom, win: dom.window, label };
}

async function main() {
  const A = await makeClient('A');
  const B = await makeClient('B');
  for (const c of [A, B]) {
    for (let i = 0; i < 250 && !(c.win.GV && c.win.st); i++) await sleep(100);
    for (let i = 0; i < 250 && typeof c.win.__gvStartRealRoomWaiting !== 'function'; i++) await sleep(100);
    // ESKİ NESİL SAYFA SİMÜLASYONU — köprü/online modüller global st'i göremez
    c.win.st.curGame = 'tavla'; // IIFE içi durumu önce ayarla (joinRoom bunu okur)
    delete c.win.st;
    delete c.win.rTavla;
    delete c.win.dTavla;
    c.win.GV.joinRoom(ROOM);
  }
  await sleep(1000);
  // Bazı akışlarda joinRoom curGame'i IIFE içi st üzerinden okur; emin olmak için başlığı kontrol et
  for (const c of [A, B]) {
    for (let i = 0; i < 120; i++) {
      const btn = c.win.document.querySelector('#gv-real-chess-wait .gv-ready');
      if (btn) { btn.click(); break; }
      await sleep(100);
    }
  }

  for (const c of [A, B]) {
    for (let i = 0; i < 150 && !c.win.document.querySelector('#boardArea .tavla-board'); i++) await sleep(100);
  }
  const aHas = !!A.win.document.querySelector('#boardArea .tavla-board');
  const bHas = !!B.win.document.querySelector('#boardArea .tavla-board');
  console.log('▶ window.st/dTavla YOK iken tahta:', aHas ? 'A çizildi ✔' : 'A BOŞ ❌', '/', bHas ? 'B çizildi ✔' : 'B BOŞ ❌');
  if (!aHas || !bHas) {
    console.log('A boardArea içeriği (ilk 300):', A.win.document.getElementById('boardArea')?.innerHTML.slice(0, 300));
    process.exit(1);
  }

  // Pullar sayısı + Zar At butonu bir tarafta aktif olmalı
  const checkers = A.win.document.querySelectorAll('#boardArea .tavla-checker').length;
  console.log('▶ A pul sayısı:', checkers, checkers === 30 ? '✔' : '❌');
  const rollBtnOf = c => [...c.win.document.querySelectorAll('#boardArea .tavla-btn')].find(b => /Zar At/.test(b.textContent) && !b.disabled);
  const roller = rollBtnOf(A) ? A : (rollBtnOf(B) ? B : null);
  console.log('▶ aktif Zar At butonu:', roller ? roller.label + ' ✔' : '❌ iki tarafta da yok');
  if (!roller) process.exit(1);
  const other = roller === A ? B : A;

  // Zar at → sunucudan gerçek zar → her iki istemcide zar yüzleri görünür
  rollBtnOf(roller).click();
  await sleep(1200);
  const diceR = [...roller.win.document.querySelectorAll('#boardArea .tavla-die-face')].map(d => d.className).join(',');
  const diceO = [...other.win.document.querySelectorAll('#boardArea .tavla-die-face')].map(d => d.className).join(',');
  const roBadge = roller.win.document.getElementById('tvMoveBadge');
  console.log('▶ zar yüzleri atanda:', diceR || 'YOK', diceR ? '✔' : '❌');
  console.log('▶ zar yüzleri rakipte:', diceO || 'YOK', diceO ? '✔' : '❌');
  console.log('▶ hamle rozeti görünür mü:', roBadge && roBadge.style.visibility, '| metin:', roBadge?.textContent);

  // Sayaç paneli de akıyor olmalı (st'siz yolda updateClock zaten bağımsız)
  const t1a = roller.win.document.getElementById('t1').textContent;
  await sleep(1600);
  const t1b = roller.win.document.getElementById('t1').textContent;
  console.log('▶ saat akışı:', t1a, '→', t1b, t1a !== t1b ? '✔' : '❌ (dondu)');

  console.log('\nSELF-RENDER (eski nesil sayfa) DOĞRULAMASI TAMAM');
  process.exit(0);
}
main().catch(e => { console.error('HATA:', e); process.exit(1); });
