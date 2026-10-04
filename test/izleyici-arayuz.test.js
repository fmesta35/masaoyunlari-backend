'use strict';
/* ============================================================================
 * İZLEYİCİ ARAYÜZÜ (jsdom) — pop-up ve izin düğmesi
 * ============================================================================
 * Sunucu tarafı test/izleyici-koltuk-secimi.test.js'te doğrulanıyor. Burada
 * GÖRÜNEN kısım sınanır, çünkü kullanıcı isteğinin yarısı görsel:
 *   "oyuncuların isimlerini pop-up açılarak seçer", "izleyiciler o oyuncuyu
 *    seçemez rengi sönük gözükür, sadece izin verilen rengi aktif olarak
 *    gözükür oyuncunun kullanıcı adı veya ziyaretçi numarasıyla",
 *   "Oyuncularda 'İzleyiciye İzin Ver' veya 'İzleyici İznini Kaldır'
 *    seçenekleri olacak oyun esnasında webde ve mobilde."
 *
 * Gerçek sunucuya bağlanmak yerine SAHTE bir soket kullanılır: modül yalnız
 * soket olaylarını dinlediği için bu yeterli ve testi hızlı tutar.
 * ========================================================================= */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const KOK = path.join(__dirname, '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Olay dinleyicilerini tutan minik sahte soket (socket.io arayüzü kadarı). */
function sahteSoket(id) {
  const din = {};
  return {
    id,
    gonderilen: [],
    on(ev, fn) { (din[ev] = din[ev] || []).push(fn); },
    off(ev, fn) { din[ev] = (din[ev] || []).filter(f => f !== fn); },
    emit(ev, data) { this.gonderilen.push({ ev, data }); },
    _tetikle(ev, data) { (din[ev] || []).forEach(f => f(data)); }
  };
}

async function main() {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = new JSDOM(
    '<!doctype html><html><body>' +
    /* izleyici.js yalnız şu iki çıpaya bakar: oda sayfası ve ses düğmesi. */
    '<div id="pg-room" class="active"><div class="room-actions">' +
    '<button id="gvSoundBtn">🔊 Ses</button></div></div>' +
    '</body></html>',
    { runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true });

  const win = dom.window;
  const sok = sahteSoket('sock-izleyici');
  win.__gvRoomSocket = sok;
  win.toast = () => {};

  const kod = fs.readFileSync(path.join(KOK, 'js', 'izleyici.js'), 'utf8');
  win.eval(kod);

  const SECENEKLER = [
    { seat: 0, name: 'Ali', uid: 7, uye: true, allowed: true },
    { seat: 1, name: 'Ziyaretçi 4821', uid: null, uye: false, allowed: true },
    { seat: 2, name: 'Veli', uid: 9, uye: true, allowed: false },
    { seat: 3, name: 'Ayşe', uid: 11, uye: true, allowed: true }
  ];

  // ---------------------------------------------------------- 1) POP-UP
  win.__gvIsSpectator = true;
  sok._tetikle('spectatorChoices', {
    roomId: 'o1', gameId: 'okey', secimli: true, choices: SECENEKLER, watchSeat: null
  });
  await sleep(30);

  const ov = win.document.querySelector('.gv-izle-ov');
  assert.ok(ov, 'izleyici girince oyuncu seçim pop-up’ı KENDİLİĞİNDEN açılmalı');
  const dgmler = ov.querySelectorAll('.gv-izle-sec');
  assert.strictEqual(dgmler.length, 4, 'dört oyuncu da listelenmeli');
  console.log('  ✓ 1) izleyiciye oyuncu seçim pop-up’ı açıldı');

  // ---------------------------------------------- 2) isim + üye/ziyaretçi
  const metin = ov.textContent;
  for (const o of SECENEKLER) {
    assert.ok(metin.includes(o.name), 'listede görünmeli: ' + o.name);
  }
  assert.ok(/Ziyaretçi 4821/.test(metin),
    'üye olmayan izlenen oyuncu ziyaretçi numarasıyla görünmeli');
  console.log('  ✓ 2) oyuncular kullanıcı adı / ziyaretçi numarasıyla listelendi');

  // ------------------------------------------- 3) izin vermeyen SÖNÜK + kilitli
  const veli = Array.from(dgmler).find(b => b.textContent.includes('Veli'));
  assert.ok(veli.classList.contains('sonuk'), 'izin vermeyen oyuncu sönük görünmeli');
  assert.strictEqual(veli.disabled, true, 'izin vermeyen oyuncu seçilememeli');
  const ali = Array.from(dgmler).find(b => b.textContent.includes('Ali'));
  assert.ok(!ali.classList.contains('sonuk'), 'izin veren oyuncu aktif görünmeli');
  assert.strictEqual(ali.disabled, false);
  console.log('  ✓ 3) izin vermeyen oyuncu sönük ve tıklanamaz, izin veren aktif');

  // -------------------------------------------------- 4) seçim sunucuya gider
  sok.gonderilen.length = 0;
  veli.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  assert.strictEqual(sok.gonderilen.length, 0, 'sönük oyuncuya tıklamak istek YOLLAMAMALI');
  ali.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  const istek = sok.gonderilen.find(x => x.ev === 'spectateSeat');
  assert.ok(istek && istek.data.seat === 0, 'seçilen koltuk sunucuya gönderilmeli');
  sok._tetikle('spectateSeatResult', { ok: true, seat: 0, name: 'Ali' });
  await sleep(20);
  assert.ok(!win.document.querySelector('.gv-izle-ov'), 'seçimden sonra pop-up kapanmalı');
  const rozet = win.document.getElementById('gvIzleRozet');
  assert.ok(rozet && /Ali/.test(rozet.textContent),
    'başlıkta kimin izlendiği yazmalı (değiştirmek için tıklanır)');
  console.log('  ✓ 4) seçim sunucuya gitti, pop-up kapandı, başlıkta izlenen oyuncu yazıyor');

  // ------------------------------------------------- 5) ÇIKARILMA UYARISI
  sok._tetikle('spectatorEjected', {
    roomId: 'o1', seat: 0, name: 'Ali', reason: 'permission_revoked',
    message: 'Ali izleyici iznini kapattı. Lobiye yönlendiriliyorsunuz.'
  });
  await sleep(30);
  const uyari = win.document.querySelector('.gv-izle-uyari');
  assert.ok(uyari, 'izin kalkınca pop-up uyarı çıkmalı');
  assert.ok(/izleyici iznini kapattı/i.test(uyari.textContent),
    'uyarı "oyuncu izleyici iznini kapattı" demeli');
  assert.ok(/[Ll]obi/.test(uyari.textContent), 'uyarı lobiye yönlendirmeyi söylemeli');
  let lobiAcildi = null;
  win.GV = { openLobby: g => { lobiAcildi = g; } };
  win.st = { curGame: 'okey' };
  uyari.querySelector('.gv-izle-lobi').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  assert.strictEqual(lobiAcildi, 'okey', 'uyarıdaki düğme lobiye döndürmeli');
  console.log('  ✓ 5) izin kalkınca uyarı pop-up’ı çıktı ve lobiye yönlendirdi');

  // ------------------------------------- 6) OYUNCUNUN İZİN DÜĞMESİ (web+mobil)
  /* Aynı sayfa bu kez OYUNCU gözüyle: izleyici değilim, koltuğum var. */
  win.__gvIsSpectator = false;
  sok._tetikle('roomUpdated', {
    id: 'o1', gameId: 'okey',
    players: [
      { id: 'sock-izleyici', seat: 0, name: 'Ali', uid: 7, allowSpectators: true },
      { id: 'x2', seat: 1, name: 'Veli', uid: 9, allowSpectators: false }
    ],
    spectators: []
  });
  await sleep(30);
  const izin = win.document.getElementById('gvIzinBtn');
  assert.ok(izin, 'oyuncuya izin düğmesi basılmalı');
  assert.notStrictEqual(izin.style.display, 'none', 'oyun içinde görünür olmalı');
  assert.ok(/İzleyici İznini Kaldır/.test(izin.textContent),
    'izin açıkken düğme "İzleyici İznini Kaldır" demeli — ' + izin.textContent);
  sok.gonderilen.length = 0;
  izin.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await sleep(20);
  const izinIstek = sok.gonderilen.find(x => x.ev === 'setSpectatorPermission');
  assert.ok(izinIstek && izinIstek.data.allow === false, 'düğme izni KALDIRMA isteği yollamalı');
  sok._tetikle('spectatorPermissionSet', { roomId: 'o1', seat: 0, allow: false, ejected: 2 });
  await sleep(20);
  assert.ok(/İzleyiciye İzin Ver/.test(izin.textContent),
    'izin kalkınca düğme "İzleyiciye İzin Ver" olmalı — ' + izin.textContent);
  assert.ok(izin.classList.contains('gv-izin-kapali'), 'kapalı durum görsel olarak ayrışmalı');
  console.log('  ✓ 6) oyuncunun "İzleyiciye İzin Ver / İznini Kaldır" düğmesi çalışıyor');

  // ------------------------------- 7) index.html bağlantıları (yükleme + tam ekran)
  const html = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
  assert.ok(/<script src="js\/izleyici\.js/.test(html), 'izleyici.js index.html’e eklenmiş olmalı');
  assert.ok(/GV_FS_KAPLAMALAR[\s\S]{0,260}gv-izle-ov/.test(html),
    'pop-up tam ekranda da görünsün diye GV_FS_KAPLAMALAR listesinde olmalı');
  console.log('  ✓ 7) modül sayfaya bağlı ve tam ekran kaplama listesinde');

  try { win.close(); } catch (_) {}
  console.log('OK izleyici arayüzü: seçim pop-up’ı, sönük oyuncu, çıkarma uyarısı, izin düğmesi');
  process.exit(0);
}
main().catch(e => { console.error('❌ İZLEYİCİ ARAYÜZ HATASI:', e); process.exit(1); });
