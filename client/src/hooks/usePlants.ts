import { useState, useEffect } from 'react';
import axios from 'axios';
import type { Plant } from '../types';

export function usePlants() {
  const [plants, setPlants] = useState<Plant[]>([]);

  useEffect(() => {
    const load = () => axios.get<Plant[]>('/api/plants').then(({ data }) => setPlants(data)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);

  return plants;
}
