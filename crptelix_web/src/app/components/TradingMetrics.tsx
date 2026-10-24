import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { apiFetch } from '../lib/apiClient';
import { useTradesSynced } from '../lib/useTradesSynced';
import { LOSS, WIN } from '../lib/widgetColors';

type PeriodKey = '1w' | '1m' | 'all';

interface TradesStatsPayload {
  total_net_profit: number;
  total_net_profit_change_pct: number | null;
  profit_factor: number | null;
  total_trades: number;
  winners: number;
  losers: number;
  max_drawdown: number;
  max_drawdown_percent: number;
  percent_profitable: number;
  avg_trade: number;
  avg_trade_change_pct: number | null;
  avg_winning_trade?: number;
  avg_losing_trade?: number;
  realized_rr?: number | null;
  realized_rr_change_pct?: number | null;
}

const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '1w', label: '1W' },
  { key: '1m', label: '1M' },
  { key: 'all', label: 'All' },
];

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function formatSignedPct(n: number, digits = 1): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function pnlColor(n: number): string {
  if (n > 0) return WIN;
  if (n < 0) return LOSS;
  return '#e8e4d9';
}

function percentProfitableColor(pct: number): string {
  if (pct > 50) return WIN;
  if (pct <= 0) return '#e8e4d9';
  return LOSS;
}

function ratioColor(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '#e8e4d9';
  if (n > 1) return WIN;
  if (n < 1) return LOSS;
  return '#e8e4d9';
}

function stopWidgetDrag(event: MouseEvent) {
  event.stopPropagation();
}

function MetricCard({
  label,
  value,
  valueColor,
  footnote,
}: {
  label: string;
  value: string;
  valueColor?: string;
  footnote: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-yellow-900/25 bg-zinc-950/40 px-3 py-2.5">
      <div className="truncate text-[11px] leading-tight text-zinc-500">{label}</div>
      <div
        className="truncate text-[18px] font-medium leading-none tracking-tight tabular-nums"
        style={{ color: valueColor || '#e8e4d9' }}
      >
        {value}
      </div>
      <div className="truncate text-[11px] leading-tight text-zinc-500">{footnote}</div>
    </div>
  );
}

