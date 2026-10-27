/* NEON RINK — çevrimiçi mod.
 * Görünüm, çizim, efekt, ses ve HUD referans oyunla aynıdır (App.tsx'ten gelen
 * yardımcılar). Fizik sunucuda çalışır; bu bileşen sunucudan gelen kareleri
 * (üst pencere postMessage ile iletir) sunucu saatine göre ara değerleyip
 * çizer. KENDİ TOKMAĞI imlecin/parmağın TAM altındadır (gecikmesiz); her
 * konum, o an ekranda görülen diskin zamanıyla (vt) sunucuya yollanır ve
 * sunucu teması bu görüş anında arar. Rakibin tokmağı da onun görüş
 * zamanından (iz akışı) çizilir; böylece iki ekranda da temas aynıdır. */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPE } from "react";
import {
  CENTER_X, CENTER_Y, COLOR_OPTIONS, ColorPicker, FIELD_BOTTOM, FIELD_LEFT, FIELD_RIGHT, FIELD_TOP,
  MALLET_RADIUS, PUCK_RADIUS, TABLE_HEIGHT, TABLE_WIDTH, drawMallet, makeRinkCanvas, mixColor, rgba,
  type Mallet,
} from "./App";

type P2 = [number, number];
type Iz = { t: number; x: number; y: number };
type DiskS = { t: number; x: number; y: number; vx: number; vy: number };
type Frame = {
  t?: number;
  iz?: [Iz[], Iz[]]; duzelt?: DiskS[] | null;
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
  buf: Frame[]; offs: { a: number; v: number }[]; off: number; jit: number;
  seat: number | null; names: [string, string]; renk: [string, string];
  maxSet: number; golHedefi: number;
  olayNo: number | null; lastFaz: string; lastTick: number;
  particles: Particle[]; trail: { x: number; y: number }[];
  shake: number; flash: number; flashSide: number;
  banner: string; bannerTime: number;
  me: { x: number; y: number } | null;
  target: { x: number; y: number } | null; keyPos: { x: number; y: number } | null;
  keys: Set<string>; pointer: number | null; lastSend: number; lastSent: string; delay: number;
  pbuf: DiskS[]; izb: [Iz[], Iz[]]; oppLag: number; rt: number;
  sentPrev: { t: number; x: number; y: number } | null;
  pred: { x: number; y: number; vx: number; vy: number; t: number; t0: number; h: number | null; bekle: number } | null;
  predBlock: number; sonYerelVurus: number;
};

/* SUNUCU MOTORUNUN (havahokeyi-engine.js) disk–tokmak çarpışması ve serbest
   kayışının BİREBİR kopyası. Kendi vuruşumuzu ekranda hemen göstermek için
   kullanılır; sunucu aynı veriyle (bizim yolladığımız imleç yolu + aynı anki
   disk) aynı sonucu hesaplar, bu yüzden tahmin ile gerçek örtüşür. */
