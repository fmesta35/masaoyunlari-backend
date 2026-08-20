'use strict';
/* DEBUG: okey oda akışı — jsdom hatalarını ve online modül durumunu döker. */
process.env.GV_POST_GAME_HOLD_MS = '400';
process.env.GV_OKEY_TURN_MS = '1500';
process.env.GV_OKEY_ROUND_PAUSE_MS = '400';

const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../../server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function makeClient(label) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => console.log(`[${label} jsdomError]`, e.detail?.message || e.message, e.detail?.stack?.split('\n')[1] || ''));
  vc.on('error', (...a) => console.log(`[${label} console.error]`, ...a));
  vc.on('warn', (...a) => console.log(`[${label} warn]`, ...a));
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE;
      w.fetch = (...a) => fetch(...a);
      w.confirm = () => true;
    }
  });
  return { dom, win: dom.window, label };
}

async function main() {
  const server = await serverModule.start(0);
  BASE = `http://localhost:${server.address().port}`;
  const A = await makeClient('A');
  const B = await makeClient('B');
  const C = await makeClient('C');
  const D = await makeClient('D');
  for (const c of [A, B, C, D]) {
    for (let i = 0; i < 200 && !(c.win.GV && c.win.st); i++) await sleep(100);
    for (let i = 0; i < 200 && typeof c.win.__gvStartRealRoomWaiting !== 'function'; i++) await sleep(100);
    console.log(c.label, 'okey-online loaded:', !!c.win.__gvOkeyOnlineLoaded);
    c.win.st.curGame = 'okey';
    c.win.GV.joinRoom('301');
  }
  await sleep(1500);
  for (const c of [A, B, C, D]) {
    for (let i = 0; i < 80; i++) {
      const btn = c.win.document.querySelector('#gv-real-chess-wait .gv-ready');
      if (btn) { btn.click(); break; }
      await sleep(100);
    }
  }
  await sleep(3000);
  for (const c of [A, B, C, D]) {
    const hasTable = !!c.win.document.querySelector('#boardArea .okey-table');
    const boardLen = c.win.document.getElementById('boardArea')?.innerHTML.length;
    console.log(c.label, 'table:', hasTable, 'boardLen:', boardLen,
      'overlayGone:', !c.win.document.getElementById('gv-real-chess-wait'),
      'st.boards.okey:', !!c.win.st?.boards?.okey,
      'roomSock:', !!c.win.__gvRoomSocket, 'sockConnected:', !!c.win.__gvRoomSocket?.connected);
    if (!hasTable) {
      console.log(c.label, 'boardArea (ilk 240):', (c.win.document.getElementById('boardArea')?.innerHTML || '').slice(0, 240));
    }
  }
  process.exit(0);
}
main().catch(e => { console.error('REPRO HATA:', e); process.exit(1); });
