const express = require('express');
const axios = require('axios');

const router = express.Router();

const CACHE_TTL   = 10 * 60 * 1000;
const DEFAULT_LAT = parseFloat(process.env.LATITUDE)  || 38.627;
const DEFAULT_LON = parseFloat(process.env.LONGITUDE) || -90.1994;
let cache = {};

router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat) || DEFAULT_LAT;
  const lon = parseFloat(req.query.lon) || DEFAULT_LON;
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;

  if (cache[key] && Date.now() - cache[key].at < CACHE_TTL) {
    return res.json(cache[key].data);
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
    console.error('Weather fetch failed:', err.message);
    if (cache[key]) return res.json(cache[key].data);
    res.status(503).json({ error: 'Weather data unavailable' });
  }
});

module.exports = router;
