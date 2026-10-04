'use strict';
/*
 * KELİMELİK — İSTEMCİ (jsdom, gerçek sunucu).
 * İki pencere masaya oturur, tahta çizilir, oyuncu ıstakadan harf seçip
 * tahtaya tıklayarak KELİME kurar, hamle sunucudan iki pencereye de döner.
 * Ayrıca: rakibin ıstakası sızmıyor mu, sözlük reddi "Kelime Bildir"i
 * açıyor mu, hamle kaydına kelime + puan yazılıyor mu, tahtanın üstündeki
 * bilgi şeritleri ve yakınlaştırma kumandası gerçekten kalktı mı,
 * pas/değiştir düğmeleri çalışıyor mu.
 */
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function pencere() {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true; }
  });
  const win = dom.window;
  win.__gvErrors = [];
  win.addEventListener('error', e => win.__gvErrors.push(String(e.message || e)));
  return win;
}
/* Sunucu ıstakasını testte sabitler ve İSTEMCİ paketi gerçekten alana
   kadar bekler. Yalnız "içinde K var mı" diye bakmak yetmiyordu: rastgele
   açılış ıstakası da K içerebildiği için test eski pakete bakıp kayıyordu. */
async function istakaKur(oda, win, seat, harfler, oda_id) {
  oda.kelimelik.racks[seat] = harfler.slice();
  const hedef = harfler.slice().sort().join('');
  win.__gvRoomSocket.emit('kelimelikShuffle', { roomId: oda_id });
  await bekle(() => Array.from(win.GVArena.state().rack || []).slice().sort().join('') === hedef,
    10000, 'ıstaka istemciye ulaşmalı (' + hedef + ')');
  win.GVArena.repaint();
}
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 20000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
  }
  throw new Error('bekleme zaman aşımı: ' + ne);
}
function tikla(win, el) {
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://localhost:' + server.address().port;
  const rooms = serverModule.rooms;
  const ODA = 'kl-istemci';

  const A = await pencere(), B = await pencere();
  for (const w of [A, B]) {
    await bekle(() => w.GV && w.st && w.GVArena, 25000, 'sayfa hazır');
    await bekle(() => typeof w.__gvStartRealRoomWaiting === 'function', 25000, 'oda köprüsü');
    w.st.curGame = 'kelimelik';
    w.GV.joinRoom(ODA);
  }
  for (const w of [A, B]) {
    const b = await bekle(() => w.document.querySelector('#gv-real-chess-wait .gv-ready'), 15000, 'HAZIRIM');
    b.click();
  }

  // 1) tahta iki pencerede de çizilir
  for (const w of [A, B]) {
    await bekle(() => w.document.querySelector('#boardArea .kl-tahta'), 25000, 'tahta');
  }
  assert.strictEqual(A.document.querySelectorAll('#boardArea .kl-hc').length, 225, '15×15 = 225 hücre');
  assert.strictEqual(A.document.querySelectorAll('#boardArea .kl-rt').length, 7, 'ıstaka 7 taş');
  assert.ok(A.document.querySelector('#boardArea .kl-hc.merkez'), '★ başlangıç karesi çizilmeli');
  console.log('  ✓ 1) tahta, bonus kareleri ve ıstaka çizildi');

  // 2) adaptör yüklenirken JS hatası olmamalı
  for (const w of [A, B]) {
    const bad = w.__gvErrors.filter(x => /is not defined|undefined/.test(x));
    assert.strictEqual(bad.length, 0, 'istemci JS hatası → ' + bad.join(' | '));
  }

  // 3) RAKİBİN ISTAKASI SIZMAMALI
  const sa = A.GVArena.state(), sb = B.GVArena.state();
  assert.strictEqual(sa.rack.length, 7);
  assert.ok(!('racks' in sa), 'iki ıstaka birden gelmemeli');
  /* jsdom AYRI bir gerçeklik (realm): oradan gelen diziler deepStrictEqual
     ile karşılaştırılamaz (prototipleri farklı). Değer olarak bakılır. */
  assert.strictEqual(Array.from(sa.rackCounts).join(','), '7,7');
  assert.strictEqual(Array.from(sb.rack).length, 7);
  assert.ok(!('bagTiles' in sa), 'torbanın içeriği gönderilmemeli');
  console.log('  ✓ 2) yalnız kendi ıstakası geliyor, rakibinki sızmıyor');

  // 4) sırası gelen pencere ıstakadan seçip tahtaya tıklayarak KEDİ kurar
  const oda = rooms.get(ODA);
  const sirali = [A, B].find(w => w.GVArena.seat() === 0);
  const oteki = sirali === A ? B : A;
  assert.ok(sirali && oteki, 'koltuklar dağıtılmalı');
  oda.kelimelik.turn = 0;
  await istakaKur(oda, sirali, 0, ['K', 'E', 'D', 'İ', 'A', 'L', 'M'], ODA);

  const kok = sirali.document.getElementById('boardArea');
  function koy(harf, r, c) {
    const rack = sirali.GVArena.state().rack;
    const i = rack.indexOf(harf);
    assert.ok(i >= 0, harf + ' ıstakada olmalı — ıstaka: ' + Array.from(rack).join(',') +
      ' · taslak: ' + sirali.__gvKelimelik.taslak().map(g => g.harf).join(','));
    tikla(sirali, kok.querySelector('.kl-rt[data-i="' + i + '"]'));
    tikla(sirali, sirali.document.querySelector('#boardArea .kl-hc[data-r="' + r + '"][data-c="' + c + '"]'));
  }
  koy('K', 7, 7); koy('E', 7, 8); koy('D', 7, 9); koy('İ', 7, 10);
  assert.strictEqual(sirali.__gvKelimelik.taslak().length, 4, 'dört harf tahtaya bırakılmalı');
  // yerel taslak tahtada görünmeli (henüz sunucuya gitmedi)
  assert.ok(sirali.document.querySelector('#boardArea .kl-hc[data-r="7"][data-c="7"] .kl-tas'),
    'taslak taş tahtada görünmeli');
  assert.strictEqual(sirali.GVArena.state().board[7][7], null, 'sunucu tahtasına henüz yazılmamalı');

  tikla(sirali, sirali.document.querySelector('#boardArea .kl-onay'));
  await bekle(() => sirali.GVArena.state().scores[0] === 12, 12000, 'KEDİ onaylandı (12 puan)');
  await bekle(() => oteki.GVArena.state().board[7][7] &&
    oteki.GVArena.state().board[7][7].harf === 'K', 12000, 'hamle rakip penceresine yansımalı');
  assert.strictEqual(sirali.__gvKelimelik.taslak().length, 0, 'onaydan sonra taslak temizlenmeli');
  console.log('  ✓ 3) ıstakadan seçip tahtaya tıklayarak KEDİ kuruldu, 12 puan, rakibe yansıdı');

  /* 4b) HAMLE KAYDI — kullanıcı isteği: "Oyunlarda yapılan hamleler de
     kazanılan puanlar ve kelimeler not edilsin." İki pencerede de yazmalı:
     hamleyi yapan "Siz" diye, rakip oyuncu adıyla görür. */
  for (const w of [sirali, oteki]) {
    const kayit = await bekle(() => {
      const el = w.document.getElementById('moveHist');
      return el && /KEDİ/.test(el.textContent) ? el : null;
    }, 10000, 'hamle kaydında kelime görünmeli');
    assert.ok(/\+12/.test(kayit.textContent), 'hamle kaydında puan görünmeli → ' + kayit.textContent.trim());
  }
  assert.ok(/Siz/.test(sirali.document.getElementById('moveHist').textContent),
    'hamleyi yapan kendini "Siz" diye görmeli');
  /* Merkez karesi (★) kullanıldığı için sunucu bonus bayrağı yollamalı:
     ayrı ses efekti (klBonus) buna bakıyor. */
  const sonKayit = oda.kelimelik.history.filter(g => g.tur === 'move').pop();
  assert.strictEqual(sonKayit.bonus, true, 'merkez karesi kullanıldı → bonus bayrağı açık olmalı');
  assert.strictEqual(sonKayit.bingo, false, '4 harf bingo değil');
  console.log('  ✓ 3b) hamle kaydına kelime + puan yazıldı, bonus bayrağı doğru');

  /* 4c) SES EFEKTLERİ — kullanıcı isteği: "Bonus puanlarda ses efekti ayrı
     olsun, hamle oynama sesleri de olsun taş koyma ve kaldırma, isterlerse
     kullanıcılar sesleri kapatabilirler." Ses motorunda bu adların GERÇEKTEN
     tanımlı olması gerekir; eksikse adaptör sessizce hiçbir şey çalmaz ve
     hata da vermez — bu yüzden ayrıca doğrulanır. Kapatma anahtarı da
     burada sınanır: kapalıyken cal() false dönmeli. */
  const D = sirali.GVDeniz;
  assert.ok(D && D.ses, 'ses motoru yüklenmeli');
  const oncekiSes = D.ses.acik();
  D.ses.ayarla(false);
  for (const ad of ['klTas', 'klGeri', 'klOnay', 'klBonus', 'klBingo', 'klRed']) {
    assert.strictEqual(D.ses.cal(ad), false, 'ses kapalıyken ' + ad + ' çalmamalı');
  }
  D.ses.ayarla(oncekiSes);
  const sesKaynak = await (await fetch(BASE + '/js/deniz-sinematik.js')).text();
  for (const ad of ['klTas', 'klGeri', 'klOnay', 'klBonus', 'klBingo', 'klRed']) {
    assert.ok(new RegExp('\\n\\s*' + ad + ':\\s*function').test(sesKaynak),
      'ses motorunda tanımlı olmalı: ' + ad);
  }
  console.log('  ✓ 3c) kelimelik ses efektleri tanımlı ve ses anahtarı hepsini kapatıyor');

  // 5) sözlükte olmayan kelime reddedilir ve Kelime Bildir açılır
  oda.kelimelik.turn = oteki.GVArena.seat();
  await istakaKur(oda, oteki, oteki.GVArena.seat(), ['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'], ODA);
  const k2 = oteki.document.getElementById('boardArea');
  tikla(oteki, k2.querySelector('.kl-rt[data-i="0"]'));
  tikla(oteki, oteki.document.querySelector('#boardArea .kl-hc[data-r="6"][data-c="7"]'));
  tikla(oteki, oteki.document.querySelector('#boardArea .kl-rt[data-i="1"]'));
  tikla(oteki, oteki.document.querySelector('#boardArea .kl-hc[data-r="5"][data-c="7"]'));
  tikla(oteki, oteki.document.querySelector('#boardArea .kl-onay'));
  await bekle(() => oteki.__gvKelimelik.ret().length > 0, 10000, 'sözlük reddi istemciye ulaşmalı');
  await bekle(() => {
    const b = oteki.document.querySelector('#boardArea .kl-bildir');
    return b && !b.disabled;
  }, 8000, 'Kelime Bildir düğmesi açılmalı');
  tikla(oteki, oteki.document.querySelector('#boardArea .kl-bildir'));
  const pencereEl = await bekle(() => oteki.document.querySelector('.kl-bildir-ov'), 8000, 'bildir penceresi');
  assert.ok(pencereEl.querySelector('.kl-bdr'), 'reddedilen kelime listelenmeli');
  oteki.__klYanit = null;
  oteki.__gvRoomSocket.on('kelimelikReported', p => { oteki.__klYanit = p; });
  console.log('    [tanı] reddedilen:', Array.from(oteki.__gvKelimelik.ret()).join(','),
    '· kutular:', pencereEl.querySelectorAll('.kl-bdr').length,
    '· işaretli:', Array.from(pencereEl.querySelectorAll('.kl-bdr')).filter(x => x.checked).length);
  tikla(oteki, pencereEl.querySelector('.kl-bdr-yolla'));
  await bekle(() => !oteki.document.querySelector('.kl-bildir-ov'), 8000, 'pencere kapanmalı');
  await bekle(() => oteki.__klYanit, 8000, 'sunucu bildirimi onaylamalı');
  const bildirim = require('../kelimelik-bildirim');
  assert.ok(bildirim.liste().length > 0, 'bildirim sunucuya kaydedilmeli');
  console.log('  ✓ 4) sözlük reddi → Kelime Bildir → sunucuya kayıt');

  // 6) GÖRÜNTÜ SADELEŞTİRMESİ + kumanda düğmeleri
  /* Kullanıcı isteği: "Tam ekran seçilmeden de rakip oynuyor, diğer taş
     bilgileri vs. oyun üzerindeki bilgiler kalksın, harita yakınlaştırma
     - ve + kısımları kalksın." Tahtanın ÜSTÜNDEKİ her şey kaldırıldı;
     torba/pas bilgisi yan panele tek satır olarak taşındı. Burada o
     şeritlerin GERÇEKTEN yok olduğu, bilginin ise kaybolmadığı sınanır. */
  const kokA = sirali.document.getElementById('boardArea');
  for (const sec of ['.kl-buyut', '.kl-kucult', '.kl-merkez', '.kl-olcek-et',
                     '.kl-durum', '.kl-skor', '.kl-torba', '.kl-arac']) {
    assert.strictEqual(kokA.querySelector(sec), null, 'tahta üstünde kalmamalı: ' + sec);
  }
  assert.strictEqual(typeof sirali.__gvKelimelik.olcek, 'undefined',
    'yakınlaştırma kademesi tamamen kaldırılmalı');
  /* Tahta kutusunun dışına taşan bir kaydırma şeridi kalmamalı. */
  const kutuEl = kokA.querySelector('.kl-kutu');
  assert.ok(kutuEl, 'tahta kutusu yerinde olmalı');
  const yanDurum = await bekle(() => sirali.document.getElementById('klYanDurum'),
    8000, 'torba/pas bilgisi yan panele taşınmalı');
  assert.ok(/taş/.test(yanDurum.textContent) && /pas/.test(yanDurum.textContent),
    'yan panel satırı torba ve pas bilgisini taşımalı → ' + yanDurum.textContent.trim());
  for (const sec of ['.kl-onay', '.kl-geri', '.kl-temiz', '.kl-karistir', '.kl-takas', '.kl-pas', '.kl-bildir']) {
    assert.ok(sirali.document.querySelector('#boardArea ' + sec), 'düğme eksik: ' + sec);
  }
  console.log('  ✓ 5) tahta üstü şeritler ve yakınlaştırma kalktı, bilgi yan panele taşındı');

  // 7) PAS: sunucuya gider, sayaç artar
  /* Sırası GERÇEKTEN kimdeyse o pencere pas geçer: sunucu durumunu elle
     değiştirip istemciyi haberdar etmemek, düğmeyi kapalı bırakıyordu. */
  oda.kelimelik.passStreak = [0, 0];
  const pasEden = await bekle(
    () => [A, B].find(w => { const q = w.GVArena.state(); return q && q.status === 'playing' && q.turn === w.GVArena.seat(); }),
    10000, 'sırası olan pencere');
  const pasKoltuk = pasEden.GVArena.seat();
  const pasOnce = oda.kelimelik.passStreak[pasKoltuk];
  const pasDgm = pasEden.document.querySelector('#boardArea .kl-pas');
  assert.ok(pasDgm && !pasDgm.disabled, 'sırası olan oyuncunun Pas düğmesi açık olmalı');
  tikla(pasEden, pasDgm);
  await bekle(() => oda.kelimelik.passStreak[pasKoltuk] > pasOnce, 10000, 'pas sunucuya ulaşmalı');
  // pas geçtikten sonra sıra rakibe geçer: pas geçenin düğmeleri kapanmalı
  await bekle(() => { const d = pasEden.document.querySelector('#boardArea .kl-onay'); return d && d.disabled; },
    8000, 'sırası olmayanın Onayla düğmesi kapalı olmalı');
  console.log('  ✓ 6) Pas Geç sunucuya ulaştı, üst üste pas sayacı arttı');

  for (const w of [A, B]) { try { w.close(); } catch (_) {} }
  server.close();
  console.log('OK kelimelik istemci (jsdom): çizim, hamle, hamle kaydı, sesler, sözlük reddi, kelime bildir, sade görünüm, pas');
  process.exit(0);
}
main().catch(e => { console.error('❌ KELİMELİK İSTEMCİ HATASI:', e); process.exit(1); });
