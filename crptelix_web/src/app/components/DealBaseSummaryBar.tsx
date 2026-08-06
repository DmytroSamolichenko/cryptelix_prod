import { useEffect, useMemo, useState } from 'react';
import { cn } from './ui/utils';
import type { FtrReportPayload } from './FtrReportTable';

import { apiFetch } from '../lib/apiClient';

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
        'shrink-0 rounded-xl border border-zinc-800 bg-zinc-900/90 px-3.5 py-2.5 min-w-[6.25rem]',
        'shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]'
      )}
    >
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-500 whitespace-nowrap">
        {label}
      </p>
      <p
        className={cn(
          'mt-1.5 text-[15px] font-semibold tabular-nums leading-none whitespace-nowrap',
          tone === 'positive' && 'text-emerald-400',
          tone === 'negative' && 'text-red-400',
          tone === 'neutral' && 'text-zinc-100'
        )}
      >
        {value}
      </p>
    </div>
  );
}

interface DealBaseSummaryBarProps {
  deals: DealRow[];
  className?: string;
}

export function DealBaseSummaryBar({ deals, className }: DealBaseSummaryBarProps) {
  const [ftr, setFtr] = useState<FtrReportPayload | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch('/api/v1/trades/ftr-report');
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
    <div className={cn('flex min-w-0 flex-col gap-2', className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
        Total
      </span>
      <div className="scrollbar-hidden min-w-0 overflow-x-auto overflow-y-hidden">
        <div className="flex w-max flex-nowrap items-stretch gap-2 pr-1">
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
