import { useState, useEffect, useRef, useCallback } from 'react';
import Header  from './components/Header';
import Home    from './components/Home';
import Weather from './components/Weather';
import Stocks  from './components/Stocks';
import Lighting from './components/Lighting';
import Spotify from './components/Spotify';

const TABS      = [
  { id: 'home',    label: 'Home'    },
  { id: 'weather', label: 'Weather' },
  { id: 'stocks',  label: 'Markets' },
  { id: 'lights',  label: 'Lights'  },
  { id: 'spotify', label: 'Music'   },
];
const TAB_ORDER = TABS.map((t) => t.id);

const INACTIVITY_MS  = 5 * 60 * 1000;
const NAV_HIDE_MS    = 3 * 1000;

export default function App() {
  const [tab,        setTab]        = useState('home');
  const [navVisible, setNavVisible] = useState(true);

  const touchStart    = useRef(null);
  const inactivityRef = useRef(null);
  const navHideRef    = useRef(null);
  const tabRef        = useRef(tab);

  useEffect(() => { tabRef.current = tab; }, [tab]);

  // ── Nav auto-hide: fades out after 3 s on Home, always visible elsewhere ──
  const scheduleNavHide = useCallback(() => {
    clearTimeout(navHideRef.current);
    navHideRef.current = setTimeout(() => setNavVisible(false), NAV_HIDE_MS);
  }, []);

  useEffect(() => {
    clearTimeout(navHideRef.current);
    if (tab === 'home') {
      scheduleNavHide();
    } else {
      setNavVisible(true);
    }
    return () => clearTimeout(navHideRef.current);
  }, [tab, scheduleNavHide]);

  // ── Inactivity: reset timer on every touch, return to home on expiry ──
  const resetInactivity = useCallback(() => {
    clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => setTab('home'), INACTIVITY_MS);

    // Any touch shows the nav; if already on Home, restart the hide countdown
    setNavVisible(true);
    clearTimeout(navHideRef.current);
    if (tabRef.current === 'home') {
      navHideRef.current = setTimeout(() => setNavVisible(false), NAV_HIDE_MS);
    }
  }, []);

  useEffect(() => {
    resetInactivity();
    return () => clearTimeout(inactivityRef.current);
  }, [resetInactivity]);

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
      className="relative w-screen overflow-hidden bg-app-bg"
      style={{ height: '100dvh' }}
      onTouchStart={resetInactivity}
    >
      {/* ── Tab content — fills full viewport ── */}
      <div
        className="absolute inset-0"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {TABS.map(({ id }) => (
          <div
            key={id}
            className={`absolute inset-0 overflow-hidden transition-opacity duration-200 ${
              tab === id ? 'opacity-100' : 'opacity-0 pointer-events-none'
            } ${id !== 'home' ? 'pt-[52px] pb-14' : ''}`}
          >
            {id === 'home'    && <Home />}
            {id === 'weather' && <Weather />}
            {id === 'stocks'  && <Stocks />}
            {id === 'lights'  && <Lighting />}
            {id === 'spotify' && <Spotify />}
          </div>
        ))}
      </div>

      {/* ── Header overlay (non-home tabs only) ── */}
      {tab !== 'home' && (
        <div className="absolute top-0 inset-x-0 z-20">
          <Header />
        </div>
      )}

      {/* ── Nav overlay — frosted glass, auto-hides on Home ── */}
      <nav
        className={`absolute bottom-0 inset-x-0 z-20 grid grid-cols-5 border-t border-muted backdrop-blur-xl bg-black/30 transition-opacity duration-700 ${
          navVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
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
