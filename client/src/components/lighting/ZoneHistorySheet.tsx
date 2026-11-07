import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import type { ZoneExplanation } from '../../types';
import { useLighting } from '../../hooks/useLighting';
import styles from './ZoneHistorySheet.module.css';

const time = (at: number) => {
  const d = new Date(at);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `Yesterday ${t}`;
};

/** "Why is this room like this?" — the server's explanation plus the last 24 hours. */
export default function ZoneHistorySheet({ zone, onClose }: { zone: string; onClose: () => void }) {
  const { zones, resumeZone } = useLighting();
  const [info, setInfo] = useState<ZoneExplanation | null>(null);

  // Refetch whenever the zone's state changes, so resuming updates the sheet in place
  const zoneState = JSON.stringify(zones[zone] ?? null);
  const load = useCallback(() => {
    axios
      .get<ZoneExplanation[]>('/api/lighting/explain', { params: { group: zone } })
      .then((r) => setInfo(r.data[0] ?? null))
      .catch(() => {});
  }, [zone]);
  useEffect(load, [load, zoneState]);

  const canResume = info && (info.control === 'manual' || info.blocked.some((b) => b.startsWith('Motion won')));

  return (
    <div className={styles.backdrop} onClick={onClose} data-no-swipe>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{info?.name ?? ''}</span>
          <button onClick={onClose} className={styles.close}>Done</button>
        </div>

        {info && (
          <>
            <div className={styles.reasons}>
              {info.reasons.map((r) => <p key={r} className={styles.reason}>{r}</p>)}
              {info.blocked.map((b) => <p key={b} className={styles.blocked}>{b}</p>)}
            </div>

            {canResume && (
              <button
                onClick={() => {
                  resumeZone(zone);
                  // A cooldown ending doesn't change zone state, so refetch directly too
                  setTimeout(load, 300);
                }}
                className={styles.resume}
              >
                Hand back to automation
              </button>
            )}

            <div>
              <p className={styles.sectionTitle}>Last 24 hours</p>
              {info.history.length === 0 ? (
                <p className={styles.empty}>Nothing has changed</p>
              ) : (
                <ul className={styles.history}>
                  {[...info.history].reverse().map((h) => (
                    <li key={`${h.at}-${h.text}`} className={styles.entry}>
                      <span className={styles.entryTime}>{time(h.at)}</span>
                      <span className={styles.entryText}>{h.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
