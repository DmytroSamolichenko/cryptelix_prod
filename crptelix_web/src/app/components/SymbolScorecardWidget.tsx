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

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 overflow-hidden bg-[#0c0c0c] px-4 pb-3 pr-9 pt-3.5 text-[#e8e4d9] [contain:layout]">
      <h3 className="widget-drag-handle shrink-0 truncate text-[17px] font-medium leading-tight text-yellow-500">
        Symbol Scorecard
      </h3>
      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-zinc-500">
          No trades yet
        </div>
      ) : (
        <div className="widget-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-[#0c0c0c] text-zinc-500">
              <tr>
                <th className="px-1.5 py-1 font-medium">Pair</th>
                <th className="px-1.5 py-1 text-right font-medium">n</th>
                <th className="px-1.5 py-1 text-right font-medium">WR</th>
                <th className="px-1.5 py-1 text-right font-medium">Net</th>
                <th className="px-1.5 py-1 text-right font-medium">R</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pair} className="border-t border-zinc-800">
                  <td className="max-w-[7rem] truncate px-1.5 py-1 text-[#e8e4d9]">{r.pair}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-[#e8e4d9]">{r.n}</td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-[#e8e4d9]">
                    {r.winRate.toFixed(0)}%
                  </td>
                  <td
                    className="px-1.5 py-1 text-right tabular-nums"
                    style={{ color: r.net > 0 ? WIN : r.net < 0 ? LOSS : NEUTRAL }}
                  >
                    {formatUsd(r.net)}
                  </td>
                  <td className="px-1.5 py-1 text-right tabular-nums text-[#e8e4d9]">
                    {r.avgR != null ? `${r.avgR.toFixed(2)}R` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
