'use strict';

/*
 * ŞİKAYET SİSTEMİ + UYARI GEÇMİŞİ (kullanıcı istekleri, verbatim):
 *
 *  (2) "Kurucu panelindeki kullanıcı ve roller de Kullanıcı, Katılım, Durum
 *       haricinde yan başlık 'Uyarılar' kısmı olsun... Uyarı almadıysa
 *       'Temiz' gözükür yeşil renkle, eğer geçmişte Uyarı Aldıysa 'Notlar'
 *       Butonu... Hangi tarihte, kaçıncı uyarıyı aldığı, kaç dakika / gün -
 *       hafta vs... Böylece katlamalı ceza uygulanabilir."
 *
 *  (3) "Oyun içi sohbette 'Kullanıcıyı Bildir' diye şikayet edilirse
 *       gerekçeleri seçebileceği pop-up çıksın... Kurucu panelinde
 *       Şikayetler alanı olacak, şikayet eden, şikayet edilen, tarih, oyun
 *       odası ve bilgisi ve oyun masası içerisinde gerçekleştirilen tüm
 *       sohbet... 'Sohbet' tıkladığında pop-up da detaylı olarak gözüksün...
 *       2 ayrı sekme olsun. 1.si Oyun içi sohbetler, 2.si genel sohbet...
 *       İlgili yorum şikayet edildiğinde o son 1 dakika içerisindeki
 *       sohbetin kaydı panele kayıt edilir aynı mantıkta."
 *
 * Doğrulananlar:
 *  1) Oyun içi şikayet: masadaki sohbet dökümü ŞİKAYET ANINDA dondurulup
 *     kaydedilir; oda kapansa bile panelde okunabilir.
 *  2) Genel sohbet şikayeti: yalnız SON 1 DAKİKANIN mesajları kaydedilir
 *     (daha eskisi alınmaz).
 *  3) Panel listesi sekmelere göre süzülür (oyun içi / genel).
 *  4) Şikayet uçları YALNIZ kurucuya açıktır.
 *  5) Uyarı geçmişi: kaldırılmış/süresi dolmuş yaptırımlar DA döner —
 *     kaçıncı uyarı ve ne kadar süre olduğu buradan çıkar (katlamalı ceza).
 *  6) Panel arayüzü: "Uyarılar" sütunu, uyarısı olmayanda yeşil "Temiz",
 *     olanda "Notlar" düğmesi; Şikayetler sekmesi ve iki alt sekme.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-report-'));
process.env.GV_ADMIN_EMAIL = 'kurucu@rapor.test';

const assert = require('assert');
const ioClient = require('socket.io-client');
const { JSDOM, VirtualConsole } = require('jsdom');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function api(p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) { headers.Authorization = 'Bearer ' + token; headers['X-GV-Token'] = token; }
  const r = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
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

function baglan() {
  return ioClient(BASE, { transports: ['websocket'], forceNew: true });
}
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 8000)) { const v = fn(); if (v) return v; await sleep(60); }
  throw new Error('zaman aşımı: ' + ne);
}
function emitAck(sock, ev, p) {
  return new Promise(res => { sock.emit(ev, p, res); setTimeout(() => res(null), 6000); });
}

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://127.0.0.1:' + server.address().port;

  const kurucu = await uyeYap('Kurucu', 'kurucu@rapor.test');
  const suclu = await uyeYap('KotuOyuncu', 'kotu@rapor.test');
  const sikayetci = await uyeYap('IyiOyuncu', 'iyi@rapor.test');

  // ---------- 1) OYUN İÇİ ŞİKAYET: masa sohbeti dökümü dondurulur ----------
  {
    const A = baglan(), B = baglan();
    await sleep(300);
    A.emit('authHello', { token: sikayetci.token });
    B.emit('authHello', { token: suclu.token });
    await sleep(400);
    A.emit('joinRoom', { roomId: 'rapor-1', gameId: 'dama' });
    B.emit('joinRoom', { roomId: 'rapor-1', gameId: 'dama' });
    await sleep(600);

    // Masada birkaç mesaj geçsin (şikayetin dayanağı).
    // NOT: masa sohbetinde kişi başına ~1 sn'lik hız sınırı var; mesajlar
    // aralıklı gönderilmezse sunucu ikincisini reddeder.
    B.emit('chatMessage', { scope: 'room', text: 'masada-kotu-mesaj-1', name: 'KotuOyuncu' });
    await sleep(400);
    A.emit('chatMessage', { scope: 'room', text: 'lutfen-boyle-konusma', name: 'IyiOyuncu' });
    await sleep(1400);
    B.emit('chatMessage', { scope: 'room', text: 'masada-kotu-mesaj-2', name: 'KotuOyuncu' });
    await sleep(500);

    const res = await emitAck(A, 'reportUser', {
      scope: 'room', roomId: 'rapor-1',
      reportedUid: suclu.uid, reportedName: 'KotuOyuncu',
      reason: 'kufur', note: 'sürekli hakaret ediyor'
    });
    assert.ok(res && res.ok, 'şikayet kaydedilmeli: ' + JSON.stringify(res));
    assert.ok(res.kayitliMesaj >= 3, 'sohbet dökümü kaydedilmeli (bulunan: ' + res.kayitliMesaj + ')');

    // Oda kapansa bile döküm panelde durmalı → herkes çıksın.
    A.emit('leaveRoom'); B.emit('leaveRoom');
    await sleep(400);
    A.close(); B.close();

    const liste = await api('/api/admin/reports?scope=room', null, 'GET', kurucu.token);
    assert.ok(liste.ok && liste.liste.length === 1, 'panelde 1 oyun içi şikayet olmalı');
    const r = liste.liste[0];
    assert.strictEqual(r.sikayetEden, 'IyiOyuncu', 'şikayet eden kaydedilmeli');
    assert.strictEqual(r.sikayetEdilen, 'KotuOyuncu', 'şikayet edilen kaydedilmeli');
    assert.strictEqual(r.gerekce, 'kufur', 'gerekçe kaydedilmeli');
    assert.strictEqual(r.odaId, 'rapor-1', 'oda bilgisi kaydedilmeli');
    assert.strictEqual(r.oyunId, 'dama', 'oyun bilgisi kaydedilmeli');
    assert.ok(r.not.includes('hakaret'), 'şikayet notu kaydedilmeli');
    const metinler = r.dokum.map(m => m.text).join(' | ');
    assert.ok(metinler.includes('masada-kotu-mesaj-1') && metinler.includes('masada-kotu-mesaj-2') &&
              metinler.includes('lutfen-boyle-konusma'),
      'ODA KAPANSA BİLE masa sohbetinin tamamı dökümde olmalı — bulunan: ' + metinler);
    console.log('  ✓ 1) oyun içi şikayet: sohbet dökümü donduruldu, oda kapandıktan sonra bile panelde');
  }

  // ---------- 2) GENEL SOHBET: yalnız SON 1 DAKİKA kaydedilir ----------
  {
    const A = baglan(), B = baglan();
    await sleep(300);
    A.emit('authHello', { token: sikayetci.token });
    B.emit('authHello', { token: suclu.token });
    await sleep(500);

    // ESKİ mesaj: zaman damgasını geriye alarak "1 dakikadan eski" yap.
    B.emit('chatMessage', { scope: 'global', text: 'cok-eski-genel-mesaj', name: 'KotuOyuncu' });
    await sleep(400);
    // Sunucunun genel sohbet tamponundaki bu mesajın ts'ini geriye çek
    // (gerçek hayatta 1 dk beklemek gerekirdi).
    serverModule.__test.chatGlobal().forEach(m => {
      if (m.text === 'cok-eski-genel-mesaj') m.ts = Date.now() - 90 * 1000;
    });

    // Genel sohbette 5 sn'lik hız sınırı var — ikinci mesaj için bekle.
    await sleep(5200);
    B.emit('chatMessage', { scope: 'global', text: 'yeni-genel-kotu-mesaj', name: 'KotuOyuncu' });
    await sleep(500);

    const res = await emitAck(A, 'reportUser', {
      scope: 'global', reportedUid: suclu.uid, reportedName: 'KotuOyuncu', reason: 'nefret'
    });
    assert.ok(res && res.ok, 'genel sohbet şikayeti kaydedilmeli');
    A.close(); B.close();

    const liste = await api('/api/admin/reports?scope=global', null, 'GET', kurucu.token);
    assert.ok(liste.ok && liste.liste.length === 1, 'panelde 1 genel şikayet olmalı');
    const d = liste.liste[0].dokum.map(m => m.text);
    assert.ok(d.includes('yeni-genel-kotu-mesaj'), 'son 1 dakikadaki mesaj kaydedilmeli');
    assert.ok(!d.includes('cok-eski-genel-mesaj'),
      '1 DAKİKADAN ESKİ mesaj kaydedilMEmeli (kullanıcı kuralı) — bulunan: ' + d.join(', '));
    console.log('  ✓ 2) genel sohbet şikayeti: yalnız son 1 dakikalık sohbet kaydediliyor');
  }

  // ---------- 3) Sekme süzgeci + 4) yetki ----------
  {
    const hepsi = await api('/api/admin/reports', null, 'GET', kurucu.token);
    assert.strictEqual(hepsi.liste.length, 2, 'süzgeçsiz iki şikayet de dönmeli');
    const oda = await api('/api/admin/reports?scope=room', null, 'GET', kurucu.token);
    const genel = await api('/api/admin/reports?scope=global', null, 'GET', kurucu.token);
    assert.ok(oda.liste.every(r => r.scope === 'room'), 'oyun içi sekmesi yalnız oda şikayetleri');
    assert.ok(genel.liste.every(r => r.scope === 'global'), 'genel sekmesi yalnız genel şikayetleri');
    console.log('  ✓ 3) panel sekmeleri (oyun içi / genel) doğru süzüyor');

    const yetkisiz = await api('/api/admin/reports', null, 'GET', sikayetci.token);
    assert.notStrictEqual(yetkisiz.status, 200, 'sıradan üye şikayetleri GÖREMEMELİ');
    const gecmisYetki = await api('/api/admin/sanctions/history', null, 'GET', sikayetci.token);
    assert.notStrictEqual(gecmisYetki.status, 200, 'sıradan üye uyarı geçmişini GÖREMEMELİ');
    console.log('  ✓ 4) şikayet ve uyarı geçmişi uçları yalnız kurucuya açık');
  }

  // ---------- 5) UYARI GEÇMİŞİ: kaldırılmış kayıtlar da döner ----------
  {
    const bos = await api('/api/admin/sanctions/history?uid=' + sikayetci.uid, null, 'GET', kurucu.token);
    assert.ok(bos.ok && bos.liste.length === 0, 'hiç uyarı almamış üyenin geçmişi BOŞ olmalı ("Temiz")');

    // 1. uyarı: 1 gün → sonra kaldır
    const u1 = await api('/api/admin/sanctions', { userId: suclu.uid, tur: 'chat', sure: '1g', sebep: 'küfür' }, 'POST', kurucu.token);
    assert.ok(u1.ok, '1. uyarı uygulanmalı: ' + JSON.stringify(u1));
    await api('/api/admin/sanctions/lift', { userId: suclu.uid, tur: 'chat' }, 'POST', kurucu.token);
    // 2. uyarı: 1 hafta (yürürlükte kalsın)
    const u2 = await api('/api/admin/sanctions', { userId: suclu.uid, tur: 'chat', sure: '1h', sebep: 'tekrar küfür' }, 'POST', kurucu.token);
    assert.ok(u2.ok, '2. uyarı uygulanmalı');

    const aktif = await api('/api/admin/sanctions', null, 'GET', kurucu.token);
    assert.strictEqual((aktif.liste || []).filter(y => Number(y.userId) === suclu.uid).length, 1,
      'YÜRÜRLÜKTEKİ liste yalnız 1 kayıt göstermeli (eski davranış korunmalı)');

    const gecmis = await api('/api/admin/sanctions/history?uid=' + suclu.uid, null, 'GET', kurucu.token);
    assert.ok(gecmis.ok, 'geçmiş okunmalı');
    assert.strictEqual(gecmis.liste.length, 2,
      'GEÇMİŞ kaldırılmış uyarıyı DA göstermeli (katlamalı ceza için) — bulunan: ' + gecmis.liste.length);
    assert.ok(gecmis.liste[0].baslangic <= gecmis.liste[1].baslangic, 'geçmiş eskiden yeniye sıralı olmalı');
    assert.ok(gecmis.liste[0].kaldirildi, '1. uyarı kaldırılmış işaretli olmalı');
    assert.ok(!gecmis.liste[1].kaldirildi, '2. uyarı hâlâ yürürlükte olmalı');
    // Süre bilgisi (kaç gün/hafta) bitiş-başlangıç farkından çıkar:
    const sure1 = gecmis.liste[0].bitis - gecmis.liste[0].baslangic;
    const sure2 = gecmis.liste[1].bitis - gecmis.liste[1].baslangic;
    assert.ok(Math.abs(sure1 - 86400000) < 5000, '1. uyarı süresi 1 gün olmalı');
    assert.ok(Math.abs(sure2 - 7 * 86400000) < 5000, '2. uyarı süresi 1 hafta olmalı');
    console.log('  ✓ 5) uyarı geçmişi: kaldırılmış kayıtlar da dönüyor, süre ve sıra doğru');
  }

  // ---------- 6) PANEL ARAYÜZÜ ----------
  {
    const vc = new VirtualConsole(); vc.on('jsdomError', () => {}); vc.on('error', () => {});
    const dom = await JSDOM.fromURL(BASE + '/index.html', {
      resources: 'usable', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
      beforeParse(w) {
        w.GV_BACKEND_URL = BASE; w.fetch = (...a) => fetch(...a); w.confirm = () => true;
        try { w.localStorage.setItem('gv-auth-token', kurucu.token); } catch (_) {}
      }
    });
    const win = dom.window;
    await bekle(() => (win.st && win.GV ? true : null), 20000, 'sayfa açılışı');
    await bekle(() => (win.st.user && !win.st.isGuest ? win.st.user : null), 20000, 'kurucu tanınmalı');

    // Paneli, kurucunun gerçekte tıkladığı düğmeyle açıyoruz.
    const panelBtn = await bekle(() => win.document.getElementById('adminPanelBtn'), 15000, '👑 Kurucu Paneli düğmesi');
    panelBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    // --- Kullanıcı sekmesi: UYARILAR sütunu ---
    const tablo = await bekle(() => {
      const t = win.document.querySelector('#adminPanelBody table');
      return (t && /UYARILAR/.test(t.innerHTML)) ? t : null;
    }, 15000, '"UYARILAR" sütunu tabloda olmalı');
    const satirlar = [...tablo.querySelectorAll('tbody tr')];
    assert.ok(satirlar.length >= 3, 'üyeler listelenmeli');

    const temizSatir = satirlar.find(tr => /IyiOyuncu/.test(tr.textContent));
    assert.ok(/Temiz/.test(temizSatir.textContent),
      'hiç uyarı almamış üyede yeşil "Temiz" yazmalı');
    assert.ok(!temizSatir.querySelector('[data-notes-uid]'), 'temiz üyede "Notlar" düğmesi olmamalı');

    const notluSatir = satirlar.find(tr => /KotuOyuncu/.test(tr.textContent));
    const notBtn = notluSatir.querySelector('[data-notes-uid]');
    assert.ok(notBtn, 'uyarı almış üyede "Notlar" düğmesi olmalı');
    assert.ok(/Notlar/.test(notBtn.textContent) && /2/.test(notBtn.textContent),
      '"Notlar" düğmesi uyarı sayısını göstermeli — bulunan: ' + notBtn.textContent.trim());

    // --- Notlar penceresi: tarih, kaçıncı uyarı, süre ---
    notBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const notGovde = await bekle(() => {
      const el = win.document.getElementById('adminNotesBody');
      return (el && /uyarı/i.test(el.textContent)) ? el : null;
    }, 8000, 'Notlar penceresi açılmalı');
    const nt = notGovde.textContent;
    assert.ok(/1\. uyarı/.test(nt) && /2\. uyarı/.test(nt), 'kaçıncı uyarı olduğu yazmalı');
    assert.ok(/1 gün/.test(nt), '1. uyarının süresi (1 gün) yazmalı — bulunan: ' + nt.slice(0, 200));
    assert.ok(/1 hafta/.test(nt), '2. uyarının süresi (1 hafta) yazmalı');
    assert.ok(/Yürürlükte/.test(nt), 'yürürlükteki uyarı işaretlenmeli');
    console.log('  ✓ 6) panel: "Uyarılar" sütunu (Temiz / Notlar) ve uyarı ayrıntı penceresi çalışıyor');

    // --- Şikayetler sekmesi + iki alt sekme + Sohbet penceresi ---
    const sekme = await bekle(() => win.document.querySelector('.admin-tab[data-tab="reports"]'), 8000, 'Şikayetler sekmesi');
    sekme.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const repTablo = await bekle(() => {
      const t = win.document.querySelector('#adminReportList table');
      return (t && /KotuOyuncu/.test(t.innerHTML)) ? t : null;
    }, 12000, 'şikayet listesi çizilmeli');
    assert.ok(/ŞİKAYET EDEN/.test(repTablo.innerHTML) && /ŞİKAYET EDİLEN/.test(repTablo.innerHTML) &&
              /GEREKÇE/.test(repTablo.innerHTML) && /TARİH/.test(repTablo.innerHTML),
      'şikayet tablosunda eden/edilen/gerekçe/tarih sütunları olmalı');
    assert.ok(/OYUN \/ MASA/.test(repTablo.innerHTML), 'oyun içi sekmede oda/oyun bilgisi sütunu olmalı');
    assert.ok(win.document.querySelector('[data-rtab="room"]') && win.document.querySelector('[data-rtab="global"]'),
      'iki alt sekme (oyun içi / genel sohbet) olmalı');

    const sohbetBtn = repTablo.querySelector('[data-rep-id]');
    assert.ok(sohbetBtn && /Sohbet/.test(sohbetBtn.textContent), '"Sohbet" düğmesi olmalı');
    sohbetBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const dokumGovde = await bekle(() => {
      const el = win.document.getElementById('adminChatBody');
      return (el && /masada-kotu-mesaj-1/.test(el.textContent)) ? el : null;
    }, 8000, 'Sohbet dökümü penceresi açılmalı');
    assert.ok(/masada-kotu-mesaj-2/.test(dokumGovde.textContent), 'dökümde tüm mesajlar olmalı');
    assert.ok(/Küfür/i.test(dokumGovde.textContent), 'gerekçe insan diliyle yazılmalı');
    assert.ok(/overflow:auto/.test(dokumGovde.innerHTML), 'uzun sohbet için kaydırma (scroll) olmalı');

    // Genel sohbet sekmesi
    win.document.querySelector('[data-rtab="global"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    const genelTablo = await bekle(() => {
      const t = win.document.querySelector('#adminReportList table');
      return (t && /Nefret/i.test(t.innerHTML)) ? t : null;
    }, 10000, 'genel sohbet şikayeti listelenmeli');
    assert.ok(!/OYUN \/ MASA/.test(genelTablo.innerHTML), 'genel sekmede oda sütunu olmamalı');
    console.log('  ✓ 7) panel: Şikayetler sekmesi, iki alt sekme ve sohbet dökümü penceresi çalışıyor');

    // --- Bildir pop-up'ı: masa oyunlarına uyarlanmış gerekçeler ---
    assert.ok(win.GVReport, 'şikayet modülü yüklenmeli');
    const kodlar = win.GVReport.gerekceler().map(g => g.kod);
    ['kufur', 'cinsel', 'nefret', 'din_siyaset', 'dolandirici', 'hile'].forEach(k => {
      assert.ok(kodlar.includes(k), 'gerekçe listesinde "' + k + '" olmalı (masa oyunlarına uyarlanmış)');
    });
    win.GVReport.ac({ uid: suclu.uid, name: 'KotuOyuncu', scope: 'room', roomId: 'rapor-1' });
    const popup = await bekle(() => win.document.getElementById('gvReportModal'), 6000, 'bildir pop-up açılmalı');
    assert.ok(/Küfür/.test(popup.textContent) && /Cinsel/.test(popup.textContent) &&
              /Dolandırıcılık/.test(popup.textContent) && /Hile/.test(popup.textContent),
      'pop-up masa oyunlarına uygun gerekçeleri göstermeli');
    assert.strictEqual(popup.querySelectorAll('input[name="gvReportReason"]').length, 10, '10 gerekçe seçeneği');
    assert.ok(popup.querySelector('#gvReportSend').disabled, 'gerekçe seçilmeden gönderilemez');
    console.log('  ✓ 8) "Kullanıcıyı Bildir" pop-up\'ı masa oyunlarına uyarlanmış gerekçelerle açılıyor');

    win.close();
  }

  server.close();
  console.log('OK şikayet sistemi + uyarı geçmişi');
  process.exit(0);
}

main().catch(err => { console.error('❌ ŞİKAYET/UYARI HATASI:', err); process.exit(1); });
