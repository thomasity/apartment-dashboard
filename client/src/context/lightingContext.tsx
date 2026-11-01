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
  OverridesMap,
  DevicesState,
} from "../types";
import { getSocket } from "../lib/socket";

/** Fallback slider values for a device the server hasn't reported yet */
export const DEFAULT_VALUES: LightingValues = { brightness: 70, colorTemp: 30 };

type LightingContextValue = {
  serverState: LightingServerState;
  devicesState: DevicesState;
  /** Optimistic slider values per device — what the UI shows while the server catches up */
  localDevices: Record<string, LightingValues>;
  circadian: CircadianState;
  rooms: RoomsMap;
  overrides: OverridesMap;

  // Global (all devices)
  setAll: (key: keyof LightingValues, value: number) => void;
  togglePower: (group: string) => void;
  toggleCircadian: (group: string) => Promise<void>;
  applyPreset: (preset: LightingValues) => void;

  // Per-device
  setDevice: (name: string, key: keyof LightingValues, value: number) => void;

  // Room-level
  setRoom: (roomName: string, key: keyof LightingValues, value: number) => void;
  toggleRoomPower: (roomName: string) => void;
  toggleRoomCircadian: (roomName: string) => Promise<void>;
  clearRoomOverride: (roomName: string) => void;

  // Room CRUD
  createRoom: (name: string) => void;
  renameRoom: (oldName: string, newName: string) => void;
  deleteRoom: (name: string) => void;
  assignDevice: (deviceName: string, roomName: string | null) => void;
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
    enabledGroups: [],
    brightness: 50,
    colorTemp: 50,
    nextChange: null,
    timeline: [],
  });
  const [rooms, setRooms] = useState<RoomsMap>({});
  const [overrides, setOverrides] = useState<OverridesMap>({});

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const roomTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTouchDevices = useRef<Record<string, Record<string, number>>>({});
  const timersDevices = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

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
      .get("/api/lighting/override")
      .then((r) => setOverrides(r.data))
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
        Object.entries(data.groups).forEach(([name, g]) => {
          initial[name] = {
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
        Object.entries(state.groups).forEach(([name, g]) => {
          const dt = lastTouchDevices.current[name] ?? {};
          next[name] = {
            brightness:
              now - (dt.brightness ?? 0) > 1200
                ? g.brightness
                : (prev[name]?.brightness ?? g.brightness),
            colorTemp:
              now - (dt.colorTemp ?? 0) > 1200
                ? g.colorTemp
                : (prev[name]?.colorTemp ?? g.colorTemp),
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
    socket.on("lighting:override", setOverrides);
    return () => {
      socket.off("lighting:state", onState);
      socket.off("lighting:devices", setDevicesState);
      socket.off("lighting:circadian", onCircadian);
      socket.off("lighting:rooms", setRooms);
      socket.off("lighting:override", setOverrides);
    };
  }, []);

  // ── Global (all devices) ─────────────────────────────────────────────────

  const sendAll = useCallback((payload: Record<string, unknown>) => {
    axios
      .post("/api/lighting/set", { group: "all", ...payload })
      .catch(console.warn);
  }, []);

  const setAll = useCallback(
    (key: keyof LightingValues, value: number) => {
      const now = Date.now();
      const off = serverState.poweredOff ?? [];
      Object.keys(localDevices).forEach((name) => {
        if (off.includes(name)) return;
        if (!lastTouchDevices.current[name])
          lastTouchDevices.current[name] = {};
        lastTouchDevices.current[name][key] = now;
      });
      setLocalDevices((prev) => {
        const next: Record<string, LightingValues> = {};
        Object.entries(prev).forEach(([name, vals]) => {
          next[name] = off.includes(name) ? vals : { ...vals, [key]: value };
        });
        return next;
      });
      clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => sendAll({ [key]: value }), 220);
    },
    [serverState.poweredOff, localDevices, sendAll],
  );

  const togglePower = useCallback(
    (group: string) => {
      const poweredOff = serverState.poweredOff ?? [];
      const deviceEntries = Object.entries(serverState.groups);
      const isOff =
        group === "all"
          ? deviceEntries.every(([n]) => poweredOff.includes(n))
          : poweredOff.includes(group);
      axios
        .post("/api/lighting/power", { group, on: isOff })
        .catch(console.warn);
    },
    [serverState],
  );

  const toggleCircadian = useCallback(
    async (group: string) => {
      const deviceEntries = Object.entries(serverState.groups);
      const enabled =
        group === "all"
          ? !deviceEntries.every(([n]) =>
              (circadian.enabledGroups ?? []).includes(n),
            )
          : !(circadian.enabledGroups ?? []).includes(group);
      await axios
        .post("/api/lighting/circadian", { group, enabled })
        .catch(console.warn);
    },
    [serverState.groups, circadian.enabledGroups],
  );

  const applyPreset = useCallback(
    (preset: LightingValues) => {
      if ((circadian.enabledGroups ?? []).length > 0) {
        axios
          .post("/api/lighting/circadian", { group: "all", enabled: false })
          .catch(console.warn);
        setCircadian((prev) => ({ ...prev, enabledGroups: [] }));
      }
      setAll("brightness", preset.brightness);
      setAll("colorTemp", preset.colorTemp);
    },
    [setAll, circadian.enabledGroups],
  );

  // ── Per-device ───────────────────────────────────────────────────────────

  const setDevice = useCallback(
    (name: string, key: keyof LightingValues, value: number) => {
      if (!lastTouchDevices.current[name]) lastTouchDevices.current[name] = {};
      lastTouchDevices.current[name][key] = Date.now();
      setLocalDevices((prev) => ({
        ...prev,
        [name]: { ...(prev[name] ?? DEFAULT_VALUES), [key]: value },
      }));
      const timerKey = `${name}-${key}`;
      clearTimeout(timersDevices.current[timerKey]);
      timersDevices.current[timerKey] = setTimeout(() => {
        axios
          .post("/api/lighting/set", { group: name, [key]: value })
          .catch(console.warn);
      }, 220);
    },
    [],
  );

  // ── Room-level ───────────────────────────────────────────────────────────

  const setRoom = useCallback(
    (roomName: string, key: keyof LightingValues, value: number) => {
      const now = Date.now();
      const off = serverState.poweredOff ?? [];
      const devicesInRoom = rooms[roomName] ?? [];
      devicesInRoom.forEach((name) => {
        if (off.includes(name)) return;
        if (!lastTouchDevices.current[name])
          lastTouchDevices.current[name] = {};
        lastTouchDevices.current[name][key] = now;
      });
      setLocalDevices((prev) => {
        const next = { ...prev };
        devicesInRoom.forEach((name) => {
          if (!off.includes(name))
            next[name] = { ...(prev[name] ?? DEFAULT_VALUES), [key]: value };
        });
        return next;
      });
      const timerKey = `room|${roomName}|${key}`;
      clearTimeout(roomTimers.current[timerKey]);
      roomTimers.current[timerKey] = setTimeout(() => {
        axios
          .post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/set`, {
            [key]: value,
          })
          .catch(console.warn);
      }, 220);
    },
    [serverState.poweredOff, rooms],
  );

  const toggleRoomPower = useCallback(
    (roomName: string) => {
      const devicesInRoom = rooms[roomName] ?? [];
      const poweredOff = serverState.poweredOff ?? [];
      const isOff =
        devicesInRoom.length > 0 &&
        devicesInRoom.every((n) => poweredOff.includes(n));
      axios
        .post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/power`, {
          on: isOff,
        })
        .catch(console.warn);
    },
    [serverState.poweredOff, rooms],
  );

  const toggleRoomCircadian = useCallback(
    async (roomName: string) => {
      const devicesInRoom = rooms[roomName] ?? [];
      const isEnabled =
        devicesInRoom.length > 0 &&
        devicesInRoom.every((n) => (circadian.enabledGroups ?? []).includes(n));
      await axios
        .post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/circadian`, {
          enabled: !isEnabled,
        })
        .catch(console.warn);
    },
    [rooms, circadian.enabledGroups],
  );

  const clearRoomOverride = useCallback((roomName: string) => {
    axios
      .delete(`/api/lighting/rooms/${encodeURIComponent(roomName)}/override`)
      .catch(console.warn);
  }, []);

  // ── Room CRUD ────────────────────────────────────────────────────────────

  const refetchRooms = useCallback(() => {
    axios
      .get("/api/lighting/rooms")
      .then((r) => setRooms(r.data))
      .catch(() => {});
  }, []);

  const createRoom = useCallback(
    (name: string) => {
      axios
        .post("/api/lighting/rooms", { name })
        .then(refetchRooms)
        .catch(console.warn);
    },
    [refetchRooms],
  );

  const renameRoom = useCallback(
    (oldName: string, newName: string) => {
      axios
        .patch(`/api/lighting/rooms/${encodeURIComponent(oldName)}`, {
          newName,
        })
        .then(refetchRooms)
        .catch(console.warn);
    },
    [refetchRooms],
  );

  const deleteRoom = useCallback(
    (name: string) => {
      axios
        .delete(`/api/lighting/rooms/${encodeURIComponent(name)}`)
        .then(refetchRooms)
        .catch(console.warn);
    },
    [refetchRooms],
  );

  const assignDevice = useCallback(
    (deviceName: string, roomName: string | null) => {
      axios
        .post("/api/lighting/rooms/assign", {
          device: deviceName,
          room: roomName ?? null,
        })
        .then(refetchRooms)
        .catch(console.warn);
    },
    [refetchRooms],
  );

  const value = {
    serverState,
    devicesState,
    localDevices,
    circadian,
    rooms,
    overrides,
    setAll,
    togglePower,
    toggleCircadian,
    applyPreset,
    setDevice,
    setRoom,
    toggleRoomPower,
    toggleRoomCircadian,
    clearRoomOverride,
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
