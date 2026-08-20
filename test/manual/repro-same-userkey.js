'use strict';

/* REPRO: Aynı tarayıcı profilinin 4 penceresi (AYNI userKey, gercek senaryo)
 * ayni okey masasina giriyor -> sunucu hepsini "rejoin" saniyor, oda 1/4'te
 * takili kaliyor.
 */
const ioClient = require('socket.io-client');
const serverModule = require('../../server.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

function connect(url, name) {
  const s = ioClient(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((res, rej) => {
    s.on('connect', () => { s.userName = name; res(s); });
    s.on('connect_error', rej);
  });
}

(async () => {
  const server = await serverModule.start(0);
  const BASE = `http://localhost:${server.address().port}`;
  const SHARED = 'guest:AYNI-PROFIL-ID'; // 4 pencerenin ortak localStorage kimligi

  const socks = [];
  for (let i = 0; i < 4; i++) {
    const s = await connect(BASE, 'pencere-' + (i + 1));
    s.emit('joinRoom', { roomId: '301', gameId: 'okey', userName: 'Ziyaretçi#8', userKey: SHARED, maxPlayers: 4, durationMinutes: 20 });
    socks.push(s);
    await sleep(120);
  }
  await sleep(300);
  const room = serverModule.rooms.get('301');
  console.log('ODA DURUMU  :', room.status);
  console.log('OYUNCU SAYISI:', room.players.length, '/ 4   <--- beklenen 4, gorulen', room.players.length);
  room.players.forEach(p => console.log(`  koltuk ${p.seat}: ${p.name}  socket=${p.id} userKey=${p.userKey}`));
  socks.forEach(s => s.close());
  server.close();
  process.exit(0);
})();
