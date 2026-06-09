import { Widget } from './DashboardWidget';
import { WidgetType } from './DashboardWidget';
import { FlexibleWidget } from './FlexibleWidget';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { DrawingCanvas } from './DrawingCanvas';
import { CanvasTextElement, type TextElementState, DEFAULT_FONT_SIZE, normalizeCommittedHtml } from './CanvasTextElement';
import { CanvasWidgetBody } from './CanvasWidgetBody';
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
  drawToolMode: 'brush' | 'eraser';
  onDrawToolModeChange: (mode: 'brush' | 'eraser') => void;
  brushColor: string;
  drawingDataUrl?: string;
  onDrawingChange?: (dataUrl: string) => void;
  canvasId?: string;
}

/** Workspace plane — scroll/pan in any direction (middle mouse, right mouse, or Space + drag) */
const WORLD_SIZE = 10000;
const WORLD_ORIGIN = WORLD_SIZE / 2;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;
const ZOOM_WHEEL_STEP = 0.1;
const ZOOM_ANIM_MS = 280;

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function getWorldPointAtAnchor(
  scrollLeft: number,
  scrollTop: number,
  zoomLevel: number,
  anchorX: number,
  anchorY: number
) {
  return {
    worldX: (scrollLeft + anchorX) / zoomLevel,
    worldY: (scrollTop + anchorY) / zoomLevel,
  };
}

function scrollForWorldPoint(
  worldX: number,
  worldY: number,
  zoomLevel: number,
  anchorX: number,
  anchorY: number
) {
  return {
    scrollLeft: worldX * zoomLevel - anchorX,
    scrollTop: worldY * zoomLevel - anchorY,
  };
}

