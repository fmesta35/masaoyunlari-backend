// Yerel yüksek skor tablosu (localStorage)

export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  players: number;
  turns: number;
  date: number;
  crashed: boolean;
}

const KEY = 'cenga.highscores.v1';
const MAX = 10;

export function loadScores(): ScoreEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((e) => e && typeof e.score === 'number' && typeof e.name === 'string')
      .slice(0, MAX) as ScoreEntry[];
  } catch {
    return [];
  }
}

export function addScores(entries: Omit<ScoreEntry, 'id'>[]): { list: ScoreEntry[]; addedIds: string[] } {
  const current = loadScores();
  const added: ScoreEntry[] = entries
    .filter((e) => e.score > 0)
    .map((e, i) => ({ ...e, id: `${e.date}-${i}-${Math.random().toString(36).slice(2, 7)}` }));
  const merged = [...current, ...added].sort((a, b) => b.score - a.score).slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* depolama dolu / kapalı olabilir */
  }
  const ids = new Set(merged.map((m) => m.id));
  return { list: merged, addedIds: added.filter((a) => ids.has(a.id)).map((a) => a.id) };
}

export function clearScores(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* yoksay */
  }
}
