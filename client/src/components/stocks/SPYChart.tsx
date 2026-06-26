import { useState, useEffect, useRef, useCallback } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import axios from 'axios';

const PERIODS = ['1D', '1W', '1M', '3M'];

export default function SPYChart() {
  const [chartBars, setChartBars] = useState<Array<{ t: string; c: number }>>([]);
  const [period,    setPeriod]    = useState('1M');

  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<'Area'> | null>(null);

  const loadChart = useCallback(async () => {
    try {
      const res = await axios.get('/api/stocks/chart', { params: { symbol: 'SPY', period } });
      setChartBars(res.data);
    } catch {}
  }, [period]);

  useEffect(() => {
    loadChart();
    const ttl = ['1D', '1W'].includes(period) ? 2 * 60_000 : 5 * 60_000;
    const id  = setInterval(loadChart, ttl);
    return () => clearInterval(id);
  }, [loadChart, period]);

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

  useEffect(() => {
    if (!seriesRef.current || !chartBars.length) return;

    const data = chartBars
      .map((b) => ({ time: Math.floor(new Date(b.t).getTime() / 1000) as UTCTimestamp, value: b.c }))
      .sort((a, b) => a.time - b.time);

    try {
      seriesRef.current.setData(data);
      chartRef.current?.timeScale().fitContent();
    } catch {
      // Series may have been removed during period switch — next render will retry
    }
  }, [chartBars]);

  return (
    <>
      <div className="shrink-0 text-[10px] font-medium text-white/25 uppercase tracking-widest -mb-2">
        S&P 500 — SPY
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />
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
    </>
  );
}
