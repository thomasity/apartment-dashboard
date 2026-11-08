import { useEffect, useState } from 'react';
import axios from 'axios';
import { TrashIcon } from '../icons';
import type { HomeState, NetworkDevice } from '../../types';
import styles from './DevicesView.module.css';

const statusLabel = (home: boolean | null) => (home === null ? 'Checking…' : home ? 'Home' : 'Away');

/** Your phone on the Wi-Fi tells the dashboard whether you're home. */
export default function PhoneSection() {
  const [state, setState] = useState<HomeState>({ home: null, phones: [] });
  const [picking, setPicking] = useState(false);
  const [devices, setDevices] = useState<NetworkDevice[]>([]);

  useEffect(() => {
    const load = () => axios.get<HomeState>('/api/home').then((r) => setState(r.data)).catch(() => {});
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  const openPicker = () => {
    setPicking(true);
    axios.get<NetworkDevice[]>('/api/home/devices').then((r) => setDevices(r.data)).catch(() => {});
  };

  const choose = (d: NetworkDevice) => {
    axios.post<HomeState>('/api/home/phones', { mac: d.mac, name: d.vendor ? `${d.vendor} phone` : 'Phone' })
      .then((r) => setState(r.data))
      .catch(console.warn);
    setPicking(false);
  };

  const remove = (mac: string) => {
    axios.delete<HomeState>(`/api/home/phones/${encodeURIComponent(mac)}`)
      .then((r) => setState(r.data))
      .catch(console.warn);
  };

  const tracked = new Set(state.phones.map((p) => p.mac));

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Your phone</span>
        <button onClick={picking ? () => setPicking(false) : openPicker} className={styles.textButton}>
          {picking ? 'Cancel' : state.phones.length ? '+ Add another' : '+ Find my phone'}
        </button>
      </div>

      {state.phones.length === 0 && !picking && (
        <p className={styles.emptyNote}>Pick your phone so the dashboard knows when you're home</p>
      )}

      <div className={styles.roomList}>
        {state.phones.map((p) => (
          <div key={p.mac} className={styles.roomRow}>
            <span className={`${styles.statusDot} ${p.home ? styles.statusDotOnline : styles.statusDotOffline}`} />
            <span className={styles.roomName}>{p.name}</span>
            <span className={styles.roomCount}>{statusLabel(p.home)}</span>
            <button onClick={() => remove(p.mac)} className={styles.roomDelete}>
              <TrashIcon />
            </button>
          </div>
        ))}

        {picking && (
          devices.length === 0 ? (
            <p className={styles.emptyNote}>Nothing found on the network yet — the Pi scans once a minute</p>
          ) : (
            devices.filter((d) => !tracked.has(d.mac)).map((d) => (
              <button key={d.mac} onClick={() => choose(d)} className={styles.roomRow}>
                <span className={styles.roomName}>{d.vendor ?? 'Unknown device'}</span>
                <span className={styles.roomCount}>{d.ip} · {d.mac}</span>
              </button>
            ))
          )
        )}
      </div>
    </div>
  );
}
