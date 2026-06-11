export default function SpotifyStrip({ track, isPlaying, onControl }) {
  if (!track) return null;

  return (
    <div className="absolute top-10 left-5 flex items-center gap-3" style={{ textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}>
      {track.art && (
        <img src={track.art} alt="" className="w-10 h-10 shadow-lg flex-shrink-0" />
      )}
      <div className="max-w-[130px]">
        <div
          className="font-light text-white/80 leading-tight truncate"
          style={{ fontSize: 'clamp(0.7rem, 1.3vw, 0.9rem)' }}
        >
          {track.name}
        </div>
        <div
          className="font-light text-white/40 leading-tight truncate"
          style={{ fontSize: 'clamp(0.55rem, 0.9vw, 0.75rem)' }}
        >
          {track.artist}
        </div>
      </div>
      <button
        data-no-swipe
        onClick={onControl}
        className="text-white/60 active:text-white touch-manipulation flex-shrink-0"
      >
        {isPlaying ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z"/>
          </svg>
        )}
      </button>
    </div>
  );
}
