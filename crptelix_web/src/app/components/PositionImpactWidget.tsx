import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, RefreshCw } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';

type VenueId = 'phoenix' | 'binance';
type PositionSide = 'long' | 'short';

/** UI prefs only — never store live book payloads here. */
export type PositionImpactPrefs = {
  symbol: string;
  venue: VenueId;
  side: PositionSide;
  margin: number;
  leverage: number;
};

type ImpactPayload = {
  venue: VenueId;
  symbol: string;
  side: PositionSide;
  margin: number;
  leverage: number;
  notional: number;
  mid: number | null;
  p_best: number | null;
  p_avg: number | null;
  p_new: number | null;
  slippage_pct: number | null;
  book_impact_pct: number | null;
  filled_notional: number;
  unfilled_notional: number;
  filled_base_qty: number;
  levels_used: number;
  sufficient_liquidity: boolean;
  book_exhausted: boolean;
  fetched_at: string;
  cached?: boolean;
  disclaimer?: string;
};

const SYMBOLS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'LINK'] as const;
const MARGIN_PRESETS = [500, 1_000, 2_500, 5_000, 10_000] as const;
const LEVERAGE_PRESETS = [1, 2, 5, 10, 20, 25] as const;

const VENUE_LABEL: Record<VenueId, string> = {
  phoenix: 'Phoenix',
  binance: 'Binance',
};

const DEFAULT_PREFS: PositionImpactPrefs = {
  symbol: 'SOL',
  venue: 'phoenix',
  side: 'long',
  margin: 1_000,
  leverage: 10,
};

function isVenueId(v: unknown): v is VenueId {
  return v === 'phoenix' || v === 'binance';
}

function isPositionSide(v: unknown): v is PositionSide {
  return v === 'long' || v === 'short';
}

export function parsePositionImpactPrefs(raw: unknown): PositionImpactPrefs {
  const d = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const symbolRaw = String(d.symbol ?? DEFAULT_PREFS.symbol).trim().toUpperCase();
  const symbol = (SYMBOLS as readonly string[]).includes(symbolRaw)
    ? symbolRaw
    : DEFAULT_PREFS.symbol;
  const venueRaw = isVenueId(d.venue) ? d.venue : DEFAULT_PREFS.venue;
  // MVP: only Phoenix is wired; keep selector visible but coerce unsupported.
  const venue: VenueId = venueRaw === 'phoenix' ? 'phoenix' : 'phoenix';
  const marginNum = Number(d.margin);
  const leverageNum = Number(d.leverage);
  return {
    symbol,
    venue,
    side: isPositionSide(d.side) ? d.side : DEFAULT_PREFS.side,
    margin:
      Number.isFinite(marginNum) && marginNum > 0 ? marginNum : DEFAULT_PREFS.margin,
    leverage:
      Number.isFinite(leverageNum) && leverageNum > 0
        ? leverageNum
        : DEFAULT_PREFS.leverage,
  };
}

function formatPct(n: number | null | undefined, digits = 4): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', {
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

function severityClass(pct: number | null): string {
  if (pct == null || !Number.isFinite(pct)) return 'text-gray-400';
  if (pct < 0.05) return 'text-emerald-400';
  if (pct < 0.2) return 'text-amber-300';
  return 'text-red-400';
}

function parseApiError(text: string, status: number): string {
  try {
    const j = JSON.parse(text) as { detail?: unknown };
    if (typeof j.detail === 'string') return j.detail;
  } catch {
    /* plain text */
  }
  return text || `HTTP ${status}`;
}

interface PositionImpactWidgetProps {
  initialData?: unknown;
  onPersistPrefs?: (prefs: PositionImpactPrefs) => void;
}

