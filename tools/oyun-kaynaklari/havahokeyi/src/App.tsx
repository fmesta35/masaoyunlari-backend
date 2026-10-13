import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

type PlayerIndex = 0 | 1;
type ViewState = "menu" | "playing" | "paused" | "gameover";

type ColorOption = {
  name: string;
  value: string;
};

type MatchSettings = {
  playerOne: string;
  playerTwo: string;
  playerOneColor: string;
  playerTwoColor: string;
  puckColor: string;
  goalsToWin: number;
  maxSets: number;
};

type MatchScore = {
  goals: [number, number];
  sets: [number, number];
  lastScorer: PlayerIndex | null;
};

type RecordItem = {
  id: string;
  winner: string;
  result: string;
  points: number;
  duration: number;
  date: string;
};

type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
};

export type Mallet = Body & {
  cooldown: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
};

type PointerTarget = {
  id: number;
  x: number;
  y: number;
};

type GameData = {
  puck: Body;
  mallets: [Mallet, Mallet];
  particles: Particle[];
  trail: { x: number; y: number }[];
  keys: Set<string>;
  pointers: [PointerTarget | null, PointerTarget | null];
  countdown: number;
  countdownTick: number;
  serveDirection: number;
  accumulator: number;
  lastTime: number;
  elapsed: number;
  shake: number;
  flash: number;
  flashSide: PlayerIndex;
  banner: string;
  bannerTime: number;
  scoringLocked: boolean;
  pendingWinner: PlayerIndex | null;
  endTimer: number;
  wallCooldown: number;
  slowTime: number;
};

export const TABLE_WIDTH = 1000;
export const TABLE_HEIGHT = 600;
export const CENTER_X = TABLE_WIDTH / 2;
export const CENTER_Y = TABLE_HEIGHT / 2;
export const FIELD_LEFT = 48;
export const FIELD_RIGHT = TABLE_WIDTH - FIELD_LEFT;
export const FIELD_TOP = 48;
export const FIELD_BOTTOM = TABLE_HEIGHT - FIELD_TOP;
export const GOAL_TOP = 205;
export const GOAL_BOTTOM = 395;
const POST_RADIUS = 13;
export const PUCK_RADIUS = 20;
export const MALLET_RADIUS = 43;
const FIXED_STEP = 1 / 120;
const RECORDS_KEY = "neon-rink-records-v1";

export const COLOR_OPTIONS: ColorOption[] = [
  { name: "Buz mavisi", value: "#38bdf8" },
  { name: "Elektrik", value: "#22d3ee" },
  { name: "Nane", value: "#34d399" },
  { name: "Asit yeşili", value: "#a3e635" },
  { name: "Solar", value: "#facc15" },
  { name: "Turuncu", value: "#fb923c" },
  { name: "Koral", value: "#fb4d6d" },
  { name: "Pembe", value: "#f472b6" },
  { name: "Magenta", value: "#d946ef" },
  { name: "Mor", value: "#8b5cf6" },
  { name: "İndigo", value: "#6366f1" },
  { name: "Beyaz", value: "#f8fafc" },
  { name: "Titanyum", value: "#94a3b8" },
  { name: "Karbon", value: "#111827" },
];

const DEFAULT_SETTINGS: MatchSettings = {
  playerOne: "Oyuncu 1",
  playerTwo: "Oyuncu 2",
  playerOneColor: "#22d3ee",
  playerTwoColor: "#fb4d6d",
  puckColor: "#f8fafc",
  goalsToWin: 5,
  maxSets: 3,
};

function makeGame(): GameData {
  return {
    puck: { x: CENTER_X, y: CENTER_Y, vx: 0, vy: 0, radius: PUCK_RADIUS },
    mallets: [
      { x: 250, y: CENTER_Y, vx: 0, vy: 0, radius: MALLET_RADIUS, cooldown: 0 },
      { x: 750, y: CENTER_Y, vx: 0, vy: 0, radius: MALLET_RADIUS, cooldown: 0 },
    ],
    particles: [],
    trail: [],
    keys: new Set<string>(),
    pointers: [null, null],
    countdown: 3.2,
    countdownTick: -1,
    serveDirection: Math.random() > 0.5 ? 1 : -1,
    accumulator: 0,
    lastTime: performance.now(),
    elapsed: 0,
    shake: 0,
    flash: 0,
    flashSide: 0,
    banner: "FACE OFF",
    bannerTime: 0.65,
    scoringLocked: true,
    pendingWinner: null,
    endTimer: 0,
    wallCooldown: 0,
    slowTime: 0,
  };
}

