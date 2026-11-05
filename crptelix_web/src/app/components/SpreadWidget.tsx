import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';

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
    <div className="flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-gray-300">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50"
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={venue}
          onChange={(e) => setVenue(e.target.value as SpreadVenue)}
          disabled={compareOn}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50 disabled:opacity-50"
        >
          {ALL_VENUES.map((v) => (
            <option key={v} value={v}>
              {VENUE_LABEL[v]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCompareOn((v) => !v)}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs ${
            compareOn
              ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
              : 'border-zinc-700 bg-zinc-900 text-gray-300 hover:border-zinc-500'
          }`}
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Compare
        </button>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-gray-400 hover:border-zinc-500 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}
        {!error && !compareOn && single && <SpreadCard row={single} />}
        {!error && compareOn && compare && (
          <div className="flex flex-col gap-2">
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
                  className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200"
                >
                  {VENUE_LABEL[v as SpreadVenue] ?? v}: {msg}
                </div>
              ))}
          </div>
        )}
        {!error && loading && !single && !compare && (
          <div className="flex h-24 items-center justify-center text-gray-500">Loading…</div>
        )}
      </div>

      <p className="border-t border-zinc-800 pt-1.5 text-[10px] leading-snug text-gray-600">
        Touch spread · (ask − bid) / mid · L2 snapshot · educational
      </p>
    </div>
  );
}

function SpreadCard({ row, highlight }: { row: SpreadRow; highlight?: boolean }) {
  return (
    <div
      className={`rounded border px-2.5 py-2 ${
        highlight
          ? 'border-yellow-500/40 bg-yellow-500/5'
          : 'border-zinc-800 bg-zinc-950/80'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-white">
          {VENUE_LABEL[row.venue] ?? row.venue}
        </span>
        {highlight && (
          <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] text-yellow-400">
            Tightest
          </span>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-yellow-400/90">
        {formatBps(row.spread_bps)}
      </div>
      <div className="mt-1 grid grid-cols-3 gap-1 text-[10px] text-gray-500">
        <span>Bid {formatPrice(row.bid)}</span>
        <span className="text-center">Mid {formatPrice(row.mid)}</span>
        <span className="text-right">Ask {formatPrice(row.ask)}</span>
      </div>
    </div>
  );
}
