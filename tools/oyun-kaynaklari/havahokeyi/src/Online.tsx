/* NEON RINK — çevrimiçi mod.
 * Görünüm, çizim, efekt, ses ve HUD referans oyunla aynıdır (App.tsx'ten gelen
 * yardımcılar). Fizik sunucuda çalışır; bu bileşen sunucudan gelen kareleri
 * (üst pencere postMessage ile iletir) yumuşatıp çizer, kendi tokmağını
 * yerelde tahmin eder ve hedef noktasını üst pencereye yollar. */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE } from "react";
import {
  CENTER_X, CENTER_Y, COLOR_OPTIONS, ColorPicker, FIELD_BOTTOM, FIELD_LEFT, FIELD_RIGHT, FIELD_TOP,
  MALLET_RADIUS, PUCK_RADIUS, TABLE_HEIGHT, TABLE_WIDTH, drawMallet, makeRinkCanvas, mixColor, rgba,
  type Mallet,
} from "./App";

type P2 = [number, number];
type Frame = {
  t?: number;
  faz: string; fazSn: number;
  disk: { x: number; y: number; vx: number; vy: number };
  tokmak: { x: number; y: number }[];
  skor: P2; setler: P2; renk: [string, string]; setSonu: boolean;
  sonGolAtan: number | null; status: string; olayNo: number; sonOlay: string;
};
type Init = {
  seat: number | null; names: [string, string]; state: Partial<Frame> & { maxSet?: number; golHedefi?: number };
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; size: number; color: string };

const PUCK_COLOR = "#f8fafc";
const LS_SES = "gv-ses";
const post = (m: Record<string, unknown>) => { try { window.parent.postMessage({ src: "havahokeyi", ...m }, "*"); } catch { /* */ } };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/* ---- ses (referanstaki tonlar) ---- */
let audio: AudioContext | null = null;
function playSound(kind: "hit" | "wall" | "goal" | "tick" | "start", power = 1) {
  try { if (localStorage.getItem(LS_SES) === "off") return; } catch { /* */ }
  if (!audio) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (C) audio = new C();
  }
  if (!audio) return;
  if (audio.state === "suspended") void audio.resume();
  const a = audio;
  const tone = (f: number, d: number, v: number, delay = 0, type: OscillatorType = "sine", end?: number) => {
    const o = a.createOscillator(); const g = a.createGain(); const s = a.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f, s);
    if (end) o.frequency.exponentialRampToValueAtTime(end, s + d);
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), s + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, s + d);
    o.connect(g); g.connect(a.destination); o.start(s); o.stop(s + d + 0.02);
  };
  if (kind === "hit") { tone(150 + power * 110, 0.075, 0.055, 0, "triangle", 80); tone(640 + power * 140, 0.035, 0.022, 0, "square", 300); }
  else if (kind === "wall") tone(125, 0.04, 0.025, 0, "triangle", 72);
  else if (kind === "tick") tone(440, 0.07, 0.035, 0, "sine", 520);
  else if (kind === "start") { tone(520, 0.08, 0.045, 0, "square", 660); tone(780, 0.13, 0.05, 0.08, "square", 980); }
  else { tone(196, 0.23, 0.065, 0, "sawtooth", 392); tone(523, 0.18, 0.05, 0.08, "square", 784); tone(784, 0.32, 0.055, 0.19, "sine", 1046); }
}

type G = {
  prev: Frame | null; cur: Frame | null; curAt: number; interval: number;
  /* ağ gecikmesine dayanıklı oynatma: sunucu saatiyle damgalı kare tamponu */
  buf: Frame[]; offs: { a: number; v: number }[]; off: number; jit: number; hist: { t: number; x: number; y: number }[];
  seat: number | null; names: [string, string]; renk: [string, string];
  maxSet: number; golHedefi: number;
  olayNo: number | null; lastFaz: string; lastTick: number;
  particles: Particle[]; trail: { x: number; y: number }[];
  shake: number; flash: number; flashSide: number;
  banner: string; bannerTime: number;
  me: { x: number; y: number } | null; meAt: number;
  target: { x: number; y: number } | null; keyPos: { x: number; y: number } | null;
  keys: Set<string>; pointer: number | null; lastSend: number; lastSent: string;
  pred: { x: number; y: number; vx: number; vy: number; t0: number; h: number | null } | null; predBlock: number; delay: number;
  vt: number; mvx: number; mvy: number; prevMe: { x: number; y: number; t: number } | null; lastClaim: number;
};

