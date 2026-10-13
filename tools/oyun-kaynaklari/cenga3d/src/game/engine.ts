import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  BLOCK_H,
  BLOCK_L,
  BLOCK_W,
  LAYER_H,
  RISK_LABELS,
  TOTAL_LAYERS,
  analyze,
  countLayer,
  createGrid,
  gripLabel,
  hasAnyMove,
  highestCompleteLayer,
  isLayerAllowed,
  layerAxis,
  layerY,
  nextTopSlot,
  riskFactor,
  riskLevel,
  slotPosition,
  stabilityPercent,
  topIndex,
  type Grid,
  type RiskLevel,
} from './tower';
import { MeshFX, PointFX, hexToRgb } from './fx';
import { sfx as realSfx } from './audio';

/* ---- çevrimiçi: ses/efekt olaylarını rakibe yansıtmak için ince bir sarmalayıcı ---- */
const SFX_FORWARD = new Set([
  'select', 'poke', 'success', 'place', 'turn', 'creak', 'thud', 'warn', 'engage', 'collapse', 'lose', 'hit', 'stack', 'deny',
]);
let sfxTap: ((name: string, args: unknown[]) => void) | null = null;
const sfx = new Proxy(realSfx, {
  get(target, key) {
    const v = (target as unknown as Record<string | symbol, unknown>)[key];
    if (typeof v !== 'function') return v;
    return (...args: unknown[]) => {
      if (sfxTap && typeof key === 'string' && SFX_FORWARD.has(key)) sfxTap(key, args);
      return (v as (...a: unknown[]) => unknown).apply(target, args);
    };
  },
}) as typeof realSfx;

