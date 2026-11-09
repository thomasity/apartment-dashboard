import React, { createContext, useState, useRef, useCallback, useEffect } from 'react';
import type { VoiceStatus } from '../types';
import { useSpotify } from '../hooks/useSpotify';
import { useConnectivity } from '../hooks/useConnectivity';
import { getSocket } from '../lib/socket';

type Message = { role: 'user' | 'assistant'; content: string };
const MAX_HISTORY = 12; // 6 exchanges
const DUCK_VOLUME = 15;
const ACTIVE_EVERY_MS = 30_000;

type VoiceContextValue = {
  status: VoiceStatus;
  transcript: string;
  response: string;
  activeVoice: string;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  interrupt: () => void;
  /** What the mic button does: start, stop listening, talk over the reply, or cancel */
  toggle: () => void;
  /** Voice needs Claude + ElevenLabs. Only blocks starting — an in-progress session can still be stopped. */
  micDisabled: boolean;
  clearHistory: () => void;
};

export const VoiceContext = createContext<VoiceContextValue | null>(null);

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const { state: spotify, setVolume } = useSpotify();
  const { online } = useConnectivity();
  const [status,     setStatus]     = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [response,   setResponse]   = useState('');
  const [activeVoice, setActiveVoice] = useState('Jarvis');

  const recogRef      = useRef<any>(null);
  const audioRef      = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef   = useRef<AudioContext | null>(null);
  const transcriptRef = useRef('');
  const finalsRef     = useRef('');
  const historyRef    = useRef<Message[]>([]);
  const relistenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noSpeechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipOnEnded   = useRef(false);
  const startRef      = useRef<(() => void) | null>(null);

  const clearHistory = useCallback(() => {
    historyRef.current = [];
  }, []);

  const cancel = useCallback(() => {
    if (relistenTimer.current) clearTimeout(relistenTimer.current);
    if (silenceTimer.current)  clearTimeout(silenceTimer.current);
    if (noSpeechTimer.current) clearTimeout(noSpeechTimer.current);
    recogRef.current?.abort();
    skipOnEnded.current = true;
    try { audioRef.current?.stop(); } catch {}
    audioRef.current = null;
    setStatus('idle');
    setTranscript('');
    setResponse('');
    transcriptRef.current = '';
  }, []);

  const interrupt = useCallback(() => {
    if (relistenTimer.current) clearTimeout(relistenTimer.current);
    if (silenceTimer.current)  clearTimeout(silenceTimer.current);
    if (noSpeechTimer.current) clearTimeout(noSpeechTimer.current);
    skipOnEnded.current = true;
    try { audioRef.current?.stop(); } catch {}
    audioRef.current = null;
    startRef.current?.();
  }, []);

  const speak = useCallback(async (text: string, keepListening = false) => {
    if (!text.trim()) {
      if (keepListening) {
        relistenTimer.current = setTimeout(() => startRef.current?.(), 900);
      } else {
        setStatus('idle');
      }
      return;
    }
    fetch('/api/voice/voices')
      .then((res) => res.json())
      .then((data) => { if (data.active) setActiveVoice(data.active); })
      .catch(() => {});

    setStatus('speaking');
    setResponse(text);
    try {
      const res = await fetch('/api/voice/speak', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        console.error('[voice] TTS error:', err);
        setStatus('idle');
        return;
      }
      const arrayBuffer = await res.arrayBuffer();
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
        audioCtxRef.current = new AudioContext();
      }
      const ctx         = audioCtxRef.current;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source      = ctx.createBufferSource();
      source.buffer     = audioBuffer;
      source.connect(ctx.destination);
      source.onended = () => {
        audioRef.current = null;
        if (skipOnEnded.current) { skipOnEnded.current = false; return; }
        if (keepListening) {
          relistenTimer.current = setTimeout(() => startRef.current?.(), 900);
        } else {
          setStatus('idle');
        }
      };
      audioRef.current = source;
      source.start(ctx.currentTime + 0.15);
    } catch (err) {
      console.error('[voice] speak error:', err);
      setStatus('idle');
    }
  }, []);

  const sendTranscript = useCallback(async (text: string) => {
    setStatus('processing');
    try {
      const history = historyRef.current;
      const res  = await fetch('/api/voice/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text, history, room: 'tablet' }),
      });
      const data          = await res.json() as { reply?: string; keepListening?: boolean };
      const reply         = data.reply ?? '';
      const keepListening = data.keepListening ?? false;

      historyRef.current = [
        ...history,
        { role: 'user'      as const, content: text  },
        { role: 'assistant' as const, content: reply },
      ].slice(-MAX_HISTORY);

      speak(reply, keepListening);
    } catch {
      speak("Sorry, something went wrong.");
    }
  }, [speak]);

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert('Speech recognition is not supported. Please use Chrome.');
      return;
    }

    const recog = new SR();
    recogRef.current      = recog;
    recog.continuous      = true;
    recog.interimResults  = true;
    recog.lang            = 'en-US';
    transcriptRef.current = '';
    finalsRef.current     = '';

    setTranscript('');
    setResponse('');
    setStatus('listening');

    noSpeechTimer.current = setTimeout(() => recog.stop(), 6000);

    recog.onresult = (e: any) => {
      if (noSpeechTimer.current) { clearTimeout(noSpeechTimer.current); noSpeechTimer.current = null; }

      // Only process results starting at e.resultIndex to avoid re-joining
      // already-seen results, which causes duplication on some browsers.
      let newFinals = '';
      let interim   = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const segment = e.results[i][0].transcript;
        if (e.results[i].isFinal) newFinals += segment;
        else                       interim   += segment;
      }

      if (newFinals) {
        finalsRef.current += newFinals;
        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(() => recog.stop(), 1500);
      }

      const full = finalsRef.current + interim;
      transcriptRef.current = full;
      setTranscript(full);
    };

    recog.onend = () => {
      if (silenceTimer.current)  clearTimeout(silenceTimer.current);
      if (noSpeechTimer.current) { clearTimeout(noSpeechTimer.current); noSpeechTimer.current = null; }
      const text = transcriptRef.current.trim();
      if (text) {
        sendTranscript(text);
      } else {
        setStatus('idle');
      }
      transcriptRef.current = '';
      finalsRef.current     = '';
    };

    recog.onerror = (e: any) => {
      if (e.error !== 'aborted') setStatus('idle');
    };

    recog.start();
  }, [sendTranscript]);

  startRef.current = start;

  const stop = useCallback(() => {
    recogRef.current?.stop();
  }, []);

  const toggle = useCallback(() => {
    if (status === 'idle')           start();
    else if (status === 'listening') stop();
    else if (status === 'speaking')  interrupt();
    else                             cancel();
  }, [status, start, stop, interrupt, cancel]);

  // Duck Spotify while a voice session is active, then restore the previous volume
  const preDuckVolume = useRef<number | null>(null);
  useEffect(() => {
    if (status !== 'idle') {
      if (preDuckVolume.current === null && spotify?.isPlaying && spotify.device?.volume != null && spotify.device.volume > DUCK_VOLUME) {
        preDuckVolume.current = spotify.device.volume;
        setVolume(DUCK_VOLUME);
      }
    } else {
      if (preDuckVolume.current !== null) {
        setVolume(preDuckVolume.current);
        preDuckVolume.current = null;
      }
    }
  }, [status]);

  // ── The assistant's remarks, read aloud ─────────────────────────────────────
  // A browser only plays sound after a tap, so a tap unlocks audio here and tells the
  // server this dashboard is the one to speak (the most recently touched one does).
  // Remarks wait while a voice session is going and are read once it's idle.
  const sayQueue = useRef<string[]>([]);
  const [saysWaiting, setSaysWaiting] = useState(0);

  useEffect(() => {
    let lastActive = 0;
    const onTouch = () => {
      if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') audioCtxRef.current = new AudioContext();
      audioCtxRef.current.resume().catch(() => {});
      if (Date.now() - lastActive < ACTIVE_EVERY_MS) return;
      lastActive = Date.now();
      getSocket().emit('assistant:active');
    };
    const onSay = ({ text }: { id: string; text: string }) => {
      sayQueue.current.push(text);
      setSaysWaiting((n) => n + 1);
    };
    window.addEventListener('pointerdown', onTouch);
    const socket = getSocket();
    socket.on('assistant:say', onSay);
    return () => {
      window.removeEventListener('pointerdown', onTouch);
      socket.off('assistant:say', onSay);
    };
  }, []);

  useEffect(() => {
    if (status !== 'idle') return;
    const next = sayQueue.current.shift();
    if (next) speak(next);
  }, [status, saysWaiting, speak]);

  const micDisabled = !online && status === 'idle';

  const value = { status, transcript, response, activeVoice, start, stop, cancel, interrupt, toggle, micDisabled, clearHistory };

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}
