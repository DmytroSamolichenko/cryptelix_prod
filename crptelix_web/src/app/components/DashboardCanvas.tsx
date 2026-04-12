import { Hexagon, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import { Widget } from './DashboardWidget';
import { WidgetType } from './DashboardWidget';
import { FlexibleWidget } from './FlexibleWidget';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { KeyMetricsCards } from './TradingMetrics';
import { FtrReportTable } from './FtrReportTable';
import { DrawingCanvas } from './DrawingCanvas';
import { AutoResizeTextarea } from './AutoResizeTextarea';
import { PortfolioWidget } from './PortfolioWidget';
import { WvlWidget } from './WvlWidget';

interface DashboardCanvasProps {
  widgets: Widget[];
  onAddWidget: (widget: Widget) => void;
  onRemoveWidget: (id: string) => void;
  onUpdateWidgetPosition: (id: string, position: { x: number; y: number }) => void;
  onUpdateWidgetSize: (id: string, size: { width: number; height: number }) => void;
  isWidgetsOpen: boolean;
  isBrushActive: boolean;
}

function formatCompactUsd(value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    const sign = value < 0 ? '-' : '';
    const abs = Math.abs(value);
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
  }
}

function formatAxisDateLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMonthAxisLabel(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length < 2 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m] = parts;
  const dt = new Date(y, m - 1, 1);
  return dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

type ProfitTrendTimeScale = 'trades' | 'days' | 'weeks' | 'months';

const PROFIT_TREND_TIME_SCALE_BUTTONS: { key: ProfitTrendTimeScale; label: string }[] = [
  { key: 'trades', label: 'Trades' },
  { key: 'days', label: 'Days' },
  { key: 'weeks', label: 'Weeks' },
  { key: 'months', label: 'Months' },
];

/** Y-axis top = max, bottom = min. Offset from top (0–100) where balance === 0 for linearGradient stops. */
function profitTrendYRange(data: Array<{ balance: number }>): {
  minY: number;
  maxY: number;
  zeroOffsetPct: number;
} {
  if (!data.length) {
    return { minY: 0, maxY: 1, zeroOffsetPct: 50 };
  }
  const balances = data.map((d) => d.balance);
  let minY = Math.min(0, ...balances);
  let maxY = Math.max(0, ...balances);
  if (minY === maxY) {
    const pad = Math.abs(minY) * 0.05 || 1;
    minY -= pad;
    maxY += pad;
  }
  const range = maxY - minY;
  const zeroFromTop = (maxY - 0) / range;
  const z = Math.min(0.999, Math.max(0.001, zeroFromTop));
  return { minY, maxY, zeroOffsetPct: z * 100 };
}

