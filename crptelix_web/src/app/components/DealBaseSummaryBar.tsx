import { useEffect, useMemo, useState } from 'react';
import { cn } from './ui/utils';
import type { FtrReportPayload } from './FtrReportTable';

const FTR_API = 'http://localhost:8000/api/v1/trades/ftr-report';

interface DealRow {
  entryPrice?: string;
  quantity?: string;
}

function parseNum(raw: unknown): number {
  const s = String(raw ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s/g, '')
    .replace(/,/g, '')
    .replace(/^\+/, '')
    .trim();
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatUsd(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return `${sign}$${formatted}`;
}

function formatVol(n: number): string {
  return `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)}`;
}

function formatRatio(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(1);
}

type ChipTone = 'positive' | 'negative' | 'neutral';

interface SummaryChipProps {
  label: string;
  value: string;
  tone?: ChipTone;
}

function SummaryChip({ label, value, tone = 'neutral' }: SummaryChipProps) {
  return (
    <div
      className={cn(
        'group relative isolate shrink-0 overflow-hidden rounded-xl border border-zinc-700/55 bg-zinc-900/75',
        'px-3 py-2 min-w-[5.5rem]',
        'transition-[border-color,box-shadow,background-color] duration-200',
        'hover:border-yellow-500/45 hover:bg-zinc-900',
        'hover:shadow-[0_0_14px_rgba(250,204,21,0.18)]'
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 whitespace-nowrap group-hover:text-gray-400">
        {label}
      </p>
      <p
        className={cn(
          'mt-1 text-sm font-bold tabular-nums leading-none whitespace-nowrap',
          tone === 'positive' && 'text-green-400',
          tone === 'negative' && 'text-red-400',
          tone === 'neutral' && 'text-gray-200'
        )}
      >
        {value}
      </p>
    </div>
  );
}

interface DealBaseSummaryBarProps {
  deals: DealRow[];
}

export function DealBaseSummaryBar({ deals }: DealBaseSummaryBarProps) {
  const [ftr, setFtr] = useState<FtrReportPayload | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(FTR_API);
        if (!res.ok) return;
        setFtr((await res.json()) as FtrReportPayload);
      } catch {
        setFtr(null);
      }
    };
    void load();
  }, [deals.length]);

  const volume = useMemo(
    () =>
      deals.reduce((sum, d) => {
        const entry = parseNum(d.entryPrice);
        const qty = parseNum(d.quantity);
        return sum + Math.abs(entry * qty);
      }, 0),
    [deals]
  );

  const fallback = useMemo(() => {
    let totalPnl = 0;
    let totalCommission = 0;
    const wins: number[] = [];
    const losses: number[] = [];

    for (const d of deals) {
      const pnl = parseNum((d as { pnl?: string }).pnl);
      const comm = parseNum((d as { commission?: string }).commission);
      totalPnl += pnl;
      totalCommission += comm;
      if (pnl > 0) wins.push(pnl);
      else if (pnl < 0) losses.push(pnl);
    }

    const net = totalPnl - totalCommission;
    const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
    const avgRr = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : null;

    return {
      total_net_profit: net,
      total_trades: deals.length,
      commission_total: totalCommission,
      gross_profit: wins.reduce((a, b) => a + b, 0),
      avg_losing_trade: avgLoss,
      avg_winning_trade: avgWin,
      avg_win_lose_ratio: avgRr,
    };
  }, [deals]);

  const netPnl = ftr?.total_net_profit ?? fallback.total_net_profit;
  const totalTrades = ftr?.total_trades ?? fallback.total_trades;
  const commission = ftr?.commission_total ?? fallback.commission_total;
  const grossProfit = ftr?.gross_profit ?? fallback.gross_profit;
  const avgLoss = ftr?.avg_losing_trade ?? fallback.avg_losing_trade;
  const avgWin = ftr?.avg_winning_trade ?? fallback.avg_winning_trade;
  const avgRr = ftr?.avg_win_lose_ratio ?? fallback.avg_win_lose_ratio;

  const pnlTone: ChipTone =
    netPnl > 0 ? 'positive' : netPnl < 0 ? 'negative' : 'neutral';

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="shrink-0 text-xs font-bold uppercase tracking-wider text-gray-500 pr-1">
        Total
      </span>
      <div className="scrollbar-hidden min-w-0 flex-1 overflow-x-auto overflow-y-hidden py-1 -my-1">
        <div className="flex w-max flex-nowrap items-stretch gap-2.5 pr-2">
          <SummaryChip label="Total PnL" value={formatUsd(netPnl)} tone={pnlTone} />
          <SummaryChip label="Total Trades" value={String(totalTrades)} />
          <SummaryChip label="Comms" value={formatUsd(commission)} />
          <SummaryChip label="Gross" value={formatUsd(grossProfit)} tone="positive" />
          <SummaryChip label="Vol" value={formatVol(volume)} />
          <SummaryChip label="Avg Loss" value={formatUsd(avgLoss)} tone="negative" />
          <SummaryChip label="Avg Win" value={formatUsd(avgWin)} tone="positive" />
          <SummaryChip label="Avg RR" value={formatRatio(avgRr)} />
        </div>
      </div>
    </div>
  );
}
