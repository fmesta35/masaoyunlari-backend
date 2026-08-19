'use strict';
/* Doğrulama: satrançta TAŞ SEÇİMİ tahtayı yeniden kurmamalı (titreme bitti).
 * A+B gerçek satranç odasına girer (#101), beyaz taraf e2 seçer → .chess
 * düğümü AYNI kalmalı (sadece sınıflar değişir). Sonra e2-e4 oynanır:
 * sunucu paketiyle tam yeniden çizim gelir (bu normaldir).
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const BASE = 'http://localhost:3100';
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
    c.win.st.curGame = 'chess';
    c.win.GV.joinRoom('101');
  }
  await sleep(900);
  for (const c of [A, B]) {
    for (let i = 0; i < 120; i++) {
      const btn = c.win.document.querySelector('#gv-real-chess-wait .gv-ready');
      if (btn) { btn.click(); break; }
      await sleep(100);
    }
  }
  // Tahta her iki istemcide kuruldu mu?
  for (const c of [A, B]) {
    for (let i = 0; i < 120 && !c.win.document.querySelector('#boardArea .chess'); i++) await sleep(100);
  }
  const aBoard = A.win.document.querySelector('#boardArea .chess');
  const bBoard = B.win.document.querySelector('#boardArea .chess');
  if (!aBoard || !bBoard) { console.log('❌ tahta kurulamadı', { a: !!aBoard, b: !!bBoard }); process.exit(1); }
  console.log('✔ iki istemcide de satranç tahtası var');

  // Kim beyaz? e2 (r6c4) karesine iki istemcide de tıkla; seçim yapan beyazdır.
  const clickCell = (c, r, col) => {
    const cell = c.win.document.querySelector(`#boardArea .chess-c[data-r="${r}"][data-c="${col}"]`);
    cell.dispatchEvent(new c.win.MouseEvent('click', { bubbles: true }));
  };
  clickCell(A, 6, 4);
  await sleep(150);
  let white = A.win.document.querySelector('#boardArea .chess-c.sel') ? A : null;
  if (!white) { clickCell(B, 6, 4); await sleep(150); if (B.win.document.querySelector('#boardArea .chess-c.sel')) white = B; }
  if (!white) { console.log('❌ kimse e2 seçemedi'); process.exit(1); }
  const other = white === A ? B : A;
  console.log('✔ beyaz taraf:', white.label);

  // KRİTİK ÖLÇÜM: seçim öncesi/sonrası .chess düğümü kimliği
  const beforeEl = white.win.document.querySelector('#boardArea .chess');
  const beforeCells = white.win.document.querySelectorAll('#boardArea .chess-c').length;
  // seçimi bırak + tekrar seç (iki hamle de yalnızca sınıf boyamalı)
  clickCell(white, 6, 4); await sleep(120); // deselect
  clickCell(white, 6, 4); await sleep(120); // reselect
  const afterEl = white.win.document.querySelector('#boardArea .chess');
  const sameNode = beforeEl === afterEl;
  const badges = white.win.document.querySelectorAll('#moveClockBadge').length;
  console.log('▶ seçim sonrası .chess düğümü AYNI mı?', sameNode ? 'EVET ✔ (titreme giderildi)' : 'HAYIR ❌');
  console.log('▶ kare sayısı:', beforeCells, '| rozet düğümü:', badges);

  // sel + hamle noktaları boyandı mı?
  const selCount = white.win.document.querySelectorAll('#boardArea .chess-c.sel').length;
  const moveDots = white.win.document.querySelectorAll('#boardArea .chess-c.valid-move').length;
  console.log('▶ sel sayısı:', selCount, '| valid-move noktası:', moveDots, (selCount === 1 && moveDots >= 2) ? '✔' : '❌');

  // Gerçek hamle: e2->e4 — sunucu paketi tam çizim getirir (beklenen rebuild)
  clickCell(white, 4, 4);
  await sleep(1200);
  const moved = white.win.document.querySelector('.chess-c[data-r="4"][data-c="4"] .chess-p');
  const otherSeen = other.win.document.querySelector('.chess-c[data-r="4"][data-c="4"] .chess-p');
  console.log('▶ e2-e4 yansıması:', moved ? 'gönderende ✔' : 'gönderende ❌', '/', otherSeen ? 'rakipte ✔' : 'rakipte ❌');

  // Saatler hâlâ akıyor mu (iki tarafta da)
  const t1a = other.win.document.getElementById('t1').textContent;
  await sleep(1600);
  const t1b = other.win.document.getElementById('t1').textContent;
  console.log('▶ rakip saati akıyor mu?', t1a, '→', t1b, t1a !== t1b ? '✔' : '(aynı — tam saniye sınırı olabilir)');

  process.exit(0);
}
main().catch(e => { console.error('HATA:', e); process.exit(1); });
