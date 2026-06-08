import { useState, useEffect } from 'react';
import { useClock }   from '../hooks/useClock';
import { useWeather } from '../hooks/useWeather';
import { useSpotify } from '../hooks/useSpotify';
import { wmo }        from '../lib/wmo';

const ROTATION_MS = 30 * 60 * 1000;
const currentEpoch = () => Math.floor(Date.now() / ROTATION_MS);
const picUrl = (n) => `https://picsum.photos/seed/${n}/1920/1080`;

export default function Home() {
  const [epochs, setEpochs] = useState({ back: currentEpoch() - 1, front: currentEpoch() });
  const now               = useClock();
  const { data: weather } = useWeather();
  const { state: spotify, control } = useSpotify();

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

  const h      = now.getHours();
  const m      = String(now.getMinutes()).padStart(2, '0');
  const s      = String(now.getSeconds()).padStart(2, '0');
  const ampm   = h >= 12 ? 'PM' : 'AM';
  const hour   = String(h % 12 || 12);
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const current = weather?.current;
  const cond    = current ? wmo(current.weather_code) : null;

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

      {/* ── Spotify now-playing strip ── */}
      {spotify?.track && (
        <div className="absolute bottom-20 left-5 flex items-center gap-3" style={{ textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}>
          {spotify.track.art && (
            <img src={spotify.track.art} alt="" className="w-10 h-10 rounded-md shadow-lg flex-shrink-0" />
          )}
          <div className="max-w-[130px]">
            <div
              className="font-light text-white/80 leading-tight truncate"
              style={{ fontSize: 'clamp(0.7rem, 1.3vw, 0.9rem)' }}
            >
              {spotify.track.name}
            </div>
            <div
              className="font-light text-white/40 leading-tight truncate"
              style={{ fontSize: 'clamp(0.55rem, 0.9vw, 0.75rem)' }}
            >
              {spotify.track.artist}
            </div>
          </div>
          <button
            data-no-swipe
            onClick={() => control(spotify.isPlaying ? 'pause' : 'play')}
            className="text-white/60 active:text-white touch-manipulation flex-shrink-0"
          >
            {spotify.isPlaying ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>
        </div>
      )}

      {/* ── Weather strip ── */}
      {cond && (
        <div className="absolute bottom-20 right-5 text-right">
          <div
            className="flex items-center justify-end gap-2 leading-none"
            style={{ textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}
          >
            <span style={{ fontSize: 'clamp(1.2rem, 2.2vw, 1.8rem)' }}>{cond.icon}</span>
            <span
              className="font-light text-white/80"
              style={{ fontSize: 'clamp(1.4rem, 2.8vw, 2.2rem)' }}
            >
              {Math.round(current.temperature_2m)}°
            </span>
          </div>
          <div
            className="font-light text-white/40 tracking-wider uppercase mt-1"
            style={{ fontSize: 'clamp(0.55rem, 0.9vw, 0.75rem)', textShadow: '0 1px 8px rgba(0,0,0,0.7)' }}
          >
            {cond.label}
          </div>
        </div>
      )}

    </div>
  );
}
