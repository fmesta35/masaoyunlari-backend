/* =====================================================================
   AMİRAL BATTI — RÖVANŞ SONRASI FİLO YENİDEN DİZİLİR
   ---------------------------------------------------------------------
   Regresyon: resetRoomToWaiting() odayı temizlerken room.battleship'i
   BOŞALTMIYORDU. Rövanş kabul edilince oyun eski maçın durumuyla
   açılıyor, oyuncu "Filon hazır — rakibi bekliyorsun" ekranında takılı
   kalıyordu. Bu test, rövanştan sonra 'placing' fazına dönüldüğünü ve
   yerleştirme süresinin baştan verildiğini kilitler.
   ===================================================================== */
// Rövanş kabul edilince Amiral Battı YENİDEN filo dizme fazına dönmeli.
const io = require('socket.io-client');
const srv = require('../server.js');
const assert = require('assert');
const uyu = ms => new Promise(r => setTimeout(r, ms));
const yer = () => [
  { shipId:'carrier', r:0,c:0,dir:'h'}, { shipId:'battleship', r:1,c:0,dir:'h'},
  { shipId:'cruiser', r:2,c:0,dir:'h'}, { shipId:'submarine', r:3,c:0,dir:'h'},
  { shipId:'destroyer', r:4,c:0,dir:'h'}];
function bekle(s,e,p,ms){return new Promise((ok,no)=>{const t=setTimeout(()=>{s.off(e,h);no(Error('zaman aşımı '+e));},ms||9000);
  function h(x){if(!p||p(x)){clearTimeout(t);s.off(e,h);ok(x);}} s.on(e,h);});}
(async()=>{
  const server = await srv.start(0);
  const U='http://127.0.0.1:'+server.address().port;
  const A=io(U,{transports:['websocket'],forceNew:true}), B=io(U,{transports:['websocket'],forceNew:true});
  await uyu(400);
  const gA=bekle(A,'gameStarted'), gB=bekle(B,'gameStarted');
  A.emit('joinRoom',{roomId:'rv-bs',gameId:'battleship',maxPlayers:2,userName:'A',userKey:'rv:A'});
  B.emit('joinRoom',{roomId:'rv-bs',gameId:'battleship',maxPlayers:2,userName:'B',userKey:'rv:B'});
  await uyu(500);
  A.emit('setReady',{ready:true}); B.emit('setReady',{ready:true});
  await Promise.all([gA,gB]); await uyu(400);
  const savas=bekle(A,'gameStateUpdated',p=>p.gameState&&p.gameState.phase==='battle',12000);
  A.emit('battleshipPlace',{roomId:'rv-bs',placements:yer()}); await uyu(350);
  B.emit('battleshipPlace',{roomId:'rv-bs',placements:yer()});
  await savas;
  console.log('  · savaş fazına geçildi');

  // A pes eder -> maç biter
  const bitti=bekle(A,'gameEnded',null,9000);
  A.emit('gvResign',{roomId:'rv-bs'});
  await bitti;
  console.log('  · pes edildi, maç bitti');

  // İki taraf da rövanş ister
  const yeni=bekle(A,'gameStateUpdated',p=>p.gameState&&p.gameState.phase==='placing',12000);
  A.emit('rematchRequest',{roomId:'rv-bs'}); await uyu(400);
  B.emit('rematchRequest',{roomId:'rv-bs'}); await uyu(400);
  B.emit('rematchVote',{roomId:'rv-bs',accept:true}); await uyu(200);
  A.emit('rematchVote',{roomId:'rv-bs',accept:true});
  const d=await yeni;
  assert.strictEqual(d.gameState.phase,'placing','rövanş sonrası FİLO DİZME fazına dönülmeli');
  assert.ok(!(d.gameState.ready&&d.gameState.ready.mine),'yeni elde filo hazır sayılmamalı');
  assert.ok(Number(d.gameState.placeRemainingMs)>60000,'yerleştirme süresi baştan verilmeli (90 sn)');
  console.log('  ✓ rövanş sonrası filo yeniden diziliyor, süre', Math.round(d.gameState.placeRemainingMs/1000),'sn');
  A.close(); B.close(); server.close(); console.log('OK rövanş sonrası filo dizme');
  process.exit(0);
})().catch(e=>{console.error('❌',e.message);process.exit(1);});
