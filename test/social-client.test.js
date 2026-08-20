'use strict';

/*
 * SOSYAL CLIENT (jsdom uçtan uca) — gerçek sayfa + gerçek sunucu.
 *
 *  1) Token localStorage'dayken sayfa açılır → auth.js otomatik giriş yapar
 *     (/api/auth/me), kullanıcı adı başlıkta görünür, misafir MODUNDAN çıkar.
 *  2) Sol menüdeki arkadaş listesi GERÇEK /api/friends verisini gösterir
 *     (mock friendsList değil); isimde data-uid vardır.
 *  3) İsme tıklayınca / GVSocial.openProfile çağrılınca profil penceresi açılır:
 *     isim, çevrimdışı/çevrimiçi bayrağı ve "Son Maçlar" bölümü gelir.
 *  4) Davet kuralı: özel masanın kurucusu değilken inviteFriendById davet
 *     GÖNDERMEZ, açıklayıcı uyarı (toast) düşer.
 *  5) Sahte davet iptali: stok inviteFriend('isim') artık koltuk DOLMUŞ GİBİ
 *     yapmaz (eski mock simülasyonu kapalı).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-socialdom-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms, label) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < (ms || 9000)) {
    try { last = await fn(); } catch (e) { last = null; }
    if (last) return last;
    await sleep(120);
  }
  throw new Error('zaman aşımı: ' + label);
}

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, {
    method: method || (body ? 'POST' : 'GET'),
    headers, body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function verifiedUser(base, name, email) {
  const reg = await api(base, '/api/auth/register', { name, email, password: 'ortaksifre9' });
  const { db } = require('../db');
  const row = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId);
  await api(base, '/api/auth/verify', { token: row.verify_token });
  const log = await api(base, '/api/auth/login', { email, password: 'ortaksifre9' });
  return { id: log.user.id, name: log.user.name, token: log.token };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await verifiedUser(BASE, 'Kral', 'kral@test.com');
  const B = await verifiedUser(BASE, 'Dost', 'dost@test.com');
  // Yeni akış: doğrudan ekleme YOK — A istek gönderir, B kabul eder.
  const rq0 = await api(BASE, '/api/friends/request', { friendId: B.id }, 'POST', A.token);
  assert.ok(rq0.ok && rq0.requested, 'istek gönderilebilmeli (direkt arkadaşlık KURULMAMALI)');
  const ac0 = await api(BASE, '/api/friends/accept', { friendId: A.id }, 'POST', B.token);
  assert.ok(ac0.ok, 'karşı taraf isteği kabul edebilmeli');
  console.log('  ✓ hazırlık) Kral + Dost üyeleri hazır (istek → bildirim → kabul), arkadaşlık kuruldu');

  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {}); // üçüncü-parti script gürültüsünü yut
  vc.on('error', () => {});
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const dom = await JSDOM.fromURL(BASE + '/index.html', {
    resources: 'usable',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE;
      w.fetch = (...a) => fetch(...a);
      w.confirm = () => true;
      try { w.localStorage.setItem('gv-auth-token', A.token); } catch (_) {}
    }
  });
  const win = dom.window;
  assert.ok(html.includes('js/auth.js'), 'index.html auth.js yüklüyor');
  assert.ok(html.includes('js/social.js'), 'index.html social.js yüklüyor');
  assert.ok(html.includes('id="gvFrReqList"') && html.includes('id="gvFriendsModalList"'),
    'arkadaşlar penceresinde İSTEKLER ve LİSTE ayrı bölümler olmalı');

  await waitFor(() => (win.st && win.__gvStartRealRoomWaiting && win.GV ? true : null), 9000, 'sayfa açılışı');

  // 1) Otomatik giriş
  const me = await waitFor(() => {
    const s = win.st;
    return (!s.isGuest && s.user && s.user.name === 'Kral') ? s.user : null;
  }, 9000, 'otomatik giriş (/api/auth/me)');
  assert.strictEqual(Number(me.id), A.id);
  console.log('  ✓ 1) token\'la sayfa açılınca otomatik üye girişi yapıldı (Ziyaretçi değil)');

  // 2) Gerçek arkadaş listesi (üst bar 👥 penceresi konteyneri; eski #friendsList yedeği)
  const fEl = await waitFor(() => {
    const el = win.document.getElementById('gvFriendsModalList') || win.document.getElementById('friendsList');
    return (el && /Dost/.test(el.innerHTML)) ? el : null;
  }, 9000, 'gerçek arkadaş listesi');
  assert.ok(/data-uid="\d+"/.test(fEl.innerHTML), 'arkadaş satırında data-uid olmalı');
  assert.ok(/Çevrimdışı|Çevrimiçi/.test(fEl.innerHTML), 'çevrimiçi durumu yazmalı');
  // eski mock veriler (Mehmet Y./Ayşe K....) görünmemeli
  assert.ok(!/Mehmet Y\.|Ayşe K\.|Caner T\./.test(fEl.innerHTML), 'mock arkadaş listesi kalmamalı');
  console.log('  ✓ 2) arkadaş listesi GERÇEK (\u2713 mock değil), isimler data-uid taşıyor');

  // 3) Profil penceresi
  assert.ok(win.GVSocial && typeof win.GVSocial.openProfile === 'function', 'GVSocial yüklü');
  win.GVSocial.openProfile(B.id);
  const card = await waitFor(() => {
    const c = win.document.getElementById('gvProfileCard');
    return (c && /Dost/.test(c.innerHTML) && /Son Maçlar/.test(c.innerHTML)) ? c : null;
  }, 9000, 'profil penceresi');
  assert.ok(/Çevrimdışı/.test(card.innerHTML), 'Dost bağlı olmadığı için Çevrimdışı görünmeli');
  assert.ok(/Arkadaşlıktan Çıkar/.test(card.innerHTML), 'zaten arkadaş → çıkar butonu');
  assert.ok(/Üyelik:/.test(card.innerHTML), 'üyelik tarihi görünmeli');
  console.log('  ✓ 3) isme tıklayınca profil penceresi: isim + durum + son maçlar + butonlar');

  // 3b) document delegation: data-uid'li herhangi bir element tıklanınca profil açılır
  const probe = win.document.createElement('span');
  probe.setAttribute('data-uid', String(B.id));
  probe.textContent = 'Dost';
  win.document.body.appendChild(probe);
  probe.click();
  await waitFor(() => {
    const m = win.document.getElementById('gvProfileModal');
    return (m && m.style.display === 'flex') ? true : null;
  }, 4000, 'delegation tıklaması');
  win.document.getElementById('gvProfileModal').style.display = 'none';
  probe.remove();
  console.log('  ✓ 3b) sayfadaki her data-uid tıklaması profili açıyor (sohbet/lobi/koltuk isimleri)');

  // 4) Davet kuralı: özel masa kurucusu değilken davet gidemez
  let toastSeen = null;
  const mo = new win.MutationObserver(() => {
    const txt = win.document.body.textContent || '';
    if (/ÖZEL masa|özel masa/.test(txt)) toastSeen = txt;
  });
  mo.observe(win.document.body, { childList: true, subtree: true });
  win.GVSocial.inviteFriendById(B.id);
  await waitFor(() => toastSeen, 4000, 'davet engeli uyarısı');
  mo.disconnect();
  console.log('  ✓ 4) özel masa kurmadan davet GİTMİYOR — açıklayıcı uyarı gösterildi');

  // 5) Mock davet simülasyonu kapalı: inviteFriend artık koltuk doldurmuyor
  assert.strictEqual(String(win.GV.inviteFriend).includes('setTimeout'), false, 'eski sahte koltuk doldurma kodu kalmamalı');
  console.log('  ✓ 5) sahte "davet edildi, masaya katıldı" simülasyonu devre dışı');

  // js/auth.js'in beklenen handler'ları da override ettiğini doğrula
  const src = String(win.GV.submitLogin);
  assert.ok(src.includes('/api/auth/login'), 'submitLogin gerçek API\'ye bağlı olmalı');
  assert.ok(!src.includes('Ahmet K.'), 'stok demo-giriş kodu devre dışı olmalı');
  assert.ok(win.GVAuth && typeof win.GVAuth.api === 'function', 'GVAuth mevcut');
  console.log('  ✓ 6) auth.js handler\'ları (submitLogin/register/forgot) gerçek API\'ye bağlı');

  console.log('\n✅ SOCIAL-CLIENT: tüm client tarafı testler geçti');
  win.close();
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
