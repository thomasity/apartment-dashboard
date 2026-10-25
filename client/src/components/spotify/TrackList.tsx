import PlayingBars from './PlayingBars';
import { BackIcon, PlayIcon } from '../icons';
import { fmtMs } from './utils';
import type { SpotifyListItem } from '../../types';
import styles from './TrackList.module.css';

interface PlaylistLike { name: string; image: string | null }

interface Props {
  playlist: PlaylistLike;
  tracks: SpotifyListItem[];
  loading: boolean;
  onBack: () => void;
  onPlay: (uri: string) => void;
  onPlayAll: () => void;
  currentUri: string | null | undefined;
  isPlaying: boolean;
}

export default function TrackList({ playlist, tracks, loading, onBack, onPlay, onPlayAll, currentUri, isPlaying }: Props) {
  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <button
          onClick={onBack}
          className={styles.backButton}
        >
          <BackIcon />
        </button>
        {playlist.image && (
          <img src={playlist.image} alt={playlist.name} className={styles.cover} />
        )}
        <div className={styles.headerText}>
          <div className={styles.title}>{playlist.name}</div>
          <div className={styles.subtitle}>{tracks.length} tracks</div>
        </div>
        <button
          onClick={onPlayAll}
          className={styles.playAll}
        >
          <PlayIcon size={12} />
          Play All
        </button>
      </div>

      {/* Tracks */}
      {loading ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>Loading…</p>
        </div>
      ) : (
        <div className={styles.list}>
          {tracks.map((t, i) => {
            const active = t.uri === currentUri;
            return (
              <button
                key={t.id}
                onClick={() => onPlay(t.uri)}
                className={`${styles.track} ${active ? styles.trackActive : ''}`}
              >
                <span className={styles.trackIndex}>
                  {active && isPlaying
                    ? <PlayingBars />
                    : <span className={`${styles.trackNumber} ${active ? styles.numberActive : styles.numberIdle}`}>{i + 1}</span>
                  }
                </span>
                <div className={styles.trackText}>
                  <div className={`${styles.trackName} ${active ? styles.nameActive : styles.nameIdle}`}>{t.name}</div>
                  <div className={styles.trackArtist}>{t.artist}</div>
                </div>
                <span className={styles.duration}>{fmtMs(t.duration)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
