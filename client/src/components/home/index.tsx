import { useState, useEffect, useRef } from 'react';
import { useClock }   from '../../hooks/useClock';
import { useWeather } from '../../hooks/useWeather';
import { useSpotify } from '../../hooks/useSpotify';
import { wmo }        from '../../lib/wmo';
import type { VoiceStatus } from '../../types';
import ClockDisplay   from './ClockDisplay';
import SpotifyStrip   from './SpotifyStrip';
import WeatherStrip   from './WeatherStrip';
import { MicrophoneIcon } from '../icons';
import { useConnectivity } from '../../hooks/useConnectivity';
import styles from './index.module.css';

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
  const { state: spotify, control, setVolume } = useSpotify();
  const { online }          = useConnectivity();
  const micDisabled         = !online && micStatus === 'idle';
  const preDuckVolume = useRef<number | null>(null);

  useEffect(() => {
    if (micStatus !== 'idle') {
      if (preDuckVolume.current === null && spotify?.isPlaying && spotify.device?.volume != null && spotify.device.volume > 15) {
        preDuckVolume.current = spotify.device.volume;
        setVolume(15);
      }
    } else {
      if (preDuckVolume.current !== null) {
        setVolume(preDuckVolume.current);
        preDuckVolume.current = null;
      }
    }
  }, [micStatus]);

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
  const maxTemp   = daily?.temperature_2m_max[0];
  const minTemp   = daily?.temperature_2m_min[0];
  const todayHigh = maxTemp !== undefined ? Math.round(maxTemp) : null;
  const todayLow  = minTemp !== undefined ? Math.round(minTemp) : null;
  const precip    = weather?.hourly?.precipitation_probability?.[h] ?? null;

  return (
    <div className={styles.root}>

      {/* Background crossfade layers */}
      <img src={picUrl(epochs.back)} className={styles.background} aria-hidden />
      <img
        key={epochs.front}
        src={picUrl(epochs.front)}
        className={styles.backgroundIncoming}
        aria-hidden
      />
      <div
        className={styles.scrim}
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

      <button
        onClick={onMicClick}
        disabled={micDisabled}
        title={micDisabled ? 'Voice needs an internet connection' : undefined}
        data-no-swipe
        className={`${styles.mic} ${
          micStatus !== 'idle'
            ? styles.micListening
            : micDisabled
              ? styles.micDisabled
              : styles.micIdle
        }`}
      >
        <MicrophoneIcon />
      </button>

    </div>
  );
}
