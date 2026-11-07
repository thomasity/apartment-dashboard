import React, {
  createContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import axios from "axios";
import type {
  LightingServerState,
  LightingValues,
  CircadianState,
  RoomsMap,
  ZonesMap,
  DevicesState,
  RuleSuggestion,
} from "../types";
import { getSocket } from "../lib/socket";

/** Fallback slider values for a device the server hasn't reported yet */
export const DEFAULT_VALUES: LightingValues = { brightness: 70, colorTemp: 30 };

// Bulbs are keyed by IEEE address and rooms by id throughout; names are for display.
// The server decides what lights should look like (Auto, rules, presence, manual
// sessions) — these actions just tell it what you did.
type LightingContextValue = {
  serverState: LightingServerState;
  devicesState: DevicesState;
  /** Optimistic slider values per bulb — what the UI shows while the server catches up */
  localDevices: Record<string, LightingValues>;
  circadian: CircadianState;
  rooms: RoomsMap;
  /** Per room (or unassigned bulb): on Auto?, and who's in control right now */
  zones: ZonesMap;

  // Global (all devices)
  setAll: (key: keyof LightingValues, value: number) => void;
  applyPreset: (preset: LightingValues) => void;

  /** "all", a room id or a bulb address */
  togglePower: (target: string) => void;
  /** "all" or a zone (room id / unassigned bulb address) */
  toggleAuto: (target: string) => void;
  /** Hand a zone back to automation: ends its manual session and the motion cooldown */
  resumeZone: (zone: string) => void;

  /** A rule suggestion to show on the Schedule tab, if the server has one */
  suggestion: RuleSuggestion | null;
  /** The suggested rule was saved */
  acceptSuggestion: (id: string) => void;
  /** "Not now" (30 days) or "never" */
  dismissSuggestion: (id: string, forever: boolean) => void;

  setDevice: (id: string, key: keyof LightingValues, value: number) => void;
  setRoom: (roomId: string, key: keyof LightingValues, value: number) => void;

  // Room CRUD
  createRoom: (name: string) => void;
  renameRoom: (id: string, name: string) => void;
  deleteRoom: (id: string) => void;
  assignDevice: (deviceId: string, roomId: string | null) => void;
};

export const LightingContext = createContext<LightingContextValue | null>(null);

export function LightingProvider({ children }: { children: React.ReactNode }) {
  const [serverState, setServerState] = useState<LightingServerState>({
    connected: false,
    groups: {},
    poweredOff: [],
  });
  const [devicesState, setDevicesState] = useState<DevicesState>({
    bridgeOnline: false,
    devices: [],
    pairing: false,
  });
  const [localDevices, setLocalDevices] = useState<
    Record<string, LightingValues>
  >({});
  const [circadian, setCircadian] = useState<CircadianState>({
    brightness: 50,
    colorTemp: 50,
    nextChange: null,
    timeline: [],
  });
  const [rooms, setRooms] = useState<RoomsMap>({});
  const [zones, setZones] = useState<ZonesMap>({});
  const [suggestion, setSuggestion] = useState<RuleSuggestion | null>(null);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTouchDevices = useRef<Record<string, Record<string, number>>>({});

  useEffect(() => {
    axios
      .get("/api/lighting/circadian")
      .then((r) => setCircadian(r.data))
      .catch(() => {});
    axios
      .get("/api/lighting/rooms")
      .then((r) => setRooms(r.data))
      .catch(() => {});
    axios
      .get("/api/lighting/zones")
      .then((r) => setZones(r.data))
      .catch(() => {});
    axios
      .get("/api/lighting/suggestions")
      .then((r) => setSuggestion(r.data || null))
      .catch(() => {});
    axios
      .get("/api/lighting/devices")
      .then(({ data }) => setDevicesState(data))
      .catch(() => {});
    axios
      .get("/api/lighting/state")
      .then(({ data }: { data: LightingServerState }) => {
        if (!Object.keys(data.groups).length) return;
        setServerState(data);
        const initial: Record<string, LightingValues> = {};
        Object.entries(data.groups).forEach(([id, g]) => {
          initial[id] = {
            brightness: g.brightness ?? DEFAULT_VALUES.brightness,
            colorTemp: g.colorTemp ?? DEFAULT_VALUES.colorTemp,
          };
        });
        setLocalDevices(initial);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    // Don't let a server push yank a slider the user touched in the last 1.2s
    const onState = (state: LightingServerState) => {
      setServerState(state);
      const now = Date.now();
      setLocalDevices((prev) => {
        const next: Record<string, LightingValues> = {};
        Object.entries(state.groups).forEach(([id, g]) => {
          const dt = lastTouchDevices.current[id] ?? {};
          next[id] = {
            brightness:
              now - (dt.brightness ?? 0) > 1200
                ? g.brightness
                : (prev[id]?.brightness ?? g.brightness),
            colorTemp:
              now - (dt.colorTemp ?? 0) > 1200
                ? g.colorTemp
                : (prev[id]?.colorTemp ?? g.colorTemp),
          };
        });
        return next;
      });
    };
    const onCircadian = (data: Partial<CircadianState>) =>
      setCircadian((prev) => ({ ...prev, ...data }));

    const socket = getSocket();
    socket.on("lighting:state", onState);
    socket.on("lighting:devices", setDevicesState);
    socket.on("lighting:circadian", onCircadian);
    socket.on("lighting:rooms", setRooms);
    socket.on("lighting:zones", setZones);
    socket.on("lighting:suggestion", setSuggestion);
    return () => {
      socket.off("lighting:state", onState);
      socket.off("lighting:devices", setDevicesState);
      socket.off("lighting:circadian", onCircadian);
      socket.off("lighting:rooms", setRooms);
      socket.off("lighting:zones", setZones);
      socket.off("lighting:suggestion", setSuggestion);
    };
  }, []);

  // Optimistically moves the given (on) bulbs' sliders and sends one debounced request
  // for the target, so dragging doesn't flood the bridge.
  const slide = useCallback(
    (
      target: string,
      bulbs: string[],
      key: keyof LightingValues,
      value: number,
    ) => {
      const now = Date.now();
      const off = serverState.poweredOff ?? [];
      const on = bulbs.filter((id) => !off.includes(id));
      on.forEach((id) => {
        (lastTouchDevices.current[id] ??= {})[key] = now;
      });
      setLocalDevices((prev) => {
        const next = { ...prev };
        on.forEach((id) => {
          next[id] = { ...(prev[id] ?? DEFAULT_VALUES), [key]: value };
        });
        return next;
      });
      const timerKey = `${target}|${key}`;
      clearTimeout(timers.current[timerKey]);
      timers.current[timerKey] = setTimeout(() => {
        axios
          .post("/api/lighting/set", { group: target, [key]: value })
          .catch(console.warn);
      }, 220);
    },
    [serverState.poweredOff],
  );

  const setAll = useCallback(
    (key: keyof LightingValues, value: number) =>
      slide("all", Object.keys(serverState.groups), key, value),
    [slide, serverState.groups],
  );

  const setDevice = useCallback(
    (id: string, key: keyof LightingValues, value: number) =>
      slide(id, [id], key, value),
    [slide],
  );

  const setRoom = useCallback(
    (roomId: string, key: keyof LightingValues, value: number) =>
      slide(roomId, rooms[roomId]?.devices ?? [], key, value),
    [slide, rooms],
  );

  // One request for both values, so the lights change in a single step
  const applyPreset = useCallback(
    (preset: LightingValues) => {
      const now = Date.now();
      const off = serverState.poweredOff ?? [];
      Object.keys(serverState.groups).forEach((id) => {
        if (!off.includes(id))
          lastTouchDevices.current[id] = { brightness: now, colorTemp: now };
      });
      setLocalDevices((prev) => {
        const next: Record<string, LightingValues> = {};
        Object.entries(prev).forEach(([id, vals]) => {
          next[id] = off.includes(id) ? vals : { ...preset };
        });
        return next;
      });
      // Drop any pending slider send so it can't land after the preset
      clearTimeout(timers.current["all|brightness"]);
      clearTimeout(timers.current["all|colorTemp"]);
      axios
        .post("/api/lighting/set", { group: "all", ...preset })
        .catch(console.warn);
    },
    [serverState.poweredOff, serverState.groups],
  );

  // Bulbs a target covers that are actually paired — a stale room member would
  // otherwise keep "every device is off" from ever being true
  const bulbsOf = useCallback(
    (target: string): string[] => {
      if (target === "all") return Object.keys(serverState.groups);
      const members = rooms[target]?.devices ?? [target];
      return members.filter((id) => serverState.groups[id]);
    },
    [rooms, serverState.groups],
  );

  const togglePower = useCallback(
    (target: string) => {
      const poweredOff = serverState.poweredOff ?? [];
      const bulbs = bulbsOf(target);
      const isOff = bulbs.length > 0 && bulbs.every((id) => poweredOff.includes(id));
      axios
        .post("/api/lighting/power", { group: target, on: isOff })
        .catch(console.warn);
    },
    [serverState.poweredOff, bulbsOf],
  );

  const toggleAuto = useCallback(
    (target: string) => {
      const list = Object.values(zones);
      const enabled =
        target === "all"
          ? !(list.length > 0 && list.every((z) => z.auto))
          : !zones[target]?.auto;
      axios
        .post("/api/lighting/auto", { group: target, enabled })
        .catch(console.warn);
    },
    [zones],
  );

  const resumeZone = useCallback((zone: string) => {
    axios
      .post(`/api/lighting/zones/${encodeURIComponent(zone)}/resume`)
      .catch(console.warn);
  }, []);

  // The server broadcasts the cleared suggestion; clearing locally too hides it at once
  const acceptSuggestion = useCallback((id: string) => {
    setSuggestion(null);
    axios.post(`/api/lighting/suggestions/${id}/accept`).catch(console.warn);
  }, []);

  const dismissSuggestion = useCallback((id: string, forever: boolean) => {
    setSuggestion(null);
    axios
      .post(`/api/lighting/suggestions/${id}/dismiss`, { forever })
      .catch(console.warn);
  }, []);

  // ── Room CRUD (the server broadcasts the new rooms) ──────────────────────

  const createRoom = useCallback((name: string) => {
    axios.post("/api/lighting/rooms", { name }).catch(console.warn);
  }, []);

  const renameRoom = useCallback((id: string, name: string) => {
    axios
      .patch(`/api/lighting/rooms/${encodeURIComponent(id)}`, { name })
      .catch(console.warn);
  }, []);

  const deleteRoom = useCallback((id: string) => {
    axios
      .delete(`/api/lighting/rooms/${encodeURIComponent(id)}`)
      .catch(console.warn);
  }, []);

  const assignDevice = useCallback(
    (deviceId: string, roomId: string | null) => {
      axios
        .post("/api/lighting/rooms/assign", { device: deviceId, room: roomId })
        .catch(console.warn);
    },
    [],
  );

  const value = {
    serverState,
    devicesState,
    localDevices,
    circadian,
    rooms,
    zones,
    setAll,
    applyPreset,
    togglePower,
    toggleAuto,
    resumeZone,
    suggestion,
    acceptSuggestion,
    dismissSuggestion,
    setDevice,
    setRoom,
    createRoom,
    renameRoom,
    deleteRoom,
    assignDevice,
  };

  return (
    <LightingContext.Provider value={value}>
      {children}
    </LightingContext.Provider>
  );
}
