import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';

const DEVICE_TYPE_LABEL = { Coordinator: 'Coordinator', Router: 'Router', EndDevice: 'Device' };

function DevicesView({ socket }) {
  const [devState, setDevState] = useState({ bridgeOnline: false, devices: [], pairing: false });

  useEffect(() => {
    axios.get('/api/lighting/devices').then((r) => setDevState(r.data)).catch(console.warn);
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.on('lighting:devices', setDevState);
    return () => socket.off('lighting:devices', setDevState);
  }, [socket]);

  const togglePair = () =>
    axios.post('/api/lighting/pair', { enable: !devState.pairing }).catch(console.warn);

  const visible = devState.devices.filter((d) => d.type !== 'Coordinator');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-8 py-6 gap-6">

      {/* Bridge status + pair button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${devState.bridgeOnline ? 'bg-emerald-400' : 'bg-white/20'}`} />
          <span className="text-[11px] uppercase tracking-widest text-white/40">
            {devState.bridgeOnline ? 'Bridge online' : 'Bridge offline'}
          </span>
        </div>
        <button
          onClick={togglePair}
          disabled={!devState.bridgeOnline}
          className={`px-4 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-widest transition-colors touch-manipulation ${
            devState.pairing
              ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40'
              : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.10] disabled:opacity-30'
          }`}
        >
          {devState.pairing ? 'Pairing…' : 'Pair device'}
        </button>
      </div>

      {/* Device list */}
      {visible.length === 0 ? (
        <p className="text-center text-[11px] text-white/20 uppercase tracking-widest pt-8">
          No devices paired
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((d) => (
            <div
              key={d.ieee_address}
              className="flex items-center justify-between px-5 py-4 rounded-2xl bg-white/[0.04]"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm text-white/70">{d.friendly_name}</span>
                {d.definition?.description && (
                  <span className="text-[10px] text-white/25">{d.definition.description}</span>
                )}
              </div>
              <span className="text-[10px] text-white/25 uppercase tracking-wider">
                {DEVICE_TYPE_LABEL[d.type] ?? d.type}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// colorTemp: 0 = warmest (🔥 left), 100 = coolest (❄️ right) — matches gradient and icons
const PRESETS = [
  { label: 'Relax',  icon: '🌙', brightness: 40,  colorTemp: 25 },
  { label: 'Focus',  icon: '💡', brightness: 90,  colorTemp: 85 },
  { label: 'Movie',  icon: '🎬', brightness: 20,  colorTemp: 18 },
  { label: 'Bright', icon: '☀️', brightness: 100, colorTemp: 60 },
];

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

export default function Lighting() {
  const [view, setView]               = useState('controls');
  const [serverState, setServerState] = useState({ connected: false, groups: {} });
  const [local, setLocal]             = useState({ brightness: 70, colorTemp: 30 });
  const [socket, setSocket]           = useState(null);
  const timers                        = useRef({});
  const animFrames                    = useRef({});
  const lastTouch                     = useRef({});
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
    // Cancel any preset animation in progress for this key
    cancelAnimationFrame(animFrames.current[key]);
    setLocal((prev) => ({ ...prev, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => sendAll({ [key]: value }), 220);
  };

  const applyPreset = ({ brightness, colorTemp }) => {
    animateTo('brightness', brightness);
    animateTo('colorTemp', colorTemp);
  };

  const offline      = !serverState.connected;
  const activePreset = PRESETS.find(
    (p) => p.brightness === local.brightness && p.colorTemp === local.colorTemp
  );
  const tempLabel =
    local.colorTemp < 33 ? 'Warm' : local.colorTemp < 67 ? 'Neutral' : 'Cool';

  return (
    <div className="h-full flex flex-col overflow-hidden relative">

      {/* Controls / Devices toggle */}
      <div className="shrink-0 flex justify-center pt-5 pb-2">
        <div className="flex bg-white/[0.06] rounded-full p-1 gap-1">
          {['controls', 'devices'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-5 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-widest transition-colors touch-manipulation ${
                view === v ? 'bg-white/[0.12] text-white/80' : 'text-white/30 hover:text-white/50'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'devices' && <DevicesView socket={socket} />}

      {view === 'controls' && <>
      {offline && (
        <div className="absolute top-5 right-8 flex items-center gap-1.5 text-[10px] text-amber-500/60 select-none z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500/60" />
          Local mode
        </div>
      )}

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div className="w-full px-12 flex flex-col gap-10">

          <div className="text-center text-[10px] font-medium text-white/25 uppercase tracking-widest select-none">
            Living Room
          </div>

          {/* ── Sliders ── */}
          <div className="flex flex-col gap-8" data-no-swipe>

            {/* Brightness */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/30 uppercase tracking-widest">Brightness</span>
                <span className="text-sm text-white/40 tabular-nums">{local.brightness}%</span>
              </div>
              <div className="flex items-center gap-5">
                <SunDim />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={local.brightness}
                  onChange={(e) => handleSlider('brightness', e.target.value)}
                  className="slider-brightness flex-1 touch-manipulation"
                />
                <SunBright />
              </div>
            </div>

            {/* Color temperature */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/30 uppercase tracking-widest">Color Temp</span>
                <span className="text-sm text-white/40">{tempLabel}</span>
              </div>
              <div className="flex items-center gap-5">
                <span className="text-xl leading-none shrink-0">🔥</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={local.colorTemp}
                  onChange={(e) => handleSlider('colorTemp', e.target.value)}
                  className="slider-colortemp flex-1 touch-manipulation"
                />
                <span className="text-xl leading-none shrink-0">❄️</span>
              </div>
            </div>
          </div>

          {/* ── Mood presets ── */}
          <div className="grid grid-cols-4 gap-4">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                onClick={() => applyPreset(preset)}
                className={`flex flex-col items-center gap-3 py-6 rounded-2xl transition-colors touch-manipulation ${
                  activePreset?.label === preset.label
                    ? 'bg-white/[0.12] ring-1 ring-white/20'
                    : 'bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.15]'
                }`}
              >
                <span className="text-3xl leading-none">{preset.icon}</span>
                <span className="text-sm font-medium text-white/45">{preset.label}</span>
              </button>
            ))}
          </div>

        </div>
      </div>
      </>}
    </div>
  );
}
