import { useCallback, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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
  Unlink,
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
/** Logical sizes shown in the toolbar; stored values are scalePx(logical). */
const FONT_SIZE_LOGICAL = [10, 12, 14, 16, 18, 20, 24, 32] as const;
const FONT_SIZE_OPTIONS = FONT_SIZE_LOGICAL.map((n) => scalePx(n));
const SAVE_DEBOUNCE_MS = 400;

const RESIZE_HANDLES: { id: ResizeHandle; className: string; cursor: string }[] = [
  { id: 'nw', className: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-nw-resize' },
  { id: 'ne', className: 'top-0 right-0 translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ne-resize' },
  { id: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2', cursor: 'cursor-se-resize' },
  { id: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-sw-resize' },
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

function normalizeLinkUrl(raw: string): string {
  const url = raw.trim();
  if (!url) return '';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url;
  return `https://${url}`;
}

type SelectionSnapshot = {
  start: number;
  end: number;
  text: string;
};

function getNodeTextOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return total + targetOffset;
    total += node.textContent?.length ?? 0;
  }

  // Element boundary: count text before this element within root.
  if (targetNode.nodeType === Node.ELEMENT_NODE) {
    const walker2 = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker2.nextNode())) {
      if (!targetNode.contains(n) && !(targetNode.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        total = 0;
      }
    }
    const pre = document.createRange();
    pre.selectNodeContents(root);
    try {
      pre.setEnd(targetNode, Math.min(targetOffset, targetNode.childNodes.length));
      return pre.toString().length;
    } catch {
      return 0;
    }
  }
  return total;
}

function snapshotSelection(container: HTMLElement): SelectionSnapshot | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;

  const start = getNodeTextOffset(container, range.startContainer, range.startOffset);
  const end = getNodeTextOffset(container, range.endContainer, range.endOffset);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
    text: range.toString().replace(/\u00a0/g, ' '),
  };
}

function rangeFromSnapshot(container: HTMLElement, snap: SelectionSnapshot): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let remainingStart = snap.start;
  let remainingEnd = snap.end;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const text = node as Text;
    const len = text.data.length;

    if (!startNode) {
      if (remainingStart <= len) {
        startNode = text;
        startOffset = remainingStart;
      } else {
        remainingStart -= len;
      }
    }

    if (!endNode) {
      if (remainingEnd <= len) {
        endNode = text;
        endOffset = remainingEnd;
        break;
      }
      remainingEnd -= len;
    } else if (startNode) {
      break;
    }
  }

  if (!startNode) {
    // Empty editor or caret at very end with no text nodes
    const range = document.createRange();
    range.selectNodeContents(container);
    range.collapse(snap.start === 0);
    if (snap.start > 0) range.collapse(false);
    return range;
  }
  if (!endNode) {
    endNode = startNode;
    endOffset = startNode.data.length;
  }

  const range = document.createRange();
  range.setStart(startNode, Math.min(startOffset, startNode.data.length));
  range.setEnd(endNode, Math.min(endOffset, endNode.data.length));
  return range;
}

