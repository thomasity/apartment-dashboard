import { useState, useCallback, useEffect, useRef } from 'react';
import {
  PrevIcon, NextIcon, PlayIcon, PauseIcon, ShuffleIcon, RepeatIcon,
  CastIcon, VolumeIcon,
} from '../icons';
import { fmtMs } from './utils';

export default function NowPlaying({
  track,
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
}) {
  const [seekValue, setSeekValue] = useState(null);

  const handleSeekEnd = useCallback((e) => {
    seek(Number(e.target.value));
    setSeekValue(null);
  }, [seek]);

  const [localVolume,  setLocalVolume]  = useState(100);
  const localChangedAt                  = useRef(0);

  useEffect(() => {
    if (deviceVolume !== undefined && Date.now() - localChangedAt.current > 5000) {
      setLocalVolume(deviceVolume);
    }
  }, [deviceVolume]);

  const handleVolumeChange = useCallback((e) => {
    const val = Number(e.target.value);
    setLocalVolume(val);
    localChangedAt.current = Date.now();
    setVolume(val);
  }, [setVolume]);

  if (!track) {
    return (
      <>
        <div className="text-center">
          <p className="text-white/25 text-sm tracking-widest uppercase">Nothing playing</p>
          <p className="text-white/15 text-xs mt-2">Tap a playlist to start</p>
        </div>
        <button
          onClick={onOpenPicker}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-muted text-white/30 active:border-strong active:text-white/60 touch-manipulation"
        >
          <CastIcon />
          <span className="text-xs truncate max-w-[100px]">{deviceName ?? 'No device'}</span>
        </button>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col items-center gap-2">
        {contextLabel && (
          <div
            className={`text-center mb-4 ${contextPlaylist ? 'cursor-pointer' : ''}`}
            onClick={contextPlaylist ? () => onSelectPlaylist(contextPlaylist) : undefined}
          >
            <p className="text-white/20 text-[9px] tracking-widest uppercase">Playing from {contextTypeLabel}</p>
            <p className="text-white/50 text-xs mt-0.5 truncate max-w-[160px] touch-manipulation">
              {contextLabel}
            </p>
          </div>
        )}
        {track.art ? (
          <img
            src={track.art}
            alt={track.album}
            className="w-40 h-40 object-cover"
            style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
          />
        ) : (
          <div className="w-40 h-40 bg-white/5 flex items-center justify-center">
            <span className="text-white/20 text-4xl">♪</span>
          </div>
        )}
      </div>

      <div className="w-full text-center">
        <div className="text-white font-medium text-lg leading-tight truncate">{track.name}</div>
        <div className="text-white/50 text-sm mt-1 truncate">{track.artist}</div>
        <div className="text-white/25 text-xs mt-0.5 truncate">{track.album}</div>

        <div className="mt-4">
          <div className="relative h-4 flex items-center" data-no-swipe>
            <div className="absolute w-full h-0.5 bg-white/10 rounded-full overflow-hidden pointer-events-none">
              <div
                className="h-full bg-white/50 rounded-full"
                style={{ width: `${(seekValue != null ? seekValue : track.progress) / track.duration * 100}%` }}
              />
            </div>
            <input
              type="range"
              min="0"
              max={track.duration || 1}
              value={seekValue ?? track.progress}
              onChange={(e) => setSeekValue(Number(e.target.value))}
              onMouseUp={handleSeekEnd}
              onTouchEnd={handleSeekEnd}
              className="absolute w-full h-full cursor-pointer opacity-0"
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-white/25 text-xs tabular-nums">{fmtMs(seekValue ?? track.progress)}</span>
            <span className="text-white/25 text-xs tabular-nums">{fmtMs(track.duration)}</span>
          </div>
        </div>
      </div>

      {/* Controls: shuffle · prev · play/pause · next · repeat */}
      <div className="flex items-center gap-5">
        <button onClick={toggleShuffle} className="flex flex-col items-center gap-0.5 touch-manipulation">
          <span className={shuffle ? 'text-white' : 'text-white/30 active:text-white/60'}>
            <ShuffleIcon />
          </span>
          <span className={`w-1 h-1 rounded-full ${shuffle ? 'bg-white' : 'bg-transparent'}`} />
        </button>

        <button onClick={() => control('previous')} className="text-white/50 active:text-white touch-manipulation pb-1.5">
          <PrevIcon />
        </button>

        <button
          onClick={() => control(isPlaying ? 'pause' : 'play')}
          className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black active:scale-95 transition-transform touch-manipulation"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button onClick={() => control('next')} className="text-white/50 active:text-white touch-manipulation pb-1.5">
          <NextIcon />
        </button>

        <button onClick={cycleRepeat} className="flex flex-col items-center gap-0.5 touch-manipulation">
          <span className={repeat !== 'off' ? 'text-white' : 'text-white/30 active:text-white/60'}>
            <RepeatIcon one={repeat === 'track'} />
          </span>
          <span className={`w-1 h-1 rounded-full ${repeat !== 'off' ? 'bg-white' : 'bg-transparent'}`} />
        </button>
      </div>

      {/* Utility strip: volume + device */}
      <div className="w-full border-t border-subtle pt-4 flex items-center gap-3">
        <span className="text-white/25 flex-shrink-0"><VolumeIcon /></span>
        <input
          type="range"
          min="0"
          max="100"
          value={localVolume}
          onChange={handleVolumeChange}
          className="flex-1 cursor-pointer touch-manipulation"
          style={{ accentColor: 'rgba(255,255,255,0.4)' }}
          data-no-swipe
        />
        <button
          onClick={onOpenPicker}
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-muted text-white/40 active:border-strong active:text-white/70 touch-manipulation"
        >
          <CastIcon />
          <span className="text-xs truncate max-w-[80px]">{deviceName ?? 'No device'}</span>
        </button>
      </div>
    </>
  );
}
