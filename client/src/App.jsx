import { useState, useEffect, useRef, useCallback } from 'react';
import Header from './components/Header';
import Clock from './components/Clock';
import Weather from './components/Weather';
import Stocks from './components/Stocks';
import Lighting from './components/Lighting';

const TABS      = [
  { id: 'clock',   label: 'Clock'   },
  { id: 'weather', label: 'Weather' },
  { id: 'stocks',  label: 'Markets' },
  { id: 'lights',  label: 'Lights'  },
];
const TAB_ORDER = TABS.map((t) => t.id);

const INACTIVITY_MS = 5 * 60 * 1000; // 5 minutes → return to clock

// 11 PM – 6 AM: dim to 30%, otherwise full brightness
function nightBrightness() {
  const h = new Date().getHours();
  return h >= 23 || h < 6 ? 0.3 : 1;
}

export default function App() {
  const [tab,        setTab]        = useState('weather');
  const [brightness, setBrightness] = useState(nightBrightness);

  const touchStart    = useRef(null);
  const inactivityRef = useRef(null);

  // ── Inactivity: reset timer on every touch, return to clock on expiry ──
  const resetInactivity = useCallback(() => {
    clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => setTab('clock'), INACTIVITY_MS);
  }, []);

  useEffect(() => {
    resetInactivity();
    return () => clearTimeout(inactivityRef.current);
  }, [resetInactivity]);

  // ── Night dimming: re-evaluate every minute ─────────────────────────
  useEffect(() => {
    const id = setInterval(() => setBrightness(nightBrightness()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Swipe detection ─────────────────────────────────────────────────
  const handleTouchStart = (e) => {
    if (e.target.closest('[data-no-swipe]')) return;
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e) => {
    if (!touchStart.current) return;
    const t  = e.changedTouches[0];
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.65) return;

    const idx = TAB_ORDER.indexOf(tab);
    if (dx < 0 && idx < TAB_ORDER.length - 1) setTab(TAB_ORDER[idx + 1]);
    if (dx > 0 && idx > 0)                    setTab(TAB_ORDER[idx - 1]);
  };

  return (
    <div
      className="w-screen flex flex-col overflow-hidden bg-[#07070f]"
      style={{
        height:     '100dvh',
        filter:     `brightness(${brightness})`,
        transition: 'filter 2s ease',
      }}
      // Any touch anywhere resets the inactivity timer
      onTouchStart={resetInactivity}
    >
      {tab !== 'clock' && <Header />}

      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {TABS.map(({ id }) => (
          <div
            key={id}
            className={`absolute inset-0 overflow-hidden transition-opacity duration-200 ${
              tab === id ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            {id === 'clock'   && <Clock />}
            {id === 'weather' && <Weather />}
            {id === 'stocks'  && <Stocks />}
            {id === 'lights'  && <Lighting />}
          </div>
        ))}
      </div>

      <nav className="shrink-0 grid grid-cols-4 border-t border-white/[0.05] bg-[#07070f]">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="relative flex items-center justify-center h-14 touch-manipulation"
          >
            {tab === id && (
              <span className="absolute top-0 left-8 right-8 h-px bg-white/40 rounded-full" />
            )}
            <span
              className={`text-[11px] font-medium tracking-widest uppercase transition-colors ${
                tab === id ? 'text-white' : 'text-white/30'
              }`}
            >
              {label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  );
}
