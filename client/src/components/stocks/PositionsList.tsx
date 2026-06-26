import { money, sign } from './utils';

interface Position {
  symbol: string;
  qty: string;
  current_price: string;
  market_value: string;
  unrealized_pl: string;
  unrealized_plpc: string;
}

interface Props { positions: Position[] }

export default function PositionsList({ positions }: Props) {
  return (
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
              <div key={pos.symbol} className="border-b border-subtle last:border-0 py-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-base font-medium text-white/70">{pos.symbol}</span>
                  <span className="text-base font-light text-white tabular-nums">
                    ${parseFloat(pos.current_price).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-0.5">
                  <span className="text-xs text-white/30">
                    {pos.qty} sh · {money(pos.market_value, true)}
                  </span>
                  <span className={`text-sm font-medium tabular-nums ${up ? 'text-online' : 'text-danger'}`}>
                    {sign(plPct)}{plPct.toFixed(2)}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
