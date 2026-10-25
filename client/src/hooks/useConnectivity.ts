import { useContext } from 'react';
import { ConnectivityContext } from '../context/connectivityContext';

export function useConnectivity() {
  const ctx = useContext(ConnectivityContext);
  if (!ctx) throw new Error('useConnectivity must be used within a ConnectivityProvider');
  return ctx;
}