export function PositionImpactWidget({
  initialData,
  onPersistPrefs,
}: PositionImpactWidgetProps) {
  const initial = useMemo(() => parsePositionImpactPrefs(initialData), [initialData]);
  const [symbol, setSymbol] = useState(initial.symbol);
  const [venue, setVenue] = useState<VenueId>(initial.venue);
  const [side, setSide] = useState<PositionSide>(initial.side);
  const [margin, setMargin] = useState(initial.margin);
  const [leverage, setLeverage] = useState(initial.leverage);
  const [marginDraft, setMarginDraft] = useState(String(initial.margin));
  const [leverageDraft, setLeverageDraft] = useState(String(initial.leverage));
  const [result, setResult] = useState<ImpactPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skipPersist = useRef(true);
  const onPersistRef = useRef(onPersistPrefs);
  onPersistRef.current = onPersistPrefs;

  const notional = margin * leverage;

  const prefs: PositionImpactPrefs = useMemo(
    () => ({ symbol, venue: 'phoenix', side, margin, leverage }),
    [symbol, side, margin, leverage]
  );

  useEffect(() => {
    if (skipPersist.current) {
      skipPersist.current = false;
      return;
    }
    onPersistRef.current?.(prefs);
  }, [prefs]);

  const load = useCallback(
    async (overrides?: { margin?: number; leverage?: number }) => {
      const marginUse = overrides?.margin ?? margin;
      const leverageUse = overrides?.leverage ?? leverage;
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          venue: 'phoenix',
          symbol,
          side,
          margin: String(marginUse),
          leverage: String(leverageUse),
        });
        const res = await apiFetch(`/api/v1/venue/price-impact?${qs}`);
        if (!res.ok) {
          const detail = await res.text();
          throw new Error(parseApiError(detail, res.status));
        }
        const data = (await res.json()) as ImpactPayload;
        setResult(data);
      } catch (e) {
        setResult(null);
        setError(e instanceof Error ? e.message : 'Failed to calculate impact');
      } finally {
        setLoading(false);
      }
    },
    [symbol, side, margin, leverage]
  );

  // Initial snapshot only — no auto-poll (Calculate refreshes).
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only first calc
  }, []);

  const parsePositive = (raw: string, fallback: number) => {
    const n = Number(raw.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };

  const commitMargin = (): number => {
    const n = parsePositive(marginDraft, margin);
    setMargin(n);
    setMarginDraft(String(n));
    return n;
  };

  const commitLeverage = (): number => {
    const n = parsePositive(leverageDraft, leverage);
    setLeverage(n);
    setLeverageDraft(String(n));
    return n;
  };

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
          onChange={(e) => {
            const v = e.target.value as VenueId;
            if (v === 'phoenix') setVenue(v);
          }}
          className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50"
          title="Venue"
        >
          <option value="phoenix">{VENUE_LABEL.phoenix}</option>
          <option value="binance" disabled>
            Binance (soon)
          </option>
        </select>

        <span className="ml-auto rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-gray-400">
          Snapshot
        </span>
        <button
          type="button"
          onClick={() => {
            const nextMargin = commitMargin();
            const nextLeverage = commitLeverage();
            void load({ margin: nextMargin, leverage: nextLeverage });
          }}
          className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-gray-400 hover:border-zinc-500 hover:text-white"
          title="Recalculate on fresh orderbook"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Calculate
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wide text-gray-500">Side</span>
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
        <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-500">
          Notional
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[11px] text-yellow-400/90">
          {formatUsd(notional)}
        </span>
        <span className="text-[10px] text-gray-600">margin × lev</span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-[7rem] flex-1 flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Margin</span>
          <input
            type="text"
            inputMode="decimal"
            value={marginDraft}
            onChange={(e) => setMarginDraft(e.target.value)}
            onBlur={commitMargin}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMargin();
            }}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50"
          />
        </label>
        <label className="flex min-w-[5.5rem] flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-gray-500">Leverage</span>
          <input
            type="text"
            inputMode="decimal"
            value={leverageDraft}
            onChange={(e) => setLeverageDraft(e.target.value)}
            onBlur={commitLeverage}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLeverage();
            }}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-white outline-none focus:border-yellow-500/50"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1">
        {MARGIN_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setMargin(n);
              setMarginDraft(String(n));
            }}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              margin === n
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-900 text-gray-500 hover:bg-zinc-800 hover:text-gray-300'
            }`}
          >
            ${n >= 1000 ? `${n / 1000}k` : n}
          </button>
        ))}
        <span className="mx-0.5 text-zinc-700">|</span>
        {LEVERAGE_PRESETS.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => {
              setLeverage(n);
              setLeverageDraft(String(n));
            }}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              leverage === n
                ? 'bg-zinc-700 text-white'
                : 'bg-zinc-900 text-gray-500 hover:bg-zinc-800 hover:text-gray-300'
            }`}
          >
            {n}x
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 px-2 py-2 text-[11px] text-red-300">
            {error}
          </div>
        )}

        {!error && loading && !result && (
          <div className="flex h-24 items-center justify-center text-gray-500">
            Calculating…
          </div>
        )}

        {!error && result && (
          <div className="flex flex-col gap-2">
            {!result.sufficient_liquidity && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-200">
                Insufficient depth — filled {formatUsd(result.filled_notional)} of{' '}
                {formatUsd(result.notional)}
                {result.unfilled_notional > 0
                  ? ` · unfilled ${formatUsd(result.unfilled_notional)}`
                  : ''}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-zinc-800 bg-zinc-950/80 px-2.5 py-2">
                <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-500">
                  <Calculator className="h-3 w-3" />
                  Slippage
                </div>
                <div
                  className={`mt-1 text-lg font-semibold tabular-nums ${severityClass(result.slippage_pct)}`}
                >
                  {formatPct(result.slippage_pct)}
                </div>
                <div className="mt-0.5 text-[10px] text-gray-600">vs best touch</div>
              </div>
              <div className="rounded border border-zinc-800 bg-zinc-950/80 px-2.5 py-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">
                  Book impact
                </div>
                <div
                  className={`mt-1 text-lg font-semibold tabular-nums ${severityClass(result.book_impact_pct)}`}
                >
                  {result.book_exhausted && result.p_new == null
                    ? 'Book wiped'
                    : formatPct(result.book_impact_pct)}
                </div>
                <div className="mt-0.5 text-[10px] text-gray-600">new best move</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded border border-zinc-800 bg-zinc-950/50 px-2.5 py-2 text-[11px]">
              <Row label="P best" value={formatPrice(result.p_best)} />
              <Row label="P avg" value={formatPrice(result.p_avg)} />
              <Row label="P new" value={formatPrice(result.p_new)} />
              <Row label="Mid" value={formatPrice(result.mid)} />
              <Row label="Levels used" value={String(result.levels_used)} />
              <Row label="Filled base" value={formatBase(result.filled_base_qty)} />
              <Row
                label="As of"
                value={
                  result.fetched_at
                    ? new Date(result.fetched_at).toLocaleTimeString()
                    : '—'
                }
              />
              <Row label="Venue" value={VENUE_LABEL[result.venue] ?? result.venue} />
            </div>
          </div>
        )}
      </div>

      <p className="border-t border-zinc-800 pt-1.5 text-[10px] leading-snug text-gray-600">
        Position impact calculator · L2 snapshot walk · educational · not financial advice
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-gray-500">{label}</span>
      <span className="text-right tabular-nums text-gray-200">{value}</span>
    </>
  );
}

function formatBase(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const digits = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
