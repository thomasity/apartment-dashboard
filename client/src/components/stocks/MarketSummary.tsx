import { money, sign } from './utils';

interface Props {
  account: { equity: string; last_equity: string } | null;
  spySnap: { latestTrade: { p: number }; prevDailyBar: { c: number } } | null;
}

export default function MarketSummary({ account, spySnap }: Props) {
  const equity     = parseFloat(account?.equity      ?? '0');
  const lastEquity = parseFloat(account?.last_equity ?? '0');
  const dayPnl     = equity - lastEquity;
  const dayPnlPct  = lastEquity ? (dayPnl / lastEquity) * 100 : 0;
  const isUp       = dayPnl >= 0;

  const spyPrice  = spySnap?.latestTrade?.p  ?? 0;
  const spyPrev   = spySnap?.prevDailyBar?.c ?? 0;
  const spyChange = spyPrice - spyPrev;
  const spyPct    = spyPrev ? (spyChange / spyPrev) * 100 : 0;
  const spyUp     = spyChange >= 0;

  return (
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
            <div className={`text-sm mt-1.5 tabular-nums ${spyUp ? 'text-online' : 'text-danger'}`}>
              {sign(spyChange)}{money(spyChange)} ({sign(spyPct)}{spyPct.toFixed(2)}%) today
            </div>
          </>
        ) : (
          <div className="text-white/20 animate-pulse text-sm mt-1">Loading…</div>
        )}
      </div>

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
            <div className={`text-sm mt-1.5 tabular-nums ${isUp ? 'text-online' : 'text-danger'}`}>
              {sign(dayPnl)}{money(dayPnl)} ({sign(dayPnlPct)}{dayPnlPct.toFixed(2)}%) today
            </div>
          </>
        ) : (
          <div className="text-white/20 animate-pulse text-sm mt-1">Loading…</div>
        )}
      </div>

    </div>
  );
}
