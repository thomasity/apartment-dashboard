import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { PencilIcon, TrashIcon, CheckIcon } from '../icons';

const SCAN_DURATION = 254;

function getRoomForDevice(name, rooms) {
  for (const [room, devices] of Object.entries(rooms)) {
    if (devices.includes(name)) return room;
  }
  return null;
}

export default function DevicesView({ socket, devState, setDevState, rooms, onCreateRoom, onRenameRoom, onDeleteRoom, onAssignDevice }) {
  // Scan state
  const [editingId, setEditingId]       = useState(null);
  const [draftName, setDraftName]       = useState('');
  const [countdown, setCountdown]       = useState(0);
  const [newDeviceIds, setNewDeviceIds] = useState(new Set());
  const prevPairing    = useRef(false);
  const scanStartIds   = useRef(null);
  const countdownTimer = useRef(null);
  const scanStartTime  = useRef(null);

  // Room management state
  const [editingRoom, setEditingRoom]     = useState(null);
  const [draftRoomName, setDraftRoomName] = useState('');
  const [addingRoom, setAddingRoom]       = useState(false);
  const [newRoomName, setNewRoomName]     = useState('');

  // Room device-picker state — which room's '+' was tapped
  const [pickerRoom, setPickerRoom] = useState(null);

  useEffect(() => {
    if (devState.pairing && !prevPairing.current) {
      scanStartIds.current  = new Set(devState.devices.map((d) => d.ieee_address));
      scanStartTime.current = Date.now();
      setCountdown(SCAN_DURATION);
      countdownTimer.current = setInterval(() => {
        const remaining = Math.max(0, SCAN_DURATION - Math.floor((Date.now() - scanStartTime.current) / 1000));
        setCountdown(remaining);
        if (remaining === 0) clearInterval(countdownTimer.current);
      }, 1000);
    } else if (!devState.pairing && prevPairing.current) {
      clearInterval(countdownTimer.current);
      scanStartIds.current  = null;
      scanStartTime.current = null;
      setCountdown(0);
      setNewDeviceIds(new Set());
    }
    prevPairing.current = devState.pairing;
    return () => clearInterval(countdownTimer.current);
  }, [devState.pairing]);

  useEffect(() => {
    if (!scanStartIds.current) return;
    const joined = devState.devices
      .filter((d) => d.type !== 'Coordinator' && !scanStartIds.current.has(d.ieee_address))
      .map((d) => d.ieee_address);
    if (joined.length) setNewDeviceIds(new Set(joined));
  }, [devState.devices]);

  const toggleScan   = () => axios.post('/api/lighting/pair', { enable: !devState.pairing }).catch(console.warn);
  const startEdit    = (d) => { setEditingId(d.ieee_address); setDraftName(d.friendly_name); };
  const removeDevice = (id) => axios.post('/api/lighting/devices/remove', { id }).catch(console.warn);

  const submitRename = (oldName) => {
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

  const submitRenameRoom = (oldName) => {
    const name = draftRoomName.trim();
    if (name && name !== oldName) onRenameRoom(oldName, name);
    setEditingRoom(null);
  };

  const toggleDeviceInRoom = (deviceName, roomName) => {
    const currentRoom = getRoomForDevice(deviceName, rooms);
    // If already in this room, remove (unassign); otherwise assign to this room
    onAssignDevice(deviceName, currentRoom === roomName ? null : roomName);
  };

  const fmt     = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
    </div>
  );
}
