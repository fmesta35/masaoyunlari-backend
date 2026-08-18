/* GameVerse - gerçek zamanlı oyun köprüsü */
(function () {
  'use strict';
  const GV = window.GVGames || null;
  let socket = null;
  let roomId = null;
  let lastRemoteSignature = null;
  let wrapped = false;
  function isAuthoritativeChess(){ return !!(window.GVGames && window.GVGames.currentGame === 'chess') || !!window.__gvChessOnlineRequested; }
  function getRoomId(){return(GV&&GV.roomId)||window.currentRoomId||window.roomId||localStorage.getItem('gv-room-id')||new URLSearchParams(location.search).get('roomId')||new URLSearchParams(location.search).get('room');}
  function getUserName(){try{const raw=localStorage.getItem('gv-user')||localStorage.getItem('user'),u=raw?JSON.parse(raw):null;return u&&(u.name||u.username)||localStorage.getItem('gv-user-name')||'Oyuncu';}catch(_){return localStorage.getItem('gv-user-name')||'Oyuncu';}}
  function signature(move){try{return JSON.stringify(move);}catch(_){return String(move);}}
  function dispatch(move,payload){const sig=signature(move);if(sig===lastRemoteSignature)return;lastRemoteSignature=sig;window.dispatchEvent(new CustomEvent('gv:remoteMove',{detail:move}));window.dispatchEvent(new CustomEvent('game:remoteMove',{detail:move}));['onRemoteMove','handleRemoteMove','receiveRemoteMove','applyRemoteGameMove','updateBoardFromRemoteMove','renderRemoteMove'].forEach(name=>{if(typeof window[name]==='function'){try{window[name](move,payload);}catch(e){console.error('[Realtime]',name,e);}}});if(window.GVGames&&typeof window.GVGames.dispatchRemoteMove==='function'){try{window.GVGames.dispatchRemoteMove(move);}catch(_){} }}
  function applyState(state,payload){if(!state)return;if(window.GVGames){window.GVGames.gameState=state;if(typeof window.GVGames.saveGameState==='function')window.GVGames.saveGameState();}window.dispatchEvent(new CustomEvent('gv:gameStateUpdated',{detail:state}));if(payload&&payload.lastMove)dispatch(payload.lastMove.moveData||payload.lastMove,payload);}
  function join(){if(isAuthoritativeChess()||!socket||!socket.connected)return;roomId=getRoomId();if(!roomId)return;if(GV)GV.roomId=roomId;socket.emit('joinRoom',{roomId,userName:getUserName(),maxPlayers:4,gameId:(GV&&GV.currentGame)||window.currentGame||'chess'});}
  function connect(){if(isAuthoritativeChess()||!window.io)return false;if(socket)return true;if(GV&&GV.socket)socket=GV.socket;else socket=window.io(window.GV_BACKEND_URL||'https://masaoyunlari-backend.onrender.com',{transports:['websocket','polling']});socket.on('connect',join);socket.on('moveMade',payload=>{if(payload&&payload.playerId&&payload.playerId===socket.id)return;const move=payload&&payload.moveData!==undefined?payload.moveData:payload;if(move!=null)dispatch(move,payload);});socket.on('receiveGameMove',move=>dispatch(move,{moveData:move}));socket.on('gameStateUpdated',payload=>applyState(payload&&payload.gameState,payload));socket.on('roomUpdated',room=>window.dispatchEvent(new CustomEvent('gv:roomUpdated',{detail:room})));socket.on('playerLeft',data=>window.dispatchEvent(new CustomEvent('gv:playerLeft',{detail:data})));join();return true;}
  function wrapGVGames(){if(isAuthoritativeChess()||wrapped||!window.GVGames||typeof window.GVGames.makeMove!=='function')return;const original=window.GVGames.makeMove.bind(window.GVGames);window.GVGames.makeMove=function(move){const result=original(move);if(result&&socket&&socket.connected&&getRoomId())socket.emit('makeMove',{roomId:getRoomId(),gameId:this.currentGame||'chess',moveData:move});return result;};wrapped=true;}
  function boot(){if(isAuthoritativeChess())return;roomId=getRoomId();if(window.io)connect();wrapGVGames();setInterval(()=>{if(isAuthoritativeChess())return;if(!socket&&window.io)connect();if(!roomId)roomId=getRoomId();wrapGVGames();},500);}
  window.addEventListener('gv:roomReady',e=>{if(isAuthoritativeChess())return;if(e.detail&&e.detail.roomId){roomId=e.detail.roomId;localStorage.setItem('gv-room-id',roomId);if(GV)GV.roomId=roomId;if(socket)join();else boot();}});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
