import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

type ProfitTrendTimeScale = 'trades' | 'days' | 'weeks' | 'months';

type TrendPoint = {
  date: string;
  balance: number;
  positive: number | null;
  negative: number | null;
};

import { apiFetch } from '../lib/apiClient';
import { useTradesSynced } from '../lib/useTradesSynced';
import { LOSS as RED, WIN as GREEN } from '../lib/widgetColors';

const TIME_SCALE_BUTTONS: { key: ProfitTrendTimeScale; label: string }[] = [
  { key: 'trades', label: 'Trades' },
  { key: 'days', label: 'Days' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'months', label: 'Months' },
];

const AXIS = '#6b675c';
const GRID = 'rgba(201,168,76,0.12)';
const NEUTRAL = '#e8e4d9';

function stopWidgetDrag(event: MouseEvent) {
  event.stopPropagation();
}

function formatCompactUsd(value: number): string {
  if (Math.abs(value) < 0.5) return '$0';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
  }
}

function formatFullUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatAxisDateLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonthAxisLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m] = parts;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function dateToMs(date: string): number {
  const parts = date.split('-').map(Number);
  if (parts.length >= 3) return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  if (parts.length >= 2) return new Date(parts[0], parts[1] - 1, 1).getTime();
  return Date.parse(date);
}

function msToDateStr(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function splitBalance(balance: number): Pick<TrendPoint, 'positive' | 'negative'> {
  if (balance > 0) return { positive: balance, negative: null };
  if (balance < 0) return { positive: null, negative: balance };
  return { positive: 0, negative: 0 };
}

function interpolateZeroCrossing(
  a: { date: string; balance: number },
  b: { date: string; balance: number }
): TrendPoint {
  const t = a.balance / (a.balance - b.balance);
  const ms = dateToMs(a.date) + t * (dateToMs(b.date) - dateToMs(a.date));
  return { date: msToDateStr(ms), balance: 0, positive: 0, negative: 0 };
}

function enrichTrendData(raw: Array<{ date: string; balance: number }>): TrendPoint[] {
  if (!raw.length) return [];

  const out: TrendPoint[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const curr = raw[i];
    if (i > 0) {
      const prev = raw[i - 1];
      const prevSign = Math.sign(prev.balance);
      const currSign = Math.sign(curr.balance);
      if (prevSign !== 0 && currSign !== 0 && prevSign !== currSign) {
        out.push(interpolateZeroCrossing(prev, curr));
      }
    }
    out.push({ date: curr.date, balance: curr.balance, ...splitBalance(curr.balance) });
  }
  return out;
}

function profitTrendYRange(data: TrendPoint[]): { minY: number; maxY: number } {
  if (!data.length) return { minY: 0, maxY: 1 };
  const balances = data.map((d) => d.balance);
  let minY = Math.min(0, ...balances);
  let maxY = Math.max(0, ...balances);
  const span = maxY - minY || Math.max(Math.abs(maxY), Math.abs(minY), 1);
  const pad = span * 0.12;
  return { minY: minY - pad, maxY: maxY + pad };
}

function ProfitTrendTooltip({
  active,
  payload,
  label,
  period,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TrendPoint }>;
  label?: string;
  period: ProfitTrendTimeScale;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const value = point.balance;
  const xLabel =
    period === 'months' ? formatMonthAxisLabel(String(label)) : formatAxisDateLabel(String(label));

  return (
    <div className="rounded-lg border border-yellow-900/40 bg-zinc-950 px-3 py-2 shadow-xl">
      <p className="mb-0.5 text-[10px] text-zinc-500">{xLabel}</p>
      <p
        className="text-sm font-semibold tabular-nums"
        style={{ color: value > 0 ? GREEN : value < 0 ? RED : NEUTRAL }}
      >
        {formatFullUsd(value)}
      </p>
    </div>
  );
}

function ProfitTrendActiveDot(props: {
  cx?: number;
  cy?: number;
  payload?: TrendPoint;
}) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || !payload) return null;
  const color = payload.balance >= 0 ? GREEN : RED;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4}
      fill={color}
      stroke="#0c0c0c"
      strokeWidth={2}
    />
  );
}

