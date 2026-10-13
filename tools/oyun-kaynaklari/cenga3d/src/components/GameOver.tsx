import type { GameOverInfo } from '../game/engine';
import type { ScoreEntry } from '../game/storage';
import HighScores from './HighScores';
import { PLAYER_COLORS } from './theme';

interface Props {
  info: GameOverInfo;
  scores: ScoreEntry[];
  newIds: string[];
  onRestart: () => void;
  onMenu: () => void;
}

const REASONS: Record<GameOverInfo['reason'], string> = {
  balance: 'Dengeyi kaybetti ve kule devrildi!',
  structure: 'Taş çekilince kule dayanamadı!',
  nomoves: 'Çekilecek taş kalmadı!',
};
const MEDALS = ['🥇', '🥈', '🥉'];

export default function GameOver({ info, scores, newIds, onRestart, onMenu }: Props) {
  const loser = info.players[info.loser];
  const survivors = info.players
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.i !== info.loser)
    .sort((a, b) => b.score - a.score);
  const winner = survivors[0];
  const rows = [...survivors, { ...loser, i: info.loser }];

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-black/55 backdrop-blur-[3px]">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="glass anim-card grid w-full max-w-3xl gap-5 rounded-3xl p-5 sm:p-7 md:grid-cols-[1.15fr_1fr]">
          <div>
            <div className="anim-slam mb-1 text-4xl font-bold tracking-wide text-coral sm:text-5xl">💥 KULE YIKILDI!</div>
            <p className="mb-4 text-cream/85">
              <b style={{ color: PLAYER_COLORS[info.loser] }}>{loser.name}</b> — {REASONS[info.reason]}
            </p>

            {winner && (
              <div
                className="mb-4 flex items-center gap-3 rounded-2xl px-4 py-3"
                style={{ background: `${PLAYER_COLORS[winner.i]}22`, border: `2px solid ${PLAYER_COLORS[winner.i]}` }}
              >
                <span className="text-3xl">🏆</span>
                <div>
                  <div className="text-[0.65rem] font-bold tracking-[0.25em] text-cream/60">KAZANAN</div>
                  <div className="text-2xl font-bold leading-none" style={{ color: PLAYER_COLORS[winner.i] }}>
                    {winner.name}
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div className="text-2xl font-bold tabular-nums" style={{ color: PLAYER_COLORS[winner.i] }}>
                    {winner.score}
                  </div>
                  <div className="text-[0.65rem] text-cream/55">puan</div>
                </div>
              </div>
            )}

            <ul className="mb-4 space-y-1.5">
              {rows.map((r, idx) => {
                const crashed = r.i === info.loser;
                return (
                  <li
                    key={r.i}
                    className="flex items-center gap-2 rounded-xl bg-cream/[0.06] px-3 py-2 text-sm"
                  >
                    <span className="w-6 text-center text-lg">{crashed ? '💥' : MEDALS[idx] ?? idx + 1}</span>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLAYER_COLORS[r.i] }} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                    <span className="text-xs text-cream/50">{r.pulls} çekiş</span>
                    <span className="w-14 text-right font-bold tabular-nums" style={{ color: PLAYER_COLORS[r.i] }}>
                      {r.score}
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button className="btn-wood flex-1" onClick={onRestart} autoFocus>
                ↻ Tekrar Oyna <kbd className="!bg-black/10 !text-[#3a1f08] !border-black/20">R</kbd>
              </button>
              <button className="btn-ghost" onClick={onMenu}>
                ⌂ Ana Menü
              </button>
            </div>
            <p className="mt-2 text-xs text-cream/45">
              {info.turn} başarılı hamle · {info.layers} katlı kule
            </p>
          </div>

          <div className="rounded-2xl bg-black/20 p-4">
            <HighScores scores={scores} highlight={newIds} />
          </div>
        </div>
      </div>
    </div>
  );
}
