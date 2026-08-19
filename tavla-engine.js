'use strict';

/*
 * GameVerse - Yetkili (server-side) Tavla motoru.
 *
 * Tahta gösterimi istemci (index.html dTavla) ile BİREBİR aynıdır:
 *   - points[0..23] = { color: 'w'|'b'|null, count: n }
 *   - Beyaz (w) azalan indekse oynar (23 -> 0), toplama bölgesi 0..5.
 *   - Siyah (b) artan indekse oynar (0 -> 23), toplama bölgesi 18..23.
 *   - Bar girişi: w -> (24 - zar), b -> (zar - 1).
 *
 * Uygulanan kurallar:
 *   - Tek taş (blot) vurulur ve bar'a gider; 2+ taşlı kapı kapalıdır.
 *   - Bar'da taş varken önce bar'dan giriş zorunludur.
 *   - Pul toplama (bear-off): tüm pullar evdeyken; tam zar, ya da daha
 *     geride pul yokken daha büyük zar ile çıkış.
 *   - Zar kullanım kuralı: mümkün olan en çok zar oynanmak ZORUNDADIR;
 *     iki zardan yalnız biri oynanabiliyorsa BÜYÜK zar oynanır; çift
 *     zarlarda mümkün olduğunca çok hamle yapılır. (legalSteps bunu
 *     derinlemesine arama ile garanti eder.)
 *   - 15 pulunu toplayan kazanır; rakip hiç pul çıkaramadıysa MARS.
 */

function newPoints() {
  const p = Array(24).fill(null).map(() => ({ color: null, count: 0 }));
  p[23] = { color: 'w', count: 2 };
  p[12] = { color: 'w', count: 5 };
  p[7] = { color: 'w', count: 3 };
  p[5] = { color: 'w', count: 5 };
  p[0] = { color: 'b', count: 2 };
  p[11] = { color: 'b', count: 5 };
  p[16] = { color: 'b', count: 3 };
  p[18] = { color: 'b', count: 5 };
  return p;
}

function init() {
  return {
    points: newPoints(),
    bar: { w: 0, b: 0 },
    off: { w: 0, b: 0 },
    turn: 'w',
    dice: [0, 0],
    movesLeft: [],
    rolled: false,
    winner: null,
    history: [] // geri alma için anlık görüntüler (tur içi)
  };
}

function opp(c) { return c === 'w' ? 'b' : 'w'; }
function dirOf(c) { return c === 'w' ? -1 : 1; }
function barEntry(c, die) { return c === 'w' ? 24 - die : die - 1; }
function distance(c, i) { return c === 'w' ? i + 1 : 24 - i; }
function stepKey(s) { return s.from + '|' + s.to + '|' + s.die; }

function clone(s) {
  return {
    points: s.points.map(p => ({ color: p.color, count: p.count })),
    bar: { w: s.bar.w, b: s.bar.b },
    off: { w: s.off.w, b: s.off.b },
    turn: s.turn,
    dice: [s.dice[0], s.dice[1]],
    movesLeft: s.movesLeft.slice(),
    rolled: s.rolled,
    winner: s.winner || null,
    history: [] // kopyada geçmiş taşınmaz
  };
}

// c renginin TÜM pulları ev bölgesinde mi? (bar dahil değil)
function allHome(s, c) {
  if (s.bar[c] > 0) return false;
  const lo = c === 'w' ? 0 : 18;
  const hi = c === 'w' ? 5 : 23;
  for (let i = 0; i < 24; i++) {
    const p = s.points[i];
    if (p.color === c && p.count > 0 && (i < lo || i > hi)) return false;
  }
  return true;
}

function landable(s, c, to) {
  if (to < 0 || to > 23) return false;
  const p = s.points[to];
  return p.count === 0 || p.color === c || p.count === 1;
}

// Büyük zarla çıkış: ancak daha geride (çıkıştan uzakta) pul yokken.
function noCheckerBehind(s, c, i) {
  if (c === 'w') {
    for (let k = i + 1; k <= 5; k++) if (s.points[k].color === 'w' && s.points[k].count > 0) return false;
  } else {
    for (let k = 18; k < i; k++) if (s.points[k].color === 'b' && s.points[k].count > 0) return false;
  }
  return true;
}

