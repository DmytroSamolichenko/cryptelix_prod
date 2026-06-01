import { Hexagon, Sparkles, TrendingUp, TrendingDown } from 'lucide-react';
import { Widget } from './DashboardWidget';
import { WidgetType } from './DashboardWidget';
import { FlexibleWidget } from './FlexibleWidget';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { KeyMetricsCards } from './TradingMetrics';
import { FtrReportTable } from './FtrReportTable';
import { DrawingCanvas } from './DrawingCanvas';
import { CanvasTextElement, type TextElementState } from './CanvasTextElement';
import { PortfolioWidget } from './PortfolioWidget';
import { WvlWidget } from './WvlWidget';
import { ProfitTrendWidget } from './ProfitTrendWidget';
import { DEFAULT_CANVAS_ZOOM, scaleSize } from '../lib/uiScale';
import { CanvasHelpHint } from './CanvasHelpHint';

interface DashboardCanvasProps {
  widgets: Widget[];
  onAddWidget: (widget: Widget) => void;
  onRemoveWidget: (id: string) => void;
  onUpdateWidgetPosition: (id: string, position: { x: number; y: number }) => void;
  onUpdateWidgetSize: (id: string, size: { width: number; height: number }) => void;
  onUpdateWidgetData: (id: string, data: Record<string, unknown>) => void;
  isWidgetsOpen: boolean;
  isBrushActive: boolean;
  brushColor: string;
  drawingDataUrl?: string;
  onDrawingChange?: (dataUrl: string) => void;
  canvasId?: string;
}

/** Workspace plane — scroll/pan in any direction (middle mouse, right mouse, or Space + drag) */
const WORLD_SIZE = 10000;
const WORLD_ORIGIN = WORLD_SIZE / 2;

function widgetToTextElement(widget: Widget): TextElementState {
  const data = (widget.data ?? {}) as { text?: string };
  return {
    id: widget.id,
    text: data.text ?? '',
    x: widget.position?.x ?? 0,
    y: widget.position?.y ?? 0,
    width: widget.size?.width ?? 280,
    height: widget.size?.height ?? 120,
  };
}

