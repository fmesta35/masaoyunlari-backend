'use strict';
const D=[[0,1],[1,0],[1,1],[1,-1]];
function init(){return{size:15,board:Array.from({length:15},()=>Array(15).fill(null)),turn:'b',status:'playing',winner:null,moves:0,result:null}}
const inb=(s,r,c)=>r>=0&&r<s.size&&c>=0&&c<s.size;
/* Kazandıran beşlinin KARELERİ (yoksa null) — bkz. connect4-engine.js */
function win(st,r,c,col){
  for(const[dr,dc]of D){
    const kareler=[[r,c]];
    for(const q of [1,-1]){
      for(let i=1;i<5;i++){
        const rr=r+q*dr*i,cc=c+q*dc*i;
        if(inb(st,rr,cc)&&st.board[rr][cc]===col) kareler.push([rr,cc]); else break;
      }
    }
    if(kareler.length>=5){
      kareler.sort((a,b)=>(a[0]-b[0])||(a[1]-b[1]));
      return kareler;
    }
  }
  return null;
}
function play(st,seat,r,c){const col=seat===0?'b':'w';if(st.status!=='playing')return{ok:false,reason:'finished'};if(st.turn!==col)return{ok:false,reason:'not_your_turn'};if(!inb(st,r,c)||st.board[r][c])return{ok:false,reason:'occupied'};st.board[r][c]=col;st.moves++;const kz=win(st,r,c,col);if(kz){st.status='finished';st.winner=seat;st.kazananKareler=kz;st.result={winner:seat,kazananKareler:kz,black:st.board.flat().filter(x=>x==='b').length,white:st.board.flat().filter(x=>x==='w').length}}else if(st.moves===st.size*st.size){st.status='finished';st.result={winner:null,black:113,white:112}}else st.turn=col==='b'?'w':'b';return{ok:true,winner:st.winner}}
module.exports={init,win,play};
