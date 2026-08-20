'use strict';

/*
 * SOHBET — masa içi + genel sohbet sunucu testleri.
 *
 *  Kurallar: yalnız ÜYELER yazabilir (misafirler okur), metin temizlenir,
 *  240 karakter sınırı, soket başına 1 sn hız sınırı, son 50 mesajlık geçmiş.
 *
 *  A) Masa sohbeti: iki üye aynı odada -> mesaj herkese gider, isim oda
 *     kaydından gelir, HTML temizlenir, chatHistory dolu döner.
 *  B) Misafir yazamaz: oda içi ve genel sohbette chatRejected; yayın YAPILMAZ.
 *  C) Genel sohbet: lobi soketinden üye (memberKey) gönderir -> diğer lobi
 *     soketi alır; genel geçmiş ayrı tutulur.
 *  D) Sınırlar: 240 karakter kırpması + 1 sn hız sınırı (ikinci mesaj red).
 */

const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url, name) {
  const socket = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('connect timeout: ' + name)), 8000);
    socket.on('connect', () => { clearTimeout(t); socket.userName = name; resolve(socket); });
    socket.on('connect_error', reject);
  });
}

function once(socket, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: ' + event)), timeoutMs || 8000);
    socket.once(event, payload => { clearTimeout(t); resolve(payload); });
  });
}

function join(socket, roomId, userKey, name) {
  socket.emit('joinRoom', {
    roomId, gameId: 'tavla', userName: name, userKey, maxPlayers: 2, durationMinutes: 10
  });
  return once(socket, 'joinedRoom');
}

function chatHistory(socket, scope, roomId) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout: chatHistory')), 8000);
    socket.emit('chatHistory', { scope, roomId }, res => { clearTimeout(t); resolve(res); });
  });
}

async function main() {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;

  // ---------- A) Masa sohbeti: üyeler konuşur, herkes görür ----------
  {
    const u1 = await connect(BASE, 'U1');
    const u2 = await connect(BASE, 'U2');
    await join(u1, '202', 'user:1', 'ÜyeBir');
    await join(u2, '202', 'user:2', 'Üyeİki');

    const got = once(u1, 'chatMessage');
    u2.emit('chatMessage', { scope: 'room', text: 'Merhaba <b>nasılsın</b>?' });
    const m = await got;
    assert.strictEqual(m.scope, 'room', 'A: oda kapsamı');
    assert.strictEqual(m.roomId, '202');
    assert.strictEqual(m.name, 'Üyeİki', 'A: isim oda kaydından (taklit edilemez)');
    assert.strictEqual(m.text, 'Merhaba nasılsın?', 'A: HTML/etiket temizlendi: ' + m.text);

    const hist = await chatHistory(u1, 'room', '202');
    assert.ok(hist.ok && hist.messages.length === 1 && hist.messages[0].text === m.text,
      'A: oda geçmişi dolu döner (sonradan giren de görür)');
    u1.close(); u2.close();
    console.log('  ✓ A) Masa sohbeti: üyeler konuştu, karşılıklı görüldü, geçmiş saklandı');
  }

  // ---------- B) Misafir yazamaz ----------
  {
    const g = await connect(BASE, 'G1');
    const u = await connect(BASE, 'U3');
    await join(u, '203', 'user:3', 'ÜyeÜç');
    g.emit('joinRoom', { roomId: '203', gameId: 'tavla', userName: 'Misafir', userKey: 'guest:m1', maxPlayers: 2, asSpectator: true });
    await once(g, 'joinedRoom');

    const rejectP = once(g, 'chatRejected');
    u.removeAllListeners('chatMessage');
    let leaked = false;
    u.on('chatMessage', () => { leaked = true; });
    g.emit('chatMessage', { scope: 'room', text: 'ben de yazayım' });
    const rej = await rejectP;
    assert.ok(/üye/i.test(rej.reason || ''), 'B: misafire üyelik nedeni açıklanır');
    await sleep(250);
    assert.strictEqual(leaked, false, 'B: misafir mesajı YAYINLANMAZ');

    const hist = await chatHistory(u, 'room', '203');
    assert.strictEqual(hist.messages.length, 0, 'B: oda geçmişine de düşmedi');
    g.close(); u.close();
    console.log('  ✓ B) Misafir mesajı reddedildi; yayın ve geçmiş temiz');
  }

  // ---------- C) Genel sohbet: lobi üzerinden ----------
  {
    const l1 = await connect(BASE, 'L1');
    const l2 = await connect(BASE, 'L2');
    l1.emit('subscribeLobby', { gameId: 'tavla', userKey: 'user:9' });
    await once(l1, 'roomsUpdated');
    l2.emit('subscribeLobby', { gameId: 'chess' });
    await once(l2, 'roomsUpdated');

    const got = once(l2, 'chatMessage');
    l1.emit('chatMessage', { scope: 'global', text: 'Herkese selam!', name: 'ÜyeDokuz', memberKey: 'user:9' });
    const m = await got;
    assert.strictEqual(m.scope, 'global');
    assert.strictEqual(m.name, 'ÜyeDokuz');
    assert.strictEqual(m.text, 'Herkese selam!');

    const hist = await chatHistory(l2, 'global');
    assert.ok(hist.messages.some(x => x.text === 'Herkese selam!'), 'C: genel geçmişte görünür');

    // Misafir lobi soketi (memberKey yok, socket.userKey yok) -> red
    const l3 = await connect(BASE, 'L3');
    l3.emit('subscribeLobby', { gameId: 'tavla' });
    await once(l3, 'roomsUpdated');
    const rej = once(l3, 'chatRejected');
    l3.emit('chatMessage', { scope: 'global', text: 'misafir yazıyor', name: 'Misafir' });
    await rej;
    l1.close(); l2.close(); l3.close();
    console.log('  ✓ C) Genel sohbet: üye mesajı herkese aktı; misafir lobi mesajı reddedildi');
  }

  // ---------- D) Sınırlar: 240 karakter + 1 sn hız sınırı ----------
  {
    const d1 = await connect(BASE, 'D1');
    const d2 = await connect(BASE, 'D2');
    d1.emit('subscribeLobby', { gameId: 'tavla', userKey: 'user:11' });
    await once(d1, 'roomsUpdated');
    d2.emit('subscribeLobby', { gameId: 'tavla' });
    await once(d2, 'roomsUpdated');

    const longText = 'çok'.repeat(200); // 600 karakter
    const got = once(d2, 'chatMessage');
    d1.emit('chatMessage', { scope: 'global', text: longText, name: 'ÜyeOnBir', memberKey: 'user:11' });
    const m = await got;
    assert.ok(m.text.length <= 240, 'D: 240 karakter sınırı (' + m.text.length + ')');

    const rej = once(d1, 'chatRejected');
    d1.emit('chatMessage', { scope: 'global', text: 'hemen ikinci', name: 'ÜyeOnBir', memberKey: 'user:11' });
    const r = await rej;
    assert.ok(/hızlı/i.test(r.reason || ''), 'D: hız sınırı nedeni anlatılır');
    d1.close(); d2.close();
    console.log('  ✓ D) 240 karakter kırpıldı; 1 sn içinde ikinci mesaj reddedildi');
  }

  await sleep(200);
  server.close();
  console.log('\n✅ chat: TUM TESTLER BASARILI');
  process.exit(0);
}

main().catch(err => { console.error('❌ chat:', err && err.stack ? err.stack : err); process.exit(1); });
