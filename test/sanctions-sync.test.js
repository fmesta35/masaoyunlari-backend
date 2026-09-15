'use strict';
/* ============================================================================
 * YAPTIRIM SENKRONİZASYONU (/api/admin/sanctions/sync)
 * ============================================================================
 * Kullanıcı raporu: kurucu panelinden yaptırım uygulamaya çalışınca
 * "Üyelik sunucusundan boş cevap." hatası alınıyordu. Kök neden: Render'ın
 * X-GV-Key'li social.php?action=sanctionApply çağrısı Yöncü'nün DDoS
 * koruması tarafından engelleniyordu (bkz. auth-remote.js/auth.php'deki
 * notlar — Render'ın TÜM sunucu-sunucu istekleri için geçerli).
 *
 * Çözüm: kalıcı yazma artık tarayıcıdan PHP'ye DOĞRUDAN gidiyor
 * (gv_require_server_key_or_admin — bearer ile de kabul edilir), Render'a
 * ise yalnızca "sync" için ayrıca gidiliyor: bu uç PHP'ye HİÇ yazmaz,
 * yalnız Render'ın anlık önbelleğini (soket katmanında ANINDA reddetme)
 * ve kullanıcıya giden bildirimi tetikler.
 *
 * Bu test /api/admin/sanctions/sync uctan dogruluyor:
 *  1) yetkisiz erişim reddedilir.
 *  2) 'apply' önbelleği ANINDA doldurur — kısıtlı kullanıcı sohbete
 *     yazamaz hale gelir (PHP'ye hiç gidilmeden, salt Render belleği).
 *  3) kullanıcıya chatSanction bildirimi anında düşer.
 *  4) 'lift' önbelleği temizler — kullanıcı yeniden yazabilir + bildirim.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-sanction-sync-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@sync.test';
process.env.GV_ADMIN_PASS = 'kurucu-test-sifresi-7731';
process.env.GV_CHAT_RATE_MS = '1';

const assert = require('assert');
const io = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) { headers.Authorization = 'Bearer ' + token; headers['X-GV-Token'] = token; }
  const r = await fetch(base + p, {
    method: method || (body ? 'POST' : 'GET'), headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function uyeAc(base, ad, eposta) {
  const reg = await api(base, '/api/auth/register', { name: ad, email: eposta, password: 'gucluSifre123' }, 'POST');
  assert.ok(reg.ok, ad + ' kaydı: ' + JSON.stringify(reg));
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
  await api(base, '/api/auth/verify', { token: vt }, 'POST');
  const login = await api(base, '/api/auth/login', { email: eposta, password: 'gucluSifre123' }, 'POST');
  assert.ok(login.ok && login.token, ad + ' girişi');
  return { id: login.user.id, name: ad, token: login.token };
}

function soketAc(base, uye) {
  return new Promise((resolve, reject) => {
    const s = io(base, { transports: ['websocket'], forceNew: true });
    const t = setTimeout(() => reject(new Error('soket zaman aşımı')), 8000);
    s.on('connect', () => { s.emit('authHello', { token: uye.token }); });
    s.on('authReady', r => { if (r && r.ok) { clearTimeout(t); resolve(s); } });
    s.on('connect_error', reject);
  });
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const kurucu = await api(BASE, '/api/auth/login', { email: 'kurucu@sync.test', password: 'kurucu-test-sifresi-7731' }, 'POST');
  assert.ok(kurucu.ok && kurucu.token, 'kurucu girişi');
  const uye = await uyeAc(BASE, 'Sync Uye', 'sync-uye@sync.test');

  // ---------- 1) yetkisiz erişim reddedilir ----------
  const denied = await api(BASE, '/api/admin/sanctions/sync', { userId: uye.id, tur: 'chat', action: 'apply' }, 'POST');
  assert.strictEqual(denied.status, 403, 'tokensız istek 403 vermeli');
  const deniedUser = await api(BASE, '/api/admin/sanctions/sync', { userId: uye.id, tur: 'chat', action: 'apply' }, 'POST', uye.token);
  assert.strictEqual(deniedUser.status, 403, 'sıradan üye sync çağıramaz');
  console.log('  ✓ 1) /api/admin/sanctions/sync yalnız kurucuya açık');

  // ---------- 2) 'apply': önbellek anında dolar, sohbet kilitlenir ----------
  const sock = await soketAc(BASE, uye);
  const bitis = Date.now() + 60000;
  // Dinleyici, sync çağrısından ÖNCE takılmalı — emitToUser senkron olarak
  // sync isteği yanıt dönmeden ÖNCE tetiklenir, sonradan dinlemek kaçırır.
  const sancP = new Promise(res => sock.once('chatSanction', res));
  const sync1 = await api(BASE, '/api/admin/sanctions/sync',
    { userId: uye.id, tur: 'chat', action: 'apply', bitis, sebep: 'test gerekçesi' }, 'POST', kurucu.token);
  assert.strictEqual(sync1.ok, true, 'sync apply başarılı: ' + JSON.stringify(sync1));
  const sanc = await sancP;

  const rejP = new Promise(res => sock.once('chatRejected', res));
  sock.emit('chatMessage', { scope: 'global', text: 'merhaba', name: uye.name });
  const rej = await rejP;
  assert.ok(/kısıtlan/i.test(rej.reason || ''), 'sync sonrası mesaj reddi AÇIKLAYICI: ' + rej.reason);
  assert.strictEqual(sanc.tur, 'chat');
  assert.ok(/test gerekçesi/.test(sanc.aciklama || ''), 'bildirimde gerekçe var');
  console.log('  ✓ 2) sync(apply) PHP\'ye hiç gitmeden Render önbelleğini doldurdu — sohbet ANINDA kilitlendi');
  console.log('  ✓ 3) kullanıcıya chatSanction bildirimi anında düştü');

  // ---------- 3) 'lift': önbellek temizlenir, sohbet açılır ----------
  const liftedP = new Promise(res => sock.once('chatSanctionLifted', res));
  const sync2 = await api(BASE, '/api/admin/sanctions/sync', { userId: uye.id, tur: 'chat', action: 'lift' }, 'POST', kurucu.token);
  assert.strictEqual(sync2.ok, true, 'sync lift başarılı');
  const lifted = await liftedP;
  const ok = new Promise(res => sock.once('chatMessage', res));
  assert.strictEqual(lifted.tur, 'chat');
  await sleep(1100); // rate limit
  sock.emit('chatMessage', { scope: 'global', text: 'artik yazabiliyorum', name: uye.name });
  const okMsg = await ok;
  assert.ok(okMsg, 'kısıtlama kalkınca mesaj kabul edildi');
  console.log('  ✓ 4) sync(lift) önbelleği temizledi — kullanıcı yeniden yazabildi + bildirim geldi');

  console.log('\n✅ SANCTIONS-SYNC: /api/admin/sanctions/sync PHP\'ye yazmadan Render\'ı anında senkronluyor');
  sock.disconnect();
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ sanctions-sync.test.js HATA:', e);
  process.exit(1);
});
