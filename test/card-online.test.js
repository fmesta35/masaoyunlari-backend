'use strict';
const assert = require('assert');
const io = require('socket.io-client');
const { start, server, rooms, seedPresetTables, applyPresetConfig, defaultPresetConfig } = require('../server');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function connect(url, name) { const s=io(url,{transports:['websocket'],forceNew:true,reconnection:false}); return new Promise((ok,no)=>{s.once('connect',()=>{s.userName=name;s.userKey='test:'+name;ok(s)});s.once('connect_error',no)}); }
function once(s,e,ms=5000){return new Promise((ok,no)=>{const t=setTimeout(()=>no(new Error('timeout '+e)),ms);s.once(e,x=>{clearTimeout(t);ok(x)})})}
async function join(s,id,game,max){const p=once(s,'joinedRoom');s.emit('joinRoom',{roomId:id,gameId:game,maxPlayers:max,durationMinutes:10,userName:s.userName,userKey:s.userKey,rounds:3});return p}
async function main(){
  // Varsayılan güvenlik: kart masaları görünür olabilir ama online tohumlama kapalıdır.
  const cfg=defaultPresetConfig(); assert.strictEqual(cfg.pisti.online,false); assert.strictEqual(cfg.batak.online,false);
  await start(0); const url='http://127.0.0.1:'+server.address().port;
  applyPresetConfig({...cfg,pisti:{visible:true,online:true},batak:{visible:true,online:true}});
  seedPresetTables();
  assert.ok((require('../server').listPublicRooms('pisti').length)>=18,'pisti hazır masaları');
  const a=await connect(url,'A'), b=await connect(url,'B');
  await join(a,'card-test-p','pisti',2); await join(b,'card-test-p','pisti',2);
  const ga=once(a,'gameStarted'); const gb=once(b,'gameStarted');a.emit('setReady',{ready:true});b.emit('setReady',{ready:true});
  const [pa,pb]=await Promise.all([ga,gb]); assert.strictEqual(pa.gameState.kind,'pisti'); assert.strictEqual(pa.gameState.hand.length,4); assert.strictEqual(pb.gameState.hand.length,4);
  const wrong=once(b,'pistiRejected'); b.emit('pistiPlay',{roomId:'card-test-p',index:0}); assert.strictEqual((await wrong).reason,'not_your_turn');
  a.disconnect();b.disconnect(); await sleep(50);
  const q=[];for(let i=0;i<4;i++){const s=await connect(url,'Q'+i);q.push(s);await join(s,'card-test-b','batak',4)}
  const gs=q.map(s=>once(s,'gameStarted'));q.forEach(s=>s.emit('setReady',{ready:true}));const states=await Promise.all(gs);assert.strictEqual(states[0].gameState.kind,'batak');assert.strictEqual(states[0].gameState.hand.length,13);assert.strictEqual(states[0].gameState.phase,'bid');
  const bad=once(q[1],'batakRejected');q[1].emit('batakBid',{roomId:'card-test-b',value:4});assert.strictEqual((await bad).reason,'not_your_turn');
  q.forEach(s=>s.disconnect());server.close();console.log('OK card online: Pisti + Batak socket akışları');
}
main().catch(e=>{console.error(e);try{server.close()}catch(_){}process.exit(1)});
