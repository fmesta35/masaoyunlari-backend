import { useCallback, useEffect, useRef, useState } from 'react';
import { Engine, type GameOverInfo, type GaugeState, type Snapshot } from './game/engine';
import { sfx } from './game/audio';
import { addScores, clearScores, loadScores, type ScoreEntry } from './game/storage';
import StartScreen from './components/StartScreen';
import Hud, { type MoveFx, type ToastFx } from './components/Hud';
import PauseMenu from './components/PauseMenu';
import GameOver from './components/GameOver';

type Screen = 'menu' | 'playing' | 'over';

const MUTE_KEY = 'cenga.muted';

/* Site içinde (iframe, ?online=1) oynanırken oda köprüsü üst sayfadadır. */
const ONLINE = (() => {
  try {
    return new URLSearchParams(location.search).get('online') === '1' && window.parent !== window;
  } catch {
    return false;
  }
})();
const SITE_MUTE_KEY = 'gv-ses';
const siteMuted = (): boolean => {
  try {
    return localStorage.getItem(SITE_MUTE_KEY) === 'off';
  } catch {
    return false;
  }
};

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const gaugeFn = useRef<((g: GaugeState) => void) | null>(null);
  const vigRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(0);

  const [screen, setScreen] = useState<Screen>('menu');
  const [paused, setPaused] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [playerCount, setPlayerCount] = useState(2);
  const [names, setNames] = useState<string[]>(['Oyuncu 1', 'Oyuncu 2', 'Oyuncu 3', 'Oyuncu 4']);
  const [muted, setMuted] = useState<boolean>(() => {
    if (ONLINE) return siteMuted();
    try {
      return localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [scores, setScores] = useState<ScoreEntry[]>(() => loadScores());
  const [newIds, setNewIds] = useState<string[]>([]);
  const [over, setOver] = useState<GameOverInfo | null>(null);
  const [move, setMove] = useState<MoveFx | null>(null);
  const [toast, setToast] = useState<ToastFx | null>(null);
  const [linked, setLinked] = useState(!ONLINE);

  const stateRef = useRef({ screen, paused, muted });
  stateRef.current = { screen, paused, muted };

  const registerGauge = useCallback((fn: ((g: GaugeState) => void) | null) => {
    gaugeFn.current = fn;
  }, []);

  /* ---- motoru kur ---- */
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const engine = new Engine(el, {
      onSnapshot: (s) => setSnap(s),
      onGauge: (g) => {
        gaugeFn.current?.(g);
        if (vigRef.current) vigRef.current.style.opacity = g.visible ? String(Math.max(0, g.stress - 0.15) * 1.1) : '0';
      },
      onMove: (m) => setMove({ ...m, id: ++idRef.current }),
      onToast: (msg, kind) => setToast({ id: ++idRef.current, msg, kind }),
      onGameOver: (info) => {
        if (ONLINE) {
          /* Sonuç ekranını site gösterir; burada yalnız çöküş sahnesi kalır. */
          setOver(null);
          return;
        }
        const res = addScores(
          info.players.map((p, i) => ({
            name: p.name,
            score: p.score,
            players: info.players.length,
            turns: info.turn,
            date: Date.now(),
            crashed: i === info.loser,
          })),
        );
        setScores(res.list);
        setNewIds(res.addedIds);
        setOver(info);
        setScreen('over');
      },
    });
    engine.setMuted(stateRef.current.muted);
    engineRef.current = engine;
    if (ONLINE) (window as unknown as { __cengaEngine?: Engine }).__cengaEngine = engine; // test/teşhis
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  /* ---- çevrimiçi köprü ---- */
  useEffect(() => {
    if (!ONLINE) return;
    const post = (m: Record<string, unknown>) => {
      try {
        window.parent.postMessage({ src: 'cenga3d', ...m }, '*');
      } catch {
        /* yoksay */
      }
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const d = e.data as { dst?: string; t?: string; [k: string]: unknown } | null;
      if (!d || d.dst !== 'cenga3d') return;
      const eng = engineRef.current;
      if (!eng) return;
      if (d.t === 'init') {
        eng.setNet((m) => post({ t: 'net', m }));
        eng.startOnline({
          count: Number(d.count) || 2,
          names: (d.names as string[]) || [],
          seed: Number(d.seed) || 1,
          me: typeof d.me === 'number' ? d.me : -1,
          settled: (d.settled as number[][] | null) || null,
          current: typeof d.current === 'number' ? d.current : 0,
          turn: typeof d.turn === 'number' ? d.turn : 0,
          players: (d.players as never) || null,
          stability: typeof d.stability === 'number' ? d.stability : 1,
        });
        setScreen('playing');
        setPaused(false);
        setOver(null);
        setMove(null);
        setToast(null);
        setLinked(true);
      } else if (d.t === 'net') {
        eng.receive(d.m as never);
      }
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SITE_MUTE_KEY) return;
      const m = e.newValue === 'off';
      sfx.init();
      sfx.setMuted(m);
      engineRef.current?.setMuted(m);
      setMuted(m);
    };
    window.addEventListener('message', onMsg);
    window.addEventListener('storage', onStorage);
    post({ t: 'ready' });
    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  /* ---- eylemler ---- */
  const startGame = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const list = names.slice(0, playerCount).map((n, i) => n.trim() || `Oyuncu ${i + 1}`);
    eng.start(playerCount, list);
    setScreen('playing');
    setPaused(false);
    setOver(null);
    setMove(null);
    setToast(null);
    setNewIds([]);
  }, [names, playerCount]);

  const restart = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.restart();
    setScreen('playing');
    setPaused(false);
    setOver(null);
    setMove(null);
    setToast(null);
    setNewIds([]);
  }, []);

  const toMenu = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setPaused(false);
    eng.toMenu();
    setScreen('menu');
    setPaused(false);
    setOver(null);
    setMove(null);
    setToast(null);
  }, []);

  const setPause = useCallback((v: boolean) => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.setPaused(v);
    setPaused(v);
  }, []);

  const togglePause = useCallback(() => {
    if (stateRef.current.screen !== 'playing') return;
    setPause(!stateRef.current.paused);
  }, [setPause]);

  const toggleMute = useCallback(() => {
    const n = !stateRef.current.muted;
    sfx.init();
    sfx.setMuted(n);
    engineRef.current?.setMuted(n);
    setMuted(n);
    try {
      localStorage.setItem(ONLINE ? SITE_MUTE_KEY : MUTE_KEY, ONLINE ? (n ? 'off' : 'on') : n ? '1' : '0');
    } catch {
      /* yoksay */
    }
  }, []);

  const actions = useRef({ startGame, restart, togglePause, toggleMute });
  actions.current = { startGame, restart, togglePause, toggleMute };

  /* ---- klavye kısayolları ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ONLINE) {
        if (e.code === 'KeyM' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) actions.current.toggleMute();
        return;
      }
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
      const a = actions.current;
      const s = stateRef.current;
      if (typing) {
        if (e.key === 'Enter' && s.screen === 'menu') {
          e.preventDefault();
          a.startGame();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      switch (e.code) {
        case 'Escape':
        case 'KeyP':
          if (s.screen === 'playing' && !e.repeat) {
            e.preventDefault();
            a.togglePause();
          }
          break;
        case 'KeyR':
          if (s.screen !== 'menu' && !e.repeat) {
            e.preventDefault();
            a.restart();
          }
          break;
        case 'KeyM':
          if (!e.repeat) a.toggleMute();
          break;
        case 'Enter':
          if (e.repeat) break;
          if (s.screen === 'menu' && !(t && t.tagName === 'BUTTON')) {
            e.preventDefault();
            a.startGame();
          } else if (s.screen === 'over') {
            e.preventDefault();
            a.restart();
          }
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---- sekme gizlenirse otomatik duraklat ---- */
  useEffect(() => {
    const onVis = () => {
      if (ONLINE) return;
      if (document.hidden && stateRef.current.screen === 'playing' && !stateRef.current.paused) setPause(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [setPause]);

  const onClearScores = useCallback(() => {
    clearScores();
    setScores([]);
  }, []);

  const collapsing = snap?.phase === 'collapse';

  return (
    <div className="scene-bg fixed inset-0 select-none overflow-hidden font-display text-cream">
      {/* 3B sahne */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Gerilim vinyeti */}
      <div
        ref={vigRef}
        className="pointer-events-none absolute inset-0 z-[5] opacity-0"
        style={{ background: 'radial-gradient(ellipse at center, transparent 45%, rgba(255,60,40,0.65) 100%)' }}
      />

      {ONLINE && !linked && (
        <div className="absolute inset-0 z-20 flex items-center justify-center text-lg font-semibold text-cream/80">
          Kule kuruluyor…
        </div>
      )}

      {!ONLINE && screen === 'menu' && (
        <StartScreen
          playerCount={playerCount}
          setPlayerCount={setPlayerCount}
          names={names}
          setNames={setNames}
          onStart={startGame}
          scores={scores}
          onClearScores={onClearScores}
          muted={muted}
          onToggleMute={toggleMute}
        />
      )}

      {screen !== 'menu' && snap && snap.mode === 'game' && (
        <Hud
          snap={snap}
          muted={muted}
          online={ONLINE}
          onPause={() => setPause(true)}
          onToggleMute={toggleMute}
          onCancel={() => engineRef.current?.cancelSelection()}
          onRotate={(d) => engineRef.current?.rotateCamera(d)}
          registerGauge={registerGauge}
          move={move}
          toast={toast}
        />
      )}

      {collapsing && (
        <>
          <div className="anim-flash pointer-events-none absolute inset-0 z-20" />
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
            <div className="anim-slam text-6xl font-bold text-white drop-shadow-[0_6px_0_rgba(200,40,20,0.9)] sm:text-8xl">
              ÇÖKTÜ!
            </div>
          </div>
        </>
      )}

      {!ONLINE && paused && screen === 'playing' && (
        <PauseMenu
          muted={muted}
          onResume={() => setPause(false)}
          onRestart={restart}
          onMenu={toMenu}
          onToggleMute={toggleMute}
        />
      )}

      {!ONLINE && screen === 'over' && over && (
        <GameOver info={over} scores={scores} newIds={newIds} onRestart={restart} onMenu={toMenu} />
      )}
    </div>
  );
}
