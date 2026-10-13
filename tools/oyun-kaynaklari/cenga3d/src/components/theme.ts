export const PLAYER_COLORS = ['#ffb547', '#4cc9f0', '#ff6b9a', '#9be564'] as const;

export const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

export const isTouchDevice = (): boolean =>
  typeof window !== 'undefined' && typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const TIER_LABELS = ['İYİ', 'HARİKA!', 'MÜKEMMEL!'] as const;
