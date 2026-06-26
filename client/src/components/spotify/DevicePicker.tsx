import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { DeviceTypeIcon, BluetoothIcon } from '../icons';
import type { SpotifyDevice } from '../../types';

interface BtDevice { mac: string; name: string; connected: boolean; }
interface BtDiscoveredDevice { mac: string; name?: string; }

interface Props {
  onClose: () => void;
  devices: SpotifyDevice[];
  transferTo: (id: string, play: boolean) => Promise<void>;
}

export default function DevicePicker({ onClose, devices, transferTo }: Props) {
  const [btPaired,     setBtPaired]     = useState<BtDevice[]>([]);
  const [btDiscovered, setBtDiscovered] = useState<BtDiscoveredDevice[]>([]);
  const [scanning,     setScanning]     = useState(false);
  const [scanError,    setScanError]    = useState<string | null>(null);
  const [pairing,      setPairing]      = useState<string | null>(null);

  useEffect(() => {
    axios.get('/api/bluetooth/devices').then((r) => setBtPaired(r.data)).catch(() => {});
  }, []);

  const handleSpotifySelect = useCallback(async (deviceId: string) => {
    await transferTo(deviceId, true);
    onClose();
  }, [transferTo, onClose]);

  const scan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    setBtDiscovered([]);
    try {
      const { data } = await axios.get('/api/bluetooth/scan');
      setBtDiscovered(data);
      if (data.length === 0) setScanError('No devices found. Make sure your speaker is in pairing mode.');
    } catch (err: unknown) {
      const msg = (err as { response?: { status?: number } }).response?.status === 409
        ? 'Scan already in progress — try again in a moment.'
        : 'Scan failed. Check server logs.';
      setScanError(msg);
    }
    setScanning(false);
  }, []);

  const pair = useCallback(async (mac: string) => {
    setPairing(mac);
    try {
      await axios.post('/api/bluetooth/pair', { mac });
      const { data } = await axios.get('/api/bluetooth/devices');
      setBtPaired(data);
      setBtDiscovered((prev) => prev.filter((d) => d.mac !== mac));
    } catch {}
    setPairing(null);
  }, []);

  const toggleConnect = useCallback(async (d: BtDevice) => {
    try {
      if (d.connected) {
        await axios.post('/api/bluetooth/disconnect', { mac: d.mac });
      } else {
        await axios.post('/api/bluetooth/connect', { mac: d.mac });
      }
      const { data } = await axios.get('/api/bluetooth/devices');
      setBtPaired(data);
    } catch {}
  }, []);

  const forget = useCallback(async (mac: string) => {
    try {
      await axios.delete(`/api/bluetooth/device/${mac}`);
      setBtPaired((prev) => prev.filter((d) => d.mac !== mac));
    } catch {}
  }, []);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#111118] border border-muted rounded-card p-7 w-[90vw] max-w-[34rem] flex flex-col gap-4 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        data-no-swipe
      >
        <p className="text-white/40 text-xs tracking-widest uppercase">Play on…</p>

        {/* Spotify devices */}
        {devices.length === 0 ? (
          <p className="text-white/25 text-sm py-2 text-center">No devices found.<br/>Open Spotify on a device first.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => d.id && handleSpotifySelect(d.id)}
                className={`grid grid-cols-3 gap-4 px-5 py-5 rounded-item touch-manipulation transition-colors ${
                  d.isActive ? 'bg-white/10 text-white' : 'text-white/50 active:bg-white/[0.06]'
                }`}
              >
                <span className={d.isActive ? 'text-white' : 'text-white/30'}>
                  <DeviceTypeIcon type={d.type ?? 'unknown'} />
                </span>
                <span className="text-sm truncate flex-1 justify-self-center">{d.name}</span>
                {d.isActive && <span className="text-white/30 text-xs justify-self-end">Active</span>}
              </button>
            ))}
          </div>
        )}

        {/* Pi Speakers (Bluetooth) */}
        <div className="pt-4 border-t border-subtle flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-white/25 text-xs tracking-widest uppercase">Pi Speakers</p>
            <button
              onClick={scan}
              disabled={scanning}
              className="px-6 py-3 rounded-full bg-white/[0.06] text-white/40 text-sm active:bg-white/[0.10] disabled:opacity-40 touch-manipulation transition-colors"
            >
              {scanning ? 'Scanning…' : '+ Scan'}
            </button>
          </div>

          {btPaired.length === 0 && !scanning && btDiscovered.length === 0 && (
            <p className="text-white/20 text-xs py-2 text-center">No speakers paired. Tap Scan to find one.</p>
          )}

          {btPaired.map((d) => (
            <div key={d.mac} className="flex flex-row gap-8 px-5 py-4 rounded-item bg-white/[0.04]">
              <div className="flex items-center gap-3">
                <span className={d.connected ? 'text-blue-400/70' : 'text-white/25'}>
                  <BluetoothIcon />
                </span>
                <span className={`text-sm flex-1 ${d.connected ? 'text-white/70' : 'text-white/35'}`}>
                  {d.name}
                </span>
              </div>
              <div className="flex w-full gap-2">
                <button
                  onClick={() => toggleConnect(d)}
                  className={`flex-1 py-4 rounded-item text-xs font-medium tracking-widest uppercase touch-manipulation transition-colors ${
                    d.connected
                      ? 'bg-blue-400/10 text-blue-400/70 active:bg-blue-400/20'
                      : 'bg-white/[0.08] text-white/40 active:bg-white/[0.14]'
                  }`}
                >
                  {d.connected ? 'Disconnect' : 'Connect'}
                </button>
                <button
                  onClick={() => forget(d.mac)}
                  className="px-5 py-3 rounded-item bg-white/[0.06] text-white/30 active:bg-danger/10 active:text-danger/70 touch-manipulation transition-colors"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          {scanError && <p className="text-white/30 text-xs py-1 text-center">{scanError}</p>}

          {btDiscovered.length > 0 && (
            <>
              <p className="text-white/25 text-xs tracking-widest uppercase mt-1">Nearby</p>
              {btDiscovered.map((d) => (
                <div key={d.mac} className="flex items-center gap-3 px-4 py-3 rounded-item bg-white/[0.03]">
                  <span className="text-white/25"><BluetoothIcon /></span>
                  <span className="text-white/40 text-sm truncate flex-1">{d.name || d.mac}</span>
                  <button
                    onClick={() => pair(d.mac)}
                    disabled={pairing === d.mac}
                    className="px-4 py-2.5 rounded-full bg-blue-400/10 text-blue-400/60 text-xs active:bg-blue-400/20 disabled:opacity-40 touch-manipulation transition-colors"
                  >
                    {pairing === d.mac ? 'Pairing…' : 'Pair'}
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
