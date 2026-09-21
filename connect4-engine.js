'use strict';
const D=[[0,1],[1,0],[1,1],[1,-1]], inside=(r,c)=>r>=0&&r<6&&c>=0&&c<7;
function init(){return{board:Array.from({length:6},()=>Array(7).fill(null)),turn:'r',status:'playing',winner:null,moves:0,result:null}}
/* Kazandıran dizinin KARELERİNİ döndürür (yoksa null).
   Kullanıcı isteği: oyuncular hangi hamleyle kaybettiklerini görebilsin —
   maç sonunda bu kareler tahtada işaretli kalır. Geriye uyumluluk için
   dönen değer yine "doğru/yanlış" gibi kullanılabilir (dizi = doğru). */
function win(st,r,c,col){
  for(const[dr,dc]of D){
    const kareler=[[r,c]];
    for(const q of [1,-1]){
      for(let i=1;i<4;i++){
        const rr=r+q*dr*i,cc=c+q*dc*i;
        if(inside(rr,cc)&&st.board[rr][cc]===col) kareler.push([rr,cc]); else break;
      }
    }
    if(kareler.length>=4){
      kareler.sort((a,b)=>(a[0]-b[0])||(a[1]-b[1]));
      return kareler;
    }
  }
  return null;
}
function play(st,seat,col){const color=seat===0?'r':'y';if(st.status!=='playing')return{ok:false,reason:'finished'};if(st.turn!==color)return{ok:false,reason:'not_your_turn'};if(!Number.isInteger(col)||col<0||col>6||st.board[0][col])return{ok:false,reason:'column_full'};let r=5;while(st.board[r][col])r--;st.board[r][col]=color;st.moves++;const kz=win(st,r,col,color);if(kz){st.status='finished';st.winner=seat;st.kazananKareler=kz;st.result={winner:seat,kazananKareler:kz}}else if(st.moves===42){st.status='finished';st.result={winner:null}}else st.turn=color==='r'?'y':'r';return{ok:true,row:r,winner:st.winner}}
module.exports={init,win,play};
