import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
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
import { LOSS, WIN } from '../lib/widgetColors';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const ENTRANCE_STAGGER_MS = 70;
const ENTRANCE_DURATION_MS = 420;
const AXIS = '#6b675c';

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

function seriesHasBars(series: WvlSeriesPoint[]): boolean {
  return series.some((row) => row.wins > 0 || row.losses > 0);
}

function seriesSignature(series: WvlSeriesPoint[]): string {
  return series.map((row) => `${row.date}:${row.wins}:${row.losses}`).join('|');
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function zeroedSeries(series: WvlSeriesPoint[]): WvlSeriesPoint[] {
  return series.map((row) => ({ ...row, wins: 0, losses: 0 }));
}

function formatWeekRange(start: Date, end: Date): string {
  if (start.getMonth() === end.getMonth()) {
    return `${format(start, 'MMM d')} - ${format(end, 'd')}`;
  }
  return `${format(start, 'MMM d')} - ${format(end, 'MMM d')}`;
}

function WvlTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const wins = Math.round(Number(payload.find((p) => p.dataKey === 'wins')?.value ?? 0));
  const losses = Math.round(Number(payload.find((p) => p.dataKey === 'losses')?.value ?? 0));
  return (
    <div className="rounded-lg border border-yellow-900/40 bg-zinc-950 px-3 py-2 text-xs shadow-xl">
      {label != null && label !== '' && (
        <div className="mb-1.5 font-medium text-zinc-300">{label}</div>
      )}
      <div className="font-medium" style={{ color: WIN }}>
        Wins {wins}
      </div>
      <div className="font-medium" style={{ color: LOSS }}>
        Losses {losses}
      </div>
    </div>
  );
}

