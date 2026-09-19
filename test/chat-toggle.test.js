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
  assert.strictEqual($('#gvChatToggle .chat-switch-txt').textContent.trim(), 'Masa Sohbeti Açık');
  assert.ok($('#gvChatOff').hidden, 'açıkken "Masa Sohbeti Kapalı" bilgisi gizli');
  assert.ok(!$('#gameChat').hidden, 'açıkken mesaj listesi görünür');
  console.log('  ✓ 1) anahtar başlıkta, varsayılan "Masa Sohbeti Açık" (yeşil)');

  // Sahte oda soketi + chat.js'in onu bağlaması için bir tur bekle.
  const sock = sahteSoket(win, '1001');
  await bekle(() => sock.__handlers.chatMessage, 8000, 'chat.js soketi bağlaması');

  // ---- 2) kapatınca görünüm değişir ----
  btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await bekle(() => btn.classList.contains('off'), 4000, 'kapalı duruma geçiş');
  assert.strictEqual($('#gvChatToggle .chat-switch-txt').textContent.trim(), 'Masa Sohbeti Kapalı');
  assert.strictEqual(btn.getAttribute('aria-checked'), 'false');
  assert.ok($('#gameChat').hidden, 'kapalıyken mesaj listesi gizli');
  assert.ok(!$('#gvChatOff').hidden, 'kapalıyken "Masa Sohbeti Kapalı" bilgisi görünür');
  assert.ok($('#gvChatInputRow').hidden, 'kapalıyken yazma satırı gizli');
  console.log('  ✓ 2) kapatınca kırmızı/beyaz "Masa Sohbeti Kapalı" + liste ve yazma satırı gizlenir');

  // ---- 2b) REGRESYON (kullanıcı isteği, verbatim): "Oyun içi sohbet
  // penceresini kapattığında oyuncu, genel sohbet mesajı da kapanmamalı.
  // Onu zaten isteğe göre mesaj balonuna tıklayıp açabiliyor o yüzden o
  // kısıma kısıtlama getirilmesine gerek yok." Bu anahtar (yukarıda
  // kapatıldı) yalnız BU MASANIN sohbetini susturmalı; genel sohbet
  // (mesaj balonu/çekmece) TAMAMEN etkilenmeden çalışmaya devam etmeli.
  // Ayrı bir ÜYE penceresiyle test edilir: FAB/çekmece yalnız üyelere
  // görünür (misafirlerde masa dalı yeterli, bkz. yukarıdaki testler).
  {
    const reg = await api(BASE, '/api/auth/register', { name: 'ChatToggleUye', email: 'chattoggle@ctoggle.test', password: 'gucluSifre123' }, 'POST');
    assert.ok(reg.ok, 'üye kaydı: ' + JSON.stringify(reg));
    const { db } = require('../db');
    const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
    await api(BASE, '/api/auth/verify', { token: vt }, 'POST');
    const giris = await api(BASE, '/api/auth/login', { email: 'chattoggle@ctoggle.test', password: 'gucluSifre123' }, 'POST');
    assert.ok(giris.ok && giris.token, 'üye girişi: ' + JSON.stringify(giris));

    const uwin = await pencere(BASE, giris.token);
    const u$ = sel => uwin.document.querySelector(sel);
    await bekle(() => uwin.st.user && !uwin.st.isGuest && uwin.st.user.id === reg.userId, 20000, 'üye olarak tanınmalı');

    // Bu üye penceresinde de masa sohbetini GERÇEK bir tıklamayla KAPAT
    // (localStorage'a doğrudan yazmak chat.js'in kendi bellek içi
    // `sohbetKapali` değişkenini güncellemez — o yalnız sayfa açılışında
    // BİR KEZ okunur; gerçek kullanıcı deneyimi anahtara tıklamaktır).
    const uBtn = await bekle(() => uwin.document.getElementById('gvChatToggle'), 8000, 'üye penceresinde sohbet anahtarı');
    // chat.js tıklama dinleyicisini yalnız İLK tick()'te bağlar (300 ms'lik
    // gecikmeli setTimeout ile) — anahtar öğe DOM'da baştan var olduğundan
    // (statik markup) burada bekle() anında döner, ama dinleyici henüz
    // bağlanmamış olabilir. Önce bağlanmayı bekle, sonra tıkla; aksi halde
    // tıklama sessizce hiçbir şey yapmaz (chat.js'in kendi __gvBagli koruması).
    await bekle(() => uBtn.__gvBagli, 8000, 'üye penceresinde anahtar tıklama dinleyicisi bağlanmalı');
    uBtn.dispatchEvent(new uwin.MouseEvent('click', { bubbles: true }));
    await bekle(() => uBtn.classList.contains('off'), 4000, 'üye penceresinde masa sohbeti kapansın');

    // Sahte LOBİ soketi kur — genel sohbet bunu kullanır (masa dışındayken).
    const lobbyHandlers = {};
    const lobbySock = {
      connected: true,
      on(ev, fn) { lobbyHandlers[ev] = fn; },
      off() {},
      emit(ev, _p, cb) { if (typeof cb === 'function') cb({ ok: true, messages: [] }); },
      __handlers: lobbyHandlers
    };
    uwin.__gvLobbySocket = lobbySock;
    uwin.st.curPage = 'home'; // masada DEĞİL — genel sohbet modu (mode==='global')

    const fab = await bekle(() => uwin.document.getElementById('gvChatFab'), 8000, 'sohbet balonu (FAB) — üyeye görünür olmalı');
    assert.notStrictEqual(fab.style.display, 'none', 'masa sohbeti kapalıyken bile FAB/balon gizlenmemeli');
    await bekle(() => lobbySock.__handlers.chatMessage, 8000, 'chat.js genel sohbet (lobi) soketini bağlaması');

    fab.dispatchEvent(new uwin.MouseEvent('click', { bubbles: true }));
    await bekle(() => uwin.document.getElementById('gvChatPanel').classList.contains('open'), 4000, 'çekmece açılsın');
    await bekle(() => (uwin.document.getElementById('gvChatTitle').textContent || '').includes('Genel Sohbet'), 4000, 'başlık Genel Sohbet olmalı');

    const gInp = u$('#gvChatText');
    const gBtn = u$('#gvChatSend');
    assert.ok(gInp && !gInp.disabled, 'masa sohbeti KAPALIYKEN bile genel sohbet yazma kutusu açık kalmalı');
    assert.ok(gBtn && !gBtn.disabled, 'masa sohbeti KAPALIYKEN bile genel sohbet gönder düğmesi açık kalmalı');

    lobbySock.__handlers.chatMessage({ id: 'g1', scope: 'global', name: 'Herkes', text: 'genel-mesaj-gorunmeli', ts: Date.now() });
    await bekle(() => (u$('#gvChatList').innerHTML || '').includes('genel-mesaj-gorunmeli'), 4000,
      'masa sohbeti KAPALIYKEN gelen GENEL sohbet mesajı normal şekilde görünmeli');

    uwin.close();
    console.log('  ✓ 2b) masa sohbetini kapatmak genel sohbeti (mesaj balonu) KAPATMIYOR — istendiği gibi ayrı çalışıyor');
  }

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

  // ---- 6) SOHBET AÇIKKEN "Sohbet Kapalı" uyarısı GÖRÜNMEMELİ ----
  // Hata (kullanıcı raporu): uyarı sürekli ekrandaydı. Sebep CSS'ti —
  // .chat-off/.chat-msgs/.chat-input üzerindeki `display:flex` sınıf kuralı,
  // tarayıcının [hidden]{display:none} kuralını eziyordu. Artık açıkça
  // `[hidden]` guard'ı var; kaynaktan doğruluyoruz (jsdom biçem sayfalarını
  // ayrıştırmadığı için hesaplanmış stil güvenilir değil).
  {
    const fs2 = require('fs'), path2 = require('path');
    const kaynak = fs2.readFileSync(path2.join(__dirname, '..', 'index.html'), 'utf8');
    assert.ok(/\.chat-off\[hidden\][^{]*\{display:none!important\}/.test(kaynak.replace(/\s/g, '')) ||
              /chat-off\[hidden\],\.chat-msgs\[hidden\],\.chat-input\[hidden\]\{display:none!important\}/
                .test(kaynak.replace(/\s/g, '')),
      'gizlenen sohbet kutuları için [hidden] kuralı olmalı (display:flex onu eziyordu)');
    // Davranış: açıkken uyarı gizli, kapalıyken görünür olmalı
    assert.ok($('#gvChatOff').hidden, 'sohbet AÇIKKEN "Sohbet Kapalı" uyarısı gizli olmalı');
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await bekle(() => btn.classList.contains('off'), 4000, 'kapanış');
    assert.ok(!$('#gvChatOff').hidden, 'sohbet KAPALIYKEN uyarı görünmeli');
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    await bekle(() => btn.classList.contains('on'), 4000, 'açılış');
    assert.ok($('#gvChatOff').hidden, 'tekrar açılınca uyarı yine gizlenmeli');
    console.log('  ✓ 6) "Sohbet Kapalı" uyarısı yalnızca sohbet kapalıyken görünüyor');
  }

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
