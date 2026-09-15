'use strict';
/* ============================================================================
 * "ÇEVRİMİÇİ OYUNCU" SAYACI (/api/live-stats) — GERÇEK KİŞİ SAYIMI
 * ============================================================================
 * Kullanıcı raporu: "Çevrimiçi oyuncu sayısı 1 den 3 e yükseliyor, gerçek
 * değeri yansıtmıyor gibi kontrol et."
 *
 * Kök neden: presenceSoketBagla(), bir ziyaretçi GİRİŞ YAPTIĞINDA kimliğini
 * (g:cihaz → u:uid) değiştirirken yalnızca SOKETİ eski kayıttan sökuyordu;
 * eski (g:cihaz) kaydın HTTP nabzı (sonHttp) SIFIRLANMIYORDU. Bu yüzden eski
 * ziyaretçi kaydı, giriş öncesi son nabzı yüzünden TTL (45 sn) boyunca
 * "hâlâ sitede" sayılmaya devam ediyordu — GERÇEKTE TEK KİŞİ olan ziyaretçi,
 * giriş yaptığı anda hem eski (misafir) hem yeni (üye) kaydıyla ÇİFT
 * sayılıyordu. Birkaç giriş/çıkış denemesi her seferinde bir hayalet kayıt
 * daha ekleyip sayacı 1 → 2 → 3'e taşıyabiliyordu.
 *
 * Bu test presenceSoketBagla'daki düzeltmeyi (kimlik değişince eski kaydın
 * sonHttp'si de sıfırlanır) uçtan uca (HTTP nabız + soket olay, gerçek
 * /api/live-stats ucu üzerinden) doğrular.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-presence-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@presence.test';
process.env.GV_ADMIN_PASS = 'kurucu-presence-sifresi-771';

const assert = require('assert');
const serverModule = require('../server.js');
const { io } = require('socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
function nabiz(base, uid, cihaz) { return api(base, '/api/live-stats', { uid, cihaz }, 'POST'); }
function soketAc(base) {
  return new Promise((res, rej) => {
    const s = io(base, { transports: ['websocket'], forceNew: true });
    const t = setTimeout(() => rej(new Error('soket zaman aşımı')), 8000);
    s.on('connect', () => { clearTimeout(t); res(s); });
  });
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1) tek ziyaretçi: HTTP nabız + soket → 1 kişi ----------
  const cihazA = 'zpresenceA111';
  const sA = await soketAc(BASE);
  sA.emit('gvPresence', { uid: null, cihaz: cihazA });
  await nabiz(BASE, null, cihazA);
  await sleep(150);
  let live = await nabiz(BASE, null, cihazA);
  assert.strictEqual(live.online, 1, 'tek ziyaretçi 1 kişi sayılmalı: ' + JSON.stringify(live));
  assert.strictEqual(live.guests, 1, 'ziyaretçi guests altında');
  console.log('  ✓ 1) Tek ziyaretçi (HTTP nabız + soket) doğru şekilde 1 kişi sayılıyor');

  // ---------- 2) AYNI ziyaretçinin 2. sekmesi (aynı cihaz anahtarı) → hâlâ 1 ----------
  const sA2 = await soketAc(BASE);
  sA2.emit('gvPresence', { uid: null, cihaz: cihazA });
  await sleep(150);
  live = await nabiz(BASE, null, cihazA);
  assert.strictEqual(live.online, 1, 'aynı ziyaretçinin 2. sekmesi ÇİFT SAYILMAMALI: ' + JSON.stringify(live));
  console.log('  ✓ 2) Aynı ziyaretçinin birden çok sekmesi/soketi yine 1 kişi');

  // ---------- 3) KRİTİK: ziyaretçi GİRİŞ YAPAR — kimlik g:cihaz → u:uid geçer ----------
  const login = await api(BASE, '/api/auth/login', { email: 'kurucu@presence.test', password: 'kurucu-presence-sifresi-771' }, 'POST');
  assert.ok(login.ok && login.token, 'kurucu girişi');
  const uid = login.user.id;
  // Açık soketler kimliklerini yeni uid ile bildirir (auth.js'in yaptığı gibi):
  sA.emit('gvPresence', { uid, cihaz: cihazA });
  sA2.emit('gvPresence', { uid, cihaz: cihazA });
  await sleep(150);
  live = await nabiz(BASE, uid, cihazA);
  assert.strictEqual(live.online, 1,
    'GİRİŞ SONRASI hâlâ AYNI TEK KİŞİ olmalı — eski (misafir) kayıt hayalet olarak kalıp sayacı şişirmemeli: ' + JSON.stringify(live));
  assert.strictEqual(live.members, 1, 'artık üye olarak sayılmalı');
  assert.strictEqual(live.guests, 0, 'eski misafir kaydı ANINDA temizlenmeli (45 sn TTL beklenmemeli)');
  console.log('  ✓ 3) Giriş yapınca eski misafir kaydı ANINDA temizleniyor — "1\'den 3\'e yükselme" hatası düzeldi');

  // ---------- 4) GERÇEKTEN 2 farklı kişi varsa sayaç 2 göstermeli ----------
  const cihazB = 'zpresenceB222';
  const sB = await soketAc(BASE);
  sB.emit('gvPresence', { uid: null, cihaz: cihazB });
  await nabiz(BASE, null, cihazB);
  await sleep(150);
  live = await nabiz(BASE, uid, cihazA);
  assert.strictEqual(live.online, 2, 'gerçekten 2 farklı kişi varken sayaç 2 göstermeli: ' + JSON.stringify(live));
  assert.strictEqual(live.members, 1);
  assert.strictEqual(live.guests, 1);
  console.log('  ✓ 4) Gerçekten farklı 2 kişi varken sayaç doğru şekilde 2 gösteriyor (yanlışlıkla düşürülmüyor)');

  // ---------- 5) sekmeler kapanınca (presence-bye + soket kopması) sayaç düşer ----------
  sA.disconnect(); sA2.disconnect();
  await api(BASE, '/api/presence-bye', { uid, cihaz: cihazA });
  sB.disconnect();
  await api(BASE, '/api/presence-bye', { uid: null, cihaz: cihazB });
  await sleep(150);
  live = await api(BASE, '/api/live-stats', null, 'GET');
  assert.strictEqual(live.online, 0, 'herkes ayrılınca sayaç 0 olmalı: ' + JSON.stringify(live));
  console.log('  ✓ 5) Sekmeler kapanınca (presence-bye) sayaç anında 0\'a düşüyor');

  console.log('\n✅ PRESENCE-COUNT: "Çevrimiçi Oyuncu" sayacı giriş/çıkışta ve çoklu sekmede GERÇEK kişi sayısını yansıtıyor');
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ presence-count.test.js HATA:', e); process.exit(1); });
