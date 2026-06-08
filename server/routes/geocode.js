const express = require('express');
const axios   = require('axios');

const router = express.Router();

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours — location never changes for a kiosk
let cache = {};

router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon are required' });
  }

  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;

  if (cache[key] && Date.now() - cache[key].at < CACHE_TTL) {
    return res.json(cache[key].data);
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params:  { lat, lon, format: 'json' },
      headers: { 'User-Agent': 'ApartmentDashboard/1.0 (home kiosk)' },
      timeout: 10000,
    });

    const { address } = response.data;
    const city  = address.city || address.town || address.village || address.county || '';
    const state = address.state || '';

    const data = { city, state };
    cache[key] = { data, at: Date.now() };
    res.json(data);
  } catch (err) {
    console.error('Geocode failed:', err.message);
    if (cache[key]) return res.json(cache[key].data);
    res.status(503).json({ error: 'Geocoding unavailable' });
  }
});

module.exports = router;
