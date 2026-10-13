export type Side = "red" | "blue";
export type GamePhase = "countdown" | "playing" | "goal" | "over";

export const GAME_WIDTH = 1000;
export const GAME_HEIGHT = 600;
export const FIELD = {
  left: 108,
  right: 892,
  top: 92,
  bottom: 508,
  centerX: 500,
  centerY: 300,
  goalTop: 220,
  goalBottom: 380,
} as const;

export interface BallState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface RodDefinition {
  x: number;
  count: number;
  spacing: number;
  minY: number;
  maxY: number;
}

export const RODS: Record<Side, RodDefinition[]> = {
  red: [
    { x: 158, count: 1, spacing: 0, minY: 185, maxY: 415 },
    { x: 340, count: 2, spacing: 86, minY: 180, maxY: 420 },
    { x: 535, count: 5, spacing: 57, minY: 220, maxY: 380 },
    { x: 760, count: 3, spacing: 82, minY: 195, maxY: 405 },
  ],
  blue: [
    { x: 842, count: 1, spacing: 0, minY: 185, maxY: 415 },
    { x: 660, count: 2, spacing: 86, minY: 180, maxY: 420 },
    { x: 465, count: 5, spacing: 57, minY: 220, maxY: 380 },
    { x: 240, count: 3, spacing: 82, minY: 195, maxY: 405 },
  ],
};

export interface GameSnapshot {
  ball: BallState;
  rods: Record<Side, number[]>;
  rodTargets: Record<Side, number[]>;
  rodVelocity: Record<Side, number[]>;
  score: Record<Side, number>;
  target: number;
  phase: GamePhase;
  phaseTime: number;
  elapsed: number;
  lastScorer: Side | null;
  lastEvent: "none" | "impact" | "kick" | "power" | "goal";
  eventId: number;
  kickoffCount: number;
}

export interface GameControls {
  targets?: Partial<Record<Side, number[]>>;
  speedScale?: Partial<Record<Side, number>>;
  precision?: Partial<Record<Side, boolean>>;
}

export interface ShotInput {
  rod: number;
  charge: number;
  aimY: number;
}

const BALL_RADIUS = 12;
const PLAYER_RADIUS = 22;
const FIXED_COUNTDOWN = 2.35;
const ROD_SPEED = 620;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function clampTarget(side: Side, rod: number, y: number) {
  const def = RODS[side][rod] ?? RODS[side][0];
  return clamp(y, def.minY, def.maxY);
}

export function createGame(target = 5): GameSnapshot {
  const homeY = FIELD.centerY;
  return {
    ball: { x: FIELD.centerX, y: homeY, vx: 0, vy: 0 },
    rods: { red: [homeY, homeY, homeY, homeY], blue: [homeY, homeY, homeY, homeY] },
    rodTargets: { red: [homeY, homeY, homeY, homeY], blue: [homeY, homeY, homeY, homeY] },
    rodVelocity: { red: [0, 0, 0, 0], blue: [0, 0, 0, 0] },
    score: { red: 0, blue: 0 },
    target: [3, 5, 7, 10].includes(target) ? target : 5,
    phase: "countdown",
    phaseTime: FIXED_COUNTDOWN,
    elapsed: 0,
    lastScorer: null,
    lastEvent: "none",
    eventId: 0,
    kickoffCount: 0,
  };
}

export function cloneGame(game: GameSnapshot): GameSnapshot {
  return {
    ...game,
    ball: { ...game.ball },
    score: { ...game.score },
    rods: { red: [...game.rods.red], blue: [...game.rods.blue] },
    rodTargets: { red: [...game.rodTargets.red], blue: [...game.rodTargets.blue] },
    rodVelocity: { red: [...game.rodVelocity.red], blue: [...game.rodVelocity.blue] },
  };
}

function emit(game: GameSnapshot, event: GameSnapshot["lastEvent"]) {
  game.lastEvent = event;
  game.eventId += 1;
}

