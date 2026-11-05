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
  'Futures COIN-M': '#FBBF24',
  'Futures USDT-M': '#34D399',
  Spot: '#60A5FA',
  Futures: '#A78BFA',
};

const ASSET_COLORS = [
  '#FBBF24',
  '#34D399',
  '#60A5FA',
  '#F472B6',
  '#A78BFA',
  '#FB923C',
  '#2DD4BF',
  '#94A3B8',
];

const GOLD = '#FBBF24';
const RING_BG = '#12110c';

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

function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amt);
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  const [x1, y1] = polar(cx, cy, r, start);
  const [x2, y2] = polar(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

function MixDonut({
  slices,
  total,
  showSubtitle,
  active,
  onHover,
}: {
  slices: MixSlice[];
  total: number;
  showSubtitle: boolean;
  active: string | null;
  onHover: (name: string | null) => void;
}) {
  const uid = useId().replace(/:/g, '');
  const cx = 100;
  const cy = 100;
  const rMid = 82;
  const thickness = 20;
  // Round caps extend past each arc end by half the stroke, so pull the arc ends in by that angle.
  const capDeg = (thickness / 2 / rMid) * (180 / Math.PI);
  const visible =
    total > 0 ? slices.filter((s) => Math.round((s.value / total) * 100) > 0) : [];
  const multi = visible.length > 1;
  const gap = multi ? 5 : 0;
  const span = 360 - gap * Math.max(visible.length, 1);
  let cursor = gap / 2;
  const fullRing = visible.length === 1 ? visible[0] : null;

  const arcs = multi
    ? visible.map((s) => {
        const sweep = Math.max(2.2, (s.value / total) * span);
        const start = cursor;
        cursor += sweep + gap;
        let lo = start + capDeg;
        let hi = start + sweep - capDeg;
        if (hi - lo < 0.6) {
          const mid = start + sweep / 2;
          lo = mid - 0.3;
          hi = mid + 0.3;
        }
        return { ...s, d: arcPath(cx, cy, rMid, lo, hi) };
      })
    : [];

  const top = total > 0 ? [...slices].sort((a, b) => b.value - a.value)[0] : null;
  const focus = (active ? slices.find((s) => s.name === active) : null) ?? top;
  const focusPct = focus && total > 0 ? Math.round((focus.value / total) * 100) : 0;
  const focusName = focus ? shortLabel(focus.name) : '';
  const gradId = (i: number) => `${uid}-g${i}`;

  return (
    <div className="relative aspect-square h-full max-h-full w-auto max-w-full">
      <svg
        viewBox="0 0 200 200"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={
          total > 0
            ? 'Volume mix: ' +
              slices
                .map((s) => `${s.name} ${Math.round((s.value / total) * 100)}%`)
                .join(', ')
            : 'Volume mix: no data'
        }
      >
        <defs>
          <filter
            id={`${uid}-glow`}
            filterUnits="userSpaceOnUse"
            x="-20"
            y="-20"
            width="240"
            height="240"
          >
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {visible.map((s, i) => (
            <linearGradient
              key={s.name}
              id={gradId(i)}
              gradientUnits="userSpaceOnUse"
              x1="30"
              y1="10"
              x2="170"
              y2="190"
            >
              <stop offset="0%" stopColor={lighten(s.color, 0.28)} />
              <stop offset="100%" stopColor={s.color} />
            </linearGradient>
          ))}
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={rMid}
          fill="none"
          stroke={RING_BG}
          strokeWidth={thickness}
        />
        {fullRing ? (
          <circle
            cx={cx}
            cy={cy}
            r={rMid}
            fill="none"
            stroke={`url(#${gradId(0)})`}
            strokeWidth={thickness}
            filter={`url(#${uid}-glow)`}
          />
        ) : null}
        {arcs.map((arc, i) => {
          const isActive = active === arc.name;
          const dim = active != null && !isActive;
          return (
            <path
              key={arc.name}
              d={arc.d}
              fill="none"
              stroke={`url(#${gradId(i)})`}
              strokeWidth={isActive ? thickness + 4 : thickness}
              strokeLinecap="round"
              opacity={dim ? 0.35 : 1}
              filter={isActive || (active == null && arc.color === GOLD) ? `url(#${uid}-glow)` : undefined}
              className="cursor-pointer transition-[stroke-width,opacity] duration-200 motion-reduce:transition-none"
              onMouseEnter={() => onHover(arc.name)}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
        <text
          x="100"
          y={showSubtitle && focusName ? '99' : '108'}
          textAnchor="middle"
          fill="#f5f1e6"
          fontSize={showSubtitle ? 34 : 28}
          fontWeight={600}
          fontFamily="system-ui, sans-serif"
        >
          {focus ? focusPct + '%' : '—'}
        </text>
        {showSubtitle && focusName ? (
          <text
            x="100"
            y="124"
            textAnchor="middle"
            fill="#a1a1aa"
            fontSize="11"
            letterSpacing="0.6"
            fontFamily="system-ui, sans-serif"
          >
            {focusName.toUpperCase()}
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
  const [active, setActive] = useState<string | null>(null);
  const [trades,setTrades] = useState<Array<Record<string, unknown>>>([]);

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
  // Too narrow for donut and legend side by side: stack them.
  const stacked = w > 0 && w < 340;
  const shortNames = w > 0 && w < 576;
  const pad = dense ? 'px-3 pb-2.5 pr-8 pt-2.5' : 'px-4 pb-3 pr-9 pt-3.5';
  const rowPad = dense ? 'py-1.5' : 'py-2.5';
  const rowText = dense ? 'text-[11px]' : 'text-[13px]';

  return (
    <div
      ref={rootRef}
      className={'flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden bg-[#0c0c0c] text-[#e8e4d9] [contain:layout] ' + pad + ' ' + (dense ? 'gap-1.5' : 'gap-2')}
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

      <div className={'flex min-h-0 flex-1 overflow-hidden ' + (stacked ? 'flex-col items-stretch ' : 'items-center ') + (dense ? 'gap-2' : 'gap-3')}>
        <div className={'flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden ' + (stacked ? 'w-full' : 'h-full')}>
          <MixDonut
            slices={slices}
            total={total}
            showSubtitle={!dense}
            active={active}
            onHover={setActive}
          />
        </div>

        <div className={'flex min-h-0 min-w-0 shrink-0 items-center overflow-hidden ' + (stacked ? 'max-h-[55%] w-full' : 'max-h-full w-[44%]')}>
          <div className="flex max-h-full min-h-0 w-full flex-col overflow-y-auto rounded-2xl border border-yellow-900/35 bg-zinc-950/50 px-3">
            {slices.length === 0 ? (
              <div className="py-4 text-center text-[12px] text-zinc-500">No trade volume yet</div>
            ) : (
              slices.map((s, i) => {
                const pct = total > 0 ? (s.value / total) * 100 : 0;
                const hot = pct >= 50;
                return (
                  <div
                    key={s.name}
                    tabIndex={0}
                    onMouseEnter={() => setActive(s.name)}
                    onMouseLeave={() => setActive(null)}
                    onFocus={() => setActive(s.name)}
                    onBlur={() => setActive(null)}
                    className={
                      'flex min-h-0 flex-col gap-1.5 outline-none transition-opacity duration-200 motion-reduce:transition-none ' +
                      rowPad +
                      (i > 0 ? ' border-t border-zinc-800/90' : '') +
                      (active != null && active !== s.name ? ' opacity-50' : '')
                    }
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: s.color, boxShadow: `0 0 8px ${s.color}66` }}
                      />
                      <span className={'min-w-0 flex-1 truncate font-medium text-zinc-100 ' + rowText}>
                        {shortNames ? shortLabel(s.name) : s.name}
                      </span>
                      <span
                        className={
                          'shrink-0 font-semibold tabular-nums ' +
                          rowText +
                          ' ' +
                          (hot ? 'text-yellow-500' : 'text-zinc-400')
                        }
                      >
                        {Math.round(pct)}%
                      </span>
                    </div>
                    {!dense && (
                      <div className="h-[3px] w-full overflow-hidden rounded-full bg-zinc-800/80">
                        <div
                          className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
                          style={{ width: `${pct}%`, backgroundColor: s.color }}
                        />
                      </div>
                    )}
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
