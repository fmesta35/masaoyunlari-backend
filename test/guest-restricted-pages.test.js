'use strict';

/*
 * İSTATİSTİKLER / SIRALAMA / RÜTBELER — yalnız üyelere açık.
 *
 *  Kullanıcı raporu: "giriş yapmayan oyuncuların istatistikler bölümünü
 *  görmesine gerek yok. Sıralama değerlerini de göremez, rütbe değerlerini
 *  de göremez."
 *
 *  Bu test: ZİYARETÇİ için üst menü + sol/mobil menüdeki bu 3 düğmenin
 *  gizlendiğini, programatik GV.page('stats'|'lb'|'ranks') çağrısının
 *  sayfayı DEĞİŞTİRMEDİĞİNİ (guestPromptModal açtığını) doğrular; ÜYE için
 *  ise düğmelerin görünür olduğunu ve sayfaların normal açıldığını doğrular.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-restrict-'));

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

async function pencere(base, token) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = base; w.fetch = (...a) => fetch(...a);
      if (token) try { w.localStorage.setItem('gv-auth-token', token); } catch (_) {}
    }
  });
  const win = dom.window;
  await bekle(() => win.st && win.GV, 20000, 'sayfa açılışı');
  return win;
}

async function api(base, p, body) {
  const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- ZİYARETÇİ ----------
  const g = await pencere(BASE);
  await bekle(() => g.st.isGuest === true, 10000, 'ziyaretçi hâli');
  ['stats', 'lb', 'ranks'].forEach(p => {
    const navBtn = g.document.querySelector('.nav-btn[data-p="' + p + '"]');
    const sbBtn = g.document.querySelector('.sb-nav-item[data-p="' + p + '"]');
    assert.ok(navBtn, p + ': üst menü düğmesi DOM\'da olmalı (gizlense de var olmalı)');
    assert.strictEqual(navBtn.style.display, 'none', p + ': üst menüde ziyaretçiye gizli olmalı');
    assert.ok(sbBtn, p + ': sol/mobil menü düğmesi DOM\'da olmalı');
    assert.strictEqual(sbBtn.style.display, 'none', p + ': sol/mobil menüde ziyaretçiye gizli olmalı');
  });
  console.log('  ✓ 1) ziyaretçiye İstatistikler/Sıralama/Rütbeler düğmeleri (üst + yan menü) gizli');

  for (const p of ['stats', 'lb', 'ranks']) {
    g.st.curPage = 'home'; // her denemeden önce sıfırla
    const modal = g.document.getElementById('guestPromptModal');
    modal.classList.remove('show');
    g.GV.page(p);
    await bekle(() => modal.classList.contains('show'), 5000, p + ': guestPromptModal açılmalı');
    assert.notStrictEqual(g.st.curPage, p, p + ': ziyaretçi sayfaya GEÇMEMELİ');
    assert.ok(!g.document.getElementById('pg-' + p).classList.contains('active'), p + ': sayfa aktifleşmemeli');
  }
  console.log('  ✓ 2) ziyaretçi programatik olarak da bu sayfalara geçemiyor — üyelik daveti çıkıyor');
  g.close();

  // ---------- ÜYE ----------
  const reg = await api(BASE, '/api/auth/register', { name: 'GercekUye', email: 'gercek2@test.com', password: 'sifre1234' });
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId);
  await api(BASE, '/api/auth/verify', { token: row.verify_token });
  const log = await api(BASE, '/api/auth/login', { email: 'gercek2@test.com', password: 'sifre1234' });

  const u = await pencere(BASE, log.token);
  await bekle(() => u.st.isGuest === false && u.st.user && u.st.user.name === 'GercekUye', 15000, 'üye girişi');
  ['stats', 'lb', 'ranks'].forEach(p => {
    const navBtn = u.document.querySelector('.nav-btn[data-p="' + p + '"]');
    assert.notStrictEqual(navBtn.style.display, 'none', p + ': üyeye görünür olmalı');
  });
  console.log('  ✓ 3) üyeye düğmeler görünür');

  for (const p of ['stats', 'lb', 'ranks']) {
    u.st.curPage = 'home';
    u.document.querySelectorAll('.page.active').forEach(e => e.classList.remove('active'));
    u.GV.page(p);
    await bekle(() => u.st.curPage === p, 5000, p + ': üye sayfaya geçebilmeli');
    assert.ok(u.document.getElementById('pg-' + p).classList.contains('active'), p + ': üye için sayfa aktifleşmeli');
  }
  console.log('  ✓ 4) üye bu üç sayfaya da normal şekilde geçebiliyor');
  u.close();

  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK ziyaretçi kısıtlaması: İstatistikler/Sıralama/Rütbeler yalnız üyelere açık');
  process.exit(0);
}

main().catch(e => { console.error('❌ ZİYARETÇİ KISITLAMA TEST HATASI:', e); process.exit(1); });