function resetForKickoff(game: GameSnapshot) {
  game.ball.x = FIELD.centerX;
  game.ball.y = FIELD.centerY;
  game.ball.vx = 0;
  game.ball.vy = 0;
  for (const side of ["red", "blue"] as const) {
    game.rods[side].fill(FIELD.centerY);
    game.rodTargets[side].fill(FIELD.centerY);
    game.rodVelocity[side].fill(0);
  }
  game.phase = "countdown";
  game.phaseTime = FIXED_COUNTDOWN;
}

function beginKickoff(game: GameSnapshot) {
  game.phase = "playing";
  game.phaseTime = 0;
  game.kickoffCount += 1;
  const direction = game.kickoffCount % 2 === 1 ? 1 : -1;
  game.ball.vx = direction * 265;
  game.ball.vy = game.kickoffCount % 3 === 0 ? 85 : -58;
  emit(game, "kick");
}

function scoreGoal(game: GameSnapshot, scoringSide: Side) {
  game.score[scoringSide] += 1;
  game.lastScorer = scoringSide;
  game.ball.x = FIELD.centerX;
  game.ball.y = FIELD.centerY;
  game.ball.vx = 0;
  game.ball.vy = 0;
  game.rods.red.fill(FIELD.centerY);
  game.rods.blue.fill(FIELD.centerY);
  game.rodTargets.red.fill(FIELD.centerY);
  game.rodTargets.blue.fill(FIELD.centerY);
  game.rodVelocity.red.fill(0);
  game.rodVelocity.blue.fill(0);
  emit(game, "goal");
  if (game.score[scoringSide] >= game.target) {
    game.phase = "over";
    game.phaseTime = 0;
  } else {
    game.phase = "goal";
    game.phaseTime = 1.35;
  }
}

function capBallSpeed(ball: BallState) {
  const speed = Math.hypot(ball.vx, ball.vy);
  const limit = 1030;
  if (speed > limit) {
    ball.vx = (ball.vx / speed) * limit;
    ball.vy = (ball.vy / speed) * limit;
  }
}

function collideWithPlayers(game: GameSnapshot) {
  const ball = game.ball;
  for (const side of ["red", "blue"] as const) {
    for (let rod = 0; rod < RODS[side].length; rod += 1) {
      const def = RODS[side][rod];
      const centerY = game.rods[side][rod];
      const firstY = centerY - ((def.count - 1) * def.spacing) / 2;
      for (let player = 0; player < def.count; player += 1) {
        const playerY = firstY + player * def.spacing;
        const dx = ball.x - def.x;
        const dy = ball.y - playerY;
        const distance = Math.hypot(dx, dy);
        if (distance >= PLAYER_RADIUS + BALL_RADIUS - 1) continue;

        const nx = distance < 0.001 ? (side === "red" ? -1 : 1) : dx / distance;
        const ny = distance < 0.001 ? 0 : dy / distance;
        const overlap = PLAYER_RADIUS + BALL_RADIUS - distance + 0.7;
        ball.x += nx * overlap;
        ball.y += ny * overlap;

        const incoming = ball.vx * nx + ball.vy * ny;
        if (incoming < 0) {
          ball.vx -= 1.72 * incoming * nx;
          ball.vy -= 1.72 * incoming * ny;
        }

        const direction = side === "red" ? 1 : -1;
        const rodSpeed = game.rodVelocity[side][rod] ?? 0;
        if (Math.abs(ball.vx) < 145) ball.vx = direction * 170;
        ball.vy += (ball.y - playerY) * 0.95 + rodSpeed * 0.26;
        ball.vx += direction * Math.min(Math.abs(rodSpeed) * 0.08, 82);
        capBallSpeed(ball);
        emit(game, "impact");
        return;
      }
    }
  }
}

