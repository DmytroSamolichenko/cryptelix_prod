import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';
import { Dropdown, type DropdownOption } from './WidgetDropdown';

type SpreadVenue = 'phoenix' | 'backpack' | 'pacifica';

export type SpreadPrefs = {
  symbol: string;
  venue: SpreadVenue;
  compareOn: boolean;
};

type SpreadRow = {
  venue: SpreadVenue;
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread_abs: number;
  spread_bps: number;
  fetched_at?: string;
};

type ComparePayload = {
  symbol: string;
  venues: SpreadRow[];
  tightest_venue: SpreadVenue | null;
  errors?: Record<string, string> | null;
};

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK'] as const;
const ALL_VENUES: SpreadVenue[] = ['phoenix', 'backpack', 'pacifica'];
const VENUE_LABEL: Record<SpreadVenue, string> = {
  phoenix: 'Phoenix',
  backpack: 'Backpack',
  pacifica: 'Pacifica',
};

const VENUE_HINT: Record<SpreadVenue, string> = {
  phoenix: 'DEX',
  backpack: 'CEX',
  pacifica: 'DEX',
};

const VENUE_OPTIONS: DropdownOption<SpreadVenue>[] = ALL_VENUES.map((v) => ({
  value: v,
  label: VENUE_LABEL[v],
  hint: VENUE_HINT[v],
}));

const DEFAULT_PREFS: SpreadPrefs = {
  symbol: 'SOL',
  venue: 'phoenix',
  compareOn: false,
};

function isSpreadVenue(v: unknown): v is SpreadVenue {
  return v === 'phoenix' || v === 'backpack' || v === 'pacifica';
}

export function parseSpreadPrefs(raw: unknown): SpreadPrefs {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const symbolRaw = String(d.symbol ?? DEFAULT_PREFS.symbol).trim().toUpperCase();
  return {
    symbol: (SYMBOLS as readonly string[]).includes(symbolRaw)
      ? symbolRaw
      : DEFAULT_PREFS.symbol,
    venue: isSpreadVenue(d.venue) ? d.venue : DEFAULT_PREFS.venue,
    compareOn: Boolean(d.compareOn),
  };
}

