'use strict';

/*
 * GameVerse — Yetkili Sunucu OKEY MOTORU (saf mantık, soket yok)
 * Kural seti sitedeki yerel motorun birebir sunucu taşımasıdır:
 *  - 106 taş: 4 renk × 1-13 × 2 + 2 sahte okey
 *  - Gösterge desteden çekilir; gerçek okey = gösterge+1 (13'ten sonra 1)
 *  - Sahte okeyler göstergenin değerini alır (n/dc)
 *  - Başlayan 15 taş alır ve ÇEKMEDEN atar; diğerleri 14 ile başlar
 *  - Taş çekme: orta desteden VEYA bir önceki oyuncunun (atma sırasına göre
 *    soldaki rakibin) en üst atığından
 *  - Bitiş: 14 taşın tamamı geçerli perler (aynı sayı-farklı renk ≥3'lü /
 *    aynı renk seri ≥3'lü, 13-1 dönüşümlü) OLMALI ya da 7 çift olmalı;
 *    15. taş ortaya atılır. Okey taşı atarak bitirmek ayrı tip ('okey'),
 *    çifte bitmek 'pairs', aksi 'standard'.
 *  - Deste bitince el berabere ('draw').
 */

const COLORS = ['t-red', 't-black', 't-blue', 't-yellow'];

function freshDeck(idPrefix) {
  const d = [];
  let id = 0;
  const px = idPrefix || 'ok';
  for (let cp = 0; cp < 2; cp++) {
    for (const c of COLORS) {
      for (let n = 1; n <= 13; n++) d.push({ id: `${px}-${id++}`, n, c, isFJ: false });
    }
  }
  d.push({ id: `${px}-${id++}`, n: 0, c: 't-joker', isFJ: true });
  d.push({ id: `${px}-${id++}`, n: 0, c: 't-joker', isFJ: true });
  return d;
}

