'use strict';
/* ============================================================================
 * HESAP SİLME — KULLANICININ KENDİSİ SİLER
 * ============================================================================
 * Kullanıcı isteği: "info@masaoyunlari.com.tr'ye direkt yönlendirip iş yükü
 * çıkarmayalım, silmek isteyen silsin." Karar: silme ANINDA ve KALICI,
 * onay = parola + 'geri alınamaz' kutusu.
 *
 * Silme geri alınamaz bir işlem olduğu için burada tek tek kanıtlanır:
 *   1) Oturumsuz çağrı 401, yanlış parola 403 — hesap DURUYOR.
 *   2) Doğru parola: hesap, oturum, arkadaşlık, puan kaydı gerçekten gitti;
 *      eski jetonla hiçbir yere girilemiyor.
 *   3) MAÇ KAYDI rakibin geçmişini bozmadan anonimleşiyor: satır kalıyor,
 *      silinen üyenin kimliği düşüyor. (Satır silinseydi rakibin maç
 *      geçmişi de yok olurdu — sessiz veri kaybı.)
 *   4) Kurucu hesabı bu yoldan silinemiyor (silinirse panele giriş kalmaz).
 *   5) Arayüz: silme bağlantısı PROFİLDE, alt bilgide DEĞİL; onay penceresi
 *      parola + onay kutusu istiyor; /?hesap-sil=1 pencereyi açıyor.
 * ========================================================================= */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-silme-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_ADMIN_EMAIL = 'kurucu@kurucu.com';
delete process.env.GV_AUTH_API;          // yerel (SQLite) mod

const KOK = path.join(__dirname, '..');

