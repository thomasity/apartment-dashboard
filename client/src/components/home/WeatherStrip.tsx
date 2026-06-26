interface Props {
  icon: string | null;
  temperature: number | null;
  high: number | null;
  low: number | null;
  precip: number | null;
  onNavigate: () => void;
}

export default function WeatherStrip({ icon, temperature, high, low, precip, onNavigate }: Props) {
  if (!icon) return null;

  return (
    <button
      onClick={onNavigate}
      className="absolute top-10 right-5 text-right rounded-2xl backdrop-blur-xl bg-black/30 border border-white/10 px-3 py-2 w-[140px] touch-manipulation"
    >
      <div className="flex items-center justify-end gap-2 leading-none">
        <span style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.8rem)' }}>{icon}</span>
        <span
          className="font-light text-white/80"
          style={{ fontSize: 'clamp(1.4rem, 2.8vw, 2.2rem)' }}
        >
          {temperature}°
        </span>
      </div>
      <div className="font-light text-white/35 mt-0.5 tracking-wide" style={{ fontSize: 'clamp(0.6rem, 1.1vw, 0.8rem)' }}>
        {high != null && low != null ? `${high}° / ${low}°` : ' '}
        {high != null && precip != null && ' · '}
        {precip != null ? `💧${precip}%` : ''}
      </div>
    </button>
  );
}
