import { memo, useRef, useEffect, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react';
import { GripVertical, X } from 'lucide-react';
import { Widget } from './DashboardWidget';
import { Card } from './ui/card';
import {
  applyDragTranslate,
  applyResizeBox,
  clearDragTransform,
  pinElementBox,
  computeResizeBox,
} from '../lib/canvasInteraction';
import {
  stopWidgetRightClickPan,
  WidgetLayerContextMenu,
  type WidgetLayerAction,
} from './WidgetLayerContextMenu';

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type InteractionMode = 'idle' | 'drag' | 'resize';

const TEXT_MIN_WIDTH = 80;
const TEXT_MIN_HEIGHT = 40;
const WIDGET_MIN_WIDTH = 238;
const WIDGET_MIN_HEIGHT = 170;
/** Below this the Volume Mix legend can no longer sit beside the donut. */
const PIE_MIN_WIDTH = 520;
const PIE_MIN_HEIGHT = 300;
const BODY_DRAG_THRESHOLD = 5;

/** Chart widgets need a fixed viewport; others scroll when content exceeds the box. */
function widgetHasOwnChrome(widget: Widget): boolean {
  return (
    widget.type === 'line-chart' ||
    widget.type === 'bar-chart' ||
    widget.type === 'pie-chart' ||
    widget.type === 'area-chart' ||
    widget.type === 'pnl-calendar' ||
    widget.type === 'symbol-scorecard' ||
    widget.type === 'session-heatmap' ||
    (widget.type === 'stats-card' && !widget.data?.ftrMetricKey)
  );
}

function widgetBodyClass(type: Widget['type']): string {
  if (
    type === 'line-chart' ||
    type === 'bar-chart' ||
    type === 'stats-card' ||
    type === 'area-chart' ||
    type === 'pie-chart' ||
    type === 'pnl-calendar' ||
    type === 'symbol-scorecard' ||
    type === 'session-heatmap' ||
    type === 'funding-rates' ||
    type === 'position-impact'
  ) {
    return 'min-h-0 min-w-0 flex-1 overflow-hidden';
  }
  return 'widget-scrollbar min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-0.5';
}

function displayWidgetTitle(widget: Widget): string {
  if (widget.type === 'line-chart') return 'Price Chart';
  if (widget.type === 'area-chart') return 'Cul. PnL';
  if (widget.type === 'pie-chart') return 'Volume Mix';
  if (widget.type === 'pnl-calendar') return 'PnL Calendar';
  if (widget.type === 'symbol-scorecard') return 'Symbol Scorecard';
  if (widget.type === 'session-heatmap') return 'Session Heatmap';
  if (widget.type === 'funding-rates') return 'Funding Rates';
  if (widget.type === 'position-impact') return 'Position Impact';
  return widget.title;
}

function clearTextSelection() {
  window.getSelection()?.removeAllRanges();
}

const RESIZE_HANDLES: { id: ResizeHandle; className: string; cursor: string }[] = [
  { id: 'nw', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nw-resize' },
  { id: 'ne', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ne-resize' },
  { id: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'cursor-se-resize' },
  { id: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-sw-resize' },
];

export type CanvasSelectEvent = { shiftKey: boolean; keepGroup?: boolean };

interface FlexibleWidgetProps {
  widget: Widget;
  onRemove: (id: string) => void;
  onUpdatePosition: (id: string, position: { x: number; y: number }) => void;
  onUpdateSize: (id: string, size: { width: number; height: number }) => void;
  canvasOrigin?: { x: number; y: number };
  zoomRef?: MutableRefObject<number>;
  isSelected?: boolean;
  isInGroup?: boolean;
  isPreviewSelected?: boolean;
  isEditing?: boolean;
  peerOffset?: { x: number; y: number } | null;
  onSelect?: (event?: CanvasSelectEvent) => void;
  onGroupDragLive?: (dx: number, dy: number) => void;
  onGroupDragEnd?: (sourceId: string, dx: number, dy: number) => void;
  onLayerAction?: (action: WidgetLayerAction) => void;
  children: React.ReactNode;
}

function FlexibleWidgetInner({
  widget,
  onRemove,
  onUpdatePosition,
  onUpdateSize,
  canvasOrigin = { x: 0, y: 0 },
  zoomRef,
  isSelected = false,
  isInGroup = false,
  isPreviewSelected = false,
  isEditing = false,
  peerOffset = null,
  onSelect,
  onGroupDragLive,
  onGroupDragEnd,
  onLayerAction,
  children,
}: FlexibleWidgetProps) {
  const [isInteracting, setIsInteracting] = useState(false);
  const [layerMenu, setLayerMenu] = useState<{ x: number; y: number } | null>(null);
  const interactionRef = useRef<InteractionMode>('idle');
  const resizeHandleRef = useRef<ResizeHandle>('se');
  const widgetRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({
    clientX: 0,
    clientY: 0,
    posX: 0,
    posY: 0,
    sizeW: 0,
    sizeH: 0,
    originX: 0,
    originY: 0,
  });
  const suppressTextSelectRef = useRef(false);
  const pendingBodyDragRef = useRef<{
    clientX: number;
    clientY: number;
    posX: number;
    posY: number;
    sizeW: number;
    sizeH: number;
    originX: number;
    originY: number;
  } | null>(null);

  const isTextField = widget.type === 'text-field';
  const position = widget.position || { x: 0, y: 0 };
  const displayX = canvasOrigin.x + position.x;
  const displayY = canvasOrigin.y + position.y;
  const minWidth = isTextField
    ? TEXT_MIN_WIDTH
    : widget.type === 'pie-chart'
      ? PIE_MIN_WIDTH
      : widget.type === 'pnl-calendar'
        ? 340
        : WIDGET_MIN_WIDTH;
  const minHeight = isTextField
    ? TEXT_MIN_HEIGHT
    : widget.type === 'pie-chart'
      ? PIE_MIN_HEIGHT
      : widget.type === 'pnl-calendar'
        ? 280
        : WIDGET_MIN_HEIGHT;
  const rawSize = widget.size || { width: 340, height: 272 };
  const size =
    widget.type === 'pie-chart'
      ? {
          width: Math.max(rawSize.width, minWidth),
          height: Math.max(rawSize.height, minHeight),
        }
      : rawSize;

  useEffect(() => {
    if (!isInteracting) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isInteracting]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (interactionRef.current === 'idle' && pendingBodyDragRef.current) {
        const pending = pendingBodyDragRef.current;
        const dist = Math.hypot(e.clientX - pending.clientX, e.clientY - pending.clientY);
        if (dist < BODY_DRAG_THRESHOLD) return;
        pendingBodyDragRef.current = null;
        interactionRef.current = 'drag';
        dragStartRef.current = pending;
        setIsInteracting(true);
        clearTextSelection();
      }

      const mode = interactionRef.current;
      if (mode === 'idle') return;

      e.preventDefault();
      const el = widgetRef.current;
      if (!el) return;

      const start = dragStartRef.current;
      const z = zoomRef?.current ?? 1;
      const dx = (e.clientX - start.clientX) / z;
      const dy = (e.clientY - start.clientY) / z;

      if (mode === 'drag') {
        applyDragTranslate(el, dx, dy);
        onGroupDragLive?.(dx, dy);
        return;
      }

      const box = computeResizeBox(
        resizeHandleRef.current,
        { x: start.posX, y: start.posY, width: start.sizeW, height: start.sizeH },
        dx,
        dy,
        minWidth,
        minHeight
      );
      applyResizeBox(el, start.originX, start.originY, box.x, box.y, box.width, box.height);
    };

    const handleMouseUp = (e: MouseEvent) => {
      pendingBodyDragRef.current = null;
      const mode = interactionRef.current;
      if (mode === 'idle') return;

      interactionRef.current = 'idle';

      const el = widgetRef.current;
      const start = dragStartRef.current;
      const z = zoomRef?.current ?? 1;
      const dx = (e.clientX - start.clientX) / z;
      const dy = (e.clientY - start.clientY) / z;

      if (mode === 'drag') {
        if (el) clearDragTransform(el);
        onUpdatePosition(widget.id, { x: start.posX + dx, y: start.posY + dy });
        onGroupDragEnd?.(widget.id, dx, dy);
      } else {
        const box = computeResizeBox(
          resizeHandleRef.current,
          { x: start.posX, y: start.posY, width: start.sizeW, height: start.sizeH },
          dx,
          dy,
          minWidth,
          minHeight
        );
        if (el) pinElementBox(el, start.originX, start.originY, box.x, box.y, box.width, box.height);
        onUpdateSize(widget.id, { width: box.width, height: box.height });
        if (box.x !== start.posX || box.y !== start.posY) {
          onUpdatePosition(widget.id, { x: box.x, y: box.y });
        }
      }

      setIsInteracting(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('pointerup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('pointerup', handleMouseUp);
    };
  }, [widget.id, onUpdatePosition, onUpdateSize, onGroupDragLive, onGroupDragEnd, zoomRef, minWidth, minHeight]);

  useEffect(() => {
    const el = widgetRef.current;
    if (!el || isInteracting) return;
    if (peerOffset) applyDragTranslate(el, peerOffset.x, peerOffset.y);
    else clearDragTransform(el);
  }, [peerOffset, isInteracting]);

  const beginDragOrResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearTextSelection();
  };

  const startInteraction = (mode: InteractionMode, e: React.MouseEvent, handle?: ResizeHandle) => {
    beginDragOrResize(e);
    if (mode === 'resize' && handle) resizeHandleRef.current = handle;
    interactionRef.current = mode;
    setIsInteracting(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      posX: position.x,
      posY: position.y,
      sizeW: size.width,
      sizeH: size.height,
      originX: canvasOrigin.x,
      originY: canvasOrigin.y,
    };
  };

  const emitSelect = (e: { shiftKey: boolean }) => {
    onSelect?.({ shiftKey: e.shiftKey, keepGroup: isSelected && !e.shiftKey });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    emitSelect(e);
    startInteraction('drag', e);
  };

  const isChromeHit = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return true;
    return Boolean(el.closest('.resize-handle, button, a, input, select, textarea'));
  };

  const handleSelectOnly = (e: React.MouseEvent) => {
    if (isChromeHit(e.target)) return;
    e.stopPropagation();
    if (e.shiftKey) return;
    emitSelect(e);
  };

  const handlePointerCapture = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (isChromeHit(e.target)) return;
    if (e.shiftKey) {
      e.preventDefault();
      suppressTextSelectRef.current = true;
      clearTextSelection();
      onSelect?.({ shiftKey: true });
      return;
    }
    if (isInGroup) {
      e.preventDefault();
      suppressTextSelectRef.current = true;
      clearTextSelection();
      onSelect?.({ shiftKey: false, keepGroup: true });
      startInteraction('drag', e);
      return;
    }
    handleBodyDragCapture(e);
  };

  const handleBodyDragCapture = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.detail < 2) return;
    if (isChromeHit(e.target)) return;
    emitSelect(e);
    pendingBodyDragRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      posX: position.x,
      posY: position.y,
      sizeW: size.width,
      sizeH: size.height,
      originX: canvasOrigin.x,
      originY: canvasOrigin.y,
    };
  };

  const handleResizeStart = (handle: ResizeHandle) => (e: React.MouseEvent) => {
    if (isTextField) emitSelect(e);
    startInteraction('resize', e, handle);
  };

  const handleTextWrapperMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    e.stopPropagation();
    emitSelect(e);
  };

  const handleContextMenu = (e: ReactMouseEvent) => {
    if (!onLayerAction) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect?.({ shiftKey: false, keepGroup: true });
    setLayerMenu({ x: e.clientX, y: e.clientY });
  };

  const layerZ = typeof widget.layer === 'number' ? widget.layer : 0;

  return (
    <div
      ref={widgetRef}
      className={`absolute ${isTextField ? '' : 'group isolate'} ${isInteracting ? 'select-none' : ''}`}
      style={{
        left: `${displayX}px`,
        top: `${displayY}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
        zIndex: isInteracting ? 50_000 : isSelected ? 40_000 + layerZ : 10_000 + layerZ,
      }}
      onMouseDown={isTextField ? handleTextWrapperMouseDown : undefined}
      onMouseDownCapture={(e) => {
        stopWidgetRightClickPan(e);
        if (!isTextField) handlePointerCapture(e);
      }}
      onContextMenu={handleContextMenu}
    >
      {layerMenu && onLayerAction && (
        <WidgetLayerContextMenu
          x={layerMenu.x}
          y={layerMenu.y}
          onAction={onLayerAction}
          onClose={() => setLayerMenu(null)}
        />
      )}
      {isTextField ? (
        <div className="relative h-full w-full">
          {isSelected && (
            <div className="absolute -top-9 left-0 z-30 flex items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-900/95 px-1 py-0.5 shadow-lg">
              <div
                className="cursor-move rounded p-1 hover:bg-zinc-800"
                onMouseDown={handleMouseDown}
                title="Move"
              >
                <GripVertical className="h-3.5 w-3.5 text-zinc-400" />
              </div>
              <button
                type="button"
                onClick={() => onRemove(widget.id)}
                className="rounded p-1 hover:bg-red-500/20"
                title="Remove"
              >
                <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-400" />
              </button>
            </div>
          )}

          <div
            className={`relative h-full w-full overflow-hidden rounded-sm ${
              isSelected
                ? 'border border-zinc-600/80'
                : 'hover:ring-1 hover:ring-zinc-600/60'
            }`}
          >
            <div
              data-text-body
              className={`relative z-10 h-full w-full overflow-hidden px-1 py-1 ${isInteracting ? 'pointer-events-none' : ''}`}
            >
              {children}
            </div>
          </div>

          {isSelected && !isEditing && (
            <>
              {RESIZE_HANDLES.map(({ id, className, cursor }) => (
                <div
                  key={id}
                  className={`resize-handle absolute z-50 h-3 w-3 select-none rounded-full border-2 border-yellow-400 bg-zinc-950 ${className} ${cursor}`}
                  onMouseDown={handleResizeStart(id)}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        <>
          <Card
            className={
              'group relative h-full overflow-hidden border ' +
              (widgetHasOwnChrome(widget)
                ? 'gap-0 rounded-2xl bg-zinc-950 '
                : 'bg-zinc-900 ') +
              (isSelected
                ? 'border-zinc-600/80'
                : isPreviewSelected
                  ? 'border-yellow-400/80 shadow-[0_0_0_1px_rgba(250,204,21,0.55)]'
                  : widgetHasOwnChrome(widget)
                    ? 'border-yellow-900/40 hover:border-yellow-800/50'
                    : 'border-zinc-800 hover:border-zinc-700')
            }
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('.widget-drag-handle')) {
                handleMouseDown(e);
                return;
              }
              handleSelectOnly(e);
            }}
            onMouseUp={() => {
              suppressTextSelectRef.current = false;
            }}
            onSelectStart={(e) => {
              if (suppressTextSelectRef.current || e.shiftKey) e.preventDefault();
            }}
          >
            <button
              type="button"
              onClick={() => onRemove(widget.id)}
              className="absolute right-2 top-2 z-20 rounded p-1 opacity-0 transition-opacity hover:bg-red-500/20 group-hover:opacity-100"
              title="Remove"
            >
              <X className="h-4 w-4 text-gray-500 hover:text-red-400" />
            </button>

            <div
              className={
                'flex h-full min-h-0 flex-col overflow-hidden ' +
                (widgetHasOwnChrome(widget)
                  ? 'bg-zinc-950 p-0 '
                  : 'bg-zinc-900 p-3 ') +
                (isInteracting ? 'pointer-events-none' : '')
              }
            >
              {!widgetHasOwnChrome(widget) && (
                <h3
                  className="mb-2 shrink-0 cursor-move select-none truncate text-[17px] font-medium leading-tight text-yellow-500"
                  onMouseDown={handleMouseDown}
                  title="Drag to move"
                >
                  <span className="inline-flex max-w-full items-center gap-1.5">
                    <span className="truncate">{displayWidgetTitle(widget)}</span>
                  </span>
                </h3>
              )}
              <div className={widgetBodyClass(widget.type)}>
                {children}
              </div>
            </div>
          </Card>

          {isSelected &&
            RESIZE_HANDLES.map(({ id, className, cursor }) => (
              <div
                key={id}
                className={`resize-handle absolute z-50 h-3 w-3 select-none rounded-full border-2 border-yellow-400 bg-zinc-950 ${className} ${cursor}`}
                onMouseDown={handleResizeStart(id)}
              />
            ))}
        </>
      )}
    </div>
  );
}

export const FlexibleWidget = memo(FlexibleWidgetInner);
