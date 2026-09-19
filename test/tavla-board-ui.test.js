'use strict';

/*
 * TAVLA TAHTA ARAYÜZÜ — kullanıcı istekleri (verbatim):
 *
 *  (3) "Tavla oyununda taş kırıkları - tahtanın ortasındaki BAR yazan
 *       kısımlarda biriksin - BAR yerine Kırık taş alanı olarak gözüksün,
 *       yazılar oyun tahtası içine gelmeden optimize edilsin. Sağ taraftaki
 *       OFF yazan kısımlarada Taş Toplama Alanı olsun uygun bir şekilde yaz."
 *
 *  (5) "Taş birikmeleri rakam olarak gözükmesin, fiziksel olarak taş
 *       yerleşsin iki tarafında."
 *
 *  ESKİ DAVRANIŞ: bir haneye 5'ten fazla pul gelince yalnız 5 pul çizilip
 *  sonuncusunun üstüne "9" gibi bir RAKAM basılıyordu (.tavla-checker.count);
 *  kırık/toplanan pullar da "⚫2" / "4" gibi sayılarla gösteriliyordu.
 *  Alanların adı İngilizce "BAR" / "OFF" idi.
 *
 *  YENİ DAVRANIŞ (bu test):
 *   1) Hiçbir yerde rakam rozeti (.tavla-checker.count) YOK.
 *   2) Her hanede pulların TAMAMI fiziksel olarak çizilir (9 pul → 9 eleman,
 *      15 pul → 15 eleman) ve 5'i aşınca üst üste binme payı (--tv-overlap)
 *      yazılır; böylece haneye sığarlar.
 *   3) Kırık taş alanı ve taş toplama alanı TÜRKÇE adlandırılır ve
 *      içlerinde pullar fiziksel olarak birikir (iki tarafta da).
 *   4) Aynı kurallar HEM yerel çizicide (index.html/dTavla) HEM de online
 *      çizicide (js/tavla-online.js) geçerlidir — ikisi aynı yardımcıyı
 *      kullanır.
 *
 *  NOT: düzen (taşma/ölçek) doğrulaması jsdom ile yapılamaz; o gerçek
 *  tarayıcıyla ayrıca ölçüldü. Bu test işaretlemenin (markup) doğruluğunu
 *  güvenceye alır.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-tavlaui-'));

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
  await bekle(() => win.st && win.GV && typeof win.dTavla === 'function', 20000, 'sayfa açılışı');
  return win;
}

// Gerçekçi durum: 5'i aşan yığınlar + kırık + toplanmış pullar.
function testDurumu() {
  const points = Array.from({ length: 24 }, () => ({ color: null, count: 0 }));
  points[0]  = { color: 'w', count: 2 };
  points[12] = { color: 'b', count: 9 };    // 5 üstü → fiziksel yığın
  points[18] = { color: 'w', count: 15 };   // en uç: 15 pul
  points[23] = { color: 'b', count: 5 };    // tam sınır (binme yok)
  return {
    points, bar: { w: 3, b: 2 }, off: { w: 4, b: 7 },
    dice: [3, 5], availableMoves: [3, 5], turn: 'w', selected: null,
    validTargets: [], diceRolled: true, gameEnded: false, moveHistory: []
  };
}

function haneDogrula(win, etiket) {
  const doc = win.document;
  const noktalar = [...doc.querySelectorAll('.tavla-point')];
  assert.strictEqual(noktalar.length, 24, etiket + ': 24 hane çizilmeli');

  // 1) Hiç rakam rozeti olmamalı
  assert.strictEqual(doc.querySelectorAll('.tavla-checker.count').length, 0,
    etiket + ': pul yığını RAKAM olarak gösterilmemeli (.tavla-checker.count kalmamalı)');

  // 2) Pul sayıları birebir çizilmeli
  const sayilar = noktalar.map(p => p.querySelectorAll('.tavla-checker').length).filter(n => n > 0).sort((a, b) => a - b);
  assert.deepStrictEqual(sayilar, [2, 5, 9, 15],
    etiket + ': her hanedeki pulların TAMAMI fiziksel olarak çizilmeli (bulunan: ' + sayilar.join(',') + ')');

  // 3) 5'i aşan hanelerde binme payı yazılmalı, aşmayanlarda yazılmamalı
  const bul = n => noktalar.find(p => p.querySelectorAll('.tavla-checker').length === n);
  const dokuz = bul(9), onbes = bul(15), bes = bul(5), iki = bul(2);
  assert.ok((dokuz.getAttribute('style') || '').includes('--tv-overlap'),
    etiket + ': 9 pullu hanede üst üste binme payı (--tv-overlap) ayarlanmalı');
  assert.ok((onbes.getAttribute('style') || '').includes('--tv-overlap'),
    etiket + ': 15 pullu hanede üst üste binme payı ayarlanmalı');
  assert.ok(!(bes.getAttribute('style') || '').includes('--tv-overlap'),
    etiket + ': 5 pullu hanede binme payı GEREKMEZ (pullar zaten sığar)');
  assert.ok(!(iki.getAttribute('style') || '').includes('--tv-overlap'),
    etiket + ': 2 pullu hanede binme payı gerekmez');

  // Binme payı NEGATİF ve 15'te 9'dakinden daha sıkı olmalı
  const pay = el => Number((el.getAttribute('style').match(/--tv-overlap:(-?[\d.]+)/) || [])[1]);
  assert.ok(pay(dokuz) < 0 && pay(onbes) < 0, etiket + ': binme payı negatif olmalı');
  assert.ok(pay(onbes) < pay(dokuz),
    etiket + ': 15 pullu hane 9 pulludan DAHA SIKI binmeli (' + pay(onbes) + ' < ' + pay(dokuz) + ')');
  // Yığın haneye sığmalı: toplam yükseklik = 1 + (n-1)*(1+pay) ≤ kapasite (5.6)
  const sigar = (n, f) => 1 + (n - 1) * (1 + f) <= 5.61;
  assert.ok(sigar(9, pay(dokuz)) && sigar(15, pay(onbes)),
    etiket + ': hesaplanan yığın haneye sığmalı');

  // 4) Kırık taş alanı: TÜRKÇE ad + fiziksel pullar (iki tarafta da)
  const barlar = [...doc.querySelectorAll('.tavla-bar')];
  assert.strictEqual(barlar.length, 2, etiket + ': iki kırık taş alanı olmalı');
  barlar.forEach(b => {
    const lbl = b.querySelector('.tavla-zone-label');
    assert.ok(lbl && lbl.textContent.trim() === 'Kırık Taş Alanı',
      etiket + ': orta alan "BAR" yerine "Kırık Taş Alanı" yazmalı (bulunan: ' + (lbl && lbl.textContent) + ')');
  });
  const barPul = barlar.map(b => b.querySelectorAll('.tavla-checker').length).sort();
  assert.deepStrictEqual(barPul, [2, 3],
    etiket + ': kırık pullar rakamla değil FİZİKSEL olarak birikmeli (bulunan: ' + barPul.join(',') + ')');
  assert.strictEqual(doc.querySelectorAll('.tavla-bar-count').length, 0,
    etiket + ': kırık taş sayacı (rakam) kalmamalı');

  // 5) Taş toplama alanı: TÜRKÇE ad + fiziksel pullar (iki tarafta da)
  const offlar = [...doc.querySelectorAll('.tavla-off')];
  assert.strictEqual(offlar.length, 2, etiket + ': iki taş toplama alanı olmalı');
  offlar.forEach(o => {
    const lbl = o.querySelector('.tavla-zone-label');
    assert.ok(lbl && lbl.textContent.trim() === 'Taş Toplama Alanı',
      etiket + ': sağdaki alan "OFF" yerine "Taş Toplama Alanı" yazmalı (bulunan: ' + (lbl && lbl.textContent) + ')');
  });
  const offPul = offlar.map(o => o.querySelectorAll('.tavla-checker').length).sort((a, b) => a - b);
  assert.deepStrictEqual(offPul, [4, 7],
    etiket + ': toplanan pullar rakamla değil FİZİKSEL olarak birikmeli (bulunan: ' + offPul.join(',') + ')');
  assert.strictEqual(doc.querySelectorAll('.tavla-off-count').length, 0,
    etiket + ': toplanan taş sayacı (rakam) kalmamalı');

  // 6) İngilizce eski adlar hiçbir yerde kalmamalı
  const tahtaHtml = doc.querySelector('.tavla-board').innerHTML;
  assert.ok(!/>BAR</.test(tahtaHtml) && !/>OFF</.test(tahtaHtml),
    etiket + ': eski "BAR"/"OFF" etiketleri kalmamalı');
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const win = await pencere(BASE);
  const area = win.document.getElementById('boardArea');

  // ---- A) YEREL ÇİZİCİ (index.html / dTavla) ----
  win.st.boards = win.st.boards || {};
  win.st.boards.tavla = testDurumu();
  win.dTavla(area);
  haneDogrula(win, 'yerel çizici');
  console.log('  ✓ A) yerel çizici: rakam yok, pullar fiziksel, alan adları Türkçe');

  // ---- B) ONLINE ÇİZİCİ (js/tavla-online.js) aynı hesabı kullanmalı ----
  // Online modül masayı kendi çizicisiyle basar; ortak yardımcı (window.tvStack)
  // üzerinden BİREBİR aynı işaretlemeyi üretmelidir.
  assert.strictEqual(typeof win.tvStack, 'function',
    'ortak yığın yardımcısı (window.tvStack) dışa açılmış olmalı ki online çizici de kullansın');
  const y = win.tvStack(15, 'w');
  assert.strictEqual((y.html.match(/tavla-checker/g) || []).length, 15,
    'ortak yardımcı 15 pulun tamamını çizmeli');
  assert.ok(y.style.includes('--tv-overlap'), 'ortak yardımcı binme payını üretmeli');
  assert.ok(!/count/.test(y.html), 'ortak yardımcı rakam rozeti üretmemeli');
  const az = win.tvStack(3, 'b');
  assert.strictEqual((az.html.match(/tavla-checker/g) || []).length, 3, '3 pul birebir çizilmeli');
  assert.strictEqual(az.style, '', '3 pulda binme payı olmamalı');
  console.log('  ✓ B) ortak yığın hesabı (online çizici de bunu kullanır) doğru');

  // ---- C) Online modülün işaretlemesi yerelle aynı sınıfları üretmeli ----
  const kaynak = fs.readFileSync(path.join(__dirname, '..', 'js', 'tavla-online.js'), 'utf8');
  assert.ok(kaynak.includes('Kırık Taş Alanı') && kaynak.includes('Taş Toplama Alanı'),
    'online tavla çizicisi de Türkçe alan adlarını kullanmalı');
  assert.ok(!/tavla-bar-count|tavla-off-count|checker \$\{p\.color\} count/.test(kaynak),
    'online tavla çizicisinde rakam sayaçları kalmamalı');
  assert.ok(kaynak.includes('window.tvStack'),
    'online çizici ortak yığın hesabını kullanmalı (görünüm birebir aynı olsun)');
  console.log('  ✓ C) online tavla çizicisi de aynı kuralları uyguluyor');

  win.close();
  server.close();
  console.log('OK tavla tahtası: fiziksel pul yığını + Türkçe "Kırık Taş Alanı" / "Taş Toplama Alanı"');
  process.exit(0);
}

main().catch(err => { console.error('❌ TAVLA TAHTA ARAYÜZ HATASI:', err); process.exit(1); });
