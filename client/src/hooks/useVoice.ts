import { useContext } from 'react';
import { VoiceContext } from '../context/voiceContext';

export function useVoice() {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice must be used within a VoiceProvider');
  return ctx;
}
