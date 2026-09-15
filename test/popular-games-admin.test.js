'use strict';

/*
 * POPÜLER OYUN SIRALAMASI (Kurucu Paneli) — kullanıcı isteği:
 *  "popüler oyun sıralaması - kurucu tarafından kurucu panelinde
 *   sıralansın (kaç oyun gösterileceği dahil)."
 *
 * Varsayılan davranış DEĞİŞMEDİ: ana sayfa 'auto' modda GERÇEK oynanma
 * sayısına göre sıralanır (bkz. test/home-popular-games.test.js). Bu test
 * yeni 'manual' modu doğrular:
 *
 *  1) /api/games-meta varsayılanda popular:{mode:'auto',order:[],count:0}
 *     döndürür (site davranışı değişmedi).
 *  2) Yalnız KURUCU /api/admin/tables-apply ile popüler sıralamayı
 *     'manual' moda alıp elle bir sıra + gösterilecek oyun sayısını (count)
 *     kaydedebilir; sunucu geçersiz/eksik girdiyi TEMİZLER (bilinmeyen oyun
 *     id'leri, tekrarlar, aralık dışı count).
 *  3) Değişiklik hem /api/games-meta (KAMU) hem /api/admin/tables
 *     (yönetici) uçlarına anında yansır.
 *  4) DATAYA kaydedilir: sunucu aynı DB ile yeniden başlatıldığında ayar
 *     korunur.
 *  5) Ana sayfa (jsdom): 'manual' moddayken kartlar kurucunun belirlediği
 *     sırada VE yalnızca `count` kadar gösterilir — gerçek oynanma sayısı
 *     bu modda sıralamayı ETKİLEMEZ (sırada olmayan oyunlar varsa onlar
 *     gerçek sayıya göre sona eklenir).
 *  6) Kurucu Paneli → Oyunlar sekmesinde "Popüler Oyun Sıralaması" bölümü
 *     var: Otomatik/Manuel anahtarı + ▲/▼ ile sıralama + "Kaydet ve
 *     Uygula" ile kalıcı olur ve ana sayfaya anında yansır.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-popadmin-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@kurucu.com';
process.env.GV_ADMIN_PASS = 'test-kurucu-sifresi-9271';
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');
const playCounts = require('../play-counts');

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function main() {
  // Ana sayfanın (auto moddaki) sıralamasını da doğrulayabilmek için birkaç
  // oyuna gerçek oynanma sayısı veriyoruz (home-popular-games.test.js'teki
  // gibi): manual moda GEÇMEDEN önceki/sonraki davranış farkını netleştirir.
  playCounts.bump('reversi'); playCounts.bump('reversi'); playCounts.bump('reversi'); // 3 — sırada olmayan oyun

  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1) varsayılan: auto, boş sıra, count 0 (tümü) ----------
  const meta0 = await api(BASE, '/api/games-meta', null, 'GET');
  assert.ok(meta0.ok, 'games-meta yanıt verir');
  assert.deepStrictEqual(meta0.popular, { mode: 'auto', order: [], count: 0 }, 'varsayılan popüler ayar: auto/boş sıra/tümü');
  console.log('  ✓ 1) /api/games-meta varsayılanda popular:{mode:auto,order:[],count:0} döndürür — site davranışı değişmedi');

  // ---------- 2) kurucu girişi ----------
  const login = await api(BASE, '/api/auth/login', { email: 'kurucu@kurucu.com', password: 'test-kurucu-sifresi-9271' }, 'POST');
  assert.ok(login.ok && login.token, 'kurucu girişi');
  const other = await api(BASE, '/api/auth/register', { name: 'Basit', email: 'basit@padm.tr', password: 'ortaksifre9' }, 'POST');
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(other.userId).verify_token;
  await api(BASE, '/api/auth/verify', { token: vt }, 'POST');
  const otherLogin = await api(BASE, '/api/auth/login', { email: 'basit@padm.tr', password: 'ortaksifre9' }, 'POST');

  // ---------- 3) yalnız kurucu sıralamayı değiştirebilir; girdi temizlenir ----------
  const denied = await api(BASE, '/api/admin/tables-apply', {
    games: { _popular: { mode: 'manual', order: ['dama', 'chess'], count: 2 } }
  }, 'POST', otherLogin.token);
  assert.strictEqual(denied.status, 403, 'kurucu olmayan üye popüler sıralamayı değiştiremez (403)');
  assert.deepStrictEqual((await api(BASE, '/api/games-meta', null, 'GET')).popular, { mode: 'auto', order: [], count: 0 }, 'yetkisiz deneme hiçbir şeyi değiştirmedi');

  const dirty = await api(BASE, '/api/admin/tables-apply', {
    games: {
      _popular: {
        mode: 'manual',
        // bilinmeyen oyun ('uzaygemisi') + tekrar ('dama' iki kez) + geçersiz tip → hepsi temizlenmeli
        order: ['dama', 'chess', 'uzaygemisi', 'dama', 'okey', 42],
        count: 999 // aralık dışı (13'ten büyük) → sunucu 0'a (tümü) düşürmeli
      }
    }
  }, 'POST', login.token);
  assert.ok(dirty.ok, 'kurucu isteği kabul edilir');
  assert.deepStrictEqual(dirty.popular.order, ['dama', 'chess', 'okey'], 'bilinmeyen oyun + tekrar temizlendi, geçerli sıra korundu');
  assert.strictEqual(dirty.popular.count, 0, 'aralık dışı (999) count sıfıra (tümü) düşürüldü');
  assert.strictEqual(dirty.popular.mode, 'manual', 'mod manuel olarak kaydedildi');
  console.log('  ✓ 2) yalnız kurucu değiştirebilir; bilinmeyen oyun/tekrar/aralık-dışı count sunucuda temizleniyor');

  // ---------- 4) geçerli bir manuel sıra + count uygula ----------
  const apply = await api(BASE, '/api/admin/tables-apply', {
    games: { _popular: { mode: 'manual', order: ['dama', 'chess', 'bilardo'], count: 2 } }
  }, 'POST', login.token);
  assert.ok(apply.ok);
  assert.deepStrictEqual(apply.popular, { mode: 'manual', order: ['dama', 'chess', 'bilardo'], count: 2 }, 'tables-apply yanıtı normalize edilmiş popüler ayarı döndürür');

  const meta1 = await api(BASE, '/api/games-meta', null, 'GET');
  assert.deepStrictEqual(meta1.popular, { mode: 'manual', order: ['dama', 'chess', 'bilardo'], count: 2 }, 'games-meta (KAMU) anında yansıdı');
  const adminTables = await api(BASE, '/api/admin/tables', null, 'GET', login.token);
  assert.deepStrictEqual(adminTables.popular, { mode: 'manual', order: ['dama', 'chess', 'bilardo'], count: 2 }, '/api/admin/tables (yönetici) da popüler ayarı taşır');
  console.log('  ✓ 3) geçerli manuel sıra + count hem /api/games-meta hem /api/admin/tables\'a anında yansıdı');

  // ---------- 5) kalıcılık: aynı DB ile yeniden başlat ----------
  serverModule.io.close();
  await new Promise(r => server.close(r));
  const server2 = await serverModule.start(0);
  const BASE2 = 'http://127.0.0.1:' + server2.address().port;
  const meta2 = await api(BASE2, '/api/games-meta', null, 'GET');
  assert.deepStrictEqual(meta2.popular, { mode: 'manual', order: ['dama', 'chess', 'bilardo'], count: 2 }, 'yeniden başlatmada popüler ayar korunuyor (SQLite settings)');
  console.log('  ✓ 4) popüler oyun sıralaması dataya kaydedildi: yeniden başlatmada aynı ayar');

  // ---------- 6) ana sayfa (jsdom): manuel sıra + count uygulanıyor ----------
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
  vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE2 + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE2;
      // Node'un çıplak fetch'i göreli URL'leri ("/api/...") belge konumuna
      // göre çözemez (tarayıcının aksine) — bkz. home-popular-games.test.js.
      w.fetch = (url, opts) => fetch(typeof url === 'string' && url.charAt(0) === '/' ? BASE2 + url : url, opts);
    }
  });
  const win = dom.window;
  await waitFor(() => win.st && win.GV, 15000, 'ana sayfa açılışı');
  await waitFor(() => {
    const ids = [...win.document.querySelectorAll('#homeGames .game-card')].map(e => e.dataset.g);
    return ids.length === 2 ? ids : null;
  }, 15000, 'manuel sırayla yalnızca 2 kart gösterilsin');
  const homeIds = [...win.document.querySelectorAll('#homeGames .game-card')].map(e => e.dataset.g);
  assert.deepStrictEqual(homeIds, ['dama', 'chess'], 'ana sayfa kurucunun belirlediği sırada (dama, chess) ve yalnız 2 tane gösteriyor: ' + homeIds.join(','));
  // reversi (gerçek oynanma sayısı 3, auto modda ilk sıraya girerdi) manuel
  // moddayken sıra dışı kaldığı ve count=2 olduğu için hiç görünmemeli:
  assert.ok(!homeIds.includes('reversi'), 'manuel moddayken sırada/gösterimde olmayan oyun (reversi) ana sayfada YOK');
  console.log('  ✓ 5) ana sayfa manuel sırayı ve gösterilecek oyun sayısını (count) uyguluyor; gerçek oynanma sayısı bu modda sıralamayı ezmiyor');

  // ---------- 7) Kurucu Paneli: Popüler Oyun Sıralaması bölümü + ▲/▼ + Kaydet ----------
  const dom2 = await JSDOM.fromURL(BASE2 + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE2;
      w.fetch = (url, opts) => fetch(typeof url === 'string' && url.charAt(0) === '/' ? BASE2 + url : url, opts);
      try { w.localStorage.setItem('gv-auth-token', login.token); } catch (_) {}
    }
  });
  const win2 = dom2.window;
  await waitFor(() => (!win2.st.isGuest && win2.st.user && win2.st.user.email === 'kurucu@kurucu.com' ? win2.st.user : null), 15000, 'kurucu otomatik girişi');
  const btn = await waitFor(() => win2.document.getElementById('adminPanelBtn'), 15000, '👑 Kurucu Paneli butonu');
  btn.click();
  win2.document.querySelector('.admin-tab[data-tab="games"]').click();
  const body2 = await waitFor(() => {
    const b = win2.document.getElementById('adminPanelBody');
    return (b && /Popüler Oyun Sıralaması/.test(b.innerHTML) && b.querySelector('#popCountInput')) ? b : null;
  }, 15000, 'Oyunlar sekmesinde Popüler Oyun Sıralaması bölümü');
  // sunucudan yüklenen ayar 'manual' idi → sıra listesi görünür olmalı:
  const orderRows = await waitFor(() => {
    const rows = body2.querySelectorAll('#popOrderList > div');
    return rows.length ? rows : null;
  }, 15000, 'manuel sıra listesi (▲/▼ satırları) çizilsin');
  assert.ok(orderRows.length >= 13, 'sırada olmayan oyunlar da listenin sonuna otomatik eklenir (13 oyunun tamamı listede)');
  console.log('  ✓ 6) panelde Popüler Oyun Sıralaması bölümü: mevcut manuel ayar (dama, chess, bilardo, ...) doğru çiziliyor');

  // "chess" satırındaki ▲ düğmesine bas → dama ile chess yer değiştirmeli (chess artık 1.):
  const chessRow = [...body2.querySelectorAll('#popOrderList > div')].find(r => /Satranç/.test(r.textContent));
  assert.ok(chessRow, 'Satranç satırı listede bulunmalı');
  chessRow.querySelector('[data-act="popUp"]').click();
  await sleep(50);
  const newFirst = body2.querySelector('#popOrderList > div');
  assert.ok(/Satranç/.test(newFirst.textContent), '▲ ile Satranç ilk sıraya taşındı: ' + newFirst.textContent);
  console.log('  ✓ 7) ▲ düğmesi sırayı gerçekten değiştiriyor (Satranç ilk sıraya taşındı)');

  // Kaydet ve Uygula → sunucuya işlenip ana sayfaya yansımalı:
  const saveBtn = win2.document.getElementById('adminSaveBtn');
  assert.ok(saveBtn, 'Kaydet ve Uygula düğmesi var');
  saveBtn.click();
  await waitFor(async () => {
    const m = await api(BASE2, '/api/games-meta', null, 'GET');
    return (m.popular && m.popular.order[0] === 'chess') ? m : null;
  }, 15000, 'yeni sıra sunucuya kaydedilsin');
  const metaFinal = await api(BASE2, '/api/games-meta', null, 'GET');
  assert.strictEqual(metaFinal.popular.order[0], 'chess', 'kaydettikten sonra sunucudaki sıra da Satranç ile başlıyor: ' + metaFinal.popular.order.join(','));
  console.log('  ✓ 8) "Kaydet ve Uygula" yeni sırayı kalıcı olarak sunucuya yazıyor');

  win.close(); win2.close();
  serverModule.io && serverModule.io.close();
  server2.close();
  console.log('\n✅ POPÜLER OYUN SIRALAMASI: kurucu paneli manuel sıra/sayı + ana sayfa uygulaması uçtan uca doğru');
  process.exit(0);
}

main().catch(e => { console.error('❌ POPÜLER OYUN SIRALAMASI TEST HATASI:', e); process.exit(1); });
