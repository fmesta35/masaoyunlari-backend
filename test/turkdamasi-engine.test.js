'use strict';
const assert=require('assert');const d=require('../turkdamasi-engine');
let s=d.init();assert.strictEqual(s.board.flat().filter(Boolean).length,32);let m=d.allMoves(s)[0];assert(m);assert.strictEqual(d.play(s,0,m.from,m.to).ok,true);assert.strictEqual(s.turn,'b');
let x=d.init();x.board=Array.from({length:8},()=>Array(8).fill(null));x.board[5][0]='w';x.board[4][0]='b';assert.strictEqual(d.play(x,0,[5,0],[4,0]).reason,'must_capture');assert.strictEqual(d.play(x,0,[5,0],[3,0]).ok,true);console.log('OK turkdamasi-engine');
