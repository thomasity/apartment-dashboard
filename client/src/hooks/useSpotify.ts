import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

export function useSpotify() {
  const [state,       setState]       = useState(null);
  const [playlists,   setPlaylists]   = useState(null);
  const [albums,      setAlbums]      = useState(null);
  const [albumsError, setAlbumsError] = useState(null);
  const [devices,     setDevices]     = useState([]);
  const [tick,      setTick]      = useState(0);
  const polledAt                  = useRef(0);
  const volumeDebounce            = useRef(null);

  const poll = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/spotify/now-playing');
      polledAt.current = Date.now();
      setState(data);
    } catch {}
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [poll]);

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

  // Tick every second while playing so the progress bar moves smoothly
  useEffect(() => {
    if (!state?.isPlaying) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.isPlaying]);

  const control = useCallback(async (action, body) => {
    try {
      await axios.post(`/api/spotify/${action}`, body);
      setTimeout(poll, 400);
    } catch {}
  }, [poll]);

  const playContext = useCallback(async (context_uri, offset_uri) => {
    try {
      const body = { context_uri };
      if (offset_uri) body.offset_uri = offset_uri;
      await axios.post('/api/spotify/play', body);
      setTimeout(poll, 400);
    } catch {}
  }, [poll]);

  const playUri = useCallback(async (uri) => {
    try {
      await axios.post('/api/spotify/play', { uris: [uri] });
      setTimeout(poll, 400);
    } catch {}
  }, [poll]);

  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await axios.get('/api/spotify/devices');
      setDevices(data);
      return data;
    } catch { return []; }
  }, []);

  const transferTo = useCallback(async (deviceId, play = false) => {
    try {
      await axios.post('/api/spotify/transfer', { deviceId, play });
      setTimeout(poll, 600);
    } catch {}
  }, [poll]);

  const toggleShuffle = useCallback(async () => {
    try {
      await axios.post('/api/spotify/shuffle', { state: !(state?.shuffle ?? false) });
      setTimeout(poll, 1000);
    } catch (err) { console.error('[spotify] shuffle:', err.response?.data ?? err.message); }
  }, [state?.shuffle, poll]);

  const cycleRepeat = useCallback(async () => {
    try {
      const order = ['off', 'context', 'track'];
      const next = order[(order.indexOf(state?.repeat ?? 'off') + 1) % order.length];
      await axios.post('/api/spotify/repeat', { state: next });
      setTimeout(poll, 1000);
    } catch (err) { console.error('[spotify] repeat:', err.response?.data ?? err.message); }
  }, [state?.repeat, poll]);

  const seek = useCallback(async (position) => {
    try {
      await axios.post('/api/spotify/seek', { position });
      polledAt.current = Date.now();
      setState((prev) => prev?.item ? { ...prev, item: { ...prev.item, progress: position } } : prev);
    } catch {}
  }, []);

  const setVolume = useCallback((vol) => {
    clearTimeout(volumeDebounce.current);
    volumeDebounce.current = setTimeout(() => {
      axios.post('/api/spotify/volume', { volume: vol }).catch(() => {});
    }, 300);
  }, []);

  const liveState = state?.item ? {
    ...state,
    item: {
      ...state.item,
      progress: state.isPlaying
        ? Math.min(state.item.progress + (Date.now() - polledAt.current), state.item.duration)
        : state.item.progress,
    },
  } : state;

  return {
    state: liveState,
    control,
    playContext,
    playUri,
    playlists,
    albums,
    albumsError,
    devices,
    fetchDevices,
    transferTo,
    toggleShuffle,
    cycleRepeat,
    seek,
    setVolume,
    _tick: tick,
  };
}
