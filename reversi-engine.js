'use strict';
const D=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const inside=(r,c)=>r>=0&&r<8&&c>=0&&c<8;
function init(){const b=Array.from({length:8},()=>Array(8).fill(null));b[3][3]='w';b[3][4]='b';b[4][3]='b';b[4][4]='w';return{board:b,turn:'b',status:'playing',passes:0,winner:null,history:[]}}
function flips(st,r,c,col){if(!inside(r,c)||st.board[r][c])return[];const opp=col==='b'?'w':'b',out=[];for(const[dr,dc]of D){let rr=r+dr,cc=c+dc,line=[];while(inside(rr,cc)&&st.board[rr][cc]===opp){line.push([rr,cc]);rr+=dr;cc+=dc}if(line.length&&inside(rr,cc)&&st.board[rr][cc]===col)out.push(...line)}return out}
function legalMoves(st,col=st.turn){const out=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(flips(st,r,c,col).length)out.push({to:[r,c],flips:flips(st,r,c,col)});return out}
function play(st,seat,r,c){const col=seat===0?'b':'w';if(st.status!=='playing')return{ok:false,reason:'finished'};if(st.turn!==col)return{ok:false,reason:'not_your_turn'};const m=legalMoves(st,col).find(x=>x.to[0]===r&&x.to[1]===c);if(!m)return{ok:false,reason:'illegal_move'};st.board[r][c]=col;m.flips.forEach(([a,b])=>st.board[a][b]=col);st.history.push({r,c,col,flips:m.flips});st.turn=col==='b'?'w':'b';st.passes=0;if(!legalMoves(st).length){st.turn=st.turn==='b'?'w':'b';st.passes++;if(!legalMoves(st).length)finish(st)}return{ok:true,move:m,winner:st.winner}}
function finish(st){let b=0,w=0;st.board.flat().forEach(x=>x==='b'?b++:x==='w'?w++:0);st.status='finished';st.winner=b===w?null:b>w?0:1;st.result={black:b,white:w,winner:st.winner};return st.result}
module.exports={init,flips,legalMoves,play,finish};
