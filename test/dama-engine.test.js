'use strict';
const assert=require('assert');const d=require('../dama-engine');
const s=d.init();assert.strictEqual(s.board.flat().filter(Boolean).length,24);const m=d.allMoves(s)[0];assert(m);assert.strictEqual(d.play(s,0,m.from,m.to).ok,true);assert.strictEqual(s.turn,'b');assert.strictEqual(d.play(s,0,m.from,m.to).reason,'not_your_turn');
const forced=d.init();forced.board=Array.from({length:8},()=>Array(8).fill(null));forced.board[5][0]='r';forced.board[4][1]='b';forced.board[3][2]=null;assert.strictEqual(d.play(forced,0,[5,0],[4,1]).reason,'must_capture');assert.strictEqual(d.play(forced,0,[5,0],[3,2]).ok,true);console.log('OK dama-engine');
