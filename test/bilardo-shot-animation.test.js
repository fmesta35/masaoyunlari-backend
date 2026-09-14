'use strict';

/*
 * BİLARDO VURUŞ ANİMASYONU (madde 5): "bilardo oyununun motorunu ve çalışma
 * mantığını flyordie daki gibi yap". flyordie'de bir vuruş yapıldığında top(lar)
 * ekranda GERÇEKTEN yuvarlanıp çarpışarak durur — sonuç aniden "ışınlanmaz".
 * Eski motorda shoot() tüm fiziği tek seferde hesaplayıp yalnız NİHAİ durumu
 * döndürüyordu; istemci hiçbir ara kare görmüyordu.
 *
 * Bu test:
 *  1) Motor seviyesinde shoot()'un artık atışın TÜM yolunu ("frames") da
 *     döndürdüğünü, ilk karenin vuruş öncesi konumla, son karenin de motorun
 *     döndürdüğü NİHAİ top konumlarıyla tutarlı olduğunu doğrular.
 *  2) Gerçek sunucu + iki gerçek soket istemcisiyle: bir vuruş yapıldığında
 *     HER İKİ oyuncunun da "bilardoShotFrames" ile kare kare akışı aldığını,
 *     ve sunucunun yetkili nihai durumunun (gameStateUpdated) bu akış
 *     BİTMEDEN aniden gelmediğini (gerçekçi bir gecikmeyle geldiğini) kontrol
 *     eder. Fizik hâlâ tamamen sunucuda, tek seferde ve hileye kapalı
 *     hesaplanır — sadece SONUCUN anlatımı akıcılaşır.
 */

const assert = require('assert');
const io = require('socket.io-client');
const bilardoEngine = require('../bilardo-engine');

