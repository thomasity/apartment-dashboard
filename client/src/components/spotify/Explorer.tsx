import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { BackIcon } from '../icons';
import PlayingBars from './PlayingBars';
import type { SpotifyPlaylist, SpotifyAlbum, SpotifyShow, SpotifyListItem, ExplorerSelection } from '../../types';
import styles from './Explorer.module.css';

interface GridItem {
  id: string;
  name: string;
  image: string | null;
  artist?: string | null;
  uri?: string;
}

interface SearchResultsData {
  tracks?: SpotifyListItem[];
  albums?: SpotifyAlbum[];
  playlists?: SpotifyPlaylist[];
  shows?: (SpotifyShow & { artist?: string })[];
  episodes?: SpotifyListItem[];
}

function SquareItem({ item, onClick }: { item: GridItem; onClick: (item: GridItem) => void }) {
  return (
    <button
      onClick={() => onClick(item)}
      className={styles.square}
    >
      {item.image ? (
        <img src={item.image} alt={item.name} className={styles.squareImage} />
      ) : (
        <div className={styles.squarePlaceholder}>
          <span className={styles.squarePlaceholderIcon}>♪</span>
        </div>
      )}
      <p className={styles.itemTitle}>{item.name}</p>
      {item.artist && <p className={styles.itemSubtitle}>{item.artist}</p>}
    </button>
  );
}

function SkeletonSquare() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonArt} />
      <div className={styles.skeletonTitle} />
      <div className={styles.skeletonSubtitle} />
    </div>
  );
}

interface HorizontalRowProps {
  title: string;
  items: GridItem[];
  loading?: boolean;
  onSeeAll: () => void;
  onSelect: (item: GridItem) => void;
}

const ROW_PREVIEW = 6;

function HorizontalRow({ title, items, loading, onSeeAll, onSelect }: HorizontalRowProps) {
  const preview = items.slice(0, ROW_PREVIEW);
  const hasMore = items.length > ROW_PREVIEW;

  return (
    <div>
      <div className={styles.rowHeader}>
        <span className={styles.sectionTitle}>{title}</span>
      </div>
      <div className={styles.rowItems}>
        {loading
          ? Array.from({ length: ROW_PREVIEW }).map((_, i) => <SkeletonSquare key={i} />)
          : (
            <>
              {preview.map((item) => <SquareItem key={item.id} item={item} onClick={onSelect} />)}
              {hasMore && (
                <button
                  onClick={onSeeAll}
                  className={styles.seeAll}
                >
                  <span className={styles.seeAllIcon}>›</span>
                  <span className={styles.seeAllLabel}>See all</span>
                </button>
              )}
            </>
          )
        }
      </div>
    </div>
  );
}

function GridView({ title, items, onBack, onSelect }: { title: string; items: GridItem[]; onBack: () => void; onSelect: (item: GridItem) => void }) {
  return (
    <div>
      <div className={styles.gridHeader}>
        <button onClick={onBack} className={styles.backButton}>
          <BackIcon size={18} />
        </button>
        <span className={styles.gridTitle}>{title}</span>
      </div>
      <div className={styles.grid}>
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onSelect(item)}
            className={styles.gridItem}
          >
            {item.image ? (
              <img src={item.image} alt={item.name} className={styles.gridImage} />
            ) : (
              <div className={styles.gridPlaceholder}>
                <span className={styles.gridPlaceholderIcon}>♪</span>
              </div>
            )}
            <p className={styles.itemTitle}>{item.name}</p>
            {item.artist && <p className={styles.itemSubtitle}>{item.artist}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}

function RowItem({ item, active, isPlaying, onClick }: { item: SpotifyListItem; active: boolean; isPlaying: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`${styles.result} ${active ? styles.resultActive : ''}`}
    >
      {item.art
        ? <img src={item.art} alt="" className={styles.resultArt} />
        : <div className={styles.resultArtPlaceholder} />
      }
      <div className={styles.resultText}>
        <div className={`${styles.resultTitle} ${active ? styles.titlePlaying : styles.titleIdle}`}>{item.name}</div>
        {item.artist && <div className={styles.resultSubtitle}>{item.artist}</div>}
      </div>
      {active && isPlaying && <PlayingBars />}
    </button>
  );
}

