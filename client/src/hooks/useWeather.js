import { useState, useEffect } from 'react';
import axios from 'axios';

export function useWeather() {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axios.get('/api/weather');
        setData(res.data);
        setError(false);
      } catch {
        setError(true);
      }
    };
    load();
    const id = setInterval(load, 10 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return { data, error };
}