/* Yerel vuruş tahmini: sunucudaki disk–tokmak çarpışmasının (havahokeyi-engine.js) birebir kopyası. */
const DISK_TAVANI = 1300, ESNEKLIK = 0.88, TOKMAK_ETKISI = 0.82;
function hitDisk(d: { x: number; y: number; vx: number; vy: number }, m: { x: number; y: number }, mvx: number, mvy: number) {
  const R = MALLET_RADIUS + PUCK_RADIUS;
  const dx = d.x - m.x, dy = d.y - m.y; const k2 = dx * dx + dy * dy;
  if (k2 >= R * R) return null;
  const u = Math.sqrt(k2) || 0.001; const nx = dx / u, ny = dy / u;
  let vx = d.vx, vy = d.vy;
  const bn = (vx - mvx) * nx + (vy - mvy) * ny;
  if (bn >= 0) return null;                       // uzaklaşıyor / teğet: tahmin yok, sunucu karar versin
  const vdn = vx * nx + vy * ny; const tn = (mvx * nx + mvy * ny) * TOKMAK_ETKISI;
  const yeni = (1 + ESNEKLIK) * tn - ESNEKLIK * vdn;
  vx += (yeni - vdn) * nx; vy += (yeni - vdn) * ny;
  const tgv = mvx * -ny + mvy * nx; vx += -ny * tgv * 0.03; vy += nx * tgv * 0.03;
  const h = Math.hypot(vx, vy); if (h > DISK_TAVANI) { vx = vx / h * DISK_TAVANI; vy = vy / h * DISK_TAVANI; }
  return { x: m.x + nx * (R + 0.6), y: m.y + ny * (R + 0.6), vx, vy };
}
function advanceDisk(d: { x: number; y: number; vx: number; vy: number }, dt: number) {
  const dr = Math.pow(0.9992, dt * 60); d.vx *= dr; d.vy *= dr; d.x += d.vx * dt; d.y += d.vy * dt;
  if (d.y - PUCK_RADIUS < FIELD_TOP) { d.y = FIELD_TOP + PUCK_RADIUS; d.vy = Math.abs(d.vy) * 0.97; }
  else if (d.y + PUCK_RADIUS > FIELD_BOTTOM) { d.y = FIELD_BOTTOM - PUCK_RADIUS; d.vy = -Math.abs(d.vy) * 0.97; }
  const mouth = d.y > 205 && d.y < 395;
  if (!mouth && d.x - PUCK_RADIUS < FIELD_LEFT) { d.x = FIELD_LEFT + PUCK_RADIUS; d.vx = Math.abs(d.vx) * 0.97; }
  else if (!mouth && d.x + PUCK_RADIUS > FIELD_RIGHT) { d.x = FIELD_RIGHT - PUCK_RADIUS; d.vx = -Math.abs(d.vx) * 0.97; }
}

