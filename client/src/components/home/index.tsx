import { useState, useEffect } from 'react';
import { useVoice }   from '../../hooks/useVoice';
import ClockDisplay   from './ClockDisplay';
import SpotifyStrip   from './SpotifyStrip';
import WeatherStrip   from './WeatherStrip';
import { MicrophoneIcon } from '../icons';
import styles from './index.module.css';

const ROTATION_MS  = 30 * 60 * 1000;
const currentEpoch = () => Math.floor(Date.now() / ROTATION_MS);
const picUrl       = (n: number) => `https://picsum.photos/seed/${n}/1920/1080`;

interface Props {
  onNavigate: (tab: string) => void;
}

export default function Home({ onNavigate }: Props) {
  const [epochs, setEpochs] = useState({ back: currentEpoch() - 1, front: currentEpoch() });
  const { status: micStatus, toggle: onMicClick, micDisabled } = useVoice();

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

      <ClockDisplay />

      <SpotifyStrip onNavigate={() => onNavigate?.('spotify')} />

      <WeatherStrip onNavigate={() => onNavigate?.('weather')} />

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
