import { useMemo } from 'react';

import { formatUsd, parseNum, tradeNet, type TradeRow } from '../lib/tradeMetrics';
import { useDealBaseTrades } from '../lib/useDealBaseTrades';
import { LOSS, WIN } from '../lib/widgetColors';

const NEUTRAL = '#e8e4d9';

type ScoreRow = {
  pair: string;
  n: number;
  winRate: number;
  net: number;
  avgR: number | null;
};

function realizedR(winPnls: number[], lossPnls: number[]): number | null {
  if (!winPnls.length || !lossPnls.length) return null;
  const avgWin = winPnls.reduce((s, n) => s + n, 0) / winPnls.length;
  const avgLoss = Math.abs(lossPnls.reduce((s, n) => s + n, 0) / lossPnls.length);
  if (avgLoss < 1e-12) return null;
  return avgWin / avgLoss;
}

function groupKey(t: TradeRow): string {
  return String(t.pair ?? '').trim() || 'Unknown';
}

export function SymbolScorecardWidget() {
  const trades = useDealBaseTrades();

  const rows = useMemo<ScoreRow[]>(() => {
    const groups = new Map<string, TradeRow[]>();
    for (const t of trades) {
      const pair = groupKey(t);
      const list = groups.get(pair) ?? [];
      list.push(t);
      groups.set(pair, list);
    }

    return [...groups.entries()]
      .map(([pair, list]) => {
        const pnls = list.map((t) => parseNum(t.pnl));
        const winPnls = pnls.filter((n) => n > 0);
        const lossPnls = pnls.filter((n) => n < 0);
        const decided = winPnls.length + lossPnls.length;
        return {
          pair,
          n: list.length,
          winRate: decided > 0 ? (winPnls.length / decided) * 100 : 0,
          net: list.reduce((s, t) => s + tradeNet(t), 0),
          avgR: realizedR(winPnls, lossPnls),
        };
      })
      .sort((a, b) => b.net - a.net);
  }, [trades]);

  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const totalTrades = rows.reduce((s, r) => s + r.n, 0);
  const netColor = (n: number) => (n > 0 ? WIN : n < 0 ? LOSS : NEUTRAL);
  const wrColor = (wr: number) => (wr >= 50 ? '#34d399' : wr >= 30 ? '#fbbf24' : '#fb7185');
  const gridCols =
    'grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_3.25rem] items-center gap-3';

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-1.5 overflow-hidden bg-[#0c0c0c] px-3 pb-2.5 pr-9 pt-3 text-[#e8e4d9] [contain:layout]">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="widget-drag-handle min-w-0 truncate text-[17px] font-medium leading-tight text-yellow-500">
          Symbol Scorecard
        </h3>
        {rows.length > 0 && (
          <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
            <span className="rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 tabular-nums text-zinc-400">
              {rows.length} pairs · {totalTrades} trades
            </span>
            <span
              className="rounded-md px-2 py-0.5 font-medium tabular-nums"
              style={{
                color: netColor(totalNet),
                backgroundColor: `${netColor(totalNet)}1a`,
              }}
            >
              {formatUsd(totalNet)}
            </span>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-zinc-500">
          No trades yet
        </div>
      ) : (
        <div className="widget-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto overflow-x-hidden">
          <div
            className={`${gridCols} sticky top-0 z-10 bg-[#0c0c0c] px-3 pb-0.5 text-[11px] uppercase tracking-wider text-zinc-500`}
          >
            <span>Pair</span>
            <span>Win rate</span>
            <span className="text-right">Net</span>
            <span className="text-right">R</span>
          </div>
          {rows.map((r, i) => (
            <div
              key={r.pair}
              className={`${gridCols} min-h-[52px] flex-1 rounded-xl border px-3 py-1.5 ${
                i === 0 && r.net > 0
                  ? 'border-yellow-900/40 bg-gradient-to-r from-yellow-500/[0.06] to-zinc-950/60'
                  : 'border-zinc-800/80 bg-zinc-950/60'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[#e8e4d9]">{r.pair}</div>
                <div className="text-[11px] text-zinc-500">
                  {r.n} {r.n === 1 ? 'trade' : 'trades'}
                </div>
              </div>
              <div>
                <div className="text-[12px] font-medium tabular-nums text-[#e8e4d9]">
                  {r.winRate.toFixed(0)}%
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/80">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(r.winRate, 2)}%`, backgroundColor: wrColor(r.winRate) }}
                  />
                </div>
              </div>
              <div
                className="text-right text-[13px] font-semibold tabular-nums"
                style={{ color: netColor(r.net) }}
              >
                {formatUsd(r.net)}
              </div>
              <div className="text-right">
                {r.avgR != null ? (
                  <span
                    className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                      r.avgR >= 1
                        ? 'bg-emerald-400/10 text-emerald-400'
                        : 'bg-amber-400/10 text-amber-300'
                    }`}
                  >
                    {r.avgR.toFixed(2)}R
                  </span>
                ) : (
                  <span className="text-[11px] text-zinc-600">—</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
