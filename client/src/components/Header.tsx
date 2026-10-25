import { useClock }   from '../hooks/useClock';
import { useWeather } from '../hooks/useWeather';
import { useSpotify } from '../hooks/useSpotify';
import { useConnectivity } from '../hooks/useConnectivity';
import { wmo }        from '../lib/wmo';
import type { VoiceStatus } from '../types';
import { MicrophoneIcon } from './icons';
import styles from './Header.module.css';

interface Props {
  micStatus: VoiceStatus;
  onMicClick: () => void;
}

export default function Header({ micStatus, onMicClick }: Props) {
  const now             = useClock();
  const { data }        = useWeather();
  const { state: spot } = useSpotify();
  const { online }      = useConnectivity();
  const current         = data?.current ?? null;
  // Voice needs Claude + ElevenLabs. Only block starting — an in-progress session can still be stopped.
  const micDisabled     = !online && micStatus === 'idle';

  const h      = now.getHours();
  const m      = String(now.getMinutes()).padStart(2, '0');
  const ampm   = h >= 12 ? 'PM' : 'AM';
  const hour   = String(h % 12 || 12);
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  });

  return (
    <div className={styles.root}>
      <div className={styles.clock}>
        <span className={styles.time}>
          {hour}:{m}
        </span>
        <span className={styles.ampm}>{ampm}</span>
        <span className={styles.date}>{dateStr}</span>
      </div>

      {/* Center: now playing */}
      {spot?.item && (
        <div className={styles.nowPlaying}>
          <span className={styles.note}>♪</span>
          <span className={styles.track}>{spot.item.name}</span>
          <span className={styles.separator}>·</span>
          <span className={styles.artist}>{spot.item.artist}</span>
        </div>
      )}

      <div className={styles.status}>
        {!online && (
          <div className={styles.offline} title="The hub can't reach the internet — music, weather and voice are paused">
            <span className={styles.offlineDot} />
            <span className={styles.offlineLabel}>Offline</span>
          </div>
        )}
        {current && (
          <div className={styles.weather}>
            <span className={styles.weatherIcon}>{wmo(current.weather_code).icon}</span>
            <span className={styles.temperature}>
              {Math.round(current.temperature_2m)}°
            </span>
          </div>
        )}
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
          <MicrophoneIcon size={16} />
        </button>
      </div>
    </div>
  );
}
