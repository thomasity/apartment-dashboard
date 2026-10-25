import { useState, useCallback, useEffect } from 'react';
import axios from 'axios';
import { DeviceTypeIcon, BluetoothIcon } from '../icons';
import type { SpotifyDevice, BtDevice, BtDiscoveredDevice } from '../../types';
import styles from './DevicePicker.module.css';

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
      className={styles.backdrop}
      onClick={onClose}
    >
      <div
        className={styles.dialog}
        onClick={(e) => e.stopPropagation()}
        data-no-swipe
      >
        <p className={styles.title}>Play on…</p>

        {/* Spotify devices */}
        {devices.length === 0 ? (
          <p className={styles.empty}>No devices found.<br/>Open Spotify on a device first.</p>
        ) : (
          <div className={styles.list}>
            {devices.map((d) => (
              <button
                key={d.id}
                onClick={() => d.id && handleSpotifySelect(d.id)}
                className={`${styles.device} ${
                  d.isActive ? styles.deviceActive : styles.deviceIdle
                }`}
              >
                <span className={d.isActive ? styles.deviceIconActive : styles.deviceIconIdle}>
                  <DeviceTypeIcon type={d.type ?? 'unknown'} />
                </span>
                <span className={styles.deviceName}>{d.name}</span>
                {d.isActive && <span className={styles.deviceVolume}>Active</span>}
              </button>
            ))}
          </div>
        )}

        {/* Pi Speakers (Bluetooth) */}
        <div className={styles.bluetooth}>
          <div className={styles.bluetoothHeader}>
            <p className={styles.sectionTitle}>Pi Speakers</p>
            <button
              onClick={scan}
              disabled={scanning}
              className={styles.scanButton}
            >
              {scanning ? 'Scanning…' : '+ Scan'}
            </button>
          </div>

          {btPaired.length === 0 && !scanning && btDiscovered.length === 0 && (
            <p className={styles.bluetoothEmpty}>No speakers paired. Tap Scan to find one.</p>
          )}

          {btPaired.map((d) => (
            <div key={d.mac} className={styles.btDevice}>
              <div className={styles.btDeviceInfo}>
                <span className={d.connected ? styles.btIconConnected : styles.btIconIdle}>
                  <BluetoothIcon />
                </span>
                <span className={`${styles.btName} ${d.connected ? styles.btNameConnected : styles.btNameIdle}`}>
                  {d.name}
                </span>
              </div>
              <div className={styles.btActions}>
                <button
                  onClick={() => toggleConnect(d)}
                  className={`${styles.btConnect} ${
                    d.connected
                      ? styles.btConnected
                      : styles.btDisconnected
                  }`}
                >
                  {d.connected ? 'Disconnect' : 'Connect'}
                </button>
                <button
                  onClick={() => forget(d.mac)}
                  className={styles.btForget}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

          {scanError && <p className={styles.scanError}>{scanError}</p>}

          {btDiscovered.length > 0 && (
            <>
              <p className={styles.discoveredTitle}>Nearby</p>
              {btDiscovered.map((d) => (
                <div key={d.mac} className={styles.discovered}>
                  <span className={styles.discoveredIcon}><BluetoothIcon /></span>
                  <span className={styles.discoveredName}>{d.name || d.mac}</span>
                  <button
                    onClick={() => pair(d.mac)}
                    disabled={pairing === d.mac}
                    className={styles.pairButton}
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
