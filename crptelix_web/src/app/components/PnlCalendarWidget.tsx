import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  startOfMonth,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { formatUsd, tradeDate, tradeNet } from '../lib/tradeMetrics';
import { useDealBaseTrades } from '../lib/useDealBaseTrades';
import { heatFill, LOSS, WIN } from '../lib/widgetColors';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const NEUTRAL = '#e8e4d9';

type DayBucket = { net: number; count: number };

function stopWidgetDrag(event: MouseEvent) {
  event.stopPropagation();
}

export function PnlCalendarWidget() {
  const trades = useDealBaseTrades();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const el = entries[0]?.target as HTMLElement | undefined;
      if (!el) return;
      setBox({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const buckets = useMemo(() => {
    const map = new Map<string, DayBucket>();
    for (const t of trades) {
      const d = tradeDate(t.date);
      if (!d) continue;
      const key = format(d, 'yyyy-MM-dd');
      const prev = map.get(key) ?? { net: 0, count: 0 };
      map.set(key, { net: prev.net + tradeNet(t), count: prev.count + 1 });
    }
    return map;
  }, [trades]);

  const days = useMemo(() => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    return eachDayOfInterval({ start, end });
  }, [month]);

  const leadBlanks = (getDay(startOfMonth(month)) + 6) % 7;
  const monthNets = days.map((d) => buckets.get(format(d, 'yyyy-MM-dd'))?.net ?? 0);
  const maxAbs = Math.max(0, ...monthNets.map((n) => Math.abs(n)));
  const monthNet = monthNets.reduce((s, n) => s + n, 0);

  const dense = (box.w > 0 && box.w < 380) || (box.h > 0 && box.h < 300);
  const daySize = dense ? 10 : 11;

  return (
    <div
      ref={rootRef}
      className={
        'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0c0c0c] pr-9 text-[#e8e4d9] [contain:layout] ' +
        (dense ? 'gap-1.5 px-3 pb-2 pt-3' : 'gap-2 px-4 pb-3 pt-3.5')
      }
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="widget-drag-handle min-w-0 truncate text-[17px] font-medium leading-tight text-yellow-500">
          PnL Calendar
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200"
            onMouseDown={stopWidgetDrag}
            onClick={(event) => {
              stopWidgetDrag(event);
              setMonth((m) => addMonths(m, -1));
            }}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="min-w-[6.5rem] text-center text-[12px] font-medium text-zinc-400">
            {format(month, dense ? 'MMM yyyy' : 'MMMM yyyy')}
          </span>
          <button
            type="button"
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-full border border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-200"
            onMouseDown={stopWidgetDrag}
            onClick={(event) => {
              stopWidgetDrag(event);
              setMonth((m) => addMonths(m, 1));
            }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="-mr-2 flex min-h-0 flex-1 flex-col gap-1 pl-3">
        <div className="grid shrink-0 grid-cols-7 gap-1 text-center text-[10px] text-zinc-500">
          {WEEKDAYS.map((d) => (
            <div key={d}>{dense ? d.slice(0, 1) : d}</div>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-7 gap-1 [grid-auto-rows:minmax(0,1fr)]">
          {Array.from({ length: leadBlanks }, (_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map((d) => {
            const key = format(d, 'yyyy-MM-dd');
            const bucket = buckets.get(key);
            const net = bucket?.net ?? 0;
            const title = bucket
              ? `${key} · ${formatUsd(net)} · ${bucket.count} trade${bucket.count === 1 ? '' : 's'}`
              : key;
            return (
              <div
                key={key}
                title={title}
                className="flex min-h-0 items-center justify-center rounded-md border border-zinc-800 bg-white/[0.03] text-zinc-300"
                style={{
                  fontSize: daySize,
                  backgroundColor: heatFill(net, maxAbs) ?? undefined,
                }}
              >
                {format(d, 'd')}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between text-[11px] text-zinc-500">
        <span>Net this month</span>
        <span
          className="tabular-nums"
          style={{
            color: monthNet > 0 ? WIN : monthNet < 0 ? LOSS : NEUTRAL,
          }}
        >
          {formatUsd(monthNet)}
        </span>
      </div>
    </div>
  );
}
