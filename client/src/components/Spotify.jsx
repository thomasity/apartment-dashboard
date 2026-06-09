import { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
import { useSpotify } from '../hooks/useSpotify';
import {
  PrevIcon, NextIcon, PlayIcon, PauseIcon, ShuffleIcon, RepeatIcon,
  CastIcon, VolumeIcon, BackIcon, DeviceTypeIcon, BluetoothIcon,
} from './icons';

function fmtMs(ms) {
  const s = Math.floor((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Track list (right panel when a playlist is open) ─────────────────────────

function PlayingBars() {
  return (
    <span className="flex items-end gap-px h-3.5 w-3.5">
      {[0, 150, 75].map((delay, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm bg-green-400"
          style={{ animation: `soundbar 0.8s ease-in-out ${delay}ms infinite alternate` }}
        />
      ))}
      <style>{`@keyframes soundbar { from { height: 3px } to { height: 14px } }`}</style>
    </span>
  );
}

function TrackList({ playlist, tracks, loading, onBack, onPlay, onPlayAll, currentUri, isPlaying }) {
  return (
    <div className="flex flex-col m-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3 sticky top-0 bg-[#07070f] p-2 border-b-2 border-white/20">
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
                className={`flex items-center gap-3 px-1 py-2.5 rounded-xl active:bg-white/5 touch-manipulation text-left ${active ? 'bg-white/[0.04]' : ''}`}
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

// ── Device picker modal ───────────────────────────────────────────────────────

function DevicePicker({ onClose, devices, transferTo }) {
  const [btPaired,     setBtPaired]     = useState([]);
  const [btDiscovered, setBtDiscovered] = useState([]);
  const [scanning,     setScanning]     = useState(false);
  const [scanError,    setScanError]    = useState(null);
  const [pairing,      setPairing]      = useState(null);

  useEffect(() => {
    axios.get('/api/bluetooth/devices').then((r) => setBtPaired(r.data)).catch(() => {});
  }, []);

  const handleSpotifySelect = useCallback(async (deviceId) => {
    await transferTo(deviceId, true);
    onClose();
  }, [transferTo, onClose]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setBtDiscovered([]);
    try {
      const { data } = await axios.get('/api/bluetooth/scan');
      setBtDiscovered(data);
      if (data.length === 0) setScanError('No devices found. Make sure your speaker is in pairing mode.');
    } catch (err) {
      const msg = err.response?.status === 409
        ? 'Scan already in progress — try again in a moment.'
        : 'Scan failed. Check server logs.';
      setScanError(msg);
    }
    setScanning(false);
  }, []);

  const pair = useCallback(async (mac) => {
    setPairing(mac);
    try {
      await axios.post('/api/bluetooth/pair', { mac });
      const { data } = await axios.get('/api/bluetooth/devices');
      setBtPaired(data);
      setBtDiscovered((prev) => prev.filter((d) => d.mac !== mac));
    } catch {}
    setPairing(null);
  }, []);

  const toggleConnect = useCallback(async (d) => {
    try {
      if (d.connected) {
        await axios.post('/api/bluetooth/disconnect', { mac: d.mac });
      } else {
        await axios.post('/api/bluetooth/connect', { mac: d.mac });
      }
      const { data } = await axios.get('/api/bluetooth/devices');
      setBtPaired(data);
    } catch {}
  }, []);

  const forget = useCallback(async (mac) => {
    try {
      await axios.delete(`/api/bluetooth/device/${mac}`);
      setBtPaired((prev) => prev.filter((d) => d.mac !== mac));
    } catch {}
  }, []);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#111118] border border-white/10 rounded-2xl p-5 w-80 flex flex-col gap-2 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-no-swipe
      >
        <p className="text-white/40 text-xs tracking-widest uppercase mb-1">Play on…</p>
        {devices.length === 0 ? (
          <p className="text-white/25 text-sm py-2 text-center">No devices found.<br/>Open Spotify on a device first.</p>
        ) : (
          devices.map((d) => (
            <button
              key={d.id}
              onClick={() => handleSpotifySelect(d.id)}
              className={`flex items-center gap-3 px-3 py-3 rounded-xl touch-manipulation transition-colors ${
                d.isActive ? 'bg-white/10 text-white' : 'text-white/50 active:bg-white/5'
              }`}
            >
              <span className={d.isActive ? 'text-white' : 'text-white/30'}>
                <DeviceTypeIcon type={d.type} />
              </span>
              <span className="text-sm truncate">{d.name}</span>
              {d.isActive && <span className="ml-auto text-white/30 text-xs">Active</span>}
            </button>
          ))
        )}

        <div className="mt-2 pt-3 border-t border-white/[0.07]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-white/25 text-xs tracking-widest uppercase">Pi Speakers</p>
            <button
              onClick={scan}
              disabled={scanning}
              className="text-white/30 text-xs active:text-white/60 disabled:opacity-40 touch-manipulation"
            >
              {scanning ? 'Scanning…' : '+ Scan'}
            </button>
          </div>

          {btPaired.length === 0 && !scanning && btDiscovered.length === 0 && (
            <p className="text-white/20 text-xs px-3 py-1">No speakers paired. Tap Scan to find one.</p>
          )}
          {btPaired.map((d) => (
            <div key={d.mac} className="flex items-center gap-3 px-3 py-2 rounded-xl">
              <span className={d.connected ? 'text-blue-400/70' : 'text-white/20'}>
                <BluetoothIcon />
              </span>
              <span className={`text-sm truncate flex-1 ${d.connected ? 'text-white/70' : 'text-white/35'}`}>
                {d.name}
              </span>
              <button
                onClick={() => toggleConnect(d)}
                className="text-xs text-white/30 active:text-white/60 touch-manipulation ml-1"
              >
                {d.connected ? 'Disconnect' : 'Connect'}
              </button>
              <button
                onClick={() => forget(d.mac)}
                className="text-xs text-white/20 active:text-red-400/60 touch-manipulation"
              >
                ✕
              </button>
            </div>
          ))}

          {scanError && <p className="text-white/30 text-xs px-3 py-1">{scanError}</p>}

          {btDiscovered.length > 0 && (
            <>
              <p className="text-white/20 text-xs px-3 pt-2 pb-1">Nearby</p>
              {btDiscovered.map((d) => (
                <div key={d.mac} className="flex items-center gap-3 px-3 py-2 rounded-xl">
                  <span className="text-white/20"><BluetoothIcon /></span>
                  <span className="text-white/40 text-sm truncate flex-1">{d.name || d.mac}</span>
                  <button
                    onClick={() => pair(d.mac)}
                    disabled={pairing === d.mac}
                    className="text-xs text-blue-400/60 active:text-blue-400 disabled:opacity-40 touch-manipulation"
                  >
                    {pairing === d.mac ? 'Pairing…' : 'Pair'}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Spotify() {
  const {
    state, control, playContext, playlists,
    devices, fetchDevices, transferTo,
    toggleShuffle, cycleRepeat, seek, setVolume,
  } = useSpotify();

  const [pickerOpen,        setPickerOpen]        = useState(false);
  const [selectedPlaylist,  setSelectedPlaylist]  = useState(null);
  const [tracks,            setTracks]            = useState([]);
  const [tracksLoading,     setTracksLoading]     = useState(false);

  // Seek — null when idle, number (ms) while dragging
  const [seekValue, setSeekValue] = useState(null);

  const handleSeekEnd = useCallback((e) => {
    const pos = Number(e.target.value);
    seek(pos);
    setSeekValue(null);
  }, [seek]);

  // Local volume — syncs from server unless recently changed locally
  const [localVolume,  setLocalVolume]  = useState(100);
  const localChangedAt                  = useRef(0);

  useEffect(() => {
    const devVol = state?.device?.volume;
    if (devVol !== undefined && Date.now() - localChangedAt.current > 5000) {
      setLocalVolume(devVol);
    }
  }, [state?.device?.volume]);

  const handleVolumeChange = useCallback((e) => {
    const val = Number(e.target.value);
    setLocalVolume(val);
    localChangedAt.current = Date.now();
    setVolume(val);
  }, [setVolume]);

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

  const openPicker = useCallback(async () => {
    await fetchDevices();
    setPickerOpen(true);
  }, [fetchDevices]);

  return (
    <div className="relative h-full flex select-none">

      {/* ── Left: Now Playing ── */}
      <div className="w-2/5 flex flex-col items-center justify-center gap-5 px-8 border-r border-white/[0.06]">
        {track ? (
          <>
            <div className="flex flex-col items-center gap-2">
              {contextLabel && contextPlaylist && (
                <div 
                  className="text-center mb-4 cursor-pointer"
                  onClick={() => handleSelectPlaylist(contextPlaylist)}
                >
                  <p className="text-white/20 text-[9px] tracking-widest uppercase">Playing from {contextTypeLabel}</p>
                  <p className="text-white/50 text-xs mt-0.5 truncate max-w-[160px] touch-manipulation">
                    {contextLabel}
                  </p>
                </div>
              )}
              {track.art ? (
                <img
                  src={track.art}
                  alt={track.album}
                  className="w-40 h-40 object-cover"
                  style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.7)' }}
                />
              ) : (
                <div className="w-40 h-40 bg-white/5 flex items-center justify-center">
                  <span className="text-white/20 text-4xl">♪</span>
                </div>
              )}
            </div>

            <div className="w-full text-center">
              <div className="text-white font-medium text-lg leading-tight truncate">{track.name}</div>
              <div className="text-white/50 text-sm mt-1 truncate">{track.artist}</div>
              <div className="text-white/25 text-xs mt-0.5 truncate">{track.album}</div>

              <div className="mt-4">
                <div className="relative h-4 flex items-center" data-no-swipe>
                  <div className="absolute w-full h-0.5 bg-white/10 rounded-full overflow-hidden pointer-events-none">
                    <div
                      className="h-full bg-white/50 rounded-full"
                      style={{ width: `${(seekValue != null ? seekValue : track.progress) / track.duration * 100}%` }}
                    />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={track.duration || 1}
                    value={seekValue ?? track.progress}
                    onChange={(e) => setSeekValue(Number(e.target.value))}
                    onMouseUp={handleSeekEnd}
                    onTouchEnd={handleSeekEnd}
                    className="absolute w-full h-full cursor-pointer opacity-0"
                  />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-white/25 text-xs tabular-nums">{fmtMs(seekValue ?? track.progress)}</span>
                  <span className="text-white/25 text-xs tabular-nums">{fmtMs(track.duration)}</span>
                </div>
              </div>
            </div>

            {/* Controls: shuffle · prev · play/pause · next · repeat */}
            <div className="flex items-center gap-5">
              <button onClick={toggleShuffle} className="flex flex-col items-center gap-0.5 touch-manipulation">
                <span className={shuffle ? 'text-white' : 'text-white/30 active:text-white/60'}>
                  <ShuffleIcon />
                </span>
                <span className={`w-1 h-1 rounded-full ${shuffle ? 'bg-white' : 'bg-transparent'}`} />
              </button>

              <button onClick={() => control('previous')} className="text-white/50 active:text-white touch-manipulation pb-1.5">
                <PrevIcon />
              </button>

              <button
                onClick={() => control(isPlaying ? 'pause' : 'play')}
                className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black active:scale-95 transition-transform touch-manipulation"
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>

              <button onClick={() => control('next')} className="text-white/50 active:text-white touch-manipulation pb-1.5">
                <NextIcon />
              </button>

              <button onClick={cycleRepeat} className="flex flex-col items-center gap-0.5 touch-manipulation">
                <span className={repeat !== 'off' ? 'text-white' : 'text-white/30 active:text-white/60'}>
                  <RepeatIcon one={repeat === 'track'} />
                </span>
                <span className={`w-1 h-1 rounded-full ${repeat !== 'off' ? 'bg-white' : 'bg-transparent'}`} />
              </button>
            </div>

            {/* Utility strip: volume + device */}
            <div className="w-full border-t border-white/[0.07] pt-4 flex items-center gap-3">
              <span className="text-white/25 flex-shrink-0"><VolumeIcon /></span>
              <input
                type="range"
                min="0"
                max="100"
                value={localVolume}
                onChange={handleVolumeChange}
                className="flex-1 cursor-pointer touch-manipulation"
                style={{ accentColor: 'rgba(255,255,255,0.4)' }}
                data-no-swipe
              />
              <button
                onClick={openPicker}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-white/10 text-white/40 active:border-white/25 active:text-white/70 touch-manipulation"
              >
                <CastIcon />
                <span className="text-xs truncate max-w-[80px]">{state?.device?.name ?? 'No device'}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <p className="text-white/25 text-sm tracking-widest uppercase">Nothing playing</p>
              <p className="text-white/15 text-xs mt-2">Tap a playlist to start</p>
            </div>
            <button
              onClick={openPicker}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border border-white/10 text-white/30 active:border-white/25 active:text-white/60 touch-manipulation"
            >
              <CastIcon />
              <span className="text-xs truncate max-w-[100px]">{state?.device?.name ?? 'No device'}</span>
            </button>
          </>
        )}
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
