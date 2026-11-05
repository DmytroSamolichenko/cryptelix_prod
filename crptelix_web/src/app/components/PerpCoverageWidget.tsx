import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, RefreshCw, Search, X } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';

type CoverageVenue = 'phoenix' | 'backpack' | 'pacifica';

export type PerpCoveragePrefs = {
  /** Last searched base symbol, e.g. BTC */
  symbol: string;
  venues: CoverageVenue[];
};

type CoveragePayload = {
  bases: string[];
  venues: CoverageVenue[];
  matrix: Record<string, Record<string, boolean>>;
  errors?: Record<string, string> | null;
  fetched_at: string;
};

const ALL_VENUES: CoverageVenue[] = ['phoenix', 'backpack', 'pacifica'];
const VENUE_LABEL: Record<CoverageVenue, string> = {
  phoenix: 'Phoenix',
  backpack: 'Backpack',
  pacifica: 'Pacifica',
};

const DEFAULT_PREFS: PerpCoveragePrefs = {
  symbol: 'SOL',
  venues: [...ALL_VENUES],
};

function isCoverageVenue(v: unknown): v is CoverageVenue {
  return v === 'phoenix' || v === 'backpack' || v === 'pacifica';
}

/** Max length after normalization — mirrors backend MAX_BASE_LEN. */
export const COVERAGE_SYMBOL_MAX_LEN = 16;

/** Normalize user input to a base ticker (SOL, BTC, TSLA…). */
export function normalizeCoverageQuery(raw: string): string {
  let s = raw.trim().toUpperCase();
  if (!s) return '';
  for (const ch of ['/', '-', '_', ' ', '.', '<', '>', '"', "'", '`', ';', '(', ')', '{', '}', '[', ']']) {
    s = s.split(ch).join('');
  }
  if (s.endsWith('PERP')) s = s.slice(0, -4);
  for (const quote of ['USDT', 'USDC', 'USD', 'BUSD']) {
    if (s.endsWith(quote) && s.length > quote.length) {
      s = s.slice(0, -quote.length);
      break;
    }
  }
  s = s.replace(/[^A-Z0-9]/g, '');
  return s.slice(0, COVERAGE_SYMBOL_MAX_LEN);
}

