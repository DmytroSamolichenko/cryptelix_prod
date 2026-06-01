import { useEffect, useRef, useState } from 'react';
import { GripVertical, X } from 'lucide-react';

export interface TextElementState {
  id: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_WIDTH = 80;
const MIN_HEIGHT = 40;
const DEFAULT_FONT_SIZE = 24;

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

export interface CanvasTextElementProps {
  element: TextElementState;
  isSelected: boolean;
  isEditing: boolean;
  zoom?: number;
  canvasOrigin?: { x: number; y: number };
  onSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onUpdate: (element: TextElementState) => void;
  onRemove?: (id: string) => void;
}

function clearTextSelection() {
  window.getSelection()?.removeAllRanges();
}

export function CanvasTextElement({
  element,
  isSelected,
  isEditing,
  zoom = 1,
  canvasOrigin = { x: 0, y: 0 },
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdate,
  onRemove,
}: CanvasTextElementProps) {
  const { id, text, x, y, width, height } = element;

  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const editableRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<ResizeHandle>('se');
  const dragStartRef = useRef({
    clientX: 0,
    clientY: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  });

  const displayX = canvasOrigin.x + x;
  const displayY = canvasOrigin.y + y;

  useEffect(() => {
    if (!isEditing || !editableRef.current) return;
    const el = editableRef.current;
    el.innerText = text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [isEditing, text]);

  useEffect(() => {
    const applyResize = (handle: ResizeHandle, dx: number, dy: number) => {
      const start = dragStartRef.current;
      let newW = start.width;
      let newH = start.height;
      let newX = start.x;
      let newY = start.y;

      if (handle.includes('e')) newW = start.width + dx;
      if (handle.includes('w')) {
        newW = start.width - dx;
        newX = start.x + dx;
      }
      if (handle.includes('s')) newH = start.height + dy;
      if (handle.includes('n')) {
        newH = start.height - dy;
        newY = start.y + dy;
      }

      if (newW < MIN_WIDTH) {
        if (handle.includes('w')) newX = start.x + start.width - MIN_WIDTH;
        newW = MIN_WIDTH;
      }
      if (newH < MIN_HEIGHT) {
        if (handle.includes('n')) newY = start.y + start.height - MIN_HEIGHT;
        newH = MIN_HEIGHT;
      }

      onUpdate({ id, text, x: newX, y: newY, width: newW, height: newH });
    };

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();
      const start = dragStartRef.current;
      const dx = (e.clientX - start.clientX) / zoom;
      const dy = (e.clientY - start.clientY) / zoom;

      if (isDragging) {
        onUpdate({
          id,
          text,
          x: start.x + dx,
          y: start.y + dy,
          width,
          height,
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
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.body.style.userSelect = prevUserSelect;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, id, text, width, height, onUpdate, zoom]);

  const beginPointerAction = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearTextSelection();
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if (isEditing) return;
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    beginPointerAction(e);
    onSelect();
    setIsDragging(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x,
      y,
      width,
      height,
    };
  };

  const handleResizeStart = (handle: ResizeHandle) => (e: React.MouseEvent) => {
    if (isEditing) return;
    beginPointerAction(e);
    onSelect();
    resizeHandleRef.current = handle;
    setIsResizing(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x,
      y,
      width,
      height,
    };
  };

  const commitText = () => {
    const next = editableRef.current?.innerText ?? text;
    const trimmed = next.replace(/\n$/, '');
    onUpdate({ id, text: trimmed, x, y, width, height });
    onEndEdit();
  };

  const handleBlur = () => {
    if (!isEditing) return;
    commitText();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editableRef.current) editableRef.current.innerText = text;
      onEndEdit();
    }
  };

  const displayText = text.trim() || 'Double-click to edit';

  return (
    <div
      className={`absolute ${isDragging || isResizing ? 'z-50 select-none' : isSelected ? 'z-40' : 'z-10'}`}
      style={{
        left: `${displayX}px`,
        top: `${displayY}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
      onMouseDown={(e) => {
        if (isEditing) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onSelect();
        onStartEdit();
      }}
    >
      {isSelected && (
        <div className="absolute -top-9 left-0 z-30 flex items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-900/95 px-1 py-0.5 shadow-lg">
          <div
            className="cursor-move rounded p-1 hover:bg-zinc-800"
            onMouseDown={handleDragStart}
            title="Move"
          >
            <GripVertical className="h-3.5 w-3.5 text-zinc-400" />
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(id)}
              className="rounded p-1 hover:bg-red-500/20"
              title="Remove"
            >
              <X className="h-3.5 w-3.5 text-zinc-400 hover:text-red-400" />
            </button>
          )}
        </div>
      )}

      <div
        className={`relative h-full w-full rounded-sm transition-shadow ${
          isSelected
            ? 'ring-2 ring-yellow-400/90 ring-offset-2 ring-offset-zinc-950'
            : 'hover:ring-1 hover:ring-zinc-600/60'
        }`}
      >
        {isEditing ? (
          <div
            ref={editableRef}
            contentEditable
            suppressContentEditableWarning
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onMouseDown={(e) => e.stopPropagation()}
            className="h-full w-full overflow-hidden break-words px-1 py-1 text-white outline-none"
            style={{
              fontSize: `${DEFAULT_FONT_SIZE}px`,
              lineHeight: 1.35,
              fontWeight: 500,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              caretColor: '#facc15',
            }}
          />
        ) : (
          <div
            className={`h-full w-full overflow-hidden break-words px-1 py-1 ${
              isSelected ? 'cursor-text' : 'cursor-default'
            } ${!text.trim() ? 'text-zinc-500' : 'text-white'}`}
            style={{
              fontSize: `${DEFAULT_FONT_SIZE}px`,
              lineHeight: 1.35,
              fontWeight: 500,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            onMouseDown={handleDragStart}
          >
            {displayText}
          </div>
        )}

        {isSelected && !isEditing && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-sm border border-yellow-400/50" />
            {RESIZE_HANDLES.map(({ id: handleId, className, cursor }) => (
              <div
                key={handleId}
                className={`resize-handle absolute z-20 h-2.5 w-2.5 select-none rounded-full border-2 border-yellow-400 bg-zinc-950 ${className} ${cursor}`}
                onMouseDown={handleResizeStart(handleId)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