function ProfitTrendWidget() {
  const [data, setData] = useState<Array<{ date: string; balance: number }>>([]);
  const [period, setPeriod] = useState<ProfitTrendTimeScale>('trades');
  const API_BASE_URL = 'http://localhost:8000';
  const fillGradientId = useMemo(
    () => `profit-trend-fill-${Math.random().toString(36).slice(2, 11)}`,
    []
  );

  useEffect(() => {
    const cleanDateLabel = (value: unknown, fallback: string) => {
      if (!value) return fallback;
      const text = String(value);
      // Keep date labels clean by stripping time portion when present.
      return text.includes('T') ? text.split('T')[0] : text;
    };

    const fetchProfitTrend = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/api/metrics/profit-trend?period=${encodeURIComponent(period)}`
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch profit trend: ${response.status}`);
        }

        const responseText = await response.text();
        let payload: unknown;
        try {
          payload = JSON.parse(responseText);
        } catch (parseError) {
          console.error('Profit trend response is not valid JSON:', parseError);
          console.error('Raw /api/metrics/profit-trend response:', responseText);
          setData([]);
          return;
        }

        // GET /api/metrics/profit-trend: cumulative PnL per trade row — keys "date", "balance" only
        const rawData = Array.isArray(payload) ? payload : [];
        const formattedData = rawData.map((d: Record<string, unknown>, index: number) => ({
          date: cleanDateLabel(d.date, `Point ${index + 1}`),
          balance: parseFloat(String(d.balance ?? '')),
        }));

        const validData = formattedData.filter((d: { date: string; balance: number }) => Number.isFinite(d.balance));
        setData(validData);
      } catch (error) {
        console.error('Failed to load /api/metrics/profit-trend', error);
        setData([]);
      }
    };

    fetchProfitTrend();
  }, [period]);

  const xTickFormatter = (v: string | number) =>
    period === 'months' ? formatMonthAxisLabel(String(v)) : formatAxisDateLabel(String(v));

  const { minY, maxY, zeroOffsetPct } = useMemo(() => profitTrendYRange(data), [data]);

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap gap-1">
        {PROFIT_TREND_TIME_SCALE_BUTTONS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setPeriod(key)}
            className={`rounded-md border px-2 py-0.5 text-[10px] font-medium transition-colors ${
              period === key
                ? 'border-yellow-500/60 bg-yellow-500/15 text-yellow-400'
                : 'border-zinc-700 bg-zinc-900/60 text-zinc-400 hover:border-zinc-600 hover:text-zinc-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
            <defs>
              {/* y1→y2 = high→low balance; zeroOffsetPct = where $0 sits between maxY (top) and minY (bottom) */}
              <linearGradient id={fillGradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.42} />
                <stop offset={`${zeroOffsetPct}%`} stopColor="#22c55e" stopOpacity={0.04} />
                <stop offset={`${zeroOffsetPct}%`} stopColor="#ef4444" stopOpacity={0.06} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.38} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              stroke="#52525b"
              tickFormatter={(v) => xTickFormatter(v)}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              domain={[minY, maxY]}
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              stroke="#52525b"
              tickFormatter={(v) => formatCompactUsd(Number(v))}
              width={52}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#18181b',
                border: '1px solid #3f3f46',
                borderRadius: '6px',
                color: '#fff',
              }}
              labelFormatter={(label) => xTickFormatter(String(label))}
              formatter={(value: number | string) => [
                new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
                  Number(value)
                ),
                'Balance',
              ]}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#22c55e"
              strokeWidth={2}
              fill={`url(#${fillGradientId})`}
              dot={false}
              activeDot={{ r: 4, fill: '#22c55e', stroke: '#14532d', strokeWidth: 1 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function DashboardCanvas({ 
  widgets, 
  onAddWidget, 
  onRemoveWidget, 
  onUpdateWidgetPosition, 
  onUpdateWidgetSize,
  isWidgetsOpen,
  isBrushActive
}: DashboardCanvasProps) {
  const [zoom, setZoom] = useState(1);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.25));
  const handleResetZoom = () => setZoom(1);

  const handleAddWidgetFromToolbar = (type: WidgetType) => {
    const widgetTitles: Record<WidgetType, string> = {
      'line-chart': 'Profit Trend',
      'bar-chart': 'WvL',
      'pie-chart': 'Portfolio Mix',
      'area-chart': 'Cumulative P&L',
      'stats-card': 'Key Metrics',
      'table': 'Full Trading Report',
      'portfolio': 'Portfolio Analytics',
      'text-field': 'Text',
      'portfolio-widget': 'Portfolio Analytics',
    };

    const randomX = Math.floor(Math.random() * 400) + 50;
    const randomY = Math.floor(Math.random() * 200) + 50;

    const newWidget: Widget = {
      id: `widget-${Date.now()}-${Math.random()}`,
      type,
      title: widgetTitles[type] || 'Widget',
      position: { x: randomX, y: randomY },
      size: type === 'table' 
        ? { width: 600, height: 500 } 
        : type === 'portfolio-widget'
        ? { width: 800, height: 600 }
        : { width: 400, height: 320 },
    };
    onAddWidget(newWidget);
  };

  const handleExtractMetric = (label: string, value: string | number, isPositive?: boolean, isNegative?: boolean) => {
    const ftrMetricKey = `ftr:${label}`;
    if (widgets.some((w) => w.data?.ftrMetricKey === ftrMetricKey)) {
      return;
    }
    const newWidget: Widget = {
      id: `ftr-spawn-${ftrMetricKey.replace(/[^\w-]+/g, '-').slice(0, 96)}`,
      type: 'stats-card',
      title: label,
      position: { x: Math.floor(Math.random() * 400) + 50, y: Math.floor(Math.random() * 200) + 50 },
      size: { width: 300, height: 180 },
      data: { value, isPositive, isNegative, ftrMetricKey },
    };
    onAddWidget(newWidget);
  };

  const renderWidgetContent = (widget: Widget) => {
    switch (widget.type) {
      case 'line-chart':
        return <ProfitTrendWidget />;

      case 'bar-chart':
        return <WvlWidget />;

      case 'stats-card':
        // If widget has custom data (from extracted metric), display it
        if (widget.data) {
          const color = widget.data.isPositive
            ? '#22c55e'
            : widget.data.isNegative
              ? '#ef4444'
              : '#fafafa';
          return (
            <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden px-3 py-2">
              <div
                className="flex max-w-full items-center justify-center gap-2 text-center text-2xl font-bold leading-tight sm:text-3xl"
                style={{ color }}
              >
                {widget.data.isPositive && <TrendingUp className="h-7 w-7 shrink-0" aria-hidden />}
                {widget.data.isNegative && <TrendingDown className="h-7 w-7 shrink-0" aria-hidden />}
                <span className="min-w-0 break-words">{widget.data.value}</span>
              </div>
            </div>
          );
        }
        return <KeyMetricsCards />;

      case 'table':
        return <FtrReportTable onExtractMetric={handleExtractMetric} />;

      case 'text-field':
        return (
          <AutoResizeTextarea />
        );

      case 'portfolio-widget':
        return (
          <PortfolioWidget />
        );

      default:
        return (
          <div className="flex items-center justify-center h-full text-gray-500 text-sm">
            Widget content
          </div>
        );
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Canvas with grid background */}
      <div
        className="flex-1 overflow-hidden relative"
        style={{
          backgroundImage: `
            radial-gradient(circle, rgba(250, 204, 21, 0.08) 1px, transparent 1px)
          `,
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: 'center center',
        }}
      >
        {/* Overlay pattern */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(250, 204, 21, 0.02) 1px, transparent 1px),
              linear-gradient(90deg, rgba(250, 204, 21, 0.02) 1px, transparent 1px)
            `,
            backgroundSize: `${48 * zoom}px ${48 * zoom}px`,
          }}
        />

        {/* Zoom Controls */}
        <div className="absolute bottom-6 right-6 flex flex-col gap-2 z-50">
          <motion.button
            onClick={handleZoomIn}
            className="p-2 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg hover:bg-zinc-800 hover:border-yellow-500/50 transition-all"
            title="Zoom In"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ZoomIn className="w-4 h-4 text-gray-400" />
          </motion.button>
          <motion.button
            onClick={handleResetZoom}
            className="px-2 py-1 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg hover:bg-zinc-800 hover:border-yellow-500/50 transition-all text-xs text-gray-400"
            title="Reset Zoom"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {Math.round(zoom * 100)}%
          </motion.button>
          <motion.button
            onClick={handleZoomOut}
            className="p-2 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg hover:bg-zinc-800 hover:border-yellow-500/50 transition-all"
            title="Zoom Out"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ZoomOut className="w-4 h-4 text-gray-400" />
          </motion.button>
        </div>

        {/* Widgets Container */}
        <div className="absolute inset-0 overflow-auto">
          <div
            className="relative min-h-full min-w-full origin-top-left transition-transform duration-200"
            style={{
              transform: `scale(${zoom})`,
              width: `${100 / zoom}%`,
              height: `${100 / zoom}%`,
            }}
          >
            {widgets.map((widget) => (
              <FlexibleWidget
                key={widget.id}
                widget={widget}
                onRemove={onRemoveWidget}
                onUpdatePosition={onUpdateWidgetPosition}
                onUpdateSize={onUpdateWidgetSize}
              >
                {renderWidgetContent(widget)}
              </FlexibleWidget>
            ))}
            
            {/* Drawing Canvas Layer */}
            <DrawingCanvas isActive={isBrushActive} />
          </div>
        </div>
      </div>
    </div>
  );
}