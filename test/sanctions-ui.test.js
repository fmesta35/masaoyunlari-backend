'use strict';
/* ============================================================================
 * ÜYE YAPTIRIMLARI — KURUCU PANELİ ARAYÜZÜ + KULLANICI TARAFI KİLİT
 * ============================================================================
 * Kullanıcı isteği (verbatim): "üyelere yaptırım uyarlama özelliği gelsin.
 * örnek olarak resim ilettim ama sitemize uyarlansın ... 1 gün, 1 hafta,
 * 1 ay, 1 yıl, sınırsız, belirli süreli girilen süre de sessizlik.
 * Kısıtlama getirildiğinde ilgili kullanıcıya bildirim gider..."
 *
 * Doğrulananlar:
 *  1) Kurucu Paneli > Kullanıcı & Roller: her üyenin satırında "⚖️ Yaptırım"
 *     düğmesi ve "Kısıtlama yok / Sohbet kısıtlı" durum sütunu var.
 *  2) Düğmeye basınca yaptırım penceresi açılıyor; ALTI süre seçeneği
 *     (1 gün / 1 hafta / 1 ay / 1 yıl / sınırsız / belirli süre) listeli,
 *     tür olarak yalnız sohbet-mesaj kısıtlaması sunuluyor, gerekçe alanı var.
 *  3) "Belirli süre" seçilince dakika kutusu açılıyor.
 *  4) Uygula → sunucuya gidiyor, liste kısıtlı durumu ve "✓ Kaldır" düğmesini
 *     gösteriyor.
 *  5) KISITLANAN KULLANICININ ekranı: sohbet kutusu kilitleniyor ve durumu
 *     açıklayan kutu çıkıyor; bildirim zilinde bildirim beliriyor.
 *  6) Kurucu kısıtlamayı kaldırınca kullanıcının kilidi anında kalkıyor.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-sanction-ui-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@ui.test';
process.env.GV_ADMIN_PASS = 'kurucu-ui-sifresi-8821';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 15000)) {
    try { const v = await fn(); if (v) return v; } catch (_) {}
    await sleep(120);
  }
  throw new Error('zaman aşımı: ' + ne);
}
async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) { headers.Authorization = 'Bearer ' + token; headers['X-GV-Token'] = token; }
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function pencere(base, token) {
  const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
  const dom = await JSDOM.fromURL(base + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = base;
      w.fetch = (...a) => fetch(...a);
      w.confirm = () => true;
      try { w.localStorage.setItem('gv-auth-token', token); } catch (_) {}
    }
  });
  const win = dom.window;
  await bekle(() => (win.st && win.GV ? true : null), 20000, 'sayfa açılışı');
  await bekle(() => (!win.st.isGuest && win.st.user && win.st.user.id ? win.st.user : null), 20000, 'otomatik giriş');
  return win;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const kgiris = await api(BASE, '/api/auth/login', { email: 'kurucu@ui.test', password: 'kurucu-ui-sifresi-8821' }, 'POST');
  assert.ok(kgiris.ok, 'kurucu girişi');
  const reg = await api(BASE, '/api/auth/register', { name: 'Yaramaz', email: 'yaramaz@ui.test', password: 'gucluSifre123' }, 'POST');
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
  await api(BASE, '/api/auth/verify', { token: vt }, 'POST');
  const ugiris = await api(BASE, '/api/auth/login', { email: 'yaramaz@ui.test', password: 'gucluSifre123' }, 'POST');
  assert.ok(ugiris.ok, 'üye girişi');

  // ---------- KURUCU EKRANI ----------
  const kw = await pencere(BASE, kgiris.token);
  const btn = await bekle(() => kw.document.getElementById('adminPanelBtn'), 15000, '👑 Kurucu Paneli butonu');
  btn.click();
  const body = await bekle(() => {
    const b = kw.document.getElementById('adminPanelBody');
    return (b && /yaramaz@ui\.test/.test(b.innerHTML)) ? b : null;
  }, 15000, 'üye listesi');

  // ---- 1) satırda yaptırım düğmesi + durum ----
  const yapBtn = body.querySelector('[data-sanc="open"][data-sanc-uid="' + ugiris.user.id + '"]');
  assert.ok(yapBtn, 'her üyenin satırında "⚖️ Yaptırım" düğmesi olmalı');
  assert.ok(/Kısıtlama yok/.test(body.innerHTML), 'kısıtsız üye için durum sütunu "Kısıtlama yok" demeli');
  assert.ok(!body.querySelector('[data-sanc="open"][data-sanc-uid="' + kgiris.user.id + '"]'),
    'kurucunun kendi satırında yaptırım düğmesi OLMAMALI');
  // ⚠ REGRESYON: js/social.js sayfanın tamamında `[data-uid]` taşıyan HER
  // öğeye tıklanınca profil penceresi açıyor. Yaptırım düğmesi `data-uid`
  // taşırsa tek tıkla İKİ pencere birden açılır (kullanıcı raporu). Düğme
  // kendi özniteliğini kullanmalı; `data-uid` yalnız üye ADINDA olmalı.
  assert.ok(!yapBtn.hasAttribute('data-uid'),
    'yaptırım düğmesi data-uid TAŞIMAMALI (yoksa profil penceresi de açılır)');
  assert.ok(!body.querySelector('[data-sanc][data-uid]'),
    'hiçbir yaptırım düğmesi data-uid taşımamalı');
  const isimEl = [...body.querySelectorAll('[data-uid="' + ugiris.user.id + '"]')]
    .find(el => /Yaramaz/.test(el.textContent));
  assert.ok(isimEl, 'üye ADI tıklanabilir olmalı (isme tıklayınca bilgileri açılır)');
  console.log('  ✓ 1) üye satırlarında yaptırım düğmesi + durum sütunu; isim tıklanabilir, düğme profil açmıyor');

  // ---- 2) pencere: süre seçenekleri + tür + gerekçe ----
  yapBtn.click();
  const modal = await bekle(() => {
    const m = kw.document.getElementById('adminSanctionModal');
    return (m && m.classList.contains('show') && m.querySelector('#sancSure')) ? m : null;
  }, 15000, 'yaptırım penceresi');
  assert.ok(/Yaramaz/.test(modal.innerHTML), 'pencere hangi üyeye uygulandığını göstermeli');
  const sec = [...modal.querySelectorAll('#sancSure option')].map(o => o.value);
  for (const k of ['1g', '1h', '1a', '1y', 'sinirsiz', 'ozel']) {
    assert.ok(sec.includes(k), 'süre seçeneği eksik: ' + k);
  }
  // Tek tür olduğu için seçim düğmesi YOK: sabit bilgi kartı gösterilir
  // (tek seçenekli radyo kullanıcıyı "neyi seçeceğim?" diye şaşırtıyordu).
  assert.strictEqual(modal.querySelectorAll('input[type="radio"]').length, 0,
    'tek tür varken radyo düğmesi gösterilmemeli');
  const turKart = modal.querySelector('#sancTurKart');
  assert.ok(turKart, 'yaptırım türü sabit bilgi kartı olarak gösterilmeli');
  assert.strictEqual(turKart.getAttribute('data-tur'), 'chat', 'tür sunucudan gelmeli');
  assert.ok(/Sohbet ve mesaj kısıtlaması/.test(turKart.textContent), 'kart türü açıkça yazmalı');
  assert.ok(modal.querySelector('#sancSebep'), 'gerekçe alanı olmalı');
  console.log('  ✓ 2) pencere: 6 süre seçeneği (' + sec.join(', ') + '), sabit tür kartı (sohbet), gerekçe alanı');

  // ---- 3) "belirli süre" seçilince dakika kutusu ----
  const sel = modal.querySelector('#sancSure');
  assert.strictEqual(modal.querySelector('#sancOzelWrap').style.display, 'none', 'başta dakika kutusu gizli');
  sel.value = 'ozel';
  sel.dispatchEvent(new kw.Event('change', { bubbles: true }));
  assert.strictEqual(modal.querySelector('#sancOzelWrap').style.display, 'block', '"belirli süre" seçilince dakika kutusu açılmalı');
  console.log('  ✓ 3) "Belirli süre" seçilince dakika kutusu açılıyor');

  // ---- 1b) yaptırım düğmesi SADECE yaptırım penceresini açmalı ----
  // Profil penceresi bir .modal-bg DEĞİL: js/social.js onu #gvProfileModal
  // olarak kurar ve style.display ile açar — bu yüzden doğrudan onu sınıyoruz.
  const prof = kw.document.getElementById('gvProfileModal');
  assert.ok(!prof || prof.style.display === 'none' || prof.style.display === '',
    'yaptırıma tıklayınca ÜYE PROFİLİ penceresi açılmamalı (display=' + (prof && prof.style.display) + ')');
  const digerAcik = [...kw.document.querySelectorAll('.modal-bg.show')]
    .filter(m => m.id !== 'adminSanctionModal' && m.id !== 'adminPanelModal');
  assert.strictEqual(digerAcik.length, 0,
    'başka pencere de açılmamalı, açılan: ' + digerAcik.map(m => m.id).join(', '));
  console.log('  ✓ 1b) yaptırım düğmesi yalnız yaptırım penceresini açıyor (profil açılmıyor)');

  // ---------- KISITLANACAK KULLANICININ EKRANI ----------
  const uw = await pencere(BASE, ugiris.token);
  await bekle(() => uw.document.getElementById('gcInput'), 10000, 'masa sohbeti kutusu');
  assert.ok(!uw.document.getElementById('gcInput').disabled, 'kısıtlamadan önce sohbet kutusu açık olmalı');
  // Anlık bildirim ancak soket KURULUP kimliği doğrulandıktan sonra düşebilir;
  // sosyal katmanın (js/social.js) da dinleyicilerini bağlaması gerekir.
  await bekle(() => {
    const s = uw.__gvLobbySocket || uw.__gvRoomSocket;
    return (s && s.connected && s.__gvSocial && s.__gvChat) ? s : null;
  }, 15000, 'kullanıcı soketi + sohbet/sosyal dinleyicileri');

  // ---- 4) kurucu uygular ----
  sel.value = '1h';
  sel.dispatchEvent(new kw.Event('change', { bubbles: true }));
  modal.querySelector('#sancSebep').value = 'Masada hakaret';
  modal.querySelector('#sancApply').click();
  await bekle(() => {
    const b = kw.document.getElementById('adminPanelBody');
    return (b && /Sohbet kısıtlı/.test(b.innerHTML) && b.querySelector('[data-sanc="lift"]')) ? b : null;
  }, 15000, 'liste kısıtlı durumu göstermeli');
  console.log('  ✓ 4) yaptırım uygulandı; liste "Sohbet kısıtlı" + "✓ Kaldır" gösteriyor');

  // ---- 5) kullanıcı tarafı: kilit + açıklama + bildirim ----
  const ban = await bekle(() => {
    const el = uw.document.getElementById('gvChatBan');
    return (el && !el.hidden) ? el : null;
  }, 15000, 'kullanıcı ekranında kısıtlama kutusu');
  assert.ok(/Sohbet Kısıtlandı/i.test(ban.textContent), 'kutu durumu açıkça yazmalı: ' + ban.textContent);
  assert.ok(/Masada hakaret/.test(ban.textContent), 'gerekçe kullanıcıya gösterilmeli');
  await bekle(() => uw.document.getElementById('gcInput').disabled ? true : null, 8000, 'sohbet kutusu kilidi');
  await bekle(() => (uw.st.notifications || []).some(n => n.actionData && n.actionData.type === 'sanction') ? true : null,
    10000, 'bildirim zilinde yaptırım bildirimi');
  const bil = uw.st.notifications.find(n => n.actionData && n.actionData.type === 'sanction');
  assert.ok(/kısıtlan/i.test(bil.desc || ''), 'bildirim durumu AÇIKLAMALI olmalı: ' + bil.desc);
  console.log('  ✓ 5) kullanıcının sohbeti kilitlendi, açıklayıcı kutu ve bildirim geldi');

  // ---- 6) kaldırma anında yansıyor ----
  kw.document.getElementById('adminPanelBody').querySelector('[data-sanc="lift"]').click();
  await bekle(() => {
    const el = uw.document.getElementById('gvChatBan');
    return (!el || el.hidden) ? true : null;
  }, 15000, 'kısıtlama kutusunun kalkması');
  await bekle(() => uw.document.getElementById('gcInput').disabled === false ? true : null, 8000, 'kilidin açılması');
  console.log('  ✓ 6) kurucu kaldırınca kullanıcının kilidi anında kalktı');

  // ---- 7) ÜYE ADINA tıklayınca profil bilgileri açılmalı ----
  // Kullanıcı isteği: "üye ismine tıkladığımda bilgileri gözükmeli."
  const isim = [...kw.document.getElementById('adminPanelBody')
    .querySelectorAll('[data-uid="' + ugiris.user.id + '"]')].find(el => /Yaramaz/.test(el.textContent));
  assert.ok(isim, 'üye adı data-uid taşımalı (profil için)');
  isim.dispatchEvent(new kw.MouseEvent('click', { bubbles: true, cancelable: true }));
  const pf = await bekle(() => {
    const el = kw.document.getElementById('gvProfileModal');
    return (el && el.style.display === 'flex') ? el : null;
  }, 10000, 'isme tıklayınca profil penceresi');
  assert.ok(pf, 'üye adına tıklayınca profil penceresi açılmalı');
  console.log('  ✓ 7) üye adına tıklayınca üye bilgileri (profil) açılıyor');

  // Profil penceresi açılırken /api/users/:id/profile + online-status
  // isteklerini başlatır. Sunucuyu bu istekler UÇUŞTAYKEN kapatırsak
  // undici "fetch failed" ile süreci düşürüyor — testin sonucuyla ilgisi
  // olmayan bir yıkım (teardown) yarışı. Önce istekleri bitmeye bırak.
  await sleep(1500);
  process.on('uncaughtException', () => {});   // kapanış sırasında geç düşen istek
  kw.close(); uw.close();
  serverModule.io && serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK yaptırım arayüzü: kurucu paneli penceresi + kullanıcı tarafı kilit/bildirim');
  process.exit(0);
}
main().catch(e => { console.error('❌ YAPTIRIM ARAYÜZ TEST HATASI:', e); process.exit(1); });
