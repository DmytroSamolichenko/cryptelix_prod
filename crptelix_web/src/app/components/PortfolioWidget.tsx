import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { apiFetch } from '../lib/apiClient';
import { useTradesSynced } from '../lib/useTradesSynced';

type MixSlice = {
  name: string;
  value: number;
  color: string;
};

type PortfolioAsset = {
  asset: string;
  amount?: string;
  value_usdt: number;
};

type HistoryPoint = {
  date: string;
  total_usdt: number;
};

type BinancePortfolioPayload = {
  exchange_name: string;
  total_usdt: number;
  assets: PortfolioAsset[];
  captured_at: string | null;
  history: HistoryPoint[];
};

type CredentialsStatus = {
  binance_connected?: boolean;
};

type TimePeriod = '7d' | '1m' | '3m' | '1y' | 'All';

const KNOWN_ASSET_COLORS: Record<string, string> = {
  BTC: '#f7931a',
  ETH: '#627eea',
  SOL: '#00d4aa',
  USDT: '#26a17b',
  USDC: '#2775ca',
  BNB: '#f3ba2f',
};

const FALLBACK_COLORS = [
  '#facc15',
  '#22c55e',
  '#3b82f6',
  '#a78bfa',
  '#f97316',
  '#14b8a6',
  '#f43f5e',
  '#94a3b8',
];

const TOOLTIP_STYLE = {
  backgroundColor: '#0c0c0c',
  border: '1px solid rgba(113, 63, 18, 0.5)',
  borderRadius: '10px',
  color: '#f5f1e6',
  fontSize: '12px',
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
} as const;

const DUST_USDT = 0.01;
const TOP_SLICES = 7;
const PERIODS: TimePeriod[] = ['7d', '1m', '3m', '1y', 'All'];
const PERIOD_DAYS: Record<Exclude<TimePeriod, 'All'>, number> = {
  '7d': 7,
  '1m': 30,
  '3m': 90,
  '1y': 365,
};

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: n >= 100 ? 0 : 2,
  }).format(n);
}

function formatCapturedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatAxisDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function colorForAsset(name: string, index: number): string {
  return KNOWN_ASSET_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

function slicesFromAssets(assets: PortfolioAsset[]): MixSlice[] {
  const ranked = assets
    .filter((a) => a.value_usdt >= DUST_USDT)
    .sort((a, b) => b.value_usdt - a.value_usdt);

  const top = ranked.slice(0, TOP_SLICES);
  const rest = ranked.slice(TOP_SLICES);
  const out: MixSlice[] = top.map((a, i) => ({
    name: a.asset,
    value: a.value_usdt,
    color: colorForAsset(a.asset, i),
  }));
  const otherSum = rest.reduce((s, a) => s + a.value_usdt, 0);
  if (otherSum > 0) {
    out.push({ name: 'Others', value: otherSum, color: '#6b7280' });
  }
  return out;
}

function filterHistory(history: HistoryPoint[], period: TimePeriod): HistoryPoint[] {
  if (period === 'All') return history;
  const days = PERIOD_DAYS[period];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter((p) => {
    const t = new Date(`${p.date}T00:00:00Z`).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
}

export function PortfolioWidget() {
  const [binanceConnected, setBinanceConnected] = useState(false);
  const [portfolio, setPortfolio] = useState<BinancePortfolioPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [period, setPeriod] = useState<TimePeriod>('All');
  const uid = useId().replace(/:/g, '');
  const gradientId = `pf-eq-${uid}`;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [statusRes, portfolioRes] = await Promise.all([
        apiFetch('/api/v1/exchanges/credentials/status'),
        apiFetch('/api/v1/exchanges/binance/portfolio'),
      ]);

      let connected = false;
      if (statusRes.ok) {
        const status = (await statusRes.json()) as CredentialsStatus;
        connected = Boolean(status.binance_connected);
      }
      setBinanceConnected(connected);

      if (!connected) {
        setPortfolio(null);
        return;
      }

      if (!portfolioRes.ok) {
        setPortfolio(null);
        setLoadFailed(true);
        return;
      }

      const data = (await portfolioRes.json()) as BinancePortfolioPayload;
      setPortfolio({
        ...data,
        assets: Array.isArray(data.assets) ? data.assets : [],
        history: Array.isArray(data.history) ? data.history : [],
      });
    } catch {
      setPortfolio(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useTradesSynced(load);

  const slices = useMemo(
    () => slicesFromAssets(portfolio?.assets ?? []),
    [portfolio]
  );
  const total =
    slices.reduce((s, x) => s + x.value, 0) || Number(portfolio?.total_usdt ?? 0);
  const capturedAt = formatCapturedAt(portfolio?.captured_at);
  const history = useMemo(
    () => filterHistory(portfolio?.history ?? [], period),
    [portfolio, period]
  );

  const first = history[0]?.total_usdt ?? 0;
  const last = history[history.length - 1]?.total_usdt ?? 0;
  const up = last >= first;
  const changePct = history.length >= 2 && first > 0 ? ((last - first) / first) * 100 : null;
  const trendColor = up ? '#34d399' : '#fb7185';

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2 overflow-hidden">
      {loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-zinc-500">
          Loading allocation…
        </div>
      ) : !binanceConnected ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-zinc-500">
          Connect Binance to see spot and futures allocation.
        </div>
      ) : loadFailed ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-zinc-500">
          Could not load Binance allocation.
        </div>
      ) : slices.length === 0 && history.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center text-xs text-zinc-500">
          No valued Binance balances yet.
        </div>
      ) : (
        <>
          <div className="flex shrink-0 items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-2xl font-semibold tabular-nums text-[#f5f1e6]">
                  {formatUsd(total)}
                </span>
                {changePct != null && (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${
                      up ? 'bg-emerald-400/10 text-emerald-400' : 'bg-rose-400/10 text-rose-400'
                    }`}
                  >
                    {up ? (
                      <TrendingUp className="h-3 w-3" aria-hidden />
                    ) : (
                      <TrendingDown className="h-3 w-3" aria-hidden />
                    )}
                    {Math.abs(changePct).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
            <div
              className="inline-flex shrink-0 gap-0.5 rounded-xl border border-zinc-800 bg-zinc-950 p-0.5"
              role="group"
              aria-label="Time period"
            >
              {PERIODS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPeriod(key)}
                  aria-pressed={period === key}
                  className={`rounded-[10px] px-2 py-0.5 text-[11px] transition-colors ${
                    period === key
                      ? 'bg-yellow-400 font-medium text-zinc-950'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          {slices.length > 0 && (
            <div className="shrink-0">
              <div
                className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
                role="img"
                aria-label={slices
                  .map((s) => `${s.name} ${total > 0 ? Math.round((s.value / total) * 100) : 0}%`)
                  .join(', ')}
              >
                {slices.map((s) => (
                  <div
                    key={s.name}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${total > 0 ? (s.value / total) * 100 : 0}%`,
                      backgroundColor: s.color,
                    }}
                    title={`${s.name}: ${formatUsd(s.value)}`}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {slices.map((s) => (
                  <span key={s.name} className="inline-flex items-center gap-1.5 text-[11px]">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.color, boxShadow: `0 0 6px ${s.color}66` }}
                    />
                    <span className="font-medium text-zinc-200">{s.name}</span>
                    <span className="tabular-nums text-zinc-500">
                      {total > 0 ? ((s.value / total) * 100).toFixed(1) : '0.0'}%
                    </span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="relative min-h-[120px] flex-1 rounded-2xl border border-yellow-900/25 bg-zinc-950/40 p-2">
            {history.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[11px] text-zinc-600">
                Daily curve starts after the first 00:00 UTC snapshot.
              </div>
            ) : (
              <div className="absolute inset-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={trendColor} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id={`${gradientId}-line`} x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#facc15" />
                        <stop offset="100%" stopColor={trendColor} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="2 4" stroke="#27272a" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="#3f3f46"
                      tick={{ fill: '#71717a', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={28}
                      tickFormatter={formatAxisDate}
                    />
                    <YAxis
                      tick={{ fill: '#71717a', fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={48}
                      tickCount={4}
                      tickFormatter={(v) => formatUsd(Number(v))}
                    />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      itemStyle={{ color: '#f5f1e6' }}
                      labelStyle={{ color: '#a1a1aa' }}
                      cursor={{ stroke: '#52525b', strokeDasharray: '3 3' }}
                      labelFormatter={(label) => formatAxisDate(String(label))}
                      formatter={(value: number) => [formatUsd(Number(value)), 'Balance']}
                    />
                    <Area
                      type="monotone"
                      dataKey="total_usdt"
                      stroke={`url(#${gradientId}-line)`}
                      strokeWidth={2.5}
                      fill={`url(#${gradientId})`}
                      activeDot={{ r: 4, fill: trendColor, stroke: '#0c0c0c', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {capturedAt && (
            <p className="shrink-0 text-[11px] text-zinc-600">
              Snapshot from {capturedAt}. Daily poll at 00:00 UTC.
            </p>
          )}
        </>
      )}
    </div>
  );
}
