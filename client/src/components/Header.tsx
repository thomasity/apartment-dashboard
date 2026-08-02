import { useClock }   from '../hooks/useClock';
import { useWeather } from '../hooks/useWeather';
import { useSpotify } from '../hooks/useSpotify';
import { wmo }        from '../lib/wmo';
import type { VoiceStatus } from '../hooks/useVoice';
import { MicrophoneIcon } from './icons';

interface Props {
  micStatus: VoiceStatus;
  onMicClick: () => void;
}

export default function Header({ micStatus, onMicClick }: Props) {
  const now             = useClock();
  const { data }        = useWeather();
  const { state: spot } = useSpotify();
  const current         = data?.current ?? null;

  const h      = now.getHours();
  const m      = String(now.getMinutes()).padStart(2, '0');
  const ampm   = h >= 12 ? 'PM' : 'AM';
  const hour   = String(h % 12 || 12);
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
  });

  return (
    <div className="relative shrink-0 flex items-center justify-between px-6 border-b border-subtle"
         style={{ height: '52px' }}>
      <div className="flex items-baseline gap-2 select-none">
        <span className="text-2xl font-thin text-white tracking-tight">
          {hour}:{m}
        </span>
        <span className="text-sm font-light text-white/30">{ampm}</span>
        <span className="text-sm font-light text-white/20 ml-2">{dateStr}</span>
      </div>

      {/* Center: now playing */}
      {spot?.item && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 select-none max-w-[200px]">
          <span className="text-white/30 text-xs">♪</span>
          <span className="text-xs text-white/40 truncate">{spot.item.name}</span>
          <span className="text-white/20 text-xs">·</span>
          <span className="text-xs text-white/25 truncate">{spot.item.artist}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {current && (
          <div className="flex items-center gap-2 select-none">
            <span className="text-lg leading-none">{wmo(current.weather_code).icon}</span>
            <span className="text-xl font-thin text-white/60">
              {Math.round(current.temperature_2m)}°
            </span>
          </div>
        )}
        <button
          onClick={onMicClick}
          data-no-swipe
          className={`flex items-center justify-center w-8 h-8 rounded-full border transition-colors touch-manipulation ${
            micStatus !== 'idle'
              ? 'bg-red-500/20 border-red-500/50 text-red-400'
              : 'bg-white/5 border-white/15 text-white/40 hover:text-white/60 hover:border-white/25'
          }`}
        >
          <MicrophoneIcon size={16} />
        </button>
      </div>
    </div>
  );
}