function shuffle(arr, rng) {
  const rand = rng || Math.random;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function isRealOkeyTile(t, realOkey) {
  if (!t) return false;
  if (t.isFJ) return false; // sahte okey gösterge yerine geçer, okey DEĞİLDİR
  return t.c === realOkey.c && t.n === realOkey.n;
}

// Bir taş "oykey mi"? (yerel motordaki _okIsOkey karşılığı)

function markOkeyFlag(t, realOkey) {
  if (!t.isFJ) t.isOkey = isRealOkeyTile(t, realOkey);
  return t;
}

// ---- Kazanma doğrulaması (yerel _okCheckPairs/_okCheckPer/_okSolveRecursive) ----
function checkPairs(tiles, realOkey) {
  if (tiles.length !== 14) return false;
  let okeyCount = 0;
  const remaining = [];
  tiles.forEach(t => { (isRealOkeyTile(t, realOkey) ? okeyCount++ : remaining.push(t)); });
  const map = {};
  remaining.forEach(t => {
    const key = `${t.c}-${t.n}`;
    map[key] = (map[key] || 0) + 1;
  });
  let singles = 0;
  Object.values(map).forEach(cnt => { if (cnt % 2 !== 0) singles++; });
  return okeyCount >= singles;
}

function checkPer(tiles, realOkey) {
  if (tiles.length !== 14) return false;
  let okeys = 0;
  const regular = [];
  tiles.forEach(t => { (isRealOkeyTile(t, realOkey) ? okeys++ : regular.push(t)); });
  regular.sort((a, b) => a.c.localeCompare(b.c) || a.n - b.n);
  return solveRecursive(regular, okeys);
}

// Tamamını aynı sayı-farklı renk grupları veya aynı renk-seri gruplarına
// ayırabilir mi? (gerçek okeyler joker gibi kullanılır)
function solveRecursive(regular, okeys) {
  if (regular.length === 0) return true;
  if (regular.length + okeys < 3) return false;

  const first = regular[0];

  // Aynı sayı — farklı renkler (3 veya 4'lü küt)
  const sameNum = regular.filter(t => t.n === first.n);
  const uniqueCols = [];
  const seen = new Set();
  sameNum.forEach(t => { if (!seen.has(t.c)) { seen.add(t.c); uniqueCols.push(t); } });

  for (let size = 3; size <= 4; size++) {
    for (let need = 0; need <= okeys; need++) {
      const reqReg = size - need;
      if (reqReg >= 1 && uniqueCols.length >= reqReg) {
        const combo = uniqueCols.slice(0, reqReg);
        const rem = [...regular];
        let valid = true;
        combo.forEach(ct => {
          const idx = rem.findIndex(r => r.id === ct.id);
          if (idx !== -1) rem.splice(idx, 1); else valid = false;
        });
        if (valid && solveRecursive(rem, okeys - need)) return true;
      }
    }
  }

  // Aynı renk seri (13→1 dönüşümlü; ≥6 uzunluklar 3/4/5'lik dilimlere
  // ayrılabildiği için 3-5 yeterli). 'first' serinin yalnız BAŞI değil herhangi
  // bir üyesi olabilir: sıralama küçük sayıyı öne koyduğundan 12-13-1 gibi
  // dönüşümlü seriler ancak farklı üyeden başlatılarak bulunur (yerel motordaki
  // kör noktanın düzeltilmiş hâli; kabul ettiği ellerin üstkümesi).
  for (let len = 5; len >= 3; len--) {
    for (let anchor = 0; anchor < len; anchor++) {
      for (let need = 0; need <= okeys; need++) {
        const rem = [...regular];
        let okeysLeft = need;
        let possible = true;
        for (let step = 0; step < len; step++) {
          let targetNum = first.n + (step - anchor);
          targetNum = ((targetNum - 1) % 13 + 13) % 13 + 1; // 1..13 halkası
          const idx = rem.findIndex(r => r.c === first.c && r.n === targetNum);
          if (idx !== -1) rem.splice(idx, 1);
          else if (okeysLeft > 0) okeysLeft--;
          else { possible = false; break; }
        }
        if (possible && okeysLeft === 0) {
          if (solveRecursive(rem, okeys - need)) return true;
        }
      }
    }
  }
  return false;
}

// ---- Tur (el) kurulumu ----
// seats: [0,1,2,3] koltuk dizilimi (sıra dizisi seats sırasını izler;
// önceki oyuncu = seats dizisindeki bir önceki koltuk).
function startRound(roundNo, seats, scores, rng, starterSeat) {
  const deck = shuffle(freshDeck(`ok-r${roundNo}`), rng);
  let indicator = null;
  for (let i = 0; i < deck.length; i++) {
    if (!deck[i].isFJ) { indicator = deck.splice(i, 1)[0]; break; }
  }
  if (!indicator) indicator = { id: 'ok-ind-fallback', c: 't-red', n: 1, isFJ: false };

  const realOkey = { c: indicator.c, n: indicator.n >= 13 ? 1 : indicator.n + 1 };

  // Sahte okeyler göstergenin kimliğini alır (yerel motorla aynı).
  deck.forEach(t => {
    if (!t.isFJ) { t.isOkey = isRealOkeyTile(t, realOkey); }
    else { t.n = indicator.n; t.dc = indicator.c; }
  });

  const starter = (starterSeat !== undefined && seats.includes(starterSeat))
    ? starterSeat
    : seats[Math.floor((rng ? rng() : Math.random()) * seats.length)];

  const hands = {};
  seats.forEach(seat => { hands[seat] = []; });
  // Başlayan 15, diğerleri 14 — başlayana önce dağıtılır.
  hands[starter] = deck.splice(0, 15).map(t => markOkeyFlag(t, realOkey));
  seats.forEach(seat => {
    if (seat !== starter) hands[seat] = deck.splice(0, 14).map(t => markOkeyFlag(t, realOkey));
  });

  return {
    round: roundNo,
    seats: seats.slice(),
    starter,
    turn: starter,
    phase: 'discard', // 15 taşla başlayan ÇEKMEDEN atar
    deck,
    indicator,
    realOkey: { c: realOkey.c, n: realOkey.n },
    hands,               // sunucuda tutulur; istemciye sadece kendi eli gider
    discardPiles: Object.fromEntries(seats.map(s => [s, []])),
    scores: Object.assign({}, scores),
    finished: false,
    result: null         // { winner, winType } veya { winner: null, winType: 'draw' }
  };
}

function prevSeatOf(state, seat) {
  const idx = state.seats.indexOf(seat);
  if (idx === -1) return null;
  return state.seats[(idx - 1 + state.seats.length) % state.seats.length];
}

function nextSeatOf(state, seat) {
  const idx = state.seats.indexOf(seat);
  if (idx === -1) return null;
  return state.seats[(idx + 1) % state.seats.length];
}

// ---- Eylemler ----
function drawFromDeck(state, seat) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'draw') return { ok: false, reason: 'must_discard' };
  if (!state.deck.length) {
    // Deste bitti: el berabere (yerel motorla aynı).
    state.finished = true;
    state.result = { winner: null, winType: 'draw' };
    return { ok: true, drawn: null, deckEmpty: true };
  }
  const t = state.deck.pop();
  if (t.isFJ) { t.n = state.indicator.n; t.dc = state.indicator.c; }
  else t.isOkey = isRealOkeyTile(t, state.realOkey);
  state.hands[seat].push(t);
  state.phase = 'discard';
  return { ok: true, drawn: t };
}

