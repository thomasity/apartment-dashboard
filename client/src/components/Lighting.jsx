import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import PRESETS from '../presets.json';
import { PencilIcon, TrashIcon, PowerIcon } from './icons';
import { LightSliders } from './LightSliders';

const SCAN_DURATION = 254;

// ── Zigbee device manager ─────────────────────────────────────────────────────

function DevicesView({ socket, devState, setDevState }) {
  const [editingId, setEditingId]       = useState(null);
  const [draftName, setDraftName]       = useState('');
  const [countdown, setCountdown]       = useState(0);
  const [newDeviceIds, setNewDeviceIds] = useState(new Set());
  const prevPairing    = useRef(false);
  const scanStartIds   = useRef(null);
  const countdownTimer = useRef(null);
  const scanStartTime  = useRef(null);

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
    if (trimmed && trimmed !== oldName) {
      axios.post('/api/lighting/devices/rename', { from: oldName, to: trimmed }).catch(console.warn);
    }
    setEditingId(null);
  };

  const fmt     = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const visible = devState.devices.filter((d) => d.type !== 'Coordinator');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-8 py-6 gap-5">
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
        <p className="text-center text-[11px] text-white/20 uppercase tracking-widest pt-6">No devices paired</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((d) => {
            const isNew = newDeviceIds.has(d.ieee_address);
            return (
              <div
                key={d.ieee_address}
                className={`flex items-center gap-3 px-5 py-4 rounded-card transition-colors ${
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
                      <span className="text-sm text-white/70 truncate">{d.friendly_name}</span>
                      {isNew && <span className="text-[10px] text-accent uppercase tracking-wider">New</span>}
                    </div>
                  )}
                  <span className="text-[10px] text-white/25">
                    {d.definition?.description ?? (d.type === 'Router' ? 'Router' : 'Device')}
                  </span>
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
  );
}

// ── Circadian / Auto controls ─────────────────────────────────────────────────

function AutoToggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-24 h-14 flex flex-col items-center justify-center gap-1 rounded-item text-xs font-medium uppercase tracking-widest transition-colors touch-manipulation ${
        on
          ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
          : 'bg-white/[0.08] text-white/40 hover:text-white/60'
      }`}
    >
      {on && <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
      Auto
    </button>
  );
}

function CircadianStrip({ circadian }) {
  const { brightness, colorTemp, nextChange, timeline } = circadian;
  const tempLabel = colorTemp < 33 ? 'Warm' : colorTemp < 67 ? 'Neutral' : 'Cool';

  const now    = new Date();
  const nowPct = ((now.getHours() * 60 + now.getMinutes()) / (24 * 60)) * 100;

  const nextMs  = nextChange ? Math.max(0, new Date(nextChange).getTime() - Date.now()) : null;
  const nextMin = nextMs !== null ? Math.floor(nextMs / 60000) : null;

  // Interpolates the same 3-stop gradient as slider-colortemp: #ffb300 → #fff4e0 45% → #a8c8ff
  const stops = timeline.length > 0
    ? timeline.map((pt, i) => {
        const pct = ((i / 23) * 100).toFixed(1);
        const t   = pt.colorTemp;
        let r, g, b;
        if (t <= 45) {
          const f = t / 45;
          r = 255;
          g = Math.round(179 + (244 - 179) * f);
          b = Math.round(224 * f);
        } else {
          const f = (t - 45) / 55;
          r = Math.round(255 + (168 - 255) * f);
          g = Math.round(244 + (200 - 244) * f);
          b = Math.round(224 + (255 - 224) * f);
        }
        const a = (0.25 + 0.7 * (pt.brightness / 100)).toFixed(2);
        return `rgba(${r},${g},${b},${a}) ${pct}%`;
      }).join(', ')
    : '#ffb300 0%, #fff4e0 45%, #a8c8ff 100%';

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative h-2 rounded-full overflow-hidden"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      >
        <div
          className="absolute top-0 bottom-0 w-px bg-white/70"
          style={{ left: `${nowPct}%`, boxShadow: '0 0 3px rgba(255,255,255,0.5)' }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[9px] text-white/30">{brightness}% · {tempLabel}</span>
        {nextMin !== null && <span className="text-[9px] text-white/20">~{nextMin}m</span>}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function avg(groups, key) {
  const vals = Object.values(groups);
  if (!vals.length) return 50;
  return Math.round(vals.reduce((s, g) => s + (g[key] ?? 50), 0) / vals.length);
}

function spread(devices, key) {
  const vals = Object.values(devices).map((d) => d[key] ?? 50);
  if (vals.length < 2) return 0;
  return Math.max(...vals) - Math.min(...vals);
}

function tempLabel(ct) {
  return ct < 33 ? 'Warm' : ct < 67 ? 'Neutral' : 'Cool';
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Lighting() {
  const [view, setView]               = useState('controls');
  const [serverState, setServerState] = useState({ connected: false, groups: {} });
  const [devicesState, setDevicesState] = useState({ bridgeOnline: false, devices: [], pairing: false });
  const [localDevices, setLocalDevices] = useState({});
  const [socket, setSocket]           = useState(null);
  const [circadian, setCircadian]     = useState({ enabledGroups: [], brightness: 50, colorTemp: 50, nextChange: null, timeline: [] });
  const timers           = useRef({});
  const lastTouchDevices = useRef({});
  const timersDevices    = useRef({});

  useEffect(() => {
    axios.get('/api/lighting/circadian').then((r) => setCircadian(r.data)).catch(() => {});
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
    s.on('lighting:devices', setDevicesState);
    s.on('lighting:circadian', (data) => setCircadian((prev) => ({ ...prev, ...data })));
    return () => s.disconnect();
  }, []);

  const sendAll = useCallback((payload) => {
    axios.post('/api/lighting/set', { group: 'all', ...payload }).catch(console.warn);
  }, []);

  const handleSlider = (key, value) => {
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
  };

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

  const applyPreset = (preset) => {
    handleSlider('brightness', preset.brightness);
    handleSlider('colorTemp', preset.colorTemp);
  };

  const deviceEntries = Object.entries(serverState.groups);

  const togglePower = useCallback((group) => {
    const poweredOff = serverState.poweredOff ?? [];
    const isOff = group === 'all'
      ? deviceEntries.every(([n]) => poweredOff.includes(n))
      : poweredOff.includes(group);
    axios.post('/api/lighting/power', { group, on: isOff }).catch(console.warn);
  }, [serverState.poweredOff, deviceEntries]);

  const toggleCircadianGroup = useCallback(async (group) => {
    const enabled = group === 'all'
      ? !deviceEntries.every(([n]) => (circadian.enabledGroups ?? []).includes(n))
      : !(circadian.enabledGroups ?? []).includes(group);
    await axios.post('/api/lighting/circadian', { group, enabled }).catch(console.warn);
  }, [circadian.enabledGroups, deviceEntries]);

  const offline         = !serverState.connected;
  const poweredOff      = serverState.poweredOff ?? [];
  const allOff          = deviceEntries.length > 0 && deviceEntries.every(([n]) => poweredOff.includes(n));
  const allBrightness   = avg(localDevices, 'brightness');
  const allColorTemp    = avg(localDevices, 'colorTemp');
  const activePreset    = PRESETS.find((p) => p.brightness === allBrightness && p.colorTemp === allColorTemp);
  const enabledGroups   = circadian.enabledGroups ?? [];
  const allCircadian    = deviceEntries.length > 0 && deviceEntries.every(([n]) => enabledGroups.includes(n));
  const brightnessMixed = deviceEntries.length > 1 && spread(localDevices, 'brightness') > 5;
  const colorTempMixed  = deviceEntries.length > 1 && spread(localDevices, 'colorTemp')  > 5;

  return (
    <div className="h-full flex flex-col overflow-hidden relative">

      {/* Nav pill */}
      <div className="shrink-0 flex justify-center pt-5 pb-2">
        <div className="flex bg-white/[0.06] rounded-full p-1 gap-1">
          {['controls', 'presets', 'devices'].map((v) => (
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

      {view === 'devices' && <DevicesView socket={socket} devState={devicesState} setDevState={setDevicesState} />}

      {view === 'presets' && (
        <div className="flex-1 min-h-0 flex items-center justify-center px-8">
          <div className="w-full grid grid-cols-3 gap-4">
            {PRESETS.map((preset) => {
              const isActive = activePreset?.label === preset.label;
              return (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className={`flex flex-col items-center gap-3 py-8 rounded-card transition-colors touch-manipulation ${
                    isActive ? 'bg-white/[0.12] ring-1 ring-strong' : 'bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.15]'
                  }`}
                >
                  <span className="text-4xl leading-none">{preset.icon}</span>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-sm font-medium text-white/70">{preset.label}</span>
                    <span className="text-[10px] text-white/30">{preset.brightness}% · {tempLabel(preset.colorTemp)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view === 'controls' && (deviceEntries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 pb-8">
          <span className={`w-2 h-2 rounded-full ${offline ? 'bg-white/20' : 'bg-online/40'}`} />
          <p className="text-[11px] uppercase tracking-widest text-white/25 mt-1">
            {offline ? 'Bridge offline' : 'No devices paired'}
          </p>
          {!offline && (
            <>
              <p className="text-white/15 text-xs">Pair a bulb in the Devices tab</p>
              <button
                onClick={() => setView('devices')}
                className="mt-2 px-4 py-1.5 rounded-full bg-white/[0.06] text-white/40 text-[11px] font-medium uppercase tracking-widest touch-manipulation hover:bg-white/[0.10] transition-colors"
              >
                Open Devices
              </button>
            </>
          )}
        </div>
      ) : <>
        {offline && (
          <div className="absolute top-5 right-8 flex items-center gap-1.5 text-[10px] text-accent/60 select-none z-10">
            <span className="w-1.5 h-1.5 rounded-full bg-accent/60" />
            Local mode
          </div>
        )}

        {/* All Devices */}
        <div className="shrink-0 px-8 pt-2 pb-5 flex flex-col gap-2" data-no-swipe>
          <h2 className="font-semibold text-white/80 select-none">All Devices</h2>
          <div className="flex items-center gap-4">
            <div className={`flex-1 h-[6.5rem] flex flex-col justify-center transition-opacity ${allOff ? 'opacity-30 pointer-events-none' : ''}`}>
              {allCircadian
                ? <CircadianStrip circadian={circadian} />
                : <LightSliders
                    brightness={allBrightness}
                    colorTemp={allColorTemp}
                    tempLabel={tempLabel(allColorTemp)}
                    onBrightness={(v) => handleSlider('brightness', v)}
                    onColorTemp={(v) => handleSlider('colorTemp', v)}
                    brightnessMixed={brightnessMixed}
                    colorTempMixed={colorTempMixed}
                  />
              }
            </div>
            <div className="flex flex-row gap-4 mx-4">
              <AutoToggle on={allCircadian} onClick={() => toggleCircadianGroup('all')} />
              <button
                onClick={() => togglePower('all')}
                className={`w-24 h-14 flex items-center justify-center rounded-item bg-white/[0.08] touch-manipulation transition-colors ${
                  allOff ? 'text-white/60 hover:text-white/80' : 'text-white/40 hover:text-white/65 active:text-danger/70'
                }`}
              >
                <PowerIcon />
              </button>
            </div>
          </div>
        </div>

        {/* Individual devices */}
        {deviceEntries.length > 0 && (
          <div className="flex-1 min-h-0 flex flex-col border-t-2 border-strong">
            <div className="flex-1 min-h-0 overflow-y-auto app-scrollbar px-8 pt-5 pb-3 flex flex-col gap-4" data-no-swipe>
              {deviceEntries.map(([name]) => {
                const dev         = localDevices[name] ?? { brightness: 70, colorTemp: 30 };
                const isCircadian = enabledGroups.includes(name);
                const isOff       = poweredOff.includes(name);
                return (
                  <div key={name} className="flex flex-col gap-1.5">
                    <div className="text-sm font-semibold text-white/70 select-none">{name}</div>
                    <div className="flex items-center gap-4">
                      <div className={`flex-1 h-[6.5rem] flex flex-col justify-center transition-opacity ${isOff ? 'opacity-30 pointer-events-none' : ''}`}>
                        {isCircadian
                          ? <CircadianStrip circadian={circadian} />
                          : <LightSliders
                              brightness={dev.brightness}
                              colorTemp={dev.colorTemp}
                              tempLabel={tempLabel(dev.colorTemp)}
                              onBrightness={(v) => handleDeviceSlider(name, 'brightness', v)}
                              onColorTemp={(v) => handleDeviceSlider(name, 'colorTemp', v)}
                            />
                        }
                      </div>
                      <div className="flex flex-row gap-4 mx-4">
                        <AutoToggle on={isCircadian} onClick={() => toggleCircadianGroup(name)} />
                        <button
                          onClick={() => togglePower(name)}
                          className={`w-24 h-14 flex items-center justify-center rounded-item bg-white/[0.08] touch-manipulation transition-colors ${
                            isOff ? 'text-white/60 hover:text-white/80' : 'text-white/40 hover:text-white/65 active:text-danger/70'
                          }`}
                        >
                          <PowerIcon />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>)}
    </div>
  );
}
