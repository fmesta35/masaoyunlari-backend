'use strict';

/*
 * YÖNCÜ YÖNLENDİRME (jsdom) — DDoS'a dayanıklı istemci akışının URL kanıtı.
 *
 *  Sayfa YÖNCÜ'den yayında (www.masaoyunlari.com.tr) ise:
 *    - /api/auth/* ve /api/friends/* istekleri tarayıcıdan DOĞRUDAN Yöncü
 *      PHP'sine gider (/api/auth.php?action=..., /api/social.php?action=...),
 *      Render'a YÖNLENDİRİLMEZ (Render'ın PHP'ye sunucu istekleri DDoS
 *      korumasıyla engelleniyor; tarayıcı istekleri serbest).
 *    - authHello/attest belgesi akışı aynı şekilde PHP'den beslenir.
 *  Sayfa Render/localhost'ta yayında ise: Render'ın kendi /api/* uçları.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const AUTH_JS = fs.readFileSync(path.join(__dirname, '..', 'js', 'auth.js'), 'utf8');

async function bootPage(url) {
  const dom = new JSDOM('<!doctype html><html><body>' +
    '<input id="loginUser" value="k@k.tr">' +
    '<input id="loginPass" value="sifre123">' +
    '</body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const calls = [];
  window.fetch = async (u) => {
    calls.push(String(u));
    return {
      status: 200,
      json: async () => ({
        ok: true, token: 'tok1', user: { id: 7, name: 'Test', email: 'k@k.tr' },
        attest: { id: 7, name: 'Test', ts: Date.now(), exp: Date.now() + 600000, sig: 'sig' }
      })
    };
  };
  window.GV = {
    toast() {}, showModal() {}, hideModal() {},
    submitLogin() {}, submitRegister() {}, submitForgotPassword() {},
    resendVerifyMail() {}, logout() {}
  };
  window.st = { isGuest: true, user: { name: 'Ziyaretçi' } };
  try { window.localStorage.setItem('gv-auth-token', 'eski-token'); } catch (_) {}
  window.eval(AUTH_JS);
  await sleep(900); // hook() + boot() oturum denemesi
  return { window, calls };
}

async function main() {
  // ---------- 1) Yöncü orijini: istekler PHP'ye (relative, same-origin) ----------
  const { window, calls } = await bootPage('https://www.masaoyunlari.com.tr/');
  // boot(): token var → /api/auth/me  →  PHP
  assert.ok(calls.some(c => c === '/api/auth.php?action=me'), 'me → auth.php (yalnızca PHP): ' + JSON.stringify(calls.slice(0, 4)));
  // Giriş → login PHP'ye gider, Render'a YÖNLENDİRİLMEZ:
  await window.eval('GV.submitLogin()');
  await sleep(150);
  assert.ok(calls.some(c => c === '/api/auth.php?action=login'), 'login → auth.php');
  assert.ok(!calls.some(c => c.indexOf('onrender.com') !== -1), 'Render adresine istek GİTMEZDİ');
  // attestation tazeleme (1.5 sn aralık) → PHP:
  await sleep(1700);
  assert.ok(calls.some(c => c === '/api/auth.php?action=attest'), 'attest → auth.php (soket kimliği belgesi)');
  console.log('  ✓ 1) Yöncü sayfasında üyelik istekleri tarayıcıdan doğrudan Yöncü PHP\'sine gitti');

  // ---------- 2) Render/localhost orijini: Render uçları ----------
  const { window: w2, calls: c2 } = await bootPage('http://localhost:3000/');
  await w2.eval('GV.submitLogin()');
  await sleep(150);
  const loginUrl = c2.find(c => c.indexOf('login') !== -1);
  assert.ok(loginUrl && loginUrl.indexOf('/api/auth/login') !== -1 && loginUrl.indexOf('.php') === -1,
    'Render/localhost ortamında login → Render REST ucu: ' + loginUrl);
  assert.ok(loginUrl.indexOf('/api/auth.php') === -1, 'PHP adresi kullanılmadı');
  console.log('  ✓ 2) Render/localhost ortamında istekler Render /api/* uçlarına gitti');

  console.log('\n✅ YONCU-ROUTING: istemci yönlendirme doğru (DDoS\'a dayanıklı)');
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
