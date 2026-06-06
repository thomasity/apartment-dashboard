import { useState, useEffect } from 'react';

export default function Clock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const h    = now.getHours();
  const m    = String(now.getMinutes()).padStart(2, '0');
  const s    = String(now.getSeconds()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = String(h % 12 || 12);

  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="h-full flex flex-col items-center justify-center select-none overflow-hidden gap-4">
      {/* Time */}
      <div className="flex items-end gap-4">
        <span
          className="font-thin text-white tracking-tight leading-none"
          style={{ fontSize: 'clamp(6rem, 18vw, 20rem)' }}
        >
          {hour}:{m}
        </span>
        <div className="flex flex-col items-start pb-3 gap-2">
          <span
            className="font-light text-white/50 leading-none"
            style={{ fontSize: 'clamp(1.5rem, 3.5vw, 4rem)' }}
          >
            {ampm}
          </span>
          <span
            className="font-light text-white/25 leading-none"
            style={{ fontSize: 'clamp(1.2rem, 2.5vw, 3rem)' }}
          >
            :{s}
          </span>
        </div>
      </div>

      {/* Date */}
      <div
        className="font-light text-white/25 tracking-widest uppercase"
        style={{ fontSize: 'clamp(0.7rem, 1.4vw, 1.1rem)' }}
      >
        {dateStr}
      </div>
    </div>
  );
}
