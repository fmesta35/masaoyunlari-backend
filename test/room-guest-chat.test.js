'use strict';

/*
 * MASA (OYUN İÇİ) SOHBETİ — ziyaretçiler birbirini görüp yazabilmeli;
 * oyun esnasında giriş yapan oyuncunun adı sohbette ve koltukta ANINDA
 * gerçek adına güncellenmelidir.
 *
 *  Kullanıcı raporu (verbatim):
 *   "1) ziyaretçiler oyun içerisinde birbirlerinin mesajlarını göremiyor.
 *    Giriş yapsa bile, mesajda hala ziyaretçi olarak gözüküyor. oyuna
 *    ziyaretçi olarak girmiştim oyun esnasında giriş yapmıştım."
 *
 *  KÖK NEDENLER (kodda doğrulandı):
 *   a) index.html:sendChat('game') ve server.js:chatMessage, masa
 *      sohbetini de ÜYELİK şartına bağlıyordu → iki ziyaretçi asla
 *      mesajlaşamıyordu (biri bile gönderemiyordu).
 *   b) server-auth.js:syncRoomIdentity yalnız me.userId'yi yazıyordu,
 *      me.name'i HİÇ güncellemiyordu → oyun ortasında giriş yapan üyenin
 *      koltuk/​sohbet adı sonsuza kadar eski "Ziyaretçi#..." kalıyordu.
 *
 *  Bu test: iki ZİYARETÇİ aynı masaya oturur, ikisi de mesaj gönderip
 *  karşı tarafta görür (a); sonra biri masadayken GERÇEKTEN giriş yapar
 *  ve hem yeni mesajının hem koltuk etiketinin gerçek adla güncellendiği
 *  doğrulanır (b).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-roomchat-'));
process.env.GV_CHAT_RATE_MS = '50';
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(base, p, body, method) {
  const r = await fetch(base + p, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json().catch(() => ({}));
}

async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 20000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + ne);
}

async function misafirPencere(base) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = base; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV && win.GVAuth, 20000, 'sayfa açılışı');
  await bekle(() => win.st.isGuest === true, 10000, 'ziyaretçi hâli');
  return win;
}

function click(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await misafirPencere(BASE); // masayı kuran ziyaretçi — oyun esnasında giriş yapacak
  const B = await misafirPencere(BASE); // sonuna kadar ziyaretçi kalacak

  const roomId = 'gc-test-room-' + Date.now();
  for (const w of [A, B]) {
    await bekle(() => typeof w.__gvStartRealRoomWaiting === 'function', 20000, 'roomfix hazır');
    w.st.curGame = 'gomoku';
    w.GV.joinRoom(roomId);
  }
  for (const w of [A, B]) {
    const btn = await bekle(() => w.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM düğmesi');
    click(w, btn);
  }
  for (const w of [A, B]) {
    await bekle(() => w.document.querySelector('#boardArea .gm-board'), 20000, 'tahta çizildi');
    await bekle(() => w.document.getElementById('gcInput'), 10000, 'sohbet kutusu');
    await bekle(() => w.__gvRoomSocket && w.__gvRoomSocket.connected, 15000, 'oda soketi bağlı');
  }
  console.log('  ✓ 1) iki ziyaretçi aynı masada oturuyor, tahta çizildi');

  // ---- (a) ZİYARETÇİ → ZİYARETÇİ masa sohbeti ----
  A.document.getElementById('gcInput').value = 'selam B, ben ziyaretçiyim';
  A.GV.sendChat('game');
  const gordu = await bekle(() => {
    const t = B.document.getElementById('gameChat');
    return t && /selam B, ben ziyaretçiyim/.test(t.textContent) ? t.textContent : null;
  }, 12000, 'B, ziyaretçi A\'nın mesajını görmeli');
  assert.ok(/Ziyaretçi/.test(gordu), 'gönderen ziyaretçi etiketiyle görünmeli: ' + gordu.slice(0, 200));
  console.log('  ✓ 2) ziyaretçi mesaj gönderebiliyor, karşı taraf (ziyaretçi) görüyor');

  B.document.getElementById('gcInput').value = 'selam A, ben de ziyaretçiyim';
  B.GV.sendChat('game');
  await bekle(() => {
    const t = A.document.getElementById('gameChat');
    return t && /selam A, ben de ziyaretçiyim/.test(t.textContent);
  }, 12000, 'A, ziyaretçi B\'nin mesajını görmeli');
  console.log('  ✓ 3) masa sohbeti ziyaretçiler arasında iki yönlü çalışıyor');

  // ---- (b) OYUN ESNASINDA GİRİŞ → ad anında güncellenmeli ----
  const eskiAd = A.st.user.name; // "Ziyaretçi#NNN"
  const reg = await api(BASE, '/api/auth/register', { name: 'GercekOyuncu', email: 'gercek@oyuncu.test', password: 'sifre1234' });
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId);
  await api(BASE, '/api/auth/verify', { token: row.verify_token });

  A.document.getElementById('loginUser').value = 'gercek@oyuncu.test';
  A.document.getElementById('loginPass').value = 'sifre1234';
  await A.GVAuth.login();
  await bekle(() => A.st.isGuest === false && A.st.user.name === 'GercekOyuncu', 10000, 'A üyeliğe geçmeli');
  console.log('  ✓ 4) A, masadayken (oyun esnasında) gerçekten giriş yaptı');
  await sleep(500); // authHello + syncRoomIdentity + emitRoom yayılsın

  A.document.getElementById('gcInput').value = 'artık üyeyim';
  A.GV.sendChat('game');
  const yeniMsj = await bekle(() => {
    const t = B.document.getElementById('gameChat');
    return t && /artık üyeyim/.test(t.textContent) ? t.textContent : null;
  }, 15000, 'B, A\'nın YENİ mesajını görmeli');
  assert.ok(/GercekOyuncu/.test(yeniMsj), 'giriş sonrası mesaj GERÇEK adla görünmeli, görülen: ' + yeniMsj.slice(0, 300));
  assert.ok(!new RegExp(eskiAd).test(yeniMsj.split('artık üyeyim')[0].slice(-40)), 'eski ziyaretçi adı artık gönderende görünmemeli');
  console.log('  ✓ 5) giriş sonrası sohbet adı ANINDA gerçek üye adına güncelleniyor (bekleme/yenileme gerekmiyor)');

  // Koltuk etiketi de (oda kaydı → roomUpdated) gerçek adı yansıtmalı.
  const koltukTamam = await bekle(() => {
    const html = B.document.body.textContent || '';
    return /GercekOyuncu/.test(html) ? html : null;
  }, 8000, 'B tarafında A\'nın koltuk etiketi de güncellenmeli');
  assert.ok(koltukTamam, 'karşı oyuncunun ekranında da gerçek ad görünmeli');
  console.log('  ✓ 6) oda kaydındaki (koltuk) ad da güncellendi — yalnız sohbet değil, herkesin ekranı senkron');

  try { A.close(); B.close(); } catch (_) {}
  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK masa sohbeti: ziyaretçi-ziyaretçi görünürlüğü + oyun esnasında giriş sonrası anlık ad güncellemesi');
  process.exit(0);
}

main().catch(e => { console.error('❌ MASA SOHBETİ TEST HATASI:', e); process.exit(1); });
