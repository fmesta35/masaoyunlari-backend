import { useEffect, useRef } from 'react';
import type { GaugeState } from '../game/engine';

interface Props {
  register: (fn: ((g: GaugeState) => void) | null) => void;
  engaged: boolean;
}

/**
 * Denge göstergesi. Her kare güncellendiği için React state yerine
 * doğrudan DOM stilleri değiştirilir (60fps, sıfır yeniden render).
 */
export default function Gauge({ register, engaged }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const hand = useRef<HTMLDivElement>(null);
  const prog = useRef<HTMLDivElement>(null);
  const stress = useRef<HTMLDivElement>(null);
  const stressWrap = useRef<HTMLDivElement>(null);
  const pct = useRef<HTMLSpanElement>(null);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);

  useEffect(() => {
    register((g) => {
      const r = root.current;
      if (!r) return;
      r.style.opacity = g.visible ? '1' : '0';
      r.style.transform = g.visible ? 'translateY(0)' : 'translateY(-14px)';
      if (!g.visible) return;
      const p = (v: number) => `${(Math.max(-1, Math.min(1, v)) + 1) * 50}%`;
      if (zone.current) {
        zone.current.style.left = p(g.target);
        zone.current.style.width = `${g.zone * 100}%`;
        zone.current.style.background = g.inZone ? 'rgba(94,234,212,0.38)' : 'rgba(94,234,212,0.16)';
      }
      if (hand.current) {
        hand.current.style.left = p(g.hand);
        hand.current.style.background = g.inZone ? '#fff4de' : '#ff6b4a';
        hand.current.style.boxShadow = g.inZone
          ? '0 0 14px rgba(255,244,222,0.9)'
          : '0 0 16px rgba(255,107,74,0.95)';
      }
      if (prog.current) prog.current.style.width = `${g.progress * 100}%`;
      if (pct.current) pct.current.textContent = `${Math.round(g.progress * 100)}%`;
      if (stress.current) stress.current.style.width = `${g.stress * 100}%`;
      if (stressWrap.current) {
        stressWrap.current.style.transform = g.stress > 0.6 ? `translateX(${(Math.random() - 0.5) * 4}px)` : 'none';
      }
      if (left.current) left.current.style.opacity = g.warn < 0 ? '1' : '0';
      if (right.current) right.current.style.opacity = g.warn > 0 ? '1' : '0';
    });
    return () => register(null);
  }, [register]);

  return (
    <div
      ref={root}
      className="w-full max-w-[640px] opacity-0 transition-[opacity,transform] duration-200"
      aria-hidden
    >
      <div className="mb-1 flex items-center justify-between px-2 text-[0.7rem] font-bold tracking-[0.2em]">
        <span className={engaged ? 'text-mint' : 'anim-blink text-amber'}>
          {engaged ? 'DENGEDE KAL' : 'HAZIR OL — YEŞİL BÖLGEDE KAL'}
        </span>
        <span ref={pct} className="tabular-nums text-cream/70">
          0%
        </span>
      </div>

      <div className="glass relative h-12 rounded-full">
        <div className="absolute inset-y-2 left-1/2 w-px bg-cream/20" />
        {[0.25, 0.75].map((t) => (
          <div key={t} className="absolute inset-y-3 w-px bg-cream/10" style={{ left: `${t * 100}%` }} />
        ))}
        <div
          ref={left}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-2xl font-black text-coral opacity-0 transition-opacity duration-75"
        >
          ‹‹
        </div>
        <div
          ref={right}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-2xl font-black text-coral opacity-0 transition-opacity duration-75"
        >
          ››
        </div>
        <div
          ref={zone}
          className="zone-pulse absolute inset-y-1 left-1/2 w-[30%] -translate-x-1/2 rounded-full border-2 border-mint"
        />
        <div
          ref={hand}
          className="absolute -inset-y-2 left-1/2 w-3 -translate-x-1/2 rounded-full bg-cream"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-3 px-1">
        <div>
          <div className="mb-0.5 text-[0.6rem] font-bold tracking-[0.2em] text-amber">ÇEKME</div>
          <div className="h-2.5 overflow-hidden rounded-full bg-black/40">
            <div
              ref={prog}
              className="h-full w-0 rounded-full bg-gradient-to-r from-amber to-[#ffe29a]"
            />
          </div>
        </div>
        <div ref={stressWrap}>
          <div className="mb-0.5 text-[0.6rem] font-bold tracking-[0.2em] text-coral">GERİLİM</div>
          <div className="h-2.5 overflow-hidden rounded-full bg-black/40">
            <div
              ref={stress}
              className="h-full w-0 rounded-full bg-gradient-to-r from-[#ffb547] to-coral"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
