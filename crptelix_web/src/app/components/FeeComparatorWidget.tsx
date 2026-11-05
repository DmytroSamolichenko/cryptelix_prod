import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';

type FeeVenue = 'phoenix' | 'backpack' | 'pacifica' | 'binance';
type FeeSide = 'maker' | 'taker' | 'round_trip';

export type FeeComparatorPrefs = {
  venues: FeeVenue[];
  notional: number;
  side: FeeSide;
};

type FeeRow = {
  venue: FeeVenue;
  maker_bps: number;
  taker_bps: number;
  fee_usd: number;
  tier?: string;
  source?: string;
  as_of?: string;
};

type ComparePayload = {
  notional: number;
  side: FeeSide;
  rows: FeeRow[];
  cheapest_venue: FeeVenue | null;
  errors?: Record<string, string> | null;
  disclaimers?: string[];
};

const ALL_VENUES: FeeVenue[] = ['phoenix', 'backpack', 'pacifica', 'binance'];
const NOTIONALS = [1_000, 10_000, 50_000] as const;
const VENUE_LABEL: Record<FeeVenue, string> = {
  phoenix: 'Phoenix',
  backpack: 'Backpack',
  pacifica: 'Pacifica',
  binance: 'Binance',
};

const DEFAULT_PREFS: FeeComparatorPrefs = {
  venues: [...ALL_VENUES],
  notional: 10_000,
  side: 'taker',
};

function isFeeVenue(v: unknown): v is FeeVenue {
  return (
    v === 'phoenix' || v === 'backpack' || v === 'pacifica' || v === 'binance'
  );
}

function isFeeSide(v: unknown): v is FeeSide {
  return v === 'maker' || v === 'taker' || v === 'round_trip';
}

export function parseFeeComparatorPrefs(raw: unknown): FeeComparatorPrefs {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const venuesRaw = Array.isArray(d.venues) ? d.venues.filter(isFeeVenue) : [];
  const notionalNum = Number(d.notional);
  return {
    venues: venuesRaw.length ? [...new Set(venuesRaw)] : [...DEFAULT_PREFS.venues],
    notional: (NOTIONALS as readonly number[]).includes(notionalNum)
      ? notionalNum
      : DEFAULT_PREFS.notional,
    side: isFeeSide(d.side) ? d.side : DEFAULT_PREFS.side,
  };
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

interface FeeComparatorWidgetProps {
  initialData?: unknown;
  onPersistPrefs?: (prefs: FeeComparatorPrefs) => void;
}

export function FeeComparatorWidget({
  initialData,
  onPersistPrefs,
}: FeeComparatorWidgetProps) {
  const initial = useMemo(() => parseFeeComparatorPrefs(initialData), [initialData]);
  const [venues, setVenues] = useState(initial.venues);
  const [notional, setNotional] = useState(initial.notional);
  const [side, setSide] = useState<FeeSide>(initial.side);
  const [data, setData] = useState<ComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipPersist = useRef(true);
  const onPersistRef = useRef(onPersistPrefs);
  onPersistRef.current = onPersistPrefs;

  const prefs: FeeComparatorPrefs = useMemo(
    () => ({ venues, notional, side }),
    [venues, notional, side]
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
      const qs = new URLSearchParams({
        venues: venues.join(','),
        notional: String(notional),
        side,
      });
      const res = await apiFetch(`/api/v1/venue/fees/compare?${qs}`);
      if (!res.ok) throw new Error(parseApiError(await res.text(), res.status));
      setData((await res.json()) as ComparePayload);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Failed to load fees');
    } finally {
      setLoading(false);
    }
  }, [venues, notional, side]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleVenue = (v: FeeVenue) => {
    setVenues((prev) =>
      prev.includes(v) ? (prev.length > 1 ? prev.filter((x) => x !== v) : prev) : [...prev, v]
    );
  };

  const maxFee = useMemo(() => {
    if (!data?.rows?.length) return 1;
    return Math.max(...data.rows.map((r) => r.fee_usd), 0.01);
  }, [data]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-gray-300">
      <div className="flex flex-wrap items-center gap-1.5">
        {ALL_VENUES.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => toggleVenue(v)}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              venues.includes(v)
                ? 'bg-yellow-500/15 text-yellow-400'
                : 'bg-zinc-900 text-gray-500 hover:bg-zinc-800'
            }`}
          >
            {VENUE_LABEL[v]}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-gray-400 hover:border-zinc-500 hover:text-white"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">Notional</span>
        {NOTIONALS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setNotional(n)}
            className={`rounded px-2 py-0.5 text-[11px] ${
              notional === n
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-900 text-gray-400 hover:bg-zinc-800'
            }`}
          >
            ${n >= 1000 ? `${n / 1000}k` : n}
          </button>
        ))}
        <span className="ml-1 text-[10px] uppercase tracking-wide text-gray-500">Side</span>
        {(['maker', 'taker', 'round_trip'] as FeeSide[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded px-2 py-0.5 text-[11px] ${
              side === s
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-900 text-gray-400 hover:bg-zinc-800'
            }`}
          >
            {s === 'round_trip' ? 'RT taker' : s}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}
        {!error && data && (
          <div className="flex flex-col gap-2">
            {data.rows.map((row) => {
              const cheapest = data.cheapest_venue === row.venue;
              const widthPct = Math.max(4, (row.fee_usd / maxFee) * 100);
              return (
                <div
                  key={row.venue}
                  className={`rounded border px-2.5 py-2 ${
                    cheapest
                      ? 'border-yellow-500/40 bg-yellow-500/5'
                      : 'border-zinc-800 bg-zinc-950/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-white">
                      {VENUE_LABEL[row.venue]}
                      {row.tier ? (
                        <span className="ml-1 text-[10px] text-gray-500">{row.tier}</span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-sm font-semibold text-white">
                      {formatUsd(row.fee_usd)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-zinc-800">
                    <div
                      className={`h-full rounded ${cheapest ? 'bg-yellow-500' : 'bg-zinc-500'}`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-gray-500">
                    <span>maker {row.maker_bps.toFixed(2)} bps</span>
                    <span>taker {row.taker_bps.toFixed(2)} bps</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!error && loading && !data && (
          <div className="flex h-24 items-center justify-center text-gray-500">Loading…</div>
        )}
      </div>

      <p className="border-t border-zinc-800 pt-1.5 text-[10px] leading-snug text-gray-600">
        Fee comparator · perp trading fees only · educational · not financial advice
      </p>
    </div>
  );
}
