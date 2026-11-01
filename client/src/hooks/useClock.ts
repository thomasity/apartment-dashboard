import { useContext } from 'react';
import { ClockContext } from '../context/clockContext';

export function useClock() {
  const ctx = useContext(ClockContext);
  if (!ctx) throw new Error('useClock must be used within a ClockProvider');
  return ctx;
}