function formatBps(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(2)} bps`;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function parseApiError(text: string, status: number): string {
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === 'string') return j.detail;
  } catch {
    /* plain */
  }
  return text || `HTTP ${status}`;
}

interface SpreadWidgetProps {
  initialData?: unknown;
  onPersistPrefs?: (prefs: SpreadPrefs) => void;
}

export function SpreadWidget({ initialData, onPersistPrefs }: SpreadWidgetProps) {
  const initial = useMemo(() => parseSpreadPrefs(initialData), [initialData]);
  const [symbol, setSymbol] = useState(initial.symbol);
  const [venue, setVenue] = useState<SpreadVenue>(initial.venue);
  const [compareOn, setCompareOn] = useState(initial.compareOn);
  const [single, setSingle] = useState<SpreadRow | null>(null);
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipPersist = useRef(true);
  const onPersistRef = useRef(onPersistPrefs);
  onPersistRef.current = onPersistPrefs;

  const prefs: SpreadPrefs = useMemo(
    () => ({ symbol, venue, compareOn }),
    [symbol, venue, compareOn]
  );

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    onPersistRef.current?.(prefs);
  }, [prefs]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (compareOn) {
        const qs = new URLSearchParams({
          symbol,
          venues: ALL_VENUES.join(','),
        });
        const res = await apiFetch(`/api/v1/venue/spread/compare?${qs}`);
        if (!res.ok) throw new Error(parseApiError(await res.text(), res.status));
        setCompare((await res.json()) as ComparePayload);
        setSingle(null);
      } else {
        const qs = new URLSearchParams({ venue, symbol });
        const res = await apiFetch(`/api/v1/venue/spread?${qs}`);
        if (!res.ok) throw new Error(parseApiError(await res.text(), res.status));
        setSingle((await res.json()) as SpreadRow);
        setCompare(null);
      }
    } catch (e) {
      setSingle(null);
      setCompare(null);
      setError(e instanceof Error ? e.message : 'Failed to load spread');
    } finally {
      setLoading(false);
    }
  }, [compareOn, symbol, venue]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          title="Symbol"
          value={symbol}
          onChange={setSymbol}
          options={SYMBOLS.map((s) => ({ value: s, label: s }))}
        />
        {!compareOn && (
          <Dropdown<SpreadVenue>
            title="Venue"
            value={venue}
            onChange={setVenue}
            options={VENUE_OPTIONS}
          />
        )}
        <button
          type="button"
          role="switch"
          aria-checked={compareOn}
          onClick={() => setCompareOn((v) => !v)}
          className="ml-auto inline-flex shrink-0 items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200"
          title="Compare venues"
        >
          Compare
          <span
            className={`relative h-[17px] w-[30px] rounded-full transition-colors ${
              compareOn ? 'bg-yellow-400' : 'bg-zinc-800'
            }`}
          >
            <span
              className={`absolute top-[2px] h-[13px] w-[13px] rounded-full transition-all ${
                compareOn ? 'left-[15px] bg-zinc-950' : 'left-[2px] bg-zinc-500'
              }`}
            />
          </span>
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}
        {!error && !compareOn && single && (
          <div className="flex min-h-full flex-col">
            <SpreadCard row={single} large />
          </div>
        )}
        {!error && compareOn && compare && (
          <div className="flex min-h-full flex-col gap-2">
            {compare.venues.map((row) => (
              <SpreadCard
                key={row.venue}
                row={row}
                highlight={compare.tightest_venue === row.venue}
              />
            ))}
            {compare.errors &&
              Object.entries(compare.errors).map(([v, msg]) => (
                <div
                  key={v}
                  className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200"
                >
                  {VENUE_LABEL[v as SpreadVenue] ?? v}: {msg}
                </div>
              ))}
          </div>
        )}
        {!error && loading && !single && !compare && (
          <div className="flex h-24 items-center justify-center text-zinc-500">Loading…</div>
        )}
      </div>

      <p className="border-t border-zinc-900 pt-1.5 text-[11px] leading-snug text-zinc-600">
        Touch spread · (ask − bid) / mid · L2 snapshot · educational
      </p>
    </div>
  );
}

function PriceCell({
  label,
  value,
  align = 'left',
}: {
  label: string;
  value: string;
  align?: 'left' | 'center' | 'right';
}) {
  const alignCls = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : '';
  return (
    <div className={alignCls}>
      <div className="text-[11px] uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="text-[13px] font-medium tabular-nums text-zinc-300">{value}</div>
    </div>
  );
}

function SpreadCard({
  row,
  highlight,
  large,
}: {
  row: SpreadRow;
  highlight?: boolean;
  large?: boolean;
}) {
  if (large) {
    // Single-venue view adapts to the widget's own width (container queries on the widget root):
    // type scales with width, prices sit beside the figure when wide and stack as rows when narrow.
    const asOf = row.fetched_at ? new Date(row.fetched_at).toLocaleTimeString() : null;
    return (
      <div className="flex min-h-[170px] flex-1 flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 @min-[560px]:p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-[#e8e4d9]">
            {VENUE_LABEL[row.venue] ?? row.venue}
          </span>
          {asOf && <span className="text-[11px] tabular-nums text-zinc-600">As of {asOf}</span>}
        </div>

        <div className="flex flex-1 flex-col justify-center gap-4 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:justify-between @min-[560px]:gap-6">
          <div className="min-w-0">
            <div className="whitespace-nowrap text-[clamp(2.5rem,12cqw,4rem)] font-semibold @min-[560px]:text-[clamp(2.25rem,6.5cqw,4.25rem)] leading-none tabular-nums text-[#f5f1e6]">
              {formatBps(row.spread_bps)}
            </div>
            <div className="mt-2 text-xs text-zinc-500">
              Touch spread · {formatPrice(row.spread_abs)} wide
            </div>
          </div>

          <div className="grid shrink-0 grid-cols-1 divide-y divide-zinc-800 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 @min-[360px]:grid-cols-3 @min-[360px]:divide-x @min-[360px]:divide-y-0 @min-[560px]:w-[min(54%,440px)]">
            {[
              { label: 'Bid', value: row.bid, tone: 'text-emerald-400' },
              { label: 'Mid', value: row.mid, tone: 'text-[#e8e4d9]' },
              { label: 'Ask', value: row.ask, tone: 'text-rose-400' },
            ].map((cell) => (
              <div
                key={cell.label}
                className="flex min-w-0 items-baseline justify-between gap-2 px-2.5 py-2 @min-[360px]:block"
              >
                <div className="text-[11px] uppercase tracking-wider text-zinc-600">
                  {cell.label}
                </div>
                <div
                  className={`truncate text-[clamp(0.9rem,2.4cqw,1.3rem)] font-semibold tabular-nums ${cell.tone}`}
                >
                  {formatPrice(cell.value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-[84px] flex-1 flex-col justify-center rounded-xl border px-3 py-2.5 ${
        highlight
          ? 'border-yellow-500/40 bg-yellow-500/[0.06]'
          : 'border-zinc-800 bg-zinc-950/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-[#e8e4d9]">
          {VENUE_LABEL[row.venue] ?? row.venue}
        </span>
        {highlight && <span className="text-[11px] font-medium text-yellow-400">Tightest</span>}
      </div>
      <div
        className={`mt-0.5 font-semibold tabular-nums text-xl ${
          highlight ? 'text-yellow-400' : 'text-[#f5f1e6]'
        }`}
      >
        {formatBps(row.spread_bps)}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <PriceCell label="Bid" value={formatPrice(row.bid)} />
        <PriceCell label="Mid" value={formatPrice(row.mid)} align="center" />
        <PriceCell label="Ask" value={formatPrice(row.ask)} align="right" />
      </div>
    </div>
  );
}
