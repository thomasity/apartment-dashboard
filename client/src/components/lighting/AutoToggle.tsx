interface Props {
  on: boolean;
  onClick: () => void;
}

export default function AutoToggle({ on, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`w-24 h-14 flex flex-col items-center justify-center gap-1 rounded-item text-xs font-medium uppercase tracking-widest transition-colors touch-manipulation ${
        on
          ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
          : 'bg-white/[0.08] text-white/40 hover:text-white/60'
      }`}
    >
      {on && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
      Auto
    </button>
  );
}
