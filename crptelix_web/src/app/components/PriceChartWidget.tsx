import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, LineChart as LineIcon } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { apiFetch } from '../lib/apiClient';
import { useTradesSynced } from '../lib/useTradesSynced';
import { LOSS, WIN } from '../lib/widgetColors';
import { CoinLogo, assetDisplayName } from './CoinLogo';

type TradeRow = Record<string, unknown>;
type ChartMode = 'line' | 'candles';
type RangeKey = '1h' | '4h' | '1d' | '1w' | '1M' | '1y' | 'all';

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type Ticker = {
  last: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  quoteVolume: number;
  marketCap: number | null;
  base: string;
  quote: string;
};

const RANGES: { key: RangeKey; label: string; interval: string; limit: number }[] = [
  { key: '1h', label: '1H', interval: '1h', limit: 72 },
  { key: '4h', label: '4H', interval: '4h', limit: 84 },
  { key: '1d', label: '1D', interval: '1d', limit: 90 },
  { key: '1w', label: '1W', interval: '1w', limit: 52 },
  { key: '1M', label: '1M', interval: '1M', limit: 36 },
  { key: '1y', label: '1Y', interval: '1w', limit: 52 },
  { key: 'all', label: 'All', interval: '1M', limit: 60 },
];

const klineCache = new Map<string, Candle[]>();

function klineCacheKey(pair: string, interval: string, limit: number): string {
  return `${pair}|${interval}|${limit}`;
}

function candlesFromPayload(payload: { candles?: Array<Record<string, unknown>> }): Candle[] {
  const rows = Array.isArray(payload.candles) ? payload.candles : [];
  return rows
    .map((c) => ({
      time: Number(c.open_time_ms),
      open: parseNum(c.open),
      high: parseNum(c.high),
      low: parseNum(c.low),
      close: parseNum(c.close),
      volume: parseNum(c.volume),
    }))
    .filter((c) => c.time > 0 && c.close > 0 && c.high > 0 && c.low > 0);
}

const QUOTE_ONLY = new Set(['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD', 'DAI', 'TUSD']);
const LINE = '#c5cdd8';
const UP = '#2ebd85';
const DOWN = '#e45d78';
const GRID = 'rgba(201,168,76,0.12)';
const AXIS = '#6b675c';

function binanceSpotKey(pair: string): string | null {
  let raw = pair.trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes(':')) raw = raw.split(':')[0];
  raw = raw.replace(/[-_ ]/g, '/');
  let base = '';
  let quote = '';
  if (raw.includes('/')) {
    [base, quote] = raw.split('/');
  } else {
    const known = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'USD', 'BTC', 'ETH', 'BNB'];
    const q = known.find((k) => raw.endsWith(k) && raw.length > k.length);
    if (!q) return null;
    base = raw.slice(0, -q.length);
    quote = q;
  }
  base = (base || '').trim();
  quote = (quote || '').trim();
  if (!base || !quote || QUOTE_ONLY.has(base) || base === quote) return null;
  if (quote === 'USD') quote = 'USDT';
  return `${base}${quote}`;
}

function splitSymbol(key: string): { base: string; quote: string } {
  const quotes = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'BTC', 'ETH', 'BNB'];
  const quote = quotes.find((q) => key.endsWith(q) && key.length > q.length) ?? 'USDT';
  return { base: key.slice(0, -quote.length) || key, quote };
}

function parseNum(raw: unknown): number {
  const n = Number(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatAxisPrice(n: number): string {
  if (!Number.isFinite(n)) return '';
  const abs = Math.abs(n);
  if (abs >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (abs >= 10) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (abs >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 5 });
}

function niceTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0) || count < 2) return [max];
  const raw = span / count;
  const exp = Math.floor(Math.log10(raw));
  const frac = raw / 10 ** exp;
  const nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  const step = nice * 10 ** exp;
  const start = Math.ceil((min + step * 0.08) / step) * step;
  const ticks: number[] = [];
  for (let value = start; value < max - step * 0.08; value += step) {
    ticks.push(Number(value.toPrecision(8)));
  }
  return ticks.length ? ticks : [max];
}

