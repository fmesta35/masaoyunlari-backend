'use strict';

/*
 * KURUCU PANELİ + YENİ HAZIR MASALAR (uçtan uca):
 *
 *  1) Damalar/Reversi/Gomoku/Connect4/Bilardo için 10'AR hazır masa
 *     (4 Hızlı / 3 Normal / 3 Düşünen) açılır; satranç/tavla 10, okey 18.
 *  2) Yönetici hesabı (kurucu@kurucu.com / kurucu123) otomatik oluşur,
 *     giriş yapar; /api/admin/users yalnız kurucuya açıktır (diğerleri 403).
 *  3) tables-apply: oyun GİZLENEBİLİR (lobide masaları kalkar), masa
 *     SAYISI artar/azalır, masa ADI/TİPİ değişir — games-meta anında yansır.
 *  4) Değişiklikler DATAYA kaydedilir: sunucu AYNI DB ile yeniden
 *     başlatıldığında ayarlar korunur.
 *  5) jsdom: kurucu oturumunda üst barda "👑 Kurucu Paneli" butonu var;
 *     panelde Kullanıcı & Roller sekmesi üye listesini, Oyunlar sekmesi
 *     tüm oyunları (görünürlük + masa düğmeleri) listeler.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-admin-'));
process.env.GV_DATA_DIR = TMP;
process.env.GV_POST_GAME_HOLD_MS = '400';

const assert = require('assert');
const serverModule = require('../server.js');

async function api(base, p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(base + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function roomsOf(base, gid) {
  const r = await api(base, '/api/rooms?gameId=' + gid, null, 'GET');
  return r.rooms || [];
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = 'http://127.0.0.1:' + server.address().port;

  // ---------- 1) yeni hazır masalar ----------
  const counts = {};
  for (const g of ['chess', 'tavla', 'okey', 'dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo']) {
    counts[g] = (await roomsOf(BASE, g)).length;
  }
  assert.strictEqual(counts.chess, 10, 'satranç 10 masa');
  assert.strictEqual(counts.tavla, 10, 'tavla 10 masa');
  assert.strictEqual(counts.okey, 18, 'okey 18 masa');
  for (const g of ['dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4', 'bilardo']) {
    assert.strictEqual(counts[g], 10, g + ' 10 masa');
  }
  const dama = await roomsOf(BASE, 'dama');
  assert.strictEqual(dama[0].name, '⚡ Hızlı Masa #401', 'ilk masa Hızlı');
  assert.strictEqual(dama[3].name, '⚡ Hızlı Masa #404', '4. masa Hızlı (son hızlı)');
  assert.strictEqual(dama[4].name, '♟️ Normal Masa #405', '5. masa Normal (ilk normal)');
  assert.strictEqual(dama[7].name, '🧠 Düşünen Masa #408', '8. masa Düşünen (ilk düşünen)');
  assert.strictEqual(dama[0].maxPlayers, 2, '2 kişilik');
  console.log('  ✓ 1) 6 yeni oyun × 10 hazır masa (Hızlı/Normal/Düşünen) + satranç/tavla/okey mevcut');

  // ---------- 2) kurucu hesabı + admin yetki ----------
  const login = await api(BASE, '/api/auth/login', { email: 'kurucu@kurucu.com', password: 'kurucu123' }, 'POST');
  assert.ok(login.ok && login.token, 'kurucu girişi (otomatik oluşturulan hesap)');
  assert.strictEqual(login.user.name, '\u{1F451} Kurucu');
  const users = await api(BASE, '/api/admin/users', null, 'GET', login.token);
  assert.ok(users.ok && Array.isArray(users.users), 'üye listesi döner');
  const me = users.users.find(u => u.email === 'kurucu@kurucu.com');
  assert.ok(me && me.role === 'kurucu', 'kurucu rolü "kurucu"');
  const other = await api(BASE, '/api/auth/register', { name: 'Basit', email: 'basit@adm.tr', password: 'ortaksifre9' }, 'POST');
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(other.userId).verify_token;
  await api(BASE, '/api/auth/verify', { token: vt }, 'POST');
  const otherLogin = await api(BASE, '/api/auth/login', { email: 'basit@adm.tr', password: 'ortaksifre9' }, 'POST');
  const denied = await api(BASE, '/api/admin/users', null, 'GET', otherLogin.token);
  assert.strictEqual(denied.status, 403, 'diğer üyeler admin uçlarına girmez (403)');
  console.log('  ✓ 2) kurucu@kurucu.com otomatik hesapla giriş; üye listesi YALNIZ kurucuya açık');

  // ---------- 2b) ana sayfa istatistikleri (canlı, yalnız kurucu) ----------
  const stats = await api(BASE, '/api/admin/stats', null, 'GET', login.token);
  assert.ok(stats.ok && stats.stats, 'istatistik döner');
  assert.strictEqual(stats.stats.totalGames, 12, '12 oyun türü');
  assert.ok(stats.stats.onlineUsers >= 0, 'online kullanıcı sayısı');
  assert.ok(stats.stats.totalUsers >= 2, 'toplam üye (kurucu + basit)');
  assert.ok('newUsersToday' in stats.stats && 'newUsersWeek' in stats.stats && 'newUsersMonth' in stats.stats, 'günlük/haftalık/aylık yeni üye');
  assert.ok('totalMatches' in stats.stats && 'ongoingMatches' in stats.stats && 'completedMatches' in stats.stats, 'maç metrikleri');
  const statsDenied = await api(BASE, '/api/admin/stats', null, 'GET', otherLogin.token);
  assert.strictEqual(statsDenied.status, 403, 'istatistik yalnız kurucuya açık (403)');
  console.log('  ✓ 2b) ana sayfa istatistikleri: canlı metrikler yalnız kurucuya (online/üye/maç/yeni üye)');

  // ---------- 3) tables-apply: gizle / sayı / ad-tip ----------
  const meta0 = await api(BASE, '/api/games-meta', null, 'GET');
  assert.ok(meta0.ok && meta0.games.every(g => g.visible), 'başlangıçta tümü görünür');

  // damayı gizle + satranç masasını 12'ye çıkar + ilk masanın adını/tipini değiştir
  const chessTables = Array.from({ length: 12 }, (_, i) => ({
    name: i === 0 ? 'Kral Düellosu' : `Satranç Masası #${101 + i}`,
    type: i === 0 ? 'fast' : 'normal',
    durationMinutes: i === 0 ? 10 : 15
  }));
  let apply = await api(BASE, '/api/admin/tables-apply', {
    games: { dama: { visible: false }, chess: { visible: true, tables: chessTables } }
  }, 'POST');
  assert.ok(apply.ok, 'apply ok');
  assert.strictEqual(apply.games.find(g => g.id === 'dama').visible, false, 'meta: dama gizli');

  assert.strictEqual((await roomsOf(BASE, 'dama')).length, 0, 'dama masaları lobide KALDI');
  const chess12 = await roomsOf(BASE, 'chess');
  assert.strictEqual(chess12.length, 12, 'satranç 12 masa oldu');
  const first = chess12.find(r => String(r.id) === '101');
  assert.strictEqual(first.name, 'Kral Düellosu', 'masa adı değişti');
  assert.strictEqual(first.duration, 10, 'masa süresi değişti');
  // gizli oyunun lobi listesi boş olsa da oyun menüsünden gizlenmesi games-meta'da:
  const meta1 = await api(BASE, '/api/games-meta', null, 'GET');
  assert.strictEqual(meta1.games.find(g => g.id === 'dama').visible, false, 'games-meta dama gizli');
  console.log('  ✓ 3) oyun gizlendi (masalar kalktı), masa sayısı 12, ad/tip değişti — meta anında yansıdı');

  // geri aç + masa sayısını 8'e düşür:
  const dfltChess8 = serverModule.defaultPresetConfig().chess.tables.slice(0, 8);
  apply = await api(BASE, '/api/admin/tables-apply', {
    games: { dama: { visible: true }, chess: { visible: true, tables: dfltChess8 } }
  }, 'POST');
  assert.ok(apply.ok);
  assert.strictEqual((await roomsOf(BASE, 'dama')).length, 10, 'dama geri geldi (10 masa)');
  assert.strictEqual((await roomsOf(BASE, 'chess')).length, 8, 'satranç 8 masaya düştü');
  console.log('  ✓ 4) oyun geri açıldı; masa sayısı azaltıldı (dolu olmayan fazla masalar kaldırıldı)');

  // ---------- 4) kalıcılık: aynı DB ile yeniden başlat ----------
  serverModule.io.close();
  await new Promise(r => server.close(r));
  const server2 = await serverModule.start(0);
  const BASE2 = 'http://127.0.0.1:' + server2.address().port;
  assert.strictEqual((await roomsOf(BASE2, 'chess')).length, 8, 'yeniden başlatmada satranç 8 masa (kayıtlı ayar)');
  assert.strictEqual((await roomsOf(BASE2, 'dama')).length, 10, 'dama 10 masa');
  const login2 = await api(BASE2, '/api/auth/login', { email: 'kurucu@kurucu.com', password: 'kurucu123' }, 'POST');
  assert.ok(login2.ok, 'kurucu hesabı DB ile birlikte kaldı');
  console.log('  ✓ 5) ayarlar dataya kaydedildi: yeniden başlatmada aynı masa yapısı + kurucu hesabı');

  // ---------- 5) jsdom: panel butonu + sekmeler ----------
  const { JSDOM, VirtualConsole } = require('jsdom');
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 15000)) {
      try { const v = await fn(); if (v) return v; } catch (_) {}
      await sleep(150);
    }
    throw new Error('zaman aşımı: ' + label);
  }
  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});
  vc.on('error', () => {});
  const dom = await JSDOM.fromURL(BASE2 + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE2;
      w.fetch = (...a) => fetch(...a);
      try { w.localStorage.setItem('gv-auth-token', login2.token); } catch (_) {}
    }
  });
  const win = dom.window;
  await waitFor(() => (win.st && win.GV ? true : null), 15000, 'sayfa açılışı');
  await waitFor(() => (!win.st.isGuest && win.st.user && win.st.user.email === 'kurucu@kurucu.com' ? win.st.user : null), 15000, 'kurucu otomatik girişi');
  const btn = await waitFor(() => win.document.getElementById('adminPanelBtn'), 15000, '👑 Kurucu Paneli butonu');
  assert.ok(btn, 'kurucu oturumunda üst barda panel butonu var');
  btn.click();
  const modal = await waitFor(() => {
    const m = win.document.getElementById('adminPanelModal');
    return (m && m.classList.contains('show')) ? m : null;
  }, 15000, 'panel modalı açıldı');
  assert.ok(modal);
  // Kullanıcı & Roller sekmesi: üye listesi (kurucu + basit üye)
  await waitFor(() => {
    const b = win.document.getElementById('adminPanelBody');
    return (b && /KURUCU/.test(b.innerHTML) && /basit@adm\.tr/.test(b.innerHTML)) ? b : null;
  }, 15000, 'Kullanıcı & Roller sekmesinde üye listesi');
  console.log('  ✓ 6) panel açıldı; Kullanıcı & Roller sekmesi üye bilgilerini gösteriyor (isim, e-posta, rol)');
  // Oyunlar sekmesi: tüm oyunlar + düğenler
  win.document.querySelector('.admin-tab[data-tab="games"]').click();
  await waitFor(() => {
    const b = win.document.getElementById('adminPanelBody');
    return (b && /OYUNLAR/.test(b.innerHTML) && /İngiliz Daması/.test(b.innerHTML) && /Bilardo/.test(b.innerHTML)
      && /Görünür/.test(b.innerHTML) && /Masa/.test(b.innerHTML) && /Kaydet ve Uygula/.test(b.innerHTML)) ? b : null;
  }, 15000, 'Oyunlar sekmesi: tüm oyunlar + görünürlük + masa düğmeleri');
  console.log('  ✓ 7) Oyunlar sekmesi: tüm oyunlar listeli, görünüm anahtarı + masa artır/azalt + düzenle + Kaydet');

  // Buton, üye (kurucu olmayan) oturumunda GÖRÜNMEMELİ:
  const dom2 = await JSDOM.fromURL(BASE2 + '/index.html', {
    resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.GV_BACKEND_URL = BASE2;
      w.fetch = (...a) => fetch(...a);
      try { w.localStorage.setItem('gv-auth-token', otherLogin.token); } catch (_) {}
    }
  });
  const win2 = dom2.window;
  await waitFor(() => (!win2.st.isGuest && win2.st.user && win2.st.user.id ? win2.st.user : null), 15000, 'üye otomatik girişi');
  await sleep(1500); // hook taraması
  assert.ok(!win2.document.getElementById('adminPanelBtn'), 'sıradan üye panel butonu görünmez');
  console.log('  ✓ 8) sıradan üyede panel butonu YOK');

  console.log('\n✅ ADMIN-PANEL: hazır masalar + kurucu paneli + kalıcılık uçtan uca doğru');
  win.close(); win2.close();
  serverModule.io && serverModule.io.close();
  server2.close();
  process.exit(0);
}

main().catch(e => { console.error('❌ TEST HATASI:', e); process.exit(1); });
