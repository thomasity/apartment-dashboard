import { useState, useEffect } from 'react';
import { useClock }   from '../../hooks/useClock';
import { useWeather } from '../../hooks/useWeather';
import { useSpotify } from '../../hooks/useSpotify';
import { usePlants }  from '../../hooks/usePlants';
import { wmo }        from '../../lib/wmo';
import type { VoiceStatus } from '../../hooks/useVoice';
import ClockDisplay   from './ClockDisplay';
import SpotifyStrip   from './SpotifyStrip';
import WeatherStrip   from './WeatherStrip';
import PlantsStrip    from './PlantsStrip';

const ROTATION_MS  = 30 * 60 * 1000;
const currentEpoch = () => Math.floor(Date.now() / ROTATION_MS);
const picUrl       = (n: number) => `https://picsum.photos/seed/${n}/1920/1080`;

interface Props {
  onNavigate: (tab: string) => void;
  micStatus: VoiceStatus;
  onMicClick: () => void;
}

export default function Home({ onNavigate, micStatus, onMicClick }: Props) {
  const [epochs, setEpochs] = useState({ back: currentEpoch() - 1, front: currentEpoch() });
  const now                 = useClock();
  const { data: weather }   = useWeather();
  const { state: spotify, control } = useSpotify();
  const plants                      = usePlants();

  useEffect(() => {
    const check = () => {
      const e = currentEpoch();
      if (e === epochs.front) return;
      const img   = new Image();
      img.onload  = () => setEpochs((prev) => ({ back: prev.front, front: e }));
      img.src     = picUrl(e);
    };
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, [epochs.front]);

  const h       = now.getHours();
  const m       = String(now.getMinutes()).padStart(2, '0');
  const s       = String(now.getSeconds()).padStart(2, '0');
  const ampm    = h >= 12 ? 'PM' : 'AM';
  const hour    = String(h % 12 || 12);
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });

  const current   = weather?.current ?? null;
  const cond      = current ? wmo(current.weather_code) : null;
  const daily     = weather?.daily ?? null;
  const todayHigh = daily ? Math.round(daily.temperature_2m_max[0]) : null;
  const todayLow  = daily ? Math.round(daily.temperature_2m_min[0]) : null;
  const precip    = weather?.hourly?.precipitation_probability?.[h] ?? null;

  return (
    <div className="relative h-full w-full overflow-hidden select-none">

      {/* Background crossfade layers */}
      <img src={picUrl(epochs.back)} className="absolute inset-0 w-full h-full object-cover" aria-hidden />
      <img
        key={epochs.front}
        src={picUrl(epochs.front)}
        className="absolute inset-0 w-full h-full object-cover"
        style={{ animation: 'homeFadeIn 4s ease-in-out forwards' }}
        aria-hidden
      />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.55) 100%)' }}
        aria-hidden
      />

      <ClockDisplay hour={hour} m={m} s={s} ampm={ampm} dateStr={dateStr} />

      <SpotifyStrip
        item={spotify?.item ?? null}
        isPlaying={spotify?.isPlaying ?? false}
        onControl={() => control(spotify?.isPlaying ? 'pause' : 'play')}
        onPrevious={() => control('previous')}
        onNext={() => control('next')}
        onNavigate={() => onNavigate?.('spotify')}
      />

      <WeatherStrip
        icon={cond?.icon ?? null}
        temperature={current ? Math.round(current.temperature_2m) : null}
        high={todayHigh}
        low={todayLow}
        precip={precip}
        onNavigate={() => onNavigate?.('weather')}
      />

      <PlantsStrip
        plants={plants}
        onNavigate={() => onNavigate?.('plants')}
      />

      <button
        onClick={onMicClick}
        data-no-swipe
        className={`absolute bottom-20 right-5 flex items-center justify-center w-14 h-14 rounded-full border backdrop-blur-sm transition-colors touch-manipulation ${
          micStatus !== 'idle'
            ? 'bg-red-500/20 border-red-500/50 text-red-400'
            : 'bg-black/30 border-white/15 text-white/40'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="8"  y1="22" x2="16" y2="22" />
        </svg>
      </button>

    </div>
  );
}
