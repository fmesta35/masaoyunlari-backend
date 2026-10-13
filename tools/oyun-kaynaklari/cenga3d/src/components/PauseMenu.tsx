interface Props {
  muted: boolean;
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onToggleMute: () => void;
}

export default function PauseMenu({ muted, onResume, onRestart, onMenu, onToggleMute }: Props) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="glass anim-card w-full max-w-sm rounded-3xl p-6 text-center">
        <div className="mb-1 text-4xl">⏸</div>
        <h2 className="mb-5 text-3xl font-bold tracking-wide text-amber">DURAKLATILDI</h2>
        <div className="flex flex-col gap-3">
          <button className="btn-wood w-full" onClick={onResume} autoFocus>
            ▶ Devam Et <kbd className="!bg-black/10 !text-[#3a1f08] !border-black/20">Esc</kbd>
          </button>
          <button className="btn-ghost w-full" onClick={onRestart}>
            ↻ Yeniden Başlat <kbd>R</kbd>
          </button>
          <button className="btn-ghost w-full" onClick={onToggleMute}>
            {muted ? '🔇 Ses: Kapalı' : '🔊 Ses: Açık'} <kbd>M</kbd>
          </button>
          <button className="btn-ghost w-full" onClick={onMenu}>
            ⌂ Ana Menü
          </button>
        </div>
        <p className="mt-5 text-xs leading-relaxed text-cream/55">
          Fare: taşa tıkla, yeşil bölgeyi takip et · Dokunmatik: parmağını sürükle · Klavye: ok tuşları, Enter, Q/E
        </p>
      </div>
    </div>
  );
}
