import React, { createContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getSocket } from '../lib/socket';

// "Online" means the Pi can reach the internet (Spotify, Open-Meteo, …). The browser's
// navigator.onLine can't tell us that — the tablet only talks to the Pi over the LAN.

type ConnectivityContextValue = {
  online: boolean;
  /** Ask the Pi to re-check now. Call this when an internet-backed request fails. */
  recheck: () => void;
};

const OFFLINE_RECHECK_MS = 15_000;

export const ConnectivityContext = createContext<ConnectivityContextValue | null>(null);

export function ConnectivityProvider({ children }: { children: React.ReactNode }) {
  // Optimistic: pollers start immediately, and the first failure triggers a real check.
  const [online, setOnline] = useState(true);

  const recheck = useCallback(async () => {
    try {
      const { data } = await axios.get<{ online: boolean }>('/api/connectivity');
      setOnline(data.online);
    } catch {
      // Can't reach the Pi itself — internet-backed calls would fail too.
      setOnline(false);
    }
  }, []);

  // The server pushes changes it notices (e.g. its Spotify poller hitting a network
  // error). Losing the socket means we can't reach the Pi at all.
  useEffect(() => {
    const socket = getSocket();
    const onPush = ({ online }: { online: boolean }) => setOnline(online);
    const onDisconnect = () => setOnline(false);
    socket.on('connectivity', onPush);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', recheck);
    return () => {
      socket.off('connectivity', onPush);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', recheck);
    };
  }, [recheck]);

  // While offline, keep checking so polling resumes as soon as we're back.
  useEffect(() => {
    if (online) return;
    const id = setInterval(recheck, OFFLINE_RECHECK_MS);
    return () => clearInterval(id);
  }, [online, recheck]);

  // The tablet's own Wi-Fi dropping or returning is a good moment to re-check.
  useEffect(() => {
    window.addEventListener('online', recheck);
    window.addEventListener('offline', recheck);
    return () => {
      window.removeEventListener('online', recheck);
      window.removeEventListener('offline', recheck);
    };
  }, [recheck]);

  const value = { online, recheck };

  return <ConnectivityContext.Provider value={value}>{children}</ConnectivityContext.Provider>;
}
