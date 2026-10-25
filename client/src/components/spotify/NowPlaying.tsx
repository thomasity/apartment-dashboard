import { useState, useCallback, useEffect, useRef } from 'react';
import {
  PrevIcon, NextIcon, PlayIcon, PauseIcon, ShuffleIcon, RepeatIcon,
  CastIcon, VolumeIcon,
} from '../icons';
import { fmtMs } from './utils';
import type { SpotifyPlaybackItem, SpotifyPlaylist } from '../../types';
import styles from './NowPlaying.module.css';

interface Props {
  item: SpotifyPlaybackItem | null;
  isPlaying: boolean;
  shuffle: boolean;
  repeat: 'off' | 'context' | 'track';
  deviceName: string | undefined;
  deviceVolume: number | undefined;
  contextLabel: string | null | undefined;
  contextPlaylist: SpotifyPlaylist | null;
  contextTypeLabel: string;
  control: (action: string) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  seek: (ms: number) => void;
  setVolume: (v: number) => void;
  onOpenPicker: () => void;
  onSelectPlaylist: (playlist: SpotifyPlaylist) => void;
}

export default function NowPlaying({
  item,
  isPlaying,
  shuffle,
  repeat,
  deviceName,
  deviceVolume,
  contextLabel,
  contextPlaylist,
  contextTypeLabel,
  control,
  toggleShuffle,
  cycleRepeat,
  seek,
  setVolume,
  onOpenPicker,
  onSelectPlaylist,
}: Props) {
  const [seekValue, setSeekValue] = useState<number | null>(null);

  const handleSeekEnd = useCallback((e: React.SyntheticEvent<HTMLInputElement>) => {
    seek(Number(e.currentTarget.value));
    setSeekValue(null);
  }, [seek]);

  const [localVolume,  setLocalVolume]  = useState(100);
  const localChangedAt                  = useRef(0);

  useEffect(() => {
    if (deviceVolume !== undefined && Date.now() - localChangedAt.current > 5000) {
      setLocalVolume(deviceVolume);
    }
  }, [deviceVolume]);

  const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    setLocalVolume(val);
    localChangedAt.current = Date.now();
    setVolume(val);
  }, [setVolume]);

  if (!item) {
    return (
      <>
        <div className={styles.idle}>
          <p className={styles.idleTitle}>Nothing playing</p>
          <p className={styles.idleHint}>Tap a playlist to start</p>
        </div>
        <button
          onClick={onOpenPicker}
          className={styles.deviceButton}
        >
          <CastIcon />
          <span className={styles.deviceName}>{deviceName ?? 'No device'}</span>
        </button>
      </>
    );
  }

  return (
    <>
      <div className={styles.root}>
        {contextLabel && (
          <div
            className={`${styles.context} ${contextPlaylist ? styles.contextClickable : ''}`}
            onClick={contextPlaylist ? () => onSelectPlaylist(contextPlaylist) : undefined}
          >
            <p className={styles.contextLabel}>Playing from {contextTypeLabel}</p>
            <p className={styles.contextName}>
              {contextLabel}
            </p>
          </div>
        )}
        {item.art ? (
          <img
            src={item.art}
            alt={item.album ?? ''}
            className={styles.art}
          />
        ) : (
          <div className={styles.artPlaceholder}>
            <span className={styles.artPlaceholderIcon}>♪</span>
          </div>
        )}
      </div>

      <div className={styles.meta}>
        <div className={styles.title}>{item.name}</div>
        <div className={styles.artist}>{item.artist}</div>
        <div className={styles.album}>{item.album}</div>

        <div className={styles.progress}>
          <div className={styles.progressTrack} data-no-swipe>
            <div className={styles.progressBar}>
              <div
                className={styles.progressFill}
                style={{ width: `${(seekValue != null ? seekValue : item.progress) / item.duration * 100}%` }}
              />
            </div>
            <input
              type="range"
              min="0"
              max={item.duration || 1}
              value={seekValue ?? item.progress}
              onChange={(e) => setSeekValue(Number(e.target.value))}
              onMouseUp={handleSeekEnd}
              onTouchEnd={handleSeekEnd}
              className={styles.progressInput}
            />
          </div>
          <div className={styles.times}>
            <span className={styles.time}>{fmtMs(seekValue ?? item.progress)}</span>
            <span className={styles.time}>{fmtMs(item.duration)}</span>
          </div>
        </div>
      </div>

      {/* Controls: shuffle · prev · play/pause · next · repeat */}
      <div className={styles.controls}>
        <button onClick={toggleShuffle} className={styles.toggle}>
          <span className={shuffle ? styles.toggleOn : styles.toggleOff}>
            <ShuffleIcon />
          </span>
          <span className={`${styles.indicator} ${shuffle ? styles.indicatorOn : styles.indicatorOff}`} />
        </button>

        <button onClick={() => control('previous')} className={styles.skip}>
          <PrevIcon />
        </button>

        <button
          onClick={() => control(isPlaying ? 'pause' : 'play')}
          className={styles.play}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button onClick={() => control('next')} className={styles.skip}>
          <NextIcon />
        </button>

        <button onClick={cycleRepeat} className={styles.toggle}>
          <span className={repeat !== 'off' ? styles.toggleOn : styles.toggleOff}>
            <RepeatIcon one={repeat === 'track'} />
          </span>
          <span className={`${styles.indicator} ${repeat !== 'off' ? styles.indicatorOn : styles.indicatorOff}`} />
        </button>
      </div>

      {/* Utility strip: volume + device */}
      <div className={styles.volume}>
        <span className={styles.volumeIcon}><VolumeIcon /></span>
        <input
          type="range"
          min="0"
          max="100"
          value={localVolume}
          onChange={handleVolumeChange}
          className={styles.volumeInput}
          data-no-swipe
        />
        <button
          onClick={onOpenPicker}
          className={styles.outputButton}
        >
          <CastIcon />
          <span className={styles.outputName}>{deviceName ?? 'No device'}</span>
        </button>
      </div>
    </>
  );
}
