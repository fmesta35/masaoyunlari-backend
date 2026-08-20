'use strict';

/*
 * GENEL SOHBET KURALLARI — TTL (1 dk), 5 sn hız sınırı, link ve küfür filtresi.
 *
 *  A) Link içeren mesaj chatRejected ile reddedilir (yayın yapılmaz).
 *  B) Küfür/argo (leetspeak + harf harf yazma dahil) reddedilir.
 *  C) Hız sınırı: genel sohbette ikinci mesaj ancak 5 sn sonra kabul edilir;
 *     1 sn kuralının genel sohbette GEÇERLİ OLMADIĞI da doğrulanır.
 *  D) TTL: GV_CHAT_TTL_MS kısaltılarak mesajın 1 dk sonunda geçmişten
 *     düştüğü doğrulanır.
 *
 * Not: hız ve TTL süreleri testte milisaniyeye indirilemez (rate'i düşürmek
 * testi anlamsız kılar); bu yüzden gerçek bekleme yapılır (~8 sn test süresi).
 */

process.env.GV_CHAT_TTL_MS = '1500'; // TTL testini 1.5 sn'ye indir

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url, name) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + name)), 8000);
    socket.on('connect', () => { clearTimeout(t); resolve(socket); });
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 8000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

function chatHistory(socket, scope) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: chatHistory')), 8000);
    socket.emit('chatHistory', { scope }, res => { clearTimeout(t); resolve(res); });
  });
}

async function member(url, name) {
  const s = await connect(url, name);
  s.emit('subscribeLobby', { gameId: 'tavla', userKey: 'user:' + name });
  await once(s, 'roomsUpdated');
  return s;
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;

  // ---------- A) Link yasağı ----------
  {
    const a1 = await member(BASE, 'A1');
    const a2 = await member(BASE, 'A2');
    let heard = false;
    a2.on('chatMessage', () => { heard = true; });
    const rej = once(a1, 'chatRejected');
    a1.emit('chatMessage', { scope: 'global', text: 'şu siteye bak https://ornek.com güzel', name: 'ÜyeA1', memberKey: 'user:A1' });
    const r = await rej;
    assert.ok(/link/i.test(r.reason || ''), 'A: link nedeni anlatılır');
    await sleep(300);
    assert.ok(!heard, 'A: linkli mesaj hiç kimseye yayılmadı');
    a1.close(); a2.close();
    console.log('  ✓ A) Link içeren mesaj reddedildi ve yayımlanmadı');
  }

  // ---------- B) Küfür filtresi (leetspeak + harf harf) ----------
  {
    const b1 = await member(BASE, 'B1');
    const b2 = await member(BASE, 'B2');
    let heard = 0;
    b2.on('chatMessage', () => { heard++; });
    for (const txt of ['s1kt1r git', 'a q sen', 'Y4RR4K']) {
      const rej = once(b1, 'chatRejected');
      b1.emit('chatMessage', { scope: 'global', text: txt, name: 'ÜyeB1', memberKey: 'user:B1' });
      const r = await rej;
      assert.ok(/küfür|argo/i.test(r.reason || ''), 'B: küfür nedeni anlatılır → ' + txt);
    }
    await sleep(300);
    assert.strictEqual(heard, 0, 'B: küfürlü mesaj yayımlanmadı');
    b1.close(); b2.close();
    console.log('  ✓ B) Küfür/argo (leetspeak + harf harf yazma) reddedildi');
  }

  // ---------- C) Genel sohbette 5 sn kuralı ----------
  {
    const c1 = await member(BASE, 'C1');
    const got = once(c1, 'chatMessage');
    c1.emit('chatMessage', { scope: 'global', text: 'ilk mesaj', name: 'ÜyeC1', memberKey: 'user:C1' });
    await got; // kabul edildi

    const rej1 = once(c1, 'chatRejected');
    c1.emit('chatMessage', { scope: 'global', text: 'hemen ikinci', name: 'ÜyeC1', memberKey: 'user:C1' });
    const r1 = await rej1;
    assert.ok(/hızlı/i.test(r1.reason || '') && /5/.test(r1.reason || ''), 'C: 5 sn kuralı nedeni anlatılır');

    // 1 sn geçse bile (eski kural) 5 sn dolmadan hâlâ reddedilmeli
    await sleep(1600);
    const rej2 = once(c1, 'chatRejected');
    c1.emit('chatMessage', { scope: 'global', text: 'bir buçuk sn sonra', name: 'ÜyeC1', memberKey: 'user:C1' });
    await rej2;

    // 5 sn dolunca kabul
    await sleep(3600);
    const ok = once(c1, 'chatMessage');
    c1.emit('chatMessage', { scope: 'global', text: 'beş saniye sonra', name: 'ÜyeC1', memberKey: 'user:C1' });
    const m = await ok;
    assert.strictEqual(m.text, 'beş saniye sonra', 'C: 5 sn sonra mesaj kabul edilir');
    c1.close();
    console.log('  ✓ C) Genel sohbette 5 sn hız sınırı uygulanıyor (1 sn kuralı değil)');
  }

  // ---------- D) TTL (testte 1.5 sn) ----------
  {
    const d1 = await member(BASE, 'D1');
    const got = once(d1, 'chatMessage');
    d1.emit('chatMessage', { scope: 'global', text: 'kısa ömürlü mesaj', name: 'ÜyeD1', memberKey: 'user:D1' });
    await got;
    let h = await chatHistory(d1, 'global');
    assert.ok(h.messages.some(x => x.text === 'kısa ömürlü mesaj'), 'D: taze iken geçmişte');
    await sleep(1800); // TTL(1500) aşıldı
    h = await chatHistory(d1, 'global');
    assert.ok(!h.messages.some(x => x.text === 'kısa ömürlü mesaj'), 'D: TTL dolunca geçmişten düştü');
    d1.close();
    console.log('  ✓ D) Süresi dolan genel sohbet mesajı geçmişten siliniyor');
  }

  await sleep(200);
  server.close();
  console.log('\n✅ chat-rules: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ chat-rules:', err && err.stack ? err.stack : err); process.exit(1); });