const ALAN = { sol: 48, sag: 952, ust: 48, alt: 552 }, KALE_UST = 205, KALE_ALT = 395, DIREK_R = 13;
const DISK_TAVANI = 1250, DISK_YUMUSAK = 950, HAVA_SURTUNME = 0.05, BANT_ESNEKLIK = 0.95, DIREK_ESNEKLIK = 0.9;
const TOKMAK_ESNEKLIK = 0.88, KUTLE_PAYI = 0.9, TOKMAK_TEGET = 0.08, TOKMAK_HIZ_TAVANI = 2200;
type DV = { x: number; y: number; vx: number; vy: number };
function hizKirp(o: DV, tavan: number) { const h = Math.hypot(o.vx, o.vy); if (h > tavan) { o.vx = o.vx / h * tavan; o.vy = o.vy / h * tavan; } }
function diskTavani(d: DV) { const h = Math.hypot(d.vx, d.vy); if (h <= DISK_YUMUSAK) return; const y = Math.min(DISK_TAVANI, DISK_YUMUSAK + (h - DISK_YUMUSAK) * 0.4); d.vx = d.vx / h * y; d.vy = d.vy / h * y; }
function bantlar(d: DV) {
  const n: { x: number; y: number }[] = []; const ka = d.y > KALE_UST && d.y < KALE_ALT;
  if (d.y - PUCK_RADIUS <= ALAN.ust + 0.5) n.push({ x: 0, y: 1 });
  if (d.y + PUCK_RADIUS >= ALAN.alt - 0.5) n.push({ x: 0, y: -1 });
  if (!ka && d.x - PUCK_RADIUS <= ALAN.sol + 0.5) n.push({ x: 1, y: 0 });
  if (!ka && d.x + PUCK_RADIUS >= ALAN.sag - 0.5) n.push({ x: -1, y: 0 });
  return n;
}
function bantIcineAl(d: DV) { const ka = d.y > KALE_UST && d.y < KALE_ALT; d.y = clamp(d.y, ALAN.ust + PUCK_RADIUS, ALAN.alt - PUCK_RADIUS); if (!ka) d.x = clamp(d.x, ALAN.sol + PUCK_RADIUS, ALAN.sag - PUCK_RADIUS); }
function carp(d: DV, m: DV, bekleyen: boolean) {
  const dx = d.x - m.x, dy = d.y - m.y; const R = PUCK_RADIUS + MALLET_RADIUS; const k2 = dx * dx + dy * dy;
  if (k2 >= R * R) return 0;
  const u = Math.sqrt(k2); let nx: number, ny: number;
  if (u > 1e-6) { nx = dx / u; ny = dy / u; } else { const h = Math.hypot(m.vx, m.vy) || 1; nx = (m.vx / h) || 1; ny = m.vy / h; }
  d.x = m.x + nx * R; d.y = m.y + ny * R;
  const bx = d.vx - m.vx, by = d.vy - m.vy; const bn = bx * nx + by * ny; let guc = 0;
  if (bn < 0) {
    if (!bekleyen) {
      d.vx -= (1 + TOKMAK_ESNEKLIK) * KUTLE_PAYI * bn * nx; d.vy -= (1 + TOKMAK_ESNEKLIK) * KUTLE_PAYI * bn * ny;
      const tgx = -ny, tgy = nx, bt = bx * tgx + by * tgy; d.vx -= bt * TOKMAK_TEGET * tgx; d.vy -= bt * TOKMAK_TEGET * tgy;
      guc = Math.min(1, Math.max(0.1, -bn / 900));
    } else { d.vx -= bn * nx; d.vy -= bn * ny; }
    diskTavani(d);
  }
  const bn2 = bantlar(d);
  if (bn2.length) {
    bantIcineAl(d); const ex = d.x - m.x, ey = d.y - m.y;
    if (ex * ex + ey * ey < R * R - 1) {
      let en = { x: 0, y: 0 }, enIyi = -Infinity;
      for (const w of bn2) for (const yon of [1, -1]) {
        const tx = -w.y * yon, ty = w.x * yon; let serbest = true;
        for (const w2 of bn2) if (w2 !== w && tx * w2.x + ty * w2.y < -0.5) serbest = false;
        const sk = (tx * ex + ty * ey) + (serbest ? 0 : -1e6); if (sk > enIyi) { enIyi = sk; en = { x: tx, y: ty }; }
      }
      const px = d.x - m.x, py = d.y - m.y, B = 2 * (px * en.x + py * en.y), C = px * px + py * py - R * R;
      const kay = (-B + Math.sqrt(Math.max(0, B * B - 4 * C))) / 2;
      if (kay > 0 && kay < R * 2) { d.x += en.x * kay; d.y += en.y * kay; bantIcineAl(d); }
      const hz = clamp(Math.hypot(m.vx, m.vy) * 0.6, 150, 520); d.vx = en.x * hz; d.vy = en.y * hz; guc = guc || 0.2;
    }
  }
  return guc;
}
function direk(d: DV, x: number, y: number) {
  const dx = d.x - x, dy = d.y - y, R = PUCK_RADIUS + DIREK_R, k2 = dx * dx + dy * dy; if (k2 >= R * R) return;
  const u = Math.sqrt(k2) || 0.001, nx = dx / u, ny = dy / u; d.x = x + nx * R; d.y = y + ny * R;
  const vn = d.vx * nx + d.vy * ny; if (vn < 0) { d.vx -= (1 + DIREK_ESNEKLIK) * vn * nx; d.vy -= (1 + DIREK_ESNEKLIK) * vn * ny; }
}
function serbestIlerle(d: DV, dt: number) {
  const r = Math.exp(-HAVA_SURTUNME * dt); d.vx *= r; d.vy *= r; d.x += d.vx * dt; d.y += d.vy * dt;
  if (d.y - PUCK_RADIUS < ALAN.ust) { d.y = ALAN.ust + PUCK_RADIUS; if (d.vy < 0) d.vy = -d.vy * BANT_ESNEKLIK; }
  else if (d.y + PUCK_RADIUS > ALAN.alt) { d.y = ALAN.alt - PUCK_RADIUS; if (d.vy > 0) d.vy = -d.vy * BANT_ESNEKLIK; }
  const ka = d.y > KALE_UST && d.y < KALE_ALT;
  if (!ka && d.x - PUCK_RADIUS < ALAN.sol) { d.x = ALAN.sol + PUCK_RADIUS; if (d.vx < 0) d.vx = -d.vx * BANT_ESNEKLIK; }
  else if (!ka && d.x + PUCK_RADIUS > ALAN.sag) { d.x = ALAN.sag - PUCK_RADIUS; if (d.vx > 0) d.vx = -d.vx * BANT_ESNEKLIK; }
  direk(d, ALAN.sol, KALE_UST); direk(d, ALAN.sol, KALE_ALT); direk(d, ALAN.sag, KALE_UST); direk(d, ALAN.sag, KALE_ALT);
  hizKirp(d, DISK_TAVANI);
}
/* zaman damgalı örneklerden ara değer */
function diskAt(b: DiskS[], t: number): DiskS | null {
  if (!b.length) return null;
  if (t <= b[0].t) return b[0];
  const son = b[b.length - 1];
  if (t >= son.t) { const dts = Math.min(0.08, (t - son.t) / 1000); return { t, x: son.x + son.vx * dts, y: son.y + son.vy * dts, vx: son.vx, vy: son.vy }; }
  let lo = 0, hi = b.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m; else hi = m; }
  const a = b[lo], c = b[hi]; const k = clamp((t - a.t) / Math.max(0.01, c.t - a.t), 0, 1);
  if (Math.hypot(c.x - a.x, c.y - a.y) > 160) return k < 0.5 ? a : c;
  return { t, x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, vx: a.vx + (c.vx - a.vx) * k, vy: a.vy + (c.vy - a.vy) * k };
}
function izAt(b: Iz[], t: number): { x: number; y: number } | null {
  if (!b.length) return null;
  if (t <= b[0].t) return b[0];
  const son = b[b.length - 1]; if (t >= son.t) return son;
  let lo = 0, hi = b.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m; else hi = m; }
  const a = b[lo], c = b[hi]; const k = clamp((t - a.t) / Math.max(0.01, c.t - a.t), 0, 1);
  return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k };
}

