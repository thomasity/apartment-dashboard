import { createContext, useEffect, useState } from 'react';

type ClockContextValue = {
  now: Date;
  /** 12-hour, unpadded: "9" */
  hour: string;
  minute: string;
  second: string;
  ampm: 'AM' | 'PM';
  /** "Sunday, November 1, 2026" */
  longDate: string;
  /** "Sun, Nov 1" */
  shortDate: string;
};

export const ClockContext = createContext<ClockContextValue | null>(null);

export function ClockProvider({ children }: { children: React.ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h = now.getHours();
  const value: ClockContextValue = {
    now,
    hour:      String(h % 12 || 12),
    minute:    String(now.getMinutes()).padStart(2, '0'),
    second:    String(now.getSeconds()).padStart(2, '0'),
    ampm:      h >= 12 ? 'PM' : 'AM',
    longDate:  now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    shortDate: now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
  };

  return <ClockContext.Provider value={value}>{children}</ClockContext.Provider>;
}
