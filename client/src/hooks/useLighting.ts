import { useContext } from 'react';
import { LightingContext } from '../context/lightingContext';

export function useLighting() {
  const ctx = useContext(LightingContext);
  if (!ctx) throw new Error('useLighting must be used within a LightingProvider');
  return ctx;
}
