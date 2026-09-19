'use strict';

/*
 * MASA SOHBETİ ↔ GENEL SOHBET: İKİ KANAL TAMAMEN AYRI OLMALI
 *
 *  Kullanıcı raporu (verbatim):
 *   "Masa / oyun içi sohbeti ile genel sohbetler tamamen ayrı şeyler.
 *    birbirinden bağımsız ilerlet. Sohbetler aynı gösteriyor."
 *
 *  ESKİ HATA: js/chat.js tek bir `mode` değişkeni kullanıyordu; oyuncu
 *  masaya oturunca ÇEKMECE de 'room' moduna geçiyordu. Sonuç: masa
 *  mesajları hem masadaki gömülü kutuda (#gameChat) hem de mesaj
 *  balonundaki çekmecede (#gvChatList) görünüyordu — iki arayüz AYNI
 *  sohbeti gösteriyor, masadayken genel sohbete hiç erişilemiyordu
 *  (çekmecenin başlığı bile "… Masa Sohbeti #201" oluyordu).
 *
 *  DOĞRU DAVRANIŞ (bu test):
 *   1) Masadayken çekmecenin başlığı HER ZAMAN "🌐 Genel Sohbet".
 *   2) MASA mesajı yalnız #gameChat'e düşer, çekmeceye ASLA düşmez.
 *   3) GENEL mesaj yalnız çekmeceye düşer, #gameChat'e ASLA düşmez.
 *   4) Masadayken çekmeceden yazılan mesaj scope:'global' gider
 *      (masa kanalına sızmaz).
 *   5) Masa sohbeti anahtarı kapatılsa bile genel sohbet akmaya devam eder.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-chatsep-'));

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

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) { headers.Authorization = 'Bearer ' + token; headers['X-GV-Token'] = token; }
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function pencere(base, token) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = base; w.fetch = (...a) => fetch(...a); w.confirm = () => true;
      if (token) { try { w.localStorage.setItem('gv-auth-token', token); } catch (_) {} }
    }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV, 20000, 'sayfa açılışı');
  return win;
}

// chat.js'in bağlanacağı sahte soket: gönderilen mesajları kaydeder,
// gelen mesajları elle düşürebilmek için işleyicileri yakalar.
function sahteSoket() {
  const handlers = {};
  return {
    connected: true,
    gonderilen: [],
    on(ev, fn) { handlers[ev] = fn; },
    off() {},
    emit(ev, p, cb) {
      this.gonderilen.push({ ev, p });
      if (typeof cb === 'function') cb({ ok: true, messages: [] });
    },
    __handlers: handlers
  };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // Çekmece (genel sohbet) yalnız ÜYELERE açıktır → üye girişi şart.
  const reg = await api(BASE, '/api/auth/register', { name: 'KanalUye', email: 'kanal@kanal.test', password: 'gucluSifre123' }, 'POST');
  assert.ok(reg.ok, 'üye kaydı: ' + JSON.stringify(reg));
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
  await api(BASE, '/api/auth/verify', { token: vt }, 'POST');
  const giris = await api(BASE, '/api/auth/login', { email: 'kanal@kanal.test', password: 'gucluSifre123' }, 'POST');
  assert.ok(giris.ok && giris.token, 'üye girişi');

  const win = await pencere(BASE, giris.token);
  const $ = s => win.document.querySelector(s);
  await bekle(() => win.st.user && !win.st.isGuest, 20000, 'üye olarak tanınmalı');

  // --- Oyuncuyu bir MASAYA oturt (oda sayfası + oda soketi) ---
  const odaSock = sahteSoket();
  const lobiSock = sahteSoket();
  win.__gvRoomSocket = odaSock;
  win.__gvLobbySocket = lobiSock;
  win.__gvActiveRoomId = '201';
  try { win.localStorage.setItem('gv-room-id', '201'); } catch (_) {}
  win.st.curPage = 'room';
  const pg = win.document.getElementById('pg-room');
  if (pg) pg.classList.add('active');

  await bekle(() => odaSock.__handlers.chatMessage && lobiSock.__handlers.chatMessage, 10000,
    'chat.js HER İKİ sokete de (oda + lobi) dinleyici bağlamalı');
  console.log('  ✓ 0) masaya oturuldu; hem oda hem lobi soketi dinleniyor');

  // --- 1) Çekmece başlığı masadayken bile GENEL SOHBET ---
  const fab = await bekle(() => win.document.getElementById('gvChatFab'), 10000, 'sohbet balonu');
  fab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await bekle(() => win.document.getElementById('gvChatPanel').classList.contains('open'), 5000, 'çekmece açılsın');
  const baslik = await bekle(() => {
    const t = win.document.getElementById('gvChatTitle');
    return t && t.textContent.includes('Genel Sohbet') ? t.textContent : null;
  }, 5000, 'başlık "Genel Sohbet" olmalı (masadayken bile)');
  assert.ok(!/Masa Sohbeti/i.test(baslik),
    'MASADAYKEN çekmece başlığı masa sohbetine dönMEmeli — bulunan: ' + baslik);
  console.log('  ✓ 1) masadayken bile çekmece başlığı "' + baslik.trim() + '"');

  // --- 2) MASA mesajı: yalnız #gameChat, çekmeceye ASLA ---
  odaSock.__handlers.chatMessage({
    id: 'r1', scope: 'room', roomId: '201', name: 'Rakip', text: 'MASA-MESAJI-XYZ', ts: Date.now()
  });
  await bekle(() => ($('#gameChat').innerHTML || '').includes('MASA-MESAJI-XYZ'), 5000,
    'masa mesajı masadaki gömülü kutuya düşmeli');
  await sleep(250);
  assert.ok(!($('#gvChatList').innerHTML || '').includes('MASA-MESAJI-XYZ'),
    'ASIL HATA: masa mesajı GENEL sohbet çekmecesinde GÖRÜNMEMELİ (iki kanal ayrıdır)');
  console.log('  ✓ 2) masa mesajı yalnız masadaki kutuda — çekmeceye sızmıyor');

  // --- 3) GENEL mesaj: yalnız çekmece, #gameChat'e ASLA ---
  lobiSock.__handlers.chatMessage({
    id: 'g1', scope: 'global', name: 'Biri', text: 'GENEL-MESAJI-ABC', ts: Date.now()
  });
  await bekle(() => ($('#gvChatList').innerHTML || '').includes('GENEL-MESAJI-ABC'), 5000,
    'genel mesaj çekmeceye düşmeli (masadayken bile)');
  await sleep(250);
  assert.ok(!($('#gameChat').innerHTML || '').includes('GENEL-MESAJI-ABC'),
    'genel sohbet mesajı MASA kutusunda GÖRÜNMEMELİ (iki kanal ayrıdır)');
  console.log('  ✓ 3) genel mesaj yalnız çekmecede — masa kutusuna sızmıyor');

  // --- 4) Masadayken çekmeceden yazılan mesaj GENEL kanala gider ---
  odaSock.gonderilen.length = 0; lobiSock.gonderilen.length = 0;
  const inp = $('#gvChatText');
  inp.value = 'cekmeceden-yazildi';
  $('#gvChatSend').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  const gonderim = await bekle(() => {
    const hepsi = [...odaSock.gonderilen, ...lobiSock.gonderilen].filter(g => g.ev === 'chatMessage');
    return hepsi.length ? hepsi[hepsi.length - 1] : null;
  }, 5000, 'çekmeceden mesaj gönderilmeli');
  assert.strictEqual(gonderim.p.scope, 'global',
    'MASADAYKEN çekmeceden yazılan mesaj GENEL sohbete gitmeli (scope:global) — bulunan: ' + gonderim.p.scope);
  console.log('  ✓ 4) masadayken çekmeceden yazılan mesaj genel sohbete gidiyor (scope=global)');

  // --- 5) Masa sohbeti KAPATILSA bile genel sohbet akmaya devam eder ---
  const anahtar = await bekle(() => win.document.getElementById('gvChatToggle'), 8000, 'masa sohbeti anahtarı');
  await bekle(() => anahtar.__gvBagli, 8000, 'anahtar dinleyicisi bağlanmalı');
  anahtar.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await bekle(() => anahtar.classList.contains('off'), 5000, 'masa sohbeti kapansın');

  lobiSock.__handlers.chatMessage({
    id: 'g2', scope: 'global', name: 'Biri', text: 'KAPALIYKEN-GENEL-AKAR', ts: Date.now()
  });
  await bekle(() => ($('#gvChatList').innerHTML || '').includes('KAPALIYKEN-GENEL-AKAR'), 5000,
    'masa sohbeti KAPALIYKEN bile genel sohbet akmalı');
  assert.ok(!$('#gvChatText').disabled, 'masa sohbeti kapalıyken genel sohbet yazma kutusu açık kalmalı');

  odaSock.__handlers.chatMessage({
    id: 'r2', scope: 'room', roomId: '201', name: 'Rakip', text: 'KAPALIYKEN-MASA-GIZLI', ts: Date.now()
  });
  await sleep(250);
  assert.ok(!($('#gameChat').innerHTML || '').includes('KAPALIYKEN-MASA-GIZLI'),
    'masa sohbeti kapalıyken masa mesajı çizilmemeli');
  assert.ok(!($('#gvChatList').innerHTML || '').includes('KAPALIYKEN-MASA-GIZLI'),
    'masa mesajı hiçbir koşulda çekmeceye düşmemeli');
  console.log('  ✓ 5) masa sohbeti kapalıyken genel sohbet etkilenmiyor, masa mesajı da sızmıyor');

  win.close();
  server.close();
  console.log('OK sohbet kanalları: masa sohbeti ile genel sohbet tamamen bağımsız');
  process.exit(0);
}

main().catch(err => { console.error('❌ SOHBET KANAL AYRIMI HATASI:', err); process.exit(1); });
