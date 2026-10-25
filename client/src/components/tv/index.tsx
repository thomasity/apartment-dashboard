import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  PlayIcon, PauseIcon, ScanBackIcon, ScanFwdIcon,
  ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
  HomeIcon, BackIcon,
  VolumeUpIcon, VolumeDownIcon, VolumeMuteIcon,
  PowerIcon, RemoteIcon, KeyboardIcon, CastIcon, CheckIcon, SearchIcon,
} from '../icons';
import type { TvStatus, TvApp, DiscoveredDevice } from '../../types';
import styles from './index.module.css';

const STATE_LABEL: Record<string, string> = { play: 'Playing', pause: 'Paused', stop: 'Stopped' };

function fmtSec(s: number) {
  if (!s || s <= 0) return '0:00';
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function AppTile({ app, onLaunch }: { app: TvApp; onLaunch: (id: string) => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <button
      onClick={() => onLaunch(app.id)}
      className={styles.appTile}
    >
      <div className={styles.appTileFrame}>
        {imgFailed ? (
          <div className={styles.appTilePlaceholder}>
            {app.name[0]}
          </div>
        ) : (
          <img
            src={`/api/tv/icon/${app.id}`}
            alt={app.name}
            className={styles.appTileIcon}
            onError={() => setImgFailed(true)}
          />
        )}
        <div className={styles.appTileCaption}>
          <p className={styles.appTileName}>{app.name}</p>
        </div>
      </div>
    </button>
  );
}

function BarBtn({ children, onClick, active, danger }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${styles.barButton} ${
        active
          ? styles.barButtonActive
          : danger
          ? styles.barButtonDanger
          : styles.barButtonIdle
      }`}
    >
      {children}
    </button>
  );
}

function FlatBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={styles.flatButton}
    >
      {children}
    </button>
  );
}

function RoundBtn({ children, onClick, dim, lg }: { children: React.ReactNode; onClick: () => void; dim?: boolean; lg?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${lg ? styles.roundButtonLarge : styles.roundButtonSmall} ${styles.roundButton} ${
        dim
          ? styles.roundButtonDim
          : styles.roundButtonBright
      }`}
    >
      {children}
    </button>
  );
}

