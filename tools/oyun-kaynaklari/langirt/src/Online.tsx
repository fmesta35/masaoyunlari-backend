/* KICKOFF CLUB (Langırt) — çevrimiçi mod.
 * Maç ekranı (masa, skor tabelası, çubuk seçici, şarj, ayarlar, sesler,
 * parçacıklar) referans oyunun kodudur: foosball-canvas.ts ve game-engine.ts
 * AYNEN kullanılır. Fizik sunucudadır (sitenin langirt-engine.js'i, referansın
 * game-engine.ts'inin birebir portu); bu bileşen sunucudan gelen kareleri
 * (üst pencere postMessage ile iletir) yumuşatıp çizer, kendi çubuklarını
 * yerelde tahmin eder, hedeflerini ve vuruşlarını üst pencereye yollar. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  FIELD, GAME_HEIGHT, GAME_WIDTH, RODS, clampTarget, createGame, fireShot, formatTime,
  type GamePhase, type GameSnapshot, type Side,
} from "@/lib/game-engine";
import { createImpactParticles, drawFoosballCanvas, type CanvasEffects, type Particle, type TableTheme } from "@/components/foosball-canvas";

type SrvFrame = {
  faz: string; fazSn: number;
  top: { x: number; y: number; vx: number; vy: number };
  cubuk: { kirmizi: number[]; mavi: number[] };
  skor: { kirmizi: number; mavi: number };
  olayNo: number; sonOlay: string; gecenSn?: number; sonGolAtan?: string | null;
};
type ControlAction = "up" | "down" | "previous" | "next" | "shoot" | "pause";
type ControlBindings = Record<ControlAction, string>;

const SETTINGS_STORAGE = "kickoff-club-settings-v1";
const LS_SES = "gv-ses";
const DEFAULT_BINDINGS: ControlBindings = { up: "w", down: "s", previous: "q", next: "e", shoot: "space", pause: "escape" };
const THEME_NAMES: Record<TableTheme, string> = { clubhouse: "Clubhouse", arctic: "Arctic", afterhours: "Afterhours" };
const THEME_ORDER: TableTheme[] = ["clubhouse", "arctic", "afterhours"];
const PHASE: Record<string, GamePhase> = { gerisayim: "countdown", oyun: "playing", gol: "goal", bitti: "over" };
const EVENT: Record<string, GameSnapshot["lastEvent"]> = { yok: "none", carpma: "impact", vurus: "kick", sut: "power", gol: "goal" };

const post = (m: Record<string, unknown>) => { try { window.parent.postMessage({ src: "langirt", ...m }, "*"); } catch { /* */ } };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const initials = (name: string) => (name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase() || "P");
function normalizeKey(key: string) { if (key === " ") return "space"; if (key === "Escape") return "escape"; return key.toLowerCase(); }
function showKey(key: string) {
  if (key === "space") return "SPACE"; if (key === "escape") return "ESC";
  if (key === "arrowup") return "↑"; if (key === "arrowdown") return "↓"; if (key === "arrowleft") return "←"; if (key === "arrowright") return "→";
  return key.toUpperCase();
}

