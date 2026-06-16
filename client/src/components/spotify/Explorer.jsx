import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { BackIcon } from '../icons';
import PlayingBars from './PlayingBars';

function SquareItem({ item, onClick }) {
  return (
    <button
      onClick={() => onClick(item)}
      className="text-left active:scale-95 transition-transform touch-manipulation flex-shrink-0 w-28"
    >
      {item.image ? (
        <img src={item.image} alt={item.name} className="w-28 h-28 object-cover" />
      ) : (
        <div className="w-28 h-28 bg-white/5 flex items-center justify-center">
          <span className="text-white/20 text-2xl">♪</span>
        </div>
      )}
      <p className="text-xs text-white/60 mt-1.5 truncate">{item.name}</p>
      {item.artist && <p className="text-xs text-white/30 truncate">{item.artist}</p>}
    </button>
  );
}

function HorizontalRow({ title, items, onSeeAll, onSelect }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 px-4">
        <span className="text-white/40 text-xs font-medium tracking-widest uppercase">{title}</span>
        <button onClick={onSeeAll} className="text-white/30 text-xs active:text-white/60 touch-manipulation">
          See all
        </button>
      </div>
      <div className="flex gap-3 px-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {items.map((item) => (
          <SquareItem key={item.id} item={item} onClick={onSelect} />
        ))}
      </div>
    </div>
  );
}

function GridView({ title, items, onBack, onSelect }) {
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-2 sticky top-0 bg-app-bg z-10">
        <button onClick={onBack} className="text-white/40 active:text-white touch-manipulation">
          <BackIcon size={18} />
        </button>
        <span className="text-white/60 text-sm font-medium">{title}</span>
      </div>
      <div className="grid grid-cols-3 gap-4 p-4 pt-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className="text-left active:scale-95 transition-transform touch-manipulation"
          >
            {item.image ? (
              <img src={item.image} alt={item.name} className="w-full aspect-square object-cover" />
            ) : (
              <div className="w-full aspect-square bg-white/5 flex items-center justify-center">
                <span className="text-white/20 text-3xl">♪</span>
              </div>
            )}
            <p className="text-xs text-white/60 mt-1.5 truncate">{item.name}</p>
            {item.artist && <p className="text-xs text-white/30 truncate">{item.artist}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

function SearchResults({ results, onSelect, currentUri, isPlaying }) {
  if (!results) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-white/20 text-sm tracking-widest uppercase">Searching…</p>
      </div>
    );
  }

  const { tracks = [], albums = [], playlists = [] } = results;
  if (!tracks.length && !albums.length && !playlists.length) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-white/20 text-sm tracking-widest uppercase">No results</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {tracks.length > 0 && (
        <div>
          <div className="px-4 mb-1">
            <span className="text-white/40 text-xs font-medium tracking-widest uppercase">Tracks</span>
          </div>
          {tracks.map((t) => {
            const active = t.uri === currentUri;
            return (
              <button
                key={t.id}
                onClick={() => onSelect({ type: 'track', data: t })}
                className={`flex items-center gap-3 px-4 py-2 w-full active:bg-white/5 touch-manipulation text-left ${active ? 'bg-white/[0.04]' : ''}`}
              >
                {t.art
                  ? <img src={t.art} alt="" className="w-8 h-8 object-cover flex-shrink-0" />
                  : <div className="w-8 h-8 bg-white/5 flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className={`text-sm truncate leading-tight ${active ? 'text-green-400' : 'text-white/80'}`}>{t.name}</div>
                  <div className="text-white/35 text-xs truncate">{t.artist}</div>
                </div>
                {active && isPlaying && <PlayingBars />}
              </button>
            );
          })}
        </div>
      )}

      {albums.length > 0 && (
        <HorizontalRow
          title="Albums"
          items={albums}
          onSeeAll={() => {}}
          onSelect={(al) => onSelect({ type: 'album', data: al })}
        />
      )}

      {playlists.length > 0 && (
        <HorizontalRow
          title="Playlists"
          items={playlists}
          onSeeAll={() => {}}
          onSelect={(pl) => onSelect({ type: 'playlist', data: pl })}
        />
      )}
    </div>
  );
}

export default function Explorer({ playlists, albums, albumsError, onSelect, currentUri, isPlaying }) {
  const [view,          setView]          = useState('home');
  const [query,         setQuery]         = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [likedCount,    setLikedCount]    = useState(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    axios.get('/api/spotify/liked-songs?count_only=true')
      .then((r) => setLikedCount(r.data.total))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const { data } = await axios.get(`/api/spotify/search?q=${encodeURIComponent(q)}`);
        setSearchResults(data);
      } catch {}
    }, 400);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const isSearching = query.trim().length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <input
          type="text"
          placeholder="Search songs, albums, playlists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full bg-white/5 text-white/80 placeholder-white/20 text-sm rounded-lg px-3 py-2 outline-none border border-white/5 focus:border-white/20 transition-colors"
          data-no-swipe
        />
      </div>

      <div className="flex-1 overflow-y-auto" data-no-swipe>
        {isSearching ? (
          <SearchResults
            results={searchResults}
            onSelect={onSelect}
            currentUri={currentUri}
            isPlaying={isPlaying}
          />
        ) : view === 'playlists' ? (
          <GridView
            title="Playlists"
            items={playlists}
            onBack={() => setView('home')}
            onSelect={(pl) => onSelect({ type: 'playlist', data: pl })}
          />
        ) : view === 'albums' ? (
          <GridView
            title="Albums"
            items={albums}
            onBack={() => setView('home')}
            onSelect={(al) => onSelect({ type: 'album', data: al })}
          />
        ) : (
          <div className="flex flex-col gap-5 py-2">
            <div className="px-4">
              <button
                onClick={() => onSelect({ type: 'liked' })}
                className="w-full rounded-xl p-4 flex items-center gap-4 touch-manipulation active:scale-[0.98] transition-transform text-left"
                style={{ background: 'linear-gradient(135deg, #4c0080 0%, #1a0040 100%)' }}
              >
                <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center text-xl select-none">
                  ♥
                </div>
                <div>
                  <div className="text-white font-semibold text-sm">Liked Songs</div>
                  {likedCount != null && (
                    <div className="text-white/50 text-xs mt-0.5">{likedCount.toLocaleString()} songs</div>
                  )}
                </div>
              </button>
            </div>

            {playlists.length > 0 && (
              <HorizontalRow
                title="Playlists"
                items={playlists}
                onSeeAll={() => setView('playlists')}
                onSelect={(pl) => onSelect({ type: 'playlist', data: pl })}
              />
            )}

            {albumsError ? (
              <div className="px-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white/40 text-xs font-medium tracking-widest uppercase">Albums</span>
                </div>
                <p className="text-white/25 text-xs px-0.5">
                  {albumsError === 'scope'
                    ? 'Re-authorize Spotify with the user-library-read scope to enable albums.'
                    : 'Could not load albums.'}
                </p>
              </div>
            ) : albums.length > 0 ? (
              <HorizontalRow
                title="Albums"
                items={albums}
                onSeeAll={() => setView('albums')}
                onSelect={(al) => onSelect({ type: 'album', data: al })}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
