import { createContext, useEffect, useState } from 'react';

export const ClockContext = createContext<Date | null>(null);

export function ClockProvider({ children }: { children: React.ReactNode }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <ClockContext.Provider value={now}>{children}</ClockContext.Provider>;
}