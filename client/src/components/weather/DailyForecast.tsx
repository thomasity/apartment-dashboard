import { wmo }  from '../../lib/wmo';
import { DAYS } from './utils';

export default function DailyForecast({ daily }) {
  return (
    <div className="flex-1 min-h-0 flex flex-col px-8 py-4 overflow-hidden">
      <div className="text-[10px] font-medium text-white/25 uppercase tracking-widest mb-3 shrink-0">
        5-Day Forecast
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-evenly overflow-hidden">
        {daily.time.map((dateStr, i) => {
          const d = new Date(dateStr + 'T12:00:00');
          const w = wmo(daily.weather_code[i]);
          return (
            <div key={dateStr} className="flex items-center gap-4">
              <span className="text-sm text-white/40 w-12 shrink-0">
                {i === 0 ? 'Today' : DAYS[d.getDay()]}
              </span>
              <span className="text-xl leading-none">{w.icon}</span>
              <span className="text-sm text-white/30 flex-1 truncate">{w.label}</span>
              <span className="text-sm font-medium text-white tabular-nums">
                {Math.round(daily.temperature_2m_max[i])}°
              </span>
              <span className="text-sm text-white/30 tabular-nums w-8 text-right">
                {Math.round(daily.temperature_2m_min[i])}°
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
