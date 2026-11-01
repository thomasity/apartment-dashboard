import { useClock }   from '../hooks/useClock';
import { useWeather } from '../hooks/useWeather';
import { useSpotify } from '../hooks/useSpotify';
import { useConnectivity } from '../hooks/useConnectivity';
import { useVoice }   from '../hooks/useVoice';
import { MicrophoneIcon } from './icons';
import styles from './Header.module.css';

export default function Header() {
  const { hour, minute, ampm, shortDate } = useClock();
  const { today }       = useWeather();
  const { state: spot } = useSpotify();
  const { online }      = useConnectivity();
  const { status: micStatus, toggle: onMicClick, micDisabled } = useVoice();


  return (
    <div className={styles.root}>
      <div className={styles.clock}>
        <span className={styles.time}>
          {hour}:{minute}
        </span>
        <span className={styles.ampm}>{ampm}</span>
        <span className={styles.date}>{shortDate}</span>
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
        {today && (
          <div className={styles.weather}>
            <span className={styles.weatherIcon}>{today.icon}</span>
            <span className={styles.temperature}>
              {today.temperature}°
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
