'use strict';
// ============== AMİRAL BATTI (Battleship) — saf oyun motoru ==============
// G/Ç yok, sunucudan çağrılır (anti-hile: tüm doğrulama burada, istemciye
// güvenilmez). 10x10 ızgara: satır/sütun 0-9 (istemcide A-J / 1-10 olarak
// gösterilir). Diğer motorlarla (okey-engine.js gibi) aynı stil: init/
// eylem fonksiyonları saf durum mutasyonu yapar, sunucu (server.js)
// koltuk-bazlı "sis-of-war" görünümünü ayrıca şekillendirir (bkz.
// server.js:battleshipState — okey-engine'in gizli-el emsaline benzer).

const SIZE = 10;

// Klasik uluslararası filo (5 gemi, 17 hücre), Türkçe adlarla.
const SHIPS = [
  { id: 'carrier',    name: 'Uçak Gemisi', size: 5 },
  { id: 'battleship', name: 'Zırhlı',      size: 4 },
  { id: 'cruiser',    name: 'Kruvazör',    size: 3 },
  { id: 'submarine',  name: 'Denizaltı',   size: 3 },
  { id: 'destroyer',  name: 'Muhrip',      size: 2 }
];
const FLEET_CELLS = SHIPS.reduce((sum, s) => sum + s.size, 0); // 17

function init() {
  return {
    phase: 'placing',      // 'placing' -> 'battle' -> 'finished'
    seats: [0, 1],
    boards: { 0: null, 1: null }, // koltuk -> 10x10 (gemi id'si | null)
    ships:  { 0: null, 1: null }, // koltuk -> [{id,name,size,cells:[[r,c]...],hits:[bool...]}]
    shots:  { 0: [], 1: [] },     // koltuk -> BU KOLTUĞUN ATTIĞI atışlar [{r,c,result,shipId}]
    ready:  { 0: false, 1: false },
    turn: null,
    winner: null,
    result: null
  };
}

function inBounds(r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function cellsFor(shipDef, r, c, dir) {
  const cells = [];
  for (let i = 0; i < shipDef.size; i++) {
    cells.push(dir === 'v' ? [r + i, c] : [r, c + i]);
  }
  return cells;
}

// placements: [{shipId, r, c, dir:'h'|'v'}, ...] — filodaki TÜM 5 gemi,
// her biri tam olarak bir kez, çakışmasız ve sınırlar içinde olmalı.
function place(state, seat, placements) {
  if (seat !== 0 && seat !== 1) return { ok: false, reason: 'bad_seat' };
  if (state.phase !== 'placing') return { ok: false, reason: 'wrong_phase' };
  if (state.ready[seat]) return { ok: false, reason: 'already_ready' };
  if (!Array.isArray(placements) || placements.length !== SHIPS.length) {
    return { ok: false, reason: 'invalid_fleet' };
  }

  const board = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const ships = [];
  const seen = new Set();

  for (const def of SHIPS) {
    const p = placements.find(x => x && x.shipId === def.id);
    if (!p) return { ok: false, reason: 'missing_ship', shipId: def.id };
    if (seen.has(def.id)) return { ok: false, reason: 'duplicate_ship', shipId: def.id };
    seen.add(def.id);

    const dir = p.dir === 'v' ? 'v' : 'h';
    const r = Number(p.r), c = Number(p.c);
    const cells = cellsFor(def, r, c, dir);
    for (const [cr, cc] of cells) {
      if (!inBounds(cr, cc)) return { ok: false, reason: 'out_of_bounds', shipId: def.id };
      if (board[cr][cc]) return { ok: false, reason: 'overlap', shipId: def.id };
    }
    cells.forEach(([cr, cc]) => { board[cr][cc] = def.id; });
    ships.push({ id: def.id, name: def.name, size: def.size, cells, hits: cells.map(() => false) });
  }

  state.boards[seat] = board;
  state.ships[seat] = ships;
  state.ready[seat] = true;

  if (state.ready[0] && state.ready[1]) {
    state.phase = 'battle';
    // İlk atışı kim yapar — adil olsun diye rastgele seçilir.
    state.turn = Math.random() < 0.5 ? 0 : 1;
  }
  return { ok: true };
}

// (r,c)'ye ateş et. Sıra her zaman el değiştirir (isabet olsa bile) —
// basitlik ve öngörülebilirlik için tercih edildi (klasik "vurdukça devam
// et" kuralı yerine).
function fire(state, seat, r, c) {
  if (seat !== 0 && seat !== 1) return { ok: false, reason: 'bad_seat' };
  if (state.phase !== 'battle') return { ok: false, reason: 'wrong_phase' };
  if (state.turn !== seat) return { ok: false, reason: 'not_your_turn' };
  r = Number(r); c = Number(c);
  if (!inBounds(r, c)) return { ok: false, reason: 'out_of_bounds' };

  const mine = state.shots[seat];
  if (mine.some(s => s.r === r && s.c === c)) return { ok: false, reason: 'already_fired' };

  const target = seat === 0 ? 1 : 0;
  const board = state.boards[target];
  const shipId = board[r][c];
  let result = 'miss';
  let sunkShip = null;

  if (shipId) {
    const ship = state.ships[target].find(s => s.id === shipId);
    const idx = ship.cells.findIndex(([cr, cc]) => cr === r && cc === c);
    ship.hits[idx] = true;
    const sunk = ship.hits.every(Boolean);
    result = sunk ? 'sunk' : 'hit';
    if (sunk) sunkShip = { id: ship.id, name: ship.name, size: ship.size, cells: ship.cells.map(x => x.slice()) };
  }

  mine.push({ r, c, result, shipId: shipId || null });

  let finished = false;
  const allSunk = state.ships[target].every(s => s.hits.every(Boolean));
  if (allSunk) {
    state.phase = 'finished';
    state.winner = seat;
    state.result = { reason: 'fleet_sunk', winnerSeat: seat };
    finished = true;
  } else {
    state.turn = target;
  }

  return { ok: true, result, shipId: shipId || null, sunkShip, finished };
}

module.exports = { init, place, fire, SHIPS, FLEET_CELLS, SIZE };
