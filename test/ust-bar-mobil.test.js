'use strict';
/* ============================================================================
 * ÜST BAR — MOBİLDE TEMA DÜĞMESİ ve BİLDİRİM ZİLİ
 * ============================================================================
 * Kullanıcı raporu (verbatim):
 *   "mobil görünümde sağ üst menüde karanlık aydınlık tema butonu var,
 *    mobilde zaten üç çizgi içerisine seçenek olarak koymuşsun o yüzden sağ
 *    üst menüdeki görünen butonu kaldır."
 *   "Mobilde sağ üst menüde Giriş yapmayan kullanıcılara da bildirim ikonu
 *    gözüküyor, Ancak giriş yaptıktan sonra bildirim ikonu gözüksün."
 *
 * DOĞRULANAN:
 *   1) Telefon genişliğinde (≤800 px) üst bardaki #themeBtn gizli, hamburger
 *      menüsündeki #sbThemeBtn yerinde ve çalışır durumda.
 *   2) Masaüstü genişliğinde #themeBtn görünmeye devam ediyor.
 *   3) Bildirim zili (#notifWrap) ziyaretçide gizli, üye girişinde görünür —
 *      hem telefonda hem masaüstünde.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium = null;
try { chromium = require('playwright').chromium; }
catch (_) { try { chromium = require('/home/claude/node_modules/playwright').chromium; } catch (_) {} }
if (!chromium) { console.log('ATLANDI üst bar mobil (playwright yok)'); process.exit(0); }
const KROM = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome']
  .find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });

process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-ustbar-'));
const assert = require('assert');
const serverModule = require('../server.js');
const uyu = ms => new Promise(r => setTimeout(r, ms));

async function api(base, p, body) {
  const r = await fetch(base + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  return r.json().catch(() => ({}));
}

async function ac(tr, BASE, vp, token) {
  const ctx = await tr.newContext({ viewport: vp });
  if (token) {
    await ctx.addInitScript(t => {
      try { localStorage.setItem('gv-auth-token', t); } catch (_) {}
    }, token);
  }
  const p = await ctx.newPage();
  await p.goto(BASE + '/index.html');
  await p.waitForFunction(() => window.GV && window.st, null, { timeout: 30000 });
  await uyu(900);
  return { ctx, p };
}

const gorunur = (p, sec) => p.evaluate(s => {
  const e = document.querySelector(s);
  if (!e) return { var: false };
  const g = getComputedStyle(e);
  const b = e.getBoundingClientRect();
  return { var: true, display: g.display, gorunurluk: g.visibility,
           g: Math.round(b.width), y: Math.round(b.height) };
}, sec);

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const tr = await chromium.launch(
    Object.assign({ args: ['--no-sandbox'] }, KROM ? { executablePath: KROM } : {}));
  let kontrol = 0;

  // ---------- 1) TELEFON — ZİYARETÇİ ----------
  {
    const { ctx, p } = await ac(tr, BASE, { width: 390, height: 844 });
    await p.waitForFunction(() => window.st && window.st.isGuest === true, null, { timeout: 12000 });

    const tema = await gorunur(p, '#themeBtn');
    assert.ok(tema.var, 'telefon: #themeBtn DOM\'da kalmalı (yalnız gizlenir)');
    assert.strictEqual(tema.display, 'none',
      'telefon: üst bardaki tema düğmesi GİZLİ olmalı — display: ' + tema.display);

    const sbTema = await gorunur(p, '#sbThemeBtn');
    assert.ok(sbTema.var && sbTema.display !== 'none',
      'telefon: hamburger menüsündeki "Görünümü Değiştir" düğmesi yerinde olmalı');

    // Menüdeki düğme gerçekten temayı değiştiriyor mu?
    const oncesi = await p.evaluate(() => window.st.theme);
    await p.evaluate(() => document.getElementById('sbThemeBtn').click());
    await uyu(250);
    const sonrasi = await p.evaluate(() => window.st.theme);
    assert.notStrictEqual(sonrasi, oncesi,
      'telefon: menüdeki görünüm düğmesi temayı değiştirmeli (' + oncesi + ' → ' + sonrasi + ')');

    const zil = await gorunur(p, '#notifWrap');
    assert.ok(zil.var, 'telefon: bildirim kutusu DOM\'da olmalı');
    assert.strictEqual(zil.display, 'none',
      'telefon / ziyaretçi: bildirim zili GİZLİ olmalı — display: ' + zil.display);
    kontrol += 5;
    console.log('  ✓ 1) telefon/ziyaretçi: tema düğmesi üst barda yok, menüde var ve çalışıyor; ' +
                'bildirim zili gizli');
    await ctx.close();
  }

  // ---------- 2) MASAÜSTÜ — ZİYARETÇİ ----------
  {
    const { ctx, p } = await ac(tr, BASE, { width: 1440, height: 900 });
    const tema = await gorunur(p, '#themeBtn');
    assert.notStrictEqual(tema.display, 'none',
      'masaüstü: tema düğmesi üst barda KALMALI — display: ' + tema.display);
    const zil = await gorunur(p, '#notifWrap');
    assert.strictEqual(zil.display, 'none',
      'masaüstü / ziyaretçi: bildirim zili gizli olmalı');
    kontrol += 2;
    console.log('  ✓ 2) masaüstü/ziyaretçi: tema düğmesi yerinde, bildirim zili gizli');
    await ctx.close();
  }

  // ---------- 3) ÜYE GİRİŞİ ----------
  const reg = await api(BASE, '/api/auth/register',
    { name: 'ZilUye', email: 'zil@test.com', password: 'sifre1234' });
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId);
  await api(BASE, '/api/auth/verify', { token: row.verify_token });
  const log = await api(BASE, '/api/auth/login', { email: 'zil@test.com', password: 'sifre1234' });
  assert.ok(log && log.token, 'test kurulumu: üye girişi anahtarı alınmalı');

  for (const [ad, vp] of [['telefon', { width: 390, height: 844 }],
                          ['masaüstü', { width: 1440, height: 900 }]]) {
    const { ctx, p } = await ac(tr, BASE, vp, log.token);
    await p.waitForFunction(() => window.st && window.st.isGuest === false, null, { timeout: 15000 });
    await uyu(400);
    const zil = await gorunur(p, '#notifWrap');
    assert.notStrictEqual(zil.display, 'none',
      ad + ' / üye: bildirim zili GÖRÜNMELİ — display: ' + zil.display);
    assert.ok(zil.g > 0 && zil.y > 0, ad + ' / üye: bildirim zili ölçülebilir boyda olmalı');
    if (ad === 'telefon') {
      const tema = await gorunur(p, '#themeBtn');
      assert.strictEqual(tema.display, 'none',
        'telefon / üye: tema düğmesi yine üst barda olmamalı');
      kontrol += 1;
    }
    kontrol += 2;
    console.log('  ✓ ' + (ad === 'telefon' ? '3' : '4') + ') ' + ad +
                '/üye: bildirim zili görünür (' + zil.g + '×' + zil.y + ')');
    await ctx.close();
  }

  await tr.close(); server.close();
  console.log('OK üst bar mobil (' + kontrol + ' kontrol)');
  process.exit(0);
}
main().catch(e => { console.error('❌ ÜST BAR HATASI:', e.message); process.exit(1); });
