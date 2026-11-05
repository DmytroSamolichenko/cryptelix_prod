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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-gray-300">
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          runSearch();
        }}
      >
        <div className="relative min-w-[8rem] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
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
            className="w-full rounded border border-zinc-700 bg-zinc-900 py-1.5 pl-7 pr-2 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-yellow-500/50"
            title="Base symbol only (letters/digits)"
          />
        </div>
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded border border-yellow-500/40 bg-yellow-500/10 px-2.5 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/20"
        >
          Check
        </button>
        <button
          type="button"
          onClick={() => void load(symbol, venues)}
          className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-gray-400 hover:border-zinc-500 hover:text-white"
          title="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">Venues</span>
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
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {!error && data && (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2 px-0.5">
              <span className="text-sm font-semibold text-white">{rowBase}</span>
              <span className="text-[10px] text-gray-500">
                Listed on {listedCount}/{data.venues.length} venues
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {data.venues.map((v) => {
                const ok = Boolean(data.matrix?.[rowBase]?.[v]);
                return (
                  <div
                    key={v}
                    className={`flex items-center justify-between rounded border px-2.5 py-2 ${
                      ok
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : 'border-zinc-800 bg-zinc-950/80'
                    }`}
                  >
                    <span className="text-[11px] font-medium text-white">
                      {VENUE_LABEL[v] ?? v}
                    </span>
                    {ok ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                        <Check className="h-3.5 w-3.5" />
                        Listed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
                        <X className="h-3.5 w-3.5" />
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
          <div className="flex h-24 items-center justify-center text-gray-500">Checking…</div>
        )}

        {data?.errors &&
          Object.entries(data.errors).map(([v, msg]) => (
            <div
              key={v}
              className="mt-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-200"
            >
              {VENUE_LABEL[v as CoverageVenue] ?? v}: {msg}
            </div>
          ))}
      </div>

      <p className="border-t border-zinc-800 pt-1.5 text-[10px] leading-snug text-gray-600">
        Type any base · public market lists · educational
        {data?.fetched_at ? ` · ${new Date(data.fetched_at).toLocaleTimeString()}` : ''}
      </p>
    </div>
  );
}
