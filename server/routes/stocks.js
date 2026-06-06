const express = require('express');
const axios   = require('axios');

const router = express.Router();

// Per-key cache store
const caches = {};

function cached(key) {
  const c = caches[key];
  return c && c.data && Date.now() - c.at < c.ttl ? c.data : null;
}

function store(key, data, ttl) {
  caches[key] = { data, at: Date.now(), ttl };
}

function stale(key) {
  return caches[key]?.data ?? null;
}

function tradingHeaders() {
  return {
    'APCA-API-KEY-ID':     process.env.ALPACA_KEY_ID,
    'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
  };
}

const TRADING_BASE = 'https://paper-api.alpaca.markets/v2';
const DATA_BASE    = 'https://data.alpaca.markets/v2';

// ── Account summary ─────────────────────────────────────────
router.get('/account', async (_req, res) => {
  const key  = 'account';
  const hit  = cached(key);
  if (hit) return res.json(hit);

  try {
    const r = await axios.get(`${TRADING_BASE}/account`, {
      headers: tradingHeaders(), timeout: 10000,
    });
    store(key, r.data, 60_000);
    res.json(r.data);
  } catch (err) {
    console.error('Account fetch failed:', err.message);
    const s = stale(key);
    if (s) return res.json(s);
    res.status(503).json({ error: 'Account data unavailable' });
  }
});

// ── Open positions ───────────────────────────────────────────
router.get('/positions', async (_req, res) => {
  const key = 'positions';
  const hit = cached(key);
  if (hit) return res.json(hit);

  try {
    const r = await axios.get(`${TRADING_BASE}/positions`, {
      headers: tradingHeaders(), timeout: 10000,
    });
    store(key, r.data, 60_000);
    res.json(r.data);
  } catch (err) {
    console.error('Positions fetch failed:', err.message);
    const s = stale(key);
    if (s) return res.json(s);
    res.status(503).json({ error: 'Positions data unavailable' });
  }
});

// ── Historical bars for chart ────────────────────────────────
router.get('/chart', async (req, res) => {
  const symbol = (req.query.symbol || 'SPY').toUpperCase();
  const period = req.query.period || '1M';
  const key    = `chart-${symbol}-${period}`;
  const hit    = cached(key);
  if (hit) return res.json(hit);

  const now  = new Date();
  let timeframe, start;

  switch (period) {
    case '1D':
      timeframe = '5Min';
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      start = d.toISOString();
      break;
    case '1W':
      timeframe = '1Hour';
      start = new Date(now - 7  * 86_400_000).toISOString();
      break;
    case '3M':
      timeframe = '1Day';
      start = new Date(now - 90 * 86_400_000).toISOString();
      break;
    default: // 1M
      timeframe = '1Day';
      start = new Date(now - 30 * 86_400_000).toISOString();
  }

  try {
    const r = await axios.get(`${DATA_BASE}/stocks/bars`, {
      params: { symbols: symbol, timeframe, start, feed: 'iex', limit: 1000 },
      headers: tradingHeaders(),
      timeout: 15_000,
    });

    const bars = r.data.bars?.[symbol] ?? [];
    // Cache 1D/1W data for 2 min, longer periods for 5 min
    store(key, bars, ['1D', '1W'].includes(period) ? 2 * 60_000 : 5 * 60_000);
    res.json(bars);
  } catch (err) {
    console.error('Chart fetch failed:', err.message);
    const s = stale(key);
    if (s) return res.json(s);
    res.status(503).json({ error: 'Chart data unavailable' });
  }
});

// ── SPY snapshot for S&P daily P&L ──────────────────────────
router.get('/market', async (_req, res) => {
  const key = 'market-spy';
  const hit = cached(key);
  if (hit) return res.json(hit);

  try {
    const r = await axios.get(`${DATA_BASE}/stocks/snapshots`, {
      params: { symbols: 'SPY', feed: 'iex' },
      headers: tradingHeaders(),
      timeout: 10_000,
    });
    store(key, r.data, 60_000);
    res.json(r.data);
  } catch (err) {
    console.error('Market snapshot failed:', err.message);
    const s = stale(key);
    if (s) return res.json(s);
    res.status(503).json({ error: 'Market data unavailable' });
  }
});

module.exports = router;
