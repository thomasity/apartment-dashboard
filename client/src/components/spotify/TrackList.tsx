import PlayingBars from './PlayingBars';
import { BackIcon, PlayIcon } from '../icons';
import { fmtMs } from './utils';

export default function TrackList({ playlist, tracks, loading, onBack, onPlay, onPlayAll, currentUri, isPlaying }) {
  return (
    <div className="flex flex-col m-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 sticky top-0 bg-app-bg p-2 border-b-2 border-strong">
        <button
          onClick={onBack}
          className="text-white/40 active:text-white touch-manipulation flex-shrink-0"
        >
          <BackIcon />
        </button>
        {playlist.image && (
          <img src={playlist.image} alt={playlist.name} className="w-10 h-10 object-cover flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-white text-md font-medium truncate">{playlist.name}</div>
          <div className="text-white/30 text-xs">{tracks.length} tracks</div>
        </div>
        <button
          onClick={onPlayAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/10 text-white/70 text-xs active:bg-white/20 touch-manipulation flex-shrink-0"
        >
          <PlayIcon size={12} />
          Play All
        </button>
      </div>

      {/* Tracks */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-white/20 text-sm tracking-widest uppercase">Loading…</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {tracks.map((t, i) => {
            const active = t.uri === currentUri;
            return (
              <button
                key={t.id}
                onClick={() => onPlay(t.uri)}
                className={`flex items-center gap-3 px-1 py-2.5 rounded-item active:bg-white/5 touch-manipulation text-left ${active ? 'bg-white/[0.04]' : ''}`}
              >
                <span className="w-5 flex-shrink-0 flex items-center justify-center">
                  {active && isPlaying
                    ? <PlayingBars />
                    : <span className={`text-xs tabular-nums ${active ? 'text-green-400' : 'text-white/20'}`}>{i + 1}</span>
                  }
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate leading-tight ${active ? 'text-green-400' : 'text-white/80'}`}>{t.name}</div>
                  <div className="text-white/35 text-xs truncate mt-0.5">{t.artist}</div>
                </div>
                <span className="text-white/25 text-xs tabular-nums flex-shrink-0">{fmtMs(t.duration)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
