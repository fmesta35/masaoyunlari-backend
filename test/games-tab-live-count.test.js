'use strict';
/* ============================================================================
 * KURUCU PANELİ — OYUNLAR SEKMESİ: "+ Masa / − Masa" ANINDA SENKRON
 * ============================================================================
 * Kullanıcı raporu: "Kurucu panelinde masa sayıları, + masa veya - masa
 * tıklandığında değerleri senkron değişmiyor. tabloda değerlerin
 * değiştiğini görebileyim ki kaç olduğunu anlayım, ardından 'kaydet ve
 * uygula' butonuna bastıktan sonra uygulama yapılsın ve bundan sonra güncel
 * ayarlarıyla devam etsin. Eğer kaydet ve uygulaya basmadan çıkarsam bir
 * önceki mevcut ayarlarından devam etsin."
 *
 * Kök neden: js/admin-panel.js'te "+ Masa"/"− Masa" yalnız paintTableRows()
 * çağırıyordu — bu fonksiyon SADECE açık "Düzenle" masa listesini yeniden
 * çiziyor, oyun adının yanındaki "N masa" ÖZET rozetini GÜNCELLEMİYORDU
 * (o rozet yalnız renderGamesTab()'ın tek seferlik ilk çiziminde hesaplanır).
 * Ayrıca settingsCache modül-seviyesi bir değişken olup panel kapatılırken
 * SIFIRLANMIYORDU — bu yüzden "Kaydet ve Uygula"ya basmadan panel kapatılıp
 * yeniden açıldığında YARIM KALAN (kaydedilmemiş) değişiklikler görünmeye
 * devam ediyordu; oysa kullanıcı kaydetmeden çıkarsa son KAYITLI ayarlara
 * dönülmesini istiyor.
 *
 * Düzeltme: (1) "N masa" rozetine data-count="<gid>" eklendi,
 * addTable/delTable/delRow sonrası updateTableCount(gid) ile ANINDA
 * güncelleniyor; (2) panel KAYDETMEDEN kapatılırsa (✕ düğmesi veya arka
 * plana tıklama) settingsCache = null yapılıp bir sonraki açılışta ayarlar
 * sunucudan (son KAYITLI hâliyle) yeniden okunuyor.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-games-count-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@count.test';
process.env.GV_ADMIN_PASS = 'kurucu-test-sifresi-4471';

const assert = require('assert');
const serverModule = require('../server.js');

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function roomsOf(base, gid) {
  const r = await api(base, '/api/rooms?gameId=' + gid, null, 'GET');
  return r.rooms || [];
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const login = await api(BASE, '/api/auth/login', { email: 'kurucu@count.test', password: 'kurucu-test-sifresi-4471' }, 'POST');
  assert.ok(login.ok && login.token, 'kurucu girişi');
  assert.strictEqual((await roomsOf(BASE, 'chess')).length, 10, 'başlangıçta satranç 10 masa');

  const { JSDOM, VirtualConsole } = require('jsdom');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 15000)) {
      try { const v = await fn(); if (v) return v; } catch (_) {}
      await sleep(120);
    }
    throw new Error('zaman aşımı: ' + label);
  }
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE;
      w.fetch = (...a) => fetch(...a);
      try { w.localStorage.setItem('gv-auth-token', login.token); } catch (_) {}
    }
  });
  const win = dom.window;
  await waitFor(() => (win.st && win.GV ? true : null), 15000, 'sayfa açılışı');
  await waitFor(() => (!win.st.isGuest && win.st.user && win.st.user.email === 'kurucu@count.test' ? win.st.user : null), 15000, 'kurucu girişi');
  const btn = await waitFor(() => win.document.getElementById('adminPanelBtn'), 15000, '👑 Kurucu Paneli butonu');

  function openPanel() {
    btn.click();
    win.document.querySelector('.admin-tab[data-tab="games"]').click();
  }
  function closeWithoutSaving() {
    // "✕" düğmesi — kaydetmeden kapatma yolu:
    const modal = win.document.getElementById('adminPanelModal');
    const x = Array.from(modal.querySelectorAll('button')).find(b => b.textContent.trim() === '✕');
    assert.ok(x, '✕ kapatma düğmesi bulunmalı');
    x.click();
  }
  function countBadge() { return win.document.querySelector('[data-count="chess"]'); }
  function addBtn() { return win.document.querySelector('[data-act="addTable"][data-gid="chess"]'); }
  function delBtn() { return win.document.querySelector('[data-act="delTable"][data-gid="chess"]'); }

  // ---------- 1) panel açılır, satranç başlangıç rozeti "10 masa" ----------
  openPanel();
  await waitFor(() => (countBadge() && /10 masa/.test(countBadge().textContent) ? true : null), 15000, 'ilk rozet "10 masa"');
  console.log('  ✓ 1) Oyunlar sekmesi açıldı; satranç rozeti başlangıçta "10 masa" gösteriyor');

  // ---------- 2) "+ Masa" → rozet ANINDA "11 masa", "12 masa", "13 masa" ----------
  addBtn().click();
  assert.ok(/11 masa/.test(countBadge().textContent), '+ Masa sonrası rozet ANINDA 11 masa göstermeli: ' + countBadge().textContent);
  addBtn().click();
  addBtn().click();
  assert.ok(/13 masa/.test(countBadge().textContent), '3× + Masa sonrası rozet 13 masa: ' + countBadge().textContent);
  console.log('  ✓ 2) "+ Masa" tıklanınca "N masa" rozeti ANINDA (yeniden açmadan) güncelleniyor');

  // ---------- 3) "− Masa" → rozet ANINDA azalır ----------
  delBtn().click();
  assert.ok(/12 masa/.test(countBadge().textContent), '− Masa sonrası rozet ANINDA 12 masa göstermeli: ' + countBadge().textContent);
  console.log('  ✓ 3) "− Masa" tıklanınca rozet ANINDA azalıyor');

  // Sunucuya HENÜZ hiçbir şey gitmedi (Kaydet'e basılmadı):
  assert.strictEqual((await roomsOf(BASE, 'chess')).length, 10, 'Kaydet\'e basılmadan sunucudaki masa sayısı DEĞİŞMEMELİ (10)');
  console.log('  ✓ 4) "Kaydet ve Uygula"ya basılmadan değişiklik yalnız istemcide kalıyor, sunucuya yansımıyor');

  // ---------- 5) Kaydetmeden panel kapatılıp yeniden açılırsa: son KAYITLI ayarlara döner ----------
  closeWithoutSaving();
  await waitFor(() => {
    const m = win.document.getElementById('adminPanelModal');
    return (m && !m.classList.contains('show')) ? true : null;
  }, 15000, 'panel kapandı');
  openPanel();
  await waitFor(() => (countBadge() && /\d+ masa/.test(countBadge().textContent) ? true : null), 15000, 'rozet yeniden çizildi');
  assert.ok(/10 masa/.test(countBadge().textContent),
    'kaydetmeden çıkıp yeniden açınca rozet son KAYITLI değere (10 masa) dönmeli, yarım kalan değişiklik taşınmamalı: ' + countBadge().textContent);
  console.log('  ✓ 5) "Kaydet ve Uygula"ya basmadan panel kapatılıp yeniden açılınca son kayıtlı ayar (10 masa) geri geliyor');

  // ---------- 6) şimdi + Masa yapıp GERÇEKTEN kaydet → sunucuya yansır, panel kapatılıp açılınca da kalıcı değer görünür ----------
  addBtn().click();
  addBtn().click();
  assert.ok(/12 masa/.test(countBadge().textContent), 'kayıt öncesi rozet 12 masa: ' + countBadge().textContent);
  const saveBtn = win.document.getElementById('adminSaveBtn');
  assert.ok(saveBtn, 'Kaydet ve Uygula düğmesi bulunmalı');
  saveBtn.click();
  await waitFor(async () => ((await roomsOf(BASE, 'chess')).length === 12 ? true : null), 15000, 'sunucuda satranç 12 masa oldu');
  console.log('  ✓ 6) "Kaydet ve Uygula" ile değişiklik sunucuya kalıcı olarak yansıdı (satranç 12 masa)');

  closeWithoutSaving();
  await waitFor(() => {
    const m = win.document.getElementById('adminPanelModal');
    return (m && !m.classList.contains('show')) ? true : null;
  }, 15000, 'panel kapandı (2)');
  openPanel();
  await waitFor(() => (countBadge() && /\d+ masa/.test(countBadge().textContent) ? true : null), 15000, 'rozet yeniden çizildi (2)');
  assert.ok(/12 masa/.test(countBadge().textContent), 'kayıttan sonra panel yeniden açılınca GÜNCEL (kaydedilmiş) değer 12 masa görünmeli: ' + countBadge().textContent);
  console.log('  ✓ 7) Kayıttan sonra panel yeniden açılınca artık GÜNCEL (kaydedilmiş) ayarla devam ediyor');

  console.log('\n✅ GAMES-TAB-LIVE-COUNT: "+ Masa/− Masa" rozeti anında senkron; kaydetmeden çıkış son kayıtlı ayarı korur; kayıt kalıcı uygulanır');
  win.close();
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ games-tab-live-count.test.js HATA:', e); process.exit(1); });
