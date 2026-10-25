import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useConnectivity } from '../hooks/useConnectivity';
import type { WeatherData } from '../types';

type WeatherContextValue = {
    data: WeatherData | null;
    error: boolean
}

export const WeatherContext = createContext<WeatherContextValue | null>(null);

export function WeatherProvider({ children } : { children: React.ReactNode }) {
    const [data,  setData]  = useState<WeatherData | null>(null);
    const [error, setError] = useState(false);
    const { online, recheck } = useConnectivity();

    // Pauses while offline (the last forecast stays on screen); reloads as soon as we're back.
    useEffect(() => {
        if (!online) return;
        const load = async () => {
        try {
            const res = await axios.get('/api/weather');
            setData(res.data);
            setError(false);
        } catch {
            setError(true);
            recheck();
        }
        };
        load();
        const id = setInterval(load, 10 * 60 * 1000);
        return () => clearInterval(id);
    }, [online, recheck]);

    const value = { data, error };

    return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}