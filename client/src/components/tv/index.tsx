import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  PlayIcon, PauseIcon, ScanBackIcon, ScanFwdIcon,
  ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
  HomeIcon, BackIcon,
  VolumeUpIcon, VolumeDownIcon, VolumeMuteIcon,
  PowerIcon, RemoteIcon, KeyboardIcon, CastIcon, CheckIcon, SearchIcon,
} from '../icons';

interface TvStatus { appId?: string; appName?: string; playerState?: string; position?: number; duration?: number; }
interface TvApp { id: string; name: string; }
interface DiscoveredDevice { ip: string; name: string; model?: string; }

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
      className="touch-manipulation active:scale-95 transition-transform"
    >
      <div className="relative w-full overflow-hidden rounded-lg">
        {imgFailed ? (
          <div className="w-full h-48 bg-white/[0.08] flex items-center justify-center text-white/40 text-xl font-bold">
            {app.name[0]}
          </div>
        ) : (
          <img
            src={`/api/tv/icon/${app.id}`}
            alt={app.name}
            className="w-full h-48 object-contain bg-white/[0.06]"
            onError={() => setImgFailed(true)}
          />
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent pt-8 pb-2 px-2">
          <p className="text-white/80 text-xs text-center truncate font-medium">{app.name}</p>
        </div>
      </div>
    </button>
  );
}

