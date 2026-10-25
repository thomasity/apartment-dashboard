import { PrevIcon, PlayIcon, PauseIcon, NextIcon } from '../icons';
import type { SpotifyPlaybackItem } from '../../types';
import styles from './SpotifyStrip.module.css';

interface Props {
  item: SpotifyPlaybackItem | null;
  isPlaying: boolean;
  onControl: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onNavigate: () => void;
}

export default function SpotifyStrip({ item, isPlaying, onControl, onPrevious, onNext, onNavigate }: Props) {
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
        <button onClick={onPrevious} className={styles.skipButton}>
          <PrevIcon />
        </button>
        <button onClick={onControl} className={styles.playButton}>
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button onClick={onNext} className={styles.skipButton}>
          <NextIcon />
        </button>
      </div>
    </div>
  );
}