export function stepGame(game: GameSnapshot, deltaSeconds: number, controls: GameControls = {}) {
  const dt = clamp(deltaSeconds, 0, 0.05);
  if (dt <= 0 || game.phase === "over") return;

  for (const side of ["red", "blue"] as const) {
    const desired = controls.targets?.[side];
    const speedScale = clamp(controls.speedScale?.[side] ?? 1, 0.12, 1.2);
    const maxSpeed = (controls.precision?.[side] ? 285 : ROD_SPEED) * speedScale;
    for (let i = 0; i < RODS[side].length; i += 1) {
      if (game.phase !== "playing") {
        game.rodVelocity[side][i] = 0;
        continue;
      }
      if (desired && Number.isFinite(desired[i])) {
        game.rodTargets[side][i] = clampTarget(side, i, desired[i]);
      }
      const oldY = game.rods[side][i];
      const difference = game.rodTargets[side][i] - oldY;
      const movement = clamp(difference, -maxSpeed * dt, maxSpeed * dt);
      game.rods[side][i] = clampTarget(side, i, oldY + movement);
      game.rodVelocity[side][i] = dt > 0 ? movement / dt : 0;
    }
  }

  if (game.phase === "countdown") {
    game.phaseTime = Math.max(0, game.phaseTime - dt);
    if (game.phaseTime === 0) beginKickoff(game);
    return;
  }
  if (game.phase === "goal") {
    game.phaseTime = Math.max(0, game.phaseTime - dt);
    if (game.phaseTime === 0) resetForKickoff(game);
    return;
  }
  if (game.phase !== "playing") return;

  game.elapsed += dt;
  const ball = game.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.y < FIELD.top + BALL_RADIUS) {
    ball.y = FIELD.top + BALL_RADIUS;
    ball.vy = Math.abs(ball.vy) * 0.88;
    emit(game, "impact");
  } else if (ball.y > FIELD.bottom - BALL_RADIUS) {
    ball.y = FIELD.bottom - BALL_RADIUS;
    ball.vy = -Math.abs(ball.vy) * 0.88;
    emit(game, "impact");
  }

  const inGoalMouth = ball.y > FIELD.goalTop && ball.y < FIELD.goalBottom;
  if (ball.x < FIELD.left - BALL_RADIUS && inGoalMouth) {
    scoreGoal(game, "blue");
    return;
  }
  if (ball.x > FIELD.right + BALL_RADIUS && inGoalMouth) {
    scoreGoal(game, "red");
    return;
  }

  if (ball.x < FIELD.left + BALL_RADIUS && !inGoalMouth) {
    ball.x = FIELD.left + BALL_RADIUS;
    ball.vx = Math.abs(ball.vx) * 0.86;
    emit(game, "impact");
  } else if (ball.x > FIELD.right - BALL_RADIUS && !inGoalMouth) {
    ball.x = FIELD.right - BALL_RADIUS;
    ball.vx = -Math.abs(ball.vx) * 0.86;
    emit(game, "impact");
  }

  collideWithPlayers(game);
  const friction = Math.pow(0.998, dt * 60);
  ball.vx *= friction;
  ball.vy *= friction;
  if (Math.hypot(ball.vx, ball.vy) < 22) {
    ball.vx *= 0.96;
    ball.vy *= 0.96;
  }
}

export function fireShot(game: GameSnapshot, side: Side, input: ShotInput) {
  if (game.phase !== "playing") return false;
  const rod = Math.max(0, Math.min(RODS[side].length - 1, Math.round(input.rod)));
  const def = RODS[side][rod];
  const centerY = game.rods[side][rod];
  const firstY = centerY - ((def.count - 1) * def.spacing) / 2;
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearestPlayerY = centerY;
  for (let player = 0; player < def.count; player += 1) {
    const py = firstY + player * def.spacing;
    const distance = Math.hypot(game.ball.x - def.x, game.ball.y - py);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPlayerY = py;
    }
  }
  if (Math.abs(game.ball.x - def.x) > 66 || nearestDistance > 78) return false;

  const charge = clamp(input.charge, 0, 1);
  const direction = side === "red" ? 1 : -1;
  const aim = clamp(input.aimY, FIELD.top + 28, FIELD.bottom - 28);
  const angle = clamp((aim - game.ball.y) / 200, -0.78, 0.78);
  const rodSpeed = Math.abs(game.rodVelocity[side][rod] ?? 0);
  const speed = 400 + charge * 520 + Math.min(rodSpeed * 0.17, 105);
  game.ball.x += direction * 7;
  game.ball.vx = direction * speed * Math.cos(angle);
  game.ball.vy = speed * Math.sin(angle) + (game.ball.y - nearestPlayerY) * 0.42;
  capBallSpeed(game.ball);
  emit(game, charge > 0.67 ? "power" : "kick");
  return true;
}

export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const remainder = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}
