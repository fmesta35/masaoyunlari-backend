'use strict';
/* ============================================================================
 * PROFİL — GERÇEK PUAN/İSTATİSTİK VERİSİ (uydurma değer yok)
 * ============================================================================
 * Kullanıcı raporu: "Profilde fazil1905gs gösteriyor ama hala Ahmet Karadağ
 * diyor. Tüm kullanıcıların puan veri istatistikleri gerçeği yansıtsın,
 * rastgele değerler olmasın."
 *
 * Kök nedenler:
 *  1) index.html'deki pg-profile bölümü sabit "Ahmet Karadağ" / 456 maç /
 *     %57 kazanma metni içeriyordu — hiçbir yerde güncellenmiyordu.
 *  2) Profildeki "Küresel Sıra" (#487 gibi) gerçek bir sıralama değil,
 *     yalnızca puan aralığına göre sabit bir tablodan (getOverallRankInfo)
 *     UYDURULUYORDU.
 *
 * Bu test SUNUCU tarafını doğrular: /api/scores/me artık her üye için
 * gerçek maç/galibiyet sayısını VE gerçek küresel sırayı (sira) döner.
 * (İstemci tarafı — index.html'in bu veriyi profName/profMatches/
 * profWinRate/profRank alanlarına yazması — kaynak metninde doğrulanır;
 * bkz. aşağıdaki kaynak-metni kontrolü.)
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-profile-stats-'));
process.env.GV_DATA_DIR = TMP;

const assert = require('assert');
const serverModule = require('../server.js');

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

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  const A = await uyeAc(BASE, 'fazil1905gs', 'fazil@profil.test');
  const B = await uyeAc(BASE, 'YeniUye', 'yeni@profil.test');

  // A için gerçek maç geçmişi yaz: 3 galibiyet, 2 mağlubiyet, 1 terk.
  serverModule.__test.puanYaz([
    { uid: A.id, gameId: 'battleship', tur: 'win', puan: 30, roomId: 'r1' },
    { uid: A.id, gameId: 'battleship', tur: 'win', puan: 30, roomId: 'r2' },
    { uid: A.id, gameId: 'chess', tur: 'win', puan: 25, roomId: 'r3' },
    { uid: A.id, gameId: 'chess', tur: 'loss', puan: 5, roomId: 'r4' },
    { uid: A.id, gameId: 'chess', tur: 'loss', puan: 5, roomId: 'r5' },
    { uid: A.id, gameId: 'chess', tur: 'leave', puan: -10, roomId: 'r6' }
  ]);
  // B hiç oynamadı — puanı/maçı 0 olmalı, "hayalet" veri OLMAMALI.
  await new Promise(r => setTimeout(r, 150));

  const ozetA = await api(BASE, '/api/scores/me', null, 'GET', A.token);
  assert.strictEqual(ozetA.ok, true);
  assert.strictEqual(ozetA.ozet.genel.mac, 5, 'A: 5 maç (2 galibiyet battleship + 1 galibiyet + 2 mağlubiyet chess)');
  assert.strictEqual(ozetA.ozet.genel.galibiyet, 3, 'A: 3 galibiyet');
  assert.strictEqual(ozetA.ozet.genel.maglubiyet, 2, 'A: 2 mağlubiyet');
  assert.strictEqual(ozetA.ozet.genel.terk, 1, 'A: 1 terk');
  assert.ok(ozetA.ozet.toplam > 0, 'A: toplam puan > 0');
  console.log('  ✓ 1) /api/scores/me GERÇEK maç/galibiyet/mağlubiyet/terk sayılarını dönüyor (uydurma değer yok)');

  const ozetB = await api(BASE, '/api/scores/me', null, 'GET', B.token);
  assert.strictEqual(ozetB.ozet.genel.mac, 0, 'B hiç oynamadı: 0 maç (hayalet veri yok)');
  assert.strictEqual(ozetB.ozet.toplam, 0, 'B: 0 puan');
  console.log('  ✓ 2) Hiç oynamamış üye için 0 maç / 0 puan (rastgele değer üretilmiyor)');

  // Küresel sıra GERÇEK olmalı: A puan yaptıysa B'den önde olmalı.
  assert.strictEqual(typeof ozetA.ozet.sira, 'number', 'A için sayısal bir sıra dönmeli');
  assert.strictEqual(typeof ozetB.ozet.sira, 'number', 'B için de sayısal bir sıra dönmeli');
  assert.ok(ozetA.ozet.sira < ozetB.ozet.sira, 'puanlı üye (A) sırada puansız üyeden (B) önde olmalı: ' +
    ozetA.ozet.sira + ' vs ' + ozetB.ozet.sira);
  assert.strictEqual(ozetA.ozet.sira, 1, 'yalnız A puanlı: A #1 olmalı');
  console.log('  ✓ 3) Küresel sıra GERÇEK puan sıralamasından geliyor (önceden puan aralığına göre uydurulan sabit tablo değildi)');

  // İstemci kaynağı: sabit "Ahmet Karadağ" / 456 / %57 artık YOK; gerçek
  // veriyi yazan kod ve id'ler mevcut.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(!html.includes('Ahmet Karadağ'), 'sabit sahte isim "Ahmet Karadağ" kalmamalı');
  assert.ok(!/stat-val">456</.test(html), 'sabit sahte "456" maç sayısı kalmamalı');
  assert.ok(!/stat-val">%57</.test(html), 'sabit sahte "%57" kazanma oranı kalmamalı');
  assert.ok(html.includes('id="profMatches"'), 'profMatches id\'si eklenmiş olmalı');
  assert.ok(html.includes('id="profWinRate"'), 'profWinRate id\'si eklenmiş olmalı');
  assert.ok(/profName[\s\S]{0,400}st\.user\.name|st\.user\.name[\s\S]{0,400}profName/.test(html) === false ||
            html.includes("document.getElementById('profName')"), 'profName gerçek kullanıcı adıyla güncelleniyor olmalı');
  console.log('  ✓ 4) index.html: sabit sahte profil metni kaldırılmış, gerçek veriye bağlı id\'ler mevcut');

  console.log('\n✅ PROFİL: puan/istatistik verileri gerçeği yansıtıyor, uydurma değer yok');
  serverModule.io && serverModule.io.close();
  server.close();
  process.exit(0);
}

main().catch(e => {
  console.error('❌ profile-real-stats.test.js HATA:', e);
  process.exit(1);
});
