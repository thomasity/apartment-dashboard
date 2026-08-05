import { useContext } from 'react';
import { ClockContext } from '../context/clockContext';

export function useClock() {
  const now = useContext(ClockContext);
  if (!now) throw new Error('useClock must be used within a ClockProvider');
  return now;
}

