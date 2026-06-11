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
      className="flex flex-col items-center gap-1.5 shrink-0 w-[4.5rem] touch-manipulation"
    >
      {imgFailed ? (
        <div className="w-14 h-10 rounded-lg bg-white/[0.08] flex items-center justify-center text-white/40 text-sm font-semibold">
          {app.name[0]}
        </div>
      ) : (
        <img
          src={`/api/tv/icon/${app.id}`}
          alt={app.name}
          className="w-14 h-10 rounded-lg object-cover bg-white/[0.06]"
          onError={() => setImgFailed(true)}
        />
      )}
      <span className="text-[9px] text-white/25 truncate w-full text-center leading-tight">{app.name}</span>
    </button>
  );
}

function Btn({ children, onClick, wide, danger, label }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onClick}
        className={`flex items-center justify-center rounded-item touch-manipulation transition-colors ${
          wide ? 'w-20 h-14' : 'w-16 h-14'
        } ${
          danger
            ? 'bg-white/[0.04] text-danger/50 hover:bg-danger/10 hover:text-danger/70'
            : 'bg-white/[0.06] text-white/60 hover:bg-white/[0.12] active:bg-white/[0.18]'
        }`}
      >
        {children}
      </button>
      {label && <span className="text-[9px] text-white/25 uppercase tracking-wider">{label}</span>}
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
    <div className="h-full overflow-y-auto app-scrollbar flex flex-col gap-5 px-6 py-4">

      {/* Now Playing */}
      <div className="shrink-0 bg-white/[0.04] rounded-card px-5 py-3.5 flex items-center gap-4">
        {appId && (
          <img
            src={`/api/tv/icon/${appId}`}
            alt={appName}
            className="w-10 h-8 rounded-lg object-cover bg-white/[0.08] shrink-0"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-white/80 truncate">{appName ?? '—'}</div>
          {playerState && STATE_LABEL[playerState] && (
            <div className="text-[10px] text-white/30 uppercase tracking-wider">{STATE_LABEL[playerState]}</div>
          )}
        </div>
        <span className={`w-2 h-2 rounded-full shrink-0 ${isPlaying ? 'bg-online' : 'bg-white/20'}`} />
      </div>

      {/* App Launcher */}
      {apps.length > 0 && (
        <div className="shrink-0 flex gap-2 overflow-x-auto pb-1" data-no-swipe style={{ scrollbarWidth: 'none' }}>
          {apps.map((app) => <AppTile key={app.id} app={app} onLaunch={launch} />)}
        </div>
      )}

      {/* Transport */}
      <div className="shrink-0 flex justify-center gap-4">
        <Btn onClick={() => key('Rev')}><ScanBackIcon /></Btn>
        <Btn onClick={() => key('Play')} wide>{isPlaying ? <PauseIcon /> : <PlayIcon />}</Btn>
        <Btn onClick={() => key('Fwd')}><ScanFwdIcon /></Btn>
      </div>

      {/* D-Pad */}
      <div className="shrink-0 flex justify-center">
        <div className="inline-grid grid-cols-3 gap-2">
          <div className="w-16 h-14" />
          <Btn onClick={() => key('Up')}><ChevronUpIcon /></Btn>
          <div className="w-16 h-14" />
          <Btn onClick={() => key('Left')}><ChevronLeftIcon /></Btn>
          <Btn onClick={() => key('Select')}>
            <span className="text-xs font-bold uppercase tracking-widest">OK</span>
          </Btn>
          <Btn onClick={() => key('Right')}><ChevronRightIcon /></Btn>
          <div className="w-16 h-14" />
          <Btn onClick={() => key('Down')}><ChevronDownIcon /></Btn>
          <div className="w-16 h-14" />
        </div>
      </div>

      {/* System */}
      <div className="shrink-0 flex justify-center gap-4">
        <Btn onClick={() => key('Back')}  label="Back"><BackIcon /></Btn>
        <Btn onClick={() => key('Home')}  label="Home"><HomeIcon /></Btn>
        <Btn onClick={() => key('Info')}  label="Options"><OptionsIcon /></Btn>
      </div>

      {/* Volume */}
      <div className="shrink-0 flex justify-center gap-4">
        <Btn onClick={() => key('VolumeDown')} label="Vol −"><VolumeDownIcon /></Btn>
        <Btn onClick={() => key('VolumeMute')} label="Mute"><VolumeMuteIcon /></Btn>
        <Btn onClick={() => key('VolumeUp')}   label="Vol +"><VolumeUpIcon /></Btn>
      </div>

      {/* Power Off */}
      <div className="shrink-0 flex justify-center pb-2">
        <Btn onClick={() => key('PowerOff')} wide danger label="Power Off">
          <PowerIcon size={18} />
        </Btn>
      </div>

    </div>
  );
}
