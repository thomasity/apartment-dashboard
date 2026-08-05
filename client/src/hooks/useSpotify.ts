import { useContext } from 'react';
import { SpotifyContext } from '../context/spotifyContext';

export function useSpotify() {
  const ctx = useContext(SpotifyContext)
  if (!ctx) throw new Error('useSpotify must be used within a SpotifyProvider');
  return ctx
}
