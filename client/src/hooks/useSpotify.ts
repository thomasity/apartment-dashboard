import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import type { SpotifyState, SpotifyDevice } from '../types';

export function useSpotify() {
  const [state,   setState] = useState<SpotifyState | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [tick,    setTick]  = useState(0);
  const polledAt                  = useRef(0);
  const volumeDebounce            = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Tick every second while playing so the progress bar moves smoothly
  useEffect(() => {
    if (!state?.isPlaying) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.isPlaying]);

  const control = useCallback(async (action: string, body?: Record<string, unknown>) => {
    try {
      await axios.post(`/api/spotify/${action}`, body);
      setTimeout(poll, 400);
    } catch {}
  }, [poll]);

  const playContext = useCallback(async (context_uri: string | undefined, offset_uri?: string) => {
    try {
      const body: { context_uri?: string; offset_uri?: string } = { context_uri };
      if (offset_uri) body.offset_uri = offset_uri;
      await axios.post('/api/spotify/play', body);
      setTimeout(poll, 400);
    } catch {}
  }, [poll]);

  const playUri = useCallback(async (uri: string) => {
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

  const transferTo = useCallback(async (deviceId: string, play = false) => {
    try {
      await axios.post('/api/spotify/transfer', { deviceId, play });
      setTimeout(poll, 600);
    } catch {}
  }, [poll]);

  const toggleShuffle = useCallback(async () => {
    try {
      await axios.post('/api/spotify/shuffle', { state: !(state?.shuffle ?? false) });
      setTimeout(poll, 1000);
    } catch (err) {
      const e = err as { response?: { data?: unknown }; message?: string };
      console.error('[spotify] shuffle:', e.response?.data ?? e.message);
    }
  }, [state?.shuffle, poll]);

  const cycleRepeat = useCallback(async () => {
    try {
      const order = ['off', 'context', 'track'];
      const next = order[(order.indexOf(state?.repeat ?? 'off') + 1) % order.length];
      await axios.post('/api/spotify/repeat', { state: next });
      setTimeout(poll, 1000);
    } catch (err) {
      const e = err as { response?: { data?: unknown }; message?: string };
      console.error('[spotify] repeat:', e.response?.data ?? e.message);
    }
  }, [state?.repeat, poll]);

  const seek = useCallback(async (position: number) => {
    try {
      await axios.post('/api/spotify/seek', { position });
      polledAt.current = Date.now();
      setState((prev) => prev?.item ? { ...prev, item: { ...prev.item, progress: position } } : prev);
    } catch {}
  }, []);

  const setVolume = useCallback((vol: number) => {
    clearTimeout(volumeDebounce.current ?? undefined);
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
