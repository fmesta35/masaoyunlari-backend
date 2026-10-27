'use strict';
/*
 * PES ET = MAĞLUBİYET (kullanıcı raporu, Satranç #101):
 *   "karşı rakip pes etti ancak sonuç berabere diyor, pes ettiyse berabere
 *    bitemez. pes eden mağlup sayılır, diğer taraflar galip sayılır
 *    puanlama buna göre yapılır"
 * Gerçek sunucu + gerçek soketlerle, ÜYE hesaplarıyla her 2 kişilik oyunda:
 *  1) bitiş paketi: pes eden youWon=false, rakibi youWon=true, sebep 'resign'
 *  2) puan: pes edene MAĞLUBİYET, rakibe GALİBİYET yazılır (berabere değil)
 */
process.env.GV_POST_GAME_HOLD_MS = '30000';
const fs = require('fs'), os = require('os'), path = require('path');
process.env.GV_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gv-pes-puan-'));
const assert = require('assert');
const ioClient = require('socket.io-client');
const serverModule = require('../server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let BASE = '';

async function api(p, body, method, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) { headers.Authorization = 'Bearer ' + token; headers['X-GV-Token'] = token; }
  const r = await fetch(BASE + p, { method: method || (body ? 'POST' : 'GET'), headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, ...(await r.json().catch(() => ({}))) };
}
async function uyeAc(ad, eposta) {
  const reg = await api('/api/auth/register', { name: ad, email: eposta, password: 'gucluSifre123' }, 'POST');
  assert.ok(reg.ok, ad + ' kaydı');
  const { db } = require('../db');
  const vt = db.prepare('SELECT verify_token FROM users WHERE id = ?').get(reg.userId).verify_token;
  await api('/api/auth/verify', { token: vt }, 'POST');
  const login = await api('/api/auth/login', { email: eposta, password: 'gucluSifre123' }, 'POST');
  return { id: login.user.id, name: ad, token: login.token };
}
function baglan() {
  const s = ioClient(BASE, { transports: ['websocket'], forceNew: true });
  s.__o = {};
  ['gameStarted', 'gameEnded'].forEach(ev => s.on(ev, p => { (s.__o[ev] = s.__o[ev] || []).push(p); }));
  return s;
}
const son = (s, ev) => { const a = s.__o[ev]; return a && a.length ? a[a.length - 1] : null; };
async function bekle(fn, ms, ne) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(60); }
  throw new Error('zaman aşımı: ' + ne);
}
async function ozet(u) {
  const r = await api('/api/scores/me', null, 'GET', u.token);
  return r.ozet || { genel: {} };
}

const OYUNLAR = process.env.OYUN ? process.env.OYUN.split(',') : ['chess', 'tavla', 'dama', 'turkdamasi', 'reversi', 'gomoku', 'connect4',
  'okey', 'okey101', 'pisti', 'batak', 'kelimelik', 'adamasmaca', 'passaparola', 'cenga', 'langirt', 'havahokeyi',
  'fark', 'kizmabirader', 'metropol', 'bilardo', 'battleship'];

