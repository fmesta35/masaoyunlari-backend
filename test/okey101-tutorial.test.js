'use strict';

/*
 * 101 OKEY ÖĞRENME MODU (madde 7'nin son kısmı) — kullanıcı isteği:
 * "Böyle bir öğrenme modu ekleyebilirsin farklı karakter ile."
 *
 *  Bu test: 101 Okey odasında "🦉 101 Okey Dersi" düğmesinin göründüğünü
 *  (ve klasik Okey/başka oyunlarda GİZLİ olduğunu), tıklanınca ORİJİNAL
 *  karakterle (Bilge Baykuş) çok adımlı bir modal açtığını, İleri/Geri
 *  gezinmenin adım sayacını doğru güncellediğini, son adımda "Bitti"
 *  butonunun modalı kapattığını ve mini sınavın doğru/yanlış geri bildirim
 *  verdiğini doğrular.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-tutorial-'));

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    try { const v = fn(); if (v) return v; } catch (_) {}
    await sleep(100);
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

function click(win, el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true })); }

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const w = await pencere(BASE);

  // ---------- 1) klasik Okey masasında ders düğmesi GİZLİ ----------
  w.st.curGame = 'okey';
  w.GV.joinRoom('tut-okey-room');
  await bekle(() => w.document.getElementById('pg-room').classList.contains('active'), 10000, 'oda sayfası açılmalı');
  const tutBtnOkey = w.document.getElementById('gv101TutorBtn');
  assert.ok(tutBtnOkey, 'düğme DOM\'da olmalı (gizlense de var)');
  assert.strictEqual(tutBtnOkey.style.display, 'none', 'klasik Okey\'de ders düğmesi GİZLİ olmalı');
  console.log('  ✓ 1) klasik Okey masasında "101 Okey Dersi" düğmesi gizli');

  // ---------- 2) 101 Okey masasında ders düğmesi GÖRÜNÜR ----------
  w.st.curGame = 'okey101';
  w.GV.joinRoom('tut-101-room');
  await bekle(() => w.document.getElementById('pg-room').classList.contains('active'), 10000, 'oda sayfası açılmalı');
  const tutBtn = w.document.getElementById('gv101TutorBtn');
  assert.notStrictEqual(tutBtn.style.display, 'none', '101 Okey\'de ders düğmesi GÖRÜNÜR olmalı');
  console.log('  ✓ 2) 101 Okey masasında "101 Okey Dersi" düğmesi görünür');

  // ---------- 3) tıklayınca ORİJİNAL karakterle modal açılır ----------
  click(w, tutBtn);
  const modal = await bekle(() => {
    const m = w.document.getElementById('okeyTutorModal');
    return m && m.classList.contains('show') ? m : null;
  }, 5000, 'öğrenme modu modalı açılmalı');
  assert.ok(/Bilge Baykuş/.test(modal.textContent), 'modal orijinal karakteri (Bilge Baykuş) tanıtmalı');
  assert.ok(/🦉/.test(modal.textContent), 'modalda maskot emojisi olmalı');
  assert.ok(/Adım 1\/7/.test(w.document.getElementById('gvTutStep').textContent), 'adım sayacı 1/7 ile başlamalı');
  console.log('  ✓ 3) düğme tıklanınca orijinal karakterle (Bilge Baykuş) öğrenme modu açılıyor');

  // ---------- 4) İleri/Geri gezinme adım sayacını doğru güncelliyor ----------
  w.GV.tutorNav(1);
  assert.ok(/Adım 2\/7/.test(w.document.getElementById('gvTutStep').textContent), 'ileri → adım 2/7');
  w.GV.tutorNav(1);
  assert.ok(/Adım 3\/7/.test(w.document.getElementById('gvTutStep').textContent), 'ileri → adım 3/7');
  w.GV.tutorNav(-1);
  assert.ok(/Adım 2\/7/.test(w.document.getElementById('gvTutStep').textContent), 'geri → adım 2/7');
  console.log('  ✓ 4) İleri/Geri gezinme adım sayacını doğru güncelliyor');

  // ---------- 5) 4. adımda 12-13-1 istisnası anlatılıyor (kural doğruluğu) ----------
  w.GV.tutorNav(1); w.GV.tutorNav(1); // 2→3→4
  assert.ok(/Adım 4\/7/.test(w.document.getElementById('gvTutStep').textContent));
  const step4Text = w.document.getElementById('gvTutBody').textContent;
  assert.ok(/12-13-1/.test(step4Text) && /101 Okey/.test(step4Text), '4. adımda 12-13-1 istisnası anlatılmalı: ' + step4Text.slice(0, 200));
  console.log('  ✓ 5) 4. adım 12-13-1 dönüşümlü seri istisnasını doğru anlatıyor (motorla tutarlı)');

  // ---------- 6) son adımda (7) mini sınav + doğru/yanlış geri bildirim ----------
  w.GV.tutorNav(1); w.GV.tutorNav(1); w.GV.tutorNav(1); // 4→5→6→7
  assert.ok(/Adım 7\/7/.test(w.document.getElementById('gvTutStep').textContent), 'son adım 7/7 olmalı');
  assert.ok(/Bitti/.test(w.document.getElementById('gvTutNext').innerHTML), 'son adımda buton "Bitti" olmalı');
  w.GV.tutorQuiz(true); // doğru cevap: geçersiz (12-13-1 101'de geçersiz)
  await bekle(() => /Doğru/.test(w.document.getElementById('gvTutQuizResult').textContent), 3000, 'doğru cevap geri bildirimi');
  w.GV.tutorQuiz(false); // yanlış cevap
  await bekle(() => /Hayır/.test(w.document.getElementById('gvTutQuizResult').textContent), 3000, 'yanlış cevap geri bildirimi');
  console.log('  ✓ 6) mini sınav doğru/yanlış cevaplara uygun geri bildirim veriyor');

  // ---------- 7) son adımda "Bitti" modalı kapatır ----------
  w.GV.tutorNav(1);
  await bekle(() => !w.document.getElementById('okeyTutorModal').classList.contains('show'), 3000, '"Bitti" modalı kapatmalı');
  console.log('  ✓ 7) son adımda "Bitti, Anladım!" modalı kapatıyor');

  try { w.close(); } catch (_) {}
  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK 101 Okey öğrenme modu: orijinal karakter + adım adım anlatım + mini sınav');
  process.exit(0);
}

main().catch(e => { console.error('❌ 101 OKEY ÖĞRENME MODU TEST HATASI:', e); process.exit(1); });
