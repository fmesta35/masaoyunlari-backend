'use strict';
/* KANIT: lokal oyun saati (startTimer/_updateTimerDisplay) online tavla
 * odasına sızarsa ne olur?  A önce LOKAL dama oynar (saati başlar), sonra
 * online tavla #201'e girer. Beklenen hata: t1/t2 iki yazıcı arasında
 * gidip gelir (titreme) ve lokal sayaç 0'a inince openLobby() → OYUNDAN ATMA.
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
    beforeParse(window) {
      window.GV_BACKEND_URL = BASE;
      window.fetch = (...a) => fetch(...a);
      window.confirm = () => true;
      window.alert = () => {};
    }
  });
  return { dom, win: dom.window, label };
}

async function main() {
  const A = await makeClient('A');
  const B = await makeClient('B');
  for (const c of [A, B]) {
    for (let i = 0; i < 200 && !(c.win.GV && c.win.st); i++) await sleep(100);
    for (let i = 0; i < 200 && typeof c.win.__gvStartRealRoomWaiting !== 'function'; i++) await sleep(100);
  }

  // --- A: önce LOKAL dama oyunu (simülasyon koltukları botla doldurur) ---
  A.win.st.curGame = 'dama';
  A.win.GV.joinRoom('7799');
  let localStarted = false;
  for (let i = 0; i < 600; i++) {
    const d = A.win.document;
    // Lokal bekleme ekranındaki HAZIRIM butonu (GV.toggleMeReady)
    const btns = [...d.querySelectorAll('#boardArea button')];
    const hazir = btns.find(b => /HAZIRIM/.test(b.textContent));
    if (hazir) hazir.click();
    const t1 = d.getElementById('t1')?.textContent;
    if (A.win.st.timers && t1 && t1 < '10:00') { localStarted = true; break; }
    await sleep(100);
  }
  console.log('▶ A lokal dama saati işliyor mu?', localStarted, '| st.timers =', JSON.stringify(A.win.st.timers && { t1: A.win.st.timers.t1, t2: A.win.st.timers.t2, player: A.win.st.timers.player }));
  if (!localStarted) { console.log('❌ Lokal oyun simüle edilemedi'); process.exit(1); }

  // Lokal saat 1-2 sn daha işlesin, sonra A ONLINE tavla odasına girsin.
  // (Sıradan kullanıcı davranışı: oyunu bırakıp başka oyuna geçmek)
  await sleep(2000);
  const t1Before = A.win.document.getElementById('t1')?.textContent;
  console.log('▶ A tavlaya girerken t1 =', t1Before);

  A.win.st.curGame = 'tavla';
  A.win.GV.joinRoom('201');
  B.win.st.curGame = 'tavla';
  B.win.GV.joinRoom('201');

  await sleep(900);
  for (const c of [A, B]) {
    for (let i = 0; i < 100; i++) {
      const btn = c.win.document.querySelector('#gv-real-chess-wait .gv-ready');
      if (btn) { btn.click(); console.log(`✔ ${c.label} HAZIRIM`); break; }
      await sleep(100);
    }
  }

  // Oyun durumu + örnekleme
  await sleep(1500);
  const room = await fetch(BASE + '/api/rooms?gameId=tavla').then(r => r.json()).then(j => j.rooms.find(r => String(r.id) === '201'));
  console.log('▶ #201:', JSON.stringify(room && { status: room.status, players: room.players }));

  const flips = [];
  const t0 = Date.now();
  let prev = {};
  let kicked = null;
  while (Date.now() - t0 < 22000) {
    for (const c of [A, B]) {
      const d = c.win.document;
      const t1 = d.getElementById('t1')?.textContent;
      const t2 = d.getElementById('t2')?.textContent;
      const cur = t1 + '|' + t2;
      if (prev[c.label] && prev[c.label] !== cur) {
        flips.push({ t: Date.now() - t0, who: c.label, from: prev[c.label], to: cur, page: d.querySelector('.page.active')?.id });
      }
      prev[c.label] = cur;
      // Atılma tespiti: oda sayfasından lobiye düşme
      if (!kicked && d.querySelector('.page.active')?.id !== 'pg-room') {
        kicked = { who: c.label, t: Date.now() - t0, page: d.querySelector('.page.active')?.id };
      }
    }
    await sleep(90);
  }

  console.log('\n===== Sayaç geçişleri =====');
  flips.forEach(f => console.log(`[+${f.t}ms] ${f.who}: ${f.from} → ${f.to}`));
  // Salınım analizi: aynı istemcide değer düştükten sonra tekrar YÜKSELİYORSA / iki kaynak arasında gidip geliyorsa
  const byA = flips.filter(f => f.who === 'A').map(f => f.to);
  const uniqueA = [...new Set(byA)];
  console.log('\nA benzersiz değerler:', uniqueA.slice(0, 30));
  const oscill = byA.length > 8 && uniqueA.length < byA.length - 4;
  console.log('▶ TİTREME/SALINIM belirtisi (A):', oscill ? 'VAR ❌' : 'yok ✔');
  console.log('▶ OYUNDAN ATILMA:', kicked ? `VAR ❌ (${kicked.who}, +${kicked.t}ms, sayfa=${kicked.page})` : 'yok ✔');
  process.exit(0);
}
main().catch(e => { console.error('HATA:', e); process.exit(1); });
