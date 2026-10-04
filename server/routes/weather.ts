import express from 'express';
import axios from 'axios';
import { errorMessage } from '../util';

const router = express.Router();

const CACHE_TTL   = 10 * 60 * 1000;
const DEFAULT_LAT = parseFloat(process.env.LATITUDE ?? '')  || 38.627;
const DEFAULT_LON = parseFloat(process.env.LONGITUDE ?? '') || -90.1994;

// Open-Meteo's response is passed straight through to the client, so it stays untyped here.
const cache: Record<string, { data: unknown; at: number }> = {};

router.get('/', async (req, res) => {
  const lat = parseFloat(String(req.query.lat ?? '')) || DEFAULT_LAT;
  const lon = parseFloat(String(req.query.lon ?? '')) || DEFAULT_LON;
  // Round coords into the cache key so nearby requests (e.g. GPS jitter) share a cache entry.
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cache[key];

  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude:         lat,
        longitude:        lon,
        current:          'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m',
        hourly:           'temperature_2m,weather_code,precipitation_probability',
        daily:            'weather_code,temperature_2m_max,temperature_2m_min',
        temperature_unit: 'fahrenheit',
        wind_speed_unit:  'mph',
        forecast_days:    5,
        timezone:         'auto',
      },
      timeout: 10000,
    });

    cache[key] = { data: response.data, at: Date.now() };
    res.json(response.data);
  } catch (err) {
    console.error('Weather fetch failed:', errorMessage(err));
    // Prefer serving a stale forecast over an error screen on the dashboard.
    if (cached) return res.json(cached.data);
    res.status(503).json({ error: 'Weather data unavailable' });
  }
});

export default router;
