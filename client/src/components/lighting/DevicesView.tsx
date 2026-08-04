import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { PencilIcon, TrashIcon, CheckIcon } from '../icons';
import type { Socket } from 'socket.io-client';
import type { RoomsMap, PresenceEntry, SensorsMap, DeviceExpose } from '../../types';

const SCAN_DURATION = 254;

interface DeviceEntry {
  ieee_address: string;
  friendly_name: string;
  type: string;
  definition?: { description?: string; exposes?: DeviceExpose[] };
}

interface DevicesState {
  bridgeOnline: boolean;
  devices: DeviceEntry[];
  pairing: boolean;
  availability?: Record<string, boolean>;
}

function getRoomForDevice(name: string, rooms: RoomsMap): string | null {
  for (const [room, devices] of Object.entries(rooms)) {
    if (devices.includes(name)) return room;
  }
  return null;
}

interface Props {
  socket: Socket | null;
  devState: DevicesState;
  setDevState: React.Dispatch<React.SetStateAction<DevicesState>>;
  rooms: RoomsMap;
  onCreateRoom: (name: string) => void;
  onRenameRoom: (oldName: string, newName: string) => void;
  onDeleteRoom: (name: string) => void;
  onAssignDevice: (deviceName: string, roomName: string | null) => void;
}

