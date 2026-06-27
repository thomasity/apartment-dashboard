import { useVoice, VoiceStatus } from '../../hooks/useVoice';

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle:       '',
  listening:  'Listening…',
  processing: 'Thinking…',
  speaking:   'Jarvis',
};

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={`w-6 h-6 transition-colors ${active ? 'text-red-400' : 'text-white'}`} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8"  y1="22" x2="16" y2="22" />
    </svg>
  );
}

function PulsingRing() {
  return (
    <span className="absolute inset-0 rounded-full animate-ping bg-red-500/30 pointer-events-none" />
  );
}

export default function VoiceOverlay() {
  const { status, transcript, response, start, stop, cancel } = useVoice();

  const active  = status !== 'idle';
  const bodyText = status === 'speaking'   ? response
                 : status === 'listening'  ? (transcript || '…')
                 : status === 'processing' ? transcript
                 : '';

  function handleMicClick() {
    if (status === 'idle')      start();
    else if (status === 'listening') stop();
    else                        cancel();
  }

  return (
    <>
      {/* Backdrop when active */}
      {active && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center"
          onClick={cancel}
        >
          <div
            className="bg-black/60 border border-white/10 rounded-2xl px-6 py-5 max-w-xs w-[85%] flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] font-medium tracking-widest uppercase text-[--color-subtle-text]">
              {STATUS_LABEL[status]}
            </p>
            {bodyText && (
              <p className="text-sm text-[--color-text] leading-relaxed">{bodyText}</p>
            )}
            {status === 'processing' && (
              <div className="flex gap-1.5 mt-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-white/50 animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating mic button — always on top */}
      <div className="fixed bottom-[72px] left-1/2 -translate-x-1/2 z-40">
        <button
          onClick={handleMicClick}
          data-no-swipe
          className={`relative w-12 h-12 rounded-full border backdrop-blur-sm flex items-center justify-center touch-manipulation transition-all duration-200 ${
            active
              ? 'bg-red-500/20 border-red-500/50'
              : 'bg-white/10 border-white/20 hover:bg-white/15'
          }`}
        >
          {status === 'listening' && <PulsingRing />}
          <MicIcon active={active} />
        </button>
      </div>
    </>
  );
}
