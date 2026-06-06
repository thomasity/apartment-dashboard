import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import axios from 'axios';

const PERIODS = ['1D', '1W', '1M', '3M'];

function money(val, compact = false) {
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return '$' + n.toLocaleString('en-US', {
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function sign(n) { return n >= 0 ? '+' : ''; }

export default function Stocks() {
  const [account,   setAccount]   = useState(null);
  const [positions, setPositions] = useState([]);
  const [chartBars, setChartBars] = useState([]);
  const [spySnap,   setSpySnap]   = useState(null);
  const [period,    setPeriod]    = useState('1M');
  const [error,     setError]     = useState(null);

  const containerRef = useRef(null);
  const chartRef     = useRef(null);
  const seriesRef    = useRef(null);

  // ── Data fetching ─────────────────────────────────────────

  const loadPortfolio = useCallback(async () => {
    try {
      const [accRes, posRes] = await Promise.all([
        axios.get('/api/stocks/account'),
        axios.get('/api/stocks/positions'),
      ]);
      setAccount(accRes.data);
      setPositions(posRes.data);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error ?? 'Failed to load');
    }
  }, []);

  const loadMarket = useCallback(async () => {
    try {
      const res = await axios.get('/api/stocks/market');
      setSpySnap(res.data?.SPY ?? null);
    } catch {}
  }, []);

  const loadChart = useCallback(async () => {
    try {
      const res = await axios.get('/api/stocks/chart', {
        params: { symbol: 'SPY', period },
      });
      setChartBars(res.data);
    } catch {}
  }, [period]);

  useEffect(() => {
    loadPortfolio();
    const id = setInterval(loadPortfolio, 60_000);
    return () => clearInterval(id);
  }, [loadPortfolio]);

  useEffect(() => {
    loadMarket();
    const id = setInterval(loadMarket, 60_000);
    return () => clearInterval(id);
  }, [loadMarket]);

  useEffect(() => {
    loadChart();
    const ttl = ['1D', '1W'].includes(period) ? 2 * 60_000 : 5 * 60_000;
    const id  = setInterval(loadChart, ttl);
    return () => clearInterval(id);
  }, [loadChart, period]);

  // ── Chart initialisation ──────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(255,255,255,0.3)',
        fontFamily: "'Inter', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.15)', labelBackgroundColor: '#1e1e2e' },
        horzLine: { color: 'rgba(255,255,255,0.15)', labelBackgroundColor: '#1e1e2e' },
      },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.06)' },
      timeScale:       { borderColor: 'rgba(255,255,255,0.06)', timeVisible: true, secondsVisible: false },
      handleScroll:    false,
      handleScale:     false,
    });

    const series = chart.addAreaSeries({
      lineColor:   '#818cf8',
      topColor:    'rgba(129,140,248,0.2)',
      bottomColor: 'rgba(129,140,248,0.0)',
      lineWidth:   2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius:  5,
    });

    chartRef.current  = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  // ── Chart data updates ────────────────────────────────────

  useEffect(() => {
    if (!seriesRef.current || !chartBars.length) return;

    const data = chartBars
      .map((b) => ({
        // Always use UTCTimestamp (seconds) for consistent type across all periods
        time:  Math.floor(new Date(b.t).getTime() / 1000),
        value: b.c,
      }))
      .sort((a, b) => a.time - b.time);

    try {
      seriesRef.current.setData(data);
      chartRef.current?.timeScale().fitContent();
    } catch (e) {
      // Series may have been removed during period switch — next render will retry
    }
  }, [chartBars]);

  // ── Derived account values ────────────────────────────────

  const equity     = parseFloat(account?.equity      ?? 0);
  const lastEquity = parseFloat(account?.last_equity ?? 0);
  const dayPnl     = equity - lastEquity;
  const dayPnlPct  = lastEquity ? (dayPnl / lastEquity) * 100 : 0;
  const isUp       = dayPnl >= 0;

  const spyPrice   = parseFloat(spySnap?.latestTrade?.p   ?? 0);
  const spyPrev    = parseFloat(spySnap?.prevDailyBar?.c  ?? 0);
  const spyChange  = spyPrice - spyPrev;
  const spyPct     = spyPrev ? (spyChange / spyPrev) * 100 : 0;
  const spyUp      = spyChange >= 0;

  // ── Render ────────────────────────────────────────────────

  if (error && !account) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-white/25 text-sm p-8 text-center">
        <span className="text-4xl">📈</span>
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="h-full flex overflow-hidden">

      {/* ── Left: account summary + chart ── */}
      <div className="flex-1 min-w-0 flex flex-col p-6 gap-4 border-r border-white/[0.05] overflow-hidden">

        {/* Summary: portfolio + S&P side by side */}
        <div className="shrink-0 flex gap-6">
          {/* S&P 500 */}
          <div className="flex-1">
            <div className="text-[10px] font-medium text-white/25 uppercase tracking-widest mb-1.5">
              State Street SPDR S&P 500 ETF Trust
            </div>
            {spySnap ? (
              <>
                <div className="font-thin text-white leading-none"
                     style={{ fontSize: 'clamp(1.6rem, 3.2vw, 2.8rem)' }}>
                  ${spyPrice.toFixed(2)}
                </div>
                <div className={`text-sm mt-1.5 tabular-nums ${spyUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {sign(spyChange)}{money(spyChange)} ({sign(spyPct)}{spyPct.toFixed(2)}%) today
                </div>
              </>
            ) : (
              <div className="text-white/20 animate-pulse text-sm mt-1">Loading…</div>
            )}
          </div>

          {/* Divider */}
          <div className="w-px bg-white/[0.05] shrink-0 self-stretch" />

          {/* Portfolio */}
          <div className="shrink-0 min-w-0">
            <div className="text-[10px] font-medium text-white/25 uppercase tracking-widest mb-1.5">
              Portfolio
            </div>
            {account ? (
              <>
                <div className="font-thin text-white leading-none"
                     style={{ fontSize: 'clamp(1.6rem, 3.2vw, 2.8rem)' }}>
                  {money(account.equity)}
                </div>
                <div className={`text-sm mt-1.5 tabular-nums ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {sign(dayPnl)}{money(dayPnl)} ({sign(dayPnlPct)}{dayPnlPct.toFixed(2)}%) today
                </div>
              </>
            ) : (
              <div className="text-white/20 animate-pulse text-sm mt-1">Loading…</div>
            )}
          </div>
        </div>

        {/* Chart canvas */}
        <div className="shrink-0 text-[10px] font-medium text-white/25 uppercase tracking-widest -mb-2">
          S&P 500 — SPY
        </div>
        <div ref={containerRef} className="flex-1 min-h-0" />

        {/* Period picker */}
        <div className="shrink-0 flex items-center gap-2">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium tracking-widest uppercase transition-colors touch-manipulation ${
                period === p
                  ? 'bg-white/[0.12] text-white'
                  : 'text-white/30 hover:text-white/60 active:text-white/80'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: positions ── */}
      <div className="w-72 shrink-0 flex flex-col p-5 overflow-hidden">
        <div className="text-[10px] font-medium text-white/25 uppercase tracking-widest mb-4 shrink-0">
          Positions
        </div>

        {positions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-white/20 text-sm">
            No open positions
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col">
            {positions.map((pos) => {
              const pl    = parseFloat(pos.unrealized_pl);
              const plPct = parseFloat(pos.unrealized_plpc) * 100;
              const up    = pl >= 0;

              return (
                <div
                  key={pos.symbol}
                  className="border-b border-white/[0.04] last:border-0 py-3"
                >
                  <div className="flex items-baseline justify-between">
                    <span className="text-base font-medium text-white/70">
                      {pos.symbol}
                    </span>
                    <span className="text-base font-light text-white tabular-nums">
                      ${parseFloat(pos.current_price).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between mt-0.5">
                    <span className="text-xs text-white/30">
                      {pos.qty} sh · {money(pos.market_value, true)}
                    </span>
                    <span className={`text-sm font-medium tabular-nums ${up ? 'text-emerald-400' : 'text-red-400'}`}>
                      {sign(plPct)}{plPct.toFixed(2)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
