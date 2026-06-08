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
  const { state, control, playContext, playlists } = useSpotify();
  const track     = state?.track ?? null;
  const isPlaying = state?.isPlaying ?? false;
  const pct       = track && track.duration > 0 ? (track.progress / track.duration) * 100 : 0;

  return (
    <div className="h-full flex select-none">

      {/* ── Left: Now Playing ── */}
      <div className="w-2/5 flex flex-col items-center justify-center gap-6 px-8 border-r border-white/[0.06]">
        {track ? (
          <>
            {track.art ? (
              <img
                src={track.art}
                alt={track.album}
                className="w-40 h-40 rounded-2xl object-cover"
                style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
              />
            ) : (
              <div className="w-40 h-40 rounded-2xl bg-white/5 flex items-center justify-center">
                <span className="text-white/20 text-4xl">♪</span>
              </div>
            )}

            <div className="w-full text-center">
              <div className="text-white font-medium text-lg leading-tight truncate">{track.name}</div>
              <div className="text-white/50 text-sm mt-1 truncate">{track.artist}</div>
              <div className="text-white/25 text-xs mt-0.5 truncate">{track.album}</div>

              <div className="mt-4">
                <div className="h-0.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-white/50 rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-white/25 text-xs tabular-nums">{fmtMs(track.progress)}</span>
                  <span className="text-white/25 text-xs tabular-nums">{fmtMs(track.duration)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-8">
              <button onClick={() => control('previous')} className="text-white/50 active:text-white touch-manipulation">
                <PrevIcon />
              </button>
              <button
                onClick={() => control(isPlaying ? 'pause' : 'play')}
                className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black active:scale-95 transition-transform touch-manipulation"
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button onClick={() => control('next')} className="text-white/50 active:text-white touch-manipulation">
                <NextIcon />
              </button>
            </div>

            {state.device?.name && (
              <div className="text-white/20 text-xs tracking-wider uppercase">{state.device.name}</div>
            )}
          </>
        ) : (
          <p className="text-white/20 text-sm tracking-widest uppercase">Nothing playing</p>
        )}
      </div>

      {/* ── Right: Playlists ── */}
      <div className="flex-1 overflow-y-auto p-4" data-no-swipe>
        {playlists.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-white/20 text-sm tracking-widest uppercase">Loading playlists…</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => playContext(pl.uri)}
                className="text-left active:scale-95 transition-transform touch-manipulation"
              >
                {pl.image ? (
                  <img src={pl.image} alt={pl.name} className="w-full aspect-square rounded-xl object-cover" />
                ) : (
                  <div className="w-full aspect-square rounded-xl bg-white/5 flex items-center justify-center">
                    <span className="text-white/20 text-3xl">♪</span>
                  </div>
                )}
                <p className="text-xs text-white/50 mt-2 px-0.5 truncate">{pl.name}</p>
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
