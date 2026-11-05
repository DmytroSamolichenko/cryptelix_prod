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

  const segWrap = 'inline-flex shrink-0 gap-0.5 rounded-xl border border-zinc-800 bg-zinc-950 p-0.5';
  const chipBtn = (active: boolean) =>
    `rounded-[10px] px-2.5 py-1 text-xs transition-colors ${
      active ? 'bg-yellow-400 font-medium text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'
    }`;
  const labelCls = 'shrink-0 text-[11px] uppercase tracking-wider text-zinc-600';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-zinc-300">
      <div className="flex flex-nowrap items-center gap-2">
        <div
          className="flex min-w-0 flex-nowrap gap-0.5 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-0.5 [scrollbar-width:none]"
          role="group"
          aria-label="Venues"
        >
          {ALL_VENUES.map((v) => {
            const on = venues.includes(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => toggleVenue(v)}
                aria-pressed={on}
                className={`shrink-0 rounded-[10px] px-2.5 py-1 text-xs transition-colors ${
                  on
                    ? 'bg-yellow-400/15 font-medium text-yellow-400'
                    : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {VENUE_LABEL[v]}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <span className={labelCls}>Notional</span>
        <div className={segWrap} role="group" aria-label="Notional">
          {NOTIONALS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNotional(n)}
              aria-pressed={notional === n}
              className={chipBtn(notional === n)}
            >
              ${n >= 1000 ? `${n / 1000}k` : n}
            </button>
          ))}
        </div>
        <span className={`${labelCls} ml-1`}>Side</span>
        <div className={segWrap} role="group" aria-label="Fee side">
          {(['maker', 'taker', 'round_trip'] as FeeSide[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`${chipBtn(side === s)} capitalize`}
            >
              {s === 'round_trip' ? 'Round trip' : s}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}
        {!error && data && (
          <div className="flex min-h-full flex-col gap-2">
            {data.rows.map((row) => {
              const cheapest = data.cheapest_venue === row.venue;
              const widthPct = Math.max(4, (row.fee_usd / maxFee) * 100);
              return (
                <div
                  key={row.venue}
                  className={`flex min-h-[64px] flex-1 flex-col justify-center rounded-xl border px-3 py-2 ${
                    cheapest
                      ? 'border-yellow-500/40 bg-yellow-500/[0.06]'
                      : 'border-zinc-800 bg-zinc-950/60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-[13px] font-medium text-[#e8e4d9]">
                        {VENUE_LABEL[row.venue]}
                      </span>
                      {row.tier ? (
                        <span className="truncate rounded-md border border-zinc-800 px-1.5 text-[11px] text-zinc-500">
                          {row.tier}
                        </span>
                      ) : null}
                      {cheapest ? (
                        <span className="text-[11px] font-medium text-yellow-400">Lowest</span>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-base font-semibold tabular-nums text-[#f5f1e6]">
                      {formatUsd(row.fee_usd)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        cheapest ? 'bg-yellow-400' : 'bg-zinc-600'
                      }`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-zinc-500">
                    <span>maker {row.maker_bps.toFixed(2)} bps</span>
                    <span>taker {row.taker_bps.toFixed(2)} bps</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {!error && loading && !data && (
          <div className="flex h-24 items-center justify-center text-zinc-500">Loading…</div>
        )}
      </div>

      <p className="border-t border-zinc-900 pt-1.5 text-[11px] leading-snug text-zinc-600">
        Fee comparator · perp trading fees only · educational · not financial advice
      </p>
    </div>
  );
}
