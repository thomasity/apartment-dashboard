const express = require('express');
const axios = require('axios');

const router = express.Router();

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
let cache = { data: null, at: 0 };

router.get('/', async (_req, res) => {
  if (cache.data && Date.now() - cache.at < CACHE_TTL) {
    return res.json(cache.data);
  }

  try {
    const response = await axios.get('https://api.open-meteo.com/v1/forecast', {
      params: {
        latitude: 38.627,
        longitude: -90.1994,
        current: 'temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m',
        hourly: 'temperature_2m,weather_code,precipitation_probability',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min',
        temperature_unit: 'fahrenheit',
        wind_speed_unit: 'mph',
        forecast_days: 5,
        timezone: 'America/Chicago',
      },
      timeout: 10000,
    });

    cache = { data: response.data, at: Date.now() };
    res.json(response.data);
  } catch (err) {
    console.error('Weather fetch failed:', err.message);
    if (cache.data) return res.json(cache.data); // serve stale on error
    res.status(503).json({ error: 'Weather data unavailable' });
  }
});

module.exports = router;
