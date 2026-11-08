import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { PencilIcon, TrashIcon, CheckIcon } from '../icons';
import type { RoomsMap, PresenceEntry, SensorsMap, DeviceEntry } from '../../types';
import { useLighting } from '../../hooks/useLighting';
import PhoneSection from './PhoneSection';
import styles from './DevicesView.module.css';

const SCAN_DURATION = 254;

/** Room id a bulb (by IEEE address) is in */
function getRoomForDevice(id: string, rooms: RoomsMap): string | null {
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.devices.includes(id)) return roomId;
  }
  return null;
}

export default function DevicesView() {
  const { devicesState: devState, rooms, createRoom, renameRoom, deleteRoom, assignDevice } = useLighting();
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

  const openPresenceConfig = (sensorId: string) => {
    const existing = presence.find((p) => p.sensor === sensorId);
    setPresenceForm({
      room:                     existing?.room ?? Object.keys(rooms)[0] ?? '',
      vacantAfterMinutes:       existing?.vacantAfterMinutes ?? 5,
      manualOffCooldownMinutes: existing?.manualOffCooldownMinutes ?? 120,
      enabled:                  existing?.enabled ?? true,
    });
    setPresenceSheetFor(sensorId);
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

  const removePresence = async (sensorId: string) => {
    await axios.delete(`/api/lighting/presence/${encodeURIComponent(sensorId)}`).catch(console.warn);
    refetchPresence();
  };

  const sensorSetTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Debounced for sliders (numeric), immediate for discrete picks (enum) — same 220ms
  // pattern used by the lighting sliders elsewhere in this app.
  const setSensorProperty = (sensorId: string, property: string, value: number | string, debounceMs = 0) => {
    setSensors((prev) => ({
      ...prev,
      [sensorId]: { ...(prev[sensorId] ?? { label: sensorId, occupancy: null }), [property]: value },
    }));
    const key = `${sensorId}|${property}`;
    clearTimeout(sensorSetTimers.current[key]);
    sensorSetTimers.current[key] = setTimeout(() => {
      axios.post(`/api/lighting/sensors/${encodeURIComponent(sensorId)}/set`, { [property]: value }).catch(console.warn);
    }, debounceMs);
  };

  const toggleScan   = () => axios.post('/api/lighting/pair', { enable: !devState.pairing }).catch(console.warn);
  const startEdit    = (d: DeviceEntry) => { setEditingId(d.ieee_address); setDraftName(d.friendly_name); };

  // Removal unpairs the bulb from Zigbee — first tap arms it, a second within 3s confirms
  const [armedRemove, setArmedRemove] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(armTimer.current ?? undefined), []);
  const removeDevice = (id: string) => {
    clearTimeout(armTimer.current ?? undefined);
    if (armedRemove !== id) {
      setArmedRemove(id);
      armTimer.current = setTimeout(() => setArmedRemove(null), 3000);
      return;
    }
    setArmedRemove(null);
    axios.post('/api/lighting/devices/remove', { id }).catch(console.warn);
  };

  const submitRename = (oldName: string) => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName)
      axios.post('/api/lighting/devices/rename', { from: oldName, to: trimmed }).catch(console.warn);
    setEditingId(null);
  };

  const submitAddRoom = () => {
    const name = newRoomName.trim();
    if (name) createRoom(name);
    setAddingRoom(false);
    setNewRoomName('');
  };

  const submitRenameRoom = (roomId: string) => {
    const name = draftRoomName.trim();
    if (name && name !== rooms[roomId]?.name) renameRoom(roomId, name);
    setEditingRoom(null);
  };

  const toggleDeviceInRoom = (deviceId: string, roomId: string) => {
    const currentRoom = getRoomForDevice(deviceId, rooms);
    // If already in this room, remove (unassign); otherwise assign to this room
    assignDevice(deviceId, currentRoom === roomId ? null : roomId);
  };
  const roomName = (roomId: string | null) => (roomId && rooms[roomId]?.name) || null;

  const fmt     = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const visible = devState.devices.filter((d) => d.type !== 'Coordinator');

  return (
    <div className={styles.root}>

      {/* ── Room Management ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionTitle}>Rooms</span>
          <button
            onClick={() => { setAddingRoom(true); setNewRoomName(''); }}
            className={styles.textButton}
          >
            + Add Room
          </button>
        </div>

        {Object.keys(rooms).length === 0 && !addingRoom ? (
          <p className={styles.emptyNote}>No rooms yet — create one to group your lights</p>
        ) : (
          <div className={styles.roomList}>
            {Object.entries(rooms).map(([roomId, room]) => (
              <div key={roomId} className={styles.roomRow}>
                {editingRoom === roomId ? (
                  <input
                    autoFocus
                    value={draftRoomName}
                    onChange={(e) => setDraftRoomName(e.target.value)}
                    onBlur={() => submitRenameRoom(roomId)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitRenameRoom(roomId);
                      if (e.key === 'Escape') setEditingRoom(null);
                    }}
                    className={styles.roomRenameInput}
                  />
                ) : (
                  <>
                    <span className={styles.roomName}>{room.name}</span>
                    <span className={styles.roomCount}>{room.devices.length} lights</span>
                  </>
                )}
                {/* Add devices to room */}
                <button
                  onClick={() => setPickerRoom(roomId)}
                  className={styles.roomAddDevices}
                  title="Add devices"
                >
                  +
                </button>
                <button
                  onClick={() => { setEditingRoom(roomId); setDraftRoomName(room.name); }}
                  className={styles.roomRename}
                >
                  <PencilIcon />
                </button>
                <button
                  onClick={() => deleteRoom(roomId)}
                  className={styles.roomDelete}
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
                className={styles.newRoomInput}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Your phone (home / away) ── */}
      <PhoneSection />

      {/* ── Devices ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.bridgeStatus}>
            <span className={`${styles.statusDot} ${devState.bridgeOnline ? styles.statusDotOnline : styles.statusDotOffline}`} />
            <span className={styles.bridgeLabel}>
              {devState.bridgeOnline
                ? `${visible.length} device${visible.length !== 1 ? 's' : ''}`
                : 'Bridge offline'}
            </span>
          </div>
          <button
            onClick={toggleScan}
            disabled={!devState.bridgeOnline}
            className={`${styles.scanButton} ${
              devState.pairing
                ? styles.scanning
                : styles.scanIdle
            }`}
          >
            {devState.pairing && <span className={styles.scanDot} />}
            {devState.pairing ? `Stop  ${fmt(countdown)}` : 'Scan'}
          </button>
        </div>

        {devState.pairing && (
          <p className={styles.pairHint}>Power-cycle your bulb to pair it</p>
        )}

        {visible.length === 0 ? (
          <p className={styles.emptyDevices}>No devices paired</p>
        ) : (
          <div className={styles.deviceList}>
            {visible.map((d) => {
              const isNew      = newDeviceIds.has(d.ieee_address);
              const avail      = devState.availability ?? {};
              const knowsAvail = d.ieee_address in avail;
              const isOffline  = avail[d.ieee_address] === false;
              const deviceRoom = roomName(getRoomForDevice(d.ieee_address, rooms));

              return (
                <div
                  key={d.ieee_address}
                  className={`${styles.deviceCard} ${
                    isNew ? styles.deviceCardNew : styles.deviceCardIdle
                  }`}
                >
                  <div className={styles.deviceInfo}>
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
                        className={styles.deviceRenameInput}
                      />
                    ) : (
                      <div className={styles.deviceNameRow}>
                        {knowsAvail && (
                          <span className={`${styles.availDot} ${isOffline ? styles.availDotOffline : styles.availDotOnline}`} />
                        )}
                        <span className={`${styles.deviceName} ${isOffline ? styles.deviceNameOffline : styles.deviceNameOnline}`}>{d.friendly_name}</span>
                        {isNew && <span className={styles.newTag}>New</span>}
                        {isOffline && <span className={styles.offlineTag}>Offline</span>}
                      </div>
                    )}
                    <div className={styles.deviceMeta}>
                      <span className={styles.deviceType}>
                        {d.definition?.description ?? (d.type === 'Router' ? 'Router' : 'Device')}
                      </span>
                      {deviceRoom && (
                        <span className={styles.deviceRoom}>· {deviceRoom}</span>
                      )}
                    </div>
                    {d.ieee_address in sensors && (() => {
                      const occ   = sensors[d.ieee_address]?.occupancy ?? null;
                      const entry = presence.find((p) => p.sensor === d.ieee_address);
                      return (
                        <div className={styles.presenceRow}>
                          <span className={`${styles.presenceDot} ${occ ? styles.presenceDotOccupied : styles.presenceDotIdle}`} />
                          <span className={styles.presenceLabel}>
                            {occ === null ? 'Presence unknown' : occ ? 'Occupied' : 'Vacant'}
                          </span>
                          {entry && (
                            <span className={styles.presenceEntry}>
                              · {roomName(entry.room) ?? 'Missing room'} · {entry.vacantAfterMinutes}m off / {(entry.manualOffCooldownMinutes / 60).toFixed(1)}h cooldown{!entry.enabled ? ' · disabled' : ''}
                            </span>
                          )}
                          <button
                            onClick={() => openPresenceConfig(d.ieee_address)}
                            className={styles.presenceSetup}
                          >
                            {entry ? 'Edit' : 'Set up as trigger'}
                          </button>
                        </div>
                      );
                    })()}
                  </div>
                  <button onClick={() => startEdit(d)} className={styles.deviceEdit}>
                    <PencilIcon />
                  </button>
                  <button
                    onClick={() => removeDevice(d.ieee_address)}
                    className={`${styles.deviceRemove} ${armedRemove === d.ieee_address ? styles.deviceRemoveArmed : ''}`}
                  >
                    {armedRemove === d.ieee_address ? 'Remove?' : <TrashIcon />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Room device picker ── */}
      {pickerRoom && (
        <div className={styles.sheetBackdrop} onClick={() => setPickerRoom(null)} data-no-swipe>
          <div className={styles.pickerSheet} onClick={(e) => e.stopPropagation()}>
            <p className={styles.sheetTitle}>{roomName(pickerRoom)}</p>
            <p className={styles.sheetHint}>Tap a device to add or remove it from this room</p>
            <div className={styles.pickerList}>
              {visible.length === 0 ? (
                <p className={styles.pickerEmpty}>No devices paired</p>
              ) : visible.map((d) => {
                const inThisRoom = (rooms[pickerRoom]?.devices ?? []).includes(d.ieee_address);
                const otherRoom  = !inThisRoom ? roomName(getRoomForDevice(d.ieee_address, rooms)) : null;
                return (
                  <button
                    key={d.ieee_address}
                    onClick={() => toggleDeviceInRoom(d.ieee_address, pickerRoom)}
                    className={styles.pickerItem}
                  >
                    <div className={styles.pickerItemText}>
                      <span className={`${styles.pickerItemName} ${inThisRoom ? styles.pickerItemNameIn : styles.pickerItemNameOut}`}>{d.friendly_name}</span>
                      {otherRoom && (
                        <span className={styles.pickerItemRoom}>Currently in {otherRoom}</span>
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
        <div className={styles.sheetBackdrop} onClick={() => setPresenceSheetFor(null)} data-no-swipe>
          <div
            className={styles.presenceSheet}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetHeader}>
              <span className={styles.presenceSheetTitle}>Presence Trigger</span>
              <button onClick={() => setPresenceSheetFor(null)} className={styles.sheetClose}>✕</button>
            </div>
            <p className={styles.presenceSheetSubtitle}>{sensors[presenceSheetFor]?.label ?? presenceSheetFor}</p>

            {/* Room */}
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Room</label>
              {Object.keys(rooms).length === 0 ? (
                <p className={styles.fieldEmpty}>No rooms yet — create one above first.</p>
              ) : (
                <div className={styles.chips}>
                  {Object.entries(rooms).map(([r, room]) => (
                    <button
                      key={r}
                      onClick={() => setPresenceForm((f) => ({ ...f, room: r }))}
                      className={`${styles.chip} ${
                        presenceForm.room === r
                          ? styles.chipSelected
                          : styles.chipIdle
                      }`}
                    >
                      {room.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Vacancy timeout */}
            <div className={styles.sliderField}>
              <div className={styles.fieldHeader}>
                <label className={styles.fieldLabel}>Turn off after vacant</label>
                <span className={styles.fieldValue}>{presenceForm.vacantAfterMinutes} min</span>
              </div>
              <input
                type="range" min="1" max="60"
                value={presenceForm.vacantAfterMinutes}
                onChange={(e) => setPresenceForm((f) => ({ ...f, vacantAfterMinutes: Number(e.target.value) }))}
                className={styles.rangeInput}
              />
            </div>

            {/* Manual-off cooldown */}
            <div className={styles.sliderField}>
              <div className={styles.fieldHeader}>
                <label className={styles.fieldLabel}>Manual-off cooldown</label>
                <span className={styles.fieldValue}>{(presenceForm.manualOffCooldownMinutes / 60).toFixed(1)} hr</span>
              </div>
              <input
                type="range" min="5" max="480" step="5"
                value={presenceForm.manualOffCooldownMinutes}
                onChange={(e) => setPresenceForm((f) => ({ ...f, manualOffCooldownMinutes: Number(e.target.value) }))}
                className={styles.rangeInput}
              />
            </div>

            {/* Enabled toggle */}
            <div className={styles.fieldHeader}>
              <label className={styles.fieldLabel}>Enabled</label>
              <button
                onClick={() => setPresenceForm((f) => ({ ...f, enabled: !f.enabled }))}
                className={`${styles.switch} ${
                  presenceForm.enabled ? styles.switchOn : styles.switchOff
                }`}
              >
                <span
                  className={`${styles.switchKnob} ${
                    presenceForm.enabled ? styles.switchKnobOn : styles.switchKnobOff
                  }`}
                />
              </button>
            </div>

            {/* Sensor settings — built from whatever this device actually reports as settable
                (e.g. radar sensitivity, detection distance), instead of hardcoding property names. */}
            {(() => {
              const device = devState.devices.find((d) => d.ieee_address === presenceSheetFor);
              const settable = (device?.definition?.exposes || []).filter((e) => (e.access & 2) !== 0);
              if (!settable.length) return null;
              const current: Record<string, unknown> = sensors[presenceSheetFor] ?? {};
              return (
                <div className={styles.sensorSettings}>
                  <label className={styles.fieldLabel}>Sensor Settings</label>
                  {settable.map((e) => {
                    const value = current[e.property];
                    if (e.type === 'numeric') {
                      const min  = e.value_min ?? 0;
                      const max  = e.value_max ?? 100;
                      const step = e.value_step ?? 1;
                      const num  = typeof value === 'number' ? value : min;
                      return (
                        <div key={e.property} className={styles.sliderField}>
                          <div className={styles.fieldHeader}>
                            <span className={styles.settingLabel}>{e.description || e.name}</span>
                            <span className={styles.fieldValue}>{num}{e.unit ? ` ${e.unit}` : ''}</span>
                          </div>
                          <input
                            type="range" min={min} max={max} step={step}
                            value={num}
                            onChange={(ev) => setSensorProperty(presenceSheetFor, e.property, Number(ev.target.value), 300)}
                            className={styles.rangeInput}
                          />
                        </div>
                      );
                    }
                    if (e.type === 'enum' && e.values) {
                      return (
                        <div key={e.property} className={styles.field}>
                          <span className={styles.settingLabel}>{e.description || e.name}</span>
                          <div className={styles.chips}>
                            {e.values.map((v) => (
                              <button
                                key={String(v)}
                                onClick={() => setSensorProperty(presenceSheetFor, e.property, v)}
                                className={`${styles.chip} ${
                                  value === v
                                    ? styles.chipSelected
                                    : styles.chipIdle
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

            <div className={styles.sheetActions}>
              {presence.some((p) => p.sensor === presenceSheetFor) && (
                <button
                  onClick={() => { removePresence(presenceSheetFor); setPresenceSheetFor(null); }}
                  className={styles.removeTrigger}
                >
                  Remove
                </button>
              )}
              <button
                onClick={savePresence}
                disabled={!presenceForm.room}
                className={styles.saveTrigger}
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
