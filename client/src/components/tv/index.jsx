import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import {
  PlayIcon, PauseIcon, ScanBackIcon, ScanFwdIcon,
  ChevronUpIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon,
  HomeIcon, BackIcon,
  VolumeUpIcon, VolumeDownIcon, VolumeMuteIcon,
  PowerIcon, RemoteIcon, KeyboardIcon, CastIcon, CheckIcon,
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
      className="w-24 h-20 rounded-item bg-zinc-700 text-white/70 flex items-center justify-center touch-manipulation hover:bg-zinc-600 active:bg-zinc-500 transition-colors"
    >
      {children}
    </button>
  );
}

function RoundBtn({ children, onClick, dim, lg }) {
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
  const [status, setStatus]               = useState(null);
  const [apps, setApps]                   = useState([]);
  const [error, setError]                 = useState(null);
  const [remoteOpen, setRemoteOpen]       = useState(false);
  const [keyboardOpen, setKeyboardOpen]   = useState(false);
  const [pickerOpen, setPickerOpen]       = useState(false);
  const [device, setDevice]               = useState(null);
  const [discovered, setDiscovered]       = useState([]);
  const [discovering, setDiscovering]     = useState(false);
  const [typeText, setTypeText]           = useState('');
  const prevTextRef                       = useRef('');

  const fetchStatus = useCallback(() => {
    axios
      .get('/api/tv/status')
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
    axios.get('/api/tv/device').then((r) => setDevice(r.data)).catch(() => {});
  }, []);

  const discover = useCallback(() => {
    setDiscovering(true);
    axios
      .get('/api/tv/discover')
      .then((r) => setDiscovered(r.data))
      .catch(() => {})
      .finally(() => setDiscovering(false));
  }, []);

  const selectDevice = useCallback((d) => {
    axios
      .post('/api/tv/select', { ip: d.ip, name: d.name })
      .then(() => { setDevice(d); setPickerOpen(false); })
      .catch(() => {});
  }, []);

  const openPicker = useCallback(() => {
    setPickerOpen(true);
    discover();
  }, [discover]);

  const key = (k) => axios.post(`/api/tv/keypress/${k}`).catch(console.warn);

  const launch = (id) => {
    axios.post(`/api/tv/launch/${id}`).catch(console.warn);
    setTimeout(fetchStatus, 1500);
  };

  const handleTypeChange = useCallback((e) => {
    const newText = e.target.value;
    const prev    = prevTextRef.current;
    if (newText.length > prev.length) {
      for (const char of newText.slice(prev.length)) {
        axios.post(`/api/tv/keypress/Lit_${encodeURIComponent(char)}`).catch(console.warn);
      }
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
          <button
            onClick={openPicker}
            className="mt-2 px-4 py-2 bg-white/[0.08] text-white/40 rounded-lg text-xs touch-manipulation hover:bg-white/[0.14] transition-colors"
          >
            Select Device
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative h-full flex flex-col">
      {/* ── Top bar ── */}
      <div className="relative z-30 shrink-0 flex items-center gap-2 px-4 py-2 border-b border-subtle">
        <div className="flex items-center gap-4 flex-1 min-w-0">
          {appId && (
            <img
              src={`/api/tv/icon/${appId}`}
              alt={appName}
              className="w-8 h-6 object-contain rounded shrink-0"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
          )}
          <span className="text-sm text-white/60 truncate">{appName ?? '—'}</span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPlaying ? 'bg-online' : 'bg-white/20'}`} />
          {playerState && STATE_LABEL[playerState] && (
            <span className="text-[9px] text-white/25 uppercase tracking-wider shrink-0">
              {STATE_LABEL[playerState]}
            </span>
          )}
          <div className="flex items-center gap-8 ml-auto shrink-0">
            <BarBtn onClick={openPicker} active={pickerOpen}>
              <CastIcon size={36} />
            </BarBtn>
            <BarBtn onClick={() => setKeyboardOpen((v) => !v)} active={keyboardOpen}>
              <KeyboardIcon size={36} />
            </BarBtn>
            <BarBtn onClick={() => setRemoteOpen((v) => !v)} active={remoteOpen}>
              <RemoteIcon size={36} />
            </BarBtn>
          </div>
        </div>
        <div className="shrink-0 pl-4 ml-4 border-l border-white/[0.08]">
          <BarBtn onClick={() => key('PowerOff')} danger>
            <PowerIcon size={36} />
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
