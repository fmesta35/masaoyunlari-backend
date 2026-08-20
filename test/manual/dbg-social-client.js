'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-dbg-'));
process.env.GV_DATA_DIR = TMP;
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../../server.js');

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

(async () => {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const reg = await api(BASE, '/api/auth/register', { name: 'Kral', email: 'k@t.com', password: 'ortaksifre9' });
  const { db } = require('../../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
  await api(BASE, '/api/auth/verify', { token: vt });
  const reg2 = await api(BASE, '/api/auth/register', { name: 'Dost', email: 'd@t.com', password: 'ortaksifre9' });
  const vt2 = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg2.userId).verify_token;
  await api(BASE, '/api/auth/verify', { token: vt2 });
  const log = await api(BASE, '/api/auth/login', { email: 'k@t.com', password: 'ortaksifre9' });
  const log2 = await api(BASE, '/api/auth/login', { email: 'd@t.com', password: 'ortaksifre9' });
  await api(BASE, '/api/friends/add', { friendId: log2.user.id }, 'POST', log.token);

  const vc = new VirtualConsole();
  ['error', 'jsdomError', 'warn'].forEach(ev => vc.on(ev, e => console.log('[VC-' + ev + ']', e && e.message ? e.message : e)));
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE;
      w.fetch = (...a) => fetch(...a).then(r => { console.log('[FETCH]', a[0], '->', r.status); return r; });
      w.confirm = () => true;
      try { w.localStorage.setItem('gv-auth-token', log.token); } catch (e) { console.log('LS ERR', e); }
    }
  });
  const win = dom.window;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const el = win.document.getElementById('friendsList');
    if (el && /Dost/.test(el.innerHTML)) { console.log('OK - Dost listede'); break; }
  }
  console.log('--- state ---');
  console.log('isGuest:', win.st && win.st.isGuest, 'user:', JSON.stringify(win.st && win.st.user));
  console.log('GVAuth:', !!win.GVAuth, 'GVSocial:', !!win.GVSocial);
  console.log('renderFriends src kısa:', String(win.renderFriends).slice(0, 100));
  // doğrudan tetikle — zincir sağlam mı?
  try {
    const rr = await win.eval(`(async () => { const r = await GVSocial.refreshFriends(); return JSON.stringify(r); })()`);
    console.log('refreshFriends sonucu:', rr);
  } catch (e) { console.log('refreshFriends HATA:', e.message); }
  try {
    await win.eval(`(async () => { GVSocial._test.renderFriendsMember(''); })()`);
  } catch (e) { console.log('renderFriendsMember HATA:', e.message); }
  await new Promise(r => setTimeout(r, 1500));
  const el = win.document.getElementById('friendsList');
  console.log('friendsList HTML:', el ? el.innerHTML.slice(0, 400) : 'YOK');
  win.close(); serverModule.io.close(); server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
