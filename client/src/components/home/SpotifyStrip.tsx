import { PrevIcon, PlayIcon, PauseIcon, NextIcon } from '../icons';
import { useSpotify } from '../../hooks/useSpotify';
import styles from './SpotifyStrip.module.css';

interface Props {
  onNavigate: () => void;
}

export default function SpotifyStrip({ onNavigate }: Props) {
  const { state, control } = useSpotify();
  const item      = state?.item;
  const isPlaying = state?.isPlaying ?? false;

  if (!item) return null;

  return (
    <div className={styles.root}>
      {/* Art + text — tapping navigates to Spotify screen */}
      <button
        onClick={onNavigate}
        className={styles.nowPlaying}
      >
        <div className={styles.art}>
          {item.art
            ? <img src={item.art} alt="" className={styles.artImage} />
            : <div className={styles.artPlaceholder}><span className={styles.artPlaceholderIcon}>♪</span></div>
          }
        </div>
        <div className={styles.text}>
          <div className={styles.title}>
            {item.name}
          </div>
          <div className={styles.artist}>
            {item.artist}
          </div>
        </div>
      </button>

      {/* Controls — independent, do not navigate */}
      <div className={styles.controls} data-no-swipe>
        <button onClick={() => control('previous')} className={styles.skipButton}>
          <PrevIcon />
        </button>
        <button onClick={() => control(isPlaying ? 'pause' : 'play')} className={styles.playButton}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button onClick={() => control('next')} className={styles.skipButton}>
          <NextIcon />
        </button>
      </div>
    </div>
  );
}
