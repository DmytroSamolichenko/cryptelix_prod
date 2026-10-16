import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';

type VenueId = 'binance' | 'phoenix';
type PositionSide = 'long' | 'short';

/** UI prefs only — never store live balances / market payloads here. */
export type FundingRatesPrefs = {
  symbol: string;
  venue: VenueId;
  compareOn: boolean;
  compareVenue: VenueId;
  notional: number;
  positionSide: PositionSide;
};

type FundingSnapshot = {
  venue: VenueId;
  symbol: string;
  venue_symbol: string;
  funding_rate_percent: number;
  interval_hours: number;
  settle_hours?: number;
  rate_per_24h_percent: number;
  next_funding_at: string | null;
  rate_as_of?: string | null;
  settle_model: string;
  mark_price: number | null;
  index_price: number | null;
  est_cost_24h_usd: number | null;
  notional: number;
  position_side: PositionSide;
  fetched_at: string;
  cached?: boolean;
  source: string;
};

type ComparePayload = {
  symbol: string;
  notional: number;
  position_side: PositionSide;
  venues: FundingSnapshot[];
  cheapest_venue_24h: VenueId | null;
  disclaimer?: string;
  errors?: Record<string, string> | null;
};

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK'] as const;
const NOTIONALS = [1_000, 10_000, 50_000] as const;

const VENUE_LABEL: Record<VenueId, string> = {
  binance: 'Binance',
  phoenix: 'Phoenix',
};

const DEFAULT_PREFS: FundingRatesPrefs = {
  symbol: 'BTC',
  venue: 'binance',
  compareOn: false,
  compareVenue: 'phoenix',
  notional: 10_000,
  positionSide: 'long',
};

function isVenueId(v: unknown): v is VenueId {
  return v === 'binance' || v === 'phoenix';
}

function isPositionSide(v: unknown): v is PositionSide {
  return v === 'long' || v === 'short';
}

export function parseFundingRatesPrefs(raw: unknown): FundingRatesPrefs {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const symbolRaw = String(d.symbol ?? DEFAULT_PREFS.symbol).trim().toUpperCase();
  const symbol = (SYMBOLS as readonly string[]).includes(symbolRaw)
    ? symbolRaw
    : DEFAULT_PREFS.symbol;
  const venue = isVenueId(d.venue) ? d.venue : DEFAULT_PREFS.venue;
  let compareVenue = isVenueId(d.compareVenue) ? d.compareVenue : DEFAULT_PREFS.compareVenue;
  if (compareVenue === venue) {
    compareVenue = venue === 'binance' ? 'phoenix' : 'binance';
  }
  const notionalNum = Number(d.notional);
  const notional = (NOTIONALS as readonly number[]).includes(notionalNum)
    ? notionalNum
    : DEFAULT_PREFS.notional;
  return {
    symbol,
    venue,
    compareOn: Boolean(d.compareOn),
    compareVenue,
    notional,
    positionSide: isPositionSide(d.positionSide) ? d.positionSide : DEFAULT_PREFS.positionSide,
  };
}