// Tek bir zar için tüm tek-pul hamleleri (kullanım-maksimizasyonu YOK;
// o aşama legalSteps içinde ele alınır).
function stepsFor(s, die) {
  const c = s.turn;
  const out = [];
  if (s.bar[c] > 0) {
    const e = barEntry(c, die);
    if (landable(s, c, e)) out.push({ from: 'bar', to: e, die });
    return out;
  }
  const home = allHome(s, c);
  for (let i = 0; i < 24; i++) {
    const p = s.points[i];
    if (p.color !== c || p.count <= 0) continue;
    const to = i + dirOf(c) * die;
    if (to >= 0 && to <= 23) {
      if (landable(s, c, to)) out.push({ from: i, to, die });
    } else if (home) {
      const dist = distance(c, i);
      if (die === dist || (die > dist && noCheckerBehind(s, c, i))) {
        out.push({ from: i, to: 'off', die });
      }
    }
  }
  return out;
}

// Hamleyi tahtaya uygular (zar tüketimi DAHİL DEĞİL — dfs kendi yönetir).
function applyStepMut(s, step) {
  const c = s.turn;
  const o = opp(c);
  if (step.from === 'bar') {
    s.bar[c]--;
  } else {
    const f = s.points[step.from];
    f.count--;
    if (f.count === 0) f.color = null;
  }
  if (step.to === 'off') {
    s.off[c]++;
  } else {
    const t = s.points[step.to];
    if (t.count === 1 && t.color === o) { // vuruş
      t.count = 0;
      t.color = null;
      s.bar[o]++;
    }
    if (t.count === 0) t.color = c;
    t.count++;
  }
}

// En iyi (count, sum) ikilisine ulaşan tüm hamle dizilerinin İLK adımları.
// dfs derinliği en fazla 4 (çift zar); düğüm sayısı pratikte küçüktür.
function legalSteps(s) {
  if (!s.movesLeft.length) return [];
  let best = { count: 0, sum: 0 };
  const firsts = new Map();

  function better(a, b) { return a.count > b.count || (a.count === b.count && a.sum > b.sum); }

  function dfs(board, diceLeft, acc) {
    const diceVals = [...new Set(diceLeft)];
    let any = false;
    for (const d of diceVals) {
      const steps = stepsFor(board, d);
      if (!steps.length) continue;
      any = true;
      const idx = diceLeft.indexOf(d);
      for (const step of steps) {
        const next = clone(board);
        applyStepMut(next, step);
        const rest = diceLeft.slice();
        rest.splice(idx, 1);
        dfs(next, rest, acc.concat([step]));
      }
    }
    if (!any) {
      const cand = { count: acc.length, sum: acc.reduce((t, st) => t + st.die, 0) };
      if (acc.length && (cand.count > best.count || (cand.count === best.count && cand.sum >= best.sum))) {
        if (better(cand, best)) { best = cand; firsts.clear(); }
        const first = acc[0];
        firsts.set(stepKey(first), first);
      }
    }
  }

  const board = clone(s);
  dfs(board, s.movesLeft.slice(), []);
  return [...firsts.values()];
}

function isLegalStep(s, step) {
  const key = stepKey(step);
  return legalSteps(s).some(x => stepKey(x) === key);
}

function applyStep(s, step) {
  acceptSnapshot(s);
  applyStepMut(s, step);
  const idx = s.movesLeft.indexOf(step.die);
  if (idx !== -1) s.movesLeft.splice(idx, 1);
  s.points.forEach(() => {}); // no-op: okunabilirlik için
  if (s.off[s.turn] === 15) s.winner = s.turn;
  return s;
}

function acceptSnapshot(s) {
  s.history.push(clone(s));
}

function roll(s, dice) {
  const d1 = Math.max(1, Math.min(6, Number(dice && dice[0]) || (1 + Math.floor(Math.random() * 6))));
  const d2 = Math.max(1, Math.min(6, Number(dice && dice[1]) || (1 + Math.floor(Math.random() * 6))));
  s.dice = [d1, d2];
  s.movesLeft = d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
  s.rolled = true;
  return s;
}

function endTurn(s) {
  s.turn = opp(s.turn);
  s.dice = [0, 0];
  s.movesLeft = [];
  s.rolled = false;
  s.history = [];
  return s;
}

// Tur bitti mi? (hamle kalmadı veya yasal hamle yok)
function turnOver(s) {
  if (!s.rolled || s.winner) return false;
  if (!s.movesLeft.length) return true;
  return legalSteps(s).length === 0;
}

function undo(s) {
  const prev = s.history.pop();
  if (!prev) return false;
  s.points = prev.points;
  s.bar = prev.bar;
  s.off = prev.off;
  s.movesLeft = prev.movesLeft;
  s.winner = prev.winner;
  return true;
}

module.exports = {
  init, clone, roll, endTurn, turnOver,
  stepsFor, legalSteps, isLegalStep, applyStep, undo,
  allHome, landable, opp
};
