import {
  FIELD,
  GAME_HEIGHT,
  GAME_WIDTH,
  RODS,
  type GameSnapshot,
  type Side,
} from "@/lib/game-engine";

export type TableTheme = "clubhouse" | "arctic" | "afterhours";

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface CanvasEffects {
  particles: Particle[];
  selectedSide: Side;
  selectedRod: number;
  charge: number;
  eventFlash: number;
  shake: number;
  theme: TableTheme;
  clock: number;
}

const THEMES: Record<TableTheme, { grassA: string; grassB: string; line: string; rail: string }> = {
  clubhouse: { grassA: "#126047", grassB: "#0b4738", line: "#d7f0dc", rail: "#9d6841" },
  arctic: { grassA: "#17627a", grassB: "#0b405d", line: "#ddf5ff", rail: "#6c8594" },
  afterhours: { grassA: "#613957", grassB: "#38223f", line: "#ffe6cf", rail: "#9f5948" },
};

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawWoodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, theme: TableTheme) {
  const rail = THEMES[theme].rail;
  const grain = ctx.createLinearGradient(x, y, x + width, y + height);
  grain.addColorStop(0, theme === "clubhouse" ? "#b17a4e" : theme === "arctic" ? "#8ca7b6" : "#a96652");
  grain.addColorStop(0.22, rail);
  grain.addColorStop(0.53, theme === "clubhouse" ? "#76452f" : theme === "arctic" ? "#4e6a7b" : "#71404a");
  grain.addColorStop(0.79, theme === "clubhouse" ? "#ad7445" : theme === "arctic" ? "#8099a3" : "#a75d49");
  grain.addColorStop(1, theme === "clubhouse" ? "#68402e" : theme === "arctic" ? "#425b70" : "#643744");
  roundedRect(ctx, x, y, width, height, 29);
  ctx.fillStyle = grain;
  ctx.fill();

  ctx.save();
  roundedRect(ctx, x + 4, y + 4, width - 8, height - 8, 26);
  ctx.clip();
  for (let index = 0; index < 23; index += 1) {
    const yy = y + 12 + index * 25;
    ctx.beginPath();
    ctx.moveTo(x + 4, yy);
    ctx.bezierCurveTo(x + width * 0.23, yy - 5, x + width * 0.58, yy + 5, x + width - 4, yy - 2);
    ctx.strokeStyle = index % 3 === 0 ? "rgba(255,225,177,0.105)" : "rgba(35,13,8,0.11)";
    ctx.lineWidth = index % 4 === 0 ? 2.3 : 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawGoal(ctx: CanvasRenderingContext2D, side: Side, flash: number) {
  const left = side === "red";
  const x = left ? 38 : 890;
  const y = FIELD.goalTop - 5;
  const width = 72;
  const height = FIELD.goalBottom - FIELD.goalTop + 10;
  const gradient = ctx.createLinearGradient(left ? x : x + width, y, left ? x + width : x, y);
  gradient.addColorStop(0, "#050b12");
  gradient.addColorStop(0.72, "#111d25");
  gradient.addColorStop(1, "#213038");
  roundedRect(ctx, x, y, width, height, 12);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.save();
  roundedRect(ctx, x + 5, y + 5, width - 10, height - 10, 9);
  ctx.clip();
  ctx.strokeStyle = "rgba(206,224,223,0.23)";
  ctx.lineWidth = 1;
  for (let xx = x + 10; xx < x + width; xx += 13) {
    ctx.beginPath();
    ctx.moveTo(xx, y + 5);
    ctx.lineTo(xx, y + height - 5);
    ctx.stroke();
  }
  for (let yy = y + 8; yy < y + height; yy += 12) {
    ctx.beginPath();
    ctx.moveTo(x + 5, yy);
    ctx.lineTo(x + width - 5, yy);
    ctx.stroke();
  }
  ctx.restore();

  const teamColor = left ? "#ff5362" : "#48c9f4";
  ctx.save();
  ctx.shadowColor = teamColor;
  ctx.shadowBlur = 12 + flash * 24;
  ctx.strokeStyle = teamColor;
  ctx.globalAlpha = 0.7 + flash * 0.3;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(left ? FIELD.left : FIELD.right, FIELD.goalTop);
  ctx.lineTo(left ? FIELD.left : FIELD.right, FIELD.goalBottom);
  ctx.stroke();
  ctx.restore();
}

function drawPlayer(ctx: CanvasRenderingContext2D, x: number, y: number, side: Side, selected: boolean, clock: number) {
  const red = side === "red";
  const main = red ? "#f34f5b" : "#39bce9";
  const deep = red ? "#9d2538" : "#175dba";
  const shine = red ? "#ffb0a0" : "#a1edff";
  const facing = red ? 1 : -1;
  const bob = Math.sin(clock * 5 + x * 0.03 + y * 0.02) * 0.45;
  ctx.save();
  ctx.translate(x, y + bob);

  if (selected) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = main;
    ctx.shadowColor = main;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.ellipse(0, 1, 28, 31, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.fillStyle = "rgba(3,8,14,0.47)";
  ctx.beginPath();
  ctx.ellipse(1.5, 18, 16, 9, 0.08, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = deep;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-4, 4);
  ctx.lineTo(-8, 19);
  ctx.moveTo(5, 4);
  ctx.lineTo(8, 19);
  ctx.stroke();

  ctx.strokeStyle = main;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-8, -7);
  ctx.lineTo(-16, 3);
  ctx.moveTo(8, -7);
  ctx.lineTo(16, 3);
  ctx.stroke();

  const body = ctx.createLinearGradient(-12, -13, 14, 13);
  body.addColorStop(0, shine);
  body.addColorStop(0.25, main);
  body.addColorStop(1, deep);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-10, -11);
  ctx.quadraticCurveTo(-12, -14, -7, -15);
  ctx.lineTo(7, -15);
  ctx.quadraticCurveTo(12, -12, 10, -6);
  ctx.lineTo(8, 7);
  ctx.quadraticCurveTo(0, 12, -8, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(7,16,25,0.62)";
  ctx.lineWidth = 2.1;
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.58)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-5, -7);
  ctx.lineTo(5, -7);
  ctx.stroke();

  ctx.fillStyle = red ? "#ffd4a8" : "#c5edff";
  ctx.beginPath();
  ctx.arc(0, -19, 7.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.arc(0, -21, 8, Math.PI, 0);
  ctx.lineTo(7, -18);
  ctx.quadraticCurveTo(0, -23, -7, -18);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#101820";
  roundedRect(ctx, facing > 0 ? 4 : -16, 14, 15, 7, 3.5);
  ctx.fill();
  ctx.fillStyle = shine;
  roundedRect(ctx, facing > 0 ? 8 : -15, 14.5, 7, 2, 1);
  ctx.fill();
  ctx.restore();
}

function drawRod(ctx: CanvasRenderingContext2D, side: Side, index: number, y: number, selected: boolean) {
  const def = RODS[side][index];
  const blue = side === "blue";
  const x = def.x;
  const metal = ctx.createLinearGradient(x - 8, 0, x + 8, 0);
  metal.addColorStop(0, "#44525a");
  metal.addColorStop(0.2, "#e0e8e5");
  metal.addColorStop(0.45, "#65757a");
  metal.addColorStop(0.72, "#f1f3e9");
  metal.addColorStop(1, "#39444c");
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.42)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetX = blue ? -2 : 2;
  roundedRect(ctx, x - 4.5, 54, 9, 492, 4.5);
  ctx.fillStyle = metal;
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = blue ? "#182a3a" : "#321e25";
  roundedRect(ctx, x - 8, 57, 16, 12, 4);
  ctx.fill();
  roundedRect(ctx, x - 8, 531, 16, 12, 4);
  ctx.fill();

  const handleGradient = ctx.createLinearGradient(0, 65, 0, 90);
  handleGradient.addColorStop(0, blue ? "#244b73" : "#6f2931");
  handleGradient.addColorStop(0.5, blue ? "#44b8d5" : "#ed5360");
  handleGradient.addColorStop(1, blue ? "#17344f" : "#782735");
  roundedRect(ctx, x - 9, 62, 18, 24, 7);
  ctx.fillStyle = handleGradient;
  ctx.fill();

  if (selected) {
    ctx.save();
    ctx.shadowColor = blue ? "#6ee3ff" : "#ff7b6f";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = blue ? "rgba(99,222,255,0.8)" : "rgba(255,117,109,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 81);
    ctx.lineTo(x, 523);
    ctx.stroke();
    ctx.restore();
  }
}

