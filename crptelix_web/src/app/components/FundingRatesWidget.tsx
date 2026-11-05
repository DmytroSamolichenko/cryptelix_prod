import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';
import { Dropdown, type DropdownOption } from './WidgetDropdown';

type VenueId = 'binance' | 'phoenix' | 'backpack' | 'pacifica';
type PositionSide = 'long' | 'short';

const ALL_VENUES: VenueId[] = ['binance', 'phoenix', 'backpack', 'pacifica'];

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
  backpack: 'Backpack',
  pacifica: 'Pacifica',
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
  return (
    v === 'binance' || v === 'phoenix' || v === 'backpack' || v === 'pacifica'
  );
}

function otherVenue(primary: VenueId, preferred?: VenueId): VenueId {
  if (preferred && preferred !== primary && isVenueId(preferred)) return preferred;
  return ALL_VENUES.find((v) => v !== primary) ?? 'phoenix';
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
  const compareVenue = otherVenue(
    venue,
    isVenueId(d.compareVenue) ? d.compareVenue : DEFAULT_PREFS.compareVenue
  );
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

function MetricTile({
  label,
  value,
  tone = 'text-[#e8e4d9]',
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-base font-medium tabular-nums ${tone}`}>{value}</div>
    </div>
  );
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
      ? 'text-[#e8e4d9]'
      : snap.est_cost_24h_usd > 0
        ? 'text-red-400'
        : snap.est_cost_24h_usd < 0
          ? 'text-emerald-400'
          : 'text-[#e8e4d9]';

  return (
    <div
      className={`rounded-2xl border p-4 ${
        highlight
          ? 'border-yellow-500/50 bg-gradient-to-b from-yellow-500/10 to-zinc-950/40'
          : 'border-yellow-900/30 bg-gradient-to-b from-yellow-500/[0.04] to-zinc-950/40'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-zinc-400">
          <span className="font-medium text-[#e8e4d9]">{snap.symbol}</span> ·{' '}
          {VENUE_LABEL[snap.venue] ?? snap.venue}
        </span>
        {highlight ? (
          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
            Lower 24h cost
          </span>
        ) : (
          <span className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-400">
            {snap.settle_model}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-medium tracking-tight tabular-nums text-[#e8e4d9]">
          {formatPct(snap.funding_rate_percent)}
        </span>
        <span className="text-xs text-zinc-500">per interval</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MetricTile label="≈ / 24h" value={formatPct(snap.rate_per_24h_percent)} />
        <MetricTile
          label="Est. 24h cost"
          value={formatUsd(snap.est_cost_24h_usd)}
          tone={payTone}
        />
        <MetricTile label="Mark price" value={formatPrice(snap.mark_price)} />
        {snap.venue === 'binance' ? (
          <MetricTile label="Next funding" value={formatCountdown(snap.next_funding_at)} />
        ) : (
          <MetricTile label="Settlement" value="24h" />
        )}
      </div>
    </div>
  );
}

const VENUE_HINT: Record<VenueId, string> = {
  binance: 'CEX',
  backpack: 'CEX',
  phoenix: 'DEX',
  pacifica: 'DEX',
};

const VENUE_OPTIONS: DropdownOption<VenueId>[] = ALL_VENUES.map((v) => ({
  value: v,
  label: VENUE_LABEL[v],
  hint: VENUE_HINT[v],
}));

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

  useEffect(() => {
    if (compareVenue === venue) {
      setCompareVenue(otherVenue(venue));
    }
  }, [venue, compareVenue]);

  const prefs: FundingRatesPrefs = useMemo(
    () => ({
      symbol,
      venue,
      compareOn,
      compareVenue: otherVenue(venue, compareVenue),
      notional,
      positionSide: side,
    }),
    [symbol, venue, compareOn, compareVenue, notional, side]
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

  const segWrap = 'inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-zinc-800 bg-zinc-950 p-0.5';
  const segBtn = (active: boolean, activeCls = 'bg-yellow-400 font-medium text-zinc-950') =>
    `rounded-[10px] px-3 py-1 text-xs transition-colors ${
      active ? activeCls : 'text-zinc-500 hover:text-zinc-300'
    }`;
  const labelCls = 'text-[11px] uppercase tracking-wider text-zinc-600';

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-1 text-xs text-zinc-300">
      <div className="flex flex-wrap items-center gap-2">
        <Dropdown
          title="Symbol"
          value={symbol}
          onChange={setSymbol}
          options={SYMBOLS.map((s) => ({ value: s, label: s }))}
        />

        <Dropdown<VenueId>
          title="Primary data source"
          value={venue}
          onChange={setVenue}
          options={VENUE_OPTIONS}
        />

        {compareOn && (
          <Dropdown<VenueId>
            title="Compare with"
            prefix="vs"
            value={prefs.compareVenue}
            onChange={setCompareVenue}
            options={VENUE_OPTIONS.filter((o) => o.value !== venue)}
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
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950 text-zinc-400 transition-colors hover:border-zinc-600 hover:text-white"
          title="Refresh"
          aria-label="Refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className={`${labelCls} shrink-0`}>Notional</span>
        <div className={segWrap} role="group" aria-label="Notional">
          {NOTIONALS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setNotional(n)}
              className={segBtn(notional === n)}
              aria-pressed={notional === n}
            >
              ${n >= 1000 ? `${n / 1000}k` : n}
            </button>
          ))}
        </div>
        <span className={`${labelCls} ml-1 shrink-0`}>Side</span>
        <div className={segWrap} role="group" aria-label="Position side">
          {(['long', 'short'] as PositionSide[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`${segBtn(
                side === s,
                s === 'long'
                  ? 'bg-emerald-500/15 font-medium text-emerald-400'
                  : 'bg-red-500/15 font-medium text-red-400'
              )} capitalize`}
              aria-pressed={side === s}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
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
                  className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] text-red-300"
                >
                  {VENUE_LABEL[v as VenueId] ?? v}: {msg}
                </div>
              ))}
          </div>
        )}

        {!error && loading && !single && !compare && (
          <div className="flex h-24 items-center justify-center text-zinc-500">Loading…</div>
        )}
      </div>

      <p className="border-t border-zinc-900 pt-2 text-[11px] leading-snug text-zinc-600">
        Educational funding view · public APIs · models differ by venue · not financial advice
        {compare?.disclaimer ? ` · ${compare.disclaimer}` : ''}
      </p>
    </div>
  );
}