function conn(url, name) {
  const s = io(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  return new Promise((ok, no) => { s.once('connect', () => { s.name = name; ok(s); }); s.once('connect_error', no); });
}
const once = (s, e, ms) => new Promise((ok, no) => {
  const t = setTimeout(() => no(new Error('zaman aşımı: ' + e)), ms || 8000);
  s.once(e, p => { clearTimeout(t); ok(p); });
});

async function main() {
  // ---------- 1) motor seviyesi: frames tutarlılığı ----------
  {
    const st = bilardoEngine.init();
    const cue = st.balls.find(b => b.id === 'cue');
    const cueX0 = cue.x, cueY0 = cue.y;
    const r = bilardoEngine.shoot(st, 0, 0.15, 0.85);
    assert.ok(r.ok, 'geçerli vuruş kabul edilmeli');
    const frames = r.shot.frames;
    assert.ok(Array.isArray(frames) && frames.length >= 2, 'birden çok kare üretilmeli (yalnız nihai durum değil)');
    assert.ok(frames.length <= bilardoEngine.constants.maxFrames + 1, 'kare sayısı sınırlı olmalı (ağ yükü taşmasın)');

    const firstCue = frames[0][0];
    assert.ok(Math.abs(firstCue[0] - cueX0) < 0.6 && Math.abs(firstCue[1] - cueY0) < 0.6,
      'ilk kare vuruş ÖNCESİ beyaz topun konumunu yansıtmalı');

    // Beyaz top cepte giderse (fauna/scratch), motor onu vuruş SONRASINDA (kare
    // kaydı bittikten sonra) başa yeniden koyar — bu yüzden o özel durumda son
    // kare (hâlâ cepte) ile nihai durum (yeniden başa konmuş) kasıtlı olarak
    // farklıdır; tıpkı gerçek bilardoda topun tekrar baş noktasına konması gibi.
    const scratch = r.shot.potted.includes('cue');
    const lastFrame = frames[frames.length - 1];
    st.balls.forEach((b, idx) => {
      if (b.potted) { assert.strictEqual(lastFrame[idx], null, 'cepteki top son karede gösterilmemeli: ' + b.id); return; }
      if (b.id === 'cue' && scratch) return;
      assert.ok(Math.abs(lastFrame[idx][0] - b.x) < 0.6 && Math.abs(lastFrame[idx][1] - b.y) < 0.6,
        'son kare, motorun döndürdüğü NİHAİ top konumuyla eşleşmeli: ' + b.id);
    });
    console.log('  ✓ 1) shoot() artık vuruşun tüm yolunu (frames) tutarlı biçimde döndürüyor');
  }

  // ---------- 2) sunucu: her iki oyuncu da kare kare akışı alıyor, nihai sonuç gecikmeli geliyor ----------
  const srv = require('../server');
  await srv.start(0);
  const url = 'http://127.0.0.1:' + srv.server.address().port;
  const roomId = 'bil-anim-test';
  const a = await conn(url, 'A'), b = await conn(url, 'B');

  const ja = once(a, 'joinedRoom'), jb = once(b, 'joinedRoom');
  a.emit('joinRoom', { roomId, gameId: 'bilardo', maxPlayers: 2, userName: 'A', userKey: 'test:bilA', durationMinutes: 10 });
  b.emit('joinRoom', { roomId, gameId: 'bilardo', maxPlayers: 2, userName: 'B', userKey: 'test:bilB', durationMinutes: 10 });
  await Promise.all([ja, jb]);

  const ga = once(a, 'gameStarted'), gb = once(b, 'gameStarted');
  a.emit('setReady', { ready: true });
  b.emit('setReady', { ready: true });
  const [pa, pb] = await Promise.all([ga, gb]);

  const mover = pa.seat === pa.gameState.turn ? a : b;

  const framesA = once(a, 'bilardoShotFrames', 5000);
  const framesB = once(b, 'bilardoShotFrames', 5000);
  const t0 = Date.now();
  mover.emit('bilardoShoot', { roomId, angle: 0.12, power: 0.8 });
  const [fa, fb] = await Promise.all([framesA, framesB]);

  assert.strictEqual(fa.roomId, roomId, 'kare akışı doğru odaya damgalanmalı');
  assert.ok(Array.isArray(fa.frames) && fa.frames.length > 5, 'anlamlı sayıda ara kare gelmeli (yalnız 1-2 değil)');
  assert.strictEqual(fa.frames.length, fb.frames.length, 'iki oyuncuya da AYNI kareler gitmeli');
  assert.ok(Array.isArray(fa.meta) && fa.meta.length === 16, 'top kimlik/tip meta bilgisi (id/n/type) gönderilmeli');
  assert.ok(typeof fa.frameMs === 'number' && fa.frameMs > 0, 'kare aralığı (ms) gönderilmeli');

  const upA = once(a, 'gameStateUpdated', 12000);
  const finalState = await upA;
  const totalMs = Date.now() - t0;
  assert.ok(finalState.gameState.shots >= 1, 'nihai (yetkili) durumda vuruş sayacı artmalı');

  const beklenenAsgariGecikme = (fa.frames.length - 1) * fa.frameMs * 0.5;
  assert.ok(totalMs >= beklenenAsgariGecikme,
    'nihai sonuç, top(lar) durmadan ANİDEN gelmemeli (' + totalMs + 'ms geçti, beklenen en az ~' + Math.round(beklenenAsgariGecikme) + 'ms)');
  console.log('  ✓ 2) her iki oyuncu da vuruşu kare kare canlı izliyor; nihai sonuç gerçekçi gecikmeyle geliyor (' +
    totalMs + 'ms, ' + fa.frames.length + ' kare, ~' + fa.frameMs + 'ms/kare)');

  a.disconnect(); b.disconnect();
  srv.server.close();
  console.log('OK bilardo vuruş animasyonu: flyordie tarzı kare kare canlı akış + gecikmeli yetkili sonuç');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ BİLARDO ANİMASYON TEST HATASI:', e);
  try { require('../server').server.close(); } catch (_) {}
  process.exit(1);
});