async function main() {
  const server = await serverModule.start(0);
  BASE = 'http://127.0.0.1:' + server.address().port;
  const A = await uyeAc('PesEden', 'pes@test.tr');
  const B = await uyeAc('Kazanan', 'kaz@test.tr');
  /* Taban (toplam 0'ın altına düşmez) ölçümü bozmasın: pes edene başlangıç puanı. */
  serverModule.__test.puanYaz([{ uid: A.id, gameId: 'baslangic', tur: 'win', puan: 2000, roomId: 'b0' }]);
  await sleep(150);
  const hatalar = [];
  for (const oyun of OYUNLAR) {
    const once = [await ozet(A), await ozet(B)];
    const sa = baglan(), sb = baglan();
    await sleep(200);
    sa.emit('authHello', { token: A.token }); sb.emit('authHello', { token: B.token });
    await sleep(250);
    const oda = 'pes-' + oyun;
    sa.emit('joinRoom', { roomId: oda, gameId: oyun, userName: A.name, memberToken: A.token, maxPlayers: 2 });
    await sleep(150);
    sb.emit('joinRoom', { roomId: oda, gameId: oyun, userName: B.name, memberToken: B.token, maxPlayers: 2 });
    await sleep(150);
    [sa, sb].forEach(s => s.emit('setReady', { roomId: oda, ready: true }));
    try {
      await bekle(() => son(sa, 'gameStarted') && son(sb, 'gameStarted'), 10000, oyun + ' başlasın');
      await sleep(300);
      if (process.env.DBG) { const r = serverModule.__test.rooms().get(oda); console.log('DBG', oyun, JSON.stringify((r.players||[]).map(p=>({n:p.name,u:p.userId,seat:p.seat,c:p.color})))); }
      sa.emit('gvResign', { roomId: oda });
      const ea = await bekle(() => son(sa, 'gameEnded'), 8000, oyun + ' bitiş (A)');
      const eb = await bekle(() => son(sb, 'gameEnded'), 8000, oyun + ' bitiş (B)');
      await sleep(400);
      const sonra = [await ozet(A), await ozet(B)];
      const pa = (Number(sonra[0].toplam) || 0) - (Number(once[0].toplam) || 0);
      const pb = (Number(sonra[1].toplam) || 0) - (Number(once[1].toplam) || 0);
      const fark = (i, k) => (Number(sonra[i].genel[k]) || 0) - (Number(once[i].genel[k]) || 0);
      const durum = `youWon A=${ea.youWon} B=${eb.youWon}; puan A ${pa >= 0 ? '+' : ''}${pa} B +${pb}; A: mağlubiyet+${fark(0, 'maglubiyet')} galibiyet+${fark(0, 'galibiyet')} beraberlik+${fark(0, 'beraberlik')}; ` +
                    `B: galibiyet+${fark(1, 'galibiyet')} mağlubiyet+${fark(1, 'maglubiyet')} beraberlik+${fark(1, 'beraberlik')}`;
      const dogru = ea.youWon === false && eb.youWon === true && pa < 0 && pb > 0 &&
        fark(0, 'maglubiyet') === 1 && fark(0, 'galibiyet') === 0 && fark(0, 'beraberlik') === 0 &&
        fark(1, 'galibiyet') === 1 && fark(1, 'maglubiyet') === 0 && fark(1, 'beraberlik') === 0;
      if (dogru) console.log('  ✓ ' + oyun + ': pes eden mağlup ve puan kaybetti, rakibi galip (' + durum + ')');
      else { hatalar.push(oyun + ': ' + durum); console.log('  ✗ ' + oyun + ': ' + durum); }
    } catch (e) { hatalar.push(oyun + ': ' + e.message); console.log('  ✗ ' + oyun + ': ' + e.message); }
    sa.close(); sb.close();
    await sleep(300);
  }
  // 3 KİŞİLİK MASA: pes eden mağlup, DİĞER İKİ oyuncu da galip.
  if (!process.env.OYUN) {
    const C = await uyeAc('Ucuncu', 'ucu@test.tr');
    for (const oyun of ['okey', 'kizmabirader']) {
      const kisi = [A, B, C];
      const once = await Promise.all(kisi.map(ozet));
      const ss = kisi.map(() => baglan());
      await sleep(200);
      ss.forEach((s, i) => s.emit('authHello', { token: kisi[i].token }));
      await sleep(250);
      const oda = 'pes3-' + oyun;
      for (let i = 0; i < 3; i++) {
        ss[i].emit('joinRoom', { roomId: oda, gameId: oyun, userName: kisi[i].name, memberToken: kisi[i].token, maxPlayers: 3 });
        await sleep(150);
      }
      ss.forEach(s => s.emit('setReady', { roomId: oda, ready: true }));
      try {
        await bekle(() => ss.every(s => son(s, 'gameStarted')), 10000, oyun + ' 3 kişi başlasın');
        await sleep(300);
        ss[0].emit('gvResign', { roomId: oda });
        const e = await Promise.all(ss.map((s, i) => bekle(() => son(s, 'gameEnded'), 8000, oyun + ' bitiş ' + i)));
        await sleep(400);
        const sonra = await Promise.all(kisi.map(ozet));
        const f = (i, k) => (Number(sonra[i].genel[k]) || 0) - (Number(once[i].genel[k]) || 0);
        const pk = (Number(sonra[0].toplam) || 0) - (Number(once[0].toplam) || 0);
        const dogru = pk < 0 && e[0].youWon === false && e[1].youWon === true && e[2].youWon === true &&
          f(0, 'maglubiyet') === 1 && f(1, 'galibiyet') === 1 && f(2, 'galibiyet') === 1;
        const d = `youWon ${e.map(x => x.youWon).join('/')}; pes eden mağlubiyet+${f(0, 'maglubiyet')}, diğerleri galibiyet+${f(1, 'galibiyet')}/+${f(2, 'galibiyet')}`;
        if (dogru) console.log('  ✓ ' + oyun + ' (3 kişi): pes eden mağlup, diğer ikisi galip (' + d + ')');
        else { hatalar.push(oyun + ' 3 kişi: ' + d); console.log('  ✗ ' + oyun + ' 3 kişi: ' + d); }
      } catch (er) { hatalar.push(oyun + ' 3 kişi: ' + er.message); console.log('  ✗ ' + oyun + ' 3 kişi: ' + er.message); }
      ss.forEach(s => s.close());
      await sleep(300);
    }
  }
  // ZİYARETÇİ: kazansa da kaybetse de puan/istatistik/sıralama kaydı OLUŞMAZ.
  if (!process.env.OYUN) {
    const { db } = require('../db');
    const say = () => db.prepare('SELECT COUNT(*) n FROM score_events').get().n;
    const once = say();
    const ga = baglan(), gb = baglan();
    await sleep(200);
    ga.emit('joinRoom', { roomId: 'pes-misafir', gameId: 'chess', userName: 'Ziyaretci1', maxPlayers: 2 });
    await sleep(150);
    gb.emit('joinRoom', { roomId: 'pes-misafir', gameId: 'chess', userName: 'Ziyaretci2', maxPlayers: 2 });
    await sleep(150);
    [ga, gb].forEach(s => s.emit('setReady', { roomId: 'pes-misafir', ready: true }));
    await bekle(() => son(ga, 'gameStarted') && son(gb, 'gameStarted'), 10000, 'misafir maçı');
    ga.emit('gvResign', { roomId: 'pes-misafir' });
    const eb = await bekle(() => son(gb, 'gameEnded'), 8000, 'misafir bitiş');
    await sleep(400);
    const sonra = say();
    if (eb.youWon === true && sonra === once) console.log('  ✓ ziyaretçi maçı: sonuç doğru, hiçbir puan/istatistik kaydı yazılmadı');
    else { hatalar.push('ziyaretçi: youWon=' + eb.youWon + ' yeni kayıt=' + (sonra - once)); console.log('  ✗ ziyaretçi: kayıt yazıldı ' + (sonra - once)); }
    ga.close(); gb.close();
  }
  server.close();
  assert.deepStrictEqual(hatalar, [], 'pes sonucu hatalı oyunlar:\n' + hatalar.join('\n'));
  console.log('OK pes et: her oyunda pes eden mağlup, rakibi galip; puan buna göre');
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
