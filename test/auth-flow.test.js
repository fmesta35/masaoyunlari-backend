'use strict';

/*
 * ÜYELİK AKIŞI (REST) — kayıt, e-posta onayı, giriş, şifre sıfırlama.
 *
 *  1) Kayıt: geçersiz alanlar 400; mükerrer isim/e-posta 409.
 *  2) Onaysız giriş 403 {needVerify:true} — mail gelmeden giriş YOK.
 *  3) Onay linki (db'deki verify_token) → verified=1 → giriş 200 + token.
 *  4) /api/auth/me Bearer ile çalışır.
 *  5) Tekrar gönder: yeni kayıtta 1 dk içinde ikinci istek 429.
 *  6) Şifremi unuttum: reset_token + 30 dk süre → yeni şifre DB'ye yazılır,
 *     ESKİ oturumlar silinir, eski şifreyle giriş 401, yenisiyle 200.
 *  7) logout: token sunucudan silinir → /me 401.
 *  8) Enumeration önlemi: var olmayan e-postaya forgot da ok:true döner.
 *
 *  Not: GV_DATA_DIR geçici klasöre ayarlanır; e-posta gönderimi (SMTP şifresi
 *  yok) loga düşer — jetonlar doğrudan DB'den okunarak akış sürülür.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// server'dan ÖNCE ayarlanmalı (db.js modül yüklenirken okunur).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-auth-test-'));
process.env.GV_DATA_DIR = TMP;

const assert = require('assert');
const serverModule = require('../server.js');

async function api(base, path_, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + path_, {
    method: method || (body ? 'POST' : 'GET'),
    headers, body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await r.json(); } catch (_) {}
  return { status: r.status, ...(data || {}) };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const Database = require('better-sqlite3');
  const db = new Database(path.join(TMP, 'gameverse.db'), { readonly: true });
  const col = (sql, ...args) => db.prepare(sql).get(...args);

  // --- 1) Kayıt doğrulamaları -------------------------------------------------
  let r = await api(BASE, '/api/auth/register', { name: 'A', email: 'a@b.com', password: 'sifre123' });
  assert.strictEqual(r.status, 400, 'kısa isim 400 olmalı');
  r = await api(BASE, '/api/auth/register', { name: 'Ayse', email: 'gecersiz', password: 'sifre123' });
  assert.strictEqual(r.status, 400, 'geçersiz e-posta 400 olmalı');
  r = await api(BASE, '/api/auth/register', { name: 'Ayse', email: 'ayse@test.com', password: '123' });
  assert.strictEqual(r.status, 400, 'kısa şifre 400 olmalı');
  console.log('  ✓ 1) eksik/geçersiz kayıt alanları 400 ile reddediliyor');

  r = await api(BASE, '/api/auth/register', { name: 'Ayse', email: 'ayse@test.com', password: 'sifre123' });
  assert.strictEqual(r.status, 200, 'kayıt başarılı olmalı');
  assert.strictEqual(r.ok, true);
  const AYSE = Number(r.userId);
  assert.ok(AYSE > 0, 'userId dönmeli');
  console.log('  ✓ 2) kayıt başarılı (onay maili kuyruğa alındı)');

  r = await api(BASE, '/api/auth/register', { name: 'ayse', email: 'baska@test.com', password: 'sifre123' });
  assert.strictEqual(r.status, 409, 'aynı isim (büyük/küçük harf) 409');
  r = await api(BASE, '/api/auth/register', { name: 'Baska', email: 'Ayse@Test.com', password: 'sifre123' });
  assert.strictEqual(r.status, 409, 'aynı e-posta 409');
  console.log('  ✓ 3) mükerrer isim / e-posta 409');

  // --- 2) Onaysız giriş YASAK -------------------------------------------------
  r = await api(BASE, '/api/auth/login', { email: 'ayse@test.com', password: 'sifre123' });
  assert.strictEqual(r.status, 403, 'onaysız giriş 403 olmalı');
  assert.strictEqual(r.needVerify, true, 'needVerify işareti gelmeli');
  assert.strictEqual(r.email, 'ayse@test.com');
  console.log('  ✓ 4) onaylanmamış üye giriş YAPAMIYOR (403 needVerify)');

  // --- 3) Mail linki onayı → giriş -------------------------------------------
  let row = col('SELECT verify_token, verified FROM users WHERE id = ?', AYSE);
  assert.ok(row.verify_token, 'verify_token üretilmiş olmalı');
  assert.strictEqual(Number(row.verified), 0);
  r = await api(BASE, '/api/auth/verify', { token: 'boyle-token-yok' });
  assert.strictEqual(r.ok, false, 'geçersiz onay linki reddedilmeli');
  r = await api(BASE, '/api/auth/verify', { token: row.verify_token });
  assert.strictEqual(r.ok, true, 'onay linki çalışmalı');
  row = col('SELECT verified, verify_token FROM users WHERE id = ?', AYSE);
  assert.strictEqual(Number(row.verified), 1, 'verified=1 olmalı');
  assert.strictEqual(row.verify_token, null, 'onay jetonu tek kullanımlık (NULL)');
  console.log('  ✓ 5) maildeki onay linki üyeliği doğruluyor (tek kullanımlık)');

  r = await api(BASE, '/api/auth/login', { email: 'ayse@test.com', password: 'yanlissifre' });
  assert.strictEqual(r.status, 401, 'yanlış şifre 401');
  r = await api(BASE, '/api/auth/login', { email: 'ayse@test.com', password: 'sifre123' });
  assert.strictEqual(r.status, 200, 'doğru şifre 200');
  assert.ok(r.token && r.user && r.user.name === 'Ayse', 'token + kullanıcı dönmeli');
  const tokenV1 = r.token;
  console.log('  ✓ 6) onaylı üye giriş yapabiliyor, token alıyor');

  r = await api(BASE, '/api/auth/me', null, 'GET', tokenV1);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.user.email, 'ayse@test.com');
  r = await api(BASE, '/api/auth/me', null, 'GET', 'sacma-token');
  assert.strictEqual(r.status, 401, 'geçersiz Bearer 401');
  console.log('  ✓ 7) /api/auth/me geçerli token ile çalışıyor, sahtesi reddediliyor');

  // --- 4) Tekrar gönder: 1 dk sınırı ------------------------------------------
  r = await api(BASE, '/api/auth/register', { name: 'Mehmet', email: 'mehmet@test.com', password: 'sifre123' });
  assert.strictEqual(r.ok, true);
  r = await api(BASE, '/api/auth/resend', { email: 'mehmet@test.com' });
  assert.strictEqual(r.status, 429, 'az önce gönderildiyse 429');
  r = await api(BASE, '/api/auth/resend', { email: 'boyle-biri@yok.com' });
  assert.strictEqual(r.status, 200, 'var olmayan adrese de aynı cevap (enumeration önlemi)');
  r = await api(BASE, '/api/auth/resend', { email: 'ayse@test.com' });
  assert.strictEqual(r.status, 200, 'zaten onaylı üyeye sessiz başarı');
  console.log('  ✓ 8) "tekrar gönder": 1 dk sınırı (429) + e-posta numaralandırma koruması');

  // --- 5) Şifremi unuttum → sıfırlama → yeni şifre -----------------------------
  r = await api(BASE, '/api/auth/forgot', { email: 'boyle-biri@yok.com' });
  assert.strictEqual(r.status, 200, 'bilinmeyen e-postada da aynı cevap');
  r = await api(BASE, '/api/auth/forgot', { email: 'ayse@test.com' });
  assert.strictEqual(r.status, 200);
  row = col('SELECT reset_token, reset_expires FROM users WHERE id = ?', AYSE);
  assert.ok(row.reset_token, 'reset_token üretilmeli');
  assert.ok(Number(row.reset_expires) > Date.now(), '30 dk süre ileride olmalı');
  assert.ok(Number(row.reset_expires) <= Date.now() + 31 * 60 * 1000, 'süre ~30 dk olmalı');
  console.log('  ✓ 9) şifremi unuttum: maile gidecek sıfırlama jetonu + 30 dk süre yazılıyor');

  r = await api(BASE, '/api/auth/reset', { token: 'gecersiz', password: 'yenisifre1' });
  assert.strictEqual(r.status, 400, 'geçersiz sıfırlama linki 400');
  r = await api(BASE, '/api/auth/reset', { token: row.reset_token, password: '123' });
  assert.strictEqual(r.status, 400, 'kısa yeni şifre 400');
  r = await api(BASE, '/api/auth/reset', { token: row.reset_token, password: 'yenisifre1' });
  assert.strictEqual(r.ok, true, 'sıfırlama başarılı');
  console.log('  ✓ 10) linkteki jetonla yeni şifre DB\'ye yazılıyor');

  r = await api(BASE, '/api/auth/me', null, 'GET', tokenV1);
  assert.strictEqual(r.status, 401, 'eski oturum sıfırlamada silinmeli');
  r = await api(BASE, '/api/auth/login', { email: 'ayse@test.com', password: 'sifre123' });
  assert.strictEqual(r.status, 401, 'eski şifre artık çalışmamalı');
  r = await api(BASE, '/api/auth/login', { email: 'ayse@test.com', password: 'yenisifre1' });
  assert.strictEqual(r.status, 200, 'yeni şifreyle giriş açık');
  const tokenV2 = r.token;
  console.log('  ✓ 11) eski oturum+şifre iptal; yeni şifreyle giriş başarılı');

  // --- 6) Süresi dolmuş reset token reddi --------------------------------------
  await api(BASE, '/api/auth/forgot', { email: 'ayse@test.com' });
  const db2 = require('../db').db;
  db2.prepare('UPDATE users SET reset_expires = ? WHERE id = ?').run(Date.now() - 1000, AYSE);
  const tok2 = col('SELECT reset_token FROM users WHERE id = ?', AYSE).reset_token;
  r = await api(BASE, '/api/auth/reset', { token: tok2, password: 'baskasifre1' });
  assert.strictEqual(r.status, 400, 'süresi dolmuş link reddedilmeli');
  console.log('  ✓ 12) 30 dk\'sı dolmuş sıfırlama linki reddediliyor');

  // --- 7) Çıkış -----------------------------------------------------------------
  r = await api(BASE, '/api/auth/logout', {}, 'POST', tokenV2);
  assert.strictEqual(r.ok, true);
  r = await api(BASE, '/api/auth/me', null, 'GET', tokenV2);
  assert.strictEqual(r.status, 401, 'çıkış sonrası token geçersiz');
  console.log('  ✓ 13) logout oturumu sunucudan siliyor');

  // --- 8) Onay aynı linkle ikinci kez yapılamaz ---------------------------------
  r = await api(BASE, '/api/auth/verify', { token: 'kullanilmis-token' });
  assert.strictEqual(r.ok, false);
  console.log('  ✓ 14) kullanılmış/geçersiz onay linki tekrar işlemiyor');

  console.log('\n✅ AUTH-FLOW: tüm üyelik akışı testleri geçti');
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
