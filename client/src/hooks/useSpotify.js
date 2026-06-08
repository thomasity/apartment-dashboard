import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

export function useSpotify() {
  const [state,     setState]     = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [devices,   setDevices]   = useState([]);
  const [tick,      setTick]      = useState(0);
  const polledAt                  = useRef(0);

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

  const playContext = useCallback(async (context_uri) => {
    try {
      await axios.post('/api/spotify/play', { context_uri });
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

  const liveState = state?.track ? {
    ...state,
    track: {
      ...state.track,
      progress: state.isPlaying
        ? Math.min(state.track.progress + (Date.now() - polledAt.current), state.track.duration)
        : state.track.progress,
    },
  } : state;

  return { state: liveState, control, playContext, playlists, devices, fetchDevices, transferTo, _tick: tick };
}
