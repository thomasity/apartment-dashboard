import React, { createContext, useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { useConnectivity } from '../hooks/useConnectivity';
import { useClock } from '../hooks/useClock';
import { wmo } from '../lib/wmo';
import type { WeatherData } from '../types';

/** Right-now summary used by the Home strip, Header, and Weather page */
type WeatherToday = {
    icon: string;
    label: string;
    temperature: number;
    high: number | null;
    low: number | null;
    /** Precipitation chance for the current hour */
    precip: number | null;
}

type WeatherContextValue = {
    data: WeatherData | null;
    today: WeatherToday | null;
    error: boolean
}

export const WeatherContext = createContext<WeatherContextValue | null>(null);

export function WeatherProvider({ children } : { children: React.ReactNode }) {
    const [data,  setData]  = useState<WeatherData | null>(null);
    const [error, setError] = useState(false);
    const { online, recheck } = useConnectivity();
    const hour = useClock().now.getHours();

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

    // This provider re-renders with the clock every second; memoizing on the hour
    // keeps weather consumers from re-rendering along with it.
    const value = useMemo(() => {
        let today: WeatherToday | null = null;
        if (data) {
            const { label, icon } = wmo(data.current.weather_code);
            const max = data.daily.temperature_2m_max[0];
            const min = data.daily.temperature_2m_min[0];
            today = {
                icon,
                label,
                temperature: Math.round(data.current.temperature_2m),
                high:        max !== undefined ? Math.round(max) : null,
                low:         min !== undefined ? Math.round(min) : null,
                precip:      data.hourly.precipitation_probability?.[hour] ?? null,
            };
        }
        return { data, today, error };
    }, [data, error, hour]);

    return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}
