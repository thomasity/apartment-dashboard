import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { PencilIcon, TrashIcon } from '../icons';

const SCAN_DURATION = 254;

export default function DevicesView({ socket, devState, setDevState }) {
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
