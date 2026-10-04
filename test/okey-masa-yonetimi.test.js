'use strict';
/* ============================================================================
 * KURUCU PANELİ — OKEY ve 101 OKEY MASA YÖNETİMİ
 * ============================================================================
 * Kullanıcı isteği: "kurucu panelindeki okey ve 101 okey'in masa düzenlerinde
 * masa artırma ve eksiltme düzeltme ayarları yok onları da düzenle."
 *
 * ÖLÇÜLEN ESKİ DURUM: panel okey/101 okey'i "(18 hazır masa — yapı sabit)"
 * diye gösteriyor ve satırlarında YALNIZ "Görünür" düğmesi çiziyordu.
 * Oysa sunucu bu oyunların masalarını zaten düzenlenebilir tutuyordu
 * (normPresetConfig → isManagedCardGame). Eksik olan tek şey paneldi.
 *
 * NE DOĞRULANIR:
 *   1) Sunucu şeması okey/101 okey'i DÜZENLENEBİLİR olarak bildiriyor ve
 *      kişi/el sütunu olan oyunları ayrıca işaretliyor.
 *   2) Kurucu okey masası EKLEYEBİLİYOR: yeni masa gerçekten lobide açılıyor.
 *   3) Yeni masanın kimliği BENZERSİZ: eski kod varsayılanlar bitince son
 *      masanın kimliğini kopyalıyordu ve iki masa aynı odaya çöküyordu.
 *   4) Kişi sayısı ve el sayısı düzenlemesi lobiye yansıyor.
 *   5) Masa ÇIKARILABİLİYOR.
 *   6) 101 Okey için de aynısı geçerli.
 *   7) Panel arayüzü (jsdom): okey satırında ➕/➖/Düzenle düğmeleri var,
 *      "yapı sabit" yazısı kalkmış, düzenleme satırında kişi ve el seçicisi
 *      çıkıyor.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-okey-masa-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@kurucu.com';
process.env.GV_ADMIN_PASS = 'test-kurucu-sifresi-9271';
process.env.GV_OKEY_PRESETS = '1';
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, {
    method: method || (body ? 'POST' : 'GET'), headers,
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function masalar(base, gid) {
  const r = await api(base, '/api/rooms?gameId=' + gid, null, 'GET');
  return (r.rooms || []).filter(x => x.isPreset !== false);
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;

  const giris = await api(BASE, '/api/auth/login',
    { email: 'kurucu@kurucu.com', password: 'test-kurucu-sifresi-9271' });
  assert.ok(giris.token, 'kurucu girişi yapılmalı');
  const T = giris.token;

  // ---------- 1) şema ----------
  const sema = (await api(BASE, '/api/admin/tables', null, 'GET', T)).sema;
  assert.ok(sema, 'panel şeması gelmeli');
  for (const g of ['okey', 'okey101']) {
    assert.ok(sema.duzenlenebilir.includes(g), g + ' düzenlenebilir listesinde olmalı');
    assert.ok(sema.kartMasalari.includes(g), g + ' kişi/el sütunu olan oyunlardan olmalı');
    assert.ok(Number(sema.kartSinir[g]) > 0, g + ' için masa üst sınırı bildirilmeli');
  }
  assert.ok(sema.kartSinir.okey >= 19, 'okey varsayılan 18 masanın üstüne yer kalmalı');
  console.log('  ✓ 1) sunucu şeması okey/101 okey\'i düzenlenebilir bildiriyor');

  // ---------- 2-3) okey masası ekle ----------
  const ayar = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  const okeyMasalari = ayar.okey.tables.slice();
  const once = await masalar(BASE, 'okey');
  assert.strictEqual(once.length, okeyMasalari.length, 'lobideki masa sayısı ayarla aynı olmalı');

  /* Panelin "➕ Masa" düğmesinin yaptığının AYNISI: kimlik VERMEDEN yeni
     satır ekle. Kimliği sunucu üretmeli. */
  okeyMasalari.push({ name: '4 Kişilik • 5 El — Yeni Masa', type: 'normal',
                      durationMinutes: 15, maxPlayers: 4, rounds: 5 });
  let r = await api(BASE, '/api/admin/tables-apply',
    { games: Object.assign({}, ayar, { okey: { visible: true, tables: okeyMasalari } }) }, 'POST', T);
  assert.strictEqual(r.ok, true, 'ayar uygulanmalı — ' + JSON.stringify(r).slice(0, 200));

  const sonra = await masalar(BASE, 'okey');
  assert.strictEqual(sonra.length, once.length + 1,
    'yeni okey masası lobide açılmalı — ' + once.length + ' → ' + sonra.length);
  const kimlikler = sonra.map(x => String(x.id));
  assert.strictEqual(new Set(kimlikler).size, kimlikler.length,
    'masa kimlikleri BENZERSİZ olmalı (eski hata: yeni masa son masanın kimliğini alıyordu)');
  const yeni = sonra.find(x => /Yeni Masa/.test(x.name || ''));
  assert.ok(yeni, 'yeni masa adıyla lobide görünmeli');
  assert.strictEqual(Number(yeni.maxPlayers), 4, 'kişi sayısı korunmalı');
  assert.strictEqual(Number(yeni.rounds), 5, 'el sayısı korunmalı');
  console.log('  ✓ 2) okey masası eklendi, kimliği benzersiz, kişi/el ayarı korundu');

  // ---------- 4) kişi ve el düzenlemesi ----------
  const ayar2 = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  const t = ayar2.okey.tables;
  const hedefId = String(t[0].id);
  t[0] = Object.assign({}, t[0], { maxPlayers: 3, rounds: 7, name: 'Düzenlenmiş Masa' });
  r = await api(BASE, '/api/admin/tables-apply', { games: ayar2 }, 'POST', T);
  assert.strictEqual(r.ok, true);
  const d = (await masalar(BASE, 'okey')).find(x => String(x.id) === hedefId);
  assert.ok(d, 'düzenlenen masa lobide durmalı');
  assert.strictEqual(Number(d.maxPlayers), 3, 'kişi sayısı değişmeli');
  assert.strictEqual(Number(d.rounds), 7, 'el sayısı değişmeli');
  assert.strictEqual(d.name, 'Düzenlenmiş Masa', 'masa adı değişmeli');
  console.log('  ✓ 3) okey masasının kişi sayısı, el sayısı ve adı düzenlenebiliyor');

  // ---------- 5) masa çıkar ----------
  const ayar3 = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  const kalan = ayar3.okey.tables.length - 1;
  ayar3.okey.tables.pop();
  r = await api(BASE, '/api/admin/tables-apply', { games: ayar3 }, 'POST', T);
  assert.strictEqual(r.ok, true);
  assert.strictEqual((await masalar(BASE, 'okey')).length, kalan, 'masa çıkarılabilmeli');
  console.log('  ✓ 4) okey masası çıkarılabiliyor');

  // ---------- 6) 101 okey ----------
  const ayar4 = (await api(BASE, '/api/admin/tables', null, 'GET', T)).games;
  const o101 = await masalar(BASE, 'okey101');
  ayar4.okey101.tables.push({ name: '3 Kişilik • Yeni 101 Masası', type: 'fast',
                              durationMinutes: 10, maxPlayers: 3 });
  r = await api(BASE, '/api/admin/tables-apply', { games: ayar4 }, 'POST', T);
  assert.strictEqual(r.ok, true);
  const o101son = await masalar(BASE, 'okey101');
  assert.strictEqual(o101son.length, o101.length + 1, '101 okey masası eklenebilmeli');
  const k101 = o101son.map(x => String(x.id));
  assert.strictEqual(new Set(k101).size, k101.length, '101 okey kimlikleri de benzersiz olmalı');
  console.log('  ✓ 5) 101 okey masası da eklenebiliyor, kimlikler benzersiz');

  // ---------- 7) panel arayüzü ----------
  const kod = fs.readFileSync(path.join(__dirname, '..', 'js', 'admin-panel.js'), 'utf8');
  assert.ok(!/yapı sabit/.test(kod),
    '"(18 hazır masa — yapı sabit)" yazısı kalkmalı — artık düzenlenebiliyor');
  assert.ok(/function duzenlenirMi/.test(kod) && /DUZENLENEBILIR/.test(kod),
    'düğme görünürlüğü STANDARD listesine değil, sunucunun düzenlenebilir listesine bağlanmalı');
  assert.ok(/data-edit="kisi"/.test(kod) && /data-edit="el"/.test(kod),
    'kart/okey masalarında kişi ve el seçicileri çizilmeli');
  assert.ok(/sema\.duzenlenebilir/.test(kod), 'liste sunucudan okunmalı');
  assert.ok(/ekleDugmesiTazele/.test(kod),
    'üst sınıra gelince "➕ Masa" kilitlenmeli, masa silinince açılmalı');
  console.log('  ✓ 6) panel kodu okey/101 okey\'e masa düğmelerini ve kişi/el sütunlarını çiziyor');

  server.close();
  console.log('OK okey + 101 okey masa yönetimi: ekle, düzenle, çıkar; kimlikler benzersiz');
  process.exit(0);
}
main().catch(e => { console.error('❌ OKEY MASA YÖNETİMİ HATASI:', e); process.exit(1); });
