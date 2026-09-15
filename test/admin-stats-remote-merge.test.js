'use strict';
/* ============================================================================
 * KURUCU PANELİ — "Toplam Üye: 0" (UZAK/Yöncü modunda)
 * ============================================================================
 * Kullanıcı raporu: "Toplam üye sayısı da sıfır gösteriyor."
 *
 * Kök neden: js/admin-panel.js refreshHeroStats() Yöncü sayfasında PHP'nin
 * (admin.php?action=stats — GERÇEK sayılar: totalUsers, newUsersX,
 * totalMatches, activeUsers) ve Render'ın (/api/admin/stats — CANLI durum:
 * onlineUsers, activeGames, ongoingMatches) sonuçlarını
 * `Object.assign({}, phpStats, renderStats)` ile birleştirir. UZAK modda
 * Render'ın yerel SQLite'ı (db.js) HER ZAMAN null'dur, ama eski kod bu
 * durumda bile totalUsers/newUsersX/totalMatches/activeUsers alanlarını
 * 0 DEĞERLERİYLE yanıta koyuyordu — Object.assign bu SIFIRLARI PHP'nin
 * gerçek sayılarının ÜZERİNE yazıyordu (ikinci kaynak önceliklidir).
 *
 * Bu test /api/admin/stats ucunu doğrudan doğrular: `db` yokken (UZAK mod
 * simülasyonu) yanıt bu alanları HİÇ İÇERMEMELİ — yalnızca gerçekten CANLI
 * olan (onlineUsers/totalGames/activeGames/ongoingMatches/now) alanlar
 * dönmeli. Böylece istemcideki birleştirme PHP'nin gerçek sayılarını asla
 * ezmez.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-stats-remote-'));
process.env.GV_DATA_DIR = TMP;
// UZAK mod: db.js bu ortam değişkeni tanımlıysa yerel SQLite'ı hiç açmaz.
process.env.GV_AUTH_API = 'http://127.0.0.1:9/unused'; // erişilemez — attestation PHP'siz doğrular
process.env.GV_SERVER_KEY = 'test-server-key-stats-0123456789';

const assert = require('assert');
const serverModule = require('../server.js');

function hmac(msg, key) { return crypto.createHmac('sha256', key).update(msg).digest('hex'); }
function attestFor(uid, name, founder) {
  const ts = Date.now(), exp = ts + 5 * 60000;
  const f = founder ? 1 : 0;
  const msg = uid + '|' + name + '|' + f + '|' + ts + '|' + exp;
  return { id: uid, name, founder: f, ts, exp, sig: hmac(msg, process.env.GV_SERVER_KEY) };
}
async function api(base, p, headers) {
  const r = await fetch(base + p, { headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {}) });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const att = attestFor(777, 'Kurucu Test', true);
  const attHeader = { 'X-GV-Attest': encodeURIComponent(JSON.stringify(att)) };

  const r = await api(BASE, '/api/admin/stats', attHeader);
  assert.strictEqual(r.status, 200, 'kurucu isteği kabul edilmeli (attestation ile PHP\'ye gitmeden)');
  assert.ok(r.ok && r.stats, 'stats döner');

  // GERÇEKTEN CANLI olan alanlar hâlâ var olmalı:
  for (const k of ['onlineUsers', 'totalGames', 'activeGames', 'ongoingMatches', 'now']) {
    assert.ok(k in r.stats, k + ' UZAK modda da bulunmalı (Render\'ın canlı verisi)');
  }
  console.log('  ✓ 1) UZAK modda Render\'ın gerçekten sahip olduğu canlı alanlar (online/oyun/oda) yanıtta var');

  // db'ye bağımlı alanlar UZAK modda YANITTA HİÇ OLMAMALI (0 olarak bile) —
  // yoksa istemcinin Object.assign(phpStats, renderStats) birleştirmesi
  // PHP'nin gerçek sayılarını bu sıfırlarla ezer:
  for (const k of ['totalUsers', 'newUsersToday', 'newUsersWeek', 'newUsersMonth', 'totalMatches', 'completedMatches', 'activeUsers', 'gamesToday']) {
    assert.ok(!(k in r.stats), k + ' UZAK modda (db yokken) yanıtta HİÇ olmamalı — olsaydı PHP\'nin gerçek sayısını 0 ile ezerdi: ' + JSON.stringify(r.stats));
  }
  console.log('  ✓ 2) UZAK modda db\'ye bağımlı alanlar (totalUsers dahil) yanıtta YOK — istemcideki Object.assign artık PHP\'nin gerçek sayılarını EZMİYOR ("Toplam Üye: 0" hatası düzeldi)');

  // İstemcideki birleştirme mantığını burada da simüle edelim (js/admin-panel.js
  // refreshHeroStats ile BİREBİR aynı: Object.assign({}, phpStats, renderStats)):
  const sahtePhpStats = { totalUsers: 42, newUsersToday: 3, newUsersWeek: 9, newUsersMonth: 20, totalMatches: 15, completedMatches: 15, activeUsers: 5 };
  const birlesik = Object.assign({}, sahtePhpStats, r.stats);
  assert.strictEqual(birlesik.totalUsers, 42, 'birleştirmede PHP\'nin GERÇEK toplam üye sayısı korunmalı, 0\'a düşmemeli');
  assert.strictEqual(birlesik.onlineUsers, r.stats.onlineUsers, 'birleştirmede Render\'ın canlı online sayısı da korunur');
  console.log('  ✓ 3) js/admin-panel.js\'teki birleştirme simülasyonu: PHP\'nin gerçek "Toplam Üye" değeri artık KORUNUYOR');

  console.log('\n✅ ADMIN-STATS-REMOTE-MERGE: UZAK modda "Toplam Üye: 0" hatası düzeldi — PHP\'nin gerçek sayıları artık ezilmiyor');
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ admin-stats-remote-merge.test.js HATA:', e); process.exit(1); });