function safeRecords(): RecordItem[] {
  try {
    const value = localStorage.getItem(RECORDS_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as RecordItem[];
    return Array.isArray(parsed) ? parsed.slice(0, 8) : [];
  } catch {
    return [];
  }
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function rgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized, 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function mixColor(hex: string, amount: number) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  const target = amount < 0 ? 0 : 255;
  const ratio = Math.abs(amount);
  const red = Math.round(((value >> 16) & 255) * (1 - ratio) + target * ratio);
  const green = Math.round(((value >> 8) & 255) * (1 - ratio) + target * ratio);
  const blue = Math.round((value & 255) * (1 - ratio) + target * ratio);
  return `rgb(${red}, ${green}, ${blue})`;
}

export function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export function makeRinkCanvas(leftColor = "#22d3ee", rightColor = "#fb4d6d", labels = true) {
  const canvas = document.createElement("canvas");
  canvas.width = TABLE_WIDTH;
  canvas.height = TABLE_HEIGHT;
  const context = canvas.getContext("2d")!;

  const frame = context.createLinearGradient(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
  frame.addColorStop(0, "#111c31");
  frame.addColorStop(0.48, "#030711");
  frame.addColorStop(1, "#172033");
  roundedRect(context, 1, 1, TABLE_WIDTH - 2, TABLE_HEIGHT - 2, 42);
  context.fillStyle = frame;
  context.fill();

  context.save();
  roundedRect(context, 28, 28, TABLE_WIDTH - 56, TABLE_HEIGHT - 56, 24);
  context.clip();
  const ice = context.createLinearGradient(0, FIELD_TOP, 0, FIELD_BOTTOM);
  ice.addColorStop(0, "#10243a");
  ice.addColorStop(0.5, "#071725");
  ice.addColorStop(1, "#0d2135");
  context.fillStyle = ice;
  context.fillRect(28, 28, TABLE_WIDTH - 56, TABLE_HEIGHT - 56);

  context.strokeStyle = "rgba(121, 209, 234, 0.04)";
  context.lineWidth = 1;
  for (let x = 48; x <= 952; x += 32) {
    context.beginPath();
    context.moveTo(x, FIELD_TOP);
    context.lineTo(x, FIELD_BOTTOM);
    context.stroke();
  }
  for (let y = 52; y <= 548; y += 32) {
    context.beginPath();
    context.moveTo(FIELD_LEFT, y);
    context.lineTo(FIELD_RIGHT, y);
    context.stroke();
  }

  const leftGlow = context.createRadialGradient(120, CENTER_Y, 20, 120, CENTER_Y, 330);
  leftGlow.addColorStop(0, rgba(leftColor, 0.09));
  leftGlow.addColorStop(1, rgba(leftColor, 0));
  context.fillStyle = leftGlow;
  context.fillRect(28, 28, TABLE_WIDTH / 2, TABLE_HEIGHT - 56);
  const rightGlow = context.createRadialGradient(880, CENTER_Y, 20, 880, CENTER_Y, 330);
  rightGlow.addColorStop(0, rgba(rightColor, 0.08));
  rightGlow.addColorStop(1, rgba(rightColor, 0));
  context.fillStyle = rightGlow;
  context.fillRect(TABLE_WIDTH / 2, 28, TABLE_WIDTH / 2, TABLE_HEIGHT - 56);
  context.restore();

  for (const side of [0, 1] as const) {
    const x = side === 0 ? 5 : FIELD_RIGHT;
    const width = FIELD_LEFT - 5;
    context.save();
    context.fillStyle = rgba(side === 0 ? leftColor : rightColor, 0.13);
    context.fillRect(x, GOAL_TOP, width, GOAL_BOTTOM - GOAL_TOP);
    context.strokeStyle = rgba(side === 0 ? leftColor : rightColor, 0.24);
    context.lineWidth = 2;
    for (let y = GOAL_TOP + 18; y < GOAL_BOTTOM; y += 22) {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + width, y + 12);
      context.stroke();
    }
    context.restore();
  }

  context.strokeStyle = "rgba(219, 248, 255, 0.14)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(CENTER_X, FIELD_TOP + 5);
  context.lineTo(CENTER_X, FIELD_BOTTOM - 5);
  context.stroke();
  context.beginPath();
  context.arc(CENTER_X, CENTER_Y, 92, 0, Math.PI * 2);
  context.strokeStyle = "rgba(219, 248, 255, 0.13)";
  context.stroke();
  context.beginPath();
  context.arc(CENTER_X, CENTER_Y, 7, 0, Math.PI * 2);
  context.fillStyle = "rgba(219, 248, 255, 0.25)";
  context.fill();

  if (labels) {
  context.font = "700 18px Arial, sans-serif";
  context.letterSpacing = "5px";
  context.textAlign = "center";
  context.fillStyle = "rgba(207, 247, 255, 0.10)";
  context.fillText("NEON RINK // 02", CENTER_X, FIELD_BOTTOM - 32);
  context.font = "700 14px Arial, sans-serif";
  context.fillStyle = "rgba(207, 247, 255, 0.16)";
  context.fillText("W A S D", 180, FIELD_BOTTOM - 34);
  context.fillText("OK TUŞLARI", 820, FIELD_BOTTOM - 34);

  }

  context.lineCap = "round";
  context.strokeStyle = "rgba(179, 231, 244, 0.42)";
  context.lineWidth = 9;
  context.beginPath();
  context.moveTo(FIELD_LEFT, GOAL_TOP);
  context.lineTo(FIELD_LEFT, FIELD_TOP + 16);
  context.quadraticCurveTo(FIELD_LEFT, FIELD_TOP, FIELD_LEFT + 16, FIELD_TOP);
  context.lineTo(FIELD_RIGHT - 16, FIELD_TOP);
  context.quadraticCurveTo(FIELD_RIGHT, FIELD_TOP, FIELD_RIGHT, FIELD_TOP + 16);
  context.lineTo(FIELD_RIGHT, GOAL_TOP);
  context.moveTo(FIELD_RIGHT, GOAL_BOTTOM);
  context.lineTo(FIELD_RIGHT, FIELD_BOTTOM - 16);
  context.quadraticCurveTo(FIELD_RIGHT, FIELD_BOTTOM, FIELD_RIGHT - 16, FIELD_BOTTOM);
  context.lineTo(FIELD_LEFT + 16, FIELD_BOTTOM);
  context.quadraticCurveTo(FIELD_LEFT, FIELD_BOTTOM, FIELD_LEFT, FIELD_BOTTOM - 16);
  context.lineTo(FIELD_LEFT, GOAL_BOTTOM);
  context.stroke();

  for (const x of [FIELD_LEFT, FIELD_RIGHT]) {
    for (const y of [GOAL_TOP, GOAL_BOTTOM]) {
      const post = context.createRadialGradient(x - 4, y - 5, 2, x, y, POST_RADIUS);
      post.addColorStop(0, "#ffffff");
      post.addColorStop(0.25, "#93c5fd");
      post.addColorStop(1, "#1f3a55");
      context.beginPath();
      context.arc(x, y, POST_RADIUS, 0, Math.PI * 2);
      context.fillStyle = post;
      context.fill();
    }
  }
  return canvas;
}

export function drawMallet(context: CanvasRenderingContext2D, mallet: Mallet, color: string) {
  context.save();
  context.shadowColor = rgba(color, 0.65);
  context.shadowBlur = 24;
  context.beginPath();
  context.arc(mallet.x, mallet.y, mallet.radius + 3, 0, Math.PI * 2);
  context.fillStyle = "rgba(0, 0, 0, 0.5)";
  context.fill();
  context.shadowBlur = 0;
  const body = context.createRadialGradient(mallet.x - 14, mallet.y - 16, 4, mallet.x, mallet.y, mallet.radius);
  body.addColorStop(0, mixColor(color, 0.7));
  body.addColorStop(0.28, color);
  body.addColorStop(1, mixColor(color, -0.72));
  context.beginPath();
  context.arc(mallet.x, mallet.y, mallet.radius, 0, Math.PI * 2);
  context.fillStyle = body;
  context.fill();
  context.strokeStyle = rgba(color, 0.9);
  context.lineWidth = 3;
  context.stroke();
  context.beginPath();
  context.arc(mallet.x, mallet.y, mallet.radius * 0.53, 0, Math.PI * 2);
  context.fillStyle = mixColor(color, -0.42);
  context.fill();
  context.strokeStyle = rgba("#ffffff", 0.18);
  context.lineWidth = 2;
  context.stroke();
  context.beginPath();
  context.arc(mallet.x - 7, mallet.y - 8, mallet.radius * 0.2, 0, Math.PI * 2);
  context.fillStyle = rgba("#ffffff", 0.21);
  context.fill();
  context.restore();
}

export function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="color-picker">
      <div className="setting-label">
        <span>{label}</span>
        <span className="selected-color-name">{COLOR_OPTIONS.find((option) => option.value === value)?.name}</span>
      </div>
      <div className="swatch-grid" role="radiogroup" aria-label={`${label} renk seçimi`}>
        {COLOR_OPTIONS.map((option) => (
          <button
            type="button"
            className={`color-swatch ${value === option.value ? "is-selected" : ""}`}
            style={{ "--swatch": option.value } as CSSProperties}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            aria-checked={value === option.value}
            aria-label={option.name}
            title={option.name}
          />
        ))}
      </div>
    </div>
  );
}

