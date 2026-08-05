import { useContext } from 'react';
import { WeatherContext } from '../context/weatherContext';

export function useWeather() {
  const ctx = useContext(WeatherContext);
  if (!ctx) throw new Error('useWeather must be used within a Weather Provider');
  return ctx;
}
