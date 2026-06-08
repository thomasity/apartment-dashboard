import { useSpotify } from '../hooks/useSpotify';

function PrevIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>
    </svg>
  );
}

function NextIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 18l8.5-6L6 6v12zm8.5-6v6h2V6h-2v6z"/>
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z"/>
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
    </svg>
  );
}

function fmtMs(ms) {
  const s = Math.floor((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Spotify() {
  const { state, control } = useSpotify();

  if (!state?.track) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-white/20 text-sm tracking-widest uppercase">Nothing playing</p>
      </div>
    );
  }

  const { isPlaying, track, device } = state;
  const pct = track.duration > 0 ? (track.progress / track.duration) * 100 : 0;

  return (
    <div className="h-full flex flex-col items-center justify-center gap-7 px-10 select-none">

      {/* Album art */}
      {track.art ? (
        <img
          src={track.art}
          alt={track.album}
          className="w-52 h-52 rounded-2xl shadow-2xl object-cover"
          style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.7)' }}
        />
      ) : (
        <div className="w-52 h-52 rounded-2xl bg-white/5 flex items-center justify-center">
          <span className="text-white/20 text-5xl">♪</span>
        </div>
      )}

      {/* Track info */}
      <div className="w-full max-w-xs text-center">
        <div className="text-white font-medium text-xl leading-tight truncate">{track.name}</div>
        <div className="text-white/50 text-sm mt-1 truncate">{track.artist}</div>
        <div className="text-white/25 text-xs mt-0.5 truncate">{track.album}</div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/50 rounded-full transition-none"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-white/25 text-xs tabular-nums">{fmtMs(track.progress)}</span>
            <span className="text-white/25 text-xs tabular-nums">{fmtMs(track.duration)}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-10">
        <button
          onClick={() => control('previous')}
          className="text-white/50 active:text-white touch-manipulation"
        >
          <PrevIcon />
        </button>

        <button
          onClick={() => control(isPlaying ? 'pause' : 'play')}
          className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black active:scale-95 transition-transform touch-manipulation"
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          onClick={() => control('next')}
          className="text-white/50 active:text-white touch-manipulation"
        >
          <NextIcon />
        </button>
      </div>

      {/* Device indicator */}
      {device?.name && (
        <div className="text-white/20 text-xs tracking-wider uppercase">{device.name}</div>
      )}
    </div>
  );
}