function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(0)}`;
}

function formatAxisDate(ms: number, range: RangeKey): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  if (range === '1h' || range === '4h') {
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' });
  }
  if (range === '1M' || range === '1y' || range === 'all') {
    return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatVolumeShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function PairPicker({
  pair,
  pairs,
  disabled,
  onChange,
}: {
  pair: string;
  pairs: string[];
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 200 });
  const current = splitSymbol(pair || 'SOLUSDT');

  const placeMenu = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({
      top: rect.bottom + 8,
      left: rect.left,
      width: Math.max(rect.width + 28, 196),
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onPointer = (event: Event) => {
      const node = event.target as HTMLElement | null;
      if (triggerRef.current?.contains(node)) return;
      if (node?.closest('[data-pair-menu]')) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onDismiss = () => setOpen(false);
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onDismiss, true);
      window.removeEventListener('resize', onDismiss);
    };
  }, [open, placeMenu]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled || !pairs.length}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group/pair -ml-0.5 flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-0.5 text-left outline-none transition-colors hover:bg-yellow-500/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="whitespace-nowrap text-[15px] font-semibold tracking-wide text-[#e8e4d9]">
          {current.base} / {current.quote}
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="inline-flex text-zinc-500 group-hover/pair:text-zinc-200"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </motion.span>
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              data-pair-menu
              role="listbox"
              initial={{ opacity: 0, y: -8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              style={{ top: pos.top, left: pos.left, width: pos.width }}
              className="fixed z-[80] origin-top overflow-hidden rounded-xl border border-yellow-900/40 bg-zinc-950/95 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-md"
            >
              <div className="max-h-56 overflow-y-auto py-1">
                {pairs.map((item, index) => {
                  const parts = splitSymbol(item);
                  const selected = item === pair;
                  return (
                    <motion.button
                      key={item}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03, duration: 0.16 }}
                      onClick={() => {
                        onChange(item);
                        setOpen(false);
                      }}
                      className={
                        'flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors ' +
                        (selected
                          ? 'bg-white/10 text-[#e8e4d9]'
                          : 'text-zinc-300 hover:bg-white/5 hover:text-[#e8e4d9]')
                      }
                    >
                      <CoinLogo symbol={parts.base} className="h-5 w-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {parts.base} / {parts.quote}
                      </span>
                      {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[#e8e4d9]" />}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}

function CandleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <path d="M4.5 3v2.2M4.5 9.5V13" stroke="currentColor" strokeWidth="1.2" />
      <rect x="3.1" y="5.2" width="2.8" height="4.3" rx="0.4" fill="currentColor" />
      <path d="M11.5 2.5v3.1M11.5 10.2V13.5" stroke="currentColor" strokeWidth="1.2" />
      <rect x="10.1" y="5.6" width="2.8" height="4.6" rx="0.4" fill="currentColor" />
    </svg>
  );
}

function PricePlot({
  candles,
  mode,
  range,
  width,
  height,
}: {
  candles: Candle[];
  mode: ChartMode;
  range: RangeKey;
  width: number;
  height: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (width < 40 || height < 40 || candles.length === 0) return null;

  const showVolume = height >= 180;
  const pad = {
    l: 10,
    r: width < 400 ? 50 : 58,
    t: 6,
    b: showVolume ? 22 : 18,
  };
  const innerW = Math.max(10, width - pad.l - pad.r);
  const innerH = Math.max(10, height - pad.t - pad.b);
  const volH = showVolume ? Math.max(20, Math.min(36, innerH * 0.14)) : 0;
  const gap = showVolume ? 10 : 0;
  const priceH = Math.max(24, innerH - volH - gap);
  const valid = candles.filter((c) => c.low > 0 && c.high > 0 && c.close > 0);
  const series = valid.length ? valid : candles;
  const minP = Math.min(...series.map((c) => c.low));
  const maxP = Math.max(...series.map((c) => c.high));
  const span = Math.max(maxP - minP, maxP * 0.02, 0.0001);
  const yMin = Math.max(0, minP - span * 0.04);
  const yMax = maxP + span * 0.08;
  const maxVol = Math.max(...series.map((c) => c.volume), 1);
  const n = series.length;
  const step = innerW / Math.max(n, 1);

  const xAt = (i: number) => pad.l + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yAt = (p: number) => pad.t + ((yMax - p) / (yMax - yMin)) * priceH;
  const last = series[n - 1];
  const lastUp = last.close >= last.open;
  const lastY = yAt(last.close);
  const hi = hover != null ? series[hover] : null;
  const hiUp = hi ? hi.close >= hi.open : lastUp;

  const yTicks = niceTicks(yMin, yMax, height < 220 ? 3 : 4);
  const xCount = width < 420 ? 4 : 6;
  const xTicks = Array.from({ length: xCount }, (_, i) =>
    Math.round((i / Math.max(xCount - 1, 1)) * (n - 1))
  );

  const linePath = series
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(2)} ${yAt(c.close).toFixed(2)}`)
    .join(' ');

  const onMove = (event: MouseEvent<SVGSVGElement>) => {
    const svg = event.currentTarget;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const x = local.x - pad.l;
    const span = Math.max(n - 1, 1);
    const i = Math.round((x / innerW) * span);
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block h-full w-full select-none"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {yTicks.map((p) => {
        const y = yAt(p);
        if (y < pad.t + 6 || y > pad.t + priceH - 6) return null;
        return (
          <g key={p}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke={GRID} strokeDasharray="3 5" />
            <text x={width - pad.r + 6} y={y + 3} fill={AXIS} fontSize={10} fontFamily="system-ui">
              {formatAxisPrice(p)}
            </text>
          </g>
        );
      })}

      <line
        x1={pad.l}
        x2={width - pad.r}
        y1={lastY}
        y2={lastY}
        stroke={mode === 'candles' ? (lastUp ? UP : DOWN) : 'rgba(197,205,216,0.45)'}
        strokeDasharray="3 4"
      />

      {showVolume &&
        series.map((c, i) => {
          const up = c.close >= c.open;
          const bw = Math.max(2, Math.min(10, step * 0.7));
          const x = xAt(i) - bw / 2;
          const h = (c.volume / maxVol) * volH;
          const y = pad.t + priceH + gap + (volH - h);
          return (
            <rect
              key={`v-${c.time}`}
              x={x}
              y={y}
              width={bw}
              height={h}
              fill={up ? UP : DOWN}
              opacity={0.55}
            />
          );
        })}

      {mode === 'line' ? (
        <path d={linePath} fill="none" stroke={LINE} strokeWidth={1.6} strokeLinejoin="round" />
      ) : (
        series.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? UP : DOWN;
          const x = xAt(i);
          const bw = Math.max(3, Math.min(16, step * 0.7));
          const yOpen = yAt(c.open);
          const yClose = yAt(c.close);
          const bodyTop = Math.min(yOpen, yClose);
          const bodyH = Math.max(1, Math.abs(yClose - yOpen));
          return (
            <g key={c.time}>
              <line x1={x} x2={x} y1={yAt(c.high)} y2={yAt(c.low)} stroke={color} strokeWidth={1} />
              <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} rx={0.4} />
            </g>
          );
        })
      )}

      {hover != null && (
        <line
          x1={xAt(hover)}
          x2={xAt(hover)}
          y1={pad.t}
          y2={pad.t + priceH + gap + volH}
          stroke="rgba(201,168,76,0.45)"
          strokeDasharray="2 3"
        />
      )}

      {xTicks.map((i, idx) => (
        <text
          key={`x-${i}`}
          x={xAt(i)}
          y={height - 5}
          fill={AXIS}
          fontSize={10}
          textAnchor={idx === 0 ? 'start' : idx === xTicks.length - 1 ? 'end' : 'middle'}
          fontFamily="system-ui"
        >
          {formatAxisDate(series[i].time, range)}
        </text>
      ))}

      <rect
        x={width - pad.r + 4}
        y={lastY - 9}
        width={pad.r - 8}
        height={18}
        rx={4}
        fill={mode === 'candles' ? (lastUp ? UP : DOWN) : '#2a2a2a'}
      />
      <text
        x={width - pad.r / 2 + 2}
        y={lastY + 3.5}
        fill={mode === 'candles' ? '#06140e' : '#e8e4d9'}
        fontSize={10}
        fontWeight={600}
        textAnchor="middle"
        fontFamily="system-ui"
      >
        {formatPrice(last.close)}
      </text>

      {hi && hover != null && (
        <g>
          <rect
            x={Math.min(Math.max(8, xAt(hover) - 70), width - 150)}
            y={10}
            width={140}
            height={showVolume ? 58 : 44}
            rx={6}
            fill="#141414"
            stroke="#2a2a2a"
          />
          <text
            x={Math.min(Math.max(16, xAt(hover) - 62), width - 142)}
            y={26}
            fill={hiUp ? UP : DOWN}
            fontSize={10}
            fontFamily="system-ui"
          >
            {formatAxisDate(hi.time, range)} · {formatPrice(hi.close)}
          </text>
          <text
            x={Math.min(Math.max(16, xAt(hover) - 62), width - 142)}
            y={42}
            fill="#9a9486"
            fontSize={10}
            fontFamily="system-ui"
          >
            O {formatPrice(hi.open)}  H {formatPrice(hi.high)}
          </text>
          {showVolume && (
            <text
              x={Math.min(Math.max(16, xAt(hover) - 62), width - 142)}
              y={56}
              fill="#9a9486"
              fontSize={10}
              fontFamily="system-ui"
            >
              L {formatPrice(hi.low)}  Vol {formatVolumeShort(hi.volume)}
            </text>
          )}
        </g>
      )}
    </svg>
  );
}

