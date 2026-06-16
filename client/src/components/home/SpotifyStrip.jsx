import { PrevIcon, PlayIcon, PauseIcon, NextIcon } from '../icons';

export default function SpotifyStrip({ track, isPlaying, onControl, onPrevious, onNext, onNavigate }) {
  if (!track) return null;

  return (
    <div className="absolute top-10 left-5 flex items-center rounded-2xl backdrop-blur-xl bg-black/30 border border-white/10 overflow-hidden">
      {/* Art + text — tapping navigates to Spotify screen */}
      <button
        onClick={onNavigate}
        className="flex items-center gap-3 pl-3 py-2 pr-2 touch-manipulation text-left"
      >
        <div className="w-10 h-10 flex-shrink-0">
          {track.art
            ? <img src={track.art} alt="" className="w-10 h-10 object-cover shadow-lg" />
            : <div className="w-10 h-10 bg-white/10 flex items-center justify-center"><span className="text-white/30 text-lg">♪</span></div>
          }
        </div>
        <div className="w-[120px]">
          <div className="font-light text-white/80 leading-tight truncate" style={{ fontSize: 'clamp(0.7rem, 1.3vw, 0.9rem)' }}>
            {track.name}
          </div>
          <div className="font-light text-white/40 leading-tight truncate" style={{ fontSize: 'clamp(0.55rem, 0.9vw, 0.75rem)' }}>
            {track.artist}
          </div>
        </div>
      </button>

      {/* Controls — independent, do not navigate */}
      <div className="flex items-center gap-2 pr-3 pl-1 py-2" data-no-swipe>
        <button onClick={onPrevious} className="text-white/45 active:text-white touch-manipulation flex-shrink-0">
          <PrevIcon />
        </button>
        <button onClick={onControl} className="text-white/70 active:text-white touch-manipulation flex-shrink-0">
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button onClick={onNext} className="text-white/45 active:text-white touch-manipulation flex-shrink-0">
          <NextIcon />
        </button>
      </div>
    </div>
  );
}
