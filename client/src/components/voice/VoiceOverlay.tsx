import type { VoiceStatus } from '../../hooks/useVoice';

interface Props {
  status: VoiceStatus;
  transcript: string;
  response: string;
  onCancel: () => void;
  onInterrupt: () => void;
  activeVoice: string;
}

export default function VoiceOverlay({ status, transcript, response, onCancel, onInterrupt, activeVoice }: Props) {
  const STATUS_LABEL: Record<VoiceStatus, string> = {
    idle:       '',
    listening:  'Listening…',
    processing: 'Thinking…',
    speaking:   activeVoice,
  };

  if (status === 'idle') return null;

  const bodyText = status === 'speaking'   ? response
                 : status === 'listening'  ? (transcript || '…')
                 : transcript;

  return (
    <div
      className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm flex flex-col items-center justify-center"
      onClick={status === 'speaking' ? onInterrupt : onCancel}
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
  );
}
