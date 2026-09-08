'use strict';

/*
 * GENEL SOHBET — yazma, Enter ile gönderme ve kullanıcılar arası görünürlük
 *
 *  Kullanıcı raporu: "webde mesaj yazılamıyor veya gönderilemiyor;
 *  farklı kullanıcılar birbirinin mesajlarını görmeli."
 *
 *  KÖK NEDEN: chat.js hazır bir sokete bağlanıyordu (pickSocket) ama o
 *  soket YALNIZCA bir oyun lobisi açıldığında kuruluyor. Ana sayfadan
 *  sohbeti açan kullanıcı için soket hiç yoktu: gönderme "Bağlantı yok"
 *  uyarısıyla düşüyor, gelen mesajlar da hiç ulaşmıyordu — sohbet boş
 *  görünüyordu. Sohbet artık soketi gerektiğinde kendisi kurar.
 *
 *  Bu test iki AYRI üye penceresi açar, hiçbir lobiye girmeden ana
 *  sayfada sohbeti kullanır ve mesajın karşı tarafa ulaştığını doğrular.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-chat-'));
process.env.GV_CHAT_RATE_MS = '200';   // testte 5 sn beklemeyelim

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return r.json().catch(() => ({}));
}
async function uye(base, ad, mail) {
  const reg = await api(base, '/api/auth/register', { name: ad, email: mail, password: 'ortaksifre9' });
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId);
  await api(base, '/api/auth/verify', { token: row.verify_token });
  const log = await api(base, '/api/auth/login', { email: mail, password: 'ortaksifre9' });
  return { id: log.user.id, name: log.user.name, token: log.token };
}
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 20000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('zaman aşımı: ' + ne);
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await uye(BASE, 'Ali', 'ali@sohbet.test');
  const B = await uye(BASE, 'Veli', 'veli@sohbet.test');

  async function pencere(u) {
    const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
    const dom = await JSDOM.fromURL(BASE + '/index.html', {
      resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) {
        w.GV_BACKEND_URL = BASE;
        w.fetch = (...a) => fetch(...a);
        try { w.localStorage.setItem('gv-auth-token', u.token); } catch (_) {}
      }
    });
    const win = dom.window;
    await bekle(() => win.st && win.GV, 20000, 'sayfa açılışı');
    await bekle(() => win.st.isGuest === false && win.st.user && win.st.user.name === u.name, 20000, u.name + ' girişi');
    return win;
  }

  const wA = await pencere(A), wB = await pencere(B);

  // Hiçbir lobiye GİRİLMEDİ: eski kodda burada soket yoktu.
  assert.ok(!wA.document.querySelector('#pg-lobby.active'), 'ana sayfada olmalıyız');

  // Sohbet baloncuğu üyeye görünür; panel açılır.
  const fab = await bekle(() => wA.document.getElementById('gvChatFab'), 12000, 'sohbet baloncuğu');
  assert.notStrictEqual(fab.style.display, 'none', 'üyeye sohbet baloncuğu görünmeli');
  fab.dispatchEvent(new wA.MouseEvent('click', { bubbles: true }));
  const fabB = await bekle(() => wB.document.getElementById('gvChatFab'), 12000, 'B sohbet baloncuğu');
  fabB.dispatchEvent(new wB.MouseEvent('click', { bubbles: true }));

  // Soket sohbet tarafından kendiliğinden kurulmuş olmalı.
  await bekle(() => wA.__gvLobbySocket && wA.__gvLobbySocket.connected, 15000, 'A soketi kendi kurmalı');
  await bekle(() => wB.__gvLobbySocket && wB.__gvLobbySocket.connected, 15000, 'B soketi kendi kurmalı');
  console.log('  ✓ 1) sohbet, oyun lobisine hiç girilmeden kendi bağlantısını kuruyor');

  // A yazar ve ENTER'a basar (düğmeye değil).
  const inp = await bekle(() => wA.document.getElementById('gvChatText'), 10000, 'sohbet kutusu');
  inp.value = 'merhaba selam';
  inp.dispatchEvent(new wA.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await bekle(() => inp.value === '', 8000, 'Enter mesajı göndermeli (kutu temizlenir)');
  console.log('  ✓ 2) Enter tuşu mesajı gönderiyor');

  // B, A'nın mesajını görmeli.
  const gelen = await bekle(() => {
    const t = wB.document.getElementById('gvChatList');
    return t && /merhaba selam/.test(t.textContent) ? t.textContent : null;
  }, 15000, 'B, A\'nın mesajını görmeli');
  assert.ok(/Ali/.test(gelen), 'gönderenin adı görünmeli, görülen: ' + gelen.slice(0, 200));
  console.log('  ✓ 3) farklı kullanıcılar birbirinin genel sohbet mesajlarını görüyor');

  // Ters yön: B yazar, A görür.
  await sleep(400);
  const inpB = wB.document.getElementById('gvChatText');
  inpB.value = 'aleykum selam';
  inpB.dispatchEvent(new wB.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await bekle(() => {
    const t = wA.document.getElementById('gvChatList');
    return t && /aleykum selam/.test(t.textContent);
  }, 15000, 'A, B\'nin mesajını görmeli');
  console.log('  ✓ 4) sohbet iki yönlü çalışıyor');

  try { wA.close(); wB.close(); } catch (_) {}
  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK genel sohbet: bağlantı, Enter ile gönderim, kullanıcılar arası görünürlük');
  process.exit(0);
}

main().catch(e => { console.error('❌ SOHBET TEST HATASI:', e); process.exit(1); });
