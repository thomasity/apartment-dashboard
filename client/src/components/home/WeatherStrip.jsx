export default function WeatherStrip({ icon, temperature }) {
  if (!icon) return null;

  return (
    <div className="absolute top-10 right-5 text-right">
      <div
        className="flex items-center justify-end gap-2 leading-none"
        style={{ textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}
      >
        <span style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.8rem)' }}>{icon}</span>
        <span
          className="font-light text-white/80"
          style={{ fontSize: 'clamp(1.4rem, 2.8vw, 2.2rem)' }}
        >
          {temperature}°
        </span>
      </div>
    </div>
  );
}
