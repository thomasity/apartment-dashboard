import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import PRESETS from '../presets.json';

const SCAN_DURATION = 254;

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6M14 11v6"/>
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
    </svg>
  );
}

function DevicesView({ socket }) {
  const [devState, setDevState]       = useState({ bridgeOnline: false, devices: [], pairing: false });
  const [editingId, setEditingId]     = useState(null);
  const [draftName, setDraftName]     = useState('');
  const [countdown, setCountdown]     = useState(0);
  const [newDeviceIds, setNewDeviceIds] = useState(new Set());
  const prevPairing                   = useRef(false);
  const scanStartIds                  = useRef(null);
  const countdownTimer                = useRef(null);
  const scanStartTime                 = useRef(null);

  useEffect(() => {
    axios.get('/api/lighting/devices').then((r) => setDevState(r.data)).catch(console.warn);
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('lighting:devices', setDevState);
    return () => socket.off('lighting:devices', setDevState);
  }, [socket]);

  // Manage scan countdown and track newly joined devices
  useEffect(() => {
    if (devState.pairing && !prevPairing.current) {
      scanStartIds.current = new Set(devState.devices.map((d) => d.ieee_address));
      scanStartTime.current = Date.now();
      setCountdown(SCAN_DURATION);
      countdownTimer.current = setInterval(() => {
        const remaining = Math.max(0, SCAN_DURATION - Math.floor((Date.now() - scanStartTime.current) / 1000));
        setCountdown(remaining);
        if (remaining === 0) clearInterval(countdownTimer.current);
      }, 1000);
    } else if (!devState.pairing && prevPairing.current) {
      clearInterval(countdownTimer.current);
      scanStartIds.current = null;
      scanStartTime.current = null;
      setCountdown(0);
      setNewDeviceIds(new Set());
    }
    prevPairing.current = devState.pairing;
    return () => clearInterval(countdownTimer.current);
  }, [devState.pairing]);

  // Highlight devices that joined during the current scan
  useEffect(() => {
    if (!scanStartIds.current) return;
    const joined = devState.devices
      .filter((d) => d.type !== 'Coordinator' && !scanStartIds.current.has(d.ieee_address))
      .map((d) => d.ieee_address);
    if (joined.length) setNewDeviceIds(new Set(joined));
  }, [devState.devices]);

  const toggleScan = () =>
    axios.post('/api/lighting/pair', { enable: !devState.pairing }).catch(console.warn);

  const startEdit = (d) => { setEditingId(d.ieee_address); setDraftName(d.friendly_name); };

  const submitRename = (oldName) => {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== oldName) {
      axios.post('/api/lighting/devices/rename', { from: oldName, to: trimmed }).catch(console.warn);
    }
    setEditingId(null);
  };

  const removeDevice = (id) =>
    axios.post('/api/lighting/devices/remove', { id }).catch(console.warn);

  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const visible = devState.devices.filter((d) => d.type !== 'Coordinator');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-8 py-6 gap-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${devState.bridgeOnline ? 'bg-emerald-400' : 'bg-white/20'}`} />
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
              ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30'
              : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.10] disabled:opacity-30'
          }`}
        >
          {devState.pairing && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
          {devState.pairing ? `Stop  ${fmt(countdown)}` : 'Scan'}
        </button>
      </div>

      {devState.pairing && (
        <p className="text-center text-[11px] text-white/25">
          Power-cycle your bulb to pair it
        </p>
      )}

      {/* Device list */}
      {visible.length === 0 ? (
        <p className="text-center text-[11px] text-white/20 uppercase tracking-widest pt-6">
          No devices paired
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((d) => {
            const isNew = newDeviceIds.has(d.ieee_address);
            return (
              <div
                key={d.ieee_address}
                className={`flex items-center gap-3 px-5 py-4 rounded-2xl transition-colors ${
                  isNew ? 'bg-amber-500/10 ring-1 ring-amber-500/20' : 'bg-white/[0.04]'
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
                      className="bg-white/[0.08] text-white/80 text-sm rounded-lg px-2 py-0.5 outline-none ring-1 ring-white/20 w-full"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white/70 truncate">{d.friendly_name}</span>
                      {isNew && (
                        <span className="text-[10px] text-amber-400 uppercase tracking-wider">New</span>
                      )}
                    </div>
                  )}
                  <span className="text-[10px] text-white/25">
                    {d.definition?.description ?? (d.type === 'Router' ? 'Router' : 'Device')}
                  </span>
                </div>
                <button
                  onClick={() => startEdit(d)}
                  className="p-2 text-white/20 hover:text-white/50 touch-manipulation transition-colors"
                >
                  <PencilIcon />
                </button>
                <button
                  onClick={() => removeDevice(d.friendly_name)}
                  className="p-2 text-white/20 hover:text-red-400/60 touch-manipulation transition-colors"
                >
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

// Sun with short rays — dim end of brightness slider
function SunDim() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"
         className="shrink-0 text-white/25">
      <circle cx="12" cy="12" r="4" />
      {/* Short rays: inner r=6.5, outer r=8.5 */}
      <line x1="12"   y1="6.5"  x2="12"   y2="4.5"  />
      <line x1="12"   y1="17.5" x2="12"   y2="19.5" />
      <line x1="6.5"  y1="12"   x2="4.5"  y2="12"   />
      <line x1="17.5" y1="12"   x2="19.5" y2="12"   />
      <line x1="15.9" y1="8.1"  x2="17.3" y2="6.7"  />
      <line x1="8.1"  y1="15.9" x2="6.7"  y2="17.3" />
      <line x1="8.1"  y1="8.1"  x2="6.7"  y2="6.7"  />
      <line x1="15.9" y1="15.9" x2="17.3" y2="17.3" />
    </svg>
  );
}

// Sun with long rays — bright end of brightness slider
function SunBright() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="2" strokeLinecap="round"
         className="shrink-0 text-white/50">
      <circle cx="12" cy="12" r="4" />
      {/* Long rays: inner r=6.5, outer r=11.5 */}
      <line x1="12"   y1="6.5"  x2="12"   y2="0.5"  />
      <line x1="12"   y1="17.5" x2="12"   y2="23.5" />
      <line x1="6.5"  y1="12"   x2="0.5"  y2="12"   />
      <line x1="17.5" y1="12"   x2="23.5" y2="12"   />
      <line x1="15.9" y1="8.1"  x2="20.0" y2="4.0"  />
      <line x1="8.1"  y1="15.9" x2="4.0"  y2="20.0" />
      <line x1="8.1"  y1="8.1"  x2="4.0"  y2="4.0"  />
      <line x1="15.9" y1="15.9" x2="20.0" y2="20.0" />
    </svg>
  );
}

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

export default function Lighting() {
  const [view, setView]               = useState('controls');
  const [serverState, setServerState] = useState({ connected: false, groups: {} });
  const [local, setLocal]             = useState({ brightness: 70, colorTemp: 30 });
  const [localDevices, setLocalDevices] = useState({});
  const [socket, setSocket]           = useState(null);
  const timers                        = useRef({});
  const animFrames                    = useRef({});
  const lastTouch                     = useRef({});
  const lastTouchDevices              = useRef({});
  const timersDevices                 = useRef({});
  const localRef                      = useRef(local);

  // Keep ref in sync so RAF closures always read the current value
  useEffect(() => { localRef.current = local; }, [local]);

  // Cancel all in-flight animations on unmount
  useEffect(() => {
    return () => Object.values(animFrames.current).forEach(cancelAnimationFrame);
  }, []);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    setSocket(s);

    s.on('lighting:state', (state) => {
      setServerState(state);
      const now = Date.now();
      setLocal((prev) => ({
        brightness: now - (lastTouch.current.brightness ?? 0) > 1200
          ? avg(state.groups, 'brightness') : prev.brightness,
        colorTemp: now - (lastTouch.current.colorTemp ?? 0) > 1200
          ? avg(state.groups, 'colorTemp')  : prev.colorTemp,
      }));
    });

    return () => s.disconnect();
  }, []);

  // Sync per-device local state from server, but don't clobber a slider the user is actively dragging
  useEffect(() => {
    const now = Date.now();
    setLocalDevices((prev) => {
      const next = {};
      Object.entries(serverState.groups).forEach(([name, g]) => {
        const dt = lastTouchDevices.current[name] ?? {};
        next[name] = {
          brightness: now - (dt.brightness ?? 0) > 1200 ? g.brightness : (prev[name]?.brightness ?? g.brightness),
          colorTemp:  now - (dt.colorTemp  ?? 0) > 1200 ? g.colorTemp  : (prev[name]?.colorTemp  ?? g.colorTemp),
        };
      });
      return next;
    });
  }, [serverState.groups]);

  const sendAll = useCallback((payload) => {
    axios.post('/api/lighting/set', { group: 'all', ...payload }).catch(console.warn);
  }, []);

  // Smoothly tween a slider key from its current value to target over ~450ms
  const animateTo = useCallback((key, target) => {
    const from = localRef.current[key];
    if (from === target) return;

    lastTouch.current[key] = Date.now();
    cancelAnimationFrame(animFrames.current[key]);

    const duration = 450;
    const start    = performance.now();

    const tick = (now) => {
      const t      = Math.min((now - start) / duration, 1);
      const eased  = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const value  = Math.round(from + (target - from) * eased);

      lastTouch.current[key] = Date.now(); // keep socket updates blocked during tween
      setLocal((prev) => ({ ...prev, [key]: value }));

      if (t < 1) {
        animFrames.current[key] = requestAnimationFrame(tick);
      } else {
        sendAll({ [key]: target });
      }
    };

    animFrames.current[key] = requestAnimationFrame(tick);
  }, [sendAll]);

  const handleSlider = (key, raw) => {
    const value = Number(raw);
    lastTouch.current[key] = Date.now();
    cancelAnimationFrame(animFrames.current[key]);
    setLocal((prev) => ({ ...prev, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => sendAll({ [key]: value }), 220);
  };

  const handleDeviceSlider = useCallback((deviceName, key, raw) => {
    const value = Number(raw);
    if (!lastTouchDevices.current[deviceName]) lastTouchDevices.current[deviceName] = {};
    lastTouchDevices.current[deviceName][key] = Date.now();
    setLocalDevices((prev) => ({ ...prev, [deviceName]: { ...(prev[deviceName] ?? {}), [key]: value } }));
    const timerKey = `${deviceName}-${key}`;
    clearTimeout(timersDevices.current[timerKey]);
    timersDevices.current[timerKey] = setTimeout(() => {
      axios.post('/api/lighting/set', { group: deviceName, [key]: value }).catch(console.warn);
    }, 220);
  }, []);

  const applyPreset = (preset) => {
    animateTo('brightness', preset.brightness);
    animateTo('colorTemp', preset.colorTemp);
  };

  const offline      = !serverState.connected;
  const activePreset = PRESETS.find(
    (p) => p.brightness === local.brightness && p.colorTemp === local.colorTemp
  );
  const tempLabel =
    local.colorTemp < 33 ? 'Warm' : local.colorTemp < 67 ? 'Neutral' : 'Cool';

  const deviceEntries = Object.entries(serverState.groups);

  const now = Date.now();
  const brightnessMixed = deviceEntries.length > 1
    && spread(localDevices, 'brightness') > 5
    && now - (lastTouch.current.brightness ?? 0) > 1200;
  const colorTempMixed = deviceEntries.length > 1
    && spread(localDevices, 'colorTemp') > 5
    && now - (lastTouch.current.colorTemp ?? 0) > 1200;

  return (
    <div className="h-full flex flex-col overflow-hidden relative">

      {/* Controls / Presets / Devices toggle */}
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

      {view === 'devices' && <DevicesView socket={socket} />}

      {view === 'presets' && (
        <div className="flex-1 min-h-0 flex items-center justify-center px-8">
          <div className="w-full grid grid-cols-3 gap-4">
            {PRESETS.map((preset) => {
              const isActive = activePreset?.label === preset.label;
              const presetTempLabel = preset.colorTemp < 33 ? 'Warm' : preset.colorTemp < 67 ? 'Neutral' : 'Cool';
              return (
                <button
                  key={preset.label}
                  onClick={() => applyPreset(preset)}
                  className={`flex flex-col items-center gap-3 py-8 rounded-2xl transition-colors touch-manipulation ${
                    isActive
                      ? 'bg-white/[0.12] ring-1 ring-white/20'
                      : 'bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.15]'
                  }`}
                >
                  <span className="text-4xl leading-none">{preset.icon}</span>
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-sm font-medium text-white/70">{preset.label}</span>
                    <span className="text-[10px] text-white/30">{preset.brightness}% · {presetTempLabel}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {view === 'controls' && <>
      {offline && (
        <div className="absolute top-5 right-8 flex items-center gap-1.5 text-[10px] text-amber-500/60 select-none z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
          Local mode
        </div>
      )}

      {/* ── All Devices (always visible) ── */}
      <div className="shrink-0 px-8 pt-2 pb-2 flex flex-col gap-3" data-no-swipe>
        <div className="text-base font-semibold text-white/80 select-none">
          All Devices
        </div>

        <div className="flex flex-col gap-3">
          {/* Brightness */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25 uppercase tracking-widest">Brightness</span>
              {brightnessMixed
                ? <span className="text-[10px] text-white/25 italic">Mixed</span>
                : <span className="text-[10px] text-white/35 tabular-nums">{local.brightness}%</span>}
            </div>
            <div className="flex items-center gap-3">
              <SunDim />
              <input
                type="range" min={0} max={100} value={local.brightness}
                onChange={(e) => handleSlider('brightness', e.target.value)}
                className={`slider-brightness flex-1 touch-manipulation${brightnessMixed ? ' slider-mixed' : ''}`}
              />
              <SunBright />
            </div>
          </div>

          {/* Color temperature */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white/25 uppercase tracking-widest">Color Temp</span>
              {colorTempMixed
                ? <span className="text-[10px] text-white/25 italic">Mixed</span>
                : <span className="text-[10px] text-white/35">{tempLabel}</span>}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-base leading-none shrink-0">🔥</span>
              <input
                type="range" min={0} max={100} value={local.colorTemp}
                onChange={(e) => handleSlider('colorTemp', e.target.value)}
                className={`slider-colortemp flex-1 touch-manipulation${colorTempMixed ? ' slider-mixed' : ''}`}
              />
              <span className="text-base leading-none shrink-0">❄️</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Individual Bulbs (scrollable) ── */}
      {deviceEntries.length > 0 && (
        <div className="flex-1 min-h-0 flex flex-col border-t-2 border-white/[0.08]">
          <div className="flex-1 min-h-0 overflow-y-auto app-scrollbar px-8 pt-3 pb-3 flex flex-col gap-4" data-no-swipe>
            {deviceEntries.map(([name]) => {
              const dev = localDevices[name] ?? { brightness: 70, colorTemp: 30 };
              const devTempLabel = dev.colorTemp < 33 ? 'Warm' : dev.colorTemp < 67 ? 'Neutral' : 'Cool';
              return (
                <div key={name} className="flex flex-col gap-2">
                  <div className="text-sm font-semibold text-white/70 select-none">
                    {name}
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/25 uppercase tracking-widest">Brightness</span>
                      <span className="text-[10px] text-white/35 tabular-nums">{dev.brightness}%</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <SunDim />
                      <input
                        type="range" min={0} max={100} value={dev.brightness}
                        onChange={(e) => handleDeviceSlider(name, 'brightness', e.target.value)}
                        className="slider-brightness flex-1 touch-manipulation"
                      />
                      <SunBright />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-white/25 uppercase tracking-widest">Color Temp</span>
                      <span className="text-[10px] text-white/35">{devTempLabel}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-base leading-none shrink-0">🔥</span>
                      <input
                        type="range" min={0} max={100} value={dev.colorTemp}
                        onChange={(e) => handleDeviceSlider(name, 'colorTemp', e.target.value)}
                        className="slider-colortemp flex-1 touch-manipulation"
                      />
                      <span className="text-base leading-none shrink-0">❄️</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>}
    </div>
  );
}