function formatPct(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function formatCountdown(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const ms = t - Date.now();
  if (ms <= 0) return 'soon';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function VenueCard({
  snap,
  highlight,
}: {
  snap: FundingSnapshot;
  highlight?: boolean;
}) {
  const payTone =
    snap.est_cost_24h_usd == null
      ? 'text-gray-300'
      : snap.est_cost_24h_usd > 0
        ? 'text-red-400'
        : snap.est_cost_24h_usd < 0
          ? 'text-emerald-400'
          : 'text-gray-300';

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        highlight
          ? 'border-yellow-500/50 bg-yellow-500/5'
          : 'border-zinc-700/80 bg-zinc-950/40'
      }`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white">
          {VENUE_LABEL[snap.venue] ?? snap.venue}
        </span>
        {highlight && (
          <span className="rounded bg-yellow-500/15 px-1.5 py-0.5 text-[10px] font-medium text-yellow-400">
            Lower 24h cost
          </span>
        )}
      </div>
      <div className="text-xl font-semibold tracking-tight text-white">
        {formatPct(snap.funding_rate_percent)}
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500">
        per interval · {snap.settle_model}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
        <div className="text-gray-500">≈ / 24h</div>
        <div className="text-right text-gray-300">
          {formatPct(snap.rate_per_24h_percent)}
        </div>
        <div className="text-gray-500">Est. 24h cost</div>
        <div className={`text-right font-medium ${payTone}`}>
          {formatUsd(snap.est_cost_24h_usd)}
        </div>
        <div className="text-gray-500">Mark</div>
        <div className="text-right text-gray-300">{formatPrice(snap.mark_price)}</div>
        {snap.venue === 'binance' ? (
          <>
            <div className="text-gray-500">Next funding</div>
            <div className="text-right text-gray-300">
              {formatCountdown(snap.next_funding_at)}
            </div>
          </>
        ) : (
          <>
            <div className="text-gray-500">Settle note</div>
            <div className="text-right text-gray-300">24h settle</div>
          </>
        )}
      </div>
    </div>
  );
}

interface FundingRatesWidgetProps {
  initialData?: unknown;
  onPersistPrefs?: (prefs: FundingRatesPrefs) => void;
}

export function FundingRatesWidget({
  initialData,
  onPersistPrefs,
}: FundingRatesWidgetProps) {
  const initial = useMemo(() => parseFundingRatesPrefs(initialData), [initialData]);
  const [symbol, setSymbol] = useState<string>(initial.symbol);
  const [venue, setVenue] = useState<VenueId>(initial.venue);
  const [compareOn, setCompareOn] = useState(initial.compareOn);
  const [compareVenue, setCompareVenue] = useState<VenueId>(initial.compareVenue);
  const [notional, setNotional] = useState<number>(initial.notional);
  const [side, setSide] = useState<PositionSide>(initial.positionSide);
  const [single, setSingle] = useState<FundingSnapshot | null>(null);
  const [compare, setCompare] = useState<ComparePayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipPersist = useRef(true);
  const onPersistRef = useRef(onPersistPrefs);
  onPersistRef.current = onPersistPrefs;

  const otherVenue: VenueId = venue === 'binance' ? 'phoenix' : 'binance';

  useEffect(() => {
    if (compareVenue === venue) {
      setCompareVenue(otherVenue);
    }
  }, [venue, compareVenue, otherVenue]);

  const prefs: FundingRatesPrefs = useMemo(
    () => ({
      symbol,
      venue,
      compareOn,
      compareVenue: compareVenue === venue ? otherVenue : compareVenue,
      notional,
      positionSide: side,
    }),
    [symbol, venue, compareOn, compareVenue, otherVenue, notional, side]
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
        const venues = [venue, prefs.compareVenue].join(',');
        const qs = new URLSearchParams({
          symbol,
          venues,
          notional: String(notional),
          position_side: side,
        });
        const res = await apiFetch(`/api/v1/venue/funding/compare?${qs}`);
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(detail || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ComparePayload;
        setCompare(data);
        setSingle(null);
      } else {
        const qs = new URLSearchParams({
          venue,
          symbol,
          notional: String(notional),
          position_side: side,
        });
        const res = await apiFetch(`/api/v1/venue/funding?${qs}`);
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(detail || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as FundingSnapshot;
        setSingle(data);
        setCompare(null);
      }
    } catch (e) {
      setSingle(null);
      setCompare(null);
      setError(e instanceof Error ? e.message : 'Failed to load funding');
    } finally {
      setLoading(false);
    }
  }, [compareOn, notional, prefs.compareVenue, side, symbol, venue]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 45_000);
    return () => window.clearInterval(id);
  }, [load]);

  const chip = useMemo(
    () => (compareOn ? 'Compare' : VENUE_LABEL[venue]),
    [compareOn, venue]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-gray-300">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50"
          title="Symbol"
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={venue}
          onChange={(e) => setVenue(e.target.value as VenueId)}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50"
          title="Primary data source"
        >
          <option value="binance">Binance</option>
          <option value="phoenix">Phoenix</option>
        </select>

        <button
          type="button"
          onClick={() => setCompareOn((v) => !v)}
          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs transition-colors ${
            compareOn
              ? 'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
              : 'border-zinc-700 bg-zinc-900 text-gray-300 hover:border-zinc-500'
          }`}
          title="Compare venues"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Compare
        </button>

        {compareOn && (
          <select
            value={prefs.compareVenue}
            onChange={(e) => setCompareVenue(e.target.value as VenueId)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50"
            title="Compare with"
          >
            {(['binance', 'phoenix'] as VenueId[])
              .filter((v) => v !== venue)
              .map((v) => (
                <option key={v} value={v}>
                  vs {VENUE_LABEL[v]}
                </option>
              ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-gray-400 hover:border-zinc-500 hover:text-white"
          title="Refresh"
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
        {(['long', 'short'] as PositionSide[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            className={`rounded px-2 py-0.5 text-[11px] capitalize ${
              side === s
                ? s === 'long'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-red-500/20 text-red-400'
                : 'bg-zinc-900 text-gray-400 hover:bg-zinc-800'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-gray-400">
          {chip}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {!error && !compareOn && single && <VenueCard snap={single} />}

        {!error && compareOn && compare && (
          <div className="flex flex-col gap-2">
            {compare.venues.map((row) => (
              <VenueCard
                key={row.venue}
                snap={row}
                highlight={compare.cheapest_venue_24h === row.venue}
              />
            ))}
            {compare.errors &&
              Object.entries(compare.errors).map(([v, msg]) => (
                <div
                  key={v}
                  className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200"
                >
                  {VENUE_LABEL[v as VenueId] ?? v}: {msg}
                </div>
              ))}
          </div>
        )}

        {!error && loading && !single && !compare && (
          <div className="flex h-24 items-center justify-center text-gray-500">Loading…</div>
        )}
      </div>

      <p className="border-t border-zinc-800 pt-1.5 text-[10px] leading-snug text-gray-600">
        Educational funding view · public APIs · models differ by venue · not financial advice
        {compare?.disclaimer ? ` · ${compare.disclaimer}` : ''}
      </p>
    </div>
  );
}
