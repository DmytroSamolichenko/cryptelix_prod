import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react';

import { apiFetch } from '../lib/apiClient';
import { useTradesSynced } from '../lib/useTradesSynced';

type MixMode = 'asset' | 'market';

type MixSlice = {
  name: string;
  value: number;
  color: string;
};

const MARKET_ORDER = ['Futures COIN-M', 'Futures USDT-M', 'Spot'] as const;

const MARKET_COLORS: Record<string, string> = {
  'Futures COIN-M': '#D4A845',
  'Futures USDT-M': '#3D8F54',
  Spot: '#A8943A',
  Futures: '#8B7AE8',
};

const ASSET_COLORS = [
  '#D4A845',
  '#3D8F54',
  '#A8943A',
  '#5B8DEF',
  '#C084FC',
  '#F97316',
  '#14B8A6',
  '#94A3B8',
];

const GOLD = '#D4A845';
const RING_BG = '#1a1810';

function parseNum(raw: unknown): number {
  const n = Number(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function baseAsset(pair: unknown): string {
  const raw = String(pair ?? '').trim().toUpperCase();
  if (!raw) return 'Unknown';
  const cleaned = raw.replace(/[-_]/g, '/');
  if (cleaned.includes('/')) {
    return cleaned.split('/')[0] || raw;
  }
  return raw.replace(/(USDT|USDC|BUSD|USD)$/i, '') || raw;
}

function marketLabel(accountType: unknown, marketType: unknown): string {
  const mt = String(marketType ?? '').trim().toLowerCase();
  const at = String(accountType ?? '').trim().toLowerCase();
  if (mt === 'usdm') return 'Futures USDT-M';
  if (mt === 'coinm') return 'Futures COIN-M';
  if (at === 'future' || at === 'futures' || at.startsWith('futures')) return 'Futures';
  return 'Spot';
}

function shortLabel(name: string): string {
  if (name === 'Futures COIN-M') return 'COIN-M';
  if (name === 'Futures USDT-M') return 'USDT-M';
  return name;
}

function stopWidgetDrag(event: MouseEvent) {
  event.stopPropagation();
}

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const a = ((angle - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

function donutPath(
  cx: number,
  cy: number,
  rInner: number,
  rOuter: number,
  start: number,
  end: number
): string {
  const sweep = Math.max(0.2, end - start);
  const large = sweep > 180 ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, start);
  const [x2, y2] = polar(cx, cy, rOuter, start + sweep);
  const [x3, y3] = polar(cx, cy, rInner, start + sweep);
  const [x4, y4] = polar(cx, cy, rInner, start);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function MixDonut({
  slices,
  total,
  showSubtitle,
}: {
  slices: MixSlice[];
  total: number;
  showSubtitle: boolean;
}) {
  const glowId = useId().replace(/:/g, '');
  const glowUrl = 'url(#' + glowId + ')';
  const cx = 100;
  const cy = 100;
  const rOuter = 78;
  const rInner = 52;
  const visible =
    total > 0 ? slices.filter((s) => Math.round((s.value / total) * 100) > 0) : [];
  const gap = visible.length > 1 ? 7 : 0;
  const n = Math.max(visible.length, 1);
  const span = 360 - gap * n;
  let cursor = gap / 2;
  const fullRing = visible.length === 1 ? visible[0] : null;

  const arcs =
    total > 0 && visible.length > 1
      ? visible.map((s) => {
          const sweep = Math.max(2.2, (s.value / total) * span);
          const start = cursor;
          cursor += sweep + gap;
          return { ...s, start, end: start + sweep };
        })
      : [];

  const top = total > 0 ? [...slices].sort((a, b) => b.value - a.value)[0] : null;
  const topPct = top && total > 0 ? Math.round((top.value / total) * 100) : 0;
  const holeName = top ? shortLabel(top.name) : '';

  return (
    <div className="relative aspect-square h-full max-h-full w-auto max-w-full">
      <svg viewBox="0 0 200 200" className="h-full w-full overflow-hidden">
        <defs>
          <filter id={glowId} x="-18%" y="-18%" width="136%" height="136%">
            <feGaussianBlur stdDeviation="1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={(rOuter + rInner) / 2}
          fill="none"
          stroke={RING_BG}
          strokeWidth={rOuter - rInner + 2}
        />
        {fullRing ? (
          <circle
            cx={cx}
            cy={cy}
            r={(rOuter + rInner) / 2}
            fill="none"
            stroke={fullRing.color}
            strokeWidth={rOuter - rInner}
            filter={fullRing.color === GOLD ? glowUrl : undefined}
          />
        ) : null}
        {arcs.map((arc) => (
          <path
            key={arc.name}
            d={donutPath(cx, cy, rInner, rOuter, arc.start, arc.end)}
            fill={arc.color}
            filter={arc.color === GOLD ? glowUrl : undefined}
          />
        ))}
        <text
          x="100"
          y={showSubtitle && holeName ? '96' : '104'}
          textAnchor="middle"
          fill="#ffffff"
          fontSize={showSubtitle ? 26 : 22}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
        >
          {top ? topPct + '%' : '—'}
        </text>
        {showSubtitle && holeName ? (
          <text
            x="100"
            y="116"
            textAnchor="middle"
            fill="#71717a"
            fontSize="9"
            fontFamily="system-ui, sans-serif"
          >
            {holeName}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export function PortfolioMixWidget() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [mode, setMode] = useState<MixMode>('market');
  const [trades, setTrades] = useState<Array<Record<string, unknown>>>([]);

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

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/trades');
      if (!res.ok) {
        setTrades([]);
        return;
      }
      const raw = (await res.json()) as unknown;
      setTrades(Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []);
    } catch {
      setTrades([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useTradesSynced(load);

  const slices = useMemo(() => {
    const buckets = new Map<string, number>();
    for (const t of trades) {
      const notional = Math.abs(parseNum(t.entry_price) * parseNum(t.quantity));
      if (notional <= 0) continue;
      const key =
        mode === 'market'
          ? marketLabel(t.account_type, t.market_type)
          : baseAsset(t.pair);
      buckets.set(key, (buckets.get(key) ?? 0) + notional);
    }

    if (mode === 'market') {
      return MARKET_ORDER.map((name) => ({
        name,
        value: buckets.get(name) ?? 0,
        color: MARKET_COLORS[name],
      }));
    }

    const ranked = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 6);
    const rest = ranked.slice(6);
    const out: MixSlice[] = top.map(([name, value], i) => ({
      name,
      value,
      color: ASSET_COLORS[i % ASSET_COLORS.length],
    }));
    const otherSum = rest.reduce((s, [, v]) => s + v, 0);
    if (otherSum > 0) {
      out.push({ name: 'Others', value: otherSum, color: '#52525b' });
    }
    return out;
  }, [trades, mode]);

  const total = slices.reduce((s, x) => s + x.value, 0);
  const w = box.w;
  const h = box.h;
  const dense = (w > 0 && w < 436) || (h > 0 && h < 312);
  const shortNames = w > 0 && w < 576;
  const pad = dense ? 'px-3 pb-3 pr-8 pt-3' : 'px-5 pb-4 pr-9 pt-4';
  const rowPad = dense ? 'py-1.5' : 'py-3';
  const rowText = dense ? 'text-[11px]' : 'text-[13px]';

  return (
    <div
      ref={rootRef}
      className={'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0c0c0c] text-[#e8e4d9] [contain:layout] ' + pad + ' ' + (dense ? 'gap-2' : 'gap-3')}
    >
      <div className="relative z-10 flex shrink-0 items-center justify-between gap-2">
        <h3 className="widget-drag-handle shrink-0 whitespace-nowrap text-[17px] font-medium leading-tight text-yellow-500">
          Volume Mix
        </h3>
        <div className="relative z-20 flex w-fit shrink-0 self-end rounded-xl border border-yellow-600/45 p-0.5">
          {(['asset', 'market'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onMouseDown={stopWidgetDrag}
              onClick={(event) => {
                stopWidgetDrag(event);
                setMode(key);
              }}
              className={
                'rounded-lg font-medium ' +
                (dense ? 'px-2 py-0.5 text-[11px] ' : 'px-3 py-1 text-[12px] ') +
                (mode === key
                  ? 'bg-yellow-500/15 text-yellow-500'
                  : 'text-zinc-400 hover:text-zinc-200')
              }
            >
              {key === 'asset' ? 'Assets' : 'Markets'}
            </button>
          ))}
        </div>
      </div>

      <div className={'flex min-h-0 flex-1 items-stretch overflow-hidden ' + (dense ? 'gap-3' : 'gap-5')}>
        <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
          <MixDonut slices={slices} total={total} showSubtitle={!dense} />
        </div>

        <div className="flex min-h-0 w-[46%] min-w-0 shrink-0 items-stretch overflow-hidden">
          <div className="flex h-full min-h-0 w-full flex-col justify-center overflow-y-auto rounded-2xl border border-yellow-900/35 bg-zinc-950/50 px-3">
            {slices.length === 0 ? (
              <div className="py-4 text-center text-[12px] text-zinc-500">No trade volume yet</div>
            ) : (
              slices.map((s, i) => {
                const pct = total > 0 ? (s.value / total) * 100 : 0;
                const hot = pct >= 50;
                return (
                  <div
                    key={s.name}
                    className={
                      'flex min-h-0 items-center gap-2 ' +
                      rowPad +
                      (i > 0 ? ' border-t border-zinc-800/90' : '')
                    }
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className={'min-w-0 flex-1 truncate font-medium text-zinc-100 ' + rowText}>
                      {shortNames ? shortLabel(s.name) : s.name}
                    </span>
                    <span
                      className={
                        'shrink-0 font-semibold tabular-nums ' +
                        rowText +
                        ' ' +
                        (hot ? 'text-yellow-500' : 'text-zinc-500')
                      }
                    >
                      {Math.round(pct)}%
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
