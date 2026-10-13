import type { ScoreEntry } from '../game/storage';
import { cn } from '../utils/cn';

interface Props {
  scores: ScoreEntry[];
  highlight?: string[];
  compact?: boolean;
  onClear?: () => void;
}

const MEDALS = ['🥇', '🥈', '🥉'];

export default function HighScores({ scores, highlight = [], compact, onClear }: Props) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold tracking-[0.18em] text-amber">🏆 EN YÜKSEK SKORLAR</h3>
        {onClear && scores.length > 0 && (
          <button
            onClick={onClear}
            className="text-xs text-cream/50 underline-offset-2 hover:text-cream hover:underline"
          >
            Temizle
          </button>
        )}
      </div>
      {scores.length === 0 ? (
        <p className="rounded-xl border border-dashed border-cream/20 px-3 py-4 text-center text-sm text-cream/60">
          Henüz skor yok — ilk rekoru sen kır!
        </p>
      ) : (
        <ol className={cn('thin-scroll space-y-1 overflow-y-auto pr-1', compact ? 'max-h-44' : 'max-h-64')}>
          {scores.map((s, i) => {
            const isNew = highlight.includes(s.id);
            return (
              <li
                key={s.id}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm',
                  isNew ? 'bg-amber/20 ring-1 ring-amber/60' : 'bg-cream/[0.05]',
                )}
              >
                <span className="w-6 text-center font-bold text-cream/70">{MEDALS[i] ?? i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {s.name}
                  {s.crashed && <span title="Kuleyi yıktı"> 💥</span>}
                </span>
                <span className="text-[0.7rem] text-cream/45">{s.players}K · {s.turns}H</span>
                <span className="w-14 text-right font-bold tabular-nums text-amber">{s.score}</span>
                {isNew && <span className="rounded-md bg-amber px-1.5 text-[0.6rem] font-bold text-night">YENİ</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
