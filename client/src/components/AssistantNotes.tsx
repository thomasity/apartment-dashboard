import { useEffect, useState } from 'react';
import axios from 'axios';
import type { Notice } from '../types';
import { getSocket } from '../lib/socket';
import styles from './AssistantNotes.module.css';

const SHOW_MS = 2 * 60 * 60 * 1000;

/** The assistant's remarks, on whatever screen is showing, with Undo where it applies. */
export default function AssistantNotes() {
  const [notes, setNotes] = useState<Notice[]>([]);

  useEffect(() => {
    axios.get<Notice[]>('/api/assistant/notices').then((r) => setNotes(r.data)).catch(() => {});
    const onNotice = (n: Notice) => setNotes((prev) => [...prev.filter((p) => p.id !== n.id), n]);
    const socket = getSocket();
    socket.on('assistant:notice', onNotice);
    // Drop notes as they age out
    const tidy = setInterval(() => setNotes((prev) => prev.filter((n) => Date.now() - (n.deliveredAt ?? n.at) < SHOW_MS)), 60_000);
    return () => {
      socket.off('assistant:notice', onNotice);
      clearInterval(tidy);
    };
  }, []);

  const close = (id: string, action: 'dismiss' | 'undo') => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    axios.post(`/api/assistant/notices/${id}/${action}`).catch(console.warn);
  };

  if (!notes.length) return null;

  return (
    <div className={styles.stack} data-no-swipe>
      {notes.map((n) => (
        <div key={n.id} className={styles.note}>
          <p className={styles.text}>{n.text}</p>
          <div className={styles.actions}>
            {n.undo && <button onClick={() => close(n.id, 'undo')} className={styles.undo}>Undo</button>}
            <button onClick={() => close(n.id, 'dismiss')} className={styles.dismiss} title="Dismiss">✕</button>
          </div>
        </div>
      ))}
    </div>
  );
}