export function WvlWidget() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [chartData, setChartData] = useState<WvlSeriesPoint[]>(() =>
    emptySeriesForWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))
  );
  const [displayData, setDisplayData] = useState<WvlSeriesPoint[]>(() =>
    emptySeriesForWeek(startOfWeek(new Date(), { weekStartsOn: 1 }))
  );
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const animRafRef = useRef<number | null>(null);
  const lastAnimatedSigRef = useRef<string>('');

  const weekEnd = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const rangeLabel = useMemo(() => formatWeekRange(weekStart, weekEnd), [weekStart, weekEnd]);
  const highlightLabel = hoverLabel ?? selectedLabel;

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const totals = useMemo(() => {
    let wins = 0;
    let losses = 0;
    for (const row of chartData) {
      wins += row.wins;
      losses += row.losses;
    }
    const trades = wins + losses;
    return {
      wins,
      losses,
      trades,
      winRate: trades > 0 ? (wins / trades) * 100 : 0,
    };
  }, [chartData]);

  const yMax = useMemo(() => {
    let m = 0;
    for (const row of chartData) {
      m = Math.max(m, row.wins, row.losses);
    }
    return Math.max(3, Math.ceil(m));
  }, [chartData]);

  const fetchWvl = useCallback(async () => {
    const startStr = format(weekStart, 'yyyy-MM-dd');
    const endStr = format(weekEnd, 'yyyy-MM-dd');
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
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    void fetchWvl();
  }, [fetchWvl]);

  useTradesSynced(fetchWvl);

  useEffect(() => {
    const sig = seriesSignature(chartData);

    if (animRafRef.current != null) {
      cancelAnimationFrame(animRafRef.current);
      animRafRef.current = null;
    }

    if (!seriesHasBars(chartData)) {
      lastAnimatedSigRef.current = sig;
      setDisplayData(chartData);
      return;
    }

    if (sig === lastAnimatedSigRef.current) {
      setDisplayData(chartData);
      return;
    }

    const target = chartData;
    setDisplayData(zeroedSeries(target));
    const startedAt = performance.now();
    const totalMs = ENTRANCE_STAGGER_MS * (target.length - 1) + ENTRANCE_DURATION_MS;

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      setDisplayData(
        target.map((row, index) => {
          const local = (elapsed - index * ENTRANCE_STAGGER_MS) / ENTRANCE_DURATION_MS;
          const t = easeOutCubic(Math.min(1, Math.max(0, local)));
          return {
            ...row,
            wins: row.wins * t,
            losses: row.losses * t,
          };
        })
      );

      if (elapsed < totalMs) {
        animRafRef.current = requestAnimationFrame(tick);
      } else {
        lastAnimatedSigRef.current = sig;
        setDisplayData(target);
        animRafRef.current = null;
      }
    };

    animRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRafRef.current != null) {
        cancelAnimationFrame(animRafRef.current);
        animRafRef.current = null;
      }
    };
  }, [chartData]);

  const changeWeek = (delta: number) => {
    setHoverLabel(null);
    setSelectedLabel(null);
    setWeekStart((d) => addWeeks(d, delta));
  };

  const compact = box.w > 0 && box.w < 480;
  const tight = box.h > 0 && box.h < 300;
  const scale = box.w > 0 ? Math.min(1, Math.max(0.82, box.w / 560)) : 1;
  const statSize = Math.round((tight ? 24 : compact ? 28 : 36) * scale);

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-4 bg-[#0c0c0c] px-4 pb-3 pr-9 pt-4 text-[#e8e4d9] [contain:layout]"
    >
      <div className="widget-drag-handle flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[17px] font-medium leading-tight text-yellow-500">
            Wins vs losses
          </h3>
          <p className="mt-1 truncate text-[12px] leading-tight text-zinc-500">
            {totals.trades} {totals.trades === 1 ? 'trade' : 'trades'} this week
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <button
            type="button"
            aria-label="Previous week"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
            onClick={() => changeWeek(-1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[5.6rem] text-center text-[12px] font-medium text-zinc-400">
            {rangeLabel}
          </span>
          <button
            type="button"
            aria-label="Next week"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-200"
            onClick={() => changeWeek(1)}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div
        className={
          'grid shrink-0 ' + (compact ? 'grid-cols-3 gap-3' : 'grid-cols-3 gap-6')
        }
      >
          <div>
            <div className="text-[11px] text-zinc-500">Win rate</div>
            <div
              className="mt-1 font-medium leading-none tracking-tight"
              style={{
                fontSize: statSize,
                color: !totals.trades ? '#e8e4d9' : totals.winRate >= 50 ? WIN : LOSS,
              }}
            >
              {totals.trades ? `${totals.winRate.toFixed(1)}%` : '—'}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: WIN }} />
              Wins
            </div>
            <div
              className="mt-1 font-medium leading-none tracking-tight"
              style={{ fontSize: statSize, color: WIN }}
            >
              {totals.wins}
            </div>
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span className="h-2 w-2 rounded-[2px]" style={{ background: LOSS }} />
              Losses
            </div>
            <div
              className="mt-1 font-medium leading-none tracking-tight"
              style={{ fontSize: statSize, color: LOSS }}
            >
              {totals.losses}
            </div>
          </div>
        </div>

      <div className="min-h-0 min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={displayData}
            barCategoryGap="28%"
            barGap={3}
            margin={{ top: 6, right: 6, left: 2, bottom: 0 }}
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
            <CartesianGrid strokeDasharray="0" stroke="rgba(201,168,76,0.12)" vertical={false} />
            {highlightLabel ? (
              <ReferenceArea
                x1={highlightLabel}
                x2={highlightLabel}
                strokeOpacity={0}
                fill="#C9A84C"
                fillOpacity={0.06}
              />
            ) : null}
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: AXIS }}
              stroke="transparent"
              tickLine={false}
              axisLine={false}
              dy={6}
            />
            <YAxis
              orientation="right"
              domain={[0, yMax]}
              allowDecimals={false}
              tick={{ fontSize: 11, fill: AXIS }}
              stroke="transparent"
              tickLine={false}
              axisLine={false}
              width={22}
            />
            <Tooltip
              cursor={{ fill: 'transparent' }}
              content={(props) => <WvlTooltip {...props} />}
            />
            <Bar
              dataKey="wins"
              name="Wins"
              fill={WIN}
              radius={[3, 3, 0, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            />
            <Bar
              dataKey="losses"
              name="Losses"
              fill={LOSS}
              radius={[3, 3, 0, 0]}
              maxBarSize={22}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
