'use strict';

/*
 * KURUCU PANELİ — imzalı belgeyle (attestation) doğrulama.
 *
 *  Sorun (kullanıcı raporu): kurucu panelinde "Puan Tablosu Sıfırlama"
 *  boş/"ayarları okunamadı" gösteriyordu. Kök neden: requireAdmin() ->
 *  remote.me() -> auth.php?action=me — Yöncü'nün DDoS koruması Render'ın
 *  bu sunucu-sunucu çağrısını engelliyor (aynı sorun /api/admin/sanctions*
 *  uçlarını da etkiliyordu, çünkü hepsi requireAdmin() üzerinden geçiyor).
 *
 *  Çözüm: auth.php?action=attest çıktısına imzalı bir "founder" bayrağı
 *  eklendi (server-auth.js verifyAttestation). requireAdmin() artık
 *  tarayıcının X-GV-Attest başlığıyla taşıdığı bu belgeyi PHP'ye HİÇ
 *  ulaşmadan yerinde doğrular; yalnız belge yoksa eski (remote.me tabanlı)
 *  yola düşer. Bu test PHP'nin TAMAMEN erişilemez olduğu bir ortamda
 *  (attest-flow.test.js ile aynı simülasyon) tüm /api/admin/* uçlarının
 *  yine de doğru çalıştığını doğrular.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-admin-attest-'));
process.env.GV_DATA_DIR = TMP;
// Render'ın PHP'ye ulaşamadığı ortamı simüle et (DDoS 303 engeli, port 9 = discard).
process.env.GV_AUTH_API = 'http://127.0.0.1:9/api';
const KEY = 'test-admin-attest-key-0123456789-abcdef';
process.env.GV_SERVER_KEY = KEY;

const assert = require('assert');
const crypto = require('crypto');
const serverModule = require('../server.js');

function sign(msg) { return crypto.createHmac('sha256', KEY).update(msg).digest('hex'); }
function attestHeaderJson(id, name, founder, opts = {}) {
  const ts = opts.ts !== undefined ? opts.ts : Date.now();
  const exp = opts.exp !== undefined ? opts.exp : ts + 10 * 60 * 1000;
  const fo = founder ? 1 : 0;
  const sig = opts.sig !== undefined ? opts.sig : sign(id + '|' + name + '|' + fo + '|' + ts + '|' + exp);
  return JSON.stringify({ id, name, founder: fo, ts, exp, sig });
}

async function get(base, p, attest) {
  const headers = {};
  if (attest !== undefined) headers['X-GV-Attest'] = encodeURIComponent(attest);
  const r = await fetch(base + p, { headers });
  let d = null;
  try { d = await r.json(); } catch (_) {}
  return { status: r.status, data: d };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // 1) Kurucu (founder:1) belgesiyle: PHP'ye HİÇ ulaşmadan puan ayarları okunmalı.
  const kurucuAttest = attestHeaderJson(1, 'Kurucu', 1);
  let r = await get(BASE, '/api/admin/scores/settings', kurucuAttest);
  assert.strictEqual(r.status, 200, 'kurucu belgesiyle 200 bekleniyor: ' + JSON.stringify(r.data));
  assert.strictEqual(r.data && r.data.ok, true, 'puan ayarları okunabilmeli (PHP kapalıyken de): ' + JSON.stringify(r.data));
  console.log('  ✓ 1) /api/admin/scores/settings — kurucu belgesiyle PHP olmadan çalışıyor');

  // 2) Aynı belge türüyle yaptırım seçenekleri de okunabilmeli.
  r = await get(BASE, '/api/admin/sanctions/options', kurucuAttest);
  assert.strictEqual(r.data && r.data.ok, true, 'yaptırım seçenekleri okunabilmeli: ' + JSON.stringify(r.data));
  assert.ok(Array.isArray(r.data.sureler) && r.data.sureler.length === 6, '6 süre seçeneği dönmeli');
  console.log('  ✓ 2) /api/admin/sanctions/options — kurucu belgesiyle çalışıyor');

  // 3) Yaptırım listesi (boş de olsa ok:true).
  r = await get(BASE, '/api/admin/sanctions', kurucuAttest);
  assert.strictEqual(r.data && r.data.ok, true, 'yaptırım listesi okunabilmeli: ' + JSON.stringify(r.data));
  console.log('  ✓ 3) /api/admin/sanctions — kurucu belgesiyle çalışıyor');

  // 4) Kurucu OLMAYAN (founder:0) geçerli-imzalı belge → kesin 403 (yedek
  //    yola düşülmez, çünkü belge geçerli ve founder açıkça false).
  const uyeAttest = attestHeaderJson(2, 'Sıradan Üye', 0);
  r = await get(BASE, '/api/admin/scores/settings', uyeAttest);
  assert.strictEqual(r.status, 403, 'üye belgesiyle 403 bekleniyor');
  assert.strictEqual(r.data && r.data.ok, false);
  console.log('  ✓ 4) sıradan üye belgesiyle 403 — yetkisiz kurucu paneline giremiyor');

  // 5) Sahte imza (founder:1 iddia ama imza tutmuyor) → belge YOK SAYILIR,
  //    yedek yola (Bearer token) düşülür; token de yoksa nihayetinde 403.
  const sahte = attestHeaderJson(3, 'Sahte Kurucu', 1, { sig: 'bu-imza-tamamen-uydurma-0000' });
  r = await get(BASE, '/api/admin/scores/settings', sahte);
  assert.strictEqual(r.status, 403, 'sahte imza + tokensiz istek 403 vermeli');
  console.log('  ✓ 5) sahte imzalı "founder" iddiası reddedildi (yedek yolda da token yok → 403)');

  // 6) Süresi dolmuş belge de aynı şekilde geçersiz sayılır.
  const eski = attestHeaderJson(1, 'Kurucu', 1, { ts: Date.now() - 20 * 60 * 1000, exp: Date.now() - 10 * 60 * 1000 });
  r = await get(BASE, '/api/admin/scores/settings', eski);
  assert.strictEqual(r.status, 403, 'süresi dolmuş belge reddedilmeli');
  console.log('  ✓ 6) süresi dolmuş belge reddedildi');

  // 7) Belge hiç yoksa (eski istemci / yerel mod davranışı) sistem hâlâ
  //    eski yola düşer ve token yoksa nazikçe 403 verir (çökmez).
  r = await get(BASE, '/api/admin/scores/settings', undefined);
  assert.strictEqual(r.status, 403, 'belge yok + token yok → 403 (çökmemeli)');
  console.log('  ✓ 7) belge yokken eski yola düşülüyor, çökmeden 403');

  console.log('\n✅ ADMIN-ATTEST: Kurucu Paneli uçları Yöncü DDoS korumasından bağımsız çalışıyor');
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ admin-attest.test.js HATA:', e);
  process.exit(1);
});
