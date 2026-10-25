import React, {
  createContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import axios from "axios";
import type { SpotifyState, SpotifyDevice } from "../types";
import { useConnectivity } from "../hooks/useConnectivity";
import { getSocket } from "../lib/socket";

type SpotifyContextValue = {
  state: SpotifyState | null;
  control: (action: string, body?: Record<string, unknown>) => Promise<void>;
  playContext: (
    context_uri: string | undefined,
    offset_uri?: string | undefined,
  ) => Promise<void>;
  playUri: (uri: string) => Promise<void>;
  devices: SpotifyDevice[];
  fetchDevices: () => Promise<any>;
  transferTo: (deviceId: string, play?: boolean) => Promise<void>;
  toggleShuffle: () => Promise<void>;
  cycleRepeat: () => Promise<void>;
  seek: (position: number) => Promise<void>;
  setVolume: (vol: number) => void;
  _tick: number;
};

export const SpotifyContext = createContext<SpotifyContextValue | null>(null);

export function SpotifyProvider({ children }: { children: React.ReactNode }) {
  const { recheck } = useConnectivity();
  const [state, setState] = useState<SpotifyState | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [tick, setTick] = useState(0);
  const polledAt = useRef(0);
  const pushed = useRef(false);
  const volumeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The server polls Spotify (adaptively, and right after any command) and pushes
  // 'spotify:state' when something changes. The GET is just for a fast first paint.
  useEffect(() => {
    const apply = (data: SpotifyState | null) => {
      pushed.current = true;
      polledAt.current = Date.now();
      setState(data);
    };
    axios
      .get("/api/spotify/now-playing")
      .then(({ data }) => {
        if (pushed.current) return; // a push already beat us — it's newer
        polledAt.current = Date.now();
        setState(data);
      })
      .catch(recheck);

    const socket = getSocket();
    socket.on("spotify:state", apply);
    return () => {
      socket.off("spotify:state", apply);
    };
  }, [recheck]);

  // Tick every second while playing so the progress bar moves smoothly
  useEffect(() => {
    if (!state?.isPlaying) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.isPlaying]);

  const control = useCallback(
    async (action: string, body?: Record<string, unknown>) => {
      try {
        await axios.post(`/api/spotify/${action}`, body);
      } catch {}
    },
    [],
  );

  const playContext = useCallback(
    async (context_uri: string | undefined, offset_uri?: string) => {
      try {
        const body: { context_uri?: string; offset_uri?: string } = {
          context_uri,
        };
        if (offset_uri) body.offset_uri = offset_uri;
        await axios.post("/api/spotify/play", body);
      } catch {}
    },
    [],
  );

  const playUri = useCallback(
    async (uri: string) => {
      try {
        await axios.post("/api/spotify/play", { uris: [uri] });
      } catch {}
    },
    [],
  );

  const fetchDevices = useCallback(async () => {
    try {
      const { data } = await axios.get("/api/spotify/devices");
      setDevices(data);
      return data;
    } catch {
      return [];
    }
  }, []);

  const transferTo = useCallback(
    async (deviceId: string, play = false) => {
      try {
        await axios.post("/api/spotify/transfer", { deviceId, play });
      } catch {}
    },
    [],
  );

  const toggleShuffle = useCallback(async () => {
    try {
      await axios.post("/api/spotify/shuffle", {
        state: !(state?.shuffle ?? false),
      });
    } catch (err) {
      const e = err as { response?: { data?: unknown }; message?: string };
      console.error("[spotify] shuffle:", e.response?.data ?? e.message);
    }
  }, [state?.shuffle]);

  const cycleRepeat = useCallback(async () => {
    try {
      const order = ["off", "context", "track"];
      const next =
        order[(order.indexOf(state?.repeat ?? "off") + 1) % order.length];
      await axios.post("/api/spotify/repeat", { state: next });
    } catch (err) {
      const e = err as { response?: { data?: unknown }; message?: string };
      console.error("[spotify] repeat:", e.response?.data ?? e.message);
    }
  }, [state?.repeat]);

  const seek = useCallback(async (position: number) => {
    try {
      await axios.post("/api/spotify/seek", { position });
      polledAt.current = Date.now();
      setState((prev) =>
        prev?.item
          ? { ...prev, item: { ...prev.item, progress: position } }
          : prev,
      );
    } catch {}
  }, []);

  const setVolume = useCallback((vol: number) => {
    clearTimeout(volumeDebounce.current ?? undefined);
    volumeDebounce.current = setTimeout(() => {
      axios.post("/api/spotify/volume", { volume: vol }).catch(() => {});
    }, 300);
  }, []);

  const liveState = state?.item
    ? {
        ...state,
        item: {
          ...state.item,
          progress: state.isPlaying
            ? Math.min(
                state.item.progress + (Date.now() - polledAt.current),
                state.item.duration,
              )
            : state.item.progress,
        },
      }
    : state;

  const value = {
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

  return (
    <SpotifyContext.Provider value={value}>{children}</SpotifyContext.Provider>
  );
}
