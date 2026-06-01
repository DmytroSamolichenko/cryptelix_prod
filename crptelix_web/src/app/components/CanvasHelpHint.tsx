import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './ui/utils';
import { ChatMessageMarkdown } from './ChatMessageMarkdown';

const AUTO_CLOSE_MS = 7000;

const HELP_MARKDOWN = `## Canvas controls

- **Pan** — middle or right mouse button, or hold **Space** and drag
- **Zoom** — mouse wheel
`;

export function CanvasHelpHint() {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    clearCloseTimer();
    setIsOpen(true);
    closeTimerRef.current = window.setTimeout(() => {
      setIsOpen(false);
      closeTimerRef.current = null;
    }, AUTO_CLOSE_MS);
  }, [clearCloseTimer]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return (
    <div className="pointer-events-auto absolute bottom-3 left-3 z-50">
      <motion.div
        layout
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        className={cn(
          'overflow-hidden border border-zinc-800/80 bg-zinc-900/95 shadow-lg backdrop-blur-sm',
          isOpen ? 'max-w-[17rem] rounded-xl' : 'h-7 w-7 rounded-full'
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isOpen ? (
            <motion.div
              key="panel"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.92 }}
              transition={{ duration: 0.18 }}
              className="px-3 py-2.5"
            >
              <ChatMessageMarkdown content={HELP_MARKDOWN} variant="assistant" />
            </motion.div>
          ) : (
            <motion.button
              key="trigger"
              type="button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              onClick={open}
              className="flex h-7 w-7 items-center justify-center text-xs font-semibold text-zinc-400 transition-colors hover:bg-zinc-800/80 hover:text-yellow-400/90"
              title="Canvas controls"
              aria-label="Show canvas controls"
              aria-expanded={false}
            >
              ?
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
