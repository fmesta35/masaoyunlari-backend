'use strict';
/* =====================================================================
   TURNUVA — UÇTAN UCA AKIŞ
   ---------------------------------------------------------------------
   Kullanıcının tarifi:
     "Turnuva günü ve saatleri tamamen kurucu tarafından ayarlanır.
      Turnuvaya sadece üyeler katılabilir. 'Turnuvaya katıl' butonuna
      tıklayan oyuncular kendilerini kayıt ederler ve kendilerine bildirim
      gider. İstenilen katılımcı sayısına ulaşılırsa tüm kullanıcılara
      başlangıç bildirimleri gider. Eşleşen kişiler herkese açık tablo
      hâlinde gösterilir. Kazanan ve kaybeden kayıt edilir... En son
      şampiyon ilan edilir."

   Doğrulananlar:
     1) Turnuvayı yalnız kurucu kurabilir; saatler tutarsızsa reddedilir.
     2) Kayıt penceresi açılınca durum 'kayit' olur ve duyuru gider.
     3) Ziyaretçi katılamaz; üye katılınca KENDİSİNE bildirim gider.
     4) Kontenjan dolunca HERKESE başlangıç bildirimi gider.
     5) Başlangıç saatinde kura çekilir, braket herkese açık döner ve
        her eşleşme için turnuva odası açılır (yalnız o iki oyuncu girer).
     6) Maç sonucu brakete işlenir; final bitince ŞAMPİYON ilan edilir.
   ===================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-turnuva-'));
process.env.GV_DATA_DIR = TMP;                     // her koşuda temiz veritabanı
process.env.GV_TOURNAMENT_TICK_MS = '250';         // zamanlayıcı testte hızlansın
process.env.GV_ADMIN_EMAIL = 'kurucu@turnuva.test';
process.env.GV_ADMIN_PASS = 'kurucu-test-sifresi-7714';

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const uyu = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function api(yol, govde, yontem, jeton) {
  const h = { 'Content-Type': 'application/json' };
  if (jeton) { h.Authorization = 'Bearer ' + jeton; h['X-GV-Token'] = jeton; }
  const r = await fetch(BASE + yol, {
    method: yontem || (govde ? 'POST' : 'GET'), headers: h,
    body: govde ? JSON.stringify(govde) : undefined
  });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}

async function uyeYap(ad, eposta) {
  const reg = await api('/api/auth/register', { name: ad, email: eposta, password: 'gucluSifre123' }, 'POST');
  assert.ok(reg.ok, 'kayıt: ' + JSON.stringify(reg));
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
  await api('/api/auth/verify', { token: vt }, 'POST');
  const g = await api('/api/auth/login', { email: eposta, password: 'gucluSifre123' }, 'POST');
  assert.ok(g.ok && g.token, 'giriş: ' + JSON.stringify(g));
  return { uid: reg.userId, token: g.token, ad };
}

function baglan() { return ioClient(BASE, { transports: ['websocket'], forceNew: true }); }

async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 9000)) { const v = await fn(); if (v) return v; await uyu(120); }
  throw new Error('zaman aşımı: ' + ne);
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://127.0.0.1:' + server.address().port;

  // Kurucu hesabı GV_ADMIN_EMAIL/GV_ADMIN_PASS ile sunucu açılışında kurulur.
  const kgiris = await api('/api/auth/login',
    { email: 'kurucu@turnuva.test', password: 'kurucu-test-sifresi-7714' }, 'POST');
  assert.ok(kgiris.ok && kgiris.token, 'kurucu girişi: ' + JSON.stringify(kgiris));
  const kurucu = { uid: kgiris.user.id, token: kgiris.token, ad: 'Kurucu' };
  const a = await uyeYap('AliOyuncu', 'ali@turnuva.test');
  const b = await uyeYap('VeliOyuncu', 'veli@turnuva.test');

  // Bildirimleri dinlemek için soketler
  const sA = baglan(), sB = baglan();
  const bildirimA = [], bildirimB = [];
  sA.on('tournamentNotice', p => bildirimA.push(p));
  sB.on('tournamentNotice', p => bildirimB.push(p));
  await uyu(300);
  sA.emit('authHello', { token: a.token });
  sB.emit('authHello', { token: b.token });
  await uyu(500);

  // ---------- 1) Yetki ve saat tutarlılığı ----------
  {
    const yetkisiz = await api('/api/admin/tournaments',
      { gameId: 'dama', ad: 'Sızma', kayitAcilis: Date.now(), kayitKapanis: Date.now() + 1000, baslangic: Date.now() + 2000 },
      'POST', a.token);
    assert.ok(yetkisiz.status === 401 || yetkisiz.status === 403,
      'turnuvayı yalnız kurucu kurabilmeli — dönen: ' + yetkisiz.status);

    const ters = await api('/api/admin/tournaments',
      { gameId: 'dama', ad: 'Ters saat', kayitAcilis: Date.now() + 5000, kayitKapanis: Date.now() + 1000, baslangic: Date.now() + 9000 },
      'POST', kurucu.token);
    assert.strictEqual(ters.ok, false, 'kayıt kapanışı açılıştan önce olamaz');
    console.log('  ✓ 1) turnuvayı yalnız kurucu kurar, tutarsız saatler reddedilir');
  }

  // ---------- 2) Turnuvayı kur: kayıt hemen açık, başlangıç birazdan ----------
  const n = Date.now();
  const kurulum = await api('/api/admin/tournaments', {
    gameId: 'dama', ad: 'Cumartesi Kupası',
    kayitAcilis: n - 1000, kayitKapanis: n + 60000, baslangic: n + 60000,
    bitis: n + 120000, kapasite: 2, not: 'Maçlar 10 dakikalıktır.'
  }, 'POST', kurucu.token);
  assert.ok(kurulum.ok, 'turnuva kurulmalı: ' + JSON.stringify(kurulum));
  const tid = kurulum.turnuva.id;

  await bekle(async () => {
    const l = await api('/api/tournaments');
    const t = (l.liste || []).find(x => x.id === tid);
    return t && t.durum === 'kayit' ? t : null;
  }, 9000, 'kayıtlar açılmalı');
  console.log('  ✓ 2) kayıt penceresi açılınca durum "kayit" oldu');

  // ---------- 3) Ziyaretçi katılamaz, üye katılınca kendine bildirim gider ----------
  {
    const misafir = await api('/api/tournaments/' + tid + '/katil', {}, 'POST');
    assert.strictEqual(misafir.status, 401, 'ziyaretçi katılamamalı');

    const r = await api('/api/tournaments/' + tid + '/katil', {}, 'POST', a.token);
    assert.ok(r.ok, 'üye katılabilmeli: ' + JSON.stringify(r));
    assert.strictEqual(r.turnuva.kayitliyim, true, 'kayıt bayrağı dönmeli');

    await bekle(async () => bildirimA.some(x => /Kaydınız alındı/i.test(x.metin || '')), 6000,
      'kayıt olana kendi bildirimi gitmeli');
    assert.ok(bildirimA.some(x => /Maçlar 10 dakikalıktır/.test(x.metin || '')),
      'kurucunun özel notu bildirime eklenmeli');
    assert.strictEqual(bildirimB.some(x => /Kaydınız alındı/i.test(x.metin || '')), false,
      'kişisel kayıt bildirimi BAŞKASINA gitmemeli');
    console.log('  ✓ 3) ziyaretçi katılamıyor; üyeye kişisel kayıt bildirimi + kurucu notu gidiyor');
  }

  // ---------- 4) Kontenjan dolunca herkese bildirim ----------
  {
    const r = await api('/api/tournaments/' + tid + '/katil', {}, 'POST', b.token);
    assert.ok(r.ok);
    await bekle(async () => bildirimA.some(x => /Kontenjan doldu/i.test(x.metin || '')) &&
                            bildirimB.some(x => /Kontenjan doldu/i.test(x.metin || '')), 6000,
      'kontenjan dolunca herkese bildirim gitmeli');
    const l = await api('/api/tournaments');
    const t = (l.liste || []).find(x => x.id === tid);
    assert.strictEqual(t.durum, 'hazir', 'kontenjan dolunca durum "hazir" olmalı');
    assert.strictEqual(t.katilimci, 2);
    console.log('  ✓ 4) kontenjan dolunca herkese başlangıç bildirimi gitti');
  }

  // ---------- 5) Başlangıç saati: kura, braket, turnuva odası ----------
  {
    // Başlangıcı öne çek (kurucu saatleri istediği gibi değiştirebilir).
    const g = await api('/api/admin/tournaments',
      { id: tid, kayitAcilis: n - 1000, kayitKapanis: n + 500, baslangic: n + 800 }, 'POST', kurucu.token);
    assert.ok(g.ok, 'saat güncellenebilmeli: ' + JSON.stringify(g));

    const t = await bekle(async () => {
      const l = await api('/api/tournaments');
      const x = (l.liste || []).find(y => y.id === tid);
      return (x && x.durum === 'devam' && x.braket) ? x : null;
    }, 12000, 'turnuva başlamalı ve braket kurulmalı');

    assert.ok(Array.isArray(t.braket.turlar) && t.braket.turlar.length >= 1, 'braket turları olmalı');
    assert.strictEqual(t.braket.turAdlari[t.braket.turAdlari.length - 1], 'Final', 'son tur Final olmalı');
    const mac = t.braket.turlar[0][0];
    assert.ok(mac.a && mac.b, 'eşleşme herkese açık olmalı (iki oyuncu da görünüyor)');
    assert.ok(mac.roomId, 'eşleşme için turnuva odası açılmalı');
    // Braket giriş yapmamış birine de açık (herkese açık tablo)
    const acik = await api('/api/tournaments');
    const tAcik = (acik.liste || []).find(y => y.id === tid);
    assert.ok(tAcik.braket.turlar[0][0].a, 'braket giriş yapmayanlara da görünmeli');
    console.log('  ✓ 5) kura çekildi, braket herkese açık, maç odası açıldı');

    // ---------- 6) Sonuç brakete işleniyor, şampiyon ilan ediliyor ----------
    // Maçı doğrudan sonuçlandırmak yerine sunucunun maç-bitti kancasını
    // gerçek bir odayla tetikliyoruz: odaya iki oyuncu girer, biri pes eder.
    const c1 = baglan(), c2 = baglan();
    await uyu(250);
    c1.emit('authHello', { token: a.token });
    c2.emit('authHello', { token: b.token });
    await uyu(600);
    c1.emit('joinRoom', { roomId: mac.roomId, gameId: 'dama', memberToken: a.token });
    c2.emit('joinRoom', { roomId: mac.roomId, gameId: 'dama', memberToken: b.token });
    await uyu(900);
    c1.emit('setReady', { ready: true });
    c2.emit('setReady', { ready: true });
    await uyu(900);
    c2.emit('gvResign', { roomId: mac.roomId });      // Veli pes eder → Ali kazanır

    const bitti = await bekle(async () => {
      const l = await api('/api/tournaments');
      const x = (l.liste || []).find(y => y.id === tid);
      return (x && x.durum === 'bitti' && x.sampiyon) ? x : null;
    }, 15000, 'final bitince şampiyon ilan edilmeli');

    assert.strictEqual(bitti.sampiyon.uid, a.uid, 'pes etmeyen oyuncu şampiyon olmalı');
    assert.strictEqual(bitti.sampiyon.name, 'AliOyuncu');
    const finalMac = bitti.braket.turlar[bitti.braket.turlar.length - 1][0];
    assert.strictEqual(finalMac.durum, 'bitti', 'final maçı bitmiş görünmeli');
    assert.strictEqual(finalMac.kazanan, a.uid, 'kazanan brakete işlenmeli');
    assert.ok(bildirimA.some(x => /ŞAMPİYON/i.test(x.metin || '')), 'şampiyon duyurusu gitmeli');
    console.log('  ✓ 6) maç sonucu brakete işlendi ve şampiyon ilan edildi');

    c1.close(); c2.close();
  }

  sA.close(); sB.close();
  server.close();
  console.log('OK turnuva akışı');
  process.exit(0);
}

main().catch(e => { console.error('❌ TURNUVA HATASI:', e); process.exit(1); });
