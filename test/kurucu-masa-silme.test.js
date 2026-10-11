'use strict';
/* ============================================================================
 * KURUCU PANELİ — MASA SATIRI SİLME (🗑)
 * ============================================================================
 * HATA (kullanıcı raporu): "kurucu panelindeki tüm oyunlarda masa
 * düzenlerinde masalar kaldırılmalı, sil veya çöp ikonuna tıklandığında
 * faaliyete geçmiyor."
 *
 * SEBEBİ: js/admin-panel.js dinleyicileri TEK TEK, yalnız o an var olan
 * [data-act] düğmelerine bağlıyordu. Masa satırları "✏️ Düzenle" ile
 * SONRADAN çiziliyor (paintTableRows); dolayısıyla 🗑 düğmeleri hiçbir zaman
 * bağlanmıyor, tıklama sessizce yutuluyordu. Görünürlük/➕/➖ düğmeleri ilk
 * çizimde var oldukları için çalışıyordu — hata yalnız satır içi 🗑'ta
 * görünüyordu, bu yüzden "bazıları çalışıyor" sanılıyordu.
 *
 * ÇÖZÜMÜ: olay DEVRİ (event delegation) — dinleyici panel gövdesine bir kez
 * takılır, sonradan çizilen düğmeler de çalışır.
 *
 * NE DOĞRULANIR
 *   1) Kaynak kodda tek tek bağlama YOK, devir VAR (hata geri dönmesin).
 *   2) Gerçek panelde: "Düzenle" ile açılan masa satırlarındaki 🗑
 *      tıklanınca DOĞRU satır siliniyor, sayaç düşüyor.
 *   3) Silme her oyun için çalışıyor (standart oyun + kart/masa oyunu).
 *   4) Silinen masa "Kaydet ve Uygula" sonrası sunucuda da yok oluyor.
 * ========================================================================= */
const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-masasil-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@kurucu.com';
process.env.GV_ADMIN_PASS = 'test-kurucu-sifresi-5512';

const assert = require('assert');
const serverModule = require('../server.js');
const KOK = path.join(__dirname, '..');
const oku = f => fs.readFileSync(path.join(KOK, f), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    try { const v = await fn(); if (v) return v; } catch (_) {}
    await sleep(150);
  }
  throw new Error('zaman aşımı: ' + label);
}