export function DashboardCanvas({ 
  widgets, 
  onAddWidget, 
  onRemoveWidget, 
  onUpdateWidgetPosition, 
  onUpdateWidgetSize,
  onUpdateWidgetData,
  isWidgetsOpen,
  isBrushActive,
  brushColor,
  drawingDataUrl,
  onDrawingChange,
  canvasId,
}: DashboardCanvasProps) {
  const [zoom, setZoom] = useState(DEFAULT_CANVAS_ZOOM);
  const [isPanning, setIsPanning] = useState(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const [editingWidgetId, setEditingWidgetId] = useState<string | null>(null);
  const knownTextWidgetIdsRef = useRef(new Set<string>());
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const worldSurfaceRef = useRef<HTMLDivElement | null>(null);
  const hasCenteredScrollRef = useRef(false);
  const panStateRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  const centerViewportOnOrigin = (zoomLevel: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const targetLeft = WORLD_ORIGIN * zoomLevel - container.clientWidth / 2;
    const targetTop = WORLD_ORIGIN * zoomLevel - container.clientHeight / 2;
    container.scrollLeft = Math.max(0, targetLeft);
    container.scrollTop = Math.max(0, targetTop);
  };

  useEffect(() => {
    if (hasCenteredScrollRef.current) return;
    const id = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container || container.clientWidth === 0) return;
      centerViewportOnOrigin(zoom);
      hasCenteredScrollRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, [zoom]);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.25));
  const handleResetZoom = () => {
    setZoom(DEFAULT_CANVAS_ZOOM);
    requestAnimationFrame(() => centerViewportOnOrigin(DEFAULT_CANVAS_ZOOM));
  };

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const state = panStateRef.current;
      const container = scrollContainerRef.current;
      if (!state.active || !container) return;

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      container.scrollLeft = state.startScrollLeft - dx;
      container.scrollTop = state.startScrollTop - dy;
    };

    const stopPanning = () => {
      if (!panStateRef.current.active) return;
      panStateRef.current.active = false;
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopPanning);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopPanning);
    };
  }, []);

  useEffect(() => {
    const stopPanningFromRef = () => {
      if (panStateRef.current.active) {
        panStateRef.current.active = false;
        setIsPanning(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      e.preventDefault();
      setSpaceHeld(true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpaceHeld(false);
        stopPanningFromRef();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const startPan = (event: React.MouseEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    event.preventDefault();

    panStateRef.current = {
      active: true,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: container.scrollLeft,
      startScrollTop: container.scrollTop,
    };
    setIsPanning(true);
  };

  const clearTextSelection = () => {
    setSelectedWidgetId(null);
    setEditingWidgetId(null);
  };

  useEffect(() => {
    for (const w of widgets) {
      if (w.type !== 'text-field' || knownTextWidgetIdsRef.current.has(w.id)) continue;
      knownTextWidgetIdsRef.current.add(w.id);
      setSelectedWidgetId(w.id);
      setEditingWidgetId(w.id);
    }
  }, [widgets]);

  const handleWorldMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 0 && !spaceHeld && event.target === event.currentTarget) {
      clearTextSelection();
    }
  };

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const isMiddle = event.button === 1;
    const isRight = event.button === 2;
    const isSpaceLeft = event.button === 0 && spaceHeld;
    if (!isMiddle && !isRight && !isSpaceLeft) return;
    clearTextSelection();
    startPan(event);
  };

  const handleTextElementUpdate = (updated: TextElementState) => {
    onUpdateWidgetPosition(updated.id, { x: updated.x, y: updated.y });
    onUpdateWidgetSize(updated.id, { width: updated.width, height: updated.height });
    onUpdateWidgetData(updated.id, { text: updated.text });
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    // Use wheel for dashboard zoom.
    event.preventDefault();
    const container = scrollContainerRef.current;
    if (!container) return;

    const prevZoom = zoom;
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    const nextZoom = Math.min(3, Math.max(0.25, prevZoom + delta));
    if (nextZoom === prevZoom) return;

    // Keep zoom focus near the pointer position.
    const rect = container.getBoundingClientRect();
    const pointerX = event.clientX - rect.left + container.scrollLeft;
    const pointerY = event.clientY - rect.top + container.scrollTop;
    const scaleRatio = nextZoom / prevZoom;

    setZoom(nextZoom);

    requestAnimationFrame(() => {
      container.scrollLeft = pointerX * scaleRatio - (event.clientX - rect.left);
      container.scrollTop = pointerY * scaleRatio - (event.clientY - rect.top);
    });
  };

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
        ? scaleSize(600, 500)
        : type === 'portfolio-widget'
        ? scaleSize(800, 600)
        : scaleSize(400, 320),
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
        return <FtrReportTable onExtractMetric={handleExtractMetric} />;

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

  const panCursor = isPanning ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : 'cursor-default';

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <div className="flex-1 overflow-hidden relative bg-zinc-950">
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

        <div
          ref={scrollContainerRef}
          className={`absolute inset-0 overflow-hidden ${panCursor}`}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleCanvasWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            ref={worldSurfaceRef}
            className="relative origin-top-left [contain:layout]"
            onMouseDown={handleWorldMouseDown}
            style={{
              width: WORLD_SIZE,
              height: WORLD_SIZE,
              transform: `scale(${zoom})`,
              transformOrigin: '0 0',
              backfaceVisibility: 'hidden',
              backgroundColor: '#09090b',
              backgroundImage: `
                radial-gradient(circle, rgba(250, 204, 21, 0.08) 1px, transparent 1px),
                linear-gradient(rgba(250, 204, 21, 0.02) 1px, transparent 1px),
                linear-gradient(90deg, rgba(250, 204, 21, 0.02) 1px, transparent 1px)
              `,
              backgroundSize: `24px 24px, 48px 48px, 48px 48px`,
            }}
          >
            {widgets.map((widget) => {
              if (widget.type === 'text-field') {
                const isSelected = selectedWidgetId === widget.id;
                const isEditing = editingWidgetId === widget.id;
                return (
                  <CanvasTextElement
                    key={widget.id}
                    element={widgetToTextElement(widget)}
                    isSelected={isSelected}
                    isEditing={isEditing}
                    canvasOrigin={{ x: WORLD_ORIGIN, y: WORLD_ORIGIN }}
                    zoom={zoom}
                    onSelect={() => {
                      setSelectedWidgetId(widget.id);
                      setEditingWidgetId(null);
                    }}
                    onStartEdit={() => {
                      setSelectedWidgetId(widget.id);
                      setEditingWidgetId(widget.id);
                    }}
                    onEndEdit={() => setEditingWidgetId(null)}
                    onUpdate={handleTextElementUpdate}
                    onRemove={(id) => {
                      if (selectedWidgetId === id) clearTextSelection();
                      onRemoveWidget(id);
                    }}
                  />
                );
              }

              return (
                <FlexibleWidget
                  key={widget.id}
                  widget={widget}
                  onRemove={onRemoveWidget}
                  onUpdatePosition={onUpdateWidgetPosition}
                  onUpdateSize={onUpdateWidgetSize}
                  canvasOrigin={{ x: WORLD_ORIGIN, y: WORLD_ORIGIN }}
                  zoom={zoom}
                >
                  {renderWidgetContent(widget)}
                </FlexibleWidget>
              );
            })}
          </div>
        </div>

        <DrawingCanvas
          isActive={isBrushActive}
          color={brushColor}
          canvasId={canvasId}
          drawingDataUrl={drawingDataUrl}
          onDrawingChange={onDrawingChange}
          viewportRef={scrollContainerRef}
          worldRef={worldSurfaceRef}
        />

        <CanvasHelpHint />
      </div>
    </div>
  );
}