function restoreSnapshot(container: HTMLElement, snap: SelectionSnapshot | null): Range | null {
  if (!snap) return null;
  const range = rangeFromSnapshot(container, snap);
  if (!range) return null;
  const sel = window.getSelection();
  if (!sel) return range;
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

function findAnchorForSnapshot(container: HTMLElement, snap: SelectionSnapshot | null): HTMLAnchorElement | null {
  if (!snap) return null;
  const range = rangeFromSnapshot(container, snap);
  if (!range) return null;

  const startEl = (
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement
  ) as HTMLElement | null;
  const anchor = startEl?.closest?.('a') as HTMLAnchorElement | null;
  if (!anchor || !container.contains(anchor)) return null;

  // Caret inside the link → edit/remove that link
  if (snap.start === snap.end) return anchor;

  // Only treat as editing that link if the selection is the whole linked text
  const full = (anchor.textContent ?? '').replace(/\u00a0/g, ' ').trim();
  if (snap.text.trim() === full) return anchor;

  return null;
}

function decorateAnchorsInRange(container: HTMLElement, range: Range, href: string) {
  const anchors = [...container.querySelectorAll('a')];
  for (const anchor of anchors) {
    const ar = document.createRange();
    ar.selectNodeContents(anchor);
    const intersects =
      range.compareBoundaryPoints(Range.END_TO_START, ar) < 0 &&
      range.compareBoundaryPoints(Range.START_TO_END, ar) > 0;
    if (!intersects) continue;
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  }
}

/** Wrap only the selected range in a link (or insert at caret). */
function applyLinkInEditable(
  container: HTMLElement,
  rawUrl: string,
  displayText: string,
  snap: SelectionSnapshot | null,
  existingAnchor: HTMLAnchorElement | null
): boolean {
  const href = normalizeLinkUrl(rawUrl);
  if (!href) return false;

  container.focus();

  // Edit existing link only when caret is inside it, or the selection is exactly that link's text
  if (existingAnchor && container.contains(existingAnchor)) {
    const isCaret = !snap || snap.start === snap.end;
    const isFullLink =
      Boolean(snap) &&
      snap!.text.trim() === (existingAnchor.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    if (isCaret || isFullLink) {
      existingAnchor.href = href;
      existingAnchor.target = '_blank';
      existingAnchor.rel = 'noopener noreferrer';
      if (displayText.trim()) existingAnchor.textContent = displayText.trim();
      return true;
    }
  }

  const range = restoreSnapshot(container, snap);
  if (!range) {
    const endRange = document.createRange();
    endRange.selectNodeContents(container);
    endRange.collapse(false);
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = displayText.trim() || href.replace(/^https?:\/\//i, '');
    endRange.insertNode(a);
    return true;
  }

  const selected = range.toString();
  const label = displayText.trim() || selected || href.replace(/^https?:\/\//i, '');

  if (range.collapsed) {
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    range.insertNode(a);
    const sel = window.getSelection();
    if (sel) {
      const after = document.createRange();
      after.setStartAfter(a);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    return true;
  }

  // Custom display text different from selection → replace only the selected slice
  if (displayText.trim() && displayText.trim() !== selected.replace(/\u00a0/g, ' ').trim()) {
    range.deleteContents();
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = label;
    range.insertNode(a);
    return true;
  }

  // Wrap exactly the restored selection (word / letter), not the whole block
  const beforeHtml = container.innerHTML;
  const ok = document.execCommand('createLink', false, href);
  if (ok) {
    const live = window.getSelection();
    if (live && live.rangeCount > 0) {
      decorateAnchorsInRange(container, live.getRangeAt(0), href);
    } else {
      decorateAnchorsInRange(container, range, href);
    }
    return true;
  }

  // Fallback if execCommand is unavailable
  container.innerHTML = beforeHtml;
  const retry = restoreSnapshot(container, snap);
  if (!retry || retry.collapsed) return false;
  const a = document.createElement('a');
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  try {
    retry.surroundContents(a);
  } catch {
    const contents = retry.extractContents();
    a.appendChild(contents);
    retry.insertNode(a);
  }
  return true;
}

function unlinkInEditable(
  container: HTMLElement,
  snap: SelectionSnapshot | null,
  existingAnchor: HTMLAnchorElement | null
): boolean {
  container.focus();

  const unwrap = (anchor: HTMLAnchorElement) => {
    const parent = anchor.parentNode;
    if (!parent) return;
    while (anchor.firstChild) {
      parent.insertBefore(anchor.firstChild, anchor);
    }
    parent.removeChild(anchor);
    parent.normalize();
  };

  const range = restoreSnapshot(container, snap);

  // Partial selection → unlink only that slice (keeps the rest of the link)
  if (range && !range.collapsed) {
    if (document.execCommand('unlink')) return true;

    // Fallback: unwrap intersecting anchors only when selection covers them fully;
    // otherwise split by extracting the selected middle as plain text.
    const anchors = [...container.querySelectorAll('a')];
    let changed = false;
    for (const anchor of anchors) {
      const ar = document.createRange();
      ar.selectNodeContents(anchor);
      const intersects =
        range.compareBoundaryPoints(Range.END_TO_START, ar) < 0 &&
        range.compareBoundaryPoints(Range.START_TO_END, ar) > 0;
      if (!intersects) continue;

      const coversAll =
        range.compareBoundaryPoints(Range.START_TO_START, ar) <= 0 &&
        range.compareBoundaryPoints(Range.END_TO_END, ar) >= 0;
      if (coversAll) {
        unwrap(anchor);
        changed = true;
      } else {
        const mid = range.extractContents();
        const holder = document.createElement('span');
        holder.appendChild(mid);
        range.insertNode(holder);
        while (holder.firstChild) {
          holder.parentNode?.insertBefore(holder.firstChild, holder);
        }
        holder.remove();
        // Clean empty leftover anchors
        if (!(anchor.textContent ?? '').trim()) unwrap(anchor);
        changed = true;
      }
    }
    return changed;
  }

  // Caret inside a link → remove that whole link
  if (existingAnchor && container.contains(existingAnchor)) {
    unwrap(existingAnchor);
    return true;
  }

  if (range?.collapsed) {
    const node = range.startContainer;
    const el = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
    const anchor = el?.closest?.('a') as HTMLAnchorElement | null;
    if (anchor && container.contains(anchor)) {
      unwrap(anchor);
      return true;
    }
  }

  return false;
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

const RICH_TEXT_SELECTOR =
  'b, strong, i, em, u, s, strike, a, ul, ol, li, span[style*="font"], span[style*="color"]';

function stripEmptyBlocks(root: HTMLElement) {
  root.querySelectorAll('div, p').forEach((node) => {
    const el = node as HTMLElement;
    const text = (el.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    const onlyBreak =
      el.childNodes.length === 1 &&
      el.firstChild?.nodeName === 'BR';
    if (text.length === 0 && (onlyBreak || el.innerHTML.trim() === '')) {
      el.remove();
    }
  });
}

function dedupeIdenticalBlocks(root: HTMLElement) {
  const blocks = [...root.children].filter(
    (node) => node.nodeType === Node.ELEMENT_NODE
  ) as HTMLElement[];
  for (let i = blocks.length - 1; i > 0; i--) {
    const current = (blocks[i].textContent ?? '').replace(/\u00a0/g, ' ').trim();
    const previous = (blocks[i - 1].textContent ?? '').replace(/\u00a0/g, ' ').trim();
    if (current.length > 0 && current === previous) {
      blocks[i].remove();
    }
  }
}

export function normalizeCommittedHtml(html: string): string {
  if (isHtmlEmpty(html)) return '';

  const container = document.createElement('div');
  container.innerHTML = html;
  stripEmptyBlocks(container);
  dedupeIdenticalBlocks(container);

  const plain = (container.textContent ?? '').replace(/\u00a0/g, ' ').trim();
  if (!plain) return '';

  const hasRichFormatting = container.querySelector(RICH_TEXT_SELECTOR) !== null;
  if (!hasRichFormatting) {
    return plain.replace(/\n/g, '<br>');
  }

  return container.innerHTML;
}

function TextFormatToolbar({
  fontSize,
  onFontSizeChange,
  onFormat,
  onInsertLink,
  onLinkMouseDown,
  onToolbarPointerDown,
}: {
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  onFormat: (command: string) => void;
  onInsertLink: () => void;
  onLinkMouseDown?: () => void;
  onToolbarPointerDown?: () => void;
}) {
  const currentIndex = FONT_SIZE_OPTIONS.indexOf(fontSize);
  const canDecrease = currentIndex > 0;
  const canIncrease = currentIndex >= 0 && currentIndex < FONT_SIZE_OPTIONS.length - 1;
  const selectValue = currentIndex >= 0 ? fontSize : nearestFontSize(fontSize);

  const keepEditorFocused = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    onToolbarPointerDown?.();
  };

  return (
    <div
      className="text-format-toolbar absolute left-0 top-full z-50 mt-2 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-0.5 rounded-lg border border-zinc-700 bg-zinc-900/95 px-1.5 py-1 shadow-xl backdrop-blur-sm"
    >
      <button
        type="button"
        title="Decrease font size"
        disabled={!canDecrease}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => canDecrease && onFontSizeChange(FONT_SIZE_OPTIONS[currentIndex - 1])}
        className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>

      <select
        value={selectValue}
        onPointerDown={keepEditorFocused}
        onMouseDown={keepEditorFocused}
        onChange={(e) => onFontSizeChange(Number(e.target.value))}
        className="h-7 max-w-[52px] cursor-pointer rounded border border-zinc-700 bg-zinc-800 px-1 text-xs text-zinc-200 outline-none"
        title="Font size"
      >
        {FONT_SIZE_LOGICAL.map((logical, i) => (
          <option key={logical} value={FONT_SIZE_OPTIONS[i]}>
            {logical}
          </option>
        ))}
      </select>

      <button
        type="button"
        title="Increase font size"
        disabled={!canIncrease}
        onMouseDown={(e) => e.preventDefault()}
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
      <ToolbarButton title="Link" onClick={onInsertLink} onBeforeMouseDown={onLinkMouseDown}>
        <Link2 className="h-3.5 w-3.5" />
      </ToolbarButton>
    </div>
  );
}

function ToolbarButton({
  children,
  title,
  onClick,
  onBeforeMouseDown,
}: {
  children: ReactNode;
  title: string;
  onClick: () => void;
  onBeforeMouseDown?: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        onBeforeMouseDown?.();
        e.preventDefault();
      }}
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
  const draftHtmlRef = useRef(html);
  const isEditingRef = useRef(isEditing);
  const suppressBlurCommitRef = useRef(false);
  const editEndCommittedRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const pendingCommandRef = useRef<string | null>(null);
  const pendingLinkRef = useRef(false);
  const resizeHandleRef = useRef<ResizeHandle>('se');
  const fontSizeRef = useRef(nearestFontSize(fontSize));
  const linkSnapRef = useRef<SelectionSnapshot | null>(null);
  const linkAnchorRef = useRef<HTMLAnchorElement | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('https://');
  const [linkText, setLinkText] = useState('');
  const [linkHasExisting, setLinkHasExisting] = useState(false);
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
  const committedHtml = normalizeCommittedHtml(html);
  const isEmpty = isHtmlEmpty(committedHtml);
  const normalizedFontSize = nearestFontSize(fontSize);
  const [showPlaceholder, setShowPlaceholder] = useState(isEmpty);

  useEffect(() => {
    fontSizeRef.current = normalizedFontSize;
  }, [normalizedFontSize]);

  useEffect(() => {
    isEditingRef.current = isEditing;
    if (isEditing) {
      editEndCommittedRef.current = false;
    }
  }, [isEditing]);

  useEffect(() => {
    draftHtmlRef.current = html;
  }, [html]);

  useEffect(() => {
    if (isEditing) {
      setShowPlaceholder(isEmpty);
    } else {
      setShowPlaceholder(false);
    }
  }, [isEditing, isEmpty]);

  const buildState = useCallback(
    (nextHtml: string, nextFontSize?: number): TextElementState => ({
      id,
      html: nextHtml,
      text: htmlToPlainText(nextHtml),
      fontSize: nextFontSize ?? fontSizeRef.current,
      x,
      y,
      width,
      height,
    }),
    [id, x, y, width, height]
  );

  const readDraftHtml = useCallback(() => {
    const el = editableRef.current;
    const raw = el?.innerHTML ?? draftHtmlRef.current;
    return normalizeCommittedHtml(raw);
  }, []);

  const commitTextWithHtml = useCallback(
    (rawHtml: string, endEdit: boolean) => {
      const nextHtml = normalizeCommittedHtml(rawHtml);
      draftHtmlRef.current = nextHtml;
      setShowPlaceholder(isHtmlEmpty(nextHtml));
      if (!endEdit || !editEndCommittedRef.current) {
        onUpdate(buildState(nextHtml));
      }
      if (!endEdit) return;
      if (editEndCommittedRef.current) return;
      editEndCommittedRef.current = true;
      onEndEdit();
    },
    [buildState, onEndEdit, onUpdate]
  );

  const commitText = useCallback(
    (endEdit: boolean) => {
      commitTextWithHtml(readDraftHtml(), endEdit);
    },
    [commitTextWithHtml, readDraftHtml]
  );

  const persistDraft = useCallback(() => {
    const nextHtml = readDraftHtml();
    draftHtmlRef.current = nextHtml;
    onUpdate(buildState(nextHtml));
  }, [buildState, onUpdate, readDraftHtml]);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => persistDraft(), SAVE_DEBOUNCE_MS);
  }, [persistDraft]);

  useEffect(() => {
    if (!isEditing || !editableRef.current) return;
    const el = editableRef.current;
    const seedHtml = normalizeCommittedHtml(html || '');
    el.innerHTML = seedHtml;
    draftHtmlRef.current = seedHtml;
    applyFontSizeToBlock(el, normalizedFontSize);
    setShowPlaceholder(isHtmlEmpty(seedHtml));
    el.focus();

    if (pendingCommandRef.current) {
      execFormat(pendingCommandRef.current);
      pendingCommandRef.current = null;
      scheduleSave();
    } else if (pendingLinkRef.current) {
      pendingLinkRef.current = false;
      // Avoid browsers selecting all on focus — insert link at caret/end instead
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      linkSnapRef.current = snapshotSelection(el);
      openLinkDialog();
    } else if (!isHtmlEmpty(seedHtml)) {
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
    if (!isEditing) return;

    const handleOutsidePointerDown = (event: Event) => {
      const root = rootRef.current;
      const target = event.target as Node | null;
      if (!root || !target) return;
      if (root.contains(target)) return;
      if ((event.target as HTMLElement).closest?.('.text-format-toolbar')) return;
      if ((event.target as HTMLElement).closest?.('.text-link-dialog')) return;
      if (linkDialogOpen) return;
      if (editEndCommittedRef.current) return;

      window.clearTimeout(saveTimerRef.current);
      commitText(true);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    document.addEventListener('touchstart', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
      document.removeEventListener('touchstart', handleOutsidePointerDown, true);
    };
  }, [isEditing, commitText, linkDialogOpen]);

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
          fontSize: fontSizeRef.current,
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
          fontSize: fontSizeRef.current,
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
    const anchor = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (anchor?.href && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      window.open(anchor.href, '_blank', 'noopener,noreferrer');
      return;
    }
    onSelect();
    onStartEdit();
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (!isEditingRef.current) return;
    if (editEndCommittedRef.current) return;
    if (linkDialogOpen) return;

    const related = e.relatedTarget as HTMLElement | null;
    if (related?.closest('.text-format-toolbar')) return;
    if (related?.closest('.text-link-dialog')) return;

    const capturedHtml = readDraftHtml();

    window.setTimeout(() => {
      if (editEndCommittedRef.current) return;
      if (suppressBlurCommitRef.current) return;
      if (linkDialogOpen) return;
      if (document.activeElement?.closest('.text-format-toolbar')) return;
      if (document.activeElement?.closest('.text-link-dialog')) return;
      window.clearTimeout(saveTimerRef.current);
      commitTextWithHtml(capturedHtml, true);
    }, 0);
  };

  const handleToolbarPointerDown = () => {
    suppressBlurCommitRef.current = true;
    window.setTimeout(() => {
      suppressBlurCommitRef.current = false;
    }, 300);
  };

  const handleInput = () => {
    const el = editableRef.current;
    if (el) draftHtmlRef.current = el.innerHTML;
    setShowPlaceholder(!el || isHtmlEmpty(el.innerHTML));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      if (linkDialogOpen) {
        closeLinkDialog();
        return;
      }
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
    const nextSize = nearestFontSize(size);
    fontSizeRef.current = nextSize;
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
        applyFontSizeToSelection(nextSize);
      } else {
        applyFontSizeToBlock(el, nextSize);
      }
      const nextHtml = normalizeCommittedHtml(el.innerHTML);
      draftHtmlRef.current = nextHtml;
      setShowPlaceholder(isHtmlEmpty(nextHtml));
      window.clearTimeout(saveTimerRef.current);
      onUpdate(buildState(nextHtml, nextSize));
      return;
    }

    onUpdate({ id, text, html: committedHtml, fontSize: nextSize, x, y, width, height });
  };

  const openLinkDialog = () => {
    const el = editableRef.current;
    if (!el) return;

    suppressBlurCommitRef.current = true;
    // Prefer snapshot from Link button mousedown (selection still alive)
    const snap = linkSnapRef.current ?? snapshotSelection(el);
    linkSnapRef.current = snap;
    const anchor = findAnchorForSnapshot(el, snap);
    linkAnchorRef.current = anchor;

    const selected = (snap?.text ?? '').replace(/\u00a0/g, ' ').trim();
    setLinkUrl(anchor?.getAttribute('href') || 'https://');
    // Prefer exact selection; only fall back to full anchor text when caret is inside a link
    setLinkText(
      selected ||
        (snap && snap.start === snap.end && anchor
          ? (anchor.textContent ?? '').replace(/\u00a0/g, ' ').trim()
          : '')
    );
    setLinkHasExisting(Boolean(anchor));
    setLinkDialogOpen(true);
  };

  const closeLinkDialog = () => {
    setLinkDialogOpen(false);
    linkSnapRef.current = null;
    linkAnchorRef.current = null;
    window.setTimeout(() => {
      suppressBlurCommitRef.current = false;
    }, 100);
    editableRef.current?.focus();
  };

  const persistEditorHtml = () => {
    const el = editableRef.current;
    if (!el) return;
    const nextHtml = normalizeCommittedHtml(el.innerHTML);
    draftHtmlRef.current = nextHtml;
    setShowPlaceholder(isHtmlEmpty(nextHtml));
    window.clearTimeout(saveTimerRef.current);
    onUpdate(buildState(nextHtml));
  };

  const captureLinkSelection = () => {
    const el = editableRef.current;
    if (!el) return;
    suppressBlurCommitRef.current = true;
    linkSnapRef.current = snapshotSelection(el);
  };

  const handleInsertLink = () => {
    if (!isEditing) {
      pendingLinkRef.current = true;
      onStartEdit();
      return;
    }
    openLinkDialog();
  };

  const handleSaveLink = () => {
    const el = editableRef.current;
    if (!el || !linkUrl.trim()) return;

    const ok = applyLinkInEditable(
      el,
      linkUrl,
      linkText,
      linkSnapRef.current,
      linkAnchorRef.current
    );
    if (ok) persistEditorHtml();
    closeLinkDialog();
  };

  const handleRemoveLink = () => {
    const el = editableRef.current;
    if (!el) return;

    const ok = unlinkInEditable(el, linkSnapRef.current, linkAnchorRef.current);
    if (ok) persistEditorHtml();
    closeLinkDialog();
  };

  const contentStyle = {
    fontSize: `${normalizedFontSize}px`,
    lineHeight: 1.5,
    fontWeight: 400,
    fontFamily: 'inherit',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    caretColor: '#facc15',
    textAlign: 'center' as const,
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
            ? 'border border-zinc-600/80'
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
              className="canvas-text-editable widget-scrollbar relative z-10 flex h-full w-full items-center justify-center overflow-y-auto px-2 py-1.5 text-center text-gray-300 outline-none"
              style={contentStyle}
            />
            {showPlaceholder && (
              <div
                className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center px-2 py-1.5 text-center text-zinc-500"
                style={contentStyle}
                aria-hidden
              >
                Type something
              </div>
            )}
          </>
        ) : (
          <div
            className={`canvas-text-display relative flex h-full w-full items-center justify-center overflow-hidden px-2 py-1.5 text-center ${
              isSelected ? 'cursor-text' : 'cursor-default'
            } ${isEmpty ? 'text-zinc-500' : 'text-gray-300'}`}
            style={contentStyle}
            onMouseDown={handleActivate}
            {...(!isEmpty ? { dangerouslySetInnerHTML: { __html: committedHtml } } : {})}
          >
            {isEmpty ? 'Type something' : null}
          </div>
        )}
      </div>

      {isSelected && (
        <>
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
            onLinkMouseDown={captureLinkSelection}
            onToolbarPointerDown={handleToolbarPointerDown}
          />
        </>
      )}

      {linkDialogOpen &&
        createPortal(
          <div
            className="text-link-dialog fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeLinkDialog();
            }}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-[0_0_40px_rgba(0,0,0,0.65)]"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-white">
                    {linkHasExisting ? 'Edit link' : 'Add link'}
                  </h3>
                  <p className="mt-1 text-xs text-zinc-500">
                    Set the URL and how the link text should look.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeLinkDialog}
                  className="rounded-md p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <label className="mb-3 block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Link URL
                </span>
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveLink();
                    }
                  }}
                  autoFocus
                  placeholder="https://example.com"
                  className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/15"
                />
              </label>

              <label className="mb-5 block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  Display text
                </span>
                <input
                  type="text"
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleSaveLink();
                    }
                  }}
                  placeholder="Text shown on the canvas"
                  className="h-10 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-yellow-500/50 focus:ring-2 focus:ring-yellow-500/15"
                />
              </label>

              <div className="flex flex-wrap items-center justify-between gap-2">
                {linkHasExisting ? (
                  <button
                    type="button"
                    onClick={handleRemoveLink}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    <Unlink className="h-3.5 w-3.5" />
                    Remove link
                  </button>
                ) : (
                  <span />
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeLinkDialog}
                    className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveLink}
                    disabled={!linkUrl.trim()}
                    className="rounded-xl bg-yellow-400 px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-yellow-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Save link
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
