'use strict';
const D=[[0,1],[1,0],[1,1],[1,-1]];
function init(){return{size:15,board:Array.from({length:15},()=>Array(15).fill(null)),turn:'b',status:'playing',winner:null,moves:0,result:null}}
const inb=(s,r,c)=>r>=0&&r<s.size&&c>=0&&c<s.size;
function win(st,r,c,col){for(const[dr,dc]of D){let n=1;for(const q of [1,-1])for(let i=1;i<5;i++){const rr=r+q*dr*i,cc=c+q*dc*i;if(inb(st,rr,cc)&&st.board[rr][cc]===col)n++;else break}if(n>=5)return true}return false}
function play(st,seat,r,c){const col=seat===0?'b':'w';if(st.status!=='playing')return{ok:false,reason:'finished'};if(st.turn!==col)return{ok:false,reason:'not_your_turn'};if(!inb(st,r,c)||st.board[r][c])return{ok:false,reason:'occupied'};st.board[r][c]=col;st.moves++;if(win(st,r,c,col)){st.status='finished';st.winner=seat;st.result={winner:seat,black:st.board.flat().filter(x=>x==='b').length,white:st.board.flat().filter(x=>x==='w').length}}else if(st.moves===st.size*st.size){st.status='finished';st.result={winner:null,black:113,white:112}}else st.turn=col==='b'?'w':'b';return{ok:true,winner:st.winner}}
module.exports={init,win,play};
