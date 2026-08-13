import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { apiFetch } from '../lib/apiClient';
import { useTradesSynced } from '../lib/useTradesSynced';

type TradeRow = Record<string, unknown>;

type PricePoint = {
  date: string;
  price: number;
};

function parseNum(raw: unknown): number {
  const n = Number(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function dateLabel(raw: unknown): string {
  const s = String(raw ?? '');
  return s.includes('T') ? s.split('T')[0] : s.slice(0, 10);
}

function formatAxisDate(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatPrice(n: number): string {
  const digits = n >= 1000 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function PriceChartWidget() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [pair, setPair] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/v1/trades');
      if (!res.ok) {
        setTrades([]);
        return;
      }
      const raw = (await res.json()) as unknown;
      setTrades(Array.isArray(raw) ? (raw as TradeRow[]) : []);
    } catch {
      setTrades([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useTradesSynced(load);

  const pairs = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of trades) {
      const p = String(t.pair ?? '').trim();
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [trades]);

  useEffect(() => {
    if (!pairs.length) {
      setPair('');
      return;
    }
    if (!pair || !pairs.includes(pair)) setPair(pairs[0]);
  }, [pairs, pair]);

  const data = useMemo<PricePoint[]>(() => {
    if (!pair) return [];
    return trades
      .filter((t) => String(t.pair ?? '').trim() === pair)
      .map((t) => ({
        date: dateLabel(t.date),
        price: parseNum(t.entry_price) || parseNum(t.exit_price),
      }))
      .filter((p) => p.date && p.price > 0)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [trades, pair]);

  const latest = data.length ? data[data.length - 1].price : 0;

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col [contain:layout]">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <p className="truncate text-sm font-semibold tabular-nums text-zinc-100">
          {data.length ? formatPrice(latest) : '—'}
        </p>
        {pairs.length > 0 && (
          <select
            value={pair}
            onChange={(e) => setPair(e.target.value)}
            className="max-w-[9rem] cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-200 outline-none"
            title="Pair"
          >
            {pairs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
      </div>

      {data.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center text-xs text-zinc-500">
          No prices for this pair
        </div>
      ) : (
        <div className="min-h-0 min-w-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#a1a1aa' }}
                stroke="#52525b"
                tickLine={false}
                tickFormatter={formatAxisDate}
              />
              <YAxis
                domain={['auto', 'auto']}
                tick={{ fontSize: 11, fill: '#a1a1aa' }}
                stroke="#52525b"
                tickLine={false}
                width={52}
                tickFormatter={(v) => formatPrice(Number(v))}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#18181b',
                  border: '1px solid #3f3f46',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(label) => formatAxisDate(String(label))}
                formatter={(value: number) => [formatPrice(value), 'Price']}
              />
              <Line
                type="monotone"
                dataKey="price"
                stroke="#facc15"
                strokeWidth={2}
                dot={{ r: 2, fill: '#facc15' }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
