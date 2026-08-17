/* GameVerse waiting room fix - no bots */
(function(){'use strict';
var timer=null;
function S(){try{return typeof st!=='undefined'?st:null}catch(e){return null}}
function chess(){var s=S();if(!s||s.curGame!=='chess'||document.querySelector('script[data-gv-chess-online]'))return;var x=document.createElement('script');x.src='js/chess-online.js?v=20260817-6';x.async=true;x.dataset.gvChessOnline='1';document.head.appendChild(x)}
function show(){var s=S();if(!s||s.curPage!=='room')return;document.querySelectorAll('.page').forEach(function(p){if(p.id==='room')p.classList.add('active')});var p=document.getElementById('room');if(p){p.style.display='block';p.style.visibility='visible';p.style.opacity='1'}if(s.roomWaitingState&&typeof window.renderWaitingTableUI==='function'){try{window.renderWaitingTableUI()}catch(e){console.error('[RoomWaitingFix]',e)}}chess()}
function watch(){if(timer)return;timer=setInterval(function(){var s=S();if(!s||s.curPage!=='room'){clearInterval(timer);timer=null;return}show()},250)}
function patch(){if(typeof window.page==='function'&&!window.__gvRoomPagePatched2){var op=window.page;window.page=function(n){var r=op.apply(this,arguments);if(n==='room'){setTimeout(show,0);setTimeout(show,100);setTimeout(show,300);watch()}return r};window.__gvRoomPagePatched2=true}if(typeof window.startRoomWaitingProcess==='function'&&!window.__gvRoomStartPatched2){var os=window.startRoomWaitingProcess;window.startRoomWaitingProcess=function(room){var r=os.apply(this,arguments);setTimeout(show,0);setTimeout(show,100);setTimeout(show,300);watch();return r};window.__gvRoomStartPatched2=true}}
function boot(){patch();show();setTimeout(patch,100);setTimeout(patch,500);setTimeout(patch,1200)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
