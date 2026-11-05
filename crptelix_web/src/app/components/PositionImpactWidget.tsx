import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, RefreshCw } from 'lucide-react';

import { apiFetch } from '../lib/apiClient';
import { Dropdown } from './WidgetDropdown';

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
  if (pct == null || !Number.isFinite(pct)) return 'text-zinc-400';
  if (pct < 0.05) return 'text-emerald-400';
  if (pct < 0.2) return 'text-amber-300';
  return 'text-rose-400';
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

  const segWrap = 'inline-flex shrink-0 gap-0.5 rounded-xl border border-zinc-800 bg-zinc-950 p-0.5';
  const chipBtn = (active: boolean) =>
    `rounded-[10px] px-2.5 py-1 text-[11px] transition-colors ${
      active ? 'bg-yellow-400 font-medium text-zinc-950' : 'text-zinc-500 hover:text-zinc-300'
    }`;
  const fieldWrap =
    'flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-1.5 transition-colors focus-within:border-yellow-500/60';
  const fieldLabel = 'shrink-0 text-[11px] uppercase tracking-wider text-zinc-500';
  const fieldInput =
    'min-w-0 flex-1 bg-transparent text-[13px] font-medium tabular-nums text-[#e8e4d9] outline-none';

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-1 text-xs text-zinc-300">
      <div className="flex flex-nowrap items-center gap-2">
        <Dropdown
          title="Symbol"
          value={symbol}
          onChange={setSymbol}
          options={SYMBOLS.map((s) => ({ value: s, label: s }))}
        />
        <Dropdown<VenueId>
          title="Venue"
          value={venue}
          onChange={(v) => {
            if (v === 'phoenix') setVenue(v);
          }}
          options={[
            { value: 'phoenix', label: VENUE_LABEL.phoenix, hint: 'DEX' },
            { value: 'binance', label: 'Binance', hint: 'soon', disabled: true },
          ]}
        />
        <div className={segWrap} role="group" aria-label="Position side">
          {(['long', 'short'] as PositionSide[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              aria-pressed={side === s}
              className={`rounded-[10px] px-3 py-1 text-xs capitalize transition-colors ${
                side === s
                  ? s === 'long'
                    ? 'bg-emerald-500/15 font-medium text-emerald-400'
                    : 'bg-rose-500/15 font-medium text-rose-400'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const nextMargin = commitMargin();
            const nextLeverage = commitLeverage();
            void load({ margin: nextMargin, leverage: nextLeverage });
          }}
          className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-yellow-400 px-3.5 py-1.5 text-[13px] font-semibold text-zinc-950 transition-colors hover:bg-yellow-300"
          title="Recalculate on fresh orderbook"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Calculate
        </button>
      </div>

      <div className="flex flex-nowrap items-center gap-2">
        <label className={fieldWrap}>
          <span className={fieldLabel}>Margin</span>
          <span className="text-zinc-600">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={marginDraft}
            onChange={(e) => setMarginDraft(e.target.value)}
            onBlur={commitMargin}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitMargin();
            }}
            className={fieldInput}
          />
        </label>
        <label className={`${fieldWrap} max-w-[9rem]`}>
          <span className={fieldLabel}>Lev</span>
          <input
            type="text"
            inputMode="decimal"
            value={leverageDraft}
            onChange={(e) => setLeverageDraft(e.target.value)}
            onBlur={commitLeverage}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLeverage();
            }}
            className={fieldInput}
          />
          <span className="text-zinc-600">×</span>
        </label>
        <span
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-yellow-500/30 bg-yellow-400/10 px-3 py-1.5 text-[13px] font-medium tabular-nums text-yellow-400"
          title="Notional = margin × leverage"
        >
          <span className="text-[11px] font-normal uppercase tracking-wider text-yellow-500/70">
            Notional
          </span>
          {formatUsd(notional)}
        </span>
      </div>

      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <div className={segWrap} role="group" aria-label="Margin presets">
          {MARGIN_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setMargin(n);
                setMarginDraft(String(n));
              }}
              aria-pressed={margin === n}
              className={chipBtn(margin === n)}
            >
              ${n >= 1000 ? `${n / 1000}k` : n}
            </button>
          ))}
        </div>
        <div className={segWrap} role="group" aria-label="Leverage presets">
          {LEVERAGE_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setLeverage(n);
                setLeverageDraft(String(n));
              }}
              aria-pressed={leverage === n}
              className={chipBtn(leverage === n)}
            >
              {n}x
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

        {!error && loading && !result && (
          <div className="flex h-24 items-center justify-center text-zinc-500">Calculating…</div>
        )}

        {!error && result && (
          <div className="flex flex-col gap-2">
            {!result.sufficient_liquidity && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200">
                Insufficient depth — filled {formatUsd(result.filled_notional)} of{' '}
                {formatUsd(result.notional)}
                {result.unfilled_notional > 0
                  ? ` · unfilled ${formatUsd(result.unfilled_notional)}`
                  : ''}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-yellow-900/30 bg-gradient-to-b from-yellow-500/[0.05] to-zinc-950/40 px-3 py-2.5">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
                  <Calculator className="h-3 w-3" aria-hidden />
                  Slippage
                </div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular-nums ${severityClass(result.slippage_pct)}`}
                >
                  {formatPct(result.slippage_pct)}
                </div>
                <div className="text-[11px] text-zinc-500">vs best touch</div>
              </div>
              <div className="rounded-2xl border border-yellow-900/30 bg-gradient-to-b from-yellow-500/[0.05] to-zinc-950/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wider text-zinc-500">
                  Book impact
                </div>
                <div
                  className={`mt-1 text-2xl font-semibold tabular-nums ${severityClass(result.book_impact_pct)}`}
                >
                  {result.book_exhausted && result.p_new == null
                    ? 'Book wiped'
                    : formatPct(result.book_impact_pct)}
                </div>
                <div className="text-[11px] text-zinc-500">new best move</div>
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(84px,1fr))] gap-2">
              <StatTile label="P best" value={formatPrice(result.p_best)} />
              <StatTile label="P avg" value={formatPrice(result.p_avg)} />
              <StatTile label="P new" value={formatPrice(result.p_new)} />
              <StatTile label="Mid" value={formatPrice(result.mid)} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <MetaChip label="Levels" value={String(result.levels_used)} />
              <MetaChip label="Filled" value={formatBase(result.filled_base_qty)} />
              <MetaChip
                label="As of"
                value={result.fetched_at ? new Date(result.fetched_at).toLocaleTimeString() : '—'}
              />
              <MetaChip label="Venue" value={VENUE_LABEL[result.venue] ?? result.venue} />
              <MetaChip label="Mode" value="Snapshot" />
            </div>
          </div>
        )}
      </div>

      <p className="border-t border-zinc-900 pt-1.5 text-[11px] leading-snug text-zinc-600">
        Position impact calculator · L2 snapshot walk · educational · not financial advice
      </p>
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/60 px-3 py-1.5">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm font-medium tabular-nums text-[#e8e4d9]">{value}</div>
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[11px]">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium tabular-nums text-zinc-300">{value}</span>
    </span>
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
