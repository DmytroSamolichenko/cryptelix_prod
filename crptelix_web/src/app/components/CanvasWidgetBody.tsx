import { memo } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { Widget } from './DashboardWidget';
import { KeyMetricsCards } from './TradingMetrics';
import { FtrReportTable } from './FtrReportTable';
import { PortfolioWidget } from './PortfolioWidget';
import { PortfolioMixWidget } from './PortfolioMixWidget';
import { WvlWidget } from './WvlWidget';
import { ProfitTrendWidget } from './ProfitTrendWidget';
import { PriceChartWidget } from './PriceChartWidget';

interface CanvasWidgetBodyProps {
  widget: Widget;
  onExtractMetric: (
    label: string,
    value: string | number,
    isPositive?: boolean,
    isNegative?: boolean
  ) => void;
}

export const CanvasWidgetBody = memo(function CanvasWidgetBody({
  widget,
  onExtractMetric,
}: CanvasWidgetBodyProps) {
  switch (widget.type) {
    case 'line-chart':
      return <PriceChartWidget />;

    case 'bar-chart':
      return <WvlWidget />;

    case 'area-chart':
      return <ProfitTrendWidget />;

    case 'pie-chart':
      return <PortfolioMixWidget />;

    case 'stats-card':
      if (widget.data) {
        const color = widget.data.isPositive
          ? '#22c55e'
          : widget.data.isNegative
            ? '#ef4444'
            : '#fafafa';
        return (
          <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-hidden px-3 py-2">
            <div
              className="flex max-w-full items-center justify-center gap-2 text-center text-xl font-bold leading-tight"
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
      return <FtrReportTable onExtractMetric={onExtractMetric} />;

    case 'portfolio-widget':
    case 'portfolio':
      return <PortfolioWidget />;

    default:
      return (
        <div className="flex h-full items-center justify-center text-sm text-gray-500">
          Widget content
        </div>
      );
  }
});
