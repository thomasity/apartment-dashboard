import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import ControlsView  from './ControlsView';
import PresetsView   from './PresetsView';
import ScheduleView  from './ScheduleView';
import DevicesView   from './DevicesView';

export default function Lighting() {
  const [view,         setView]         = useState('controls');
  const [serverState,  setServerState]  = useState({ connected: false, groups: {} });
  const [devicesState, setDevicesState] = useState({ bridgeOnline: false, devices: [], pairing: false });
  const [localDevices, setLocalDevices] = useState({});
  const [socket,       setSocket]       = useState(null);
  const [circadian,    setCircadian]    = useState({ enabledGroups: [], brightness: 50, colorTemp: 50, nextChange: null, timeline: [] });
  const [rooms,        setRooms]        = useState({});
  const [overrides,    setOverrides]    = useState({});

  const timers           = useRef({});
  const roomTimers       = useRef({});
  const lastTouchDevices = useRef({});
  const timersDevices    = useRef({});

  useEffect(() => {
    axios.get('/api/lighting/circadian').then((r) => setCircadian(r.data)).catch(() => {});
    axios.get('/api/lighting/rooms').then((r) => setRooms(r.data)).catch(() => {});
    axios.get('/api/lighting/override').then((r) => setOverrides(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    axios.get('/api/lighting/devices').then(({ data }) => setDevicesState(data)).catch(() => {});
  }, []);

  useEffect(() => {
    axios.get('/api/lighting/state').then(({ data }) => {
      if (!Object.keys(data.groups).length) return;
      setServerState(data);
      const initial = {};
      Object.entries(data.groups).forEach(([name, g]) => {
        initial[name] = { brightness: g.brightness ?? 70, colorTemp: g.colorTemp ?? 30 };
      });
      setLocalDevices(initial);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('lighting:state', (state) => {
      setServerState(state);
      const now = Date.now();
      setLocalDevices((prev) => {
        const next = {};
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
    s.on('lighting:circadian', (data) => setCircadian((prev) => ({ ...prev, ...data })));
    s.on('lighting:rooms',     setRooms);
    s.on('lighting:override',  setOverrides);
    return () => s.disconnect();
  }, []);

  // ── Global (all devices) ─────────────────────────────────────────────────

  const sendAll = useCallback((payload) => {
    axios.post('/api/lighting/set', { group: 'all', ...payload }).catch(console.warn);
  }, []);

  const handleSlider = useCallback((key, value) => {
    const now = Date.now();
    const off = serverState.poweredOff ?? [];
    Object.keys(localDevices).forEach((name) => {
      if (off.includes(name)) return;
      if (!lastTouchDevices.current[name]) lastTouchDevices.current[name] = {};
      lastTouchDevices.current[name][key] = now;
    });
    setLocalDevices((prev) => {
      const next = {};
      Object.keys(prev).forEach((name) => {
        next[name] = off.includes(name) ? prev[name] : { ...prev[name], [key]: value };
      });
      return next;
    });
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => sendAll({ [key]: value }), 220);
  }, [serverState.poweredOff, localDevices, sendAll]);

  const togglePower = useCallback((group) => {
    const poweredOff    = serverState.poweredOff ?? [];
    const deviceEntries = Object.entries(serverState.groups);
    const isOff = group === 'all'
      ? deviceEntries.every(([n]) => poweredOff.includes(n))
      : poweredOff.includes(group);
    axios.post('/api/lighting/power', { group, on: isOff }).catch(console.warn);
  }, [serverState]);

  const toggleCircadianGroup = useCallback(async (group) => {
    const deviceEntries = Object.entries(serverState.groups);
    const enabled = group === 'all'
      ? !deviceEntries.every(([n]) => (circadian.enabledGroups ?? []).includes(n))
      : !(circadian.enabledGroups ?? []).includes(group);
    await axios.post('/api/lighting/circadian', { group, enabled }).catch(console.warn);
  }, [serverState.groups, circadian.enabledGroups]);

  // ── Per-device ───────────────────────────────────────────────────────────

  const handleDeviceSlider = useCallback((name, key, value) => {
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

  const handleRoomSlider = useCallback((roomName, key, value) => {
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

  const toggleRoomPower = useCallback((roomName) => {
    const devicesInRoom = rooms[roomName] ?? [];
    const poweredOff = serverState.poweredOff ?? [];
    const isOff = devicesInRoom.length > 0 && devicesInRoom.every((n) => poweredOff.includes(n));
    axios.post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/power`, { on: isOff }).catch(console.warn);
  }, [serverState.poweredOff, rooms]);

  const toggleRoomCircadian = useCallback(async (roomName) => {
    const devicesInRoom = rooms[roomName] ?? [];
    const isEnabled = devicesInRoom.length > 0 && devicesInRoom.every((n) => (circadian.enabledGroups ?? []).includes(n));
    await axios.post(`/api/lighting/rooms/${encodeURIComponent(roomName)}/circadian`, { enabled: !isEnabled }).catch(console.warn);
  }, [rooms, circadian.enabledGroups]);

  // ── Room CRUD ────────────────────────────────────────────────────────────

  const refetchRooms = useCallback(() => {
    axios.get('/api/lighting/rooms').then((r) => setRooms(r.data)).catch(() => {});
  }, []);

  const createRoom = useCallback((name) => {
    axios.post('/api/lighting/rooms', { name }).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  const renameRoom = useCallback((oldName, newName) => {
    axios.patch(`/api/lighting/rooms/${encodeURIComponent(oldName)}`, { newName }).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  const deleteRoom = useCallback((name) => {
    axios.delete(`/api/lighting/rooms/${encodeURIComponent(name)}`).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  const assignDevice = useCallback((deviceName, roomName) => {
    axios.post('/api/lighting/rooms/assign', { device: deviceName, room: roomName ?? null }).then(refetchRooms).catch(console.warn);
  }, [refetchRooms]);

  // ── Override ─────────────────────────────────────────────────────────────

  const clearRoomOverride = useCallback((roomName) => {
    axios.delete(`/api/lighting/rooms/${encodeURIComponent(roomName)}/override`).catch(console.warn);
  }, []);

  // ── Presets ──────────────────────────────────────────────────────────────

  const applyPreset = useCallback((preset) => {
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
