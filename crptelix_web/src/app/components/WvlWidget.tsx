import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  format,
  startOfWeek,
  addWeeks,
} from 'date-fns';
import type { TooltipProps } from 'recharts';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { apiFetch } from '../lib/apiClient';
import { useTradesSynced } from '../lib/useTradesSynced';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface WvlSeriesPoint {
  date: string;
  label: string;
  wins: number;
  losses: number;
}

function labelForCalendarDay(d: Date): string {
  return WEEKDAY_SHORT[(d.getDay() + 6) % 7];
}

function emptySeriesForWeek(weekStartMonday: Date): WvlSeriesPoint[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStartMonday, i);
    return {
      date: format(d, 'yyyy-MM-dd'),
      label: labelForCalendarDay(d),
      wins: 0,
      losses: 0,
    };
  });
}

function WvlTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const wins = Number(payload.find((p) => p.dataKey === 'wins')?.value ?? 0);
  const losses = Number(payload.find((p) => p.dataKey === 'losses')?.value ?? 0);
  return (
    <div className="rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
      {label != null && label !== '' && (
        <div className="mb-1.5 font-medium text-zinc-300">{label}</div>
      )}
      <div className="font-medium text-emerald-400">wins : {wins}</div>
      <div className="font-medium text-red-500">losses : {losses}</div>
    </div>
  );
}

export function WvlWidget() {
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [chartData, setChartData] = useState<WvlSeriesPoint[]>(() =>
    emptySeriesForWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))
  );
  const [loading, setLoading] = useState(true);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const rangeLabel = useMemo(
    () => `${format(weekStart, 'MMMM d')} - ${format(weekEnd, 'MMMM d')}`,
    [weekStart, weekEnd]
  );

  const highlightLabel = hoverLabel ?? selectedLabel;

  const yMax = useMemo(() => {
    let m = 1;
    for (const r of chartData) {
      m = Math.max(m, r.wins, r.losses);
    }
    return Math.max(5, Math.ceil(m / 5) * 5);
  }, [chartData]);

  const fetchWvl = useCallback(async () => {
    const startStr = format(weekStart, 'yyyy-MM-dd');
    const endStr = format(weekEnd, 'yyyy-MM-dd');
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/v1/trades/wvl?start_date=${encodeURIComponent(startStr)}&end_date=${encodeURIComponent(endStr)}`
      );
      if (!res.ok) {
        setChartData(emptySeriesForWeek(weekStart));
        return;
      }
      const raw = (await res.json()) as { series?: WvlSeriesPoint[] };
      const series = Array.isArray(raw.series) ? raw.series : [];
      if (series.length === 7) {
        setChartData(series);
      } else {
        setChartData(emptySeriesForWeek(weekStart));
      }
    } catch {
      setChartData(emptySeriesForWeek(weekStart));
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    void fetchWvl();
  }, [fetchWvl]);

  useTradesSynced(fetchWvl);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-center gap-3 px-1">
        <button
          type="button"
          aria-label="Previous week"
          className="rounded border border-zinc-700 px-2 py-0.5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          onClick={() => setWeekStart((d) => addWeeks(d, -1))}
        >
          &lt;
        </button>
        <span className="min-w-[10rem] text-center text-xs font-medium text-zinc-400">
          {rangeLabel}
        </span>
        <button
          type="button"
          aria-label="Next week"
          className="rounded border border-zinc-700 px-2 py-0.5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
          onClick={() => setWeekStart((d) => addWeeks(d, 1))}
        >
          &gt;
        </button>
      </div>

      <div className="min-h-0 min-w-0 flex-1 opacity-100">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            onMouseMove={(state) => {
              const label =
                state && typeof state === 'object' && 'activeLabel' in state
                  ? (state as { activeLabel?: string | number }).activeLabel
                  : undefined;
              if (label != null && label !== '') {
                setHoverLabel(String(label));
              }
            }}
            onMouseLeave={() => setHoverLabel(null)}
            onClick={(state) => {
              const label =
                state && typeof state === 'object' && 'activeLabel' in state
                  ? (state as { activeLabel?: string | number }).activeLabel
                  : undefined;
              if (label != null && label !== '') {
                setSelectedLabel((prev) =>
                  prev === String(label) ? null : String(label)
                );
              }
            }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
            {highlightLabel ? (
              <ReferenceArea
                x1={highlightLabel}
                x2={highlightLabel}
                strokeOpacity={0}
                fill="#52525b"
                fillOpacity={0.45}
              />
            ) : null}
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#a1a1aa' }}
              stroke="#52525b"
              tickLine={false}
              axisLine={{ stroke: '#52525b' }}
            />
            <YAxis
              domain={[0, yMax]}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#a1a1aa' }}
              stroke="#52525b"
              tickLine={false}
              axisLine={{ stroke: '#52525b' }}
              width={36}
            />
            <Tooltip
              cursor={{ fill: 'transparent' }}
              content={(props) => <WvlTooltip {...props} />}
            />
            <Bar
              dataKey="wins"
              name="Wins"
              fill="#22c55e"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
            <Bar
              dataKey="losses"
              name="Losses"
              fill="#ef4444"
              radius={[4, 4, 0, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {loading && (
        <p className="shrink-0 text-center text-[10px] text-zinc-500">Loading WvL…</p>
      )}
    </div>
  );
}
