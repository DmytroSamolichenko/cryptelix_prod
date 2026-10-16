import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { BringToFront, SendToBack } from 'lucide-react';
import { createPortal } from 'react-dom';

export type WidgetLayerAction = 'front' | 'back';

interface WidgetLayerContextMenuProps {
  x: number;
  y: number;
  onAction: (action: WidgetLayerAction) => void;
  onClose: () => void;
}

export function WidgetLayerContextMenu({
  x,
  y,
  onAction,
  onClose,
}: WidgetLayerContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let nextX = x;
    let nextY = y;
    if (rect.right > window.innerWidth - pad) {
      nextX = Math.max(pad, window.innerWidth - rect.width - pad);
    }
    if (rect.bottom > window.innerHeight - pad) {
      nextY = Math.max(pad, window.innerHeight - rect.height - pad);
    }
    if (nextX !== x || nextY !== y) {
      el.style.left = `${nextX}px`;
      el.style.top = `${nextY}px`;
    }
  }, [x, y]);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-[200] min-w-[180px] overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl shadow-black/40"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white"
        onClick={() => {
          onAction('front');
          onClose();
        }}
      >
        <BringToFront className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        Bring to front
      </button>
      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white"
        onClick={() => {
          onAction('back');
          onClose();
        }}
      >
        <SendToBack className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        Send to back
      </button>
    </div>,
    document.body
  );
}

/** Stop canvas right-click pan from starting when the pointer is on a widget. */
export function stopWidgetRightClickPan(event: ReactMouseEvent) {
  if (event.button === 2) {
    event.stopPropagation();
  }
}