export function PriceChartWidget() {
  const rootRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [plot, setPlot] = useState({ w: 0, h: 0 });
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [pair, setPair] = useState('');
  const [range, setRange] = useState<RangeKey>('1w');
  const [mode, setMode] = useState<ChartMode>('line');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [klineError, setKlineError] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setPlot({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const loadTrades = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/trades');
      if (!res.ok) {
        setTrades([]);
        return;
      }
      const raw = (await res.json()) as unknown;
      setTrades(Array.isArray(raw) ? (raw as TradeRow[]) : []);
    } catch {
      setTrades([]);
    }
  }, []);

  useEffect(() => {
    void loadTrades();
  }, [loadTrades]);

  useTradesSynced(loadTrades);

  const pairs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of trades) {
      const key = binanceSpotKey(String(t.pair ?? ''));
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);
  }, [trades]);

  useEffect(() => {
    if (!pairs.length) {
      setPair('');
      return;
    }
    if (!pair || !pairs.includes(pair)) setPair(pairs[0]);
  }, [pairs, pair]);

  const selected = RANGES.find((r) => r.key === range) ?? RANGES[3];
  const { base, quote } = splitSymbol(pair || 'SOLUSDT');

  useEffect(() => {
    if (!pair) {
      setCandles([]);
      setTicker(null);
      return;
    }
    let cancelled = false;
    const cacheId = klineCacheKey(pair, selected.interval, selected.limit);
    const cached = klineCache.get(cacheId);
    if (cached?.length) {
      setCandles(cached);
      setKlineError(false);
    }

    const loadKlines = async () => {
      try {
        const klineRes = await apiFetch(
          `/api/v1/market/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(selected.interval)}&limit=${selected.limit}`
        );
        if (!klineRes.ok) {
          if (!cancelled && !cached?.length) {
            setCandles([]);
            setKlineError(true);
          }
          return;
        }
        const next = candlesFromPayload(
          (await klineRes.json()) as { candles?: Array<Record<string, unknown>> }
        );
        klineCache.set(cacheId, next);
        if (!cancelled) {
          setCandles(next);
          setKlineError(next.length === 0);
        }
      } catch {
        if (!cancelled && !cached?.length) {
          setCandles([]);
          setKlineError(true);
        }
      }
    };

    const loadTicker = async () => {
      try {
        const tickerRes = await apiFetch(
          `/api/v1/market/ticker?symbol=${encodeURIComponent(pair)}`
        );
        if (!tickerRes.ok || cancelled) return;
        const t = (await tickerRes.json()) as Record<string, unknown>;
        if (cancelled) return;
        setTicker({
          last: parseNum(t.last_price),
          change: parseNum(t.price_change),
          changePct: parseNum(t.price_change_percent),
          high: parseNum(t.high_price),
          low: parseNum(t.low_price),
          quoteVolume: parseNum(t.quote_volume),
          marketCap: t.market_cap_usd == null ? null : parseNum(t.market_cap_usd),
          base: String(t.base || base),
          quote: String(t.quote || quote),
        });
      } catch {
        /* keep last ticker */
      }
    };

    void loadKlines();
    void loadTicker();
    return () => {
      cancelled = true;
    };
  }, [pair, range, selected.interval, selected.limit, base, quote]);

  const last = candles.length ? candles[candles.length - 1] : null;
  const price = ticker?.last || last?.close || 0;
  const change = ticker?.change ?? (last ? last.close - last.open : 0);
  const changePct = ticker?.changePct ?? 0;
  const up = change >= 0;
  const compact = box.w > 0 && box.w < 560;
  const tight = box.h > 0 && box.h < 360;
  const scale = box.w > 0 ? Math.min(1, Math.max(0.82, box.w / 700)) : 1;
  const priceSize = Math.round((compact ? 26 : 30) * scale);
  const ohlc = last;
  const ohlcUp = ohlc ? ohlc.close >= ohlc.open : up;

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3 bg-[#0c0c0c] px-4 pb-3 pr-9 pt-3.5 text-[#e8e4d9] [contain:layout]"
    >
      <div
        className={
          'flex shrink-0 ' +
          (compact || tight ? 'flex-col gap-3' : 'items-center justify-between gap-6')
        }
      >
        <div className="widget-drag-handle flex min-w-0 shrink-0 flex-col gap-3">
          <h3 className="truncate text-[17px] font-medium leading-tight text-yellow-500">
            Price Chart
          </h3>
          <div className="flex items-center gap-3">
            <CoinLogo
              symbol={base}
              className="h-8 w-8 shrink-0"
            />
            <div className="min-w-0 shrink-0">
              <PairPicker
                pair={pair}
                pairs={pairs}
                disabled={!pairs.length}
                onChange={setPair}
              />
              <p className="whitespace-nowrap text-[11px] leading-tight text-zinc-500">
                {assetDisplayName(ticker?.base || base)}
                <span className="mx-1.5 text-zinc-700">|</span>
                Spot
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-medium leading-none tracking-tight text-[#e8e4d9]"
                style={{ fontSize: priceSize }}
              >
                ${price ? formatPrice(price) : '—'}
              </span>
              <span className="text-[11px] text-zinc-500">{ticker?.quote || quote}</span>
            </div>
            <p
              className="mt-2 text-[12px] leading-none"
              style={{ color: up ? WIN : LOSS }}
            >
              {up ? '+' : ''}
              {formatPrice(Math.abs(change))} ({up ? '+' : ''}
              {changePct.toFixed(2)}%)
              <span className="ml-1 text-zinc-500">24h</span>
            </p>
          </div>
        </div>
        {!tight && (
          <div
            className={
              'grid min-w-0 text-right ' + (compact ? 'grid-cols-2 gap-x-5 gap-y-2' : 'grid-cols-4 gap-x-5')
            }
          >
            {[
              ['24h high', formatPrice(ticker?.high || 0)],
              ['24h low', formatPrice(ticker?.low || 0)],
              ['24h volume', formatCompact(ticker?.quoteVolume)],
              ['Market cap', formatCompact(ticker?.marketCap)],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <div className="text-[13px] leading-tight text-zinc-500">{label}</div>
                <div className="mt-1 truncate text-[20px] font-medium leading-tight text-zinc-200">{value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex min-h-0 shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {RANGES.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setRange(item.key)}
              className={
                'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium ' +
                (range === item.key
                  ? 'bg-white/10 text-[#e8e4d9]'
                  : 'text-zinc-500 hover:text-zinc-300')
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setMode('line')}
            aria-label="Line chart"
            className={
              'rounded-md p-1.5 ' +
              (mode === 'line' ? 'bg-white/10 text-[#e8e4d9]' : 'text-zinc-500 hover:text-zinc-300')
            }
          >
            <LineIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMode('candles')}
            aria-label="Candlestick chart"
            className={
              'rounded-md p-1.5 ' +
              (mode === 'candles' ? 'bg-white/10 text-[#e8e4d9]' : 'text-zinc-500 hover:text-zinc-300')
            }
          >
            <CandleGlyph className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {ohlc && !tight && (
        <p
          className="shrink-0 whitespace-nowrap font-mono text-[10px] leading-none"
          style={{ color: ohlcUp ? WIN : LOSS }}
        >
          {base}
          {quote} · {selected.label} &nbsp;O {formatPrice(ohlc.open)} &nbsp;H {formatPrice(ohlc.high)}{' '}
          &nbsp;L {formatPrice(ohlc.low)} &nbsp;C {formatPrice(ohlc.close)}
        </p>
      )}

      <div ref={plotRef} className="min-h-0 min-w-0 flex-1">
        {candles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[#6b675c]">
            {klineError
              ? 'No public Binance price for this pair'
              : pair
                ? 'Loading price…'
                : 'No pairs in Deal Base'}
          </div>
        ) : (
          <PricePlot
            key={`${pair}-${range}-${mode}`}
            candles={candles}
            mode={mode}
            range={range}
            width={plot.w}
            height={plot.h}
          />
        )}
      </div>
    </div>
  );
}
