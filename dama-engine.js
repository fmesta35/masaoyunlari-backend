'use strict';

// English draughts (American checkers), 8x8, sunucu yetkili motoru.
// Men move/capture diagonally forward; kings move both directions. Captures
// are compulsory and multiple jumps are resolved as one atomic move.
const D = [[-1,-1],[-1,1],[1,-1],[1,1]];
function inside(r,c){return r>=0&&r<8&&c>=0&&c<8}
function enemy(p,color){return p && p.toLowerCase() !== color}
function init(){const b=Array.from({length:8},()=>Array(8).fill(null));for(let r=0;r<3;r++)for(let c=0;c<8;c++)if((r+c)%2)b[r][c]='b';for(let r=5;r<8;r++)for(let c=0;c<8;c++)if((r+c)%2)b[r][c]='r';return {board:b,turn:'r',status:'playing',captures:{r:0,b:0},winner:null,history:[]}}
function movesFor(st,r,c){const p=st.board[r]?.[c], color=p?.toLowerCase();if(!p||color!==st.turn)return[];const king=p===p.toUpperCase(), dirs=king?D:D.filter(x=>color==='r'?x[0]<0:x[0]>0), captures=[];
 for(const [dr,dc] of dirs){const mr=r+dr,mc=c+dc,lr=r+2*dr,lc=c+2*dc;if(inside(lr,lc)&&enemy(st.board[mr][mc],color)&&!st.board[lr][lc])captures.push({from:[r,c],to:[lr,lc],captures:[[mr,mc]]});}
 if(captures.length)return captures; if(hasCapture(st))return[];
 return dirs.map(([dr,dc])=>({from:[r,c],to:[r+dr,c+dc],captures:[]})).filter(m=>inside(...m.to)&&!st.board[m.to[0]][m.to[1]]);
}
function hasCapture(st){for(let r=0;r<8;r++)for(let c=0;c<8;c++)if(st.board[r][c]?.toLowerCase()===st.turn&&movesCapture(st,r,c).length)return true;return false}
function movesCapture(st,r,c){const p=st.board[r]?.[c],color=p?.toLowerCase();if(!p||color!==st.turn)return[];const king=p===p.toUpperCase(),dirs=king?D:D.filter(x=>color==='r'?x[0]<0:x[0]>0);return dirs.map(([dr,dc])=>({to:[r+2*dr,c+2*dc],captures:[[r+dr,c+dc]]})).filter(m=>inside(...m.to)&&enemy(st.board[m.captures[0][0]][m.captures[0][1]],color)&&!st.board[m.to[0]][m.to[1]]);}
function allMoves(st){const out=[];for(let r=0;r<8;r++)for(let c=0;c<8;c++)out.push(...movesFor(st,r,c));return out}
function play(st,player,from,to){const color=player===0?'r':'b';if(st.status!=='playing')return{ok:false,reason:'finished'};if(color!==st.turn)return{ok:false,reason:'not_your_turn'};if(!Array.isArray(from)||!Array.isArray(to))return{ok:false,reason:'bad_move'};const m=allMoves(st).find(x=>x.from[0]===from[0]&&x.from[1]===from[1]&&x.to[0]===to[0]&&x.to[1]===to[1]);if(!m)return{ok:false,reason:hasCapture(st)?'must_capture':'illegal_move'};const p=st.board[from[0]][from[1]];st.board[from[0]][from[1]]=null;st.board[to[0]][to[1]]=p;for(const [r,c] of m.captures){st.board[r][c]=null;st.captures[color]++;}if(p==='r'&&to[0]===0)st.board[to[0]][to[1]]='R';if(p==='b'&&to[0]===7)st.board[to[0]][to[1]]='B';st.history.push({from,to,captures:m.captures});const other=player==='r'?'b':'r';if(!allPieces(st,other)||!allMoves({...st,turn:other}).length){st.status='finished';st.winner=player}else st.turn=other;return{ok:true,move:m,winner:st.winner}}
function allPieces(st,color){return st.board.some(row=>row.some(p=>p?.toLowerCase()===color))}
module.exports={init,movesFor,allMoves,play};