export default function TV() {
  const [status, setStatus]               = useState<TvStatus | null>(null);
  const [apps, setApps]                   = useState<TvApp[]>([]);
  const [error, setError]                 = useState<string | null>(null);
  const [appsError, setAppsError]         = useState<string | null>(null);
  const [remoteOpen, setRemoteOpen]       = useState(false);
  const [keyboardOpen, setKeyboardOpen]   = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [pickerOpen, setPickerOpen]       = useState(false);
  const [device, setDevice]               = useState<DiscoveredDevice | null>(null);
  const [discovered, setDiscovered]       = useState<DiscoveredDevice[]>([]);
  const [discovering, setDiscovering]     = useState(false);
  const [typeText, setTypeText]           = useState('');
  const [waking, setWaking]               = useState(false);
  const prevTextRef                       = useRef('');
  const statusAt                          = useRef(0);
  const [_tick, setTick]                  = useState(0);

  const fetchStatus = useCallback(() => {
    axios
      .get('/api/tv/status')
      .then((r) => { setStatus(r.data); statusAt.current = Date.now(); setError(null); setWaking(false); })
      .catch((e) => setError(e.response?.data?.error ?? 'Unreachable'));
  }, []);

  const wakeTV = useCallback(() => {
    setWaking(true);
    axios.post('/api/tv/power-on').catch(() => {});
    // Auto-clear waking state after 60s so UI doesn't get stuck
    setTimeout(() => setWaking(false), 60000);
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Tick every second while playing to keep progress bar smooth
  useEffect(() => {
    if (status?.playerState !== 'play') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [status?.playerState]);

  const fetchApps = useCallback(() => {
    setAppsError(null);
    axios.get('/api/tv/apps')
      .then((r) => setApps(r.data))
      .catch((e) => setAppsError(e.response?.data?.error ?? 'Could not reach TV'));
  }, []);

  useEffect(() => {
    fetchApps();
    axios.get('/api/tv/device').then((r) => setDevice(r.data)).catch(() => {});
  }, [fetchApps]);

  const discover = useCallback(() => {
    setDiscovering(true);
    axios.get('/api/tv/discover')
      .then((r) => setDiscovered(r.data))
      .catch(() => {})
      .finally(() => setDiscovering(false));
  }, []);

  const selectDevice = useCallback((d: DiscoveredDevice) => {
    axios.post('/api/tv/select', { ip: d.ip, name: d.name })
      .then(() => { setDevice(d); setPickerOpen(false); })
      .catch(() => {});
  }, []);

  const openPicker = useCallback(() => { setPickerOpen(true); discover(); }, [discover]);

  const key = (k: string) => axios.post(`/api/tv/keypress/${k}`).catch(console.warn);

  const launch = (id: string) => {
    axios.post(`/api/tv/launch/${id}`).catch(console.warn);
    setTimeout(fetchStatus, 1500);
  };

  const handleTypeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newText = e.target.value;
    const prev    = prevTextRef.current;
    if (newText.length > prev.length) {
      for (const char of newText.slice(prev.length))
        axios.post(`/api/tv/keypress/Lit_${encodeURIComponent(char)}`).catch(console.warn);
    } else if (newText.length < prev.length) {
      for (let i = 0; i < prev.length - newText.length; i++) key('Backspace');
    }
    prevTextRef.current = newText;
    setTypeText(newText);
  }, []);

  const closeKeyboard = useCallback(() => {
    setKeyboardOpen(false);
    setTypeText('');
    prevTextRef.current = '';
  }, []);

  const sendSearch = useCallback(() => {
    const q = searchQuery.trim();
    if (!q) return;
    axios.post('/api/tv/search', { keyword: q }).catch(console.warn);
  }, [searchQuery]);

  const { appId, appName, playerState, position = 0, duration = 0 } = status ?? {};
  const isPlaying = playerState === 'play';

  // Interpolated position — re-computed each tick so the bar moves smoothly
  const livePos  = isPlaying && duration > 0
    ? Math.min(position + (Date.now() - statusAt.current) / 1000, duration)
    : position;
  const progress = duration > 0 ? (livePos / duration) * 100 : 0;

  if (error) {
    const notConfigured = error.includes('ROKU_IP');
    return (
      <div className={styles.status}>
        <span className={`${styles.statusDot} ${waking ? styles.statusDotWaking : styles.statusDotIdle}`} />
        <p className={styles.statusTitle}>
          {notConfigured ? 'No device configured' : waking ? 'Waking TV…' : 'TV Offline'}
        </p>
        {waking && (
          <p className={styles.statusHint}>This may take a few seconds</p>
        )}
        {notConfigured && (
          <button
            onClick={openPicker}
            className={styles.statusAction}
          >
            Select Device
          </button>
        )}
        {!notConfigured && !waking && (
          <button
            onClick={wakeTV}
            className={styles.statusAction}
          >
            Wake TV
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={styles.root}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.nowPlayingRow}>
          <div className={styles.nowPlaying}>
            {appId && (
              <img
                src={`/api/tv/icon/${appId}`}
                alt={appName}
                className={styles.appIcon}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span className={styles.appName}>{appName ?? '—'}</span>
            <span className={`${styles.playDot} ${isPlaying ? styles.playDotPlaying : styles.playDotIdle}`} />
            {playerState && STATE_LABEL[playerState] && (
              <span className={styles.playState}>
                {STATE_LABEL[playerState]}
              </span>
            )}
            {duration > 0 && (
              <span className={styles.playTime}>
                {fmtSec(Math.round(livePos))} / {fmtSec(duration)}
              </span>
            )}
          </div>

          <div className={styles.topControls}>
            <BarBtn onClick={() => setKeyboardOpen((v) => !v)} active={keyboardOpen}>
              <KeyboardIcon size={20} />
            </BarBtn>
            <BarBtn onClick={openPicker} active={pickerOpen}>
              <CastIcon size={20} />
            </BarBtn>
            <BarBtn onClick={() => setRemoteOpen((v) => !v)} active={remoteOpen}>
              <RemoteIcon size={20} />
            </BarBtn>
          </div>

          <div className={styles.powerSlot}>
            <BarBtn onClick={() => key('Power')} danger>
              <PowerIcon size={20} />
            </BarBtn>
          </div>
        </div>

        {/* Progress bar — only when duration is known */}
        {duration > 0 && (
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* ── Content search bar ── */}
      <div className={styles.searchBar} data-no-swipe>
        <div className={styles.searchField}>
          <span className={styles.searchIcon}>
            <SearchIcon size={15} />
          </span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendSearch(); }}
            placeholder="Search movies, shows, apps…"
            className={styles.searchInput}
          />
        </div>
        <button
          onClick={sendSearch}
          disabled={!searchQuery.trim()}
          className={styles.searchButton}
        >
          Search
        </button>
      </div>

      {/* ── App Grid ── */}
      <div className={styles.body} data-no-swipe>
        {appsError ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>Failed to load apps</p>
            <p className={styles.emptyHint}>{appsError}</p>
            <button
              onClick={fetchApps}
              className={styles.emptyAction}
            >
              Retry
            </button>
          </div>
        ) : apps.length === 0 ? (
          <div className={styles.loading}>
            <p className={styles.loadingText}>Loading…</p>
          </div>
        ) : (
          <div className={styles.apps}>
            {apps.map((app) => (
              <AppTile key={app.id} app={app} onLaunch={launch} />
            ))}
          </div>
        )}
      </div>

      {/* ── Remote FABs ── */}
      {remoteOpen && (
        <>
          <div className={styles.remoteDismiss} onClick={() => setRemoteOpen(false)} />

          {/* Bottom-left: D-pad */}
          <div className={styles.dpadPanel} data-no-swipe>
            <div className={styles.dpad}>
              <div className={styles.dpadRing} />
              <button onClick={() => key('Up')} className={styles.dpadUp}>
                <ChevronUpIcon size={40} />
              </button>
              <button onClick={() => key('Down')} className={styles.dpadDown}>
                <ChevronDownIcon size={40} />
              </button>
              <button onClick={() => key('Left')} className={styles.dpadLeft}>
                <ChevronLeftIcon size={40} />
              </button>
              <button onClick={() => key('Right')} className={styles.dpadRight}>
                <ChevronRightIcon size={40} />
              </button>
              <button onClick={() => key('Select')} className={styles.dpadOk}>
                <span className={styles.dpadOkLabel}>OK</span>
              </button>
            </div>
          </div>

          {/* Bottom-right: Nav + Transport */}
          <div className={styles.keysPanel} data-no-swipe>
            <div className={styles.keysRow}>
              <FlatBtn onClick={() => key('Back')}><BackIcon size={30} /></FlatBtn>
              <FlatBtn onClick={() => key('Home')}><HomeIcon size={32} /></FlatBtn>
            </div>
            <div className={styles.keysGroup}>
              <FlatBtn onClick={() => key('Rev')}><ScanBackIcon size={32} /></FlatBtn>
              <RoundBtn lg onClick={() => key('Play')}>
                {isPlaying ? <PauseIcon size={40} /> : <PlayIcon size={40} />}
              </RoundBtn>
              <FlatBtn onClick={() => key('Fwd')}><ScanFwdIcon size={32} /></FlatBtn>
            </div>
            <div className={styles.keysGroup}>
              <FlatBtn onClick={() => key('VolumeDown')}><VolumeDownIcon size={32} /></FlatBtn>
              <RoundBtn onClick={() => key('VolumeMute')} dim><VolumeMuteIcon size={36} /></RoundBtn>
              <FlatBtn onClick={() => key('VolumeUp')}><VolumeUpIcon size={32} /></FlatBtn>
            </div>
          </div>
        </>
      )}

      {/* ── Keyboard input ── */}
      {keyboardOpen && (
        <div className={styles.keyboardBackdrop} onClick={closeKeyboard}>
          <div className={styles.keyboardBar} onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={typeText}
              onChange={handleTypeChange}
              onKeyDown={(e) => { if (e.key === 'Enter') key('Enter'); }}
              placeholder="Keys send in real time…"
              className={styles.keyboardInput}
            />
            <button onClick={() => key('Enter')} className={styles.keyboardSend}>
              ↵
            </button>
          </div>
        </div>
      )}

      {/* ── Device picker ── */}
      {pickerOpen && (
        <div className={styles.discoverBackdrop} onClick={() => setPickerOpen(false)}>
          <div className={styles.discoverSheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.discoverHeader}>
              <span className={styles.discoverTitle}>Select Roku Device</span>
              <button
                onClick={discover}
                disabled={discovering}
                className={styles.discoverRescan}
              >
                {discovering ? 'Searching…' : 'Refresh'}
              </button>
            </div>
            {discovering && discovered.length === 0 ? (
              <p className={styles.discoverStatus}>Searching…</p>
            ) : discovered.length === 0 ? (
              <p className={styles.discoverEmpty}>No Roku devices found</p>
            ) : (
              <div className={styles.discoverList}>
                {discovered.map((d) => (
                  <button
                    key={d.ip}
                    onClick={() => selectDevice(d)}
                    className={styles.discoverItem}
                  >
                    <div className={styles.discoverItemText}>
                      <span className={styles.discoverItemName}>{d.name}</span>
                      {d.model && <span className={styles.discoverItemModel}>{d.model}</span>}
                    </div>
                    {device?.ip === d.ip && <CheckIcon size={16} />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