function widgetToTextElement(widget: Widget): TextElementState {
  const data = (widget.data ?? {}) as { text?: string; html?: string; fontSize?: number };
  const rawHtml = data.html ?? '';
  const htmlFromText = data.text ? data.text.replace(/\n/g, '<br>') : '';
  const sourceHtml =
    rawHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ').trim().length > 0
      ? rawHtml
      : htmlFromText;
  const html = normalizeCommittedHtml(sourceHtml);
  return {
    id: widget.id,
    text: data.text ?? '',
    html,
    fontSize: typeof data.fontSize === 'number' ? data.fontSize : DEFAULT_FONT_SIZE,
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
  drawToolMode,
  brushColor,
  drawingDataUrl,
  onDrawingChange,
  canvasId,
}: DashboardCanvasProps) {
  const [zoom, setZoom] = useState(DEFAULT_CANVAS_ZOOM);
  const zoomRef = useRef(DEFAULT_CANVAS_ZOOM);
  const zoomAnimFrameRef = useRef<number | null>(null);
  const zoomLabelRef = useRef<HTMLSpanElement | null>(null);
  const isZoomAnimatingRef = useRef(false);
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

  const updateZoomLabel = (level: number) => {
    if (zoomLabelRef.current) {
      zoomLabelRef.current.textContent = `${Math.round(level * 100)}%`;
    }
  };

  const syncWorldTransform = (level: number) => {
    const el = worldSurfaceRef.current;
    if (!el) return;
    el.style.transform = `scale(${level})`;
  };

  const setZoomAnimating = (active: boolean) => {
    isZoomAnimatingRef.current = active;
    const el = worldSurfaceRef.current;
    if (!el) return;
    if (active) {
      el.style.willChange = 'transform';
    } else {
      el.style.willChange = '';
    }
  };

  const commitZoom = (level: number) => {
    zoomRef.current = level;
    syncWorldTransform(level);
    updateZoomLabel(level);
    setZoom(level);
  };

  useEffect(() => {
    if (isZoomAnimatingRef.current) return;
    zoomRef.current = zoom;
    syncWorldTransform(zoom);
    updateZoomLabel(zoom);
  }, [zoom]);

  useEffect(() => {
    return () => {
      if (zoomAnimFrameRef.current != null) {
        cancelAnimationFrame(zoomAnimFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (hasCenteredScrollRef.current) return;
    const id = requestAnimationFrame(() => {
      const container = scrollContainerRef.current;
      if (!container || container.clientWidth === 0) return;
      syncWorldTransform(zoomRef.current);
      updateZoomLabel(zoomRef.current);
      centerViewportOnOrigin(zoomRef.current);
      hasCenteredScrollRef.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const cancelZoomAnimation = () => {
    if (zoomAnimFrameRef.current != null) {
      cancelAnimationFrame(zoomAnimFrameRef.current);
      zoomAnimFrameRef.current = null;
    }
    if (isZoomAnimatingRef.current) {
      setZoomAnimating(false);
      commitZoom(zoomRef.current);
    }
  };

  const applyZoomAtAnchor = (
    nextZoom: number,
    anchorX: number,
    anchorY: number,
    options?: { animate?: boolean }
  ) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const targetZoom = clampZoom(nextZoom);
    const startZoom = zoomRef.current;
    if (Math.abs(targetZoom - startZoom) < 0.001) return;

    cancelZoomAnimation();

    const { worldX, worldY } = getWorldPointAtAnchor(
      container.scrollLeft,
      container.scrollTop,
      startZoom,
      anchorX,
      anchorY
    );

    if (!options?.animate) {
      const { scrollLeft, scrollTop } = scrollForWorldPoint(
        worldX,
        worldY,
        targetZoom,
        anchorX,
        anchorY
      );
      container.scrollLeft = scrollLeft;
      container.scrollTop = scrollTop;
      commitZoom(targetZoom);
      return;
    }

    setZoomAnimating(true);
    const startTime = performance.now();

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startTime) / ZOOM_ANIM_MS);
      const currentZoom = startZoom + (targetZoom - startZoom) * easeOutCubic(progress);
      const { scrollLeft, scrollTop } = scrollForWorldPoint(
        worldX,
        worldY,
        currentZoom,
        anchorX,
        anchorY
      );

      zoomRef.current = currentZoom;
      syncWorldTransform(currentZoom);
      updateZoomLabel(currentZoom);
      container.scrollLeft = scrollLeft;
      container.scrollTop = scrollTop;

      if (progress < 1) {
        zoomAnimFrameRef.current = requestAnimationFrame(tick);
      } else {
        zoomAnimFrameRef.current = null;
        setZoomAnimating(false);
        commitZoom(targetZoom);
      }
    };

    zoomAnimFrameRef.current = requestAnimationFrame(tick);
  };

  const getViewportCenter = (container: HTMLDivElement) => ({
    anchorX: container.clientWidth / 2,
    anchorY: container.clientHeight / 2,
  });

  const zoomFromViewportCenter = useCallback((delta: number, animate = true) => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { anchorX, anchorY } = getViewportCenter(container);
    applyZoomAtAnchor(zoomRef.current + delta, anchorX, anchorY, { animate });
  }, []);

  const handleZoomIn = useCallback(() => {
    zoomFromViewportCenter(ZOOM_STEP, true);
  }, [zoomFromViewportCenter]);

  const handleZoomOut = useCallback(() => {
    zoomFromViewportCenter(-ZOOM_STEP, true);
  }, [zoomFromViewportCenter]);

  const handleResetZoom = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const { anchorX, anchorY } = getViewportCenter(container);
    applyZoomAtAnchor(DEFAULT_CANVAS_ZOOM, anchorX, anchorY, { animate: true });
  }, []);

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

  const clearWidgetSelection = () => {
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const zoomIn =
        (e.key === '+' || e.key === '=') && (e.ctrlKey || e.metaKey);
      const zoomOut = (e.key === '-' || e.key === '_') && (e.ctrlKey || e.metaKey);
      const resetZoom = e.key === '0' && (e.ctrlKey || e.metaKey);

      if (zoomIn) {
        e.preventDefault();
        handleZoomIn();
      } else if (zoomOut) {
        e.preventDefault();
        handleZoomOut();
      } else if (resetZoom) {
        e.preventDefault();
        handleResetZoom();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleZoomIn, handleZoomOut, handleResetZoom]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      if (!selectedWidgetId) return;

      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      ) {
        return;
      }

      const widget = widgets.find((w) => w.id === selectedWidgetId);
      if (!widget) return;

      if (widget.type === 'text-field' && editingWidgetId === selectedWidgetId) return;

      e.preventDefault();
      onRemoveWidget(selectedWidgetId);
      clearWidgetSelection();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedWidgetId, editingWidgetId, widgets, onRemoveWidget]);

  const handleWorldMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 0 && !spaceHeld && event.target === event.currentTarget) {
      clearWidgetSelection();
    }
  };

  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const isMiddle = event.button === 1;
    const isRight = event.button === 2;
    const isSpaceLeft = event.button === 0 && spaceHeld;
    if (!isMiddle && !isRight && !isSpaceLeft) return;
    clearWidgetSelection();
    startPan(event);
  };

  const handleTextElementUpdate = (updated: TextElementState) => {
    onUpdateWidgetPosition(updated.id, { x: updated.x, y: updated.y });
    onUpdateWidgetSize(updated.id, { width: updated.width, height: updated.height });
    onUpdateWidgetData(updated.id, {
      text: updated.text,
      html: updated.html,
      fontSize: updated.fontSize,
    });
  };

  const handleCanvasWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const container = scrollContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const anchorX = event.clientX - rect.left;
    const anchorY = event.clientY - rect.top;

    const prevZoom = zoomRef.current;
    const delta = event.deltaY < 0 ? ZOOM_WHEEL_STEP : -ZOOM_WHEEL_STEP;
    const nextZoom = clampZoom(prevZoom + delta);
    if (nextZoom === prevZoom) return;

    applyZoomAtAnchor(nextZoom, anchorX, anchorY);
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

  const handleExtractMetric = useCallback(
    (label: string, value: string | number, isPositive?: boolean, isNegative?: boolean) => {
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
    },
    [widgets, onAddWidget]
  );

  const panCursor = isPanning ? 'cursor-grabbing' : spaceHeld ? 'cursor-grab' : 'cursor-default';

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      <div className="flex-1 overflow-hidden relative bg-zinc-950">
        <div
          ref={scrollContainerRef}
          className={`absolute inset-0 overflow-auto scrollbar-hidden ${panCursor}`}
          onMouseDown={handleCanvasMouseDown}
          onWheel={handleCanvasWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            ref={worldSurfaceRef}
            className="relative origin-top-left"
            onMouseDown={handleWorldMouseDown}
            style={{
              width: WORLD_SIZE,
              height: WORLD_SIZE,
              transformOrigin: '0 0',
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
                    zoomRef={zoomRef}
                    onSelect={() => {
                      setSelectedWidgetId(widget.id);
                      setEditingWidgetId(widget.id);
                    }}
                    onStartEdit={() => {
                      setSelectedWidgetId(widget.id);
                      setEditingWidgetId(widget.id);
                    }}
                    onEndEdit={() => setEditingWidgetId(null)}
                    onUpdate={handleTextElementUpdate}
                    onRemove={(id) => {
                      if (selectedWidgetId === id) clearWidgetSelection();
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
                  zoomRef={zoomRef}
                  isSelected={selectedWidgetId === widget.id}
                  onSelect={() => {
                    setSelectedWidgetId(widget.id);
                    setEditingWidgetId(null);
                  }}
                >
                  <CanvasWidgetBody widget={widget} onExtractMetric={handleExtractMetric} />
                </FlexibleWidget>
              );
            })}

            <DrawingCanvas
              isActive={isBrushActive}
              toolMode={drawToolMode}
              color={brushColor}
              canvasId={canvasId}
              worldSize={WORLD_SIZE}
              drawingData={drawingDataUrl}
              onDrawingChange={onDrawingChange}
              worldRef={worldSurfaceRef}
              zoomRef={zoomRef}
            />
          </div>
        </div>

        <CanvasHelpHint />

        {/* Zoom controls — rendered last so clicks always reach the buttons */}
        <div
          className="pointer-events-auto absolute bottom-6 right-6 z-[60] flex flex-col gap-2"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <motion.button
            type="button"
            onClick={handleZoomIn}
            className="p-2 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg hover:bg-zinc-800 hover:border-yellow-500/50 transition-all"
            title="Zoom In"
            aria-label="Zoom in"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ZoomIn className="w-4 h-4 text-gray-400" />
          </motion.button>
          <motion.button
            type="button"
            onClick={handleResetZoom}
            className="px-2 py-1 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg hover:bg-zinc-800 hover:border-yellow-500/50 transition-all text-xs text-gray-400"
            title="Reset zoom to 100%"
            aria-label="Reset zoom"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <span ref={zoomLabelRef}>{Math.round(zoom * 100)}%</span>
          </motion.button>
          <motion.button
            type="button"
            onClick={handleZoomOut}
            className="p-2 bg-zinc-900/90 backdrop-blur-sm border border-zinc-700 rounded-lg hover:bg-zinc-800 hover:border-yellow-500/50 transition-all"
            title="Zoom Out"
            aria-label="Zoom out"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ZoomOut className="w-4 h-4 text-gray-400" />
          </motion.button>
        </div>
      </div>
    </div>
  );
}