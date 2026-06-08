import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useCoords } from '../hooks/useCoords';

const ROTATION_MS = 30 * 60 * 1000;
const currentEpoch = () => Math.floor(Date.now() / ROTATION_MS);
const picUrl = (n) => `https://picsum.photos/seed/${n}/1920/1080`;

const WMO = {
  0: 'Clear',         1: 'Mostly Clear',  2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy',        48: 'Icy Fog',
  51: 'Light Drizzle',53: 'Drizzle',      55: 'Heavy Drizzle',
  61: 'Light Rain',   63: 'Rain',         65: 'Heavy Rain',
  71: 'Light Snow',   73: 'Snow',         75: 'Heavy Snow',   77: 'Snow Grains',
  80: 'Showers',      81: 'Rain Showers', 82: 'Heavy Showers',
  85: 'Snow Showers', 86: 'Heavy Snow',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

export default function Home() {
  const [now, setNow]         = useState(new Date());
  const [epochs, setEpochs]   = useState({ back: currentEpoch() - 1, front: currentEpoch() });
  const [weather, setWeather] = useState(null);
  const coords = useCoords();

  // Clock tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Photo rotation — preload next image before swapping
  useEffect(() => {
    const check = () => {
      const e = currentEpoch();
      if (e === epochs.front) return;
      const img = new Image();
      img.onload = () => setEpochs(prev => ({ back: prev.front, front: e }));
      img.src = picUrl(e);
    };
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [epochs.front]);

  // Weather
  const loadWeather = useCallback(async () => {
    try {
      const res = await axios.get('/api/weather', { params: coords ?? {} });
      setWeather(res.data);
    } catch {}
  }, [coords]);

  useEffect(() => {
    loadWeather();
    const id = setInterval(loadWeather, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadWeather]);

  const h      = now.getHours();
  const m      = String(now.getMinutes()).padStart(2, '0');
  const s      = String(now.getSeconds()).padStart(2, '0');
  const ampm   = h >= 12 ? 'PM' : 'AM';
  const hour   = String(h % 12 || 12);
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const temp = weather?.current?.temperature_2m;
  const code = weather?.current?.weather_code;
  const cond = WMO[code] ?? '';

  return (
    <div className="relative h-full w-full overflow-hidden select-none">

      {/* ── Background layers ── */}
      <img
        src={picUrl(epochs.back)}
        className="absolute inset-0 w-full h-full object-cover"
        aria-hidden
      />
      <img
        key={epochs.front}
        src={picUrl(epochs.front)}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ animation: 'homeFadeIn 4s ease-in-out forwards' }}
        aria-hidden
      />

      {/* ── Dark gradient overlay ── */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.55) 100%)' }}
        aria-hidden
      />

      {/* ── Clock ── */}
      <div className="relative h-full flex flex-col items-center justify-center">
        <div className="flex items-end gap-4">
          <span
            className="font-thin text-white tracking-tight leading-none"
            style={{ fontSize: 'clamp(6rem, 18vw, 20rem)', textShadow: '0 2px 40px rgba(0,0,0,0.6)' }}
          >
            {hour}:{m}
          </span>
          <div className="flex flex-col items-start pb-3 gap-2">
            <span
              className="font-light text-white/70 leading-none"
              style={{ fontSize: 'clamp(1.5rem, 3.5vw, 4rem)', textShadow: '0 2px 20px rgba(0,0,0,0.6)' }}
            >
              {ampm}
            </span>
            <span
              className="font-light text-white/40 leading-none"
              style={{ fontSize: 'clamp(1.2rem, 2.5vw, 3rem)', textShadow: '0 2px 20px rgba(0,0,0,0.6)' }}
            >
              :{s}
            </span>
          </div>
        </div>

        <div
          className="font-light text-white/50 tracking-widest uppercase mt-4"
          style={{ fontSize: 'clamp(0.7rem, 1.4vw, 1.1rem)', textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}
        >
          {dateStr}
        </div>
      </div>

      {/* ── Weather strip ── */}
      {temp !== undefined && (
        <div className="absolute bottom-20 right-5 text-right">
          <div
            className="font-light text-white/80 leading-none"
            style={{ fontSize: 'clamp(1.4rem, 2.8vw, 2.2rem)', textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}
          >
            {Math.round(temp)}°
          </div>
          {cond && (
            <div
              className="font-light text-white/40 tracking-wider uppercase mt-1"
              style={{ fontSize: 'clamp(0.55rem, 0.9vw, 0.75rem)', textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}
            >
              {cond}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
