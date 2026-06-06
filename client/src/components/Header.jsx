import { useState, useEffect } from 'react';
import axios from 'axios';

const WMO_ICON = {
  0: '☀️', 1: '🌤', 2: '⛅', 3: '☁️',
  45: '🌫', 48: '🌫',
  51: '🌦', 53: '🌦', 55: '🌧',
  61: '🌧', 63: '🌧', 65: '🌧',
  71: '🌨', 73: '❄️', 75: '❄️',
  80: '🌦', 81: '🌧', 82: '⛈',
  95: '⛈', 96: '⛈', 99: '⛈',
};

export default function Header() {
  const [now, setNow]       = useState(new Date());
  const [current, setCurrent] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get('/api/weather');
        setCurrent(res.data.current);
      } catch {}
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const h    = now.getHours();
  const m    = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = String(h % 12 || 12);

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="shrink-0 flex items-center justify-between px-6 h-13 border-b border-white/[0.05]"
         style={{ height: '52px' }}>
      <div className="flex items-baseline gap-2 select-none">
        <span className="text-2xl font-thin text-white tracking-tight">
          {hour}:{m}
        </span>
        <span className="text-sm font-light text-white/30">{ampm}</span>
        <span className="text-sm font-light text-white/20 ml-2">{dateStr}</span>
      </div>

      {current && (
        <div className="flex items-center gap-2 select-none">
          <span className="text-lg leading-none">{WMO_ICON[current.weather_code] ?? '🌡'}</span>
          <span className="text-xl font-thin text-white/60">
            {Math.round(current.temperature_2m)}°
          </span>
        </div>
      )}
    </div>
  );
}