function BarBtn({ children, onClick, active, danger }: { children: React.ReactNode; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-10 h-10 flex items-center justify-center rounded-full touch-manipulation transition-colors ${
        active
          ? 'bg-white/[0.15] text-white/80'
          : danger
          ? 'text-white/35 hover:bg-danger/10 hover:text-danger/70'
          : 'text-white/35 hover:bg-white/[0.08] hover:text-white/70'
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
      className="w-24 h-20 rounded-item bg-zinc-700 text-white/70 flex items-center justify-center touch-manipulation hover:bg-zinc-600 active:bg-zinc-500 transition-colors"
    >
      {children}
    </button>
  );
}

function RoundBtn({ children, onClick, dim, lg }: { children: React.ReactNode; onClick: () => void; dim?: boolean; lg?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`${lg ? 'w-28 h-28' : 'w-24 h-24'} rounded-full flex items-center justify-center touch-manipulation transition-colors ${
        dim
          ? 'bg-zinc-700 text-white/50 hover:bg-zinc-600'
          : 'bg-zinc-600 text-white/80 hover:bg-zinc-500 active:bg-zinc-400'
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
      <div className="h-full flex flex-col items-center justify-center gap-2 pb-8">
        <span className={`w-2 h-2 rounded-full transition-colors ${waking ? 'bg-amber-400/60 animate-pulse' : 'bg-white/20'}`} />
        <p className="text-[11px] uppercase tracking-widest text-white/25 mt-1">
          {notConfigured ? 'No device configured' : waking ? 'Waking TV…' : 'TV Offline'}
        </p>
        {waking && (
          <p className="text-[10px] text-white/15">This may take a few seconds</p>
        )}
        {notConfigured && (
          <button
            onClick={openPicker}
            className="mt-2 px-4 py-2 bg-white/[0.08] text-white/40 rounded-lg text-xs touch-manipulation hover:bg-white/[0.14] transition-colors"
          >
            Select Device
          </button>
        )}
        {!notConfigured && !waking && (
          <button
            onClick={wakeTV}
            className="mt-2 px-4 py-2 bg-white/[0.08] text-white/40 rounded-lg text-xs touch-manipulation hover:bg-white/[0.14] transition-colors"
          >
            Wake TV
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">

      {/* ── Top bar ── */}
      <div className="relative z-30 shrink-0 overflow-hidden border-b border-subtle">
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {appId && (
              <img
                src={`/api/tv/icon/${appId}`}
                alt={appName}
                className="w-8 h-6 object-contain rounded shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <span className="text-sm text-white/60 truncate">{appName ?? '—'}</span>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlaying ? 'bg-online' : 'bg-white/20'}`} />
            {playerState && STATE_LABEL[playerState] && (
              <span className="text-[9px] text-white/25 uppercase tracking-wider shrink-0">
                {STATE_LABEL[playerState]}
              </span>
            )}
            {duration > 0 && (
              <span className="text-[9px] text-white/20 tabular-nums shrink-0">
                {fmtSec(Math.round(livePos))} / {fmtSec(duration)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-6 shrink-0">
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

          <div className="shrink-0 pl-4 ml-2 border-l border-white/[0.08]">
            <BarBtn onClick={() => key('Power')} danger>
              <PowerIcon size={20} />
            </BarBtn>
          </div>
        </div>

        {/* Progress bar — only when duration is known */}
        {duration > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.06]">
            <div
              className="h-full bg-white/30"
              style={{ width: `${progress}%`, transition: 'width 1s linear' }}
            />
          </div>
        )}
      </div>

      {/* ── Content search bar ── */}
      <div className="shrink-0 px-4 pt-3 pb-1 flex gap-2" data-no-swipe>
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 pointer-events-none">
            <SearchIcon size={15} />
          </span>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendSearch(); }}
            placeholder="Search movies, shows, apps…"
            className="w-full bg-white/[0.06] text-white/70 placeholder-white/20 rounded-lg pl-9 pr-3 py-2 text-sm outline-none"
          />
        </div>
        <button
          onClick={sendSearch}
          disabled={!searchQuery.trim()}
          className="px-3 py-2 bg-white/[0.08] text-white/50 rounded-lg text-xs touch-manipulation transition-colors whitespace-nowrap disabled:opacity-30 enabled:hover:bg-white/[0.14]"
        >
          Search
        </button>
      </div>

      {/* ── App Grid ── */}
      <div className="flex-1 overflow-y-auto app-scrollbar" data-no-swipe>
        {appsError ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <p className="text-white/20 text-xs tracking-widest uppercase">Failed to load apps</p>
            <p className="text-white/15 text-xs">{appsError}</p>
            <button
              onClick={fetchApps}
              className="mt-1 px-4 py-2 bg-white/[0.08] text-white/40 rounded-lg text-xs touch-manipulation hover:bg-white/[0.14] transition-colors"
            >
              Retry
            </button>
          </div>
        ) : apps.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-white/20 text-xs tracking-widest uppercase">Loading…</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4">
            {apps.map((app) => (
              <AppTile key={app.id} app={app} onLaunch={launch} />
            ))}
          </div>
        )}
      </div>

      {/* ── Remote FABs ── */}
      {remoteOpen && (
        <>
          <div className="absolute inset-0 z-10" onClick={() => setRemoteOpen(false)} />

          {/* Bottom-left: D-pad */}
          <div className="absolute bottom-4 left-4 z-20 p-4 rounded-2xl bg-zinc-900" data-no-swipe>
            <div className="relative w-[312px] h-[312px]">
              <div className="absolute inset-0 rounded-full bg-zinc-800" />
              <button onClick={() => key('Up')} className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-20 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors">
                <ChevronUpIcon size={40} />
              </button>
              <button onClick={() => key('Down')} className="absolute bottom-0 left-1/2 -translate-x-1/2 w-20 h-20 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors">
                <ChevronDownIcon size={40} />
              </button>
              <button onClick={() => key('Left')} className="absolute left-0 top-1/2 -translate-y-1/2 w-20 h-20 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors">
                <ChevronLeftIcon size={40} />
              </button>
              <button onClick={() => key('Right')} className="absolute right-0 top-1/2 -translate-y-1/2 w-20 h-20 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors">
                <ChevronRightIcon size={40} />
              </button>
              <button onClick={() => key('Select')} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 rounded-full bg-zinc-600 text-white/80 hover:bg-zinc-500 active:bg-zinc-400 flex items-center justify-center touch-manipulation transition-colors">
                <span className="text-base font-bold uppercase tracking-widest">OK</span>
              </button>
            </div>
          </div>

          {/* Bottom-right: Nav + Transport */}
          <div className="absolute bottom-4 right-4 z-20 p-4 rounded-2xl bg-zinc-900 flex flex-col gap-3" data-no-swipe>
            <div className="flex justify-around gap-3">
              <FlatBtn onClick={() => key('Back')}><BackIcon size={30} /></FlatBtn>
              <FlatBtn onClick={() => key('Home')}><HomeIcon size={32} /></FlatBtn>
            </div>
            <div className="flex items-center gap-3">
              <FlatBtn onClick={() => key('Rev')}><ScanBackIcon size={32} /></FlatBtn>
              <RoundBtn lg onClick={() => key('Play')}>
                {isPlaying ? <PauseIcon size={40} /> : <PlayIcon size={40} />}
              </RoundBtn>
              <FlatBtn onClick={() => key('Fwd')}><ScanFwdIcon size={32} /></FlatBtn>
            </div>
            <div className="flex items-center gap-3">
              <FlatBtn onClick={() => key('VolumeDown')}><VolumeDownIcon size={32} /></FlatBtn>
              <RoundBtn onClick={() => key('VolumeMute')} dim><VolumeMuteIcon size={36} /></RoundBtn>
              <FlatBtn onClick={() => key('VolumeUp')}><VolumeUpIcon size={32} /></FlatBtn>
            </div>
          </div>
        </>
      )}

      {/* ── Keyboard input ── */}
      {keyboardOpen && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={closeKeyboard}>
          <div className="border-t border-white/10 bg-[#111] px-4 py-3 flex gap-3" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={typeText}
              onChange={handleTypeChange}
              onKeyDown={(e) => { if (e.key === 'Enter') key('Enter'); }}
              placeholder="Keys send in real time…"
              className="flex-1 bg-white/[0.08] text-white/80 placeholder-white/20 rounded-lg px-4 py-2.5 outline-none text-sm"
            />
            <button onClick={() => key('Enter')} className="px-4 py-2.5 bg-white/[0.10] text-white/60 rounded-lg text-sm hover:bg-white/[0.16] touch-manipulation transition-colors">
              ↵
            </button>
          </div>
        </div>
      )}

      {/* ── Device picker ── */}
      {pickerOpen && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={() => setPickerOpen(false)}>
          <div className="bg-zinc-900 border-t border-white/10 px-4 pt-4 pb-6 rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-white/70">Select Roku Device</span>
              <button
                onClick={discover}
                disabled={discovering}
                className="text-xs text-white/30 hover:text-white/60 touch-manipulation transition-colors disabled:opacity-40"
              >
                {discovering ? 'Searching…' : 'Refresh'}
              </button>
            </div>
            {discovering && discovered.length === 0 ? (
              <p className="text-center text-white/20 text-xs py-6 tracking-widest uppercase">Searching…</p>
            ) : discovered.length === 0 ? (
              <p className="text-center text-white/20 text-xs py-6">No Roku devices found</p>
            ) : (
              <div className="flex flex-col gap-1">
                {discovered.map((d) => (
                  <button
                    key={d.ip}
                    onClick={() => selectDevice(d)}
                    className="flex items-center justify-between px-3 py-3 rounded-lg hover:bg-white/[0.06] touch-manipulation transition-colors"
                  >
                    <div className="flex flex-col items-start gap-0.5">
                      <span className="text-sm text-white/70">{d.name}</span>
                      {d.model && <span className="text-xs text-white/25">{d.model}</span>}
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
