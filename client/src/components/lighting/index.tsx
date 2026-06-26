import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import ControlsView  from './ControlsView';
import PresetsView   from './PresetsView';
import ScheduleView  from './ScheduleView';
import DevicesView   from './DevicesView';
import type { LightingServerState, LightingValues, CircadianState, RoomsMap, OverridesMap } from '../../types';

export default function Lighting() {
  interface DevicesState {
    bridgeOnline: boolean;
    devices: DeviceEntry[];
    pairing: boolean;
    availability?: Record<string, boolean>;
  }

  interface DeviceEntry {
    ieee_address: string;
    friendly_name: string;
    type: string;
    definition?: { description?: string };
  }

  const [view,         setView]         = useState('controls');
  const [serverState,  setServerState]  = useState<LightingServerState>({ connected: false, groups: {}, poweredOff: [] });
  const [devicesState, setDevicesState] = useState<DevicesState>({ bridgeOnline: false, devices: [], pairing: false });
  const [localDevices, setLocalDevices] = useState<Record<string, LightingValues>>({});
  const [socket,       setSocket]       = useState<Socket | null>(null);
  const [circadian,    setCircadian]    = useState<CircadianState>({ enabledGroups: [], brightness: 50, colorTemp: 50, nextChange: null, timeline: [] });
  const [rooms,        setRooms]        = useState<RoomsMap>({});
  const [overrides,    setOverrides]    = useState<OverridesMap>({});

  const timers           = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const roomTimers       = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const lastTouchDevices = useRef<Record<string, Record<string, number>>>({});
  const timersDevices    = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    axios.get('/api/lighting/circadian').then((r) => setCircadian(r.data)).catch(() => {});
    axios.get('/api/lighting/rooms').then((r) => setRooms(r.data)).catch(() => {});
    axios.get('/api/lighting/override').then((r) => setOverrides(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    axios.get('/api/lighting/devices').then(({ data }) => setDevicesState(data)).catch(() => {});
  }, []);

  useEffect(() => {
    axios.get('/api/lighting/state').then(({ data }: { data: LightingServerState }) => {
      if (!Object.keys(data.groups).length) return;
      setServerState(data);
      const initial: Record<string, LightingValues> = {};
      Object.entries(data.groups).forEach(([name, g]) => {
        initial[name] = { brightness: g.brightness ?? 70, colorTemp: g.colorTemp ?? 30 };
      });
      setLocalDevices(initial);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('lighting:state', (state: LightingServerState) => {
      setServerState(state);
      const now = Date.now();
      setLocalDevices((prev) => {
        const next: Record<string, LightingValues> = {};
        Object.entries(state.groups).forEach(([name, g]) => {
          const dt = lastTouchDevices.current[name] ?? {};
          next[name] = {
            brightness: now - (dt.brightness ?? 0) > 1200 ? g.brightness : (prev[name]?.brightness ?? g.brightness),
            colorTemp:  now - (dt.colorTemp  ?? 0) > 1200 ? g.colorTemp  : (prev[name]?.colorTemp  ?? g.colorTemp),
          };
        });
        return next;
      });
    });
    s.on('lighting:devices',  setDevicesState);
    s.on('lighting:circadian', (data: Partial<CircadianState>) => setCircadian((prev) => ({ ...prev, ...data })));
    s.on('lighting:rooms',     setRooms);
    s.on('lighting:override',  setOverrides);
    return () => { s.disconnect(); };
  }, []);

  // ── Global (all devices) ─────────────────────────────────────────────────

  const sendAll = useCallback((payload: Record<string, unknown>) => {
    axios.post('/api/lighting/set', { group: 'all', ...payload }).catch(console.warn);
  }, []);

  const handleSlider = useCallback((key: keyof LightingValues, value: number) => {
    const now = Date.now();
    const off = serverState.poweredOff ?? [];
    Object.keys(localDevices).forEach((name) => {
      if (off.includes(name)) return;
      if (!lastTouchDevices.current[name]) lastTouchDevices.current[name] = {};
      lastTouchDevices.current[name][key] = now;
    });
    setLocalDevices((prev) => {
      const next: Record<string, LightingValues> = {};
      Object.keys(prev).forEach((name) => {
        next[name] = off.includes(name) ? prev[name] : { ...prev[name], [key]: value };
      });
      return next;
    });
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => sendAll({ [key]: value }), 220);
  }, [serverState.poweredOff, localDevices, sendAll]);

  const togglePower = useCallback((group: string) => {
    const poweredOff    = serverState.poweredOff ?? [];
    const deviceEntries = Object.entries(serverState.groups);
    const isOff = group === 'all'
      ? deviceEntries.every(([n]) => poweredOff.includes(n))
      : poweredOff.includes(group);
    axios.post('/api/lighting/power', { group, on: isOff }).catch(console.warn);
  }, [serverState]);

  const toggleCircadianGroup = useCallback(async (group: string) => {
    const deviceEntries = Object.entries(serverState.groups);
    const enabled = group === 'all'
      ? !deviceEntries.every(([n]) => (circadian.enabledGroups ?? []).includes(n))
      : !(circadian.enabledGroups ?? []).includes(group);
    await axios.post('/api/lighting/circadian', { group, enabled }).catch(console.warn);
  }, [serverState.groups, circadian.enabledGroups]);

  // ── Per-device ───────────────────────────────────────────────────────────

  const handleDeviceSlider = useCallback((name: string, key: keyof LightingValues, value: number) => {
    if (!lastTouchDevices.current[name]) lastTouchDevices.current[name] = {};
    lastTouchDevices.current[name][key] = Date.now();
    setLocalDevices((prev) => ({ ...prev, [name]: { ...(prev[name] ?? {}), [key]: value } }));
    const timerKey = `${name}-${key}`;
    clearTimeout(timersDevices.current[timerKey]);
    timersDevices.current[timerKey] = setTimeout(() => {
      axios.post('/api/lighting/set', { group: name, [key]: value }).catch(console.warn);
    }, 220);
  }, []);

  // ── Room-level ───────────────────────────────────────────────────────────

  const handleRoomSlider = useCallback((roomName: string, key: keyof LightingValues, value: number) => {
    const now = Date.now();
    const off = serverState.poweredOff ?? [];
    const devicesInRoom = rooms[roomName] ?? [];
    devicesInRoom.forEach((name) => {
      if (off.includes(name)) return;
      if (!lastTouchDevices.current[name]) lastTouchDevices.current[name] = {};
      lastTouchDevices.current[name][key] = now;
    });
    setLocalDevices((prev) => {
      const next = { ...prev };
      devicesInRoom.forEach((name) => {
        if (!off.includes(name)) next[name] = { ...(prev[name] ?? {}), [key]: value };
      });
      return next;
    });
    const timerKey = `room|${roomName}|${key}`;
    clearTimeout(roomTimers.current[timerKey]);
    roomTimers.current[timerKey] = setTimeout(() => {
      axios.post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/set`, { [key]: value }).catch(console.warn);
    }, 220);
  }, [serverState.poweredOff, rooms]);

  const toggleRoomPower = useCallback((roomName: string) => {
    const devicesInRoom = rooms[roomName] ?? [];
    const poweredOff = serverState.poweredOff ?? [];
    const isOff = devicesInRoom.length > 0 && devicesInRoom.every((n) => poweredOff.includes(n));
    axios.post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/power`, { on: isOff }).catch(console.warn);
  }, [serverState.poweredOff, rooms]);

  const toggleRoomCircadian = useCallback(async (roomName: string) => {
    const devicesInRoom = rooms[roomName] ?? [];
    const isEnabled = devicesInRoom.length > 0 && devicesInRoom.every((n) => (circadian.enabledGroups ?? []).includes(n));
    await axios.post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/circadian`, { enabled: !isEnabled }).catch(console.warn);
  }, [rooms, circadian.enabledGroups]);

  // ── Room CRUD ────────────────────────────────────────────────────────────

  const refetchRooms = useCallback(() => {
    axios.get('/api/lighting/rooms').then((r) => setRooms(r.data)).catch(() => {});
  }, []);

  const createRoom = useCallback((name: string) => {
    axios.post('/api/lighting/rooms', { name }).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  const renameRoom = useCallback((oldName: string, newName: string) => {
    axios.patch(`/api/lighting/rooms/${encodeURIComponent(oldName)}`, { newName }).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  const deleteRoom = useCallback((name: string) => {
    axios.delete(`/api/lighting/rooms/${encodeURIComponent(name)}`).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  const assignDevice = useCallback((deviceName: string, roomName: string | null) => {
    axios.post('/api/lighting/rooms/assign', { device: deviceName, room: roomName ?? null }).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  // ── Override ─────────────────────────────────────────────────────────────

  const clearRoomOverride = useCallback((roomName: string) => {
    axios.delete(`/api/lighting/rooms/${encodeURIComponent(roomName)}/override`).catch(console.warn);
  }, []);

  // ── Presets ──────────────────────────────────────────────────────────────

  const applyPreset = useCallback((preset: LightingValues) => {
    if ((circadian.enabledGroups ?? []).length > 0) {
      axios.post('/api/lighting/circadian', { group: 'all', enabled: false }).catch(console.warn);
      setCircadian((prev) => ({ ...prev, enabledGroups: [] }));
    }
    handleSlider('brightness', preset.brightness);
    handleSlider('colorTemp',  preset.colorTemp);
  }, [handleSlider, circadian.enabledGroups]);

  return (
    <div className="h-full flex flex-col overflow-hidden relative">

      {/* Nav pill */}
      <div className="shrink-0 flex justify-center pt-5 pb-2">
        <div className="flex bg-white/[0.06] rounded-full p-1 gap-1">
          {['controls', 'presets', 'rules', 'devices'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-widest transition-colors touch-manipulation ${
                view === v ? 'bg-white/[0.12] text-white/80' : 'text-white/30 hover:text-white/50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'controls' && (
        <ControlsView
          serverState={serverState}
          localDevices={localDevices}
          circadian={circadian}
          availability={devicesState.availability}
          rooms={rooms}
          overrides={overrides}
          onSlider={handleSlider}
          onDeviceSlider={handleDeviceSlider}
          onRoomSlider={handleRoomSlider}
          onTogglePower={togglePower}
          onToggleCircadian={toggleCircadianGroup}
          onRoomTogglePower={toggleRoomPower}
          onRoomToggleCircadian={toggleRoomCircadian}
          onClearRoomOverride={clearRoomOverride}
          onGoToDevices={() => setView('devices')}
        />
      )}

      {view === 'presets' && (
        <PresetsView
          localDevices={localDevices}
          onApplyPreset={applyPreset}
        />
      )}

      {view === 'rules' && (
        <ScheduleView rooms={rooms} />
      )}

      {view === 'devices' && (
        <DevicesView
          socket={socket}
          devState={devicesState}
          setDevState={setDevicesState}
          rooms={rooms}
          onCreateRoom={createRoom}
          onRenameRoom={renameRoom}
          onDeleteRoom={deleteRoom}
          onAssignDevice={assignDevice}
        />
      )}

    </div>
  );
}
