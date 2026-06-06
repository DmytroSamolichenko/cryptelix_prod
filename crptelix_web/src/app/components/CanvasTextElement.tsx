import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  Bold,
  GripVertical,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Plus,
  Strikethrough,
  Underline,
  X,
} from 'lucide-react';
import { scalePx } from '../lib/uiScale';
import {
  applyDragTranslate,
  applyResizeBox,
  clearDragTransform,
  pinElementBox,
  computeResizeBox,
} from '../lib/canvasInteraction';

export interface TextElementState {
  id: string;
  text: string;
  html: string;
  fontSize: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type InteractionMode = 'idle' | 'drag' | 'resize';

const MIN_WIDTH = 120;
const MIN_HEIGHT = 48;
export const DEFAULT_FONT_SIZE = scalePx(14);
const FONT_SIZE_OPTIONS = [10, 12, 14, 16, 18, 20, 24, 32].map((n) => scalePx(n));
const SAVE_DEBOUNCE_MS = 400;

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
  zoomRef?: MutableRefObject<number>;
  canvasOrigin?: { x: number; y: number };
  onSelect: () => void;
  onStartEdit: () => void;
  onEndEdit: () => void;
  onUpdate: (element: TextElementState) => void;
  onRemove?: (id: string) => void;
}

function htmlToPlainText(html: string): string {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? div.innerText ?? '').trim();
}

function isHtmlEmpty(html: string): boolean {
  return htmlToPlainText(html).length === 0;
}

function clearTextSelection() {
  window.getSelection()?.removeAllRanges();
}

function execFormat(command: string, value?: string) {
  document.execCommand(command, false, value);
}

function stripNestedFontSizes(root: HTMLElement) {
  root.querySelectorAll('[style*="font-size"]').forEach((node) => {
    (node as HTMLElement).style.removeProperty('font-size');
  });
}

function applyFontSizeToSelection(fontSize: number) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  if (range.collapsed) return;

  const span = document.createElement('span');
  span.style.fontSize = `${fontSize}px`;
  try {
    range.surroundContents(span);
  } catch {
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }
  selection.removeAllRanges();
  const next = document.createRange();
  next.selectNodeContents(span);
  selection.addRange(next);
}

function applyFontSizeToBlock(el: HTMLElement, fontSize: number) {
  el.style.fontSize = `${fontSize}px`;
  stripNestedFontSizes(el);
}

function nearestFontSize(size: number): number {
  return FONT_SIZE_OPTIONS.reduce((prev, curr) =>
    Math.abs(curr - size) < Math.abs(prev - size) ? curr : prev
  );
}

