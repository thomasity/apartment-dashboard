import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { useSpotify } from '../../hooks/useSpotify';
import NowPlaying from './NowPlaying';
import TrackList from './TrackList';
import Explorer from './Explorer';
import DevicePicker from './DevicePicker';
import type { SpotifyListItem, SpotifyPlaylist, SpotifyAlbum, SelectionData, ExplorerSelection } from '../../types';
import styles from './index.module.css';

type SelectedSource = ExplorerSelection & { data: SelectionData & { name: string; image: string | null } };

export default function Spotify() {
  const {
    state, control, playContext, playUri,
    devices, fetchDevices, transferTo,
    toggleShuffle, cycleRepeat, seek, setVolume,
  } = useSpotify();

  const [playlists,   setPlaylists]   = useState<SpotifyPlaylist[] | null>(null);
  const [albums,      setAlbums]      = useState<SpotifyAlbum[] | null>(null);
  const [albumsError, setAlbumsError] = useState<string | null>(null);

  useEffect(() => {
    axios.get('/api/spotify/playlists').then((r) => setPlaylists(r.data)).catch(() => {});
    axios.get('/api/spotify/albums')
      .then((r) => setAlbums(r.data))
      .catch((err) => {
        const status = err.response?.status;
        setAlbumsError(status === 403 || status === 401 ? 'scope' : 'error');
        console.error('[spotify] albums fetch failed:', err.response?.data ?? err.message);
      });
  }, []);

  const [pickerOpen,      setPickerOpen]      = useState(false);
  const [selectedSource,  setSelectedSource]  = useState<SelectedSource | null>(null);
  const [tracks,          setTracks]          = useState<SpotifyListItem[]>([]);
  const [tracksLoading,   setTracksLoading]   = useState(false);

  const handleSelect = useCallback(async (selection: ExplorerSelection) => {
    if (selection.type === 'track' || selection.type === 'episode') {
      playUri(selection.data?.uri ?? '');
      return;
    }

    // Switch to TrackList immediately so user sees the loading state right away
    const prelimSource: SelectedSource = selection.type === 'liked'
      ? { type: 'liked', data: { name: 'Liked Songs', image: null } }
      : (selection as SelectedSource);
    setSelectedSource(prelimSource);
    setTracks([]);
    setTracksLoading(true);

    try {
      if (selection.type === 'playlist') {
        const { data } = await axios.get(`/api/spotify/playlist/${selection.data?.id}/tracks`);
        setTracks(data);
      } else if (selection.type === 'album') {
        const { data } = await axios.get(`/api/spotify/album/${selection.data?.id}/tracks`);
        setTracks(data);
      } else if (selection.type === 'liked') {
        const { data } = await axios.get('/api/spotify/liked-songs');
        setTracks(data.tracks);
        setSelectedSource({ type: 'liked', data: { name: 'Liked Songs', image: null, collectionUri: data.collectionUri } });
      } else if (selection.type === 'show') {
        const { data } = await axios.get(`/api/spotify/shows/${selection.data?.id}/episodes`);
        setTracks(data);
      }
    } catch (err: unknown) {
      console.error('[spotify] tracks fetch failed:', err instanceof Error ? err.message : err);
      setSelectedSource(null);
    }
    setTracksLoading(false);
  }, [playUri]);

  const handleBack = useCallback(() => {
    setSelectedSource(null);
    setTracks([]);
  }, []);

  const handlePlay = useCallback((trackUri: string) => {
    if (!selectedSource) return;
    const { type, data } = selectedSource;
    if (type === 'show')                          playUri(trackUri);
    else if (type === 'playlist' || type === 'album') playContext(data.uri, trackUri);
    else if (type === 'liked')                    playContext(data.collectionUri, trackUri);
  }, [selectedSource, playContext, playUri]);

  const handlePlayAll = useCallback(() => {
    if (!selectedSource) return;
    const { type, data } = selectedSource;
    if (type === 'playlist' || type === 'album') playContext(data.uri);
    else if (type === 'liked')                   playContext(data.collectionUri);
  }, [selectedSource, playContext]);

  const openPicker = useCallback(async () => {
    await fetchDevices();
    setPickerOpen(true);
  }, [fetchDevices]);

  const item      = state?.item ?? null;
  const isPlaying = state?.isPlaying ?? false;
  const shuffle   = state?.shuffle   ?? false;
  const repeat    = state?.repeat    ?? 'off';

  const contextUri = state?.context?.uri;
  const contextPlaylist = state?.context?.type === 'playlist'
    ? ((playlists ?? []).find((pl) => pl.uri === contextUri) ?? null)
    : null;
  const contextLabel =
    state?.context?.type === 'collection' ? 'Liked Songs' :
    state?.context?.type === 'album'      ? item?.album   :
    state?.context?.type === 'artist'     ? item?.artist  :
    contextPlaylist?.name ?? null;
  const contextTypeLabel =
    state?.context?.type === 'collection' ? 'library' : state?.context?.type ?? '';

  return (
    <div className={styles.root}>

      {/* ── Left: Now Playing ── */}
      <div className={styles.sidebar}>
        <NowPlaying
          item={item}
          isPlaying={isPlaying}
          shuffle={shuffle}
          repeat={repeat}
          deviceName={state?.device?.name}
          deviceVolume={state?.device?.volume}
          contextLabel={contextLabel}
          contextPlaylist={contextPlaylist}
          contextTypeLabel={contextTypeLabel}
          control={control}
          toggleShuffle={toggleShuffle}
          cycleRepeat={cycleRepeat}
          seek={seek}
          setVolume={setVolume}
          onOpenPicker={openPicker}
          onSelectPlaylist={(pl: SpotifyPlaylist) => handleSelect({ type: 'playlist', data: pl })}
        />
      </div>

      {/* ── Right: Explorer or Track List ── */}
      <div className={styles.main}>
        {selectedSource ? (
          <div className={styles.scroll} data-no-swipe>
            <TrackList
              playlist={selectedSource.data}
              tracks={tracks}
              loading={tracksLoading}
              onBack={handleBack}
              onPlay={handlePlay}
              onPlayAll={handlePlayAll}
              currentUri={item?.uri}
              isPlaying={isPlaying}
            />
          </div>
        ) : (
          <Explorer
            playlists={playlists}
            albums={albums}
            albumsError={albumsError}
            onSelect={handleSelect}
            currentUri={item?.uri}
            isPlaying={isPlaying}
          />
        )}
      </div>

      {/* ── Device picker modal ── */}
      {pickerOpen && (
        <DevicePicker
          devices={devices}
          transferTo={transferTo}
          onClose={() => setPickerOpen(false)}
        />
      )}

    </div>
  );
}
