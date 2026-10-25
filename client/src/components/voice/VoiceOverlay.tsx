import type { VoiceStatus } from '../../types';
import styles from './VoiceOverlay.module.css';

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
      className={styles.backdrop}
      onClick={status === 'speaking' ? onInterrupt : onCancel}
    >
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
      >
        <p className={styles.status}>
          {STATUS_LABEL[status]}
        </p>
        {bodyText && (
          <p className={styles.transcript}>{bodyText}</p>
        )}
        {status === 'processing' && (
          <div className={styles.dots}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={styles.dot}
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
