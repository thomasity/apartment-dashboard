export default function CurrentConditions({ current, icon, label }) {
  return (
    <div className="shrink-0 flex items-center gap-6 px-8 py-5 border-b border-subtle">
      <span className="text-6xl leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <div
          className="font-thin text-white leading-none"
          style={{ fontSize: 'clamp(3.5rem, 6vw, 6rem)' }}
        >
          {Math.round(current.temperature_2m)}°
        </div>
        <div className="text-sm text-white/40 mt-1.5">
          Feels like {Math.round(current.apparent_temperature)}° · {label}
        </div>
      </div>
      <div className="text-right text-white/25 text-sm leading-loose shrink-0">
        <div>Humidity {current.relative_humidity_2m}%</div>
        <div>Wind {Math.round(current.wind_speed_10m)} mph</div>
      </div>
    </div>
  );
}
