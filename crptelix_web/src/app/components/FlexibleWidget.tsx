import { memo, useRef, useEffect, useState, type MutableRefObject } from 'react';
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

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type InteractionMode = 'idle' | 'drag' | 'resize';

const TEXT_MIN_WIDTH = 80;
const TEXT_MIN_HEIGHT = 40;
const WIDGET_MIN_WIDTH = 238;
const WIDGET_MIN_HEIGHT = 170;

/** Chart widgets need a fixed viewport; others scroll when content exceeds the box. */
function widgetBodyClass(type: Widget['type']): string {
  if (type === 'line-chart' || type === 'bar-chart') {
    return 'min-h-0 min-w-0 flex-1 overflow-hidden';
  }
  return 'widget-scrollbar min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto pr-0.5';
}

function clearTextSelection() {
  window.getSelection()?.removeAllRanges();
}

const RESIZE_HANDLES: { id: ResizeHandle; className: string; cursor: string }[] = [
  { id: 'nw', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nw-resize' },
  { id: 'n', className: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-n-resize' },
  { id: 'ne', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ne-resize' },
  { id: 'e', className: 'top-1/2 right-0 translate-x-1/2 -translate-y-1/2', cursor: 'cursor-e-resize' },
  { id: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'cursor-se-resize' },
  { id: 's', className: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-s-resize' },
  { id: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-sw-resize' },
  { id: 'w', className: 'top-1/2 left-0 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-w-resize' },
];

interface FlexibleWidgetProps {
  widget: Widget;
  onRemove: (id: string) => void;
  onUpdatePosition: (id: string, position: { x: number; y: number }) => void;
  onUpdateSize: (id: string, size: { width: number; height: number }) => void;
  canvasOrigin?: { x: number; y: number };
  zoomRef?: MutableRefObject<number>;
  isSelected?: boolean;
  isEditing?: boolean;
  onSelect?: () => void;
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
  isEditing = false,
  onSelect,
  children,
}: FlexibleWidgetProps) {
  const [isInteracting, setIsInteracting] = useState(false);
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

  const isTextField = widget.type === 'text-field';
  const position = widget.position || { x: 0, y: 0 };
  const size = widget.size || { width: 340, height: 272 };
  const displayX = canvasOrigin.x + position.x;
  const displayY = canvasOrigin.y + position.y;
  const minWidth = isTextField ? TEXT_MIN_WIDTH : WIDGET_MIN_WIDTH;
  const minHeight = isTextField ? TEXT_MIN_HEIGHT : WIDGET_MIN_HEIGHT;

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
  }, [widget.id, onUpdatePosition, onUpdateSize, zoomRef, minWidth, minHeight]);

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

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    onSelect?.();
    startInteraction('drag', e);
  };

  const handleSelectOnly = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    e.stopPropagation();
    onSelect?.();
  };

  const handleResizeStart = (handle: ResizeHandle) => (e: React.MouseEvent) => {
    if (isTextField) onSelect?.();
    startInteraction('resize', e, handle);
  };

  const handleTextWrapperMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    e.stopPropagation();
    onSelect?.();
  };

  return (
    <div
      ref={widgetRef}
      className={`absolute ${isTextField ? '' : 'group isolate'} ${isInteracting ? 'z-50 select-none' : isSelected ? 'z-40' : 'z-10'}`}
      style={{
        left: `${displayX}px`,
        top: `${displayY}px`,
        width: `${size.width}px`,
        height: `${size.height}px`,
      }}
      onMouseDown={isTextField ? handleTextWrapperMouseDown : undefined}
    >
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
            className={`relative h-full w-full rounded-sm ${
              isSelected
                ? 'ring-2 ring-yellow-400/90 ring-offset-2 ring-offset-zinc-950'
                : 'hover:ring-1 hover:ring-zinc-600/60'
            }`}
          >
            <div
              data-text-body
              className={`relative z-10 h-full w-full overflow-hidden px-1 py-1 ${isInteracting ? 'pointer-events-none' : ''}`}
            >
              {children}
            </div>

            {isSelected && !isEditing && (
              <>
                <div className="pointer-events-none absolute inset-0 rounded-sm border border-yellow-400/50" />
              </>
            )}
          </div>

          {isSelected && !isEditing && (
            <>
              {RESIZE_HANDLES.map(({ id, className, cursor }) => (
                <div
                  key={id}
                  className={`resize-handle absolute z-50 h-2.5 w-2.5 select-none rounded-full border-2 border-yellow-400 bg-zinc-950 ${className} ${cursor}`}
                  onMouseDown={handleResizeStart(id)}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        <>
          <Card
            className={`group h-full overflow-hidden border bg-zinc-900 ${
              isSelected
                ? 'border-yellow-400/70 ring-2 ring-yellow-400/90 ring-offset-2 ring-offset-zinc-950'
                : 'border-zinc-800 hover:border-zinc-700'
            }`}
            onMouseDown={handleSelectOnly}
          >
            <div
              className="absolute left-0 right-0 top-0 z-20 flex h-10 cursor-move items-center px-3 bg-gradient-to-b from-zinc-900 to-zinc-900/95 opacity-0 transition-opacity group-hover:opacity-100"
              onMouseDown={handleMouseDown}
            >
              <GripVertical className="h-4 w-4 text-gray-500" />
            </div>

            <button
              type="button"
              onClick={() => onRemove(widget.id)}
              className="absolute right-2 top-2 z-20 rounded bg-zinc-900 p-1 opacity-0 transition-opacity hover:bg-zinc-800 group-hover:opacity-100"
            >
              <X className="h-4 w-4 text-gray-500" />
            </button>

            <div
              className={`flex h-full min-h-0 flex-col overflow-hidden bg-zinc-900 p-3 ${isInteracting ? 'pointer-events-none' : ''}`}
            >
              <h3 className="mb-2 shrink-0 truncate text-sm font-semibold text-white">{widget.title}</h3>
              <div className={widgetBodyClass(widget.type)}>
                {children}
              </div>
            </div>
          </Card>

          {RESIZE_HANDLES.map(({ id, className, cursor }) => (
            <div
              key={id}
              className={`resize-handle absolute z-50 h-3 w-3 select-none rounded-full border-2 bg-zinc-900 ${
                isSelected
                  ? 'border-yellow-400 opacity-100'
                  : 'border-zinc-500 opacity-0 transition-opacity group-hover:opacity-100'
              } ${className} ${cursor}`}
              onMouseDown={handleResizeStart(id)}
            />
          ))}
        </>
      )}
    </div>
  );
}

export const FlexibleWidget = memo(FlexibleWidgetInner);