function TextFormatToolbar({
  fontSize,
  onFontSizeChange,
  onFormat,
  onInsertLink,
}: {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  onFormat: (command: string) => void;
  onInsertLink: () => void;
}) {
  const currentIndex = FONT_SIZE_OPTIONS.indexOf(fontSize);
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex >= 0 && currentIndex < FONT_SIZE_OPTIONS.length - 1;

  return (
    <div
      className="text-format-toolbar absolute left-0 top-full z-50 mt-2 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900/95 px-1.5 py-1 shadow-xl backdrop-blur-sm"
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        title="Decrease font size"
        disabled={!canDecrease}
        onClick={() => canDecrease && onFontSizeChange(FONT_SIZE_OPTIONS[currentIndex - 1])}
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <select
        value={fontSize}
        onChange={(e) => onFontSizeChange(Number(e.target.value))}
        className="h-7 max-w-[52px] cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-1 text-xs text-zinc-200 outline-none"
        title="Font size"
      >
        {FONT_SIZE_OPTIONS.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>

      <button
        type="button"
        title="Increase font size"
        disabled={!canIncrease}
        onClick={() => canIncrease && onFontSizeChange(FONT_SIZE_OPTIONS[currentIndex + 1])}
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>

      <div className="mx-0.5 h-5 w-px bg-zinc-700" />

      <ToolbarButton title="Bold" onClick={() => onFormat('bold')}>
        <Bold className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Italic" onClick={() => onFormat('italic')}>
        <Italic className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Underline" onClick={() => onFormat('underline')}>
        <Underline className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Strikethrough" onClick={() => onFormat('strikeThrough')}>
        <Strikethrough className="h-3.5 w-3.5" />
      </ToolbarButton>

      <div className="mx-0.5 h-5 w-px bg-zinc-700" />

      <ToolbarButton title="Bullet list" onClick={() => onFormat('insertUnorderedList')}>
        <List className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Numbered list" onClick={() => onFormat('insertOrderedList')}>
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarButton>
      <ToolbarButton title="Link" onClick={onInsertLink}>
        <Link2 className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  title,
  onClick,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
    >
      {children}
    </button>
  );
}

export function CanvasTextElement({
  element,
  isSelected,
  isEditing,
  zoomRef,
  canvasOrigin = { x: 0, y: 0 },
  onSelect,
  onStartEdit,
  onEndEdit,
  onUpdate,
  onRemove,
}: CanvasTextElementProps) {
  const { id, text, html, fontSize, x, y, width, height } = element;

  const [isInteracting, setIsInteracting] = useState(false);
  const interactionRef = useRef<InteractionMode>('idle');
  const editableRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const pendingCommandRef = useRef<string | null>(null);
  const pendingLinkRef = useRef(false);
  const resizeHandleRef = useRef<ResizeHandle>('se');
  const dragStartRef = useRef({
    clientX: 0,
    clientY: 0,
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    originX: 0,
    originY: 0,
  });

  const displayX = canvasOrigin.x + x;
  const displayY = canvasOrigin.y + y;
  const isEmpty = isHtmlEmpty(html) && !text.trim();
  const normalizedFontSize = nearestFontSize(fontSize);
  const [showPlaceholder, setShowPlaceholder] = useState(isEmpty);

  useEffect(() => {
    if (isEditing) {
      setShowPlaceholder(isEmpty);
    }
  }, [isEditing, isEmpty]);

  const buildState = useCallback(
    (nextHtml: string, nextFontSize = normalizedFontSize): TextElementState => ({
      id,
      html: nextHtml,
      text: htmlToPlainText(nextHtml),
      fontSize: nextFontSize,
      x,
      y,
      width,
      height,
    }),
    [id, normalizedFontSize, x, y, width, height]
  );

  const commitText = useCallback(
    (endEdit: boolean) => {
      const el = editableRef.current;
      const nextHtml = el?.innerHTML ?? html;
      onUpdate(buildState(nextHtml));
      if (endEdit) onEndEdit();
    },
    [buildState, html, onEndEdit, onUpdate]
  );

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => commitText(false), SAVE_DEBOUNCE_MS);
  }, [commitText]);

  useEffect(() => {
    if (!isEditing || !editableRef.current) return;
    const el = editableRef.current;
    el.innerHTML = html || '';
    applyFontSizeToBlock(el, normalizedFontSize);
    setShowPlaceholder(isHtmlEmpty(el.innerHTML));
    el.focus();

    if (pendingCommandRef.current) {
      execFormat(pendingCommandRef.current);
      pendingCommandRef.current = null;
      scheduleSave();
    } else if (pendingLinkRef.current) {
      pendingLinkRef.current = false;
      const url = window.prompt('Enter link URL');
      if (url?.trim()) {
        execFormat('createLink', url.trim());
        scheduleSave();
      }
    } else {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  }, [isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => window.clearTimeout(saveTimerRef.current);
  }, []);

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
      const el = rootRef.current;
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
        { x: start.x, y: start.y, width: start.width, height: start.height },
        dx,
        dy,
        MIN_WIDTH,
        MIN_HEIGHT
      );
      applyResizeBox(el, start.originX, start.originY, box.x, box.y, box.width, box.height);
    };

    const handleMouseUp = (e: MouseEvent) => {
      const mode = interactionRef.current;
      if (mode === 'idle') return;

      interactionRef.current = 'idle';

      const el = rootRef.current;
      const start = dragStartRef.current;
      const z = zoomRef?.current ?? 1;
      const dx = (e.clientX - start.clientX) / z;
      const dy = (e.clientY - start.clientY) / z;

      if (mode === 'drag') {
        if (el) clearDragTransform(el);
        onUpdate({
          id,
          text,
          html,
          fontSize: normalizedFontSize,
          x: start.x + dx,
          y: start.y + dy,
          width,
          height,
        });
      } else {
        const box = computeResizeBox(
          resizeHandleRef.current,
          { x: start.x, y: start.y, width: start.width, height: start.height },
          dx,
          dy,
          MIN_WIDTH,
          MIN_HEIGHT
        );
        if (el) pinElementBox(el, start.originX, start.originY, box.x, box.y, box.width, box.height);
        onUpdate({
          id,
          text,
          html,
          fontSize: normalizedFontSize,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
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
  }, [id, text, html, normalizedFontSize, width, height, onUpdate, zoomRef]);

  const beginPointerAction = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    clearTextSelection();
  };

  const startInteraction = (mode: InteractionMode, e: React.MouseEvent, handle?: ResizeHandle) => {
    beginPointerAction(e);
    onSelect();
    if (mode === 'resize' && handle) resizeHandleRef.current = handle;
    interactionRef.current = mode;
    setIsInteracting(true);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x,
      y,
      width,
      height,
      originX: canvasOrigin.x,
      originY: canvasOrigin.y,
    };
  };

  const handleDragStart = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.resize-handle')) return;
    startInteraction('drag', e);
  };

  const handleResizeStart = (handle: ResizeHandle) => (e: React.MouseEvent) => {
    startInteraction('resize', e, handle);
  };

  const handleActivate = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
    onStartEdit();
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!isEditing) return;
    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest('.text-format-toolbar')) return;
    window.clearTimeout(saveTimerRef.current);
    commitText(true);
  };

  const handleInput = () => {
    const el = editableRef.current;
    setShowPlaceholder(!el || isHtmlEmpty(el.innerHTML));
    scheduleSave();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (editableRef.current) editableRef.current.innerHTML = html;
      setShowPlaceholder(isHtmlEmpty(html));
      window.clearTimeout(saveTimerRef.current);
      onEndEdit();
    }
  };

  const handleFormat = (command: string) => {
    if (!isEditing) {
      pendingCommandRef.current = command;
      onStartEdit();
      return;
    }
    editableRef.current?.focus();
    execFormat(command);
    scheduleSave();
  };

  const handleFontSizeChange = (size: number) => {
    const el = editableRef.current;

    if (isEditing && el) {
      el.focus();
      const selection = window.getSelection();
      const hasSelection =
        selection &&
        selection.rangeCount > 0 &&
        el.contains(selection.anchorNode ?? null) &&
        !selection.getRangeAt(0).collapsed;

      if (hasSelection) {
        applyFontSizeToSelection(size);
      } else {
        applyFontSizeToBlock(el, size);
      }
      onUpdate(buildState(el.innerHTML, size));
      scheduleSave();
      return;
    }

    onUpdate({ id, text, html, fontSize: size, x, y, width, height });
  };

  const handleInsertLink = () => {
    if (!isEditing) {
      pendingLinkRef.current = true;
      onStartEdit();
      return;
    }
    editableRef.current?.focus();
    const url = window.prompt('Enter link URL');
    if (url?.trim()) {
      execFormat('createLink', url.trim());
      scheduleSave();
    }
  };

  const contentStyle = {
    fontSize: `${normalizedFontSize}px`,
    lineHeight: 1.5,
    fontWeight: 400,
    fontFamily: 'inherit',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    caretColor: '#facc15',
  };

  return (
    <div
      ref={rootRef}
      className={`absolute ${isInteracting ? 'z-50 select-none' : isSelected ? 'z-40' : 'z-10'}`}
      style={{
        left: `${displayX}px`,
        top: `${displayY}px`,
        width: `${width}px`,
        height: `${height}px`,
      }}
    >
      {isSelected && (
        <div className="absolute -top-9 left-0 z-50 flex items-center gap-0.5 rounded-md border border-zinc-700 bg-zinc-900/95 px-1 py-0.5 shadow-lg">
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
        className={`relative h-full w-full overflow-hidden rounded-sm ${
          isSelected
            ? 'ring-2 ring-yellow-400/90 ring-offset-2 ring-offset-zinc-950'
            : 'hover:ring-1 hover:ring-zinc-600/60'
        }`}
      >
        {isEditing ? (
          <>
            <div
              ref={editableRef}
              contentEditable
              suppressContentEditableWarning
              onBlur={handleBlur}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              onMouseDown={(e) => e.stopPropagation()}
              className="canvas-text-editable widget-scrollbar relative z-10 h-full w-full overflow-y-auto px-2 py-1.5 text-gray-300 outline-none"
              style={contentStyle}
            />
            {showPlaceholder && (
              <div
                className="pointer-events-none absolute inset-0 z-0 px-2 py-1.5 text-zinc-500"
                style={contentStyle}
                aria-hidden
              >
                Type something
              </div>
            )}
          </>
        ) : (
          <div
            className={`canvas-text-display relative h-full w-full overflow-hidden px-2 py-1.5 ${
              isSelected ? 'cursor-text' : 'cursor-default'
            } ${isEmpty ? 'text-zinc-500' : 'text-gray-300'}`}
            style={contentStyle}
            onMouseDown={handleActivate}
          >
            {isEmpty ? (
              'Type something'
            ) : (
              <div dangerouslySetInnerHTML={{ __html: html || text }} />
            )}
          </div>
        )}
      </div>

      {isSelected && (
        <>
          <div className="pointer-events-none absolute inset-0 rounded-sm border border-yellow-400/50" />
          {RESIZE_HANDLES.map(({ id: handleId, className, cursor }) => (
            <div
              key={handleId}
              className={`resize-handle absolute z-50 h-3 w-3 select-none rounded-full border-2 border-yellow-400 bg-zinc-950 ${className} ${cursor}`}
              onMouseDown={handleResizeStart(handleId)}
            />
          ))}
          <TextFormatToolbar
            fontSize={normalizedFontSize}
            onFontSizeChange={handleFontSizeChange}
            onFormat={handleFormat}
            onInsertLink={handleInsertLink}
          />
        </>
      )}
    </div>
  );
}