export function SoundIcon({ muted = false }: { muted?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      {muted ? <path d="m17 9 4 4m0-4-4 4" /> : <path d="M17 8c1.6 1.4 1.6 6.6 0 8m2.5-11c3.3 3 3.3 11 0 14" />}
    </svg>
  );
}

function PauseIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>;
}

export default function App() {
  const [view, setView] = useState<ViewState>("menu");
  const [menuTab, setMenuTab] = useState<"setup" | "records">("setup");
  const [settings, setSettings] = useState<MatchSettings>(DEFAULT_SETTINGS);
  const [score, setScore] = useState<MatchScore>({ goals: [0, 0], sets: [0, 0], lastScorer: null });
  const [records, setRecords] = useState<RecordItem[]>(safeRecords);
  const [soundOn, setSoundOn] = useState(true);
  const [finalResult, setFinalResult] = useState<{
    winner: PlayerIndex;
    sets: [number, number];
    duration: number;
    points: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<GameData>(makeGame());
  const viewRef = useRef<ViewState>(view);
  const settingsRef = useRef(settings);
  const scoreRef = useRef(score);
  const soundOnRef = useRef(soundOn);
  const audioRef = useRef<AudioContext | null>(null);

  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  const patchSettings = <K extends keyof MatchSettings>(key: K, value: MatchSettings[K]) => {
    setSettings((current) => {
      const next = { ...current, [key]: value };
      settingsRef.current = next;
      return next;
    });
  };

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const AudioConstructor = window.AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioConstructor) audioRef.current = new AudioConstructor();
    }
    if (audioRef.current?.state === "suspended") void audioRef.current.resume();
  }, []);

  const playSound = useCallback((kind: "hit" | "wall" | "goal" | "tick" | "start", power = 1) => {
    if (!soundOnRef.current) return;
    ensureAudio();
    const audio = audioRef.current;
    if (!audio) return;
    const tone = (
      frequency: number,
      duration: number,
      volume: number,
      delay = 0,
      type: OscillatorType = "sine",
      endFrequency?: number,
    ) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime + delay;
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    };
    if (kind === "hit") {
      tone(150 + power * 110, 0.075, 0.055, 0, "triangle", 80);
      tone(640 + power * 140, 0.035, 0.022, 0, "square", 300);
    } else if (kind === "wall") {
      tone(125, 0.04, 0.025, 0, "triangle", 72);
    } else if (kind === "tick") {
      tone(440, 0.07, 0.035, 0, "sine", 520);
    } else if (kind === "start") {
      tone(520, 0.08, 0.045, 0, "square", 660);
      tone(780, 0.13, 0.05, 0.08, "square", 980);
    } else {
      tone(196, 0.23, 0.065, 0, "sawtooth", 392);
      tone(523, 0.18, 0.05, 0.08, "square", 784);
      tone(784, 0.32, 0.055, 0.19, "sine", 1046);
    }
  }, [ensureAudio]);

  const finishMatch = useCallback((winner: PlayerIndex) => {
    const currentScore = scoreRef.current;
    const game = gameRef.current;
    const currentSettings = settingsRef.current;
    const winnerName = winner === 0 ? currentSettings.playerOne : currentSettings.playerTwo;
    const setDifference = Math.abs(currentScore.sets[0] - currentScore.sets[1]);
    const points = Math.max(100, currentScore.sets[winner] * 1000 + setDifference * 250
      + Math.round(Math.max(0, 900 - game.elapsed * 3)));
    const record: RecordItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      winner: winnerName,
      result: `${currentScore.sets[0]} - ${currentScore.sets[1]}`,
      points,
      duration: game.elapsed,
      date: new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "short" }).format(new Date()),
    };
    setRecords((current) => {
      const next = [...current, record].sort((a, b) => b.points - a.points).slice(0, 8);
      try {
        localStorage.setItem(RECORDS_KEY, JSON.stringify(next));
      } catch {
        // The match still completes when private browsing blocks local storage.
      }
      return next;
    });
    setFinalResult({ winner, sets: [...currentScore.sets] as [number, number], duration: game.elapsed, points });
    game.keys.clear();
    game.pointers = [null, null];
    viewRef.current = "gameover";
    setView("gameover");
  }, []);

  const registerGoal = useCallback((scorer: PlayerIndex) => {
    const game = gameRef.current;
    if (game.scoringLocked) return;
    game.scoringLocked = true;
    game.flash = 1;
    game.flashSide = scorer;
    game.shake = 17;
    game.puck.vx = 0;
    game.puck.vy = 0;
    game.trail = [];
    const currentSettings = settingsRef.current;
    const scorerColor = scorer === 0 ? currentSettings.playerOneColor : currentSettings.playerTwoColor;
    const goalX = scorer === 0 ? FIELD_RIGHT : FIELD_LEFT;
    for (let index = 0; index < 58; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 130 + Math.random() * 620;
      game.particles.push({
        x: goalX,
        y: CENTER_Y + (Math.random() - 0.5) * 130,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.45 + Math.random() * 0.65,
        maxLife: 1.1,
        size: 2 + Math.random() * 7,
        color: index % 4 === 0 ? "#ffffff" : scorerColor,
      });
    }
    playSound("goal");

    const previous = scoreRef.current;
    const goals: [number, number] = [...previous.goals] as [number, number];
    const sets: [number, number] = [...previous.sets] as [number, number];
    goals[scorer] += 1;
    let setWon = false;
    if (goals[scorer] >= currentSettings.goalsToWin) {
      sets[scorer] += 1;
      setWon = true;
    }
    const winsNeeded = Math.ceil(currentSettings.maxSets / 2);
    const matchWon = sets[scorer] >= winsNeeded;
    const nextScore: MatchScore = { goals, sets, lastScorer: scorer };
    scoreRef.current = nextScore;
    setScore(nextScore);
    const scorerName = scorer === 0 ? currentSettings.playerOne : currentSettings.playerTwo;
    game.banner = matchWon ? `${scorerName} KAZANDI` : setWon ? `${scorerName} SETİ ALDI` : `${scorerName} GOL!`;
    game.bannerTime = matchWon ? 1.4 : setWon ? 1.25 : 0.9;

    if (matchWon) {
      game.pendingWinner = scorer;
      game.endTimer = 1.45;
      return;
    }
    if (setWon) {
      const resetScore: MatchScore = { goals: [0, 0], sets, lastScorer: scorer };
      scoreRef.current = resetScore;
      setScore(resetScore);
    }
    game.puck.x = CENTER_X;
    game.puck.y = CENTER_Y;
    game.countdown = setWon ? 2.8 : 2.15;
    game.countdownTick = -1;
    game.serveDirection = scorer === 0 ? -1 : 1;
  }, [playSound]);

  const startMatch = useCallback(() => {
    ensureAudio();
    const currentSettings = settingsRef.current;
    if (!currentSettings.playerOne.trim() || !currentSettings.playerTwo.trim()) {
      const next = {
        ...currentSettings,
        playerOne: currentSettings.playerOne.trim() || "Oyuncu 1",
        playerTwo: currentSettings.playerTwo.trim() || "Oyuncu 2",
      };
      settingsRef.current = next;
      setSettings(next);
    }
    gameRef.current = makeGame();
    const emptyScore: MatchScore = { goals: [0, 0], sets: [0, 0], lastScorer: null };
    scoreRef.current = emptyScore;
    setScore(emptyScore);
    setFinalResult(null);
    viewRef.current = "playing";
    setView("playing");
  }, [ensureAudio]);

  const pauseMatch = useCallback(() => {
    if (viewRef.current !== "playing") return;
    gameRef.current.keys.clear();
    viewRef.current = "paused";
    setView("paused");
  }, []);

  const resumeMatch = useCallback(() => {
    if (viewRef.current !== "paused") return;
    ensureAudio();
    gameRef.current.lastTime = performance.now();
    viewRef.current = "playing";
    setView("playing");
  }, [ensureAudio]);

  const returnToMenu = useCallback(() => {
    gameRef.current.keys.clear();
    gameRef.current.pointers = [null, null];
    viewRef.current = "menu";
    setMenuTab("setup");
    setView("menu");
  }, []);

  useEffect(() => {
    const controlledKeys = new Set([
      "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ]);
    const onKeyDown = (event: KeyboardEvent) => {
      if (controlledKeys.has(event.code) && viewRef.current === "playing") {
        event.preventDefault();
        gameRef.current.keys.add(event.code);
      }
      if (event.repeat) return;
      if (event.code === "Escape" || event.code === "KeyP") {
        if (viewRef.current === "playing") pauseMatch();
        else if (viewRef.current === "paused") resumeMatch();
      }
      if ((event.code === "Enter" || event.code === "KeyR") && viewRef.current === "gameover") startMatch();
    };
    const onKeyUp = (event: KeyboardEvent) => gameRef.current.keys.delete(event.code);
    const onBlur = () => gameRef.current.keys.clear();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [pauseMatch, resumeMatch, startMatch]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const rinkCanvas = makeRinkCanvas();
    let animationFrame = 0;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const nextWidth = Math.max(1, Math.round(bounds.width * pixelRatio));
      const nextHeight = Math.max(1, Math.round(bounds.height * pixelRatio));
      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const spawnImpact = (x: number, y: number, color: string, nx: number, ny: number, power: number) => {
      const game = gameRef.current;
      const count = Math.min(13, 4 + Math.floor(power * 8));
      for (let index = 0; index < count; index += 1) {
        const angle = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.2;
        const speed = 80 + Math.random() * 280 * power;
        game.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.18 + Math.random() * 0.24,
          maxLife: 0.42,
          size: 1.5 + Math.random() * 4,
          color,
        });
      }
    };

    const constrainMallet = (mallet: Mallet, player: PlayerIndex) => {
      const innerPadding = 7;
      const minX = player === 0 ? FIELD_LEFT + mallet.radius + innerPadding : CENTER_X + mallet.radius + 8;
      const maxX = player === 0 ? CENTER_X - mallet.radius - 8 : FIELD_RIGHT - mallet.radius - innerPadding;
      const minY = FIELD_TOP + mallet.radius + innerPadding;
      const maxY = FIELD_BOTTOM - mallet.radius - innerPadding;
      mallet.x = Math.max(minX, Math.min(maxX, mallet.x));
      mallet.y = Math.max(minY, Math.min(maxY, mallet.y));
    };

    const moveMallet = (mallet: Mallet, player: PlayerIndex, dt: number) => {
      const game = gameRef.current;
      const pointer = game.pointers[player];
      const previousX = mallet.x;
      const previousY = mallet.y;
      if (pointer) {
        const deltaX = pointer.x - mallet.x;
        const deltaY = pointer.y - mallet.y;
        const distance = Math.hypot(deltaX, deltaY);
        const move = Math.min(distance, 1120 * dt);
        if (distance > 0.001) {
          mallet.x += (deltaX / distance) * move;
          mallet.y += (deltaY / distance) * move;
        }
      } else {
        const keys = game.keys;
        const horizontal = player === 0
          ? Number(keys.has("KeyD")) - Number(keys.has("KeyA"))
          : Number(keys.has("ArrowRight")) - Number(keys.has("ArrowLeft"));
        const vertical = player === 0
          ? Number(keys.has("KeyS")) - Number(keys.has("KeyW"))
          : Number(keys.has("ArrowDown")) - Number(keys.has("ArrowUp"));
        const magnitude = Math.hypot(horizontal, vertical);
        if (magnitude > 0) {
          mallet.x += (horizontal / magnitude) * 710 * dt;
          mallet.y += (vertical / magnitude) * 710 * dt;
        }
      }
      constrainMallet(mallet, player);
      mallet.vx = (mallet.x - previousX) / dt;
      mallet.vy = (mallet.y - previousY) / dt;
      if (!pointer && Math.abs(mallet.vx) < 0.01 && Math.abs(mallet.vy) < 0.01) {
        mallet.vx = 0;
        mallet.vy = 0;
      }
    };

    const collideWithMallet = (mallet: Mallet, color: string) => {
      const game = gameRef.current;
      const puck = game.puck;
      const dx = puck.x - mallet.x;
      const dy = puck.y - mallet.y;
      const minDistance = puck.radius + mallet.radius;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= minDistance * minDistance) return;
      const distance = Math.sqrt(distanceSquared) || 0.001;
      const nx = dx / distance;
      const ny = dy / distance;
      puck.x = mallet.x + nx * (minDistance + 0.6);
      puck.y = mallet.y + ny * (minDistance + 0.6);
      const relativeX = puck.vx - mallet.vx;
      const relativeY = puck.vy - mallet.vy;
      const relativeNormal = relativeX * nx + relativeY * ny;
      const impact = Math.max(90, Math.abs(relativeNormal));
      if (relativeNormal < 0) {
        const impulse = -(1.08 + 1) * relativeNormal;
        puck.vx += impulse * nx;
        puck.vy += impulse * ny;
      } else {
        const malletNormal = mallet.vx * nx + mallet.vy * ny;
        if (malletNormal > 0) {
          puck.vx += malletNormal * nx * 0.62;
          puck.vy += malletNormal * ny * 0.62;
        }
      }
      const tangentX = -ny;
      const tangentY = nx;
      const tangentVelocity = mallet.vx * tangentX + mallet.vy * tangentY;
      puck.vx += tangentX * tangentVelocity * 0.075;
      puck.vy += tangentY * tangentVelocity * 0.075;
      const speed = Math.hypot(puck.vx, puck.vy);
      if (speed > 1450) {
        puck.vx = (puck.vx / speed) * 1450;
        puck.vy = (puck.vy / speed) * 1450;
      }
      if (mallet.cooldown <= 0) {
        const power = Math.min(1, impact / 850);
        game.shake = Math.max(game.shake, 2.5 + power * 5);
        spawnImpact(puck.x - nx * puck.radius, puck.y - ny * puck.radius, color, nx, ny, power);
        playSound("hit", power);
        mallet.cooldown = 0.055;
      }
    };

    const collideWithPost = (x: number, y: number) => {
      const game = gameRef.current;
      const puck = game.puck;
      const dx = puck.x - x;
      const dy = puck.y - y;
      const minDistance = puck.radius + POST_RADIUS;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared >= minDistance * minDistance) return;
      const distance = Math.sqrt(distanceSquared) || 0.001;
      const nx = dx / distance;
      const ny = dy / distance;
      puck.x = x + nx * (minDistance + 0.4);
      puck.y = y + ny * (minDistance + 0.4);
      const normalVelocity = puck.vx * nx + puck.vy * ny;
      if (normalVelocity < 0) {
        puck.vx -= 1.92 * normalVelocity * nx;
        puck.vy -= 1.92 * normalVelocity * ny;
      }
      if (game.wallCooldown <= 0) {
        game.shake = Math.max(game.shake, 3.4);
        playSound("wall");
        game.wallCooldown = 0.04;
      }
    };

    const updateParticles = (dt: number) => {
      const game = gameRef.current;
      for (const particle of game.particles) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= Math.pow(0.975, dt * 60);
        particle.vy *= Math.pow(0.975, dt * 60);
      }
      game.particles = game.particles.filter((particle) => particle.life > 0).slice(-180);
    };

    const update = (dt: number) => {
      const game = gameRef.current;
      const currentSettings = settingsRef.current;
      game.elapsed += dt;
      game.shake = Math.max(0, game.shake - dt * 28);
      game.flash = Math.max(0, game.flash - dt * 1.8);
      game.bannerTime = Math.max(0, game.bannerTime - dt);
      game.wallCooldown = Math.max(0, game.wallCooldown - dt);
      game.mallets[0].cooldown = Math.max(0, game.mallets[0].cooldown - dt);
      game.mallets[1].cooldown = Math.max(0, game.mallets[1].cooldown - dt);
      updateParticles(dt);
      moveMallet(game.mallets[0], 0, dt);
      moveMallet(game.mallets[1], 1, dt);

      if (game.pendingWinner !== null) {
        game.endTimer -= dt;
        if (game.endTimer <= 0) {
          const winner = game.pendingWinner;
          game.pendingWinner = null;
          finishMatch(winner);
        }
        return;
      }
      if (game.countdown > 0) {
        game.countdown -= dt;
        game.puck.x = CENTER_X;
        game.puck.y = CENTER_Y;
        const tick = Math.ceil(game.countdown);
        if (tick !== game.countdownTick && tick >= 1 && tick <= 3) {
          game.countdownTick = tick;
          playSound("tick");
        }
        if (game.countdown <= 0) {
          game.countdown = 0;
          game.scoringLocked = false;
          game.puck.vx = game.serveDirection * 430;
          game.puck.vy = (Math.random() - 0.5) * 270;
          playSound("start");
        }
        return;
      }

      const puck = game.puck;
      const drag = Math.pow(0.9992, dt * 60);
      puck.vx *= drag;
      puck.vy *= drag;
      puck.x += puck.vx * dt;
      puck.y += puck.vy * dt;
      if (puck.y - puck.radius < FIELD_TOP) {
        puck.y = FIELD_TOP + puck.radius;
        puck.vy = Math.abs(puck.vy) * 0.97;
        if (game.wallCooldown <= 0) {
          playSound("wall");
          game.wallCooldown = 0.035;
        }
      } else if (puck.y + puck.radius > FIELD_BOTTOM) {
        puck.y = FIELD_BOTTOM - puck.radius;
        puck.vy = -Math.abs(puck.vy) * 0.97;
        if (game.wallCooldown <= 0) {
          playSound("wall");
          game.wallCooldown = 0.035;
        }
      }

      const inGoalOpening = puck.y > GOAL_TOP && puck.y < GOAL_BOTTOM;
      if (!inGoalOpening && puck.x - puck.radius < FIELD_LEFT) {
        puck.x = FIELD_LEFT + puck.radius;
        puck.vx = Math.abs(puck.vx) * 0.97;
      } else if (!inGoalOpening && puck.x + puck.radius > FIELD_RIGHT) {
        puck.x = FIELD_RIGHT - puck.radius;
        puck.vx = -Math.abs(puck.vx) * 0.97;
      }
      collideWithPost(FIELD_LEFT, GOAL_TOP);
      collideWithPost(FIELD_LEFT, GOAL_BOTTOM);
      collideWithPost(FIELD_RIGHT, GOAL_TOP);
      collideWithPost(FIELD_RIGHT, GOAL_BOTTOM);
      collideWithMallet(game.mallets[0], currentSettings.playerOneColor);
      collideWithMallet(game.mallets[1], currentSettings.playerTwoColor);

      const speed = Math.hypot(puck.vx, puck.vy);
      if (speed < 120) game.slowTime += dt;
      else game.slowTime = 0;
      if (game.slowTime > 1.25) {
        puck.vx = (Math.random() > 0.5 ? 1 : -1) * 230;
        puck.vy = (Math.random() - 0.5) * 180;
        game.slowTime = 0;
      }
      if (puck.x < 4 - puck.radius) registerGoal(1);
      else if (puck.x > TABLE_WIDTH - 4 + puck.radius) registerGoal(0);
    };

    const draw = () => {
      const game = gameRef.current;
      const currentSettings = settingsRef.current;
      const widthScale = canvas.width / TABLE_WIDTH;
      const heightScale = canvas.height / TABLE_HEIGHT;
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(widthScale, 0, 0, heightScale, 0, 0);
      context.save();
      if (game.shake > 0 && viewRef.current === "playing") {
        context.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
      }
      context.drawImage(rinkCanvas, 0, 0);
      if (game.countdown <= 0 && viewRef.current === "playing" && game.pendingWinner === null) {
        game.trail.push({ x: game.puck.x, y: game.puck.y });
        if (game.trail.length > 15) game.trail.shift();
      }
      for (let index = 0; index < game.trail.length; index += 1) {
        const point = game.trail[index];
        const progress = (index + 1) / game.trail.length;
        context.beginPath();
        context.arc(point.x, point.y, PUCK_RADIUS * progress * 0.7, 0, Math.PI * 2);
        context.fillStyle = rgba(currentSettings.puckColor, progress * 0.12);
        context.fill();
      }
      for (const particle of game.particles) {
        const alpha = Math.max(0, particle.life / particle.maxLife);
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size * alpha, 0, Math.PI * 2);
        context.fillStyle = rgba(particle.color, Math.min(1, alpha * 1.4));
        context.fill();
      }
      drawMallet(context, game.mallets[0], currentSettings.playerOneColor);
      drawMallet(context, game.mallets[1], currentSettings.playerTwoColor);

      const puck = game.puck;
      context.save();
      context.shadowColor = rgba(currentSettings.puckColor, 0.8);
      context.shadowBlur = 22;
      const puckGradient = context.createRadialGradient(puck.x - 7, puck.y - 8, 2, puck.x, puck.y, puck.radius);
      puckGradient.addColorStop(0, mixColor(currentSettings.puckColor, 0.72));
      puckGradient.addColorStop(0.35, currentSettings.puckColor);
      puckGradient.addColorStop(1, mixColor(currentSettings.puckColor, -0.7));
      context.beginPath();
      context.arc(puck.x, puck.y, puck.radius, 0, Math.PI * 2);
      context.fillStyle = puckGradient;
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = "rgba(255, 255, 255, 0.45)";
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.arc(puck.x, puck.y, puck.radius * 0.46, 0, Math.PI * 2);
      context.strokeStyle = "rgba(0, 0, 0, 0.25)";
      context.stroke();
      context.restore();

      if (game.flash > 0) {
        const flashGradient = context.createLinearGradient(
          game.flashSide === 0 ? TABLE_WIDTH : 0, 0,
          game.flashSide === 0 ? TABLE_WIDTH * 0.35 : TABLE_WIDTH * 0.65, 0,
        );
        const color = game.flashSide === 0 ? currentSettings.playerOneColor : currentSettings.playerTwoColor;
        flashGradient.addColorStop(0, rgba(color, game.flash * 0.42));
        flashGradient.addColorStop(1, rgba(color, 0));
        context.fillStyle = flashGradient;
        context.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
      }
      if (game.bannerTime > 0) {
        const alpha = Math.min(1, game.bannerTime * 2.4);
        context.textAlign = "center";
        context.font = "900 42px Arial, sans-serif";
        context.fillStyle = `rgba(239, 252, 255, ${alpha})`;
        context.shadowColor = "rgba(34, 211, 238, 0.6)";
        context.shadowBlur = 24;
        context.fillText(game.banner, CENTER_X, CENTER_Y - 78);
        context.shadowBlur = 0;
      } else if (game.countdown > 0 && game.countdown <= 3) {
        context.textAlign = "center";
        context.font = "900 74px Arial, sans-serif";
        context.fillStyle = "rgba(239, 252, 255, 0.92)";
        context.shadowColor = "rgba(34, 211, 238, 0.75)";
        context.shadowBlur = 28;
        context.fillText(String(Math.max(1, Math.ceil(game.countdown))), CENTER_X, CENTER_Y + 25);
        context.shadowBlur = 0;
      }
      context.restore();
    };

    const frame = (time: number) => {
      const game = gameRef.current;
      const elapsed = Math.min(0.034, Math.max(0, (time - game.lastTime) / 1000));
      game.lastTime = time;
      if (viewRef.current === "playing") {
        game.accumulator += elapsed;
        let safety = 0;
        while (game.accumulator >= FIXED_STEP && safety < 5) {
          update(FIXED_STEP);
          game.accumulator -= FIXED_STEP;
          safety += 1;
        }
      }
      draw();
      animationFrame = requestAnimationFrame(frame);
    };
    gameRef.current.lastTime = performance.now();
    animationFrame = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [finishMatch, playSound, registerGoal, view]);

  const pointerPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * TABLE_WIDTH,
      y: ((event.clientY - bounds.top) / bounds.height) * TABLE_HEIGHT,
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (viewRef.current !== "playing") return;
    event.preventDefault();
    const point = pointerPosition(event);
    const player: PlayerIndex = point.x < CENTER_X ? 0 : 1;
    if (gameRef.current.pointers[player]) return;
    gameRef.current.pointers[player] = { id: event.pointerId, ...point };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointers = gameRef.current.pointers;
    const player = pointers[0]?.id === event.pointerId ? 0 : pointers[1]?.id === event.pointerId ? 1 : null;
    if (player === null) return;
    event.preventDefault();
    pointers[player] = { id: event.pointerId, ...pointerPosition(event) };
  };

  const releasePointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointers = gameRef.current.pointers;
    if (pointers[0]?.id === event.pointerId) pointers[0] = null;
    if (pointers[1]?.id === event.pointerId) pointers[1] = null;
  };

  const toggleSound = () => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    if (next) {
      ensureAudio();
      window.setTimeout(() => playSound("tick"), 0);
    }
  };

  const winsNeeded = Math.ceil(settings.maxSets / 2);

  if (view === "menu") {
    return (
      <main className="menu-screen">
        <div className="menu-ambient" aria-hidden="true" />
        <div className="menu-rink-plane" aria-hidden="true">
          <div className="menu-center-line" />
          <div className="menu-center-circle" />
          <div className="menu-goal menu-goal-left" />
          <div className="menu-goal menu-goal-right" />
          <div className="menu-demo-mallet menu-demo-mallet-one" style={{ "--demo-color": settings.playerOneColor } as CSSProperties} />
          <div className="menu-demo-mallet menu-demo-mallet-two" style={{ "--demo-color": settings.playerTwoColor } as CSSProperties} />
          <div className="menu-demo-puck" style={{ "--demo-color": settings.puckColor } as CSSProperties} />
        </div>
        <header className="menu-nav">
          <div className="mini-brand"><span className="brand-slash">//</span><span>NR 02</span></div>
          <button className="icon-button" type="button" onClick={toggleSound} aria-label={soundOn ? "Sesi kapat" : "Sesi aç"}>
            <SoundIcon muted={!soundOn} />
          </button>
        </header>

        <div className="menu-content">
          <section className="brand-hero" aria-labelledby="game-title">
            <p className="overline">İKİ OYUNCULU MASA HOKEYİ</p>
            <h1 id="game-title"><span>NEON</span><span>RINK</span></h1>
            <p className="hero-copy">İki kişi. Tek masa. Sıfır fren.</p>
            <div className="control-legend" aria-label="Kontroller">
              <div><span className="legend-number">01</span><strong>W A S D</strong></div>
              <span className="legend-divider" />
              <div><span className="legend-number">02</span><strong>OK TUŞLARI</strong></div>
              <p>Mobilde herkes kendi yarısına dokunur.</p>
            </div>
          </section>

          <section className="setup-panel" aria-label="Oyun ayarları">
            <div className="panel-tabs" role="tablist">
              <button type="button" className={menuTab === "setup" ? "is-active" : ""} onClick={() => setMenuTab("setup")} role="tab" aria-selected={menuTab === "setup"}>Maç ayarı</button>
              <button type="button" className={menuTab === "records" ? "is-active" : ""} onClick={() => setMenuTab("records")} role="tab" aria-selected={menuTab === "records"}>Yerel rekorlar <span>{records.length}</span></button>
            </div>

            {menuTab === "setup" ? (
              <div className="setup-content panel-enter" role="tabpanel">
                <div className="name-grid">
                  <label><span>OYUNCU 01</span><input value={settings.playerOne} maxLength={14} onChange={(event) => patchSettings("playerOne", event.target.value)} /></label>
                  <label><span>OYUNCU 02</span><input value={settings.playerTwo} maxLength={14} onChange={(event) => patchSettings("playerTwo", event.target.value)} /></label>
                </div>
                <div className="picker-stack">
                  <ColorPicker label="Oyuncu 01 tutacağı" value={settings.playerOneColor} onChange={(value) => patchSettings("playerOneColor", value)} />
                  <ColorPicker label="Disk rengi" value={settings.puckColor} onChange={(value) => patchSettings("puckColor", value)} />
                  <ColorPicker label="Oyuncu 02 tutacağı" value={settings.playerTwoColor} onChange={(value) => patchSettings("playerTwoColor", value)} />
                </div>
                <div className="rules-grid">
                  <div>
                    <span className="setting-label">Tur golü</span>
                    <div className="segmented-control">
                      {[3, 5, 7].map((goals) => <button type="button" className={settings.goalsToWin === goals ? "is-active" : ""} key={goals} onClick={() => patchSettings("goalsToWin", goals)}>{goals}</button>)}
                    </div>
                  </div>
                  <div>
                    <span className="setting-label">Set sayısı</span>
                    <div className="segmented-control">
                      {[1, 3, 5].map((sets) => <button type="button" className={settings.maxSets === sets ? "is-active" : ""} key={sets} onClick={() => patchSettings("maxSets", sets)}>{sets}</button>)}
                    </div>
                  </div>
                </div>
                <button type="button" className="start-button" onClick={startMatch}><span>Maçı başlat</span><span className="start-arrow">↗</span></button>
              </div>
            ) : (
              <div className="records-content panel-enter" role="tabpanel">
                <div className="records-heading">
                  <div><span className="overline">BU CİHAZDA</span><h2>Salonun en iyileri</h2></div>
                  {records.length > 0 && <button type="button" className="text-button" onClick={() => { localStorage.removeItem(RECORDS_KEY); setRecords([]); }}>Temizle</button>}
                </div>
                {records.length > 0 ? (
                  <div className="records-table">
                    <div className="records-row records-labels"><span>#</span><span>Oyuncu</span><span>Set</span><span>Süre</span><span>Puan</span></div>
                    {records.map((record, index) => (
                      <div className="records-row" key={record.id}>
                        <span className="record-rank">{String(index + 1).padStart(2, "0")}</span>
                        <span><strong>{record.winner}</strong><small>{record.date}</small></span>
                        <span>{record.result}</span><span>{formatTime(record.duration)}</span><span className="record-points">{record.points}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-records"><span>00</span><h3>Henüz kayıt yok</h3><p>İlk maçı bitir, tabloya adını yazdır.</p></div>
                )}
                <button type="button" className="start-button records-start" onClick={startMatch}><span>Yeni maç</span><span className="start-arrow">↗</span></button>
              </div>
            )}
          </section>
        </div>
      </main>
    );
  }

  const setDots = (player: PlayerIndex) => Array.from({ length: winsNeeded }, (_, index) => (
    <span key={index} className={index < score.sets[player] ? "is-won" : ""} style={{ "--player-color": player === 0 ? settings.playerOneColor : settings.playerTwoColor } as CSSProperties} />
  ));

  return (
    <main className="game-screen">
      <div className="game-ambient" aria-hidden="true" />
      <header className="game-header">
        <button className="game-brand" type="button" onClick={returnToMenu} aria-label="Ana menüye dön"><span className="brand-slash">//</span><span>NEON RINK</span></button>
        <div className="scoreboard" aria-label="Maç skoru">
          <div className="score-player score-player-one">
            <div className="player-name-line"><span className="player-color" style={{ backgroundColor: settings.playerOneColor }} /><strong>{settings.playerOne}</strong></div>
            <div className="set-dots" aria-label={`${score.sets[0]} set`}>{setDots(0)}</div>
          </div>
          <div className="goal-score">
            <span key={`left-${score.goals[0]}`} className={score.lastScorer === 0 ? "score-pop" : ""}>{score.goals[0]}</span><b>:</b>
            <span key={`right-${score.goals[1]}`} className={score.lastScorer === 1 ? "score-pop" : ""}>{score.goals[1]}</span>
            <small>{settings.goalsToWin} GOL / {settings.maxSets} SET</small>
          </div>
          <div className="score-player score-player-two">
            <div className="player-name-line"><strong>{settings.playerTwo}</strong><span className="player-color" style={{ backgroundColor: settings.playerTwoColor }} /></div>
            <div className="set-dots" aria-label={`${score.sets[1]} set`}>{setDots(1)}</div>
          </div>
        </div>
        <div className="game-actions">
          <button className="icon-button" type="button" onClick={toggleSound} aria-label={soundOn ? "Sesi kapat" : "Sesi aç"}><SoundIcon muted={!soundOn} /></button>
          <button className="icon-button pause-button" type="button" onClick={pauseMatch} aria-label="Oyunu duraklat"><PauseIcon /></button>
        </div>
      </header>

      <section className="rink-area" aria-label="Air hockey oyun masası">
        <div className="rink-shell">
          <canvas ref={canvasRef} className="game-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={releasePointer} onPointerCancel={releasePointer} onContextMenu={(event) => event.preventDefault()} />
          <div className="table-edge table-edge-left" aria-hidden="true" />
          <div className="table-edge table-edge-right" aria-hidden="true" />
          {view === "paused" && (
            <div className="game-overlay">
              <div className="overlay-content overlay-enter">
                <span className="overline">OYUN DURAKLATILDI</span><h2>Buz nefes alıyor.</h2><p>Devam etmek için P veya ESC tuşuna da basabilirsin.</p>
                <div className="overlay-actions"><button type="button" className="primary-action" onClick={resumeMatch}>Devam et</button><button type="button" className="secondary-action" onClick={returnToMenu}>Ana menü</button></div>
              </div>
            </div>
          )}
          {view === "gameover" && finalResult && (
            <div className="game-overlay gameover-overlay">
              <div className="overlay-content overlay-enter">
                <span className="overline">MAÇ TAMAMLANDI</span>
                <h2 style={{ color: finalResult.winner === 0 ? settings.playerOneColor : settings.playerTwoColor }}>{finalResult.winner === 0 ? settings.playerOne : settings.playerTwo}</h2>
                <p className="champion-label">RINK ŞAMPİYONU</p>
                <div className="final-line"><span><small>SET</small>{finalResult.sets[0]} : {finalResult.sets[1]}</span><span><small>SÜRE</small>{formatTime(finalResult.duration)}</span><span><small>PUAN</small>{finalResult.points}</span></div>
                <div className="overlay-actions"><button type="button" className="primary-action" onClick={startMatch}>Rövanş</button><button type="button" className="secondary-action" onClick={() => { returnToMenu(); setMenuTab("records"); }}>Skor tablosu</button></div>
                <span className="restart-hint">ENTER veya R ile anında rövanş</span>
              </div>
            </div>
          )}
        </div>
      </section>
      <footer className="game-footer"><span><b>01</b> W A S D</span><p>Dokun ve sürükle. Kendi yarı alanında kal.</p><span><b>02</b> OK TUŞLARI</span></footer>
    </main>
  );
}