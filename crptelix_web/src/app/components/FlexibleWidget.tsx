import { useState, useRef, useEffect } from 'react';
import { GripVertical, X } from 'lucide-react';
import { Widget } from './DashboardWidget';
import { Card } from './ui/card';
import { motion } from 'motion/react';

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const TEXT_MIN_WIDTH = 80;
const TEXT_MIN_HEIGHT = 40;
const WIDGET_MIN_WIDTH = 280;
const WIDGET_MIN_HEIGHT = 200;

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
  zoom?: number;
  isSelected?: boolean;
  isEditing?: boolean;
  onSelect?: () => void;
  children: React.ReactNode;
}

export function FlexibleWidget({
  widget,
  onRemove,
  onUpdatePosition,
  onUpdateSize,
  canvasOrigin = { x: 0, y: 0 },
  zoom = 1,
  isSelected = false,
  isEditing = false,
  onSelect,
  children,
}: FlexibleWidgetProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandleRef = useRef<ResizeHandle>('se');
  const dragStartRef = useRef({
    clientX: 0,
    clientY: 0,
    posX: 0,
    posY: 0,
    sizeW: 0,
    sizeH: 0,
  });
  const widgetRef = useRef<HTMLDivElement>(null);

  const isTextField = widget.type === 'text-field';
  const position = widget.position || { x: 0, y: 0 };
  const size = widget.size || { width: 400, height: 320 };
  const displayX = canvasOrigin.x + position.x;
  const displayY = canvasOrigin.y + position.y;
  const minWidth = isTextField ? TEXT_MIN_WIDTH : WIDGET_MIN_WIDTH;
  const minHeight = isTextField ? TEXT_MIN_HEIGHT : WIDGET_MIN_HEIGHT;

  const beginDragOrResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearTextSelection();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    beginDragOrResize(e);
    if (isTextField) onSelect?.();

    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      posX: position.x,
      posY: position.y,
      sizeW: size.width,
      sizeH: size.height,
    };
  };

  const handleResizeStart = (handle: ResizeHandle) => (e: React.MouseEvent) => {
    beginDragOrResize(e);
    if (isTextField) onSelect?.();
    resizeHandleRef.current = handle;
    setIsResizing(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      posX: position.x,
      posY: position.y,
      sizeW: size.width,
      sizeH: size.height,
    };
  };

  useEffect(() => {
    const applyResize = (handle: ResizeHandle, dx: number, dy: number) => {
      const start = dragStartRef.current;
      let newW = start.sizeW;
      let newH = start.sizeH;
      let newX = start.posX;
      let newY = start.posY;

      if (handle.includes('e')) newW = start.sizeW + dx;
      if (handle.includes('w')) {
        newW = start.sizeW - dx;
        newX = start.posX + dx;
      }
      if (handle.includes('s')) newH = start.sizeH + dy;
      if (handle.includes('n')) {
        newH = start.sizeH - dy;
        newY = start.posY + dy;
      }

      if (newW < minWidth) {
        if (handle.includes('w')) newX = start.posX + start.sizeW - minWidth;
        newW = minWidth;
      }
      if (newH < minHeight) {
        if (handle.includes('n')) newY = start.posY + start.sizeH - minHeight;
        newH = minHeight;
      }

      onUpdateSize(widget.id, { width: newW, height: newH });
      if (newX !== start.posX || newY !== start.posY) {
        onUpdatePosition(widget.id, { x: newX, y: newY });
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const start = dragStartRef.current;
      const dx = (e.clientX - start.clientX) / zoom;
      const dy = (e.clientY - start.clientY) / zoom;

      if (isDragging) {
        onUpdatePosition(widget.id, {
          x: start.posX + dx,
          y: start.posY + dy,
        });
      } else if (isResizing) {
        applyResize(resizeHandleRef.current, dx, dy);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
    };

    if (isDragging || isResizing) {
      const prevUserSelect = document.body.style.userSelect;
      const prevWebkitUserSelect = document.body.style.webkitUserSelect;
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.body.style.userSelect = prevUserSelect;
        document.body.style.webkitUserSelect = prevWebkitUserSelect;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [
    isDragging,
    isResizing,
    widget.id,
    onUpdatePosition,
    onUpdateSize,
    zoom,
    isTextField,
    minWidth,
    minHeight,
  ]);

  const handleTextWrapperMouseDown = (e: React.MouseEvent) => {
    if (isEditing) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    e.stopPropagation();
    onSelect?.();
  };

  return (
    <motion.div
      ref={widgetRef}
      layout={false}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`absolute ${isDragging || isResizing ? 'z-50 select-none' : isSelected ? 'z-40' : 'z-10'}`}
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
                title="Перемістити"
              >
                <GripVertical className="h-3.5 w-3.5 text-zinc-400" />
              </div>
              <button
                type="button"
                onClick={() => onRemove(widget.id)}
                className="rounded p-1 hover:bg-red-500/20"
                title="Видалити"
              >
                <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-400" />
              </button>
            </div>
          )}

          <div
            className={`relative h-full w-full rounded-sm transition-shadow ${
              isSelected
                ? 'ring-2 ring-yellow-400/90 ring-offset-2 ring-offset-zinc-950'
                : 'hover:ring-1 hover:ring-zinc-600/60'
            }`}
          >
            <div
              data-text-body
              className="relative z-10 h-full w-full overflow-hidden px-1 py-1 [contain:layout]"
            >
              {children}
            </div>

            {isSelected && !isEditing && (
              <>
                <div className="pointer-events-none absolute inset-0 rounded-sm border border-yellow-400/50" />
                {RESIZE_HANDLES.map(({ id, className, cursor }) => (
                  <div
                    key={id}
                    className={`resize-handle absolute z-20 h-2.5 w-2.5 select-none rounded-full border-2 border-yellow-400 bg-zinc-950 ${className} ${cursor}`}
                    onMouseDown={handleResizeStart(id)}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      ) : (
        <Card className="group h-full border border-zinc-800 bg-zinc-900/95 transition-colors hover:border-zinc-700">
          <div
            className="absolute left-0 right-0 top-0 z-20 flex h-10 cursor-move items-center px-3 bg-gradient-to-b from-zinc-900/80 to-transparent opacity-0 transition-opacity group-hover:opacity-100"
            onMouseDown={handleMouseDown}
          >
            <GripVertical className="h-4 w-4 text-gray-500" />
          </div>

          <button
            type="button"
            onClick={() => onRemove(widget.id)}
            className="absolute right-2 top-2 z-20 rounded bg-zinc-900/80 p-1 opacity-0 transition-opacity hover:bg-zinc-800 group-hover:opacity-100"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>

          <div className="flex h-full min-h-0 flex-col overflow-hidden p-4 [contain:layout]">
            <h3 className="mb-3 shrink-0 truncate text-sm font-semibold text-white">{widget.title}</h3>
            <div
              className={
                widget.type === 'line-chart' ||
                widget.type === 'bar-chart' ||
                widget.type === 'stats-card' ||
                widget.type === 'table'
                  ? 'min-h-0 min-w-0 flex-1 overflow-hidden [contain:layout]'
                  : 'flex-1 overflow-hidden [contain:layout]'
              }
            >
              {children}
            </div>
          </div>

          {RESIZE_HANDLES.map(({ id, className, cursor }) => (
            <div
              key={id}
              className={`resize-handle absolute z-30 h-2.5 w-2.5 select-none rounded-full border-2 border-zinc-500 bg-zinc-900 opacity-0 transition-opacity group-hover:opacity-100 ${className} ${cursor}`}
              onMouseDown={handleResizeStart(id)}
            />
          ))}
        </Card>
      )}
    </motion.div>
  );
}