/* ------------------------------------------------------------- 1) KAYNAK */
function kaynakTesti() {
  const p = oku('js/admin-panel.js');
  assert.ok(/function aksiyonDevriKur/.test(p), 'olay devri kurucusu olmalı');
  assert.ok(/aksiyonDevriKur\(body\)/.test(p), 'panel gövdesine devir takılmalı');
  /* Tek tek bağlama GERİ GELMESİN: bu satır döndüğü an sonradan çizilen
     düğmeler yine ölü kalır. */
  assert.ok(!/querySelectorAll\('\[data-act\]'\)\.forEach\(btn => btn\.addEventListener/.test(p),
    'tek tek [data-act] bağlama geri gelmemeli — olay devri kullanılmalı');
  assert.ok(/data-act="delRow"/.test(p), 'satır silme düğmesi çizilmeli');
  /* Silinecek satırın indeksi denetlenmeli: -1/NaN splice(-1,1) ile YANLIŞ
     masayı silerdi. */
  assert.ok(/!\(i >= 0\) \|\| i >= cfg\.tables\.length/.test(p),
    'delRow indeksi denetlemeli (yanlış masa silinmesin)');
  console.log('  ✓ 1) kaynak: olay devri var, tek tek bağlama yok, indeks denetleniyor');
}

/* --------------------------------------------------------- 2-4) GERÇEK PANEL */
async function panelTesti() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const giris = await (await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'kurucu@kurucu.com', password: 'test-kurucu-sifresi-5512' })
  })).json();
  assert.ok(giris.token, 'kurucu girişi yapılmalı');

  const { JSDOM, VirtualConsole } = require('jsdom');
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE;
      w.fetch = (...a) => fetch(...a);
      try { w.localStorage.setItem('gv-auth-token', giris.token); } catch (_) {}
    }
  });
  const win = dom.window;
  await waitFor(() => (win.st && win.GV ? true : null), 20000, 'sayfa açılışı');
  await waitFor(() => (!win.st.isGuest && win.st.user ? true : null), 20000, 'kurucu girişi');
  const btn = await waitFor(() => win.document.getElementById('adminPanelBtn'), 20000, 'panel düğmesi');
  btn.click();
  await waitFor(() => {
    const m = win.document.getElementById('adminPanelModal');
    return (m && m.classList.contains('show')) ? m : null;
  }, 20000, 'panel açıldı');
  win.document.querySelector('.admin-tab[data-tab="games"]').click();
  await waitFor(() => {
    const b = win.document.getElementById('adminPanelBody');
    return (b && /OYUNLAR/.test(b.innerHTML)) ? b : null;
  }, 20000, 'Oyunlar sekmesi');

  /* Standart bir oyun (satranç) ve masası yönetilen bir oyun (okey):
     ikisinde de aynı 🗑 mantığı çalışmalı. */
  for (const gid of ['chess', 'okey', 'metropol']) {
    const duzenle = await waitFor(
      () => win.document.querySelector(`[data-act="editTables"][data-gid="${gid}"]`),
      10000, gid + ' için Düzenle düğmesi');
    duzenle.click();
    const satirlar = () => [...win.document.querySelectorAll(`[data-act="delRow"][data-gid="${gid}"]`)];
    await waitFor(() => (satirlar().length ? true : null), 10000, gid + ' masa satırları');

    const once = satirlar().length;
    assert.ok(once >= 3, gid + ' en az üç masa satırı olmalı — bulunan: ' + once);
    /* İKİNCİ satırı sil ve DOĞRU satırın gittiğini isimden doğrula. */
    const adlar = [...win.document.querySelectorAll(`[data-edit="name"][data-gid="${gid}"]`)].map(x => x.value);
    const silinecek = adlar[1];
    satirlar()[1].click();
    await waitFor(() => (satirlar().length === once - 1 ? true : null), 8000,
      gid + ': 🗑 tıklandı ama satır silinmedi (eski hata buydu)');
    const kalan = [...win.document.querySelectorAll(`[data-edit="name"][data-gid="${gid}"]`)].map(x => x.value);
    assert.strictEqual(kalan.length, once - 1, gid + ': bir satır eksilmeli');
    assert.ok(!kalan.includes(silinecek),
      gid + ': silinen masa ("' + silinecek + '") listede kalmamalı — YANLIŞ satır silinmiş olabilir');
    assert.deepStrictEqual(kalan, adlar.filter((_, i) => i !== 1),
      gid + ': yalnız tıklanan satır silinmeli, sıra bozulmamalı');
    duzenle.click();   // paneli kapat (sıradaki oyun için)
    await sleep(120);
  }
  console.log('  ✓ 2-3) 🗑 tıklanınca doğru masa satırı siliniyor (standart + kart + yeni oyun)');

  /* 4) Kaydet → sunucuda da yok olmalı. metropol'ün masa sayısı bir azalmış
     olmalı (12 → 11). */
  const oncekiMasa = (await (await fetch(BASE + '/api/rooms?gameId=metropol')).json()).rooms.length;
  win.document.getElementById('adminSaveBtn').click();
  const sonra = await waitFor(async () => {
    const r = (await (await fetch(BASE + '/api/rooms?gameId=metropol')).json()).rooms;
    return r.length < oncekiMasa ? r : null;
  }, 15000, 'kaydetme sunucuya yansımadı');
  assert.strictEqual(sonra.length, oncekiMasa - 1,
    'silinen masa sunucuda da gitmeli — önce ' + oncekiMasa + ', sonra ' + sonra.length);
  console.log('  ✓ 4) silme "Kaydet ve Uygula" ile sunucuya yansıyor (' +
    oncekiMasa + ' → ' + sonra.length + ' masa)');

  win.close();
  serverModule.io && serverModule.io.close();
  server.close();
}

(async () => {
  try {
    kaynakTesti();
    await panelTesti();
    console.log('OK kurucu masa silme: 🗑 her oyunda çalışıyor ve sunucuya yansıyor');
    process.exit(0);
  } catch (e) {
    console.error('MASA SİLME HATASI:', e && e.message);
    console.error(e && e.stack);
    process.exit(1);
  }
})();
