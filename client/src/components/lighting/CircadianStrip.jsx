export default function CircadianStrip({ circadian }) {
  const { brightness, colorTemp, nextChange, timeline } = circadian;
  const tempLabel = colorTemp < 33 ? 'Warm' : colorTemp < 67 ? 'Neutral' : 'Cool';

  const now    = new Date();
  const nowPct = ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100;

  const nextMs  = nextChange ? Math.max(0, new Date(nextChange).getTime() - Date.now()) : null;
  const nextMin = nextMs !== null ? Math.floor(nextMs / 60000) : null;

  // Interpolates the same 3-stop gradient as slider-colortemp: #ffb300 → #fff4e0 45% → #a8c8ff
  const stops = timeline.length > 0
    ? timeline.map((pt, i) => {
        const pct = ((i / 23) * 100).toFixed(1);
        const t   = pt.colorTemp;
        let r, g, b;
        if (t <= 45) {
          const f = t / 45;
          r = 255;
          g = Math.round(179 + (244 - 179) * f);
          b = Math.round(224 * f);
        } else {
          const f = (t - 45) / 55;
          r = Math.round(255 + (168 - 255) * f);
          g = Math.round(244 + (200 - 244) * f);
          b = Math.round(224 + (255 - 224) * f);
        }
        const a = (0.25 + 0.7 * (pt.brightness / 100)).toFixed(2);
        return `rgba(${r},${g},${b},${a}) ${pct}%`;
      }).join(', ')
    : '#ffb300 0%, #fff4e0 45%, #a8c8ff 100%';

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative h-2 rounded-full overflow-hidden"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      >
        <div
          className="absolute top-0 bottom-0 w-px bg-white/70"
          style={{ left: `${nowPct}%`, boxShadow: '0 0 3px rgba(255,255,255,0.5)' }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-white/30">{brightness}% · {tempLabel}</span>
        {nextMin !== null && <span className="text-[9px] text-white/20">~{nextMin}m</span>}
      </div>
    </div>
  );
}
