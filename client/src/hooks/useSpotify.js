import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

export function useSpotify() {
  const [state, setState]   = useState(null);
  const [tick,  setTick]    = useState(0);
  const polledAt            = useRef(0);

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

  const control = useCallback(async (action, body) => {
    try {
      await axios.post(`/api/spotify/${action}`, body);
      setTimeout(poll, 400);
    } catch {}
  }, [poll]);

  if (!state?.track) return { state, control };

  // Interpolate progress locally between server polls
  const elapsed  = state.isPlaying ? Date.now() - polledAt.current : 0;
  const progress = Math.min(state.track.progress + elapsed, state.track.duration);

  return {
    state: { ...state, track: { ...state.track, progress } },
    control,
    // expose tick so callers can force re-render awareness (unused but available)
    _tick: tick,
  };
}
