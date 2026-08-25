'use strict';

// Sunucu yetkili Pişti motoru. State is deliberately JSON serialisable.
const SUITS = ['♠','♥','♦','♣'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function deck() { return SUITS.flatMap(s => RANKS.map(r => ({ s, r }))); }
function shuffle(a, rng=Math.random) { for (let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function init(players=2, rounds=1, rng=Math.random) {
  if (players<2||players>4) throw new Error('players');
  const st={players,rounds,round:1,deck:shuffle(deck(),rng),hands:Array.from({length:players},()=>[]),center:[],captures:Array.from({length:players},()=>[]),scores:Array(players).fill(0),turn:0,lastWinner:0,finished:false};
  st.center.push(st.deck.pop(),st.deck.pop(),st.deck.pop(),st.deck.pop()); deal(st); return st;
}
function deal(st){ for(const h of st.hands) while(h.length<4&&st.deck.length)h.push(st.deck.pop()); }
function play(st, player, index){
  if(st.finished)return {ok:false,reason:'finished'}; if(player!==st.turn)return {ok:false,reason:'not_your_turn'};
  const card=st.hands[player]?.[index]; if(!card)return {ok:false,reason:'bad_card'};
  st.hands[player].splice(index,1); const top=st.center.at(-1); st.center.push(card);
  const take=!!top&&(card.r==='J'||card.r===top.r); if(take){const pile=st.center.splice(0);st.captures[player].push(...pile);st.lastWinner=player;}
  st.turn=(st.turn+1)%st.players;
  if(st.hands.every(h=>!h.length)){ if(st.deck.length)deal(st); else finish(st); }
  return {ok:true,card,take};
}
function score(st){const s=st.scores.map(()=>0);for(let p=0;p<st.players;p++)for(const c of st.captures[p]){if(c.r==='A'||c.r==='J')s[p]++;if(c.r==='10'&&c.s==='♦')s[p]+=3;if(c.r==='2'&&c.s==='♣')s[p]+=2;}const counts=st.captures.map(x=>x.length), max=Math.max(...counts);if(counts.filter(x=>x===max).length===1)s[counts.indexOf(max)]+=3;return s;}
function finish(st){st.scores=score(st);st.finished=true;st.result={scores:st.scores.slice(),winner:st.scores.indexOf(Math.max(...st.scores))};return st.result;}
module.exports={SUITS,RANKS,deck,shuffle,init,deal,play,score,finish};
