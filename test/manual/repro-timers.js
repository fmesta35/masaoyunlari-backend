'use strict';
/* Manuel üretim simülasyonu — GERÇEK index.html + GERÇEK server.js.
 * İki tarayıcı (jsdom) tavla masasına girer, HAZIRIM basar, oyun oynanırken
 * sayaç DOM'u 100 ms'de bir örneklene­rek titreme/sıfırlanma aranır.
 * Kullanım: node test/manual/repro-timers.js [saniye]
 */
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://localhost:3100';
const RUN_SECONDS = Number(process.argv[2] || 20);

const pageErrors = [];
const timerLog = []; // {t, who, t1, t2, name1, name2}
const boardLog = [];

async function makeClient(label) {
  const vc = new VirtualConsole();
  const logs = [];
  vc.on('log', (...a) => logs.push(['log', ...a]));
  vc.on('warn', (...a) => logs.push(['warn', ...a]));
  vc.on('error', (...a) => logs.push(['error', ...a]));
  vc.on('jsdomError', e => pageErrors.push(`${label}: ${e && (e.stack || e.message || e)}`));

  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.GV_BACKEND_URL = BASE;
      window.fetch = (...a) => fetch(...a);
      window.__label = label;
    }
  });
  return { dom, win: dom.window, label, logs };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('▶ İki istemci açılıyor...');
  const A = await makeClient('A');
  const B = await makeClient('B');

  // Site boot bekle
  for (const c of [A, B]) {
    let ok = false;
    for (let i = 0; i < 200; i++) {
      if (c.win.GV && c.win.st && c.win.document.getElementById('boardArea')) { ok = true; break; }
      await sleep(100);
    }
    if (!ok) throw new Error(c.label + ': site açılmadı');
  }
  console.log('✔ Site boot tamam. st/rTavla/dTavla:',
    ['st', 'rTavla', 'dTavla'].map(k => `${k}=${typeof A.win[k]}`).join(' '));

  // İkisi de tavla lobisine → 201 masasına katıl
  for (const [c, name] of [[A, 'Oyuncu-A'], [B, 'Oyuncu-B']]) {
    // Köprü (room-waiting-fix.js) yüklene­ne dek bekle — yoksa uyarı basıp sessiz kalır
    let bridge = false;
    for (let i = 0; i < 200; i++) {
      if (typeof c.win.__gvStartRealRoomWaiting === 'function') { bridge = true; break; }
      await sleep(100);
    }
    if (!bridge) console.log(`⚠ ${c.label}: köprü 20 sn içinde yüklenemedi!`);
    c.win.st.user = { name };
    c.win.st.curGame = 'tavla';
    c.win.GV.joinRoom('201');
  }
  console.log('▶ Odaya katılım gönderildi, bekleme odası bekleniyor...');

  const waitOverlay = async c => {
    for (let i = 0; i < 150; i++) {
      const b = c.win.document.querySelector('#gv-real-chess-wait .gv-ready');
      if (b) return b;
      const playing = await fetch(BASE + '/api/rooms?gameId=tavla').then(r => r.json()).then(j => j.rooms.find(r => String(r.id) === '201'));
      if (playing && playing.status === 'playing') return null; // geç kaldıysak
      await sleep(100);
    }
    return null;
  };

  await sleep(800);
  for (const c of [A, B]) {
    const btn = await waitOverlay(c);
    if (btn) { btn.click(); console.log(`✔ ${c.label}: HAZIRIM basıldı`); }
    else console.log(`⚠ ${c.label}: HAZIRIM butonu bulunamadı (oyun çoktan başlamış olabilir)`);
  }

  // Oyun başladı mı?
  const started = await fetch(BASE + '/api/rooms?gameId=tavla').then(r => r.json()).then(j => j.rooms.find(r => String(r.id) === '201'));
  console.log('▶ Masa #201 durumu:', JSON.stringify({ status: started.status, players: started.players, spectators: started.spectatorCount }));

  // Örnekleme: 100 ms'de bir sayaçlar + tahta varlığı
  const t0 = Date.now();
  let lastA = '', lastB = '';
  while (Date.now() - t0 < RUN_SECONDS * 1000) {
    for (const c of [A, B]) {
      const d = c.win.document;
      const t1 = d.getElementById('t1')?.textContent ?? '?';
      const t2 = d.getElementById('t2')?.textContent ?? '?';
      const n1 = d.querySelector('#topTimers .timer-name')?.textContent ?? '?';
      const n2 = d.querySelectorAll('#topTimers .timer-name')[1]?.textContent ?? '?';
      const board = !!d.querySelector('#boardArea .tavla-board');
      const prev = c.label === 'A' ? lastA : lastB;
      const cur = `${t1}|${t2}|${n1}|${n2}`;
      if (cur !== prev) {
        timerLog.push({ t: Date.now() - t0, who: c.label, t1, t2, n1, n2, board });
        if (c.label === 'A') lastA = cur; else lastB = cur;
      }
      if (!board && c.win.__gvTavlaOnlineLoaded) {
        boardLog.push({ t: Date.now() - t0, who: c.label, note: 'tavla-board YOK', areaLen: d.getElementById('boardArea')?.innerHTML.length });
      }
    }
    await sleep(100);
  }

  console.log('\n===== SAYAÇ DEĞİŞİM GÜNLÜĞÜ (değişim anları) =====');
  for (const e of timerLog) {
    console.log(`[+${String(e.t).padStart(5)}ms] ${e.who} t1=${e.t1} t2=${e.t2} | ${e.n1} / ${e.n2} | tahta=${e.board ? 'VAR' : 'YOK'}`);
  }
  const missing = boardLog.length;
  console.log(`\n▶ Tahta yokluğu örnek sayısı: ${missing}`);
  if (boardLog.length) console.log('  İlk örnekler:', boardLog.slice(0, 5));

  console.log('\n===== Sayfa hataları =====');
  console.log(pageErrors.length ? pageErrors.join('\n') : '(yok)');
  console.log('\n===== A konsolu (son 20) =====');
  console.log(A.logs.slice(-20).map(l => l.join(' ')).join('\n') || '(boş)');
  console.log('\n===== B konsolu (son 20) =====');
  console.log(B.logs.slice(-20).map(l => l.join(' ')).join('\n') || '(boş)');

  const stA = await fetch(BASE + '/api/rooms?gameId=tavla').then(r => r.json()).then(j => j.rooms.find(r => String(r.id) === '201'));
  console.log('\n▶ Son masa durumu:', JSON.stringify(stA && { status: stA.status, players: stA.players }));
  process.exit(0);
}

main().catch(err => { console.error('REPRO HATASI:', err); process.exit(1); });
