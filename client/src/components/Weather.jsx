import { useState, useEffect } from 'react';
import axios from 'axios';

const WMO = {
  0:  { label: 'Clear',          icon: '☀️' },
  1:  { label: 'Mostly Clear',   icon: '🌤' },
  2:  { label: 'Partly Cloudy',  icon: '⛅' },
  3:  { label: 'Overcast',       icon: '☁️' },
  45: { label: 'Foggy',          icon: '🌫' },
  48: { label: 'Icy Fog',        icon: '🌫' },
  51: { label: 'Light Drizzle',  icon: '🌦' },
  53: { label: 'Drizzle',        icon: '🌦' },
  55: { label: 'Heavy Drizzle',  icon: '🌧' },
  61: { label: 'Light Rain',     icon: '🌧' },
  63: { label: 'Rain',           icon: '🌧' },
  65: { label: 'Heavy Rain',     icon: '🌧' },
  71: { label: 'Light Snow',     icon: '🌨' },
  73: { label: 'Snow',           icon: '❄️' },
  75: { label: 'Heavy Snow',     icon: '❄️' },
  77: { label: 'Snow Grains',    icon: '🌨' },
  80: { label: 'Showers',        icon: '🌦' },
  81: { label: 'Rain Showers',   icon: '🌧' },
  82: { label: 'Heavy Showers',  icon: '⛈' },
  85: { label: 'Snow Showers',   icon: '🌨' },
  86: { label: 'Heavy Snow',     icon: '❄️' },
  95: { label: 'Thunderstorm',   icon: '⛈' },
  96: { label: 'Thunderstorm',   icon: '⛈' },
  99: { label: 'Thunderstorm',   icon: '⛈' },
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function cond(code) {
  return WMO[code] ?? { label: 'Unknown', icon: '🌡' };
}

export default function Weather() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState(false);

  const load = async () => {
    try {
      const res = await axios.get('/api/weather');
      setData(res.data);
      setError(false);
    } catch {
      setError(true);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (error && !data) {
    return (
      <div className="h-full flex items-center justify-center text-white/25">
        Weather unavailable
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-white/20 animate-pulse">
        Loading…
      </div>
    );
  }

  const { current, hourly, daily } = data;
  const weather  = cond(current.weather_code);
  const todayStr = daily.time[0];
  const nowHour  = new Date().getHours();

  // Find the current hour's index in the hourly array, then take the next 12 hours.
  // This spans midnight naturally — 11 PM shows midnight, 1 AM, 2 AM, etc.
  const startIdx = hourly.time.findIndex(
    (t) => t.startsWith(todayStr) && parseInt(t.split('T')[1]) === nowHour
  );
  const safeStart  = startIdx >= 0 ? startIdx : 0;
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
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Current conditions ── */}
      <div className="shrink-0 flex items-center gap-6 px-8 py-5 border-b border-white/[0.04]">
        <span className="text-6xl leading-none">{weather.icon}</span>
        <div className="flex-1 min-w-0">
          <div
            className="font-thin text-white leading-none"
            style={{ fontSize: 'clamp(3.5rem, 6vw, 6rem)' }}
          >
            {Math.round(current.temperature_2m)}°
          </div>
          <div className="text-sm text-white/40 mt-1.5">
            Feels like {Math.round(current.apparent_temperature)}° · {weather.label}
          </div>
        </div>
        <div className="text-right text-white/25 text-sm leading-loose shrink-0">
          <div>Humidity {current.relative_humidity_2m}%</div>
          <div>Wind {Math.round(current.wind_speed_10m)} mph</div>
        </div>
      </div>

      {/* ── Hourly strip ── */}
      <div className="shrink-0 px-6 py-4 border-b border-white/[0.04]">
        <div className="text-[10px] font-medium text-white/25 uppercase tracking-widest mb-3">
          Hourly
        </div>
        {/* data-no-swipe prevents the horizontal scroll from triggering tab swipe */}
        <div data-no-swipe className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
          {hourlyItems.map((item, idx) => {
            const w          = cond(item.code);
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
                    <span className="text-[10px] text-white/25 uppercase tracking-wider">
                      {dayName}
                    </span>
                  </div>
                )}
                <div
                  className={`flex flex-col items-center gap-2 shrink-0 rounded-2xl px-4 py-4 min-w-[90px] ${
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

      {/* ── 5-day forecast ── */}
      <div className="flex-1 min-h-0 flex flex-col px-8 py-4 overflow-hidden">
        <div className="text-[10px] font-medium text-white/25 uppercase tracking-widest mb-3 shrink-0">
          5-Day Forecast
        </div>
        <div className="flex-1 min-h-0 flex flex-col justify-evenly overflow-hidden">
          {daily.time.map((dateStr, i) => {
            const d = new Date(dateStr + 'T12:00:00');
            const w = cond(daily.weather_code[i]);
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

    </div>
  );
}