export function ProfitTrendWidget() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [data, setData] = useState<TrendPoint[]>([]);
  const [period, setPeriod] = useState<ProfitTrendTimeScale>('trades');
  const [loading, setLoading] = useState(true);
  const uid = useId().replace(/:/g, '');
  const posFillId = `pt-pos-${uid}`;
  const negFillId = `pt-neg-${uid}`;

  const fetchProfitTrend = useCallback(async () => {
    const cleanDateLabel = (value: unknown, fallback: string) => {
      if (!value) return fallback;
      const text = String(value);
      return text.includes('T') ? text.split('T')[0] : text;
    };

    setLoading(true);
    try {
      const response = await apiFetch(
        `/api/metrics/profit-trend?period=${encodeURIComponent(period)}`
      );
      if (!response.ok) throw new Error(`Failed to fetch profit trend: ${response.status}`);

      const payload = await response.json();
      const raw = (Array.isArray(payload) ? payload : [])
        .map((d: Record<string, unknown>, index: number) => ({
          date: cleanDateLabel(d.date, `Point ${index + 1}`),
          balance: parseFloat(String(d.balance ?? '')),
        }))
        .filter((d) => Number.isFinite(d.balance));

      setData(enrichTrendData(raw));
    } catch (error) {
      console.error('Failed to load /api/metrics/profit-trend', error);
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    // Padding depends on `dense`, so measure the padding box; contentRect would oscillate.
    const ro = new ResizeObserver(() => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    void fetchProfitTrend();
  }, [fetchProfitTrend]);

  useTradesSynced(fetchProfitTrend);

  const xTickFormatter = (v: string | number) =>
    period === 'months' ? formatMonthAxisLabel(String(v)) : formatAxisDateLabel(String(v));

  const { minY, maxY } = useMemo(() => profitTrendYRange(data), [data]);
  const crossesZero = minY < 0 && maxY > 0;
  const hasPositive = data.some((d) => d.balance > 0);
  const hasNegative = data.some((d) => d.balance < 0);
  const latestBalance = data.length ? data[data.length - 1].balance : 0;
  const dense = (box.w > 0 && box.w < 472) || (box.h > 0 && box.h < 286);
  const scale = box.w > 0 ? Math.min(1, Math.max(0.82, (box.w - 52) / 520)) : 1;
  const valueSize = Math.round((dense ? 13 : 15) * scale);
  const tabClass = dense ? 'px-1.5 py-0.5 text-[10px] ' : 'px-2 py-0.5 text-[11px] ';
  const axisSize = dense ? 9 : 10;

  return (
    <div
      ref={rootRef}
      className={
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0c0c0c] pr-9 text-[#e8e4d9] [contain:layout] ' +
        (dense ? 'gap-1.5 px-3 pb-2 pt-3' : 'gap-2 px-4 pb-3 pt-3.5')
      }
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <h3 className="widget-drag-handle min-w-0 truncate text-[17px] font-medium leading-tight text-yellow-500">
          Cul. PnL
        </h3>
        <div className="relative z-20 mt-1 flex shrink-0 rounded-lg border border-yellow-600/45 p-0.5">
          {TIME_SCALE_BUTTONS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onMouseDown={stopWidgetDrag}
              onClick={(event) => {
                stopWidgetDrag(event);
                setPeriod(key);
              }}
              className={
                'rounded-md font-medium ' +
                tabClass +
                (period === key
                  ? 'bg-yellow-500/15 text-yellow-500'
                  : 'text-zinc-500 hover:text-zinc-300')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p
        className="shrink-0 truncate font-medium leading-none tracking-tight tabular-nums"
        style={{
          fontSize: valueSize,
          color: latestBalance > 0 ? GREEN : latestBalance < 0 ? RED : NEUTRAL,
        }}
      >
        {loading && data.length === 0 ? '—' : formatFullUsd(latestBalance)}
      </p>

      <div className="relative min-h-0 min-w-0 flex-1 px-0.5 pb-1 pt-1">
        {loading && data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[#6b675c]">Loading…</div>
        ) : data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[#6b675c]">
            No profit data yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 6, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={posFillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={negFillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={RED} stopOpacity={0} />
                  <stop offset="100%" stopColor={RED} stopOpacity={0.28} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke={GRID} strokeDasharray="3 5" vertical={false} />

              <XAxis
                dataKey="date"
                tick={{ fontSize: axisSize, fill: AXIS }}
                axisLine={{ stroke: AXIS }}
                tickLine={false}
                tickFormatter={xTickFormatter}
                interval="preserveStartEnd"
                minTickGap={40}
                dy={6}
              />

              <YAxis
                domain={[minY, maxY]}
                tick={{ fontSize: axisSize, fill: AXIS }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCompactUsd(Number(v))}
                width={48}
                tickCount={5}
              />

              {crossesZero && (
                <ReferenceLine y={0} stroke={AXIS} strokeWidth={1} />
              )}

              <Tooltip
                cursor={{ stroke: AXIS, strokeWidth: 1, strokeDasharray: '3 3' }}
                content={<ProfitTrendTooltip period={period} />}
              />

              {hasNegative && (
                <Area
                  type="monotone"
                  dataKey="negative"
                  baseValue={0}
                  stroke="none"
                  fill={'url(#' + negFillId + ')'}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                />
              )}

              {hasPositive && (
                <Area
                  type="monotone"
                  dataKey="positive"
                  baseValue={0}
                  stroke="none"
                  fill={'url(#' + posFillId + ')'}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                />
              )}

              {hasNegative && (
                <Line
                  type="monotone"
                  dataKey="negative"
                  stroke={RED}
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                />
              )}

              {hasPositive && (
                <Line
                  type="monotone"
                  dataKey="positive"
                  stroke={GREEN}
                  strokeWidth={2}
                  connectNulls={false}
                  isAnimationActive={false}
                  dot={false}
                  activeDot={false}
                />
              )}

              <Line
                type="monotone"
                dataKey="balance"
                stroke="transparent"
                strokeWidth={8}
                isAnimationActive={false}
                dot={false}
                activeDot={<ProfitTrendActiveDot />}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