function drawFromPrev(state, seat) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'draw') return { ok: false, reason: 'must_discard' };
  const prev = prevSeatOf(state, seat);
  const pile = state.discardPiles[prev] || [];
  if (!pile.length) return { ok: false, reason: 'no_discard' };
  const t = pile.pop();
  state.hands[seat].push(t);
  state.phase = 'discard';
  return { ok: true, drawn: t, fromSeat: prev };
}

function discard(state, seat, tileId) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'discard') return { ok: false, reason: 'must_draw' };
  const hand = state.hands[seat];
  const idx = hand.findIndex(t => t.id === tileId);
  if (idx === -1) return { ok: false, reason: 'tile_not_found' };
  const tile = hand.splice(idx, 1)[0];
  state.discardPiles[seat].push(tile);
  state.turn = nextSeatOf(state, seat);
  state.phase = 'draw';
  return { ok: true, tile, next: state.turn };
}

// Bitiş: tileId ortaya atılır; kalan 14 geçerli olmalı.
function finish(state, seat, tileId) {
  if (state.finished) return { ok: false, reason: 'round_over' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  if (state.phase !== 'discard') return { ok: false, reason: 'must_draw' };
  const hand = state.hands[seat];
  const idx = hand.findIndex(t => t.id === tileId);
  if (idx === -1) return { ok: false, reason: 'tile_not_found' };
  const tile = hand[idx];
  const remaining = hand.filter((_, i) => i !== idx);

  const isPairs = checkPairs(remaining, state.realOkey);
  const isPer = checkPer(remaining, state.realOkey);
  if (!isPairs && !isPer) return { ok: false, reason: 'not_a_win_hand' };

  hand.splice(idx, 1);
  state.discardPiles[seat].push(tile); // orta atığı olarak kayda geçer

  let winType = 'standard';
  if (isPairs) winType = 'pairs';
  else if (isRealOkeyTile(tile, state.realOkey)) winType = 'okey';

  state.finished = true;
  state.result = { winner: seat, winType };
  return { ok: true, winType, tile };
}

// Bir elin 14 taşıyla bitip bitmeyeceğini dışa aç (istemci "Kontrol" için).
function canFinishWith14(tiles, realOkey) {
  return checkPairs(tiles, realOkey) || checkPer(tiles, realOkey);
}

function handCanFinish(hand, realOkey) {
  // 15 taşlı elden herhangi bir taşı atınca kalan 14 geçerli mi?
  if (!Array.isArray(hand) || hand.length !== 15) return false;
  for (let i = 0; i < hand.length; i++) {
    const rest = hand.filter((_, j) => j !== i);
    if (checkPairs(rest, realOkey) || checkPer(rest, realOkey)) return true;
  }
  return false;
}

module.exports = {
  COLORS,
  freshDeck,
  startRound,
  drawFromDeck,
  drawFromPrev,
  discard,
  finish,
  checkPairs,
  checkPer,
  canFinishWith14,
  handCanFinish,
  isRealOkeyTile,
  prevSeatOf,
  nextSeatOf
};
