function SunDim() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
         className="shrink-0 text-white/25">
      <circle cx="12" cy="12" r="4" />
      <line x1="12"   y1="6.5"  x2="12"   y2="4.5"  />
      <line x1="12"   y1="17.5" x2="12"   y2="19.5" />
      <line x1="6.5"  y1="12"   x2="4.5"  y2="12"   />
      <line x1="17.5" y1="12"   x2="19.5" y2="12"   />
      <line x1="15.9" y1="8.1"  x2="17.3" y2="6.7"  />
      <line x1="8.1"  y1="15.9" x2="6.7"  y2="17.3" />
      <line x1="8.1"  y1="8.1"  x2="6.7"  y2="6.7"  />
      <line x1="15.9" y1="15.9" x2="17.3" y2="17.3" />
    </svg>
  );
}

function SunBright() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round"
         className="shrink-0 text-white/50">
      <circle cx="12" cy="12" r="4" />
      <line x1="12"   y1="6.5"  x2="12"   y2="0.5"  />
      <line x1="12"   y1="17.5" x2="12"   y2="23.5" />
      <line x1="6.5"  y1="12"   x2="0.5"  y2="12"   />
      <line x1="17.5" y1="12"   x2="23.5" y2="12"   />
      <line x1="15.9" y1="8.1"  x2="20.0" y2="4.0"  />
      <line x1="8.1"  y1="15.9" x2="4.0"  y2="20.0" />
      <line x1="8.1"  y1="8.1"  x2="4.0"  y2="4.0"  />
      <line x1="15.9" y1="15.9" x2="20.0" y2="20.0" />
    </svg>
  );
}

export function LightSliders({
  brightness, colorTemp, tempLabel,
  onBrightness, onColorTemp,
  brightnessMixed = false, colorTempMixed = false,
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25 uppercase tracking-widest">Brightness</span>
          {brightnessMixed
            ? <span className="text-[10px] text-white/25 italic">Mixed</span>
            : <span className="text-[10px] text-white/35 tabular-nums">{brightness}%</span>}
        </div>
        <div className="flex items-center gap-3">
          <SunDim />
          <input
            type="range" min={0} max={100} value={brightness}
            onChange={(e) => onBrightness(Number(e.target.value))}
            className={`slider-brightness flex-1 touch-manipulation${brightnessMixed ? ' slider-mixed' : ''}`}
          />
          <SunBright />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-white/25 uppercase tracking-widest">Color Temp</span>
          {colorTempMixed
            ? <span className="text-[10px] text-white/25 italic">Mixed</span>
            : <span className="text-[10px] text-white/35">{tempLabel}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-base leading-none shrink-0">🔥</span>
          <input
            type="range" min={0} max={100} value={colorTemp}
            onChange={(e) => onColorTemp(Number(e.target.value))}
            className={`slider-colortemp flex-1 touch-manipulation${colorTempMixed ? ' slider-mixed' : ''}`}
          />
          <span className="text-base leading-none shrink-0">❄️</span>
        </div>
      </div>
    </div>
  );
}
