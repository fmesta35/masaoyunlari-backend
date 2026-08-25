/* GameVerse — Pişti/Batak online kart masaları. Sunucu yetkilidir. */
(function(){'use strict';
  if(window.__gvCardOnlineLoaded)return; window.__gvCardOnlineLoaded=true;
  const BACKEND=window.GV_BACKEND_URL||'https://masaoyunlari-backend.onrender.com';
  let socket=null, game=null, seat=null, state=null, roomId=null;
  const S=()=>{try{return typeof st!=='undefined'?st:null}catch(_){return null}};
  const esc=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function current(){let g=S()?.curGame||window.__gvCurrentGame||'';return String(g).toLowerCase()==='batak'?'batak':'pisti'}
  function id(){return String(window.__gvActiveRoomId||S()?.roomWaitingState?.room?.id||localStorage.getItem('gv-room-id')||'')}
  function draw(){const a=document.getElementById('boardArea');if(!a||!state)return;const pisti=game==='pisti';let h='<div class="card-wrap" style="max-width:760px;margin:auto"><div class="card-score">';h+=`<b>${pisti?'🃏 PİŞTİ':'🎯 BATAK'}</b><span>Skor: ${esc((state.scores||[]).join(' / '))}</span>`;if(!pisti)h+=`<span>İhaleler: ${esc((state.bids||[]).join(' / '))}</span><span>Ko: ${esc(state.trump||'—')}</span>`;h+=`</div><div class="card-table"><div class="card-center-pile">${(state.center||state.trick||[]).map(c=>`<div class="pcard"><div class="cr">${esc(c.r)}</div><div class="cs">${esc(c.s)}</div></div>`).join('')||'<span style="color:#aaa">Masa</span>'}</div></div><div class="hand-row">`; (state.hand||[]).forEach((c,i)=>{h+=`<button class="pcard" data-i="${i}" style="cursor:pointer"><div class="cr">${esc(c.r)}</div><div class="cs">${esc(c.s)}</div></button>`});h+='</div>';
    if(!pisti&&state.phase==='bid')h+='<div class="gv-card-actions">'+[4,5,6,7,8,9,10,11,12,13].map(v=>`<button data-bid="${v}">${v}</button><button data-bid="pass">Pas</button>`).join('')+'</div>';
    if(!pisti&&state.phase==='trump')h+='<div class="gv-card-actions">'+['♠','♥','♦','♣'].map(v=>`<button data-trump="${v}">${v}</button>`).join('')+'</div>';h+='</div>';a.innerHTML=h;
    a.querySelectorAll('[data-i]').forEach(b=>b.onclick=()=>socket?.emit(pisti?'pistiPlay':'batakPlay',{roomId,index:Number(b.dataset.i)}));
    a.querySelectorAll('[data-bid]').forEach(b=>b.onclick=()=>socket?.emit('batakBid',{roomId,value:b.dataset.bid==='pass'?'pass':Number(b.dataset.bid)}));a.querySelectorAll('[data-trump]').forEach(b=>b.onclick=()=>socket?.emit('batakTrump',{roomId,suit:b.dataset.trump}));
  }
  function boot(){game=current();roomId=id();if(!roomId)return;socket=window.__gvRoomSocket||window.io(BACKEND,{transports:['websocket','polling']});window.__gvRoomSocket=socket;const join=()=>socket.emit('joinRoom',{roomId,gameId:game,userName:S()?.user?.name||'Oyuncu',userKey:'guest:'+Math.random().toString(36).slice(2)});socket.on('connect',join);if(socket.connected)join();socket.on('gameStarted',p=>{if(p.gameState?.kind===game){seat=p.seat;state=p.gameState;draw()}});socket.on('gameStateUpdated',p=>{if(p.gameState?.kind===game){state=p.gameState;draw()}});socket.on(game+'Rejected',p=>window.GV?.toast?.('Hamle reddedildi: '+p.reason,'warning'))}
  window.addEventListener('gv:roomGameStarted',boot);window.addEventListener('gv:roomReady',e=>{if(['pisti','batak'].includes(e.detail?.gameId))boot()});
})();