function drawBall(ctx: CanvasRenderingContext2D, game: GameSnapshot) {
  const { x, y, vx, vy } = game.ball;
  const speed = Math.hypot(vx, vy);
  if (speed > 120) {
    const tail = Math.min(45, speed * 0.065);
    const gradient = ctx.createLinearGradient(x - (vx / speed) * tail, y - (vy / speed) * tail, x, y);
    gradient.addColorStop(0, "rgba(231,248,231,0)");
    gradient.addColorStop(1, "rgba(243,255,244,0.38)");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x - (vx / speed) * tail, y - (vy / speed) * tail);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  ctx.save();
  ctx.shadowColor = "rgba(1,7,10,0.68)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 7;
  const ballGradient = ctx.createRadialGradient(x - 5, y - 6, 1, x, y, 14);
  ballGradient.addColorStop(0, "#ffffff");
  ballGradient.addColorStop(0.66, "#f0f3e7");
  ballGradient.addColorStop(1, "#99a9a5");
  ctx.fillStyle = ballGradient;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 11.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(x, y);
  ctx.rotate((game.elapsed * 2.8) % (Math.PI * 2));
  ctx.fillStyle = "#20313c";
  ctx.beginPath();
  for (let index = 0; index < 5; index += 1) {
    const angle = (Math.PI * 2 * index) / 5 - Math.PI / 2;
    const px = Math.cos(angle) * 4.1;
    const py = Math.sin(angle) * 4.1;
    if (index === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  for (let index = 0; index < 5; index += 1) {
    const angle = (Math.PI * 2 * index) / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * 8, Math.sin(angle) * 8, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.arc(x - 4, y - 5, 2, 0, Math.PI * 2);
  ctx.fill();
}

function drawFieldMarkings(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.strokeStyle = "rgba(232,249,229,0.47)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeRect(FIELD.left, FIELD.top, FIELD.right - FIELD.left, FIELD.bottom - FIELD.top);
  ctx.beginPath();
  ctx.moveTo(FIELD.centerX, FIELD.top);
  ctx.lineTo(FIELD.centerX, FIELD.bottom);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(FIELD.centerX, FIELD.centerY, 63, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(236,248,227,0.52)";
  ctx.beginPath();
  ctx.arc(FIELD.centerX, FIELD.centerY, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeRect(FIELD.left, FIELD.centerY - 104, 56, 208);
  ctx.strokeRect(FIELD.right - 56, FIELD.centerY - 104, 56, 208);
  ctx.strokeRect(FIELD.left, FIELD.centerY - 62, 24, 124);
  ctx.strokeRect(FIELD.right - 24, FIELD.centerY - 62, 24, 124);
  ctx.beginPath();
  ctx.arc(FIELD.left + 60, FIELD.centerY, 2.5, 0, Math.PI * 2);
  ctx.arc(FIELD.right - 60, FIELD.centerY, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawFoosballCanvas(ctx: CanvasRenderingContext2D, game: GameSnapshot, effects: CanvasEffects) {
  const theme = THEMES[effects.theme];
  ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  const shakeX = effects.shake > 0 ? Math.sin(effects.clock * 74) * effects.shake : 0;
  const shakeY = effects.shake > 0 ? Math.cos(effects.clock * 91) * effects.shake * 0.62 : 0;
  ctx.save();
  ctx.translate(shakeX, shakeY);

  const floor = ctx.createLinearGradient(0, 0, GAME_WIDTH, GAME_HEIGHT);
  floor.addColorStop(0, "#14232b");
  floor.addColorStop(0.55, "#101b22");
  floor.addColorStop(1, "#0a121a");
  ctx.fillStyle = floor;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
  const tableGlow = ctx.createRadialGradient(500, 290, 80, 500, 300, 580);
  tableGlow.addColorStop(0, "rgba(127,168,142,0.12)");
  tableGlow.addColorStop(1, "rgba(9,16,23,0)");
  ctx.fillStyle = tableGlow;
  ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.78)";
  ctx.shadowBlur = 34;
  ctx.shadowOffsetY = 19;
  roundedRect(ctx, 46, 23, 908, 552, 38);
  ctx.fillStyle = "#332219";
  ctx.fill();
  ctx.restore();

  drawWoodGrain(ctx, 46, 22, 908, 550, effects.theme);
  roundedRect(ctx, 58, 34, 884, 526, 31);
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,226,183,0.24)";
  ctx.stroke();

  for (const side of ["red", "blue"] as const) drawGoal(ctx, side, effects.eventFlash);

  const fieldGradient = ctx.createLinearGradient(100, 80, 900, 520);
  fieldGradient.addColorStop(0, theme.grassA);
  fieldGradient.addColorStop(0.52, theme.grassB);
  fieldGradient.addColorStop(1, theme.grassA);
  roundedRect(ctx, 84, 74, 832, 452, 25);
  ctx.fillStyle = fieldGradient;
  ctx.fill();
  ctx.save();
  roundedRect(ctx, 84, 74, 832, 452, 25);
  ctx.clip();
  for (let index = 0; index < 10; index += 1) {
    ctx.fillStyle = index % 2 === 0 ? "rgba(226,255,215,0.035)" : "rgba(3,27,22,0.055)";
    ctx.fillRect(95 + index * 82, 76, 41, 448);
  }
  const light = ctx.createLinearGradient(90, 72, 650, 430);
  light.addColorStop(0, "rgba(255,255,255,0.10)");
  light.addColorStop(0.42, "rgba(255,255,255,0.025)");
  light.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = light;
  ctx.fillRect(86, 74, 830, 452);
  ctx.restore();

  drawFieldMarkings(ctx);
  drawGoal(ctx, "red", effects.eventFlash);
  drawGoal(ctx, "blue", effects.eventFlash);

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#ebf4da";
  ctx.font = "800 10px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("KICKOFF CLUB  •  EST. 2024", 500, 88);
  ctx.restore();

  for (const side of ["red", "blue"] as const) {
    for (let index = 0; index < RODS[side].length; index += 1) {
      const selected = side === effects.selectedSide && index === effects.selectedRod;
      drawRod(ctx, side, index, game.rods[side][index], selected);
      const def = RODS[side][index];
      const start = game.rods[side][index] - ((def.count - 1) * def.spacing) / 2;
      for (let player = 0; player < def.count; player += 1) {
        drawPlayer(ctx, def.x, start + player * def.spacing, side, selected, effects.clock);
      }
    }
  }

  drawBall(ctx, game);

  if (effects.charge > 0.025 && game.phase === "playing") {
    const chargeColor = effects.selectedSide === "red" ? "#ff7168" : "#61ddff";
    const radius = 18 + effects.charge * 17;
    ctx.save();
    ctx.strokeStyle = chargeColor;
    ctx.globalAlpha = 0.24 + effects.charge * 0.64;
    ctx.lineWidth = 2 + effects.charge * 2;
    ctx.shadowColor = chargeColor;
    ctx.shadowBlur = 8 + effects.charge * 16;
    ctx.beginPath();
    ctx.arc(game.ball.x, game.ball.y, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * effects.charge);
    ctx.stroke();
    ctx.restore();
  }

  if (effects.eventFlash > 0) {
    ctx.save();
    const color = game.lastScorer === "red" ? "#ff5f6d" : "#52d5ff";
    const flare = ctx.createRadialGradient(game.ball.x, game.ball.y, 12, game.ball.x, game.ball.y, 250);
    flare.addColorStop(0, `${color}28`);
    flare.addColorStop(1, `${color}00`);
    ctx.fillStyle = flare;
    ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    ctx.restore();
  }

  for (const particle of effects.particles) {
    const alpha = Math.max(0, particle.life / particle.maxLife);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.shadowColor = particle.color;
    ctx.shadowBlur = particle.size * 2;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (0.35 + alpha * 0.65), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

export function createImpactParticles(x: number, y: number, color: string, count: number, seed = 0): Particle[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = ((index + seed * 0.37) / count) * Math.PI * 2 + Math.sin(index * 14.3 + seed) * 0.18;
    const speed = 55 + ((index * 37 + seed * 11) % 115);
    const life = 0.32 + ((index * 17 + seed * 5) % 34) / 100;
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      color,
      size: 1.8 + ((index * 13 + seed) % 30) / 10,
    };
  });
}