export default function Online() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const claimRef = useRef<(() => Record<string, number | undefined>) | null>(null);
  const g = useRef<G>({
    prev: null, cur: null, curAt: 0, interval: 20, buf: [], offs: [], off: 0, jit: 0, hist: [], seat: null, names: ["Oyuncu 1", "Oyuncu 2"],
    renk: ["#22d3ee", "#fb4d6d"], maxSet: 3, golHedefi: 5, olayNo: null, lastFaz: "", lastTick: -1,
    particles: [], trail: [], shake: 0, flash: 0, flashSide: 0, banner: "FACE OFF", bannerTime: 0.65,
    me: null, meAt: 0, target: null, keyPos: null, keys: new Set(), pointer: null, lastSend: 0, lastSent: "",
    pred: null, predBlock: 0, delay: 60,
    vt: 0, mvx: 0, mvy: 0, prevMe: null, lastClaim: 0,
  });
  const [ready, setReady] = useState(false);
  const [seat, setSeat] = useState<number | null>(null);
  const [names, setNames] = useState<[string, string]>(["Oyuncu 1", "Oyuncu 2"]);
  const [renk, setRenk] = useState<[string, string]>(["#22d3ee", "#fb4d6d"]);
  const [skor, setSkor] = useState<P2>([0, 0]);
  const [setler, setSetler] = useState<P2>([0, 0]);
  const [lastScorer, setLastScorer] = useState<number | null>(null);
  const [maxSet, setMaxSet] = useState(3);
  const [golHedefi, setGolHedefi] = useState(5);
  const [palette, setPalette] = useState(false);
  const ters = seat === 1;
  const rinkRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);

  const spawnImpact = useCallback((x: number, y: number, color: string, nx: number, ny: number, power: number) => {
    const count = Math.min(13, 4 + Math.floor(power * 8));
    for (let i = 0; i < count; i += 1) {
      const angle = Math.atan2(ny, nx) + (Math.random() - 0.5) * 2.2;
      const speed = 80 + Math.random() * 280 * power;
      g.current.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 0.18 + Math.random() * 0.24, maxLife: 0.42, size: 1.5 + Math.random() * 4, color });
    }
  }, []);

  /* ---- yeni kare ---- */
  const onFrame = useCallback((f: Frame) => {
    const s = g.current;
    const now = performance.now();
    if (s.curAt) { const d = now - s.curAt; if (d > 4 && d < 400) s.interval = s.interval * 0.9 + d * 0.1; }
    s.prev = s.cur || f; s.cur = f; s.curAt = now;
    /* saat farkı: varış − sunucu damgası; en küçük değer ≈ en hızlı yol (taban gecikme) */
    if (typeof f.t === "number" && isFinite(f.t)) {
      const sample = now - f.t;
      s.offs.push({ a: now, v: sample });
      while (s.offs.length && now - s.offs[0].a > 5000) s.offs.shift();
      let mn = Infinity; for (const o of s.offs) if (o.v < mn) mn = o.v;
      s.off = mn;
      s.jit = s.jit * 0.92 + Math.max(0, sample - mn) * 0.08;
      s.buf.push(f);
      if (s.buf.length > 60) s.buf.shift();
    }

    if (f.renk && (f.renk[0] !== s.renk[0] || f.renk[1] !== s.renk[1])) { s.renk = [f.renk[0], f.renk[1]]; setRenk(s.renk); }
    setSkor((o) => (o[0] === f.skor[0] && o[1] === f.skor[1] ? o : [f.skor[0], f.skor[1]]));
    setSetler((o) => (f.setler && (o[0] !== f.setler[0] || o[1] !== f.setler[1]) ? [f.setler[0], f.setler[1]] : o));

    /* geri sayım sesleri */
    if (f.faz === "gerisayim") {
      const n = Math.max(1, Math.ceil(f.fazSn));
      if (n !== s.lastTick) { s.lastTick = n; playSound("tick"); }
    } else s.lastTick = -1;
    if (s.lastFaz === "gerisayim" && f.faz === "oyun") { playSound("start"); s.banner = ""; s.bannerTime = 0; }
    s.lastFaz = f.faz;

    /* olaylar */
    if (s.olayNo === null) { s.olayNo = f.olayNo; return; }
    if (f.olayNo === s.olayNo) return;
    s.olayNo = f.olayNo;
    const d = f.disk;
    if (f.sonOlay === "gol" && f.sonGolAtan !== null && f.sonGolAtan !== undefined) {
      const scorer = f.sonGolAtan;
      const color = f.renk ? f.renk[scorer] : s.renk[scorer];
      const goalX = scorer === 0 ? FIELD_RIGHT : FIELD_LEFT;
      s.flash = 1; s.flashSide = scorer; s.shake = 17; s.trail = [];
      for (let i = 0; i < 58; i += 1) {
        const angle = Math.random() * Math.PI * 2; const sp = 130 + Math.random() * 620;
        s.particles.push({ x: goalX, y: CENTER_Y + (Math.random() - 0.5) * 130, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp,
          life: 0.45 + Math.random() * 0.65, maxLife: 1.1, size: 2 + Math.random() * 7, color: i % 4 === 0 ? "#ffffff" : color });
      }
      playSound("goal");
      const nm = s.names[scorer] || "Oyuncu";
      const bitti = f.faz === "bitti" || f.status === "finished";
      s.banner = bitti ? `${nm} KAZANDI` : f.setSonu ? `${nm} SETİ ALDI` : `${nm} GOL!`;
      s.bannerTime = bitti ? 1.4 : f.setSonu ? 1.25 : 0.9;
      setLastScorer(scorer);
    } else if (f.sonOlay === "vurus") {
      const m0 = f.tokmak[0], m1 = f.tokmak[1];
      const d0 = Math.hypot(d.x - m0.x, d.y - m0.y), d1 = Math.hypot(d.x - m1.x, d.y - m1.y);
      const i = d0 < d1 ? 0 : 1; const m = f.tokmak[i];
      const dist = Math.min(d0, d1) || 1;
      const nx = (d.x - m.x) / dist, ny = (d.y - m.y) / dist;
      const power = Math.min(1, Math.max(90, Math.hypot(d.vx, d.vy) * 0.6) / 850);
      s.shake = Math.max(s.shake, 2.5 + power * 5);
      spawnImpact(d.x - nx * PUCK_RADIUS, d.y - ny * PUCK_RADIUS, (f.renk || s.renk)[i], nx, ny, power);
      playSound("hit", power);
    } else if (f.sonOlay === "duvar") {
      s.shake = Math.max(s.shake, 3.4);
      playSound("wall");
    }
  }, [spawnImpact]);

  /* ---- üst pencere mesajları ---- */
  useEffect(() => {
    const on = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.dst !== "havahokeyi") return;
      const s = g.current;
      if (d.t === "init") {
        const init = d as Init & { t: string };
        s.seat = init.seat === 0 || init.seat === 1 ? init.seat : null;
        s.names = init.names; s.maxSet = init.state.maxSet || 3; s.golHedefi = init.state.golHedefi || 5;
        s.cur = null; s.prev = null; s.buf = []; s.offs = []; s.hist = []; s.olayNo = null; s.me = null; s.target = null; s.keyPos = null;
        setSeat(s.seat); setNames(init.names); setMaxSet(s.maxSet); setGolHedefi(s.golHedefi);
        if (init.state.renk) { s.renk = [init.state.renk[0], init.state.renk[1]]; setRenk(s.renk); }
        if (init.state.skor) setSkor([init.state.skor[0], init.state.skor[1]]);
        if (init.state.setler) setSetler([init.state.setler[0], init.state.setler[1]]);
        setReady(true);
      } else if (d.t === "frame" && d.f) onFrame(d.f as Frame);
    };
    window.addEventListener("message", on);
    post({ t: "ready" });
    return () => window.removeEventListener("message", on);
  }, [onFrame]);

  /* ---- klavye ---- */
  useEffect(() => {
    const keysOf = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    const dn = (e: KeyboardEvent) => { if (keysOf.has(e.code) && g.current.seat !== null) { e.preventDefault(); g.current.keys.add(e.code); } };
    const up = (e: KeyboardEvent) => g.current.keys.delete(e.code);
    const bl = () => g.current.keys.clear();
    window.addEventListener("keydown", dn); window.addEventListener("keyup", up); window.addEventListener("blur", bl);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); window.removeEventListener("blur", bl); };
  }, []);

  /* ---- çizim + yerel tokmak ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const resize = () => {
      const b = canvas.getBoundingClientRect();
      const r = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(b.width * r)), h = Math.max(1, Math.round(b.height * r));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    const ro = new ResizeObserver(resize); ro.observe(canvas); resize();
    let raf = 0; let last = performance.now();

    const constrain = (m: { x: number; y: number }, p: number) => {
      const pad = 7;
      const minX = p === 0 ? FIELD_LEFT + MALLET_RADIUS + pad : CENTER_X + MALLET_RADIUS + 8;
      const maxX = p === 0 ? CENTER_X - MALLET_RADIUS - 8 : FIELD_RIGHT - MALLET_RADIUS - pad;
      m.x = clamp(m.x, minX, maxX); m.y = clamp(m.y, FIELD_TOP + MALLET_RADIUS + pad, FIELD_BOTTOM - MALLET_RADIUS - pad);
    };

    /* Gecikme telafisi: "ekranda gördüğüm an" + tokmağımın konumu/hızı */
    const claim = () => {
      const s = g.current;
      return s.me && s.vt ? { vt: Math.round(s.vt * 10) / 10, px: Math.round(s.me.x * 10) / 10, py: Math.round(s.me.y * 10) / 10, mvx: Math.round(s.mvx), mvy: Math.round(s.mvy) } : {};
    };
    claimRef.current = claim;
    const send = (x: number, y: number, force = false) => {
      const s = g.current; const t = performance.now();
      if (!force && t - s.lastSend < 16) return;
      const k = Math.round(x) + "," + Math.round(y);
      if (!force && k === s.lastSent && t - s.lastSend < 250) return;
      s.lastSend = t; s.lastSent = k;
      post({ t: "move", x: Math.round(x), y: Math.round(y), ...claim() });
    };

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      const s = g.current;
      const dt = Math.min(0.05, (time - last) / 1000); last = time;
      const f = s.cur;
      const rotated = s.seat === 1;

      /* interpolasyon: sunucu saatiyle geriden oynat (jitter tamponu) */
      let disk = f ? f.disk : null; let mal: { x: number; y: number }[] = f ? f.tokmak.map((t) => ({ x: t.x, y: t.y })) : [];
      if (f && s.buf.length >= 2 && typeof f.t === "number") {
        const delay = clamp(s.interval * 1.5 + s.jit * 2 + 14, 40, 150);
        const rt = time - s.off - delay;           // gösterilecek sunucu zamanı
        s.vt = rt; s.delay = delay;
        const bf = s.buf; let i = -1;
        for (let n = bf.length - 1; n >= 0; n -= 1) { if ((bf[n].t as number) <= rt) { i = n; break; } }
        if (i < 0) { disk = bf[0].disk; mal = bf[0].tokmak.map((t) => ({ x: t.x, y: t.y })); }
        else if (i === bf.length - 1) {
          /* tampon tükendi: diski hızıyla kısa süre ileri taşı */
          const a = bf[i]; const dts = Math.min(0.08, (rt - (a.t as number)) / 1000);
          disk = a.faz === "oyun" ? { x: a.disk.x + a.disk.vx * dts, y: a.disk.y + a.disk.vy * dts, vx: a.disk.vx, vy: a.disk.vy } : a.disk;
          mal = a.tokmak.map((t) => ({ x: t.x, y: t.y }));
        } else {
          const a = bf[i], b = bf[i + 1];
          const span = Math.max(1, (b.t as number) - (a.t as number));
          const k = clamp((rt - (a.t as number)) / span, 0, 1);
          const jump = Math.hypot(b.disk.x - a.disk.x, b.disk.y - a.disk.y) > 160 || a.faz !== b.faz;
          disk = jump ? (k < 0.5 ? a.disk : b.disk)
            : { x: a.disk.x + (b.disk.x - a.disk.x) * k, y: a.disk.y + (b.disk.y - a.disk.y) * k, vx: b.disk.vx, vy: b.disk.vy };
          mal = b.tokmak.map((t, n) => {
            const o = a.tokmak[n];
            if (!o || Math.hypot(t.x - o.x, t.y - o.y) > 220) return { x: t.x, y: t.y };
            return { x: o.x + (t.x - o.x) * k, y: o.y + (t.y - o.y) * k };
          });
        }
      } else if (f && s.prev && s.prev !== f) {
        const k = clamp((time - s.curAt) / Math.max(16, s.interval), 0, 1);
        const a = s.prev, b = f;
        disk = { x: a.disk.x + (b.disk.x - a.disk.x) * k, y: a.disk.y + (b.disk.y - a.disk.y) * k, vx: b.disk.vx, vy: b.disk.vy };
        mal = b.tokmak.map((t, i) => { const o = a.tokmak[i]; return o ? { x: o.x + (t.x - o.x) * k, y: o.y + (t.y - o.y) * k } : t; });
      }

      /* kendi tokmağım: yerel tahmin */
      if (f && s.seat !== null && f.tokmak[s.seat]) {
        const sv = f.tokmak[s.seat];
        if (!s.me) s.me = { x: sv.x, y: sv.y };
        const playing = f.status === "playing";
        /* klavye: ekran yönünde 710 u/s sanal hedef */
        const kk = s.keys;
        let hx = Number(kk.has("KeyD") || kk.has("ArrowRight")) - Number(kk.has("KeyA") || kk.has("ArrowLeft"));
        let hy = Number(kk.has("KeyS") || kk.has("ArrowDown")) - Number(kk.has("KeyW") || kk.has("ArrowUp"));
        if (rotated) { hx = -hx; hy = -hy; }
        const mag = Math.hypot(hx, hy);
        if (mag > 0 && playing) {
          if (!s.keyPos) s.keyPos = { x: s.me.x, y: s.me.y };
          s.keyPos.x += (hx / mag) * 710 * dt; s.keyPos.y += (hy / mag) * 710 * dt;
          constrain(s.keyPos, s.seat);
          s.target = { x: s.keyPos.x, y: s.keyPos.y };
          send(s.target.x, s.target.y);
        } else if (s.keyPos) {
          s.keyPos = null;
          if (s.pointer === null) { s.target = { x: s.me.x, y: s.me.y }; send(s.me.x, s.me.y, true); }
        }
        if (s.target) {
          const dx = s.target.x - s.me.x, dy = s.target.y - s.me.y; const dist = Math.hypot(dx, dy);
          const step = Math.min(dist, 1500 * dt);
          if (dist > 0.001) { s.me.x += (dx / dist) * step; s.me.y += (dy / dist) * step; }
        }
        /* Uzlaşma: sunucudaki tokmak ağ gecikmesi kadar GERİDEDİR; şimdiki tahminle
           kıyaslamak yerine yakın geçmişimdeki izle kıyasla. İz üzerindeyse
           sapma yok (yalnız gecikme) → dokunma; gerçekten ayrıştıysa nazikçe çek. */
        s.hist.push({ t: time, x: s.me.x, y: s.me.y });
        while (s.hist.length && time - s.hist[0].t > 1100) s.hist.shift();
        let best = Infinity;
        for (const h of s.hist) { const dd = Math.hypot(h.x - sv.x, h.y - sv.y); if (dd < best) best = dd; }
        if (!playing || best > 170) { s.me.x = sv.x; s.me.y = sv.y; s.hist = []; }
        else if (best > 32) { const c = Math.min(1, dt * 5); s.me.x += (sv.x - s.me.x) * c; s.me.y += (sv.y - s.me.y) * c; }
        constrain(s.me, s.seat);
        mal[s.seat] = { x: s.me.x, y: s.me.y };
        /* tokmak hızı (yumuşatılmış) + disk yakındaysa vuruş talebini sık yolla */
        if (s.prevMe && time > s.prevMe.t) {
          const ddt = (time - s.prevMe.t) / 1000;
          s.mvx = s.mvx * 0.5 + ((s.me.x - s.prevMe.x) / ddt) * 0.5; s.mvy = s.mvy * 0.5 + ((s.me.y - s.prevMe.y) / ddt) * 0.5;
        }
        s.prevMe = { x: s.me.x, y: s.me.y, t: time };
        if (playing && disk && s.vt && time - s.lastClaim >= 16 &&
            Math.hypot(disk.x - s.me.x, disk.y - s.me.y) < MALLET_RADIUS + PUCK_RADIUS + 90) {
          s.lastClaim = time;
          const tg = s.target || s.me;
          post({ t: "move", x: Math.round(tg.x), y: Math.round(tg.y), ...claim() });
        }
      }

      /* YEREL VURUŞ TAHMİNİ: ekranda tokmağım diske değdiği an disk hemen tepki verir
         (sunucu onayı ağ gecikmesi kadar sonra gelir; o zamana kadar tahmini gösteririz). */
      if (s.seat !== null && s.me && disk && f && f.status === "playing" && f.faz === "oyun" && s.vt) {
        if (!s.pred && time > s.predBlock) {
          const c = hitDisk(disk, s.me, s.mvx, s.mvy);
          if (c) {
            let el = Math.min(0.25, (s.delay + 25) / 1000);
            while (el > 1e-4) { const st2 = Math.min(1 / 120, el); advanceDisk(c, st2); el -= st2; }
            s.pred = { ...c, t0: time, h: null }; s.predBlock = time + 380;
          }
        }
      } else if (s.pred && (!f || f.faz !== "oyun")) s.pred = null;
      if (s.pred && disk) {
        const pr = s.pred; advanceDisk(pr, dt);
        const age = time - pr.t0; const gap = Math.hypot(disk.x - pr.x, disk.y - pr.y);
        if (pr.h === null && ((age > 150 && gap < 45) || (age > 260 && gap > 110) || age > 650)) pr.h = time;
        if (pr.h === null) disk = { x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy };
        else {
          const k = Math.min(1, (time - pr.h) / 160);
          disk = { x: pr.x + (disk.x - pr.x) * k, y: pr.y + (disk.y - pr.y) * k, vx: disk.vx, vy: disk.vy };
          if (k >= 1) s.pred = null;
        }
      }

      /* parçacık ve sayaçlar (referanstaki gibi) */
      for (const p of s.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.975, dt * 60); p.vy *= Math.pow(0.975, dt * 60); p.life -= dt; }
      s.particles = s.particles.filter((p) => p.life > 0).slice(-180);
      s.shake = Math.max(0, s.shake - dt * 28); s.flash = Math.max(0, s.flash - dt * 1.8);
      s.bannerTime = Math.max(0, s.bannerTime - dt);

      /* çizim */
      const key = s.renk.join("|");
      if (!rinkRef.current || rinkRef.current.key !== key) rinkRef.current = { key, canvas: makeRinkCanvas(s.renk[0], s.renk[1], false) };
      const W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.setTransform(W / TABLE_WIDTH, 0, 0, H / TABLE_HEIGHT, 0, 0);
      if (rotated) { ctx.translate(TABLE_WIDTH, TABLE_HEIGHT); ctx.rotate(Math.PI); }
      ctx.save();
      if (s.shake > 0 && f && f.status === "playing") ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
      ctx.drawImage(rinkRef.current.canvas, 0, 0);
      if (disk && f && f.faz === "oyun") { s.trail.push({ x: disk.x, y: disk.y }); if (s.trail.length > 15) s.trail.shift(); }
      else if (!f || f.faz !== "oyun") s.trail = [];
      for (let i = 0; i < s.trail.length; i += 1) {
        const pt = s.trail[i]; const pr = (i + 1) / s.trail.length;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, PUCK_RADIUS * pr * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = rgba(PUCK_COLOR, pr * 0.12); ctx.fill();
      }
      for (const p of s.particles) {
        const al = Math.max(0, p.life / p.maxLife);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * al, 0, Math.PI * 2);
        ctx.fillStyle = rgba(p.color, Math.min(1, al * 1.4)); ctx.fill();
      }
      if (f) {
        mal.forEach((m, i) => drawMallet(ctx, { x: m.x, y: m.y, vx: 0, vy: 0, radius: MALLET_RADIUS, cooldown: 0 } as Mallet, s.renk[i]));
      }
      if (disk) {
        ctx.save();
        ctx.shadowColor = rgba(PUCK_COLOR, 0.8); ctx.shadowBlur = 22;
        const pg = ctx.createRadialGradient(disk.x - 7, disk.y - 8, 2, disk.x, disk.y, PUCK_RADIUS);
        pg.addColorStop(0, mixColor(PUCK_COLOR, 0.72)); pg.addColorStop(0.35, PUCK_COLOR); pg.addColorStop(1, mixColor(PUCK_COLOR, -0.7));
        ctx.beginPath(); ctx.arc(disk.x, disk.y, PUCK_RADIUS, 0, Math.PI * 2); ctx.fillStyle = pg; ctx.fill();
        ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(255, 255, 255, 0.45)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.beginPath(); ctx.arc(disk.x, disk.y, PUCK_RADIUS * 0.46, 0, Math.PI * 2); ctx.strokeStyle = "rgba(0, 0, 0, 0.25)"; ctx.stroke();
        ctx.restore();
      }
      if (s.flash > 0) {
        const fg = ctx.createLinearGradient(s.flashSide === 0 ? TABLE_WIDTH : 0, 0, s.flashSide === 0 ? TABLE_WIDTH * 0.35 : TABLE_WIDTH * 0.65, 0);
        fg.addColorStop(0, rgba(s.renk[s.flashSide], s.flash * 0.42)); fg.addColorStop(1, rgba(s.renk[s.flashSide], 0));
        ctx.fillStyle = fg; ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);
      }
      ctx.restore();
      ctx.restore();
      /* yazılar masa dönse de düz görünür */
      ctx.save();
      ctx.setTransform(W / TABLE_WIDTH, 0, 0, H / TABLE_HEIGHT, 0, 0);
      if (s.bannerTime > 0 && s.banner) {
        const al = Math.min(1, s.bannerTime * 2.4);
        ctx.textAlign = "center"; ctx.font = "900 42px Arial, sans-serif";
        ctx.fillStyle = `rgba(239, 252, 255, ${al})`; ctx.shadowColor = "rgba(34, 211, 238, 0.6)"; ctx.shadowBlur = 24;
        ctx.fillText(s.banner, CENTER_X, CENTER_Y - 78); ctx.shadowBlur = 0;
      } else if (f && f.faz === "gerisayim" && f.fazSn > 0 && f.fazSn <= 3) {
        ctx.textAlign = "center"; ctx.font = "900 74px Arial, sans-serif";
        ctx.fillStyle = "rgba(239, 252, 255, 0.92)"; ctx.shadowColor = "rgba(34, 211, 238, 0.75)"; ctx.shadowBlur = 28;
        ctx.fillText(String(Math.max(1, Math.ceil(f.fazSn))), CENTER_X, CENTER_Y + 25); ctx.shadowBlur = 0;
      }
      ctx.restore();
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [ready]);

  /* ---- işaretçi ---- */
  const tablePoint = (e: RPE<HTMLCanvasElement>) => {
    const b = e.currentTarget.getBoundingClientRect();
    let x = ((e.clientX - b.left) / b.width) * TABLE_WIDTH, y = ((e.clientY - b.top) / b.height) * TABLE_HEIGHT;
    if (ters) { x = TABLE_WIDTH - x; y = TABLE_HEIGHT - y; }
    return { x, y };
  };
  const aim = (e: RPE<HTMLCanvasElement>) => {
    const s = g.current; if (s.seat === null) return;
    const p = tablePoint(e);
    const q = { x: p.x, y: p.y };
    const mn = s.seat === 0 ? FIELD_LEFT + MALLET_RADIUS + 7 : CENTER_X + MALLET_RADIUS + 8;
    const mx = s.seat === 0 ? CENTER_X - MALLET_RADIUS - 8 : FIELD_RIGHT - MALLET_RADIUS - 7;
    q.x = clamp(q.x, mn, mx); q.y = clamp(q.y, FIELD_TOP + MALLET_RADIUS + 7, FIELD_BOTTOM - MALLET_RADIUS - 7);
    s.target = q;
    const t = performance.now();
    if (t - s.lastSend >= 16) { s.lastSend = t; post({ t: "move", x: Math.round(q.x), y: Math.round(q.y), ...(claimRef.current ? claimRef.current() : {}) }); }
  };
  const onDown = (e: RPE<HTMLCanvasElement>) => {
    const s = g.current; if (s.seat === null) return;
    e.preventDefault(); s.pointer = e.pointerId;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* */ }
    aim(e);
  };
  const onMove = (e: RPE<HTMLCanvasElement>) => {
    const s = g.current; if (s.seat === null) return;
    if (e.pointerType !== "mouse" && s.pointer !== e.pointerId) return;
    e.preventDefault(); aim(e);
  };
  const onUp = (e: RPE<HTMLCanvasElement>) => { if (g.current.pointer === e.pointerId) g.current.pointer = null; };

  const pickColor = (c: string) => {
    if (seat === null) return;
    const n: [string, string] = [renk[0], renk[1]]; n[seat] = c;
    g.current.renk = n; setRenk(n); post({ t: "renk", c });
  };

  const winsNeeded = Math.ceil(maxSet / 2);
  const order = ters ? [1, 0] : [0, 1];
  const setDots = (p: number) => Array.from({ length: winsNeeded }, (_, i) => (
    <span key={i} className={i < setler[p] ? "is-won" : ""} style={{ "--player-color": renk[p] } as CSSProperties} />
  ));
  const showPlayer = (p: number, right: boolean) => (
    <div className={`score-player ${right ? "score-player-two" : "score-player-one"}`}>
      <div className="player-name-line">
        {!right && <span className="player-color" style={{ backgroundColor: renk[p] }} />}
        <strong>{names[p]}{seat === p ? " (Siz)" : ""}</strong>
        {right && <span className="player-color" style={{ backgroundColor: renk[p] }} />}
      </div>
      <div className="set-dots" aria-label={`${setler[p]} set`}>{setDots(p)}</div>
    </div>
  );

  return (
    <main className="game-screen">
      <div className="game-ambient" aria-hidden="true" />
      <header className="game-header">
        <div className="game-brand"><span className="brand-slash">//</span><span>NEON RINK</span></div>
        <div className="scoreboard" aria-label="Maç skoru">
          {showPlayer(order[0], false)}
          <div className="goal-score">
            <span key={`l-${skor[order[0]]}`} className={lastScorer === order[0] ? "score-pop" : ""}>{skor[order[0]]}</span><b>:</b>
            <span key={`r-${skor[order[1]]}`} className={lastScorer === order[1] ? "score-pop" : ""}>{skor[order[1]]}</span>
            <small>{golHedefi} GOL / {maxSet} SET</small>
          </div>
          {showPlayer(order[1], true)}
        </div>
        <div className="game-actions">
          {seat !== null && (
            <button className="icon-button color-button" type="button" aria-label="Tutacak rengi seç" onClick={() => setPalette((v) => !v)}>
              <span className="color-dot" style={{ backgroundColor: renk[seat] }} />
            </button>
          )}
        </div>
      </header>

      <section className="rink-area" aria-label="Air hockey oyun masası">
        <div className="rink-shell">
          <canvas ref={canvasRef} className="game-canvas" onPointerDown={onDown} onPointerMove={onMove}
            onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()} />
          <div className="table-edge table-edge-left" style={{ background: renk[order[0]], boxShadow: `0 0 20px ${renk[order[0]]}` }} aria-hidden="true" />
          <div className="table-edge table-edge-right" style={{ background: renk[order[1]], boxShadow: `0 0 20px ${renk[order[1]]}` }} aria-hidden="true" />
          {palette && seat !== null && (
            <div className="game-overlay color-pop" onClick={() => setPalette(false)}>
              <div className="overlay-content overlay-enter" onClick={(e) => e.stopPropagation()}>
                <ColorPicker label="Tutacak rengin" value={renk[seat]} onChange={(v) => { pickColor(v); }} />
                <div className="overlay-actions"><button type="button" className="primary-action" onClick={() => setPalette(false)}>Tamam</button></div>
              </div>
            </div>
          )}
        </div>
      </section>
      <footer className="game-footer">
        <span><b>01</b> W A S D</span>
        <p>{seat === null ? "Maçı izliyorsun." : "Dokun ve sürükle. Kendi yarı alanında kal."}</p>
        <span><b>02</b> OK TUŞLARI</span>
      </footer>
    </main>
  );
}

export { COLOR_OPTIONS };
