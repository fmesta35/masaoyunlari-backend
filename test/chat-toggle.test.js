'use strict';
/*
 * SOHBET AÇ/KAPA ANAHTARI (kullanıcı isteği, verbatim):
 *  "kullanıcılar oyun içerisinde birbirlerinin mesajlarını görmek istemez
 *   ise, Sohbet Açık (yeşil renk tonunda gözüksün) yanında switch
 *   özellikli Aç kapa düğmeli olsun. Kapattığında, kapatan kullanıcı
 *   sohbeti görmez, Kırmızı beyaz renk tonlarında Sohbet Kapalı yazar."
 *
 * Doğrulananlar:
 *  1) Anahtar masa sohbeti başlığında; varsayılan AÇIK + yeşil + "Sohbet Açık".
 *  2) Kapatınca: kırmızı/beyaz "Sohbet Kapalı", mesaj listesi ve yazma
 *     satırı gizlenir, yerine "Sohbet Kapalı" bilgisi gelir.
 *  3) KAPALIYKEN gelen masa mesajı kullanıcıya ÇİZİLMEZ (asıl istek).
 *  4) Tekrar açınca anahtar yeşile döner ve akış yeniden görünür.
 *  5) Tercih localStorage'da saklanır (sayfa yenilense de korunur).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-chattoggle-'));

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
  await bekle(() => win.st && win.GV, 20000, 'sayfa açılışı');
  return win;
}

// chat.js'in bağlanacağı sahte oda soketi: 'chatMessage' işleyicisini
// yakalar ki testte sunucu olmadan mesaj düşürebilelim.
function sahteSoket(win, roomId) {
  const handlers = {};
  const sock = {
    connected: true,
    on(ev, fn) { handlers[ev] = fn; },
    off() {},
    emit(ev, _p, cb) { if (typeof cb === 'function') cb({ ok: true, messages: [] }); },
    __handlers: handlers
  };
  win.__gvRoomSocket = sock;
  win.__gvActiveRoomId = roomId;
  try { win.localStorage.setItem('gv-room-id', roomId); } catch (_) {}
  // chat.js masa moduna yalnız ODA SAYFASINDAyken geçer (isRoomPage()).
  win.st.curPage = 'room';
  const pg = win.document.getElementById('pg-room');
  if (pg) pg.classList.add('active');
  return sock;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const win = await pencere(BASE);
  const $ = sel => win.document.querySelector(sel);

  // ---- 1) anahtar var, varsayılan AÇIK ----
  const btn = await bekle(() => $('#gvChatToggle'), 10000, 'sohbet anahtarı');
  assert.ok(btn.classList.contains('on'), 'varsayılan AÇIK olmalı');
  assert.strictEqual(btn.getAttribute('aria-checked'), 'true');
  assert.strictEqual($('#gvChatToggle .chat-switch-txt').textContent.trim(), 'Sohbet Açık');
  assert.ok($('#gvChatOff').hidden, 'açıkken "Sohbet Kapalı" bilgisi gizli');
  assert.ok(!$('#gameChat').hidden, 'açıkken mesaj listesi görünür');
  console.log('  ✓ 1) anahtar başlıkta, varsayılan "Sohbet Açık" (yeşil)');

  // Sahte oda soketi + chat.js'in onu bağlaması için bir tur bekle.
  const sock = sahteSoket(win, '1001');
  await bekle(() => sock.__handlers.chatMessage, 8000, 'chat.js soketi bağlaması');

  // ---- 2) kapatınca görünüm değişir ----
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await bekle(() => btn.classList.contains('off'), 4000, 'kapalı duruma geçiş');
  assert.strictEqual($('#gvChatToggle .chat-switch-txt').textContent.trim(), 'Sohbet Kapalı');
  assert.strictEqual(btn.getAttribute('aria-checked'), 'false');
  assert.ok($('#gameChat').hidden, 'kapalıyken mesaj listesi gizli');
  assert.ok(!$('#gvChatOff').hidden, 'kapalıyken "Sohbet Kapalı" bilgisi görünür');
  assert.ok($('#gvChatInputRow').hidden, 'kapalıyken yazma satırı gizli');
  console.log('  ✓ 2) kapatınca kırmızı/beyaz "Sohbet Kapalı" + liste ve yazma satırı gizlenir');

  // ---- 3) ASIL İSTEK: kapalıyken gelen mesaj ÇİZİLMEZ ----
  sock.__handlers.chatMessage({
    id: 'm1', scope: 'room', roomId: '1001', name: 'Rakip', text: 'gizli-kalmali-1', ts: Date.now()
  });
  await sleep(200);
  assert.ok(!$('#gameChat').innerHTML.includes('gizli-kalmali-1'),
    'sohbet kapalıyken gelen masa mesajı kullanıcıya gösterilmemeli');
  console.log('  ✓ 3) kapalıyken gelen masa mesajı hiç çizilmiyor');

  // ---- 4) tekrar açınca akış geri gelir ----
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await bekle(() => btn.classList.contains('on'), 4000, 'açık duruma dönüş');
  assert.ok(!$('#gameChat').hidden, 'açınca liste geri gelir');
  assert.ok($('#gvChatOff').hidden);
  sock.__handlers.chatMessage({
    id: 'm2', scope: 'room', roomId: '1001', name: 'Rakip', text: 'gorunur-mesaj-2', ts: Date.now()
  });
  await bekle(() => $('#gameChat').innerHTML.includes('gorunur-mesaj-2'), 4000, 'açıkken mesajın görünmesi');
  console.log('  ✓ 4) tekrar açınca "Sohbet Açık" ve mesajlar yeniden görünüyor');

  // ---- 5) tercih kalıcı ----
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await bekle(() => btn.classList.contains('off'), 4000, 'kapanış');
  assert.strictEqual(win.localStorage.getItem('gv-chat-muted'), '1', 'kapalı tercihi saklanmalı');
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await bekle(() => btn.classList.contains('on'), 4000, 'açılış');
  assert.strictEqual(win.localStorage.getItem('gv-chat-muted'), '0', 'açık tercihi saklanmalı');
  console.log('  ✓ 5) tercih localStorage\'da saklanıyor (sayfa yenilense de korunur)');

  win.close();
  server.close();
  console.log('OK sohbet aç/kapa: anahtar + kapalıyken mesaj gizleme + kalıcı tercih');
}
main().catch(e => { console.error(e); process.exit(1); });
