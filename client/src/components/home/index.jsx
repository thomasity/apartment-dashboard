import { useState, useEffect } from 'react';
import { useClock }   from '../../hooks/useClock';
import { useWeather } from '../../hooks/useWeather';
import { useSpotify } from '../../hooks/useSpotify';
import { wmo }        from '../../lib/wmo';
import ClockDisplay   from './ClockDisplay';
import SpotifyStrip   from './SpotifyStrip';
import WeatherStrip   from './WeatherStrip';

const ROTATION_MS  = 30 * 60 * 1000;
const currentEpoch = () => Math.floor(Date.now() / ROTATION_MS);
const picUrl       = (n) => `https://picsum.photos/seed/${n}/1920/1080`;

export default function Home() {
  const [epochs, setEpochs] = useState({ back: currentEpoch() - 1, front: currentEpoch() });
  const now                 = useClock();
  const { data: weather }   = useWeather();
  const { state: spotify, control } = useSpotify();

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
        track={spotify?.track ?? null}
        isPlaying={spotify?.isPlaying ?? false}
        onControl={() => control(spotify?.isPlaying ? 'pause' : 'play')}
        onPrevious={() => control('previous')}
        onNext={() => control('next')}
      />

      <WeatherStrip
        icon={cond?.icon ?? null}
        temperature={current ? Math.round(current.temperature_2m) : null}
        high={todayHigh}
        low={todayLow}
        precip={precip}
      />

    </div>
  );
}
