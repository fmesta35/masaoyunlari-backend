import { useEffect, useRef, useState } from 'react';
import type { GaugeState, MoveResult, Snapshot } from '../game/engine';
import Gauge from './Gauge';
import { PLAYER_COLORS, TIER_LABELS, isTouchDevice } from './theme';
import { cn } from '../utils/cn';

export interface MoveFx extends MoveResult {
  id: number;
}
export interface ToastFx {
  id: number;
  msg: string;
  kind: 'info' | 'warn';
}

interface Props {
  snap: Snapshot;
  online?: boolean;
  muted: boolean;
  onPause: () => void;
  onToggleMute: () => void;
  onCancel: () => void;
  onRotate: (dir: number) => void;
  registerGauge: (fn: ((g: GaugeState) => void) | null) => void;
  move: MoveFx | null;
  toast: ToastFx | null;
}

const RISK_COLORS = ['#5eead4', '#a7f3d0', '#ffb547', '#ff6b4a'];
const GRIP_COLORS: Record<string, string> = { Gevşek: '#5eead4', Normal: '#ffb547', Sıkı: '#ff6b4a' };

function hintFor(snap: Snapshot, touch: boolean): string {
  if (snap.online && snap.me !== snap.current && (snap.phase === 'select' || snap.phase === 'pull' || snap.phase === 'placing' || snap.phase === 'creak')) {
    const who = snap.players[snap.current]?.name ?? 'Rakip';
    if (snap.phase === 'select') return `Sıra ${who}'de — taş seçmesini bekle · Sürükle: kamera`;
    if (snap.phase === 'pull') return `${who} taşı çekiyor…`;
  }
  switch (snap.phase) {
    case 'intro':
      return 'Kule kuruluyor…';
    case 'select':
      return touch
        ? 'Çekmek istediğin taşa dokun · Boşluğu sürükle: kamera · Sıkıştır: yakınlaştır'
        : 'Bir taşa tıkla · Sürükle: kamera · Tekerlek: yakınlaştır';
    case 'pull':
      if (!snap.selection?.engaged)
        return touch
          ? 'Parmağını yeşil bölgede tut — taş birazdan çıkmaya başlar (vazgeçebilirsin)'
          : 'Fareyi yeşil bölgede tut — taş birazdan çıkmaya başlar (vazgeçebilirsin)';
      return touch ? 'Parmağınla yeşil bölgeyi takip et!' : 'Yeşil bölgeyi fareyle takip et! (← → de olur)';
    case 'placing':
      return 'Taş tepeye yerleşiyor…';
    case 'creak':
      return 'Kule gıcırdıyor!!';
    default:
      return '';
  }
}

