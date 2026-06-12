import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  PlayIcon, PauseIcon, ScanBackIcon, ScanFwdIcon,
  ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
  HomeIcon, BackIcon,
  VolumeUpIcon, VolumeDownIcon, VolumeMuteIcon,
  PowerIcon, RemoteIcon, KeyboardIcon,
} from '../icons';

const STATE_LABEL = { play: 'Playing', pause: 'Paused', stop: 'Stopped' };

function AppTile({ app, onLaunch }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <button onClick={() => onLaunch(app.id)} className="touch-manipulation">
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

function BarBtn({ children, onClick, active, danger }) {
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

function FlatBtn({ children, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-16 h-14 rounded-item bg-white/[0.08] text-white/50 flex items-center justify-center touch-manipulation hover:bg-white/[0.14] active:bg-white/[0.20] transition-colors"
    >
      {children}
    </button>
  );
}

function RoundBtn({ children, onClick, dim, lg }) {
  return (
    <button
      onClick={onClick}
      className={`${lg ? 'w-20 h-20' : 'w-16 h-16'} rounded-full flex items-center justify-center touch-manipulation transition-colors ${
        dim
          ? 'bg-white/[0.08] text-white/40 hover:bg-white/[0.14]'
          : 'bg-white/[0.12] text-white/70 hover:bg-white/[0.20] active:bg-white/[0.28]'
      }`}
    >
      {children}
    </button>
  );
}

export default function TV() {
  const [status, setStatus] = useState(null);
  const [apps, setApps] = useState([]);
  const [error, setError] = useState(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [typeText, setTypeText] = useState('');
  const prevTextRef = useRef('');

  const fetchStatus = useCallback(() => {
    axios
      .get('/api/tv/status')
      .then((r) => {
        setStatus(r.data);
        setError(null);
      })
      .catch((e) => setError(e.response?.data?.error ?? 'Unreachable'));
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, 5000);
    return () => clearInterval(id);
  }, [fetchStatus]);

  useEffect(() => {
    axios
      .get('/api/tv/apps')
      .then((r) => setApps(r.data))
      .catch(() => {});
  }, []);

  const key = (k) => axios.post(`/api/tv/keypress/${k}`).catch(console.warn);

  const launch = (id) => {
    axios.post(`/api/tv/launch/${id}`).catch(console.warn);
    setTimeout(fetchStatus, 1500);
  };

  const handleTypeChange = useCallback((e) => {
    const newText = e.target.value;
    const prev = prevTextRef.current;
    if (newText.length > prev.length) {
      const added = newText.slice(prev.length);
      for (const char of added) {
        axios.post(`/api/tv/keypress/Lit_${encodeURIComponent(char)}`).catch(console.warn);
      }
    } else if (newText.length < prev.length) {
      const removed = prev.length - newText.length;
      for (let i = 0; i < removed; i++) key('Backspace');
    }
    prevTextRef.current = newText;
    setTypeText(newText);
  }, []);

  const closeKeyboard = useCallback(() => {
    setKeyboardOpen(false);
    setTypeText('');
    prevTextRef.current = '';
  }, []);

  const { appId, appName, playerState } = status ?? {};
  const isPlaying = playerState === 'play';

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 pb-8">
        <span className="w-2 h-2 rounded-full bg-white/20" />
        <p className="text-[11px] uppercase tracking-widest text-white/25 mt-1">
          {error.includes('ROKU_IP') ? 'ROKU_IP not configured' : 'TV Offline'}
        </p>
        {error.includes('ROKU_IP') && <p className="text-white/15 text-xs">Add ROKU_IP to your .env file</p>}
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      {/* ── Top bar — z-30 keeps it above the FAB dismiss overlay ── */}
      <div className="relative z-30 shrink-0 flex items-center gap-2 px-4 py-2 border-b border-subtle">
        {/* Now Playing + Keyboard/Remote */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {appId && (
            <img
              src={`/api/tv/icon/${appId}`}
              alt={appName}
              className="w-8 h-6 object-contain rounded shrink-0"
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          )}
          <span className="text-sm text-white/60 truncate">{appName ?? '—'}</span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlaying ? 'bg-online' : 'bg-white/20'}`} />
          {playerState && STATE_LABEL[playerState] && (
            <span className="text-[9px] text-white/25 uppercase tracking-wider shrink-0">
              {STATE_LABEL[playerState]}
            </span>
          )}
          <div className="flex items-center gap-4 ml-auto shrink-0">
            <BarBtn onClick={() => setKeyboardOpen((v) => !v)} active={keyboardOpen}>
              <KeyboardIcon size={24} />
            </BarBtn>
            <BarBtn onClick={() => setRemoteOpen((v) => !v)} active={remoteOpen}>
              <RemoteIcon size={24} />
            </BarBtn>
          </div>
        </div>
        {/* Power — separated by divider */}
        <div className="shrink-0 pl-3 border-l border-white/[0.08]">
          <BarBtn onClick={() => key('PowerOff')} danger>
            <PowerIcon size={24} />
          </BarBtn>
        </div>
      </div>

      {/* ── App Grid ── */}
      <div className="flex-1 overflow-y-auto app-scrollbar" data-no-swipe>
        {apps.length === 0 ? (
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
          {/* Dismiss on tap outside — top bar sits above this at z-30 */}
          <div className="absolute inset-0 z-10" onClick={() => setRemoteOpen(false)} />

          {/* Bottom-left: D-pad */}
          <div
            className="absolute bottom-4 left-4 z-20 p-4 rounded-2xl bg-black/50 backdrop-blur-sm"
            data-no-swipe
          >
            <div className="relative w-52 h-52">
              <div className="absolute inset-0 rounded-full bg-white/[0.06]" />
              <button
                onClick={() => key('Up')}
                className="absolute top-0 left-1/2 -translate-x-1/2 w-14 h-14 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors"
              >
                <ChevronUpIcon size={28} />
              </button>
              <button
                onClick={() => key('Down')}
                className="absolute bottom-0 left-1/2 -translate-x-1/2 w-14 h-14 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors"
              >
                <ChevronDownIcon size={28} />
              </button>
              <button
                onClick={() => key('Left')}
                className="absolute left-0 top-1/2 -translate-y-1/2 w-14 h-14 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors"
              >
                <ChevronLeftIcon size={28} />
              </button>
              <button
                onClick={() => key('Right')}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-14 h-14 flex items-center justify-center text-white/60 hover:text-white/90 touch-manipulation transition-colors"
              >
                <ChevronRightIcon size={28} />
              </button>
              <button
                onClick={() => key('Select')}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-white/[0.14] text-white/70 hover:bg-white/[0.22] active:bg-white/[0.30] flex items-center justify-center touch-manipulation transition-colors"
              >
                <span className="text-xs font-bold uppercase tracking-widest">OK</span>
              </button>
            </div>
          </div>

          {/* Bottom-right: Nav + Transport + Volume */}
          <div
            className="absolute bottom-4 right-4 z-20 p-4 rounded-2xl bg-black/50 backdrop-blur-sm flex flex-col gap-3"
            data-no-swipe
          >
            <div className="flex justify-around gap-3">
              <FlatBtn onClick={() => key('Back')}>
                <BackIcon />
              </FlatBtn>
              <FlatBtn onClick={() => key('Home')}>
                <HomeIcon size={22} />
              </FlatBtn>
            </div>
            <div className="flex items-center gap-3">
              <FlatBtn onClick={() => key('Rev')}>
                <ScanBackIcon size={22} />
              </FlatBtn>
              <RoundBtn lg onClick={() => key('Play')}>
                {isPlaying ? <PauseIcon /> : <PlayIcon size={28} />}
              </RoundBtn>
              <FlatBtn onClick={() => key('Fwd')}>
                <ScanFwdIcon size={22} />
              </FlatBtn>
            </div>
            <div className="flex items-center gap-3">
              <FlatBtn onClick={() => key('VolumeDown')}>
                <VolumeDownIcon size={22} />
              </FlatBtn>
              <RoundBtn onClick={() => key('VolumeMute')} dim>
                <VolumeMuteIcon size={24} />
              </RoundBtn>
              <FlatBtn onClick={() => key('VolumeUp')}>
                <VolumeUpIcon size={22} />
              </FlatBtn>
            </div>
          </div>
        </>
      )}

      {/* ── Keyboard input ── */}
      {keyboardOpen && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={closeKeyboard}>
          <div
            className="border-t border-white/10 bg-[#111] px-4 py-3 flex gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={typeText}
              onChange={handleTypeChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') key('Enter');
              }}
              placeholder="Keys send in real time…"
              className="flex-1 bg-white/[0.08] text-white/80 placeholder-white/20 rounded-lg px-4 py-2.5 outline-none text-sm"
            />
            <button
              onClick={() => key('Enter')}
              className="px-4 py-2.5 bg-white/[0.10] text-white/60 rounded-lg text-sm hover:bg-white/[0.16] touch-manipulation transition-colors"
            >
              ↵
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
