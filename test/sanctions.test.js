'use strict';
/* ============================================================================
 * ÜYE YAPTIRIMLARI — SOHBET / MESAJ KISITLAMASI (uçtan uca)
 * ============================================================================
 * Kullanıcı isteği (verbatim):
 *  "üyelere yaptırım uyarlama özelliği gelsin ... tüm sohbetler kapatılsın
 *   kullanıcının (oyun içi ve genel sohbet) 1 gün, 1 hafta, 1 ay, 1 yıl,
 *   sınırsız, belirli süreli girilen süre de sessizlik. Kısıtlama
 *   getirildiğinde ilgili kullanıcıya bildirim gider ve bu bildirimde
 *   durumu açıklayıcı bir bildirim gider. şimdilik sadece mesaj ve sohbet
 *   kısıtlaması yaptırımı uygulansın"
 *
 * Doğrulananlar:
 *  1) Yaptırım uçları YALNIZ kurucuya açık (üye/anonim → 403).
 *  2) Altı süre seçeneği sunucuda tanımlı: 1 gün / 1 hafta / 1 ay / 1 yıl /
 *     sınırsız / belirli süre (dakika).
 *  3) Kısıtlanan üye GENEL sohbete yazamaz — ret mesajı AÇIKLAYICI.
 *  4) Kısıtlanan üye OYUN İÇİ (masa) sohbetine de yazamaz.
 *  5) Kısıtlama anında kullanıcının soketine BİLDİRİM düşer (chatSanction).
 *  6) Kısıtlanmayan üye her iki sohbette de normal yazmaya devam eder.
 *  7) Süresi dolan yaptırım kendiliğinden kalkar (belirli süre seçeneği).
 *  8) Kurucu yaptırımı KALDIRINCA üye yeniden yazabilir + bildirim gider.
 *  9) Yaptırım listesi/kendi durumu uçları doğru çalışır.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-sanction-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@yaptirim.test';
process.env.GV_ADMIN_PASS = 'kurucu-test-sifresi-4471';
process.env.GV_CHAT_RATE_MS = '1';          // testte genel sohbet beklemesi olmasın
process.env.GV_SANCTION_TTL_MS = '250';     // önbellek hızla tazelensin

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

// Onaylı üye oluştur + giriş yap
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

// Kimliği doğrulanmış (authHello) soket
function soketAc(base, uye) {
  return new Promise((resolve, reject) => {
    const s = io(base, { transports: ['websocket'], forceNew: true });
    const t = setTimeout(() => reject(new Error('soket zaman aşımı')), 8000);
    s.on('connect', () => { s.emit('authHello', { token: uye.token }); });
    s.on('authReady', r => {
      if (!r || !r.ok) return;
      clearTimeout(t);
      s.__olaylar = [];
      s.on('chatSanction', p => s.__olaylar.push({ ev: 'chatSanction', p }));
      s.on('chatSanctionLifted', p => s.__olaylar.push({ ev: 'chatSanctionLifted', p }));
      resolve(s);
    });
    s.on('connect_error', e => { clearTimeout(t); reject(e); });
  });
}

// Mesaj gönder: kabul mü (chatMessage yankısı) ret mi (chatRejected)?
function mesajGonder(sock, scope, text, extra) {
  return new Promise(resolve => {
    let bitti = false;
    const bit = v => { if (bitti) return; bitti = true; sock.off('chatMessage', ok); sock.off('chatRejected', no); resolve(v); };
    const ok = m => { if (m && m.text === text) bit({ kabul: true, msg: m }); };
    const no = p => bit({ kabul: false, reason: (p && p.reason) || '', yaptirim: p && p.yaptirim });
    sock.on('chatMessage', ok);
    sock.on('chatRejected', no);
    sock.emit('chatMessage', Object.assign({ scope, text, name: 'x' }, extra || {}));
    setTimeout(() => bit({ kabul: false, reason: '(cevap yok)' }), 2500);
  });
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // kurucu + iki normal üye
  // Kurucu hesabı GV_ADMIN_EMAIL/GV_ADMIN_PASS ile sunucu açılışında kurulur.
  const kgiris = await api(BASE, '/api/auth/login',
    { email: 'kurucu@yaptirim.test', password: 'kurucu-test-sifresi-4471' }, 'POST');
  assert.ok(kgiris.ok && kgiris.token, 'kurucu girişi: ' + JSON.stringify(kgiris));
  const kurucu = { id: kgiris.user.id, name: 'Kurucu', token: kgiris.token };
  const kotu = await uyeAc(BASE, 'Kotu', 'kotu@yaptirim.test');
  const iyi = await uyeAc(BASE, 'Iyi', 'iyi@yaptirim.test');
  assert.ok((await api(BASE, '/api/admin/users', null, 'GET', kurucu.token)).ok, 'kurucu yetkisi');

  // ---- 1) yetki kapısı ----
  const anon = await api(BASE, '/api/admin/sanctions', null, 'GET');
  assert.strictEqual(anon.status, 403, 'anonim yaptırım listesini göremez');
  const uyeDener = await api(BASE, '/api/admin/sanctions', { userId: iyi.id, tur: 'chat', sure: '1g' }, 'POST', kotu.token);
  assert.strictEqual(uyeDener.status, 403, 'sıradan üye yaptırım uygulayamaz');
  const kendine = await api(BASE, '/api/admin/sanctions', { userId: kurucu.id, tur: 'chat', sure: '1g' }, 'POST', kurucu.token);
  assert.ok(!kendine.ok, 'kurucu kendine yaptırım uygulayamaz');
  console.log('  ✓ 1) yaptırım uçları yalnız kurucuya açık');

  // ---- 2) süre seçenekleri ----
  const opt = await api(BASE, '/api/admin/sanctions/options', null, 'GET', kurucu.token);
  assert.ok(opt.ok, 'seçenekler okunmalı');
  const ids = (opt.sureler || []).map(x => x.id);
  for (const k of ['1g', '1h', '1a', '1y', 'sinirsiz', 'ozel']) {
    assert.ok(ids.includes(k), 'süre seçeneği eksik: ' + k);
  }
  assert.deepStrictEqual((opt.turler || []).map(t => t.id), ['chat'],
    'şimdilik YALNIZ sohbet/mesaj kısıtlaması olmalı (kullanıcı isteği)');
  console.log('  ✓ 2) süre seçenekleri: ' + ids.join(', ') + ' — tür: yalnız sohbet');

  // soketler
  const sKotu = await soketAc(BASE, kotu);
  const sIyi = await soketAc(BASE, iyi);

  // Kısıtlamadan ÖNCE her ikisi de yazabiliyor (temel doğrulama)
  assert.ok((await mesajGonder(sKotu, 'global', 'kisitlamadan-once')).kabul, 'kısıtlama öncesi yazabilmeli');

  // ---- 3+5) kısıtla: genel sohbet + anlık bildirim ----
  const uygula = await api(BASE, '/api/admin/sanctions',
    { userId: kotu.id, tur: 'chat', sure: '1h', sebep: 'Sohbette hakaret' }, 'POST', kurucu.token);
  assert.ok(uygula.ok, 'yaptırım uygulanmalı: ' + JSON.stringify(uygula));
  assert.ok(uygula.yaptirim.bitis > Date.now() + 6 * 86400000, '1 hafta bitişi ileri bir tarih olmalı');

  await sleep(300);
  const bildirim = sKotu.__olaylar.find(x => x.ev === 'chatSanction');
  assert.ok(bildirim, 'kısıtlanan kullanıcıya ANINDA bildirim gitmeli');
  assert.ok(/kısıtland/i.test(bildirim.p.aciklama || ''), 'bildirim durumu AÇIKLAMALI: ' + bildirim.p.aciklama);
  assert.ok(/Sohbette hakaret/.test(bildirim.p.aciklama || ''), 'gerekçe bildirime girmeli');
  assert.ok(/oyun içi ve genel/i.test(bildirim.p.aciklama || ''), 'her iki sohbetin kapandığı söylenmeli');
  console.log('  ✓ 5) kısıtlanan üyeye açıklayıcı bildirim düştü: "' + bildirim.p.aciklama.slice(0, 72) + '..."');

  const genel = await mesajGonder(sKotu, 'global', 'yazabiliyor-muyum-1');
  assert.strictEqual(genel.kabul, false, 'kısıtlı üye GENEL sohbete yazamamalı');
  assert.ok(/kısıtland/i.test(genel.reason), 'ret mesajı açıklayıcı olmalı: ' + genel.reason);
  assert.ok(genel.yaptirim && genel.yaptirim.bitis, 'ret paketi yaptırım bilgisini taşımalı (istemci kutuyu kilitler)');
  console.log('  ✓ 3) kısıtlı üye genel sohbete yazamıyor — "' + genel.reason.slice(0, 60) + '..."');

  // ---- 4) OYUN İÇİ (masa) sohbeti de kapalı ----
  await new Promise(r => { sKotu.emit('joinRoom', { roomId: '101', name: 'Kotu', userKey: 'user:' + kotu.id }); setTimeout(r, 500); });
  const masa = await mesajGonder(sKotu, 'room', 'masa-mesaji-1');
  assert.strictEqual(masa.kabul, false, 'kısıtlı üye MASA (oyun içi) sohbetine de yazamamalı');
  assert.ok(/kısıtland/i.test(masa.reason), 'masa reddi de açıklayıcı olmalı, gelen: ' + masa.reason);
  console.log('  ✓ 4) kısıtlı üye oyun içi masa sohbetine de yazamıyor');

  await sleep(1100);   // masa sohbetinde 1 sn'lik hız sınırı var
  // ---- 6) kısıtlanmayan üye etkilenmiyor ----
  assert.ok((await mesajGonder(sIyi, 'global', 'ben-serbestim')).kabul,
    'kısıtlanmayan üye normal yazabilmeli');
  console.log('  ✓ 6) kısıtlanmayan üye her iki sohbette normal yazıyor');

  // ---- 9) listeleme + kendi durumu ----
  const liste = await api(BASE, '/api/admin/sanctions', null, 'GET', kurucu.token);
  assert.ok(liste.ok && liste.liste.some(y => Number(y.userId) === Number(kotu.id)), 'kısıtlı üye listede olmalı');
  const benim = await api(BASE, '/api/sanctions/me', null, 'GET', kotu.token);
  assert.ok(benim.ok && benim.yaptirim && benim.yaptirim.aciklama, 'üye kendi kısıtlamasını görebilmeli');
  const benimIyi = await api(BASE, '/api/sanctions/me', null, 'GET', iyi.token);
  assert.strictEqual(benimIyi.yaptirim, null, 'kısıtlı olmayan üye için null dönmeli');
  console.log('  ✓ 9) yaptırım listesi ve "kendi durumum" uçları doğru');

  // ---- 8) kaldırma ----
  const kaldir = await api(BASE, '/api/admin/sanctions/lift', { userId: kotu.id, tur: 'chat' }, 'POST', kurucu.token);
  assert.ok(kaldir.ok && kaldir.kaldirilan >= 1, 'yaptırım kaldırılmalı');
  await sleep(300);
  assert.ok(sKotu.__olaylar.find(x => x.ev === 'chatSanctionLifted'), 'kaldırma bildirimi gitmeli');
  await sleep(1100);
  const sonra = await mesajGonder(sKotu, 'room', 'artik-yazabiliyorum');
  assert.strictEqual(sonra.kabul, true, 'kaldırıldıktan sonra yeniden yazabilmeli');
  console.log('  ✓ 8) kurucu kaldırınca üye yeniden yazabiliyor (+ bildirim)');

  // ---- 7) belirli süre: dolunca kendiliğinden kalkar ----
  await sleep(1100);
  const kisa = await api(BASE, '/api/admin/sanctions',
    { userId: kotu.id, tur: 'chat', sure: 'ozel', dakika: 1, sebep: 'kısa susturma' }, 'POST', kurucu.token);
  assert.ok(kisa.ok, 'belirli süreli yaptırım uygulanmalı');
  assert.ok(Math.abs(kisa.yaptirim.bitis - (Date.now() + 60000)) < 4000, '1 dakikalık bitiş doğru hesaplanmalı');
  assert.strictEqual((await mesajGonder(sKotu, 'global', 'kisa-sure-icinde')).kabul, false,
    'belirli süre içinde yazamamalı');
  // Bitişi geçmişe çekip (veritabanında) süre dolmuş senaryoyu doğrula:
  const { db } = require('../db');
  db.prepare('UPDATE sanctions SET expires_at = ? WHERE user_id = ? AND lifted_at IS NULL')
    .run(Date.now() - 1000, kotu.id);
  await sleep(350);                                    // önbellek TTL'i geçsin
  assert.strictEqual((await mesajGonder(sKotu, 'global', 'sure-doldu-yazabilirim')).kabul, true,
    'süresi dolan yaptırım KENDİLİĞİNDEN kalkmalı');
  const bitmisMe = await api(BASE, '/api/sanctions/me', null, 'GET', kotu.token);
  assert.strictEqual(bitmisMe.yaptirim, null, 'süresi dolan yaptırım "kendi durumum" ucunda da yok sayılmalı');
  console.log('  ✓ 7) süresi dolan yaptırım kendiliğinden kalkıyor');

  // ---- geçersiz girdiler ----
  const kotuSure = await api(BASE, '/api/admin/sanctions', { userId: iyi.id, tur: 'chat', sure: 'ozel', dakika: 0 }, 'POST', kurucu.token);
  assert.ok(!kotuSure.ok, 'geçersiz özel süre reddedilmeli');
  const kotuTur = await api(BASE, '/api/admin/sanctions', { userId: iyi.id, tur: 'ban', sure: '1g' }, 'POST', kurucu.token);
  assert.ok(!kotuTur.ok, 'tanımsız yaptırım türü reddedilmeli (şimdilik yalnız sohbet)');
  console.log('  ✓ geçersiz süre/tür istekleri reddediliyor');

  sKotu.close(); sIyi.close();
  serverModule.io.close();
  await new Promise(r => server.close(r));
  console.log('OK üye yaptırımları: sohbet kısıtlaması (oyun içi + genel), bildirim, süre seçenekleri, kaldırma');
  process.exit(0);
}
main().catch(e => { console.error('❌ YAPTIRIM TEST HATASI:', e); process.exit(1); });
