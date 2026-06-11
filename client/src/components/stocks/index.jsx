import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import MarketSummary from './MarketSummary';
import SPYChart      from './SPYChart';
import PositionsList from './PositionsList';

export default function Stocks() {
  const [account,   setAccount]   = useState(null);
  const [positions, setPositions] = useState([]);
  const [spySnap,   setSpySnap]   = useState(null);
  const [error,     setError]     = useState(null);

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

      {/* Left: summary + chart */}
      <div className="flex-1 min-w-0 flex flex-col p-6 gap-4 border-r border-subtle overflow-hidden">
        <MarketSummary account={account} spySnap={spySnap} />
        <SPYChart />
      </div>

      {/* Right: positions */}
      <PositionsList positions={positions} />

    </div>
  );
}
