/* GameVerse chess waiting bridge - keeps the existing UI, no bots. */
(function(){
'use strict';
const BACKEND='https://masaoyunlari-backend.onrender.com';
let socket=null, roomId=null, room=null, gameStarted=false, lastVisible=false;

function getState(){try{return typeof st!=='undefined'?st:null}catch(e){return null}}
function getRoomId(){
 const s=getState();
 const a=[window.__gvActiveRoomId,window.__gvActiveRoom?.id,window.currentRoomId,window.roomId,s?.roomWaitingState?.roomId,s?.roomWaitingState?.room?.id,localStorage.getItem('gv-room-id')];
 for(const x of a){if(x!==undefined&&x!==null&&String(x)!=='')return String(x)}
 return null;
}
function isRoomPage(){
 const s=getState();
 return !!(document.getElementById('pg-room')?.classList.contains('active')||document.getElementById('room')?.classList.contains('active')||String(s?.curPage||'').toLowerCase()==='room');
}
function isChess(){
 const s=getState();
 const g=s?.curGame||window.__gvCurrentGame||window.__gvActiveRoom?.gameId||'';
 return /chess|satranç|satranc/i.test(String(g)) || /chess|satranç|satranc/i.test(document.getElementById('grTitle')?.textContent||'');
}
function css(){if(document.getElementById('gv-wait-css'))return;const x=document.createElement('style');x.id='gv-wait-css';x.textContent=`
#gv-chess-wait{position:fixed!important;left:50%!important;top:50%!important;transform:translate(-50%,-50%)!important;width:min(92vw,560px)!important;min-height:220px!important;z-index:2147483647!important;display:flex!important;flex-direction:column!important;justify-content:center!important;padding:28px!important;box-sizing:border-box!important;background:#14142d!important;color:#fff!important;border:1px solid rgba(255,255,255,.2)!important;border-radius:18px!important;box-shadow:0 20px 80px rgba(0,0,0,.8)!important;font-family:Arial,sans-serif!important;text-align:center!important}
#gv-chess-wait h2{margin:0 0 10px!important;font-size:24px!important;color:#fff!important}#gv-chess-wait p{margin:7px 0!important;color:#ddd!important}#gv-chess-wait .count{margin-top:18px!important;font-size:18px!important;font-weight:700!important;color:#b9adff!important}#gv-chess-wait .spin{margin:16px auto!important;width:28px!important;height:28px!important;border:3px solid #555!important;border-top-color:#b9adff!important;border-radius:50%!important;animation:gvspin 1s linear infinite!important}@keyframes gvspin{to{transform:rotate(360deg)}}`;document.head.appendChild(x)}
function show(text,count){
 css();let e=document.getElementById('gv-chess-wait');if(!e){e=document.createElement('div');e.id='gv-chess-wait';document.body.appendChild(e)}
 e.innerHTML='<h2>♟ Satranç — Eşleşme Bekleme Salonu</h2><p>'+text+'</p><div class="spin"></div><div class="count">Oyuncular: '+(count||1)+' / 2</div>';
 e.style.display='flex';lastVisible=true;
}
function hide(){const e=document.getElementById('gv-chess-wait');if(e)e.remove();lastVisible=false}
function name(){const s=getState();return s?.user?.name||s?.user?.username||localStorage.getItem('gv-user-name')||'Oyuncu'}
function key(){const s=getState();const u=s?.user;const id=u&&(u.id||u.userId||u.username||u.email);if(id)return'user:'+id;let k=localStorage.getItem('gv-room-guest-key');if(!k){k='guest-'+Math.random().toString(36).slice(2)+Date.now();localStorage.setItem('gv-room-guest-key',k)}return'guest:'+k}
function loadSocket(){
 if(window.io)return Promise.resolve();
 return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=BACKEND+'/socket.io/socket.io.js';s.onload=resolve;s.onerror=reject;document.head.appendChild(s)})
}
function connect(){
 if(!roomId||socket)return;
 show('Sunucuya bağlanılıyor...',1);
 loadSocket().then(()=>{
  socket=window.io(BACKEND,{transports:['websocket','polling'],reconnection:true,reconnectionAttempts:Infinity});window.__gvRoomSocket=socket;
  socket.on('connect',()=>socket.emit('joinRoom',{roomId,gameId:'chess',maxPlayers:2,durationMinutes:10,userName:name(),userKey:key()}));
  socket.on('roomUpdated',r=>{if(!r||String(r.id)!==String(roomId))return;room=r;window.__gvActiveRoom=r;const n=Array.isArray(r.players)?r.players.length:1;if(n<2&&!gameStarted)show('Rakip oyuncu bekleniyor...',n);if(n>=2&&!gameStarted){gameStarted=true;hide();loadChess()}});
  socket.on('gameStarted',p=>{if(!p||String(p.roomId)!==String(roomId))return;gameStarted=true;hide();loadChess()});
  socket.on('disconnect',()=>{if(!gameStarted&&isRoomPage())show('Sunucu bağlantısı yeniden kuruluyor...',1)})
 }).catch(()=>show('Sunucu bağlantısı kurulamadı. Yeniden deneniyor...',1))
}
function loadChess(){if(document.querySelector('script[data-gv-chess-online]'))return;const s=document.createElement('script');s.src='js/chess-online.js?v=20260817-13';s.dataset.gvChessOnline='1';document.head.appendChild(s)}
function scan(){
 if(!isRoomPage()||!isChess()){if(lastVisible)hide();return}
 if(!gameStarted){show(room&&Array.isArray(room.players)?'Rakip oyuncu bekleniyor...':'Odaya bağlanılıyor...',room&&Array.isArray(room.players)?room.players.length:1)}
 const id=getRoomId();
 if(id&&id!==roomId){roomId=id;connect()}
}
setInterval(scan,300);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',scan);else scan();
})();