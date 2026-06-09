import { useState, useCallback, useEffect, useRef } from 'react';
import axios from 'axios';
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

function ShuffleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
    </svg>
  );
}

function RepeatIcon({ one }) {
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
      </svg>
      {one && (
        <span className="absolute inset-0 flex items-center justify-center text-[7px] font-bold leading-none mt-px">1</span>
      )}
    </div>
  );
}

function CastIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2C12 14.14 7.05 10 1 10zm20-6H3C1.9 4 1 4.9 1 6v3h2V6h18v12h-7v2h7c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z"/>
    </svg>
  );
}

function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  );
}

function DeviceTypeIcon({ type }) {
  if (type === 'smartphone') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 1.01L7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99zM17 19H7V5h10v14z"/>
    </svg>
  );
  if (type === 'computer') return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
    </svg>
  );
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 2H7c-1.1 0-2 .9-2 2v16c0 1.1.9 1.99 2 1.99L17 22c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-5 2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm0 16c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm5-5H7V7h10v8z"/>
    </svg>
  );
}

function fmtMs(ms) {
  const s = Math.floor((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function BluetoothIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z"/>
    </svg>
  );
}

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
      const msg = err.response?.status === 409 ? 'Scan already in progress — try again in a moment.' : 'Scan failed. Check server logs.';
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

          {scanError && (
            <p className="text-white/30 text-xs px-3 py-1">{scanError}</p>
          )}

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

export default function Spotify() {
  const { state, control, playContext, playlists, devices, fetchDevices, transferTo, toggleShuffle, cycleRepeat, setVolume } = useSpotify();
  const [pickerOpen, setPickerOpen] = useState(false);

  // Local volume state — initialized once from server, then tracks local changes
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

  const track     = state?.track ?? null;
  const isPlaying = state?.isPlaying ?? false;
  const shuffle   = state?.shuffle   ?? false;
  const repeat    = state?.repeat    ?? 'off';
  const pct       = track && track.duration > 0 ? (track.progress / track.duration) * 100 : 0;

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

            {/* ── Playback controls: shuffle · prev · play/pause · next · repeat ── */}
            <div className="flex items-center gap-5">
              {/* Shuffle */}
              <button
                onClick={toggleShuffle}
                className="flex flex-col items-center gap-0.5 touch-manipulation transition-colors"
              >
                <span className={shuffle ? 'text-white' : 'text-white/30 active:text-white/60'}>
                  <ShuffleIcon />
                </span>
                <span className={`w-1 h-1 rounded-full ${shuffle ? 'bg-white' : 'bg-transparent'}`} />
              </button>

              {/* Previous */}
              <button onClick={() => control('previous')} className="text-white/50 active:text-white touch-manipulation pb-1.5">
                <PrevIcon />
              </button>

              {/* Play / Pause */}
              <button
                onClick={() => control(isPlaying ? 'pause' : 'play')}
                className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-black active:scale-95 transition-transform touch-manipulation"
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>

              {/* Next */}
              <button onClick={() => control('next')} className="text-white/50 active:text-white touch-manipulation pb-1.5">
                <NextIcon />
              </button>

              {/* Repeat */}
              <button
                onClick={cycleRepeat}
                className="flex flex-col items-center gap-0.5 touch-manipulation transition-colors"
              >
                <span className={repeat !== 'off' ? 'text-white' : 'text-white/30 active:text-white/60'}>
                  <RepeatIcon one={repeat === 'track'} />
                </span>
                <span className={`w-1 h-1 rounded-full ${repeat !== 'off' ? 'bg-white' : 'bg-transparent'}`} />
              </button>
            </div>

            {/* ── Volume ── */}
            <div className="w-full flex items-center gap-3">
              <span className="text-white/30 flex-shrink-0"><VolumeIcon /></span>
              <input
                type="range"
                min="0"
                max="100"
                value={localVolume}
                onChange={handleVolumeChange}
                className="flex-1 h-1 rounded-full cursor-pointer touch-manipulation"
                style={{ accentColor: 'rgba(255,255,255,0.55)' }}
                data-no-swipe
              />
            </div>
          </>
        ) : (
          <div className="text-center">
            <p className="text-white/25 text-sm tracking-widest uppercase">Nothing playing</p>
            <p className="text-white/15 text-xs mt-2">Tap a playlist to start</p>
          </div>
        )}

        {/* Device picker button — always visible at bottom of left panel */}
        <button
          onClick={openPicker}
          className={`flex items-center gap-2 touch-manipulation transition-colors ${
            state?.device?.name ? 'text-white/30 active:text-white/60' : 'text-white/15 active:text-white/40'
          }`}
        >
          <CastIcon />
          <span className="text-xs tracking-wider uppercase truncate max-w-[120px]">
            {state?.device?.name ?? 'No device'}
          </span>
        </button>
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