async function cagir(BASE, yol, { token, body, method } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = 'Bearer ' + token;
  const r = await fetch(BASE + yol, {
    method: method || (body ? 'POST' : 'GET'),
    headers: h,
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await r.json(); } catch (_) {}
  return { status: r.status, ...(j || {}) };
}

async function uyeYap(BASE, db, ad, mail) {
  const k = await cagir(BASE, '/api/auth/register', { body: { name: ad, email: mail, password: 'Parola123!' } });
  assert.ok(k.ok, 'kayıt başarılı olmalı: ' + JSON.stringify(k));
  db.prepare('UPDATE users SET verified = 1 WHERE email = ?').run(mail);
  const g = await cagir(BASE, '/api/auth/login', { body: { email: mail, password: 'Parola123!' } });
  assert.ok(g.ok && g.token, 'giriş başarılı olmalı: ' + JSON.stringify(g));
  return { token: g.token, id: g.user.id };
}

async function main() {
  const serverModule = require('../server.js');
  const server = await serverModule.start(0);
  const BASE = 'http://localhost:' + server.address().port;
  const { db } = require('../db.js');

  const ali = await uyeYap(BASE, db, 'AliSil', 'ali.sil@ornek.com');
  const veli = await uyeYap(BASE, db, 'VeliKalir', 'veli.kalir@ornek.com');

  // Silinecek üyenin etrafına gerçek veri koy: arkadaşlık, puan, ortak maç.
  db.prepare('INSERT INTO friends(user_id,friend_id,created_at) VALUES(?,?,?)').run(ali.id, veli.id, Date.now());
  db.prepare('INSERT INTO friends(user_id,friend_id,created_at) VALUES(?,?,?)').run(veli.id, ali.id, Date.now());
  db.prepare('INSERT INTO score_events(user_id,game_id,kind,points,ts) VALUES(?,?,?,?,?)')
    .run(ali.id, 'okey', 'win', 30, Date.now());
  const ortakMac = JSON.stringify([
    { id: ali.id, name: 'AliSil', won: true },
    { id: veli.id, name: 'VeliKalir', won: false }
  ]);
  db.prepare('INSERT INTO matches(game_id,room_id,players,winner,reason,ts) VALUES(?,?,?,?,?,?)')
    .run('okey', '301', ortakMac, 'AliSil', 'bitti', Date.now());
  const yalnizMac = JSON.stringify([{ id: ali.id, name: 'AliSil', won: true }]);
  const yalnizId = db.prepare('INSERT INTO matches(game_id,room_id,players,winner,reason,ts) VALUES(?,?,?,?,?,?)')
    .run('tavla', '201', yalnizMac, 'AliSil', 'bitti', Date.now()).lastInsertRowid;

  // ---------- 1) KÖTÜ YOLLAR: hesap durmalı ----------
  const oturumsuz = await cagir(BASE, '/api/auth/delete-account', { body: { password: 'Parola123!' } });
  assert.strictEqual(oturumsuz.status, 401, 'oturumsuz silme 401 olmalı');
  const yanlis = await cagir(BASE, '/api/auth/delete-account', { token: ali.token, body: { password: 'yanlis' } });
  assert.strictEqual(yanlis.status, 403, 'yanlış parola 403 olmalı');
  const parolasiz = await cagir(BASE, '/api/auth/delete-account', { token: ali.token, body: {} });
  assert.strictEqual(parolasiz.status, 403, 'parolasız istek 403 olmalı');
  assert.ok(db.prepare('SELECT id FROM users WHERE id = ?').get(ali.id),
    'başarısız denemelerden sonra hesap HÂLÂ durmalı');
  console.log('  ✓ 1) oturumsuz 401, yanlış/boş parola 403 — hesap silinmedi');

  // ---------- 2) DOĞRU PAROLA: gerçekten siliniyor ----------
  const ok = await cagir(BASE, '/api/auth/delete-account', { token: ali.token, body: { password: 'Parola123!' } });
  assert.ok(ok.ok, 'doğru parolayla silme başarılı olmalı: ' + JSON.stringify(ok));

  assert.ok(!db.prepare('SELECT id FROM users WHERE id = ?').get(ali.id), 'users satırı silinmeli');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM sessions WHERE user_id = ?').get(ali.id).c, 0, 'oturumlar silinmeli');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM friends WHERE user_id = ? OR friend_id = ?').get(ali.id, ali.id).c, 0,
    'arkadaşlık iki yönde de silinmeli');
  assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM score_events WHERE user_id = ?').get(ali.id).c, 0,
    'puan kayıtları silinmeli (sıralamadan düşsün)');

  const sonra = await cagir(BASE, '/api/auth/me', { token: ali.token });
  assert.strictEqual(sonra.status, 401, 'silinen hesabın eski jetonu artık geçersiz olmalı');
  console.log('  ✓ 2) hesap, oturum, arkadaşlık ve puan kayıtları gitti; eski jeton geçersiz');

  // ---------- 3) MAÇ KAYDI: rakip korunuyor, kimlik düşüyor ----------
  const kalan = db.prepare("SELECT players FROM matches WHERE room_id = '301'").get();
  assert.ok(kalan, 'ortak maç satırı DURMALI — silinirse rakibin geçmişi de yok olur');
  const oyuncular = JSON.parse(kalan.players);
  assert.strictEqual(oyuncular.length, 2, 'satırdaki oyuncu sayısı değişmemeli');
  const silinen = oyuncular.find(p => p.id === null);
  assert.ok(silinen, 'silinen üyenin kimliği (id) satırdan düşmeli');
  assert.strictEqual(silinen.name, 'Silinmiş kullanıcı', 'adı da anonimleşmeli');
  assert.strictEqual(silinen.won, true, 'maçın sonucu (kim kazandı) bozulmamalı');
  assert.ok(oyuncular.some(p => p.id === veli.id && p.name === 'VeliKalir'), 'rakip dokunulmadan kalmalı');
  assert.ok(!db.prepare('SELECT id FROM matches WHERE id = ?').get(yalnizId),
    'başka tanımlı üye kalmayan satır tamamen silinmeli');
  console.log('  ✓ 3) ortak maç anonimleşti (rakip korundu), tek kişilik maç tamamen silindi');

  // ---------- 4) KURUCU HESABI KORUNUYOR ----------
  const kurucu = await uyeYap(BASE, db, 'Kurucu', 'kurucu@kurucu.com');
  const red = await cagir(BASE, '/api/auth/delete-account', { token: kurucu.token, body: { password: 'Parola123!' } });
  assert.strictEqual(red.status, 403, 'kurucu hesabı bu yoldan silinememeli');
  assert.ok(db.prepare('SELECT id FROM users WHERE id = ?').get(kurucu.id), 'kurucu hesabı durmalı');
  console.log('  ✓ 4) kurucu hesabı silinemiyor (panele giriş kaybolmasın)');

  // ---------- 5) ARAYÜZ ----------
  const indexHtml = fs.readFileSync(path.join(KOK, 'index.html'), 'utf8');
  const altBilgi = (indexHtml.match(/<h4>İLETİŞİM<\/h4>[\s\S]{0,400}?<\/div>/) || [])[0] || '';
  assert.ok(!/hesap-silme/.test(altBilgi),
    'silme bağlantısı alt bilgiden kaldırılmalıydı (kullanıcı isteği)');
  const profil = (indexHtml.match(/<div class="page" id="pg-profile">[\s\S]*?\n    <\/div>/) || [])[0] || '';
  assert.ok(/Hesap Silme Hakkında/.test(profil) && /href="\/hesap-silme\.html"/.test(profil),
    'profil sayfasında "Hesap Silme Hakkında" bağlantısı olmalı');
  assert.ok(/id="deleteAccountModal"/.test(indexHtml), 'silme onay penceresi olmalı');
  assert.ok(/id="delAccPass"/.test(indexHtml) && /id="delAccOnay"/.test(indexHtml),
    'onay penceresi parola alanı ve onay kutusu istemeli');
  assert.ok(/hesap-sil=1/.test(indexHtml), '/?hesap-sil=1 ile pencere açılmalı');
  assert.ok(/'\/api\/auth\/delete-account'/.test(indexHtml), 'istemci silme ucunu çağırmalı');

  const silmeSayfasi = fs.readFileSync(path.join(KOK, 'hesap-silme.html'), 'utf8');
  assert.ok(/href="\/\?hesap-sil=1"/.test(silmeSayfasi),
    'silme sayfasının en altında uygulamaya dönen "Hesabımı Sil" düğmesi olmalı');
  assert.ok(!/Yalnız verilerin silinmesi/.test(silmeSayfasi),
    'böyle bir yetki yok — "yalnız verileri sil" bölümü kaldırılmalıydı');
  assert.ok(!/30\s*gün içinde yerine getirilir/.test(silmeSayfasi),
    'silme artık anında; "30 gün içinde yerine getirilir" ifadesi kalmamalı');

  const politika = fs.readFileSync(path.join(KOK, 'gizlilik-politikasi.html'), 'utf8');
  assert.ok(/kendiniz silersiniz/i.test(politika),
    'politika da silmenin kullanıcı tarafından yapıldığını yazmalı');

  const uzak = fs.readFileSync(path.join(KOK, 'auth-remote.js'), 'utf8');
  assert.ok(/'POST \/api\/auth\/delete-account'/.test(uzak),
    'uzak (Yöncü PHP) modda da silme ucu yönlendirilmeli');
  const php = fs.readFileSync(path.join(KOK, 'yoncu-api', 'auth.php'), 'utf8');
  assert.ok(/action === 'deleteAccount'/.test(php), 'PHP tarafında deleteAccount olmalı');
  assert.ok(/password_verify/.test(php.slice(php.indexOf("'deleteAccount'"))),
    'PHP tarafı da parolayı doğrulamalı');
  assert.ok(/gv_is_founder/.test(php.slice(php.indexOf("'deleteAccount'"))),
    'PHP tarafı da kurucu hesabını korumalı');
  console.log('  ✓ 5) arayüz, silme sayfası, politika ve PHP ucu tutarlı');

  server.close();
  console.log('OK hesap silme: kullanıcının kendisi siliyor, anında ve kalıcı');
  process.exit(0);
}
main().catch(e => { console.error('❌ HESAP SİLME HATASI:', e); process.exit(1); });
