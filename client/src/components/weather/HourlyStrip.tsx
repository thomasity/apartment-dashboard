import { wmo }  from '../../lib/wmo';
import { DAYS } from './utils';
import type { WeatherHourly, WeatherDaily } from '../../hooks/useWeather';

interface Props {
  hourly: WeatherHourly;
  daily: WeatherDaily;
}

export default function HourlyStrip({ hourly, daily }: Props) {
  const todayStr = daily.time[0];
  const nowHour  = new Date().getHours();

  const startIdx = hourly.time.findIndex(
    (t) => t.startsWith(todayStr) && parseInt(t.split('T')[1]) === nowHour
  );
  const safeStart   = startIdx >= 0 ? startIdx : 0;
  const hourlyItems = hourly.time.slice(safeStart, safeStart + 12).map((timeStr, offset) => {
    const i        = safeStart + offset;
    const datePart = timeStr.split('T')[0];
    const hour     = parseInt(timeStr.split('T')[1]);
    return {
      timeStr,
      datePart,
      hour,
      temp:   hourly.temperature_2m[i],
      code:   hourly.weather_code[i],
      precip: hourly.precipitation_probability[i],
      isNow:  offset === 0,
    };
  });

  return (
    <div className="shrink-0 px-6 py-4 border-b border-subtle">
      <div className="text-[10px] font-medium text-white/25 uppercase tracking-widest mb-3">
        Hourly
      </div>
      <div data-no-swipe className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {hourlyItems.map((item, idx) => {
          const w          = wmo(item.code);
          const label      = item.isNow
            ? 'Now'
            : `${item.hour % 12 || 12} ${item.hour >= 12 ? 'PM' : 'AM'}`;
          const prev       = hourlyItems[idx - 1];
          const isDayBreak = idx > 0 && item.datePart !== prev.datePart;
          const dayName    = isDayBreak
            ? DAYS[new Date(item.datePart + 'T12:00:00').getDay()]
            : null;

          return (
            <div key={item.timeStr} className="contents">
              {isDayBreak && (
                <div className="flex flex-col items-center justify-center shrink-0 px-2 gap-1 self-center">
                  <div className="h-14 w-px bg-white/[0.08] rounded-full" />
                  <span className="text-[10px] text-white/25 uppercase tracking-wider">{dayName}</span>
                </div>
              )}
              <div
                className={`flex flex-col items-center gap-2 shrink-0 rounded-card px-4 py-4 min-w-[90px] ${
                  item.isNow ? 'bg-white/[0.09]' : 'bg-white/[0.03]'
                }`}
              >
                <span className={`text-sm font-medium ${item.isNow ? 'text-white' : 'text-white/35'}`}>
                  {label}
                </span>
                <span className="text-3xl leading-none">{w.icon}</span>
                <span className="text-lg font-medium text-white">{Math.round(item.temp)}°</span>
                {item.precip > 0 && (
                  <span className="text-xs text-blue-300/60">{item.precip}%</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