function playRemoteSfx(name: string, args: unknown[]): void {
  if (!SFX_FORWARD.has(name)) return;
  const f = (realSfx as unknown as Record<string, unknown>)[name];
  if (typeof f === 'function') (f as (...a: unknown[]) => unknown).apply(realSfx, args);
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type NetMsg = { t: string; [k: string]: unknown };

/* ------------------------------------------------------------------ */
/* Tipler                                                              */
/* ------------------------------------------------------------------ */

export type Phase = 'menu' | 'intro' | 'select' | 'pull' | 'placing' | 'creak' | 'collapse' | 'over';
export type Mode = 'menu' | 'game';

export interface PlayerState {
  name: string;
  score: number;
  streak: number;
  pulls: number;
}

export interface SelectionInfo {
  layer: number;
  grip: number;
  gripLabel: string;
  riskLevel: RiskLevel;
  riskLabel: string;
  engaged: boolean;
}

export interface Snapshot {
  phase: Phase;
  mode: Mode;
  players: PlayerState[];
  current: number;
  turn: number;
  layers: number;
  stability: number;
  selection: SelectionInfo | null;
  kbd: boolean;
  /** çevrimiçi: bu tarayıcının oyuncu sırası (-1: izleyici) */
  me?: number;
  online?: boolean;
}

export interface GaugeState {
  visible: boolean;
  hand: number;
  target: number;
  zone: number;
  progress: number;
  stress: number;
  engaged: boolean;
  inZone: boolean;
  warn: number;
}

export interface MoveResult {
  player: number;
  points: number;
  tier: 0 | 1 | 2;
  mult: number;
  streak: number;
  acc: number;
}

export interface GameOverInfo {
  loser: number;
  reason: 'balance' | 'structure' | 'nomoves';
  players: PlayerState[];
  turn: number;
  layers: number;
}

export interface EngineEvents {
  onSnapshot(s: Snapshot): void;
  onGauge(g: GaugeState): void;
  onMove(m: MoveResult): void;
  onToast(msg: string, kind: 'info' | 'warn'): void;
  onGameOver(info: GameOverInfo): void;
}

interface Block {
  id: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  layer: number;
  slot: number;
  r1: number;
  r2: number;
  glow: number;
  inTower: boolean;
  introDelay: number;
  landed: boolean;
  squash: number;
  body: CANNON.Body | null;
}

interface PullState {
  block: Block;
  fromLayer: number;
  base: THREE.Vector3;
  dirX: number;
  dirZ: number;
  grip: number;
  risk: number;
  willCollapse: boolean;
  afterDirX: number;
  afterDirZ: number;
  afterWeak: number;
  zone: number;
  amp: number;
  w1: number;
  w2: number;
  w3: number;
  p1: number;
  p2: number;
  p3: number;
  rate: number;
  armed: boolean;
  engaged: boolean;
  armTime: number;
  inZoneTime: number;
  t: number;
  ramp: number;
  progress: number;
  stress: number;
  hand: number;
  handTarget: number;
  target: number;
  jolt: number;
  joltGoal: number;
  joltTimer: number;
  warnDir: number;
  accSum: number;
  accT: number;
  poke: number;
  dustT: number;
  sparkT: number;
  creakT: number;
  creaked: boolean;
}

interface PlaceState {
  block: Block;
  t: number;
  p0: THREE.Vector3;
  q0: THREE.Quaternion;
  p1: THREE.Vector3;
  q1: THREE.Quaternion;
  dest: { layer: number; slot: number };
  landed: boolean;
  after: number;
  acc: number;
  grip: number;
  risk: number;
  fromLayer: number;
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                         */
/* ------------------------------------------------------------------ */

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInCubic = (t: number): number => t * t * t;
const easeOutBounce = (x: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const noise1 = (t: number, s: number): number => Math.sin(t * 1.7 + s) * 0.6 + Math.sin(t * 3.1 + s * 2.3) * 0.4;
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

const TINTS = [0xffffff, 0xf4dfbf, 0xe8c999, 0xfff0d6, 0xdcb98c];
const AMBER = 0xffa62b;
const RED = 0xff3b30;
const MINT = 0x5eead4;
const WOOD_SHARDS = [0xe9b872, 0xc98a3d, 0xf3d29a, 0xb77a35];
const CONFETTI = [0xffb547, 0x4cc9f0, 0xff6b9a, 0x9be564, 0xfff1d0, 0x5eead4];

function makeWoodTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#eab976');
  grad.addColorStop(0.5, '#dfa95e');
  grad.addColorStop(1, '#e8b56d');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * 256;
    const dark = Math.random() < 0.7;
    g.strokeStyle = dark
      ? `rgba(120,68,22,${0.05 + Math.random() * 0.14})`
      : `rgba(255,232,186,${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 0.6 + Math.random() * 2.4;
    g.beginPath();
    g.moveTo(0, y);
    const ph = Math.random() * 6;
    const amp = 1 + Math.random() * 4;
    for (let x = 0; x <= 512; x += 24) g.lineTo(x, y + Math.sin(x * 0.018 + ph) * amp + (Math.random() - 0.5) * 1.2);
    g.stroke();
  }
  for (let k = 0; k < 2; k++) {
    const kx = 60 + Math.random() * 390;
    const ky = 40 + Math.random() * 170;
    for (let r = 5; r > 0; r--) {
      g.strokeStyle = `rgba(110,60,18,${0.1 + (5 - r) * 0.05})`;
      g.lineWidth = 1.5;
      g.beginPath();
      g.ellipse(kx, ky, r * 7, r * 2.4, 0, 0, Math.PI * 2);
      g.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Motor                                                               */
/* ------------------------------------------------------------------ */

export class Engine {
  private container: HTMLElement;
  private ev: EngineEvents;
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private towerGroup = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private blockGeo: THREE.BufferGeometry;
  private baseMat: THREE.MeshStandardMaterial;
  private woodTex: THREE.CanvasTexture;
  private decoGeo: THREE.BufferGeometry[] = [];
  private decoMat: THREE.Material[] = [];
  private pointFx: PointFX;
  private meshFx: MeshFX;
  private resizeObs: ResizeObserver;
  private isMobile: boolean;
  private maxPR: number;
  private pixelRatio: number;

  // oyun durumu
  private mode: Mode = 'menu';
  private phase: Phase = 'intro';
  private paused = false;
  private blocks: Block[] = [];
  private grid: Grid = [];
  private pickList: THREE.Object3D[] = [];
  private players: PlayerState[] = [];
  private current = 0;
  private turn = 0;
  private stability = 1;
  private pull: PullState | null = null;
  private place: PlaceState | null = null;
  private creakInfo: { t: number; dirX: number; dirZ: number; weak: number; ct: number } | null = null;
  private hover: Block | null = null;
  private focus: Block | null = null;
  private kbd = false;
  private introT = 0;
  private collapseT = 0;
  private collapseReason: GameOverInfo['reason'] = 'balance';
  private world: CANNON.World | null = null;
  private lastHit = 0;
  private hitBudget = 0;
  private shardBudget = 0;

  // kamera
  private az = 0.7;
  private azT = 0.7;
  private el = 0.34;
  private elT = 0.34;
  private zoom = 1;
  private zoomT = 1;
  private zoomPhase = 1.05;
  private focusY = 5;
  private trauma = 0;
  private contTrauma = 0;
  private time = 0;
  private timeScale = 1;

  // sallanma
  private lean = 0;
  private leanVel = 0;
  private leanGoal = 0;
  private leanAxis = new THREE.Vector3(0, 0, -1);

  // girdi
  private keys = new Set<string>();
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { id: number; sx: number; sy: number; lx: number; ly: number; moved: boolean; t: number } | null = null;
  private touchAnchor: { id: number; x: number; hand: number } | null = null;
  private pinchD = 0;
  private pinchZoom = 1;
  private mouseX = -1;
  private mouseY = -1;
  private mouseIn = false;
  private lastPointerType = 'mouse';
  private hoverTimer = 0;

  // döngü
  private raf = 0;
  private lastT = 0;
  private emaDt = 0.016;
  private perfT = 0;
  private disposed = false;

  private gauge: GaugeState = {
    visible: false,
    hand: 0,
    target: 0,
    zone: 0.3,
    progress: 0,
    stress: 0,
    engaged: false,
    inZone: false,
    warn: 0,
  };
  private gaugeShown = false;

  // çevrimiçi katman (aktif oyuncunun tarayıcısı fiziği yürütür, diğerleri aynayı izler)
  private online = false;
  private net: ((m: NetMsg) => void) | null = null;
  private me = -1;
  private ctl = 0;
  private rng: () => number = Math.random;
  private outS: unknown[][] = [];
  private outFx: unknown[][] = [];
  private outTs: [string, string][] = [];
  private outMv: MoveResult[] = [];
  private outSnap: Snapshot | null = null;
  private sentT = new Map<number, string>();
  private sentLean = '';
  private sendAcc = 0;
  private beatAcc = 0;
  private keyAcc = 0;
  private flushNow = false;
  private mTarget = new Map<number, { p: THREE.Vector3; q: THREE.Quaternion }>();
  private mLean = new THREE.Quaternion();
  private mGauge: GaugeState | null = null;
  private mGaugeS: GaugeState | null = null;
  private mSel: SelectionInfo | null = null;
  private mLayers = TOTAL_LAYERS;

  constructor(container: HTMLElement, ev: EngineEvents) {
    this.container = container;
    this.ev = ev;
    const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    this.isMobile = coarse || Math.min(window.innerWidth, window.innerHeight) < 600;
    this.maxPR = this.isMobile ? 1.75 : 2;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.maxPR);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x000000, 0);
    this.canvas = this.renderer.domElement;
    this.canvas.style.touchAction = 'none';
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.5, 220);

    this.setupLights();
    this.woodTex = makeWoodTexture();
    this.baseMat = new THREE.MeshStandardMaterial({ map: this.woodTex, roughness: 0.62, metalness: 0.02 });
    this.blockGeo = new RoundedBoxGeometry(BLOCK_L, BLOCK_H, BLOCK_W, 3, 0.07);
    this.setupTable();

    this.pointFx = new PointFX(700);
    this.meshFx = new MeshFX(360);
    this.scene.add(this.pointFx.points);
    this.scene.add(this.meshFx.mesh);
    this.scene.add(this.towerGroup);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    sfxTap = (name, args) => {
      if (this.net && this.isActive) this.outS.push([name, args]);
    };
    this.toMenu();
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ------------------------------ kurulum ------------------------------ */

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight(0xdcecff, 0x3a2412, 1.15);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe0b0, 3.0);
    key.position.set(9, 22, 8);
    key.target.position.set(0, 4, 0);
    key.castShadow = true;
    const ms = this.isMobile ? 1024 : 2048;
    key.shadow.mapSize.set(ms, ms);
    const sc = key.shadow.camera;
    sc.left = -14;
    sc.right = 14;
    sc.top = 14;
    sc.bottom = -14;
    sc.near = 2;
    sc.far = 70;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 3;
    this.scene.add(key);
    this.scene.add(key.target);
    const rim = new THREE.DirectionalLight(0x7cc4ff, 1.1);
    rim.position.set(-10, 9, -9);
    this.scene.add(rim);
    const warm = new THREE.PointLight(0xffa04a, 60, 40, 1.6);
    warm.position.set(-5, 6, 8);
    this.scene.add(warm);
  }

  private setupTable(): void {
    const feltGeo = new THREE.CylinderGeometry(12.5, 12.5, 0.6, 80);
    const feltMat = new THREE.MeshStandardMaterial({ color: 0x1d5750, roughness: 0.95 });
    const felt = new THREE.Mesh(feltGeo, feltMat);
    felt.position.y = -0.3;
    felt.receiveShadow = true;
    this.scene.add(felt);

    const rimGeo = new THREE.TorusGeometry(12.65, 0.4, 14, 110);
    const rimMat = new THREE.MeshStandardMaterial({ map: this.woodTex, color: 0xb98550, roughness: 0.55 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = -0.1;
    rim.receiveShadow = true;
    this.scene.add(rim);

    const ringGeo = new THREE.RingGeometry(3.7, 3.85, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x4fb7a6,
      transparent: true,
      opacity: 0.35,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.004;
    this.scene.add(ring);

    this.decoGeo.push(feltGeo, rimGeo, ringGeo);
    this.decoMat.push(feltMat, rimMat, ringMat);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    this.pointFx.setScale((h * this.pixelRatio) / (2 * Math.tan(fov / 2)));
  }

  private buildTower(): void {
    for (const b of this.blocks) {
      b.mesh.removeFromParent();
      b.mat.dispose();
    }
    this.blocks = [];
    this.world = null;
    this.grid = createGrid();
    this.towerGroup.quaternion.identity();
    this.lean = 0;
    this.leanVel = 0;
    this.leanGoal = 0;
    this.pointFx.clear();
    this.meshFx.clear();
    for (let l = 0; l < TOTAL_LAYERS; l++) {
      for (let s = 0; s < 3; s++) {
        const id = this.grid[l][s];
        const mat = this.baseMat.clone();
        mat.color.setHex(TINTS[Math.floor(this.rng() * TINTS.length)]);
        const mesh = new THREE.Mesh(this.blockGeo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.id = id;
        const [x, y, z] = slotPosition(l, s);
        mesh.position.set(x, y, z);
        if (layerAxis(l) === 'z') mesh.rotation.y = Math.PI / 2;
        this.towerGroup.add(mesh);
        this.blocks.push({
          id,
          mesh,
          mat,
          layer: l,
          slot: s,
          r1: this.rng(),
          r2: this.rng(),
          glow: 0,
          inTower: true,
          introDelay: l * 0.05 + s * 0.025,
          landed: false,
          squash: 0,
          body: null,
        });
      }
    }
    this.refreshPick();
  }

  private refreshPick(): void {
    this.pickList = this.blocks.filter((b) => b.inTower).map((b) => b.mesh);
  }

  /* --------------------------- genel API --------------------------- */

  private startIntro(): void {
    this.introT = 0;
    this.phase = 'intro';
    for (const b of this.blocks) b.mesh.visible = false;
  }

  toMenu(): void {
    this.mode = 'menu';
    this.players = [];
    this.pull = null;
    this.place = null;
    this.creakInfo = null;
    this.hideGauge();
    sfx.stopScrape();
    this.timeScale = 1;
    this.trauma = 0;
    this.buildTower();
    this.stability = 1;
    this.turn = 0;
    this.current = 0;
    this.startIntro();
    this.emit();
  }

  start(count: number, names: string[]): void {
    sfx.init();
    this.mode = 'game';
    this.players = [];
    for (let i = 0; i < count; i++) {
      this.players.push({ name: (names[i] || `Oyuncu ${i + 1}`).trim() || `Oyuncu ${i + 1}`, score: 0, streak: 0, pulls: 0 });
    }
    this.current = 0;
    this.turn = 0;
    this.stability = 1;
    this.pull = null;
    this.place = null;
    this.creakInfo = null;
    this.hover = null;
    this.focus = null;
    this.kbd = false;
    this.paused = false;
    this.timeScale = 1;
    this.trauma = 0;
    this.hideGauge();
    sfx.stopScrape();
    this.buildTower();
    this.azT = this.az + 0; // mevcut açıdan devam
    this.elT = 0.34;
    this.zoomT = 1;
    this.startIntro();
    this.emit();
  }

  restart(): void {
    const names = this.players.map((p) => p.name);
    this.start(Math.max(2, this.players.length), names);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.keys.clear();
    if (p) sfx.stopScrape();
  }

  setMuted(m: boolean): void {
    sfx.setMuted(m);
  }

  cancelSelection(): void {
    const p = this.pull;
    if (this.phase !== 'pull' || !p || p.engaged || !this.isActive) return;
    p.block.mesh.position.copy(p.base);
    this.pull = null;
    this.phase = 'select';
    this.hideGauge();
    sfx.click();
    this.emit();
  }

  rotateCamera(dir: number): void {
    this.azT += dir * 0.5;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    sfx.stopScrape();
    for (const b of this.blocks) b.mat.dispose();
    this.blockGeo.dispose();
    this.baseMat.dispose();
    this.woodTex.dispose();
    this.decoGeo.forEach((g) => g.dispose());
    this.decoMat.forEach((m) => m.dispose());
    this.pointFx.dispose();
    this.meshFx.dispose();
    this.renderer.dispose();
    if (this.canvas.parentElement === this.container) this.container.removeChild(this.canvas);
  }


  /* ======================= ÇEVRİMİÇİ KATMAN ======================= */

  /** Aktif oyuncu mu? (çevrimdışı modda her zaman evet) */
  private get isActive(): boolean {
    return !this.online || (this.me >= 0 && this.me === this.ctl);
  }

  setNet(fn: ((m: NetMsg) => void) | null): void {
    this.net = fn;
  }

  startOnline(o: {
    count: number;
    names: string[];
    seed: number;
    me: number;
    settled?: number[][] | null;
    current?: number;
    turn?: number;
    players?: PlayerState[] | null;
    stability?: number;
  }): void {
    this.online = true;
    this.me = o.me;
    this.rng = mulberry32(o.seed);
    this.start(o.count, o.names);
    this.ctl = 0;
    this.mSel = null;
    this.mTarget.clear();
    this.sentT.clear();
    if (o.settled && o.settled.length) {
      this.importSettled(o.settled);
      this.current = o.current ?? 0;
      this.ctl = this.current;
      this.turn = o.turn ?? 0;
      if (o.players && o.players.length) this.players = o.players.map((p) => ({ ...p }));
      this.stability = o.stability ?? 1;
      this.finishIntro();
    }
    this.emit();
  }

  private exportSettled(): number[][] {
    return this.blocks.map((b) => [b.layer, b.slot]);
  }

  private importSettled(s: number[][]): void {
    let maxL = TOTAL_LAYERS - 1;
    for (const [l] of s) maxL = Math.max(maxL, l);
    this.grid = [];
    for (let l = 0; l <= maxL; l++) this.grid.push([-1, -1, -1]);
    const up = new THREE.Vector3(0, 1, 0);
    s.forEach(([l, sl], id) => {
      const b = this.blocks[id];
      if (!b) return;
      if (b.mesh.parent !== this.towerGroup) this.towerGroup.add(b.mesh);
      b.layer = l;
      b.slot = sl;
      b.inTower = true;
      b.landed = true;
      this.grid[l][sl] = id;
      const [x, y, z] = slotPosition(l, sl);
      b.mesh.position.set(x, y, z);
      b.mesh.quaternion.setFromAxisAngle(up, layerAxis(l) === 'z' ? Math.PI / 2 : 0);
      b.mesh.scale.set(1, 1, 1);
      b.mesh.visible = true;
      b.squash = 0;
    });
    this.mTarget.clear();
    this.sentT.clear();
    this.refreshPick();
  }

  private finishIntro(): void {
    if (this.phase !== 'intro') return;
    for (const b of this.blocks) {
      const [x, y, z] = slotPosition(b.layer, b.slot);
      b.mesh.position.set(x, y, z);
      b.mesh.visible = true;
      b.landed = true;
    }
    this.phase = 'select';
    this.introT = 99;
  }

  /** Sunucudan (rakip tarayıcıdan) gelen paketleri işler. */
  receive(m: NetMsg): void {
    if (!this.online) return;
    switch (m.t) {
      case 'f':
        this.onFrame(m);
        break;
      case 'turn':
        this.onTurn(m);
        break;
      case 'over':
        this.onOver(m);
        break;
      case 'timeout':
        this.timeoutAction();
        break;
      default:
        break;
    }
  }

  private applyExtras(m: NetMsg): void {
    const s = m.s as unknown[][] | undefined;
    if (s) for (const [n, a] of s) playRemoteSfx(n as string, (a as unknown[]) ?? []);
    const fx = m.fx as number[][] | undefined;
    if (fx) {
      for (const f of fx) {
        const k = f[0];
        if (k === 0) this.dust(f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8], f[9]);
        else if (k === 1) this.sparkle(f[1], f[2], f[3], f[4], f[5], f[6], f[7], f[8]);
        else if (k === 2) this.confetti(f[1], f[2], f[3], f[4], CONFETTI);
      }
    }
    const ts = m.ts as [string, 'info' | 'warn'][] | undefined;
    if (ts) for (const [msg, kind] of ts) this.ev.onToast(msg, kind);
    const mv = m.mv as MoveResult[] | undefined;
    if (mv) for (const x of mv) this.ev.onMove(x);
  }

  private onFrame(m: NetMsg): void {
    this.applyExtras(m);
    if (this.isActive) return;
    if (this.phase === 'intro') this.finishIntro();
    const ph = m.ph as Phase;
    if (ph === 'collapse' && this.phase !== 'collapse' && this.phase !== 'over') this.mirrorCollapseStart();
    else if (ph !== this.phase && this.phase !== 'collapse' && this.phase !== 'over') this.phase = ph;
    const sn = m.sn as Snapshot | undefined;
    if (sn) {
      this.players = sn.players.map((p) => ({ ...p }));
      this.current = sn.current;
      this.turn = sn.turn;
      this.stability = sn.stability;
      this.mSel = sn.selection;
      this.mLayers = sn.layers;
      this.emit();
    }
    const tq = m.tq as number[] | undefined;
    if (tq) this.mLean.set(tq[0], tq[1], tq[2], tq[3]);
    const bl = m.b as number[][] | undefined;
    if (bl) {
      for (const r of bl) {
        const b = this.blocks[r[0]];
        if (!b) continue;
        const cur = this.mTarget.get(r[0]);
        if (cur) {
          cur.p.set(r[1], r[2], r[3]);
          cur.q.set(r[4], r[5], r[6], r[7]);
        } else {
          this.mTarget.set(r[0], { p: new THREE.Vector3(r[1], r[2], r[3]), q: new THREE.Quaternion(r[4], r[5], r[6], r[7]) });
        }
      }
    }
    const g = m.g as number[] | 0 | undefined;
    if (g) {
      this.mGauge = { visible: true, hand: g[0], target: g[1], zone: g[2], progress: g[3], stress: g[4], engaged: !!g[5], inZone: !!g[6], warn: g[7] };
      if (!this.mGaugeS) this.mGaugeS = { ...this.mGauge };
    } else if (this.mGauge) {
      this.mGauge = null;
      this.mGaugeS = null;
      this.hideGauge();
      realSfx.stopScrape();
    }
  }

  private mirrorCollapseStart(): void {
    this.phase = 'collapse';
    this.hideGauge();
    realSfx.stopScrape();
    this.towerGroup.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const b of this.blocks) {
      b.mesh.visible = true;
      b.mesh.updateWorldMatrix(true, false);
      b.mesh.getWorldPosition(pos);
      b.mesh.getWorldQuaternion(q);
      this.scene.add(b.mesh);
      b.mesh.position.copy(pos);
      b.mesh.quaternion.copy(q);
      b.mesh.scale.set(1, 1, 1);
      b.squash = 0;
    }
    this.mTarget.clear();
    this.towerGroup.quaternion.identity();
    this.mLean.identity();
    this.lean = 0;
    this.leanVel = 0;
    this.trauma = 1;
    this.timeScale = 1;
  }

  private onOver(m: NetMsg): void {
    this.applyExtras(m);
    if (this.isActive && this.net) return; // ev zaten yerelde tetiklendi
    const info = m.info as GameOverInfo;
    if (this.phase === 'intro') this.finishIntro();
    if (this.phase !== 'collapse' && this.phase !== 'over') this.mirrorCollapseStart();
    this.phase = 'over';
    this.ev.onGameOver(info);
    this.emit();
  }

  private onTurn(m: NetMsg): void {
    this.applyExtras(m);
    if (this.phase === 'intro') this.finishIntro();
    this.importSettled(m.settled as number[][]);
    this.players = (m.players as PlayerState[]).map((p) => ({ ...p }));
    this.current = m.current as number;
    this.ctl = this.current;
    this.turn = m.turn as number;
    this.stability = m.stability as number;
    this.pull = null;
    this.place = null;
    this.creakInfo = null;
    this.mSel = null;
    this.mGauge = null;
    this.mGaugeS = null;
    this.hideGauge();
    realSfx.stopScrape();
    this.phase = 'select';
    this.focus = null;
    this.hover = null;
    this.emit();
  }

  /** Süre doldu: taş seçilmediyse en güvenli taş seçilir, çekişte beklendiyse el kayar. */
  timeoutAction(): void {
    if (!this.online || !this.isActive) return;
    if (this.phase === 'select') {
      let best: Block | null = null;
      let bestRisk = 9;
      for (const b of this.blocks) {
        if (!b.inTower || !isLayerAllowed(this.grid, b.layer)) continue;
        const r = riskFactor(analyze(this.grid, b.id)) + (analyze(this.grid, b.id).stable ? 0 : 5);
        if (r < bestRisk) {
          bestRisk = r;
          best = b;
        }
      }
      if (best) {
        this.ev.onToast('Süre doldu — taş senin yerine seçildi!', 'warn');
        this.outTs.push(['Süre doldu — taş seçildi!', 'warn']);
        this.selectBlock(best);
      }
    } else if (this.phase === 'pull' && this.pull) {
      const p = this.pull;
      const sign = Math.random() < 0.5 ? 1 : -1;
      this.ev.onToast('Süre doldu — el kaydı!', 'warn');
      this.startCollapse('balance', Math.cos(this.az) * sign, -Math.sin(this.az) * sign, p.fromLayer);
    }
  }

  private r3(v: number): number {
    return Math.round(v * 1000) / 1000;
  }

  private buildFrame(force: boolean): NetMsg | null {
    const b: number[][] = [];
    const r3 = this.r3;
    for (const bl of this.blocks) {
      const p = bl.mesh.position;
      const q = bl.mesh.quaternion;
      const row = [bl.id, r3(p.x), r3(p.y), r3(p.z), Math.round(q.x * 10000) / 10000, Math.round(q.y * 10000) / 10000, Math.round(q.z * 10000) / 10000, Math.round(q.w * 10000) / 10000];
      const key = row.join(',');
      if (this.sentT.get(bl.id) !== key) {
        this.sentT.set(bl.id, key);
        b.push(row);
      }
    }
    const tq = this.towerGroup.quaternion;
    const lk = [tq.x, tq.y, tq.z, tq.w].map((v) => Math.round(v * 10000) / 10000);
    const lean = lk.join(',');
    const g = this.gauge;
    const hasG = g.visible && this.gaugeShown;
    const m: NetMsg = { t: 'f', ph: this.phase };
    let dirty = false;
    if (b.length) {
      m.b = b;
      dirty = true;
    }
    if (lean !== this.sentLean) {
      this.sentLean = lean;
      m.tq = lk;
      dirty = true;
    }
    if (hasG) {
      m.g = [r3(g.hand), r3(g.target), r3(g.zone), r3(g.progress), r3(g.stress), g.engaged ? 1 : 0, g.inZone ? 1 : 0, g.warn];
      dirty = true;
    } else if (this.sentGauge) {
      m.g = 0;
      dirty = true;
    }
    this.sentGauge = hasG;
    if (this.outSnap) {
      m.sn = this.outSnap;
      this.outSnap = null;
      dirty = true;
    }
    if (this.outS.length) {
      m.s = this.outS;
      this.outS = [];
      dirty = true;
    }
    if (this.outFx.length) {
      m.fx = this.outFx;
      this.outFx = [];
      dirty = true;
    }
    if (this.outTs.length) {
      m.ts = this.outTs;
      this.outTs = [];
      dirty = true;
    }
    if (this.outMv.length) {
      m.mv = this.outMv;
      this.outMv = [];
      dirty = true;
    }
    if (!dirty && !force) return null;
    return m;
  }
  private sentGauge = false;

  private takeExtras(m: NetMsg): void {
    if (this.outS.length) {
      m.s = this.outS;
      this.outS = [];
    }
    if (this.outFx.length) {
      m.fx = this.outFx;
      this.outFx = [];
    }
    if (this.outTs.length) {
      m.ts = this.outTs;
      this.outTs = [];
    }
    if (this.outMv.length) {
      m.mv = this.outMv;
      this.outMv = [];
    }
  }

  private pumpNet(raw: number): void {
    if (!this.net || !this.online || !this.isActive) return;
    if (this.phase === 'intro' || this.phase === 'menu') return;
    this.sendAcc += raw;
    this.beatAcc += raw;
    this.keyAcc += raw;
    if (this.keyAcc > 2) {
      /* düzenli tam kare: kaçan paketler kuleyi kalıcı bozmasın */
      this.keyAcc = 0;
      this.sentT.clear();
    }
    if (this.sendAcc < 0.05 && !this.flushNow) return;
    this.sendAcc = 0;
    this.flushNow = false;
    const f = this.buildFrame(this.beatAcc > 1);
    if (f) {
      this.beatAcc = 0;
      this.net(f);
    }
  }

  private updateMirror(_dt: number, raw: number): void {
    const k = 1 - Math.exp(-raw * 22);
    for (const [id, t] of this.mTarget) {
      const b = this.blocks[id];
      if (!b) continue;
      b.mesh.position.lerp(t.p, k);
      b.mesh.quaternion.slerp(t.q, k);
    }
    if (this.phase !== 'collapse' && this.phase !== 'over') {
      this.towerGroup.quaternion.slerp(this.mLean, k);
    }
    const g = this.mGauge;
    const gs = this.mGaugeS;
    if (g && gs) {
      const kk = 1 - Math.exp(-raw * 24);
      gs.hand += (g.hand - gs.hand) * kk;
      gs.target += (g.target - gs.target) * kk;
      gs.progress += (g.progress - gs.progress) * kk;
      gs.stress += (g.stress - gs.stress) * kk;
      gs.zone = g.zone;
      gs.engaged = g.engaged;
      gs.inZone = g.inZone;
      gs.warn = g.warn;
      gs.visible = true;
      this.ev.onGauge(gs);
      this.gaugeShown = true;
      this.contTrauma = gs.stress * 0.25;
    }
  }

  private emit(): void {
    const p = this.pull;
    const mirror = this.online && !this.isActive;
    const sel: SelectionInfo | null = mirror
      ? this.mSel
      : p
        ? {
            layer: p.fromLayer + 1,
            grip: p.grip,
            gripLabel: gripLabel(p.grip),
            riskLevel: this.pullRiskLevel,
            riskLabel: RISK_LABELS[this.pullRiskLevel],
            engaged: p.engaged,
          }
        : null;
    const snap: Snapshot = {
      phase: this.phase,
      mode: this.mode,
      players: this.players.map((pl) => ({ ...pl })),
      current: this.current,
      turn: this.turn,
      layers: mirror ? this.mLayers : Math.max(0, topIndex(this.grid) + 1),
      stability: this.stability,
      selection: sel,
      kbd: this.kbd,
      me: this.me,
      online: this.online,
    };
    if (this.online && this.net && !mirror) {
      this.outSnap = snap;
      this.flushNow = true;
    }
    this.ev.onSnapshot(snap);
  }
  private pullRiskLevel: RiskLevel = 0;

  private hideGauge(): void {
    if (this.gaugeShown) {
      this.gauge.visible = false;
      this.ev.onGauge(this.gauge);
      this.gaugeShown = false;
    }
  }

  /* ------------------------------ girdi ------------------------------ */

  private onPointerDown = (e: PointerEvent): void => {
    sfx.init();
    this.lastPointerType = e.pointerType;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, t: performance.now() };
    } else {
      this.drag = null;
      this.pinchD = this.pinchDist();
      this.pinchZoom = this.zoomT;
    }
    if (this.phase === 'pull' && this.pull && e.pointerType !== 'mouse') {
      this.touchAnchor = { id: e.pointerId, x: e.clientX, hand: this.pull.handTarget };
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.lastPointerType = e.pointerType;
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.pointerType === 'mouse') {
      if (this.kbd && Math.hypot(e.clientX - this.mouseX, e.clientY - this.mouseY) > 4) {
        this.kbd = false;
        this.focus = null;
      }
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.mouseIn = e.target === this.canvas;
      if (!this.mouseIn) this.hover = null;
    }
    if (this.phase === 'pull' && this.pull) {
      if (e.pointerType === 'mouse') {
        this.pull.handTarget = this.mapHand(e.clientX);
      } else if (this.touchAnchor && this.touchAnchor.id === e.pointerId) {
        const w = Math.max(200, this.canvas.clientWidth);
        this.pull.handTarget = clamp(this.touchAnchor.hand + (e.clientX - this.touchAnchor.x) / (w * 0.38), -1.1, 1.1);
      }
      return;
    }
    if (this.drag && this.drag.id === e.pointerId) {
      const d = this.drag;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8) d.moved = true;
      if (d.moved) {
        this.azT -= (e.clientX - d.lx) * 0.0075;
        this.elT = clamp(this.elT + (e.clientY - d.ly) * 0.004, 0.1, 0.95);
      }
      d.lx = e.clientX;
      d.ly = e.clientY;
    } else if (this.pointers.size === 2 && this.pinchD > 0) {
      const d = this.pinchDist();
      if (d > 5) this.zoomT = clamp((this.pinchZoom * this.pinchD) / d, 0.55, 1.4);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    const was = this.pointers.delete(e.pointerId);
    if (this.touchAnchor && this.touchAnchor.id === e.pointerId) this.touchAnchor = null;
    const d = this.drag;
    if (d && d.id === e.pointerId) {
      this.drag = null;
      if (
        was &&
        e.type === 'pointerup' &&
        !d.moved &&
        performance.now() - d.t < 700 &&
        this.phase === 'select' &&
        this.mode === 'game' &&
        !this.paused
      ) {
        const b = this.pick(e.clientX, e.clientY);
        if (b) {
          this.kbd = false;
          this.selectBlock(b);
        }
      }
    }
    if (this.pointers.size < 2) this.pinchD = 0;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoomT = clamp(this.zoomT * Math.exp(e.deltaY * 0.001), 0.55, 1.4);
  };

  private onBlur = (): void => {
    this.keys.clear();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.mode !== 'game' || this.paused || e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const code = e.code;
    this.keys.add(code);
    sfx.init();
    const isNav = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(code);
    if (isNav && (this.phase === 'select' || this.phase === 'pull')) e.preventDefault();
    if (this.phase === 'select' && this.isActive) {
      switch (code) {
        case 'ArrowUp':
        case 'KeyW':
          this.moveFocus(0, 1);
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.moveFocus(0, -1);
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.moveFocus(-1, 0);
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.moveFocus(1, 0);
          break;
        case 'Enter':
        case 'Space':
          if (this.focus && this.focus.inTower) this.selectBlock(this.focus);
          else this.moveFocus(0, 0);
          break;
        default:
          break;
      }
    } else if (this.phase === 'pull' && this.isActive) {
      if (code === 'KeyX' || code === 'Backspace') this.cancelSelection();
    }
  };

  private mapHand(clientX: number): number {
    const r = this.canvas.getBoundingClientRect();
    return clamp(((clientX - r.left) / Math.max(1, r.width) - 0.5) / 0.4, -1.1, 1.1);
  }

  private pinchDist(): number {
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private pick(cx: number, cy: number): Block | null {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickList, false);
    if (hits.length === 0) return null;
    return this.blocks[hits[0].object.userData.id as number] ?? null;
  }

  private moveFocus(dx: number, dy: number): void {
    const hc = highestCompleteLayer(this.grid);
    if (hc <= 0) return;
    this.kbd = true;
    this.hover = null;
    const f = this.focus;
    if (!f || !f.inTower || f.layer >= hc) {
      let l = Math.min(hc - 1, Math.floor((hc - 1) * 0.5));
      while (l >= 0 && countLayer(this.grid[l]) === 0) l--;
      if (l < 0) return;
      const row = this.grid[l];
      const id = row[1] >= 0 ? row[1] : row.find((v) => v >= 0)!;
      this.focus = this.blocks[id];
      sfx.click();
      this.emit();
      return;
    }
    if (dy !== 0) {
      let l = f.layer + dy;
      while (l >= 0 && l < hc) {
        const row = this.grid[l];
        if (countLayer(row) > 0) {
          let s = f.slot;
          if (row[s] < 0) {
            const order = [1, 0, 2].sort((a, b) => Math.abs(a - f.slot) - Math.abs(b - f.slot));
            s = order.find((x) => row[x] >= 0)!;
          }
          this.focus = this.blocks[row[s]];
          sfx.click();
          break;
        }
        l += dy;
      }
    } else if (dx !== 0) {
      const items = this.grid[f.layer].filter((v) => v >= 0).map((id) => this.blocks[id]);
      const v = new THREE.Vector3();
      const proj = (b: Block): number => {
        v.copy(b.mesh.position);
        this.towerGroup.localToWorld(v);
        v.project(this.camera);
        return v.x;
      };
      items.sort((a, b) => proj(a) - proj(b) || a.slot - b.slot);
      const idx = items.indexOf(f);
      const ni = idx + dx;
      if (ni >= 0 && ni < items.length) {
        this.focus = items[ni];
        sfx.click();
      }
    }
    this.emit();
  }

  /* ------------------------- seçim & çekme ------------------------- */

  private computeGrip(b: Block): number {
    const top = Math.max(1, topIndex(this.grid));
    const load = clamp((top - b.layer) / top, 0, 1);
    return clamp(0.1 + 0.55 * b.r1 + 0.35 * load * (0.5 + 0.5 * b.r2) + (b.slot === 1 ? 0.08 : 0), 0.05, 1);
  }

  private denyBlock(b: Block): void {
    sfx.deny();
    this.trauma = Math.min(1, this.trauma + 0.12);
    const hc = highestCompleteLayer(this.grid);
    const top = topIndex(this.grid);
    let msg = 'Bu taş çekilemez!';
    if (b.layer === hc && countLayer(this.grid[top]) < 3) msg = 'Eksik üst katın altındaki kattan taş çekilemez!';
    else if (b.layer >= hc) msg = 'En üstteki tamamlanmış kattan taş çekilemez!';
    this.ev.onToast(msg, 'warn');
    b.glow = 1;
    this.hover = b;
  }

  private selectBlock(b: Block): void {
    if (this.phase !== 'select' || !b.inTower || this.paused || !this.isActive) return;
    if (!isLayerAllowed(this.grid, b.layer)) {
      this.denyBlock(b);
      return;
    }
    const grip = this.computeGrip(b);
    const after = analyze(this.grid, b.id);
    const risk = riskFactor(after);
    this.pullRiskLevel = riskLevel(after);
    let d = 0.05 + 0.35 * grip + 0.3 * risk + Math.min(0.28, 0.012 * this.turn);
    if (this.turn < 2) d *= 0.7;
    d = clamp(d, 0, 1);

    const axis = layerAxis(b.layer);
    const cam = this.camera.position;
    let dirX = 0;
    let dirZ = 0;
    if (axis === 'x') dirX = cam.x >= 0 ? 1 : -1;
    else dirZ = cam.z >= 0 ? 1 : -1;

    // kamerayı çekme yönüne doğru çevir
    const az0 = Math.atan2(dirX, dirZ);
    const cand = [az0 + 0.55, az0 - 0.55].map((a) => a + Math.PI * 2 * Math.round((this.az - a) / (Math.PI * 2)));
    this.azT = Math.abs(cand[0] - this.az) < Math.abs(cand[1] - this.az) ? cand[0] : cand[1];
    this.elT = clamp(this.elT, 0.22, 0.5);

    const w1 = lerp(0.9, 1.5, d);
    this.pull = {
      block: b,
      fromLayer: b.layer,
      base: b.mesh.position.clone(),
      dirX,
      dirZ,
      grip,
      risk,
      willCollapse: !after.stable,
      afterDirX: after.dirX,
      afterDirZ: after.dirZ,
      afterWeak: after.weakLayer,
      zone: lerp(0.3, 0.11, d),
      amp: lerp(0.35, 0.72, d),
      w1,
      w2: w1 * 2.3,
      w3: w1 * 4.1,
      p1: Math.random() * 6.28,
      p2: Math.random() * 6.28,
      p3: Math.random() * 6.28,
      rate: lerp(0.3, 0.16, grip),
      armed: true,
      engaged: false,
      armTime: 0,
      inZoneTime: 0,
      t: 0,
      ramp: 0,
      progress: 0,
      stress: 0,
      hand: 0,
      handTarget: 0,
      target: 0,
      jolt: 0,
      joltGoal: 0,
      joltTimer: rnd(1.4, 2.6) / (0.4 + grip),
      warnDir: 0,
      accSum: 0,
      accT: 0,
      poke: 0,
      dustT: 0,
      sparkT: 0,
      creakT: 0,
      creaked: false,
    };
    const startHand = this.lastPointerType === 'mouse' && this.mouseX >= 0 ? this.mapHand(this.mouseX) : 0;
    this.pull.hand = startHand;
    this.pull.handTarget = startHand;
    this.phase = 'pull';
    this.hover = null;
    this.focus = null;
    sfx.select();
    sfx.poke();
    this.trauma = Math.min(1, this.trauma + 0.1);
    const w = this.towerGroup.localToWorld(b.mesh.position.clone().add(new THREE.Vector3(dirX * 1.5, 0, dirZ * 1.5)));
    this.dust(w.x, w.y, w.z, 6, 1.0, 0.5, 0xe8d3ad, 0.45, 0.6);
    this.emit();
  }

  private updatePull(dt: number): void {
    const p = this.pull;
    if (!p) return;
    const b = p.block;

    // --- girdi
    let kd = 0;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) kd += 1;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) kd -= 1;
    if (kd !== 0) p.handTarget = clamp(p.handTarget + kd * 3.0 * dt, -1.1, 1.1);
    p.hand += (p.handTarget - p.hand) * (1 - Math.exp(-dt * 30));
    p.poke += dt;

    // --- hedef (denge noktası)
    let target = 0;
    if (p.engaged) {
      p.t += dt;
      p.ramp = Math.min(1, p.ramp + dt / 1.2);
      const t = p.t;
      const wander =
        p.amp * (0.55 * Math.sin(p.w1 * t + p.p1) + 0.3 * Math.sin(p.w2 * t + p.p2) + 0.15 * Math.sin(p.w3 * t + p.p3));
      if (p.t > 1.6 && p.progress < 0.93) {
        p.joltTimer -= dt;
        if (p.warnDir === 0 && p.joltTimer < 0.45) {
          const cur = p.target;
          p.warnDir = cur > 0.25 ? -1 : cur < -0.25 ? 1 : Math.random() < 0.5 ? -1 : 1;
          sfx.warn();
        }
        if (p.joltTimer <= 0) {
          p.joltGoal += p.warnDir * (0.22 + 0.3 * p.grip);
          p.warnDir = 0;
          p.joltTimer = rnd(1.4, 2.6) / (0.4 + p.grip);
          this.trauma = Math.min(1, this.trauma + 0.3);
          sfx.creak(0.9);
          sfx.thud(0.3);
          const w = this.pullExitWorld(p);
          this.sparkle(w.x, w.y, w.z, 8, 0xffd27a, 2.8, 0.2, 0.5);
          this.leanVel += (p.joltGoal > 0 ? 1 : -1) * 0.25;
        }
      }
      p.jolt += (p.joltGoal - p.jolt) * (1 - Math.exp(-dt * 14));
      p.joltGoal *= Math.exp(-dt * 1.4);
      target = clamp(wander * p.ramp + p.jolt, -0.92, 0.92);
    }
    p.target = target;

    const err = p.hand - target;
    const ae = Math.abs(err);
    const inZone = ae <= p.zone;

    if (!p.engaged) {
      p.armTime += dt;
      p.inZoneTime = inZone ? p.inZoneTime + dt : 0;
      if (p.inZoneTime > 0.45 && p.armTime > 1.1) {
        p.engaged = true;
        sfx.engage();
        this.emit();
      }
    } else {
      const center = inZone ? 1 - ae / p.zone : 0;
      p.accT += dt;
      if (inZone) {
        p.progress += p.rate * (0.75 + 0.5 * center) * dt;
        p.stress = Math.max(0, p.stress - dt * 0.5);
        p.accSum += center * dt;
      } else {
        const over = ae - p.zone;
        p.stress += (0.85 + 2.0 * over) * dt * (p.t < 1.0 ? 0.5 : 1);
      }
      p.stress = clamp(p.stress, 0, 1);

      // efektler
      sfx.scrape(inZone ? 0.4 + 0.6 * p.grip : 0, p.progress);
      p.dustT -= dt;
      if (inZone && p.dustT <= 0) {
        p.dustT = 0.07;
        const w = this.pullExitWorld(p);
        this.dust(w.x, w.y - 0.2, w.z, 1, 0.5, 0.35, 0xe2c79c, 0.32, 0.55);
      }
      p.sparkT -= dt;
      if (inZone && ae < p.zone * 0.3 && p.sparkT <= 0) {
        p.sparkT = 0.28;
        const w = this.pullExitWorld(p);
        this.sparkle(w.x, w.y + 0.1, w.z, 2, 0xffe29a, 1.6, 0.16, 0.7);
      }
      if (p.stress > 0.3) {
        p.creakT -= dt;
        if (p.creakT <= 0) {
          sfx.creak(p.stress);
          p.creakT = 0.3 + (1 - p.stress) * 0.5;
        }
      }
      this.contTrauma = p.stress * 0.45;
    }

    // --- sallanma
    this.leanAxis.set(-Math.sin(this.az), 0, -Math.cos(this.az));
    this.leanGoal = p.engaged ? clamp((target - p.hand) * 0.08, -0.13, 0.13) : 0;

    // --- taşın konumu
    const poke = p.poke;
    let po = 0;
    if (poke < 0.12) po = -0.1 * (poke / 0.12);
    else if (poke < 0.3) po = lerp(-0.1, 0.14, (poke - 0.12) / 0.18);
    else if (poke < 0.5) po = lerp(0.14, 0, (poke - 0.3) / 0.2);
    const travel = p.progress * (BLOCK_L + 0.25) + po;
    const jit = p.engaged ? 0.006 + p.stress * 0.035 : 0;
    b.mesh.position.set(
      p.base.x + p.dirX * travel + (p.dirX === 0 ? (Math.random() - 0.5) * jit : 0),
      p.base.y + (Math.random() - 0.5) * jit * 0.6,
      p.base.z + p.dirZ * travel + (p.dirZ === 0 ? (Math.random() - 0.5) * jit : 0),
    );

    // --- gösterge
    const g = this.gauge;
    g.visible = true;
    g.hand = p.hand;
    g.target = target;
    g.zone = p.zone;
    g.progress = clamp(p.progress, 0, 1);
    g.stress = p.stress;
    g.engaged = p.engaged;
    g.inZone = inZone;
    g.warn = p.warnDir;
    this.ev.onGauge(g);
    this.gaugeShown = true;

    // --- sonuçlar
    if (p.stress >= 1) {
      const sign = target - p.hand >= 0 ? 1 : -1;
      const dx = Math.cos(this.az) * sign;
      const dz = -Math.sin(this.az) * sign;
      this.startCollapse('balance', dx, dz, p.fromLayer);
      return;
    }
    if (!p.creaked && p.willCollapse && p.progress >= 0.55) {
      p.creaked = true;
      this.beginCreak(p.afterDirX, p.afterDirZ, p.afterWeak);
      return;
    }
    if (p.progress >= 1) {
      p.progress = 1;
      this.beginPlacing();
    }
  }

  private pullExitWorld(p: PullState): THREE.Vector3 {
    const local = p.base.clone().add(new THREE.Vector3(p.dirX * (BLOCK_L / 2 + 0.05), 0, p.dirZ * (BLOCK_L / 2 + 0.05)));
    return this.towerGroup.localToWorld(local);
  }

  private beginCreak(dirX: number, dirZ: number, weak: number): void {
    this.phase = 'creak';
    this.creakInfo = { t: 0, dirX, dirZ, weak, ct: 0 };
    this.hideGauge();
    sfx.stopScrape();
    sfx.creak(1);
    this.ev.onToast('Kule gıcırdıyor…', 'warn');
    if (this.net && this.isActive) this.outTs.push(['Kule gıcırdıyor…', 'warn']);
    this.emit();
  }

  private updateCreak(dt: number): void {
    const c = this.creakInfo;
    if (!c) return;
    c.t += dt;
    c.ct -= dt;
    const u = clamp(c.t / 1.0, 0, 1);
    this.leanAxis.set(c.dirZ, 0, -c.dirX);
    this.leanGoal = lerp(0.03, 0.19, u * u);
    this.contTrauma = 0.2 + 0.55 * u;
    if (c.ct <= 0) {
      c.ct = 0.14;
      sfx.creak(0.6 + u * 0.4);
    }
    if (c.t >= 1.0) {
      this.startCollapse('structure', c.dirX, c.dirZ, c.weak);
    }
  }

  /* ---------------------------- yerleştirme ---------------------------- */

  private beginPlacing(): void {
    const p = this.pull!;
    const b = p.block;
    sfx.stopScrape();
    this.hideGauge();
    this.grid[b.layer][b.slot] = -1;
    b.inTower = false;
    this.refreshPick();
    const dest = nextTopSlot(this.grid);
    while (this.grid.length <= dest.layer) this.grid.push([-1, -1, -1]);
    const [x, y, z] = slotPosition(dest.layer, dest.slot);
    this.place = {
      block: b,
      t: 0,
      p0: b.mesh.position.clone(),
      q0: b.mesh.quaternion.clone(),
      p1: new THREE.Vector3(x, y, z),
      q1: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), layerAxis(dest.layer) === 'z' ? Math.PI / 2 : 0),
      dest,
      landed: false,
      after: 0,
      acc: p.accT > 0 ? p.accSum / p.accT : 0.5,
      grip: p.grip,
      risk: p.risk,
      fromLayer: p.fromLayer,
    };
    this.pull = null;
    this.phase = 'placing';
    sfx.success(1);
    this.emit();
  }

  private updatePlacing(dt: number): void {
    const pl = this.place;
    if (!pl) return;
    pl.t += dt;
    const b = pl.block;
    const HOLD = 0.18;
    const FLY = 0.95;
    if (pl.t < HOLD) {
      return;
    }
    if (pl.t < HOLD + FLY) {
      const u = (pl.t - HOLD) / FLY;
      const yA = Math.max(pl.p0.y, pl.p1.y) + 1.6;
      if (u < 0.35) {
        const s = easeOutCubic(u / 0.35);
        b.mesh.position.set(pl.p0.x, lerp(pl.p0.y, yA, s), pl.p0.z);
        b.mesh.quaternion.copy(pl.q0);
      } else if (u < 0.78) {
        const s = easeInOutCubic((u - 0.35) / 0.43);
        b.mesh.position.set(lerp(pl.p0.x, pl.p1.x, s), yA, lerp(pl.p0.z, pl.p1.z, s));
        b.mesh.quaternion.slerpQuaternions(pl.q0, pl.q1, s);
      } else {
        const s = easeInCubic((u - 0.78) / 0.22);
        b.mesh.position.set(pl.p1.x, lerp(yA, pl.p1.y, s), pl.p1.z);
        b.mesh.quaternion.copy(pl.q1);
      }
      return;
    }
    if (!pl.landed) {
      this.land(pl);
      return;
    }
    pl.after += dt;
    if (pl.after > 0.7) {
      this.place = null;
      this.nextTurn();
    }
  }

  private land(pl: PlaceState): void {
    pl.landed = true;
    const b = pl.block;
    b.mesh.position.copy(pl.p1);
    b.mesh.quaternion.copy(pl.q1);
    b.layer = pl.dest.layer;
    b.slot = pl.dest.slot;
    this.grid[b.layer][b.slot] = b.id;
    b.inTower = true;
    this.refreshPick();
    b.squash = 0.16;
    const w = this.towerGroup.localToWorld(pl.p1.clone());
    this.dust(w.x, w.y - 0.25, w.z, 16, 2.4, 0.9, 0xe8d3ad, 0.7, 0.95);
    sfx.place();
    this.trauma = Math.min(1, this.trauma + 0.24);
    this.leanVel += (Math.random() < 0.5 ? -1 : 1) * 0.35;

    const a = analyze(this.grid);
    if (!a.stable) {
      this.startCollapse('structure', a.dirX, a.dirZ, a.weakLayer);
      return;
    }
    this.stability = stabilityPercent(a);
    this.scoreMove(pl, w);
    this.emit();
  }

  private scoreMove(pl: PlaceState, w: THREE.Vector3): void {
    const acc = pl.acc;
    const tier: 0 | 1 | 2 = acc >= 0.6 ? 2 : acc >= 0.4 ? 1 : 0;
    const player = this.players[this.current];
    player.streak = tier >= 1 ? player.streak + 1 : 0;
    const mult = 1 + 0.25 * Math.min(4, Math.max(0, player.streak - 1));
    const base = 100 + 6 * pl.fromLayer + Math.round(pl.grip * 60) + Math.round(acc * 120) + Math.round(pl.risk * 80);
    const points = Math.round(base * mult);
    player.score += points;
    player.pulls += 1;
    if (tier === 2) {
      this.confetti(w.x, w.y + 0.6, w.z, 38, CONFETTI);
      this.sparkle(w.x, w.y + 0.4, w.z, 18, 0xffe29a, 4, 0.28, 0.9);
      sfx.success(3);
    } else if (tier === 1) {
      this.sparkle(w.x, w.y + 0.4, w.z, 12, 0xffe29a, 3, 0.24, 0.8);
      sfx.success(2);
    }
    const mvInfo: MoveResult = { player: this.current, points, tier, mult, streak: player.streak, acc };
    if (this.net && this.isActive) this.outMv.push(mvInfo);
    this.ev.onMove(mvInfo);
  }

  private nextTurn(): void {
    this.turn += 1;
    this.current = (this.current + 1) % this.players.length;
    if (!hasAnyMove(this.grid)) {
      this.ev.onToast('Çekilecek taş kalmadı!', 'warn');
      this.startCollapse('nomoves', 1, 0, 0);
      return;
    }
    this.phase = 'select';
    this.focus = null;
    this.hover = null;
    sfx.turn();
    if (this.online && this.net) {
      const m: NetMsg = {
        t: 'turn',
        settled: this.exportSettled(),
        players: this.players.map((pl) => ({ ...pl })),
        current: this.current,
        turn: this.turn,
        stability: this.stability,
      };
      this.takeExtras(m);
      this.outSnap = null;
      this.net(m);
      this.ctl = this.current;
      this.mSel = null;
      this.mTarget.clear();
    }
    this.emit();
  }

  /* ------------------------------ çöküş ------------------------------ */

  private startCollapse(reason: GameOverInfo['reason'], dirX: number, dirZ: number, weakLayer: number): void {
    if (this.phase === 'collapse' || this.phase === 'over') return;
    this.collapseReason = reason;
    this.phase = 'collapse';
    this.hideGauge();
    sfx.stopScrape();
    this.pull = null;
    this.place = null;
    this.creakInfo = null;
    this.hover = null;
    this.focus = null;
    this.collapseT = 0;
    this.timeScale = 0.28;
    this.trauma = 1;
    sfx.collapse();

    this.towerGroup.updateMatrixWorld(true);
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -28, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.allowSleep = true;
    (world.solver as CANNON.GSSolver).iterations = 12;
    const matBlock = new CANNON.Material('block');
    const matGround = new CANNON.Material('ground');
    world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matBlock, { friction: 0.42, restitution: 0.04 }));
    world.addContactMaterial(new CANNON.ContactMaterial(matBlock, matGround, { friction: 0.6, restitution: 0.06 }));
    const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane(), material: matGround });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(ground);

    const weakY = layerY(Math.max(0, weakLayer));
    const towerH = Math.max(1, (topIndex(this.grid) + 1) * LAYER_H);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const b of this.blocks) {
      b.mesh.visible = true;
      b.mesh.updateWorldMatrix(true, false);
      b.mesh.getWorldPosition(pos);
      b.mesh.getWorldQuaternion(q);
      this.scene.add(b.mesh);
      b.mesh.position.copy(pos);
      b.mesh.quaternion.copy(q);
      b.mesh.scale.set(1, 1, 1);
      b.squash = 0;
      const body = new CANNON.Body({
        mass: 1,
        material: matBlock,
        shape: new CANNON.Box(new CANNON.Vec3(BLOCK_L / 2, BLOCK_H / 2, BLOCK_W / 2)),
        position: new CANNON.Vec3(pos.x, pos.y, pos.z),
        linearDamping: 0.02,
        angularDamping: 0.06,
        allowSleep: true,
      });
      body.quaternion.set(q.x, q.y, q.z, q.w);
      body.sleepSpeedLimit = 0.2;
      body.sleepTimeLimit = 0.6;
      if (pos.y > weakY) {
        const h = clamp((pos.y - weakY) / towerH, 0, 1);
        const sp = 1.4 + 5.5 * h;
        body.velocity.set(dirX * sp + (Math.random() - 0.5) * 0.6, 0, dirZ * sp + (Math.random() - 0.5) * 0.6);
        const wv = 0.3 + 0.9 * h;
        body.angularVelocity.set(
          dirZ * wv + (Math.random() - 0.5) * 0.3,
          (Math.random() - 0.5) * 0.5,
          -dirX * wv + (Math.random() - 0.5) * 0.3,
        );
      }
      body.addEventListener('collide', this.onCollide);
      world.addBody(body);
      b.body = body;
    }
    this.towerGroup.quaternion.identity();
    this.lean = 0;
    this.leanVel = 0;
    this.world = world;
    this.emit();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onCollide = (e: any): void => {
    const v = Math.abs(e.contact.getImpactVelocityAlongNormal() as number);
    if (v < 1.8) return;
    this.trauma = Math.min(1, this.trauma + v * 0.006);
    if (this.time - this.lastHit > 0.04) {
      this.lastHit = this.time;
      sfx.hit(v);
    }
    const p = e.target.position as CANNON.Vec3;
    if (v > 3.2 && this.hitBudget > 0) {
      this.hitBudget--;
      this.dust(p.x, Math.max(0.15, p.y), p.z, 3, 1.5, 1.0, 0xcfb08a, 0.6, 0.9);
    }
    if (v > 5 && this.shardBudget > 0) {
      this.shardBudget--;
      for (let i = 0; i < 2; i++) {
        this.meshFx.emit(
          p.x, Math.max(0.2, p.y), p.z,
          rnd(-3, 3), rnd(2, 6), rnd(-3, 3),
          rnd(0.06, 0.16), rnd(0.04, 0.09), rnd(0.18, 0.4),
          WOOD_SHARDS[Math.floor(Math.random() * WOOD_SHARDS.length)],
          rnd(1.2, 2.2), 16, 26,
        );
      }
    }
  };

  private updateCollapse(dt: number, raw: number): void {
    this.collapseT += raw;
    this.hitBudget = 4;
    this.shardBudget = 3;
    if (this.world) {
      this.world.step(1 / 60, dt, 3);
      for (const b of this.blocks) {
        const body = b.body;
        if (!body || body.sleepState === CANNON.Body.SLEEPING) continue;
        b.mesh.position.set(body.position.x, body.position.y, body.position.z);
        b.mesh.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
      }
    }
    if (this.phase === 'collapse' && this.collapseT > 2.8) {
      this.phase = 'over';
      sfx.lose();
      this.confetti(0, 9, 0, 70, CONFETTI);
      const info: GameOverInfo = {
        loser: this.current,
        reason: this.collapseReason,
        players: this.players.map((p) => ({ ...p })),
        turn: this.turn,
        layers: Math.max(0, topIndex(this.grid) + 1),
      };
      if (this.online && this.net) {
        const m: NetMsg = { t: 'over', info };
        this.takeExtras(m);
        this.net(m);
      }
      this.ev.onGameOver(info);
      this.emit();
    }
  }

  /* ------------------------------ efektler ------------------------------ */

  private dust(x: number, y: number, z: number, n: number, spread: number, up: number, hex = 0xe2c9a0, size = 0.6, life = 0.8): void {
    if (this.net && this.isActive) this.outFx.push([0, x, y, z, n, spread, up, hex, size, life]);
    const rgb = hexToRgb(hex);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = spread * (0.3 + Math.random() * 0.7);
      this.pointFx.emit(
        x + Math.cos(a) * 0.2, y, z + Math.sin(a) * 0.2,
        Math.cos(a) * s, up * (0.3 + Math.random() * 0.7), Math.sin(a) * s,
        life * (0.7 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), rgb, 0.4, 2.0, 1.4,
      );
    }
  }

  private sparkle(x: number, y: number, z: number, n: number, hex: number, speed = 2.5, size = 0.22, life = 0.7): void {
    if (this.net && this.isActive) this.outFx.push([1, x, y, z, n, hex, speed, size, life]);
    const rgb = hexToRgb(hex);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.pointFx.emit(
        x, y, z,
        Math.sin(ph) * Math.cos(th) * s, Math.abs(Math.cos(ph)) * s + 0.8, Math.sin(ph) * Math.sin(th) * s,
        life * (0.7 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), rgb, 3, 1.2, -0.5,
      );
    }
  }

  private confetti(x: number, y: number, z: number, n: number, colors: number[]): void {
    if (this.net && this.isActive) this.outFx.push([2, x, y, z, n]);
    for (let i = 0; i < n; i++) {
      this.meshFx.emit(
        x + rnd(-0.6, 0.6), y, z + rnd(-0.6, 0.6),
        rnd(-5, 5), rnd(5, 11), rnd(-5, 5),
        0.17, 0.025, 0.3,
        colors[Math.floor(Math.random() * colors.length)],
        rnd(2.6, 4.4), 18, 12,
      );
    }
  }

  /* ------------------------------ döngü ------------------------------ */

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let raw = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(raw > 0)) raw = 0.016;
    raw = Math.min(raw, 0.05);
    if (!this.paused) {
      this.time += raw;
      this.timeScale = Math.min(1, this.timeScale + raw * 0.9);
      this.update(raw * this.timeScale, raw);
      if (this.phase === 'select' || this.phase === 'pull' || this.phase === 'menu') {
        this.emaDt = this.emaDt * 0.95 + raw * 0.05;
        this.perfT += raw;
        if (this.perfT > 2.5) {
          this.perfT = 0;
          if (this.emaDt > 0.025 && this.pixelRatio > 1) {
            this.pixelRatio = Math.max(1, this.pixelRatio - 0.25);
            this.resize();
          }
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private cursor = '';
  private setCursor(c: string): void {
    if (this.cursor !== c) {
      this.cursor = c;
      this.canvas.style.cursor = c;
    }
  }

  private update(dt: number, raw: number): void {
    this.leanGoal = 0;
    this.contTrauma = 0;
    if (this.phase === 'pull') this.setCursor('crosshair');
    else if (this.phase !== 'select') this.setCursor(this.mode === 'menu' ? 'grab' : 'default');
    const mirror = this.online && !this.isActive && this.phase !== 'intro' && this.phase !== 'menu';
    if (mirror) {
      if (this.phase === 'select') this.updateSelect(raw);
      this.updateMirror(dt, raw);
    } else {
      switch (this.phase) {
        case 'menu':
          this.azT += raw * 0.12;
          break;
        case 'intro':
          this.updateIntro(raw);
          break;
        case 'select':
          this.updateSelect(raw);
          break;
        case 'pull':
          this.updatePull(dt);
          break;
        case 'placing':
          this.updatePlacing(dt);
          break;
        case 'creak':
          this.updateCreak(dt);
          break;
        case 'collapse':
        case 'over':
          this.updateCollapse(dt, raw);
          break;
      }
      this.updateLean(dt);
    }
    this.updateBlocks(raw);
    this.updateCamera(raw);
    this.pointFx.update(dt);
    this.meshFx.update(dt);
    this.pumpNet(raw);
  }

  private updateIntro(raw: number): void {
    this.introT += raw;
    for (const b of this.blocks) {
      const u = clamp((this.introT - b.introDelay) / 0.55, 0, 1);
      if (u <= 0) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.visible = true;
      const [x, y, z] = slotPosition(b.layer, b.slot);
      b.mesh.position.set(x, y + (1 - easeOutBounce(u)) * 9, z);
      if (u >= 1 && !b.landed) {
        b.landed = true;
        b.squash = 0.07;
        if (b.slot === 1) {
          sfx.stack(b.layer);
          this.dust(x, 0.1 + b.layer * LAYER_H, z, 3, 1.4, 0.4, 0xe8d3ad, 0.45, 0.6);
        }
      }
    }
    if (this.introT > 1.7) {
      for (const b of this.blocks) {
        const [x, y, z] = slotPosition(b.layer, b.slot);
        b.mesh.position.set(x, y, z);
        b.mesh.visible = true;
      }
      this.phase = this.mode === 'game' ? 'select' : 'menu';
      this.emit();
    }
  }

  private updateSelect(raw: number): void {
    let rot = 0;
    if (this.keys.has('KeyQ')) rot -= 1;
    if (this.keys.has('KeyE')) rot += 1;
    if (rot !== 0) this.azT += rot * 1.9 * raw;
    if (this.keys.has('KeyZ')) this.elT = clamp(this.elT - raw * 0.8, 0.1, 0.95);
    if (this.keys.has('KeyC')) this.elT = clamp(this.elT + raw * 0.8, 0.1, 0.95);

    if (this.isActive && this.mouseIn && this.lastPointerType === 'mouse' && !this.kbd && !(this.drag && this.drag.moved)) {
      this.hoverTimer -= raw;
      if (this.hoverTimer <= 0) {
        this.hoverTimer = 0.05;
        this.hover = this.pick(this.mouseX, this.mouseY);
        this.setCursor(this.hover ? (isLayerAllowed(this.grid, this.hover.layer) ? 'pointer' : 'not-allowed') : 'grab');
      }
    } else if ((!this.mouseIn && !this.kbd) || !this.isActive) {
      this.hover = null;
    }
  }

  private updateLean(dt: number): void {
    const sub = Math.min(dt, 0.03);
    if (sub <= 0) return;
    const k = 90;
    const c = 9;
    this.leanVel += ((this.leanGoal - this.lean) * k - this.leanVel * c) * sub;
    this.lean += this.leanVel * sub;
    if (Math.abs(this.lean) < 1e-5 && Math.abs(this.leanVel) < 1e-5 && this.leanGoal === 0) {
      this.lean = 0;
      this.leanVel = 0;
    }
    this.towerGroup.quaternion.setFromAxisAngle(this.leanAxis, this.lean);
  }

  private updateBlocks(raw: number): void {
    const allowedCache = new Map<number, boolean>();
    const pullBlock = this.pull ? this.pull.block : null;
    for (const b of this.blocks) {
      let target = 0;
      let color = AMBER;
      if (this.phase === 'select' && b.inTower) {
        if (b === this.hover || b === this.focus) {
          let ok = allowedCache.get(b.layer);
          if (ok === undefined) {
            ok = isLayerAllowed(this.grid, b.layer);
            allowedCache.set(b.layer, ok);
          }
          target = ok ? 0.5 + 0.15 * Math.sin(this.time * 6) : 0.4;
          color = ok ? AMBER : RED;
        }
      } else if (this.phase === 'pull' && b === pullBlock) {
        target = 0.35 + 0.2 * Math.sin(this.time * 8);
        color = this.pull && this.pull.engaged ? MINT : AMBER;
      } else if (this.phase === 'placing' && this.place && this.place.block === b && !this.place.landed) {
        target = 0.3;
        color = MINT;
      }
      b.glow += (target - b.glow) * (1 - Math.exp(-raw * 14));
      if (b.glow > 0.003) {
        b.mat.emissive.setHex(color);
        b.mat.emissiveIntensity = b.glow;
      } else if (b.mat.emissiveIntensity !== 0) {
        b.mat.emissiveIntensity = 0;
      }
      if (b.squash > 0.002) {
        b.squash *= Math.exp(-raw * 12);
        b.mesh.scale.set(1 + b.squash * 0.5, 1 - b.squash, 1 + b.squash * 0.5);
      } else if (b.squash !== 0) {
        b.squash = 0;
        b.mesh.scale.set(1, 1, 1);
      }
    }
  }

  private fitDist(h: number): number {
    const t = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const dv = (Math.max(h, 8) * 1.34) / 2 / t;
    const dh = 6.6 / 2 / (t * this.camera.aspect);
    return Math.max(dv, dh);
  }

  private updateCamera(raw: number): void {
    const towerH = Math.max(8, (topIndex(this.grid) + 1) * LAYER_H);
    let focusT = towerH * 0.5 + towerH * 0.06;
    let zoomP = 1.0;
    switch (this.phase) {
      case 'menu':
      case 'intro':
        zoomP = 1.08;
        break;
      case 'pull':
        if (this.pull) focusT = lerp(focusT, this.pull.base.y + 0.4, 0.5);
        zoomP = 0.8;
        break;
      case 'creak':
        zoomP = 0.95;
        break;
      case 'placing':
        if (this.place) focusT = lerp(focusT, this.place.p1.y, 0.35);
        zoomP = 0.95;
        break;
      case 'collapse':
        focusT = 3.2;
        zoomP = 1.35;
        break;
      case 'over':
        focusT = 2.6;
        zoomP = 1.45;
        this.azT += raw * 0.05;
        break;
      default:
        break;
    }
    const kf = 1 - Math.exp(-raw * 4);
    this.focusY += (focusT - this.focusY) * kf;
    this.zoomPhase += (zoomP - this.zoomPhase) * kf;
    this.zoom += (this.zoomT - this.zoom) * (1 - Math.exp(-raw * 10));
    this.az += (this.azT - this.az) * (1 - Math.exp(-raw * (this.phase === 'pull' ? 4 : 12)));
    this.el += (this.elT - this.el) * (1 - Math.exp(-raw * 10));

    const dist = this.fitDist(towerH) * this.zoom * this.zoomPhase;
    const ce = Math.cos(this.el);
    let cx = Math.sin(this.az) * ce * dist;
    let cy = Math.sin(this.el) * dist + this.focusY;
    let cz = Math.cos(this.az) * ce * dist;

    this.trauma = Math.max(0, this.trauma - raw * 1.4);
    const tr = clamp(this.trauma + this.contTrauma, 0, 1);
    const sh = tr * tr;
    let roll = 0;
    if (sh > 0.0004) {
      const t = this.time * 38;
      cx += sh * 0.5 * noise1(t, 1.3);
      cy += sh * 0.5 * noise1(t, 7.1);
      cz += sh * 0.5 * noise1(t, 3.7);
      roll = sh * 0.035 * noise1(t, 11.3);
    }
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(0, this.focusY, 0);
    if (roll !== 0) this.camera.rotateZ(roll);
  }
}
