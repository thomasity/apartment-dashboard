import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
  PlayIcon, PauseIcon, ScanBackIcon, ScanFwdIcon,
  ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
  HomeIcon, BackIcon, OptionsIcon,
  VolumeUpIcon, VolumeDownIcon, VolumeMuteIcon,
  PowerIcon,
} from '../icons';

const STATE_LABEL = { play: 'Playing', pause: 'Paused', stop: 'Stopped' };

function AppTile({ app, onLaunch }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <button
      onClick={() => onLaunch(app.id)}
      className="touch-manipulation"
    >
      {imgFailed ? (
        <div className="w-full h-48 rounded-lg bg-white/[0.08] flex items-center justify-center text-white/40 text-sm font-semibold">
          {app.name[0]}
        </div>
      ) : (
        <img
          src={`/api/tv/icon/${app.id}`}
          alt={app.name}
          className="w-full h-48 object-contain rounded-lg bg-white/[0.06]"
          onError={() => setImgFailed(true)}
        />
      )}
    </button>
  );
}

function Btn({ children, onClick, danger, label }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <button
        onClick={onClick}
        className={`w-11 h-11 flex items-center justify-center rounded-item touch-manipulation transition-colors ${
          danger
            ? 'bg-white/[0.04] text-danger/50 hover:bg-danger/10 hover:text-danger/70'
            : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.12] active:bg-white/[0.18]'
        }`}
      >
        {children}
      </button>
      {label && <span className="text-[8px] text-white/20 uppercase tracking-wider">{label}</span>}
    </div>
  );
}

export default function TV() {
  const [status, setStatus] = useState(null);
  const [apps,   setApps]   = useState([]);
  const [error,  setError]  = useState(null);

  const fetchStatus = useCallback(() => {
    axios.get('/api/tv/status')
      .then((r) => { setStatus(r.data); setError(null); })
      .catch((e) => setError(e.response?.data?.error ?? 'Unreachable'));
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    axios.get('/api/tv/apps').then((r) => setApps(r.data)).catch(() => {});
  }, []);

  const key    = (k)  => axios.post(`/api/tv/keypress/${k}`).catch(console.warn);
  const launch = (id) => { axios.post(`/api/tv/launch/${id}`).catch(console.warn); setTimeout(fetchStatus, 1500); };

  const { appId, appName, playerState } = status ?? {};
  const isPlaying = playerState === 'play';

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 pb-8">
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <p className="text-[11px] uppercase tracking-widest text-white/25 mt-1">
          {error.includes('ROKU_IP') ? 'ROKU_IP not configured' : 'TV Offline'}
        </p>
        {error.includes('ROKU_IP') && (
          <p className="text-white/15 text-xs">Add ROKU_IP to your .env file</p>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full flex select-none">

      {/* ── Left: Remote ── */}
      <div className="w-1/2 shrink-0 flex flex-col items-center justify-center gap-3 px-4 border-r border-subtle">

        {/* Now Playing — compact strip */}
        <div className="flex items-center gap-1.5 w-full px-1">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlaying ? 'bg-online' : 'bg-white/20'}`} />
          <span className="text-xs text-white/50 truncate">{appName ?? '—'}</span>
          {playerState && STATE_LABEL[playerState] && (
            <span className="text-[9px] text-white/25 uppercase tracking-wider shrink-0">{STATE_LABEL[playerState]}</span>
          )}
        </div>

        {/* Transport */}
        <div className="flex gap-2">
          <Btn onClick={() => key('Rev')}><ScanBackIcon size={20} /></Btn>
          <Btn onClick={() => key('Play')}>{isPlaying ? <PauseIcon /> : <PlayIcon size={22} />}</Btn>
          <Btn onClick={() => key('Fwd')}><ScanFwdIcon size={20} /></Btn>
        </div>

        {/* D-Pad */}
        <div className="inline-grid grid-cols-3 gap-1.5">
          <div className="w-11 h-11" />
          <Btn onClick={() => key('Up')}><ChevronUpIcon size={20} /></Btn>
          <div className="w-11 h-11" />
          <Btn onClick={() => key('Left')}><ChevronLeftIcon size={20} /></Btn>
          <Btn onClick={() => key('Select')}>
            <span className="text-[10px] font-bold uppercase tracking-widest">OK</span>
          </Btn>
          <Btn onClick={() => key('Right')}><ChevronRightIcon size={20} /></Btn>
          <div className="w-11 h-11" />
          <Btn onClick={() => key('Down')}><ChevronDownIcon size={20} /></Btn>
          <div className="w-11 h-11" />
        </div>

        {/* System */}
        <div className="flex gap-2">
          <Btn onClick={() => key('Back')}  label="Back"><BackIcon /></Btn>
          <Btn onClick={() => key('Home')}  label="Home"><HomeIcon size={20} /></Btn>
          <Btn onClick={() => key('Info')}  label="Options"><OptionsIcon size={20} /></Btn>
        </div>

        {/* Volume */}
        <div className="flex gap-2">
          <Btn onClick={() => key('VolumeDown')} label="Vol −"><VolumeDownIcon size={20} /></Btn>
          <Btn onClick={() => key('VolumeMute')} label="Mute"><VolumeMuteIcon size={20} /></Btn>
          <Btn onClick={() => key('VolumeUp')}   label="Vol +"><VolumeUpIcon size={20} /></Btn>
        </div>

        {/* Power */}
        <Btn onClick={() => key('PowerOff')} danger label="Power Off">
          <PowerIcon size={16} />
        </Btn>

      </div>

      {/* ── Right: App Launcher ── */}
      <div className="flex-1 overflow-y-auto app-scrollbar" data-no-swipe>
        {apps.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-white/20 text-xs tracking-widest uppercase">Loading…</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 p-4">
            {apps.map((app) => <AppTile key={app.id} app={app} onLaunch={launch} />)}
          </div>
        )}
      </div>

    </div>
  );
}