export default function Hud({
  snap,
  online = false,
  muted,
  onPause,
  onToggleMute,
  onCancel,
  onRotate,
  registerGauge,
  move,
  toast,
}: Props) {
  const touch = isTouchDevice();
  const [banner, setBanner] = useState<number | null>(null);
  const lastBanner = useRef(-1);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (snap.phase === 'intro') lastBanner.current = -1;
    if (snap.phase === 'select' && lastBanner.current !== snap.turn) {
      lastBanner.current = snap.turn;
      setBanner(snap.turn);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setBanner(null), 1700);
    }
  }, [snap.phase, snap.turn]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const cur = snap.players[snap.current];
  const color = PLAYER_COLORS[snap.current] ?? '#ffb547';
  const sel = snap.selection;
  const hint = hintFor(snap, touch);
  const stab = Math.round(snap.stability * 100);
  const stabColor = snap.stability > 0.6 ? '#5eead4' : snap.stability > 0.3 ? '#ffb547' : '#ff6b4a';
  const moveColor = move ? PLAYER_COLORS[move.player] : '#ffb547';
  const playing = snap.phase !== 'collapse' && snap.phase !== 'over';

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col"
      style={{
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
      }}
    >
      {/* Üst çubuk */}
      <div className="flex items-start gap-2">
        <div
          className="grid min-w-0 flex-1 gap-2"
          style={{ gridTemplateColumns: `repeat(${snap.players.length}, minmax(0, 1fr))`, maxWidth: 560 }}
        >
          {snap.players.map((p, i) => {
            const active = i === snap.current && playing;
            const c = PLAYER_COLORS[i];
            return (
              <div
                key={i}
                className={cn(
                  'glass min-w-0 rounded-2xl px-2.5 py-1.5 transition-all duration-300',
                  active ? 'scale-[1.04]' : 'opacity-65',
                )}
                style={{
                  borderColor: active ? c : undefined,
                  boxShadow: active ? `0 0 0 2px ${c}, 0 10px 30px ${c}55` : undefined,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
                  <span className="truncate text-[0.8rem] font-semibold sm:text-sm">{p.name}</span>
                  {p.streak >= 2 && <span className="text-xs">🔥{p.streak}</span>}
                </div>
                <div
                  key={p.score}
                  className="anim-pop text-lg font-bold leading-tight tabular-nums sm:text-xl"
                  style={{ color: c }}
                >
                  {p.score}
                </div>
              </div>
            );
          })}
        </div>
        <div className="pointer-events-auto flex gap-2">
          {!online && (
            <button className="icon-btn" onClick={onToggleMute} aria-label="Sesi aç/kapat" title="Ses (M)">
              {muted ? '🔇' : '🔊'}
            </button>
          )}
          {!online && (
            <button className="icon-btn" onClick={onPause} aria-label="Duraklat" title="Duraklat (Esc / P)">
              ⏸
            </button>
          )}
        </div>
      </div>

      {/* Bilgi şeridi */}
      <div className="mt-2 flex justify-center">
        <div className="glass flex items-center gap-3 rounded-full px-3.5 py-1 text-[0.72rem] font-semibold tracking-wider text-cream/80 sm:text-xs">
          <span>HAMLE <b className="text-cream">{snap.turn + 1}</b></span>
          <span className="opacity-30">|</span>
          <span><b className="text-cream">{snap.layers}</b> KAT</span>
          <span className="opacity-30">|</span>
          <span className="flex items-center gap-1.5">
            DENGE
            <span className="inline-block h-2 w-14 overflow-hidden rounded-full bg-black/40 sm:w-20">
              <span
                className="block h-full rounded-full transition-all duration-500"
                style={{ width: `${stab}%`, background: stabColor }}
              />
            </span>
            <b style={{ color: stabColor }}>{stab}%</b>
          </span>
        </div>
      </div>

      {/* Gösterge + seçim kartı */}
      <div className="mt-3 flex flex-col items-center gap-2 px-1">
        <Gauge register={registerGauge} engaged={!!sel?.engaged} />
        {sel && (
          <div className="anim-fade-up flex flex-wrap items-center justify-center gap-1.5 text-xs font-semibold">
            <span className="rounded-full bg-black/45 px-2.5 py-1">Kat {sel.layer}</span>
            <span className="rounded-full bg-black/45 px-2.5 py-1">
              Tutuş: <b style={{ color: GRIP_COLORS[sel.gripLabel] }}>{sel.gripLabel}</b>
            </span>
            <span className="rounded-full bg-black/45 px-2.5 py-1">
              Kule: <b style={{ color: RISK_COLORS[sel.riskLevel] }}>{sel.riskLabel}</b>
            </span>
            {!sel.engaged && (!online || snap.me === snap.current) && (
              <button
                onClick={onCancel}
                className="pointer-events-auto rounded-full border border-cream/30 bg-cream/10 px-3 py-1 hover:bg-cream/20 active:scale-95"
              >
                Vazgeç <kbd>X</kbd>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Orta: sıra afişi + skor popup'ı */}
      <div className="relative flex-1">
        {banner !== null && cur && (
          <div key={banner} className="anim-banner absolute inset-x-0 top-[22%] flex justify-center">
            <div
              className="rounded-3xl px-7 py-3 text-center shadow-2xl"
              style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, color: '#2a1606' }}
            >
              <div className="text-[0.7rem] font-bold tracking-[0.3em] opacity-70">SIRA</div>
              <div className="text-3xl font-bold leading-none sm:text-4xl">{cur.name}</div>
            </div>
          </div>
        )}
        {move && (
          <div key={move.id} className="anim-score absolute inset-x-0 top-[8%] flex flex-col items-center">
            <div
              className="text-5xl font-bold tabular-nums drop-shadow-[0_4px_0_rgba(0,0,0,0.45)] sm:text-6xl"
              style={{ color: moveColor }}
            >
              +{move.points}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm font-bold tracking-widest">
              <span className="rounded-full bg-black/55 px-3 py-1" style={{ color: moveColor }}>
                {TIER_LABELS[move.tier]}
              </span>
              {move.mult > 1 && (
                <span className="rounded-full bg-black/55 px-3 py-1 text-amber">🔥 ×{move.mult.toFixed(2).replace(/\.?0+$/, '')} SERİ</span>
              )}
            </div>
          </div>
        )}
        {toast && (
          <div key={toast.id} className="anim-toast absolute inset-x-0 top-0 flex justify-center px-4">
            <div
              className={cn(
                'rounded-2xl px-4 py-2 text-center text-sm font-bold shadow-xl',
                toast.kind === 'warn' ? 'bg-coral text-white' : 'bg-cream text-night',
              )}
            >
              {toast.msg}
            </div>
          </div>
        )}
      </div>

      {/* Alt: ipucu + kamera düğmeleri */}
      <div className="flex items-end justify-between gap-2">
        <div className="w-11" />
        <div className="glass max-w-[min(92vw,640px)] rounded-2xl px-4 py-2 text-center text-xs font-medium text-cream/90 sm:text-sm">
          {hint}
          {snap.phase === 'select' && !touch && (!online || snap.me === snap.current) && (
            <div className="mt-0.5 hidden text-[0.7rem] text-cream/55 sm:block">
              Klavye: <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> taş seç · <kbd>Enter</kbd> çek · <kbd>Q</kbd>
              <kbd>E</kbd> kamera{online ? '' : <> · <kbd>P</kbd> duraklat · <kbd>R</kbd> yeniden</>}
            </div>
          )}
        </div>
        <div className="pointer-events-auto flex w-11 flex-col gap-1.5">
          {snap.phase === 'select' && (
            <>
              <button className="icon-btn !h-10 !w-11" onClick={() => onRotate(-1)} aria-label="Sola döndür">
                ⟲
              </button>
              <button className="icon-btn !h-10 !w-11" onClick={() => onRotate(1)} aria-label="Sağa döndür">
                ⟳
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
