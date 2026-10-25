import { useState, useEffect, useRef, useCallback } from "react";
import Header from "./components/Header";
import Home from "./components/home";
import Weather from "./components/weather";
import Lighting from "./components/lighting";
import Spotify from "./components/spotify";
import TV from "./components/tv";
import VoiceOverlay from "./components/voice/VoiceOverlay";
import { useVoice } from "./hooks/useVoice";
import styles from './App.module.css';

const TABS = [
  { id: "home", label: "Home" },
  { id: "weather", label: "Weather" },
  { id: "lights", label: "Lights" },
  { id: "spotify", label: "Music" },
  { id: "tv", label: "TV" },
];
const TAB_ORDER = TABS.map((t) => t.id);

const INACTIVITY_MS = 5 * 60 * 1000;
const NAV_HIDE_MS = 10 * 1000;

export default function App() {
  const [tab, setTab] = useState("home");
  const [navVisible, setNavVisible] = useState(true);
  const [spotifyMounted, setSpotifyMounted] = useState(false);
  const {
    status,
    transcript,
    response,
    start,
    stop,
    cancel,
    interrupt,
    clearHistory,
    activeVoice,
  } = useVoice();

  function handleMicClick() {
    if (status === "idle") start();
    else if (status === "listening") stop();
    else if (status === "speaking") interrupt();
    else cancel();
  }

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const inactivityRef = useRef<number | null>(null);
  const navHideRef = useRef<number | null>(null);
  const tabRef = useRef(tab);

  useEffect(() => {
    tabRef.current = tab;
    if (tab === "spotify") setSpotifyMounted(true);
  }, [tab]);

  // ── Nav auto-hide: fades out after X s on Home, always visible elsewhere ──
  const scheduleNavHide = useCallback(() => {
    clearTimeout(navHideRef.current ?? undefined);
    navHideRef.current = setTimeout(() => setNavVisible(false), NAV_HIDE_MS);
  }, []);

  useEffect(() => {
    clearTimeout(navHideRef.current ?? undefined);
    if (tab === "home") {
      scheduleNavHide();
    } else {
      setNavVisible(true);
    }
    return () => clearTimeout(navHideRef.current ?? undefined);
  }, [tab, scheduleNavHide]);

  // ── Inactivity: reset timer on every touch, return to home on expiry ──
  const resetInactivity = useCallback(() => {
    clearTimeout(inactivityRef.current ?? undefined);
    inactivityRef.current = setTimeout(() => {
      setTab("home");
      clearHistory();
    }, INACTIVITY_MS);

    // Any touch shows the nav; if already on Home, restart the hide countdown
    setNavVisible(true);
    clearTimeout(navHideRef.current ?? undefined);
    if (tabRef.current === "home") {
      navHideRef.current = setTimeout(() => setNavVisible(false), NAV_HIDE_MS);
    }
  }, []);

  useEffect(() => {
    resetInactivity();
    return () => clearTimeout(inactivityRef.current ?? undefined);
  }, [resetInactivity]);

  // ── Swipe detection ─────────────────────────────────────────────────
  const handleTouchStart = (e: React.TouchEvent) => {
    if ((e.target as Element).closest("[data-no-swipe]")) return;
    const t = e.touches[0];
    if (!t) return;
    touchStart.current = { x: t.clientX, y: t.clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    if (!touchStart.current || !t) return;
    const dx = t.clientX - touchStart.current.x;
    const dy = t.clientY - touchStart.current.y;
    touchStart.current = null;

    if (Math.abs(dx) < 80 || Math.abs(dy) > Math.abs(dx) * 0.65) return;

    const idx = TAB_ORDER.indexOf(tab);
    const next = TAB_ORDER[dx < 0 ? idx + 1 : idx - 1];
    if (next) setTab(next);
  };

  return (
    <div
      className={styles.root}
      onTouchStart={resetInactivity}
    >
      {/* ── Tab content — fills full viewport ── */}
      <div
        className={styles.tabs}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {TABS.map(({ id }) => (
          <div
            key={id}
            className={`${styles.panel} ${
              tab === id ? styles.visible : styles.hidden
            } ${id !== "home" ? styles.panelInset : ""}`}
          >
            {id === "home" && (
              <Home
                onNavigate={setTab}
                micStatus={status}
                onMicClick={handleMicClick}
              />
            )}
            {id === "weather" && <Weather />}
            {id === "lights" && <Lighting />}
            {id === "spotify" && spotifyMounted && <Spotify />}
            {id === "tv" && <TV />}
          </div>
        ))}
      </div>

      {/* ── Header overlay (non-home tabs only) ── */}
      {tab !== "home" && (
        <div className={styles.header}>
          <Header micStatus={status} onMicClick={handleMicClick} />
        </div>
      )}

      {/* ── Nav overlay — frosted glass, auto-hides on Home ── */}
      <nav
        className={`${styles.nav} ${
          navVisible ? styles.visible : styles.hidden
        }`}
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={styles.navButton}
          >
            {tab === id && (
              <span className={styles.navIndicator} />
            )}
            <span
              className={`${styles.navLabel} ${
                tab === id
                  ? styles.navLabelActive
                  : styles.navLabelIdle
              }`}
            >
              {label}
            </span>
          </button>
        ))}
      </nav>

      <VoiceOverlay
        status={status}
        transcript={transcript}
        response={response}
        onCancel={cancel}
        onInterrupt={interrupt}
        activeVoice={activeVoice}
      />
    </div>
  );
}