function SearchResults({ results, onSelect, currentUri, isPlaying }: { results: SearchResultsData | null; onSelect: (s: ExplorerSelection) => void; currentUri: string | null | undefined; isPlaying: boolean }) {
  if (!results) {
    return (
      <div className={styles.status}>
        <p className={styles.statusText}>Searching…</p>
      </div>
    );
  }

  const { tracks = [], albums = [], playlists = [], shows = [], episodes = [] } = results;
  if (!tracks.length && !albums.length && !playlists.length && !shows.length && !episodes.length) {
    return (
      <div className={styles.status}>
        <p className={styles.statusText}>No results</p>
      </div>
    );
  }

  return (
    <div className={styles.results}>
      {tracks.length > 0 && (
        <div>
          <div className={styles.resultsHeader}>
            <span className={styles.sectionTitle}>Tracks</span>
          </div>
          {tracks.map((t) => (
            <RowItem
              key={t.id}
              item={t}
              active={t.uri === currentUri}
              isPlaying={isPlaying}
              onClick={() => onSelect({ type: 'track', data: t })}
            />
          ))}
        </div>
      )}

      {episodes.length > 0 && (
        <div>
          <div className={styles.resultsHeader}>
            <span className={styles.sectionTitle}>Episodes</span>
          </div>
          {episodes.map((ep) => (
            <RowItem
              key={ep.id}
              item={ep}
              active={ep.uri === currentUri}
              isPlaying={isPlaying}
              onClick={() => onSelect({ type: 'episode', data: ep })}
            />
          ))}
        </div>
      )}

      {shows.length > 0 && (
        <HorizontalRow
          title="Podcasts"
          items={shows.map((s) => ({ ...s, artist: s.publisher }))}
          onSeeAll={() => {}}
          onSelect={(s) => onSelect({ type: 'show', data: s })}
        />
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

interface ExplorerProps {
  playlists: SpotifyPlaylist[] | null;
  albums: SpotifyAlbum[] | null;
  albumsError: string | null;
  onSelect: (selection: ExplorerSelection) => void;
  currentUri: string | null | undefined;
  isPlaying: boolean;
}

export default function Explorer({ playlists, albums, albumsError, onSelect, currentUri, isPlaying }: ExplorerProps) {
  const [view,          setView]          = useState('home');
  const [query,         setQuery]         = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultsData | null>(null);
  const [likedCount,    setLikedCount]    = useState<number | null>(null);
  const [podcasts,      setPodcasts]      = useState<(SpotifyShow & { artist?: string })[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    axios.get('/api/spotify/liked-songs?count_only=true')
      .then((r) => setLikedCount(r.data.total))
      .catch(() => {});
    axios.get('/api/spotify/shows')
      .then((r) => setPodcasts(r.data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchResults(null); return; }
    clearTimeout(searchTimer.current ?? undefined);
    searchTimer.current = setTimeout(async () => {
      try {
        const { data } = await axios.get(`/api/spotify/search?q=${encodeURIComponent(q)}`);
        setSearchResults(data);
      } catch {}
    }, 400);
    return () => clearTimeout(searchTimer.current ?? undefined);
  }, [query]);

  const isSearching = query.trim().length > 0;

  return (
    <div className={styles.root}>
      <div className={styles.searchBar}>
        <input
          type="text"
          placeholder="Search songs, albums, playlists…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={styles.searchInput}
          data-no-swipe
        />
      </div>

      <div className={styles.body} data-no-swipe>
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
            items={playlists ?? []}
            onBack={() => setView('home')}
            onSelect={(pl) => onSelect({ type: 'playlist', data: pl })}
          />
        ) : view === 'albums' ? (
          <GridView
            title="Albums"
            items={albums ?? []}
            onBack={() => setView('home')}
            onSelect={(al) => onSelect({ type: 'album', data: al })}
          />
        ) : view === 'podcasts' ? (
          <GridView
            title="Podcasts"
            items={(podcasts ?? []).map((s) => ({ ...s, artist: s.publisher }))}
            onBack={() => setView('home')}
            onSelect={(s) => onSelect({ type: 'show', data: s })}
          />
        ) : (
          <div className={styles.home}>
            <div className={styles.likedSection}>
              <button
                onClick={() => onSelect({ type: 'liked' })}
                className={styles.likedCard}
              >
                <div className={styles.likedIcon}>
                  ♥
                </div>
                <div>
                  <div className={styles.likedTitle}>Liked Songs</div>
                  <div className={styles.likedSubtitle}>
                    {likedCount != null ? `${likedCount.toLocaleString()} songs` : ' '}
                  </div>
                </div>
              </button>
            </div>

            {(playlists === null || playlists.length > 0) && (
              <HorizontalRow
                title="Playlists"
                loading={playlists === null}
                items={playlists ?? []}
                onSeeAll={() => setView('playlists')}
                onSelect={(pl) => onSelect({ type: 'playlist', data: pl })}
              />
            )}

            {(podcasts === null || podcasts.length > 0) && (
              <HorizontalRow
                title="Podcasts"
                loading={podcasts === null}
                items={(podcasts ?? []).map((s) => ({ ...s, artist: s.publisher }))}
                onSeeAll={() => setView('podcasts')}
                onSelect={(s) => onSelect({ type: 'show', data: s })}
              />
            )}

            {albumsError ? (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionTitle}>Albums</span>
                </div>
                <p className={styles.sectionEmpty}>
                  {albumsError === 'scope'
                    ? 'Re-authorize Spotify with the user-library-read scope to enable albums.'
                    : 'Could not load albums.'}
                </p>
              </div>
            ) : (albums === null || albums.length > 0) ? (
              <HorizontalRow
                title="Albums"
                loading={albums === null}
                items={albums ?? []}
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