export default function DevicesView({ socket, devState, setDevState, rooms, onCreateRoom, onRenameRoom, onDeleteRoom, onAssignDevice }: Props) {
  // Scan state
  const [editingId, setEditingId]       = useState<string | null>(null);
  const [draftName, setDraftName]       = useState('');
  const [countdown, setCountdown]       = useState(0);
  const [newDeviceIds, setNewDeviceIds] = useState<Set<string>>(new Set());
  const prevPairing    = useRef(false);
  const scanStartIds   = useRef<Set<string> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const scanStartTime  = useRef<number | null>(null);

  // Room management state
  const [editingRoom, setEditingRoom]     = useState<string | null>(null);
  const [draftRoomName, setDraftRoomName] = useState('');
  const [addingRoom, setAddingRoom]       = useState(false);
  const [newRoomName, setNewRoomName]     = useState('');

  // Room device-picker state — which room's '+' was tapped
  const [pickerRoom, setPickerRoom] = useState<string | null>(null);

  // Presence trigger state
  const [sensors,          setSensors]          = useState<SensorsMap>({});
  const [presence,         setPresence]         = useState<PresenceEntry[]>([]);
  const [presenceSheetFor, setPresenceSheetFor] = useState<string | null>(null);
  const [presenceForm,     setPresenceForm]     = useState({
    room: '', vacantAfterMinutes: 5, manualOffCooldownMinutes: 120, enabled: true,
  });

  useEffect(() => {
    if (devState.pairing && !prevPairing.current) {
      scanStartIds.current  = new Set(devState.devices.map((d) => d.ieee_address));
      scanStartTime.current = Date.now();
      setCountdown(SCAN_DURATION);
      countdownTimer.current = setInterval(() => {
        const remaining = Math.max(0, SCAN_DURATION - Math.floor((Date.now() - (scanStartTime.current ?? Date.now())) / 1000));
        setCountdown(remaining);
        if (remaining === 0) clearInterval(countdownTimer.current ?? undefined);
      }, 1000);
    } else if (!devState.pairing && prevPairing.current) {
      clearInterval(countdownTimer.current ?? undefined);
      scanStartIds.current  = null;
      scanStartTime.current = null;
      setCountdown(0);
      setNewDeviceIds(new Set());
    }
    prevPairing.current = devState.pairing;
    return () => clearInterval(countdownTimer.current ?? undefined);
  }, [devState.pairing]);

  useEffect(() => {
    if (!scanStartIds.current) return;
    const joined = devState.devices
      .filter((d) => d.type !== 'Coordinator' && !scanStartIds.current!.has(d.ieee_address))
      .map((d) => d.ieee_address);
    if (joined.length) setNewDeviceIds(new Set(joined));
  }, [devState.devices]);

  const refetchPresence = () => {
    axios.get('/api/lighting/sensors').then((r) => setSensors(r.data)).catch(() => {});
    axios.get('/api/lighting/presence').then((r) => setPresence(r.data)).catch(() => {});
  };

  useEffect(() => {
    refetchPresence();
    const interval = setInterval(refetchPresence, 4000); // live-ish occupancy while tuning
    return () => clearInterval(interval);
  }, []);

  const openPresenceConfig = (sensorName: string) => {
    const existing = presence.find((p) => p.sensor === sensorName);
    setPresenceForm({
      room:                     existing?.room ?? Object.keys(rooms)[0] ?? '',
      vacantAfterMinutes:       existing?.vacantAfterMinutes ?? 5,
      manualOffCooldownMinutes: existing?.manualOffCooldownMinutes ?? 120,
      enabled:                  existing?.enabled ?? true,
    });
    setPresenceSheetFor(sensorName);
  };

  const savePresence = async () => {
    if (!presenceSheetFor || !presenceForm.room) return;
    const existing = presence.find((p) => p.sensor === presenceSheetFor);
    if (existing) {
      await axios.patch(`/api/lighting/presence/${encodeURIComponent(presenceSheetFor)}`, presenceForm).catch(console.warn);
    } else {
      await axios.post('/api/lighting/presence', { sensor: presenceSheetFor, ...presenceForm }).catch(console.warn);
    }
    refetchPresence();
    setPresenceSheetFor(null);
  };

  const removePresence = async (sensorName: string) => {
    await axios.delete(`/api/lighting/presence/${encodeURIComponent(sensorName)}`).catch(console.warn);
    refetchPresence();
  };

  const sensorSetTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Debounced for sliders (numeric), immediate for discrete picks (enum) — same 220ms
  // pattern used by the lighting sliders elsewhere in this app.
  const setSensorProperty = (sensorName: string, property: string, value: number | string, debounceMs = 0) => {
    setSensors((prev) => ({
      ...prev,
      [sensorName]: { ...(prev[sensorName] ?? { label: sensorName, occupancy: null }), [property]: value },
    }));
    const key = `${sensorName}|${property}`;
    clearTimeout(sensorSetTimers.current[key]);
    sensorSetTimers.current[key] = setTimeout(() => {
      axios.post(`/api/lighting/sensors/${encodeURIComponent(sensorName)}/set`, { [property]: value }).catch(console.warn);
    }, debounceMs);
  };

  const toggleScan   = () => axios.post('/api/lighting/pair', { enable: !devState.pairing }).catch(console.warn);
  const startEdit    = (d: DeviceEntry) => { setEditingId(d.ieee_address); setDraftName(d.friendly_name); };
  const removeDevice = (id: string) => axios.post('/api/lighting/devices/remove', { id }).catch(console.warn);

  const submitRename = (oldName: string) => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName)
      axios.post('/api/lighting/devices/rename', { from: oldName, to: trimmed }).catch(console.warn);
    setEditingId(null);
  };

  const submitAddRoom = () => {
    const name = newRoomName.trim();
    if (name) onCreateRoom(name);
    setAddingRoom(false);
    setNewRoomName('');
  };

  const submitRenameRoom = (oldName: string) => {
    const name = draftRoomName.trim();
    if (name && name !== oldName) onRenameRoom(oldName, name);
    setEditingRoom(null);
  };

  const toggleDeviceInRoom = (deviceName: string, roomName: string) => {
    const currentRoom = getRoomForDevice(deviceName, rooms);
    // If already in this room, remove (unassign); otherwise assign to this room
    onAssignDevice(deviceName, currentRoom === roomName ? null : roomName);
  };

  const fmt     = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const visible = devState.devices.filter((d) => d.type !== 'Coordinator');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-8 py-6 gap-6 relative">

      {/* ── Room Management ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-widest text-white/30 font-medium">Rooms</span>
          <button
            onClick={() => { setAddingRoom(true); setNewRoomName(''); }}
            className="text-xs text-white/30 hover:text-white/60 touch-manipulation transition-colors"
          >
            + Add Room
          </button>
        </div>

        {Object.keys(rooms).length === 0 && !addingRoom ? (
          <p className="text-[11px] text-white/15 italic">No rooms yet — create one to group your lights</p>
        ) : (
          <div className="flex flex-col gap-1">
            {Object.keys(rooms).map((name) => (
              <div key={name} className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/[0.04]">
                {editingRoom === name ? (
                  <input
                    autoFocus
                    value={draftRoomName}
                    onChange={(e) => setDraftRoomName(e.target.value)}
                    onBlur={() => submitRenameRoom(name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRenameRoom(name);
                      if (e.key === 'Escape') setEditingRoom(null);
                    }}
                    className="flex-1 bg-white/[0.08] text-white/80 text-sm rounded px-2 py-0.5 outline-none ring-1 ring-strong"
                  />
                ) : (
                  <>
                    <span className="flex-1 text-sm text-white/60">{name}</span>
                    <span className="text-[10px] text-white/20">{(rooms[name] ?? []).length} lights</span>
                  </>
                )}
                {/* Add devices to room */}
                <button
                  onClick={() => setPickerRoom(name)}
                  className="p-1.5 text-white/25 hover:text-white/60 touch-manipulation transition-colors text-base leading-none"
                  title="Add devices"
                >
                  +
                </button>
                <button
                  onClick={() => { setEditingRoom(name); setDraftRoomName(name); }}
                  className="p-1.5 text-white/20 hover:text-white/50 touch-manipulation transition-colors"
                >
                  <PencilIcon />
                </button>
                <button
                  onClick={() => onDeleteRoom(name)}
                  className="p-1.5 text-white/20 hover:text-danger/60 touch-manipulation transition-colors"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}

            {addingRoom && (
              <input
                autoFocus
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                onBlur={submitAddRoom}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitAddRoom();
                  if (e.key === 'Escape') setAddingRoom(false);
                }}
                placeholder="Room name…"
                className="px-3 py-2 bg-white/[0.06] text-white/80 placeholder-white/20 text-sm rounded-lg outline-none ring-1 ring-strong"
              />
            )}
          </div>
        )}
      </div>

      {/* ── Devices ── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${devState.bridgeOnline ? 'bg-online' : 'bg-white/20'}`} />
            <span className="text-[11px] uppercase tracking-widest text-white/40">
              {devState.bridgeOnline
                ? `${visible.length} device${visible.length !== 1 ? 's' : ''}`
                : 'Bridge offline'}
            </span>
          </div>
          <button
            onClick={toggleScan}
            disabled={!devState.bridgeOnline}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-widest transition-colors touch-manipulation ${
              devState.pairing
                ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.10] disabled:opacity-30'
            }`}
          >
            {devState.pairing && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />}
            {devState.pairing ? `Stop  ${fmt(countdown)}` : 'Scan'}
          </button>
        </div>

        {devState.pairing && (
          <p className="text-center text-[11px] text-white/25">Power-cycle your bulb to pair it</p>
        )}

        {visible.length === 0 ? (
          <p className="text-center text-[11px] text-white/20 uppercase tracking-widest pt-4">No devices paired</p>
        ) : (
          <div className="flex flex-col gap-2">
            {visible.map((d) => {
              const isNew      = newDeviceIds.has(d.ieee_address);
              const avail      = devState.availability ?? {};
              const knowsAvail = d.friendly_name in avail;
              const isOffline  = avail[d.friendly_name] === false;
              const deviceRoom = getRoomForDevice(d.friendly_name, rooms);

              return (
                <div
                  key={d.ieee_address}
                  className={`flex items-center gap-3 px-4 py-3 rounded-card transition-colors ${
                    isNew ? 'bg-accent/10 ring-1 ring-accent/20' : 'bg-white/[0.04]'
                  }`}
                >
                  <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                    {editingId === d.ieee_address ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => submitRename(d.friendly_name)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter')  submitRename(d.friendly_name);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="bg-white/[0.08] text-white/80 text-sm rounded-lg px-2 py-0.5 outline-none ring-1 ring-strong w-full"
                      />
                    ) : (
                      <div className="flex items-center gap-2">
                        {knowsAvail && (
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOffline ? 'bg-danger/60' : 'bg-online/60'}`} />
                        )}
                        <span className={`text-sm truncate ${isOffline ? 'text-white/30' : 'text-white/70'}`}>{d.friendly_name}</span>
                        {isNew && <span className="text-[10px] text-accent uppercase tracking-wider">New</span>}
                        {isOffline && <span className="text-[10px] text-white/25 uppercase tracking-wider">Offline</span>}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-white/20">
                        {d.definition?.description ?? (d.type === 'Router' ? 'Router' : 'Device')}
                      </span>
                      {deviceRoom && (
                        <span className="text-[10px] text-white/25">· {deviceRoom}</span>
                      )}
                    </div>
                    {d.friendly_name in sensors && (() => {
                      const occ   = sensors[d.friendly_name]?.occupancy ?? null;
                      const entry = presence.find((p) => p.sensor === d.friendly_name);
                      return (
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${occ ? 'bg-online' : 'bg-white/20'}`} />
                          <span className="text-[10px] text-white/25">
                            {occ === null ? 'Presence unknown' : occ ? 'Occupied' : 'Vacant'}
                          </span>
                          {entry && (
                            <span className="text-[10px] text-white/20">
                              · {entry.room} · {entry.vacantAfterMinutes}m off / {(entry.manualOffCooldownMinutes / 60).toFixed(1)}h cooldown{!entry.enabled ? ' · disabled' : ''}
                            </span>
                          )}
                          <button
                            onClick={() => openPresenceConfig(d.friendly_name)}
                            className="text-[10px] text-accent/70 hover:text-accent touch-manipulation transition-colors"
                          >
                            {entry ? 'Edit' : 'Set up as trigger'}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  <button onClick={() => startEdit(d)} className="p-2 text-white/20 hover:text-white/50 touch-manipulation transition-colors">
                    <PencilIcon />
                  </button>
                  <button onClick={() => removeDevice(d.friendly_name)} className="p-2 text-white/20 hover:text-danger/60 touch-manipulation transition-colors">
                    <TrashIcon />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Room device picker ── */}
      {pickerRoom && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={() => setPickerRoom(null)}>
          <div className="bg-zinc-900 border-t border-white/10 px-4 pt-4 pb-6 rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium text-white/60 mb-1">{pickerRoom}</p>
            <p className="text-[11px] text-white/25 mb-4">Tap a device to add or remove it from this room</p>
            <div className="flex flex-col gap-1">
              {visible.length === 0 ? (
                <p className="text-center text-white/20 text-xs py-4">No devices paired</p>
              ) : visible.map((d) => {
                const inThisRoom = (rooms[pickerRoom] ?? []).includes(d.friendly_name);
                const otherRoom  = !inThisRoom ? getRoomForDevice(d.friendly_name, rooms) : null;
                return (
                  <button
                    key={d.ieee_address}
                    onClick={() => toggleDeviceInRoom(d.friendly_name, pickerRoom)}
                    className="flex items-center justify-between px-3 py-3 rounded-lg hover:bg-white/[0.06] touch-manipulation transition-colors"
                  >
                    <div className="flex flex-col items-start gap-0.5">
                      <span className={`text-sm ${inThisRoom ? 'text-white/80' : 'text-white/45'}`}>{d.friendly_name}</span>
                      {otherRoom && (
                        <span className="text-[10px] text-white/25">Currently in {otherRoom}</span>
                      )}
                    </div>
                    {inThisRoom && <CheckIcon size={16} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Presence trigger config ── */}
      {presenceSheetFor && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={() => setPresenceSheetFor(null)}>
          <div
            className="bg-zinc-900 border-t border-white/10 px-5 pt-5 pb-8 rounded-t-2xl flex flex-col gap-5 max-h-[85%] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white/60">Presence Trigger</span>
              <button onClick={() => setPresenceSheetFor(null)} className="text-white/30 hover:text-white/60 text-xl leading-none touch-manipulation">✕</button>
            </div>
            <p className="text-[11px] text-white/25 -mt-3">{presenceSheetFor}</p>

            {/* Room */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-widest text-white/30">Room</label>
              {Object.keys(rooms).length === 0 ? (
                <p className="text-[11px] text-white/20 italic">No rooms yet — create one above first.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {Object.keys(rooms).map((r) => (
                    <button
                      key={r}
                      onClick={() => setPresenceForm((f) => ({ ...f, room: r }))}
                      className={`px-3 py-1.5 rounded-full text-xs touch-manipulation transition-colors ${
                        presenceForm.room === r
                          ? 'bg-white/[0.15] text-white/80'
                          : 'bg-white/[0.05] text-white/35 hover:bg-white/[0.10]'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Vacancy timeout */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest text-white/30">Turn off after vacant</label>
                <span className="text-[10px] text-white/40">{presenceForm.vacantAfterMinutes} min</span>
              </div>
              <input
                type="range" min="1" max="60"
                value={presenceForm.vacantAfterMinutes}
                onChange={(e) => setPresenceForm((f) => ({ ...f, vacantAfterMinutes: Number(e.target.value) }))}
                className="w-full accent-white/60"
              />
            </div>

            {/* Manual-off cooldown */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[10px] uppercase tracking-widest text-white/30">Manual-off cooldown</label>
                <span className="text-[10px] text-white/40">{(presenceForm.manualOffCooldownMinutes / 60).toFixed(1)} hr</span>
              </div>
              <input
                type="range" min="5" max="480" step="5"
                value={presenceForm.manualOffCooldownMinutes}
                onChange={(e) => setPresenceForm((f) => ({ ...f, manualOffCooldownMinutes: Number(e.target.value) }))}
                className="w-full accent-white/60"
              />
            </div>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <label className="text-[10px] uppercase tracking-widest text-white/30">Enabled</label>
              <button
                onClick={() => setPresenceForm((f) => ({ ...f, enabled: !f.enabled }))}
                className={`w-10 h-6 rounded-full relative shrink-0 touch-manipulation transition-colors ${
                  presenceForm.enabled ? 'bg-accent/40' : 'bg-white/[0.10]'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    presenceForm.enabled ? 'left-5' : 'left-1'
                  }`}
                />
              </button>
            </div>

            {/* Sensor settings — built from whatever this device actually reports as settable
                (e.g. radar sensitivity, detection distance), instead of hardcoding property names. */}
            {(() => {
              const device = devState.devices.find((d) => d.friendly_name === presenceSheetFor);
              const settable = (device?.definition?.exposes || []).filter((e) => (e.access & 2) !== 0);
              if (!settable.length) return null;
              const current = sensors[presenceSheetFor] ?? {};
              return (
                <div className="flex flex-col gap-4">
                  <label className="text-[10px] uppercase tracking-widest text-white/30">Sensor Settings</label>
                  {settable.map((e) => {
                    const value = current[e.property];
                    if (e.type === 'numeric') {
                      const min  = e.value_min ?? 0;
                      const max  = e.value_max ?? 100;
                      const step = e.value_step ?? 1;
                      const num  = typeof value === 'number' ? value : min;
                      return (
                        <div key={e.property} className="flex flex-col gap-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-white/50">{e.description || e.name}</span>
                            <span className="text-[10px] text-white/40">{num}{e.unit ? ` ${e.unit}` : ''}</span>
                          </div>
                          <input
                            type="range" min={min} max={max} step={step}
                            value={num}
                            onChange={(ev) => setSensorProperty(presenceSheetFor, e.property, Number(ev.target.value), 300)}
                            className="w-full accent-white/60"
                          />
                        </div>
                      );
                    }
                    if (e.type === 'enum' && e.values) {
                      return (
                        <div key={e.property} className="flex flex-col gap-2">
                          <span className="text-xs text-white/50">{e.description || e.name}</span>
                          <div className="flex flex-wrap gap-2">
                            {e.values.map((v) => (
                              <button
                                key={String(v)}
                                onClick={() => setSensorProperty(presenceSheetFor, e.property, v)}
                                className={`px-3 py-1.5 rounded-full text-xs touch-manipulation transition-colors ${
                                  value === v
                                    ? 'bg-white/[0.15] text-white/80'
                                    : 'bg-white/[0.05] text-white/35 hover:bg-white/[0.10]'
                                }`}
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })}
                </div>
              );
            })()}

            <div className="flex gap-3">
              {presence.some((p) => p.sensor === presenceSheetFor) && (
                <button
                  onClick={() => { removePresence(presenceSheetFor); setPresenceSheetFor(null); }}
                  className="px-4 py-3 rounded-xl bg-danger/15 text-danger/70 font-medium text-sm touch-manipulation transition-colors hover:bg-danger/25"
                >
                  Remove
                </button>
              )}
              <button
                onClick={savePresence}
                disabled={!presenceForm.room}
                className="flex-1 py-3 rounded-xl bg-accent/25 text-accent font-semibold text-sm touch-manipulation transition-colors hover:bg-accent/35 disabled:opacity-30 disabled:pointer-events-none"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