function ChangePct({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return null;
  return (
    <span className="tabular-nums" style={{ color: value >= 0 ? WIN : LOSS }}>
      {formatSignedPct(value)}
    </span>
  );
}

export function KeyMetricsCards() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [period, setPeriod] = useState<PeriodKey>('1w');
  const [stats, setStats] = useState<TradesStatsPayload | null>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const load = useCallback(async (next: PeriodKey) => {
    try {
      const res = await apiFetch(`/api/v1/trades/stats?period=${next}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        console.error('Failed to fetch /api/v1/trades/stats', res.status);
        return;
      }
      const data = (await res.json()) as TradesStatsPayload;
      setStats(data);
    } catch (e) {
      console.error('Error fetching trade stats', e);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  useTradesSynced(() => {
    void load(period);
  });

  const tnp = stats?.total_net_profit ?? 0;
  const avg = stats?.avg_trade ?? 0;
  const pp = stats?.percent_profitable ?? 0;
  const maxDd = stats?.max_drawdown ?? 0;
  const maxDdPct = stats?.max_drawdown_percent ?? 0;
  const compact = box.w > 0 && box.w < 520;
  const empty = !stats;
  const pfDisplay =
    stats?.profit_factor != null && Number.isFinite(stats.profit_factor)
      ? stats.profit_factor.toFixed(3)
      : '—';
  const rrDisplay =
    stats?.realized_rr != null && Number.isFinite(stats.realized_rr)
      ? `${stats.realized_rr.toFixed(2)}R`
      : '—';

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3 bg-[#0c0c0c] px-4 pb-3 pr-9 pt-4 text-[#e8e4d9] [contain:layout]"
    >
      <div className="flex shrink-0 items-center justify-between gap-3">
        <h3 className="widget-drag-handle min-w-0 truncate text-[17px] font-medium leading-tight text-yellow-500">
          Key Metrics
        </h3>
        <div className="relative z-20 flex shrink-0 items-center gap-1">
          {PERIODS.map((item) => (
            <button
              key={item.key}
              type="button"
              onMouseDown={stopWidgetDrag}
              onClick={(event) => {
                stopWidgetDrag(event);
                setPeriod(item.key);
              }}
              className={
                'rounded-md px-2 py-1 text-[11px] font-medium ' +
                (period === item.key
                  ? 'bg-white/10 text-[#e8e4d9]'
                  : 'text-zinc-500 hover:text-zinc-300')
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className={
          'grid shrink-0 gap-2 ' + (compact ? 'grid-cols-2' : 'grid-cols-3')
        }
      >
        <MetricCard
          label="Total Net Profit"
          value={empty ? '…' : formatUsd(tnp)}
          valueColor={pnlColor(tnp)}
          footnote={
            <span className="inline-flex items-center gap-1.5">
              <ChangePct value={stats?.total_net_profit_change_pct} />
              <span>Inc. commissions</span>
            </span>
          }
        />
        <MetricCard
          label="Profit Factor"
          value={empty ? '…' : pfDisplay}
          valueColor={ratioColor(stats?.profit_factor)}
          footnote="Gross profit / Gross loss"
        />
        <MetricCard
          label="Total Trades"
          value={empty ? '…' : String(stats?.total_trades ?? 0)}
          footnote={
            <span>
              <span className="font-medium" style={{ color: WIN }}>
                {stats?.winners ?? 0} winners
              </span>
              <span> / </span>
              <span className="font-medium" style={{ color: LOSS }}>
                {stats?.losers ?? 0} losers
              </span>
            </span>
          }
        />
        <MetricCard
          label="Percent Profitable"
          value={empty ? '…' : `${pp.toFixed(2)}%`}
          valueColor={percentProfitableColor(pp)}
          footnote={
            <span className="inline-flex items-center gap-1.5">
              <span className="tabular-nums" style={{ color: percentProfitableColor(pp) }}>
                {formatSignedPct(pp)}
              </span>
              <span>Win rate</span>
            </span>
          }
        />
        <MetricCard
          label="Max Drawdown"
          value={empty ? '…' : formatUsd(-Math.abs(maxDd))}
          valueColor={maxDd > 0 ? LOSS : '#e8e4d9'}
          footnote={
            <span className="tabular-nums" style={{ color: maxDd > 0 ? LOSS : undefined }}>
              {empty ? '…' : formatSignedPct(-Math.abs(maxDdPct))}
            </span>
          }
        />
        <MetricCard
          label="Avg Trade"
          value={empty ? '…' : formatUsd(avg)}
          valueColor={pnlColor(avg)}
          footnote={
            <span className="inline-flex items-center gap-1.5">
              <ChangePct value={stats?.avg_trade_change_pct} />
              <span>Per trade</span>
            </span>
          }
        />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-3 items-center rounded-xl border border-yellow-900/25 bg-zinc-950/40 px-6 py-3">
        <span className="justify-self-center whitespace-nowrap text-[14px] font-medium leading-none text-zinc-400">
          Realized R:R
        </span>
        <span className="inline-flex items-center justify-center gap-2.5 justify-self-center">
          <span
            className="text-[22px] font-medium leading-none tracking-tight tabular-nums"
            style={{ color: ratioColor(stats?.realized_rr) }}
          >
            {empty ? '…' : rrDisplay}
          </span>
          <span className="text-[14px] font-medium leading-none">
            <ChangePct value={stats?.realized_rr_change_pct} />
          </span>
        </span>
        <span
          className="inline-flex flex-col items-center justify-center justify-self-center text-[12px] font-medium italic leading-tight text-zinc-400"
          title="avg win / |avg loss|"
        >
          <span className="whitespace-nowrap">avg win</span>
          <span className="my-0.5 h-px w-full bg-zinc-500" />
          <span className="whitespace-nowrap">|avg loss|</span>
        </span>
      </div>
    </div>
  );
}