export default function Online() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const g = useRef<G>({
    prev: null, cur: null, curAt: 0, interval: 16, buf: [], offs: [], off: 0, jit: 0, seat: null, names: ["Oyuncu 1", "Oyuncu 2"],
    renk: ["#22d3ee", "#fb4d6d"], maxSet: 3, golHedefi: 5, olayNo: null, lastFaz: "", lastTick: -1,
    particles: [], trail: [], shake: 0, flash: 0, flashSide: 0, banner: "FACE OFF", bannerTime: 0.65,
    me: null, target: null, keyPos: null, keys: new Set(), pointer: null, lastSend: 0, lastSent: "", delay: 60,
    pbuf: [], izb: [[], []], oppLag: 0, rt: 0, sentPrev: null, pred: null, predBlock: 0, sonYerelVurus: 0,
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
      /* disk tamponu: geç gelen bir vuruş geçmişi değiştirdiyse düzeltme ile değiştir */
      const ft = f.t as number;
      if (f.duzelt && f.duzelt.length) {
        const t0 = f.duzelt[0].t;
        s.pbuf = s.pbuf.filter((k) => k.t < t0).concat(f.duzelt);
      }
      if (!s.pbuf.length || s.pbuf[s.pbuf.length - 1].t < ft) s.pbuf.push({ t: ft, x: f.disk.x, y: f.disk.y, vx: f.disk.vx, vy: f.disk.vy });
      while (s.pbuf.length > 2 && ft - s.pbuf[0].t > 1500) s.pbuf.shift();
      /* imleç izleri (görüş zamanlı); rakibin izi kareden ne kadar geride? */
      if (f.iz) for (const j of [0, 1]) {
        const yeni = f.iz[j] || []; if (!yeni.length) continue;
        const b = s.izb[j];
        for (const k of yeni) if (!b.length || k.t >= b[b.length - 1].t) b.push(k);
        while (b.length > 2 && ft - b[0].t > 1500) b.shift();
        if (j !== s.seat) { const lag = ft - yeni[yeni.length - 1].t; s.oppLag = s.oppLag ? s.oppLag * 0.85 + lag * 0.15 : lag; }
      }
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
    } else if (f.sonOlay === "vurus" && performance.now() - s.sonYerelVurus > 450) {
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
        s.cur = null; s.prev = null; s.buf = []; s.offs = []; s.olayNo = null; s.me = null; s.target = null; s.keyPos = null;
        s.pbuf = []; s.izb = [[], []]; s.oppLag = 0; s.sentPrev = null; s.pred = null;
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

    const send = (x: number, y: number, force = false) => {
      const s = g.current; const t = performance.now();
      if (t - s.lastSend < 15) return;                // ~60 Hz
      const k = Math.round(x) + "," + Math.round(y);
      if (!force && k === s.lastSent && t - s.lastSend < 250) return;
      s.lastSend = t; s.lastSent = k;
      post({ t: "move", x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, vt: Math.round(s.rt * 10) / 10 });
      s.sentPrev = { t: s.rt, x, y };
    };

    const frame = (time: number) => {
      raf = requestAnimationFrame(frame);
      const s = g.current;
      const dt = Math.min(0.05, (time - last) / 1000); last = time;
      const f = s.cur;
      const rotated = s.seat === 1;

      /* GÖRÜŞ ZAMANI: sunucu saatiyle geriden oynat. Gecikme = kare aralığı +
         titreşim payı; rakibin imleç izi kareden gerideyse onu da bekleriz
         (rakip tokmağı diskle AYNI zamandan çizilsin). */
      let disk: DV | null = f ? f.disk : null; const mal: { x: number; y: number }[] = f ? f.tokmak.map((t) => ({ x: t.x, y: t.y })) : [];
      if (f && typeof f.t === "number" && s.buf.length >= 2) {
        const taban = clamp(s.interval * 1.2 + s.jit * 2 + 10, 28, 120);
        const delay = clamp(Math.max(taban, s.oppLag + 12), 28, 260);
        s.delay = s.delay ? s.delay * 0.9 + delay * 0.1 : delay;
        s.rt = time - s.off - s.delay;
        const bf = s.buf; let fr = bf[0];
        for (let n = bf.length - 1; n >= 0; n -= 1) { if ((bf[n].t as number) <= s.rt) { fr = bf[n]; break; } }
        const dd = fr.faz === "oyun" ? diskAt(s.pbuf, s.rt) : null;
        disk = dd ? { x: dd.x, y: dd.y, vx: dd.vx, vy: dd.vy } : fr.disk;
        for (const j of [0, 1]) { const p = izAt(s.izb[j], s.rt); if (p) mal[j] = { x: p.x, y: p.y }; }
      }
      const fazOyun = !!f && f.faz === "oyun" && f.status === "playing";

      /* KENDİ TOKMAĞIM: imlecin/parmağın TAM altında (gecikmesiz). */
      if (f && s.seat !== null) {
        const playing = f.status === "playing";
        const kk = s.keys;
        let hx = Number(kk.has("KeyD") || kk.has("ArrowRight")) - Number(kk.has("KeyA") || kk.has("ArrowLeft"));
        let hy = Number(kk.has("KeyS") || kk.has("ArrowDown")) - Number(kk.has("KeyW") || kk.has("ArrowUp"));
        if (rotated) { hx = -hx; hy = -hy; }
        const mag = Math.hypot(hx, hy);
        if (mag > 0 && playing) {
          if (!s.keyPos) s.keyPos = { x: (s.target || mal[s.seat]).x, y: (s.target || mal[s.seat]).y };
          s.keyPos.x += (hx / mag) * 900 * dt; s.keyPos.y += (hy / mag) * 900 * dt;
          constrain(s.keyPos, s.seat);
          s.target = { x: s.keyPos.x, y: s.keyPos.y };
        } else if (s.keyPos) s.keyPos = null;
        if (s.target) { constrain(s.target, s.seat); mal[s.seat] = { x: s.target.x, y: s.target.y }; }
        s.me = mal[s.seat] || null;
        /* konumu görüş zamanıyla yolla: hareket varsa ya da disk yakındaysa her karede */
        if (playing && s.me && s.rt) {
          const yakin = disk && Math.hypot(disk.x - s.me.x, disk.y - s.me.y) < MALLET_RADIUS + PUCK_RADIUS + 160;
          const k = Math.round(s.me.x) + "," + Math.round(s.me.y);
          if (yakin || k !== s.lastSent) send(s.me.x, s.me.y, !!yakin);
        }
      }

      /* KENDİ VURUŞUMUN ANINDA GÖRÜNMESİ: son iki bildirimim arasındaki imleç yolu
         ekrandaki diske değdiyse, sunucunun yapacağı hesabın aynısını hemen yap. */
      if (s.seat !== null && s.me && disk && fazOyun && s.sentPrev && s.rt) {
        if (!s.pred && time > s.predBlock) {
          const a = s.sentPrev, now = { t: s.rt, x: s.me.x, y: s.me.y };
          const d0 = diskAt(s.pbuf, a.t), d1 = diskAt(s.pbuf, now.t);
          if (d0 && d1 && now.t > a.t) {
            const R = MALLET_RADIUS + PUCK_RADIUS;
            const p0x = d0.x - a.x, p0y = d0.y - a.y, p1x = d1.x - now.x, p1y = d1.y - now.y;
            const qx = p1x - p0x, qy = p1y - p0y, A = qx * qx + qy * qy, B = 2 * (p0x * qx + p0y * qy), C = p0x * p0x + p0y * p0y - R * R;
            let u = -1;
            if (C <= 0) u = 0; else if (A > 1e-9) { const D = B * B - 4 * A * C; if (D >= 0) { const v = (-B - Math.sqrt(D)) / (2 * A); if (v >= 0 && v <= 1) u = v; } }
            if (u >= 0) {
              const tc = a.t + (now.t - a.t) * u;
              const dc = diskAt(s.pbuf, tc) as DiskS;
              const dts = Math.max(0.001, (now.t - a.t) / 1000);
              const m: DV = { x: a.x + (now.x - a.x) * u, y: a.y + (now.y - a.y) * u, vx: (now.x - a.x) / dts, vy: (now.y - a.y) / dts };
              hizKirp(m, TOKMAK_HIZ_TAVANI);
              const c: DV = { x: dc.x, y: dc.y, vx: dc.vx, vy: dc.vy };
              const bn = (c.vx - m.vx) * (c.x - m.x) + (c.vy - m.vy) * (c.y - m.y);
              if (bn < 0 && carp(c, m, false)) {
                s.pred = { ...c, t: tc, t0: time, h: null, bekle: 0.03 }; s.predBlock = time + 250;
                s.sonYerelVurus = performance.now();
                const pw = Math.min(1, Math.max(0.12, Math.hypot(c.vx, c.vy) / 900));
                const nx = (c.x - m.x) / (MALLET_RADIUS + PUCK_RADIUS), ny = (c.y - m.y) / (MALLET_RADIUS + PUCK_RADIUS);
                spawnImpact(c.x - nx * PUCK_RADIUS, c.y - ny * PUCK_RADIUS, s.renk[s.seat], nx, ny, pw);
                s.shake = Math.max(s.shake, 2.5 + pw * 5); playSound("hit", pw);
              }
            }
          }
        }
      } else if (s.pred && !fazOyun) s.pred = null;
      if (s.pred && disk) {
        const pr = s.pred;
        /* tahmini diski görüş zamanına kadar ilerlet (bant, direk, tokmaklar) */
        let kalan = (s.rt - pr.t) / 1000;
        while (kalan > 1e-4) {
          const st2 = Math.min(1 / 240, kalan); serbestIlerle(pr, st2); pr.bekle = Math.max(0, pr.bekle - st2);
          for (let j = 0; j < 2; j += 1) { const mm = mal[j]; if (mm) carp(pr, { x: mm.x, y: mm.y, vx: 0, vy: 0 }, true); }
          kalan -= st2;
        }
        pr.t = s.rt;
        const age = time - pr.t0; const gap = Math.hypot(disk.x - pr.x, disk.y - pr.y);
        /* sunucunun düzeltmesi geldiğinde (aynı hesap) yumuşakça ona geç */
        if (pr.h === null && ((age > 90 && gap < 30) || (age > 320 && gap > 90) || age > 700)) pr.h = time;
        if (pr.h === null) disk = { x: pr.x, y: pr.y, vx: pr.vx, vy: pr.vy };
        else {
          const k = Math.min(1, (time - pr.h) / 140);
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
    void t;   // gönderim çizim döngüsünde, görüş zamanıyla birlikte yapılır
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
