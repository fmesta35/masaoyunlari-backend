import type { ScoreEntry } from '../game/storage';
import { PLAYER_COLORS } from './theme';
import HighScores from './HighScores';
import { cn } from '../utils/cn';

interface Props {
  playerCount: number;
  setPlayerCount: (n: number) => void;
  names: string[];
  setNames: (n: string[]) => void;
  onStart: () => void;
  scores: ScoreEntry[];
  onClearScores: () => void;
  muted: boolean;
  onToggleMute: () => void;
}

const LOGO = ['C', 'E', 'N', 'G', 'A'];
const TILT = ['-4deg', '3deg', '-2deg', '4deg', '-3deg'];

export default function StartScreen({
  playerCount,
  setPlayerCount,
  names,
  setNames,
  onStart,
  scores,
  onClearScores,
  muted,
  onToggleMute,
}: Props) {
  return (
    <div className="absolute inset-0 z-20 overflow-y-auto pointer-events-auto lg:pointer-events-none">
      <div className="mx-auto flex min-h-full w-full max-w-[1400px] flex-col gap-4 p-4 pb-8 lg:flex-row lg:items-center lg:justify-between lg:p-8">
        {/* Sol panel */}
        <section className="glass anim-card pointer-events-auto w-full rounded-3xl p-5 sm:p-6 lg:w-[430px]">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex gap-1.5">
              {LOGO.map((l, i) => (
                <span
                  key={l}
                  className="wood-tile"
                  style={{ ['--r' as string]: TILT[i], animationDelay: `${i * 0.18}s`, transform: `rotate(${TILT[i]})` }}
                >
                  {l}
                </span>
              ))}
            </div>
            <button className="icon-btn" onClick={onToggleMute} aria-label="Sesi aç/kapat" title="Ses (M)">
              {muted ? '🔇' : '🔊'}
            </button>
          </div>
          <p className="mb-5 text-lg font-medium text-cream/85">
            Dengeni koru, taşı yavaşça çek. <span className="text-amber">Kuleyi yıkan kaybeder!</span>
          </p>

          <h3 className="mb-2 text-xs font-bold tracking-[0.2em] text-cream/60">OYUNCU SAYISI</h3>
          <div className="mb-4 grid grid-cols-3 gap-2">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setPlayerCount(n)}
                className={cn(
                  'rounded-2xl border-2 py-3 text-2xl font-bold transition-all active:scale-95',
                  playerCount === n
                    ? 'border-amber bg-amber/20 text-amber shadow-[0_0_24px_rgba(255,181,71,0.35)]'
                    : 'border-cream/15 bg-cream/5 text-cream/70 hover:border-cream/40',
                )}
              >
                {n}
                <span className="ml-1 text-xs font-semibold opacity-70">kişi</span>
              </button>
            ))}
          </div>

          <h3 className="mb-2 text-xs font-bold tracking-[0.2em] text-cream/60">İSİMLER</h3>
          <div className="mb-5 grid grid-cols-2 gap-2">
            {Array.from({ length: playerCount }).map((_, i) => (
              <label key={i} className="relative block">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full"
                  style={{ background: PLAYER_COLORS[i] }}
                />
                <input
                  className="name-input !pl-8"
                  style={{ ['--pc' as string]: PLAYER_COLORS[i] }}
                  value={names[i] ?? ''}
                  maxLength={12}
                  placeholder={`Oyuncu ${i + 1}`}
                  onChange={(e) => {
                    const next = [...names];
                    next[i] = e.target.value;
                    setNames(next);
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                />
              </label>
            ))}
          </div>

          <button className="btn-wood w-full !py-4 text-xl" onClick={onStart}>
            ▶ OYNA <kbd className="!bg-black/10 !text-[#3a1f08] !border-black/20">Enter</kbd>
          </button>
        </section>

        {/* Sağ panel */}
        <section className="pointer-events-auto flex w-full flex-col gap-4 lg:w-[400px]">
          <div className="glass anim-card rounded-3xl p-5" style={{ animationDelay: '0.1s' }}>
            <h3 className="mb-3 text-sm font-bold tracking-[0.18em] text-amber">📜 NASIL OYNANIR</h3>
            <ol className="space-y-2 text-[0.92rem] leading-snug text-cream/85">
              <li className="flex gap-2">
                <b className="text-amber">1.</b>
                <span>Kule 18 kat, 54 taştan oluşur. Sırayla <b>bir taş seç</b> (dokun / tıkla).</span>
              </li>
              <li className="flex gap-2">
                <b className="text-amber">2.</b>
                <span>
                  Taşı çekerken <b className="text-mint">yeşil bölgeyi</b> fare / parmak / ok tuşlarıyla takip et.
                  Dengedeysen taş yavaşça çıkar; kaçırırsan gerilim artar ve kule yıkılır.
                </span>
              </li>
              <li className="flex gap-2">
                <b className="text-amber">3.</b>
                <span>Çektiğin taş kulenin tepesine, alttaki kata dik biçimde yerleşir. Kat tamamlanmadan yeni kat açılmaz.</span>
              </li>
              <li className="flex gap-2">
                <b className="text-amber">4.</b>
                <span>En üstteki tamamlanmış kattan ve eksik üst katın altındaki kattan taş çekilemez.</span>
              </li>
              <li className="flex gap-2">
                <b className="text-amber">5.</b>
                <span>
                  <b className="text-coral">Kuleyi yıkan oyuncu kaybeder.</b> Hassas çekişler seri ve bonus puan kazandırır.
                </span>
              </li>
            </ol>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[0.72rem] text-cream/70">
              <div className="rounded-xl bg-cream/5 p-2">🖱️<br />Tıkla &amp; fareyi sağa-sola oynat</div>
              <div className="rounded-xl bg-cream/5 p-2">👆<br />Dokun &amp; parmağını sürükle</div>
              <div className="rounded-xl bg-cream/5 p-2">⌨️<br />↑↓←→ Enter · Q/E kamera</div>
            </div>
          </div>
          <div className="glass anim-card rounded-3xl p-5" style={{ animationDelay: '0.2s' }}>
            <HighScores scores={scores} compact onClear={onClearScores} />
          </div>
        </section>
      </div>
    </div>
  );
}
