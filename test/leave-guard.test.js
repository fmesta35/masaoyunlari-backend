'use strict';

/*
 * LEAVE-GUARD — oyundan yanlışlıkla ayrılmayı önleyen onay penceresi (jsdom).
 *
 *  Kullanıcı isteği: oyun BAŞLAMIŞKEN oyuncu başka sayfaya tıklarsa /
 *  yanlışlıkla gezinirse / yenilemeye kalkarsa DİREKT oyundan çıkmasın:
 *   - Önce "Oyunu Terk Etmek İstediğinize Emin Misiniz? ... mağlup sayılacak
 *     ve ceza puanı alacaksınız" penceresi çıkar.
 *   - HAYIR → oyunda kalır, tıklanan yerde İŞLEM YAPILMAZ.
 *   - EVET → tıklanan yere gidebilir (terk akışı onaylanır).
 *   - 30 sn cevaplanmazsa pencere kendiliğinden kapanır (oyunda kalınır).
 *   - beforeunload (yenileme/sekme kapatma) engellenir.
 *
 *  A) Maç başlamadan gezinme SERBEST (bekçi devrede değil).
 *  B) gameStarted sonrası GV.page çağrısı pencere açar ve gezinmeyi BLOKLAR;
 *     HAYIR → oyunda kalır; EVET → gezinme gerçekleşir.
 *  C) Pencere cevapsız kalırsa (testte 600 sn ayarı kısaltılmıştır) kendi
 *     kapanır; gezinme hâlâ yapılmamıştır.
 *  D) beforeunload maç sırasında engellenir; gameEnded sonrası serbest kalır.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { JSDOM, VirtualConsole } = require('jsdom');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, what, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeoutMs || 10000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(80);
  }
  throw new Error('bekleme zaman aşımı: ' + what);
}

async function main() {
  const guardSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'leave-guard.js'), 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});

  const navCalls = [];
  const fakeSock = new EventEmitter(); // socket.io-benzeri: on/emit yeterli
  fakeSock.connected = true;

  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'http://localhost/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.__gvRoomSocket = fakeSock;
      w.__gvLeaveGuardModalMs = 600; // 30 sn yerine hızlı test döngüsü
      w.GV = {
        page: (...a) => { navCalls.push(['page', ...a]); },
        openLobby: (...a) => { navCalls.push(['openLobby', ...a]); }
      };
    }
  });
  const win = dom.window;
  win.eval(guardSrc);

  // ---------- A) Maçtan ÖNCE gezinme serbest ----------
  win.GV.page('games');
  await sleep(150);
  assert.deepStrictEqual(navCalls, [['page', 'games']], 'A: maç yokken gezinme bloke edilmez');
  assert.ok(!win.document.querySelector('.gvlg-overlay'), 'A: pencere de açılmaz');
  console.log('  ✓ A) Maç öncesi gezinme serbest (pencere yok)');

  // ---------- Maç başlasın (bekçi soketi 800 ms taramayla bağlar) ----------
  await waitFor(() => fakeSock.listenerCount('gameStarted') > 0, 'bekçi sokete bağlandı');
  fakeSock.emit('gameStarted', { isSpectator: false });
  await waitFor(() => win.__gvLeaveGuard && win.__gvLeaveGuard.inGame === true, 'inGame=true oldu');

  // ---------- B) HAYIR kalır / EVET gider ----------
  {
    win.GV.page('lb'); // bekçi bloklasın
    await waitFor(() => win.document.querySelector('.gvlg-overlay') !== null, 'onay penceresi açıldı');
    const txt = win.document.querySelector('.gvlg-overlay').textContent;
    assert.ok(/Emin Misiniz/i.test(txt) && /mağlup/i.test(txt) && /ceza puanı/i.test(txt),
      'B: uyarı metni istenen ifadeleri içerir');
    assert.strictEqual(navCalls.length, 1, 'B: tıklanan sayfa AÇILMADI (bloke)');
    // HAYIR → oyunda kal
    win.document.querySelector('.gvlg-no').click();
    await waitFor(() => win.document.querySelector('.gvlg-overlay') === null, 'pencere kapandı');
    assert.strictEqual(navCalls.length, 1, 'B: HAYIR sonrası hâlâ gezinilmedi');

    // EVET → gezinme gerçekleşir (ve gerçek terk işlemi yapılır: sokete
    // leaveRoom emit edilir, bekçi sıfırlanır)
    win.GV.openLobby('tavla');
    await waitFor(() => win.document.querySelector('.gvlg-overlay') !== null, 'ikinci pencere');
    win.document.querySelector('.gvlg-yes').click();
    await waitFor(() => navCalls.length === 2, 'EVET sonrası hedef sayfa açıldı');
    assert.deepStrictEqual(navCalls[1], ['openLobby', 'tavla']);
    assert.ok(!win.document.querySelector('.gvlg-overlay'), 'B: EVET sonrası pencere kapalı');
    await waitFor(() => win.__gvLeaveGuard.inGame === false, 'B: EVET terk işlemi yaptı (bekçi sıfır)');
    console.log('  ✓ B) Maçta gezinme bloklandı → HAYIR kal, EVET git + gerçek terk (metin doğru)');
  }

  // Bekçiyi tekrar maç konumuna getir
  fakeSock.emit('gameStarted', { isSpectator: false });
  await waitFor(() => win.__gvLeaveGuard.inGame === true, 'ikinci maç başladı');

  // ---------- C) Cevapsız pencere kendi kapanır (oyunda kalınır) ----------
  {
    win.GV.page('tourn');
    await waitFor(() => win.document.querySelector('.gvlg-overlay') !== null, 'C: pencere açıldı');
    await waitFor(() => win.document.querySelector('.gvlg-overlay') === null, 'C: pencere otomatik kapandı', 4000);
    assert.strictEqual(navCalls.length, 2, 'C: otomatik kapanış HAYIR gibi davrandı (gezinilmedi)');
    console.log('  ✓ C) Cevapsız uyarı kendiliğinden kapandı; oyuncu oyunda kaldı');
  }

  // ---------- D) beforeunload engeli + maç bitince serbest ----------
  {
    // C'deki otomatik kapanış bekçiyi kırmaz; yeni maç başlatıp engeli doğrula
    fakeSock.emit('gameStarted', { isSpectator: false });
    await waitFor(() => win.__gvLeaveGuard.inGame === true, 'üçüncü maç başladı');
    const ev = new win.Event('beforeunload', { cancelable: true });
    win.dispatchEvent(ev);
    assert.strictEqual(ev.defaultPrevented, true, 'D: maç sırasında yenileme/kapama engellenir');

    fakeSock.emit('gameEnded', {});
    await waitFor(() => win.__gvLeaveGuard.inGame === false, 'inGame=false oldu');
    const ev2 = new win.Event('beforeunload', { cancelable: true });
    win.dispatchEvent(ev2);
    assert.strictEqual(ev2.defaultPrevented, false, 'D: maç bitince yenileme serbest');
    win.GV.page('home');
    await sleep(150);
    assert.deepStrictEqual(navCalls[navCalls.length - 1], ['page', 'home'], 'D: bitiş sonrası gezinme serbest');
    console.log('  ✓ D) beforeunload engellendi; maç bitince her şey serbest');
  }

  console.log('\n✅ leave-guard: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ leave-guard:', err && err.stack ? err.stack : err); process.exit(1); });