export function parsePerpCoveragePrefs(raw: unknown): PerpCoveragePrefs {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  // Migrate older prefs that stored `bases: string[]`.
  let symbol = normalizeCoverageQuery(String(d.symbol ?? ''));
  if (!symbol && Array.isArray(d.bases) && d.bases.length) {
    symbol = normalizeCoverageQuery(String(d.bases[0]));
  }
  const venuesRaw = Array.isArray(d.venues) ? d.venues.filter(isCoverageVenue) : [];
  return {
    symbol: symbol || DEFAULT_PREFS.symbol,
    venues: venuesRaw.length ? [...new Set(venuesRaw)] : [...DEFAULT_PREFS.venues],
  };
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

interface PerpCoverageWidgetProps {
  initialData?: unknown;
  onPersistPrefs?: (prefs: PerpCoveragePrefs) => void;
}

export function PerpCoverageWidget({
  initialData,
  onPersistPrefs,
}: PerpCoverageWidgetProps) {
  const initial = useMemo(() => parsePerpCoveragePrefs(initialData), [initialData]);
  const [queryDraft, setQueryDraft] = useState(initial.symbol);
  const [symbol, setSymbol] = useState(initial.symbol);
  const [venues, setVenues] = useState(initial.venues);
  const [data, setData] = useState<CoveragePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipPersist = useRef(true);
  const onPersistRef = useRef(onPersistPrefs);
  onPersistRef.current = onPersistPrefs;

  const prefs: PerpCoveragePrefs = useMemo(
    () => ({ symbol, venues }),
    [symbol, venues]
  );

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    onPersistRef.current?.(prefs);
  }, [prefs]);

  const load = useCallback(
    async (base: string, venueList: CoverageVenue[]) => {
      const normalized = normalizeCoverageQuery(base);
      if (!normalized) {
        setError('Enter a symbol, e.g. BTC or SOL');
        setData(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          bases: normalized,
          venues: venueList.join(','),
        });
        const res = await apiFetch(`/api/v1/venue/markets/coverage?${qs}`);
        if (!res.ok) throw new Error(parseApiError(await res.text(), res.status));
        setData((await res.json()) as CoveragePayload);
        setSymbol(normalized);
        setQueryDraft(normalized);
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : 'Failed to load coverage');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void load(symbol, venues);
    // Initial + when venue selection changes (same symbol).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- search only on mount/venues; symbol via Search
  }, [venues]);

  const runSearch = () => {
    const next = normalizeCoverageQuery(queryDraft);
    if (!next) {
      setError('Enter a symbol, e.g. BTC or SOL');
      return;
    }
    void load(next, venues);
  };

  const toggleVenue = (v: CoverageVenue) => {
    setVenues((prev) =>
      prev.includes(v) ? (prev.length > 1 ? prev.filter((x) => x !== v) : prev) : [...prev, v]
    );
  };

  const rowBase = data?.bases?.[0] ?? symbol;
  const listedCount = data
    ? data.venues.filter((v) => Boolean(data.matrix?.[rowBase]?.[v])).length
    : 0;

  const focusRing =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400/60';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-zinc-300">
      <form
        className="flex flex-nowrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={queryDraft}
            onChange={(e) => {
              // Keep draft mostly alphanumeric; strip script-ish chars immediately.
              const next = e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9/_ -]/g, '')
                .slice(0, COVERAGE_SYMBOL_MAX_LEN + 8);
              setQueryDraft(next);
            }}
            maxLength={COVERAGE_SYMBOL_MAX_LEN + 8}
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoCapitalize="characters"
            placeholder="BTC, SOL, TSLA…"
            aria-label="Base symbol"
            className="h-9 w-full rounded-xl border border-zinc-800 bg-zinc-950 pl-9 pr-3 text-[13px] text-[#e8e4d9] caret-yellow-400 outline-none transition-colors placeholder:text-zinc-500 hover:border-zinc-700 focus:border-yellow-500/60 focus:ring-2 focus:ring-yellow-500/15 selection:bg-yellow-400/25"
            title="Base symbol only (letters/digits)"
          />
        </div>
        <button
          type="submit"
          className={`h-9 shrink-0 rounded-xl bg-yellow-400 px-4 text-[13px] font-semibold text-zinc-950 transition-colors hover:bg-yellow-300 ${focusRing}`}
        >
          Check
        </button>
        <button
          type="button"
          onClick={() => void load(symbol, venues)}
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white ${focusRing}`}
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </form>

      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <span className="shrink-0 text-[11px] uppercase tracking-wider text-zinc-600">Venues</span>
        <div
          className="inline-flex shrink-0 gap-0.5 rounded-xl border border-zinc-800 bg-zinc-950 p-0.5"
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
                className={`rounded-[10px] px-2.5 py-1 text-xs transition-colors ${
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
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
            {error}
          </div>
        )}

        {!error && data && (
          <div className="flex min-h-full flex-col gap-2">
            <div className="flex items-center justify-between gap-2 px-0.5">
              <span className="text-lg font-semibold leading-6 text-[#f5f1e6]">{rowBase}</span>
              <span
                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                  listedCount > 0
                    ? 'border-green-500/30 text-green-400'
                    : 'border-zinc-800 text-zinc-500'
                }`}
              >
                Listed on {listedCount}/{data.venues.length} venues
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-2">
              {data.venues.map((v) => {
                const ok = Boolean(data.matrix?.[rowBase]?.[v]);
                return (
                  <div
                    key={v}
                    className={`flex min-h-[48px] flex-1 items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                      ok
                        ? 'border-green-500/30 bg-green-500/[0.05] shadow-[0_6px_20px_-8px_rgba(34,197,94,0.45)]'
                        : 'border-zinc-800 bg-zinc-950/60'
                    }`}
                  >
                    <span className="text-[13px] font-medium text-[#e8e4d9]">
                      {VENUE_LABEL[v] ?? v}
                    </span>
                    {ok ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-400">
                        <Check className="h-3.5 w-3.5" aria-hidden />
                        Listed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 px-2 py-0.5 text-xs text-zinc-500">
                        <X className="h-3.5 w-3.5" aria-hidden />
                        Not listed
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!error && loading && !data && (
          <div className="flex h-24 items-center justify-center text-zinc-500">Checking…</div>
        )}

        {data?.errors &&
          Object.entries(data.errors).map(([v, msg]) => (
            <div
              key={v}
              className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200"
            >
              {VENUE_LABEL[v as CoverageVenue] ?? v}: {msg}
            </div>
          ))}
      </div>

      <p className="border-t border-zinc-900 pt-1.5 text-[11px] leading-snug text-zinc-600">
        Type any base · public market lists · educational
        {data?.fetched_at ? ` · ${new Date(data.fetched_at).toLocaleTimeString()}` : ''}
      </p>
    </div>
  );
}