function Icon({ name, size = 17 }: { name: "bolt" | "arrow" | "settings" | "volume" | "pause" | "close"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  const paths: Record<string, React.ReactNode> = {
    bolt: <path d="M13 2 4.8 13h6.4L10 22l9.2-12h-6.7L13 2Z" fill="currentColor" stroke="none" />,
    arrow: <path d="M5 12h13M13 6l6 6-6 6" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.1 1.8-1.8 3.1-2.1-.4a8 8 0 0 1-1.6.9l-.7 2h-3.6l-.7-2a8 8 0 0 1-1.6-.9l-2.1.4-1.8-3.1L5.7 15a8 8 0 0 1 0-1.9l-1.1-1.8 1.8-3.1 2.1.4a8 8 0 0 1 1.6-.9l.7-2h3.6l.7 2a8 8 0 0 1 1.6.9l2.1-.4 1.8 3.1-1.1 1.8a8 8 0 0 1-.1 1.9Z" transform="translate(-1.3 -1.3) scale(.99)" /></>,
    volume: <><path d="M4 10v4h4l5 4V6l-5 4H4Z" /><path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" /></>,
    pause: <path d="M8 5v14M16 5v14" strokeWidth="3" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg {...common}>{paths[name]}</svg>;
}

type G = {
  prev: SrvFrame | null; cur: SrvFrame | null; curAt: number; interval: number;
  side: Side | null; names: [string, string]; target: number;
  myRods: number[]; myTargets: number[]; lastSentAt: number; lastSent: string;
  lastEvent: number | null; shake: number; flash: number; particles: Particle[];
  clock: number; selected: number; charge: number | null; pointerDown: boolean; aimY: number;
  keys: Set<string>; lastUi: number; lastScore: string; lastPhase: GamePhase;
};

export default function Online() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef<G>({
    prev: null, cur: null, curAt: 0, interval: 50, side: null, names: ["Kırmızı", "Mavi"], target: 5,
    myRods: [300, 300, 300, 300], myTargets: [300, 300, 300, 300], lastSentAt: 0, lastSent: "",
    lastEvent: null, shake: 0, flash: 0, particles: [], clock: 0, selected: 3, charge: null, pointerDown: false, aimY: FIELD.centerY,
    keys: new Set(), lastUi: 0, lastScore: "0-0", lastPhase: "countdown",
  });
  const audioRef = useRef<AudioContext | null>(null);
  const soundRef = useRef({ muted: false, effects: 0.62, interface: 0.36 });
  const bindingsRef = useRef<ControlBindings>(DEFAULT_BINDINGS);
  const themeRef = useRef<TableTheme>("clubhouse");
  const assistRef = useRef(true);
  const pausedRef = useRef(false);
  const modalRef = useRef(false);
  const captureRef = useRef<ControlAction | null>(null);

  const [ready, setReady] = useState(false);
  const [side, setSide] = useState<Side | null>(null);
  const [names, setNames] = useState<[string, string]>(["Kırmızı", "Mavi"]);
  const [target, setTarget] = useState(5);
  const [scores, setScores] = useState({ red: 0, blue: 0 });
  const [phase, setPhase] = useState<GamePhase>("countdown");
  const [countdown, setCountdown] = useState(3);
  const [clock, setClock] = useState("00:00");
  const [lastScorer, setLastScorer] = useState<Side | null>(null);
  const [selectedRod, setSelectedRod] = useState(3);
  const [connected, setConnected] = useState(true);
  const [paused, setPaused] = useState(false);
  const [modal, setModal] = useState(false);
  const [muted, setMuted] = useState(false);
  const [effectsVolume, setEffectsVolume] = useState(0.62);
  const [interfaceVolume, setInterfaceVolume] = useState(0.36);
  const [bindings, setBindings] = useState<ControlBindings>(DEFAULT_BINDINGS);
  const [capturing, setCapturing] = useState<ControlAction | null>(null);
  const [tableTheme, setTableTheme] = useState<TableTheme>("clubhouse");
  const [assisted, setAssisted] = useState(true);
  const [toast, setToast] = useState("");

  bindingsRef.current = bindings; themeRef.current = tableTheme; assistRef.current = assisted;
  pausedRef.current = paused; modalRef.current = modal; captureRef.current = capturing;
  soundRef.current = { muted, effects: effectsVolume, interface: interfaceVolume };

  /* ---- ayarlar (kalıcı) ---- */
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_STORAGE) || "{}");
      if (typeof s.muted === "boolean") setMuted(s.muted);
      if (typeof s.effects === "number") setEffectsVolume(s.effects);
      if (typeof s.interface === "number") setInterfaceVolume(s.interface);
      if (s.bindings) setBindings({ ...DEFAULT_BINDINGS, ...s.bindings });
      if (THEME_ORDER.includes(s.theme)) setTableTheme(s.theme);
      if (typeof s.assisted === "boolean") setAssisted(s.assisted);
    } catch { /* */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_STORAGE, JSON.stringify({ muted, effects: effectsVolume, interface: interfaceVolume, bindings, theme: tableTheme, assisted })); } catch { /* */ }
  }, [muted, effectsVolume, interfaceVolume, bindings, tableTheme, assisted]);

  const notify = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast(""), 2000); }, []);

  /* ---- ses (referanstaki sentez) ---- */
  const playSound = useCallback((kind: string) => {
    const settings = soundRef.current;
    if (settings.muted) return;
    try { if (localStorage.getItem(LS_SES) === "off") return; } catch { /* */ }
    try {
      const C = window.AudioContext;
      if (!C) return;
      const context = audioRef.current ?? new C();
      audioRef.current = context;
      if (context.state === "suspended") void context.resume();
      const ui = kind === "ui";
      const volume = (ui ? settings.interface : settings.effects) * (kind === "impact" ? 0.45 : kind === "rod" ? 0.22 : 0.75);
      if (kind === "goal") {
        [440, 554, 659].forEach((frequency, index) => {
          const o = context.createOscillator(); const gn = context.createGain(); const start = context.currentTime + index * 0.105;
          o.type = index === 0 ? "triangle" : "sine"; o.frequency.setValueAtTime(frequency, start);
          gn.gain.setValueAtTime(0.0001, start);
          gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.12), start + 0.025);
          gn.gain.exponentialRampToValueAtTime(0.0001, start + 0.31);
          o.connect(gn); gn.connect(context.destination); o.start(start); o.stop(start + 0.34);
        });
        return;
      }
      const o = context.createOscillator(); const gn = context.createGain(); const now = context.currentTime;
      const configs: Record<string, { type: OscillatorType; start: number; end: number; duration: number }> = {
        ui: { type: "sine", start: 590, end: 780, duration: 0.065 },
        kick: { type: "triangle", start: 220, end: 90, duration: 0.17 },
        power: { type: "sawtooth", start: 145, end: 45, duration: 0.32 },
        impact: { type: "triangle", start: 180, end: 70, duration: 0.11 },
        rod: { type: "sine", start: 300, end: 230, duration: 0.08 },
      };
      const c = configs[kind] ?? configs.ui;
      o.type = c.type; o.frequency.setValueAtTime(c.start, now);
      o.frequency.exponentialRampToValueAtTime(c.end, now + c.duration);
      gn.gain.setValueAtTime(0.0001, now);
      gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.12), now + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, now + c.duration);
      o.connect(gn); gn.connect(context.destination); o.start(now); o.stop(now + c.duration + 0.02);
    } catch { /* ses isteğe bağlı */ }
  }, []);
  const soundFn = useRef(playSound); soundFn.current = playSound;

  /* ---- sunucu karesi → referans anlık görüntüsü ---- */
  const snapOf = useCallback((f: SrvFrame, ball: GameSnapshot["ball"], rods: { red: number[]; blue: number[] }): GameSnapshot => {
    const s = g.current;
    const base = createGame(s.target);
    return {
      ...base, ball, rods: { red: [...rods.red], blue: [...rods.blue] },
      rodTargets: { red: [...rods.red], blue: [...rods.blue] },
      score: { red: f.skor.kirmizi, blue: f.skor.mavi }, target: s.target,
      phase: PHASE[f.faz] ?? "playing", phaseTime: f.fazSn, elapsed: f.gecenSn ?? 0,
      lastScorer: f.sonGolAtan === "kirmizi" ? "red" : f.sonGolAtan === "mavi" ? "blue" : null,
      lastEvent: EVENT[f.sonOlay] ?? "none", eventId: f.olayNo,
    };
  }, []);

  const onFrame = useCallback((f: SrvFrame) => {
    const s = g.current; const now = performance.now();
    if (s.curAt) { const d = now - s.curAt; if (d > 8 && d < 500) s.interval = s.interval * 0.8 + d * 0.2; }
    s.prev = s.cur || f; s.cur = f; s.curAt = now;
    if (s.lastEvent === null) { s.lastEvent = f.olayNo; return; }
    if (f.olayNo === s.lastEvent) return;
    s.lastEvent = f.olayNo;
    const ev = EVENT[f.sonOlay] ?? "none";
    const ball = f.top;
    if (ev === "goal") {
      const scorer: Side = f.sonGolAtan === "kirmizi" ? "red" : "blue";
      s.particles.push(...createImpactParticles(ball.x, ball.y, scorer === "red" ? "#ff6873" : "#59d9ff", 42, f.olayNo));
      s.shake = 6; s.flash = 0.8; soundFn.current("goal"); setLastScorer(scorer);
    } else if (ev === "power" || ev === "kick") {
      let nearest: Side = "red"; let best = 1e9;
      for (const sd of ["red", "blue"] as const) for (const r of RODS[sd]) { const d = Math.abs(r.x - ball.x); if (d < best) { best = d; nearest = sd; } }
      s.particles.push(...createImpactParticles(ball.x, ball.y, nearest === "red" ? "#ffb080" : "#86e7ff", ev === "power" ? 18 : 10, f.olayNo));
      s.shake = ev === "power" ? 3.5 : 1.5; soundFn.current(ev);
    } else if (ev === "impact" && Math.hypot(ball.vx, ball.vy) > 205) {
      s.particles.push(...createImpactParticles(ball.x, ball.y, "#f7edd1", 4, f.olayNo));
      soundFn.current("impact");
    }
  }, []);

  /* ---- üst pencere mesajları ---- */
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.dst !== "langirt") return;
      const s = g.current;
      if (d.t === "init") {
        s.side = d.seat === 0 ? "red" : d.seat === 1 ? "blue" : null;
        s.names = d.names; s.target = d.state?.hedefGol || 5; s.cur = null; s.prev = null; s.lastEvent = null;
        s.selected = 3; setSelectedRod(3);
        setSide(s.side); setNames(d.names); setTarget(s.target);
        setReady(true);
        if (d.frame) onFrame(d.frame);
      } else if (d.t === "frame" && d.f) onFrame(d.f as SrvFrame);
    };
    window.addEventListener("message", on);
    post({ t: "ready" });
    return () => window.removeEventListener("message", on);
  }, [onFrame]);

  const selectRod = useCallback((rod: number) => { const r = clamp(rod, 0, 3); g.current.selected = r; setSelectedRod(r); }, []);

  const moveTo = useCallback((rod: number, y: number) => {
    const s = g.current; if (!s.side) return;
    s.myTargets[rod] = clampTarget(s.side, rod, y);
  }, []);

  /* ---- vuruş ---- */
  const fireSelected = useCallback((heldMs: number) => {
    const s = g.current;
    s.charge = null; s.pointerDown = false;
    if (!s.side || !s.cur || pausedRef.current || modalRef.current) return false;
    const charge = clamp(Math.max(0.12, heldMs / 1180), 0, 1);
    let aimY = s.aimY;
    if (assistRef.current) {
      const opp = s.side === "red" ? s.cur.cubuk.mavi[0] : s.cur.cubuk.kirmizi[0];
      const lane = Math.abs(opp - FIELD.goalTop) > Math.abs(opp - FIELD.goalBottom) ? FIELD.goalTop + 38 : FIELD.goalBottom - 38;
      aimY = aimY * 0.78 + lane * 0.22;
    }
    const rods = { red: s.cur.cubuk.kirmizi.slice(), blue: s.cur.cubuk.mavi.slice() };
    rods[s.side] = s.myRods.slice();
    const sim = snapOf(s.cur, { ...s.cur.top }, rods);
    sim.phase = "playing";
    const fired = fireShot(sim, s.side, { rod: s.selected, charge, aimY });
    if (fired) {
      soundFn.current(charge > 0.67 ? "power" : "kick");
      post({ t: "shot", cubuk: s.selected, guc: charge, nisanY: aimY });
    }
    return fired;
  }, [snapOf]);

  /* ---- işaretçi ---- */
  const pt = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * GAME_WIDTH, y: ((e.clientY - r.top) / r.height) * GAME_HEIGHT };
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = g.current; if (!s.side || pausedRef.current) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    s.pointerDown = true; s.charge = performance.now();
    const p = pt(e); s.aimY = p.y;
    const rods = RODS[s.side]; let closest = 0;
    for (let i = 1; i < rods.length; i += 1) if (Math.abs(rods[i].x - p.x) < Math.abs(rods[closest].x - p.x)) closest = i;
    selectRod(closest); moveTo(closest, p.y);
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = g.current; if (!s.side || pausedRef.current) return;
    const p = pt(e); s.aimY = p.y;
    if (s.pointerDown || e.pointerType === "mouse") moveTo(s.selected, p.y);
  };
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = g.current; if (!s.pointerDown) return;
    e.preventDefault();
    fireSelected(performance.now() - (s.charge ?? performance.now()));
  };

  /* ---- klavye ---- */
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const s = g.current; const key = normalizeKey(event.key);
      if (captureRef.current) {
        event.preventDefault();
        const action = captureRef.current;
        const conflict = key === "arrowup" || key === "arrowdown" || Object.entries(bindingsRef.current).some(([n, v]) => n !== action && v === key);
        if (conflict) { notify("Bu tuş zaten atanmış."); setCapturing(null); return; }
        setBindings({ ...bindingsRef.current, [action]: key }); setCapturing(null); soundFn.current("ui");
        return;
      }
      if (key === "escape") {
        event.preventDefault();
        if (modalRef.current) { setModal(false); setCapturing(null); return; }
        setPaused(!pausedRef.current); return;
      }
      if (key === bindingsRef.current.pause && !modalRef.current) { event.preventDefault(); setPaused(!pausedRef.current); return; }
      if (modalRef.current || pausedRef.current || !s.side) return;
      if (key === bindingsRef.current.previous || key === bindingsRef.current.next) {
        event.preventDefault();
        selectRod((s.selected + (key === bindingsRef.current.next ? 1 : -1) + 4) % 4); return;
      }
      if (key === bindingsRef.current.up || key === bindingsRef.current.down || key === "arrowup" || key === "arrowdown") {
        event.preventDefault(); s.keys.add(key); return;
      }
      if (key === bindingsRef.current.shoot || key === "space") {
        event.preventDefault();
        if (!s.keys.has("space")) s.charge = performance.now();
        s.keys.add("space"); return;
      }
      if (key === "shift") s.keys.add("shift");
    };
    const up = (event: KeyboardEvent) => {
      const s = g.current; const key = normalizeKey(event.key);
      s.keys.delete(key);
      if (key === "shift") return;
      if (key === "space" || key === bindingsRef.current.shoot) {
        s.keys.delete("space");
        if (s.charge !== null) fireSelected(performance.now() - s.charge);
      }
    };
    const blur = () => { const s = g.current; s.keys.clear(); s.pointerDown = false; s.charge = null; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, [fireSelected, notify, selectRod]);

  /* ---- çizim döngüsü + yerel çubuk tahmini ---- */
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true }); if (!ctx) return;
    let width = 0, height = 0, raf = 0, last = performance.now(), lastRodSound = 0;
    const resize = () => {
      const r = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
      if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; }
      width = canvas.width; height = canvas.height;
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

    const send = (force = false) => {
      const s = g.current; if (!s.side) return;
      const t = performance.now(); const body = s.myTargets.map((v) => Math.round(v)).join(",");
      if (!force && (t - s.lastSentAt < 50 || (body === s.lastSent && t - s.lastSentAt < 400))) return;
      s.lastSentAt = t; s.lastSent = body;
      post({ t: "rods", hedefY: s.myTargets.map((v) => Math.round(v)), hassas: s.keys.has("shift") });
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const s = g.current; const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
      s.clock += dt;
      const f = s.cur;
      if (!f) {
        ctx.setTransform(width / GAME_WIDTH, 0, 0, height / GAME_HEIGHT, 0, 0);
        drawFoosballCanvas(ctx, createGame(s.target), { particles: [], selectedSide: s.side ?? "red", selectedRod: 3, charge: 0, eventFlash: 0, shake: 0, theme: themeRef.current, clock: s.clock });
        return;
      }
      /* ara değer */
      const k = s.prev && s.prev !== f ? clamp((now - s.curAt) / Math.max(16, s.interval), 0, 1) : 1;
      const a = s.prev || f; const lerp = (x: number, y: number) => x + (y - x) * k;
      const ball = { x: lerp(a.top.x, f.top.x), y: lerp(a.top.y, f.top.y), vx: f.top.vx, vy: f.top.vy };
      const rods = { red: f.cubuk.kirmizi.map((v, i) => lerp(a.cubuk.kirmizi[i] ?? v, v)), blue: f.cubuk.mavi.map((v, i) => lerp(a.cubuk.mavi[i] ?? v, v)) };

      /* kendi çubuklarım: klavye + yerel tahmin */
      if (s.side) {
        const own = s.side === "red" ? f.cubuk.kirmizi : f.cubuk.mavi;
        if (f.faz !== "oyun") {
          for (let i = 0; i < 4; i += 1) { s.myRods[i] = own[i]; s.myTargets[i] = own[i]; }
        } else if (!pausedRef.current && !modalRef.current) {
          const keys = s.keys; const b = bindingsRef.current; const shift = keys.has("shift");
          const axis = (keys.has(b.down) || keys.has("arrowdown") ? 1 : 0) - (keys.has(b.up) || keys.has("arrowup") ? 1 : 0);
          if (axis) s.myTargets[s.selected] = clampTarget(s.side, s.selected, s.myTargets[s.selected] + axis * 440 * dt * (shift ? 0.5 : 1));
          const speed = (shift ? 285 : 620);
          for (let i = 0; i < 4; i += 1) {
            const diff = s.myTargets[i] - s.myRods[i];
            const move = clamp(diff, -speed * dt, speed * dt);
            s.myRods[i] = clampTarget(s.side, i, s.myRods[i] + move);
            const sv = own[i]; const gap = sv - s.myRods[i];
            if (Math.abs(gap) > 80) s.myRods[i] = sv;
            else if (Math.abs(diff) < 1 && Math.abs(gap) > 0.5) s.myRods[i] += gap * Math.min(1, dt * 5);
          }
          const sp = Math.abs((s.myTargets[s.selected] - s.myRods[s.selected]) / Math.max(dt, 0.001));
          if (sp > 190 && now - lastRodSound > 330) { lastRodSound = now; soundFn.current("rod"); }
        }
        if (s.side === "red") rods.red = s.myRods.slice(); else rods.blue = s.myRods.slice();
        send();
      }

      /* parçacık / sarsıntı */
      for (let i = s.particles.length - 1; i >= 0; i -= 1) {
        const p = s.particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97;
        if (p.life <= 0) s.particles.splice(i, 1);
      }
      s.shake = Math.max(0, s.shake - dt * 13); s.flash = Math.max(0, s.flash - dt * 1.1);
      const held = s.charge === null ? 0 : clamp((now - s.charge) / 1180, 0, 1);
      const effects: CanvasEffects = {
        particles: s.particles, selectedSide: s.side ?? "red", selectedRod: s.selected, charge: held,
        eventFlash: s.flash, shake: s.shake, theme: themeRef.current, clock: s.clock,
      };
      const snap = snapOf(f, ball, rods);
      ctx.setTransform(width / GAME_WIDTH, 0, 0, height / GAME_HEIGHT, 0, 0);
      drawFoosballCanvas(ctx, snap, effects);

      /* arayüz durumu */
      const key = `${snap.score.red}-${snap.score.blue}`;
      if (key !== s.lastScore) { s.lastScore = key; setScores({ ...snap.score }); }
      if (snap.phase !== s.lastPhase) { s.lastPhase = snap.phase; setPhase(snap.phase); }
      if (snap.phase === "countdown") setCountdown(Math.max(1, Math.ceil(snap.phaseTime)));
      if (now - s.lastUi > 220) {
        s.lastUi = now; setClock(formatTime(snap.elapsed));
        setConnected(now - s.curAt < 2500);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [ready, snapOf]);

  const bump = (amount: number) => { const s = g.current; if (s.side) moveTo(s.selected, s.myTargets[s.selected] + amount); };
  const nameOf = (sd: Side) => (sd === "red" ? names[0] : names[1]);
  const active = ready;
  const connLabel = connected ? "CONNECTED" : "RECONNECTING";

  return (
    <div className="club-app online-shell">
      <section className="arena-column" aria-label="Foosball arena">
        <div className="arena-header">
          <div className="arena-title-block">
            <div className="arena-kicker"><span className="live-pip live-pip-active" />ONLINE MATCH</div>
            <div className="arena-subtitle">FIRST TO {target} · SERVER REFEREED</div>
          </div>
          <div className={`connection-pill ${connected ? "connected" : "connection-warn"}`}><span className="connection-icon">⌁</span>{connLabel}</div>
        </div>

        <div className="scoreboard">
          <div className="score-team score-red">
            <span className="team-badge">{initials(nameOf("red"))}</span>
            <span className="team-copy"><small>{side === "red" ? "YOUR SIDE" : "HOME TEAM"}</small><strong>{nameOf("red")}</strong></span>
            <b className="team-score">{scores.red}</b>
          </div>
          <div className="score-center"><span className="clock-label">MATCH TIME</span><strong>{clock}</strong><span className="vs-label">{phase === "playing" ? "IN PLAY" : "VS"}</span></div>
          <div className="score-team score-blue">
            <b className="team-score">{scores.blue}</b>
            <span className="team-copy"><small>{side === "blue" ? "YOUR SIDE" : "AWAY TEAM"}</small><strong>{nameOf("blue")}</strong></span>
            <span className="team-badge">{initials(nameOf("blue"))}</span>
          </div>
        </div>

        <div className={`table-stage ${active ? "table-stage-active" : ""}`}>
          <canvas ref={canvasRef} className="foosball-canvas"
            aria-label="Interactive foosball table. Move your mouse vertically to control the selected rod; hold and release to shoot."
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()} />
          {!paused && phase === "countdown" && <div className="kickoff-countdown" aria-live="polite"><span>KICK OFF</span><strong>{countdown}</strong></div>}
          {!paused && phase === "goal" && <div className="goal-callout"><span>GOAL!</span><strong>{lastScorer ? nameOf(lastScorer) : ""} SCORES</strong></div>}
          {!paused && phase === "playing" && <div className="table-live-label"><span /> LIVE · FIRST TO {target}</div>}
          {!connected && phase === "playing" && <div className="opponent-warning"><span /> RECONNECTING</div>}
          {side && <div className="charge-tip"><span className="charge-dot" />MOVE ROD · HOLD &amp; RELEASE TO SHOOT</div>}
          {paused && (
            <div className="match-overlay pause-overlay">
              <div className="pause-emblem"><Icon name="pause" size={22} /></div>
              <small>MATCH PAUSED</small><h2>Take a breather.</h2>
              <p>The online table stays live while you’re away.</p>
              <button className="overlay-primary" onClick={() => setPaused(false)}>BACK TO THE TABLE <Icon name="arrow" size={15} /></button>
            </div>
          )}
        </div>

        {side && (
          <div className="touch-control-bar" aria-label="Touch controls">
            <div className="touch-rod-select"><span>ROD {selectedRod + 1}</span>
              <button onClick={() => selectRod((selectedRod + 3) % 4)} aria-label="Select previous rod">‹</button>
              <button onClick={() => selectRod((selectedRod + 1) % 4)} aria-label="Select next rod">›</button></div>
            <div className="touch-arrows">
              <button onClick={() => bump(-28)} aria-label="Move selected rod up">↑</button>
              <button onClick={() => bump(28)} aria-label="Move selected rod down">↓</button></div>
            <button className="touch-kick"
              onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); g.current.charge = performance.now(); g.current.pointerDown = true; }}
              onPointerUp={(e) => { e.preventDefault(); fireSelected(performance.now() - (g.current.charge ?? performance.now())); }}
              onPointerCancel={() => fireSelected(performance.now() - (g.current.charge ?? performance.now()))}>
              <Icon name="bolt" size={16} /> HOLD TO KICK</button>
          </div>
        )}

        <div className="arena-footer">
          <div className="target-select"><span>FIRST TO</span>{[3, 5, 7, 10].map((n) => <button key={n} className={target === n ? "target-active" : ""} disabled>{n}</button>)}</div>
          <span className="footer-separator" />
          <div className="selected-rod-label"><span className={`rod-color ${side ?? "red"}`} />{side ? `${side.toUpperCase()} ROD ${selectedRod + 1}` : "SPECTATING"}</div>
          <div className="arena-footer-actions">
            {side && <button className="footer-icon-button" onClick={() => { setPaused(!paused); soundFn.current("ui"); }} aria-label="Pause match"><Icon name="pause" size={15} /></button>}
            <button className="footer-icon-button" onClick={() => { setModal(true); soundFn.current("ui"); }} aria-label="Open controls and sound settings"><Icon name="settings" size={15} /></button>
          </div>
        </div>
      </section>

      {toast && <div className="toast-message" role="status"><span>✓</span>{toast}</div>}

      {modal && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setModal(false); setCapturing(null); } }}>
          <section className="modal-card settings-modal" role="dialog" aria-modal="true" aria-label="Game settings">
            <button className="modal-close" onClick={() => { setModal(false); setCapturing(null); }} aria-label="Close"><Icon name="close" size={18} /></button>
            <div className="modal-eyebrow"><span /> PERSONALIZE YOUR TABLE</div><h2>Make it<br /><em>your game.</em></h2>
            <div className="settings-section">
              <div className="settings-title"><span>01</span><div><strong>Sound &amp; feedback</strong><small>Lightweight synthesized arcade sounds</small></div>
                <button className={`mute-button ${muted ? "muted" : ""}`} onClick={() => setMuted(!muted)} aria-label={muted ? "Unmute sounds" : "Mute sounds"}><Icon name="volume" size={17} />{muted ? "MUTED" : "SOUND ON"}</button></div>
              <label className="range-setting"><span>GAME EFFECTS</span><input type="range" min="0" max="1" step="0.01" value={effectsVolume} onChange={(e) => setEffectsVolume(Number(e.target.value))} /><b>{Math.round(effectsVolume * 100)}%</b></label>
              <label className="range-setting"><span>UI CLICKS</span><input type="range" min="0" max="1" step="0.01" value={interfaceVolume} onChange={(e) => setInterfaceVolume(Number(e.target.value))} /><b>{Math.round(interfaceVolume * 100)}%</b></label>
            </div>
            <div className="settings-section">
              <div className="settings-title"><span>02</span><div><strong>Table &amp; match</strong><small>Cosmetic only. Skill wins games.</small></div></div>
              <div className="theme-picker">{THEME_ORDER.map((th) => <button className={tableTheme === th ? "theme-option theme-option-active" : "theme-option"} key={th} onClick={() => setTableTheme(th)}><i className={`theme-swatch-inner theme-${th}`} />{THEME_NAMES[th]}</button>)}</div>
              <div className="settings-match-options"><label><input type="checkbox" checked={assisted} onChange={(e) => setAssisted(e.target.checked)} /><span><strong>Beginner-friendly assist</strong><small>Gently biases shots toward the more-open goal lane.</small></span></label></div>
            </div>
            <div className="settings-section controls-settings">
              <div className="settings-title"><span>03</span><div><strong>Control mapping</strong><small>Click a key, then press its replacement.</small></div></div>
              <div className="keybind-grid">{(["up", "down", "previous", "next", "shoot", "pause"] as ControlAction[]).map((action) => (
                <div className="keybind-row" key={action}><span>{action === "up" ? "Move up" : action === "down" ? "Move down" : action === "previous" ? "Previous rod" : action === "next" ? "Next rod" : action === "shoot" ? "Shoot / kick" : "Pause / menu"}</span>
                  <button className={capturing === action ? "keybind-key keybind-listening" : "keybind-key"} onClick={() => setCapturing(action)}>{capturing === action ? "PRESS KEY…" : showKey(bindings[action])}</button></div>
              ))}</div>
            </div>
            <button className="modal-action-wide settings-done" onClick={() => { setModal(false); setCapturing(null); }}>DONE <Icon name="arrow" size={15} /></button>
          </section>
        </div>
      )}
    </div>
  );
}
