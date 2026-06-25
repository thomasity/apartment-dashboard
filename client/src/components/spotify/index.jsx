import { useState, useCallback } from 'react';
import axios from 'axios';
import { useSpotify } from '../../hooks/useSpotify';
import NowPlaying from './NowPlaying';
import TrackList from './TrackList';
import Explorer from './Explorer';
import DevicePicker from './DevicePicker';

export default function Spotify() {
  const {
    state, control, playContext, playUri, playlists, albums, albumsError,
    devices, fetchDevices, transferTo,
    toggleShuffle, cycleRepeat, seek, setVolume,
  } = useSpotify();

  const [pickerOpen,      setPickerOpen]      = useState(false);
  const [selectedSource,  setSelectedSource]  = useState(null);
  const [tracks,          setTracks]          = useState([]);
  const [tracksLoading,   setTracksLoading]   = useState(false);

  const handleSelect = useCallback(async (selection) => {
    if (selection.type === 'track' || selection.type === 'episode') {
      playUri(selection.data.uri);
      return;
    }

    // Switch to TrackList immediately so user sees the loading state right away
    const prelimSource = selection.type === 'liked'
      ? { type: 'liked', data: { name: 'Liked Songs', image: null } }
      : selection;
    setSelectedSource(prelimSource);
    setTracks([]);
    setTracksLoading(true);

    try {
      if (selection.type === 'playlist') {
        const { data } = await axios.get(`/api/spotify/playlist/${selection.data.id}/tracks`);
        setTracks(data);
      } else if (selection.type === 'album') {
        const { data } = await axios.get(`/api/spotify/album/${selection.data.id}/tracks`);
        setTracks(data);
      } else if (selection.type === 'liked') {
        const { data } = await axios.get('/api/spotify/liked-songs');
        setTracks(data.tracks);
        setSelectedSource({ type: 'liked', data: { name: 'Liked Songs', image: null, collectionUri: data.collectionUri } });
      } else if (selection.type === 'show') {
        const { data } = await axios.get(`/api/spotify/shows/${selection.data.id}/episodes`);
        setTracks(data);
      }
    } catch (err) {
      console.error('[spotify] tracks fetch failed:', err.message);
      setSelectedSource(null);
    }
    setTracksLoading(false);
  }, [playUri]);

  const handleBack = useCallback(() => {
    setSelectedSource(null);
    setTracks([]);
  }, []);

  const handlePlay = useCallback((trackUri) => {
    if (!selectedSource) return;
    if (selectedSource.type === 'show')     return playUri(trackUri);
    if (selectedSource.type === 'playlist') return playContext(selectedSource.data.uri, trackUri);
    if (selectedSource.type === 'album')    return playContext(selectedSource.data.uri, trackUri);
    if (selectedSource.type === 'liked')    return playContext(selectedSource.data.collectionUri, trackUri);
  }, [selectedSource, playContext, playUri]);

  const handlePlayAll = useCallback(() => {
    if (!selectedSource) return;
    if (selectedSource.type === 'playlist') return playContext(selectedSource.data.uri);
    if (selectedSource.type === 'album')    return playContext(selectedSource.data.uri);
    if (selectedSource.type === 'liked')    return playContext(selectedSource.data.collectionUri);
  }, [selectedSource, playContext]);

  const openPicker = useCallback(async () => {
    await fetchDevices();
    setPickerOpen(true);
  }, [fetchDevices]);

  const item      = state?.item ?? null;
  const isPlaying = state?.isPlaying ?? false;
  const shuffle   = state?.shuffle   ?? false;
  const repeat    = state?.repeat    ?? 'off';

  const contextPlaylist = state?.context?.type === 'playlist'
    ? ((playlists ?? []).find((pl) => pl.uri === state.context.uri) ?? null)
    : null;
  const contextLabel =
    state?.context?.type === 'collection' ? 'Liked Songs' :
    state?.context?.type === 'album'      ? item?.album   :
    state?.context?.type === 'artist'     ? item?.artist  :
    contextPlaylist?.name ?? null;
  const contextTypeLabel =
    state?.context?.type === 'collection' ? 'library' : state?.context?.type ?? '';

  return (
    <div className="relative h-full flex select-none">

      {/* ── Left: Now Playing ── */}
      <div className="w-2/5 flex flex-col items-center justify-center gap-5 px-8 border-r border-subtle">
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
          onSelectPlaylist={handleSelect}
        />
      </div>

      {/* ── Right: Explorer or Track List ── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedSource ? (
          <div className="flex-1 overflow-y-auto" data-no-swipe>
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
