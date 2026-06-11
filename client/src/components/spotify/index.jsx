import { useState, useCallback } from 'react';
import axios from 'axios';
import { useSpotify } from '../../hooks/useSpotify';
import NowPlaying from './NowPlaying';
import TrackList from './TrackList';
import DevicePicker from './DevicePicker';

export default function Spotify() {
  const {
    state, control, playContext, playlists,
    devices, fetchDevices, transferTo,
    toggleShuffle, cycleRepeat, seek, setVolume,
  } = useSpotify();

  const [pickerOpen,       setPickerOpen]       = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [tracks,           setTracks]           = useState([]);
  const [tracksLoading,    setTracksLoading]    = useState(false);

  const handleSelectPlaylist = useCallback(async (pl) => {
    setSelectedPlaylist(pl);
    setTracks([]);
    setTracksLoading(true);
    try {
      const { data } = await axios.get(`/api/spotify/playlist/${pl.id}/tracks`);
      setTracks(data);
    } catch (err) {
      console.error('[spotify] tracks fetch failed:', err.message);
    }
    setTracksLoading(false);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedPlaylist(null);
    setTracks([]);
  }, []);

  const openPicker = useCallback(async () => {
    await fetchDevices();
    setPickerOpen(true);
  }, [fetchDevices]);

  const track     = state?.track ?? null;
  const isPlaying = state?.isPlaying ?? false;
  const shuffle   = state?.shuffle   ?? false;
  const repeat    = state?.repeat    ?? 'off';

  const contextPlaylist = state?.context?.type === 'playlist'
    ? (playlists.find((pl) => pl.uri === state.context.uri) ?? null)
    : null;
  const contextLabel =
    state?.context?.type === 'collection' ? 'Liked Songs' :
    state?.context?.type === 'album'      ? track?.album  :
    state?.context?.type === 'artist'     ? track?.artist :
    contextPlaylist?.name ?? null;
  const contextTypeLabel =
    state?.context?.type === 'collection' ? 'library' : state?.context?.type ?? '';

  return (
    <div className="relative h-full flex select-none">

      {/* ── Left: Now Playing ── */}
      <div className="w-2/5 flex flex-col items-center justify-center gap-5 px-8 border-r border-subtle">
        <NowPlaying
          track={track}
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
          onSelectPlaylist={handleSelectPlaylist}
        />
      </div>

      {/* ── Right: Playlists or Track List ── */}
      <div className="flex-1 overflow-y-auto" data-no-swipe>
        {selectedPlaylist ? (
          <TrackList
            playlist={selectedPlaylist}
            tracks={tracks}
            loading={tracksLoading}
            onBack={handleBack}
            onPlay={(trackUri) => playContext(selectedPlaylist.uri, trackUri)}
            onPlayAll={() => playContext(selectedPlaylist.uri)}
            currentUri={track?.uri}
            isPlaying={isPlaying}
          />
        ) : playlists.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-white/20 text-sm tracking-widest uppercase">Loading playlists…</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-y-8 gap-x-16 p-16">
            {playlists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => handleSelectPlaylist(pl)}
                className="text-left active:scale-95 transition-transform touch-manipulation"
              >
                {pl.image ? (
                  <img src={pl.image} alt={pl.name} className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-square rounded-item bg-white/5 flex items-center justify-center">
                    <span className="text-white/20 text-3xl">♪</span>
                  </div>
                )}
                <p className="text-xs text-white/50 mt-2 px-0.5 truncate">{pl.name}</p>
              </button>
            ))}
          </div>
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
