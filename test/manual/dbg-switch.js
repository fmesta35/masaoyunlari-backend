process.env.GV_PISTI_TURN_MS='30000';
const { JSDOM, VirtualConsole } = require('jsdom');
const srvmod = require('../../server.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async()=>{
 const server = await srvmod.start(0);
 const BASE='http://localhost:'+server.address().port;
 const cfg=srvmod.defaultPresetConfig();
 srvmod.applyPresetConfig({...cfg, pisti:{visible:true,online:true}});
 srvmod.seedPresetTables();
 async function mk(l){const vc=new VirtualConsole();vc.on('jsdomError',()=>{});
  const dom=await JSDOM.fromURL(BASE+'/index.html',{resources:'usable',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,
   beforeParse(w){w.GV_BACKEND_URL=BASE;w.fetch=(...a)=>fetch(...a);w.confirm=()=>true;
     w.__log=[]; }});
  dom.window.addEventListener('error',e=>console.log(l,'ERR',e.message));
  return {win:dom.window,l};}
 const A=await mk('A'), B=await mk('B');
 for(const c of [A,B]){ while(!(c.win.GV&&c.win.st&&c.win.GVArena&&typeof c.win.__gvStartRealRoomWaiting==='function')) await sleep(200); }
 for(const c of [A,B]){ c.win.st.curGame='pisti'; c.win.GV.joinRoom('sw-pisti'); }
 await sleep(2500);
 for(const c of [A,B]){
   const r=c.win.document.querySelector('#gv-real-chess-wait .gv-ready');
   console.log(c.l,'ready btn?',!!r, 'wait html len', (c.win.document.getElementById('gv-real-chess-wait')||{}).innerHTML?.length);
   if(r) r.click();
 }
 await sleep(3000);
 console.log('A activeRoomId', A.win.__gvActiveRoomId, 'arena room', A.win.GVArena.roomId(), 'activeId', A.win.GVArena.activeId());
 console.log('A board:', (A.win.document.getElementById('boardArea').innerHTML||'').slice(0,300));
 console.log('cardLoaded', A.win.__gvCardOnlineLoaded, 'socket?', !!A.win.__gvRoomSocket);
 const room = srvmod.rooms.get('sw-pisti');
 console.log('server room', room && {status:room.status, players:room.players.length, gameId:room.gameId, maxPlayers:room.maxPlayers, ready:room.players.map(p=>p.isReady)});
 server.close(); process.exit(0);
})();
