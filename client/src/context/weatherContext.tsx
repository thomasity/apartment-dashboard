import React, { createContext, useState, useEffect } from 'react';
import axios from 'axios';

export interface WeatherCurrent {
  weather_code: number;
  temperature_2m: number;
  apparent_temperature: number;
  relative_humidity_2m: number;
  wind_speed_10m: number;
}

export interface WeatherHourly {
  time: string[];
  temperature_2m: number[];
  weather_code: number[];
  precipitation_probability: number[];
}

export interface WeatherDaily {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
}

export interface WeatherData {
  current: WeatherCurrent;
  hourly: WeatherHourly;
  daily: WeatherDaily;
}

type WeatherContextValue = {
    data: WeatherData | null;
    error: boolean
}

export const WeatherContext = createContext<WeatherContextValue | null>(null);

export function WeatherProvider({ children } : { children: React.ReactNode }) {
    const [data,  setData]  = useState<WeatherData | null>(null);
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

    const value = { data, error };

    return <WeatherContext.Provider value={value}>{children}</WeatherContext.Provider>;
}