// Saf oyun mantığı: kule ızgarası, Cenga kuralları ve denge analizi.

export const BLOCK_L = 2.98; // taş uzunluğu (görsel/fizik)
export const BLOCK_W = 0.98; // taş genişliği
export const BLOCK_H = 0.58; // taş yüksekliği
export const PITCH = 1.0; // yan yana taşların merkez aralığı
export const LAYER_H = 0.6; // kat yüksekliği
export const TOTAL_LAYERS = 18;
export const SLOT_ORDER = [1, 0, 2]; // üst kata yerleştirme sırası

export type Axis = 'x' | 'z';

export const layerAxis = (layer: number): Axis => (layer % 2 === 0 ? 'x' : 'z');
export const slotOffset = (slot: number): number => (slot - 1) * PITCH;
export const layerY = (layer: number): number => layer * LAYER_H + LAYER_H / 2;

/** Bir taşın kule içindeki yerel konumu */
export function slotPosition(layer: number, slot: number): [number, number, number] {
  const off = slotOffset(slot);
  return layerAxis(layer) === 'x' ? [0, layerY(layer), off] : [off, layerY(layer), 0];
}

export type Grid = number[][];

export function createGrid(): Grid {
  let id = 0;
  const g: Grid = [];
  for (let l = 0; l < TOTAL_LAYERS; l++) {
    g.push([id++, id++, id++]);
  }
  return g;
}

export const countLayer = (row: number[]): number => row.reduce((a, v) => a + (v >= 0 ? 1 : 0), 0);

export function topIndex(grid: Grid): number {
  let t = grid.length - 1;
  while (t >= 0 && countLayer(grid[t]) === 0) t--;
  return t;
}

/** Cenga kuralı: en üstteki TAMAMLANMIŞ kattan ve onun üstündeki katlardan taş çekilemez. */
export function highestCompleteLayer(grid: Grid): number {
  const top = topIndex(grid);
  if (top < 0) return -1;
  return countLayer(grid[top]) === 3 ? top : top - 1;
}

export function isLayerAllowed(grid: Grid, layer: number): boolean {
  return layer < highestCompleteLayer(grid);
}

export function hasAnyMove(grid: Grid): boolean {
  const hc = highestCompleteLayer(grid);
  for (let l = 0; l < hc; l++) if (countLayer(grid[l]) > 0) return true;
  return false;
}

/** Çekilen taşın kuleye yerleşeceği yer: önce mevcut üst katı tamamla, sonra yeni kat aç. */
export function nextTopSlot(grid: Grid): { layer: number; slot: number } {
  const top = topIndex(grid);
  if (top < 0) return { layer: 0, slot: 1 };
  if (countLayer(grid[top]) === 3) return { layer: top + 1, slot: 1 };
  for (const s of SLOT_ORDER) {
    if (grid[top][s] === -1) return { layer: top, slot: s };
  }
  return { layer: top + 1, slot: 1 };
}

export interface Analysis {
  stable: boolean;
  margin: number; // en dar katın gerçek devrilme payı
  soft: number; // risk için yumuşatılmış pay
  weakLayer: number;
  dirX: number;
  dirZ: number;
}

/**
 * Her kat için, üstündeki yığının ağırlık merkezi bu katın taşıma
 * alanı (taşların kapladığı bölge) içinde mi diye bakar.
 */
export function analyze(grid: Grid, exclude = -1): Analysis {
  const res: Analysis = { stable: true, margin: 99, soft: 99, weakLayer: -1, dirX: 1, dirZ: 0 };
  let mass = 0;
  let mx = 0;
  let mz = 0;
  for (let k = grid.length - 1; k >= 0; k--) {
    const axis = layerAxis(k);
    const slots: number[] = [];
    for (let s = 0; s < 3; s++) {
      const v = grid[k][s];
      if (v >= 0 && v !== exclude) slots.push(s);
    }
    if (mass > 0) {
      if (slots.length === 0) {
        res.margin = -1;
        res.soft = -1;
        res.weakLayer = k;
        const cx = mx / mass;
        const cz = mz / mass;
        const len = Math.hypot(cx, cz) || 1;
        res.dirX = len > 0.001 ? cx / len : 1;
        res.dirZ = len > 0.001 ? cz / len : 0;
      } else {
        const lo = (Math.min(...slots) - 1) * PITCH - BLOCK_W / 2 - 0.01;
        const hi = (Math.max(...slots) - 1) * PITCH + BLOCK_W / 2 + 0.01;
        const c = axis === 'x' ? mz / mass : mx / mass; // kat eksenine dik koordinat
        const cl = axis === 'x' ? mx / mass : mz / mass; // taş boyunca koordinat
        const m1 = c - lo;
        const m2 = hi - c;
        const m = Math.min(m1, m2);
        const M = Math.max(m1, m2);
        const ml = BLOCK_L / 2 - Math.abs(cl);
        const margin = Math.min(m, ml);
        const soft = Math.min(0.7 * m + 0.3 * M, ml);
        if (margin < res.margin) {
          res.margin = margin;
          res.weakLayer = k;
          const sign = m2 < m1 ? 1 : -1;
          if (axis === 'x') {
            res.dirX = 0;
            res.dirZ = sign;
          } else {
            res.dirX = sign;
            res.dirZ = 0;
          }
        }
        if (soft < res.soft) res.soft = soft;
      }
    }
    for (const s of slots) {
      const off = slotOffset(s);
      if (axis === 'x') mz += off;
      else mx += off;
      mass += 1;
    }
  }
  res.stable = res.margin > 0.03;
  return res;
}

/** 0..1 kule dengesi göstergesi */
export function stabilityPercent(a: Analysis): number {
  if (!a.stable) return 0;
  return Math.max(0, Math.min(1, (a.soft - 0.03) / 0.9));
}

/** 0..1 risk faktörü (taş çekilince kalan pay üzerinden) */
export function riskFactor(a: Analysis): number {
  if (!a.stable) return 1;
  return Math.max(0, Math.min(1, (1.5 - a.soft) / 1.3));
}

export type RiskLevel = 0 | 1 | 2 | 3;

export function riskLevel(a: Analysis): RiskLevel {
  if (!a.stable || a.soft < 0.45) return 3;
  if (a.soft < 0.75) return 2;
  if (a.soft < 1.0) return 1;
  return 0;
}

export const RISK_LABELS = ['Güvenli', 'Dengeli', 'Riskli', 'Çok riskli'] as const;

export function gripLabel(g: number): string {
  if (g < 0.38) return 'Gevşek';
  if (g < 0.65) return 'Normal';
  return 'Sıkı';
}
