import { useState, useRef, useCallback } from 'react';

export type VoiceStatus = 'idle' | 'listening' | 'processing' | 'speaking';

export function useVoice() {
  const [status,     setStatus]     = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState('');
  const [response,   setResponse]   = useState('');

  const recogRef       = useRef<any>(null);
  const audioRef       = useRef<HTMLAudioElement | null>(null);
  const transcriptRef  = useRef('');

  const cancel = useCallback(() => {
    recogRef.current?.abort();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setStatus('idle');
    setTranscript('');
    setResponse('');
    transcriptRef.current = '';
  }, []);

  const speak = useCallback(async (text: string) => {
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
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        audioRef.current = null;
        setStatus('idle');
      };
      audio.onerror = (e) => {
        console.error('[voice] audio playback error:', e);
        setStatus('idle');
      };
      audio.play();
    } catch (err) {
      console.error('[voice] speak error:', err);
      setStatus('idle');
    }
  }, []);

  const sendTranscript = useCallback(async (text: string) => {
    setStatus('processing');
    try {
      const res  = await fetch('/api/voice/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ message: text }),
      });
      const data = await res.json() as { reply?: string };
      speak(data.reply ?? "Sorry, I didn't get a response.");
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
    recogRef.current        = recog;
    recog.continuous        = false;
    recog.interimResults    = true;
    recog.lang              = 'en-US';
    transcriptRef.current   = '';

    setTranscript('');
    setResponse('');
    setStatus('listening');

    recog.onresult = (e: any) => {
      const t = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join('');
      setTranscript(t);
      transcriptRef.current = t;
    };

    recog.onend = () => {
      const text = transcriptRef.current.trim();
      if (text) {
        sendTranscript(text);
      } else {
        setStatus('idle');
      }
      transcriptRef.current = '';
    };

    recog.onerror = (e: any) => {
      if (e.error !== 'aborted') setStatus('idle');
    };

    recog.start();
  }, [sendTranscript]);

  const stop = useCallback(() => {
    recogRef.current?.stop();
  }, []);

  return { status, transcript, response, start, stop, cancel };
}
